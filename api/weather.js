// CalMac Sailing Predictor — Weather + Marine API
// Uses Open-Meteo (free, no key needed) for both wind and wave data

const ROUTES = [
{ route: ‘Ardrossan – Brodick (Arran)’,                  lat: 55.58, lon: -5.09 },
{ route: ‘Troon – Brodick (Arran)’,                       lat: 55.53, lon: -4.97 },
{ route: ‘Kennacraig – Port Ellen / Port Askaig (Islay)’, lat: 55.87, lon: -5.50 },
{ route: ‘Oban – Craignure (Mull)’,                       lat: 56.41, lon: -5.47 },
{ route: ‘Oban – Coll / Tiree’,                           lat: 56.62, lon: -6.52 },
{ route: ‘Oban – Colonsay’,                               lat: 56.07, lon: -6.19 },
{ route: ‘Oban – Castlebay / Lochboisdale’,               lat: 56.95, lon: -7.32 },
{ route: ‘Mallaig – Armadale (Skye)’,                     lat: 57.06, lon: -5.83 },
{ route: ‘Ullapool – Stornoway (Lewis)’,                   lat: 58.20, lon: -6.39 },
{ route: ‘Uig – Tarbert / Lochmaddy’,                     lat: 57.73, lon: -6.96 },
{ route: ‘Gourock – Dunoon’,                              lat: 55.96, lon: -4.92 },
{ route: ‘Wemyss Bay – Rothesay (Bute)’,                  lat: 55.84, lon: -5.05 },
{ route: ‘Colintraive – Rhubodach (Bute)’,                lat: 55.92, lon: -5.15 },
{ route: ‘Largs – Cumbrae Slip’,                          lat: 55.79, lon: -4.87 },
{ route: ‘Tarbert – Portavadie’,                          lat: 55.87, lon: -5.41 },
{ route: ‘Claonaig – Lochranza (Arran)’,                  lat: 55.70, lon: -5.39 },
{ route: ‘Tobermory – Kilchoan’,                          lat: 56.62, lon: -6.08 },
{ route: ‘Fishnish – Lochaline’,                          lat: 56.52, lon: -5.73 },
{ route: ‘Mallaig – Small Isles’,                         lat: 56.97, lon: -6.30 },
{ route: ‘Oban – Lismore’,                                lat: 56.50, lon: -5.49 },
{ route: ‘Seil – Luing’,                                  lat: 56.23, lon: -5.62 },
{ route: ‘Port Askaig – Feolin (Jura)’,                   lat: 55.85, lon: -6.10 },
];

function calcRisk(gustMph, waveM, weatherCode) {
let risk = 0;

// Wind gusts (0-55 pts) — CalMac typically cancels around 40-45mph
if (gustMph >= 55)      risk += 55;
else if (gustMph >= 45) risk += 42;
else if (gustMph >= 38) risk += 28;
else if (gustMph >= 28) risk += 12;

// Wave height (0-30 pts) — significant factor for exposed routes
if (waveM >= 4.0)      risk += 30;
else if (waveM >= 3.0) risk += 22;
else if (waveM >= 2.0) risk += 12;
else if (waveM >= 1.2) risk += 5;

// Weather code (0-15 pts) — secondary factor
if (weatherCode >= 95)      risk += 15;
else if (weatherCode >= 80) risk += 10;
else if (weatherCode >= 71) risk += 12;
else if (weatherCode >= 61) risk += 6;

return Math.min(risk, 100);
}

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Cache-Control’, ‘s-maxage=1800, stale-while-revalidate=300’);

try {
const lats = ROUTES.map(r => r.lat).join(’,’);
const lons = ROUTES.map(r => r.lon).join(’,’);

```
// Fetch wind + weather and marine (waves) in parallel
const [windResp, marineResp] = await Promise.all([
  fetch(
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lats}&longitude=${lons}` +
    `&hourly=windspeed_10m,windgusts_10m,weathercode` +
    `&windspeed_unit=mph&forecast_days=2&timezone=Europe%2FLondon`
  ),
  fetch(
    `https://marine-api.open-meteo.com/v1/marine` +
    `?latitude=${lats}&longitude=${lons}` +
    `&hourly=wave_height,wave_period` +
    `&forecast_days=2&timezone=Europe%2FLondon`
  )
]);

const windData   = await windResp.json();
const marineData = await marineResp.json();

// Open-Meteo returns array for multiple locations, single object for one
const windArr   = Array.isArray(windData)   ? windData   : [windData];
const marineArr = Array.isArray(marineData) ? marineData : [marineData];

const now = new Date();
// Use UTC hour offset for London time (BST = UTC+1, GMT = UTC+0)
// Open-Meteo returns hourly in the requested timezone, index 0 = midnight
const currentHour = now.getUTCHours() + (isDaylightSaving(now) ? 1 : 0);
const hourStart = Math.min(currentHour, 23);
const hourEnd = Math.min(currentHour + 12, 48);

const results = ROUTES.map((point, i) => {
  const w = windArr[i]   || {};
  const m = marineArr[i] || {};

  const gusts  = (w.hourly?.windgusts_10m || []).slice(hourStart, hourEnd);
  const winds  = (w.hourly?.windspeed_10m || []).slice(hourStart, hourEnd);
  const codes  = (w.hourly?.weathercode   || []).slice(hourStart, hourEnd);
  const waves  = (m.hourly?.wave_height   || []).slice(hourStart, hourEnd);
  const periods = (m.hourly?.wave_period  || []).slice(hourStart, hourEnd);

  const maxGust  = gusts.length  ? Math.max(...gusts.filter(v => v != null))  : 0;
  const maxWind  = winds.length  ? Math.max(...winds.filter(v => v != null))  : 0;
  const maxCode  = codes.length  ? Math.max(...codes.filter(v => v != null))  : 0;
  const maxWave  = waves.length  ? Math.max(...waves.filter(v => v != null))  : 0;
  const avgPeriod = periods.length ? periods.filter(v => v != null).reduce((a, b) => a + b, 0) / periods.length : 0;

  const risk = calcRisk(maxGust, maxWave, maxCode);

  return {
    route:       point.route,
    maxGustMph:  Math.round(maxGust),
    maxWindMph:  Math.round(maxWind),
    maxWaveM:    Math.round(maxWave * 10) / 10,
    avgPeriodS:  Math.round(avgPeriod),
    weatherCode: maxCode,
    sailingRisk: risk,
  };
});

res.status(200).json({ weather: results, fetchedAt: new Date().toISOString() });
```

} catch (err) {
console.error(‘Weather API error:’, err.message);
res.status(500).json({ error: err.message, weather: [] });
}
};

function isDaylightSaving(date) {
// UK switches last Sunday of March / October
const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
return date.getTimezoneOffset() < Math.max(jan, jul);
}
