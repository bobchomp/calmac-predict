// api/sailings.js — the per-sailing log (lib/sailingLog.js)
//   GET /api/sailings                     how the predictions did, last 30 days (?days= up to 90,
//                                         ?route= for one route): totals, by day, by route and by
//                                         what we said, and how the tracker's latest run went
//   GET /api/sailings?date=YYYY-MM-DD     every sailing logged that day
//   GET /api/sailings?date=…&format=csv   the same as a spreadsheet

import { kvConfigured, kvGetJsonMany } from '../../lib/kv';
import { ROUTES } from '../../lib/routes';
import { LOG_KEY, STATS_KEY, TRACKER_KEY, addStats, calibration, dayStats, figures, summarise, verdictBands } from '../../lib/sailingLog';
import { ukDateStr } from '../../lib/timetable';

const CSV_COLUMNS = [
  ['date', r => r.date], ['time', r => r.time], ['route', r => r.route], ['from', r => r.from], ['to', r => r.to],
  ['first_chance', r => r.first?.chance], ['first_at', r => r.first?.at],
  ['last_chance', r => r.last?.chance], ['last_at', r => r.last?.at],
  ['sailed', r => (r.outcome ? (r.outcome.sailed === null ? 'unknown' : r.outcome.sailed ? 'yes' : 'no') : 'pending')],
  ['calmac_status', r => r.outcome?.status ?? r.seen?.status], ['reason', r => r.outcome?.reason ?? r.seen?.reason],
  ['correct', r => (r.correct == null ? '' : r.correct ? 'yes' : 'no')],
];
const csvCell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const byTime = (a, b) => a.time.localeCompare(b.time) || a.route.localeCompare(b.route);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!kvConfigured()) return res.status(200).json({ ok: false, note: 'Redis not configured' });

  try {
    const date = req.query?.date;
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      const [log] = await kvGetJsonMany([LOG_KEY(date)]);
      const records = Object.values(log || {}).sort(byTime);
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="sailings-${date}.csv"`);
        return res.status(200).send([CSV_COLUMNS.map(c => c[0]).join(','), ...records.map(r => CSV_COLUMNS.map(c => csvCell(c[1](r))).join(','))].join('\n') + '\n');
      }
      return res.status(200).json({ ok: true, date, ...summarise(log), records });
    }

    const days = Math.min(90, Math.max(1, parseInt(req.query?.days, 10) || 30));
    const route = req.query?.route || null;
    const dates = Array.from({ length: days }, (_, i) => ukDateStr(-i)).reverse();
    const [tracker, ...stats] = await kvGetJsonMany([TRACKER_KEY, ...dates.map(STATS_KEY)]);
    // Figures for the last two days come from their logs if the tracker
    // hasn't written them yet
    const missing = dates.slice(-2).filter((d, i) => !stats[dates.length - 2 + i]);
    if (missing.length) {
      const logs = await kvGetJsonMany(missing.map(LOG_KEY));
      missing.forEach((d, i) => { if (logs[i]) stats[dates.indexOf(d)] = dayStats(logs[i]); });
    }
    const total = addStats(stats, route);
    const byDay = dates.map((date, i) => ({ date, ...figures(addStats([stats[i]], route)) })).filter(d => d.sailings);
    const byRoute = ROUTES.map(r => r.name).filter(name => !route || name === route)
      .map(name => ({ route: name, ...figures(addStats(stats, name)) })).filter(r => r.sailings);
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=120');
    return res.status(200).json({
      ok: true, days, route, since: byDay[0]?.date || null, tracker,
      ...figures(total), bands: verdictBands(total), calibration: calibration(total), byDay, byRoute,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
