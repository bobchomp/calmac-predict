// Open-Meteo forecasts for all 22 routes, shaped into what a route card
// needs. Shared by the page (lib/data.js) and the sailing log
// (pages/api/track-sailings.js), so both work out the same chances.

import { TOMORROW_WINDOW } from './risk';
import { ROUTES } from './routes';

// One request per API for all 22 routes: Open-Meteo takes comma-separated
// coordinates and returns an array. Hours are indexed from today's UK midnight.
export function forecastUrls() {
  const lats = ROUTES.map(r => r.lat).join(',');
  const lons = ROUTES.map(r => r.lon).join(',');
  return {
    windUrl: 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lats + '&longitude=' + lons
      + '&forecast_days=2&timezone=Europe%2FLondon&windspeed_unit=ms'
      + '&hourly=windspeed_10m,windgusts_10m,winddirection_10m,weather_code,visibility,precipitation,snowfall',
    marineUrl: 'https://marine-api.open-meteo.com/v1/marine'
      + '?latitude=' + lats + '&longitude=' + lons
      + '&forecast_days=2&timezone=Europe%2FLondon'
      + '&hourly=wave_height,wave_period,swell_wave_height',
  };
}

const next12 = (arr, start) => (arr || []).slice(start, start + 12).filter(v => v != null);
// Tomorrow's hours within TOMORROW_WINDOW
const tomorrowHours = arr => (arr || []).slice(TOMORROW_START + TOMORROW_WINDOW.from, TOMORROW_START + TOMORROW_WINDOW.to + 1).filter(v => v != null);
const max = arr => arr.length ? Math.max(...arr) : null;
const min = arr => arr.length ? Math.min(...arr) : null;
const TOMORROW_START = 24;

// One route's figures for the next 12 hours from `hour`, plus tomorrow's
// (over TOMORROW_WINDOW), from its Open-Meteo forecast (hourly) and marine
// (or null) responses
export function routeWeather(hourly, marine, hour) {
  const gusts = next12(hourly.windgusts_10m, hour);
  const winds = next12(hourly.windspeed_10m, hour);
  // Open-Meteo doesn't always give gusts offshore; fall back to wind speed
  const effectiveGusts = gusts.length ? gusts : winds;
  const waves  = marine ? next12(marine.wave_height, hour) : [];
  const dirs   = (hourly.winddirection_10m || []).slice(hour, hour + 12).filter(v => v != null);

  const tGusts = tomorrowHours(hourly.windgusts_10m);
  const effectiveTGusts = tGusts.length ? tGusts : tomorrowHours(hourly.windspeed_10m);
  const tWaves = marine ? tomorrowHours(marine.wave_height) : [];
  const tDirs  = tomorrowHours(hourly.winddirection_10m);

  // weather_code is the current field name (weathercode is the legacy alias)
  const weatherCodes = hourly.weather_code || hourly.weathercode || [];
  // Offshore gust arrays can be all nulls: patch each missing hour with wind speed
  const rawGusts = hourly.windgusts_10m || [];
  const rawWinds = hourly.windspeed_10m || [];
  const patchedGusts = rawGusts.length ? rawGusts.map((v, i) => v != null ? v : (rawWinds[i] ?? 0)) : rawWinds;
  const merged = { ...hourly, weathercode: weatherCodes, windgusts_10m: patchedGusts };
  const average = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  // Tomorrow's 24 hours, indexed from tomorrow midnight like today's are
  const tomorrowOf = data => data && Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.slice(TOMORROW_START, TOMORROW_START + 24) : v]));

  return {
    hourlyData: merged,
    marineData: marine,
    maxGustMph: max(effectiveGusts) !== null ? Math.round(max(effectiveGusts) * 2.237) : null,
    maxWindMph: max(winds) !== null ? Math.round(max(winds) * 2.237) : null,
    weatherCode: max(next12(weatherCodes, hour)),
    maxWaveM: max(waves) !== null ? Math.round(max(waves) * 10) / 10 : null,
    minVisM: min(next12(hourly.visibility, hour)),
    hasMarine: marine !== null,
    windDirDeg: average(dirs),
    tomorrow: {
      maxGustMph: max(effectiveTGusts) !== null ? Math.round(max(effectiveTGusts) * 2.237) : null,
      maxWaveM: max(tWaves) !== null ? Math.round(max(tWaves) * 10) / 10 : null,
      weatherCode: max(tomorrowHours(weatherCodes)),
      minVisM: min(tomorrowHours(hourly.visibility)),
      windDirDeg: average(tDirs),
      hourly: tomorrowOf(merged),
      marine: tomorrowOf(marine),
    },
  };
}

