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
  hint: 'Play 9 drums or pick from 20 beats.',
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
