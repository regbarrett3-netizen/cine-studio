import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AudioClip } from './mixEngine';
import { decodeBlob, encodeWav, wakeAudio } from './mixEngine';
import {
  CHORDS,
  FAMILY_LIST,
  INSTRUMENTS,
  INST_BY_ID,
  MIDI_HIGH,
  MIDI_LOW,
  NOTE_NAMES,
  SCALES,
  makeLimiterCurve,
  makeReverbImpulse,
  noteName,
  startNote,
} from './instruments';
import type { FamilyName, Inst, Voice } from './instruments';

const SAMPLER_ID = 'sampler';
const SAMPLER_INST = { id: SAMPLER_ID, name: 'My Sampler', emoji: '🎙️', family: 'Voices', home: 48, spec: { kind: 'sub' } } as unknown as Inst;

/* ==================================================================== */
/* Keyboard: 88 keys, lots of instruments                                */
/* ==================================================================== */

const FOCUS = 'focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-white';
const BTN = `min-h-[48px] px-4 py-2 rounded-xl text-base font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-100 ${FOCUS}`;
const BTN_PRIMARY = `w-full min-h-[64px] px-6 py-4 rounded-2xl font-bold text-lg bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 text-white shadow-lg shadow-pink-500/25 ${FOCUS}`;

const MAX_REC_SECONDS = 600;
const MAX_VOICES = 36;
const STORAGE_KEY = 'cine-keys-v1';

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const SHARP_AFTER = [0, 2, 5, 7, 9]; // C D F G A have a black key to their right
const WHITES: number[] = [];
for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) if (WHITE_PCS.includes(m % 12)) WHITES.push(m);
const WHITE_INDEX = new Map(WHITES.map((m, i) => [m, i]));
const TOTAL_WHITES = WHITES.length; // 52
const BLACK_W = 0.62; // black key width as a fraction of a white key

const ZOOMS = {
  big: { whites: 8, label: 'Big keys' },
  small: { whites: 14, label: 'Small keys' },
} as const;
type Zoom = keyof typeof ZOOMS;

const REC_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
const pickRecType = () =>
  typeof MediaRecorder === 'undefined' ? '' : (REC_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '');
const extOf = (mime: string) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : 'audio');
const clock = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const startIdxFor = (midi: number, whites: number) => {
  // the white key at or just under `midi`
  let m = midi;
  while (!WHITE_INDEX.has(m) && m > MIDI_LOW) m--;
  return Math.min(Math.max(0, (WHITE_INDEX.get(m) ?? 0)), TOTAL_WHITES - whites);
};

interface Saved {
  inst: string;
  start: number | null;
  zoom: Zoom;
  vol: number;
  reverb: number;
  names: boolean;
  root: number;
  scale: string;
  chord: string;
  touchVel: boolean;
}

const DEFAULTS: Saved = {
  inst: 'grand',
  start: null,
  zoom: 'big',
  vol: 0.8,
  reverb: 0.22,
  names: false,
  root: 0,
  scale: 'off',
  chord: 'off',
  touchVel: true,
};

function loadSaved(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Saved>;
    const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
      inst: typeof p.inst === 'string' && INST_BY_ID[p.inst] ? p.inst : DEFAULTS.inst,
      start: p.start === null || p.start === undefined ? null : n(p.start, 0, TOTAL_WHITES - 1, 0),
      zoom: p.zoom === 'small' ? 'small' : 'big',
      vol: n(p.vol, 0, 1, DEFAULTS.vol),
      reverb: n(p.reverb, 0, 1, DEFAULTS.reverb),
      names: p.names === true,
      root: n(p.root, 0, 11, 0),
      scale: SCALES.some((s) => s.id === p.scale) ? (p.scale as string) : 'off',
      chord: CHORDS.some((c) => c.id === p.chord) ? (p.chord as string) : 'off',
      touchVel: p.touchVel !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

interface Props {
  modeLabel: string;
  onHome: () => void;
  onAdd: (clip: AudioClip) => void;
  track?: string;
  choiceId: string;
}

interface Held {
  midi: number;
  notes: number[];
  voices: Voice[];
}

interface Take {
  url: string;
  secs: number;
  ext: string;
  blob: Blob;
}

/* ==================================================================== */
/* Sampler: record up to 10 seconds with the mic, then play it on keys   */
/* ==================================================================== */

const SAMPLE_MAX = 10;

interface SamplerOpts {
  root: number; // the key that plays the sound at its normal pitch
  loop: boolean;
  pitched: boolean; // keys change the pitch
  oneShot: boolean; // let the sound finish even if you let go
  reverse: boolean;
}

const SAMPLER_DEFAULTS: SamplerOpts = { root: 60, loop: false, pitched: true, oneShot: true, reverse: false };

function startSampleNote(ctx: AudioContext, out: AudioNode, buf: AudioBuffer, o: SamplerOpts, midi: number, vel: number, t: number): Voice {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = o.pitched ? Math.pow(2, (midi - o.root) / 12) : 1;
  if (o.loop) {
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buf.duration;
  }
  const attack = ctx.createGain();
  attack.gain.setValueAtTime(0, t);
  attack.gain.linearRampToValueAtTime(Math.min(1, Math.max(0.05, vel)) * 0.9, t + 0.004);
  const rel = ctx.createGain();
  src.connect(attack);
  attack.connect(rel);
  rel.connect(out);
  src.start(t);
  src.onended = () => {
    try {
      rel.disconnect();
    } catch {
      /* already gone */
    }
  };
  let done = false;
  return {
    release: (when: number) => {
      if (done || (!o.loop && o.oneShot)) return; // one-shots play to the end
      done = true;
      const w = Math.max(when, ctx.currentTime);
      rel.gain.setValueAtTime(1, w);
      rel.gain.setTargetAtTime(0, w, 0.03);
      try {
        src.stop(w + 0.3);
      } catch {
        /* never started */
      }
    },
  };
}

/** Cut the sample to the chosen start and end, and turn it round if asked. */
function makePlayBuffer(ctx: BaseAudioContext, buf: AudioBuffer, start: number, end: number, reverse: boolean): AudioBuffer {
  const rate = buf.sampleRate;
  const from = Math.max(0, Math.floor(start * rate));
  const to = Math.min(buf.length, Math.max(from + 1, Math.floor(end * rate)));
  const out = ctx.createBuffer(buf.numberOfChannels, to - from, rate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < to - from; i++) dst[i] = src[reverse ? to - 1 - i : from + i];
    // short fades hide clicks where we cut
    const fade = Math.min(Math.floor(rate * 0.004), Math.floor((to - from) / 4));
    for (let i = 0; i < fade; i++) {
      dst[i] *= i / fade;
      dst[to - from - 1 - i] *= i / fade;
    }
  }
  return out;
}

interface SamplerPanelProps {
  buf: AudioBuffer | null;
  trim: { start: number; end: number };
  opts: SamplerOpts;
  getCtx: () => AudioContext | null;
  onTrim: (t: { start: number; end: number }) => void;
  onOpts: (o: SamplerOpts) => void;
  onRecorded: (b: AudioBuffer) => void;
  onHear: () => void;
  onAddToProject: () => void;
  added: boolean;
  onSave: () => void;
}

function SamplerPanel(p: SamplerPanelProps) {
  const [phase, setPhase] = useState<'idle' | 'asking' | 'recording' | 'working'>('idle');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const startedRef = useRef(0);
  const peakRef = useRef(0);
  const typeRef = useRef('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dead = useRef(false);

  const release = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    meterCtxRef.current?.close().catch(() => undefined);
    meterCtxRef.current = null;
    setLevel(0);
  };

  useEffect(() => {
    dead.current = false;
    return () => {
      dead.current = true;
      const rec = recRef.current;
      if (rec) {
        rec.onstop = null;
        if (rec.state !== 'inactive') {
          try {
            rec.stop();
          } catch {
            /* already stopped */
          }
        }
      }
      release();
    };
  }, []);

  const finishRecording = async () => {
    const mime = recRef.current?.mimeType || typeRef.current || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];
    const peak = peakRef.current;
    release();
    if (dead.current) return;
    if (blob.size === 0 || peak < 0.015) {
      setError('I could not hear anything. Move the phone closer to your mouth or the sound, then try again.');
      setPhase('idle');
      return;
    }
    setPhase('working');
    const ctx = p.getCtx();
    if (!ctx) {
      setPhase('idle');
      return;
    }
    try {
      const raw = await decodeBlob(ctx, blob);
      if (dead.current) return;
      const len = Math.min(raw.length, Math.floor(raw.sampleRate * SAMPLE_MAX));
      const chs = Math.min(2, raw.numberOfChannels);
      let top = 1e-6;
      for (let c = 0; c < chs; c++) {
        const d = raw.getChannelData(c);
        for (let i = 0; i < len; i++) top = Math.max(top, Math.abs(d[i]));
      }
      const gain = Math.min(8, 0.9 / top); // bring it to a good level, but do not blow up hiss
      const out = ctx.createBuffer(chs, len, raw.sampleRate);
      for (let c = 0; c < chs; c++) {
        const s = raw.getChannelData(c);
        const d = out.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = s[i] * gain;
      }
      p.onRecorded(out);
      setPhase('idle');
    } catch {
      setError('This phone could not open that recording. Try again.');
      setPhase('idle');
    }
  };

  const stop = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const start = async () => {
    if (phase !== 'idle') return;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record. Try Safari or Chrome on your phone.');
      return;
    }
    setPhase('asking');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'The microphone is turned off for this page. Allow the microphone in your browser settings, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found on this device.'
            : 'The microphone is busy or not working. Close other apps that use it, then try again.',
      );
      setPhase('idle');
      return;
    }
    if (dead.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    peakRef.current = 0;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const mctx = new AC();
      meterCtxRef.current = mctx;
      void mctx.resume();
      const an = mctx.createAnalyser();
      an.fftSize = 1024;
      mctx.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.fftSize);
      const draw = () => {
        an.getByteTimeDomainData(data);
        let pk = 0;
        for (let i = 0; i < data.length; i++) pk = Math.max(pk, Math.abs(data[i] - 128) / 128);
        peakRef.current = Math.max(peakRef.current, pk);
        setLevel((prev) => Math.max(pk, prev * 0.85));
        rafRef.current = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      /* the level bar is only a nicety */
    }
    try {
      typeRef.current = pickRecType();
      const rec = new MediaRecorder(stream, typeRef.current ? { mimeType: typeRef.current } : undefined);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => void finishRecording();
      rec.start(250);
    } catch {
      release();
      setError('This phone could not start recording. Try Safari or Chrome.');
      setPhase('idle');
      return;
    }
    startedRef.current = Date.now();
    setSecs(0);
    setPhase('recording');
    timerRef.current = window.setInterval(() => {
      const s = (Date.now() - startedRef.current) / 1000;
      setSecs(Math.min(SAMPLE_MAX, s));
      if (s >= SAMPLE_MAX) stop();
    }, 100);
  };

  // draw the wave with the part you keep lit up
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !p.buf) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const w = Math.max(100, Math.floor(cv.getBoundingClientRect().width || 320));
    const h = 88;
    cv.width = Math.floor(w * dpr);
    cv.height = Math.floor(h * dpr);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#020617';
    g.fillRect(0, 0, w, h);
    const d = p.buf.getChannelData(0);
    const per = d.length / w;
    const inX0 = (p.trim.start / p.buf.duration) * w;
    const inX1 = (p.trim.end / p.buf.duration) * w;
    for (let x = 0; x < w; x++) {
      let lo = 1;
      let hi = -1;
      const a = Math.floor(x * per);
      const b = Math.min(d.length, Math.max(a + 1, Math.floor((x + 1) * per)));
      for (let i = a; i < b; i++) {
        if (d[i] < lo) lo = d[i];
        if (d[i] > hi) hi = d[i];
      }
      g.fillStyle = x >= inX0 && x <= inX1 ? '#f472b6' : '#475569';
      g.fillRect(x, h / 2 - hi * (h / 2 - 4), 1, Math.max(1, (hi - lo) * (h / 2 - 4)));
    }
    g.fillStyle = '#ffffff';
    g.fillRect(Math.max(0, inX0 - 1), 0, 2, h);
    g.fillRect(Math.min(w - 2, inX1 - 1), 0, 2, h);
  }, [p.buf, p.trim.start, p.trim.end]);

  const dur = p.buf?.duration ?? 0;
  const toggle = (on: boolean) =>
    `flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border px-4 text-left text-base font-semibold ${FOCUS} ${
      on ? 'border-pink-500 bg-pink-500/10 text-white' : 'border-slate-700 bg-slate-900 text-slate-200'
    }`;
  const rootNames: Array<{ m: number; n: string }> = [];
  for (let m = 36; m <= 84; m++) rootNames.push({ m, n: noteName(m) });

  return (
    <section aria-label="Sampler" className="space-y-3 rounded-2xl border border-pink-500/40 bg-slate-900 p-3">
      <p className="text-lg font-black">🎙️ Sampler</p>
      <p className="text-slate-300">Record up to {SAMPLE_MAX} seconds with your phone's mic. Then play it on the keys: low keys make it deep and slow, high keys make it squeaky and fast.</p>
      {error ? (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
          {error}
        </p>
      ) : null}

      {phase === 'recording' ? (
        <div className="space-y-3 rounded-xl border border-red-500/40 bg-slate-950 p-4 text-center">
          <p role="status" className="flex items-center justify-center gap-2 text-lg font-black text-red-400">
            <span aria-hidden="true" className="inline-block h-3.5 w-3.5 animate-pulse rounded-full bg-red-500" />
            Recording
          </p>
          <p className="text-5xl font-black tabular-nums" data-testid="sample-timer">
            {secs.toFixed(1)}<span className="text-2xl text-slate-400"> / {SAMPLE_MAX}</span>
          </p>
          <div aria-hidden="true" className="h-5 w-full overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full rounded-full ${level > 0.9 ? 'bg-rose-500' : level > 0.6 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${Math.min(100, Math.round(level * 100))}%` }} />
          </div>
          <button type="button" onClick={stop} className={`min-h-[72px] w-full rounded-2xl bg-slate-100 text-2xl font-black text-slate-950 hover:bg-white ${FOCUS}`}>
            ■ Stop
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={phase !== 'idle'}
          className={`flex min-h-[80px] w-full items-center justify-center gap-3 rounded-2xl bg-rose-600 text-xl font-black text-white shadow-lg shadow-rose-600/30 hover:bg-rose-500 disabled:opacity-70 ${FOCUS}`}
        >
          <span aria-hidden="true">🎤</span>
          {phase === 'asking' ? 'Tap Allow if your phone asks…' : phase === 'working' ? 'Getting your sound ready…' : p.buf ? 'Record a new sample' : 'Record a sample'}
        </button>
      )}

      {p.buf ? (
        <div className="space-y-3">
          <canvas ref={canvasRef} data-testid="sample-wave" className="w-full rounded-lg border border-slate-700" style={{ height: 88 }} />
          <label className="block space-y-1">
            <span className="flex justify-between text-base font-bold">
              <span>✂ Start</span>
              <span className="tabular-nums text-slate-400">{p.trim.start.toFixed(2)} s</span>
            </span>
            <input
              type="range"
              min={0}
              max={dur}
              step={0.01}
              value={p.trim.start}
              aria-label="Sample start"
              onChange={(e) => p.onTrim({ start: Math.min(Number(e.target.value), p.trim.end - 0.05), end: p.trim.end })}
              className="h-11 w-full accent-pink-500"
            />
          </label>
          <label className="block space-y-1">
            <span className="flex justify-between text-base font-bold">
              <span>✂ End</span>
              <span className="tabular-nums text-slate-400">{p.trim.end.toFixed(2)} s</span>
            </span>
            <input
              type="range"
              min={0}
              max={dur}
              step={0.01}
              value={p.trim.end}
              aria-label="Sample end"
              onChange={(e) => p.onTrim({ start: p.trim.start, end: Math.max(Number(e.target.value), p.trim.start + 0.05) })}
              className="h-11 w-full accent-pink-500"
            />
          </label>
          <button type="button" onClick={p.onHear} className={`${BTN} min-h-[56px] w-full text-lg`}>
            ▶ Hear my sample
          </button>
          <label className="block space-y-1">
            <span className="text-base font-bold">🎹 This key plays it at normal pitch</span>
            <select
              value={p.opts.root}
              onChange={(e) => p.onOpts({ ...p.opts, root: Number(e.target.value) })}
              className={`min-h-[52px] w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-base font-semibold text-slate-100 ${FOCUS}`}
            >
              {rootNames.map((r) => (
                <option key={r.m} value={r.m}>
                  {r.n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" aria-pressed={p.opts.pitched} onClick={() => p.onOpts({ ...p.opts, pitched: !p.opts.pitched })} className={toggle(p.opts.pitched)}>
            <span>
              🎼 Keys change the pitch
              <span className="block text-sm font-normal text-slate-400">Turn off to play the same sound on every key, like drum pads.</span>
            </span>
            <span className="font-bold">{p.opts.pitched ? 'On' : 'Off'}</span>
          </button>
          <button type="button" aria-pressed={p.opts.loop} onClick={() => p.onOpts({ ...p.opts, loop: !p.opts.loop })} className={toggle(p.opts.loop)}>
            <span>
              🔁 Loop while I hold the key
              <span className="block text-sm font-normal text-slate-400">Great for humming a note into a long sound.</span>
            </span>
            <span className="font-bold">{p.opts.loop ? 'On' : 'Off'}</span>
          </button>
          <button
            type="button"
            aria-pressed={p.opts.oneShot}
            disabled={p.opts.loop}
            onClick={() => p.onOpts({ ...p.opts, oneShot: !p.opts.oneShot })}
            className={`${toggle(p.opts.oneShot && !p.opts.loop)} disabled:opacity-50`}
          >
            <span>
              ☝️ Play the whole sound
              <span className="block text-sm font-normal text-slate-400">It keeps playing even if you let go. Off: it stops when you let go.</span>
            </span>
            <span className="font-bold">{p.opts.oneShot && !p.opts.loop ? 'On' : 'Off'}</span>
          </button>
          <button type="button" aria-pressed={p.opts.reverse} onClick={() => p.onOpts({ ...p.opts, reverse: !p.opts.reverse })} className={toggle(p.opts.reverse)}>
            <span>⏪ Play it backwards</span>
            <span className="font-bold">{p.opts.reverse ? 'On' : 'Off'}</span>
          </button>
          {p.added ? (
            <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 font-bold text-emerald-300">
              🎉 Sample added to your project!
            </p>
          ) : (
            <button type="button" onClick={p.onAddToProject} className={BTN_PRIMARY}>
              ✓ Put my sample on my project
            </button>
          )}
          <button type="button" onClick={p.onSave} className={`${BTN} min-h-[56px] w-full text-lg`}>
            ⬇ Save sample to my phone
          </button>
        </div>
      ) : null}
    </section>
  );
}


export default function Keys({ modeLabel, onHome, onAdd, track, choiceId }: Props) {
  const [saved] = useState<Saved>(loadSaved);
  const [instId, setInstId] = useState(saved.inst);
  const [zoom, setZoom] = useState<Zoom>(saved.zoom);
  const [start, setStart] = useState<number>(() => {
    const w = ZOOMS[saved.zoom].whites;
    return saved.start === null ? startIdxFor(INST_BY_ID[saved.inst].home, w) : Math.min(saved.start, TOTAL_WHITES - w);
  });
  const [vol, setVol] = useState(saved.vol);
  const [reverb, setReverb] = useState(saved.reverb);
  const [names, setNames] = useState(saved.names);
  const [root, setRoot] = useState(saved.root);
  const [scaleId, setScaleId] = useState(saved.scale);
  const [chordId, setChordId] = useState(saved.chord);
  const [touchVel, setTouchVel] = useState(saved.touchVel);
  const [hold, setHold] = useState(false);
  const [picker, setPicker] = useState(false);
  const [family, setFamily] = useState<FamilyName>(INST_BY_ID[saved.inst].family);
  const [lit, setLit] = useState<ReadonlySet<number>>(new Set());
  const [audioError, setAudioError] = useState('');
  const [sampBuf, setSampBuf] = useState<AudioBuffer | null>(null);
  const [sampTrim, setSampTrim] = useState({ start: 0, end: 0 });
  const [sampOpts, setSampOpts] = useState<SamplerOpts>(SAMPLER_DEFAULTS);
  const [sampAdded, setSampAdded] = useState(false);
  const [sampHint, setSampHint] = useState('');

  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [added, setAdded] = useState(false);
  const [recError, setRecError] = useState('');

  const ctxRef = useRef<AudioContext | null>(null);
  const busRef = useRef<GainNode | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const wetRef = useRef<GainNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const holdsRef = useRef(new Map<number, Held>());
  const sustainedRef = useRef<Held[]>([]);
  const allVoicesRef = useRef<Held[]>([]);
  const kbRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef(0);
  const recTimerRef = useRef<number | null>(null);
  const takeUrlRef = useRef<string | null>(null);
  const previewTimers = useRef<number[]>([]);
  const playBufRef = useRef<AudioBuffer | null>(null);
  const sampOptsRef = useRef<SamplerOpts>(SAMPLER_DEFAULTS);
  sampOptsRef.current = sampOpts;

  // latest values for event handlers that outlive a render
  const live = useRef({ instId, chordId, hold, touchVel, vol, reverb });
  live.current = { instId, chordId, hold, touchVel, vol, reverb };

  const isSampler = instId === SAMPLER_ID;
  const inst = INST_BY_ID[instId] ?? SAMPLER_INST;
  const whites = ZOOMS[zoom].whites;
  const maxStart = TOTAL_WHITES - whites;
  const scale = SCALES.find((s) => s.id === scaleId) ?? SCALES[0];
  const chord = CHORDS.find((c) => c.id === chordId) ?? CHORDS[0];

  /* ---------- remember settings ---------- */
  useEffect(() => {
    try {
      const s: Saved = { inst: instId, start, zoom, vol, reverb, names, root, scale: scaleId, chord: chordId, touchVel };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* storage can be blocked: fine */
    }
  }, [instId, start, zoom, vol, reverb, names, root, scaleId, chordId, touchVel]);

  /* ---------- audio ---------- */
  const ensureAudio = (): AudioContext | null => {
    let ctx = ctxRef.current;
    if (!ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AC();
        // iPhones: play even when the side switch is on silent
        void wakeAudio(ctx);
        const bus = ctx.createGain();
        const dry = ctx.createGain();
        const conv = ctx.createConvolver();
        conv.buffer = makeReverbImpulse(ctx);
        const wet = ctx.createGain();
        wet.gain.value = live.current.reverb * 0.9;
        const master = ctx.createGain();
        master.gain.value = live.current.vol;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 14;
        comp.ratio.value = 5;
        comp.attack.value = 0.004;
        comp.release.value = 0.2;
        bus.connect(dry);
        dry.connect(master);
        bus.connect(conv);
        conv.connect(wet);
        wet.connect(master);
        master.connect(comp);
        // soft safety limiter so loud chords never crackle
        const pre = ctx.createGain();
        pre.gain.value = 0.5;
        const limiter = ctx.createWaveShaper();
        limiter.curve = makeLimiterCurve();
        comp.connect(pre);
        pre.connect(limiter);
        limiter.connect(ctx.destination);
        try {
          const dest = ctx.createMediaStreamDestination();
          limiter.connect(dest);
          destRef.current = dest;
        } catch {
          destRef.current = null;
        }
        ctxRef.current = ctx;
        busRef.current = bus;
        masterRef.current = master;
        wetRef.current = wet;
      } catch {
        setAudioError('This phone could not start the sound. Try Safari or Chrome.');
        return null;
      }
    }
    if (ctx.state !== 'running') void wakeAudio(ctx);
    return ctx;
  };

  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx && masterRef.current) masterRef.current.gain.setTargetAtTime(vol, ctx.currentTime, 0.02);
  }, [vol]);
  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx && wetRef.current) wetRef.current.gain.setTargetAtTime(reverb * 0.9, ctx.currentTime, 0.05);
  }, [reverb]);

  const syncLit = () => {
    const s = new Set<number>();
    holdsRef.current.forEach((h) => h.notes.forEach((n) => s.add(n)));
    sustainedRef.current.forEach((h) => h.notes.forEach((n) => s.add(n)));
    setLit(s);
  };

  const noteOn = (pointerId: number, midi: number, vel: number) => {
    const ctx = ensureAudio();
    const bus = busRef.current;
    if (!ctx || !bus) return;
    const cur = live.current;
    const offsets = (CHORDS.find((c) => c.id === cur.chordId) ?? CHORDS[0]).offsets;
    const instrument = INST_BY_ID[cur.instId];
    const sampleBuf = cur.instId === SAMPLER_ID ? playBufRef.current : null;
    if (cur.instId === SAMPLER_ID && !sampleBuf) {
      setSampHint('Record a sample first, then tap the keys.');
      return;
    }
    const when = ctx.currentTime + 0.005;
    const notes: number[] = [];
    const voices: Voice[] = [];
    for (const off of offsets) {
      const m = midi + off;
      if (m > MIDI_HIGH) continue;
      const v = offsets.length > 1 ? vel * 0.8 : vel;
      voices.push(sampleBuf ? startSampleNote(ctx, bus, sampleBuf, sampOptsRef.current, m, v, when) : startNote(ctx, bus, instrument, m, v, when));
      notes.push(m);
    }
    const held: Held = { midi, notes, voices };
    holdsRef.current.set(pointerId, held);
    allVoicesRef.current.push(held);
    // too many notes at once: let the oldest go
    let count = allVoicesRef.current.reduce((a, h) => a + h.voices.length, 0);
    while (count > MAX_VOICES && allVoicesRef.current.length > 1) {
      const old = allVoicesRef.current.shift();
      if (!old) break;
      old.voices.forEach((v) => v.release(ctx.currentTime));
      count -= old.voices.length;
      sustainedRef.current = sustainedRef.current.filter((h) => h !== old);
      holdsRef.current.forEach((h, id) => {
        if (h === old) holdsRef.current.delete(id);
      });
    }
    syncLit();
  };

  const noteOff = (pointerId: number) => {
    const h = holdsRef.current.get(pointerId);
    if (!h) return;
    holdsRef.current.delete(pointerId);
    const ctx = ctxRef.current;
    if (live.current.hold) {
      sustainedRef.current.push(h);
    } else if (ctx) {
      h.voices.forEach((v) => v.release(ctx.currentTime));
      allVoicesRef.current = allVoicesRef.current.filter((x) => x !== h);
    }
    syncLit();
  };

  const letGoOfSustained = () => {
    const ctx = ctxRef.current;
    const list = sustainedRef.current;
    sustainedRef.current = [];
    if (ctx) list.forEach((h) => h.voices.forEach((v) => v.release(ctx.currentTime)));
    allVoicesRef.current = allVoicesRef.current.filter((x) => !list.includes(x));
    syncLit();
  };

  const allOff = () => {
    holdsRef.current.forEach((_, id) => noteOff(id));
    letGoOfSustained();
  };

  const toggleHold = () => {
    const next = !hold;
    live.current.hold = next;
    setHold(next);
    if (!next) letGoOfSustained();
  };

  /* ---------- touch the keys ---------- */
  const hit = (clientX: number, clientY: number): { midi: number; vel: number } | null => {
    const el = kbRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    if (fx < 0 || fx >= 1 || fy < 0 || fy > 1) return null;
    const pos = fx * whites; // in white-key widths from the left edge
    const wi = Math.floor(pos) + start;
    let midi = WHITES[wi];
    if (midi === undefined) return null;
    if (fy < 0.62) {
      for (const j of [wi - 1, wi]) {
        const w = WHITES[j];
        if (w !== undefined && SHARP_AFTER.includes(w % 12) && w + 1 <= MIDI_HIGH && Math.abs(pos + start - (j + 1)) < BLACK_W / 2) {
          midi = w + 1;
          break;
        }
      }
    }
    const vel = live.current.touchVel ? 0.3 + 0.7 * Math.min(1, Math.max(0, fy)) : 0.8;
    return { midi, vel };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const k = hit(e.clientX, e.clientY);
    if (!k) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers refuse: sliding still works inside the box */
    }
    noteOn(e.pointerId, k.midi, k.vel);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const h = holdsRef.current.get(e.pointerId);
    if (!h) return;
    const k = hit(e.clientX, e.clientY);
    if (k && k.midi !== h.midi) {
      noteOff(e.pointerId);
      noteOn(e.pointerId, k.midi, k.vel);
    }
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => noteOff(e.pointerId);

  useEffect(() => {
    const quiet = () => allOff();
    window.addEventListener('blur', quiet);
    document.addEventListener('visibilitychange', quiet);
    return () => {
      window.removeEventListener('blur', quiet);
      document.removeEventListener('visibilitychange', quiet);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- the sampler ---------- */
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!sampBuf || !ctx) {
      playBufRef.current = null;
      return;
    }
    const end = sampTrim.end > sampTrim.start ? sampTrim.end : sampBuf.duration;
    playBufRef.current = makePlayBuffer(ctx, sampBuf, sampTrim.start, end, sampOpts.reverse);
  }, [sampBuf, sampTrim.start, sampTrim.end, sampOpts.reverse]);

  const sampleToWav = (): Blob | null => {
    const b = playBufRef.current;
    return b ? encodeWav(b) : null;
  };

  const chooseSampler = () => {
    allOff();
    setInstId(SAMPLER_ID);
    setPicker(false);
    setSampHint('');
    setStart(startIdxFor(48, whites));
  };

  const addSample = () => {
    const blob = sampleToWav();
    const b = playBufRef.current;
    if (!blob || !b) return;
    onAdd({ name: 'My sample', type: 'audio', duration: Math.max(0.1, b.duration), track, from: choiceId, blob });
    setSampAdded(true);
  };

  const saveSample = () => {
    const blob = sampleToWav();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-sample.wav';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const hearSample = () => {
    const ctx = ensureAudio();
    const bus = busRef.current;
    const b = playBufRef.current;
    if (!ctx || !bus || !b) return;
    startSampleNote(ctx, bus, b, { ...sampOptsRef.current, loop: false, pitched: false, oneShot: true }, 60, 0.9, ctx.currentTime + 0.01);
  };

  /* ---------- picking an instrument ---------- */
  const preview = (id: string) => {
    const ctx = ensureAudio();
    const bus = busRef.current;
    if (!ctx || !bus) return;
    previewTimers.current.forEach((t) => window.clearTimeout(t));
    previewTimers.current = [];
    const it = INST_BY_ID[id];
    const base = Math.min(it.home + 12, 96);
    const slow = it.spec.kind === 'sub' ? it.spec.attack : 0;
    const hold = Math.min(1.5, 0.4 + slow);
    [0, 4, 7].forEach((off, i) => {
      const v = startNote(ctx, bus, it, base + off, 0.7, ctx.currentTime + 0.02 + i * 0.16);
      const timer = window.setTimeout(() => v.release(ctx.currentTime), (0.02 + i * 0.16 + hold) * 1000);
      previewTimers.current.push(timer);
    });
  };

  const chooseInst = (id: string) => {
    allOff();
    setInstId(id);
    setFamily(INST_BY_ID[id].family);
    setPicker(false);
    setStart(startIdxFor(INST_BY_ID[id].home, whites));
    preview(id);
  };

  /* ---------- moving around the 88 keys ---------- */
  const shift = (whiteSteps: number) => setStart((s) => Math.min(maxStart, Math.max(0, s + whiteSteps)));

  const changeZoom = (z: Zoom) => {
    setZoom(z);
    setStart((s) => Math.min(s, TOTAL_WHITES - ZOOMS[z].whites));
  };

  const onMapMove = (e: ReactPointerEvent<HTMLDivElement>, isDown: boolean) => {
    const el = mapRef.current;
    if (!el || (!isDown && e.buttons === 0 && e.pressure === 0)) return;
    const r = el.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    setStart(Math.min(maxStart, Math.max(0, Math.round(fx * TOTAL_WHITES - whites / 2))));
  };

  /* ---------- recording what you play ---------- */
  const stopTimer = () => {
    if (recTimerRef.current !== null) window.clearInterval(recTimerRef.current);
    recTimerRef.current = null;
  };

  const startRec = () => {
    setRecError('');
    const ctx = ensureAudio();
    const dest = destRef.current;
    if (!ctx || !dest || typeof MediaRecorder === 'undefined') {
      setRecError('This browser cannot record what you play. Try Safari or Chrome.');
      return;
    }
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    setTake(null);
    setAdded(false);
    try {
      const type = pickRecType();
      const rec = new MediaRecorder(dest.stream, type ? { mimeType: type } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const secs = (Date.now() - recStartRef.current) / 1000;
        const mime = rec.mimeType || type || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        if (blob.size === 0) {
          setRecError('Nothing was recorded. Play some keys while recording.');
          return;
        }
        const url = URL.createObjectURL(blob);
        takeUrlRef.current = url;
        setTake({ url, secs, ext: extOf(mime), blob });
      };
      rec.start(1000);
      recorderRef.current = rec;
    } catch {
      setRecError('This phone could not start recording.');
      return;
    }
    recStartRef.current = Date.now();
    setRecSecs(0);
    setRecording(true);
    recTimerRef.current = window.setInterval(() => {
      const s = (Date.now() - recStartRef.current) / 1000;
      setRecSecs(s);
      if (s >= MAX_REC_SECONDS) stopRec();
    }, 250);
  };

  const stopRec = () => {
    stopTimer();
    setRecording(false);
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const useTake = () => {
    if (!take) return;
    onAdd({
      name: `My ${inst.name}`.slice(0, 42),
      type: 'audio',
      duration: Math.max(1, Math.min(take.secs, 600)),
      track,
      from: choiceId,
      blob: take.blob,
    });
    setAdded(true);
  };

  const discardTake = () => {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    setTake(null);
    setAdded(false);
  };

  useEffect(
    () => () => {
      stopTimer();
      const rec = recorderRef.current;
      if (rec) {
        rec.onstop = null;
        if (rec.state !== 'inactive') {
          try {
            rec.stop();
          } catch {
            /* already stopped */
          }
        }
      }
      previewTimers.current.forEach((t) => window.clearTimeout(t));
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
      holdsRef.current.forEach((h) => h.voices.forEach((v) => v.release(0)));
      sustainedRef.current.forEach((h) => h.voices.forEach((v) => v.release(0)));
      ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    },
    [],
  );

  /* ---------- what to draw ---------- */
  const inScale = (m: number) => scale.steps.length > 0 && scale.steps.includes(((m - root) % 12 + 12) % 12);
  const isRoot = (m: number) => scale.steps.length > 0 && ((m - root) % 12 + 12) % 12 === 0;

  const visibleWhites: Array<{ m: number; i: number }> = [];
  for (let i = start; i < start + whites; i++) visibleWhites.push({ m: WHITES[i], i });
  const visibleBlacks: Array<{ m: number; left: number }> = [];
  for (let j = Math.max(0, start - 1); j < Math.min(TOTAL_WHITES, start + whites); j++) {
    const w = WHITES[j];
    if (SHARP_AFTER.includes(w % 12) && w + 1 <= MIDI_HIGH) visibleBlacks.push({ m: w + 1, left: (j + 1 - start) / whites });
  }

  const lowName = noteName(WHITES[start]);
  const highName = noteName(WHITES[start + whites - 1]);

  const familyInsts = INSTRUMENTS.filter((i) => i.family === family);

  const toggleBtn = (on: boolean) =>
    `flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border px-4 text-left text-base font-semibold ${FOCUS} ${
      on ? 'border-pink-500 bg-pink-500/10 text-white' : 'border-slate-700 bg-slate-900 text-slate-200'
    }`;
  const selectCls = `min-h-[52px] w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-base font-semibold text-slate-100 ${FOCUS}`;

  const saveLink = take ? (
    <a href={take.url} download={`my-${inst.id}.${take.ext}`} className={`${BTN} flex min-h-[56px] items-center justify-center text-lg`}>
      ⬇ Save to my phone
    </a>
  ) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            allOff();
            stopRec();
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
        <div className="mx-auto flex max-w-xl gap-2">
          <button
            type="button"
            aria-expanded={picker}
            onClick={() => setPicker((v) => !v)}
            className={`flex min-h-[56px] flex-1 items-center justify-between gap-2 rounded-2xl bg-slate-800 px-4 text-left text-lg font-bold hover:bg-slate-700 ${FOCUS}`}
          >
            <span className="truncate">
              <span aria-hidden="true">{inst.emoji}</span> {inst.name}
            </span>
            <span aria-hidden="true">{picker ? '▲' : '▼'}</span>
          </button>
          <button
            type="button"
            onClick={recording ? stopRec : startRec}
            className={`min-h-[56px] w-28 shrink-0 rounded-2xl text-lg font-bold ${FOCUS} ${recording ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-100 hover:bg-slate-700'}`}
          >
            {recording ? `■ ${clock(recSecs)}` : '● Rec'}
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-xl space-y-5 px-4 py-5">
        <div className="space-y-1">
          <h1 className="text-3xl font-black leading-tight">Play an instrument!</h1>
          <p className="leading-relaxed text-slate-300">
            Pick an instrument, then tap the keys. Slide your finger to glide. You can press many keys at once.
          </p>
        </div>

        {audioError ? (
          <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
            {audioError}
          </p>
        ) : null}

        {picker ? (
          <section aria-label="Pick an instrument" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
            <button
              type="button"
              aria-pressed={isSampler}
              onClick={chooseSampler}
              className={`flex min-h-[64px] w-full items-center gap-3 rounded-xl border px-4 text-left text-lg font-black ${FOCUS} ${
                isSampler ? 'border-pink-500 bg-pink-500/15 text-white' : 'border-rose-500/50 bg-rose-500/10 text-white hover:border-rose-400'
              }`}
            >
              <span aria-hidden="true" className="text-2xl">🎙️</span>
              <span>
                My Sampler
                <span className="block text-sm font-normal text-slate-300">Record your own sound with the mic and play it on the keys.</span>
              </span>
            </button>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Instrument families">
              {FAMILY_LIST.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={family === f.id}
                  onClick={() => setFamily(f.id)}
                  className={`min-h-[44px] rounded-full px-4 text-base font-semibold ${FOCUS} ${
                    family === f.id ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <span aria-hidden="true">{f.emoji}</span> {f.id}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {familyInsts.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  aria-pressed={it.id === instId}
                  onClick={() => chooseInst(it.id)}
                  className={`flex min-h-[64px] items-center gap-2 rounded-xl border px-3 text-left text-base font-bold leading-tight ${FOCUS} ${
                    it.id === instId ? 'border-pink-500 bg-pink-500/15 text-white' : 'border-slate-700 bg-slate-950 text-slate-100 hover:border-slate-500'
                  }`}
                >
                  <span aria-hidden="true" className="text-2xl">
                    {it.emoji}
                  </span>
                  {it.name}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {recError ? (
          <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
            {recError}
          </p>
        ) : null}

        {recording ? (
          <p role="status" className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 font-semibold text-red-200">
            <span aria-hidden="true" className="inline-block h-3 w-3 animate-pulse rounded-full bg-red-500" />
            Recording what you play… tap Stop when you are done.
          </p>
        ) : null}

        {take ? (
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4" aria-label="Your recording">
            <p className="text-lg font-bold">Your music is {clock(take.secs)} long.</p>
            <audio key={take.url} src={take.url} controls className="w-full" />
            {added ? (
              <div role="status" className="space-y-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4">
                <p className="text-xl font-black text-emerald-300">🎉 Added to your project!</p>
                <p className="text-slate-200">It only lives on this page, so tap Save to my phone if you want to keep the sound.</p>
                <div className="grid gap-3">
                  <button type="button" onClick={onHome} className={BTN_PRIMARY}>
                    Back to my project
                  </button>
                  {saveLink}
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <button type="button" onClick={useTake} className={BTN_PRIMARY}>
                  ✓ Add my music to my project
                </button>
                {saveLink}
                <button type="button" onClick={discardTake} className={`${BTN} min-h-[56px] text-lg`}>
                  🗑️ Throw it away
                </button>
              </div>
            )}
          </section>
        ) : null}

        {isSampler ? (
          <>
            <SamplerPanel
              buf={sampBuf}
              trim={sampTrim}
              opts={sampOpts}
              getCtx={ensureAudio}
              onTrim={(t) => {
                setSampTrim(t);
                setSampAdded(false);
              }}
              onOpts={(o) => {
                setSampOpts(o);
                setSampAdded(false);
              }}
              onRecorded={(b) => {
                setSampBuf(b);
                setSampTrim({ start: 0, end: b.duration });
                setSampAdded(false);
                setSampHint('');
              }}
              onHear={hearSample}
              onAddToProject={addSample}
              added={sampAdded}
              onSave={saveSample}
            />
            {sampAdded ? (
              <button type="button" onClick={onHome} className={BTN_PRIMARY}>
                Back to my project
              </button>
            ) : null}
            {sampHint ? (
              <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
                {sampHint}
              </p>
            ) : null}
          </>
        ) : null}

        {/* ---- keyboard ---- */}
        <section aria-label="Keyboard" className="space-y-3">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <button type="button" onClick={() => shift(-7)} disabled={start <= 0} aria-label="Go down one octave" className={`${BTN} min-w-[84px] disabled:opacity-40`}>
              ◀ Lower
            </button>
            <p className="text-center text-base font-bold" aria-live="polite">
              {lowName} to {highName}
            </p>
            <button type="button" onClick={() => shift(7)} disabled={start >= maxStart} aria-label="Go up one octave" className={`${BTN} min-w-[84px] disabled:opacity-40`}>
              Higher ▶
            </button>
          </div>

          {/* overview of all 88 keys: drag to move */}
          <div className="space-y-1">
            <div
              ref={mapRef}
              role="presentation"
              onPointerDown={(e) => {
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* ok */
                }
                onMapMove(e, true);
              }}
              onPointerMove={(e) => onMapMove(e, false)}
              className="relative flex h-11 touch-none select-none overflow-hidden rounded-lg border border-slate-700 bg-slate-100"
            >
              {WHITES.map((m) => (
                <div key={m} className="h-full flex-1 border-r border-slate-300 last:border-r-0" />
              ))}
              <div
                className="pointer-events-none absolute top-0 h-full rounded-md border-2 border-pink-500 bg-pink-500/25"
                style={{ left: `${(start / TOTAL_WHITES) * 100}%`, width: `${(whites / TOTAL_WHITES) * 100}%` }}
              />
            </div>
            <div aria-hidden="true" className="relative h-4 text-[10px] font-bold text-slate-400">
              {[24, 36, 48, 60, 72, 84, 96, 108].map((m) => (
                <span key={m} className="absolute -translate-x-1/2" style={{ left: `${((WHITE_INDEX.get(m) ?? 0) / TOTAL_WHITES) * 100}%` }}>
                  {m === 60 ? 'C4 middle' : noteName(m)}
                </span>
              ))}
            </div>
          </div>

          <div
            ref={kbRef}
            role="group"
            aria-label="Piano keys. Touch to play."
            data-testid="keyboard"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onLostPointerCapture={onUp}
            onContextMenu={(e) => e.preventDefault()}
            className="relative w-full touch-none select-none overflow-hidden rounded-xl border-2 border-slate-700 bg-slate-800"
            style={{ height: 'min(48vh, 300px)', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
          >
            <div className="absolute inset-0 flex">
              {visibleWhites.map(({ m }) => {
                const on = lit.has(m);
                const tint = inScale(m);
                return (
                  <div
                    key={m}
                    data-midi={m}
                    className={`relative flex h-full flex-1 items-end justify-center border-r border-slate-400 pb-2 text-[11px] font-bold last:border-r-0 ${
                      on ? 'bg-pink-300 text-slate-900' : tint ? 'bg-pink-100 text-slate-700' : 'bg-slate-50 text-slate-500'
                    }`}
                  >
                    {isRoot(m) ? <span aria-hidden="true" className="absolute bottom-7 h-2.5 w-2.5 rounded-full bg-pink-600" /> : null}
                    {names || m % 12 === 0 ? noteName(m) : ''}
                  </div>
                );
              })}
            </div>
            {visibleBlacks.map(({ m, left }) => {
              const on = lit.has(m);
              const tint = inScale(m);
              return (
                <div
                  key={m}
                  data-midi={m}
                  className={`absolute top-0 flex items-end justify-center rounded-b-md border border-slate-950 pb-1 text-[9px] font-bold ${
                    on ? 'bg-pink-500 text-white' : tint ? 'bg-pink-800 text-pink-100' : 'bg-slate-900 text-slate-400'
                  }`}
                  style={{
                    left: `${(left - BLACK_W / whites / 2) * 100}%`,
                    width: `${(BLACK_W / whites) * 100}%`,
                    height: '62%',
                  }}
                >
                  {names ? NOTE_NAMES[m % 12].replace('#', '♯') : ''}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
              <button
                key={z}
                type="button"
                aria-pressed={zoom === z}
                onClick={() => changeZoom(z)}
                className={`min-h-[48px] rounded-xl text-base font-bold ${FOCUS} ${zoom === z ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
              >
                {ZOOMS[z].label}
              </button>
            ))}
          </div>
        </section>

        {/* ---- extras ---- */}
        <section aria-label="Sound settings" className="space-y-3">
          <button type="button" aria-pressed={hold} onClick={toggleHold} className={toggleBtn(hold)}>
            <span>
              🦶 Hold the sound (sustain)
              <span className="block text-sm font-normal text-slate-400">Notes keep ringing after you let go.</span>
            </span>
            <span className="font-bold">{hold ? 'On' : 'Off'}</span>
          </button>

          <label className="block space-y-1">
            <span className="text-base font-bold">🎼 One finger, many notes</span>
            <select value={chordId} onChange={(e) => setChordId(e.target.value)} className={selectCls}>
              {CHORDS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1">
            <span className="text-base font-bold">🌈 Show me the good notes</span>
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <select aria-label="Starting note" value={root} onChange={(e) => setRoot(Number(e.target.value))} className={selectCls}>
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
              <select aria-label="Scale" value={scaleId} onChange={(e) => setScaleId(e.target.value)} className={selectCls}>
                {SCALES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-sm text-slate-400">Pink keys sound great together. The dot marks the home note.</p>
          </div>

          <button type="button" aria-pressed={names} onClick={() => setNames((v) => !v)} className={toggleBtn(names)}>
            <span>🔤 Show note names</span>
            <span className="font-bold">{names ? 'On' : 'Off'}</span>
          </button>
          <button type="button" aria-pressed={touchVel} onClick={() => setTouchVel((v) => !v)} className={toggleBtn(touchVel)}>
            <span>
              👆 Touch lower for louder
              <span className="block text-sm font-normal text-slate-400">Press near the bottom of a key to play it harder.</span>
            </span>
            <span className="font-bold">{touchVel ? 'On' : 'Off'}</span>
          </button>

          <label className="block space-y-1">
            <span className="flex justify-between text-base font-bold">
              <span>🔈 Volume</span>
              <span className="text-slate-400">{Math.round(vol * 100)}%</span>
            </span>
            <input type="range" min={0} max={1} step={0.01} value={vol} onChange={(e) => setVol(Number(e.target.value))} className="h-11 w-full accent-pink-500" />
          </label>
          <label className="block space-y-1">
            <span className="flex justify-between text-base font-bold">
              <span>🏛️ Echo room</span>
              <span className="text-slate-400">{Math.round(reverb * 100)}%</span>
            </span>
            <input type="range" min={0} max={1} step={0.01} value={reverb} onChange={(e) => setReverb(Number(e.target.value))} className="h-11 w-full accent-pink-500" />
          </label>
        </section>

        <p className="text-sm text-slate-400">
          These instruments are made inside your phone, so they work without internet. They are lifelike, not exact copies of the real thing. If you hear nothing on an iPhone, check that the silent switch is off.
        </p>
      </main>
    </div>
  );
}
