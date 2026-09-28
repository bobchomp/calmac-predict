// Sailing risk model, shared by the site (via components/LegacyScript.js)
// and the server (pages/api/weather.js).

export const ROUTES = [
  { name: 'Ardrossan - Brodick (Arran)',                   lat: 55.58, lon: -5.09 },
  { name: 'Troon - Brodick (Arran)',                       lat: 55.53, lon: -4.97 },
  { name: 'Kennacraig - Port Ellen / Port Askaig (Islay)', lat: 55.87, lon: -5.50 },
  { name: 'Oban - Craignure (Mull)',                       lat: 56.41, lon: -5.47 },
  { name: 'Oban - Coll / Tiree',                          lat: 56.62, lon: -6.52 },
  { name: 'Oban - Colonsay',                              lat: 56.07, lon: -6.19 },
  { name: 'Oban - Castlebay / Lochboisdale',              lat: 56.95, lon: -7.32 },
  { name: 'Mallaig - Armadale (Skye)',                    lat: 57.06, lon: -5.83 },
  { name: 'Ullapool - Stornoway (Lewis)',                  lat: 58.20, lon: -6.39 },
  { name: 'Uig - Tarbert / Lochmaddy',                    lat: 57.73, lon: -6.96 },
  { name: 'Gourock - Dunoon',                             lat: 55.96, lon: -4.92 },
  { name: 'Wemyss Bay - Rothesay (Bute)',                 lat: 55.84, lon: -5.05 },
  { name: 'Colintraive - Rhubodach (Bute)',               lat: 55.92, lon: -5.15 },
  { name: 'Largs - Cumbrae Slip',                         lat: 55.79, lon: -4.87 },
  { name: 'Tarbert - Portavadie',                         lat: 55.87, lon: -5.41 },
  { name: 'Claonaig - Lochranza (Arran)',                 lat: 55.70, lon: -5.39 },
  { name: 'Tobermory - Kilchoan',                         lat: 56.62, lon: -6.08 },
  { name: 'Fishnish - Lochaline',                         lat: 56.52, lon: -5.73 },
  { name: 'Mallaig - Small Isles',                        lat: 56.97, lon: -6.30 },
  { name: 'Oban - Lismore',                               lat: 56.50, lon: -5.49 },
  { name: 'Seil - Luing',                                 lat: 56.23, lon: -5.62 },
  { name: 'Port Askaig - Feolin (Jura)',                  lat: 55.85, lon: -6.10 },
];

// Gust threshold (mph) at which a route typically cancels, and exposure
// (1 = sheltered … 4 = very exposed).
export const ROUTE_PROFILES = {
  'Ardrossan - Brodick (Arran)':                   { threshold: 45, exposure: 3 },
  'Troon - Brodick (Arran)':                        { threshold: 45, exposure: 3 },
  'Kennacraig - Port Ellen / Port Askaig (Islay)':  { threshold: 42, exposure: 3 },
  'Oban - Craignure (Mull)':                        { threshold: 50, exposure: 2 },
  'Oban - Coll / Tiree':                            { threshold: 38, exposure: 4 },
  'Oban - Colonsay':                                { threshold: 40, exposure: 3 },
  'Oban - Castlebay / Lochboisdale':                { threshold: 38, exposure: 4 },
  'Mallaig - Armadale (Skye)':                      { threshold: 55, exposure: 1 },
  'Ullapool - Stornoway (Lewis)':                   { threshold: 40, exposure: 4 },
  'Uig - Tarbert / Lochmaddy':                      { threshold: 40, exposure: 4 },
  'Gourock - Dunoon':                               { threshold: 65, exposure: 1 },
  'Wemyss Bay - Rothesay (Bute)':                  { threshold: 60, exposure: 1 },
  'Colintraive - Rhubodach (Bute)':                { threshold: 70, exposure: 1 },
  'Largs - Cumbrae Slip':                          { threshold: 65, exposure: 1 },
  'Tarbert - Portavadie':                          { threshold: 55, exposure: 2 },
  'Claonaig - Lochranza (Arran)':                  { threshold: 48, exposure: 2 },
  'Tobermory - Kilchoan':                          { threshold: 45, exposure: 3 },
  'Fishnish - Lochaline':                          { threshold: 55, exposure: 2 },
  'Mallaig - Small Isles':                         { threshold: 38, exposure: 4 },
  'Oban - Lismore':                                { threshold: 55, exposure: 2 },
  'Seil - Luing':                                  { threshold: 60, exposure: 1 },
  'Port Askaig - Feolin (Jura)':                   { threshold: 58, exposure: 1 },
  'Tayinloan - Gigha':                             { threshold: 62, exposure: 1 },
  'Sconser - Raasay':                              { threshold: 55, exposure: 2 },
  'Fionnphort - Iona':                             { threshold: 60, exposure: 1 },
};

// Routes with tidal restrictions that can cause cancellations independently of weather
export const TIDAL_ROUTES = new Set([
  'Uig - Tarbert / Lochmaddy',  // Harris/Berneray tidal restrictions
  'Mallaig - Small Isles',       // Some piers have tidal access windows
]);

// month0: 0 = January
export function seasonFactor(month0 = new Date().getMonth()) {
  // Winter Nov-Feb: sailings cancel at lower wind speeds
  if (month0 >= 10 || month0 <= 1) return 0.85;
  // Early spring Mar, late autumn Sep-Oct: slightly reduced
  if (month0 === 2 || month0 === 8 || month0 === 9) return 0.93;
  return 1.0;
}

// Extra risk for an Open-Meteo (WMO) weather code. Codes aren't ordered by
// severity (80-82 are rain showers, 95-99 thunderstorms), so each type is
// scored explicitly. Rain alone rarely stops a ferry and wind is scored
// separately, so drizzle, light rain, light showers and fog (covered by
// visibility) add nothing.
export function weatherCodeRisk(code) {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 10; // snow, snow showers
  if (code >= 95 && code <= 99) return 10;                                  // thunderstorm
  if (code === 56 || code === 57 || code === 66 || code === 67) return 5;   // freezing drizzle / rain
  if (code === 65 || code === 82) return 5;                                 // heavy rain, violent showers
  if (code === 63 || code === 81) return 2;                                 // moderate rain / showers
  return 0;
}

// Risk score 0-100 for one hour. hourlyWeather/hourlyMarine are Open-Meteo
// hourly blocks (wind in m/s), indexed by hour of the UK day.
export function calcHourlyRisk(routeName, hour, hourlyWeather, hourlyMarine, month0) {
  const profile = ROUTE_PROFILES[routeName] || { threshold: 45, exposure: 2 };
  const season  = seasonFactor(month0);
  const effectiveThreshold = profile.threshold * season;
  let risk = 0;

  // ── WIND (0-40 pts) ── m/s → mph to match the thresholds
  const gust = (((hourlyWeather.windgusts_10m || [])[hour] ?? (hourlyWeather.windspeed_10m || [])[hour]) ?? 0) * 2.237;
  const wind = ((hourlyWeather.windspeed_10m || [])[hour] ?? 0) * 2.237;
  const gustRatio = gust / effectiveThreshold; // >1 means likely cancelled
  if      (gustRatio >= 1.2)  risk += 40;
  else if (gustRatio >= 1.0)  risk += 34;
  else if (gustRatio >= 0.9)  risk += 26;
  else if (gustRatio >= 0.75) risk += 16;
  else if (gustRatio >= 0.6)  risk += 8;
  else if (gustRatio >= 0.45) risk += 3;

  // ── WAVE HEIGHT (0-30 pts) ──
  if (hourlyMarine) {
    const waveH = (hourlyMarine.wave_height || [])[hour] || 0;
    const swellH = (hourlyMarine.swell_wave_height || [])[hour] || 0;
    const wavePeriod = (hourlyMarine.wave_period || [])[hour] || 8;
    // Long-period swell is more disruptive than short chop at same height
    const periodFactor = wavePeriod > 12 ? 1.3 : wavePeriod > 8 ? 1.1 : 1.0;
    const effectiveWave = Math.max(waveH, swellH * 0.8) * periodFactor;

    const waveThreshold = profile.exposure === 1 ? 3.0
                        : profile.exposure === 2 ? 2.5
                        : profile.exposure === 3 ? 2.0
                        : 1.5;
    const waveRatio = effectiveWave / waveThreshold;
    if (waveRatio >= 1.2)      risk += 30;
    else if (waveRatio >= 1.0) risk += 22;
    else if (waveRatio >= 0.8) risk += 14;
    else if (waveRatio >= 0.6) risk += 7;
    else if (waveRatio >= 0.4) risk += 2;
  } else {
    // No marine data — estimate wave risk from wind and exposure
    const estimatedWave = (wind * 0.04) * profile.exposure;
    if (estimatedWave > 2.5) risk += 15;
    else if (estimatedWave > 1.5) risk += 8;
    else if (estimatedWave > 1.0) risk += 3;
  }

  // ── VISIBILITY / FOG (0-15 pts) ──
  const vis = (hourlyWeather.visibility || [])[hour];
  if (vis !== undefined) {
    if (vis < 500)        risk += 15;
    else if (vis < 1000)  risk += 10;
    else if (vis < 3000)  risk += 5;
    else if (vis < 5000)  risk += 2;
  }

  // ── PRECIPITATION / SNOW (0-10 pts) ──
  // The larger of the weather-type score and the measured snow/rain amounts
  const snow   = (hourlyWeather.snowfall      || [])[hour] || 0;
  const precip = (hourlyWeather.precipitation || [])[hour] || 0;
  const code   = (hourlyWeather.weather_code || hourlyWeather.weathercode || [])[hour] || 0;
  const amountRisk = snow > 2 ? 10 : snow > 0.5 ? 5 : precip > 5 ? 2 : 0;
  risk += Math.max(weatherCodeRisk(code), amountRisk);

  // ── TIDAL PENALTY ──
  if (TIDAL_ROUTES.has(routeName)) risk += 3;

  return Math.min(100, Math.round(risk));
}

// Average of the 3 worst hours in the next 12, with the next 3 hours weighted
// up, so one gusty hour doesn't tank an otherwise calm day.
export function calcOverallRisk(routeName, currentHour, hourlyWeather, hourlyMarine, month0) {
  const risks = [];
  for (let i = 0; i < 12; i++) {
    const h = Math.min(currentHour + i, 23);
    const r = calcHourlyRisk(routeName, h, hourlyWeather, hourlyMarine, month0);
    risks.push(i < 3 ? r * 1.1 : r);
  }
  risks.sort((a, b) => b - a);
  const worst3 = risks.slice(0, 3);
  const score = worst3.reduce((a, b) => a + b, 0) / worst3.length;
  return Math.min(100, Math.round(score));
}

// A route's historical reliability (0-100) for the season, from the Google
// Sheet thresholds ({ [route]: { base, winter, summer, shoulder, samples } }),
// or null when there isn't enough data. month1: 1 = January.
export function historicalReliability(thresholds, routeName, month1 = new Date().getMonth() + 1) {
  const t = thresholds?.[routeName];
  if (!t || !t.samples || t.samples < 2) return null;

  const WINTER = [11, 12, 1, 2];
  const SUMMER = [5, 6, 7, 8, 9];
  if (WINTER.includes(month1) && t.winter) return parseFloat(t.winter);
  if (SUMMER.includes(month1) && t.summer) return parseFloat(t.summer);
  if (t.shoulder)                          return parseFloat(t.shoulder);
  return parseFloat(t.base) || null;
}

// Sailing chance (0-100) from a risk score. With historical reliability, it's
// 70% weather model / 30% track record, capped at reliability + 10.
export function chanceFromRisk(risk, histRel = null) {
  const weatherChance = Math.max(0, Math.min(100, Math.round(100 - risk)));
  if (histRel === null) return weatherChance;
  const cap = Math.min(100, histRel + 10);
  const blended = Math.round((weatherChance * 0.7) + (histRel * 0.3));
  return Math.max(0, Math.min(cap, blended));
}

export function verdictFromRisk(risk) {
  if (risk >= 50) return 'unlikely';
  if (risk >= 20) return 'caution';
  return 'likely';
}
