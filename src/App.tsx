// src/App.tsx
import React, { useState } from 'react';
import { TimelineCanvas } from '../components/timeline/TimelineCanvas';
import { ApiKeyPanel } from '../components/settings/ApiKeyPanel';
import { useBillingStore } from '../store/billingStore';
import { MediaTrack } from '../types/timeline';

export default function App() {
  const { credits } = useBillingStore();
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [zoomLevel] = useState<number>(40);

  // Initial sample tracks for preview
  const [tracks] = useState<MediaTrack[]>([
    {
      id: 'track-1',
      name: 'AI Vocal & Audio Track',
      type: 'audio',
      muted: false,
      solo: false,
      clips: [
        { id: 'clip-1', trackId: 'track-1', name: 'Verse 1 - Kane Vicious', srcUrl: '', startTime: 0, duration: 8, trimLeft: 0, trimRight: 0 },
        { id: 'clip-2', trackId: 'track-1', name: 'Chorus - Heavy Synth', srcUrl: '', startTime: 10, duration: 12, trimLeft: 0, trimRight: 0 }
      ]
    },
    {
      id: 'track-2',
      name: 'Cinematic Visuals (Luma / LTX)',
      type: 'video',
      muted: false,
      solo: false,
      clips: [
        { id: 'clip-3', trackId: 'track-2', name: 'Sci-Fi Collider Shot', srcUrl: '', startTime: 2, duration: 15, trimLeft: 0, trimRight: 0 }
      ]
    }
  ]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <header className="flex justify-between items-center mb-8 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            CINE Studio
          </h1>
          <p className="text-xs text-slate-400">AI Audio, Music Video & Film Suite</p>
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-xs bg-indigo-950 border border-indigo-800 text-indigo-300 px-3 py-1.5 rounded-lg font-mono">
            Credits: {credits}
          </span>
        </div>
      </header>

      <main className="space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Multimodal Timeline</h2>
          <TimelineCanvas
            tracks={tracks}
            currentTime={currentTime}
            zoomLevel={zoomLevel}
            onSeek={(time) => setCurrentTime(time)}
          />
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Settings & BYO Keys</h2>
            <ApiKeyPanel />
          </div>
        </section>
      </main>
    </div>
  );
}
