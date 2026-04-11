const ROUTES = [
{ route: ‘Ardrossan \u2013 Brodick (Arran)’,                    lat: 55.58, lon: -5.09 },
{ route: ‘Troon \u2013 Brodick (Arran)’,                        lat: 55.53, lon: -4.97 },
{ route: ‘Kennacraig \u2013 Port Ellen / Port Askaig (Islay)’, lat: 55.87, lon: -5.50 },
{ route: ‘Oban \u2013 Craignure (Mull)’,                        lat: 56.41, lon: -5.47 },
{ route: ‘Oban \u2013 Coll / Tiree’,                            lat: 56.62, lon: -6.52 },
{ route: ‘Oban \u2013 Colonsay’,                                lat: 56.07, lon: -6.19 },
{ route: ‘Oban \u2013 Castlebay / Lochboisdale’,               lat: 56.95, lon: -7.32 },
{ route: ‘Mallaig \u2013 Armadale (Skye)’,                      lat: 57.06, lon: -5.83 },
{ route: ‘Ullapool \u2013 Stornoway (Lewis)’,                   lat: 58.20, lon: -6.39 },
{ route: ‘Uig \u2013 Tarbert / Lochmaddy’,                     lat: 57.73, lon: -6.96 },
{ route: ‘Gourock \u2013 Dunoon’,                               lat: 55.96, lon: -4.92 },
{ route: ‘Wemyss Bay \u2013 Rothesay (Bute)’,                   lat: 55.84, lon: -5.05 },
{ route: ‘Colintraive \u2013 Rhubodach (Bute)’,                 lat: 55.92, lon: -5.15 },
{ route: ‘Largs \u2013 Cumbrae Slip’,                           lat: 55.79, lon: -4.87 },
{ route: ‘Tarbert \u2013 Portavadie’,                           lat: 55.87, lon: -5.41 },
{ route: ‘Claonaig \u2013 Lochranza (Arran)’,                   lat: 55.70, lon: -5.39 },
{ route: ‘Tobermory \u2013 Kilchoan’,                           lat: 56.62, lon: -6.08 },
{ route: ‘Fishnish \u2013 Lochaline’,                           lat: 56.52, lon: -5.73 },
{ route: ‘Mallaig \u2013 Small Isles’,                          lat: 56.97, lon: -6.30 },
{ route: ‘Oban \u2013 Lismore’,                                 lat: 56.50, lon: -5.49 },
{ route: ‘Seil \u2013 Luing’,                                   lat: 56.23, lon: -5.62 },
{ route: ‘Port Askaig \u2013 Feolin (Jura)’,                    lat: 55.85, lon: -6.10 },
];

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Cache-Control’, ‘s-maxage=1800’);

try {
const now = new Date();
const currentHour = now.getHours();

```
// Use Open-Meteo multi-location batch API — one request for all 22 routes
const lats = ROUTES.map(r => r.lat).join(',');
const lons = ROUTES.map(r => r.lon).join(',');

const weatherUrl = 'https://api.open-meteo.com/v1/forecast'
  + '?latitude=' + lats
  + '&longitude=' + lons
  + '&hourly=windspeed_10m,windgusts_10m,weathercode,visibility,precipitation,snowfall'
  + '&windspeed_unit=mph&forecast_days=1&timezone=Europe%2FLondon';

const marineUrl = 'https://marine-api.open-meteo.com/v1/marine'
  + '?latitude=' + lats
  + '&longitude=' + lons
  + '&hourly=wave_height,wave_period,swell_wave_height'
  + '&forecast_days=1&timezone=Europe%2FLondon';

// Fetch both in parallel; marine may partially fail — that's fine
const [weatherRes, marineRes] = await Promise.all([
  fetch(weatherUrl),
  fetch(marineUrl).catch(() => null),
]);

if (!weatherRes.ok) throw new Error('Weather API returned ' + weatherRes.status);

const weatherArray = await weatherRes.json(); // array of 22 objects
const marineArray  = marineRes && marineRes.ok
  ? await marineRes.json().catch(() => null)
  : null;

// Normalise: Open-Meteo returns an array when multiple locs are given
const wArr = Array.isArray(weatherArray) ? weatherArray : [weatherArray];
const mArr = marineArray ? (Array.isArray(marineArray) ? marineArray : [marineArray]) : [];

const results = ROUTES.map((route, i) => {
  const w = wArr[i] || {};
  const m = mArr[i] || null;
  const hourly = w.hourly || {};
  const marine = m ? m.hourly || null : null;

  const slice = (arr) => (arr || []).slice(currentHour, currentHour + 12);
  const gusts  = slice(hourly.windgusts_10m);
  const winds  = slice(hourly.windspeed_10m);
  const codes  = slice(hourly.weathercode);
  const vis    = slice(hourly.visibility);
  const precip = slice(hourly.precipitation);
  const snow   = slice(hourly.snowfall);
  const waves  = marine ? slice(marine.wave_height)       : [];
  const swells = marine ? slice(marine.swell_wave_height) : [];
  const periods= marine ? slice(marine.wave_period)       : [];

  const safe = (arr, fn) => arr.length ? fn(...arr) : null;
  return {
    route:        route.route,
    hourly:       hourly,   // full hourly for per-sailing calcs
    marine:       marine,
    maxGustMph:   safe(gusts,  Math.max) !== null ? Math.round(safe(gusts, Math.max))  : null,
    maxWindMph:   safe(winds,  Math.max) !== null ? Math.round(safe(winds, Math.max))  : null,
    worstCode:    safe(codes,  Math.max),
    minVisM:      safe(vis,    Math.min),
    maxPrecip:    safe(precip, Math.max),
    maxSnow:      safe(snow,   Math.max),
    maxWaveM:     safe(waves,  Math.max) !== null ? Math.round(safe(waves,  Math.max) * 10) / 10 : null,
    maxSwellM:    safe(swells, Math.max) !== null ? Math.round(safe(swells, Math.max) * 10) / 10 : null,
    avgPeriod:    periods.length ? Math.round(periods.reduce((a,b)=>a+b,0)/periods.length) : null,
    hasMarine:    !!marine,
  };
});

res.status(200).json({ routes: results, fetchedAt: now.toISOString() });
```

} catch (err) {
res.status(500).json({ error: err.message, routes: [] });
}
};
