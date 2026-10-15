// utils/storyboardAgent.ts

export interface StoryboardScene {
  sceneNumber: number;
  scriptLine: string;
  visualPrompt: string;
  cameraMotion: string;
  estimatedDuration: number;
}

export function generateStoryboardFromScript(scriptText: string): StoryboardScene[] {
  const lines = scriptText.split('\n').filter(line => line.trim().length > 0);
  
  return lines.map((line, index) => ({
    sceneNumber: index + 1,
    scriptLine: line,
    visualPrompt: `Cinematic scene depicting: "${line}". High detail, dramatic lighting, 8k resolution.`,
    cameraMotion: index % 2 === 0 ? 'dolly-in' : 'orbit',
    estimatedDuration: 5.0,
  }));
}
