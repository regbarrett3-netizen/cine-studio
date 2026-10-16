// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const MAX_PROMPT_LENGTH = 2000;
const MAX_KEY_LENGTH = 256;
const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // per minute, per client IP

// Best-effort limiter. Serverless instances do not share memory, so this only
// slows down abuse that lands on one instance. Real limits need a shared store.
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}

function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (first ?? '').split(',')[0].trim() || 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (rateLimited(clientIp(req))) {
    res.setHeader('Retry-After', String(Math.ceil(RATE_WINDOW_MS / 1000)));
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

  try {
    const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const { prompt, model, customApiKey, useByoKey } = body as {
      prompt?: unknown;
      model?: unknown;
      customApiKey?: unknown;
      useByoKey?: unknown;
    };

    if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
      return res
        .status(400)
        .json({ error: `Prompt must be text between 1 and ${MAX_PROMPT_LENGTH} characters.` });
    }
    if (typeof model !== 'string' || !/^[a-z0-9._-]{1,64}$/i.test(model)) {
      return res.status(400).json({ error: 'Model must be a short identifier such as "luma-ray".' });
    }

    // Decide which key pays for this request.
    let apiKey: string | undefined;
    if (useByoKey === true) {
      if (typeof customApiKey !== 'string' || customApiKey.length === 0 || customApiKey.length > MAX_KEY_LENGTH) {
        return res.status(400).json({ error: 'A valid custom API key is required when using your own key.' });
      }
      apiKey = customApiKey;
    } else {
      // The platform key spends real money. Credits only exist in the browser,
      // so the server cannot verify them. Keep this path off until the server
      // has real accounts and a credit balance it can check.
      if (process.env.PLATFORM_KEY_ENABLED !== 'true') {
        return res.status(403).json({
          error: 'Platform credits are not available yet. Add your own API key to generate.',
        });
      }
      apiKey = process.env.DEFAULT_AI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'The server is not configured for platform generation.' });
      }
    }

    // Mock dispatch. Replace with the real Luma / LTX / Suno call when live.
    // Never log the prompt or any key.
    void apiKey;

    return res.status(200).json({
      success: true,
      message: 'Generation task dispatched successfully',
      model,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Generation API error:', error instanceof Error ? error.message : 'unknown error');
    return res.status(500).json({ error: 'Internal server error during generation dispatch.' });
  }
}
