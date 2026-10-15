import React, { useState } from 'react';

export default function App() {
  const [isLaunched, setIsLaunched] = useState(false);

  if (!isLaunched) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-6 bg-slate-900/80 p-8 rounded-2xl border border-slate-800 backdrop-blur">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
            CINE Studio
          </h1>
          <p className="text-slate-400 text-sm">
            The all-in-one AI audio, music video, and film production suite.
          </p>
          <button
            onClick={() => setIsLaunched(true)}
            className="w-full py-3 px-6 rounded-xl font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg transition-all transform active:scale-95 cursor-pointer"
          >
            Launch Production Suite
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <header className="flex justify-between items-center border-b border-slate-800 pb-4 mb-6">
        <h1 className="text-xl font-bold tracking-wide">CINE Studio Suite</h1>
        <button
          onClick={() => setIsLaunched(false)}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300"
        >
          Exit Suite
        </button>
      </header>
      <main className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <h2 className="font-semibold mb-2">1. Audio Engine</h2>
          <p className="text-xs text-slate-400">Generative stems and multi-track arrangement.</p>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <h2 className="font-semibold mb-2">2. Visual Timeline</h2>
          <p className="text-xs text-slate-400">Multimodal track sequencing and video sync.</p>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <h2 className="font-semibold mb-2">3. Render & Export</h2>
          <p className="text-xs text-slate-400">Final audio-visual sync and master delivery.</p>
        </div>
      </main>
    </div>
  );
}
