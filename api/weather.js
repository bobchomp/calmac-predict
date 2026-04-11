const https = require(‘https’);

const ROUTES = [
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

// Simple https GET returning parsed JSON — works on all Node versions
function httpsGet(url) {
return new Promise(function(resolve, reject) {
https.get(url, function(resp) {
var data = ‘’;
resp.on(‘data’, function(chunk) { data += chunk; });
resp.on(‘end’, function() {
try { resolve(JSON.parse(data)); }
catch(e) { reject(new Error(’JSON parse failed: ’ + e.message)); }
});
}).on(‘error’, reject);
});
}

function sliceHours(arr, hour) { return (arr || []).slice(hour, hour + 12); }
function safeMax(arr) { return arr.length ? Math.max.apply(null, arr) : null; }
function safeMin(arr) { return arr.length ? Math.min.apply(null, arr) : null; }

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Cache-Control’, ‘s-maxage=1800’);

try {
var now = new Date();
var currentHour = now.getHours();

```
var lats = ROUTES.map(function(r) { return r.lat; }).join(',');
var lons = ROUTES.map(function(r) { return r.lon; }).join(',');

var weatherUrl = 'https://api.open-meteo.com/v1/forecast'
  + '?latitude=' + lats
  + '&longitude=' + lons
  + '&hourly=windspeed_10m,windgusts_10m,weathercode,visibility,precipitation,snowfall'
  + '&windspeed_unit=mph&forecast_days=1&timezone=Europe%2FLondon';

var marineUrl = 'https://marine-api.open-meteo.com/v1/marine'
  + '?latitude=' + lats
  + '&longitude=' + lons
  + '&hourly=wave_height,wave_period,swell_wave_height'
  + '&forecast_days=1&timezone=Europe%2FLondon';

var weatherArray = await httpsGet(weatherUrl);
var marineArray  = await httpsGet(marineUrl).catch(function() { return null; });

var wArr = Array.isArray(weatherArray) ? weatherArray : [weatherArray];
var mArr = marineArray ? (Array.isArray(marineArray) ? marineArray : [marineArray]) : [];

var results = ROUTES.map(function(route, i) {
  var w = wArr[i] || {};
  var m = mArr[i] || null;
  var hourly = w.hourly || {};
  var marine = m ? (m.hourly || null) : null;

  var gusts  = sliceHours(hourly.windgusts_10m, currentHour);
  var winds  = sliceHours(hourly.windspeed_10m,  currentHour);
  var codes  = sliceHours(hourly.weathercode,    currentHour);
  var vis    = sliceHours(hourly.visibility,     currentHour);
  var precip = sliceHours(hourly.precipitation,  currentHour);
  var snow   = sliceHours(hourly.snowfall,       currentHour);
  var waves  = marine ? sliceHours(marine.wave_height,       currentHour) : [];
  var swells = marine ? sliceHours(marine.swell_wave_height, currentHour) : [];
  var periods= marine ? sliceHours(marine.wave_period,       currentHour) : [];

  var maxGust = safeMax(gusts);
  var maxWave = safeMax(waves);
  var maxSwell = safeMax(swells);

  return {
    route:      route.route,
    hourly:     hourly,
    marine:     marine,
    maxGustMph: maxGust  !== null ? Math.round(maxGust)          : null,
    maxWindMph: safeMax(winds) !== null ? Math.round(safeMax(winds)) : null,
    worstCode:  safeMax(codes),
    minVisM:    safeMin(vis),
    maxPrecip:  safeMax(precip),
    maxSnow:    safeMax(snow),
    maxWaveM:   maxWave  !== null ? Math.round(maxWave  * 10) / 10 : null,
    maxSwellM:  maxSwell !== null ? Math.round(maxSwell * 10) / 10 : null,
    avgPeriod:  periods.length ? Math.round(periods.reduce(function(a,b){return a+b;},0)/periods.length) : null,
    hasMarine:  !!marine,
  };
});

res.status(200).json({ routes: results, fetchedAt: now.toISOString() });
```

} catch (err) {
res.status(500).json({ error: err.message, routes: [] });
}
};
