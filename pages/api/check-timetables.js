// api/check-timetables.js
// Detects new seasonal timetable PDFs published on calmac.co.uk/route-information/[slug]/
//
// Each route page is server-rendered and contains direct <a href="...pdf"> links.
// We store the known set of PDF URLs per route in Upstash Redis.
// When new URLs appear (new season/amended timetable published), we broadcast
// a push notification to ALL subscribers across all routes.
//
// Called daily by api/cron.js — secrets checked there, not here.
// Can also be triggered manually:
//   GET /api/check-timetables  with header  Authorization: Bearer <CRON_SECRET>  (or ?secret=)

const BASE_URL    = process.env.CRON_BASE_URL || 'https://www.willitsail.co.uk';
const KV_URL      = process.env.UPSTASH_REDIS_REST_URL   || '';
const KV_TOKEN    = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

const CALMAC_ROUTE_BASE = 'https://www.calmac.co.uk/route-information';

// Maps our route keys → calmac.co.uk/route-information/[slug]/ URL slugs.
// Verified: public site slugs match the corporate site slugs for all tested routes.
// Mark any that fail with a 404 so they can be corrected.
const ROUTE_SLUGS = {
  'Ardrossan - Brodick (Arran)':                       'ardrossan-brodick',
  'Kennacraig - Port Ellen / Port Askaig (Islay)':     'kennacraig-islay',
  'Oban - Craignure (Mull)':                           'oban-craignure',
  'Oban - Coll / Tiree':                               'oban-coll-tiree',
  'Oban - Colonsay':                                   'oban-colonsay',
  'Oban - Castlebay / Lochboisdale':                   'oban-castlebaylochboisdale',
  'Mallaig - Armadale (Skye)':                         'mallaig-armadale',
  'Ullapool - Stornoway (Lewis)':                      'ullapool-stornoway',
  'Uig - Tarbert / Lochmaddy':                         'uig-tarbert-lochmaddy',
  'Gourock - Dunoon':                                  'gourock-dunoon',
  'Wemyss Bay - Rothesay (Bute)':                      'wemyss-bay-rothesay',
  'Colintraive - Rhubodach (Bute)':                    'colintraive-rhubodach',
  'Largs - Cumbrae Slip':                              'largs-cumbrae',
  'Tarbert - Portavadie':                              'tarbert-loch-fyne-portavadie',
  'Claonaig - Lochranza (Arran)':                      'claonaig-lochranza',
  'Tobermory - Kilchoan':                              'tobermory-kilchoan',
  'Fishnish - Lochaline':                              'fishnish-lochaline',
  'Mallaig - Small Isles':                             'mallaig-small-isles',
  'Oban - Lismore':                                    'oban-lismore',
  'Tayinloan - Gigha':                                 'tayinloan-gigha',
  'Sconser - Raasay':                                  'sconser-raasay',
  'Fionnphort - Iona':                                 'fionnphort-iona',
  'Troon - Brodick (Arran)':                           'troon-brodick',
};

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

// ── Fetch one route page and extract timetable PDF URLs ──────────────────
// The page has a #timetablesContent tab section followed by #faresContent.
// We scope PDF extraction to just the timetables section so fares PDFs
// (which live in the next tab) are never accidentally included.
async function fetchTimetablePdfs(slug) {
  const pageUrl = `${CALMAC_ROUTE_BASE}/${slug}/`;
  const resp = await fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WillItSailBot/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${slug}`);
  const html = await resp.text();

  // Slice out just the #timetablesContent div — stop before the next tab section
  const ttStart = html.indexOf('id="timetablesContent"');
  const ttEnd   = html.indexOf('id="faresContent"');
  const section = ttStart !== -1
    ? html.slice(ttStart, ttEnd !== -1 ? ttEnd : ttStart + 8000)
    : html; // fallback: search the whole page

  const pdfs = [...new Set(
    [...section.matchAll(/href="(https:\/\/assets\.calmac\.co\.uk\/[^"]+\.pdf)"/gi)]
      .map(m => m[1])
  )];

  return { slug, pageUrl, pdfs };
}

// ── Handler ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const secret = req.query?.secret || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results    = [];
  const newRoutes  = []; // routes with newly-seen timetable PDFs

  // Fetch all route pages in parallel (batched to avoid hammering calmac.co.uk)
  const entries = Object.entries(ROUTE_SLUGS);
  const BATCH   = 5;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(([routeKey, slug]) => fetchTimetablePdfs(slug).then(r => ({ ...r, routeKey })))
    );

    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        results.push({ ok: false, error: outcome.reason?.message });
        continue;
      }
      const { routeKey, slug, pageUrl, pdfs } = outcome.value;
      results.push({ ok: true, routeKey, slug, found: pdfs.length });

      if (pdfs.length === 0) continue;

      const storeKey = `timetable_pdfs:${slug}`;
      const known    = (await kvGet(storeKey)) || [];
      const newPdfs  = pdfs.filter(url => !known.includes(url));

      if (newPdfs.length > 0 && KV_URL) {
        // Persist the updated set
        await kvSet(storeKey, [...new Set([...known, ...pdfs])]);
        newRoutes.push({ routeKey, slug, newPdfs, pageUrl });
      }
    }
  }

  // ── Broadcast push notification if any routes have new timetables ──────
  let broadcastResult = null;
  if (newRoutes.length > 0 && KV_URL) {
    const routeNames = newRoutes.map(r => r.routeKey);
    const body = routeNames.length === 1
      ? `New timetable available for ${routeNames[0]}.`
      : `New timetables for ${routeNames.length} routes: ${routeNames.slice(0, 3).join(', ')}${routeNames.length > 3 ? '…' : ''}`;

    try {
      const notifyResp = await fetch(`${BASE_URL}/api/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:  'broadcast',
          title:   '📅 New CalMac Timetable',
          message: body,
          url:     newRoutes.length === 1
            ? `${CALMAC_ROUTE_BASE}/${newRoutes[0].slug}/#timetables`
            : 'https://www.calmac.co.uk/timetables',
        }),
        signal: AbortSignal.timeout(20000),
      });
      broadcastResult = await notifyResp.json().catch(() => null);
    } catch (err) {
      broadcastResult = { error: err.message };
    }
  }

  return res.status(200).json({
    ok:        true,
    checked:   results.filter(r => r.ok).length,
    failed:    results.filter(r => !r.ok).length,
    newRoutes: newRoutes.map(r => ({ routeKey: r.routeKey, newPdfs: r.newPdfs })),
    broadcast: broadcastResult,
    results,
  });
};
