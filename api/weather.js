const ROUTE_WEATHER_POINTS = [
{ route: ‘Ardrossan – Brodick (Arran)’, lat: 55.58, lon: -5.09 },
{ route: ‘Troon – Brodick (Arran)’, lat: 55.53, lon: -4.97 },
{ route: ‘Kennacraig – Port Ellen / Port Askaig (Islay)’, lat: 55.87, lon: -5.50 },
{ route: ‘Oban – Craignure (Mull)’, lat: 56.41, lon: -5.47 },
{ route: ‘Oban – Coll / Tiree’, lat: 56.62, lon: -6.52 },
{ route: ‘Oban – Colonsay’, lat: 56.07, lon: -6.19 },
{ route: ‘Oban – Castlebay / Lochboisdale’, lat: 56.95, lon: -7.32 },
{ route: ‘Mallaig – Armadale (Skye)’, lat: 57.06, lon: -5.83 },
{ route: ‘Ullapool – Stornoway (Lewis)’, lat: 58.20, lon: -6.39 },
{ route: ‘Uig – Tarbert / Lochmaddy’, lat: 57.73, lon: -6.96 },
{ route: ‘Gourock – Dunoon’, lat: 55.96, lon: -4.92 },
{ route: ‘Wemyss Bay – Rothesay (Bute)’, lat: 55.84, lon: -5.05 },
{ route: ‘Colintraive – Rhubodach (Bute)’, lat: 55.92, lon: -5.15 },
{ route: ‘Largs – Cumbrae Slip’, lat: 55.79, lon: -4.87 },
{ route: ‘Tarbert – Portavadie’, lat: 55.87, lon: -5.41 },
{ route: ‘Claonaig – Lochranza (Arran)’, lat: 55.70, lon: -5.39 },
{ route: ‘Tobermory – Kilchoan’, lat: 56.62, lon: -6.08 },
{ route: ‘Fishnish – Lochaline’, lat: 56.52, lon: -5.73 },
{ route: ‘Mallaig – Small Isles’, lat: 56.97, lon: -6.30 },
{ route: ‘Oban – Lismore’, lat: 56.50, lon: -5.49 },
{ route: ‘Seil – Luing’, lat: 56.23, lon: -5.62 },
{ route: ‘Port Askaig – Feolin (Jura)’, lat: 55.85, lon: -6.10 },
];

function calcRisk(gustMph, weatherCode) {
let risk = 0;
if (gustMph >= 55) risk += 60;
else if (gustMph >= 45) risk += 45;
else if (gustMph >= 35) risk += 25;
else if (gustMph >= 25) risk += 10;
if (weatherCode >= 95) risk += 40;
else if (weatherCode >= 80) risk += 25;
else if (weatherCode >= 71) risk += 30;
else if (weatherCode >= 61) risk += 15;
else if (weatherCode >= 51) risk += 5;
return Math.min(risk, 100);
}

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Cache-Control’, ‘s-maxage=1800’);

try {
const now = new Date();
const currentHour = now.getHours();

```
// Use Open-Meteo's bulk endpoint — pass all lats/lons as arrays in one request
// This is their documented multi-location format
const lats = ROUTE_WEATHER_POINTS.map(p => p.lat).join(',');
const lons = ROUTE_WEATHER_POINTS.map(p => p.lon).join(',');
const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=windspeed_10m,windgusts_10m,weathercode&windspeed_unit=mph&forecast_days=1&timezone=Europe%2FLondon`;

const response = await fetch(url, {
  headers: { 'Accept': 'application/json' },
  signal: AbortSignal.timeout(25000)
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`Open-Meteo HTTP ${response.status}: ${text.slice(0, 200)}`);
}

const raw = await response.json();

// Open-Meteo returns array for multiple locations
const dataArray = Array.isArray(raw) ? raw : [raw];

const results = ROUTE_WEATHER_POINTS.map((point, i) => {
  const data = dataArray[i];
  if (!data || !data.hourly) {
    return { route: point.route, maxGustMph: null, maxWindMph: null, weatherCode: null, sailingRisk: null, error: 'no data for index ' + i };
  }
  const gusts = (data.hourly.windgusts_10m || []).slice(currentHour, currentHour + 12);
  const winds = (data.hourly.windspeed_10m || []).slice(currentHour, currentHour + 12);
  const codes = (data.hourly.weathercode || []).slice(currentHour, currentHour + 12);
  const maxGust = gusts.length ? Math.max(...gusts) : 0;
  const maxWind = winds.length ? Math.max(...winds) : 0;
  const worstCode = codes.length ? Math.max(...codes) : 0;
  return {
    route: point.route,
    maxGustMph: Math.round(maxGust),
    maxWindMph: Math.round(maxWind),
    weatherCode: worstCode,
    sailingRisk: calcRisk(maxGust, worstCode)
  };
});

res.status(200).json({ weather: results, fetchedAt: now.toISOString(), source: 'bulk', count: dataArray.length });
```

} catch (err) {
// Return the full error so we can diagnose from the browser
res.status(500).json({ error: err.message, stack: err.stack, weather: [] });
}
}
