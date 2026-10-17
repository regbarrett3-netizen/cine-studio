import React, { useState } from 'react';

import Workspace from './Workspace';
import { readSaved, removeSaved } from './Flow';
import type { SavedProject } from './Flow';

const GOALS = [
  { id: 'music', label: 'Music', emoji: '🎵', desc: 'Make a song: beats, keys, your voice.', color: 'from-purple-500 to-indigo-500' },
  { id: 'music-video', label: 'Music Video', emoji: '💿', desc: 'A song plus a video made by AI.', color: 'from-pink-500 to-rose-500' },
  { id: 'full-movie', label: 'Movie', emoji: '🎬', desc: 'Scenes, sound effects and a soundtrack.', color: 'from-amber-500 to-orange-500' },
];
const LABEL: Record<string, string> = { music: 'Music', 'music-video': 'Music Video', 'movie-sfx': 'Movie', 'full-movie': 'Movie' };

export default function App() {
  const [goal, setGoal] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedProject[]>(() => readSaved());

  if (goal) {
    return (
      <Workspace
        mode={goal}
        modeLabel={LABEL[goal] ?? 'Project'}
        onBack={() => {
          setSaved(readSaved());
          setGoal(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Banner */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </div>
            <div>
              <span className="font-bold text-lg bg-gradient-to-r from-purple-400 via-pink-400 to-red-400 bg-clip-text text-transparent">
                CINE Studio
              </span>
              <span className="ml-2 text-xs text-purple-400 font-semibold px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded-full">
                #1 AI Studio
              </span>
            </div>
          </div>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-6 pt-10 pb-6 text-center space-y-3">
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white leading-tight">
          What do you want to{' '}
          <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">make?</span>
        </h1>
        <p className="text-slate-400 text-base">Tap one to start.</p>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-6">
        <div className="grid grid-cols-1 gap-4">
          {GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGoal(g.id)}
              className="flex min-h-[104px] items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-left transition-all hover:border-pink-500 active:bg-slate-800 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${g.color} text-4xl`} aria-hidden="true">
                {g.emoji}
              </span>
              <span className="space-y-1">
                <span className="block text-3xl font-black text-white">{g.label}</span>
                <span className="block text-base text-slate-400">{g.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {saved.length > 0 ? (
        <section aria-label="Saved projects" className="max-w-3xl mx-auto px-6 pb-8 space-y-3">
          <h2 className="text-xl font-bold text-pink-300">💾 My saved projects</h2>
          {saved.map((s) => (
            <div key={s.mode} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGoal(s.mode)}
                className="min-h-[64px] flex-1 rounded-2xl border border-slate-800 bg-slate-900 px-4 text-left hover:border-pink-500 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <span className="block text-lg font-bold">Finish my {s.label}</span>
                <span className="block text-sm text-slate-400">
                  {s.count} {s.count === 1 ? 'thing' : 'things'} added · saved {new Date(s.savedAt).toLocaleDateString()}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove saved ${s.label} from this list`}
                onClick={() => {
                  removeSaved(s.mode);
                  setSaved(readSaved());
                }}
                className="min-h-[64px] min-w-[56px] rounded-2xl border border-slate-800 bg-slate-900 text-xl hover:border-rose-500 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                ✕
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {/* Step-by-Step 4th-Grader Guide */}
      <section className="max-w-5xl mx-auto px-6 py-12 border-t border-slate-800/80">
        <div className="text-center mb-10 space-y-2">
          <span className="text-xs font-semibold text-purple-400 tracking-wider uppercase">Child's Play Simple</span>
          <h2 className="text-2xl font-bold text-white">How It Works (3 Easy Steps)</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl space-y-3 relative">
            <span className="text-3xl font-black text-purple-500/40">01</span>
            <h3 className="font-bold text-white text-base">Type Your Idea</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Describe what you want to hear or see in plain words. Example: <i>"A futuristic cyberpunk car chase with heavy 808 bass."</i>
            </p>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl space-y-3 relative">
            <span className="text-3xl font-black text-pink-500/40">02</span>
            <h3 className="font-bold text-white text-base">Press Generate</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Our AI automatically builds your stems, synthesizes sound effects, and crafts high-definition video clips.
            </p>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl space-y-3 relative">
            <span className="text-3xl font-black text-red-500/40">03</span>
            <h3 className="font-bold text-white text-base">Export & Share</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Watch your finished scene or music video right away, download in 4K, and share it with the world!
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
