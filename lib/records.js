// The status-and-weather snapshots (once the Google Sheet's SailingRecords
// tab): each route's CalMac status and the weather there, every 15 minutes.
// Kept in Redis per UK day as { cols, rows }, each row an array in cols' order.

export const RECORD_COLS = ['at', 'route', 'status', 'reason', 'gust_ms', 'wind_ms', 'wave_m', 'weather_code'];
export const RECORDS_KEY = date => `records:${date}`;

export const ukDateOf = at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(at));

// One day's rows with more added: a row already there (same time and route)
// is kept, the rest sorted in by time
export function mergeRecords(existing, incoming) {
  const id = row => `${row[0]}|${row[1]}`;
  const seen = new Set((existing?.rows || []).map(id));
  const rows = [...(existing?.rows || []), ...incoming.filter(row => !seen.has(id(row)) && seen.add(id(row)))];
  rows.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
  return { cols: RECORD_COLS, rows };
}
