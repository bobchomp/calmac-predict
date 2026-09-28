// api/ingest-report.js — Monthly CalMac performance report ingestion
//
// CalMac publish one PDF per route at:
//   https://corporate.calmac.co.uk/en-gb/about-us/route-performance-reports/[slug]/
//
// Each PDF contains ~12 months of historical data for that route.
// This endpoint fetches all 22 route pages in parallel, downloads and parses
// each PDF, and posts all extracted rows to Google Apps Script → Google Sheets.
//
// Called by cron-job.org on the 1st of each month:
//   GET /api/ingest-report  with header  Authorization: Bearer <CRON_SECRET>  (or ?secret=)
//
// To target a single route (useful for testing / fixing a bad slug):
//   GET /api/ingest-report?secret=<SECRET>&route=oban-colonsay
//
// To override the PDF URL for a single route (skips page scraping):
//   GET /api/ingest-report?secret=<SECRET>&route=oban-colonsay&url=https://...

const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL || '';
const CRON_SECRET      = process.env.CRON_SECRET       || '';

const CORPORATE_BASE = 'https://corporate.calmac.co.uk/en-gb/about-us/route-performance-reports';

// Maps route keys → corporate site URL slugs (confirmed working).
// Slugs verified against corporate.calmac.co.uk/en-gb/about-us/route-performance-reports/[slug]/
// Routes omitted here have no CalMac performance page:
//   - Troon - Brodick (Arran): seasonal service, not reported separately
//   - Seil - Luing: operated by Argyll & Bute Council, not CalMac
//   - Port Askaig - Feolin (Jura): operated by Argyll & Bute Council, not CalMac
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
};

const MONTH_NAMES = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// ── Fetch the PDF URL from a route's corporate page ──────────────────────
async function fetchRoutePdfUrl(slug) {
  const pageUrl = `${CORPORATE_BASE}/${slug}/`;
  const resp = await fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WillItSailBot/1.0)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching page for "${slug}"`);
  const html = await resp.text();

  // Try href, src, and data-* attributes that might hold a PDF link
  const patterns = [
    /href="([^"]*\.pdf[^"]*)"/gi,
    /src="([^"]*\.pdf[^"]*)"/gi,
    /data-[a-z-]+="([^"]*\.pdf[^"]*)"/gi,
    /'([^']*\.pdf[^']*)'/gi,
  ];

  for (const pattern of patterns) {
    const matches = [...html.matchAll(pattern)].map(m => m[1]);
    if (matches.length) {
      const url = matches[0];
      if (url.startsWith('http')) return url;
      if (url.startsWith('//'))   return 'https:' + url;
      return new URL(url, pageUrl).href;
    }
  }

  throw new Error(`No PDF link found in page source for "${slug}" — page may be JS-rendered`);
}

// ── Download PDF and return a Buffer ─────────────────────────────────────
async function downloadPdf(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`PDF download ${resp.status} from ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

// ── Parse monthly rows from extracted PDF text ────────────────────────────
//
// PDF table structure (from Oban-Colonsay example):
//   Year  Month      Operated  Additional  Diverted  Cancelled  CancelledAfterRelief  Reliability%  Scheduled ...
//   2024  October    36        0           0          4          0                     90.0%         40        ...
//
// We capture: year, month, operated, diverted, cancelled, reliability%, scheduled
function parseRoutePdf(text, routeKey) {
  const MONTHS_RE = 'January|February|March|April|May|June|July|August|September|October|November|December';
  const rowRe = new RegExp(
    `(\\d{4})\\s+(${MONTHS_RE})\\s+` +
    `(\\d+)\\s+\\d+\\s+(\\d+)\\s+(\\d+)\\s+\\d+\\s+` +
    `([\\d.]+)%\\s+(\\d+)`,
    'g'
  );

  const rows = [];
  for (const m of text.matchAll(rowRe)) {
    const year        = parseInt(m[1], 10);
    const month       = MONTH_NAMES[m[2].toLowerCase()];
    const operated    = parseInt(m[3], 10);
    const diverted    = parseInt(m[4], 10);
    const cancelled   = parseInt(m[5], 10);
    const reliability = parseFloat(m[6]);
    const scheduled   = parseInt(m[7], 10);
    if (scheduled > 0 && month) {
      rows.push({ routeKey, year, month, scheduled, operated, cancelled, diverted, reliability });
    }
  }
  return rows;
}

// ── Process one route: page fetch → PDF download → parse ─────────────────
async function processRoute(routeKey, slug, overridePdfUrl) {
  try {
    const pdfUrl = overridePdfUrl || await fetchRoutePdfUrl(slug);
    const buffer = await downloadPdf(pdfUrl);

    const pdfParse = require('pdf-parse');
    const { text } = await pdfParse(buffer);
    const rows = parseRoutePdf(text, routeKey);

    return { ok: true, routeKey, slug, pdfUrl, rowCount: rows.length, rows };
  } catch (err) {
    return { ok: false, routeKey, slug, error: err.message };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const secret = req.query?.secret || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ?route=slug targets a single route; ?url= overrides its PDF URL
  const targetSlug     = req.query?.route || null;
  const overridePdfUrl = req.query?.url   || null;

  const routesToProcess = targetSlug
    ? Object.entries(ROUTE_SLUGS).filter(([, slug]) => slug === targetSlug)
    : Object.entries(ROUTE_SLUGS);

  if (targetSlug && routesToProcess.length === 0) {
    return res.status(400).json({
      error: `Unknown route slug: "${targetSlug}"`,
      knownSlugs: Object.values(ROUTE_SLUGS),
    });
  }

  try {
    // Fetch, download, and parse all routes in parallel
    const results = await Promise.all(
      routesToProcess.map(([routeKey, slug]) => processRoute(routeKey, slug, overridePdfUrl))
    );

    const succeeded = results.filter(r => r.ok);
    const failed    = results.filter(r => !r.ok);
    const allRows   = succeeded.flatMap(r => r.rows);

    // Post all rows to Google Apps Script
    let sheetResult = null;
    if (SHEET_SCRIPT_URL && allRows.length > 0) {
      const sheetResp = await fetch(SHEET_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ingestReport', rows: allRows }),
        signal: AbortSignal.timeout(20000),
      });
      sheetResult = await sheetResp.json().catch(() => null);
    }

    return res.status(200).json({
      ok:        succeeded.length > 0,
      totalRows: allRows.length,
      routes: {
        succeeded: succeeded.map(r => ({ routeKey: r.routeKey, slug: r.slug, rowCount: r.rowCount, pdfUrl: r.pdfUrl })),
        failed:    failed.map(r => ({ routeKey: r.routeKey, slug: r.slug, error: r.error })),
      },
      sheetResult,
    });

  } catch (err) {
    console.error('ingest-report.js error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
