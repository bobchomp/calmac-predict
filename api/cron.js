// api/cron.js
// Vercel cron job — runs every 10 minutes via vercel.json
// Checks weather for all routes with active subscribers, sends push if < 70%

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://calmac-predict.vercel.app';

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL   || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const NOTIFY_THRESHOLD = 70; // send push when chance falls below this %

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

async function kvKeys(pattern) {
  if (!KV_URL) return [];
  const r = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const j = await r.json();
  return j.result || [];
}

// ── Route midpoint coords for weather lookup ──────────────────────────────
const ROUTE_COORDS = {
  'Ullapool - Stornoway (Lewis)':                      { lat: 58.05, lon: -5.85 },
  'Troon - Brodick (Arran)':                           { lat: 55.60, lon: -5.00 },
  'Ardrossan - Brodick (Arran)':                       { lat: 55.60, lon: -5.10 },
  'Oban - Craignure (Mull)':                           { lat: 56.49, lon: -5.56 },
  'Kennacraig - Port Ellen / Port Askaig (Islay)':     { lat: 55.75, lon: -5.90 },
  'Wemyss Bay - Rothesay (Bute)':                      { lat: 55.88, lon: -5.02 },
  'Gourock - Dunoon':                                  { lat: 55.96, lon: -4.86 },
  'Tarbert - Portavadie':                              { lat: 55.88, lon: -5.42 },
  'Fishnish - Lochaline':                              { lat: 56.53, lon: -5.72 },
  'Mallaig - Armadale (Skye)':                         { lat: 57.04, lon: -5.82 },
  'Uig - Tarbert / Lochmaddy':                         { lat: 57.65, lon: -6.75 },
  'Oban - Coll / Tiree':                               { lat: 56.55, lon: -6.50 },
  'Oban - Castlebay / Lochboisdale':                   { lat: 56.70, lon: -7.00 },
  'Oban - Colonsay':                                   { lat: 56.15, lon: -6.10 },
  'Claonaig - Lochranza (Arran)':                      { lat: 55.73, lon: -5.17 },
  'Colintraive - Rhubodach (Bute)':                    { lat: 55.92, lon: -5.15 },
  'Largs - Cumbrae Slip':                              { lat: 55.81, lon: -4.90 },
  'Oban - Lismore':                                    { lat: 56.52, lon: -5.47 },
  'Mallaig - Small Isles':                             { lat: 56.98, lon: -6.10 },
  'Tobermory - Kilchoan':                              { lat: 56.69, lon: -6.07 },
};

async function getLastSent(route) {
  const key = `lastsent:${route.replace(/[^a-z0-9]/gi, '_')}`;
  const val = await kvGet(key);
  return val ? parseInt(val) : 0;
}

async function setLastSent(route) {
  const key = `lastsent:${route.replace(/[^a-z0-9]/gi, '_')}`;
  await kvSet(key, Date.now());
}

// ── Handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Vercel cron auth
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!KV_URL) return res.status(200).json({ ok: true, note: 'KV not configured' });

  try {
    const subKeys = await kvKeys('subs:*');
    if (!subKeys.length) return res.status(200).json({ ok: true, checked: 0 });

    const results = [];

    for (const key of subKeys) {
      // Derive route name from key — e.g. "subs:Ullapool___Stornoway__Lewis_"
      const routeSlug = key.replace(/^subs:/, '');
      // Find matching route by comparing slugified names
      const route = Object.keys(ROUTE_COORDS).find(r =>
        r.replace(/[^a-z0-9]/gi, '_') === routeSlug
      );
      if (!route) continue;

      const coords = ROUTE_COORDS[route];

      try {
        const weatherResp = await fetch(
          `${BASE_URL}/api/weather?lat=${coords.lat}&lon=${coords.lon}&route=${encodeURIComponent(route)}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (!weatherResp.ok) continue;

        const weather = await weatherResp.json();
        const chance = weather?.sailingChance ?? weather?.chance ?? 100;

        if (chance < NOTIFY_THRESHOLD) {
          const lastSent = await getLastSent(route);
          const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

          if (lastSent > twoHoursAgo) {
            results.push({ route, chance, skipped: 'cooldown' });
            continue;
          }

          const notifyResp = await fetch(`${BASE_URL}/api/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send',
              route,
              chance,
              message: `Sailing chance is ${chance}% — conditions may cause disruption.`,
            }),
          });
          const notifyResult = await notifyResp.json();
          await setLastSent(route);
          results.push({ route, chance, sent: notifyResult.sent });
        } else {
          results.push({ route, chance, ok: true });
        }
      } catch (err) {
        results.push({ route, error: err.message });
      }
    }

    return res.status(200).json({ ok: true, checked: subKeys.length, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};