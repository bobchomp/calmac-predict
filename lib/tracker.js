// The per-sailing log (lib/sailingLog.js), and the status-and-weather
// snapshots (lib/records.js), run every 15 minutes by the GitHub Actions
// tracker job (scripts/jobs/tracker.mjs).
//
// Each run, for today's and tomorrow's timetabled sailings:
// 1. Before departure: saves the chance the site shows for the sailing (the
//    same forecast, thresholds and sums as its card row, so 0 once CalMac
//    has cancelled it), the forecast's own chance beside it (weather), the
//    old points model's chance (old, to compare the two), CalMac's current
//    status for it, and whether a CalMac notice warns it's liable to
//    disruption or cancellation (to see later whether those warnings
//    should lower the score; they don't yet).
// 2. From 10 minutes after departure: records whether it sailed (CalMac
//    hadn't cancelled it) and whether the last prediction was right.
// And, with { snapshot: true }, each route's CalMac status and weather now.
//
// With { dry: true } nothing is saved: the result says what would have been,
// and how its chances compare with the ones already in the log.
//
// Open-Meteo turns GitHub's shared addresses away now and then; a run it
// refuses uses the last forecast fetched, if it's recent (fetchForecast).

import { sailingChanceAt, sailingsForDay } from './card';
import { disruptionsByRoute, sailingInfo, warnedFor } from './disruptions';
import { forecastUrls, routeWeather } from './forecast';
import { kvGetJsonMany, kvSetJson } from './kv';
import { RECORDS_KEY, mergeRecords, ukDateOf } from './records';
import { ROUTES } from './routes';
import { oldChanceAt } from './risk';
import { loadThresholds } from './thresholds';
import { LOG_KEY, STATS_KEY, TRACKER_KEY, dayStats, departureMs, predictsSailing, sailingOutcome } from './sailingLog';
import { ukDateStr } from './timetable';

const RESOLVE_AFTER_MS = 10 * 60 * 1000;
// A status seen this long before departure still counts if no later look came
const SEEN_GOOD_FOR_MS = 3 * 60 * 60 * 1000;
const KEEP_SECONDS = 400 * 24 * 60 * 60;

const ukHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));

// Open-Meteo turns away busy shared addresses (429) now and then, as GitHub's
// runners and Vercel's functions are: a failed request is tried twice more
export async function getJson(url, ms, baseUrl) {
  for (const wait of [2000, 5000, null]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
      if (r.ok) return await r.json();
      const err = new Error(`HTTP ${r.status} from ${new URL(url, baseUrl).host}${new URL(url, baseUrl).pathname}`);
      if (wait === null || (r.status < 500 && r.status !== 429)) throw Object.assign(err, { final: true });
      throw err;
    } catch (err) {
      if (wait === null || err.final) throw err;
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}

// Open-Meteo's forecast (wind and marine responses, as forecastUrls asks for
// them), each falling back to the last one fetched when a request fails. A
// saved one is used only if it's for the same request (the same routes, in
// the same order), from the same UK day (its hours are indexed from that
// midnight) and under an hour old; each good one is saved (kept two hours)
// unless save is false. saved: how many minutes old each saved
// one used is.
export const SAVED_FORECAST_KEY = part => `forecast:${part}`;
const SAVED_FORECAST_FOR_MS = 60 * 60 * 1000;
export async function fetchForecast({ baseUrl, save = true }) {
  const { windUrl, marineUrl } = forecastUrls();
  const at = new Date().toISOString();
  const today = ukDateStr(0);
  const urls = { wind: windUrl, marine: marineUrl };
  const results = await Promise.allSettled([getJson(windUrl, 15000, baseUrl), getJson(marineUrl, 15000, baseUrl)]);
  const out = { wind: null, marine: null, saved: {}, errors: {} };
  const failed = [];
  const saves = [];
  ['wind', 'marine'].forEach((part, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      out[part] = r.value;
      if (save) saves.push(kvSetJson(SAVED_FORECAST_KEY(part), { at, date: today, url: urls[part], data: r.value }, 2 * 60 * 60).catch(() => {}));
    } else {
      out.errors[part] = r.reason?.message || String(r.reason);
      failed.push(part);
    }
  });
  if (failed.length) {
    const saved = await kvGetJsonMany(failed.map(SAVED_FORECAST_KEY)).catch(() => failed.map(() => null));
    failed.forEach((part, i) => {
      const s = saved[i];
      const age = s ? Date.now() - Date.parse(s.at) : Infinity;
      if (s?.url === urls[part] && s.date === today && age < SAVED_FORECAST_FOR_MS) {
        out[part] = s.data;
        out.saved[part] = Math.round(age / 60000);
      }
    });
  }
  await Promise.all(saves);
  return out;
}

// The run note shown by /api/sailings and the Status tab
export async function runTracker({ baseUrl, snapshot = false, dry = false }) {
  const progress = { stage: 'starting' };
  try {
    const result = await trackSailings({ baseUrl, snapshot, dry, progress });
    if (!dry) await kvSetJson(TRACKER_KEY, { at: new Date().toISOString(), ok: true, predicted: result.predicted, resolved: result.resolved, inputs: result.inputs }).catch(() => {});
    return { ok: true, ...result };
  } catch (err) {
    const error = `${progress.stage}: ${err?.message || err}${err?.cause?.message ? ` (${err.cause.message})` : ''}`;
    if (!dry) await kvSetJson(TRACKER_KEY, { at: new Date().toISOString(), ok: false, error }).catch(() => {});
    return { ok: false, error };
  }
}

async function trackSailings({ baseUrl, snapshot, dry, progress }) {
  progress.stage = 'fetching';
  const now = Date.now();
  const at = new Date(now).toISOString();
  const [yesterday, today, tomorrow] = [ukDateStr(-1), ukDateStr(0), ukDateStr(1)];

  const [status, ttToday, ttTomorrow, forecastResult, thresholds, logs] = await Promise.allSettled([
    getJson(`${baseUrl}/api/status`, 15000, baseUrl),
    getJson(`${baseUrl}/api/timetable?date=${today}`, 20000, baseUrl),
    getJson(`${baseUrl}/api/timetable?date=${tomorrow}`, 20000, baseUrl),
    fetchForecast({ baseUrl, save: !dry }),
    loadThresholds(),
    kvGetJsonMany([yesterday, today, tomorrow].map(LOG_KEY)),
  ]);
  if (logs.status === 'rejected') { progress.stage = 'reading the log'; throw logs.reason; }
  const log = { [yesterday]: logs.value[0] || {}, [today]: logs.value[1] || {}, [tomorrow]: logs.value[2] || {} };
  // What the log held before this run, to compare a dry run's chances with
  const before = dry ? JSON.parse(JSON.stringify(log)) : null;
  const changed = new Set();

  // The site's inputs: forecast per route, thresholds, timetables, CalMac status
  const value = r => (r.status === 'fulfilled' ? r.value : null);
  const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const forecast = value(forecastResult) || { wind: null, marine: null, saved: {}, errors: {} };
  const windArr = asArray(forecast.wind);
  const marineArr = asArray(forecast.marine);
  const hour = ukHour();
  const routes = windArr.length
    ? Object.fromEntries(ROUTES.map((r, i) => [r.name, { name: r.name, ...routeWeather(windArr[i]?.hourly || {}, marineArr[i]?.hourly || null, hour) }]))
    : null;
  const thresholdData = value(thresholds)?.thresholds || null;
  const thresholdSource = value(thresholds)?.source || null;
  const timetable = { [today]: value(ttToday)?.routes, [tomorrow]: value(ttTomorrow)?.routes };
  const statusData = value(status);
  const disruptions = statusData && !statusData.fallback ? disruptionsByRoute(statusData) : null;

  // 1. Predictions (and today's CalMac status) for sailings yet to leave
  progress.stage = 'predicting';
  let predicted = 0;
  for (const [date, isTomorrow] of [[today, false], [tomorrow, true]]) {
    for (const { name } of ROUTES) {
      const route = routes?.[name];
      // Tomorrow's chance needs tomorrow's forecast, else there's none (as the site)
      const hasForecast = route && (isTomorrow ? route.tomorrow?.hourly : route.hourlyData);
      for (const s of sailingsForDay(timetable, name, isTomorrow).sailings) {
        if (departureMs(date, s.t) <= now) continue;
        const id = `${name}|${s.t}|${s.f}`;
        let rec = log[date][id];
        if (hasForecast) {
          const weather = sailingChanceAt(route, s.t, isTomorrow, thresholdData);
          const chance = sailingChanceAt(route, s.t, isTomorrow, thresholdData, disruptions?.[name] || null, s.f);
          if (chance !== null) {
            const cancelled = sailingInfo(disruptions?.[name] || null, isTomorrow, s.t, s.f)?.status === 'cancelled';
            const old = cancelled ? 0 : oldChanceAt(name, Math.min(Number(s.t.split(':')[0]), 23),
              isTomorrow ? route.tomorrow.hourly : route.hourlyData, isTomorrow ? route.tomorrow.marine : route.marineData,
              thresholdData, Number(date.slice(5, 7)));
            rec = log[date][id] ||= { route: name, date, time: s.t, from: s.f, to: s.to };
            rec.first ||= { chance, weather, old, at };
            rec.last = { chance, weather, old, at };
            changed.add(date);
            predicted++;
          }
        }
        if (rec && !isTomorrow && disruptions) {
          rec.seen = { ...sailingOutcome(disruptions[name], s.t, s.f), at };
          changed.add(date);
        }
        // A warning in force at this look, and when one was first seen
        if (rec && disruptions) {
          rec.warned = warnedFor(disruptions[name], date, departureMs(date, s.t), new Date(now));
          if (rec.warned) rec.warnedAt ||= at;
          changed.add(date);
        }
      }
    }
  }

  // 2. Outcomes for sailings that have left
  progress.stage = 'recording outcomes';
  let resolved = 0;
  for (const date of [yesterday, today]) {
    for (const rec of Object.values(log[date])) {
      if (rec.outcome || !rec.last) continue;
      const leaves = departureMs(date, rec.time);
      if (now < leaves + RESOLVE_AFTER_MS) continue;
      let outcome = null;
      if (date === today && disruptions) {
        outcome = sailingOutcome(disruptions[rec.route], rec.time, rec.from);
      } else if (rec.seen && leaves - Date.parse(rec.seen.at) <= SEEN_GOOD_FOR_MS) {
        outcome = { status: rec.seen.status, reason: rec.seen.reason };
      } else if (date !== today) {
        // No look at CalMac close enough to departure: can't tell
        outcome = { status: 'unknown', reason: null };
      }
      if (!outcome) continue; // CalMac's status unavailable this run: try again next time
      const sailed = outcome.status === 'unknown' ? null : outcome.status !== 'cancelled';
      rec.outcome = { sailed, ...outcome, at };
      rec.correct = sailed === null ? null : predictsSailing(rec.last.chance) === sailed;
      changed.add(date);
      resolved++;
    }
  }

  // 3. Each route's CalMac status and weather now
  const snapshotRows = snapshot ? snapshotNow({ at, statusData, windArr, marineArr, hour }) : null;

  // Each changed day, and the figures for days that have had departures
  progress.stage = 'saving the log';
  if (!dry) {
    await Promise.all([...changed].flatMap(date => [
      kvSetJson(LOG_KEY(date), log[date], KEEP_SECONDS),
      date !== tomorrow && kvSetJson(STATS_KEY(date), dayStats(log[date]), KEEP_SECONDS),
    ].filter(Boolean)));
  }
  if (snapshotRows && !dry) {
    progress.stage = 'saving the snapshot';
    const key = RECORDS_KEY(ukDateOf(now));
    const [existing] = await kvGetJsonMany([key]);
    await kvSetJson(key, mergeRecords(existing, snapshotRows));
  }

  return {
    predicted,
    resolved,
    inputs: {
      forecast: !!routes,
      ...(Object.keys(forecast.saved).length && { forecastSavedMinutesAgo: forecast.saved }),
      ...(Object.keys(forecast.errors).length && { forecastErrors: forecast.errors }),
      thresholds: thresholdSource || false,
      ...(value(thresholds)?.error && { thresholdsError: value(thresholds).error }),
      calmacStatus: !!disruptions,
      timetables: { [today]: !!timetable[today], [tomorrow]: !!timetable[tomorrow] },
    },
    logged: Object.fromEntries([yesterday, today, tomorrow].map(d => [d, Object.keys(log[d]).length])),
    ...(snapshotRows && { snapshot: { routes: snapshotRows.length, withStatus: snapshotRows.filter(r => r[2] !== 'unknown').length, withWeather: snapshotRows.filter(r => r[4] !== null).length } }),
    ...(dry && { comparison: compareChances(before, log, [today, tomorrow], at) }),
  };
}

// The statuses the Google Sheet's snapshots used, from the site's status data
const SNAPSHOT_STATUS = { cancelled: 'cancelled', disrupted: 'disrupted', amber: 'aware', normal: 'normal' };
const SEVERITY = ['unknown', 'normal', 'aware', 'disrupted', 'cancelled'];
const round1 = v => (v == null ? null : Math.round(v * 10) / 10);

// One row per route (lib/records.js RECORD_COLS): CalMac's status, the
// reason for its first disruption, and the forecast for this hour in m/s
function snapshotNow({ at, statusData, windArr, marineArr, hour }) {
  const byRoute = {};
  for (const r of (statusData && !statusData.fallback ? statusData.routes : []) || []) {
    const status = SNAPSHOT_STATUS[r.status] || 'unknown';
    const reason = [...Object.values(r.sailingStatuses || {}), ...Object.values(r.sailingStatusesTomorrow || {})].find(s => s.reason)?.reason || null;
    // Two CalMac routes can be one of ours (Uig): keep the worse
    const prev = byRoute[r.routeKey];
    if (!prev || SEVERITY.indexOf(status) > SEVERITY.indexOf(prev.status)) byRoute[r.routeKey] = { status, reason };
  }
  return ROUTES.map((route, i) => {
    const wh = windArr[i]?.hourly || {};
    const mh = marineArr[i]?.hourly || {};
    const s = byRoute[route.name];
    return [
      at, route.name, s?.status || 'unknown', s?.reason || null,
      round1(wh.windgusts_10m?.[hour] ?? wh.windspeed_10m?.[hour]),
      round1(wh.windspeed_10m?.[hour]),
      round1(mh.wave_height?.[hour]),
      (wh.weather_code || wh.weathercode)?.[hour] ?? null,
    ];
  });
}

// For a dry run: how many of the chances it worked out match the ones the
// log already had for the same sailings, and the biggest difference
function compareChances(before, after, dates, at) {
  let compared = 0, same = 0, maxDiff = 0;
  for (const date of dates) {
    for (const [id, rec] of Object.entries(after[date])) {
      const old = before[date][id]?.last?.chance;
      if (old == null || rec.last?.at !== at) continue;
      compared++;
      const diff = Math.abs(old - rec.last.chance);
      if (diff === 0) same++;
      maxDiff = Math.max(maxDiff, diff);
    }
  }
  return { compared, same, maxDiff };
}
