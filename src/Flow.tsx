import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { BTN_DISABLED, BTN_PRIMARY, BTN_SECONDARY, DonePanel, FOCUS, Screen } from './ui';
import { generateSong } from './mixEngine';
import type { AudioClip, SongResult } from './mixEngine';

// Flip to true once /api/generate really makes music, video and sound.
// While false, "Generate" on an AI idea saves the idea and says AI making is coming soon.
export const GENERATION_IS_LIVE = false;

/* ------------------------------------------------------------------ */
/* Saved projects: a list on the first page so you can come back later */
/* ------------------------------------------------------------------ */

export interface SavedProject {
  mode: string;
  label: string;
  savedAt: number;
  count: number;
}

const SAVED_KEY = 'cine-saved-v1';

export function readSaved(): SavedProject[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const list = raw ? (JSON.parse(raw) as SavedProject[]) : [];
    return Array.isArray(list)
      ? list.filter((s) => s && typeof s.mode === 'string' && typeof s.label === 'string').slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

export function saveProject(mode: string, label: string, count: number): void {
  try {
    const rest = readSaved().filter((s) => s.mode !== mode);
    window.localStorage.setItem(SAVED_KEY, JSON.stringify([{ mode, label, savedAt: Date.now(), count }, ...rest]));
  } catch {
    /* storage blocked: the project itself is still kept where it was */
  }
}

export function removeSaved(mode: string): void {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(readSaved().filter((s) => s.mode !== mode)));
  } catch {
    /* ignore */
  }
}

const isMovie = (mode: string) => mode === 'movie-sfx' || mode === 'full-movie';
const shorten = (s: string, n = 42) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const clock = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The word for the thing being made, for buttons and headings. */
export const goalWord = (mode: string, modeLabel: string) => (isMovie(mode) ? 'Movie' : mode === 'music-video' ? 'Music Video' : modeLabel || 'Music');

/* ------------------------------------------------------------------ */
/* Generate / Continue bar at the bottom of the project page            */
/* ------------------------------------------------------------------ */

interface BarProps {
  onGenerate: () => void;
  onContinue: () => void;
  notice: string;
}

export function GenerateBar({ onGenerate, onContinue, notice }: BarProps) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 space-y-2 border-t border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
      {notice ? (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-amber-200">
          {notice}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={onGenerate} className={BTN_PRIMARY}>
          ✨ Generate
        </button>
        <button type="button" onClick={onContinue} className={`${BTN_SECONDARY} min-h-[64px] text-lg font-bold`}>
          Continue →
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Continue: go back to the project or save it for later               */
/* ------------------------------------------------------------------ */

interface ContinueProps {
  mode: string;
  modeLabel: string;
  count: number;
  onProject: () => void;
  onSaved: () => void;
  onBack: () => void;
}

export function ContinueScreen({ mode, modeLabel, count, onProject, onSaved, onBack }: ContinueProps) {
  const word = goalWord(mode, modeLabel);
  const [done, setDone] = useState(false);
  const save = () => {
    saveProject(mode, modeLabel, count);
    setDone(true);
  };
  return (
    <Screen title="Where to next?" subtitle="Your project is not made yet. Pick what you want to do." modeLabel={modeLabel} onBack={onBack} backLabel="← Back to my project">
      {done ? (
        <div role="status" className="space-y-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5">
          <p className="text-2xl font-black text-emerald-300">💾 Saved!</p>
          <p className="leading-relaxed text-slate-200">Your {word.toLowerCase()} project is saved on this phone. Open the first page any time and tap it to finish.</p>
          <button type="button" onClick={onSaved} className={BTN_PRIMARY}>
            Go to the first page
          </button>
        </div>
      ) : (
        <div className="grid gap-3 landscape:grid-cols-2">
          <button type="button" onClick={onProject} className={`${BTN_PRIMARY} min-h-[88px] text-2xl`}>
            {isMovie(mode) ? '🎥' : mode === 'music-video' ? '💿' : '🎵'} {word}
            <span className="mt-1 block text-sm font-semibold opacity-90">Go back to my unfinished project</span>
          </button>
          <button type="button" onClick={save} className={`${BTN_SECONDARY} min-h-[88px] text-2xl font-black`}>
            💾 Save
            <span className="mt-1 block text-sm font-semibold text-slate-300">Keep it and finish later</span>
          </button>
        </div>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Generate: mix everything into one finished file                      */
/* ------------------------------------------------------------------ */

const REASON: Record<'empty' | 'long' | 'silent' | 'failed', string> = {
  empty:
    'There is no sound to mix yet. Make a beat, play the keys, record your voice or pick a song first. AI ideas are saved, but AI music making is not switched on yet.',
  long: 'This project is longer than 10 minutes. Shorten or remove a sound in the mixer, then tap Generate again.',
  silent: 'The mix came out silent. Open the mixer, check that no channel is muted and the faders are up, then tap Generate again.',
  failed: 'This phone could not finish the mix. Try again, or use fewer or shorter sounds.',
};

interface GenerateProps {
  mode: string;
  modeLabel: string;
  onBack: () => void;
  onReady: (r: { blob: Blob; seconds: number; parts: number }) => void;
}

export function GenerateScreen({ mode, modeLabel, onBack, onReady }: GenerateProps) {
  const [error, setError] = useState('');
  const started = useRef(false);
  const alive = useRef(true);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = () => {
    setError('');
    void generateSong(mode).then((r: SongResult) => {
      if (!alive.current) return;
      if (r.ok) readyRef.current({ blob: r.blob, seconds: r.seconds, parts: r.parts });
      else setError(REASON[r.reason]);
    });
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen title={error ? 'Could not make it yet' : 'Making your song…'} subtitle={error ? undefined : 'Mixing all your sounds together. This takes a few seconds.'} modeLabel={modeLabel} onBack={onBack} backLabel="← Back to my project">
      {error ? (
        <div className="space-y-4">
          <p role="alert" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 leading-relaxed text-amber-100">
            {error}
          </p>
          <button type="button" onClick={onBack} className={BTN_PRIMARY}>
            Back to my project
          </button>
          <button type="button" onClick={run} className={`${BTN_SECONDARY} w-full min-h-[56px] text-lg`}>
            Try again
          </button>
        </div>
      ) : (
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <span aria-hidden="true" className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-t-pink-500" />
          <p className="text-lg font-bold">Working on it…</p>
        </div>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* The song is finished: save it to Files or go on to the video         */
/* ------------------------------------------------------------------ */

type SaveOutcome = 'shared' | 'downloaded' | 'cancelled';

async function saveToFiles(blob: Blob, fileName: string): Promise<SaveOutcome> {
  const file = new File([blob], fileName, { type: blob.type || 'audio/wav' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  try {
    // On a phone this opens the share sheet, which has "Save to Files".
    if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    /* fall through to a plain download */
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

interface ReadyProps {
  mode: string;
  modeLabel: string;
  blob: Blob;
  seconds: number;
  onVideo: () => void;
  onHome: () => void;
}

export function SongReady({ mode, modeLabel, blob, seconds, onVideo, onHome }: ReadyProps) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const movie = isMovie(mode);

  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setNote('');
    try {
      const name = `my-${movie ? 'soundtrack' : 'song'}.wav`;
      const out = await saveToFiles(blob, name);
      if (out === 'shared') setNote('Saved! If you picked "Save to Files", it is in your Files app.');
      else if (out === 'downloaded') setNote('Saved! Look in your Downloads (the Files app on an iPhone).');
    } catch {
      setNote('This phone could not save the file. Try again.');
    }
    setSaving(false);
  };

  return (
    <Screen
      title={movie ? '🎉 Your soundtrack is ready!' : '🎉 Your music is ready!'}
      subtitle={`It is ${clock(seconds)} long. Press play to hear it.`}
      modeLabel={modeLabel}
      onBack={onHome}
      backLabel="← Back to my project"
    >
      {url ? <audio key={url} src={url} controls className="w-full" /> : null}
      {note ? (
        <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 font-semibold text-emerald-200">
          {note}
        </p>
      ) : null}
      <div className="grid gap-3 landscape:grid-cols-2">
        <button type="button" onClick={() => void save()} disabled={saving} className={`${BTN_PRIMARY} min-h-[80px] text-2xl`}>
          💾 Save
          <span className="mt-1 block text-sm font-semibold opacity-90">Save the file to Files</span>
        </button>
        <button type="button" onClick={onVideo} className={`${BTN_SECONDARY} min-h-[80px] text-2xl font-black`}>
          {movie ? '🎥 Movie Scenes' : '🎬 Music Video'}
          <span className="mt-1 block text-sm font-semibold text-slate-300">{movie ? 'Open the AI to make your scenes' : 'Open the AI to make your video'}</span>
        </button>
      </div>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* The AI video page: type an idea, add lyrics, press Generate          */
/* ------------------------------------------------------------------ */

const MAX_LYRICS_FILE = 200 * 1024;
const MAX_LYRICS_CHARS = 1500;

interface VideoProps {
  mode: string;
  modeLabel: string;
  hasSong: boolean;
  onHome: () => void;
  onAdd: (clip: AudioClip) => void;
}

export function VideoAiStep({ mode, modeLabel, hasSong, onHome, onAdd }: VideoProps) {
  const movie = isMovie(mode);
  const [idea, setIdea] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [fileName, setFileName] = useState('');
  const [phase, setPhase] = useState<'typing' | 'working' | 'done'>('typing');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const ready = idea.trim().length >= 3;

  const examples = movie
    ? ['A dragon flies over a castle', 'Two kids build a rocket', 'A robot dances in the rain']
    : ['Neon city at night, camera flies through', 'Singer on a stage with colored lights', 'Cartoon animals dancing in a forest'];

  const pickLyrics = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setNotice('');
    if (f.size > MAX_LYRICS_FILE) {
      setNotice('That file is too big for lyrics. Pick a small text file (.txt).');
      return;
    }
    try {
      const text = (await f.text()).replace(/\u0000/g, '').trim();
      if (!text || /[\u0000-\u0008]/.test(text.slice(0, 200))) {
        setNotice('That does not look like a text file. Pick a .txt file with your words, or paste them below.');
        return;
      }
      setLyrics(text.slice(0, MAX_LYRICS_CHARS));
      setFileName(f.name);
      if (text.length > MAX_LYRICS_CHARS) setNotice(`Only the first ${MAX_LYRICS_CHARS.toLocaleString()} letters are used.`);
    } catch {
      setNotice('This phone could not read that file. Paste your words below instead.');
    }
  };

  const generate = async () => {
    if (!ready || phase === 'working') return;
    setNotice('');
    setPhase('working');
    const text = idea.trim();
    const prompt = lyrics.trim() ? `${text}\n\n${movie ? 'Script' : 'Lyrics'}:\n${lyrics.trim()}`.slice(0, 2000) : text;
    let outcome: 'sent' | 'soon' | 'busy' = 'soon';
    if (GENERATION_IS_LIVE) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, model: 'video', useByoKey: false }),
          signal: controller.signal,
        });
        outcome = res.ok ? 'sent' : res.status === 429 ? 'busy' : 'soon';
      } catch {
        outcome = 'soon';
      } finally {
        window.clearTimeout(timer);
      }
    }
    if (outcome === 'busy') {
      setNotice('Lots of people are making things right now. Wait a minute, then tap Generate again.');
      setPhase('typing');
      return;
    }
    onAdd({
      name: shorten(`${movie ? 'Scene' : 'Music video'}: ${text}`),
      type: 'video',
      duration: 8,
      track: movie ? 'Scenes' : 'Visuals',
      from: 'video-ai',
    });
    setMessage(
      outcome === 'sent'
        ? 'Your idea and lyrics were sent to the AI. They are saved in your project.'
        : 'AI video making is coming soon! Your idea and lyrics are saved in your project, so they will be ready when the AI is.',
    );
    setPhase('done');
  };

  const again = () => {
    setIdea('');
    setNotice('');
    setPhase('typing');
  };

  return (
    <Screen
      title={movie ? 'Make your movie scenes' : 'Make your music video'}
      subtitle={movie ? 'Tell the AI what happens. Add your script if you have one.' : 'Tell the AI what the video looks like. Add your lyrics so it can match the words.'}
      modeLabel={modeLabel}
      onBack={onHome}
      backLabel="← Back to my project"
    >
      {phase === 'done' ? (
        <DonePanel message={message} againLabel="Make another idea" onAgain={again} onHome={onHome} />
      ) : (
        <>
          {hasSong ? (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 font-semibold text-emerald-200">🎵 Your finished {movie ? 'soundtrack' : 'song'} goes with this video.</p>
          ) : null}
          <div className="space-y-2">
            <label htmlFor="vidIdea" className="block text-lg font-bold">
              Your idea
            </label>
            <textarea
              id="vidIdea"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              rows={4}
              maxLength={300}
              placeholder={examples[0]}
              className="w-full rounded-2xl border-2 border-slate-700 bg-slate-900 px-4 py-3 text-lg text-white placeholder:text-slate-500 focus:border-pink-500 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              {examples.map((ex) => (
                <button key={ex} type="button" onClick={() => setIdea(ex)} className={`min-h-[48px] rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-left text-base text-slate-100 hover:border-pink-500 ${FOCUS}`}>
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-lg font-bold">{movie ? 'Script (optional)' : 'Lyrics (optional)'}</p>
            <label className={`flex min-h-[64px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-pink-500/60 bg-slate-900 px-3 text-lg font-bold focus-within:outline focus-within:outline-4 focus-within:outline-white`}>
              <span aria-hidden="true">📄</span> {fileName ? `✓ ${shorten(fileName, 28)}` : movie ? 'Upload my script' : 'Upload my lyrics'}
              <input type="file" accept=".txt,.lrc,.srt,.md,text/plain" onChange={(e) => void pickLyrics(e)} className="sr-only" aria-label={movie ? 'Upload a script file' : 'Upload a lyrics file'} />
            </label>
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value.slice(0, MAX_LYRICS_CHARS))}
              rows={6}
              aria-label={movie ? 'Script text' : 'Lyrics text'}
              placeholder={movie ? 'Or type or paste your script here' : 'Or type or paste your lyrics here'}
              className="w-full rounded-2xl border-2 border-slate-700 bg-slate-900 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-pink-500 focus:outline-none"
            />
            <p className="text-sm text-slate-400">{lyrics.length.toLocaleString()} / {MAX_LYRICS_CHARS.toLocaleString()} letters</p>
          </div>

          {notice ? (
            <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
              {notice}
            </p>
          ) : null}

          <button type="button" onClick={() => void generate()} disabled={!ready || phase === 'working'} className={ready && phase !== 'working' ? BTN_PRIMARY : BTN_DISABLED}>
            {phase === 'working' ? 'Working on it…' : ready ? '✨ Generate' : 'Type or tap an idea first'}
          </button>
        </>
      )}
    </Screen>
  );
}
