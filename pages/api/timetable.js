// api/timetable.js — scheduled sailings for one day from the CalMac GraphQL API
//   GET /api/timetable?date=YYYY-MM-DD   (defaults to today, UK time)
// Returns { date, routes: { [siteRouteName]: [{ t:'HH:MM', f:'Origin', to:'Destination' }] } }
// Each leg of a multi-stop sailing is its own row. Times are Europe/London.

const ROUTE_MAP = require('../../lib/route-map');

const ukDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' });
const ukTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function previousDay(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const date = req.query?.date || ukDate.format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  // Sailings are filed under their service day, so a leg departing after
  // midnight can sit under the previous sailingDate.
  const query = `{
    sailings(where: { sailingDate: { in: ["${previousDay(date)}", "${date}"] } }) {
      route { name }
      legs { departureDateTime originPort { name } destinationPort { name } }
    }
  }`;

  try {
    const resp = await fetch('https://apim.calmac.co.uk/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://www.calmac.co.uk',
        'Referer': 'https://www.calmac.co.uk/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      },
      body: JSON.stringify({ variables: {}, query }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`GraphQL ${resp.status}`);
    const json = await resp.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);

    // Every CalMac route gets an entry, so an empty list means "no sailings that day"
    const routes = Object.fromEntries(Object.values(ROUTE_MAP).map(n => [n, []]));
    const seen = new Set();
    for (const sailing of json.data?.sailings || []) {
      const name = ROUTE_MAP[sailing.route?.name];
      if (!name) continue;
      for (const leg of sailing.legs || []) {
        const dep = new Date(leg.departureDateTime);
        if (isNaN(dep) || ukDate.format(dep) !== date) continue;
        const row = { t: ukTime.format(dep), f: leg.originPort?.name || '', to: leg.destinationPort?.name || '' };
        const key = `${name}|${row.t}|${row.f}|${row.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routes[name].push(row);
      }
    }
    for (const rows of Object.values(routes)) rows.sort((a, b) => a.t.localeCompare(b.t));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ date, source: 'apim.calmac.co.uk/graphql', routes });
  } catch (err) {
    console.error('Timetable fetch failed:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: err.message });
  }
};
