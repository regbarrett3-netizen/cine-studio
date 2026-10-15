// utils/audioAnalyzer.ts

export async function analyzeAudioWaveform(audioUrl: string, sampleCount: number = 100): Promise<number[]> {
  try {
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();
    
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const rawData = audioBuffer.getChannelData(0); // Use left channel
    
    const blockSize = Math.floor(rawData.length / sampleCount);
    const filteredData: number[] = [];
    
    for (let i = 0; i < sampleCount; i++) {
      let blockStart = blockSize * i;
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[blockStart + j]);
      }
      filteredData.push(sum / blockSize);
    }
    
    // Normalize values between 0.0 and 1.0
    const maxVal = Math.max(...filteredData, 0.001);
    return filteredData.map(val => val / maxVal);
  } catch (error) {
    console.error('Error analyzing audio waveform:', error);
    return new Array(sampleCount).fill(0.5); // Fallback flat waveform
  }
}
