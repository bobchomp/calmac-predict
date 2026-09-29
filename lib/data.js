// Loading everything the page shows: Open-Meteo weather for all 22 routes,
// CalMac disruptions (/api/status), live timetables (/api/timetable) and the
// Google Sheet's historical thresholds. Results go into the app state
// (lib/appState.js); startApp() runs the first load behind the loading
// screen and keeps it all refreshed.

import { setAppState } from './appState';
import { SHEET_SCRIPT_URL } from './config';
import { disruptionsByRoute } from './disruptions';
import { openModal } from './modal';
import { showShareBanner } from './overlays';
import { forecastUrls, routeWeather } from './forecast';
import { calcOverallRisk, seasonFactor } from './risk';
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
// { [route]: { base, winter, summer, shoulder, samples } }. The last good
// copy is kept in localStorage and used straight away, then replaced by the
// Sheet's if it answers (it's slow to start, and unreachable offline).
const THRESHOLDS_KEY = 'wis_thresholds';

export async function loadHistoricalThresholds() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(THRESHOLDS_KEY)); } catch (_) {}
  if (saved) setAppState({ thresholds: saved });
  try {
    const res = await fetch(`${SHEET_SCRIPT_URL}?action=getThresholds`, { signal: AbortSignal.timeout(20000) });
    const json = await res.json();
    if (json.thresholds) {
      setAppState({ thresholds: json.thresholds });
      try { localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(json.thresholds)); } catch (_) {}
      console.log(`[CalMac] Loaded historical thresholds for ${Object.keys(json.thresholds).length} routes`);
    }
  } catch (err) {
    if (saved) {
      console.warn('[CalMac] Could not load historical thresholds — using the saved copy', err);
    } else {
      console.warn('[CalMac] Could not load historical thresholds — using weather-only predictions', err);
    }
  }
}

// ── CalMac disruptions ──
export async function loadDisruptions() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.fallback) return;
    const disruptions = disruptionsByRoute(data);
    setAppState({ disruptions, lastDisruptionFetch: new Date() });
  } catch (_) {}
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

// Request everything the page loads again, without showing it, so the
// service worker saves an offline copy. For the first visit, whose loads
// happen before the service worker is in control.
export function warmOfflineCache() {
  const { windUrl, marineUrl } = forecastUrls();
  [windUrl, marineUrl, '/api/status', `/api/timetable?date=${ukDateStr(0)}`, `/api/timetable?date=${ukDateStr(1)}`]
    .forEach(url => fetch(url).catch(() => {}));
}

// Routes' weather, and when it was saved if it came from the offline copy
async function fetchAllWeather(hour) {
  const { windUrl, marineUrl } = forecastUrls();

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
  // Signal back after being offline: replace the saved forecast straight away
  window.addEventListener('online', () => {
    fetchData().catch(() => {});
    loadDisruptions();
  });

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

  // CalMac's notices and a shared link don't depend on the weather, so they
  // follow either way (once the loading screen has gone)
  let loaded = true;
  try {
    await fetchData();
    clearInterval(ticker);
    clearTimeout(hardTimeout);
    loadingStore.set({ progress: 100, message: 'Ready!' });
    setTimeout(() => loadingStore.set({ hidden: true }), 400);
  } catch (_) {
    loaded = false;
    clearInterval(ticker);
    clearTimeout(hardTimeout);
    showError('Could not load data — tap Refresh to try again');
  }
  loadDisruptions();
  setTimeout(openShareLink, loaded ? 200 : 3700);
}

