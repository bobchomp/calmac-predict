// GitHub Actions: monthly. Replaces /api/ingest-report: reads CalMac's
// published reliability figures, saves them to Redis `reliability`, and
// works the thresholds out again (lib/reliability.js) into Redis
// `thresholds`, which the site uses. Two sources:
// - the monthly island performance packs (each with 12 months of each of
//   the island's routes): the newest, and those 12 and 24 months before it
//   and the oldest, so the months join up
// - each route's own report page, which CalMac stopped updating in late 2024
//   but which is the only source for a few routes
// A newer figure for a month replaces an older one. Needs pdf-parse (npm ci).

import { createRequire } from 'node:module';
import { kvGetJsonMany, kvSetJson } from '../../lib/kv.js';
import { calcThresholds } from '../../lib/reliability.js';
import { THRESHOLDS_KEY } from '../../lib/thresholds.js';
import { runJob, say } from './common.mjs';

// The package's own entry point runs a self-test when imported this way
const pdfParse = createRequire(import.meta.url)('pdf-parse/lib/pdf-parse.js');

// The reports are tables, and pdf-parse's own text runs a row's cells
// together ("2024March267121261080.7%316…"). CalMac's PDFs place each
// character on its own, so pieces of text that touch are joined, and a gap
// wider than a quarter of the text's size (between cells) becomes a space
async function pageText(page) {
  const { items } = await page.getTextContent({ disableCombineTextItems: true });
  let text = '', lastY = null, lastEnd = 0;
  for (const item of items) {
    const [scale, , , , x, y] = item.transform;
    const size = Math.abs(scale) || item.height || 10;
    const sep = lastY === null ? '' : Math.abs(y - lastY) >= size / 2 ? '\n' : x - lastEnd > size / 4 ? ' ' : '';
    text += sep + item.str;
    lastY = y;
    lastEnd = x + item.width;
  }
  return text;
}

const CORPORATE = 'https://corporate.calmac.co.uk/en-gb/about-us';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; WillItSailBot/1.0)' };

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

// The island packs' route names → our route keys (their other routes, such
// as Fionnphort - Iona, aren't on the site; Mallaig - Armadale, Mallaig -
// Small Isles and Oban - Lismore aren't in any pack)
const PACK_ROUTES = {
  'Ardrossan - Brodick':           'Ardrossan - Brodick (Arran)',
  'Claonaig - Lochranza':          'Claonaig - Lochranza (Arran)',
  'Wemyss Bay - Rothesay':         'Wemyss Bay - Rothesay (Bute)',
  'Colintraive - Rhubodach':       'Colintraive - Rhubodach (Bute)',
  'Oban - Castlebay/Lochboisdale': 'Oban - Castlebay / Lochboisdale',
  'Oban - Coll/Tiree':             'Oban - Coll / Tiree',
  'Oban - Colonsay':               'Oban - Colonsay',
  'Kennacraig - Islay':            'Kennacraig - Port Ellen / Port Askaig (Islay)',
  'Uig - Tarbert/Lochmaddy':       'Uig - Tarbert / Lochmaddy',
  'Ullapool - Stornoway':          'Ullapool - Stornoway (Lewis)',
  'Oban - Craignure':              'Oban - Craignure (Mull)',
  'Tobermory - Kilchoan':          'Tobermory - Kilchoan',
  'Fishnish - Lochaline':          'Fishnish - Lochaline',
  'Gourock - Dunoon':              'Gourock - Dunoon',
  'Tarbert LF - Portavadie':       'Tarbert - Portavadie',
  'Largs - Cumbrae Slip':          'Largs - Cumbrae Slip',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map(m => m.slice(0, 3));

async function fetchOk(url, ms = 30000) {
  const resp = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  return resp;
}
const pdfText = async url => (await pdfParse(Buffer.from(await (await fetchOk(url)).arrayBuffer()), { pagerender: pageText })).text;
const pdfLinks = html => [...new Set([...html.matchAll(/href="(https:\/\/assets\.calmac\.co\.uk\/[^"]+\.pdf)"/gi)].map(m => m[1]))];

// Table rows, as "2025 September" or "Sep-25", then (in the packs) the
// route, then: Operated Additional Diverted Cancelled [Cancelled after
// relief, in older reports] Reliability% Scheduled …  Busy routes' counts
// have thousands separators (1,772).
function parseRows(text, route = null) {
  const n = '(\\d[\\d,]*)';
  const when = `(?:(?<year>\\d{4})\\s*(?<month>${MONTHS.join('|')})|(?<mon>${SHORT.join('|')})-(?<yy>\\d{2}))`;
  const name = route ? '' : '\\s+(?<name>\\S[^\\n]*?)';
  const re = new RegExp(`${when}${name}\\s+(?<op>${n.slice(1, -1)})\\s+(?<add>${n.slice(1, -1)})\\s+(?<div>${n.slice(1, -1)})\\s+(?<canc>${n.slice(1, -1)})(?:\\s+${n})?\\s+(?<rel>[\\d.]+)\\s*%\\s+(?<sched>${n.slice(1, -1)})`, 'g');
  const num = s => Number(s.replace(/,/g, ''));
  const rows = [];
  for (const { groups: g } of text.matchAll(re)) {
    const key = route || PACK_ROUTES[g.name.trim()];
    if (!key) continue;
    const row = {
      route: key,
      year: g.year ? Number(g.year) : 2000 + Number(g.yy),
      month: g.month ? MONTHS.indexOf(g.month) + 1 : SHORT.indexOf(g.mon) + 1,
      scheduled: num(g.sched), operated: num(g.op), cancelled: num(g.canc), diverted: num(g.div),
      reliability: Math.round(Number(g.rel) * 10) / 10,
    };
    if (row.scheduled > 0 && row.month) rows.push(row);
  }
  return rows;
}

// The island packs to read, newest first: { heading ("August 2026"), url }
async function islandPacks() {
  const html = await (await fetchOk(`${CORPORATE}/performance-reports/island-performance/`, 15000)).text();
  const packs = [];
  let heading = null;
  for (const m of html.matchAll(/<h[1-6][^>]*>([^<]*)<\/h[1-6]>|href="(https:\/\/assets\.calmac\.co\.uk\/[^"]+\.pdf)"/gi)) {
    if (m[1] && new RegExp(`^(${MONTHS.join('|')}) \\d{4}$`).test(m[1].trim())) heading = m[1].trim();
    else if (m[2] && heading) packs.push({ heading, url: m[2] });
  }
  const headings = [...new Set(packs.map(p => p.heading))];
  if (!headings.length) throw new Error('no packs found on the island performance page');
  const index = h => { const [mon, year] = h.split(' '); return Number(year) * 12 + MONTHS.indexOf(mon); };
  const newest = index(headings[0]);
  const wanted = new Set([headings.at(-1), ...headings.filter(h => (newest - index(h)) % 12 === 0)]);
  return packs.filter(p => wanted.has(p.heading));
}

// The report on a route's own page
async function routePage(route, slug) {
  const html = await (await fetchOk(`${CORPORATE}/route-performance-reports/${slug}/`, 15000)).text();
  const url = pdfLinks(html)[0];
  if (!url) throw new Error('no PDF link on the page');
  const text = await pdfText(url);
  return { url, text, rows: parseRows(text, route) };
}

async function ingestReports({ dry }) {
  const [reliability, reports] = await kvGetJsonMany(['reliability', 'reports']);
  if (!reliability?.rows) throw new Error('No reliability figures in Redis (run the Sheet import first)');

  const failed = [];
  const unread = [];
  const sources = {};
  // Each route-month's figures from the newest source that has it
  const found = new Map();
  const id = r => `${r.route}|${r.year}|${r.month}`;
  const take = rows => { for (const r of rows) if (!found.has(id(r))) found.set(id(r), r); };

  const packs = await islandPacks();
  for (const heading of [...new Set(packs.map(p => p.heading))]) {
    const results = await Promise.allSettled(packs.filter(p => p.heading === heading).map(async p => ({ url: p.url, text: await pdfText(p.url) })));
    let read = 0;
    for (const r of results) {
      if (r.status === 'rejected') { failed.push({ source: `${heading} pack`, error: r.reason?.message }); continue; }
      const rows = parseRows(r.value.text);
      read++;
      take(rows);
    }
    sources[`island packs, ${heading}`] = `${read} of ${results.length} read`;
  }
  const pages = await Promise.allSettled(Object.entries(ROUTE_SLUGS).map(([route, slug]) => routePage(route, slug)));
  pages.forEach((r, i) => {
    const route = Object.keys(ROUTE_SLUGS)[i];
    if (r.status === 'rejected') return failed.push({ source: `${route} page`, error: r.reason?.message });
    if (!r.value.rows.length) unread.push({ route, pdfUrl: r.value.url, text: r.value.text.replace(/\s+/g, ' ').trim().slice(0, 600) });
    take(r.value.rows);
  });
  sources['route pages'] = `${pages.filter(r => r.status === 'fulfilled').length} of ${pages.length} read`;

  // Months not saved yet are added; a saved month CalMac now gives another
  // figure for is replaced
  const saved = new Map(reliability.rows.map(r => [id(r), r]));
  const added = [], updated = [];
  for (const [key, r] of found) {
    const was = saved.get(key);
    if (!was) added.push(r);
    else if (Math.abs((was.reliability ?? NaN) - r.reliability) > 0.05 || Number.isNaN(was.reliability)) updated.push({ ...r, was: was.reliability });
    else continue;
    saved.set(key, r);
  }
  const at = new Date().toISOString();
  const rows = [...saved.values()].sort((a, b) => a.route.localeCompare(b.route) || a.year - b.year || a.month - b.month);
  const thresholds = calcThresholds(rows, reports?.rows || [], at);

  // How the figures move each route's thresholds (the site's chances follow)
  const [current] = await kvGetJsonMany([THRESHOLDS_KEY]);
  const changes = Object.entries(thresholds).flatMap(([route, t]) => {
    const was = current?.thresholds?.[route];
    const moved = ['base', 'winter', 'summer', 'shoulder']
      .filter(k => (was?.[k] ?? null) !== t[k])
      .map(k => `${k} ${was?.[k] ?? '–'} → ${t[k] ?? '–'}`);
    return moved.length ? [`${route}: ${moved.join(', ')} (${was?.samples ?? 0} → ${t.samples} months)`] : [];
  });

  // The months saved for each route, first to last
  const ym = r => `${r.year}-${String(r.month).padStart(2, '0')}`;
  const coverage = {};
  for (const r of rows) {
    const c = coverage[r.route] ||= { months: 0, from: ym(r), to: ym(r) };
    c.months++;
    if (ym(r) < c.from) c.from = ym(r);
    if (ym(r) > c.to) c.to = ym(r);
  }

  const changed = added.length + updated.length > 0;
  if (!dry && changed) {
    await kvSetJson('reliability', { at, rows });
    await kvSetJson(THRESHOLDS_KEY, { at, source: 'CalMac reports', thresholds });
  }

  say(`${found.size} route-months read from CalMac: ${added.length} new, ${updated.length} with a changed figure.`);
  const list = items => items.slice(0, 40).concat(items.length > 40 ? [`… and ${items.length - 40} more`] : []);
  return {
    ok: found.size > 0,
    sources,
    added: list(added.map(r => `${r.route} ${ym(r)}: ${r.reliability}%`)),
    updated: list(updated.map(r => `${r.route} ${ym(r)}: ${r.was}% → ${r.reliability}%`)),
    reliabilityMonths: rows.length,
    coverage: Object.fromEntries(Object.entries(coverage).map(([route, c]) => [route, `${c.from} → ${c.to} (${c.months} months)`])),
    thresholdChanges: changes,
    saved: !dry && changed,
    failed,
    // Route pages read but with no months found in them (the first few in full)
    unread: unread.map((u, i) => (i < 3 ? u : { route: u.route, pdfUrl: u.pdfUrl })),
  };
}

await runJob({ name: 'monthly' }, ingestReports);
