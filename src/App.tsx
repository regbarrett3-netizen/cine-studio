import React, { useState } from 'react';
import Workspace from './Workspace';

export default function App() {
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);
if (showWorkspace) return <Workspace mode={selectedGoal ?? 'custom'} modeLabel={({ music: 'Make Just Music', 'music-video': 'Music + Music Video', 'movie-sfx': 'Movie + Sound Effects', 'full-movie': 'Movie + SFX + Soundtrack' } as Record<string, string>)[selectedGoal ?? ''] || 'Custom Project'} onBack={() => setShowWorkspace(false)} />;


  const projectGoals = [
    {
      id: 'music',
      title: 'Make Just Music',
      desc: 'Generate beat loops, stems, and full 808 audio tracks in seconds.',
      color: 'from-purple-500 to-indigo-500'
    },
    {
      id: 'music-video',
      title: 'Music + Music Video',
      desc: 'Sync dynamic visuals and video clips directly to your song.',
      color: 'from-pink-500 to-rose-500'
    },
    {
      id: 'movie-sfx',
      title: 'Movie + Sound Effects',
      desc: 'Build cinematic film scenes packed with realistic background SFX.',
      color: 'from-amber-500 to-orange-500'
    },
    {
      id: 'full-movie',
      title: 'Movie + SFX + Soundtrack',
      desc: 'The complete Hollywood package: dialogue, SFX, and custom score.',
      color: 'from-emerald-500 to-teal-500'
    }
  ];

  if (showWorkspace) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6 flex flex-col items-center justify-center">
        <div className="max-w-xl text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
            ✓ Mode Active: {projectGoals.find(g => g.id === selectedGoal)?.title || 'Custom Project'}
          </div>
          <h1 className="text-3xl font-bold">Welcome to CINE Studio</h1>
          <p className="text-slate-400 text-sm">Your workspace is calibrated and ready. Add your first scene to begin.</p>
          <button 
            onClick={() => setShowWorkspace(false)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
          >
            ← Back to Landing Page
          </button>
        </div>
      </div>
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
          <button 
            onClick={() => setShowWorkspace(true)}
            className="text-xs font-semibold text-slate-300 hover:text-white border border-slate-700 px-4 py-2 rounded-xl bg-slate-900"
          >
            Skip to Canvas →
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-5xl mx-auto px-6 pt-12 pb-8 text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-400 text-xs font-semibold">
          ✨ The Most Powerful & Simple AI Studio on the Planet
        </div>
        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white leading-tight">
          Make Hit Songs & Movies <br />
          <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
            In 3 Simple Steps
          </span>
        </h1>
        <p className="text-slate-400 max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
          So easy a 4th grader can create a full cinematic movie in minutes. No complex software, no learning curve—just pure creativity.
        </p>
      </section>

      {/* Project Selector Section */}
      <section className="max-w-5xl mx-auto px-6 py-8">
        <div className="text-center mb-8">
          <h2 className="text-xl font-bold text-white">What do you want to build today?</h2>
          <p className="text-slate-400 text-xs mt-1">Pick a goal to auto-configure your studio workspace</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projectGoals.map((goal) => {
            const isSelected = selectedGoal === goal.id;
            return (
              <button
                key={goal.id}
                onClick={() => setSelectedGoal(goal.id)}
                className={`p-5 rounded-2xl border text-left transition-all flex items-start gap-4 relative overflow-hidden ${
                  isSelected 
                    ? 'bg-slate-900 border-pink-500 ring-2 ring-pink-500/50 scale-[1.01]' 
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className={`p-3 rounded-xl bg-gradient-to-br ${goal.color} text-white font-bold text-lg`}>
                  {goal.id === 'music' ? '🎵' : goal.id === 'music-video' ? '💿' : goal.id === 'movie-sfx' ? '🎬' : '🎥'}
                </div>
                <div className="space-y-1 pr-6">
                  <h3 className="font-bold text-white text-base">{goal.title}</h3>
                  <p className="text-slate-400 text-xs leading-relaxed">{goal.desc}</p>
                </div>
                {isSelected && (
                  <div className="absolute top-4 right-4 text-pink-400 font-bold">
                    ✓
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* CTA Launch Button */}
        <div className="mt-8 text-center">
          <button
            onClick={() => setShowWorkspace(true)}
            disabled={!selectedGoal}
            className={`px-8 py-4 rounded-2xl font-bold text-sm transition-all flex items-center gap-3 mx-auto shadow-lg ${
              selectedGoal
                ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 text-white hover:opacity-95 shadow-pink-500/25 cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <span>{selectedGoal ? 'Open My Studio Canvas' : 'Pick a goal above to start'}</span>
            <span>→</span>
          </button>
        </div>
      </section>

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
