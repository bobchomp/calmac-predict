// The per-sailing log: for every CalMac sailing, the chance the site showed
// for it before it left, whether it sailed, and whether the prediction was
// right. Written by pages/api/track-sailings.js, read by pages/api/sailings.js.
//
// Stored in Redis as one key per UK date, `sailings:YYYY-MM-DD`, holding
// { [route|time|from]: record }:
//   { route, date, time, from, to,
//     first: { chance, at },          earliest prediction (can be the day before)
//     last:  { chance, at },          latest prediction before departure
//     seen:  { status, reason, at },  CalMac's status at the latest look before departure
//     outcome: { sailed, status, reason, at } | undefined until resolved
//                                     (sailed null: couldn't tell, left out of the figures)
//     correct: true | false | null }  the last prediction against the outcome

import { sailingStatusFor, statusesForDay } from './disruptions';

export const LOG_KEY = date => `sailings:${date}`;
// How the tracker's latest run went: { at, ok, error | predicted, resolved, inputs }
export const TRACKER_KEY = 'sailings:tracker';

// A prediction of 50% or more is a call that it sails
export const SAILS_FROM = 50;
export const predictsSailing = chance => chance >= SAILS_FROM;

// When a sailing leaves, from its UK date and 'HH:MM'
const ukClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function departureMs(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  const [uh, um] = ukClock.format(new Date(asUtc)).split(':').map(Number);
  let offset = (uh * 60 + um) - (hh * 60 + mm);
  if (offset < -720) offset += 1440;
  if (offset > 720) offset -= 1440;
  return asUtc - offset * 60000;
}

// CalMac's status for one of today's sailings, from its route's combined
// disruption (lib/disruptions.js disruptionsByRoute). A route cancelled with
// no per-sailing detail cancels every sailing.
export function sailingOutcome(disruption, time, from) {
  const statuses = statusesForDay(disruption, false);
  const info = sailingStatusFor(statuses, time, from);
  const cancelled = info?.status === 'cancelled' || (disruption?.status === 'cancelled' && !Object.keys(statuses).length);
  return {
    status: cancelled ? 'cancelled' : info?.status || 'normal',
    reason: info?.reason || null,
  };
}

// ── Figures ──
// A day's figures are kept per route (`sailings:stats:YYYY-MM-DD`), small
// enough to add up 90 days of them: counts, plus how many sailed out of the
// sailings in each 5% band of the last prediction (bins[i] = [count, sailed]).
export const STATS_KEY = date => `sailings:stats:${date}`;
const COUNTS = ['sailings', 'pending', 'resolved', 'correct', 'firstCorrect', 'cancelled', 'cancelledPredicted', 'falseAlarms'];
const BIN = 5, BINS = 20;
const emptyStats = () => ({ ...Object.fromEntries(COUNTS.map(k => [k, 0])), bins: Array.from({ length: BINS }, () => [0, 0]) });

// { routes: { [route]: stats } } from a day's log
export function dayStats(log) {
  const routes = {};
  for (const r of Object.values(log || {})) {
    if (!r.last) continue;
    const s = routes[r.route] ||= emptyStats();
    s.sailings++;
    if (!r.outcome) { s.pending++; continue; }
    if (r.outcome.sailed === null) continue;
    const said = predictsSailing(r.last.chance), sailed = r.outcome.sailed;
    s.resolved++;
    if (said === sailed) s.correct++;
    if (r.first && predictsSailing(r.first.chance) === sailed) s.firstCorrect++;
    if (!sailed) { s.cancelled++; if (!said) s.cancelledPredicted++; } else if (!said) s.falseAlarms++;
    const bin = s.bins[Math.min(BINS - 1, Math.floor(r.last.chance / BIN))];
    bin[0]++; if (sailed) bin[1]++;
  }
  return { routes };
}

// Days' stats added up, for every route or just one
export function addStats(days, route = null) {
  const total = emptyStats();
  for (const day of days) {
    for (const [name, s] of Object.entries(day?.routes || {})) {
      if (route && name !== route) continue;
      COUNTS.forEach(k => { total[k] += s[k] || 0; });
      s.bins.forEach(([n, sailed], i) => { total.bins[i][0] += n; total.bins[i][1] += sailed; });
    }
  }
  return total;
}

const pct = (part, whole) => (whole ? Math.round(part / whole * 100) : null);
const binsRange = (bins, from, to) => bins.slice(from / BIN, to / BIN).reduce((a, [n, s]) => [a[0] + n, a[1] + s], [0, 0]);

// The headline figures from added-up stats
export function figures(t) {
  return {
    sailings: t.sailings, pending: t.pending, resolved: t.resolved, correct: t.correct,
    accuracy: pct(t.correct, t.resolved),
    // The earliest prediction instead (for tomorrow's sailings, the day before)
    firstAccuracy: pct(t.firstCorrect, t.resolved),
    cancelled: t.cancelled, cancelledPredicted: t.cancelledPredicted, falseAlarms: t.falseAlarms,
  };
}

// How often sailings went, by the site's verdict for them (the same bands
// as its colours: likely 75+, caution 45-74, at risk under 45)
export function verdictBands(t) {
  return [['likely', 75, 100], ['caution', 45, 75], ['unlikely', 0, 45]].map(([verdict, from, to]) => {
    const [count, sailed] = binsRange(t.bins, from, to);
    return { verdict, count, sailedPct: pct(sailed, count) };
  });
}

// How often sailings went, for each 10% band of what we said
export function calibration(t) {
  return Array.from({ length: 10 }, (_, i) => {
    const [count, sailed] = binsRange(t.bins, i * 10, i * 10 + 10);
    return { from: i * 10, to: i === 9 ? 100 : i * 10 + 9, count, sailedPct: pct(sailed, count) };
  });
}

// Everything for one day's log (api/sailings.js ?date=)
export function summarise(log) {
  const t = addStats([dayStats(log)]);
  return { ...figures(t), bands: verdictBands(t) };
}
