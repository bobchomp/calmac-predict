// api/user.js
// Syncs user preferences (favourites) across devices using Clerk auth + Upstash Redis
// GET  /api/user        → returns { favs: [...] }
// POST /api/user        → body: { favs: [...] }  → saves and returns { ok: true }

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL   || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || '';

// ── Verify Clerk session token ───────────────────────────────────────────
async function getUserId(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  try {
    const res = await fetch('https://api.clerk.com/v1/tokens/verify', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.sub || null; // sub = userId
  } catch {
    return null;
  }
}

// ── Upstash helpers ──────────────────────────────────────────────────────
async function kvGet(key) {
  if (!KV_URL) return null;
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}

async function kvSet(key, value) {
  if (!KV_URL) return;
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

// ── Handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const key = `user:${userId}:favs`;

  if (req.method === 'GET') {
    const favs = (await kvGet(key)) || [];
    return res.status(200).json({ favs });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const favs = Array.isArray(body?.favs) ? body.favs : [];
    await kvSet(key, favs);
    return res.status(200).json({ ok: true, favs });
  }

  return res.status(405).end();
};