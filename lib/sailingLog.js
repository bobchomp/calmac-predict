// The per-sailing log: for every CalMac sailing, the chance the site showed
// for it before it left, whether it sailed, and whether the prediction was
// right. Written by lib/tracker.js, read by pages/api/sailings.js.
//
// Stored in Redis as one key per UK date, `sailings:YYYY-MM-DD`, holding
// { [route|time|from]: record }:
//   { route, date, time, from, to,
//     first: { chance, weather, old, at }  earliest prediction (can be the day before);
//                                     weather is before CalMac's cancellations, old
//                                     the old points model's chance (dev, to compare)
//     last:  { chance, weather, old, at }  latest prediction before departure
//     seen:  { status, reason, at },  CalMac's status at the latest look before departure
//     warned: true | false,           a CalMac notice warning it was liable to disruption
//                                     or cancellation, at the latest look (since 21 Oct 2026)
//     warnedAt: ISO | undefined,      when such a warning was first seen before it left
//     met: ['yellow wind', …],        Met Office warnings in force for its route when it
//                                     leaves, at the latest look (since 22 Oct 2026)
//     metAt: ISO | undefined,         when one was first seen before it left
//     outcome: { sailed, status, reason, at } | undefined until resolved
//                                     (sailed null: couldn't tell, left out of the figures)
//     correct: true | false | null }  the last prediction against the outcome

import { sailingInfo } from './disruptions';
import { NON_CALMAC_ROUTES, ROUTES } from './routes';

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
  const info = sailingInfo(disruption, false, time, from);
  return { status: info?.status || 'normal', reason: info?.reason || null };
}

// ── Figures ──
// A day's figures are kept per route (`sailings:stats:YYYY-MM-DD`), small
// enough to add up 90 days of them: counts, plus how many sailed out of the
// sailings in each 5% band of the last prediction (bins[i] = [count, sailed]).
// Where the log has the old model's chance too, how the two compare: the
// sailings compared, each one's squared error added up (brier), how many
// each called right, and each one's cancellations predicted and false alarms. How sailings with a CalMac warning in force before they
// left did against the rest: how many, how many sailed, and what we said
// for them added up. Routes CalMac doesn't run are left out.
export const STATS_KEY = date => `sailings:stats:${date}`;
const COUNTS = ['sailings', 'pending', 'resolved', 'correct', 'firstCorrect', 'cancelled', 'cancelledPredicted', 'falseAlarms', 'compared', 'brierNew', 'brierOld', 'correctNew', 'correctOld',
  'cancelledCompared', 'caughtNew', 'caughtOld', 'falseNew', 'falseOld',
  'warned', 'warnedSailed', 'warnedSaid', 'notWarned', 'notWarnedSailed', 'notWarnedSaid',
  'metWarned', 'metWarnedSailed', 'metWarnedSaid', 'metNotWarned', 'metNotWarnedSailed', 'metNotWarnedSaid'];
const BIN = 5, BINS = 20;
const emptyStats = () => ({ ...Object.fromEntries(COUNTS.map(k => [k, 0])), bins: Array.from({ length: BINS }, () => [0, 0]) });

// { routes: { [route]: stats } } from a day's log
export function dayStats(log) {
  const routes = {};
  for (const r of Object.values(log || {})) {
    if (!r.last || NON_CALMAC_ROUTES.has(r.route)) continue;
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
    // Only sailings the tracker looked at for warnings (logged since 21 Oct 2026)
    if ('warned' in r) {
      const k = r.warnedAt ? 'warned' : 'notWarned';
      s[k]++;
      if (sailed) s[k + 'Sailed']++;
      s[k + 'Said'] += r.last.chance;
    }
    // ...and Met Office warnings (logged since 22 Oct 2026)
    if ('met' in r) {
      const k = r.metAt ? 'metWarned' : 'metNotWarned';
      s[k]++;
      if (sailed) s[k + 'Sailed']++;
      s[k + 'Said'] += r.last.chance;
    }
    if (r.last.old != null) {
      const y = sailed ? 1 : 0;
      s.compared++;
      s.brierNew += (r.last.chance / 100 - y) ** 2;
      s.brierOld += (r.last.old / 100 - y) ** 2;
      const saidOld = predictsSailing(r.last.old);
      if (said === sailed) s.correctNew++;
      if (saidOld === sailed) s.correctOld++;
      if (!sailed) { s.cancelledCompared++; if (!said) s.caughtNew++; if (!saidOld) s.caughtOld++; }
      else { if (!said) s.falseNew++; if (!saidOld) s.falseOld++; }
    }
  }
  return { routes };
}

// Days' stats added up, for every route or just one
export function addStats(days, route = null) {
  const total = emptyStats();
  for (const day of days) {
    for (const [name, s] of Object.entries(day?.routes || {})) {
      if ((route && name !== route) || NON_CALMAC_ROUTES.has(name)) continue;
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
    // The new model against the old on the same sailings (error: lower is better)
    comparison: t.compared ? {
      sailings: t.compared,
      errorNew: Number((t.brierNew / t.compared).toFixed(4)), errorOld: Number((t.brierOld / t.compared).toFixed(4)),
      correctNew: pct(t.correctNew, t.compared), correctOld: pct(t.correctOld, t.compared),
      cancelled: t.cancelledCompared, caughtNew: t.caughtNew, caughtOld: t.caughtOld,
      falseNew: t.falseNew, falseOld: t.falseOld,
    } : null,
    // Sailings with a CalMac "liable to disruption" warning against the rest:
    // what we said for them on average, and how many sailed
    // Likewise for Met Office warnings (metWarned, metNotWarned)
    warnings: t.warned + t.notWarned + t.metWarned + t.metNotWarned ? Object.fromEntries(['warned', 'notWarned', 'metWarned', 'metNotWarned'].map(k => [k, {
      sailings: t[k], said: t[k] ? Math.round(t[k + 'Said'] / t[k]) : null, sailedPct: pct(t[k + 'Sailed'], t[k]),
    }])) : null,
  };
}

// The new formula against the old, over every day given (the Accuracy page
// passes up to 90, whatever period it's showing). It's only worth judging
// once it covers COMPARE_MIN days with sailings compared and cancelled
// sailings among them (most of the difference is on cancellation days), so
// until then it's just the progress towards that.
export const COMPARE_MIN = { days: 14, cancelled: 50 };
export function formulaComparison(dates, stats, route = null) {
  const byDay = dates.map((date, i) => ({ date, ...figures(addStats([stats[i]], route)).comparison })).filter(d => d.sailings);
  const total = figures(addStats(stats, route)).comparison;
  const progress = { since: byDay[0]?.date || null, days: byDay.length, sailings: total?.sailings || 0, cancelled: total?.cancelled || 0 };
  const ready = progress.days >= COMPARE_MIN.days && progress.cancelled >= COMPARE_MIN.cancelled;
  if (!ready) return { ready, progress, needs: COMPARE_MIN };
  const byRoute = route ? [] : ROUTES.map(r => ({ route: r.name, ...figures(addStats(stats, r.name)).comparison })).filter(r => r.sailings);
  return { ready, progress, needs: COMPARE_MIN, total, byDay, byRoute };
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
