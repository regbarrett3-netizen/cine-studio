import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import BeatBox from './BeatBox';
import Editor, { addClipToProject, readProjectClips } from './Editor';
import type { NewClip, ProjectClip } from './Editor';

// Flip to true once /api/generate really makes music, video and sound.
// While false, the "Make it" button saves the idea and says AI making is coming soon.
const GENERATION_IS_LIVE = false;

type Kind = 'music' | 'scene' | 'sfx';

interface Choice {
  id: string;
  emoji: string;
  title: string;
  hint: string;
  action: 'prompt' | 'upload' | 'beatbox' | 'record';
  kind: Kind; // what is being made: music, a video scene, or a sound effect
  track?: string; // preferred track name on the timeline
}

interface Section {
  title?: string;
  help?: string;
  choices: Choice[];
}

interface ModeConfig {
  heading: string;
  intro: string;
  sections: Section[];
}

const mediaOf = (kind: Kind): 'audio' | 'video' => (kind === 'scene' ? 'video' : 'audio');
const NOUN: Record<Kind, string> = { music: 'song', scene: 'video', sfx: 'sound' };

const aiMusic = (track?: string): Choice => ({
  id: 'prompt-music',
  emoji: '✨',
  title: 'Tell the AI what you want',
  hint: 'Type an idea. The AI makes the music.',
  action: 'prompt',
  kind: 'music',
  track,
});
const ownSong = (track?: string): Choice => ({
  id: 'upload-music',
  emoji: '📁',
  title: 'Use my own song',
  hint: 'Pick a song from your phone.',
  action: 'upload',
  kind: 'music',
  track,
});
const beatBox = (track?: string): Choice => ({
  id: 'beatbox',
  emoji: '🥁',
  title: 'BeatBox',
  hint: 'Play 9 drums or pick from 20 beats.',
  action: 'beatbox',
  kind: 'music',
  track,
});
const recordMic = (track?: string): Choice => ({
  id: 'record-music',
  emoji: '🎤',
  title: 'Record with my mic',
  hint: 'Sing, rap or play live on your phone.',
  action: 'record',
  kind: 'music',
  track,
});
const recordSound = (track?: string): Choice => ({
  id: 'record-sfx',
  emoji: '🎤',
  title: 'Record a sound',
  hint: 'Use your mic to catch a real sound.',
  action: 'record',
  kind: 'sfx',
  track,
});
const aiScene = (track?: string): Choice => ({
  id: 'prompt-scene',
  emoji: '✨',
  title: 'Tell the AI about a scene',
  hint: 'Type what happens. The AI makes the video.',
  action: 'prompt',
  kind: 'scene',
  track,
});
const ownVideo = (track?: string): Choice => ({
  id: 'upload-scene',
  emoji: '🎞️',
  title: 'Use my own videos',
  hint: 'Pick a video from your phone.',
  action: 'upload',
  kind: 'scene',
  track,
});
const aiSound = (track?: string): Choice => ({
  id: 'prompt-sfx',
  emoji: '✨',
  title: 'Tell the AI what sound you need',
  hint: 'Type a sound. The AI makes it.',
  action: 'prompt',
  kind: 'sfx',
  track,
});
const ownSound = (track?: string): Choice => ({
  id: 'upload-sfx',
  emoji: '🔊',
  title: 'Use my own sounds',
  hint: 'Pick a sound from your phone.',
  action: 'upload',
  kind: 'sfx',
  track,
});

const MODES: Record<string, ModeConfig> = {
  music: {
    heading: "Let's make music!",
    intro: 'Tap a big button to start. You can try more than one.',
    sections: [{ choices: [aiMusic(), ownSong(), beatBox(), recordMic()] }],
  },
  'music-video': {
    heading: "Let's make a music video!",
    intro: 'Start with your song. Then add your video.',
    sections: [
      { title: 'Step 1: Get your song', choices: [aiMusic('Song'), ownSong('Song'), beatBox('Song'), recordMic('Song')] },
      { title: 'Step 2: Add your video', choices: [aiScene('Visuals'), ownVideo('Visuals')] },
    ],
  },
  'movie-sfx': {
    heading: "Let's make a movie!",
    intro: 'Make your scenes first. Then add sound effects.',
    sections: [
      { title: 'Step 1: Make your scenes', choices: [aiScene('Scenes'), ownVideo('Scenes')] },
      { title: 'Step 2: Add sound effects', choices: [aiSound('Sound FX'), ownSound('Sound FX'), recordSound('Sound FX')] },
    ],
  },
  'full-movie': {
    heading: "Let's make a big movie!",
    intro: 'Make your scenes, add sound effects, then add your soundtrack.',
    sections: [
      { title: 'Step 1: Make your scenes', choices: [aiScene('Scenes'), ownVideo('Scenes')] },
      { title: 'Step 2: Add sound effects', choices: [aiSound('Sound FX'), ownSound('Sound FX'), recordSound('Sound FX')] },
      { title: 'Step 3: Add your soundtrack', choices: [aiMusic('Soundtrack'), ownSong('Soundtrack'), beatBox('Soundtrack'), recordMic('Soundtrack')] },
    ],
  },
  custom: {
    heading: "Let's make something!",
    intro: 'Tap a big button to start. You can try more than one.',
    sections: [
      { title: 'Make some sound', choices: [aiMusic(), ownSong(), beatBox(), recordMic()] },
      { title: 'Make some pictures', choices: [aiScene(), ownVideo()] },
    ],
  },
};

interface PromptConfig {
  heading: string;
  help: string;
  placeholder: string;
  examples: string[];
  button: string;
  label: string;
  model: string;
}

const PROMPTS: Record<Kind, PromptConfig> = {
  music: {
    heading: 'What music do you want?',
    help: 'Say it in your own words. Tell us how it feels or what is happening.',
    placeholder: 'A happy song for a sunny day',
    examples: [
      'A happy song for a sunny day',
      'Spooky music for a haunted house',
      'A fast, loud video game battle',
      'Calm music for a rainy day',
    ],
    button: '✨ Make my music!',
    label: 'Music',
    model: 'music',
  },
  scene: {
    heading: 'What happens in your scene?',
    help: 'Tell us who is there and what they do.',
    placeholder: 'A dragon flies over a castle at sunset',
    examples: [
      'A dragon flies over a castle',
      'Two kids build a rocket in the yard',
      'A robot dances in the rain',
      'A puppy finds a treasure map',
    ],
    button: '✨ Make my scene!',
    label: 'Scene',
    model: 'video',
  },
  sfx: {
    heading: 'What sound do you need?',
    help: 'Tell us the sound you want to hear.',
    placeholder: 'Thunder and heavy rain',
    examples: ['Thunder and rain', 'A door creaking open', 'Footsteps in the snow', 'A crowd cheering'],
    button: '✨ Make my sound!',
    label: 'Sound',
    model: 'sfx',
  },
};

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_CLIP_SECONDS = 600;

const shorten = (s: string, n = 42) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

const FOCUS = 'focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-white';
const BTN_PRIMARY = `w-full min-h-[64px] px-6 py-4 rounded-2xl font-bold text-lg bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 text-white shadow-lg shadow-pink-500/25 ${FOCUS}`;
const BTN_DISABLED = `w-full min-h-[64px] px-6 py-4 rounded-2xl font-bold text-lg bg-slate-800 text-slate-400 cursor-not-allowed ${FOCUS}`;
const BTN_SECONDARY = `min-h-[48px] px-4 py-2 rounded-xl text-base font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-100 ${FOCUS}`;

/* ------------------------------------------------------------------ */
/* Shared layout                                                       */
/* ------------------------------------------------------------------ */

interface ScreenProps {
  title: string;
  subtitle?: string;
  modeLabel: string;
  onBack: () => void;
  backLabel?: string;
  children: ReactNode;
}

function Screen({ title, subtitle, modeLabel, onBack, backLabel = '← Back', children }: ScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
        <button type="button" onClick={onBack} className={BTN_SECONDARY}>
          {backLabel}
        </button>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold truncate">
          ✓ {modeLabel}
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 py-6 space-y-6">
        <div className="space-y-2">
          <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-black leading-tight outline-none">
            {title}
          </h1>
          {subtitle ? <p className="text-slate-300 text-base leading-relaxed">{subtitle}</p> : null}
        </div>
        {children}
      </main>
    </div>
  );
}

interface DonePanelProps {
  message: string;
  againLabel: string;
  onAgain: () => void;
  onHome: () => void;
}

function DonePanel({ message, againLabel, onAgain, onHome }: DonePanelProps) {
  return (
    <div role="status" className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 space-y-4">
      <p className="text-2xl font-black text-emerald-300">🎉 Added to your project!</p>
      <p className="text-slate-200 leading-relaxed">{message}</p>
      <div className="grid gap-3">
        <button type="button" onClick={onHome} className={BTN_PRIMARY}>
          Back to my project
        </button>
        <button type="button" onClick={onAgain} className={`${BTN_SECONDARY} min-h-[56px] text-lg`}>
          {againLabel}
        </button>
      </div>
    </div>
  );
}

interface ActivityProps {
  choice: Choice;
  modeLabel: string;
  onHome: () => void;
  onAdd: (clip: NewClip) => void;
}

/* ------------------------------------------------------------------ */
/* Type an idea for the AI                                             */
/* ------------------------------------------------------------------ */

function PromptStep({ choice, modeLabel, onHome, onAdd }: ActivityProps) {
  const cfg = PROMPTS[choice.kind];
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'typing' | 'working' | 'done'>('typing');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const ready = text.trim().length >= 3;

  const submit = async () => {
    if (!ready || phase === 'working') return;
    const idea = text.trim();
    setNotice('');
    setPhase('working');

    let outcome: 'sent' | 'soon' | 'busy' = 'soon';
    if (GENERATION_IS_LIVE) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: idea, model: cfg.model, useByoKey: false }),
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
      setNotice('Lots of people are making things right now. Wait a minute, then tap the button again.');
      setPhase('typing');
      return;
    }

    onAdd({
      name: shorten(`${cfg.label}: ${idea}`),
      type: mediaOf(choice.kind),
      duration: 8,
      track: choice.track,
      from: choice.id,
    });
    setMessage(
      outcome === 'sent'
        ? 'Your idea was sent to the AI. It is saved in your project.'
        : 'AI making is coming soon! Your idea is saved in your project, so it will be ready when the AI is.',
    );
    setPhase('done');
  };

  const again = () => {
    setText('');
    setNotice('');
    setPhase('typing');
  };

  return (
    <Screen title={cfg.heading} subtitle={cfg.help} modeLabel={modeLabel} onBack={onHome} backLabel="← Back to my project">
      {phase === 'done' ? (
        <DonePanel message={message} againLabel="Make another idea" onAgain={again} onHome={onHome} />
      ) : (
        <>
          <div className="space-y-2">
            <label htmlFor="idea" className="block text-lg font-bold">
              Your idea
            </label>
            <textarea
              id="idea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              maxLength={300}
              placeholder={cfg.placeholder}
              className="w-full rounded-2xl bg-slate-900 border-2 border-slate-700 focus:border-pink-500 focus:outline-none px-4 py-3 text-lg text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <p className="text-base font-bold">Need an idea? Tap one:</p>
            <div className="flex flex-wrap gap-2">
              {cfg.examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setText(ex)}
                  className={`min-h-[48px] px-4 py-2 rounded-full text-base bg-slate-900 border border-slate-700 hover:border-pink-500 text-slate-100 text-left ${FOCUS}`}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {notice ? (
            <p role="alert" className="rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 px-4 py-3">
              {notice}
            </p>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={!ready || phase === 'working'}
            className={ready && phase !== 'working' ? BTN_PRIMARY : BTN_DISABLED}
          >
            {phase === 'working' ? 'Working on it…' : ready ? cfg.button : 'Type or tap an idea first'}
          </button>
        </>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Pick a file from the phone                                          */
/* ------------------------------------------------------------------ */

function looksLikeMedia(file: File, media: 'audio' | 'video'): boolean {
  if (file.type.startsWith(`${media}/`)) return true;
  // Phones often hand over files from Files / Drive / iCloud with an empty or
  // odd type, so fall back to the file extension.
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  const known =
    media === 'audio'
      ? ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'aif', 'aiff', 'caf', 'mp4']
      : ['mp4', 'mov', 'm4v', 'webm', '3gp'];
  return known.includes(ext);
}

function UploadStep({ choice, modeLabel, onHome, onAdd }: ActivityProps) {
  const media = mediaOf(choice.kind);
  const noun = NOUN[choice.kind];
  const [file, setFile] = useState<{ name: string; url: string } | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = ''; // lets the same file be picked again
    if (!picked) return;
    if (!looksLikeMedia(picked, media)) {
      setError(`Hmm, that does not look like a ${noun}. Try a different file.`);
      return;
    }
    if (picked.size > MAX_FILE_BYTES) {
      setError('That file is too big. Try a smaller one.');
      return;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(picked);
    urlRef.current = url;
    setError('');
    setDuration(null);
    setFile({ name: picked.name, url });
  };

  const onBroken = () => {
    setError(`This phone could not open that ${noun}. If it is in iCloud or Drive, download it to your phone first, then try again.`);
    setFile(null);
  };

  const useIt = () => {
    if (!file) return;
    const secs = duration !== null && Number.isFinite(duration) && duration > 0 ? duration : 8;
    onAdd({
      name: shorten(stripExt(file.name)),
      type: media,
      duration: Math.min(secs, MAX_CLIP_SECONDS),
      track: choice.track,
      from: choice.id,
    });
    setAdded(true);
  };

  const again = () => {
    setAdded(false);
    setFile(null);
    setDuration(null);
    setError('');
  };

  return (
    <Screen
      title={`Pick a ${noun}`}
      subtitle="Tap the big button, then choose a file from your phone. It stays on your phone and is not sent anywhere."
      modeLabel={modeLabel}
      onBack={onHome}
      backLabel="← Back to my project"
    >
      {added ? (
        <DonePanel
          message="Heads up: if you close this page, you will need to pick the file again to hear it."
          againLabel={`Pick another ${noun}`}
          onAgain={again}
          onHome={onHome}
        />
      ) : (
        <>
          <label
            className={`flex min-h-[88px] cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-pink-500/60 bg-slate-900 px-4 py-6 text-center text-xl font-bold hover:border-pink-400 focus-within:outline focus-within:outline-4 focus-within:outline-offset-2 focus-within:outline-white`}
          >
            <span aria-hidden="true">📁</span>
            <span>{file ? `Choose a different ${noun}` : `Choose a ${noun}`}</span>
            <input
              type="file"
              accept={
                media === 'audio'
                  ? 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.aif,.aiff'
                  : 'video/*,.mp4,.mov,.m4v,.webm'
              }
              onChange={onPick}
              className="sr-only"
              aria-label={`Choose a ${noun} from your phone`}
            />
          </label>

          {error ? (
            <p role="alert" className="rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 px-4 py-3">
              {error}
            </p>
          ) : null}

          {file ? (
            <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <p className="break-words text-lg font-bold">{file.name}</p>
              {media === 'audio' ? (
                <audio
                  key={file.url}
                  src={file.url}
                  controls
                  className="w-full"
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onError={onBroken}
                />
              ) : (
                <video
                  key={file.url}
                  src={file.url}
                  controls
                  playsInline
                  className="max-h-72 w-full rounded-xl bg-black"
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onError={onBroken}
                />
              )}
              <p className="text-slate-300">Tap play to listen. Happy with it?</p>
              <button type="button" onClick={useIt} className={BTN_PRIMARY}>
                ✓ Use this {noun}
              </button>
            </div>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Record live with the phone microphone                               */
/* ------------------------------------------------------------------ */

const MAX_REC_SECONDS = 600;
const REC_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

function pickRecType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return REC_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

const extOf = (mime: string) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : 'audio');

const clock = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Take {
  url: string;
  secs: number;
  ext: string;
}

function RecordStep({ choice, modeLabel, onHome, onAdd }: ActivityProps) {
  const noun = choice.kind === 'sfx' ? 'sound' : 'recording';
  const [phase, setPhase] = useState<'idle' | 'asking' | 'counting' | 'recording' | 'review'>('idle');
  const [error, setError] = useState('');
  const [count, setCount] = useState(3);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(true);
  const [take, setTake] = useState<Take | null>(null);
  const [added, setAdded] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [cleanup, setCleanup] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const peakRef = useRef(0);
  const urlRef = useRef<string | null>(null);
  const typeRef = useRef('');

  const releaseMic = () => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = null;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    setLevel(0);
  };

  useEffect(
    () => () => {
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
      releaseMic();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const finish = () => {
    const secs = (Date.now() - startRef.current) / 1000;
    const mime = recRef.current?.mimeType || typeRef.current || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];
    releaseMic();
    if (blob.size === 0) {
      setError('Nothing was recorded. Try again.');
      setPhase('idle');
      return;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setTake({ url, secs, ext: extOf(mime) });
    setPhase('review');
  };

  const beginRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      typeRef.current = pickRecType();
      const rec = new MediaRecorder(stream, typeRef.current ? { mimeType: typeRef.current } : undefined);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = finish;
      rec.onerror = () => {
        setError('Recording stopped by accident. Try again.');
        releaseMic();
        setPhase('idle');
      };
      rec.start(1000);
    } catch {
      releaseMic();
      setError('This phone could not start recording. Try Safari or Chrome.');
      setPhase('idle');
      return;
    }
    startRef.current = Date.now();
    peakRef.current = 0;
    setSeconds(0);
    setHeard(true);
    setPhase('recording');
    tickRef.current = window.setInterval(() => {
      const s = (Date.now() - startRef.current) / 1000;
      setSeconds(s);
      if (s > 2.5 && peakRef.current < 0.02) setHeard(false);
      else setHeard(true);
      if (s >= MAX_REC_SECONDS) stopRecording();
    }, 250);
  };

  const startMeter = (stream: MediaStream) => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      ctxRef.current = ctx;
      void ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const draw = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
        peakRef.current = Math.max(peakRef.current, peak);
        setLevel((prev) => Math.max(peak, prev * 0.85));
        rafRef.current = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      /* the meter is only a nicety, recording still works without it */
    }
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
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: cleanup, noiseSuppression: cleanup, autoGainControl: cleanup },
      });
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
    streamRef.current = stream;
    startMeter(stream);
    if (!countIn) {
      beginRecording();
      return;
    }
    let n = 3;
    setCount(n);
    setPhase('counting');
    tickRef.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (tickRef.current !== null) window.clearInterval(tickRef.current);
        tickRef.current = null;
        beginRecording();
      } else {
        setCount(n);
      }
    }, 1000);
  };

  const cancelCountdown = () => {
    releaseMic();
    setPhase('idle');
  };

  const stopRecording = () => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = null;
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const again = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setTake(null);
    setAdded(false);
    setError('');
    setPhase('idle');
  };

  const useIt = () => {
    if (!take) return;
    onAdd({
      name: shorten(`My ${noun}`),
      type: 'audio',
      duration: Math.max(1, Math.min(take.secs, MAX_CLIP_SECONDS)),
      track: choice.track,
      from: choice.id,
    });
    setAdded(true);
  };

  const saveLink = take ? (
    <a
      href={take.url}
      download={`my-${noun}.${take.ext}`}
      className={`${BTN_SECONDARY} flex min-h-[56px] items-center justify-center text-lg`}
    >
      ⬇ Save to my phone
    </a>
  ) : null;

  const toggleClass = (on: boolean) =>
    `flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border px-4 text-left text-base font-semibold ${FOCUS} ${
      on ? 'border-pink-500 bg-pink-500/10 text-white' : 'border-slate-700 bg-slate-900 text-slate-200'
    }`;

  return (
    <Screen
      title={choice.kind === 'sfx' ? 'Record a sound!' : 'Record live!'}
      subtitle="Sing, rap, play an instrument, or catch a real sound with your phone's microphone. It stays on your phone and is not sent anywhere."
      modeLabel={modeLabel}
      onBack={() => {
        releaseMic();
        onHome();
      }}
      backLabel="← Back to my project"
    >
      {error ? (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
          {error}
        </p>
      ) : null}

      {phase === 'idle' || phase === 'asking' ? (
        <>
          <button
            type="button"
            onClick={start}
            disabled={phase === 'asking'}
            className={`flex min-h-[96px] w-full items-center justify-center gap-3 rounded-2xl bg-rose-600 text-2xl font-black text-white shadow-lg shadow-rose-600/30 hover:bg-rose-500 ${FOCUS} ${
              phase === 'asking' ? 'opacity-70' : ''
            }`}
          >
            <span aria-hidden="true">🎤</span>
            {phase === 'asking' ? 'Tap Allow if your phone asks…' : 'Start recording'}
          </button>
          <div className="space-y-3">
            <button type="button" aria-pressed={countIn} onClick={() => setCountIn((v) => !v)} className={toggleClass(countIn)}>
              <span>⏱️ Count me in (3, 2, 1)</span>
              <span className="font-bold">{countIn ? 'On' : 'Off'}</span>
            </button>
            <button type="button" aria-pressed={cleanup} onClick={() => setCleanup((v) => !v)} className={toggleClass(cleanup)}>
              <span>
                🧼 Clean up background noise
                <span className="block text-sm font-normal text-slate-400">Good for talking. Turn it off for singing and music.</span>
              </span>
              <span className="font-bold">{cleanup ? 'On' : 'Off'}</span>
            </button>
          </div>
          <p className="text-slate-400">Tip: find a quiet spot and hold your phone close.</p>
        </>
      ) : null}

      {phase === 'counting' ? (
        <div role="status" aria-live="assertive" className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
          <p className="text-xl font-bold">Get ready…</p>
          <p className="text-8xl font-black text-pink-400">{count}</p>
          <button type="button" onClick={cancelCountdown} className={`${BTN_SECONDARY} min-h-[56px] text-lg`}>
            Cancel
          </button>
        </div>
      ) : null}

      {phase === 'recording' ? (
        <div className="space-y-4 rounded-2xl border border-rose-500/40 bg-slate-900 p-5 text-center">
          <p role="status" className="flex items-center justify-center gap-2 text-xl font-black text-rose-400">
            <span aria-hidden="true" className="inline-block h-4 w-4 animate-pulse rounded-full bg-rose-500" />
            Recording
          </p>
          <p className="text-6xl font-black tabular-nums" aria-label={`${clock(seconds)} recorded`}>
            {clock(seconds)}
          </p>
          <div aria-hidden="true" className="h-6 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full ${level > 0.9 ? 'bg-rose-500' : level > 0.6 ? 'bg-amber-400' : 'bg-emerald-400'}`}
              style={{ width: `${Math.min(100, Math.round(level * 100))}%` }}
            />
          </div>
          {!heard ? (
            <p role="alert" className="text-amber-200">
              I cannot hear anything yet. Check that your microphone is not covered.
            </p>
          ) : level > 0.9 ? (
            <p className="text-amber-200">Too loud! Move the phone a little farther away.</p>
          ) : (
            <p className="text-slate-300">The bar jumps when it hears you.</p>
          )}
          <button
            type="button"
            onClick={stopRecording}
            className={`min-h-[72px] w-full rounded-2xl bg-slate-100 text-2xl font-black text-slate-950 hover:bg-white ${FOCUS}`}
          >
            ■ Stop
          </button>
        </div>
      ) : null}

      {phase === 'review' && take ? (
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-lg font-bold">Your {noun} is {clock(take.secs)} long.</p>
          <audio key={take.url} src={take.url} controls className="w-full" />
          <p className="text-slate-300">Tap play to listen. Happy with it?</p>
          {added ? (
            <>
              <DonePanel
                message="Your recording is on your timeline. It only lives on this page, so tap Save to my phone if you want to keep the sound."
                againLabel="Record another"
                onAgain={again}
                onHome={onHome}
              />
              {saveLink}
            </>
          ) : (
            <div className="grid gap-3">
              <button type="button" onClick={useIt} className={BTN_PRIMARY}>
                ✓ Use this {noun}
              </button>
              {saveLink}
              <button type="button" onClick={again} className={`${BTN_SECONDARY} min-h-[56px] text-lg`}>
                🔁 Record again
              </button>
            </div>
          )}
        </div>
      ) : null}
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Home: the "what's next" choices                                     */
/* ------------------------------------------------------------------ */

type View =
  | { name: 'home' }
  | { name: 'activity'; choice: Choice }
  | { name: 'editor' };

interface WorkspaceProps {
  mode: string;
  modeLabel: string;
  onBack: () => void;
}

export default function Workspace({ mode, modeLabel, onBack }: WorkspaceProps) {
  const config = MODES[mode] ?? MODES.custom;
  const [view, setView] = useState<View>({ name: 'home' });
  const [clips, setClips] = useState<ProjectClip[]>(() => readProjectClips(mode));

  const viewKey = view.name === 'activity' ? `activity-${view.choice.id}` : view.name;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [viewKey]);

  const goHome = () => {
    setClips(readProjectClips(mode));
    setView({ name: 'home' });
  };

  const addClip = (clip: NewClip) => {
    addClipToProject(mode, clip);
    setClips(readProjectClips(mode));
  };

  if (view.name === 'editor') {
    return <Editor mode={mode} modeLabel={modeLabel} onBack={goHome} />;
  }

  if (view.name === 'activity') {
    const props: ActivityProps = { choice: view.choice, modeLabel, onHome: goHome, onAdd: addClip };
    if (view.choice.action === 'prompt') return <PromptStep key={view.choice.id} {...props} />;
    if (view.choice.action === 'upload') return <UploadStep key={view.choice.id} {...props} />;
    if (view.choice.action === 'record') return <RecordStep key={view.choice.id} {...props} />;
    return (
      <BeatBox
        key={view.choice.id}
        modeLabel={modeLabel}
        onHome={goHome}
        onAdd={addClip}
        track={view.choice.track}
        choiceId={view.choice.id}
      />
    );
  }

  return (
    <Screen title={config.heading} subtitle={config.intro} modeLabel={modeLabel} onBack={onBack} backLabel="← Home">
      {config.sections.map((section, si) => (
        <section key={section.title ?? `section-${si}`} className="space-y-3" aria-label={section.title}>
          {section.title ? <h2 className="text-xl font-bold text-pink-300">{section.title}</h2> : null}
          <div className="grid gap-3">
            {section.choices.map((choice) => {
              const count = clips.filter((c) => c.from === choice.id).length;
              return (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => setView({ name: 'activity', choice })}
                  className={`relative flex min-h-[96px] items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-left hover:border-pink-500 active:bg-slate-800 ${FOCUS}`}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-3xl"
                  >
                    {choice.emoji}
                  </span>
                  <span className="min-w-0 space-y-1">
                    <span className="block text-xl font-bold leading-snug">{choice.title}</span>
                    <span className="block text-base text-slate-300 leading-snug">{choice.hint}</span>
                    {count > 0 ? (
                      <span className="block text-sm font-semibold text-emerald-400">✓ {count} added</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <section aria-labelledby="project-heading" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 id="project-heading" className="text-xl font-bold">
          My project
        </h2>
        {clips.length === 0 ? (
          <p className="text-slate-300">Nothing here yet. Tap a big button above to start!</p>
        ) : (
          <ul className="space-y-2">
            {clips.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-xl bg-slate-900 px-3 py-2">
                <span aria-hidden="true" className="text-xl">
                  {c.type === 'audio' ? '🎵' : '🎬'}
                </span>
                <span className="min-w-0 break-words text-base">{c.name}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => setView({ name: 'editor' })} className={`${BTN_SECONDARY} w-full min-h-[56px] text-lg`}>
          🎛️ Arrange my project
        </button>
        <p className="text-sm text-slate-400">Move, cut and line up your clips on a timeline.</p>
      </section>
    </Screen>
  );
}
