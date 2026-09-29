// The Status tab's system checks and the About tab's database figures.
// runStatusCheck and loadAboutStats run when those tabs open (and from the
// Status tab's Check now button).

import { getAppState } from './appState';
import { SHEET_SCRIPT_URL } from './config';
import { createStore } from './store';
import { ukDateStr } from './timetable';

// ── Status tab ──
// items: [{ name, icon, dot, badge, badgeText, detail }]; icon is '' while checking
const CHECKING = ['Weather API', 'Marine/Wave API', 'CalMac Status API', 'Push Notifications', 'Service Worker', 'Historical Data']
  .map(name => ({ name, icon: '', dot: 'grey', badge: 'grey', badgeText: '–', detail: 'Checking…' }));

export const statusStore = createStore({ items: [], lastChecked: null });

const hhmm = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
let runId = 0;

export async function runStatusCheck() {
  const run = ++runId;
  statusStore.set({ items: CHECKING });
  const { routes, thresholds, lastFetched, lastDisruptionFetch, pushSupported } = getAppState();
  const results = [];

  // 1. Weather API
  try {
    const t0 = Date.now();
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=57.0&longitude=-5.8&hourly=windspeed_10m&forecast_days=1', { signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - t0;
    const routesLoaded = routes.filter(rt => rt.maxGustMph !== null && rt.maxGustMph !== undefined).length;
    if (!r.ok) {
      results.push({ name: 'Weather API', icon: '🌤', dot: 'red', badge: 'err', badgeText: '✗ Error', detail: `HTTP ${r.status} — weather data unavailable` });
    } else if (routesLoaded === 0) {
      results.push({ name: 'Weather API', icon: '🌤', dot: 'amber', badge: 'warn', badgeText: '⚠ No data', detail: `Open-Meteo responding (${ms}ms) — app data failed to load, try refreshing` });
    } else {
      results.push({ name: 'Weather API', icon: '🌤', dot: 'green', badge: 'ok', badgeText: '✓ OK', detail: `Open-Meteo responding (${ms}ms) · ${routesLoaded}/22 routes loaded` });
    }
  } catch (e) {
    results.push({ name: 'Weather API', icon: '🌤', dot: 'red', badge: 'err', badgeText: '✗ Error', detail: e.message });
  }

  // 2. Marine/Wave API
  try {
    const t0 = Date.now();
    const r = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=57.0&longitude=-5.8&hourly=wave_height&forecast_days=1', { signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - t0;
    const marineCount = routes.filter(rt => rt.hasMarine).length;
    results.push({
      name: 'Marine / Wave API', icon: '🌊',
      dot: r.ok ? 'green' : 'amber', badge: r.ok ? 'ok' : 'warn', badgeText: r.ok ? '✓ OK' : '⚠ Degraded',
      detail: r.ok
        ? `Open-Meteo Marine responding (${ms}ms) · ${marineCount}/22 routes have wave data`
        : `HTTP ${r.status} — wave predictions estimated from wind`,
    });
  } catch (_) {
    results.push({ name: 'Marine / Wave API', icon: '🌊', dot: 'amber', badge: 'warn', badgeText: '⚠ Degraded', detail: 'Unavailable — wave risk estimated from wind' });
  }

  // 3. CalMac Status API
  try {
    const t0 = Date.now();
    const r = await fetch('/api/status', { signal: AbortSignal.timeout(10000) });
    const ms = Date.now() - t0;
    const data = await r.json();
    const isFallback = data.fallback === true;
    results.push({
      name: 'CalMac Status API', icon: '🚨',
      dot: isFallback ? 'red' : 'green', badge: isFallback ? 'err' : 'ok', badgeText: isFallback ? '✗ Fallback' : '✓ Live',
      detail: isFallback
        ? `API unavailable (${data.error || 'unknown error'}) — showing link to CalMac website`
        : `${data.routes?.length || 0} routes · ${data.disrupted?.length || 0} disrupted · fetched in ${ms}ms${lastDisruptionFetch ? ' · last loaded ' + hhmm(lastDisruptionFetch) : ''}`,
    });
  } catch (e) {
    results.push({ name: 'CalMac Status API', icon: '🚨', dot: 'red', badge: 'err', badgeText: '✗ Error', detail: e.message });
  }

  // 4. Push notifications
  const hasSW = 'serviceWorker' in navigator;
  const hasPush = 'PushManager' in window;
  const hasNotif = 'Notification' in window;
  let subscribedRoutes = [];
  try { subscribedRoutes = JSON.parse(localStorage.getItem('notifRoutes') || '[]'); } catch (_) {}
  if (!hasSW || !hasPush || !hasNotif) {
    results.push({ name: 'Push Notifications', icon: '🔔', dot: 'red', badge: 'err', badgeText: '✗ Unsupported', detail: 'Push notifications not supported in this browser' });
  } else if (Notification.permission === 'denied') {
    results.push({ name: 'Push Notifications', icon: '🔔', dot: 'red', badge: 'err', badgeText: '✗ Blocked', detail: 'Notifications blocked — enable in browser settings' });
  } else if (Notification.permission === 'granted' && pushSupported) {
    results.push({
      name: 'Push Notifications', icon: '🔔', dot: 'green', badge: 'ok', badgeText: '✓ Active',
      detail: subscribedRoutes.length > 0
        ? `Subscribed to ${subscribedRoutes.length} route${subscribedRoutes.length > 1 ? 's' : ''}: ${subscribedRoutes.join(', ').substring(0, 60)}`
        : 'Permission granted · No routes subscribed yet — tap "Alert me" on a route',
    });
  } else {
    results.push({ name: 'Push Notifications', icon: '🔔', dot: 'amber', badge: 'warn', badgeText: '⚠ Not set up', detail: 'Tap "Alert me" on a route to enable push notifications' });
  }

  // 5. Service worker
  let sw = { dot: 'grey', badge: 'grey', badgeText: '–', detail: 'Not supported' };
  if (hasSW) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (reg) {
        const state = reg.active?.state || reg.installing?.state || reg.waiting?.state || 'unknown';
        const active = state === 'activated';
        sw = { dot: active ? 'green' : 'amber', badge: active ? 'ok' : 'warn', badgeText: active ? '✓ Active' : '⚠ ' + state, detail: `Service worker ${state} · Scope: ${reg.scope}` };
      } else {
        sw = { dot: 'amber', badge: 'warn', badgeText: '⚠ Not registered', detail: 'Service worker not yet registered — reload the page' };
      }
    } catch (e) {
      sw = { dot: 'red', badge: 'err', badgeText: '✗ Error', detail: e.message };
    }
  }
  results.push({ name: 'Service Worker', icon: '⚙️', ...sw });

  // 6. Historical calibration
  const calibrated = Object.keys(thresholds).length;
  results.push({
    name: 'Historical Calibration', icon: '📊',
    dot: calibrated ? 'green' : 'amber', badge: calibrated ? 'ok' : 'warn', badgeText: calibrated ? '✓ Loaded' : '⚠ Loading',
    detail: calibrated
      ? `${calibrated} routes calibrated with real CalMac data · Last weather fetch: ${lastFetched ? hhmm(lastFetched) : 'never'}`
      : 'Historical thresholds not yet loaded — predictions use weather only',
  });

  // 7. Prediction accuracy, sailing by sailing (api/sailings.js; left out if
  // the endpoint fails)
  try {
    const accResp = await fetch('/api/sailings', { signal: AbortSignal.timeout(8000) });
    const acc = accResp.ok ? await accResp.json() : null;
    if (acc?.ok) {
      const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
      const item = { name: 'Prediction Accuracy', icon: '🎯', link: { href: `/api/sailings?date=${ukDateStr(0)}&format=csv`, text: "Download today's record" } };
      if (acc.resolved < 20) {
        results.push({
          ...item, dot: 'amber', badge: 'warn', badgeText: acc.resolved ? '⚠ Building' : '⚠ Recording',
          detail: acc.resolved
            ? `${acc.correct} of ${plural(acc.resolved, 'sailing')} called right so far · ${plural(acc.pending, 'sailing')} still to go`
            : `Recording every sailing's prediction and outcome — ${plural(acc.sailings, 'sailing')} so far; results appear once they've departed`,
        });
      } else {
        const level = acc.accuracy >= 80 ? 0 : acc.accuracy >= 60 ? 1 : 2;
        const bands = acc.bands
          .filter(b => b.count > 0)
          .map(b => `${{ likely: 'Likely', caution: 'Caution', unlikely: 'At risk' }[b.verdict]} → ${b.sailedPct}% sailed`)
          .join(' · ');
        results.push({
          ...item,
          dot: ['green', 'amber', 'red'][level], badge: ['ok', 'warn', 'err'][level], badgeText: `${['✓', '⚠', '✗'][level]} ${acc.accuracy}%`,
          detail: `${acc.accuracy}% of ${plural(acc.resolved, 'sailing')} called right (last 30 days)`
            + (acc.cancelled ? ` · ${acc.cancelledPredicted} of ${plural(acc.cancelled, 'cancellation')} predicted` : '')
            + ` · ${plural(acc.falseAlarms, 'false alarm')}`
            + (bands ? ' · ' + bands : ''),
        });
      }
    }
  } catch (_) {}

  // A newer check (Check now tapped again) replaces this one
  if (run !== runId) return;
  statusStore.set({ items: results, lastChecked: new Date() });
}

// ── About tab ──
export const aboutStatsStore = createStore({ months: '–', routes: '–' });
let aboutStatsLoaded = false;

export async function loadAboutStats() {
  if (aboutStatsLoaded) return;
  try {
    const res = await fetch(`${SHEET_SCRIPT_URL}?action=getStats`);
    const json = await res.json();
    if (json.reliability_months !== undefined) {
      aboutStatsStore.set({ months: json.reliability_months, routes: json.routes_calibrated });
      aboutStatsLoaded = true;
    }
  } catch (_) {
    // Sheet unavailable: leave the dashes
  }
}
