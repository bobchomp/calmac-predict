// GitHub Actions: monthly (.github/workflows/monthly.yml). Replaces
// /api/ingest-report: reads CalMac's published reliability figures
// (calmac.mjs), saves them to Redis `reliability`, and works the thresholds
// out again (lib/reliability.js) into Redis `thresholds`, which the site
// uses. A newer figure for a month replaces an older one.
//
// The months imported from the Google Sheet were mostly estimates (whole
// numbers, often far from CalMac's figures), so rows this job saves are
// marked source: 'CalMac'. Only those count as a month already being had,
// and a route's estimates are dropped once it has a year of CalMac's figures.

import { kvGetJsonMany, kvSetJson } from '../../../lib/kv.js';
import { calcThresholds } from '../../../lib/reliability.js';
import { THRESHOLDS_KEY } from '../../../lib/thresholds.js';
import { runJob, say } from '../common.mjs';
import { ROUTE_SLUGS, islandPacks, packRows, pdfText, routePage } from './calmac.mjs';

async function ingestReports({ dry }) {
  const [reliability, reports] = await kvGetJsonMany(['reliability', 'reports']);
  if (!reliability?.rows) throw new Error('No reliability figures in Redis (run the Sheet import first)');

  const failed = [];
  const unread = [];
  const sources = {};
  // Each route-month's figures from the newest source that has it
  const found = new Map();
  const id = r => `${r.route}|${r.year}|${r.month}`;
  const take = rows => { for (const r of rows) if (!found.has(id(r))) found.set(id(r), { ...r, source: 'CalMac' }); };

  // A month's packs, read side by side
  const readPacks = async (heading, list) => {
    const results = await Promise.allSettled(list.map(async p => packRows(await pdfText(p.url))));
    let read = 0;
    for (const r of results) {
      if (r.status === 'rejected') failed.push({ source: `${heading} pack`, error: r.reason?.message });
      else { read++; take(r.value); }
    }
    sources[`island packs, ${heading}`] = `${read} of ${results.length} read`;
  };

  // The newest month's packs, then the route pages
  const packs = await islandPacks();
  const headings = [...new Map(packs.map(p => [p.heading, p.index])).entries()];
  await readPacks(headings[0][0], packs.filter(p => p.heading === headings[0][0]));
  const pages = await Promise.allSettled(Object.entries(ROUTE_SLUGS).map(([route, slug]) => routePage(route, slug)));
  pages.forEach((r, i) => {
    const route = Object.keys(ROUTE_SLUGS)[i];
    if (r.status === 'rejected') return failed.push({ source: `${route} page`, error: r.reason?.message });
    if (!r.value.rows.length) unread.push({ route, pdfUrl: r.value.url, text: r.value.text.replace(/\s+/g, ' ').trim().slice(0, 600) });
    take(r.value.rows);
  });
  sources['route pages'] = `${pages.filter(r => r.status === 'fulfilled').length} of ${pages.length} read`;

  // Then the packs for any month neither those nor CalMac's figures already
  // saved have for most routes (on the first run, the year from late 2024)
  const perMonth = new Map();
  for (const r of [...found.values(), ...reliability.rows.filter(r => r.source === 'CalMac')]) {
    const k = r.year * 12 + r.month - 1;
    perMonth.set(k, (perMonth.get(k) || new Set()).add(r.route));
  }
  for (const [heading, index] of headings.slice(1)) {
    if ((perMonth.get(index)?.size || 0) >= 10) continue;
    await readPacks(heading, packs.filter(p => p.heading === heading));
  }

  // Months not saved yet are added; a saved month CalMac now gives another
  // figure for (or that was an estimate) is replaced
  const saved = new Map(reliability.rows.map(r => [id(r), r]));
  const added = [], updated = [];
  for (const [key, r] of found) {
    const was = saved.get(key);
    if (!was) added.push(r);
    else if (was.source !== 'CalMac' || Math.abs((was.reliability ?? NaN) - r.reliability) > 0.05 || Number.isNaN(was.reliability)) updated.push({ ...r, was: was.reliability });
    else continue;
    saved.set(key, r);
  }

  // A route's remaining estimates go once it has a year of CalMac's figures
  const calmacMonths = {};
  for (const r of saved.values()) if (r.source === 'CalMac') calmacMonths[r.route] = (calmacMonths[r.route] || 0) + 1;
  const dropped = [];
  for (const [key, r] of saved) {
    if (r.source !== 'CalMac' && (calmacMonths[r.route] || 0) >= 12) { dropped.push(r); saved.delete(key); }
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

  // The months saved for each route, first to last, and how many are estimates
  const ym = r => `${r.year}-${String(r.month).padStart(2, '0')}`;
  const coverage = {};
  for (const r of rows) {
    const c = coverage[r.route] ||= { months: 0, estimates: 0, from: ym(r), to: ym(r) };
    c.months++;
    if (r.source !== 'CalMac') c.estimates++;
    if (ym(r) < c.from) c.from = ym(r);
    if (ym(r) > c.to) c.to = ym(r);
  }

  const changed = added.length + updated.length + dropped.length > 0;
  if (!dry && changed) {
    await kvSetJson('reliability', { at, rows });
    await kvSetJson(THRESHOLDS_KEY, { at, source: 'CalMac reports', thresholds });
  }

  say(`${found.size} route-months read from CalMac: ${added.length} new, ${updated.length} replacing an estimate or older figure; ${dropped.length} estimates dropped.`);
  const list = items => items.slice(0, 40).concat(items.length > 40 ? [`… and ${items.length - 40} more`] : []);
  return {
    ok: found.size > 0,
    sources,
    added: list(added.map(r => `${r.route} ${ym(r)}: ${r.reliability}%`)),
    updated: list(updated.map(r => `${r.route} ${ym(r)}: ${r.was}% → ${r.reliability}%`)),
    // Estimates for months CalMac hasn't published, on routes it has a year of
    estimatesDropped: list(dropped.map(r => `${r.route} ${ym(r)}: ${r.reliability}%`)),
    reliabilityMonths: rows.length,
    coverage: Object.fromEntries(Object.entries(coverage).map(([route, c]) => [route, `${c.from} → ${c.to} (${c.months} months${c.estimates ? `, ${c.estimates} of them estimates` : ''})`])),
    thresholdChanges: changes,
    saved: !dry && changed,
    failed,
    // Route pages read but with no months found in them (the first few in full)
    unread: unread.map((u, i) => (i < 3 ? u : { route: u.route, pdfUrl: u.pdfUrl })),
  };
}

await runJob({ name: 'monthly' }, ingestReports);
