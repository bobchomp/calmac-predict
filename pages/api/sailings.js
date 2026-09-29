// api/sailings.js — the per-sailing log (lib/sailingLog.js)
//   GET /api/sailings                     how the predictions did, last 30 days (?days= up to 90)
//   GET /api/sailings?date=YYYY-MM-DD     every sailing logged that day
//   GET /api/sailings?date=…&format=csv   the same as a spreadsheet

import { kvConfigured, kvGetJsonMany } from '../../lib/kv';
import { LOG_KEY, summarise } from '../../lib/sailingLog';
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
      return res.status(200).json({ ok: true, date, ...summarise(records), records });
    }

    const days = Math.min(90, Math.max(1, parseInt(req.query?.days, 10) || 30));
    const dates = Array.from({ length: days }, (_, i) => ukDateStr(-i));
    const logs = await kvGetJsonMany(dates.map(LOG_KEY));
    const records = logs.flatMap(log => Object.values(log || {}));
    const withData = dates.filter((d, i) => logs[i] && Object.keys(logs[i]).length);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, days, since: withData.at(-1) || null, ...summarise(records) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
