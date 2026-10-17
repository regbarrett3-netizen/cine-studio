/* ==================================================================== */
/* CINE mixer engine: audio library, 24-channel session, automation,     */
/* waveform peaks, live playback and mixdown. No React in here.          */
/* ==================================================================== */

import type { NewClip } from './Editor';
import { makeReverbImpulse } from './instruments';

/** A clip handed to the project. Sounds can carry their audio so the mixer can use them. */
export type AudioClip = NewClip & { blob?: Blob };

/* ------------------------------------------------------------------ */
/* Audio library: the actual sounds, kept on this phone                */
/* ------------------------------------------------------------------ */

export interface LibItem {
  id: string;
  name: string;
  seconds: number;
  from?: string;
  track?: string;
  added: number;
}

const DB_NAME = 'cine-audio';
const STORE = 'blobs';
const memoryBlobs = new Map<string, Blob>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) {
    memoryBlobs.set(id, blob);
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    memoryBlobs.set(id, blob); // storage full or blocked: keep it for this visit at least
  }
}

export async function getBlob(id: string): Promise<Blob | null> {
  const m = memoryBlobs.get(id);
  if (m) return m;
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function delBlob(id: string): Promise<void> {
  memoryBlobs.delete(id);
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* nothing to do */
  }
}

const libKey = (mode: string) => `cine-library-${mode}`;
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function readLibrary(mode: string): LibItem[] {
  try {
    const raw = window.localStorage.getItem(libKey(mode));
    const parsed = raw ? (JSON.parse(raw) as LibItem[]) : [];
    return Array.isArray(parsed) ? parsed.filter((i) => i && typeof i.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeLibrary(mode: string, items: LibItem[]) {
  try {
    window.localStorage.setItem(libKey(mode), JSON.stringify(items));
  } catch {
    /* storage blocked: the item stays in memory for this visit */
  }
}

/** Keep a copy of a finished sound so the mixer can play it. Returns null if the clip has no audio. */
export async function saveToLibrary(mode: string, clip: AudioClip): Promise<LibItem | null> {
  if (clip.type !== 'audio' || !clip.blob) return null;
  const item: LibItem = {
    id: newId(),
    name: clip.name,
    seconds: clip.duration,
    from: clip.from,
    track: clip.track,
    added: Date.now(),
  };
  await putBlob(item.id, clip.blob);
  writeLibrary(mode, [...readLibrary(mode), item]);
  return item;
}

export function updateLibrarySeconds(mode: string, id: string, seconds: number) {
  writeLibrary(mode, readLibrary(mode).map((i) => (i.id === id ? { ...i, seconds } : i)));
}

export async function removeFromLibrary(mode: string, id: string): Promise<void> {
  writeLibrary(mode, readLibrary(mode).filter((i) => i.id !== id));
  await delBlob(id);
}

/* ------------------------------------------------------------------ */
/* The session: 24 channels, regions, automation                      */
/* ------------------------------------------------------------------ */

export const CHANNELS = 24;
export const MAX_AUTO_POINTS = 4000;
export const MAX_SECONDS = 600;

export type AutoMode = 'off' | 'read' | 'write' | 'touch' | 'latch';
export const AUTO_MODES: AutoMode[] = ['off', 'read', 'write', 'touch', 'latch'];
export type AutoTarget = 'vol' | 'pan' | 'mute' | 'solo';
export const EQ_MAX = 12; // dB either way
export interface Eq {
  low: number;
  mid: number;
  high: number;
}

export interface AutoPoint {
  t: number; // timeline seconds
  v: number; // fader position 0..1 (volume) or -1..1 (pan)
}

export interface Region {
  id: string;
  item: string; // library id
  name: string;
  start: number; // where it sits on the timeline
  offset: number; // where in the sound it begins
  length: number;
  gain: number; // linear
  fadeIn: number;
  fadeOut: number;
}

export interface Channel {
  name: string;
  color: string;
  vol: number; // fader position
  pan: number;
  mute: boolean;
  solo: boolean;
  mode: AutoMode;
  autoVol: AutoPoint[];
  autoPan: AutoPoint[];
  autoMute: AutoPoint[]; // steps: v >= 0.5 means muted
  autoSolo: AutoPoint[];
  eq: Eq;
  reverb: number; // 0..1 send
  regions: Region[];
}

export interface Session {
  channels: Channel[];
  master: number;
  seen: string[]; // library ids already placed
}

export const FADER_UNITY = 0.75;
export const COLORS = ['#f472b6', '#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#fb923c', '#f87171', '#2dd4bf'];

export function newChannel(i: number): Channel {
  return {
    name: `Ch ${i + 1}`,
    color: COLORS[i % COLORS.length],
    vol: FADER_UNITY,
    pan: 0,
    mute: false,
    solo: false,
    mode: 'off',
    autoVol: [],
    autoPan: [],
    autoMute: [],
    autoSolo: [],
    eq: { low: 0, mid: 0, high: 0 },
    reverb: 0,
    regions: [],
  };
}

export function newSession(): Session {
  return { channels: Array.from({ length: CHANNELS }, (_, i) => newChannel(i)), master: FADER_UNITY, seen: [] };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fader position (0..1) to linear gain: 0.75 is 0 dB, the top is +6 dB, the bottom is silence. */
export function faderToDb(p: number): number {
  if (p <= 0.001) return -Infinity;
  if (p >= FADER_UNITY) return ((p - FADER_UNITY) / (1 - FADER_UNITY)) * 6;
  return -72 * Math.pow(1 - p / FADER_UNITY, 1.6);
}
export function faderToGain(p: number): number {
  const db = faderToDb(clamp(p, 0, 1));
  return db === -Infinity ? 0 : Math.pow(10, db / 20);
}
export function dbLabel(p: number): string {
  const db = faderToDb(p);
  if (db === -Infinity) return '-∞';
  if (Math.abs(db) < 0.05) return '0.0';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
}

export function dbToLinear(db: number) {
  return Math.pow(10, db / 20);
}

export function valueAt(points: AutoPoint[], t: number, fallback: number): number {
  const n = points.length;
  if (n === 0) return fallback;
  if (t <= points[0].t) return points[0].v;
  if (t >= points[n - 1].t) return points[n - 1].v;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.t - a.t;
  return span <= 0 ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / span;
}

/** Value of a stepped lane (mute, solo): it holds until the next point. */
export function stepAt(points: AutoPoint[], t: number, fallback: number): number {
  const n = points.length;
  if (n === 0) return fallback;
  if (t < points[0].t) return points[0].v;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return points[lo].v;
}

/** Like mergeAutomation but for stepped lanes: values hold, so nothing is smoothed. */
export function mergeSteps(old: AutoPoint[], startT: number, endT: number, written: AutoPoint[], fallback: number): AutoPoint[] {
  if (written.length === 0) return old;
  const before = old.filter((p) => p.t < startT);
  const after = old.filter((p) => p.t > endT);
  const out: AutoPoint[] = [...before];
  if (old.length > 0 && startT > 0.002) out.push({ t: Math.max(0, startT - 0.002), v: stepAt(old, startT, fallback) });
  out.push(...written);
  out.sort((a, b) => a.t - b.t);
  if (after.length > 0) out.push({ t: endT + 0.002, v: stepAt(old, endT, fallback) });
  out.push(...after);
  const clean: AutoPoint[] = [];
  for (const p of out) {
    const last = clean[clean.length - 1];
    if (last && p.t <= last.t) {
      if (p.t < last.t - 1e-6) continue;
      last.v = p.v;
    } else if (!last || last.v !== p.v) clean.push({ t: p.t, v: p.v });
  }
  return clean.slice(0, MAX_AUTO_POINTS);
}

/** Drop points that lie on a straight line between their neighbours. */
export function thin(points: AutoPoint[], eps = 0.004): AutoPoint[] {
  if (points.length <= 2) return points.slice();
  const out: AutoPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const span = c.t - a.t;
    const expect = span <= 0 ? b.v : a.v + ((c.v - a.v) * (b.t - a.t)) / span;
    if (Math.abs(expect - b.v) > eps) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Put newly written points into old automation, replacing whatever lay in the written range. */
export function mergeAutomation(old: AutoPoint[], startT: number, endT: number, written: AutoPoint[], fallback: number): AutoPoint[] {
  if (written.length === 0) return old;
  const before = old.filter((p) => p.t < startT);
  const after = old.filter((p) => p.t > endT);
  const out: AutoPoint[] = [...before];
  if (old.length > 0 && startT > 0.002) {
    // hold the old value right up to where the new writing begins
    out.push({ t: Math.max(0, startT - 0.002), v: valueAt(old, startT, fallback) });
  }
  out.push(...written);
  out.sort((a, b) => a.t - b.t);
  const merged = [...out, ...after];
  // keep times strictly rising
  const clean: AutoPoint[] = [];
  for (const p of merged) {
    const last = clean[clean.length - 1];
    if (last && p.t <= last.t) {
      if (p.t < last.t - 1e-6) continue;
      last.v = p.v;
    } else clean.push({ t: p.t, v: p.v });
  }
  return thin(clean).slice(0, MAX_AUTO_POINTS);
}

export function regionEnd(r: Region) {
  return r.start + r.length;
}

export function sessionEnd(s: Session): number {
  let end = 0;
  for (const c of s.channels) for (const r of c.regions) end = Math.max(end, regionEnd(r));
  return end;
}

const sKey = (mode: string) => `cine-mix-${mode}`;

export function loadSession(mode: string): Session {
  try {
    const raw = window.localStorage.getItem(sKey(mode));
    if (!raw) return newSession();
    const p = JSON.parse(raw) as Session;
    if (!p || !Array.isArray(p.channels)) return newSession();
    const base = newSession();
    base.master = typeof p.master === 'number' ? clamp(p.master, 0, 1) : FADER_UNITY;
    base.seen = Array.isArray(p.seen) ? p.seen.filter((x) => typeof x === 'string') : [];
    p.channels.slice(0, CHANNELS).forEach((c, i) => {
      const d = base.channels[i];
      if (typeof c.name === 'string') d.name = c.name.slice(0, 16);
      if (typeof c.color === 'string') d.color = c.color;
      if (typeof c.vol === 'number') d.vol = clamp(c.vol, 0, 1);
      if (typeof c.pan === 'number') d.pan = clamp(c.pan, -1, 1);
      d.mute = c.mute === true;
      d.solo = c.solo === true;
      d.mode = AUTO_MODES.includes(c.mode) ? c.mode : 'off';
      const pts = (a: unknown): AutoPoint[] =>
        Array.isArray(a) ? a.filter((q) => q && Number.isFinite(q.t) && Number.isFinite(q.v)).map((q) => ({ t: q.t, v: q.v })).slice(0, MAX_AUTO_POINTS) : [];
      d.autoVol = pts(c.autoVol);
      d.autoPan = pts(c.autoPan);
      d.autoMute = pts(c.autoMute);
      d.autoSolo = pts(c.autoSolo);
      const e = (c.eq ?? {}) as Partial<Eq>;
      const eqv = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? clamp(x, -EQ_MAX, EQ_MAX) : 0);
      d.eq = { low: eqv(e.low), mid: eqv(e.mid), high: eqv(e.high) };
      d.reverb = typeof c.reverb === 'number' && Number.isFinite(c.reverb) ? clamp(c.reverb, 0, 1) : 0;
      d.regions = Array.isArray(c.regions)
        ? c.regions
            .filter((r) => r && typeof r.item === 'string' && Number.isFinite(r.start) && Number.isFinite(r.length) && r.length > 0)
            .map((r) => ({
              id: typeof r.id === 'string' ? r.id : newId(),
              item: r.item,
              name: typeof r.name === 'string' ? r.name : 'Sound',
              start: Math.max(0, r.start),
              offset: Math.max(0, Number.isFinite(r.offset) ? r.offset : 0),
              length: r.length,
              gain: Number.isFinite(r.gain) ? clamp(r.gain, 0, 4) : 1,
              fadeIn: Number.isFinite(r.fadeIn) ? Math.max(0, r.fadeIn) : 0,
              fadeOut: Number.isFinite(r.fadeOut) ? Math.max(0, r.fadeOut) : 0,
            }))
        : [];
    });
    return base;
  } catch {
    return newSession();
  }
}

export function saveSession(mode: string, s: Session) {
  try {
    window.localStorage.setItem(sKey(mode), JSON.stringify(s));
  } catch {
    /* storage blocked: the mix is kept for this visit only */
  }
}

export function cloneSession(s: Session): Session {
  return JSON.parse(JSON.stringify(s)) as Session;
}

/* ---------- editing a region ---------- */

export function splitRegion(r: Region, t: number): [Region, Region] | null {
  const end = regionEnd(r);
  if (t <= r.start + 0.0005 || t >= end - 0.0005) return null;
  const left: Region = { ...r, length: t - r.start, fadeOut: 0 };
  const right: Region = { ...r, id: newId(), start: t, offset: r.offset + (t - r.start), length: end - t, fadeIn: 0 };
  left.fadeIn = Math.min(left.fadeIn, left.length / 2);
  right.fadeOut = Math.min(right.fadeOut, right.length / 2);
  return [left, right];
}

export function clampFades(r: Region) {
  const half = r.length / 2;
  r.fadeIn = clamp(r.fadeIn, 0, half);
  r.fadeOut = clamp(r.fadeOut, 0, half);
}

/* ------------------------------------------------------------------ */
/* Waveform peaks (several zoom levels so drawing is always quick)    */
/* ------------------------------------------------------------------ */

export interface PeakLevel {
  spp: number; // samples per peak
  min: Float32Array;
  max: Float32Array;
}
export interface Peaks {
  rate: number;
  length: number;
  levels: PeakLevel[];
}

export function buildPeaks(buf: AudioBuffer): Peaks {
  const chs: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  const base = 64;
  const n = Math.max(1, Math.ceil(buf.length / base));
  let min = new Float32Array(n);
  let max = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let lo = 1;
    let hi = -1;
    const a = i * base;
    const b = Math.min(buf.length, a + base);
    for (const d of chs) {
      for (let k = a; k < b; k++) {
        const v = d[k];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min[i] = b > a ? lo : 0;
    max[i] = b > a ? hi : 0;
  }
  const levels: PeakLevel[] = [{ spp: base, min, max }];
  let spp = base;
  while (min.length > 64) {
    const m = Math.ceil(min.length / 4);
    const nMin = new Float32Array(m);
    const nMax = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      let lo = 1;
      let hi = -1;
      for (let k = i * 4; k < Math.min(min.length, i * 4 + 4); k++) {
        if (min[k] < lo) lo = min[k];
        if (max[k] > hi) hi = max[k];
      }
      nMin[i] = lo;
      nMax[i] = hi;
    }
    spp *= 4;
    levels.push({ spp, min: nMin, max: nMax });
    min = nMin;
    max = nMax;
  }
  return { rate: buf.sampleRate, length: buf.length, levels };
}

/** Move to the nearest point where the waveform crosses zero, so cuts do not click. */
export function nearestZero(buf: AudioBuffer, timeSec: number, radiusSec = 0.01): number {
  const d = buf.getChannelData(0);
  const rate = buf.sampleRate;
  const centre = Math.round(timeSec * rate);
  const radius = Math.round(radiusSec * rate);
  let best = -1;
  for (let k = 0; k <= radius; k++) {
    for (const idx of k === 0 ? [centre] : [centre - k, centre + k]) {
      if (idx < 1 || idx >= d.length) continue;
      if ((d[idx - 1] <= 0 && d[idx] > 0) || (d[idx - 1] >= 0 && d[idx] < 0) || d[idx] === 0) {
        best = idx;
        break;
      }
    }
    if (best >= 0) break;
  }
  return best >= 0 ? best / rate : timeSec;
}

/* ------------------------------------------------------------------ */
/* The audio graph                                                     */
/* ------------------------------------------------------------------ */

interface ChannelNodes {
  fader: GainNode;
  panL: AudioParam; // balance: left side level
  panR: AudioParam; // balance: right side level
  gate: GainNode; // mute and solo
  lo: BiquadFilterNode;
  mid: BiquadFilterNode;
  hi: BiquadFilterNode;
  send: GainNode; // to the shared reverb
  input: GainNode;
  meter: AnalyserNode;
}

function limiterCurve() {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(2 * ((i / (n - 1)) * 2 - 1));
  return c;
}

export class MixEngine {
  readonly ctx: BaseAudioContext;
  readonly nodes: ChannelNodes[] = [];
  readonly master: GainNode;
  readonly masterMeter: AnalyserNode;
  private readonly verb: ConvolverNode;
  private sources: AudioBufferSourceNode[] = [];
  private anchorCtx = 0;
  private anchorT = 0;
  private render = false;
  playing = false;
  private buf = new Float32Array(512);
  private writing = new Set<string>();

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.masterMeter = ctx.createAnalyser();
    this.masterMeter.fftSize = 512;
    const pre = ctx.createGain();
    pre.gain.value = 0.5;
    const lim = ctx.createWaveShaper();
    lim.curve = limiterCurve();
    this.master.connect(this.masterMeter);
    this.master.connect(pre);
    pre.connect(lim);
    lim.connect(ctx.destination);
    this.verb = ctx.createConvolver();
    this.verb.buffer = makeReverbImpulse(ctx, 2.2);
    this.verb.connect(this.master);
    for (let i = 0; i < CHANNELS; i++) {
      const input = ctx.createGain();
      const fader = ctx.createGain();
      const gate = ctx.createGain();
      // balance: the centre leaves both sides alone, moving off-centre turns the far side down
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      const gl = ctx.createGain();
      const gr = ctx.createGain();
      gl.gain.value = 1;
      gr.gain.value = 1;
      const meter = ctx.createAnalyser();
      meter.fftSize = 512;
      const lo = ctx.createBiquadFilter();
      const mid = ctx.createBiquadFilter();
      const hi = ctx.createBiquadFilter();
      lo.type = 'lowshelf';
      lo.frequency.value = 120;
      mid.type = 'peaking';
      mid.frequency.value = 1000;
      mid.Q.value = 0.9;
      hi.type = 'highshelf';
      hi.frequency.value = 6000;
      const send = ctx.createGain();
      send.gain.value = 0;
      input.connect(lo);
      lo.connect(mid);
      mid.connect(hi);
      hi.connect(fader);
      fader.connect(split);
      split.connect(gl, 0);
      split.connect(gr, 1);
      gl.connect(merge, 0, 0);
      gr.connect(merge, 0, 1);
      merge.connect(gate);
      gate.connect(meter);
      gate.connect(this.master);
      gate.connect(send);
      send.connect(this.verb);
      this.nodes.push({ input, fader, panL: gl.gain, panR: gr.gain, gate, lo, mid, hi, send, meter });
    }
  }

  /** where the playhead is on the timeline, in seconds */
  get time(): number {
    if (!this.playing) return this.anchorT;
    return this.anchorT + Math.max(0, this.ctx.currentTime - this.anchorCtx);
  }

  private at(t: number) {
    return this.anchorCtx + (t - this.anchorT);
  }

  /** while a fader move is being recorded, the live fader wins over the stored moves */
  setWriting(i: number, target: AutoTarget, on: boolean) {
    const key = `${i}:${target}`;
    if (on) this.writing.add(key);
    else this.writing.delete(key);
  }

  private usesAuto(ch: Channel, pts: AutoPoint[], key: string) {
    if (pts.length === 0 || this.writing.has(key)) return false;
    return this.render ? ch.mode !== 'off' : ch.mode === 'read' || ch.mode === 'touch' || ch.mode === 'latch';
  }

  private schedule(param: AudioParam, pts: AutoPoint[], staticVal: number, conv: (v: number) => number, useAuto: boolean, fromT: number) {
    const now = this.ctx.currentTime;
    const T = this.playing ? Math.max(now, this.at(fromT)) : now;
    param.cancelScheduledValues(this.render ? 0 : now);
    if (useAuto) {
      param.setValueAtTime(conv(valueAt(pts, fromT, staticVal)), T);
      let prev = { t: fromT, v: valueAt(pts, fromT, staticVal) };
      let events = 0;
      for (const p of pts) {
        if (p.t <= fromT) continue;
        // move in fader steps, so a long slide sounds like a smooth fader move
        const steps = Math.min(40, Math.max(1, Math.ceil(Math.abs(p.v - prev.v) / 0.02)));
        for (let k = 1; k <= steps && events < 20000; k++, events++) {
          const f = k / steps;
          param.linearRampToValueAtTime(conv(prev.v + (p.v - prev.v) * f), this.at(prev.t + (p.t - prev.t) * f));
        }
        prev = p;
      }
    } else {
      param.setValueAtTime(conv(staticVal), T);
    }
  }

  /** (Re)apply fader, pan, sound shaping, mute and solo of one channel from the playhead onward. */
  applyChannel(s: Session, i: number, only?: AutoTarget, skipGates = false) {
    const ch = s.channels[i];
    const n = this.nodes[i];
    const t = this.time;
    if (!only || only === 'vol') this.schedule(n.fader.gain, ch.autoVol, ch.vol, faderToGain, this.usesAuto(ch, ch.autoVol, `${i}:vol`), t);
    if (!only || only === 'pan') {
      // balance: the centre leaves both sides alone, moving off-centre turns the far side down
      const useP = this.usesAuto(ch, ch.autoPan, `${i}:pan`);
      this.schedule(n.panL, ch.autoPan, ch.pan, (v) => Math.min(1, 1 - clamp(v, -1, 1)), useP, t);
      this.schedule(n.panR, ch.autoPan, ch.pan, (v) => Math.min(1, 1 + clamp(v, -1, 1)), useP, t);
    }
    if (!only) {
      const at = this.render ? 0 : this.ctx.currentTime;
      n.lo.gain.setTargetAtTime(clamp(ch.eq.low, -EQ_MAX, EQ_MAX), at, 0.02);
      n.mid.gain.setTargetAtTime(clamp(ch.eq.mid, -EQ_MAX, EQ_MAX), at, 0.02);
      n.hi.gain.setTargetAtTime(clamp(ch.eq.high, -EQ_MAX, EQ_MAX), at, 0.02);
      n.send.gain.setTargetAtTime(clamp(ch.reverb, 0, 1) * 0.8, at, 0.02);
    }
    if (!skipGates && (!only || only === 'mute' || only === 'solo')) this.applyGates(s);
  }

  private muteOf(s: Session, i: number, t: number) {
    const c = s.channels[i];
    return (this.usesAuto(c, c.autoMute, `${i}:mute`) ? stepAt(c.autoMute, t, 0) >= 0.5 : c.mute);
  }

  private soloOf(s: Session, i: number, t: number) {
    const c = s.channels[i];
    return (this.usesAuto(c, c.autoSolo, `${i}:solo`) ? stepAt(c.autoSolo, t, 0) >= 0.5 : c.solo);
  }

  /** Mute and solo for every channel together, because one solo changes all the others. */
  private applyGates(s: Session) {
    const from = this.time;
    const at = this.render ? 0 : this.ctx.currentTime;
    const times: number[] = [];
    s.channels.forEach((c, i) => {
      if (this.usesAuto(c, c.autoMute, `${i}:mute`)) for (const p of c.autoMute) if (p.t > from) times.push(p.t);
      if (this.usesAuto(c, c.autoSolo, `${i}:solo`)) for (const p of c.autoSolo) if (p.t > from) times.push(p.t);
    });
    const uniq = [...new Set(times)].sort((a, b) => a - b).slice(0, 4000);
    s.channels.forEach((_, i) => {
      const g = this.nodes[i].gate.gain;
      const audibleAt = (t: number) => {
        let anySolo = false;
        for (let j = 0; j < s.channels.length; j++) if (this.soloOf(s, j, t)) anySolo = true;
        return !this.muteOf(s, i, t) && (!anySolo || this.soloOf(s, i, t));
      };
      g.cancelScheduledValues(at);
      let cur = audibleAt(from);
      g.setTargetAtTime(cur ? 1 : 0, at, 0.01);
      for (const t of uniq) {
        const v = audibleAt(t + 1e-4);
        if (v === cur) continue;
        cur = v;
        g.setTargetAtTime(v ? 1 : 0, Math.max(at, this.at(t)), 0.005);
      }
    });
  }

  applyAll(s: Session) {
    s.channels.forEach((_, i) => this.applyChannel(s, i, undefined, true));
    this.applyGates(s);
    this.master.gain.setTargetAtTime(faderToGain(s.master), this.render ? 0 : this.ctx.currentTime, 0.01);
  }

  private stopSources() {
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* never started */
      }
      src.disconnect();
    }
    this.sources = [];
  }

  /** Start playing from timeline second t0. Pass render=true when the context is an offline one. */
  play(s: Session, buffers: Map<string, AudioBuffer>, t0: number, render = false) {
    this.stopSources();
    this.render = render;
    this.anchorT = t0;
    this.anchorCtx = render ? 0 : this.ctx.currentTime + 0.06;
    this.playing = true;
    this.applyAll(s);
    s.channels.forEach((ch, i) => {
      for (const r of ch.regions) this.scheduleRegion(this.nodes[i], r, buffers.get(r.item), t0);
    });
  }

  private scheduleRegion(n: ChannelNodes, r: Region, b: AudioBuffer | undefined, t0: number) {
    if (!b) return;
    const end = regionEnd(r);
    if (end <= t0) return;
    const startAt = Math.max(r.start, t0);
    const offset = r.offset + (startAt - r.start);
    const dur = Math.min(end - startAt, b.duration - offset);
    if (dur <= 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const g = this.ctx.createGain();
    const gainAt = (t: number) => {
      let v = r.gain;
      if (r.fadeIn > 0 && t < r.start + r.fadeIn) v *= Math.max(0, (t - r.start) / r.fadeIn);
      if (r.fadeOut > 0 && t > end - r.fadeOut) v *= Math.max(0, (end - t) / r.fadeOut);
      return v;
    };
    const when = this.at(startAt);
    g.gain.setValueAtTime(gainAt(startAt), when);
    if (r.fadeIn > 0 && startAt < r.start + r.fadeIn) g.gain.linearRampToValueAtTime(r.gain, this.at(r.start + r.fadeIn));
    if (r.fadeOut > 0) {
      if (end - r.fadeOut > startAt) g.gain.setValueAtTime(r.gain, this.at(end - r.fadeOut));
      g.gain.linearRampToValueAtTime(0, this.at(end));
    }
    src.connect(g);
    g.connect(n.input);
    src.start(when, offset, dur);
    src.onended = () => {
      try {
        g.disconnect();
      } catch {
        /* already gone */
      }
    };
    this.sources.push(src);
  }

  stop(s: Session, at?: number) {
    const t = at ?? this.time;
    this.stopSources();
    this.playing = false;
    this.anchorT = t;
    this.applyAll(s);
  }

  seek(t: number) {
    this.anchorT = Math.max(0, t);
  }

  /** level of one channel right now, 0..1+ */
  level(i: number | 'master'): number {
    const an = i === 'master' ? this.masterMeter : this.nodes[i].meter;
    an.getFloatTimeDomainData(this.buf);
    let peak = 0;
    for (let k = 0; k < this.buf.length; k++) {
      const v = Math.abs(this.buf[k]);
      if (v > peak) peak = v;
    }
    return peak;
  }
}

/* ------------------------------------------------------------------ */
/* Mixdown                                                             */
/* ------------------------------------------------------------------ */

export function encodeWav(buffer: AudioBuffer): Blob {
  const chs = Math.min(2, buffer.numberOfChannels);
  const len = buffer.length;
  const bytes = 44 + len * 2 * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const w = (o: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(o + i, str.charCodeAt(i));
  };
  w(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  w(36, 'data');
  view.setUint32(40, len * 4, true);
  const l = buffer.getChannelData(0);
  const r = chs > 1 ? buffer.getChannelData(1) : l;
  let o = 44;
  for (let i = 0; i < len; i++) {
    view.setInt16(o, Math.round(clamp(l[i], -1, 1) * 32767), true);
    view.setInt16(o + 2, Math.round(clamp(r[i], -1, 1) * 32767), true);
    o += 4;
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

export async function renderMixdown(s: Session, buffers: Map<string, AudioBuffer>, rate = 44100): Promise<{ blob: Blob; seconds: number; peak: number }> {
  const tail = s.channels.some((c) => c.reverb > 0) ? 2.4 : 0.4; // room for the echo to fade
  const seconds = sessionEnd(s) + tail;
  if (seconds > MAX_SECONDS) throw new Error('too long');
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const engine = new MixEngine(ctx);
  engine.play(s, buffers, 0, true);
  const out = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
  }
  return { blob: encodeWav(out), seconds: out.duration, peak };
}

/* ------------------------------------------------------------------ */
/* Waking the phone's audio                                            */
/* ------------------------------------------------------------------ */

let silentEl: HTMLAudioElement | null = null;

/**
 * iPhones keep Web Audio asleep until a tap, and older ones also mute it when the side switch is on silent.
 * Call this from a tap. It sets the "playback" audio session, plays a silent blip, and loops a silent
 * audio tag, which is the trick that makes older iPhones treat the page like a music player.
 */
export async function wakeAudio(ctx: AudioContext): Promise<void> {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    /* not on this browser */
  }
  const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
  try {
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, 22050);
    s.connect(ctx.destination);
    s.start(0);
  } catch {
    /* fine */
  }
  try {
    if (!silentEl && typeof Audio !== 'undefined') {
      const n = 800;
      const view = new DataView(new ArrayBuffer(44 + n));
      const w = (o: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(o + i, str.charCodeAt(i));
      };
      w(0, 'RIFF');
      view.setUint32(4, 36 + n, true);
      w(8, 'WAVE');
      w(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true);
      view.setUint32(28, 8000, true);
      view.setUint16(32, 1, true);
      view.setUint16(34, 8, true);
      w(36, 'data');
      view.setUint32(40, n, true);
      for (let i = 0; i < n; i++) view.setUint8(44 + i, 128);
      const el = new Audio(URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' })));
      el.loop = true;
      el.setAttribute('playsinline', '');
      silentEl = el;
    }
    if (silentEl && silentEl.paused) void silentEl.play().catch(() => undefined);
  } catch {
    /* fine */
  }
  await resumed;
}


/* ------------------------------------------------------------------ */
/* Generate: turn everything in the project into one finished song     */
/* ------------------------------------------------------------------ */

function placeLibraryItem(s: Session, item: LibItem, buf: AudioBuffer): Session {
  let idx = s.channels.findIndex((c) => c.regions.length === 0);
  if (idx < 0) idx = CHANNELS - 1;
  const start = s.channels[idx].regions.length > 0 ? Math.max(...s.channels[idx].regions.map(regionEnd)) : 0;
  const region: Region = { id: newId(), item: item.id, name: item.name, start, offset: 0, length: buf.duration, gain: 1, fadeIn: 0, fadeOut: 0 };
  return {
    ...s,
    channels: s.channels.map((c, k) =>
      k === idx ? { ...c, name: /^Ch \d+$/.test(c.name) ? item.name.slice(0, 10) : c.name, regions: [...c.regions, region] } : c,
    ),
  };
}

export type SongResult =
  | { ok: true; blob: Blob; seconds: number; peak: number; parts: number }
  | { ok: false; reason: 'empty' | 'long' | 'silent' | 'failed' };

/**
 * Mix every sound saved for this project (new ones are put on free channels, like the mixer does)
 * into one stereo WAV, using the same fader, pan and automation settings as the mixer.
 */
export async function generateSong(mode: string): Promise<SongResult> {
  try {
    let s = loadSession(mode);
    const lib = readLibrary(mode);
    const Off =
      window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    const dctx = new Off(2, 1, 44100);
    const bufs = new Map<string, AudioBuffer>();
    const load = async (id: string): Promise<AudioBuffer | null> => {
      const have = bufs.get(id);
      if (have) return have;
      const blob = await getBlob(id);
      if (!blob) return null;
      try {
        const b = await decodeBlob(dctx, blob);
        if (b.duration > MAX_SECONDS) return null;
        bufs.set(id, b);
        return b;
      } catch {
        return null;
      }
    };
    const seen = new Set(s.seen);
    for (const it of lib) {
      if (seen.has(it.id)) continue;
      const b = await load(it.id);
      if (!b) continue;
      s = placeLibraryItem(s, it, b);
      seen.add(it.id);
    }
    s = { ...s, seen: [...seen] };
    // keep only regions whose sound we could open
    let parts = 0;
    for (const c of s.channels) {
      for (const r of c.regions) {
        if (await load(r.item)) parts++;
      }
    }
    if (parts === 0) return { ok: false, reason: 'empty' };
    if (sessionEnd(s) + 2.4 > MAX_SECONDS) return { ok: false, reason: 'long' };
    saveSession(mode, s);
    const out = await renderMixdown(s, bufs);
    if (out.peak < 0.001) return { ok: false, reason: 'silent' };
    try {
      await putBlob(`song-${mode}`, out.blob);
    } catch {
      /* the song still plays and can be saved from the next screen */
    }
    return { ok: true, blob: out.blob, seconds: out.seconds, peak: out.peak, parts };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Turn a stored sound into an AudioBuffer. */
export async function decodeBlob(ctx: BaseAudioContext, blob: Blob): Promise<AudioBuffer> {
  const data = await blob.arrayBuffer();
  return await new Promise<AudioBuffer>((resolve, reject) => {
    // older Safari only understands the callback form
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && typeof p.catch === 'function') p.then(resolve, reject);
  });
}

/* ------------------------------------------------------------------ */
/* Showing time                                                        */
/* ------------------------------------------------------------------ */

export function fmtTime(t: number, fine = false): string {
  const ms = Math.round(Math.max(0, t) * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${fine ? String(rest).padStart(3, '0') : String(Math.floor(rest / 100))}`;
}
