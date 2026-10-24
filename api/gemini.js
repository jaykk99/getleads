// Vercel serverless function: proxies Gemini calls so the real API key
// stays server-side. The frontend used to call Google directly with
// import.meta.env.VITE_GEMINI_API_KEY -- any VITE_-prefixed var gets
// inlined into the public JS bundle at build time, so that key was
// extractable by anyone who opened dev tools, independent of this app's
// own Solana payment gate. GEMINI_API_KEY (no VITE_ prefix) is a plain
// server env var: Vite never sees or bundles it, and it's only read here,
// at request time, inside this function.
//
// GET  /api/gemini  -> { ok: true, hasKey: boolean } status check (no
//                       key material -- just whether one is configured),
//                       used by the frontend to show "AI Live" vs "Keyless".
// POST /api/gemini  -> forwards the request body as-is to Gemini's
//                       generateContent endpoint and relays the response.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, hasKey: GEMINI_API_KEY.length > 0 }));
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'POST only' }));
  }

  if (!GEMINI_API_KEY) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Gemini API key is not configured on the server (GEMINI_API_KEY env var).' }));
  }

  try {
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const upstream = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json');
    return res.end(text);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Failed to reach Gemini: ' + (err && err.message || String(err)) }));
  }
}
