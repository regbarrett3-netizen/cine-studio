// api/music.ts
// Makes songs with fal.ai. The key lives only on the server (FAL_KEY).
// Nothing is made unless MUSIC_ENABLED is exactly "true" in Vercel.
import type { VercelRequest, VercelResponse } from '@vercel/node';

const MODEL = 'fal-ai/lyria3/pro';
const QUEUE = 'https://queue.fal.run/fal-ai/lyria3/';
const MAX_PROMPT = 3500;
const PER_MINUTE = 4; // submits per minute per IP
const DAILY_CAP = Number(process.env.MUSIC_DAILY_CAP ?? '40'); // songs per day per server copy

const hits = new Map<string, number[]>();
let dayKey = '';
let dayCount = 0;

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_MINUTE) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

function dayFull(): boolean {
  const k = new Date().toISOString().slice(0, 10);
  if (k !== dayKey) {
    dayKey = k;
    dayCount = 0;
  }
  return dayCount >= DAILY_CAP;
}

const ip = (req: VercelRequest) => {
  const f = req.headers['x-forwarded-for'];
  return ((Array.isArray(f) ? f[0] : f) ?? '').split(',')[0].trim() || 'unknown';
};

const okUrl = (u: unknown): u is string => typeof u === 'string' && u.length < 400 && u.startsWith(QUEUE) && !/\s/.test(u);
const okAudio = (u: unknown): u is string => {
  if (typeof u !== 'string' || u.length > 600) return false;
  try {
    const h = new URL(u);
    return h.protocol === 'https:' && /(^|\.)(fal\.media|fal\.run|fal\.ai)$/.test(h.hostname);
  } catch {
    return false;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const key = process.env.FAL_KEY;
  if (process.env.MUSIC_ENABLED !== 'true' || !key) {
    return res.status(503).json({ error: 'off' });
  }
  const auth = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};

  try {
    if (body.action === 'start') {
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (prompt.length < 3 || prompt.length > MAX_PROMPT) {
        return res.status(400).json({ error: `Write between 3 and ${MAX_PROMPT} characters.` });
      }
      if (limited(ip(req))) return res.status(429).json({ error: 'busy' });
      if (dayFull()) return res.status(429).json({ error: 'busy' });
      const r = await fetch(`https://queue.fal.run/${MODEL}`, { method: 'POST', headers: auth, body: JSON.stringify({ prompt }) });
      if (!r.ok) return res.status(502).json({ error: 'fail' });
      const j = (await r.json()) as { status_url?: unknown; response_url?: unknown };
      if (!okUrl(j.status_url) || !okUrl(j.response_url)) return res.status(502).json({ error: 'fail' });
      dayCount += 1;
      return res.status(200).json({ statusUrl: j.status_url, resultUrl: j.response_url });
    }

    if (body.action === 'check') {
      if (!okUrl(body.statusUrl) || !okUrl(body.resultUrl)) return res.status(400).json({ error: 'Bad request.' });
      const s = await fetch(body.statusUrl, { headers: auth });
      if (!s.ok) return res.status(502).json({ error: 'fail' });
      const st = (await s.json()) as { status?: string };
      if (st.status !== 'COMPLETED') return res.status(200).json({ done: false });
      const rr = await fetch(body.resultUrl, { headers: auth });
      if (!rr.ok) return res.status(502).json({ error: 'fail' });
      const out = (await rr.json()) as { audio?: { url?: unknown } };
      const url = out.audio?.url;
      if (!okAudio(url)) return res.status(502).json({ error: 'fail' });
      return res.status(200).json({ done: true, url });
    }

    if (body.action === 'audio') {
      if (!okAudio(body.url)) return res.status(400).json({ error: 'Bad request.' });
      const a = await fetch(body.url);
      if (!a.ok) return res.status(502).json({ error: 'fail' });
      const buf = Buffer.from(await a.arrayBuffer());
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(buf);
    }

    return res.status(400).json({ error: 'Bad request.' });
  } catch (e) {
    console.error('music api error:', e instanceof Error ? e.message : 'unknown');
    return res.status(500).json({ error: 'fail' });
  }
}
