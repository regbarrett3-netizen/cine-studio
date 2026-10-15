// components/timeline/TimelineCanvas.tsx
import React, { useRef, useEffect } from 'react';
import { MediaTrack } from '../../types/timeline';

interface TimelineCanvasProps {
  tracks: MediaTrack[];
  currentTime: number;
  zoomLevel: number;
  onSeek: (time: number) => void;
}

export const TimelineCanvas: React.FC<TimelineCanvasProps> = ({
  tracks,
  currentTime,
  zoomLevel,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#0f172a'; // Slate-900 background
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw playhead & time grid
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;

    let yOffset = 40;
    tracks.forEach((track, trackIdx) => {
      // Draw track header background
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(10, yOffset, canvas.width - 20, 50);

      // Draw clips
      track.clips.forEach((clip) => {
        const startX = 150 + clip.startTime * zoomLevel;
        const width = clip.duration * zoomLevel;
        ctx.fillStyle = trackIdx % 2 === 0 ? '#3b82f6' : '#8b5cf6';
        ctx.fillRect(startX, yOffset + 5, width, 40);

        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.fillText(clip.name, startX + 8, yOffset + 28);
      });

      yOffset += 60;
    });

    // Draw Playhead line
    const playheadX = 150 + currentTime * zoomLevel;
    ctx.strokeStyle = '#ef4444'; // Red-500 playhead
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 20);
    ctx.lineTo(playheadX, canvas.height);
    ctx.stroke();

  }, [tracks, currentTime, zoomLevel]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    if (clickX > 150) {
      const newTime = (clickX - 150) / zoomLevel;
      onSeek(Math.max(0, newTime));
    }
  };

  return (
    <div className="overflow-x-auto bg-slate-950 p-4 rounded-xl border border-slate-800">
      <canvas
        ref={canvasRef}
        width={1200}
        height={300}
        onClick={handleCanvasClick}
        className="cursor-pointer rounded-lg shadow-inner"
      />
    </div>
  );
};
