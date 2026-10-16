// One-off move of the Google Sheet's data into Upstash Redis, run by the
// "Import the Google Sheet" GitHub Actions workflow. Reads every tab through
// the Apps Script's read-only export action, a page at a time, then:
//   dry run (default): reports what it read and what it would save
//   --write (or MODE=write): saves it, reads it back and checks it
//
// Saved as:
//   reliability     { at, rows: [{ route, year, month, scheduled, operated, cancelled, diverted, reliability }] }
//   thresholds      { at, source, thresholds: { [route]: { base, winter, summer, shoulder, samples, updated } } }
//   reports         { at, rows: [{ at, route, sailed, wind_mph, wave_m, notes }] }
//   records:<date>  { cols, rows }  (lib/records.js; merged with any already there)
//   import:sheet    a note of the import
//
// The repo is public, so its logs show counts and figures, never rows.
//
// Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, SHEET_EXPORT_KEY,
//      SHEET_URL (optional; the site's Sheet in lib/config.js otherwise)

import { appendFileSync } from 'node:fs';
import { SHEET_SCRIPT_URL } from '../lib/config.js';
import { RECORD_COLS, RECORDS_KEY, mergeRecords, ukDateOf } from '../lib/records.js';
import { calcThresholds } from '../lib/reliability.js';

const WRITE = process.argv.includes('--write') || process.env.MODE === 'write';
const SHEET_URL = process.env.SHEET_URL || SHEET_SCRIPT_URL;
const KEY = process.env.SHEET_EXPORT_KEY || '';
const KV_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const PAGE = Number(process.env.PAGE_SIZE) || 5000;

const TABS = { reliability: 'route_reliability', thresholds: 'route_thresholds', reports: 'user_reports', records: 'SailingRecords' };

const summary = [];
const say = (line = '') => { console.log(line); summary.push(line); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A refusal (err.final) isn't worth trying again
async function retrying(what, fn, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) {
      if (i >= tries || err.final) throw new Error(`${what}: ${err.message}`);
      console.warn(`${what} failed (${err.message}), trying again`);
      await sleep(2000 * 2 ** (i - 1));
    }
  }
}

// ── The Sheet ──
async function exportPage(tab, offset) {
  const url = `${SHEET_URL}?action=export&tab=${encodeURIComponent(tab)}&offset=${offset}&limit=${PAGE}&key=${encodeURIComponent(KEY)}`;
  return retrying(`${tab} from row ${offset}`, async () => {
    const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { throw new Error('the Sheet replied with something other than JSON (is the new Apps Script version deployed?)'); }
    if (json.error) throw Object.assign(new Error(`the Sheet said: ${json.error}`), { final: /not allowed|unknown/i.test(json.error) });
    return json;
  });
}

async function readTab(tab) {
  const first = await exportPage(tab, 0);
  const rows = [...first.rows];
  while (rows.length < first.total) {
    const page = await exportPage(tab, rows.length);
    if (!page.rows.length) break;
    rows.push(...page.rows);
    console.log(`  ${tab}: ${rows.length} / ${first.total}`);
  }
  return { headers: first.headers, total: first.total, rows };
}

// ── Redis ──
async function kv(args) {
  return retrying(`Redis ${args[0]} ${args[1] || ''}`, async () => {
    const r = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    return j.result;
  });
}
async function kvGetMany(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 10) {
    const values = await kv(['MGET', ...keys.slice(i, i + 10)]);
    out.push(...values.map(v => (v ? JSON.parse(v) : null)));
  }
  return out;
}
const kvSet = (key, value) => kv(['SET', key, JSON.stringify(value)]);

// ── Turning rows into data ──
const blank = v => v === '' || v === undefined || v === null;
const orNull = v => (blank(v) ? null : v);
const num = v => (blank(v) || Number.isNaN(Number(v)) ? null : Number(v));

function checkHeaders(name, headers, expected) {
  const got = headers.slice(0, expected.length).map(h => String(h).trim().toLowerCase());
  const want = expected.map(h => h.toLowerCase());
  if (got.join('|') !== want.join('|')) say(`⚠️ ${name} headers are [${headers.join(', ')}], expected [${expected.join(', ')}]`);
}

const fmtBytes = n => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

async function main() {
  const missing = [!KEY && 'SHEET_EXPORT_KEY', !KV_URL && 'UPSTASH_REDIS_REST_URL', !KV_TOKEN && 'UPSTASH_REDIS_REST_TOKEN'].filter(Boolean);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}`);
  const at = new Date().toISOString();

  say(`## Google Sheet → Upstash: ${WRITE ? 'write' : 'dry run'}`);
  say();

  console.log('Reading the Sheet…');
  const sheet = {};
  for (const [name, tab] of Object.entries(TABS)) sheet[name] = await readTab(tab);

  // Reliability (CalMac's monthly figures)
  const rel = sheet.reliability;
  const reliability = rel.rows.filter(r => !blank(r[0])).map(r => ({
    route: r[0], year: num(r[1]), month: num(r[2]), scheduled: num(r[3]), operated: num(r[4]),
    cancelled: num(r[5]), diverted: num(r[6]), reliability: num(r[7]),
  }));

  // Thresholds, as getThresholds() serves them to the site
  const thresholds = Object.fromEntries(sheet.thresholds.rows.filter(r => !blank(r[0])).map(r => [r[0], {
    base: parseFloat(r[1]) || null,
    winter: parseFloat(r[2]) || null,
    summer: parseFloat(r[3]) || null,
    shoulder: parseFloat(r[4]) || null,
    samples: parseInt(r[5]) || 0,
    updated: r[6] || '',
  }]));

  // "Did it sail" reports (the feature's gone; kept for the record)
  const reports = sheet.reports.rows.filter(r => !blank(r[1])).map(r => ({
    at: orNull(r[0]), route: r[1], sailed: r[2] === 'YES', wind_mph: num(r[3]), wave_m: num(r[4]), notes: orNull(r[5]),
  }));

  // Status-and-weather snapshots, per UK day
  checkHeaders(TABS.records, sheet.records.headers, ['Timestamp', 'Route', 'Status', 'DisruptionReason', 'Gust_ms', 'Wind_ms', 'Wave_m', 'WeatherCode']);
  const byDay = {};
  let badTime = 0;
  for (const r of sheet.records.rows) {
    const ms = Date.parse(r[0]);
    if (blank(r[0]) || Number.isNaN(ms)) { badTime++; continue; }
    const row = [new Date(ms).toISOString(), orNull(r[1]), orNull(r[2]), orNull(r[3]), num(r[4]), num(r[5]), num(r[6]), num(r[7])];
    (byDay[ukDateOf(ms)] ||= []).push(row);
  }
  const days = Object.keys(byDay).sort();
  const dayValues = Object.fromEntries(days.map(d => [d, mergeRecords(null, byDay[d])]));
  const kept = days.reduce((n, d) => n + dayValues[d].rows.length, 0);
  const sizes = days.map(d => JSON.stringify(dayValues[d]).length);
  const perDay = days.map(d => dayValues[d].rows.length);

  say('### What the Sheet has');
  say('| Tab | Rows | Saved as |');
  say('|---|---|---|');
  say(`| ${TABS.reliability} | ${rel.total} | \`reliability\`: ${reliability.length} months, ${new Set(reliability.map(r => r.route)).size} routes |`);
  say(`| ${TABS.thresholds} | ${sheet.thresholds.total} | \`thresholds\`: ${Object.keys(thresholds).length} routes |`);
  say(`| ${TABS.reports} | ${sheet.reports.total} | \`reports\`: ${reports.length} reports |`);
  say(`| ${TABS.records} | ${sheet.records.total} | \`records:<date>\`: ${kept} rows over ${days.length} days |`);
  say();
  if (sheet.records.rows.length !== sheet.records.total) say(`⚠️ Read ${sheet.records.rows.length} of ${sheet.records.total} SailingRecords rows`);
  if (badTime) say(`⚠️ ${badTime} SailingRecords rows had no readable time and are left out`);
  const dupes = sheet.records.rows.length - badTime - kept;
  if (dupes) say(`ℹ️ ${dupes} SailingRecords rows repeat another's time and route, and are kept once`);
  if (days.length) {
    say(`Snapshots run from ${days[0]} to ${days.at(-1)}: ${Math.min(...perDay)}–${Math.max(...perDay)} a day, ${fmtBytes(sizes.reduce((a, b) => a + b, 0))} in all, the largest day ${fmtBytes(Math.max(...sizes))}.`);
    const statuses = {};
    for (const d of days) for (const row of dayValues[d].rows) statuses[row[2]] = (statuses[row[2]] || 0) + 1;
    say(`Statuses: ${Object.entries(statuses).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ')}.`);
  }
  say();

  // Thresholds worked out here from the reliability figures, against the Sheet's
  const recalculated = calcThresholds(reliability, reports, at);
  const routes = [...new Set([...Object.keys(thresholds), ...Object.keys(recalculated)])].sort();
  const differences = [];
  for (const route of routes) {
    const a = thresholds[route], b = recalculated[route];
    if (!a || !b) { differences.push(`${route}: ${a ? 'only in the Sheet' : 'not in the Sheet'}`); continue; }
    const off = ['base', 'winter', 'summer', 'shoulder'].filter(k => (a[k] == null) !== (b[k] == null) || Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > 0.05);
    if (a.samples !== b.samples) off.push('samples');
    if (off.length) differences.push(`${route}: ${off.map(k => `${k} ${a[k]} in the Sheet, ${b[k]} worked out`).join('; ')}`);
  }
  say('### Thresholds');
  say(differences.length
    ? `⚠️ Working the thresholds out from the reliability figures differs from the Sheet's for ${differences.length} of ${routes.length} routes (the Sheet's are the ones saved):`
    : `✅ Working the thresholds out from the reliability figures gives the Sheet's own, for all ${routes.length} routes.`);
  for (const d of differences) say(`- ${d}`);
  say();

  if (!WRITE) {
    say('Dry run: nothing saved. Run the workflow again with **write** to save it.');
    return;
  }

  // ── Saving ──
  console.log('Saving…');
  const existing = await kvGetMany(days.map(RECORDS_KEY));
  const toSave = Object.fromEntries(days.map((d, i) => [d, existing[i] ? mergeRecords(existing[i], byDay[d]) : dayValues[d]]));
  const already = existing.filter(Boolean).length;
  for (const [i, d] of days.entries()) {
    await kvSet(RECORDS_KEY(d), toSave[d]);
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1} / ${days.length} days`);
  }
  await kvSet('reliability', { at, rows: reliability });
  await kvSet('thresholds', { at, source: 'Google Sheet', thresholds });
  await kvSet('reports', { at, rows: reports });

  // Read it all back
  console.log('Checking…');
  const problems = [];
  const back = await kvGetMany(days.map(RECORDS_KEY));
  days.forEach((d, i) => {
    const want = toSave[d].rows.length;
    const got = back[i]?.rows?.length;
    if (got !== want || back[i]?.cols?.join() !== RECORD_COLS.join()) problems.push(`records:${d} has ${got ?? 'nothing'}, expected ${want} rows`);
  });
  const [relBack, thrBack, repBack] = await kvGetMany(['reliability', 'thresholds', 'reports']);
  if (relBack?.rows?.length !== reliability.length) problems.push(`reliability has ${relBack?.rows?.length ?? 'nothing'}, expected ${reliability.length}`);
  if (JSON.stringify(thrBack?.thresholds) !== JSON.stringify(thresholds)) problems.push("thresholds don't match what was saved");
  if (repBack?.rows?.length !== reports.length) problems.push(`reports has ${repBack?.rows?.length ?? 'nothing'}, expected ${reports.length}`);

  const savedRows = days.reduce((n, d) => n + toSave[d].rows.length, 0);
  const note = { at, ok: !problems.length, reliability: reliability.length, thresholds: Object.keys(thresholds).length, reports: reports.length, records: savedRows, days: days.length, firstDay: days[0] || null, lastDay: days.at(-1) || null, problems };
  await kvSet('import:sheet', note);

  say('### Saved');
  say(`${days.length} days of snapshots (${savedRows} rows${already ? `; ${already} of the days were already in Upstash and were merged with the Sheet's` : ''}), ${reliability.length} reliability months, ${Object.keys(thresholds).length} routes' thresholds and ${reports.length} reports.`);
  say(problems.length ? `❌ Reading it back found ${problems.length} problems:` : '✅ Read back and checked: everything matches.');
  for (const p of problems.slice(0, 50)) say(`- ${p}`);
  if (problems.length) process.exitCode = 1;
}

main()
  .catch(err => {
    say(`❌ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
  });
