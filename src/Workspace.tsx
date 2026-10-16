import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
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
  action: 'prompt' | 'upload' | 'beatbox';
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
  hint: 'Tap the squares to build a drum beat.',
  action: 'beatbox',
  kind: 'music',
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
    sections: [{ choices: [aiMusic(), ownSong(), beatBox()] }],
  },
  'music-video': {
    heading: "Let's make a music video!",
    intro: 'Start with your song. Then add your video.',
    sections: [
      { title: 'Step 1: Get your song', choices: [aiMusic('Song'), ownSong('Song'), beatBox('Song')] },
      { title: 'Step 2: Add your video', choices: [aiScene('Visuals'), ownVideo('Visuals')] },
    ],
  },
  'movie-sfx': {
    heading: "Let's make a movie!",
    intro: 'Make your scenes first. Then add sound effects.',
    sections: [
      { title: 'Step 1: Make your scenes', choices: [aiScene('Scenes'), ownVideo('Scenes')] },
      { title: 'Step 2: Add sound effects', choices: [aiSound('Sound FX'), ownSound('Sound FX')] },
    ],
  },
  'full-movie': {
    heading: "Let's make a big movie!",
    intro: 'Make your scenes, add sound effects, then add your soundtrack.',
    sections: [
      { title: 'Step 1: Make your scenes', choices: [aiScene('Scenes'), ownVideo('Scenes')] },
      { title: 'Step 2: Add sound effects', choices: [aiSound('Sound FX'), ownSound('Sound FX')] },
      { title: 'Step 3: Add your soundtrack', choices: [aiMusic('Soundtrack'), ownSong('Soundtrack'), beatBox('Soundtrack')] },
    ],
  },
  custom: {
    heading: "Let's make something!",
    intro: 'Tap a big button to start. You can try more than one.',
    sections: [
      { title: 'Make some sound', choices: [aiMusic(), ownSong(), beatBox()] },
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
  if (file.type) return file.type.startsWith(`${media}/`);
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  const known = media === 'audio' ? ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] : ['mp4', 'mov', 'm4v', 'webm'];
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
    setError(`This phone cannot play that ${noun}. Try a different one.`);
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
              accept={`${media}/*`}
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
/* BeatBox: a tap-the-squares drum machine                             */
/* ------------------------------------------------------------------ */

const STEPS = 8;
const BEAT_STORAGE_KEY = 'cine-beat-pattern';

interface BeatRow {
  id: 'boom' | 'clap' | 'tick' | 'ding';
  label: string;
  emoji: string;
  on: string;
  chance: number; // chance a square is on in "Surprise me"
}

const BEAT_ROWS: BeatRow[] = [
  { id: 'boom', label: 'Boom', emoji: '🥁', on: 'bg-pink-500 border-pink-300', chance: 0.3 },
  { id: 'clap', label: 'Clap', emoji: '👏', on: 'bg-amber-400 border-amber-200', chance: 0.25 },
  { id: 'tick', label: 'Tick', emoji: '⏱️', on: 'bg-sky-400 border-sky-200', chance: 0.5 },
  { id: 'ding', label: 'Ding', emoji: '🔔', on: 'bg-emerald-400 border-emerald-200', chance: 0.15 },
];

const TEMPOS = [
  { label: 'Slow', bpm: 90 },
  { label: 'Medium', bpm: 115 },
  { label: 'Fast', bpm: 140 },
];

type Pattern = boolean[][];

const STARTER: number[][] = [
  [1, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 1, 0],
  [1, 0, 1, 0, 1, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

const starterPattern = (): Pattern => STARTER.map((row) => row.map((v) => v === 1));

function loadPattern(): Pattern {
  try {
    const raw = window.localStorage.getItem(BEAT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.length === BEAT_ROWS.length &&
        parsed.every((row) => Array.isArray(row) && row.length === STEPS && row.every((v) => typeof v === 'boolean'))
      ) {
        return parsed as Pattern;
      }
    }
  } catch {
    // fall through to the starter beat
  }
  return starterPattern();
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function playSound(ctx: AudioContext, noise: AudioBuffer, id: BeatRow['id'], when: number): void {
  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(ctx.destination);

  if (id === 'boom') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, when);
    osc.frequency.exponentialRampToValueAtTime(40, when + 0.15);
    gain.gain.setValueAtTime(1, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
    osc.connect(gain);
    gain.connect(out);
    osc.start(when);
    osc.stop(when + 0.4);
  } else if (id === 'ding') {
    [880, 1760].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, when);
      gain.gain.setValueAtTime(i === 0 ? 0.5 : 0.18, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.6);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 0.65);
    });
  } else {
    // clap and tick are short bursts of filtered noise
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = noise;
    if (id === 'clap') {
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 0.8;
      gain.gain.setValueAtTime(0.9, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
    } else {
      filter.type = 'highpass';
      filter.frequency.value = 6500;
      gain.gain.setValueAtTime(0.5, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    }
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(when);
    src.stop(when + 0.25);
  }
}

function BeatBoxStep({ choice, modeLabel, onHome, onAdd }: ActivityProps) {
  const [pattern, setPattern] = useState<Pattern>(loadPattern);
  const [tempoIdx, setTempoIdx] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [added, setAdded] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const noiseRef = useRef<AudioBuffer | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const playingRef = useRef(false);
  const nextTimeRef = useRef(0);
  const stepRef = useRef(0);
  const patternRef = useRef(pattern);
  const bpmRef = useRef(TEMPOS[1].bpm);
  patternRef.current = pattern;
  bpmRef.current = TEMPOS[tempoIdx].bpm;

  useEffect(() => {
    try {
      window.localStorage.setItem(BEAT_STORAGE_KEY, JSON.stringify(pattern));
    } catch {
      // ignore
    }
  }, [pattern]);

  const ensureAudio = (): { ctx: AudioContext; noise: AudioBuffer } => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new Ctor();
      noiseRef.current = makeNoise(ctxRef.current);
    }
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
    return { ctx: ctxRef.current, noise: noiseRef.current as AudioBuffer };
  };

  const stop = () => {
    window.clearInterval(timerRef.current);
    playingRef.current = false;
    setPlaying(false);
    setActiveStep(-1);
  };

  const start = () => {
    const { ctx, noise } = ensureAudio();
    nextTimeRef.current = ctx.currentTime + 0.05;
    stepRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
    timerRef.current = window.setInterval(() => {
      while (nextTimeRef.current < ctx.currentTime + 0.15) {
        const step = stepRef.current;
        const when = nextTimeRef.current;
        BEAT_ROWS.forEach((row, r) => {
          if (patternRef.current[r][step]) playSound(ctx, noise, row.id, when);
        });
        window.setTimeout(() => {
          if (playingRef.current) setActiveStep(step);
        }, Math.max(0, (when - ctx.currentTime) * 1000));
        nextTimeRef.current += 60 / bpmRef.current / 2;
        stepRef.current = (step + 1) % STEPS;
      }
    }, 25);
  };

  useEffect(
    () => () => {
      window.clearInterval(timerRef.current);
      playingRef.current = false;
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    [],
  );

  const hear = (id: BeatRow['id']) => {
    const { ctx, noise } = ensureAudio();
    playSound(ctx, noise, id, ctx.currentTime);
  };

  const toggle = (r: number, i: number) => {
    const turningOn = !pattern[r][i];
    setPattern((prev) => prev.map((row, ri) => (ri === r ? row.map((v, vi) => (vi === i ? !v : v)) : row)));
    if (turningOn) hear(BEAT_ROWS[r].id);
  };

  const surprise = () => {
    setPattern(BEAT_ROWS.map((row) => Array.from({ length: STEPS }, () => Math.random() < row.chance)));
  };

  const clear = () => setPattern(BEAT_ROWS.map(() => Array<boolean>(STEPS).fill(false)));

  const hasSquares = pattern.some((row) => row.some(Boolean));

  const addIt = () => {
    if (!hasSquares) return;
    stop();
    onAdd({ name: 'My beat', type: 'audio', duration: 8, track: choice.track, from: choice.id });
    setAdded(true);
  };

  return (
    <Screen
      title="Make your beat!"
      subtitle="Tap the squares to turn sounds on. Then press Play to hear your beat."
      modeLabel={modeLabel}
      onBack={() => {
        stop();
        onHome();
      }}
      backLabel="← Back to my project"
    >
      {added ? (
        <DonePanel
          message="Your beat is on your timeline."
          againLabel="Keep making my beat"
          onAgain={() => setAdded(false)}
          onHome={onHome}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={playing ? stop : start}
            className={`w-full min-h-[64px] rounded-2xl text-xl font-bold ${FOCUS} ${
              playing ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
            }`}
          >
            {playing ? '■ Stop' : '▶ Play my beat'}
          </button>

          <div className="space-y-4">
            {BEAT_ROWS.map((row, r) => (
              <div key={row.id} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => hear(row.id)}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 text-base font-bold ${FOCUS}`}
                >
                  <span aria-hidden="true">{row.emoji}</span>
                  {row.label}
                  <span className="text-xs font-normal text-slate-400">tap to hear</span>
                </button>
                <div className="grid grid-cols-8 gap-1">
                  {pattern[r].map((on, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${row.label}, square ${i + 1}`}
                      onClick={() => toggle(r, i)}
                      className={`h-14 rounded-lg border-2 ${FOCUS} ${
                        on ? row.on : 'bg-slate-900 border-slate-700'
                      } ${activeStep === i ? (on ? 'brightness-150 border-white' : 'bg-slate-600 border-white') : ''}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-base font-bold">How fast?</p>
            <div className="grid grid-cols-3 gap-2">
              {TEMPOS.map((t, i) => (
                <button
                  key={t.label}
                  type="button"
                  aria-pressed={tempoIdx === i}
                  onClick={() => setTempoIdx(i)}
                  className={`min-h-[52px] rounded-xl text-base font-bold ${FOCUS} ${
                    tempoIdx === i ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={surprise} className={`${BTN_SECONDARY} min-h-[56px] text-lg`}>
              🎲 Surprise me
            </button>
            <button type="button" onClick={clear} className={`${BTN_SECONDARY} min-h-[56px] text-lg`}>
              🧹 Clear
            </button>
          </div>

          <button type="button" onClick={addIt} disabled={!hasSquares} className={hasSquares ? BTN_PRIMARY : BTN_DISABLED}>
            {hasSquares ? '✓ Add my beat to my project' : 'Tap some squares first'}
          </button>
        </>
      )}
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
    return <BeatBoxStep key={view.choice.id} {...props} />;
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
