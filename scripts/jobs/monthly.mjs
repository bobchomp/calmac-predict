// GitHub Actions: monthly. Replaces /api/ingest-report: reads each route's
// CalMac performance report (a PDF with ~12 months of figures), adds months
// not already saved to Redis `reliability`, and works the thresholds out
// again (lib/reliability.js) into Redis `thresholds`, which the site uses.
// Needs pdf-parse (npm ci).

import { createRequire } from 'node:module';
import { kvGetJsonMany, kvSetJson } from '../../lib/kv.js';
import { calcThresholds } from '../../lib/reliability.js';
import { THRESHOLDS_KEY } from '../../lib/thresholds.js';
import { runJob, say } from './common.mjs';

// The package's own entry point runs a self-test when imported this way
const pdfParse = createRequire(import.meta.url)('pdf-parse/lib/pdf-parse.js');

const CORPORATE_BASE = 'https://corporate.calmac.co.uk/en-gb/about-us/route-performance-reports';

// Our route keys → corporate.calmac.co.uk/…/route-performance-reports/<slug>/
// (Troon - Brodick, Seil - Luing and Port Askaig - Feolin have no report)
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

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// The report's PDF link on the route's page
async function reportPdfUrl(slug) {
  const pageUrl = `${CORPORATE_BASE}/${slug}/`;
  const resp = await fetch(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WillItSailBot/1.0)' }, signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching the page`);
  const html = await resp.text();
  for (const pattern of [/href="([^"]*\.pdf[^"]*)"/gi, /src="([^"]*\.pdf[^"]*)"/gi, /data-[a-z-]+="([^"]*\.pdf[^"]*)"/gi, /'([^']*\.pdf[^']*)'/gi]) {
    const url = [...html.matchAll(pattern)][0]?.[1];
    if (url) return url.startsWith('//') ? 'https:' + url : new URL(url, pageUrl).href;
  }
  throw new Error('no PDF link on the page');
}

// Rows of the report's table:
//   Year Month Operated Additional Diverted Cancelled CancelledAfterRelief Reliability% Scheduled …
//   2024 October 36 0 0 4 0 90.0% 40 …
function parseReport(text, route) {
  const rowRe = new RegExp(`(\\d{4})\\s+(${MONTHS.join('|')})\\s+(\\d+)\\s+\\d+\\s+(\\d+)\\s+(\\d+)\\s+\\d+\\s+([\\d.]+)%\\s+(\\d+)`, 'gi');
  const rows = [];
  for (const m of text.matchAll(rowRe)) {
    const row = {
      route,
      year: Number(m[1]), month: MONTHS.indexOf(m[2].toLowerCase()) + 1,
      scheduled: Number(m[7]), operated: Number(m[3]), cancelled: Number(m[5]), diverted: Number(m[4]),
      reliability: Number(m[6]),
    };
    if (row.scheduled > 0 && row.month) rows.push(row);
  }
  return rows;
}

async function routeReport(route, slug) {
  const pdfUrl = await reportPdfUrl(slug);
  const resp = await fetch(pdfUrl, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} downloading the PDF`);
  const { text } = await pdfParse(Buffer.from(await resp.arrayBuffer()));
  const rows = parseReport(text, route);
  // A report with no rows read is shown in the summary, to see why
  return { rows, pdfUrl, ...(!rows.length && { text: text.replace(/\s+/g, ' ').trim().slice(0, 600) }) };
}

async function ingestReports({ dry }) {
  const [reliability, reports] = await kvGetJsonMany(['reliability', 'reports']);
  if (!reliability?.rows) throw new Error('No reliability figures in Redis (run the Sheet import first)');

  const results = await Promise.allSettled(Object.entries(ROUTE_SLUGS).map(([route, slug]) => routeReport(route, slug)));
  const failed = [];
  const found = [];
  const unread = [];
  results.forEach((r, i) => {
    const route = Object.keys(ROUTE_SLUGS)[i];
    if (r.status === 'rejected') failed.push({ route, error: r.reason?.message });
    else if (r.value.rows.length) found.push(...r.value.rows);
    else unread.push({ route, pdfUrl: r.value.pdfUrl, text: r.value.text });
  });

  // Months already saved are kept as they are (as the Sheet did)
  const id = r => `${r.route}|${r.year}|${r.month}`;
  const have = new Set(reliability.rows.map(id));
  const added = found.filter(r => !have.has(id(r)) && have.add(id(r)));
  const at = new Date().toISOString();
  const rows = [...reliability.rows, ...added];
  const thresholds = calcThresholds(rows, reports?.rows || [], at);

  if (!dry && added.length) {
    await kvSetJson('reliability', { at, rows });
    await kvSetJson(THRESHOLDS_KEY, { at, source: 'CalMac reports', thresholds });
  }

  say(`${Object.keys(ROUTE_SLUGS).length - failed.length} of ${Object.keys(ROUTE_SLUGS).length} reports read: ${found.length} months in them, ${added.length} new.`);
  return {
    ok: found.length > 0,
    added: added.map(r => `${r.route} ${r.year}-${String(r.month).padStart(2, '0')}: ${r.reliability}%`),
    reliabilityMonths: rows.length,
    thresholdsRoutes: Object.keys(thresholds).length,
    saved: !dry && added.length > 0,
    failed,
    // Reports read but with no months found in them (the first few in full)
    unread: unread.map((u, i) => (i < 3 ? u : { route: u.route, pdfUrl: u.pdfUrl })),
  };
}

await runJob({ name: 'monthly' }, ingestReports);
