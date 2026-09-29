// Loading everything the page shows: Open-Meteo weather for all 22 routes,
// CalMac disruptions (/api/status), live timetables (/api/timetable) and the
// Google Sheet's historical thresholds. Results go into the app state
// (lib/appState.js); startApp() runs the first load behind the loading
// screen and keeps it all refreshed.

import { setAppState } from './appState';
import { SHEET_SCRIPT_URL } from './config';
import { mergeStatuses } from './disruptions';
import { openModal } from './modal';
import { showShareBanner } from './overlays';
import { TOMORROW_WINDOW, calcOverallRisk, seasonFactor } from './risk';
import { ROUTES } from './routes';
import { createStore } from './store';
import { ukDateStr } from './timetable';

// ── Loading screen ──
export const loadingStore = createStore({ progress: null, message: 'Fetching weather data…', error: false, hidden: false });
const setProgress = (progress, message) => loadingStore.set(message ? { progress: Math.min(100, progress), message } : { progress: Math.min(100, progress) });

// ── Live timetable ──
// Real per-date sailings, keyed by UK date. A CalMac route with an empty list
// has no sailings that day; routes missing from the response (non-CalMac, or
// API down) fall back to TIMETABLE (lib/timetable.js).
const liveTimetable = {};

export async function loadLiveTimetable() {
  await Promise.all([ukDateStr(0), ukDateStr(1)].map(async date => {
    if (liveTimetable[date]) return;
    try {
      const res = await fetch(`/api/timetable?date=${date}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const json = await res.json();
      if (json.routes) liveTimetable[date] = json.routes;
    } catch (err) {
      console.warn('[CalMac] Live timetable unavailable — using built-in timetable', err);
    }
  }));
  setAppState({ timetable: { ...liveTimetable } });
}

// ── Historical thresholds from the Google Sheet ──
// { [route]: { base, winter, summer, shoulder, samples } }
export async function loadHistoricalThresholds() {
  try {
    const res = await fetch(`${SHEET_SCRIPT_URL}?action=getThresholds`);
    const json = await res.json();
    if (json.thresholds) {
      setAppState({ thresholds: json.thresholds });
      console.log(`[CalMac] Loaded historical thresholds for ${Object.keys(json.thresholds).length} routes`);
    }
  } catch (err) {
    console.warn('[CalMac] Could not load historical thresholds — using weather-only predictions', err);
  }
}

// ── CalMac disruptions ──
export async function loadDisruptions() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.fallback) return;
    // Several CalMac routes can share one card: combine their notices and
    // sailing statuses. All routes are kept so BE_AWARE ones have statuses too.
    const disruptions = {};
    (data.routes || data.disrupted || []).forEach(d => {
      if (!d.routeKey) return;
      const prev = disruptions[d.routeKey];
      disruptions[d.routeKey] = {
        ...d,
        notices: [...(prev?.notices || []), ...(d.notices || [])],
        sailingStatuses: mergeStatuses(prev?.sailingStatuses, d.sailingStatuses),
        sailingStatusesTomorrow: mergeStatuses(prev?.sailingStatusesTomorrow, d.sailingStatusesTomorrow),
      };
    });
    setAppState({ disruptions, lastDisruptionFetch: new Date() });
  } catch (_) {}
}

// ── Weather ──
// One request per API for all 22 routes: Open-Meteo takes comma-separated
// coordinates and returns an array.
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

// Offline, the service worker answers with the last saved forecast (marked
// with an x-saved-at header). Hours to skip so index 0 is today's midnight:
// 0 for a forecast that starts today, 24 for one saved yesterday; null if
// it's older than that.
function hoursBehind(entry) {
  const first = entry?.hourly?.time?.[0];
  if (!first) return 0;
  const days = Math.round((Date.parse(ukDateStr(0)) - Date.parse(first.slice(0, 10))) / 86400000);
  return days === 0 ? 0 : days === 1 ? 24 : null;
}
const fromToday = (hourly, skip) => hourly && skip
  ? Object.fromEntries(Object.entries(hourly).map(([k, v]) => [k, Array.isArray(v) ? v.slice(skip) : v]))
  : hourly;

function weatherUrls() {
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

// Request everything the page loads again, without showing it, so the
// service worker saves an offline copy. For the first visit, whose loads
// happen before the service worker is in control.
export function warmOfflineCache() {
  const { windUrl, marineUrl } = weatherUrls();
  [windUrl, marineUrl, '/api/status', `/api/timetable?date=${ukDateStr(0)}`, `/api/timetable?date=${ukDateStr(1)}`, `${SHEET_SCRIPT_URL}?action=getThresholds`]
    .forEach(url => fetch(url).catch(() => {}));
}

// Routes' weather, and when it was saved if it came from the offline copy
async function fetchAllWeather(hour) {
  const { windUrl, marineUrl } = weatherUrls();

  setProgress(30, 'Fetching weather data…');
  const getJson = async url => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { json: await r.json(), savedAt: Number(r.headers.get('x-saved-at')) || null };
  };
  const [windResp, marineResp] = await Promise.allSettled([getJson(windUrl), getJson(marineUrl)]);
  if (windResp.status === 'rejected') throw new Error('Weather fetch failed: ' + windResp.reason);

  setProgress(70, 'Processing…');
  const asArray = v => Array.isArray(v) ? v : [v];
  const windArr = asArray(windResp.value.json);
  const windSkip = hoursBehind(windArr[0]);
  if (windSkip === null) throw new Error('The saved forecast is out of date');
  let marineArr = marineResp.status === 'fulfilled' ? asArray(marineResp.value.json) : [];
  const marineSkip = hoursBehind(marineArr[0]);
  if (marineSkip === null) marineArr = [];
  const results = ROUTES.map((route, i) => routeWeather(
    fromToday(windArr[i]?.hourly, windSkip) || {},
    fromToday(marineArr[i]?.hourly, marineSkip) || null,
    hour,
  ));
  if (!results.some(r => r.maxGustMph !== null)) throw new Error('No weather data received — check your connection');
  setProgress(85, 'Calculating risk scores…');
  return { results, savedAt: windResp.value.savedAt };
}

// Routes before (or without) weather data
const placeholderRoutes = () => ROUTES.map(r => ({
  name: r.name,
  maxGustMph: undefined, maxWindMph: undefined, weatherCode: undefined,
  maxWaveM: undefined, minVisM: undefined,
  risk: undefined, hasMarine: false,
  hourlyData: null, marineData: null,
}));

const setStatus = (type, text) => setAppState({ status: { type, text } });

// Reload the weather (and timetables) and recalculate every route
export async function fetchData() {
  setAppState({ refreshing: true, phase: 'loading' });
  setStatus('loading', 'Loading…');
  const timetableReady = loadLiveTimetable();
  try {
    setProgress(20, 'Calling weather API…');
    const hour = new Date().getHours();
    const { results: weather, savedAt } = await fetchAllWeather(hour);
    await timetableReady;
    setProgress(75, 'Calculating risk scores…');

    const routes = ROUTES.map((r, i) => {
      const w = weather[i];
      const risk = calcOverallRisk(r.name, hour, w.hourlyData || {}, w.marineData || null);
      return { name: r.name, ...w, risk };
    });
    // A saved forecast is as old as when it was saved
    const lastFetched = savedAt ? new Date(savedAt) : new Date();
    setAppState({ phase: 'ready', routes, lastFetched });

    const season = seasonFactor();
    const time = lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const when = lastFetched.toDateString() === new Date().toDateString() ? time : lastFetched.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
    setStatus(savedAt ? 'error' : 'ok', (savedAt ? "Couldn't reach the weather service · showing the forecast saved " + when : 'Updated ' + time)
      + ' · Wave data: ' + routes.filter(r => r.hasMarine).length + '/22 routes'
      + ' · ' + (season < 0.9 ? 'Winter mode' : season < 1.0 ? 'Shoulder season' : 'Summer mode')
      + ' · Auto-refreshes every 30 min');
  } catch (err) {
    setStatus('error', 'Could not load data: ' + err.message + ' — tap Refresh to try again');
    await timetableReady;
    setAppState({ phase: 'ready', routes: placeholderRoutes() });
    throw err;
  } finally {
    setAppState({ refreshing: false });
  }
}

// ── Share links (?route=…&sailing=…&from=…, or &alert=1 from a push alert) ──
// Opened once the first load is done
function openShareLink() {
  const params = new URLSearchParams(location.search);
  const route = params.get('route');
  if (!route) return;
  if (!params.has('alert')) {
    const from = params.get('from');
    showShareBanner(from ? `${from} shared "${route}" with you 🚢` : `Someone shared "${route}" with you 🚢`);
  }
  setTimeout(() => openModal(route, params.get('sailing')), 400);
  history.replaceState(null, '', location.pathname);
}

// ── Start-up ──
let started = false;

export async function startApp() {
  if (started) return;
  started = true;
  setInterval(() => fetchData().catch(() => {}), 30 * 60 * 1000);
  setInterval(loadDisruptions, 10 * 60 * 1000);

  // Step the loading screen along while the first load runs
  const messages = ['Fetching wind forecasts…', 'Loading wave & swell data…', 'Calculating route risks…', 'Checking visibility…', 'Applying seasonal factors…', 'Almost ready…'];
  let msgIdx = 0;
  const ticker = setInterval(() => {
    setProgress(Math.min(90, ((msgIdx + 1) / messages.length) * 90), messages[msgIdx]);
    msgIdx = Math.min(msgIdx + 1, messages.length - 1);
  }, 1800);
  const showError = message => {
    loadingStore.set({ error: true, progress: 100, message: '⚠️ ' + message });
    setTimeout(() => loadingStore.set({ hidden: true }), 3500);
  };
  // Give up on the loading screen after 45s, but still try to show something
  const hardTimeout = setTimeout(() => {
    clearInterval(ticker);
    showError('Taking too long — check your connection');
    setTimeout(() => fetchData().catch(() => {}), 100);
  }, 45000);

  // Thresholds load alongside the weather; the cards update whenever they arrive
  loadHistoricalThresholds();

  try {
    await fetchData();
    clearInterval(ticker);
    clearTimeout(hardTimeout);
    loadingStore.set({ progress: 100, message: 'Ready!' });
    setTimeout(() => loadingStore.set({ hidden: true }), 400);
    loadDisruptions();
    setTimeout(openShareLink, 200);
  } catch (_) {
    clearInterval(ticker);
    clearTimeout(hardTimeout);
    showError('Could not load data — tap Refresh to try again');
  }
}

