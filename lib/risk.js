// Sailing chance model, shared by the site
// and the GitHub Actions jobs (scripts/jobs/).
//
// The chance for a sailing is the chance the weather lets it go (a curve
// fitted to real outcomes, weatherChanceAt) times the chance nothing else
// stops it (the route's CalMac track record outside the stormy months,
// otherReliability). The points-based risk model further down is the one
// production used before; it's kept for the sailing log's comparison of
// the two (oldChanceAt) and the route modal's factor list.

// The weather curve: a logistic fit to the sailing log, 29 Sep – 18 Oct 2026
// (7,300 CalMac sailings, 199 cancelled for weather, each day tested on a fit
// made without it). Gusts and sustained wind in mph, exposure 1-4, waves in
// metres (0 for routes without marine data).
export const WEATHER_MODEL = { intercept: 8.412, gust: -0.0530, wind: -0.1465, exposure: -0.294, wave: -0.283 };

const logistic = z => 1 / (1 + Math.exp(-z));
const mph = ms => (ms ?? 0) * 2.237;

// One hour's inputs for the weather curve
function hourInputs(routeName, hour, hourlyWeather, hourlyMarine) {
  const profile = ROUTE_PROFILES[routeName] || { threshold: 45, exposure: 2 };
  const wind = mph((hourlyWeather.windspeed_10m || [])[hour]);
  const gust = mph((hourlyWeather.windgusts_10m || [])[hour] ?? (hourlyWeather.windspeed_10m || [])[hour]);
  const wave = (hourlyMarine?.wave_height || [])[hour] ?? 0;
  return { gust, wind, wave, exposure: profile.exposure };
}

// Dense fog, snow, thunderstorms and freezing rain: not in the fitted data
// (no fog or snow in it), so they keep the old model's allowance for them
function hazardFactor(hour, hourlyWeather) {
  const vis  = (hourlyWeather.visibility || [])[hour];
  const snow = (hourlyWeather.snowfall || [])[hour] || 0;
  const code = (hourlyWeather.weather_code || hourlyWeather.weathercode || [])[hour] || 0;
  const fog = vis == null ? 1 : vis < 500 ? 0.85 : vis < 1000 ? 0.9 : 1;
  const snowOrStorm = snow > 2 || (code >= 71 && code <= 77) || code === 85 || code === 86 || (code >= 95 && code <= 99);
  const freezing = code === 56 || code === 57 || code === 66 || code === 67;
  return fog * (snowOrStorm ? 0.9 : freezing ? 0.95 : 1);
}

// Chance (0-1) the weather lets a sailing at this hour go
export function weatherChanceAt(routeName, hour, hourlyWeather, hourlyMarine) {
  const { gust, wind, wave, exposure } = hourInputs(routeName, hour, hourlyWeather, hourlyMarine);
  const m = WEATHER_MODEL;
  return logistic(m.intercept + m.gust * gust + m.wind * wind + m.exposure * exposure + m.wave * wave) * hazardFactor(hour, hourlyWeather);
}

// The gust (mph) at which this hour's weather would make a sailing a 50/50,
// with its sustained wind in the same proportion and its waves: what the
// route modal calls the limit
export function gustLimitAt(routeName, hour, hourlyWeather, hourlyMarine) {
  const { gust, wind, wave, exposure } = hourInputs(routeName, hour, hourlyWeather, hourlyMarine);
  const m = WEATHER_MODEL;
  const windShare = gust > 1 ? Math.min(1, wind / gust) : 0.65;
  return (m.intercept + m.exposure * exposure + m.wave * wave) / -(m.gust + m.wind * windShare);
}

// Chance (0-1) nothing but the weather stops a sailing: the route's CalMac
// reliability in summer (May–Sep), when cancellations are mostly technical
// and operational. 1 for routes without CalMac figures.
export function otherReliability(thresholds, routeName) {
  const t = thresholds?.[routeName];
  if (!t || !t.samples || t.samples < 2) return 1;
  const v = parseFloat(t.summer) || parseFloat(t.base);
  return v ? Math.min(1, v / 100) : 1;
}

// Sailing chance (0-100) for one hour
export function chanceAt(routeName, hour, hourlyWeather, hourlyMarine, thresholds) {
  return Math.round(100 * weatherChanceAt(routeName, hour, hourlyWeather, hourlyMarine) * otherReliability(thresholds, routeName));
}

// Chance (0-100) across a stretch of the day: the average of its 3 worst
// hours, so one gusty hour doesn't sink an otherwise calm day
export function windowChance(routeName, fromHour, toHour, hourlyWeather, hourlyMarine, thresholds) {
  const chances = [];
  for (let h = Math.min(fromHour, 23); h <= Math.min(toHour, 23); h++) chances.push(chanceAt(routeName, h, hourlyWeather, hourlyMarine, thresholds));
  const worst = chances.sort((a, b) => a - b).slice(0, 3);
  return Math.round(worst.reduce((a, b) => a + b, 0) / worst.length);
}

// ── The old points model (production's before the fitted curve) ──

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

// Tomorrow is summarised over 06:00–22:00 (hours 6–21), roughly CalMac's
// operating day: early sailings count, the empty overnight hours don't
export const TOMORROW_WINDOW = { from: 6, to: 21 };

// Overall risk across a stretch of the day: the average of its worst 3
// hours (calcOverallRisk does the same for the next 12 hours, weighting the
// first few more heavily)
export function calcWindowRisk(routeName, fromHour, toHour, hourlyWeather, hourlyMarine, month0) {
  const risks = [];
  for (let h = fromHour; h <= toHour; h++) risks.push(calcHourlyRisk(routeName, h, hourlyWeather, hourlyMarine, month0));
  risks.sort((a, b) => b - a);
  const worst3 = risks.slice(0, 3);
  return Math.min(100, Math.round(worst3.reduce((a, b) => a + b, 0) / worst3.length));
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

// The old model's sailing chance (0-100) for one hour
export function oldChanceAt(routeName, hour, hourlyWeather, hourlyMarine, thresholds, month1 = new Date().getMonth() + 1) {
  return chanceFromRisk(calcHourlyRisk(routeName, hour, hourlyWeather, hourlyMarine, month1 - 1), historicalReliability(thresholds, routeName, month1));
}

// Sailing chance (0-100) from a risk score. With historical reliability, it's
// 70% weather model / 30% track record, capped at reliability + 10.
export function chanceFromRisk(risk, histRel = null) {
  const weatherChance = Math.max(0, Math.min(100, Math.round(100 - risk)));
  if (histRel === null) return weatherChance;
  // Thresholds can have decimals (78.7), so round the cap as well
  const cap = Math.min(100, Math.round(histRel + 10));
  const blended = Math.round((weatherChance * 0.7) + (histRel * 0.3));
  return Math.max(0, Math.min(cap, blended));
}

// The site's verdict for a sailing chance: the same bands as its colour
// (format.js chanceColor), so the icon always matches the percentage
export function verdictFromChance(chance) {
  if (chance >= 75) return 'likely';
  if (chance >= 45) return 'caution';
  return 'unlikely';
}

