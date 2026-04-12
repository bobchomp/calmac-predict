// api/cron.js — daily 8am UTC
// 1. Fetches live CalMac service status via GraphQL
// 2. Records any cancellations/disruptions to Google Sheet (ground truth log)
// 3. Sends push notifications to subscribers of affected routes

const BASE_URL = process.env.CRON_BASE_URL || 'https://calmac-predict.vercel.app';

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL   || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const SHEET_URL = process.env.FEEDBACK_SHEET_URL || ''; // reuse same sheet endpoint

const NOTIFY_THRESHOLD = 70;

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

// ── Route coords for weather lookup ────────────────────────────────────
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

// ── Write a cancellation record to Google Sheet ────────────────────────
async function recordToSheet(route, calMacStatus, predictedChance) {
  if (!SHEET_URL) return;
  const row = {
    timestamp:       new Date().toISOString(),
    route,
    sailed:          calMacStatus === 'cancelled' ? 'NO' : 'YES',
    calMacStatus,
    predictedChance: predictedChance ?? '',
    source:          'calmac-graphql-api',
  };
  try {
    await fetch(SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('Sheet write failed:', err.message);
  }
}

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  // Accept auth from:
  // 1. Vercel cron: Authorization: Bearer <secret>
  // 2. cron-job.org: GET /api/cron?secret=<secret>
  const headerAuth = req.headers['authorization'] === `Bearer ${secret}`;
  const queryAuth  = req.query?.secret === secret;
  if (!headerAuth && !queryAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = [];

  try {
    // ── Step 1: fetch live CalMac status ──
    const statusResp = await fetch(`${BASE_URL}/api/status`, {
      signal: AbortSignal.timeout(12000),
    });
    const statusData = statusResp.ok ? await statusResp.json() : { routes: [], disrupted: [] };
    const disrupted = statusData.disrupted || [];

    // ── Step 2: for each disrupted route, get predicted chance & record to sheet ──
    for (const disruption of disrupted) {
      const routeKey = disruption.routeKey;
      if (!routeKey || !ROUTE_COORDS[routeKey]) continue;

      const coords = ROUTE_COORDS[routeKey];
      let predictedChance = null;

      try {
        const weatherResp = await fetch(
          `${BASE_URL}/api/weather?lat=${coords.lat}&lon=${coords.lon}&route=${encodeURIComponent(routeKey)}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (weatherResp.ok) {
          const weather = await weatherResp.json();
          predictedChance = weather?.sailingChance ?? weather?.chance ?? null;
        }
      } catch (_) {}

      // Record to Google Sheet as ground truth
      await recordToSheet(routeKey, disruption.status, predictedChance);
      results.push({ route: routeKey, calMacStatus: disruption.status, predictedChance, recorded: true });

      // ── Step 3: send push notifications if subscribed & below threshold ──
      if (predictedChance !== null && predictedChance < NOTIFY_THRESHOLD && KV_URL) {
        const subKey = `subs:${routeKey.replace(/[^a-z0-9]/gi, '_')}`;
        const subs = (await kvGet(subKey)) || [];
        if (subs.length > 0) {
          const lastSent = (await kvGet(`lastsent:${routeKey.replace(/[^a-z0-9]/gi, '_')}`)) || 0;
          const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
          if (lastSent < twoHoursAgo) {
            try {
              const notifyResp = await fetch(`${BASE_URL}/api/notify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'send',
                  route: routeKey,
                  chance: predictedChance,
                  message: disruption.status === 'cancelled'
                    ? `All sailings cancelled on ${routeKey} today.`
                    : `Disruptions reported on ${routeKey}. Sailing chance: ${predictedChance}%.`,
                }),
              });
              const notifyResult = await notifyResp.json();
              await kvSet(`lastsent:${routeKey.replace(/[^a-z0-9]/gi, '_')}`, Date.now());
              results[results.length - 1].pushed = notifyResult.sent;
            } catch (_) {}
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      disrupted: disrupted.length,
      recorded: results.filter(r => r.recorded).length,
      results,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};