// Per-season thresholds from CalMac's monthly reliability figures, worked
// out as the Google Sheet's recalculateThresholds() does: each route's
// average reliability % over all its months, and over its winter (Nov–Feb),
// summer (May–Sep) and shoulder (Mar, Apr, Oct) months. "Did it sail"
// reports count as 100 (sailed) or 0 (didn't).

export const WINTER = [11, 12, 1, 2];
export const SUMMER = [5, 6, 7, 8, 9];

const seasonOf = month => (WINTER.includes(month) ? 'winter' : SUMMER.includes(month) ? 'summer' : 'shoulder');

// To one decimal place; null for none (or 0, as the Sheet reads them back)
const average = values => (values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) || null : null);

const ukMonth = at => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: 'numeric' }).format(new Date(at)));

// reliability: [{ route, month, reliability }], reports: [{ at, route, sailed }]
// → { [route]: { base, winter, summer, shoulder, samples, updated } }
export function calcThresholds(reliability, reports = [], updated = new Date().toISOString()) {
  const byRoute = {};
  const add = (route, month, value) => {
    const d = byRoute[route];
    d.all.push(value);
    d[seasonOf(month)].push(value);
  };
  for (const row of reliability) {
    if (!row.route) continue;
    byRoute[row.route] ||= { all: [], winter: [], summer: [], shoulder: [] };
    add(row.route, parseInt(row.month), parseFloat(row.reliability));
  }
  for (const r of reports) {
    if (!r.route || !byRoute[r.route]) continue;
    add(r.route, ukMonth(r.at), r.sailed ? 100 : 0);
  }
  return Object.fromEntries(Object.entries(byRoute).map(([route, d]) => [route, {
    base: average(d.all),
    winter: average(d.winter),
    summer: average(d.summer),
    shoulder: average(d.shoulder),
    samples: d.all.length,
    updated,
  }]));
}
