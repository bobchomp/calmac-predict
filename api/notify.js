// api/notify.js
// Web Push notification management
// POST /api/notify { action: 'subscribe', route, subscription }
// POST /api/notify { action: 'unsubscribe', route, endpoint }
// POST /api/notify { action: 'send', route, message, chance }  (called by cron)
// GET  /api/notify  — returns public VAPID key

// VAPID keys — generate with: npx web-push generate-vapid-keys
// Add to Vercel env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
// Subscriptions stored in Upstash Redis (env vars added automatically when you connect it)

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:hello@willitsail.app';
const KV_URL        = process.env.UPSTASH_REDIS_REST_URL   || '';
const KV_TOKEN      = process.env.UPSTASH_REDIS_REST_TOKEN || '';

// ── Upstash Redis REST helpers ──────────────────────────────────────────
// Upstash REST API: POST /<command>/<args...>  with Bearer token
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
    method: 'GET', // Upstash supports GET for simple set commands
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

async function kvKeys(pattern) {
  if (!KV_URL) return [];
  const r = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const j = await r.json();
  return j.result || [];
}

// ── Web Push ────────────────────────────────────────────────────────────
async function sendPush(subscription, payload) {
  try {
    const webpush = await import('web-push');
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) return 'expired';
    return false;
  }
}

// ── Handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — return VAPID public key
  if (req.method === 'GET') {
    if (!VAPID_PUBLIC) {
      return res.status(200).json({ available: false, reason: 'Push not configured' });
    }
    return res.status(200).json({ available: true, publicKey: VAPID_PUBLIC });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { action, route, subscription, endpoint, message, chance } = body || {};

  // ── SUBSCRIBE ──
  if (action === 'subscribe') {
    if (!route || !subscription?.endpoint) {
      return res.status(400).json({ error: 'route and subscription required' });
    }
    if (!KV_URL) return res.status(200).json({ ok: true, note: 'KV not configured' });

    const key = `subs:${route.replace(/[^a-z0-9]/gi, '_')}`;
    const existing = (await kvGet(key)) || [];
    if (!existing.find(s => s.endpoint === subscription.endpoint)) {
      existing.push(subscription);
      await kvSet(key, existing);
    }
    return res.status(200).json({ ok: true, count: existing.length });
  }

  // ── UNSUBSCRIBE ──
  if (action === 'unsubscribe') {
    if (!route || !endpoint) return res.status(400).json({ error: 'route and endpoint required' });
    if (!KV_URL) return res.status(200).json({ ok: true });

    const key = `subs:${route.replace(/[^a-z0-9]/gi, '_')}`;
    const existing = (await kvGet(key)) || [];
    await kvSet(key, existing.filter(s => s.endpoint !== endpoint));
    return res.status(200).json({ ok: true });
  }

  // ── SEND (called by cron) ──
  if (action === 'send') {
    if (!route) return res.status(400).json({ error: 'route required' });
    if (!KV_URL || !VAPID_PUBLIC) return res.status(200).json({ ok: true, sent: 0, note: 'Push not configured' });

    const key = `subs:${route.replace(/[^a-z0-9]/gi, '_')}`;
    const subs = (await kvGet(key)) || [];
    if (!subs.length) return res.status(200).json({ ok: true, sent: 0 });

    const payload = {
      title: `\u26a0\ufe0f ${route}`,
      body: message || `Sailing chance has dropped to ${chance}% \u2014 check before you travel.`,
      icon: '/icon-120.png',
      badge: '/icon-120.png',
      data: { route, chance, url: `https://calmac-predict.vercel.app/?route=${encodeURIComponent(route)}` },
    };

    let sent = 0;
    const expired = [];
    for (const sub of subs) {
      const result = await sendPush(sub, payload);
      if (result === true) sent++;
      if (result === 'expired') expired.push(sub.endpoint);
    }

    if (expired.length) {
      const cleaned = subs.filter(s => !expired.includes(s.endpoint));
      await kvSet(key, cleaned);
    }

    return res.status(200).json({ ok: true, sent, expired: expired.length });
  }

  return res.status(400).json({ error: 'unknown action' });
};