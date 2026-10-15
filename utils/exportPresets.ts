// utils/exportPresets.ts

export interface ExportPreset {
  name: string;
  resolution: { width: number; height: number };
  aspectRatio: string;
  fps: number;
  videoBitrate: string;
  audioBitrate: string;
}

export const EXPORT_PRESETS: Record<string, ExportPreset> = {
  CINEMATIC_4K: {
    name: 'Cinematic 4K',
    resolution: { width: 3840, height: 2160 },
    aspectRatio: '16:9',
    fps: 60,
    videoBitrate: '50Mbps',
    audioBitrate: '320kbps',
  },
  SOCIAL_REELS: {
    name: 'Social Reels / TikTok',
    resolution: { width: 1080, height: 1920 },
    aspectRatio: '9:16',
    fps: 30,
    videoBitrate: '15Mbps',
    audioBitrate: '192kbps',
  },
  WEB_PREVIEW: {
    name: 'Fast Web Preview',
    resolution: { width: 1280, height: 720 },
    aspectRatio: '16:9',
    fps: 30,
    videoBitrate: '5Mbps',
    audioBitrate: '128kbps',
  },
};
