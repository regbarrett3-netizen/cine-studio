/* ==================================================================== */
/* CINE instruments: a bank of synthesized instruments, no sample files  */
/* Everything is made live with the Web Audio API (and a little maths).  */
/* ==================================================================== */

export type FamilyName =
  | 'Pianos'
  | 'Organs'
  | 'Synths'
  | 'Bass'
  | 'Guitars'
  | 'Strings'
  | 'Brass'
  | 'Woodwinds'
  | 'Mallets'
  | 'Voices'
  | 'World';

export const FAMILY_LIST: Array<{ id: FamilyName; emoji: string }> = [
  { id: 'Pianos', emoji: '🎹' },
  { id: 'Organs', emoji: '⛪' },
  { id: 'Synths', emoji: '🎛️' },
  { id: 'Bass', emoji: '🔊' },
  { id: 'Guitars', emoji: '🎸' },
  { id: 'Strings', emoji: '🎻' },
  { id: 'Brass', emoji: '🎺' },
  { id: 'Woodwinds', emoji: '🪈' },
  { id: 'Mallets', emoji: '🔔' },
  { id: 'Voices', emoji: '🎤' },
  { id: 'World', emoji: '🌍' },
];

/* ---------- recipe shapes ---------- */

interface Osc {
  type?: OscillatorType;
  harm?: number[]; // custom harmonic recipe (organs)
  ratio?: number; // multiple of the note's frequency
  detune?: number; // cents
  gain?: number;
}

interface NoiseSpec {
  gain: number;
  freq: number;
  q?: number;
  type?: BiquadFilterType;
  attack?: number;
  decay: number; // time constant
  sustain?: number; // 0..1 of gain
}

interface Tremolo {
  rate: number;
  depth: number; // 0..1
}

/** Oscillators through a filter and an envelope: leads, pads, strings, brass, winds, basses, organs. */
export interface SubSpec {
  kind: 'sub';
  osc: Osc[];
  attack: number;
  decay: number; // time constant toward sustain
  sustain: number;
  release: number;
  filter?: { type?: BiquadFilterType; base: number; track: number; q: number; env?: number; envTime?: number };
  formants?: Array<[number, number, number]>; // [Hz, Q, gain] parallel bandpass bank (voices)
  vibrato?: { rate: number; depth: number; delay: number };
  noise?: NoiseSpec;
  drop?: { mult: number; time: number };
  drive?: number;
  trem?: Tremolo;
}

/** Two-operator FM: electric pianos, bells, mallets. */
export interface FmSpec {
  kind: 'fm';
  carrier: number;
  mod: number;
  index: number;
  indexDecay: number;
  attack?: number;
  decay: number;
  sustain: number;
  release: number;
  trem?: Tremolo;
  noise?: NoiseSpec;
}

/** Karplus-Strong plucked string, rendered into a short buffer: guitars, harp, banjo, sitar... */
export interface PluckSpec {
  kind: 'pluck';
  bright: number; // 0 dark .. 1 bright
  t60: number; // seconds to fade 60 dB around middle C
  pick?: number; // pluck position 0..0.5
  double?: number; // cents, adds a second slightly detuned string
  drive?: number;
  buzz?: number; // sitar-like buzz
  release: number;
}

/** Additive piano with a little string inharmonicity and a hammer thump. */
export interface PianoSpec {
  kind: 'piano';
  partials: number;
  bright: number; // bigger = darker
  inharm: number;
  t60: number;
  chorus: number; // cents between the two strings
  hammer: number;
  release: number;
}

export type Spec = SubSpec | FmSpec | PluckSpec | PianoSpec;

export interface Inst {
  id: string;
  name: string;
  emoji: string;
  family: FamilyName;
  home: number; // MIDI note at the left of the keyboard when you pick it
  spec: Spec;
  vol?: number; // loudness trim from calibration
}

/* ---------- the shelf ---------- */

const ROCK = [1, 0.8, 0.6, 0.45, 0.3, 0.22, 0.15, 0.1];
const PIPE = [1, 0.55, 0.8, 0.35, 0.5, 0.2, 0.3, 0.12, 0.16];

const saws = (...cents: number[]): Osc[] => cents.map((detune) => ({ type: 'sawtooth', detune, gain: 1 }));
const VIB = (rate: number, depth: number, delay: number) => ({ rate, depth, delay });

const AAH: Array<[number, number, number]> = [
  [730, 9, 1],
  [1090, 11, 0.55],
  [2440, 14, 0.25],
  [3400, 16, 0.12],
];
const OOH: Array<[number, number, number]> = [
  [320, 8, 1],
  [800, 10, 0.3],
  [2250, 12, 0.08],
];
const OBOE: Array<[number, number, number]> = [
  [1050, 4, 1],
  [2650, 5, 0.5],
  [3900, 6, 0.2],
];

export const INSTRUMENTS: Inst[] = [
  /* ---- Pianos & keys ---- */
  { id: 'grand', name: 'Grand Piano', emoji: '🎹', family: 'Pianos', home: 48, spec: { kind: 'piano', partials: 8, bright: 1.05, inharm: 0.00012, t60: 7, chorus: 3, hammer: 0.22, release: 0.28 } },
  { id: 'bright-piano', name: 'Bright Piano', emoji: '✨', family: 'Pianos', home: 48, spec: { kind: 'piano', partials: 9, bright: 0.65, inharm: 0.00018, t60: 5, chorus: 4, hammer: 0.4, release: 0.22 } },
  { id: 'honky', name: 'Honky-Tonk Piano', emoji: '🤠', family: 'Pianos', home: 48, spec: { kind: 'piano', partials: 7, bright: 0.85, inharm: 0.0003, t60: 3.2, chorus: 17, hammer: 0.35, release: 0.2 } },
  { id: 'rhodes', name: 'Electric Piano', emoji: '🌙', family: 'Pianos', home: 48, spec: { kind: 'fm', carrier: 1, mod: 1, index: 1.7, indexDecay: 0.9, attack: 0.004, decay: 1.7, sustain: 0.04, release: 0.3, trem: { rate: 4.6, depth: 0.22 } } },
  { id: 'wurli', name: 'Wurlitzer', emoji: '🎷', family: 'Pianos', home: 48, spec: { kind: 'fm', carrier: 1, mod: 2, index: 2.4, indexDecay: 0.3, attack: 0.003, decay: 1.1, sustain: 0.05, release: 0.2, trem: { rate: 5.6, depth: 0.18 } } },
  { id: 'clav', name: 'Clavinet', emoji: '🕺', family: 'Pianos', home: 48, spec: { kind: 'fm', carrier: 1, mod: 3, index: 4.5, indexDecay: 0.06, attack: 0.001, decay: 0.4, sustain: 0.1, release: 0.06, noise: { gain: 0.1, freq: 4000, type: 'highpass', decay: 0.012 } } },
  { id: 'harpsichord', name: 'Harpsichord', emoji: '👑', family: 'Pianos', home: 48, spec: { kind: 'pluck', bright: 1, t60: 1.4, pick: 0.12, double: 6, release: 0.07 } },
  { id: 'celesta', name: 'Celesta', emoji: '🧚', family: 'Pianos', home: 60, spec: { kind: 'fm', carrier: 1, mod: 4, index: 1.1, indexDecay: 0.12, decay: 0.9, sustain: 0, release: 0.4 } },

  /* ---- Organs & reeds ---- */
  { id: 'rock-organ', name: 'Rock Organ', emoji: '🎸', family: 'Organs', home: 48, spec: { kind: 'sub', osc: [{ harm: ROCK, gain: 1 }], attack: 0.006, decay: 0.2, sustain: 1, release: 0.05, vibrato: VIB(6.5, 7, 0.1), noise: { gain: 0.12, freq: 3000, type: 'highpass', decay: 0.012 } } },
  { id: 'church-organ', name: 'Church Organ', emoji: '⛪', family: 'Organs', home: 36, spec: { kind: 'sub', osc: [{ harm: PIPE, gain: 1 }, { harm: PIPE, ratio: 0.5, gain: 0.6 }, { harm: PIPE, ratio: 2, gain: 0.35 }], attack: 0.07, decay: 0.2, sustain: 1, release: 0.3, filter: { base: 5000, track: 2, q: 0.5 } } },
  { id: 'accordion', name: 'Accordion', emoji: '🪗', family: 'Organs', home: 48, spec: { kind: 'sub', osc: [{ type: 'sawtooth', detune: -9, gain: 1 }, { type: 'sawtooth', detune: 9, gain: 1 }, { type: 'square', gain: 0.5 }], attack: 0.05, decay: 0.2, sustain: 1, release: 0.1, filter: { base: 1400, track: 2, q: 1 }, vibrato: VIB(5.2, 6, 0.2) } },
  { id: 'harmonica', name: 'Harmonica', emoji: '🎶', family: 'Organs', home: 60, spec: { kind: 'sub', osc: [{ type: 'sawtooth', gain: 1 }, { type: 'square', detune: 6, gain: 0.5 }], attack: 0.04, decay: 0.2, sustain: 1, release: 0.1, filter: { type: 'bandpass', base: 900, track: 1.5, q: 0.9 }, noise: { gain: 0.05, freq: 3500, type: 'bandpass', q: 0.8, attack: 0.04, decay: 0.2, sustain: 1 }, vibrato: VIB(5.5, 10, 0.4) } },

  /* ---- Synths ---- */
  { id: 'saw-lead', name: 'Saw Lead', emoji: '⚡', family: 'Synths', home: 60, spec: { kind: 'sub', osc: saws(-6, 6), attack: 0.008, decay: 0.2, sustain: 1, release: 0.12, filter: { base: 1200, track: 3, q: 2, env: 2, envTime: 0.25 }, vibrato: VIB(5.5, 7, 0.25) } },
  { id: 'square-lead', name: 'Square Lead', emoji: '🎮', family: 'Synths', home: 60, spec: { kind: 'sub', osc: [{ type: 'square', detune: -4, gain: 1 }, { type: 'square', detune: 4, gain: 1 }], attack: 0.006, decay: 0.2, sustain: 1, release: 0.1, filter: { base: 2500, track: 2, q: 1 }, vibrato: VIB(5.5, 6, 0.3) } },
  { id: 'supersaw', name: 'Super Saw', emoji: '🚀', family: 'Synths', home: 48, spec: { kind: 'sub', osc: saws(-25, -15, -6, 0, 6, 15, 25), attack: 0.01, decay: 0.2, sustain: 1, release: 0.3, filter: { base: 5000, track: 1, q: 0.7 } } },
  { id: 'synth-pluck', name: 'Synth Pluck', emoji: '💧', family: 'Synths', home: 60, spec: { kind: 'sub', osc: saws(-8, 8), attack: 0.002, decay: 0.3, sustain: 0, release: 0.1, filter: { base: 400, track: 2, q: 4, env: 6, envTime: 0.12 } } },
  { id: 'warm-pad', name: 'Warm Pad', emoji: '🌅', family: 'Synths', home: 48, spec: { kind: 'sub', osc: [...saws(-9, 0, 9), { type: 'triangle', gain: 0.8 }], attack: 0.7, decay: 0.3, sustain: 1, release: 1.3, filter: { base: 900, track: 1, q: 0.7 }, vibrato: VIB(0.6, 4, 0) } },
  { id: 'dream-pad', name: 'Dream Pad', emoji: '☁️', family: 'Synths', home: 48, spec: { kind: 'sub', osc: [{ type: 'sine', gain: 1 }, { type: 'triangle', ratio: 2, detune: 7, gain: 0.5 }, { type: 'sawtooth', detune: -6, gain: 0.25 }], attack: 1.2, decay: 0.3, sustain: 1, release: 2, filter: { base: 2000, track: 1, q: 0.6 }, vibrato: VIB(0.9, 9, 0) } },
  { id: 'poly-brass', name: '80s Poly Brass', emoji: '📼', family: 'Synths', home: 48, spec: { kind: 'sub', osc: saws(-10, 10), attack: 0.04, decay: 0.3, sustain: 0.9, release: 0.25, filter: { base: 600, track: 1, q: 1.5, env: 3, envTime: 0.18 } } },

  /* ---- Bass ---- */
  { id: '808-sub', name: '808 Sub Bass', emoji: '💥', family: 'Bass', home: 24, spec: { kind: 'sub', osc: [{ type: 'sine', gain: 1 }, { type: 'triangle', gain: 0.12 }], attack: 0.002, decay: 0.9, sustain: 0, release: 0.14, drop: { mult: 1.7, time: 0.05 }, drive: 2.6 } },
  { id: 'moog-bass', name: 'Moog Bass', emoji: '🧲', family: 'Bass', home: 24, spec: { kind: 'sub', osc: [{ type: 'sawtooth', gain: 1 }, { type: 'square', ratio: 0.5, gain: 0.6 }], attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.1, filter: { base: 80, track: 1.2, q: 6, env: 7, envTime: 0.15 } } },
  { id: 'reese', name: 'Reese Bass', emoji: '🐍', family: 'Bass', home: 24, spec: { kind: 'sub', osc: [{ type: 'sawtooth', detune: -14, gain: 1 }, { type: 'sawtooth', detune: 14, gain: 1 }, { type: 'sine', ratio: 0.5, gain: 0.8 }], attack: 0.03, decay: 0.3, sustain: 1, release: 0.3, filter: { base: 200, track: 2, q: 1 } } },
  { id: 'acid', name: 'Acid Bass', emoji: '🧪', family: 'Bass', home: 36, spec: { kind: 'sub', osc: [{ type: 'sawtooth', gain: 1 }], attack: 0.003, decay: 0.18, sustain: 0.5, release: 0.05, filter: { base: 100, track: 1, q: 14, env: 10, envTime: 0.2 } } },
  { id: 'bass-guitar', name: 'Bass Guitar', emoji: '🎸', family: 'Bass', home: 24, spec: { kind: 'pluck', bright: 0.35, t60: 2.4, pick: 0.2, drive: 0.6, release: 0.14 } },
  { id: 'upright', name: 'Upright Bass', emoji: '🎻', family: 'Bass', home: 24, spec: { kind: 'pluck', bright: 0.12, t60: 1.1, pick: 0.3, release: 0.2 } },

  /* ---- Guitars & plucked strings ---- */
  { id: 'acoustic', name: 'Acoustic Guitar', emoji: '🪕', family: 'Guitars', home: 40, spec: { kind: 'pluck', bright: 0.55, t60: 3, pick: 0.13, release: 0.35 } },
  { id: 'nylon', name: 'Nylon Guitar', emoji: '🌹', family: 'Guitars', home: 40, spec: { kind: 'pluck', bright: 0.25, t60: 2.2, pick: 0.2, release: 0.35 } },
  { id: 'clean-guitar', name: 'Clean Electric', emoji: '🎸', family: 'Guitars', home: 40, spec: { kind: 'pluck', bright: 0.6, t60: 3.5, pick: 0.2, double: 3, release: 0.25 } },
  { id: 'dist-guitar', name: 'Distorted Guitar', emoji: '🤘', family: 'Guitars', home: 40, spec: { kind: 'pluck', bright: 0.7, t60: 5, pick: 0.15, drive: 12, release: 0.12 } },
  { id: 'banjo', name: 'Banjo', emoji: '🐎', family: 'Guitars', home: 48, spec: { kind: 'pluck', bright: 0.95, t60: 0.8, pick: 0.12, release: 0.1 } },
  { id: 'ukulele', name: 'Ukulele', emoji: '🌴', family: 'Guitars', home: 60, spec: { kind: 'pluck', bright: 0.5, t60: 1.1, pick: 0.2, release: 0.2 } },
  { id: 'mandolin', name: 'Mandolin', emoji: '🍕', family: 'Guitars', home: 55, spec: { kind: 'pluck', bright: 0.75, t60: 1.1, pick: 0.1, double: 7, release: 0.12 } },
  { id: 'harp', name: 'Harp', emoji: '🪽', family: 'Guitars', home: 48, spec: { kind: 'pluck', bright: 0.35, t60: 3.5, pick: 0.1, release: 1.2 } },

  /* ---- Bowed strings ---- */
  { id: 'violin', name: 'Violin', emoji: '🎻', family: 'Strings', home: 55, spec: { kind: 'sub', osc: saws(-4, 4), attack: 0.09, decay: 0.2, sustain: 1, release: 0.2, filter: { base: 800, track: 4, q: 1.2 }, vibrato: VIB(5.8, 14, 0.35), noise: { gain: 0.04, freq: 3000, type: 'bandpass', q: 0.7, attack: 0.05, decay: 0.2, sustain: 1 } } },
  { id: 'cello', name: 'Cello', emoji: '🎼', family: 'Strings', home: 36, spec: { kind: 'sub', osc: [{ type: 'sawtooth', detune: -5, gain: 1 }, { type: 'sawtooth', detune: 5, gain: 1 }, { type: 'square', gain: 0.3 }], attack: 0.12, decay: 0.2, sustain: 1, release: 0.25, filter: { base: 500, track: 3, q: 1 }, vibrato: VIB(5, 10, 0.4) } },
  { id: 'strings', name: 'String Orchestra', emoji: '🎭', family: 'Strings', home: 48, spec: { kind: 'sub', osc: saws(-18, -11, -4, 4, 11, 18), attack: 0.35, decay: 0.3, sustain: 1, release: 0.8, filter: { base: 1200, track: 1.5, q: 0.6 }, vibrato: VIB(0.8, 6, 0) } },
  { id: 'tremolo-strings', name: 'Tremolo Strings', emoji: '🎬', family: 'Strings', home: 55, spec: { kind: 'sub', osc: saws(-14, -5, 5, 14), attack: 0.2, decay: 0.3, sustain: 1, release: 0.5, filter: { base: 1500, track: 1.5, q: 0.6 }, trem: { rate: 9, depth: 0.55 } } },
  { id: 'pizzicato', name: 'Pizzicato Strings', emoji: '🐜', family: 'Strings', home: 55, spec: { kind: 'pluck', bright: 0.45, t60: 0.5, pick: 0.25, release: 0.08 } },

  /* ---- Brass & sax ---- */
  { id: 'trumpet', name: 'Trumpet', emoji: '🎺', family: 'Brass', home: 60, spec: { kind: 'sub', osc: [{ type: 'sawtooth', detune: -3, gain: 1 }, { type: 'sawtooth', detune: 3, gain: 1 }, { type: 'square', gain: 0.4 }], attack: 0.04, decay: 0.2, sustain: 1, release: 0.12, filter: { base: 500, track: 3, q: 1, env: 4, envTime: 0.08 }, vibrato: VIB(5.5, 8, 0.4) } },
  { id: 'trombone', name: 'Trombone', emoji: '📯', family: 'Brass', home: 48, spec: { kind: 'sub', osc: saws(-4, 4), attack: 0.07, decay: 0.2, sustain: 1, release: 0.15, filter: { base: 300, track: 2.5, q: 0.9, env: 3, envTime: 0.12 }, vibrato: VIB(5, 7, 0.5) } },
  { id: 'horn', name: 'French Horn', emoji: '🦌', family: 'Brass', home: 48, spec: { kind: 'sub', osc: [{ type: 'sawtooth', gain: 1 }, { type: 'triangle', gain: 0.8 }], attack: 0.1, decay: 0.2, sustain: 1, release: 0.25, filter: { base: 350, track: 2, q: 0.7, env: 2.5, envTime: 0.2 } } },
  { id: 'tuba', name: 'Tuba', emoji: '🐘', family: 'Brass', home: 28, spec: { kind: 'sub', osc: [{ type: 'sawtooth', gain: 1 }, { type: 'square', gain: 0.7 }], attack: 0.06, decay: 0.2, sustain: 1, release: 0.15, filter: { base: 300, track: 1.5, q: 0.8, env: 1.5, envTime: 0.15 } } },
  { id: 'brass-section', name: 'Brass Section', emoji: '🎷', family: 'Brass', home: 55, spec: { kind: 'sub', osc: saws(-12, -4, 4, 12), attack: 0.06, decay: 0.2, sustain: 1, release: 0.2, filter: { base: 500, track: 3, q: 1, env: 3.5, envTime: 0.1 }, vibrato: VIB(5.2, 6, 0.5) } },
  { id: 'alto-sax', name: 'Alto Sax', emoji: '🎷', family: 'Brass', home: 55, spec: { kind: 'sub', osc: [{ type: 'sawtooth', gain: 1 }, { type: 'square', gain: 0.55 }], attack: 0.04, decay: 0.2, sustain: 1, release: 0.12, filter: { base: 1500, track: 2, q: 2, env: 1, envTime: 0.15 }, noise: { gain: 0.08, freq: 3000, type: 'bandpass', q: 0.8, attack: 0.04, decay: 0.2, sustain: 1 }, vibrato: VIB(5.5, 14, 0.3) } },
  { id: 'tenor-sax', name: 'Tenor Sax', emoji: '🎷', family: 'Brass', home: 48, spec: { kind: 'sub', osc: [{ type: 'sawtooth', gain: 1 }, { type: 'square', gain: 0.6 }], attack: 0.05, decay: 0.2, sustain: 1, release: 0.14, filter: { base: 1000, track: 2, q: 2, env: 1, envTime: 0.15 }, noise: { gain: 0.1, freq: 2500, type: 'bandpass', q: 0.8, attack: 0.05, decay: 0.2, sustain: 1 }, vibrato: VIB(5, 14, 0.35) } },

  /* ---- Woodwinds ---- */
  { id: 'flute', name: 'Flute', emoji: '🪈', family: 'Woodwinds', home: 60, spec: { kind: 'sub', osc: [{ type: 'sine', gain: 1 }, { type: 'sine', ratio: 2, gain: 0.15 }], attack: 0.08, decay: 0.2, sustain: 1, release: 0.12, noise: { gain: 0.06, freq: 3500, type: 'bandpass', q: 0.8, attack: 0.06, decay: 0.2, sustain: 1 }, vibrato: VIB(5, 8, 0.3) } },
  { id: 'piccolo', name: 'Piccolo', emoji: '🐦', family: 'Woodwinds', home: 72, spec: { kind: 'sub', osc: [{ type: 'sine', gain: 1 }, { type: 'sine', ratio: 2, gain: 0.22 }], attack: 0.05, decay: 0.2, sustain: 1, release: 0.1, noise: { gain: 0.07, freq: 5000, type: 'bandpass', q: 0.8, attack: 0.05, decay: 0.2, sustain: 1 }, vibrato: VIB(5.5, 7, 0.3) } },
  { id: 'clarinet', name: 'Clarinet', emoji: '🥢', family: 'Woodwinds', home: 55, spec: { kind: 'sub', osc: [{ type: 'square', gain: 1 }], attack: 0.05, decay: 0.2, sustain: 1, release: 0.1, filter: { base: 600, track: 3, q: 0.8 }, noise: { gain: 0.03, freq: 2500, type: 'bandpass', q: 0.8, attack: 0.05, decay: 0.2, sustain: 1 } } },
  { id: 'oboe', name: 'Oboe', emoji: '🦆', family: 'Woodwinds', home: 60, spec: { kind: 'sub', osc: [{ type: 'sawtooth', gain: 1 }], attack: 0.06, decay: 0.2, sustain: 1, release: 0.12, formants: OBOE, vibrato: VIB(5.5, 9, 0.3) } },
  { id: 'pan-flute', name: 'Pan Flute', emoji: '🏔️', family: 'Woodwinds', home: 60, spec: { kind: 'sub', osc: [{ type: 'sine', gain: 1 }, { type: 'triangle', gain: 0.1 }], attack: 0.1, decay: 0.2, sustain: 1, release: 0.15, noise: { gain: 0.13, freq: 3000, type: 'bandpass', q: 0.8, attack: 0.08, decay: 0.2, sustain: 1 }, vibrato: VIB(4.5, 6, 0.4) } },
  { id: 'ocarina', name: 'Ocarina', emoji: '🥚', family: 'Woodwinds', home: 60, spec: { kind: 'sub', osc: [{ type: 'sine', gain: 1 }, { type: 'sine', ratio: 2, gain: 0.05 }], attack: 0.05, decay: 0.2, sustain: 1, release: 0.1, noise: { gain: 0.02, freq: 3000, type: 'bandpass', q: 0.8, attack: 0.05, decay: 0.2, sustain: 1 }, vibrato: VIB(5, 5, 0.3) } },
  { id: 'whistle', name: 'Whistle', emoji: '😗', family: 'Woodwinds', home: 72, spec: { kind: 'sub', osc: [{ type: 'sine', gain: 1 }], attack: 0.06, decay: 0.2, sustain: 1, release: 0.08, noise: { gain: 0.02, freq: 4000, type: 'bandpass', q: 1, attack: 0.05, decay: 0.2, sustain: 1 }, vibrato: VIB(5.5, 12, 0.35) } },

  /* ---- Mallets & bells ---- */
  { id: 'marimba', name: 'Marimba', emoji: '🪵', family: 'Mallets', home: 48, spec: { kind: 'fm', carrier: 1, mod: 4, index: 1.4, indexDecay: 0.04, attack: 0.001, decay: 0.35, sustain: 0, release: 0.2 } },
  { id: 'vibes', name: 'Vibraphone', emoji: '🌊', family: 'Mallets', home: 53, spec: { kind: 'fm', carrier: 1, mod: 4, index: 0.9, indexDecay: 0.6, attack: 0.002, decay: 1.6, sustain: 0, release: 0.5, trem: { rate: 5, depth: 0.45 } } },
  { id: 'xylophone', name: 'Xylophone', emoji: '🥁', family: 'Mallets', home: 60, spec: { kind: 'fm', carrier: 1, mod: 3, index: 1.8, indexDecay: 0.03, attack: 0.001, decay: 0.16, sustain: 0, release: 0.1 } },
  { id: 'glock', name: 'Glockenspiel', emoji: '❄️', family: 'Mallets', home: 72, spec: { kind: 'fm', carrier: 1, mod: 3.51, index: 1.5, indexDecay: 0.3, attack: 0.001, decay: 0.8, sustain: 0, release: 0.3 } },
  { id: 'kalimba', name: 'Kalimba', emoji: '🖐️', family: 'Mallets', home: 60, spec: { kind: 'fm', carrier: 1, mod: 5, index: 0.8, indexDecay: 0.04, attack: 0.001, decay: 0.6, sustain: 0, release: 0.25 } },
  { id: 'steel-drum', name: 'Steel Drum', emoji: '🏝️', family: 'Mallets', home: 60, spec: { kind: 'fm', carrier: 1, mod: 2, index: 1.2, indexDecay: 0.25, attack: 0.002, decay: 0.7, sustain: 0, release: 0.3, trem: { rate: 6, depth: 0.15 } } },
  { id: 'music-box', name: 'Music Box', emoji: '🎁', family: 'Mallets', home: 72, spec: { kind: 'fm', carrier: 1, mod: 5.19, index: 0.5, indexDecay: 0.1, attack: 0.001, decay: 0.9, sustain: 0, release: 0.3 } },
  { id: 'bells', name: 'Tubular Bells', emoji: '🔔', family: 'Mallets', home: 60, spec: { kind: 'fm', carrier: 1, mod: 3.5, index: 2.5, indexDecay: 1.5, attack: 0.001, decay: 3, sustain: 0, release: 0.8 } },
  { id: 'timpani', name: 'Timpani', emoji: '🥁', family: 'Mallets', home: 36, spec: { kind: 'sub', osc: [{ type: 'sine', gain: 1 }, { type: 'triangle', gain: 0.2 }], attack: 0.002, decay: 0.6, sustain: 0, release: 0.3, drop: { mult: 1.35, time: 0.09 }, noise: { gain: 0.25, freq: 400, type: 'lowpass', decay: 0.03 } } },

  /* ---- Voices ---- */
  { id: 'choir-aah', name: 'Choir Aah', emoji: '😮', family: 'Voices', home: 48, spec: { kind: 'sub', osc: saws(-10, 0, 10), attack: 0.35, decay: 0.3, sustain: 1, release: 0.6, formants: AAH, vibrato: VIB(5, 10, 0.3) } },
  { id: 'choir-ooh', name: 'Choir Ooh', emoji: '😗', family: 'Voices', home: 48, spec: { kind: 'sub', osc: saws(-10, 0, 10), attack: 0.4, decay: 0.3, sustain: 1, release: 0.7, formants: OOH, vibrato: VIB(5, 9, 0.3) } },
  { id: 'solo-aah', name: 'Singer Aah', emoji: '🎙️', family: 'Voices', home: 55, spec: { kind: 'sub', osc: saws(-4, 4), attack: 0.08, decay: 0.2, sustain: 1, release: 0.2, formants: AAH, vibrato: VIB(5.5, 18, 0.35), noise: { gain: 0.03, freq: 3500, type: 'bandpass', q: 0.8, attack: 0.04, decay: 0.2, sustain: 1 } } },

  /* ---- World ---- */
  { id: 'sitar', name: 'Sitar', emoji: '🕉️', family: 'World', home: 48, spec: { kind: 'pluck', bright: 0.85, t60: 4.5, pick: 0.1, buzz: 1, release: 0.4 } },
  { id: 'koto', name: 'Koto', emoji: '🎎', family: 'World', home: 55, spec: { kind: 'pluck', bright: 0.8, t60: 2, pick: 0.08, release: 0.3 } },
  { id: 'bagpipes', name: 'Bagpipes', emoji: '🏴', family: 'World', home: 55, spec: { kind: 'sub', osc: [{ type: 'sawtooth', gain: 1 }, { type: 'square', detune: 4, gain: 0.6 }], attack: 0.02, decay: 0.2, sustain: 1, release: 0.06, filter: { type: 'bandpass', base: 1200, track: 1.5, q: 2.5 } } },
];

/** Loudness trims measured by rendering every instrument offline, so they all sit at a similar volume. */
const CAL: Record<string, number> = {
  'grand': 1.21,
  'bright-piano': 1.84,
  'honky': 2.33,
  'rhodes': 0.61,
  'wurli': 0.47,
  'clav': 0.74,
  'harpsichord': 4,
  'celesta': 0.55,
  'rock-organ': 0.51,
  'church-organ': 0.44,
  'accordion': 0.41,
  'harmonica': 0.79,
  'saw-lead': 0.45,
  'square-lead': 0.26,
  'supersaw': 0.51,
  'synth-pluck': 1.26,
  'warm-pad': 0.45,
  'dream-pad': 0.8,
  'poly-brass': 0.5,
  '808-sub': 0.41,
  'moog-bass': 0.4,
  'reese': 0.42,
  'acid': 0.53,
  'bass-guitar': 1.31,
  'upright': 2.1,
  'acoustic': 1.93,
  'nylon': 1.6,
  'clean-guitar': 2.57,
  'dist-guitar': 0.25,
  'banjo': 3.57,
  'ukulele': 3.57,
  'mandolin': 4,
  'harp': 2.29,
  'violin': 0.48,
  'cello': 0.45,
  'strings': 0.64,
  'tremolo-strings': 0.7,
  'pizzicato': 3.57,
  'trumpet': 0.5,
  'trombone': 0.46,
  'horn': 0.33,
  'tuba': 0.26,
  'brass-section': 0.49,
  'alto-sax': 0.27,
  'tenor-sax': 0.27,
  'flute': 0.32,
  'piccolo': 0.32,
  'clarinet': 0.26,
  'oboe': 0.49,
  'pan-flute': 0.3,
  'ocarina': 0.32,
  'whistle': 0.32,
  'marimba': 0.88,
  'vibes': 0.58,
  'xylophone': 1.47,
  'glock': 0.58,
  'kalimba': 0.66,
  'steel-drum': 0.78,
  'music-box': 0.55,
  'bells': 0.41,
  'timpani': 0.52,
  'choir-aah': 1.29,
  'choir-ooh': 0.95,
  'solo-aah': 0.84,
  'sitar': 0.67,
  'koto': 3.57,
  'bagpipes': 1.49,
};
INSTRUMENTS.forEach((i) => {
  i.vol = CAL[i.id] ?? 1;
});

export const INST_BY_ID: Record<string, Inst> = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));

/* ---------- helpers ---------- */

export const MIDI_LOW = 21; // A0
export const MIDI_HIGH = 108; // C8

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m: number) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface CtxCache {
  noise?: AudioBuffer;
  waves: Map<string, PeriodicWave>;
  curves: Map<number, Float32Array>;
  plucks: Map<string, AudioBuffer>;
}
const caches = new WeakMap<BaseAudioContext, CtxCache>();
const cacheOf = (ctx: BaseAudioContext): CtxCache => {
  let c = caches.get(ctx);
  if (!c) {
    c = { waves: new Map(), curves: new Map(), plucks: new Map() };
    caches.set(ctx, c);
  }
  return c;
};

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const c = cacheOf(ctx);
  if (!c.noise) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0; // fixed seed: same noise every time
      d[i] = (seed / 4294967296) * 2 - 1;
    }
    c.noise = buf;
  }
  return c.noise;
}

function harmonicWave(ctx: BaseAudioContext, harm: number[]): PeriodicWave {
  const key = harm.join(',');
  const c = cacheOf(ctx);
  let w = c.waves.get(key);
  if (!w) {
    const real = new Float32Array(harm.length + 1);
    const imag = new Float32Array(harm.length + 1);
    harm.forEach((a, i) => {
      imag[i + 1] = a;
    });
    w = ctx.createPeriodicWave(real, imag);
    c.waves.set(key, w);
  }
  return w;
}

function driveCurve(ctx: BaseAudioContext, amount: number): Float32Array {
  const c = cacheOf(ctx);
  let curve = c.curves.get(amount);
  if (!curve) {
    const n = 1024;
    curve = new Float32Array(n);
    const k = Math.tanh(amount);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / (k || 1);
    }
    c.curves.set(amount, curve);
  }
  return curve;
}

/* ---------- a playing note ---------- */

export interface Voice {
  release: (when: number) => void;
}

const MAX_VOICE_SECONDS = 30;

/** Start one note. `out` is where the sound goes. Returns a handle to let go of the key. */
export function startNote(ctx: BaseAudioContext, out: AudioNode, inst: Inst, midi: number, vel: number, t: number): Voice {
  const spec = inst.spec;
  const trim = (inst.vol ?? 1) * clamp(vel, 0.05, 1);
  if (spec.kind === 'sub') return startSub(ctx, out, spec, midi, trim, t);
  if (spec.kind === 'fm') return startFm(ctx, out, spec, midi, trim, t);
  if (spec.kind === 'pluck') return startPluck(ctx, out, inst, spec, midi, trim, t);
  return startPiano(ctx, out, spec, midi, trim, t);
}

/** release stage lives on its own gain so it never fights the attack/decay curve */
function releaseStage(ctx: BaseAudioContext, out: AudioNode, release: number) {
  const g = ctx.createGain();
  g.connect(out);
  let done = false;
  const stopAll: Array<(t: number) => void> = [];
  const voice: Voice = {
    release: (when: number) => {
      if (done) return;
      done = true;
      const t = Math.max(when, ctx.currentTime);
      g.gain.setValueAtTime(1, t);
      g.gain.setTargetAtTime(0, t, Math.max(0.01, release / 4));
      stopAll.forEach((s) => s(t + release * 1.6 + 0.05));
    },
  };
  return { gain: g, voice, onStop: (fn: (t: number) => void) => stopAll.push(fn) };
}

function lfo(ctx: BaseAudioContext, rate: number, amount: number, target: AudioParam, t: number, fadeIn = 0) {
  const o = ctx.createOscillator();
  o.frequency.value = rate;
  const g = ctx.createGain();
  if (fadeIn > 0) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amount, t + fadeIn + 0.2);
  } else {
    g.gain.value = amount;
  }
  o.connect(g);
  g.connect(target);
  o.start(t);
  return o;
}

function addNoise(ctx: BaseAudioContext, n: NoiseSpec, into: AudioNode, t: number, trim: number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = n.type ?? 'bandpass';
  f.frequency.value = n.freq;
  f.Q.value = n.q ?? 0.7;
  const g = ctx.createGain();
  const peak = n.gain * trim;
  const attack = n.attack ?? 0.001;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.max(0.001, attack));
  g.gain.setTargetAtTime(peak * (n.sustain ?? 0), t + attack, n.decay);
  src.connect(f);
  f.connect(g);
  g.connect(into);
  src.start(t);
  return src;
}

function startSub(ctx: BaseAudioContext, out: AudioNode, s: SubSpec, midi: number, trim: number, t: number): Voice {
  const f = midiToHz(midi);
  const rel = releaseStage(ctx, out, s.release);
  const amp = ctx.createGain();
  amp.connect(rel.gain);

  // amplitude envelope: attack, then decay toward the sustain level
  const norm = 0.55 / Math.sqrt(s.osc.reduce((a, o) => a + (o.gain ?? 1) ** 2, 0));
  const peak = trim * norm;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + Math.max(0.002, s.attack));
  amp.gain.setTargetAtTime(peak * s.sustain, t + s.attack, s.decay);

  let node: AudioNode = amp;
  if (s.trem) {
    const tr = ctx.createGain();
    tr.gain.value = 1 - s.trem.depth / 2;
    tr.connect(node);
    const l = lfo(ctx, s.trem.rate, s.trem.depth / 2, tr.gain, t);
    rel.onStop((x) => l.stop(x));
    node = tr;
  }
  if (s.drive) {
    const ws = ctx.createWaveShaper();
    ws.curve = driveCurve(ctx, s.drive) as Float32Array<ArrayBuffer>;
    ws.connect(node);
    node = ws;
  }

  // filter or vowel bank sits in front of the amplifier
  let input: AudioNode = node;
  if (s.formants) {
    const sum = ctx.createGain();
    sum.gain.value = 1;
    for (const [hz, q, g] of s.formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = hz;
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = g * 2.2;
      sum.connect(bp);
      bp.connect(gg);
      gg.connect(node);
    }
    input = sum;
  } else if (s.filter) {
    const bq = ctx.createBiquadFilter();
    bq.type = s.filter.type ?? 'lowpass';
    const cutoff = clamp(s.filter.base + s.filter.track * f, 60, 16000);
    bq.Q.value = s.filter.q;
    if (s.filter.env) {
      bq.frequency.setValueAtTime(clamp(cutoff * (1 + s.filter.env), 60, 18000), t);
      bq.frequency.setTargetAtTime(cutoff, t, s.filter.envTime ?? 0.15);
    } else {
      bq.frequency.value = cutoff;
    }
    bq.connect(node);
    input = bq;
  }

  const oscs: OscillatorNode[] = [];
  for (const o of s.osc) {
    const osc = ctx.createOscillator();
    if (o.harm) osc.setPeriodicWave(harmonicWave(ctx, o.harm));
    else osc.type = o.type ?? 'sine';
    const hz = f * (o.ratio ?? 1);
    if (s.drop) {
      osc.frequency.setValueAtTime(hz * s.drop.mult, t);
      osc.frequency.exponentialRampToValueAtTime(hz, t + s.drop.time);
    } else {
      osc.frequency.value = hz;
    }
    osc.detune.value = o.detune ?? 0;
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    osc.connect(g);
    g.connect(input);
    if (s.vibrato) {
      const l = lfo(ctx, s.vibrato.rate, s.vibrato.depth, osc.detune, t, s.vibrato.delay);
      rel.onStop((x) => l.stop(x));
    }
    osc.start(t);
    oscs.push(osc);
  }

  const noise = s.noise ? addNoise(ctx, s.noise, node, t, trim) : null;

  // notes that fade away by themselves can be switched off once silent
  const natural = s.sustain <= 0.001 ? t + s.attack + s.decay * 9 + 0.1 : t + MAX_VOICE_SECONDS;
  oscs.forEach((o) => o.stop(natural));
  noise?.stop(natural);
  rel.onStop((x) => {
    oscs.forEach((o) => o.stop(Math.min(x, natural)));
    noise?.stop(Math.min(x, natural));
  });
  oscs[0].onended = () => {
    try {
      rel.gain.disconnect();
    } catch {
      /* already gone */
    }
  };
  return rel.voice;
}

function startFm(ctx: BaseAudioContext, out: AudioNode, s: FmSpec, midi: number, trim: number, t: number): Voice {
  const f = midiToHz(midi);
  const rel = releaseStage(ctx, out, s.release);
  const amp = ctx.createGain();
  amp.connect(rel.gain);
  const attack = s.attack ?? 0.002;
  const peak = trim * 0.5;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + attack);
  amp.gain.setTargetAtTime(peak * s.sustain, t + attack, s.decay);

  let node: AudioNode = amp;
  if (s.trem) {
    const tr = ctx.createGain();
    tr.gain.value = 1 - s.trem.depth / 2;
    tr.connect(node);
    const l = lfo(ctx, s.trem.rate, s.trem.depth / 2, tr.gain, t);
    rel.onStop((x) => l.stop(x));
    node = tr;
  }

  const car = ctx.createOscillator();
  car.frequency.value = f * s.carrier;
  const mod = ctx.createOscillator();
  mod.frequency.value = f * s.mod;
  const dev = ctx.createGain();
  // keep very high notes from folding into harsh aliasing
  const brightFix = f * s.mod > 5000 ? 0.3 : 1;
  const idx = s.index * f * s.mod * brightFix;
  dev.gain.setValueAtTime(idx, t);
  dev.gain.setTargetAtTime(idx * 0.12, t, s.indexDecay);
  mod.connect(dev);
  dev.connect(car.frequency);
  car.connect(node);
  car.start(t);
  mod.start(t);
  const noise = s.noise ? addNoise(ctx, s.noise, node, t, trim) : null;

  const natural = s.sustain <= 0.001 ? t + attack + s.decay * 9 + 0.1 : t + MAX_VOICE_SECONDS;
  car.stop(natural);
  mod.stop(natural);
  noise?.stop(natural);
  rel.onStop((x) => {
    car.stop(Math.min(x, natural));
    mod.stop(Math.min(x, natural));
    noise?.stop(Math.min(x, natural));
  });
  car.onended = () => {
    try {
      rel.gain.disconnect();
    } catch {
      /* already gone */
    }
  };
  return rel.voice;
}

/* ---- Karplus-Strong ---- */

function renderPluck(sr: number, hz: number, s: PluckSpec): Float32Array {
  const bright = clamp(s.bright, 0, 1);
  const k = 0.5 - 0.4 * bright; // loop smoothing: big k is dark
  const period = sr / hz;
  const N = Math.max(2, Math.floor(period - k - 0.1));
  const D = period - k - N; // fractional delay left over
  const a = (1 - D) / (1 + D); // all-pass for fine tuning

  const t60 = clamp(s.t60 * Math.pow(261.6 / hz, 0.4), 0.15, 12);
  const loss = Math.pow(10, -3 / (t60 * hz)); // per trip around the loop
  const seconds = Math.min(6, t60 * 0.9 + 0.2);
  const len = Math.floor(seconds * sr);
  const out = new Float32Array(len);

  // excitation: noise burst, smoothed by brightness, notched at the pick position
  const line = new Float32Array(N);
  let seed = (Math.floor(hz * 1000) ^ 0x9e3779b9) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const alpha = (1 - bright) * 0.85;
  let lp = 0;
  const burst = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    lp = lp * alpha + rnd() * (1 - alpha);
    burst[i] = lp;
  }
  const pickN = Math.max(1, Math.round((s.pick ?? 0.15) * N));
  let mean = 0;
  for (let i = 0; i < N; i++) {
    line[i] = burst[i] - (i >= pickN ? burst[i - pickN] : 0) * 0.9;
    mean += line[i];
  }
  mean /= N;
  let peak = 1e-6;
  for (let i = 0; i < N; i++) {
    line[i] -= mean;
    peak = Math.max(peak, Math.abs(line[i]));
  }
  for (let i = 0; i < N; i++) line[i] /= peak;

  let idx = 0;
  let prev = line[N - 1];
  let apX = 0;
  let apY = 0;
  for (let n = 0; n < len; n++) {
    const cur = line[idx];
    out[n] = cur;
    const smooth = cur * (1 - k) + prev * k;
    prev = cur;
    const ap = a * smooth + apX - a * apY;
    apX = smooth;
    apY = ap;
    line[idx] = ap * loss;
    idx = idx + 1 === N ? 0 : idx + 1;
  }

  if (s.buzz) {
    for (let n = 0; n < len; n++) {
      const x = out[n] * 3;
      out[n] = (x > 0 ? Math.tanh(x * 2) : Math.tanh(x * 0.5)) * 0.6;
    }
  }
  if (s.drive) {
    const d = s.drive;
    for (let n = 0; n < len; n++) out[n] = Math.tanh(out[n] * d * 1.5) / Math.tanh(d);
  }
  // remove any DC, soften the very end
  let dc = 0;
  for (let n = 0; n < len; n++) dc += out[n];
  dc /= len;
  const fade = Math.min(len, Math.floor(0.06 * sr));
  let pk = 1e-6;
  for (let n = 0; n < len; n++) {
    let v = out[n] - dc;
    if (n > len - fade) v *= (len - n) / fade;
    out[n] = v;
    pk = Math.max(pk, Math.abs(v));
  }
  for (let n = 0; n < len; n++) out[n] /= pk;
  return out;
}

function pluckBuffer(ctx: BaseAudioContext, inst: Inst, s: PluckSpec, midi: number): AudioBuffer {
  const c = cacheOf(ctx);
  const key = `${inst.id}:${midi}`;
  let buf = c.plucks.get(key);
  if (buf) return buf;
  const sr = ctx.sampleRate;
  const hz = midiToHz(midi);
  const a = renderPluck(sr, hz, s);
  let data = a;
  if (s.double) {
    const b = renderPluck(sr, hz * Math.pow(2, s.double / 1200), { ...s, pick: (s.pick ?? 0.15) * 1.3 });
    const len = Math.min(a.length, b.length);
    data = new Float32Array(len);
    for (let i = 0; i < len; i++) data[i] = (a[i] + b[i]) * 0.5;
  }
  buf = ctx.createBuffer(1, data.length, sr);
  buf.getChannelData(0).set(data);
  c.plucks.set(key, buf);
  if (c.plucks.size > 500) {
    const first = c.plucks.keys().next().value;
    if (first !== undefined) c.plucks.delete(first);
  }
  return buf;
}

function startPluck(ctx: BaseAudioContext, out: AudioNode, inst: Inst, s: PluckSpec, midi: number, trim: number, t: number): Voice {
  const rel = releaseStage(ctx, out, s.release);
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(ctx, inst, s, midi);
  const g = ctx.createGain();
  g.gain.value = trim * 0.7;
  src.connect(g);
  g.connect(rel.gain);
  src.start(t);
  rel.onStop((x) => src.stop(x));
  src.onended = () => {
    try {
      rel.gain.disconnect();
    } catch {
      /* already gone */
    }
  };
  return rel.voice;
}

/* ---- piano ---- */

function startPiano(ctx: BaseAudioContext, out: AudioNode, s: PianoSpec, midi: number, trim: number, t: number): Voice {
  const f = midiToHz(midi);
  const rel = releaseStage(ctx, out, s.release);
  const bus = ctx.createGain();
  bus.gain.value = trim * 0.5;
  bus.connect(rel.gain);

  const t60 = clamp(s.t60 * Math.pow(261.6 / f, 0.75), 0.4, 14);
  const B = s.inharm * Math.pow(Math.max(f, 60) / 261.6, 1.4);
  let total = 0;
  const parts: Array<{ hz: number; a: number; tau: number }> = [];
  for (let k = 1; k <= s.partials; k++) {
    const hz = f * k * Math.sqrt(1 + B * k * k);
    if (hz > 9500) break;
    const hammer = Math.abs(Math.sin(Math.PI * k * 0.125)) * 0.8 + 0.2; // strike point near 1/8 of the string
    const a = (1 / Math.pow(k, s.bright)) * hammer;
    parts.push({ hz, a, tau: t60 / (6.9 * (1 + 0.55 * (k - 1))) });
    total += a;
  }
  const oscs: OscillatorNode[] = [];
  const natural = t + t60 * 1.1 + 0.3;
  parts.forEach((p, i) => {
    const copies = i < 3 && s.chorus > 0 ? 2 : 1;
    for (let c = 0; c < copies; c++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = p.hz;
      osc.detune.value = copies === 2 ? (c === 0 ? -s.chorus / 2 : s.chorus / 2) : 0;
      const g = ctx.createGain();
      const peak = (p.a / total) * (copies === 2 ? 0.55 : 1) * 1.3;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.003);
      g.gain.setTargetAtTime(0, t + 0.003, p.tau);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(natural);
      oscs.push(osc);
    }
  });
  let thump: AudioBufferSourceNode | null = null;
  if (s.hammer > 0) {
    thump = addNoise(ctx, { gain: s.hammer * 0.5, freq: clamp(f * 3, 300, 5000), q: 0.8, type: 'bandpass', decay: 0.012 }, bus, t, 1);
    thump.stop(t + 0.15);
  }
  rel.onStop((x) => oscs.forEach((o) => o.stop(Math.min(x, natural))));
  if (oscs[0]) {
    oscs[0].onended = () => {
      try {
        rel.gain.disconnect();
      } catch {
        /* already gone */
      }
    };
  }
  return rel.voice;
}

/* ---------- shared effects ---------- */

/** A short, soft room: decaying stereo noise. Good enough to glue everything together. */
export function makeReverbImpulse(ctx: BaseAudioContext, seconds = 1.8): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = 777 + ch * 1013;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = (seed / 4294967296) * 2 - 1;
      lp = lp * 0.55 + n * 0.45; // darker tail
      d[i] = lp * Math.pow(1 - i / len, 2.6);
    }
  }
  return buf;
}

export const CHORDS: Array<{ id: string; label: string; offsets: number[] }> = [
  { id: 'off', label: 'Single notes', offsets: [0] },
  { id: 'major', label: 'Major chord (happy)', offsets: [0, 4, 7] },
  { id: 'minor', label: 'Minor chord (sad)', offsets: [0, 3, 7] },
  { id: 'seventh', label: 'Seventh chord (jazzy)', offsets: [0, 4, 7, 10] },
  { id: 'sus', label: 'Open chord (floaty)', offsets: [0, 5, 7] },
  { id: 'power', label: 'Power chord (rock)', offsets: [0, 7, 12] },
  { id: 'octave', label: 'Double octave', offsets: [0, 12] },
];

export const SCALES: Array<{ id: string; label: string; steps: number[] }> = [
  { id: 'off', label: 'No help', steps: [] },
  { id: 'major', label: 'Major (happy)', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', label: 'Minor (sad)', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'majpent', label: 'Easy happy (5 notes)', steps: [0, 2, 4, 7, 9] },
  { id: 'minpent', label: 'Easy sad (5 notes)', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
];

/** Soft safety limiter curve: signals are halved before it, so it covers peaks up to 2x full scale. */
export function makeLimiterCurve() {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(2 * ((i / (n - 1)) * 2 - 1));
  return curve;
}
