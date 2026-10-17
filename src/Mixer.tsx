import { memo, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import {
  AUTO_MODES,
  CHANNELS,
  FADER_UNITY,
  MAX_SECONDS,
  MixEngine,
  buildPeaks,
  clampFades,
  dbLabel,
  decodeBlob,
  faderToDb,
  fmtTime,
  getBlob,
  loadSession,
  mergeAutomation,
  nearestZero,
  newId,
  readLibrary,
  regionEnd,
  renderMixdown,
  saveSession,
  saveToLibrary,
  sessionEnd,
  splitRegion,
  updateLibrarySeconds,
  valueAt,
} from './mixEngine';
import type { AudioClip, AutoMode, AutoPoint, AutoTarget, Channel, LibItem, Peaks, Region, Session } from './mixEngine';

/* ==================================================================== */
/* Mixing page: 24 channels, zoomable waveforms, automation              */
/* ==================================================================== */

const FOCUS = 'focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-white';
const BTN = `min-h-[48px] px-4 py-2 rounded-xl text-base font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-100 ${FOCUS}`;
const BTN_SM = `min-h-[44px] min-w-[44px] px-3 rounded-lg text-base font-bold bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-100 disabled:opacity-40 ${FOCUS}`;
const BTN_PRIMARY = `w-full min-h-[64px] px-6 py-4 rounded-2xl font-bold text-lg bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 text-white shadow-lg shadow-pink-500/25 ${FOCUS}`;

const LANE = 64;
const RULER = 30;
const MIN_PPS = 0.5;
const MAX_PPS = 200000;
const FADER_H = 190;
const CAP_H = 34;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const MODE_LABEL: Record<AutoMode, string> = { off: 'Off', read: 'Read', write: 'Write', touch: 'Touch', latch: 'Latch' };
const MODE_CLASS: Record<AutoMode, string> = {
  off: 'bg-slate-800 text-slate-300',
  read: 'bg-emerald-600 text-white',
  write: 'bg-red-600 text-white',
  touch: 'bg-amber-400 text-slate-950',
  latch: 'bg-orange-500 text-slate-950',
};
const MODE_HELP: Record<AutoMode, string> = {
  off: 'Off: the fader is just a fader.',
  read: 'Read: plays back what you recorded.',
  write: 'Write: records your fader moves the whole time you play.',
  touch: 'Touch: records only while your finger is on the fader.',
  latch: 'Latch: starts recording when you touch it and keeps going until you stop.',
};

const STEPS_MS = [1, 10, 100, 1000];

const readsAuto = (ch: Channel, pts: AutoPoint[]) => pts.length > 0 && (ch.mode === 'read' || ch.mode === 'touch' || ch.mode === 'latch');

/* ---------- small immutable helpers ---------- */

const withChannel = (s: Session, i: number, fn: (c: Channel) => Channel): Session => ({
  ...s,
  channels: s.channels.map((c, k) => (k === i ? fn(c) : c)),
});

const withRegion = (s: Session, i: number, id: string, fn: (r: Region) => Region): Session =>
  withChannel(s, i, (c) => ({ ...c, regions: c.regions.map((r) => (r.id === id ? fn({ ...r }) : r)) }));

function placeItem(s: Session, item: LibItem, buf: AudioBuffer, start: number, chIdx?: number): Session {
  let idx = chIdx ?? s.channels.findIndex((c) => c.regions.length === 0);
  if (idx < 0) idx = CHANNELS - 1;
  const region: Region = {
    id: newId(),
    item: item.id,
    name: item.name,
    start: chIdx === undefined && s.channels[idx].regions.length > 0 ? Math.max(...s.channels[idx].regions.map(regionEnd)) : start,
    offset: 0,
    length: buf.duration,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
  };
  return withChannel(s, idx, (c) => ({
    ...c,
    name: /^Ch \d+$/.test(c.name) ? item.name.slice(0, 10) : c.name,
    regions: [...c.regions, region],
  }));
}

function niceStep(pps: number): number {
  const steps = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const s of steps) if (s * pps >= 64) return s;
  return 600;
}

function spanLabel(sec: number): string {
  if (sec >= 60) return `${(sec / 60).toFixed(1)} min`;
  if (sec >= 1) return `${sec.toFixed(1)} s`;
  return `${Math.round(sec * 1000)} ms`;
}

/* ==================================================================== */
/* Fader (pointer driven so several can move at once)                    */
/* ==================================================================== */

interface FaderProps {
  value: number;
  onChange: (v: number, phase: 'down' | 'move' | 'up') => void;
  label: string;
  meterRef?: (el: HTMLDivElement | null) => void;
}

function Fader({ value, onChange, label, meterRef }: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const lastDown = useRef(0);
  const dragging = useRef(false);

  const valueAtY = (clientY: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return value;
    const usable = r.height - CAP_H;
    return clamp(1 - (clientY - r.top - CAP_H / 2) / usable, 0, 1);
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    dragging.current = true;
    const now = Date.now();
    const doubleTap = now - lastDown.current < 320;
    lastDown.current = now;
    onChange(doubleTap ? FADER_UNITY : valueAtY(e.clientY), 'down');
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) onChange(valueAtY(e.clientY), 'move');
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    onChange(valueAtY(e.clientY), 'up');
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp(value + step, 0, 1), 'move');
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp(value - step, 0, 1), 'move');
    else if (e.key === 'Home') onChange(FADER_UNITY, 'move');
    else return;
    e.preventDefault();
  };

  const top = (1 - value) * (FADER_H - CAP_H);
  return (
    <div className="flex items-stretch justify-center gap-1.5" style={{ height: FADER_H }}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={`${dbLabel(value)} dB`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        className={`relative w-11 shrink-0 touch-none select-none rounded-lg bg-slate-950 ${FOCUS}`}
        style={{ height: FADER_H }}
      >
        <div className="absolute left-1/2 top-2 bottom-2 w-1.5 -translate-x-1/2 rounded bg-slate-700" />
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 h-px bg-slate-500"
          style={{ top: CAP_H / 2 + (1 - FADER_UNITY) * (FADER_H - CAP_H) }}
        />
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 rounded-md border border-slate-400 bg-gradient-to-b from-slate-300 to-slate-500 shadow"
          style={{ top, height: CAP_H }}
        >
          <div className="mx-auto mt-[15px] h-0.5 w-7 bg-slate-900" />
        </div>
      </div>
      <div aria-hidden="true" className="relative w-2.5 shrink-0 overflow-hidden rounded bg-slate-950">
        <div
          ref={meterRef}
          className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-emerald-500 via-emerald-400 to-amber-400"
          style={{ height: '0%' }}
        />
      </div>
    </div>
  );
}

/* ==================================================================== */
/* One channel strip                                                     */
/* ==================================================================== */

interface StripProps {
  i: number;
  name: string;
  color: string;
  vol: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  mode: AutoMode;
  hasAuto: boolean;
  hasSounds: boolean;
  selected: boolean;
  onControl: (i: number, target: AutoTarget, v: number, phase: 'down' | 'move' | 'up') => void;
  onName: (i: number, name: string) => void;
  onMode: (i: number) => void;
  onMute: (i: number) => void;
  onSolo: (i: number) => void;
  onSelect: (i: number) => void;
  regMeter: (i: number, el: HTMLDivElement | null) => void;
}

const Strip = memo(function Strip(p: StripProps) {
  const { i } = p;
  return (
    <div
      className={`flex w-[88px] shrink-0 flex-col items-stretch gap-2 rounded-xl border bg-slate-900 p-2 ${p.selected ? 'border-pink-500' : 'border-slate-800'}`}
      data-testid={`strip-${i}`}
    >
      <button
        type="button"
        onClick={() => p.onSelect(i)}
        className={`flex items-center justify-between rounded-md px-1.5 py-1 text-xs font-black text-slate-950 ${FOCUS}`}
        style={{ background: p.color }}
        aria-label={`Select channel ${i + 1}`}
      >
        <span>{i + 1}</span>
        <span aria-hidden="true">{p.hasSounds ? '●' : '○'}</span>
      </button>
      <input
        value={p.name}
        maxLength={10}
        onChange={(e) => p.onName(i, e.target.value)}
        aria-label={`Name of channel ${i + 1}`}
        className={`min-h-[40px] w-full rounded-md border border-slate-700 bg-slate-950 px-1.5 text-center text-sm font-bold text-slate-100 ${FOCUS}`}
      />
      <button
        type="button"
        onClick={() => p.onMode(i)}
        aria-label={`Automation for channel ${i + 1}: ${MODE_LABEL[p.mode]}. Tap to change.`}
        className={`min-h-[44px] rounded-md text-sm font-black ${MODE_CLASS[p.mode]} ${FOCUS}`}
      >
        {MODE_LABEL[p.mode]}
        {p.hasAuto ? ' ◆' : ''}
      </button>
      <div className="space-y-1">
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={p.pan}
          aria-label={`Pan of channel ${i + 1}`}
          onChange={(e) => p.onControl(i, 'pan', Number(e.target.value), 'move')}
          onPointerDown={(e) => p.onControl(i, 'pan', Number((e.currentTarget as HTMLInputElement).value), 'down')}
          onPointerUp={(e) => p.onControl(i, 'pan', Number((e.currentTarget as HTMLInputElement).value), 'up')}
          onPointerCancel={(e) => p.onControl(i, 'pan', Number((e.currentTarget as HTMLInputElement).value), 'up')}
          onDoubleClick={() => p.onControl(i, 'pan', 0, 'move')}
          className="h-9 w-full accent-sky-400"
        />
        <p className="text-center text-[11px] font-bold text-slate-400">
          {Math.abs(p.pan) < 0.02 ? 'Center' : p.pan < 0 ? `L ${Math.round(-p.pan * 100)}` : `R ${Math.round(p.pan * 100)}`}
        </p>
      </div>
      <Fader value={p.vol} label={`Volume of channel ${i + 1}`} onChange={(v, ph) => p.onControl(i, 'vol', v, ph)} meterRef={(el) => p.regMeter(i, el)} />
      <p className="text-center text-sm font-black tabular-nums text-slate-100">{dbLabel(p.vol)} dB</p>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          aria-pressed={p.mute}
          onClick={() => p.onMute(i)}
          aria-label={`Mute channel ${i + 1}`}
          className={`min-h-[44px] rounded-md text-base font-black ${p.mute ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300'} ${FOCUS}`}
        >
          M
        </button>
        <button
          type="button"
          aria-pressed={p.solo}
          onClick={() => p.onSolo(i)}
          aria-label={`Solo channel ${i + 1}`}
          className={`min-h-[44px] rounded-md text-base font-black ${p.solo ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300'} ${FOCUS}`}
        >
          S
        </button>
      </div>
    </div>
  );
});

/* ==================================================================== */
/* The page                                                              */
/* ==================================================================== */

interface Props {
  mode: string;
  modeLabel: string;
  onHome: () => void;
  onAdd: (clip: AudioClip) => void;
}

interface Writer {
  i: number;
  target: AutoTarget;
  startT: number;
  pts: AutoPoint[];
}

type Gesture =
  | { type: 'scrub' }
  | { type: 'pan'; x0: number; t0: number }
  | { type: 'pinch'; d0: number; pps0: number; tMid: number }
  | { type: 'move'; ch: number; id: string; grab: number; base: Session; moved: boolean }
  | { type: 'trimS' | 'trimE'; ch: number; id: string; base: Session; moved: boolean };

export default function Mixer({ mode, modeLabel, onHome, onAdd }: Props) {
  const [S, setSState] = useState<Session>(() => loadSession(mode));
  const SRef = useRef(S);
  const setS = (next: Session) => {
    SRef.current = next;
    setSState(next);
  };
  const history = useRef<Session[]>([]);
  const future = useRef<Session[]>([]);
  const [, setHistVer] = useState(0);

  const [tab, setTab] = useState<'edit' | 'mix'>('edit');
  const [tool, setTool] = useState<'move' | 'trim' | 'cursor'>('move');
  const [snapZero, setSnapZero] = useState(true);
  const [stepMs, setStepMs] = useState(10);
  const [autoShow, setAutoShow] = useState<'vol' | 'pan' | 'none'>('vol');
  const [follow, setFollow] = useState(true);
  const [selCh, setSelCh] = useState(0);
  const [selRegion, setSelRegion] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [width, setWidth] = useState(340);
  const [view, setViewState] = useState({ t0: 0, pps: 40 });
  const [panel, setPanel] = useState<'' | 'add' | 'mix' | 'help'>('');
  const [library, setLibrary] = useState<LibItem[]>(() => readLibrary(mode));
  const [bufVer, setBufVer] = useState(0);
  const [loading, setLoading] = useState('');
  const [missing, setMissing] = useState(0);
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [mixdown, setMixdown] = useState<{ url: string; seconds: number; peak: number; blob: Blob } | null>(null);
  const [mixAdded, setMixAdded] = useState(false);
  const [engineError, setEngineError] = useState('');

  const followRef = useRef(follow);
  followRef.current = follow;
  const widthRef = useRef(width);
  widthRef.current = width;
  const viewRef = useRef(view);
  const setView = (v: { t0: number; pps: number }) => {
    const next = { pps: clamp(v.pps, MIN_PPS, MAX_PPS), t0: Math.max(0, v.t0) };
    viewRef.current = next;
    setViewState(next);
  };
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const engineRef = useRef<MixEngine | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const peaks = useRef(new Map<string, Peaks>());
  const writers = useRef(new Map<string, Writer>());
  const meterEls = useRef<Array<HTMLDivElement | null>>(Array(CHANNELS + 1).fill(null));
  const meterLevel = useRef<number[]>(Array(CHANNELS + 1).fill(0));
  const rafRef = useRef(0);
  const lastUi = useRef(0);
  const prevSession = useRef<Session>(S);
  const areaRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const mixUrl = useRef<string | null>(null);

  /* ---------- engine ---------- */
  const getEngine = (): MixEngine | null => {
    if (engineRef.current) return engineRef.current;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
      const eng = new MixEngine(ctx);
      eng.applyAll(SRef.current);
      engineRef.current = eng;
      return eng;
    } catch {
      setEngineError('This phone could not start the sound. Try Safari or Chrome.');
      return null;
    }
  };

  /* ---------- history ---------- */
  const pushHistory = (prev: Session) => {
    history.current.push(prev);
    if (history.current.length > 60) history.current.shift();
    future.current = [];
    setHistVer((v) => v + 1);
  };
  const edit = (fn: (s: Session) => Session) => {
    const prev = SRef.current;
    const next = fn(prev);
    if (next === prev) return;
    pushHistory(prev);
    setS(next);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(SRef.current);
    setS(prev);
    setHistVer((v) => v + 1);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(SRef.current);
    setS(next);
    setHistVer((v) => v + 1);
  };

  /* ---------- loading sounds ---------- */
  const loadItem = async (id: string): Promise<AudioBuffer | null> => {
    const have = buffers.current.get(id);
    if (have) return have;
    const eng = getEngine();
    if (!eng) return null;
    const blob = await getBlob(id);
    if (!blob) return null;
    try {
      const b = await decodeBlob(eng.ctx, blob);
      if (b.duration > MAX_SECONDS) return null;
      buffers.current.set(id, b);
      peaks.current.set(id, buildPeaks(b));
      setBufVer((v) => v + 1);
      return b;
    } catch {
      return null;
    }
  };

  const fitView = (s: Session = SRef.current, w = width) => {
    const span = Math.max(6, sessionEnd(s) * 1.04);
    setView({ t0: 0, pps: (w - 4) / span });
  };

  useEffect(() => {
    let dead = false;
    void (async () => {
      const lib = readLibrary(mode);
      setLibrary(lib);
      const cur = SRef.current;
      const wanted = new Set<string>([
        ...cur.channels.flatMap((c) => c.regions.map((r) => r.item)),
        ...lib.filter((i) => !cur.seen.includes(i.id)).map((i) => i.id),
      ]);
      if (wanted.size > 0) setLoading('Loading your sounds…');
      let bad = 0;
      for (const id of wanted) {
        const b = await loadItem(id);
        if (dead) return;
        if (!b) bad++;
      }
      let next = SRef.current;
      const seen = [...next.seen];
      for (const item of lib) {
        if (seen.includes(item.id)) continue;
        seen.push(item.id);
        const b = buffers.current.get(item.id);
        if (b) next = placeItem(next, item, b, 0);
      }
      if (next !== SRef.current || seen.length !== SRef.current.seen.length) setS({ ...next, seen });
      setMissing(bad);
      setLoading('');
      fitView(SRef.current);
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- keep the audio engine in step with the session ---------- */
  useEffect(() => {
    const eng = engineRef.current;
    const prev = prevSession.current;
    prevSession.current = S;
    if (!eng || prev === S) return;
    const muteSoloChanged = S.channels.some((c, i) => c.mute !== prev.channels[i].mute || c.solo !== prev.channels[i].solo);
    if (muteSoloChanged) {
      eng.applyAll(S);
    } else {
      S.channels.forEach((c, i) => {
        const p = prev.channels[i];
        if (c !== p && (c.vol !== p.vol || c.pan !== p.pan || c.mode !== p.mode || c.autoVol !== p.autoVol || c.autoPan !== p.autoPan)) eng.applyChannel(S, i);
      });
      if (S.master !== prev.master) eng.applyAll(S);
    }
    const regionsChanged = S.channels.some((c, i) => c.regions !== prev.channels[i].regions);
    if (regionsChanged && eng.playing) eng.play(S, buffers.current, eng.time);
  }, [S]);

  /* ---------- remember the mix ---------- */
  useEffect(() => {
    const t = window.setTimeout(() => saveSession(mode, S), 400);
    return () => window.clearTimeout(t);
  }, [S, mode]);
  useEffect(
    () => () => {
      saveSession(mode, SRef.current);
    },
    [mode],
  );

  /* ---------- size ---------- */
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);

  /* ---------- transport ---------- */
  const beginWrite = (i: number, target: AutoTarget, t: number) => {
    const key = `${i}:${target}`;
    if (writers.current.has(key)) return;
    const ch = SRef.current.channels[i];
    writers.current.set(key, { i, target, startT: t, pts: [{ t, v: target === 'vol' ? ch.vol : ch.pan }] });
    engineRef.current?.setWriting(i, target, true);
    engineRef.current?.applyChannel(SRef.current, i, target);
  };

  const endWrite = (key: string) => {
    const w = writers.current.get(key);
    const eng = engineRef.current;
    if (!w || !eng) return;
    writers.current.delete(key);
    const t = Math.max(w.startT, eng.time);
    const ch = SRef.current.channels[w.i];
    const last = w.target === 'vol' ? ch.vol : ch.pan;
    const written = [...w.pts, { t, v: last }];
    edit((s) =>
      withChannel(s, w.i, (c) =>
        w.target === 'vol'
          ? { ...c, autoVol: mergeAutomation(c.autoVol, w.startT, t, written, c.vol) }
          : { ...c, autoPan: mergeAutomation(c.autoPan, w.startT, t, written, c.pan) },
      ),
    );
    eng.setWriting(w.i, w.target, false);
    eng.applyChannel(SRef.current, w.i, w.target);
  };

  const startAt = (t: number) => {
    const eng = getEngine();
    if (!eng) return;
    timeRef.current = t;
    eng.play(SRef.current, buffers.current, t);
    playingRef.current = true;
    setPlaying(true);
    setMixdown(null);
    SRef.current.channels.forEach((c, i) => {
      if (c.mode === 'write') {
        beginWrite(i, 'vol', t);
        beginWrite(i, 'pan', t);
      }
    });
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  };

  const stopPlay = () => {
    const eng = engineRef.current;
    if (!eng) return;
    const t = eng.time;
    const wroteWriteMode = new Set<number>();
    for (const [key, w] of [...writers.current.entries()]) {
      if (SRef.current.channels[w.i].mode === 'write') wroteWriteMode.add(w.i);
      endWrite(key);
    }
    playingRef.current = false;
    cancelAnimationFrame(rafRef.current);
    eng.stop(SRef.current, t);
    timeRef.current = t;
    setTime(t);
    setPlaying(false);
    meterEls.current.forEach((el) => {
      if (el) el.style.height = '0%';
    });
    if (wroteWriteMode.size > 0) {
      // like a real board: after a Write pass go to Read so you cannot erase it by accident
      setS({ ...SRef.current, channels: SRef.current.channels.map((c, i) => (wroteWriteMode.has(i) ? { ...c, mode: 'read' as AutoMode } : c)) });
      setStatus('Your fader moves are saved. Those channels are now on Read, so press Play to hear them.');
    }
  };

  const togglePlay = async () => {
    const eng = getEngine();
    if (!eng) return;
    if (playingRef.current) {
      stopPlay();
      return;
    }
    try {
      await (eng.ctx as AudioContext).resume();
    } catch {
      /* some browsers throw if already running */
    }
    setStatus('');
    startAt(timeRef.current);
  };

  const setPlayhead = (t: number) => {
    const tt = Math.max(0, t);
    timeRef.current = tt;
    setTime(tt);
    const eng = engineRef.current;
    if (eng) {
      if (playingRef.current) {
        for (const key of [...writers.current.keys()]) endWrite(key);
        startAt(tt);
      } else {
        eng.stop(SRef.current, tt);
      }
    }
  };

  const loop = () => {
    const eng = engineRef.current;
    if (!eng || !playingRef.current) return;
    const t = eng.time;
    timeRef.current = t;
    writers.current.forEach((w) => {
      const ch = SRef.current.channels[w.i];
      const v = w.target === 'vol' ? ch.vol : ch.pan;
      const last = w.pts[w.pts.length - 1];
      if ((!last || Math.abs(last.v - v) > 0.002 || t - last.t > 0.25) && w.pts.length < 6000) w.pts.push({ t, v });
    });
    // meters go straight to the screen without a React render
    for (let k = 0; k <= CHANNELS; k++) {
      const el = meterEls.current[k];
      if (!el) continue;
      const lv = eng.level(k === CHANNELS ? 'master' : k);
      const db = lv > 0.00001 ? 20 * Math.log10(lv) : -90;
      const pct = clamp((db + 60) / 63, 0, 1);
      const held = Math.max(pct, meterLevel.current[k] - 0.04);
      meterLevel.current[k] = held;
      el.style.height = `${Math.round(held * 100)}%`;
    }
    const now = performance.now();
    if (now - lastUi.current > 33) {
      lastUi.current = now;
      setTime(t);
      const v = viewRef.current;
      const x = (t - v.t0) * v.pps;
      if (followRef.current && (x > widthRef.current * 0.9 || x < 0)) setView({ ...v, t0: Math.max(0, t - (widthRef.current * 0.12) / v.pps) });
    }
    const end = sessionEnd(SRef.current);
    if (end > 0 && t > end + 0.6) {
      stopPlay();
      return;
    }
    rafRef.current = requestAnimationFrame(loop);
  };

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      const eng = engineRef.current;
      engineRef.current = null;
      if (eng) {
        try {
          eng.stop(SRef.current);
          void (eng.ctx as AudioContext).close();
        } catch {
          /* already closed */
        }
      }
      if (mixUrl.current) URL.revokeObjectURL(mixUrl.current);
    },
    [],
  );

  /* ---------- faders, pan, mute, solo ---------- */
  const onControl = (i: number, target: AutoTarget, v: number, phase: 'down' | 'move' | 'up') => {
    const cur = SRef.current;
    const ch = cur.channels[i];
    if (phase !== 'up') setS(withChannel(cur, i, (c) => (target === 'vol' ? { ...c, vol: v } : { ...c, pan: v })));
    if (!playingRef.current) return;
    if ((ch.mode === 'touch' || ch.mode === 'latch') && phase === 'down') beginWrite(i, target, timeRef.current);
    if (ch.mode === 'touch' && phase === 'up') endWrite(`${i}:${target}`);
  };

  const onName = (i: number, name: string) => setS(withChannel(SRef.current, i, (c) => ({ ...c, name })));
  const onMode = (i: number) => {
    const cur = SRef.current.channels[i].mode;
    const next = AUTO_MODES[(AUTO_MODES.indexOf(cur) + 1) % AUTO_MODES.length];
    setMode(i, next);
  };
  const setMode = (i: number, next: AutoMode) => {
    if (playingRef.current) {
      // leaving a writing mode mid-play saves what was written so far
      for (const key of [`${i}:vol`, `${i}:pan`]) if (writers.current.has(key)) endWrite(key);
    }
    edit((s) => withChannel(s, i, (c) => ({ ...c, mode: next })));
    if (playingRef.current && next === 'write') {
      beginWrite(i, 'vol', timeRef.current);
      beginWrite(i, 'pan', timeRef.current);
    }
  };
  const onMute = (i: number) => setS(withChannel(SRef.current, i, (c) => ({ ...c, mute: !c.mute })));
  const onSolo = (i: number) => setS(withChannel(SRef.current, i, (c) => ({ ...c, solo: !c.solo })));
  const onSelect = (i: number) => {
    setSelCh(i);
    setSelRegion(null);
  };
  const regMeter = (i: number, el: HTMLDivElement | null) => {
    meterEls.current[i] = el;
  };

  /* ---------- timeline picture ---------- */
  const xOf = (t: number, v = view) => (t - v.t0) * v.pps;
  const tOf = (x: number, v = view) => v.t0 + x / v.pps;

  const drawBase = () => {
    const cv = baseRef.current;
    if (!cv) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const h = RULER + CHANNELS * LANE;
    if (cv.width !== Math.floor(width * dpr) || cv.height !== Math.floor(h * dpr)) {
      cv.width = Math.floor(width * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, h);
    g.fillStyle = '#020617';
    g.fillRect(0, 0, width, h);

    // ruler
    const step = niceStep(view.pps);
    g.fillStyle = '#0f172a';
    g.fillRect(0, 0, width, RULER);
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    const first = Math.floor(view.t0 / step) * step;
    for (let t = first; t <= view.t0 + width / view.pps + step; t += step) {
      const x = Math.round(xOf(t)) + 0.5;
      g.strokeStyle = '#334155';
      g.beginPath();
      g.moveTo(x, RULER - 10);
      g.lineTo(x, RULER);
      g.stroke();
      g.strokeStyle = 'rgba(51,65,85,0.45)';
      g.beginPath();
      g.moveTo(x, RULER);
      g.lineTo(x, h);
      g.stroke();
      g.fillStyle = '#94a3b8';
      g.fillText(step < 1 ? `${t.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)}s` : fmtTime(t), x + 3, 10);
    }

    const sess = SRef.current;
    for (let i = 0; i < CHANNELS; i++) {
      const y = RULER + i * LANE;
      const ch = sess.channels[i];
      g.fillStyle = i === selCh ? 'rgba(236,72,153,0.07)' : i % 2 ? 'rgba(15,23,42,0.6)' : 'rgba(2,6,23,0)';
      g.fillRect(0, y, width, LANE);
      g.strokeStyle = '#1e293b';
      g.beginPath();
      g.moveTo(0, y + LANE - 0.5);
      g.lineTo(width, y + LANE - 0.5);
      g.stroke();
      for (const r of ch.regions) {
        const x0 = xOf(r.start);
        const x1 = xOf(regionEnd(r));
        if (x1 < 0 || x0 > width) continue;
        const sel = r.id === selRegion;
        g.fillStyle = `${ch.color}${sel ? '40' : '22'}`;
        g.fillRect(x0, y + 2, x1 - x0, LANE - 4);
        drawWave(g, r, ch.color, x0, x1, y);
        g.strokeStyle = sel ? '#ffffff' : ch.color;
        g.lineWidth = sel ? 2 : 1;
        g.strokeRect(x0 + 0.5, y + 2.5, Math.max(1, x1 - x0 - 1), LANE - 5);
        g.lineWidth = 1;
        // fades
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        if (r.fadeIn > 0) {
          g.beginPath();
          g.moveTo(x0, y + LANE - 3);
          g.lineTo(xOf(r.start + r.fadeIn), y + 3);
          g.stroke();
        }
        if (r.fadeOut > 0) {
          g.beginPath();
          g.moveTo(xOf(regionEnd(r) - r.fadeOut), y + 3);
          g.lineTo(x1, y + LANE - 3);
          g.stroke();
        }
        if (x1 - x0 > 40) {
          g.fillStyle = '#e2e8f0';
          g.font = '10px system-ui, sans-serif';
          g.textBaseline = 'top';
          g.fillText(r.name.slice(0, 24), Math.max(x0, 0) + 4, y + 4);
        }
      }
      // automation line
      if (autoShow !== 'none') {
        const pts = autoShow === 'vol' ? ch.autoVol : ch.autoPan;
        if (pts.length > 0) {
          g.strokeStyle = '#fde047';
          g.lineWidth = 1.5;
          g.beginPath();
          const toY = (v: number) => (autoShow === 'vol' ? y + 6 + (1 - v) * (LANE - 12) : y + 6 + (1 - (v + 1) / 2) * (LANE - 12));
          let started = false;
          const startX = clamp(xOf(pts[0].t), -2000, width + 2000);
          g.moveTo(Math.min(0, startX), toY(pts[0].v));
          for (const p of pts) {
            const px = xOf(p.t);
            if (px < -2000 || px > width + 2000) {
              started = true;
              continue;
            }
            g.lineTo(px, toY(p.v));
            started = true;
          }
          const lastP = pts[pts.length - 1];
          g.lineTo(Math.max(width, xOf(lastP.t)), toY(lastP.v));
          if (started) g.stroke();
          g.lineWidth = 1;
          if (pts.length < 400) {
            g.fillStyle = '#fde047';
            for (const p of pts) {
              const px = xOf(p.t);
              if (px >= 0 && px <= width) g.fillRect(px - 2, toY(p.v) - 2, 4, 4);
            }
          }
        }
      }
    }
  };

  function drawWave(g: CanvasRenderingContext2D, r: Region, color: string, x0: number, x1: number, y: number) {
    const buf = buffers.current.get(r.item);
    const pk = peaks.current.get(r.item);
    if (!buf || !pk) return;
    const mid = y + LANE / 2;
    const half = LANE / 2 - 5;
    const sampleRate = buf.sampleRate;
    const sppCol = sampleRate / view.pps; // samples per screen pixel
    const from = Math.max(0, Math.floor(x0));
    const to = Math.min(width, Math.ceil(x1));
    g.fillStyle = color;
    g.strokeStyle = color;
    const gain = r.gain;
    if (sppCol < 2) {
      // zoomed right in: draw the real samples joined by a line
      const data = buf.getChannelData(0);
      g.beginPath();
      let moved = false;
      for (let x = from; x <= to; x++) {
        const t = tOf(x) - r.start + r.offset;
        const idx = Math.round(t * sampleRate);
        if (idx < 0 || idx >= data.length) continue;
        const py = mid - clamp(data[idx] * gain, -1, 1) * half;
        if (!moved) {
          g.moveTo(x, py);
          moved = true;
        } else g.lineTo(x, py);
      }
      g.stroke();
      if (view.pps / sampleRate > 5) {
        for (let k = Math.floor((tOf(from) - r.start + r.offset) * sampleRate); k <= Math.ceil((tOf(to) - r.start + r.offset) * sampleRate); k++) {
          if (k < 0 || k >= data.length) continue;
          const px = xOf(r.start - r.offset + k / sampleRate);
          g.fillRect(px - 2, mid - clamp(data[k] * gain, -1, 1) * half - 2, 4, 4);
        }
      }
      return;
    }
    let level = pk.levels[0];
    for (const l of pk.levels) if (l.spp <= sppCol) level = l;
    const data0 = sppCol < 64 ? buf.getChannelData(0) : null;
    const data1 = sppCol < 64 && buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    for (let x = from; x < to; x++) {
      const a = (tOf(x) - r.start + r.offset) * sampleRate;
      const b = a + sppCol;
      let lo = 1;
      let hi = -1;
      if (data0) {
        const i0 = Math.max(0, Math.floor(a));
        const i1 = Math.min(data0.length - 1, Math.max(i0, Math.floor(b)));
        for (let k = i0; k <= i1; k++) {
          const v = data0[k];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          if (data1) {
            const w = data1[k];
            if (w < lo) lo = w;
            if (w > hi) hi = w;
          }
        }
      } else {
        const i0 = Math.max(0, Math.floor(a / level.spp));
        const i1 = Math.min(level.min.length - 1, Math.max(i0, Math.floor(b / level.spp)));
        for (let k = i0; k <= i1; k++) {
          if (level.min[k] < lo) lo = level.min[k];
          if (level.max[k] > hi) hi = level.max[k];
        }
      }
      if (hi < lo) continue;
      const top = mid - clamp(hi * gain, -1, 1) * half;
      const bottom = mid - clamp(lo * gain, -1, 1) * half;
      g.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }

  const drawOverlay = () => {
    const cv = overRef.current;
    if (!cv) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const h = RULER + CHANNELS * LANE;
    if (cv.width !== Math.floor(width * dpr) || cv.height !== Math.floor(h * dpr)) {
      cv.width = Math.floor(width * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, h);
    const x = xOf(timeRef.current);
    if (x >= -2 && x <= width + 2) {
      g.strokeStyle = '#ef4444';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.fillStyle = '#ef4444';
      g.beginPath();
      g.moveTo(x - 6, 0);
      g.lineTo(x + 6, 0);
      g.lineTo(x, 9);
      g.closePath();
      g.fill();
    }
  };

  useEffect(() => {
    if (tab === 'edit') drawBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S, view, width, bufVer, selCh, selRegion, autoShow, tab]);
  useEffect(() => {
    if (tab === 'edit') drawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, view, width, tab]);

  /* ---------- touching the timeline ---------- */
  const local = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = areaRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const snapTime = (t: number, skip: string) => {
    const tol = 8 / viewRef.current.pps;
    let best = t;
    let bestD = tol;
    const cands = [0, timeRef.current];
    for (const c of SRef.current.channels) for (const r of c.regions) if (r.id !== skip) cands.push(r.start, regionEnd(r));
    for (const c of cands) {
      const d = Math.abs(c - t);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  const mutRegion = (ch: number, id: string, fn: (r: Region) => void) => {
    setS(
      withRegion(SRef.current, ch, id, (r) => {
        fn(r);
        clampFades(r);
        return r;
      }),
    );
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    const p = local(e);
    ptrs.current.set(e.pointerId, p);
    const v = viewRef.current;
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      gesture.current = { type: 'pinch', d0: Math.max(24, Math.abs(a.x - b.x)), pps0: v.pps, tMid: tOf((a.x + b.x) / 2, v) };
      return;
    }
    if (ptrs.current.size > 2) return;
    const lane = Math.floor((p.y - RULER) / LANE);
    const t = tOf(p.x, v);
    if (lane < 0) {
      gesture.current = { type: 'scrub' };
      setPlayhead(t);
      return;
    }
    if (lane >= CHANNELS) return;
    setSelCh(lane);
    const ch = SRef.current.channels[lane];
    const hit = ch.regions.find((r) => t >= r.start && t <= regionEnd(r));
    if (tool === 'cursor') {
      setSelRegion(hit?.id ?? null);
      gesture.current = { type: 'scrub' };
      setPlayhead(t);
      return;
    }
    if (tool === 'trim') {
      let best: { id: string; type: 'trimS' | 'trimE'; d: number } | null = null;
      for (const r of ch.regions) {
        const dS = Math.abs(p.x - xOf(r.start, v));
        const dE = Math.abs(p.x - xOf(regionEnd(r), v));
        if (dS < 28 && (!best || dS < best.d)) best = { id: r.id, type: 'trimS', d: dS };
        if (dE < 28 && (!best || dE < best.d)) best = { id: r.id, type: 'trimE', d: dE };
      }
      if (best) {
        setSelRegion(best.id);
        gesture.current = { type: best.type, ch: lane, id: best.id, base: SRef.current, moved: false };
        return;
      }
    }
    if (tool === 'move' && hit) {
      setSelRegion(hit.id);
      gesture.current = { type: 'move', ch: lane, id: hit.id, grab: t - hit.start, base: SRef.current, moved: false };
      return;
    }
    setSelRegion(hit?.id ?? null);
    gesture.current = { type: 'pan', x0: p.x, t0: v.t0 };
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const p = local(e);
    ptrs.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const v = viewRef.current;
    if (g.type === 'pinch') {
      if (ptrs.current.size < 2) return;
      const [a, b] = [...ptrs.current.values()];
      const d = Math.max(24, Math.abs(a.x - b.x));
      const mid = (a.x + b.x) / 2;
      const pps = clamp(g.pps0 * (d / g.d0), MIN_PPS, MAX_PPS);
      setView({ pps, t0: g.tMid - mid / pps });
      return;
    }
    if (ptrs.current.size > 1) return;
    if (g.type === 'scrub') {
      setPlayhead(tOf(p.x, v));
    } else if (g.type === 'pan') {
      setView({ pps: v.pps, t0: g.t0 - (p.x - g.x0) / v.pps });
    } else if (g.type === 'move') {
      const tNew = Math.max(0, snapTime(tOf(p.x, v) - g.grab, g.id));
      if (!g.moved) {
        g.moved = true;
        pushHistory(g.base);
      }
      mutRegion(g.ch, g.id, (r) => {
        r.start = tNew;
      });
    } else {
      const reg = SRef.current.channels[g.ch].regions.find((r) => r.id === g.id);
      const buf = reg ? buffers.current.get(reg.item) : undefined;
      if (!reg || !buf) return;
      let t = snapTime(tOf(p.x, v), g.id);
      if (g.type === 'trimS') {
        const minStart = reg.start - reg.offset;
        t = clamp(t, Math.max(0, minStart), regionEnd(reg) - 0.005);
        if (snapZero) {
          const z = nearestZero(buf, reg.offset + (t - reg.start), 0.004);
          t = clamp(reg.start + (z - reg.offset), Math.max(0, minStart), regionEnd(reg) - 0.005);
        }
        if (!g.moved) {
          g.moved = true;
          pushHistory(g.base);
        }
        const d = t - reg.start;
        mutRegion(g.ch, g.id, (r) => {
          r.start = t;
          r.offset += d;
          r.length -= d;
        });
      } else {
        const maxEnd = reg.start + (buf.duration - reg.offset);
        t = clamp(t, reg.start + 0.005, maxEnd);
        if (snapZero) {
          const z = nearestZero(buf, reg.offset + (t - reg.start), 0.004);
          t = clamp(reg.start + (z - reg.offset), reg.start + 0.005, maxEnd);
        }
        if (!g.moved) {
          g.moved = true;
          pushHistory(g.base);
        }
        mutRegion(g.ch, g.id, (r) => {
          r.length = t - r.start;
        });
      }
    }
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) gesture.current = null;
    else if (gesture.current?.type === 'pinch') gesture.current = null;
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
    const v = viewRef.current;
    const r = areaRef.current?.getBoundingClientRect();
    const x = e.clientX - (r?.left ?? 0);
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
      setView({ pps: v.pps, t0: v.t0 + e.deltaY / v.pps });
      return;
    }
    const pps = clamp(v.pps * Math.exp(-e.deltaY * 0.01), MIN_PPS, MAX_PPS);
    setView({ pps, t0: tOf(x, v) - x / pps });
  };

  /* ---------- zoom controls ---------- */
  const zoomTo = (pps: number, centreT = timeRef.current) => {
    const p = clamp(pps, MIN_PPS, MAX_PPS);
    setView({ pps: p, t0: centreT - width / 2 / p });
  };
  const zoomSlider = Math.log(view.pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS);
  const centreOfView = () => tOf(width / 2);
  const sampleRate = [...buffers.current.values()][0]?.sampleRate ?? 44100;

  /* ---------- editing the selected sound ---------- */
  const selected = (() => {
    if (!selRegion) return null;
    for (let i = 0; i < CHANNELS; i++) {
      const r = S.channels[i].regions.find((x) => x.id === selRegion);
      if (r) return { ch: i, r };
    }
    return null;
  })();

  const stepSec = stepMs / 1000;

  const doSplit = () => {
    const t0 = timeRef.current;
    const target = selected ?? (() => {
      const r = S.channels[selCh].regions.find((x) => t0 > x.start && t0 < regionEnd(x));
      return r ? { ch: selCh, r } : null;
    })();
    if (!target) {
      setStatus('Move the red line over a sound, then tap Split.');
      return;
    }
    let t = t0;
    const buf = buffers.current.get(target.r.item);
    if (snapZero && buf) {
      const z = nearestZero(buf, target.r.offset + (t - target.r.start), 0.01);
      t = target.r.start + (z - target.r.offset);
    }
    const parts = splitRegion(target.r, t);
    if (!parts) {
      setStatus('The red line must be inside the sound to split it.');
      return;
    }
    setStatus('');
    edit((s) => withChannel(s, target.ch, (c) => ({ ...c, regions: c.regions.flatMap((x) => (x.id === target.r.id ? parts : [x])) })));
    setSelRegion(parts[1].id);
  };

  const doDelete = () => {
    if (!selected) return;
    edit((s) => withChannel(s, selected.ch, (c) => ({ ...c, regions: c.regions.filter((x) => x.id !== selected.r.id) })));
    setSelRegion(null);
  };

  const doDuplicate = () => {
    if (!selected) return;
    const copy: Region = { ...selected.r, id: newId(), start: regionEnd(selected.r) };
    edit((s) => withChannel(s, selected.ch, (c) => ({ ...c, regions: [...c.regions, copy] })));
    setSelRegion(copy.id);
  };

  const editSel = (fn: (r: Region, buf: AudioBuffer | undefined) => void) => {
    if (!selected) return;
    const buf = buffers.current.get(selected.r.item);
    edit((s) =>
      withRegion(s, selected.ch, selected.r.id, (r) => {
        fn(r, buf);
        clampFades(r);
        return r;
      }),
    );
  };

  const nudgeMove = (dir: number) =>
    editSel((r) => {
      r.start = Math.max(0, r.start + dir * stepSec);
    });
  const nudgeTrimStart = (dir: number) =>
    editSel((r) => {
      const minStart = Math.max(0, r.start - r.offset);
      const ns = clamp(r.start + dir * stepSec, minStart, regionEnd(r) - 0.005);
      const d = ns - r.start;
      r.start = ns;
      r.offset += d;
      r.length -= d;
    });
  const nudgeTrimEnd = (dir: number) =>
    editSel((r, buf) => {
      const maxLen = buf ? buf.duration - r.offset : r.length + 60;
      r.length = clamp(r.length + dir * stepSec, 0.005, maxLen);
    });
  const nudgeFade = (which: 'fadeIn' | 'fadeOut', dir: number) =>
    editSel((r) => {
      r[which] = Math.max(0, r[which] + dir * Math.max(0.01, stepSec));
    });
  const nudgeGain = (dir: number) =>
    editSel((r) => {
      r.gain = clamp(r.gain * Math.pow(10, dir / 20), 0, 4);
    });
  const moveToChannel = (dir: number) => {
    if (!selected) return;
    const to = selected.ch + dir;
    if (to < 0 || to >= CHANNELS) return;
    edit((s) => {
      const without = withChannel(s, selected.ch, (c) => ({ ...c, regions: c.regions.filter((x) => x.id !== selected.r.id) }));
      return withChannel(without, to, (c) => ({ ...c, regions: [...c.regions, selected.r] }));
    });
    setSelCh(to);
  };

  /* ---------- adding sounds ---------- */
  const addFromLibrary = async (item: LibItem) => {
    const buf = await loadItem(item.id);
    if (!buf) {
      setStatus('That sound could not be opened.');
      return;
    }
    const t = timeRef.current;
    edit((s) => placeItem(s, item, buf, t, selCh));
    setStatus(`Added "${item.name}" to channel ${selCh + 1}.`);
    setPanel('');
  };

  const addFromPhone = async (file: File | undefined) => {
    if (!file) return;
    setStatus('Opening your file…');
    const item = await saveToLibrary(mode, {
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 42),
      type: 'audio',
      duration: 1,
      track: 'Audio',
      from: 'mixer-file',
      blob: file,
    });
    if (!item) {
      setStatus('That file could not be added.');
      return;
    }
    const buf = await loadItem(item.id);
    if (!buf) {
      setStatus('This phone could not open that file. Try an MP3, M4A or WAV.');
      return;
    }
    item.seconds = buf.duration;
    updateLibrarySeconds(mode, item.id, buf.duration);
    const t = timeRef.current;
    setLibrary(readLibrary(mode));
    edit((s) => ({ ...placeItem(s, item, buf, t, selCh), seen: [...s.seen, item.id] }));
    setStatus(`Added "${item.name}" to channel ${selCh + 1}.`);
    setPanel('');
  };

  /* ---------- mix down ---------- */
  const doMixdown = async () => {
    if (exporting) return;
    if (playingRef.current) stopPlay();
    setExporting(true);
    setStatus('Mixing your song…');
    try {
      const out = await renderMixdown(SRef.current, buffers.current);
      if (mixUrl.current) URL.revokeObjectURL(mixUrl.current);
      const url = URL.createObjectURL(out.blob);
      mixUrl.current = url;
      setMixdown({ url, seconds: out.seconds, peak: out.peak, blob: out.blob });
      setMixAdded(false);
      setStatus('');
    } catch {
      setStatus('Sorry, your phone could not mix that. Try a shorter song.');
    } finally {
      setExporting(false);
    }
  };

  const addMixdown = () => {
    if (!mixdown) return;
    onAdd({ name: 'My mix', type: 'audio', duration: mixdown.seconds, track: 'Mixdown', from: 'mixdown', blob: mixdown.blob });
    setMixAdded(true);
    setLibrary(readLibrary(mode));
  };

  /* ---------- derived ---------- */
  const anySounds = S.channels.some((c) => c.regions.length > 0);
  const selChan = S.channels[selCh];
  const span = width / view.pps;
  const shown = (c: Channel, target: AutoTarget) => {
    const pts = target === 'vol' ? c.autoVol : c.autoPan;
    const base = target === 'vol' ? c.vol : c.pan;
    return readsAuto(c, pts) ? valueAt(pts, time, base) : base;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            if (playingRef.current) stopPlay();
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

      {/* transport */}
      <div className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 px-3 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button type="button" aria-label="Go to the start" onClick={() => setPlayhead(0)} className={BTN_SM}>
            ⏮
          </button>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Stop' : 'Play'}
            className={`min-h-[52px] w-20 shrink-0 rounded-xl text-xl font-black ${FOCUS} ${playing ? 'bg-rose-600 text-white' : 'bg-emerald-500 text-slate-950'}`}
          >
            {playing ? '■' : '▶'}
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p data-testid="clock" className="text-2xl font-black tabular-nums leading-none">
              {fmtTime(time, true)}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">{playing && writers.current.size > 0 ? '● Recording your fader moves' : `Song length ${fmtTime(sessionEnd(S))}`}</p>
          </div>
          <button type="button" aria-label="Undo" onClick={undo} disabled={history.current.length === 0} className={BTN_SM}>
            ↶
          </button>
          <button type="button" aria-label="Redo" onClick={redo} disabled={future.current.length === 0} className={BTN_SM}>
            ↷
          </button>
        </div>
        <div className="mx-auto mt-2 grid max-w-3xl grid-cols-2 gap-2" role="tablist">
          {(['edit', 'mix'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-[44px] rounded-xl text-base font-bold ${FOCUS} ${tab === t ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
            >
              {t === 'edit' ? '〰️ Waveforms' : '🎚️ Faders'}
            </button>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-4">
        <div className="space-y-1 px-1">
          <h1 className="text-3xl font-black leading-tight">Mix your song!</h1>
          <p className="leading-relaxed text-slate-300">
            24 channels. Zoom in on the waves to cut exactly, then move the faders. Record your fader moves and the board plays them back for you.
          </p>
        </div>

        {engineError ? (
          <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
            {engineError}
          </p>
        ) : null}
        {loading ? (
          <p role="status" className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-200">
            {loading}
          </p>
        ) : null}
        {missing > 0 ? (
          <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
            {missing} {missing === 1 ? 'sound' : 'sounds'} could not be opened, so {missing === 1 ? 'it was' : 'they were'} left out. They may be too long or no longer saved on this phone.
          </p>
        ) : null}
        {!loading && !anySounds ? (
          <div role="status" className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-lg font-bold">Your mixer is empty.</p>
            <p className="text-slate-300">
              Make a beat, play the keys or record your voice, then tap "Add to my project". It shows up here. You can also add a song from your phone.
            </p>
          </div>
        ) : null}
        {status ? (
          <p role="status" className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-200">
            {status}
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          <button type="button" aria-expanded={panel === 'add'} onClick={() => setPanel(panel === 'add' ? '' : 'add')} className={`${BTN} text-sm`}>
            ＋ Add sound
          </button>
          <button type="button" aria-expanded={panel === 'mix'} onClick={() => setPanel(panel === 'mix' ? '' : 'mix')} className={`${BTN} text-sm`}>
            ⬇ Mix down
          </button>
          <button type="button" aria-expanded={panel === 'help'} onClick={() => setPanel(panel === 'help' ? '' : 'help')} className={`${BTN} text-sm`}>
            ❓ Help
          </button>
        </div>

        {panel === 'add' ? (
          <section aria-label="Add a sound" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
            <p className="text-base font-bold">
              Adds to channel {selCh + 1} at the red line.
            </p>
            <label className={`flex min-h-[64px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-pink-500/60 bg-slate-950 px-3 text-lg font-bold focus-within:outline focus-within:outline-4 focus-within:outline-white`}>
              <span aria-hidden="true">📁</span> Pick a song from my phone
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                className="sr-only"
                aria-label="Pick a sound file from your phone"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  void addFromPhone(f);
                }}
              />
            </label>
            {library.length === 0 ? (
              <p className="text-slate-400">No sounds from your project yet. Sounds you add to your project from BeatBox, the keys or the mic show up here.</p>
            ) : (
              <ul className="space-y-2">
                {library.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => void addFromLibrary(it)}
                      className={`flex min-h-[56px] w-full items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-left text-base font-semibold hover:border-pink-500 ${FOCUS}`}
                    >
                      <span className="truncate">{it.name}</span>
                      <span className="shrink-0 text-slate-400">{fmtTime(it.seconds)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {panel === 'mix' ? (
          <section aria-label="Mix down" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-lg font-bold">Make one finished song file</p>
            <p className="text-slate-300">This plays every channel, your fader moves and your pan moves into a single stereo WAV file.</p>
            <button type="button" onClick={() => void doMixdown()} disabled={!anySounds || exporting} className={`${BTN_PRIMARY} disabled:opacity-50`}>
              {exporting ? 'Mixing…' : '🎚️ Mix down my song'}
            </button>
            {mixdown ? (
              <div className="space-y-3">
                <p className="font-bold">Your mix is {fmtTime(mixdown.seconds)} long.</p>
                {mixdown.peak > 0.98 ? <p className="text-amber-200">It is very loud and may crackle. Pull some faders down and mix again.</p> : null}
                <audio key={mixdown.url} src={mixdown.url} controls className="w-full" />
                {mixAdded ? (
                  <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 font-bold text-emerald-300">
                    🎉 Added to your project!
                  </p>
                ) : (
                  <button type="button" onClick={addMixdown} className={BTN_PRIMARY}>
                    ✓ Add my mix to my project
                  </button>
                )}
                <a href={mixdown.url} download="my-mix.wav" className={`${BTN} flex min-h-[56px] items-center justify-center text-lg`}>
                  ⬇ Save to my phone
                </a>
              </div>
            ) : null}
          </section>
        ) : null}

        {panel === 'help' ? (
          <section aria-label="Help" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-200">
            <p className="text-lg font-bold">How to use the mixer</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Tap a wave to pick it. Drag it to move it. Drag empty space to slide the view.</li>
              <li>Pinch with two fingers, or use the zoom buttons, to zoom in for exact cuts.</li>
              <li>Move the red line, then tap Split to cut a sound in two.</li>
              <li>Switch to Trim and drag the edge of a wave to make it shorter or longer.</li>
              <li>On the Faders tab, move a fader to change the volume. Double-tap it to reset.</li>
            </ul>
            <p className="font-bold">Record your fader moves (automation)</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Tap the Auto button on a channel until it says Touch or Write.</li>
              <li>Press Play and move that channel's fader or pan while the song plays.</li>
              <li>Press Stop. Set the channel to Read, press Play, and watch the fader move by itself.</li>
            </ol>
            <ul className="space-y-1 text-sm text-slate-300">
              {AUTO_MODES.map((m) => (
                <li key={m}>{MODE_HELP[m]}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {tab === 'edit' ? (
          <>
            {/* zoom */}
            <section aria-label="Zoom" className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-3">
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Zoom out" className={BTN_SM} onClick={() => zoomTo(view.pps / 2, centreOfView())}>
                  −
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={clamp(zoomSlider, 0, 1)}
                  aria-label="Zoom"
                  onChange={(e) => zoomTo(MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, Number(e.target.value)), centreOfView())}
                  className="h-11 min-w-0 flex-1 accent-pink-500"
                />
                <button type="button" aria-label="Zoom in" className={BTN_SM} onClick={() => zoomTo(view.pps * 2, centreOfView())}>
                  ＋
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={BTN_SM} onClick={() => fitView()}>
                  Whole song
                </button>
                <button type="button" className={BTN_SM} onClick={() => zoomTo(width / 1)}>
                  1 s
                </button>
                <button type="button" className={BTN_SM} onClick={() => zoomTo(width / 0.1)}>
                  100 ms
                </button>
                <button type="button" className={BTN_SM} onClick={() => zoomTo(sampleRate * 2)}>
                  Samples
                </button>
                <span data-testid="span" className="ml-auto text-sm font-semibold text-slate-300">
                  Showing {spanLabel(span)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(['move', 'trim', 'cursor'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tool === t}
                    onClick={() => setTool(t)}
                    className={`min-h-[44px] rounded-lg px-3 text-base font-bold ${FOCUS} ${tool === t ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
                  >
                    {t === 'move' ? '✋ Move' : t === 'trim' ? '↔ Trim' : '📍 Red line'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={snapZero}
                  onClick={() => setSnapZero((v) => !v)}
                  className={`min-h-[44px] rounded-lg px-2 text-sm font-bold ${FOCUS} ${snapZero ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-200'}`}
                >
                  Smooth cuts {snapZero ? 'On' : 'Off'}
                </button>
                <button
                  type="button"
                  aria-pressed={follow}
                  onClick={() => setFollow((v) => !v)}
                  className={`min-h-[44px] rounded-lg px-2 text-sm font-bold ${FOCUS} ${follow ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-200'}`}
                >
                  Follow red line {follow ? 'On' : 'Off'}
                </button>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                Show recorded moves:
                <select
                  value={autoShow}
                  onChange={(e) => setAutoShow(e.target.value as 'vol' | 'pan' | 'none')}
                  className={`min-h-[44px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 text-base ${FOCUS}`}
                >
                  <option value="vol">Volume (yellow line)</option>
                  <option value="pan">Pan (yellow line)</option>
                  <option value="none">Hide</option>
                </select>
              </label>
            </section>

            {/* waveforms */}
            <div className="flex overflow-hidden rounded-xl border border-slate-800">
              <div className="w-[76px] shrink-0 bg-slate-950">
                <div style={{ height: RULER }} className="border-b border-slate-800 bg-slate-900" />
                {S.channels.map((c, i) => (
                  <div
                    key={i}
                    className={`flex flex-col justify-center gap-1 border-b border-slate-800 px-1 ${i === selCh ? 'bg-pink-500/10' : ''}`}
                    style={{ height: LANE }}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(i)}
                      aria-label={`Select channel ${i + 1}: ${c.name}`}
                      className={`truncate rounded px-1 text-left text-xs font-black text-slate-950 ${FOCUS}`}
                      style={{ background: c.color }}
                    >
                      {i + 1} {c.name}
                    </button>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-pressed={c.mute}
                        aria-label={`Mute channel ${i + 1}`}
                        onClick={() => onMute(i)}
                        className={`h-7 flex-1 rounded text-xs font-black ${c.mute ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300'} ${FOCUS}`}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        aria-pressed={c.solo}
                        aria-label={`Solo channel ${i + 1}`}
                        onClick={() => onSolo(i)}
                        className={`h-7 flex-1 rounded text-xs font-black ${c.solo ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300'} ${FOCUS}`}
                      >
                        S
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div
                ref={areaRef}
                data-testid="timeline"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onWheel={onWheel}
                className="relative min-w-0 flex-1 select-none"
                style={{ height: RULER + CHANNELS * LANE, touchAction: 'pan-y' }}
              >
                <canvas ref={baseRef} data-testid="waves" className="absolute left-0 top-0" style={{ width, height: RULER + CHANNELS * LANE }} />
                <canvas ref={overRef} className="pointer-events-none absolute left-0 top-0" style={{ width, height: RULER + CHANNELS * LANE }} />
              </div>
            </div>

            {/* selected channel */}
            <section aria-label={`Channel ${selCh + 1}`} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
              <div className="flex items-center gap-2">
                <span className="rounded-md px-2 py-1 text-sm font-black text-slate-950" style={{ background: selChan.color }}>
                  {selCh + 1}
                </span>
                <input
                  value={selChan.name}
                  maxLength={10}
                  onChange={(e) => onName(selCh, e.target.value)}
                  aria-label="Channel name"
                  className={`min-h-[44px] min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-base font-bold ${FOCUS}`}
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-bold text-slate-300">Automation (record your fader moves)</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {AUTO_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={selChan.mode === m}
                      onClick={() => setMode(selCh, m)}
                      className={`min-h-[44px] rounded-lg text-sm font-black ${FOCUS} ${selChan.mode === m ? MODE_CLASS[m] : 'bg-slate-800 text-slate-400'}`}
                    >
                      {MODE_LABEL[m]}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-sm text-slate-400">{MODE_HELP[selChan.mode]}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={selChan.autoVol.length === 0}
                  onClick={() => edit((s) => withChannel(s, selCh, (c) => ({ ...c, autoVol: [] })))}
                  className={`${BTN} text-sm disabled:opacity-40`}
                >
                  Clear volume moves
                </button>
                <button
                  type="button"
                  disabled={selChan.autoPan.length === 0}
                  onClick={() => edit((s) => withChannel(s, selCh, (c) => ({ ...c, autoPan: [] })))}
                  className={`${BTN} text-sm disabled:opacity-40`}
                >
                  Clear pan moves
                </button>
              </div>
            </section>

            {/* selected sound */}
            <section aria-label="Edit the picked sound" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
              {selected ? (
                <>
                  <p className="truncate text-base font-bold" data-testid="sel-info">
                    {selected.r.name} · channel {selected.ch + 1}
                  </p>
                  <p className="text-sm text-slate-300 tabular-nums" data-testid="sel-times">
                    Starts {fmtTime(selected.r.start, true)} · Length {fmtTime(selected.r.length, true)}
                  </p>
                </>
              ) : (
                <p className="text-base font-bold text-slate-300">Tap a wave to pick it, then edit it here.</p>
              )}
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={doSplit} className={BTN}>
                  ✂ Split
                </button>
                <button type="button" onClick={doDuplicate} disabled={!selected} className={`${BTN} disabled:opacity-40`}>
                  ⧉ Copy
                </button>
                <button type="button" onClick={doDelete} disabled={!selected} className={`${BTN} disabled:opacity-40`}>
                  🗑 Delete
                </button>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                Nudge step:
                <select
                  value={stepMs}
                  onChange={(e) => setStepMs(Number(e.target.value))}
                  aria-label="Nudge step"
                  className={`min-h-[44px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 text-base ${FOCUS}`}
                >
                  {STEPS_MS.map((m) => (
                    <option key={m} value={m}>
                      {m >= 1000 ? `${m / 1000} second` : `${m} millisecond${m === 1 ? '' : 's'}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                <span className="text-sm font-bold">Move sound</span>
                <button type="button" aria-label="Move earlier" disabled={!selected} onClick={() => nudgeMove(-1)} className={BTN_SM}>
                  ◀
                </button>
                <button type="button" aria-label="Move later" disabled={!selected} onClick={() => nudgeMove(1)} className={BTN_SM}>
                  ▶
                </button>
                <span className="text-sm font-bold">Trim the start</span>
                <button type="button" aria-label="Trim start earlier" disabled={!selected} onClick={() => nudgeTrimStart(-1)} className={BTN_SM}>
                  ◀
                </button>
                <button type="button" aria-label="Trim start later" disabled={!selected} onClick={() => nudgeTrimStart(1)} className={BTN_SM}>
                  ▶
                </button>
                <span className="text-sm font-bold">Trim the end</span>
                <button type="button" aria-label="Trim end earlier" disabled={!selected} onClick={() => nudgeTrimEnd(-1)} className={BTN_SM}>
                  ◀
                </button>
                <button type="button" aria-label="Trim end later" disabled={!selected} onClick={() => nudgeTrimEnd(1)} className={BTN_SM}>
                  ▶
                </button>
                <span className="text-sm font-bold">Fade in {selected ? `${Math.round(selected.r.fadeIn * 1000)} ms` : ''}</span>
                <button type="button" aria-label="Shorter fade in" disabled={!selected} onClick={() => nudgeFade('fadeIn', -1)} className={BTN_SM}>
                  −
                </button>
                <button type="button" aria-label="Longer fade in" disabled={!selected} onClick={() => nudgeFade('fadeIn', 1)} className={BTN_SM}>
                  ＋
                </button>
                <span className="text-sm font-bold">Fade out {selected ? `${Math.round(selected.r.fadeOut * 1000)} ms` : ''}</span>
                <button type="button" aria-label="Shorter fade out" disabled={!selected} onClick={() => nudgeFade('fadeOut', -1)} className={BTN_SM}>
                  −
                </button>
                <button type="button" aria-label="Longer fade out" disabled={!selected} onClick={() => nudgeFade('fadeOut', 1)} className={BTN_SM}>
                  ＋
                </button>
                <span className="text-sm font-bold">Loudness {selected ? `${(20 * Math.log10(Math.max(0.0001, selected.r.gain))).toFixed(1)} dB` : ''}</span>
                <button type="button" aria-label="Quieter" disabled={!selected} onClick={() => nudgeGain(-1)} className={BTN_SM}>
                  −
                </button>
                <button type="button" aria-label="Louder" disabled={!selected} onClick={() => nudgeGain(1)} className={BTN_SM}>
                  ＋
                </button>
                <span className="text-sm font-bold">Channel</span>
                <button type="button" aria-label="Move to the channel above" disabled={!selected} onClick={() => moveToChannel(-1)} className={BTN_SM}>
                  ▲
                </button>
                <button type="button" aria-label="Move to the channel below" disabled={!selected} onClick={() => moveToChannel(1)} className={BTN_SM}>
                  ▼
                </button>
              </div>
            </section>
          </>
        ) : (
          <section aria-label="Faders" className="space-y-2">
            <p className="px-1 text-sm text-slate-400">Slide sideways to see all 24 channels. The big strip on the right is the master volume.</p>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1 overflow-x-auto pb-2" data-testid="strips" style={{ touchAction: 'pan-x' }}>
                <div className="flex gap-2">
                  {S.channels.map((c, i) => (
                    <Strip
                      key={i}
                      i={i}
                      name={c.name}
                      color={c.color}
                      vol={shown(c, 'vol')}
                      pan={shown(c, 'pan')}
                      mute={c.mute}
                      solo={c.solo}
                      mode={c.mode}
                      hasAuto={c.autoVol.length > 0 || c.autoPan.length > 0}
                      hasSounds={c.regions.length > 0}
                      selected={i === selCh}
                      onControl={onControl}
                      onName={onName}
                      onMode={onMode}
                      onMute={onMute}
                      onSolo={onSolo}
                      onSelect={onSelect}
                      regMeter={regMeter}
                    />
                  ))}
                </div>
              </div>
              <div className="flex w-[88px] shrink-0 flex-col items-stretch gap-2 rounded-xl border border-pink-500/50 bg-slate-900 p-2" data-testid="master">
                <p className="rounded-md bg-slate-100 py-1 text-center text-xs font-black text-slate-950">MASTER</p>
                <div className="flex-1" />
                <Fader
                  value={S.master}
                  label="Master volume"
                  onChange={(v) => setS({ ...SRef.current, master: v })}
                  meterRef={(el) => regMeter(CHANNELS, el)}
                />
                <p className="text-center text-sm font-black tabular-nums">{dbLabel(S.master)} dB</p>
                <p className="text-center text-[11px] text-slate-400">{Math.abs(faderToDb(S.master)) < 0.05 ? 'Unity' : ''}</p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
