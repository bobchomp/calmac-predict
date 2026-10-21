// Reading CalMac's published reliability figures (for index.mjs):
// - the monthly island performance packs on
//   corporate.calmac.co.uk/en-gb/about-us/performance-reports/island-performance/:
//   since August 2026 each has 12 months of each of the island's routes;
//   before that, each has its own month's sailings, route by route and leg
//   by leg (parseLegRows)
// - each route's own report page, which CalMac stopped updating in late 2024
//   but which is the only source for a few routes
// Each gives rows of { route, year, month, scheduled, operated, cancelled,
// diverted, reliability }, with `route` one of the site's route names.

import { createRequire } from 'node:module';
import { PACK_ROUTES } from './routes.mjs';

export { ROUTE_SLUGS } from './routes.mjs';

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


const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map(m => m.slice(0, 3));

// Tried up to three times: reading a year of packs side by side can see a
// dropped connection or two
async function fetchOk(url, ms = 30000) {
  for (let attempt = 1; ; attempt++) {
    try {
      const resp = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
      if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status} from ${url}`), { final: resp.status < 500 && resp.status !== 429 });
      return resp;
    } catch (err) {
      if (err.final || attempt === 3) throw err;
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}
export const pdfText = async url => (await pdfParse(Buffer.from(await (await fetchOk(url)).arrayBuffer()), { pagerender: pageText })).text;
const pdfLinks = html => [...new Set([...html.matchAll(/href="(https:\/\/assets\.calmac\.co\.uk\/[^"]+\.pdf)"/gi)].map(m => m[1]))];

// Table rows, as "2025 September" or "Sep-25", then (in the packs) the
// route, then: Operated Additional Diverted Cancelled [Cancelled after
// relief, in older reports] Reliability% Scheduled …  Busy routes' counts
// have thousands separators (1,772).
export function parseRows(text, route = null) {
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

// The older packs' layout: one month's sailings for each leg (direction)
// of each route, without the reliability, which is worked out as CalMac
// does: sailings operated, less additional ones, out of those scheduled
//   Year Month Route Leg Operated Scheduled Additional Cancelled Diverted [On Time Late]
//   2025 August Oban - Craignure Craignure-Oban 293 312 0 19 0
const escape = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
export function parseLegRows(text) {
  const n = '(\\d[\\d,]*)';
  const names = Object.keys(PACK_ROUTES).map(escape).join('|');
  const when = `(?:(?<year>\\d{4})\\s+(?<month>${MONTHS.join('|')})|(?<mon>${SHORT.join('|')})-(?<yy>\\d{2}))`;
  const re = new RegExp(`${when}\\s+(?<name>${names})\\s+\\S[^\\n]*?\\s+${n}\\s+${n}\\s+${n}\\s+${n}\\s+${n}(?:\\s+\\d[\\d,]*){0,2}\\s*$`, 'gm');
  const num = s => Number(s.replace(/,/g, ''));
  // Only in that table (the next one, of cancellations and lateness, has
  // rows of the same shape)
  const tables = text.split(/(?=Summary of )/).filter(t => /^Summary of Scheduled, Operated, Cancelled/.test(t));
  const sums = new Map();
  for (const m of tables.join('\n').matchAll(re)) {
    const g = m.groups;
    const year = g.year ? Number(g.year) : 2000 + Number(g.yy);
    const month = g.month ? MONTHS.indexOf(g.month) + 1 : SHORT.indexOf(g.mon) + 1;
    const key = `${g.name}|${year}|${month}`;
    const t = sums.get(key) || { route: PACK_ROUTES[g.name], year, month, operated: 0, scheduled: 0, additional: 0, cancelled: 0, diverted: 0 };
    t.operated += num(m[6]); t.scheduled += num(m[7]); t.additional += num(m[8]); t.cancelled += num(m[9]); t.diverted += num(m[10]);
    sums.set(key, t);
  }
  return [...sums.values()].filter(t => t.scheduled > 0).map(({ additional, ...t }) => ({
    ...t,
    reliability: Math.round(((t.operated - additional) / t.scheduled) * 1000) / 10,
  }));
}

// Rows from a pack in either layout
export const packRows = text => [...parseRows(text), ...parseLegRows(text)];

// Every island pack, newest first: { heading ("August 2026"), index (months
// since year 0, to compare), url }
export async function islandPacks() {
  const html = await (await fetchOk(`${CORPORATE}/performance-reports/island-performance/`, 15000)).text();
  const packs = [];
  let heading = null;
  for (const m of html.matchAll(/<h[1-6][^>]*>([^<]*)<\/h[1-6]>|href="(https:\/\/assets\.calmac\.co\.uk\/[^"]+\.pdf)"/gi)) {
    if (m[1] && new RegExp(`^(${MONTHS.join('|')}) \\d{4}$`).test(m[1].trim())) heading = m[1].trim();
    else if (m[2] && heading) packs.push({ heading, url: m[2] });
  }
  if (!packs.length) throw new Error('no packs found on the island performance page');
  const index = h => { const [mon, year] = h.split(' '); return Number(year) * 12 + MONTHS.indexOf(mon); };
  return packs.map(p => ({ ...p, index: index(p.heading) }));
}

// The report on a route's own page
export async function routePage(route, slug) {
  const html = await (await fetchOk(`${CORPORATE}/route-performance-reports/${slug}/`, 15000)).text();
  const url = pdfLinks(html)[0];
  if (!url) throw new Error('no PDF link on the page');
  const text = await pdfText(url);
  return { url, text, rows: parseRows(text, route) };
}
