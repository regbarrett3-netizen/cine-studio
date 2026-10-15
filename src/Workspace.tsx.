import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

type TrackType = 'audio' | 'video';

interface Clip {
  id: string;
  name: string;
  start: number; // seconds
  duration: number; // seconds
}

interface Track {
  id: string;
  name: string;
  type: TrackType;
  muted: boolean;
  clips: Clip[];
}

interface WorkspaceProps {
  mode: string;
  modeLabel: string;
  onBack: () => void;
}

const ROW_H = 56;
const RULER_H = 28;
const MIN_DURATION = 60;
const MIN_PPS = 4;
const MAX_PPS = 40;

const uid = () => Math.random().toString(36).slice(2, 9);

const newTrack = (name: string, type: TrackType): Track => ({
  id: uid(),
  name,
  type,
  muted: false,
  clips: [],
});

function presetTracks(mode: string): Track[] {
  switch (mode) {
    case 'music':
      return [newTrack('Beat', 'audio'), newTrack('Vocals', 'audio')];
    case 'music-video':
      return [newTrack('Song', 'audio'), newTrack('Visuals', 'video')];
    case 'movie-sfx':
      return [newTrack('Scenes', 'video'), newTrack('Sound FX', 'audio')];
    case 'full-movie':
      return [
        newTrack('Scenes', 'video'),
        newTrack('Sound FX', 'audio'),
        newTrack('Soundtrack', 'audio'),
      ];
    default:
      return [newTrack('Audio 1', 'audio'), newTrack('Video 1', 'video')];
  }
}

function loadTracks(mode: string): Track[] {
  try {
    const raw = window.localStorage.getItem(`cine-timeline-${mode}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Track[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // storage unavailable or corrupt: fall through to preset
  }
  return presetTracks(mode);
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

type Drag =
  | { kind: 'scrub' }
  | { kind: 'clip'; trackId: string; clipId: string; offset: number }
  | { kind: 'pan'; startX: number; startScroll: number };

export default function Workspace({ mode, modeLabel, onBack }: WorkspaceProps) {
  const [tracks, setTracks] = useState<Track[]>(() => loadTracks(mode));
  const [selTrackId, setSelTrackId] = useState<string | null>(null);
  const [selClipId, setSelClipId] = useState<string | null>(null);
  const [time, setTimeState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(12); // pixels per second

  const timeRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const setTime = useCallback((v: number) => {
    timeRef.current = v;
    setTimeState(v);
  }, []);

  const contentEnd = useMemo(
    () =>
      tracks.reduce(
        (max, t) => t.clips.reduce((m, c) => Math.max(m, c.start + c.duration), max),
        0,
      ),
    [tracks],
  );
  const duration = Math.max(MIN_DURATION, Math.ceil(contentEnd) + 10);

  const selTrack = tracks.find((t) => t.id === selTrackId) ?? null;
  const selClip =
    tracks.flatMap((t) => t.clips).find((c) => c.id === selClipId) ?? null;

  // Persist
  useEffect(() => {
    try {
      window.localStorage.setItem(`cine-timeline-${mode}`, JSON.stringify(tracks));
    } catch {
      // ignore
    }
  }, [tracks, mode]);

  // Playback loop
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const endAt = contentEnd > 0 ? contentEnd : duration;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = timeRef.current + dt;
      if (next >= endAt) {
        setTime(endAt);
        setPlaying(false);
        return;
      }
      setTime(next);
      const sc = scrollRef.current;
      if (sc) {
        const x = next * pps;
        if (x > sc.scrollLeft + sc.clientWidth - 24) sc.scrollLeft = x - 48;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, contentEnd, duration, pps, setTime]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.round(duration * pps);
    const h = RULER_H + tracks.length * ROW_H;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, w, h);

    // rows
    tracks.forEach((t, i) => {
      const y = RULER_H + i * ROW_H;
      ctx.fillStyle = i % 2 === 0 ? '#0f172a' : '#111a2e';
      ctx.fillRect(0, y, w, ROW_H);
      if (t.id === selTrackId) {
        ctx.fillStyle = 'rgba(139, 92, 246, 0.08)';
        ctx.fillRect(0, y, w, ROW_H);
      }
    });

    // ruler
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, w, RULER_H);
    const step = pps >= 20 ? 1 : pps >= 8 ? 5 : 10;
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let s = 0; s <= duration; s += step) {
      const x = s * pps + 0.5;
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 8);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, x + 3, 12);
    }

    // clips
    tracks.forEach((t, i) => {
      const y = RULER_H + i * ROW_H + 6;
      const ch = ROW_H - 12;
      t.clips.forEach((c) => {
        const x = c.start * pps;
        const cw = Math.max(c.duration * pps, 4);
        const grad = ctx.createLinearGradient(x, y, x, y + ch);
        if (t.type === 'audio') {
          grad.addColorStop(0, t.muted ? '#475569' : '#8b5cf6');
          grad.addColorStop(1, t.muted ? '#334155' : '#6366f1');
        } else {
          grad.addColorStop(0, t.muted ? '#475569' : '#f59e0b');
          grad.addColorStop(1, t.muted ? '#334155' : '#ea580c');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, cw, ch, 6);
        } else {
          ctx.rect(x, y, cw, ch);
        }
        ctx.fill();
        if (c.id === selClipId) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 4, y, Math.max(cw - 8, 0), ch);
        ctx.clip();
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.name, x + 8, y + ch / 2);
        ctx.restore();
      });
    });

    // playhead
    const px = time * pps + 0.5;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px, 9);
    ctx.closePath();
    ctx.fill();
  }, [tracks, time, pps, duration, selClipId, selTrackId]);

  // Pointer interaction
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const sc = scrollRef.current;
    if (!canvas || !sc) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    canvas.setPointerCapture(e.pointerId);

    if (y < RULER_H) {
      dragRef.current = { kind: 'scrub' };
      setPlaying(false);
      setTime(Math.max(0, Math.min(duration, x / pps)));
      return;
    }
    const row = Math.floor((y - RULER_H) / ROW_H);
    const track = tracks[row];
    if (track) {
      setSelTrackId(track.id);
      const t = x / pps;
      const hit = [...track.clips].reverse().find((c) => t >= c.start && t <= c.start + c.duration);
      if (hit) {
        setSelClipId(hit.id);
        dragRef.current = { kind: 'clip', trackId: track.id, clipId: hit.id, offset: t - hit.start };
        return;
      }
    }
    setSelClipId(null);
    dragRef.current = { kind: 'pan', startX: e.clientX, startScroll: sc.scrollLeft };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    const canvas = canvasRef.current;
    const sc = scrollRef.current;
    if (!d || !canvas || !sc) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (d.kind === 'scrub') {
      setTime(Math.max(0, Math.min(duration, x / pps)));
    } else if (d.kind === 'clip') {
      const start = Math.max(0, Math.round((x / pps - d.offset) * 10) / 10);
      setTracks((prev) =>
        prev.map((t) =>
          t.id === d.trackId
            ? { ...t, clips: t.clips.map((c) => (c.id === d.clipId ? { ...c, start } : c)) }
            : t,
        ),
      );
    } else {
      sc.scrollLeft = d.startScroll - (e.clientX - d.startX);
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // Actions
  const addTrack = (type: TrackType) => {
    const count = tracks.filter((t) => t.type === type).length + 1;
    const t = newTrack(`${type === 'audio' ? 'Audio' : 'Video'} ${count}`, type);
    setTracks((prev) => [...prev, t]);
    setSelTrackId(t.id);
    setSelClipId(null);
  };

  const addClip = () => {
    const target = selTrack ?? tracks[0];
    if (!target) return;
    const clip: Clip = {
      id: uid(),
      name: `${target.name} clip ${target.clips.length + 1}`,
      start: Math.round(timeRef.current * 10) / 10,
      duration: 8,
    };
    setTracks((prev) =>
      prev.map((t) => (t.id === target.id ? { ...t, clips: [...t.clips, clip] } : t)),
    );
    setSelTrackId(target.id);
    setSelClipId(clip.id);
  };

  const updateClip = (id: string, patch: Partial<Clip>) => {
    setTracks((prev) =>
      prev.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    );
  };

  const splitClip = () => {
    if (!selClip) return;
    const at = timeRef.current;
    if (at <= selClip.start + 0.1 || at >= selClip.start + selClip.duration - 0.1) return;
    const first: Clip = { ...selClip, duration: at - selClip.start };
    const second: Clip = {
      id: uid(),
      name: `${selClip.name} (2)`,
      start: at,
      duration: selClip.start + selClip.duration - at,
    };
    setTracks((prev) =>
      prev.map((t) =>
        t.clips.some((c) => c.id === selClip.id)
          ? { ...t, clips: t.clips.flatMap((c) => (c.id === selClip.id ? [first, second] : [c])) }
          : t,
      ),
    );
    setSelClipId(second.id);
  };

  const deleteClip = () => {
    if (!selClip) return;
    setTracks((prev) => prev.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== selClip.id) })));
    setSelClipId(null);
  };

  const removeTrack = () => {
    if (!selTrack || tracks.length <= 1) return;
    setTracks((prev) => prev.filter((t) => t.id !== selTrack.id));
    setSelTrackId(null);
    setSelClipId(null);
  };

  const toggleMute = (id: string) =>
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, muted: !t.muted } : t)));

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    const endAt = contentEnd > 0 ? contentEnd : duration;
    if (timeRef.current >= endAt) setTime(0);
    setPlaying(true);
  };

  const stop = () => {
    setPlaying(false);
    setTime(0);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  };

  const btn =
    'px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
        <button onClick={onBack} className={btn}>
          ← Back
        </button>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold truncate">
          ✓ {modeLabel}
        </div>
      </header>

      <main className="p-4 space-y-4 max-w-5xl mx-auto">
        {/* Transport */}
        <section className="flex flex-wrap items-center gap-2">
          <button onClick={togglePlay} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white min-w-[72px]`}>
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button onClick={stop} className={btn}>
            ■ Stop
          </button>
          <div className="font-mono text-sm text-slate-300 px-2 tabular-nums">{fmt(time)}</div>
          <label className="flex items-center gap-2 text-xs text-slate-400 ml-auto">
            Zoom
            <input
              type="range"
              min={MIN_PPS}
              max={MAX_PPS}
              value={pps}
              onChange={(e) => setPps(Number(e.target.value))}
              className="w-28 accent-violet-500"
              aria-label="Zoom"
            />
          </label>
        </section>

        {/* Timeline */}
        <section className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden flex">
          <div className="shrink-0 w-24 border-r border-slate-800 bg-slate-950">
            <div style={{ height: RULER_H }} className="border-b border-slate-800" />
            {tracks.map((t) => (
              <div
                key={t.id}
                style={{ height: ROW_H }}
                onClick={() => {
                  setSelTrackId(t.id);
                  setSelClipId(null);
                }}
                className={`px-2 flex flex-col justify-center gap-1 border-b border-slate-800/60 cursor-pointer ${
                  t.id === selTrackId ? 'bg-violet-500/10' : ''
                }`}
              >
                <div className="text-[11px] font-semibold text-slate-200 truncate">{t.name}</div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] uppercase tracking-wide text-slate-500">{t.type}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMute(t.id);
                    }}
                    className={`ml-auto text-[10px] px-1.5 rounded ${
                      t.muted ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-800 text-slate-400'
                    }`}
                    aria-label={t.muted ? 'Unmute track' : 'Mute track'}
                  >
                    M
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div ref={scrollRef} className="overflow-x-auto flex-1">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="block touch-none select-none"
            />
          </div>
        </section>

        {/* Edit tools */}
        <section className="flex flex-wrap gap-2">
          <button onClick={addClip} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>
            + Add clip at playhead
          </button>
          <button onClick={() => addTrack('audio')} className={btn}>
            + Audio track
          </button>
          <button onClick={() => addTrack('video')} className={btn}>
            + Video track
          </button>
          <button onClick={splitClip} disabled={!selClip} className={btn}>
            ✂ Split
          </button>
          <button onClick={deleteClip} disabled={!selClip} className={btn}>
            Delete clip
          </button>
          <button onClick={removeTrack} disabled={!selTrack || tracks.length <= 1 || !!selClip} className={btn}>
            Remove track
          </button>
        </section>

        {/* Inspector */}
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          {selClip ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs text-slate-400">
                Clip name
                <input
                  value={selClip.name}
                  onChange={(e) => updateClip(selClip.id, { name: e.target.value })}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="text-xs text-slate-400">
                Start (sec)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={selClip.start}
                  onChange={(e) => updateClip(selClip.id, { start: Math.max(0, Number(e.target.value) || 0) })}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="text-xs text-slate-400">
                Length (sec)
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={selClip.duration}
                  onChange={(e) =>
                    updateClip(selClip.id, { duration: Math.max(0.5, Number(e.target.value) || 0.5) })
                  }
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                />
              </label>
            </div>
          ) : (
            <p className="text-xs text-slate-400 leading-relaxed">
              Tap a track name, then <span className="text-slate-200">+ Add clip</span>. Drag a clip to move it,
              drag empty space to scroll, and drag along the ruler at the top to scrub. Your timeline saves
              automatically in this browser.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
