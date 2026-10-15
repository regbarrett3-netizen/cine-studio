// types/timeline.ts

export type TrackType = 'audio' | 'video' | 'overlay';

export interface MediaClip {
  id: string;
  trackId: string;
  name: string;
  srcUrl: string;
  startTime: number; // Seconds on timeline
  duration: number;  // Duration in seconds
  trimLeft: number;  // Offset in source media
  trimRight: number;
}

export interface MediaTrack {
  id: string;
  name: string;
  type: TrackType;
  muted: boolean;
  solo: boolean;
  clips: MediaClip[];
}

export interface TimelineState {
  currentTime: number;
  zoomLevel: number;
  isPlaying: boolean;
  tracks: MediaTrack[];
}
