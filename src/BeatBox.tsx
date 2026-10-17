import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { wakeAudio } from './mixEngine';
import type { AudioClip } from './mixEngine';

/* ==================================================================== */
/* 1. The kit: nine saturated 808-style drums                            */
/* ==================================================================== */

export type DrumId = 'crash1' | 'crash2' | 'ride' | 'hat' | 'snare' | 'tom1' | 'tom2' | 'tom3' | 'kick';

interface Drum {
  id: DrumId;
  label: string;
  short: string;
  on: string; // sequencer square when on
  pad: string; // pad gradient
  level: number; // starting volume, 0 to 1
}

// Order = row order in the step sequencer (cymbals on top, bass drum at the bottom).
export const DRUMS: Drum[] = [
  { id: 'crash1', label: 'Crash 1', short: 'Crash 1', on: 'bg-amber-300 border-amber-100', pad: 'from-amber-300 to-yellow-500', level: 0.6 },
  { id: 'crash2', label: 'Crash 2', short: 'Crash 2', on: 'bg-lime-300 border-lime-100', pad: 'from-lime-300 to-green-500', level: 0.6 },
  { id: 'ride', label: 'Ride', short: 'Ride', on: 'bg-sky-300 border-sky-100', pad: 'from-sky-300 to-blue-500', level: 0.55 },
  { id: 'hat', label: 'Hi-Hat', short: 'Hi-Hat', on: 'bg-teal-300 border-teal-100', pad: 'from-teal-300 to-cyan-500', level: 0.6 },
  { id: 'snare', label: 'Snare', short: 'Snare', on: 'bg-fuchsia-400 border-fuchsia-200', pad: 'from-fuchsia-400 to-purple-500', level: 0.85 },
  { id: 'tom1', label: 'High Tom', short: 'High Tom', on: 'bg-orange-300 border-orange-100', pad: 'from-orange-300 to-orange-500', level: 0.8 },
  { id: 'tom2', label: 'Mid Tom', short: 'Mid Tom', on: 'bg-orange-400 border-orange-200', pad: 'from-orange-400 to-red-500', level: 0.8 },
  { id: 'tom3', label: 'Low Tom', short: 'Low Tom', on: 'bg-orange-600 border-orange-300', pad: 'from-orange-500 to-red-700', level: 0.8 },
  { id: 'kick', label: 'Bass Drum', short: 'Bass Drum', on: 'bg-rose-500 border-rose-200', pad: 'from-rose-500 to-pink-700', level: 0.95 },
];

const ROW_OF: Record<DrumId, number> = {
  crash1: 0, crash2: 1, ride: 2, hat: 3, snare: 4, tom1: 5, tom2: 6, tom3: 7, kick: 8,
};

// Pads are laid out like a kit: cymbals, toms, then the core three.
const PAD_LAYOUT: DrumId[][] = [
  ['crash1', 'ride', 'crash2'],
  ['tom1', 'tom2', 'tom3'],
  ['hat', 'snare', 'kick'],
];

const DRUM_BY_ID = Object.fromEntries(DRUMS.map((d) => [d.id, d])) as Record<DrumId, Drum>;

const SR = 44100;
const STEPS = 16;
const BPM_MIN = 60;
const BPM_MAX = 200;
const LOOKAHEAD = 0.12;
const METAL = [263, 400, 421, 474, 587, 845]; // the six "metal" square waves of an 808 cymbal

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function seconds(id: DrumId, kickLen: number): number {
  switch (id) {
    case 'kick': return kickLen + 0.15;
    case 'snare': return 0.35;
    case 'hat': return 0.16;
    case 'tom1': return 0.55;
    case 'tom2': return 0.65;
    case 'tom3': return 0.85;
    case 'crash1': return 2.0;
    case 'crash2': return 2.4;
    default: return 1.0; // ride
  }
}

// Soft-clipping curve. Higher amounts push the drums harder into saturation.
function satCurve(amount: number) {
  const n = 2048;
  const c = new Float32Array(n);
  const k = Math.max(0.01, amount);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = Math.tanh(x * k) / norm;
  }
  return c;
}

function noiseBuffer(ctx: BaseAudioContext, secs: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * secs), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Builds one drum inside an offline context. Every voice is saturated a little,
// the bass drum and toms a lot, which is where the 808 "crunch" comes from.
function buildVoice(ctx: OfflineAudioContext, id: DrumId, kickLen: number): void {
  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(ctx.destination);

  const sat = (amount: number) => {
    const w = ctx.createWaveShaper();
    w.curve = satCurve(amount);
    w.oversample = '2x';
    return w;
  };
  const noise = (secs: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx, secs);
    s.start(0);
    return s;
  };
  const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };
  const envelope = (points: Array<[number, number]>) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    points.forEach(([t, v], i) => {
      if (i === 0) g.gain.linearRampToValueAtTime(v, t);
      else g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), t);
    });
    return g;
  };
  const tone = (type: OscillatorType, from: number, to: number, glide: number, dur: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, 0);
    o.frequency.exponentialRampToValueAtTime(to, glide);
    o.start(0);
    o.stop(dur);
    return o;
  };
  const metal = (scale: number, level: number) => {
    const sum = ctx.createGain();
    sum.gain.value = level;
    METAL.forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * scale;
      o.connect(sum);
      o.start(0);
    });
    return sum;
  };

  if (id === 'kick') {
    const dur = kickLen + 0.15;
    const body = tone('sine', 190, 52, 0.06, dur);
    body.frequency.exponentialRampToValueAtTime(44, Math.max(kickLen, 0.1));
    const env = envelope([[0.002, 1], [0.15, 0.6], [kickLen, 0.0008]]);
    const drive = sat(5);
    body.connect(env);
    env.connect(drive);
    drive.connect(out);
    const clickLow = filter('lowpass', 2500);
    const clickEnv = envelope([[0.001, 0.5], [0.012, 0.001]]);
    noise(0.05).connect(clickLow);
    clickLow.connect(clickEnv);
    clickEnv.connect(out);
  } else if (id === 'snare') {
    const a = tone('triangle', 190, 150, 0.1, 0.35);
    const aEnv = envelope([[0.002, 0.55], [0.14, 0.001]]);
    const b = tone('triangle', 330, 260, 0.08, 0.35);
    const bEnv = envelope([[0.002, 0.35], [0.09, 0.001]]);
    const hp = filter('highpass', 1500);
    const bp = filter('bandpass', 3500, 0.7);
    const nEnv = envelope([[0.002, 0.9], [0.24, 0.001]]);
    const mix = ctx.createGain();
    const drive = sat(2.5);
    a.connect(aEnv); aEnv.connect(mix);
    b.connect(bEnv); bEnv.connect(mix);
    noise(0.4).connect(hp); hp.connect(bp); bp.connect(nEnv); nEnv.connect(mix);
    mix.connect(drive); drive.connect(out);
  } else if (id === 'hat') {
    const m = metal(1, 0.17);
    const env = envelope([[0.001, 1], [0.07, 0.001]]);
    const hp = filter('highpass', 7000);
    const bp = filter('bandpass', 10000, 0.8);
    const drive = sat(1.5);
    m.connect(hp); hp.connect(bp); bp.connect(env); env.connect(drive); drive.connect(out);
  } else if (id === 'tom1' || id === 'tom2' || id === 'tom3') {
    const base = id === 'tom1' ? 200 : id === 'tom2' ? 140 : 95;
    const len = id === 'tom1' ? 0.45 : id === 'tom2' ? 0.55 : 0.75;
    const body = tone('sine', base * 1.7, base, 0.09, len + 0.1);
    const env = envelope([[0.002, 1], [len, 0.001]]);
    const drive = sat(2.2);
    body.connect(env); env.connect(drive); drive.connect(out);
    const clickLow = filter('lowpass', 2500);
    const clickEnv = envelope([[0.001, 0.25], [0.01, 0.001]]);
    noise(0.05).connect(clickLow);
    clickLow.connect(clickEnv);
    clickEnv.connect(out);
  } else if (id === 'crash1' || id === 'crash2') {
    const dark = id === 'crash2';
    const m = metal(dark ? 0.78 : 1, 0.13);
    const hp = filter('highpass', dark ? 4200 : 5200);
    const env = envelope([[0.002, 1], [0.08, 0.45], [dark ? 2.3 : 1.9, 0.001]]);
    const sizzle = noise(2.5);
    const sizzleHp = filter('highpass', dark ? 5200 : 6500);
    const sizzleGain = ctx.createGain();
    sizzleGain.gain.value = 0.5;
    const drive = sat(1.6);
    m.connect(hp); hp.connect(env);
    sizzle.connect(sizzleHp); sizzleHp.connect(sizzleGain); sizzleGain.connect(env);
    env.connect(drive); drive.connect(out);
  } else {
    // ride
    const m = metal(1.38, 0.12);
    const bp = filter('bandpass', 7000, 0.8);
    const hp = filter('highpass', 4500);
    const env = envelope([[0.002, 1], [0.05, 0.35], [0.95, 0.001]]);
    const bell = tone('sine', 2650, 2650, 0.1, 0.3);
    const bellEnv = envelope([[0.002, 0.35], [0.18, 0.001]]);
    const drive = sat(1.3);
    m.connect(bp); bp.connect(hp); hp.connect(env); env.connect(drive); drive.connect(out);
    bell.connect(bellEnv); bellEnv.connect(drive);
  }
}

async function renderDrum(id: DrumId, kickLen: number): Promise<AudioBuffer> {
  const Off =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new Off(1, Math.ceil(SR * seconds(id, kickLen)), SR);
  buildVoice(ctx, id, kickLen);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) {
    const scale = 0.9 / peak;
    for (let i = 0; i < d.length; i++) d[i] *= scale;
  }
  return buf;
}

/* ==================================================================== */
/* 2. Output bus, playing a step, saving a WAV                           */
/* ==================================================================== */

interface Bus {
  input: GainNode;
  shaper: WaveShaperNode;
  master: GainNode;
}

// drive: 0 to 1. master: 0 to 1.
function createBus(ctx: BaseAudioContext, drive: number, master: number): Bus {
  const input = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '4x';
  shaper.curve = satCurve(1 + drive * 9);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 6;
  comp.ratio.value = 10;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  const out = ctx.createGain();
  out.gain.value = master;
  input.connect(shaper);
  shaper.connect(comp);
  comp.connect(out);
  out.connect(ctx.destination);
  return { input, shaper, master: out };
}

type Buffers = Partial<Record<DrumId, AudioBuffer>>;

interface Mix {
  vol: Record<DrumId, number>;
  muted: Record<DrumId, boolean>;
  solo: Record<DrumId, boolean>;
}

function hit(ctx: BaseAudioContext, dest: AudioNode, buf: AudioBuffer, when: number, gain: number): void {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(dest);
  src.start(when);
}

// Square codes: 0 off, 1 soft, 2 hit, 3 loud, 12/13/14 = roll of 2, 3 or 4 hits in one step.
const velocityOf = (code: number) => (code === 1 ? 0.45 : code === 3 ? 1 : 0.8);
const repeatsOf = (code: number) => (code >= 12 ? code - 10 : 1);

function playStep(
  ctx: BaseAudioContext,
  dest: AudioNode,
  bufs: Buffers,
  pattern: number[][],
  mix: Mix,
  step: number,
  when: number,
  stepDur: number,
): void {
  const anySolo = DRUMS.some((d) => mix.solo[d.id]);
  DRUMS.forEach((d, r) => {
    const code = pattern[r][step];
    if (!code) return;
    const buf = bufs[d.id];
    if (!buf) return;
    if (mix.muted[d.id] || (anySolo && !mix.solo[d.id])) return;
    const reps = repeatsOf(code);
    for (let k = 0; k < reps; k++) {
      hit(ctx, dest, buf, when + (k * stepDur) / reps, velocityOf(code) * mix.vol[d.id]);
    }
  });
}

const swingOffset = (step: number, swing: number, stepDur: number) =>
  step % 2 === 1 ? ((swing / 100) * stepDur) / 3 : 0;

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const bytes = new ArrayBuffer(44 + length * channels * 2);
  const view = new DataView(bytes);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + length * channels * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = clamp(data[c][i], -1, 1);
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

async function renderWav(
  bufs: Buffers,
  pattern: number[][],
  mix: Mix,
  bpm: number,
  swing: number,
  drive: number,
  master: number,
  bars: number,
): Promise<Blob> {
  const stepDur = 60 / bpm / 4;
  const total = bars * STEPS * stepDur + 2.4; // room for the last cymbal to ring out
  const Off =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new Off(2, Math.ceil(total * SR), SR);
  const bus = createBus(ctx, drive / 100, master / 100);
  for (let b = 0; b < bars; b++) {
    for (let s = 0; s < STEPS; s++) {
      const when = (b * STEPS + s) * stepDur + swingOffset(s, swing, stepDur);
      playStep(ctx, bus.input, bufs, pattern, mix, s, when, stepDur);
    }
  }
  return encodeWav(await ctx.startRendering());
}

/* ==================================================================== */
/* 3. Twenty beats                                                       */
/* ==================================================================== */

// One string per drum, 16 squares each (one bar of 16th notes).
// . off   o soft   x hit   X loud   2 3 4 roll of 2, 3 or 4 quick hits
export type BeatRows = Partial<Record<DrumId, string>>;

export type Family = 'Trap' | 'Drill' | 'Boom Bap' | 'West Coast' | 'South' | 'Crossover';

export interface Beat {
  id: string;
  name: string;
  family: Family;
  feel: string;
  bpm: number;
  swing: number; // 0 to 100
  drive: number; // 0 to 100
  rows: BeatRows;
}

// These are original grooves written in the sound and tempo range of the big rap styles.
// They are not copies of any recording.
export const BEATS: Beat[] = [
  {
    id: 'atlanta-trap-anthem', name: 'Atlanta Trap Anthem', family: 'Trap', bpm: 140, swing: 0, drive: 55,
    feel: 'Half-time snare, bouncing 808 kick, fast hi-hat rolls.',
    rows: { kick: 'X......x..x.....', snare: '........X.......', hat: 'x.xxx.x.x.x2x.x4', crash1: 'X...............' },
  },
  {
    id: 'melodic-trap-glide', name: 'Melodic Trap Glide', family: 'Trap', bpm: 142, swing: 10, drive: 45,
    feel: 'Smooth and moody, with a triplet roll to turn the bar.',
    rows: { kick: 'X.....x...x.x...', snare: '........X.......', hat: 'x.x.x.x.x.x.x.3.', ride: '..o.......o.....' },
  },
  {
    id: 'dark-trap-banger', name: 'Dark Trap Banger', family: 'Trap', bpm: 138, swing: 0, drive: 80,
    feel: 'Heavy and crunchy. Low toms hit like thunder.',
    rows: { kick: 'X..x..x...x....x', snare: '........X.......', hat: 'x.xxx.xxx.x.x.22', tom3: '............X...', tom2: '..............x.', crash2: 'X...............' },
  },
  {
    id: 'rage-trap-bounce', name: 'Rage Trap Bounce', family: 'Trap', bpm: 155, swing: 0, drive: 70,
    feel: 'Fast, loud and jumpy. Kicks hit on every off-beat.',
    rows: { kick: 'X..x..x..x..x...', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.43', crash1: 'X...............' },
  },
  {
    id: 'trap-soul-slow', name: 'Trap Soul Slow', family: 'Trap', bpm: 130, swing: 25, drive: 35,
    feel: 'Late-night groove with soft ghost notes and a light ride.',
    rows: { kick: 'X.....x....x....', snare: '........X..o....', hat: 'x.o.x.o.x.o.x.o.', ride: '.......o.......o' },
  },
  {
    id: 'phonk-drift', name: 'Phonk Drift', family: 'Trap', bpm: 132, swing: 15, drive: 90,
    feel: 'Gritty, distorted and swaggering, with a bell-like ride.',
    rows: { kick: 'X..x.x..X.x.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.xx', ride: '..x...x...x...x.' },
  },
  {
    id: 'plugg-float', name: 'Plugg Float', family: 'Trap', bpm: 146, swing: 5, drive: 30,
    feel: 'Light and floaty. Soft hats, space for a melody.',
    rows: { kick: 'X.....x.....x...', snare: '........X.......', hat: 'x.o.x.o.x.o.x.o3' },
  },
  {
    id: 'uk-drill-slide', name: 'UK Drill Slide', family: 'Drill', bpm: 140, swing: 0, drive: 60,
    feel: 'Sliding kick pattern and triplet hat rolls.',
    rows: { kick: 'X..x......x..x..', snare: '........X......o', hat: 'x.x.xx3.x.x.xx3.' },
  },
  {
    id: 'nyc-drill-pressure', name: 'NYC Drill Pressure', family: 'Drill', bpm: 146, swing: 0, drive: 70,
    feel: 'Tight, driving hats with a quick roll at the end.',
    rows: { kick: 'X.x...x..x....x.', snare: '........X..o....', hat: 'XoxoXoxoXoxoXox4' },
  },
  {
    id: 'chicago-drill-gritty', name: 'Chicago Drill Gritty', family: 'Drill', bpm: 142, swing: 0, drive: 85,
    feel: 'Dirty and heavy. Low toms add weight.',
    rows: { kick: 'X...x...X..x....', snare: '........X.......', hat: 'x.x.x.x.xx.xx.x2', tom3: '.......x......x.' },
  },
  {
    id: 'boom-bap-classic', name: 'Boom Bap Classic', family: 'Boom Bap', bpm: 90, swing: 45, drive: 20,
    feel: 'Hard kick, crisp snare on 2 and 4, loose swing.',
    rows: { kick: 'X.....x.x.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
  },
  {
    id: 'golden-era-swing', name: 'Golden Era Swing', family: 'Boom Bap', bpm: 94, swing: 55, drive: 25,
    feel: 'Bouncy 90s feel with ghost snares.',
    rows: { kick: 'X.....x..x.x....', snare: '....X..o....X..o', hat: 'x.xox.xox.xox.xo' },
  },
  {
    id: 'jazz-crate-boom-bap', name: 'Jazz Crate Boom Bap', family: 'Boom Bap', bpm: 88, swing: 60, drive: 10,
    feel: 'Swinging ride cymbal and a soft foot hat.',
    rows: { kick: 'X.......x.x.....', snare: '....X.......X..o', hat: '....o.......o...', ride: 'x...x.x.x...x.x.' },
  },
  {
    id: 'lofi-rain-boom-bap', name: 'Lo-fi Rain Boom Bap', family: 'Boom Bap', bpm: 78, swing: 35, drive: 15,
    feel: 'Slow, soft and dusty. Good for chill rap.',
    rows: { kick: 'X.....o.x..x....', snare: '....x.......x...', hat: 'o.o.o.o.o.o.o.o.', ride: '.....o.......o..' },
  },
  {
    id: 'west-coast-bounce', name: 'West Coast Bounce', family: 'West Coast', bpm: 98, swing: 25, drive: 35,
    feel: 'Laid-back bounce with a falling tom fill at the end.',
    rows: { kick: 'X..x..x...x..x..', snare: '....X.......X...', hat: 'x.x.x.xxx.x.x.x.', tom1: '.............x..', tom2: '..............x.', tom3: '...............X' },
  },
  {
    id: 'cali-funk-cruiser', name: 'Cali Funk Cruiser', family: 'West Coast', bpm: 94, swing: 35, drive: 30,
    feel: 'Smooth cruising groove with a ghost snare.',
    rows: { kick: 'X.....x.x.....x.', snare: '....X..o....X...', hat: 'x.o.x.o.x.o.x.o.', crash1: 'X...............' },
  },
  {
    id: 'crunk-party-starter', name: 'Crunk Party Starter', family: 'South', bpm: 78, swing: 0, drive: 75,
    feel: 'Big and loud. Low toms and a crash on the one.',
    rows: { kick: 'X.....X.X...X...', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', tom3: 'X.......X.......', crash1: 'X...............' },
  },
  {
    id: 'houston-slowed', name: 'Houston Slowed', family: 'South', bpm: 68, swing: 20, drive: 50,
    feel: 'Slow, heavy and wide open. Lots of space.',
    rows: { kick: 'X.....x....x....', snare: '........X.......', hat: 'x...x...x...x...', ride: '..o...o...o...o.' },
  },
  {
    id: 'afro-rap-fusion', name: 'Afro-Rap Fusion', family: 'Crossover', bpm: 104, swing: 20, drive: 25,
    feel: 'Rolling 3-3-2 toms over a steady kick.',
    rows: { kick: 'X.......X.......', snare: '....o.......x..o', hat: 'x.x.xxx.x.x.xxx.', ride: 'o...o...o...o...', tom1: 'x..x..x.x..x..x.' },
  },
  {
    id: 'stadium-anthem', name: 'Stadium Anthem', family: 'Crossover', bpm: 128, swing: 0, drive: 45,
    feel: 'Four on the floor with two crashes and a tom fill.',
    rows: { kick: 'X...X...X...X...', snare: '....X.......X...', hat: '..x...x...x...x.', crash1: 'X...............', crash2: '........X.......', tom1: '............x...', tom2: '..............x.', tom3: '...............X' },
  },
];

const FAMILIES: Array<'All' | Family> = ['All', 'Trap', 'Drill', 'Boom Bap', 'West Coast', 'South', 'Crossover'];

const CODE_OF: Record<string, number> = { '.': 0, o: 1, x: 2, X: 3, '2': 12, '3': 13, '4': 14 };

export function decodeRows(rows: BeatRows): number[][] {
  return DRUMS.map((d) => {
    const text = (rows[d.id] ?? '').padEnd(STEPS, '.').slice(0, STEPS);
    return Array.from(text, (c) => CODE_OF[c] ?? 0);
  });
}

const emptyPattern = (): number[][] => DRUMS.map(() => Array<number>(STEPS).fill(0));

/* ==================================================================== */
/* 4. Saved settings                                                     */
/* ==================================================================== */

const STORAGE_KEY = 'cine-beatbox-v2';

interface Saved {
  pattern: number[][];
  bpm: number;
  swing: number;
  drive: number;
  master: number;
  kickLen: number; // seconds
  vol: Record<DrumId, number>;
  muted: Record<DrumId, boolean>;
  solo: Record<DrumId, boolean>;
  beatId: string | null;
}

const byDrum = <T,>(make: (d: Drum) => T) =>
  Object.fromEntries(DRUMS.map((d) => [d.id, make(d)])) as Record<DrumId, T>;

function defaults(): Saved {
  const first = BEATS[0];
  return {
    pattern: decodeRows(first.rows),
    bpm: first.bpm,
    swing: first.swing,
    drive: first.drive,
    master: 80,
    kickLen: 1.0,
    vol: byDrum((d) => d.level),
    muted: byDrum(() => false),
    solo: byDrum(() => false),
    beatId: first.id,
  };
}

function isNumberIn(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

function loadSaved(): Saved {
  const base = defaults();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Saved>;
    const patternOk =
      Array.isArray(p.pattern) &&
      p.pattern.length === DRUMS.length &&
      p.pattern.every((row) => Array.isArray(row) && row.length === STEPS && row.every((v) => typeof v === 'number' && v in { 0: 1, 1: 1, 2: 1, 3: 1, 12: 1, 13: 1, 14: 1 }));
    const record = <T,>(src: unknown, ok: (v: unknown) => boolean, fallback: Record<DrumId, T>): Record<DrumId, T> => {
      if (typeof src !== 'object' || src === null) return fallback;
      const obj = src as Record<string, unknown>;
      return byDrum((d) => (ok(obj[d.id]) ? (obj[d.id] as T) : fallback[d.id]));
    };
    return {
      pattern: patternOk ? (p.pattern as number[][]) : base.pattern,
      bpm: isNumberIn(p.bpm, BPM_MIN, BPM_MAX) ? Math.round(p.bpm) : base.bpm,
      swing: isNumberIn(p.swing, 0, 100) ? p.swing : base.swing,
      drive: isNumberIn(p.drive, 0, 100) ? p.drive : base.drive,
      master: isNumberIn(p.master, 0, 100) ? p.master : base.master,
      kickLen: isNumberIn(p.kickLen, 0.3, 2) ? p.kickLen : base.kickLen,
      vol: record<number>(p.vol, (v) => isNumberIn(v, 0, 1), base.vol),
      muted: record<boolean>(p.muted, (v) => typeof v === 'boolean', base.muted),
      solo: record<boolean>(p.solo, (v) => typeof v === 'boolean', base.solo),
      beatId: typeof p.beatId === 'string' && BEATS.some((b) => b.id === p.beatId) ? p.beatId : null,
    };
  } catch {
    return base;
  }
}

/* ==================================================================== */
/* 5. Screen                                                             */
/* ==================================================================== */

const FOCUS = 'focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-white';
const BTN = `min-h-[48px] px-4 py-2 rounded-xl text-base font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-100 ${FOCUS}`;
const BTN_PRIMARY = `w-full min-h-[64px] px-6 py-4 rounded-2xl font-bold text-lg bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 text-white shadow-lg shadow-pink-500/25 ${FOCUS}`;
const BTN_DISABLED = `w-full min-h-[64px] px-6 py-4 rounded-2xl font-bold text-lg bg-slate-800 text-slate-400 cursor-not-allowed ${FOCUS}`;
const CHIP = (on: boolean) =>
  `min-h-[44px] rounded-full px-4 text-base font-semibold ${FOCUS} ${
    on ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
  }`;

type Tab = 'pads' | 'steps' | 'beats' | 'sound';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'pads', label: 'Pads' },
  { id: 'steps', label: 'Steps' },
  { id: 'beats', label: 'Beats' },
  { id: 'sound', label: 'Sound' },
];

const BRUSHES: Array<{ code: number; label: string }> = [
  { code: 2, label: 'Hit' },
  { code: 1, label: 'Soft' },
  { code: 3, label: 'Loud' },
  { code: 12, label: 'Roll ×2' },
  { code: 13, label: 'Roll ×3' },
  { code: 14, label: 'Roll ×4' },
];

const BAR_CHOICES = [1, 2, 4, 8];

interface Props {
  modeLabel: string;
  onHome: () => void;
  onAdd: (clip: AudioClip) => void;
  track?: string;
  choiceId: string;
}

interface SliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: string;
  onChange: (v: number) => void;
}

function Slider({ id, label, value, min, max, step = 1, suffix = '', hint, onChange }: SliderProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-base font-bold">
          {label}
        </label>
        <span className="text-sm tabular-nums text-slate-300">
          {value}
          {suffix}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 w-full accent-pink-500"
      />
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

function BeatPreview({ rows }: { rows: BeatRows }) {
  const lanes: Array<{ id: DrumId; on: string }> = [
    { id: 'hat', on: 'bg-teal-300' },
    { id: 'snare', on: 'bg-fuchsia-400' },
    { id: 'kick', on: 'bg-rose-500' },
  ];
  const decoded = decodeRows(rows);
  return (
    <div className="space-y-0.5" aria-hidden="true">
      {lanes.map((lane) => (
        <div key={lane.id} className="grid gap-px" style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}>
          {decoded[ROW_OF[lane.id]].map((code, i) => (
            <span key={i} className={`h-1.5 rounded-sm ${code ? lane.on : 'bg-slate-800'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function DonePanel({ message, onAgain, onHome }: { message: string; onAgain: () => void; onHome: () => void }) {
  return (
    <div role="status" className="space-y-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5">
      <p className="text-2xl font-black text-emerald-300">🎉 Added to your project!</p>
      <p className="leading-relaxed text-slate-200">{message}</p>
      <div className="grid gap-3">
        <button type="button" onClick={onHome} className={BTN_PRIMARY}>
          Back to my project
        </button>
        <button type="button" onClick={onAgain} className={`${BTN} min-h-[56px] text-lg`}>
          Keep making my beat
        </button>
      </div>
    </div>
  );
}

export default function BeatBox({ modeLabel, onHome, onAdd, track, choiceId }: Props) {
  const [saved] = useState<Saved>(loadSaved);
  const [pattern, setPattern] = useState<number[][]>(saved.pattern);
  const [bpm, setBpm] = useState(saved.bpm);
  const [swing, setSwing] = useState(saved.swing);
  const [drive, setDrive] = useState(saved.drive);
  const [master, setMaster] = useState(saved.master);
  const [kickLen, setKickLen] = useState(saved.kickLen);
  const [vol, setVol] = useState(saved.vol);
  const [muted, setMuted] = useState(saved.muted);
  const [solo, setSolo] = useState(saved.solo);
  const [beatId, setBeatId] = useState<string | null>(saved.beatId);

  const [tab, setTab] = useState<Tab>('pads');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [rec, setRec] = useState(false);
  const [brush, setBrush] = useState(2);
  const [page, setPage] = useState(0);
  const [follow, setFollow] = useState(true);
  const [family, setFamily] = useState<'All' | Family>('All');
  const [lit, setLit] = useState<Partial<Record<DrumId, boolean>>>({});
  const [bars, setBars] = useState(4);
  const [undoCount, setUndoCount] = useState(0);
  const [added, setAdded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const ctxRef = useRef<AudioContext | null>(null);
  const busRef = useRef<Bus | null>(null);
  const bufsRef = useRef<Buffers>({});
  const renderedKickRef = useRef(saved.kickLen);
  const timerRef = useRef<number | undefined>(undefined);
  const playingRef = useRef(false);
  const recRef = useRef(false);
  const nextTimeRef = useRef(0);
  const stepRef = useRef(0);
  const recentRef = useRef<Array<{ step: number; when: number }>>([]);
  const undoRef = useRef<number[][][]>([]);
  const tapsRef = useRef<number[]>([]);
  const litTimers = useRef<Partial<Record<DrumId, number>>>({});
  const snapshotRef = useRef<Saved | null>(null);

  const patternRef = useRef(pattern);
  const bpmRef = useRef(bpm);
  const swingRef = useRef(swing);
  const mixRef = useRef<Mix>({ vol, muted, solo });
  patternRef.current = pattern;
  bpmRef.current = bpm;
  swingRef.current = swing;
  mixRef.current = { vol, muted, solo };
  recRef.current = rec;

  const beat = BEATS.find((b) => b.id === beatId) ?? null;

  const flushSaved = () => {
    try {
      if (snapshotRef.current) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotRef.current));
    } catch {
      // storage unavailable
    }
  };

  /* ---------- render the drums once (and the bass drum again when its length changes) ---------- */
  useEffect(() => {
    let cancelled = false;
    Promise.all(DRUMS.map(async (d) => [d.id, await renderDrum(d.id, renderedKickRef.current)] as const))
      .then((entries) => {
        if (cancelled) return;
        entries.forEach(([id, buf]) => {
          bufsRef.current[id] = buf;
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || renderedKickRef.current === kickLen) return;
    const t = window.setTimeout(() => {
      renderDrum('kick', kickLen)
        .then((buf) => {
          bufsRef.current.kick = buf;
          renderedKickRef.current = kickLen;
        })
        .catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(t);
  }, [kickLen, ready]);

  /* ---------- live sound settings ---------- */
  useEffect(() => {
    const bus = busRef.current;
    if (bus) bus.shaper.curve = satCurve(1 + (drive / 100) * 9);
  }, [drive]);

  useEffect(() => {
    const bus = busRef.current;
    const ctx = ctxRef.current;
    if (bus && ctx) bus.master.gain.setTargetAtTime(master / 100, ctx.currentTime, 0.02);
  }, [master]);

  /* ---------- remember settings ---------- */
  // Saved a moment after each change, and again right away when leaving the screen
  // or closing the page, so a quick change is never lost.
  snapshotRef.current = { pattern, bpm, swing, drive, master, kickLen, vol, muted, solo, beatId };

  useEffect(() => {
    const t = window.setTimeout(flushSaved, 300);
    return () => window.clearTimeout(t);
  }, [pattern, bpm, swing, drive, master, kickLen, vol, muted, solo, beatId]);

  useEffect(() => {
    const onHide = () => flushSaved();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flushSaved();
    };
    // flushSaved reads from a ref, so it never changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- follow the playhead across the two pages ---------- */
  useEffect(() => {
    if (playing && follow && activeStep >= 0) setPage(activeStep < 8 ? 0 : 1);
  }, [activeStep, playing, follow]);

  /* ---------- clean up ---------- */
  useEffect(
    () => () => {
      window.clearInterval(timerRef.current);
      playingRef.current = false;
      Object.values(litTimers.current).forEach((t) => window.clearTimeout(t));
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    [],
  );

  /* ---------- audio ---------- */
  const ensureAudio = (): { ctx: AudioContext; bus: Bus } => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      ctxRef.current = ctx;
      busRef.current = createBus(ctx, drive / 100, master / 100);
      void wakeAudio(ctx);
    }
    const ctx = ctxRef.current;
    if (ctx.state !== 'running') void wakeAudio(ctx);
    return { ctx, bus: busRef.current as Bus };
  };

  const flash = (id: DrumId) => {
    setLit((prev) => ({ ...prev, [id]: true }));
    window.clearTimeout(litTimers.current[id]);
    litTimers.current[id] = window.setTimeout(() => setLit((prev) => ({ ...prev, [id]: false })), 110);
  };

  const commit = (next: number[][]) => {
    undoRef.current.push(patternRef.current);
    if (undoRef.current.length > 40) undoRef.current.shift();
    patternRef.current = next;
    setPattern(next);
    setUndoCount(undoRef.current.length);
  };

  const setCell = (r: number, i: number, code: number) =>
    patternRef.current.map((row, ri) => (ri === r ? row.map((v, vi) => (vi === i ? code : v)) : row));

  const recordHit = (id: DrumId, t: number) => {
    const recent = recentRef.current;
    if (!recent.length) return;
    let best = recent[0];
    for (const e of recent) if (Math.abs(e.when - t) < Math.abs(best.when - t)) best = e;
    commit(setCell(ROW_OF[id], best.step, 2));
  };

  const press = (id: DrumId) => {
    if (!ready) return;
    const { ctx, bus } = ensureAudio();
    const buf = bufsRef.current[id];
    if (!buf) return;
    hit(ctx, bus.input, buf, ctx.currentTime, mixRef.current.vol[id]);
    flash(id);
    if (playingRef.current && recRef.current) recordHit(id, ctx.currentTime);
  };

  const preview = (id: DrumId, code: number) => {
    if (!ready || playingRef.current) return;
    const { ctx, bus } = ensureAudio();
    const buf = bufsRef.current[id];
    if (buf) hit(ctx, bus.input, buf, ctx.currentTime, velocityOf(code) * mixRef.current.vol[id]);
  };

  /* ---------- transport ---------- */
  const stop = () => {
    window.clearInterval(timerRef.current);
    playingRef.current = false;
    setPlaying(false);
    setActiveStep(-1);
  };

  const start = () => {
    if (!ready || playingRef.current) return;
    const { ctx, bus } = ensureAudio();
    nextTimeRef.current = ctx.currentTime + 0.06;
    stepRef.current = 0;
    recentRef.current = [];
    playingRef.current = true;
    setPlaying(true);
    timerRef.current = window.setInterval(() => {
      while (nextTimeRef.current < ctx.currentTime + LOOKAHEAD) {
        const step = stepRef.current;
        const stepDur = 60 / bpmRef.current / 4;
        const when = nextTimeRef.current + swingOffset(step, swingRef.current, stepDur);
        playStep(ctx, bus.input, bufsRef.current, patternRef.current, mixRef.current, step, when, stepDur);
        recentRef.current.push({ step, when });
        if (recentRef.current.length > 20) recentRef.current.shift();
        window.setTimeout(() => {
          if (playingRef.current) setActiveStep(step);
        }, Math.max(0, (when - ctx.currentTime) * 1000));
        nextTimeRef.current += stepDur;
        stepRef.current = (step + 1) % STEPS;
      }
    }, 25);
  };

  const togglePlay = () => (playingRef.current ? stop() : start());

  const changeBpm = (next: number) => setBpm(clamp(Math.round(next), BPM_MIN, BPM_MAX));

  const tapTempo = () => {
    const now = performance.now();
    const taps = tapsRef.current;
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 6) taps.shift();
    if (taps.length >= 2) changeBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
  };

  /* ---------- editing ---------- */
  const paint = (r: number, i: number) => {
    const current = patternRef.current[r][i];
    const next = current === brush ? 0 : brush;
    commit(setCell(r, i, next));
    if (next) preview(DRUMS[r].id, next);
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    patternRef.current = prev;
    setPattern(prev);
    setUndoCount(undoRef.current.length);
  };

  const clearAll = () => commit(emptyPattern());

  const surprise = () => {
    const chance = (p: number) => Math.random() < p;
    const next = emptyPattern();
    const halfTime = chance(0.6);
    next[ROW_OF.kick][0] = 3;
    [3, 6, 7, 10, 11, 13].forEach((s) => chance(0.35) && (next[ROW_OF.kick][s] = 2));
    (halfTime ? [8] : [4, 12]).forEach((s) => (next[ROW_OF.snare][s] = 3));
    for (let s = 0; s < STEPS; s++) {
      if (s % 2 === 0) next[ROW_OF.hat][s] = s % 4 === 0 ? 2 : 1 + (chance(0.6) ? 1 : 0);
      else if (chance(0.25)) next[ROW_OF.hat][s] = chance(0.5) ? 12 : 13;
    }
    if (chance(0.5)) next[ROW_OF.crash1][0] = 3;
    if (chance(0.4)) [13, 14, 15].forEach((s, k) => (next[ROW_OF[(['tom1', 'tom2', 'tom3'] as DrumId[])[k]]][s] = 2));
    commit(next);
    setBeatId(null);
  };

  const loadBeat = (b: Beat, andPlay: boolean) => {
    commit(decodeRows(b.rows));
    setBpm(b.bpm);
    setSwing(b.swing);
    setDrive(b.drive);
    setBeatId(b.id);
    setAdded(false);
    if (andPlay) {
      if (playingRef.current) {
        stepRef.current = 0;
      } else {
        start();
      }
    }
  };

  /* ---------- finishing ---------- */
  const beatName = beat ? beat.name : 'My beat';

  const addToProject = async () => {
    if (saving || !ready) return;
    stop();
    const stepDur = 60 / bpm / 4;
    setSaving(true);
    let blob: Blob | undefined;
    try {
      blob = await renderWav(bufsRef.current, patternRef.current, mixRef.current, bpm, swing, drive, master, bars);
    } catch {
      blob = undefined; // still add the clip: the mixer will just show it as silent
    }
    setSaving(false);
    onAdd({ name: beatName, type: 'audio', duration: bars * STEPS * stepDur, track, from: choiceId, blob });
    setAdded(true);
  };

  const saveWav = async () => {
    if (saving || !ready) return;
    setSaving(true);
    setStatus('Making your file…');
    try {
      const blob = await renderWav(bufsRef.current, patternRef.current, mixRef.current, bpm, swing, drive, master, bars);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const fileName = `${beatName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${bpm}bpm.wav`;
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 15000);
      setStatus(`Saved ${fileName}. Look in your downloads.`);
    } catch {
      setStatus('Sorry, your phone could not make the file. Try fewer bars.');
    } finally {
      setSaving(false);
    }
  };

  /* ---------- derived ---------- */
  const anySolo = DRUMS.some((d) => solo[d.id]);
  const audible = (id: DrumId) => !muted[id] && (!anySolo || solo[id]);
  const shownBeats = BEATS.filter((b) => family === 'All' || b.family === family);

  const padKey = (id: DrumId) => (e: { key: string; repeat: boolean; preventDefault: () => void }) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      press(id);
    }
  };

  /* ================================================================== */

  const content: ReactNode = (
    <>
      {tab === 'pads' ? (
        <section aria-label="Drum pads" className="space-y-3">
          <p className="text-base text-slate-300">
            Tap the pads to play. Press <b>Rec</b>, then <b>Play</b>, and your taps go into the beat.
          </p>
          <div className="grid gap-3">
            {PAD_LAYOUT.map((row, ri) => (
              <div key={ri} className="grid grid-cols-3 gap-3">
                {row.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={DRUM_BY_ID[id].label}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      press(id);
                    }}
                    onKeyDown={padKey(id)}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`h-24 select-none touch-manipulation rounded-2xl bg-gradient-to-br ${DRUM_BY_ID[id].pad} px-1 text-lg font-black leading-tight text-slate-950 ${FOCUS} ${
                      lit[id] ? 'scale-95 brightness-125' : ''
                    }`}
                  >
                    {DRUM_BY_ID[id].label}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {!ready ? <p className="text-slate-300">{failed ? 'Sorry, the drums could not load. Try reloading the page.' : 'Loading your drums…'}</p> : null}
        </section>
      ) : null}

      {tab === 'steps' ? (
        <section aria-label="Step sequencer" className="space-y-4">
          <div className="space-y-2">
            <p className="text-base font-bold">Paint with:</p>
            <div className="flex flex-wrap gap-2">
              {BRUSHES.map((b) => (
                <button key={b.code} type="button" aria-pressed={brush === b.code} onClick={() => setBrush(b.code)} className={CHIP(brush === b.code)}>
                  {b.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">Tap a square to add that sound. Tap it again to remove it. Rolls play quick repeats, great for hi-hats.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={page === 0} onClick={() => { setPage(0); setFollow(false); }} className={CHIP(page === 0)}>
              Steps 1–8
            </button>
            <button type="button" aria-pressed={page === 1} onClick={() => { setPage(1); setFollow(false); }} className={CHIP(page === 1)}>
              Steps 9–16
            </button>
            <button type="button" aria-pressed={follow} onClick={() => setFollow((f) => !f)} className={CHIP(follow)}>
              Follow
            </button>
          </div>

          <div className="space-y-1.5">
            {DRUMS.map((d, r) => (
              <div key={d.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onPointerDown={() => press(d.id)}
                  onKeyDown={padKey(d.id)}
                  aria-label={`Hear ${d.label}`}
                  className={`w-[4.25rem] shrink-0 rounded-lg px-1 py-2 text-left text-xs font-bold leading-tight ${FOCUS} ${audible(d.id) ? 'bg-slate-900 text-slate-100' : 'bg-slate-900 text-slate-500 line-through'}`}
                >
                  {d.short}
                </button>
                <div className="grid flex-1 grid-cols-8 gap-1">
                  {pattern[r].slice(page * 8, page * 8 + 8).map((code, c) => {
                    const i = page * 8 + c;
                    const rep = repeatsOf(code);
                    return (
                      <button
                        key={i}
                        type="button"
                        aria-pressed={code > 0}
                        aria-label={`${d.label}, step ${i + 1}${code ? (rep > 1 ? `, roll of ${rep}` : code === 1 ? ', soft' : code === 3 ? ', loud' : ', on') : ', off'}`}
                        onClick={() => paint(r, i)}
                        className={`flex h-11 items-center justify-center rounded-md border-2 text-xs font-black text-slate-950 ${FOCUS} ${
                          code ? `${d.on} ${code === 1 ? 'opacity-55' : ''} ${code === 3 ? 'ring-2 ring-white/80' : ''}` : i % 4 === 0 ? 'border-slate-600 bg-slate-800' : 'border-slate-700 bg-slate-900'
                        } ${activeStep === i ? 'outline outline-2 outline-white' : ''}`}
                      >
                        {rep > 1 ? `${rep}×` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={undo} disabled={undoCount === 0} className={`${BTN} disabled:opacity-40`}>
              ↩ Undo
            </button>
            <button type="button" onClick={clearAll} className={BTN}>
              🧹 Clear
            </button>
            <button type="button" onClick={surprise} className={BTN}>
              🎲 Surprise
            </button>
          </div>
        </section>
      ) : null}

      {tab === 'beats' ? (
        <section aria-label="Beat library" className="space-y-4">
          <p className="text-base text-slate-300">Twenty beats in the sound of the big rap styles. Tap one to load it and hear it.</p>
          <div className="flex flex-wrap gap-2">
            {FAMILIES.map((f) => (
              <button key={f} type="button" aria-pressed={family === f} onClick={() => setFamily(f)} className={CHIP(family === f)}>
                {f}
              </button>
            ))}
          </div>
          <ul className="space-y-3">
            {shownBeats.map((b) => (
              <li key={b.id} className={`space-y-3 rounded-2xl border bg-slate-900 p-4 ${beatId === b.id ? 'border-pink-500' : 'border-slate-800'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold leading-snug">{b.name}</h3>
                    <p className="text-sm leading-snug text-slate-300">{b.feel}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-800 px-3 py-1 text-sm font-bold tabular-nums">{b.bpm} BPM</span>
                </div>
                <BeatPreview rows={b.rows} />
                <button type="button" onClick={() => loadBeat(b, true)} className={`${BTN} w-full min-h-[52px] text-lg`}>
                  {beatId === b.id ? '▶ Play again' : '▶ Load & play'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === 'sound' ? (
        <section aria-label="Sound settings" className="space-y-5">
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <Slider id="tempo" label="Tempo" value={bpm} min={BPM_MIN} max={BPM_MAX} suffix=" BPM" onChange={changeBpm} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => changeBpm(bpm / 2)} className={BTN}>
                ½× Half-time
              </button>
              <button type="button" onClick={() => changeBpm(bpm * 2)} className={BTN}>
                2× Double-time
              </button>
            </div>
            <Slider id="swing" label="Swing" value={Math.round(swing)} min={0} max={100} suffix="%" hint="Pushes every other 16th note late for a loose, bouncy feel." onChange={setSwing} />
            <Slider id="drive" label="808 Drive" value={Math.round(drive)} min={0} max={100} suffix="%" hint="Saturation. Turn it up for a crunchier, harder sound." onChange={setDrive} />
            <Slider id="boom" label="Boom length" value={Math.round(kickLen * 10) / 10} min={0.3} max={2} step={0.1} suffix=" s" hint="How long the bass drum rings." onChange={setKickLen} />
            <Slider id="master" label="Master volume" value={Math.round(master)} min={0} max={100} suffix="%" onChange={setMaster} />
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-lg font-bold">Mixer</h2>
            {DRUMS.map((d) => (
              <div key={d.id} className="flex items-center gap-2">
                <label htmlFor={`vol-${d.id}`} className="w-20 shrink-0 text-sm font-bold">
                  {d.label}
                </label>
                <input
                  id={`vol-${d.id}`}
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(vol[d.id] * 100)}
                  onChange={(e) => setVol((v) => ({ ...v, [d.id]: Number(e.target.value) / 100 }))}
                  className="h-9 min-w-0 flex-1 accent-pink-500"
                />
                <button
                  type="button"
                  aria-pressed={muted[d.id]}
                  aria-label={`Mute ${d.label}`}
                  onClick={() => setMuted((m) => ({ ...m, [d.id]: !m[d.id] }))}
                  className={`h-11 w-11 shrink-0 rounded-lg text-sm font-black ${FOCUS} ${muted[d.id] ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300'}`}
                >
                  M
                </button>
                <button
                  type="button"
                  aria-pressed={solo[d.id]}
                  aria-label={`Solo ${d.label}`}
                  onClick={() => setSolo((s) => ({ ...s, [d.id]: !s[d.id] }))}
                  className={`h-11 w-11 shrink-0 rounded-lg text-sm font-black ${FOCUS} ${solo[d.id] ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
                >
                  S
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            stop();
            onHome();
          }}
          className={BTN}
        >
          ← Back to my project
        </button>
        <div className="inline-flex items-center gap-2 truncate rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
          ✓ {modeLabel}
        </div>
      </header>

      <div className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-4 py-2 backdrop-blur">
        <div className="mx-auto max-w-xl space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!ready}
              className={`min-h-[56px] flex-1 rounded-2xl text-xl font-bold ${FOCUS} ${
                !ready ? 'cursor-not-allowed bg-slate-800 text-slate-400' : playing ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
              }`}
            >
              {!ready ? 'Loading…' : playing ? '■ Stop' : '▶ Play'}
            </button>
            <button
              type="button"
              aria-pressed={rec}
              onClick={() => setRec((r) => !r)}
              className={`min-h-[56px] w-24 shrink-0 rounded-2xl text-lg font-bold ${FOCUS} ${rec ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-100 hover:bg-slate-700'}`}
            >
              ● Rec
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Slower" onClick={() => changeBpm(bpm - 1)} className={`${BTN} w-12 px-0 text-xl`}>
              −
            </button>
            <div className="flex-1 text-center" aria-live="off">
              <span data-testid="bpm" className="text-3xl font-black tabular-nums">
                {bpm}
              </span>
              <span className="ml-1 text-xs font-semibold text-slate-400">BPM</span>
            </div>
            <button type="button" aria-label="Faster" onClick={() => changeBpm(bpm + 1)} className={`${BTN} w-12 px-0 text-xl`}>
              +
            </button>
            <button type="button" onClick={tapTempo} className={`${BTN} w-20`}>
              Tap
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-xl space-y-4 px-4 py-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-black leading-tight">BeatBox</h1>
          <p className="text-slate-300">{beat ? `Now loaded: ${beat.name}` : 'Your own beat'}</p>
        </div>

        {added ? (
          <DonePanel message="Your beat is on your timeline." onAgain={() => setAdded(false)} onHome={onHome} />
        ) : (
          <>
            <div role="tablist" aria-label="BeatBox sections" className="grid grid-cols-4 gap-1 rounded-2xl bg-slate-900 p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`min-h-[48px] rounded-xl text-base font-bold ${FOCUS} ${tab === t.id ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div role="tabpanel">{content}</div>

            <section aria-label="Finish" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <h2 className="text-xl font-bold">Finished?</h2>
              <div className="space-y-2">
                <p className="text-base font-semibold">How many bars?</p>
                <div className="flex flex-wrap gap-2">
                  {BAR_CHOICES.map((n) => (
                    <button key={n} type="button" aria-pressed={bars === n} onClick={() => setBars(n)} className={CHIP(bars === n)}>
                      {n} {n === 1 ? 'bar' : 'bars'}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => void addToProject()} disabled={saving} className={BTN_PRIMARY}>
                ✓ Add my beat to my project
              </button>
              <button type="button" onClick={saveWav} disabled={saving || !ready} className={`${saving || !ready ? BTN_DISABLED : BTN} w-full min-h-[56px] text-lg`}>
                {saving ? 'Making your file…' : '⬇ Save as a WAV file'}
              </button>
              <p role="status" className="min-h-[1.25rem] text-sm text-slate-300">
                {status}
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
