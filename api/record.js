// api/record.js — Real-time sailing status recorder
// Called by cron-job.org every 30 minutes via:
//   GET https://willitsail.rossmackenzie.co.uk/api/record?secret=<CRON_SECRET>
//
// Fetches live CalMac route status + current weather for all 22 routes,
// then appends one row per route to the Google Sheet "SailingRecords" tab.
// Over time this builds a ground-truth database linking weather to outcomes.

const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL || '';
const CRON_SECRET      = process.env.CRON_SECRET       || '';

// All 22 routes with coordinates (matches client-side ROUTES array)
const ROUTES = [
  { name: 'Ardrossan - Brodick (Arran)',                   lat: 55.58, lon: -5.09 },
  { name: 'Troon - Brodick (Arran)',                       lat: 55.53, lon: -4.97 },
  { name: 'Kennacraig - Port Ellen / Port Askaig (Islay)', lat: 55.87, lon: -5.50 },
  { name: 'Oban - Craignure (Mull)',                       lat: 56.41, lon: -5.47 },
  { name: 'Oban - Coll / Tiree',                           lat: 56.62, lon: -6.52 },
  { name: 'Oban - Colonsay',                               lat: 56.07, lon: -6.19 },
  { name: 'Oban - Castlebay / Lochboisdale',               lat: 56.95, lon: -7.32 },
  { name: 'Mallaig - Armadale (Skye)',                     lat: 57.06, lon: -5.83 },
  { name: 'Ullapool - Stornoway (Lewis)',                   lat: 58.20, lon: -6.39 },
  { name: 'Uig - Tarbert / Lochmaddy',                     lat: 57.73, lon: -6.96 },
  { name: 'Gourock - Dunoon',                              lat: 55.96, lon: -4.92 },
  { name: 'Wemyss Bay - Rothesay (Bute)',                  lat: 55.84, lon: -5.05 },
  { name: 'Colintraive - Rhubodach (Bute)',                lat: 55.92, lon: -5.15 },
  { name: 'Largs - Cumbrae Slip',                          lat: 55.79, lon: -4.87 },
  { name: 'Tarbert - Portavadie',                          lat: 55.87, lon: -5.41 },
  { name: 'Claonaig - Lochranza (Arran)',                  lat: 55.70, lon: -5.39 },
  { name: 'Tobermory - Kilchoan',                          lat: 56.62, lon: -6.08 },
  { name: 'Fishnish - Lochaline',                          lat: 56.52, lon: -5.73 },
  { name: 'Mallaig - Small Isles',                         lat: 56.97, lon: -6.30 },
  { name: 'Oban - Lismore',                                lat: 56.50, lon: -5.49 },
  { name: 'Seil - Luing',                                  lat: 56.23, lon: -5.62 },
  { name: 'Port Askaig - Feolin (Jura)',                   lat: 55.85, lon: -6.10 },
];

// Maps CalMac GraphQL route names to our internal route keys
const ROUTE_MAP = {
  'Gourock - Dunoon':                                          'Gourock - Dunoon',
  'Wemyss Bay - Rothesay':                                     'Wemyss Bay - Rothesay (Bute)',
  'Ardrossan - Brodick':                                       'Ardrossan - Brodick (Arran)',
  'Troon - Brodick':                                           'Troon - Brodick (Arran)',
  'Claonaig - Lochranza':                                      'Claonaig - Lochranza (Arran)',
  'Largs - Cumbrae Slip (Millport)':                           'Largs - Cumbrae Slip',
  'Colintraive - Rhubodach':                                   'Colintraive - Rhubodach (Bute)',
  'Tarbert (Loch Fyne) - Portavadie':                          'Tarbert - Portavadie',
  'Uig - Lochmaddy':                                           'Uig - Tarbert / Lochmaddy',
  'Uig - Tarbert':                                             'Uig - Tarbert / Lochmaddy',
  'Kennacraig - Port Askaig (Islay) / Port Ellen (Islay)':    'Kennacraig - Port Ellen / Port Askaig (Islay)',
  'Oban - Craignure':                                          'Oban - Craignure (Mull)',
  'Oban - Castlebay':                                          'Oban - Castlebay / Lochboisdale',
  'Mallaig / Oban - Lochboisdale':                             'Oban - Castlebay / Lochboisdale',
  'Mallaig - Armadale':                                        'Mallaig - Armadale (Skye)',
  'Ullapool - Stornoway':                                      'Ullapool - Stornoway (Lewis)',
  'Lochaline - Fishnish':                                      'Fishnish - Lochaline',
  'Mallaig - Eigg/Muck/Rum/Canna':                             'Mallaig - Small Isles',
  'Oban - Coll/Tiree':                                         'Oban - Coll / Tiree',
  'Oban - Colonsay - Port Askaig - Kennacraig':               'Oban - Colonsay',
  'Oban - Lismore':                                            'Oban - Lismore',
  'Tobermory - Kilchoan':                                      'Tobermory - Kilchoan',
  'Tayinloan - Gigha':                                         'Tayinloan - Gigha',
  'Sconser - Raasay':                                          'Sconser - Raasay',
  'Fionnphort - Iona':                                         'Fionnphort - Iona',
};

const GRAPHQL_QUERY = `{
  routes {
    name
    status
    routeStatuses {
      status
      subStatus
      startDateTime
      endDateTime
      disruptionReason
    }
  }
}`;

// ── Fetch CalMac live status ──────────────────────────────────────────────
async function fetchCalMacStatus() {
  const resp = await fetch('https://apim.calmac.co.uk/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': 'https://www.calmac.co.uk',
      'Referer': 'https://www.calmac.co.uk/en-gb/service-status/',
    },
    body: JSON.stringify({ variables: {}, query: GRAPHQL_QUERY }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`CalMac GraphQL ${resp.status}`);
  const json = await resp.json();
  return json?.data?.routes || [];
}

// ── Fetch current weather for all routes in two batch requests ────────────
async function fetchCurrentWeather() {
  const lats = ROUTES.map(r => r.lat).join(',');
  const lons = ROUTES.map(r => r.lon).join(',');
  const hour = new Date().getHours();

  const [windResp, marineResp] = await Promise.allSettled([
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
      `&hourly=windspeed_10m,windgusts_10m,weather_code&windspeed_unit=ms` +
      `&forecast_days=1&timezone=Europe%2FLondon`,
      { signal: AbortSignal.timeout(12000) }
    ).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fetch(
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}` +
      `&hourly=wave_height&forecast_days=1&timezone=Europe%2FLondon`,
      { signal: AbortSignal.timeout(12000) }
    ).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
  ]);

  const windArr   = windResp.status === 'fulfilled'
    ? (Array.isArray(windResp.value)   ? windResp.value   : [windResp.value])
    : [];
  const marineArr = marineResp.status === 'fulfilled'
    ? (Array.isArray(marineResp.value) ? marineResp.value : [marineResp.value])
    : [];

  return ROUTES.map((route, i) => {
    const wh = windArr[i]?.hourly   || {};
    const mh = marineArr[i]?.hourly || {};
    // Use current hour; fall back to wind speed if gusts unavailable
    const gust = wh.windgusts_10m?.[hour] ?? wh.windspeed_10m?.[hour] ?? null;
    const wind = wh.windspeed_10m?.[hour] ?? null;
    const wave = mh.wave_height?.[hour]   ?? null;
    const code = (wh.weather_code || wh.weathercode)?.[hour] ?? null;
    return { name: route.name, gust_ms: gust, wind_ms: wind, wave_m: wave, weather_code: code };
  });
}

// ── Parse normalised status from CalMac top-level route status ────────────
function parseStatus(status) {
  const s = (status || '').toUpperCase();
  if (s === 'ALL_SAILINGS_CANCELLED') return 'cancelled';
  if (s === 'DISRUPTIONS')            return 'disrupted';
  if (s === 'BE_AWARE')               return 'aware';
  if (s === 'NORMAL')                 return 'normal';
  return 'unknown';
}

// ── Extract the primary disruption reason from routeStatuses ─────────────
function primaryReason(routeStatuses) {
  if (!routeStatuses?.length) return null;
  const active = routeStatuses.find(s => s.status === 'SAILING');
  return active?.disruptionReason || routeStatuses[0]?.disruptionReason || null;
}

// ── Handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const secret = req.query?.secret || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const timestamp = new Date().toISOString();

  try {
    const [calMacRoutes, weatherRows] = await Promise.all([
      fetchCalMacStatus(),
      fetchCurrentWeather(),
    ]);

    // Build a lookup from our route key → CalMac status
    const statusByRoute = {};
    for (const r of calMacRoutes) {
      if (r.name?.toLowerCase().includes('freight')) continue;
      const key = ROUTE_MAP[r.name];
      if (key) {
        statusByRoute[key] = {
          status: parseStatus(r.status),
          reason: primaryReason(r.routeStatuses),
        };
      }
    }

    // Build one record per route
    const records = weatherRows.map(w => ({
      timestamp,
      route:         w.name,
      status:        statusByRoute[w.name]?.status || 'unknown',
      reason:        statusByRoute[w.name]?.reason || null,
      gust_ms:       w.gust_ms !== null ? Math.round(w.gust_ms * 10) / 10 : null,
      wind_ms:       w.wind_ms !== null ? Math.round(w.wind_ms * 10) / 10 : null,
      wave_m:        w.wave_m  !== null ? Math.round(w.wave_m  * 10) / 10 : null,
      weather_code:  w.weather_code,
    }));

    // Post batch to Google Apps Script
    if (SHEET_SCRIPT_URL) {
      const sheetResp = await fetch(SHEET_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recordStatus', records }),
        signal: AbortSignal.timeout(15000),
      });
      if (!sheetResp.ok) {
        console.error('Sheet write failed:', sheetResp.status);
      }
    }

    const disrupted = records.filter(r => r.status !== 'normal' && r.status !== 'unknown').length;
    return res.status(200).json({ ok: true, timestamp, recorded: records.length, disrupted });

  } catch (err) {
    console.error('record.js error:', err.message);
    return res.status(500).json({ error: err.message, timestamp });
  }
};
