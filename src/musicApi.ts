// Asks our own server to make a song, waits for it, and returns the sound.
export type MusicFail = 'off' | 'busy' | 'fail';

const post = (body: unknown) =>
  fetch('/api/music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

async function lengthOf(blob: Blob): Promise<number> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return buf.duration;
  } catch {
    return 30;
  }
}

export async function generateMusic(prompt: string, onTick: (seconds: number) => void): Promise<{ blob: Blob; seconds: number }> {
  const fail = (code: MusicFail) => Object.assign(new Error(code), { code });
  let start: Response;
  try {
    start = await post({ action: 'start', prompt });
  } catch {
    throw fail('fail');
  }
  if (start.status === 503) throw fail('off');
  if (start.status === 429) throw fail('busy');
  if (!start.ok) throw fail('fail');
  const { statusUrl, resultUrl } = (await start.json()) as { statusUrl: string; resultUrl: string };

  const began = Date.now();
  let url = '';
  while (Date.now() - began < 5 * 60_000) {
    await wait(3000);
    onTick(Math.round((Date.now() - began) / 1000));
    try {
      const c = await post({ action: 'check', statusUrl, resultUrl });
      if (!c.ok) throw fail('fail');
      const j = (await c.json()) as { done?: boolean; url?: string };
      if (j.done && j.url) {
        url = j.url;
        break;
      }
    } catch (e) {
      if ((e as { code?: string }).code === 'fail') throw e;
    }
  }
  if (!url) throw fail('fail');

  let blob: Blob | null = null;
  try {
    const d = await fetch(url);
    if (d.ok) blob = await d.blob();
  } catch {
    blob = null;
  }
  if (!blob) {
    const a = await post({ action: 'audio', url });
    if (!a.ok) throw fail('fail');
    blob = await a.blob();
  }
  return { blob, seconds: await lengthOf(blob) };
}
