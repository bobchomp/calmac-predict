// Shared data and pure helpers live in lib/ (routes, risk, timetable, format,
// sun, disruptions, config); components/LegacyScript.js puts them on window
// before this script runs.

// ── LIVE TIMETABLE ──
// Real per-date sailings from /api/timetable (CalMac API), keyed by UK date.
// A CalMac route with an empty list has no sailings that day; routes missing
// from the response (non-CalMac, or API down) fall back to TIMETABLE (lib/timetable.js).
const liveTimetable = {};
async function loadLiveTimetable() {
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
}

const ROUTE_NAMES = ROUTES.map(r => r.name);

// ── STATE ──
let allRoutes = [];
let activeFilter = 'all';
let searchQuery  = '';
let lastFetched  = null;

// ── HELPERS ──
// ── LIVE DISRUPTION STATUS ──────────────────────────────────────────────
// Populated by loadDisruptionBanner() from /api/status
// Maps routeKey → { status, message }
let liveDisruptions = {};
let showingTomorrowGlobal = false;

// ── GOOGLE SHEET INTEGRATION ─────────────────────────────────
// Stores historical reliability thresholds fetched from the Sheet.
// Format: { [routeKey]: { base, winter, summer, shoulder, samples } }
let historicalThresholds = {};
let thresholdsLoaded = false;

async function loadHistoricalThresholds() {
  try {
    const res = await fetch(`${SHEET_SCRIPT_URL}?action=getThresholds`);
    const json = await res.json();
    if (json.thresholds) {
      historicalThresholds = json.thresholds;
      thresholdsLoaded = true;
      console.log(`[CalMac] Loaded historical thresholds for ${Object.keys(historicalThresholds).length} routes`);
    }
  } catch (err) {
    console.warn('[CalMac] Could not load historical thresholds — using weather-only predictions', err);
  }
}

// ── RENDER ──
// The route grids are rendered by components/RouteGrids.js from this state
function renderRoutes() {
  setAppState({
    phase: 'ready',
    routes: allRoutes.map(r => ({ ...r })),
    disruptions: { ...liveDisruptions },
    timetable: { ...liveTimetable },
    thresholds: historicalThresholds,
    showingTomorrow: showingTomorrowGlobal,
    filter: activeFilter,
    search: searchQuery,
    lastFetched,
  });
}

function updateSummary() {
  const likely   = allRoutes.filter(r => r.verdict === 'likely').length;
  const caution  = allRoutes.filter(r => r.verdict === 'caution').length;
  const unlikely = allRoutes.filter(r => r.verdict === 'unlikely').length;
  document.getElementById('sumTotal').textContent   = allRoutes.length;
  document.getElementById('sumLikely').textContent  = likely;
  document.getElementById('sumCaution').textContent = caution;
  document.getElementById('sumUnlikely').textContent = unlikely;
  document.getElementById('summaryCards').style.display = '';
}

function showSkeletons() {
  setAppState({ phase: 'loading' });
}

function setStatus(type, msg) {
  const bar = document.getElementById('statusBar');
  document.getElementById('statusText').textContent = msg;
  document.getElementById('pulse').style.display = type === 'loading' ? '' : 'none';
  bar.className = 'status-bar ' + type;
}

// ── FETCH ──
// Single batch request for all 22 routes — Open-Meteo supports comma-separated
// lat/lon and returns an array, so 2 requests total instead of 44.
async function fetchAllWeather() {
  const hour = new Date().getHours();

  const lats = ROUTES.map(r => r.lat).join(',');
  const lons = ROUTES.map(r => r.lon).join(',');

  const windUrl   = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + lats + '&longitude=' + lons
    + '&forecast_days=2&timezone=Europe%2FLondon&windspeed_unit=ms'
    + '&hourly=windspeed_10m,windgusts_10m,winddirection_10m,weather_code,visibility,precipitation,snowfall';
  const marineUrl = 'https://marine-api.open-meteo.com/v1/marine'
    + '?latitude=' + lats + '&longitude=' + lons
    + '&forecast_days=2&timezone=Europe%2FLondon'
    + '&hourly=wave_height,wave_period,swell_wave_height';

  if (typeof ls !== 'undefined') { ls.setProgress(30); ls.setMessage('Fetching weather data…'); }

  const [windResp, marineResp] = await Promise.allSettled([
    fetch(windUrl,   { signal: AbortSignal.timeout(15000) }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
    fetch(marineUrl, { signal: AbortSignal.timeout(15000) }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
  ]);

  if (windResp.status === 'rejected') throw new Error('Weather fetch failed: ' + windResp.reason);

  if (typeof ls !== 'undefined') { ls.setProgress(70); ls.setMessage('Processing…'); }

  const windArr   = Array.isArray(windResp.value)   ? windResp.value   : [windResp.value];
  const marineArr = marineResp.status === 'fulfilled'
    ? (Array.isArray(marineResp.value) ? marineResp.value : [marineResp.value])
    : [];

  const slice     = (arr, start) => (arr || []).slice(start, start + 12).filter(v => v != null);
  const sliceFrom = (arr, start) => (arr || []).slice(start, start + 24).filter(v => v != null);
  const mx = arr => arr.length ? Math.max(...arr) : null;
  const mn = arr => arr.length ? Math.min(...arr) : null;

  const results = ROUTES.map((route, i) => {
    const w      = windArr[i]   || {};
    const mEntry = marineArr[i] || null;
    const hourly = w.hourly     || {};
    const marine = mEntry?.hourly || null;

    const gusts  = slice(hourly.windgusts_10m, hour);
    const winds  = slice(hourly.windspeed_10m,  hour);
    // Open-Meteo doesn't always provide windgusts_10m for offshore locations — fall back to wind speed
    const effectiveGusts = gusts.length ? gusts : winds;
    const waves  = marine ? slice(marine.wave_height,        hour) : [];
    const swells = marine ? slice(marine.swell_wave_height,  hour) : [];
    const dirs   = (hourly.winddirection_10m || []).slice(hour, hour + 12).filter(v => v != null);
    const windDirDeg = dirs.length ? Math.round(dirs.reduce((a,b) => a + b, 0) / dirs.length) : null;

    const tomorrowStart = 24;
    const tGusts = sliceFrom(hourly.windgusts_10m, tomorrowStart);
    const tWinds = sliceFrom(hourly.windspeed_10m, tomorrowStart);
    const effectiveTGusts = tGusts.length ? tGusts : tWinds;
    const tWaves = marine ? sliceFrom(marine.wave_height, tomorrowStart) : [];

    // weather_code is the current Open-Meteo field name (weathercode is legacy alias)
    const weatherHourly = hourly.weather_code || hourly.weathercode || [];
    // Element-wise gust fallback: Open-Meteo returns arrays of nulls for offshore locations.
    // Checking array truthiness alone won't catch this — we must patch each null element.
    const rawGusts = hourly.windgusts_10m || [];
    const rawWinds = hourly.windspeed_10m || [];
    const patchedGusts = rawGusts.length
      ? rawGusts.map((v, i) => v != null ? v : (rawWinds[i] ?? 0))
      : rawWinds;
    const mergedHourly = { ...hourly, weathercode: weatherHourly, windgusts_10m: patchedGusts };
    // Tomorrow's 24 hours, indexed from tomorrow midnight like today's are
    const tomorrowOf = data => data && Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.slice(tomorrowStart, tomorrowStart + 24) : v]));

    return {
      route: route.name, hourly: mergedHourly, marine,
      maxGustMph: mx(effectiveGusts) !== null ? Math.round(mx(effectiveGusts) * 2.237) : null,
      maxWindMph: mx(winds)          !== null ? Math.round(mx(winds)          * 2.237) : null,
      worstCode:  mx(slice(weatherHourly, hour)),
      minVisM:    mn(slice(hourly.visibility, hour)),
      maxPrecip:  mx(slice(hourly.precipitation, hour)),
      maxSnow:    mx(slice(hourly.snowfall, hour)),
      maxWaveM:   mx(waves)  !== null ? Math.round(mx(waves)  * 10) / 10 : null,
      maxSwellM:  mx(swells) !== null ? Math.round(mx(swells) * 10) / 10 : null,
      hasMarine:  marine !== null,
      windDirDeg,
      tomorrow: {
        maxGustMph: mx(effectiveTGusts) !== null ? Math.round(mx(effectiveTGusts) * 2.237) : null,
        maxWaveM:   mx(tWaves)          !== null ? Math.round(mx(tWaves)          * 10) / 10 : null,
        hourly:     tomorrowOf(mergedHourly),
        marine:     tomorrowOf(marine),
      },
    };
  });

  if (!results.some(r => r.maxGustMph !== null)) {
    throw new Error('No weather data received — check your connection');
  }
  if (typeof ls !== 'undefined') { ls.setProgress(85); ls.setMessage('Calculating risk scores…'); }
  return results;
}


async function fetchData() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  showSkeletons();
  setStatus('loading', 'Loading…');

  allRoutes = ROUTES.map(r => ({
    name: r.name, verdict: 'unknown',
    maxGustMph: undefined, maxWindMph: undefined, weatherCode: undefined,
    maxWaveM: undefined, minVisM: undefined,
    risk: undefined, hasMarine: false,
    hourlyData: null, marineData: null,
  }));

  const timetableReady = loadLiveTimetable();

  try {
    if (typeof ls !== 'undefined') {
      ls.setMessage('Calling weather API…');
      ls.setProgress(20);
    }

    const routeData = await fetchAllWeather();
    await timetableReady;

    if (typeof ls !== 'undefined') {
      ls.setProgress(75);
      ls.setMessage('Calculating risk scores…');
    }

    const hour = new Date().getHours();

    routeData.forEach(w => {
      const route = allRoutes.find(r => r.name === w.route);
      if (!route) return;
      route.maxGustMph  = w.maxGustMph;
      route.maxWindMph  = w.maxWindMph;
      route.weatherCode = w.worstCode;
      route.maxWaveM    = w.maxWaveM;
      route.minVisM     = w.minVisM;
      route.hasMarine   = w.hasMarine;
      route.hourlyData  = w.hourly;
      route.marineData  = w.marine;
      route.windDirDeg  = w.windDirDeg;
      route.tomorrow    = w.tomorrow || null;
      // Compute risk using the full algorithm
      route.risk = calcOverallRisk(route.name, hour, w.hourly || {}, w.marine || null);
    });

    allRoutes.forEach(r => { r.verdict = verdictFromRisk(r.risk || 0); });

    updateSummary();
    renderRoutes();
    lastFetched = new Date();
    setAppState({ lastFetched });

    const marineCount = allRoutes.filter(r => r.hasMarine).length;
    setStatus('ok', 'Updated ' + lastFetched.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
      + ' · Wave data: ' + marineCount + '/22 routes'
      + ' · ' + (seasonFactor() < 0.9 ? 'Winter mode' : seasonFactor() < 1.0 ? 'Shoulder season' : 'Summer mode')
      + ' · Auto-refreshes every 30 min');

  } catch(err) {
    setStatus('error', 'Could not load data: ' + err.message + ' — tap Refresh to try again');
    allRoutes.forEach(r => { r.verdict = 'unknown'; });
    await timetableReady;
    renderRoutes();
    throw err; // re-throw so boot handler catches it
  } finally {
    btn.classList.remove('spinning');
  }
}

// ── BOTTOM NAV ──
let activeTab = 'tabRoutes';

const TAB_HASH = { tabRoutes: '', tabFavs: 'favourites', tabStatus: 'status', tabAbout: 'about' };
const HASH_TAB = { '': 'tabRoutes', favourites: 'tabFavs', status: 'tabStatus', about: 'tabAbout' };

function switchTab(target, updateHash = true) {
  if (!document.getElementById(target)) return;
  activeTab = target;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.nav-tab[data-tab="${target}"]`)?.classList.add('active');
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.getElementById(target).classList.add('active');
  const showToolbar = target === 'tabRoutes';
  document.querySelector('.toolbar').style.display = showToolbar ? '' : 'none';
  if (target === 'tabAbout') loadAboutStats();
  if (target === 'tabStatus') runStatusCheck();
  window.scrollTo(0, 0);
  if (updateHash) {
    const hash = TAB_HASH[target];
    history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
  }
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#', '');
  switchTab(HASH_TAB[hash] || 'tabRoutes', false);
});

// ── LOADING SCREEN ──
const ls = (() => {
  const screen   = document.getElementById('loadingScreen');
  const progress = document.getElementById('lsProgress');
  const status   = document.getElementById('lsStatus');
  return {
    setProgress(pct) { progress.style.width = Math.min(100, pct) + '%'; },
    setMessage(msg)  { status.textContent = msg; },
    dismiss() {
      progress.style.width = '100%';
      status.textContent = 'Ready!';
      setTimeout(() => screen.classList.add('hidden'), 400);
    },
    showError(msg) {
      status.style.color = '#ff9090';
      status.textContent = '⚠️ ' + msg;
      progress.style.background = '#c8102e';
      progress.style.width = '100%';
      setTimeout(() => screen.classList.add('hidden'), 3500);
    }
  };
})();

// ── EVENTS ──
document.getElementById('search').addEventListener('input', e => { searchQuery = e.target.value; renderRoutes(); });
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderRoutes();
  });
});
document.getElementById('refreshBtn').addEventListener('click', fetchData);
setInterval(fetchData, 30 * 60 * 1000);
setInterval(loadDisruptionBanner, 10 * 60 * 1000); // refresh CalMac disruptions every 10 min

// ─────────────────────────────────────────────────────────────────────────
// ── SERVICE WORKER REGISTRATION ──
// ─────────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Listen for messages from SW (e.g. navigate to route from notification)
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'NAVIGATE' && e.data.url) {
      // Alert links are /?route=…; older ones used #route=…
      const target = new URL(e.data.url, location.href);
      const route = target.searchParams.get('route')
        || (target.hash.startsWith('#route=') ? decodeURIComponent(target.hash.replace('#route=', '')) : null);
      if (route) openModal(route, target.searchParams.get('sailing'));
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// ── DEEP LINK / SHARE LINK HANDLING ──
// Parse ?route=...&date=...&sailing=... on load
// ─────────────────────────────────────────────────────────────────────────
function parseShareLink() {
  const params = new URLSearchParams(location.search);
  const route = params.get('route');
  const date  = params.get('date');
  const sailing = params.get('sailing');
  if (route) {
    // After data loads, open modal or trip modal
    window._shareRoute   = route;
    window._shareSailing = sailing;
    window._shareFrom    = params.get('from') || null;
    window._shareAlert   = params.has('alert'); // opened from an alert, not a share
  }
}
parseShareLink();

function handleShareDeepLink() {
  if (!window._shareRoute) return;
  const route = window._shareRoute;
  const from  = window._shareFrom;

  // Show the share banner (not for alert links)
  if (!window._shareAlert) {
    showShareBanner(from
      ? `${from} shared "${route}" with you 🚢`
      : `Someone shared "${route}" with you 🚢`);
  }

  // Open the route modal
  setTimeout(() => openModal(route, window._shareSailing || null), 400);

  // Clean URL without reloading
  history.replaceState(null, '', location.pathname);
}

// ─────────────────────────────────────────────────────────────────────────
// ── PUSH NOTIFICATIONS ──
// ─────────────────────────────────────────────────────────────────────────
let vapidPublicKey = null;
let pushSupported = false;

async function initPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const res = await fetch('/api/notify');
    const data = await res.json();
    if (!data.available) return;
    vapidPublicKey = data.publicKey;
    pushSupported = true;
    setAppState({ pushSupported });
  } catch (_) {}
}
initPush();

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

// Returns current push subscription endpoint, or null
async function getPushSubscription() {
  if (!pushSupported) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub;
  } catch (_) { return null; }
}

// Toggle push notification for a route (called from card bell button)
async function toggleRouteNotification(routeName) {
  if (!pushSupported) {
    alert('Push notifications are not supported in this browser.');
    return;
  }
  if (Notification.permission === 'denied') {
    alert('Notifications are blocked. Please enable them in your browser settings.');
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    const isOn = isRouteNotified(routeName);

    if (isOn) {
      // Unsubscribe for this route
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unsubscribe', route: routeName, endpoint: sub?.endpoint }),
      });
      setRouteNotified(routeName, false);
    } else {
      // Request permission if needed
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;
      }

      // Create or reuse push subscription
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', route: routeName, subscription: sub.toJSON(), threshold: getNotifThreshold(routeName) }),
      });
      setRouteNotified(routeName, true);
    }
  } catch (err) {
    console.warn('Push toggle error:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ── LIVE STATUS LOADER ──
// Loads CalMac disruption data silently — shown inline on each sailing row
// ─────────────────────────────────────────────────────────────────────────
async function loadDisruptionBanner() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.fallback) return;
    const disrupted = data.disrupted || [];
    const allRoutes_status = data.routes || disrupted;
    liveDisruptions = {};
    // Store ALL routes so sailingStatuses is available even for BE_AWARE routes
    // Several CalMac routes can share one card: combine their notices and
    // sailing statuses
    allRoutes_status.forEach(d => {
      if (!d.routeKey) return;
      const prev = liveDisruptions[d.routeKey];
      liveDisruptions[d.routeKey] = {
        ...d,
        notices: [...(prev?.notices || []), ...(d.notices || [])],
        sailingStatuses: mergeStatuses(prev?.sailingStatuses, d.sailingStatuses),
        sailingStatusesTomorrow: mergeStatuses(prev?.sailingStatusesTomorrow, d.sailingStatusesTomorrow),
      };
    });
    setAppState({ lastDisruptionFetch: new Date() });
    // Re-render so sailing rows reflect live CalMac status
    if (Object.keys(liveDisruptions).length > 0 && allRoutes.length > 0) {
      renderRoutes();
    }
  } catch (_) {}
}

// ── ENABLE ALERTS ──
// Run once the threshold picker (components/Pickers.js) is confirmed
async function enableRouteAlerts(routeName) {
  if (!pushSupported) {
    let waited = 0;
    while (!pushSupported && waited < 3000) {
      await new Promise(r => setTimeout(r, 200));
      waited += 200;
    }
  }
  if (!pushSupported && !('PushManager' in window)) {
    alert('Push notifications require HTTPS and a modern browser.');
    return;
  }
  if (!pushSupported) await initPush();
  toggleRouteNotification(routeName);
}

// ── TOMORROW GLOBAL TOGGLE ──
function toggleTomorrowGlobal() {
  showingTomorrowGlobal = !showingTomorrowGlobal;
  const btn = document.getElementById('tomorrowToggleBtn');
  if (btn) {
    if (showingTomorrowGlobal) {
      btn.style.background = 'var(--blue)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--blue)';
      btn.querySelector('svg').style.stroke = '#fff';
      btn.querySelector('svg').nextSibling && (btn.lastChild.textContent = ' Today');
      btn.querySelector('span') ? btn.querySelector('span').textContent = 'Today' : null;
    } else {
      btn.style.background = 'var(--offwhite)';
      btn.style.color = 'var(--muted)';
      btn.style.borderColor = 'var(--light)';
      btn.querySelector('span') ? btn.querySelector('span').textContent = 'Tomorrow' : null;
    }
  }
  // Re-render all cards with tomorrow data
  renderRoutes();
}



// Store route for modal open from map panel
window._mapSelectedRoute = null;

// ─────────────────────────────────────────────────────────────────────────
// ── BOOT ──
// Tie loading screen to actual data fetch
(async () => {
  const messages = [
    'Fetching wind forecasts…',
    'Loading wave & swell data…',
    'Calculating route risks…',
    'Checking visibility…',
    'Applying seasonal factors…',
    'Almost ready…',
  ];
  let msgIdx = 0;
  // Animate progress in steps while fetch runs
  const ticker = setInterval(() => {
    const newPct = Math.min(90, ((msgIdx + 1) / messages.length) * 90);
    ls.setProgress(newPct);
    ls.setMessage(messages[msgIdx]);
    msgIdx = Math.min(msgIdx + 1, messages.length - 1);
  }, 1800);

  // Hard timeout — if fetch takes >45s, show error and dismiss
  const hardTimeout = setTimeout(() => {
    clearInterval(ticker);
    ls.showError('Taking too long — check your connection');
    setTimeout(fetchData, 100); // still try to render what we have
  }, 45000);

  // Load historical thresholds in parallel with weather — fire and forget.
  // If it resolves before fetchData finishes, scores will be calibrated.
  // If it's slower, the page will be correct on next auto-refresh.
  loadHistoricalThresholds().then(() => {
    // Re-render if weather data is already loaded when thresholds arrive
    if (allRoutes.some(r => r.maxGustMph !== undefined)) renderRoutes();
  });

  try {
    await fetchData();
    clearInterval(ticker);
    clearTimeout(hardTimeout);
    ls.dismiss();
    // Post-boot: load disruption banner + handle share deep links
    loadDisruptionBanner();
    setTimeout(() => {
      handleShareDeepLink();
      // Refresh map if it's already open
    }, 200);
  } catch(e) {
    clearInterval(ticker);
    clearTimeout(hardTimeout);
    ls.showError('Could not load data — tap Refresh to try again');
    setTimeout(() => document.getElementById('loadingScreen').classList.add('hidden'), 3500);
  }
})();


