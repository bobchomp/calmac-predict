// api/track-sailings.js — the per-sailing log (lib/sailingLog.js)
// Called by cron-job.org every 15 minutes via:
//   GET /api/track-sailings  with header  Authorization: Bearer <CRON_SECRET>
//
// Each run, for today's and tomorrow's timetabled sailings:
// 1. Before departure: saves the chance the site shows for the sailing (the
//    same forecast, thresholds and sums as its card row), and CalMac's
//    current status for it.
// 2. From 10 minutes after departure: records whether it sailed (CalMac
//    hadn't cancelled it) and whether the last prediction was right.

import { SHEET_SCRIPT_URL as DEFAULT_SHEET_URL } from '../../lib/config';
import { sailingChanceAt, sailingsForDay } from '../../lib/card';
import { disruptionsByRoute } from '../../lib/disruptions';
import { forecastUrls, routeWeather } from '../../lib/forecast';
import { kvConfigured, kvGetJsonMany, kvSetJson } from '../../lib/kv';
import { ROUTES } from '../../lib/routes';
import { LOG_KEY, STATS_KEY, TRACKER_KEY, dayStats, departureMs, predictsSailing, sailingOutcome } from '../../lib/sailingLog';
import { ukDateStr } from '../../lib/timetable';

const BASE_URL = process.env.CRON_BASE_URL || 'https://www.willitsail.co.uk';
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL || DEFAULT_SHEET_URL;
const CRON_SECRET = process.env.CRON_SECRET || '';

const RESOLVE_AFTER_MS = 10 * 60 * 1000;
// A status seen this long before departure still counts if no later look came
const SEEN_GOOD_FOR_MS = 3 * 60 * 60 * 1000;
const KEEP_SECONDS = 400 * 24 * 60 * 60;

const ukHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));

async function getJson(url, ms) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url, BASE_URL).pathname}`);
  return r.json();
}

export default async function handler(req, res) {
  const secret = req.query?.secret || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!CRON_SECRET || secret !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!kvConfigured()) return res.status(200).json({ ok: false, note: 'Redis not configured' });

  // Each run leaves a note of how it went (shown by /api/sailings and the
  // Status tab), so a failing run can be seen without the server logs
  const progress = { stage: 'starting' };
  try {
    const result = await trackSailings(progress);
    await kvSetJson(TRACKER_KEY, { at: new Date().toISOString(), ok: true, predicted: result.predicted, resolved: result.resolved, inputs: result.inputs }).catch(() => {});
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const error = `${progress.stage}: ${err?.message || err}${err?.cause?.message ? ` (${err.cause.message})` : ''}`;
    console.error('[track-sailings] failed', error, err);
    await kvSetJson(TRACKER_KEY, { at: new Date().toISOString(), ok: false, error }).catch(() => {});
    return res.status(500).json({ ok: false, error });
  }
}

async function trackSailings(progress) {
  progress.stage = 'fetching';
  const now = Date.now();
  const at = new Date(now).toISOString();
  const [yesterday, today, tomorrow] = [ukDateStr(-1), ukDateStr(0), ukDateStr(1)];
  const { windUrl, marineUrl } = forecastUrls();

  const [status, ttToday, ttTomorrow, wind, marine, thresholds, logs] = await Promise.allSettled([
    getJson(`${BASE_URL}/api/status`, 15000),
    getJson(`${BASE_URL}/api/timetable?date=${today}`, 20000),
    getJson(`${BASE_URL}/api/timetable?date=${tomorrow}`, 20000),
    getJson(windUrl, 15000),
    getJson(marineUrl, 15000),
    getJson(`${SHEET_SCRIPT_URL}?action=getThresholds`, 20000),
    kvGetJsonMany([yesterday, today, tomorrow].map(LOG_KEY)),
  ]);
  if (logs.status === 'rejected') { progress.stage = 'reading the log'; throw logs.reason; }
  const log = { [yesterday]: logs.value[0] || {}, [today]: logs.value[1] || {}, [tomorrow]: logs.value[2] || {} };
  const changed = new Set();

  // The site's inputs: forecast per route, thresholds, timetables, CalMac status
  const value = r => (r.status === 'fulfilled' ? r.value : null);
  const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const windArr = asArray(value(wind));
  const marineArr = asArray(value(marine));
  const hour = ukHour();
  const routes = windArr.length
    ? Object.fromEntries(ROUTES.map((r, i) => [r.name, { name: r.name, ...routeWeather(windArr[i]?.hourly || {}, marineArr[i]?.hourly || null, hour) }]))
    : null;
  const thresholdData = value(thresholds)?.thresholds || null;
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
          const chance = sailingChanceAt(route, s.t, isTomorrow, thresholdData);
          if (chance !== null) {
            rec = log[date][id] ||= { route: name, date, time: s.t, from: s.f, to: s.to };
            rec.first ||= { chance, at };
            rec.last = { chance, at };
            changed.add(date);
            predicted++;
          }
        }
        if (rec && !isTomorrow && disruptions) {
          rec.seen = { ...sailingOutcome(disruptions[name], s.t, s.f), at };
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

  // Each changed day, and the figures for days that have had departures
  progress.stage = 'saving the log';
  await Promise.all([...changed].flatMap(date => [
    kvSetJson(LOG_KEY(date), log[date], KEEP_SECONDS),
    date !== tomorrow && kvSetJson(STATS_KEY(date), dayStats(log[date]), KEEP_SECONDS),
  ].filter(Boolean)));

  return {
    predicted,
    resolved,
    inputs: {
      forecast: !!routes,
      thresholds: !!thresholdData,
      calmacStatus: !!disruptions,
      timetables: { [today]: !!timetable[today], [tomorrow]: !!timetable[tomorrow] },
    },
    logged: Object.fromEntries([yesterday, today, tomorrow].map(d => [d, Object.keys(log[d]).length])),
  };
}
