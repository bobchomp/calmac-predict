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

function sailingsFor(routeName, tomorrow) {
  const live = liveTimetable[ukDateStr(tomorrow ? 1 : 0)]?.[routeName];
  return { sailings: live ?? TIMETABLE[routeName] ?? [], isLive: !!live };
}

const ROUTE_NAMES = ROUTES.map(r => r.name);

// ── STATE ──
let allRoutes = [];
let activeFilter = 'all';
let searchQuery  = '';
let lastFetched  = null;

// ── HELPERS ──
// ── SAILING CHANCE CACHE ────────────────────────────────────────────────
// Pre-computed per-sailing chances: { "RouteName|HH:MM": 79 }
// Written by buildCard(), read by openModal()
const sailingChanceCache = {};

// ── LIVE DISRUPTION STATUS ──────────────────────────────────────────────
// Populated by loadDisruptionBanner() from /api/status
// Maps routeKey → { status, message }
let liveDisruptions = {};
let showingTomorrowGlobal = false;
let lastDisruptionFetch = null;

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

// Historical reliability for a route in the current season (0–100), or null.
function getHistoricalReliability(routeName) {
  return historicalReliability(historicalThresholds, routeName);
}

function sailingChance(risk, routeName) {
  return chanceFromRisk(risk, routeName ? getHistoricalReliability(routeName) : null);
}

// Per-sailing risk at a specific departure time
function sailingRisk(departureTime, routeName, hourlyWeather, hourlyMarine) {
  if (!hourlyWeather) return null;
  const [hh] = departureTime.split(':').map(Number);
  const idx = Math.min(hh, 23);
  const risk = calcHourlyRisk(routeName, idx, hourlyWeather, hourlyMarine);
  return sailingChance(risk, routeName);
}

// ── RENDER ──
function renderRoutes() {
  const grid = document.getElementById('routesGrid');
  let filtered = allRoutes.filter(r => {
    const mf = activeFilter === 'all' || r.verdict === activeFilter;
    const ms = r.name.toLowerCase().includes(searchQuery.toLowerCase());
    return mf && ms;
  });
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><p>No routes match your filter.</p></div>';
    return;
  }
  grid.innerHTML = filtered.map((r, i) => buildCard(r, i)).join('');
  attachFavButtons(grid);
  attachCardClicks(grid);
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
  const grid = document.getElementById('routesGrid');
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="route-card">
      <div class="card-head">
        <div class="verdict-badge unknown"></div>
        <div style="flex:1"><div class="skeleton" style="height:13px;width:70%;margin-bottom:6px"></div><div class="skeleton" style="height:10px;width:45%"></div></div>
      </div>
      <div style="padding:10px 16px;background:var(--offwhite)"><div class="skeleton" style="height:10px"></div></div>
      <div style="padding:12px 16px"><div class="skeleton" style="height:10px;margin-bottom:8px"></div><div class="skeleton" style="height:10px;margin-bottom:8px"></div><div class="skeleton" style="height:10px"></div></div>
    </div>
  `).join('');
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
        hourly:     mergedHourly,
        marine,
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

// ── FAVOURITES ──
let favourites = JSON.parse(localStorage.getItem('wis_favs') || '[]');

function saveFavourites() {
  localStorage.setItem('wis_favs', JSON.stringify(favourites));
}

function isFav(name) { return favourites.includes(name); }

function toggleFav(name) {
  if (isFav(name)) {
    favourites = favourites.filter(f => f !== name);
  } else {
    favourites.push(name);
  }
  saveFavourites();
  // Just update the star icons — no full re-render to avoid recursion
  document.querySelectorAll('.fav-btn').forEach(btn => {
    if (btn.dataset.route === name) btn.textContent = isFav(name) ? '★' : '☆';
  });
  // Only re-render favourites tab if it's currently visible
  if (activeTab === 'tabFavs') renderFavourites();
}

function renderFavourites() {
  const grid = document.getElementById('favsGrid');
  const empty = document.getElementById('favsEmpty');
  const favRoutes = allRoutes.filter(r => isFav(r.name));
  if (favRoutes.length === 0) {
    grid.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
    grid.innerHTML = favRoutes.map((r, i) => buildCard(r, i)).join('');
    attachFavButtons(grid);
    attachCardClicks(grid);
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
  if (target === 'tabFavs') renderFavourites();
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

// Attributes for an island placeholder, rendered by components/Islands.js
function islandAttrs(type, props) {
  return `data-island="${type}" data-props="${escapeHtml(JSON.stringify(props))}"`;
}

// ── BUILD CARD (extracted so both tabs can use it) ──
function buildCard(r, i) {
  const currentHour = new Date().getHours();
  const currentMin  = new Date().getMinutes();
  const v        = r.verdict || 'unknown';
  const profile  = ROUTE_PROFILES[r.name] || {threshold:45,exposure:2};
  // Use tomorrow data if global toggle is active
  const _useTomorrow = showingTomorrowGlobal && r.tomorrow?.maxGustMph !== null;
  const _tomorrowNoon = 12;
  const _tomorrowRisk = _useTomorrow && r.tomorrow?.hourly
    ? calcOverallRisk(r.name, _tomorrowNoon, r.tomorrow.hourly, r.tomorrow.marine)
    : null;
  const overall  = r.maxGustMph !== undefined
    ? (_useTomorrow && _tomorrowRisk !== null ? sailingChance(_tomorrowRisk, r.name) : sailingChance(r.risk || 0, r.name))
    : null;
  const colour   = overall !== null ? chanceColor(overall) : 'var(--muted)';
  const gustPct  = Math.min(100, Math.round(((r.maxGustMph||0) / 65) * 100));
  const wc       = windClass(r.maxGustMph || 0);
  const pips     = r.maxGustMph !== undefined ? (r.hasMarine ? 3 : 2) : 1;
  const routeCoords = ROUTES.find(x => x.name === r.name) || { lat: 57, lon: -5.5 };
  const delay    = Math.min(i * 30, 350);
  const favStar  = isFav(r.name) ? '★' : '☆';

  // CalMac live status for this route
  const disruption   = liveDisruptions[r.name];
  const calMacStatus = disruption?.status || null;

  // Check if ALL sailings on this route are cancelled (wildcard '*' entry).
  // The route-level status is live, so it only counts for today.
  const sailingStatuses_card = statusesForDay(disruption, _useTomorrow);
  const allCancelled = (!_useTomorrow && calMacStatus === 'cancelled') ||
    (sailingStatuses_card['*']?.status === 'cancelled') ||
    (Object.keys(sailingStatuses_card).length > 0 &&
     Object.values(sailingStatuses_card).every(s => s.status === 'cancelled'));

  const { sailings, isLive: sailingsLive } = sailingsFor(r.name, _useTomorrow);
  // CalMac has an amended service or disruption in place (e.g. replacement
  // sailings described only in a notice, or a diversion to another port)
  const hasServiceChange = Object.keys(sailingStatuses_card).length > 0 || routeNotices(r.name).some(n => n.type === 'SAILING');
  // Find the next upcoming sailing time for this route
  // In tomorrow mode there's no "next" or "past" — all sailings are future
  const nextSailingTime = _useTomorrow ? null : (sailings.find(s => {
    const [hh, mm] = s.t.split(':').map(Number);
    return (hh > currentHour) || (hh === currentHour && mm > currentMin);
  })?.t || null);
  const sailingRows = sailings.map(s => {
    const time = s.t;
    const [hh, mm] = time.split(':').map(Number);
    const isPast = _useTomorrow ? false : ((hh < currentHour) || (hh === currentHour && mm <= currentMin));
    const isNext = time === nextSailingTime;
    const _sailHourly = _useTomorrow && r.tomorrow?.hourly ? r.tomorrow.hourly : r.hourlyData;
    const _sailMarine = _useTomorrow && r.tomorrow?.marine ? r.tomorrow.marine : r.marineData;
    const pct = _sailHourly ? sailingRisk(time, r.name, _sailHourly, _sailMarine) : null;
    // Store in cache so modal can read the exact same value
    if (pct !== null) sailingChanceCache[r.name + '|' + time] = pct;
    const sailingInfo = sailingStatusFor(sailingStatuses_card, time, s.f);
    const sailingStatus = sailingInfo?.status || null;

    // Reason icon for disruption rows
    const reasonIcons = { Weather: '🌊', Technical: '🔧', Operational: '⛴️', Tidal: '🌊', Other: 'ℹ️' };
    const reasonIcon = sailingInfo?.reason ? (reasonIcons[sailingInfo.reason] || 'ℹ️') : null;
    const reasonLabel = sailingInfo?.reason && sailingInfo.reason !== 'Other' ? sailingInfo.reason : null;

    return {
      time, from: s.f, to: s.to, pct,
      color: pct !== null ? chanceColor(pct) : 'var(--muted)',
      isPast, isNext,
      nextLabel: isNext ? (isBeforeDawn(hh, routeCoords.lat, routeCoords.lon) ? '🌙 Pre-dawn · Next' : 'Next sailing') : null,
      status: sailingStatus === 'cancelled' ? 'cancelled' : (sailingStatus === 'disrupted' || sailingStatus === 'amber') ? 'disrupted' : null,
      statusTitle: sailingStatus === 'cancelled' ? (sailingInfo.detail || '').substring(0, 120) : null,
      reasonIcon, reasonLabel,
    };
  });

  const calibration = (() => {
    const t = historicalThresholds[r.name];
    if (!t || t.samples < 2) return null;
    // Only show badge if calibration meaningfully affected the score
    const weatherOnly = Math.max(0, Math.min(100, Math.round(100 - (r.risk || 0))));
    const diff = Math.abs((overall || 0) - weatherOnly);
    return diff < 3 ? null : { samples: t.samples, diff };
  })();
  const cardHead = {
    verdictClass: allCancelled ? 'unlikely' : v,
    verdictIcon: allCancelled ? '❌' : verdictEmoji(v),
    name: r.name,
    cancelled: allCancelled,
    chanceText: overall !== null ? overall + '%' : '–',
    chanceColor: colour,
    chanceLabel: _useTomorrow ? "Tomorrow" : "Next 12h",
    exposureLabel: ['', '🛡 Sheltered', '🌊 Moderate', '🌊🌊 Exposed', '⚠️ Very exposed'][profile.exposure],
    // [background, text, border] colours
    badges: [
      calMacStatus === 'cancelled' && { text: '🚨 Cancelled', colors: ['#fceaed', '#c62828', '#ffcdd2'] },
      calMacStatus === 'disrupted' && { text: '⚠️ Disrupted', colors: ['#fff3e0', '#e65100', '#ffe082'] },
      calMacStatus === 'amber' && { text: '⚠️ Be Aware', colors: ['#fff8e1', '#e65100', '#ffe082'] },
      disruption?.isUpcoming && !['cancelled', 'disrupted', 'amber'].includes(calMacStatus) && { text: '⏰ Change coming', colors: ['#fff8e1', '#e65100', '#ffe082'] },
      calibration && { text: '📊 Calibrated', title: `Calibrated using ${calibration.samples} months of real CalMac data — shifted score by ${calibration.diff}%` },
    ].filter(Boolean),
  };
  const cardNotices = routeNotices(r.name).map(n => ({
    icon: NOTICE_ICONS[n.type] || '📋',
    title: n.title,
    preview: n.detail ? (d => d.length > 120 ? d.substring(0, 120).trimEnd() + '…' : d)(n.detail.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim()) : null,
  }));
  const gustShown = _useTomorrow && r.tomorrow?.maxGustMph !== null ? r.tomorrow.maxGustMph : r.maxGustMph;
  const waveShown = _useTomorrow ? r.tomorrow?.maxWaveM : r.maxWaveM;
  const cardWeather = {
    gust: gustShown !== undefined ? gustShown + ' mph' : '–',
    windDir: r.windDirDeg !== null && r.windDirDeg !== undefined ? windDirLabel(r.windDirDeg) : null,
    wave: waveShown !== null && waveShown !== undefined ? waveShown + 'm' : '–',
    vis: r.minVisM !== null && r.minVisM !== undefined && r.minVisM < 5000 ? (r.minVisM < 1000 ? r.minVisM + 'm' : Math.round(r.minVisM / 1000 * 10) / 10 + 'km') : null,
    desc: r.weatherCode !== undefined ? weatherDesc(r.weatherCode, r.minVisM) : '',
  };

  return `<div class="route-card" style="animation-delay:${delay}ms">
    <button class="fav-btn" data-route="${r.name}" title="Favourite this route">${favStar}</button>
    <div class="card-head" ${islandAttrs('cardHead', cardHead)}></div>
    <div style="display:contents" ${islandAttrs('notices', { routeName: r.name, notices: cardNotices })}></div>
    <div class="card-weather ${wc}" ${islandAttrs('weather', cardWeather)}></div>
    <div class="wind-bar-wrap ${wc}" ${islandAttrs('windBar', { gustPct })}></div>
    <div class="sailings-section" ${islandAttrs('sailings', {
      routeName: r.name,
      title: _useTomorrow ? "Tomorrow's sailings" : "Today's sailings",
      rows: sailingRows,
      emptyText: !sailingsLive ? 'No timetable available'
        : hasServiceChange ? `Normal sailings aren't running ${_useTomorrow ? 'tomorrow' : 'today'} — see CalMac's service update above`
        : `No sailings scheduled ${_useTomorrow ? 'tomorrow' : 'today'}`,
    })}></div>
    <div class="card-foot">
      <div class="conf-pips">
        ${[1,2,3].map(n=>`<div class="conf-pip ${n<=pips?'filled':''}"></div>`).join('')}
        <span>${pips===3?'High':pips===2?'Medium':'Low'} confidence</span>
      </div>
      <span>Updated ${lastFetched ? lastFetched.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '–'}</span>
    </div>

  </div>`;
}

function attachFavButtons(container) {
  container.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFav(btn.dataset.route);
    });
  });
}



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

// ── MODAL ──
function openModal(routeName, sailingTime) {
  const r = allRoutes.find(x => x.name === routeName);
  if (!r) return;

  const profile  = ROUTE_PROFILES[r.name] || { threshold: 45, exposure: 2 };
  const modalTomorrow = showingTomorrowGlobal && r.tomorrow?.maxGustMph !== null;
  const { sailings } = sailingsFor(r.name, modalTomorrow);
  // If a specific sailing time is given, use that hour; else use current hour
  const hour     = sailingTime ? parseInt(sailingTime.split(':')[0]) : new Date().getHours();
  const hourly   = r.hourlyData || {};
  const marine   = r.marineData || null;
  const season   = seasonFactor();

  // ── Use the SAME calculation path as the sailing row cards ──
  // sailingRisk() → calcHourlyRisk() is the single source of truth
  const h = sailingTime ? Math.min(parseInt(sailingTime.split(':')[0]), 23) : hour;
  const hw = r.hourlyData || {};
  const hm = r.marineData || null;

  // These are the exact values calcHourlyRisk uses (m/s converted to mph)
  const rawGustMs  = (hw.windgusts_10m || [])[h];   // null = missing gust data
  const rawWindMs  = (hw.windspeed_10m || [])[h];   // null = missing wind data
  const gustMs     = rawGustMs != null ? rawGustMs : (rawWindMs ?? 0);
  const gust = gustMs * 2.237;
  const wind = (rawWindMs ?? 0) * 2.237;
  const hasWindData = rawWindMs != null;
  const waveM = hm ? ((hm.wave_height || [])[h] ?? r.maxWaveM) : r.maxWaveM;
  const vis   = (hw.visibility || [])[h] ?? r.minVisM;
  const code  = (hw.weathercode || [])[h] ?? r.weatherCode ?? 0;
  const snow  = (hw.snowfall || [])[h] ?? 0;
  const isTidal = TIDAL_ROUTES.has(r.name);
  const effThreshold = profile.threshold * season;

  // Wind score — must exactly match calcHourlyRisk thresholds
  const gustRatio = gust / effThreshold;
  let windScore = 0;
  if      (gustRatio >= 1.2)  windScore = 40;
  else if (gustRatio >= 1.0)  windScore = 34;
  else if (gustRatio >= 0.9)  windScore = 26;
  else if (gustRatio >= 0.75) windScore = 16;
  else if (gustRatio >= 0.6)  windScore = 8;
  else if (gustRatio >= 0.45) windScore = 3;

  // Wave score — identical to calcHourlyRisk
  let waveScore = 0;
  let waveReason = 'No wave data — estimated from wind';
  if (waveM !== null && waveM !== undefined) {
    const swellH = hm ? ((hm.swell_wave_height || [])[h] || 0) : 0;
    const wavePeriod = hm ? ((hm.wave_period || [])[h] || 8) : 8;
    const periodFactor = wavePeriod > 12 ? 1.3 : wavePeriod > 8 ? 1.1 : 1.0;
    const effectiveWave = Math.max(waveM, swellH * 0.8) * periodFactor;
    const waveThreshold = profile.exposure === 1 ? 3.0 : profile.exposure === 2 ? 2.5 : profile.exposure === 3 ? 2.0 : 1.5;
    const waveRatio = effectiveWave / waveThreshold;
    waveReason = waveM.toFixed(1) + 'm waves (threshold ' + waveThreshold + 'm for this route)';
    if      (waveRatio >= 1.2) waveScore = 30;
    else if (waveRatio >= 1.0) waveScore = 22;
    else if (waveRatio >= 0.8) waveScore = 14;
    else if (waveRatio >= 0.6) waveScore = 7;
    else if (waveRatio >= 0.4) waveScore = 2;
  } else {
    const est = (wind * 0.04) * profile.exposure;
    if      (est > 2.5) { waveScore = 15; waveReason = 'Estimated ~' + est.toFixed(1) + 'm from wind speed'; }
    else if (est > 1.5) { waveScore = 8;  waveReason = 'Estimated ~' + est.toFixed(1) + 'm from wind speed'; }
    else if (est > 1.0) { waveScore = 3;  waveReason = 'Estimated ~' + est.toFixed(1) + 'm from wind speed'; }
    else                { waveReason = 'Calm — estimated ~' + est.toFixed(1) + 'm'; }
  }

  // Visibility score — identical to calcHourlyRisk
  let visScore = 0;
  let visReason = 'Good visibility';
  if (vis !== null && vis !== undefined) {
    if      (vis < 500)  { visScore = 15; visReason = vis + 'm — dense fog, serious risk'; }
    else if (vis < 1000) { visScore = 10; visReason = vis + 'm — poor visibility'; }
    else if (vis < 3000) { visScore = 5;  visReason = (vis/1000).toFixed(1) + 'km — reduced visibility'; }
    else if (vis < 5000) { visScore = 2;  visReason = (vis/1000).toFixed(1) + 'km — slightly hazy'; }
    else                 { visReason = (vis/1000).toFixed(0) + 'km+ — clear'; }
  }

  // Precipitation — identical to calcHourlyRisk
  let precipScore = 0;
  let precipReason = 'No significant precipitation';
  if      (snow > 2  || code >= 71) { precipScore = 10; precipReason = snow > 0 ? snow.toFixed(1) + 'cm snow forecast' : 'Heavy snow/wintry showers'; }
  else if (snow > 0.5 || code >= 61) { precipScore = 4; precipReason = 'Rain or light snow expected'; }
  else if (code >= 51)               { precipScore = 1; precipReason = 'Drizzle expected'; }

  // Tidal — identical to calcHourlyRisk
  const tidalScore  = isTidal ? 3 : 0;
  const tidalReason = isTidal ? 'This route has known tidal restrictions that can cause cancellations' : 'No tidal restrictions on this route';

  // Season — for display only (already baked into effThreshold)
  const seasonScore = season < 1.0 ? Math.round((1 - season) * 30) : 0;
  const seasonReason = season < 0.9
    ? 'Winter — thresholds reduced by 15% (winds cancel sailings at lower speeds)'
    : season < 1.0 ? 'Shoulder season — thresholds slightly reduced'
    : 'Summer — standard thresholds apply';

  // ── SINGLE SOURCE OF TRUTH for percentage ──
  // Read from the cache written by buildCard() — guaranteed same value as card row
  const cacheKey = sailingTime ? r.name + '|' + sailingTime : null;
  const cached = cacheKey ? sailingChanceCache[cacheKey] : null;
  const totalRisk = r.hourlyData
    ? calcHourlyRisk(r.name, h, hw, hm)
    : (r.risk || 0);
  const chance = cached !== undefined && cached !== null
    ? cached
    : sailingTime
      ? sailingChance(calcHourlyRisk(r.name, h, r.hourlyData || {}, r.marineData || null), r.name)
      : sailingChance(r.risk || 0, r.name);
  const colour = chanceColor(chance);

  // Verdict text
  const verdictText = chance >= 75
    ? 'This route looks good to go based on current forecasts.'
    : chance >= 45
    ? 'Conditions are borderline. CalMac may reduce service or cancel some sailings.'
    : 'High risk of disruption or cancellation based on forecast conditions.';

  // Exposure labels
  const exposureLabels = ['', 'Sheltered waters', 'Moderate exposure', 'Exposed crossing', 'Very exposed'];

  // CalMac live disruption info for this route (and specific sailing)
  const disruption = liveDisruptions[r.name];
  const sailingStatuses = statusesForDay(disruption, modalTomorrow);
  const sailingInfo = sailingTime
    ? sailingStatusFor(sailingStatuses, sailingTime, sailings.find(x => x.t === sailingTime)?.f)
    : (sailingStatuses['*'] || Object.values(sailingStatuses)[0] || null);
  const sailingIsCancelled = sailingInfo?.status === 'cancelled';
  const sailingIsDisrupted = sailingInfo?.status === 'disrupted' || sailingInfo?.status === 'amber';

  // Disruption block HTML
  const disruptionBlockHtml = sailingInfo ? (() => {
    const bg    = sailingIsCancelled ? '#fceaed' : '#fff8e1';
    const bdr   = sailingIsCancelled ? '#ffcdd2' : '#ffe082';
    const col   = sailingIsCancelled ? '#c62828' : '#e65100';
    const icon  = sailingIsCancelled ? '🚨' : '⚠️';
    // Reason-specific icons
    const reasonIcons = { Weather: '🌊', Technical: '🔧', Operational: '🛳️', Tidal: '🌊', Other: 'ℹ️' };
    const reasonIcon = sailingInfo.reason ? (reasonIcons[sailingInfo.reason] || 'ℹ️') : '';
    const title = sailingIsCancelled
      ? `Cancelled — ${sailingInfo.reason || 'CalMac advisory'}`
      : sailingInfo.status === 'amber'
        ? 'Be Aware — CalMac advisory'
        : `Disrupted — ${sailingInfo.reason || 'CalMac advisory'}`;
    const detail = linkifyDetail((sailingInfo.detail || '').trim());
    const reason = sailingInfo.reason ? `<div style="font-size:.75rem;color:${col};margin-top:6px;opacity:.85">${reasonIcon} Reason: <strong>${sailingInfo.reason}</strong></div>` : '';
    return `<div style="background:${bg};border:1.5px solid ${bdr};border-radius:10px;padding:12px 14px;margin-bottom:16px">
      <div style="font-weight:700;color:${col};font-size:.9rem;margin-bottom:4px">${icon} ${title}</div>
      <div class="calmac-detail" style="font-size:.82rem;color:${col};line-height:1.55">${detail}</div>
      ${reason}
    </div>`;
  })() : '';

  // ── Risk level helper — returns { label, cls, barPct, barColor } ──
  function riskLevel(ratio) {
    if (ratio <= 0)    return { label: 'Safe',     cls: 'safe',     barPct: 0,                    barColor: 'var(--green)' };
    if (ratio < 0.45)  return { label: 'Low',      cls: 'low',      barPct: Math.round(ratio*100), barColor: '#4ade80' };
    if (ratio < 0.75)  return { label: 'Moderate', cls: 'notable',  barPct: Math.round(ratio*100), barColor: 'var(--amber)' };
    if (ratio < 1.0)   return { label: 'High',     cls: 'high',     barPct: Math.round(ratio*100), barColor: '#f97316' };
    return               { label: 'Critical', cls: 'critical', barPct: 100,                   barColor: 'var(--red)' };
  }

  // Wind
  const windLevel = riskLevel(gustRatio);
  const windReason = !hasWindData
    ? 'No wind data for this hour'
    : gust < 1
      ? 'Calm at departure time'
      : Math.round(gust) + ' mph gusts · ' + Math.round(wind) + ' mph sustained · threshold ~' + Math.round(effThreshold) + ' mph';

  // Wave — bar ratio based on waveRatio (already computed above)
  let waveRatio2 = 0;
  if (waveM !== null && waveM !== undefined) {
    const swellH2 = hm ? ((hm.swell_wave_height || [])[h] || 0) : 0;
    const wavePeriod2 = hm ? ((hm.wave_period || [])[h] || 8) : 8;
    const pf2 = wavePeriod2 > 12 ? 1.3 : wavePeriod2 > 8 ? 1.1 : 1.0;
    const wt2 = profile.exposure === 1 ? 3.0 : profile.exposure === 2 ? 2.5 : profile.exposure === 3 ? 2.0 : 1.5;
    waveRatio2 = Math.max(waveM, swellH2 * 0.8) * pf2 / wt2;
  }
  const waveLevel = riskLevel(waveRatio2);

  // Visibility
  const visRatio = vis == null ? 0 : vis < 500 ? 1.2 : vis < 1000 ? 0.9 : vis < 3000 ? 0.6 : vis < 5000 ? 0.3 : 0;
  const visLevel = riskLevel(visRatio);

  // Precipitation
  const precipRatio = (snow > 2 || code >= 71) ? 1.2 : (snow > 0.5 || code >= 61) ? 0.75 : (code >= 51) ? 0.35 : 0;
  const precipLevel = riskLevel(precipRatio);

  // Season
  const seasonRatio = season < 0.85 ? 0.8 : season < 1.0 ? 0.4 : 0;
  const seasonLevel = riskLevel(seasonRatio);

  // Tidal
  const tidalLevel = riskLevel(isTidal ? 0.35 : 0);

  // Build rows — always show Wind & Wave; show others only if not Safe
  const scoreRows = [
    { icon:'💨', name:'Wind & Gusts',  reason: windReason,   level: windLevel,   always: true  },
    { icon:'🌊', name:'Wave Height',   reason: waveReason,   level: waveLevel,   always: true  },
    { icon:'🌫', name:'Visibility',    reason: visReason,    level: visLevel,    always: false },
    { icon:'🌧', name:'Precipitation', reason: precipReason, level: precipLevel, always: false },
    { icon:'📅', name:'Season',        reason: seasonReason, level: seasonLevel, always: false },
    { icon:'🌊', name:'Tidal Factors', reason: tidalReason,  level: tidalLevel,  always: false },
  ].filter(row => row.always || row.level.cls !== 'safe');

  // SVG ring
  const r2 = 36, cx = 45, cy = 45, circ = 2 * Math.PI * r2;
  const dash = ((100 - chance) / 100) * circ;

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-header">
      <div class="modal-route-name">${sailingTime ? sailingTime + ' · ' + r.name : r.name}</div>
      <div class="modal-subtitle">${(() => { const s = sailingTime ? sailings.find(x=>x.t===sailingTime) : null; return s ? s.f + ' → ' + s.to + ' · ' : ''; })()}${exposureLabels[profile.exposure] || ''} · Threshold ~${Math.round(effThreshold)} mph gusts</div>
    </div>
    <div class="modal-body">

      ${disruptionBlockHtml}

      <div class="modal-hero">
        <div class="chance-ring">
          <svg width="90" height="90" viewBox="0 0 90 90">
            <circle cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke="var(--light)" stroke-width="8"/>
            <circle cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke="${colour}" stroke-width="8"
              stroke-dasharray="${circ}" stroke-dashoffset="${dash}"
              stroke-linecap="round" style="transition:stroke-dashoffset .6s ease"/>
          </svg>
          <div class="chance-ring-num" style="color:${colour}">${chance}%</div>
        </div>
        <div class="modal-verdict">
          <div class="modal-verdict-label" style="color:${colour}">${chance >= 75 ? '✅ Likely to sail' : chance >= 45 ? '⚠️ Caution advised' : '❌ At risk'}</div>
          <div class="modal-verdict-desc">${verdictText}</div>
        </div>
      </div>

      <div class="breakdown-title">Conditions</div>
      ${scoreRows.map(row => `
        <div class="breakdown-row">
          <div class="br-icon">${row.icon}</div>
          <div class="br-info">
            <div class="br-name">${row.name}</div>
            <div class="br-reason">${row.reason}</div>
            <div class="br-bar"><div class="br-bar-fill" style="width:${row.level.barPct}%;background:${row.level.barColor}"></div></div>
          </div>
          <div class="br-level ${row.level.cls}">${row.level.barPct}%</div>
        </div>
      `).join('')}

      <div class="breakdown-total">
        <div>
          <div class="bt-label">Sailing chance</div>
          <div style="font-size:.72rem;opacity:.6;margin-top:2px">Based on weather forecast</div>
        </div>
        <div class="bt-chance">${chance}%</div>
      </div>

      <div class="profile-pills">
        <span class="profile-pill">📍 ${exposureLabels[profile.exposure]||'Standard'}</span>
        <span class="profile-pill">💨 Threshold ~${Math.round(effThreshold)} mph</span>
        ${r.hasMarine ? '<span class="profile-pill">🌊 Live wave data</span>' : '<span class="profile-pill">🌊 Wave estimated</span>'}
        ${isTidal ? '<span class="profile-pill">🌊 Tidal route</span>' : ''}
        <span class="profile-pill">📅 ${season < 0.9 ? 'Winter mode' : season < 1.0 ? 'Shoulder season' : 'Summer mode'}</span>
      </div>

      <a class="modal-calmac-link" href="https://www.calmac.co.uk/service-status" target="_blank" rel="noopener">
        🚢 Check CalMac's official status page
      </a>
    </div>
  `;

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// Close on overlay click
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});

// ── CALMAC NOTICES (card banners + popup) ──
function routeNotices(routeName) {
  return topNotices(liveDisruptions[routeName]);
}

function openTimetableNotice(routeName, idx = 0) {
  const notice = routeNotices(routeName)[idx];
  if (!notice) return;
  document.getElementById('tnTitle').textContent = notice.title || 'Service notice';
  document.getElementById('tnBody').innerHTML = linkifyDetail(notice.detail) || '<em style="opacity:.6">No further detail provided.</em>';
  document.getElementById('tnOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeTimetableNotice() {
  document.getElementById('tnOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
document.getElementById('tnOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('tnOverlay')) closeTimetableNotice();
});
// Swipe down to close
let _tnTouchY = 0;
document.querySelector('#tnOverlay .tn-popup').addEventListener('touchstart', e => { _tnTouchY = e.touches[0].clientY; }, { passive: true });
document.querySelector('#tnOverlay .tn-popup').addEventListener('touchend', e => {
  if (e.changedTouches[0].clientY - _tnTouchY > 60 && document.querySelector('#tnOverlay .tn-popup').scrollTop === 0) closeTimetableNotice();
}, { passive: true });

// Close on swipe down
let touchStartY = 0;
document.getElementById('modalContent').addEventListener('touchstart', e => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });
document.getElementById('modalContent').addEventListener('touchend', e => {
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (dy > 60 && document.getElementById('modalContent').scrollTop === 0) closeModal();
}, { passive: true });

// Card click → no longer opens a modal (sailings rows handle that)
function attachCardClicks(container) {
  // Intentionally empty — modal is opened by clicking individual sailing rows
}




// ── ABOUT TAB STATS ──
let aboutStatsLoaded = false;
async function loadAboutStats() {
  if (aboutStatsLoaded) return;
  try {
    const res = await fetch(`${SHEET_SCRIPT_URL}?action=getStats`);
    const json = await res.json();
    if (json.reliability_months !== undefined) {
      document.getElementById('stat-months').textContent  = json.reliability_months;
      document.getElementById('stat-routes').textContent  = json.routes_calibrated;
      document.getElementById('stat-reports').textContent = json.user_reports;
      aboutStatsLoaded = true;
    }
  } catch(_) {
    // Sheet unavailable — leave dashes
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ── SERVICE WORKER REGISTRATION ──
// ─────────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Listen for messages from SW (e.g. navigate to route from notification)
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'NAVIGATE' && e.data.url) {
      const hash = new URL(e.data.url, location.href).hash;
      if (hash.startsWith('#route=')) {
        const route = decodeURIComponent(hash.replace('#route=', ''));
        openModal(route);
      }
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
  }
}
parseShareLink();

function handleShareDeepLink() {
  if (!window._shareRoute) return;
  const route = window._shareRoute;
  const from  = window._shareFrom;

  // Show the share banner
  const banner = document.getElementById('shareBanner');
  const text   = document.getElementById('shareBannerText');
  if (banner && text) {
    text.textContent = from
      ? `${from} shared "${route}" with you 🚢`
      : `Someone shared "${route}" with you 🚢`;
    banner.style.display = 'flex';
  }

  // Open the route modal
  setTimeout(() => openModal(route, window._shareSailing || null), 400);

  // Clean URL without reloading
  history.replaceState(null, '', location.pathname);
}

// ─────────────────────────────────────────────────────────────────────────
// ── SHARE BUTTON ──
// ─────────────────────────────────────────────────────────────────────────
function shareRoute(routeName, sailing) {
  // Show a non-blocking name picker so we don't break the iOS gesture chain
  // We collect the name first, then call share directly from the button tap
  const existing = document.getElementById('shareNamePicker');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.id = 'shareNamePicker';
  picker.style.cssText = `position:fixed;bottom:calc(80px + env(safe-area-inset-bottom));left:12px;right:12px;
    z-index:1000;background:var(--white);border-radius:16px;padding:16px;
    box-shadow:0 8px 40px rgba(0,48,135,0.2);`;
  picker.innerHTML = `
    <div style="font-size:.85rem;font-weight:700;color:var(--navy);margin-bottom:10px">Share this route</div>
    <input id="shareNameInput" type="text" placeholder="Your name (optional)"
      style="width:100%;padding:9px 12px;border:1.5px solid var(--light);border-radius:10px;
      font-family:inherit;font-size:.88rem;box-sizing:border-box;margin-bottom:10px;outline:none"/>
    <div style="display:flex;gap:8px">
      <button onclick="document.getElementById('shareNamePicker').remove()"
        style="flex:1;padding:9px;border-radius:10px;border:1.5px solid var(--light);
        background:var(--white);font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer">
        Cancel
      </button>
      <button id="shareConfirmBtn"
        style="flex:1;padding:9px;border-radius:10px;border:none;background:var(--blue);
        color:#fff;font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer">
        Share
      </button>
    </div>`;
  document.body.appendChild(picker);
  setTimeout(() => document.getElementById('shareNameInput')?.focus(), 50);

  // Dismiss on outside tap
  setTimeout(() => {
    document.addEventListener('click', function dismiss(e) {
      if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', dismiss); }
    });
  }, 100);

  document.getElementById('shareConfirmBtn').addEventListener('click', () => {
    const name = (document.getElementById('shareNameInput')?.value || '').trim();
    picker.remove();

    const params = new URLSearchParams({ route: routeName });
    if (sailing)   params.set('sailing', sailing);
    if (name)      params.set('from', name);

    const url   = `${location.origin}${location.pathname}?${params}`;
    const title = `Will It Sail? — ${routeName}`;
    const text  = name ? `${name} shared a CalMac route with you` : `Check this CalMac route on Will It Sail?`;

    if (navigator.share) {
      navigator.share({ title, text, url }).catch(() => {
        // Fallback to clipboard if share fails
        _copyToClipboard(url);
      });
    } else {
      _copyToClipboard(url);
    }
  });
}

function _copyToClipboard(url) {
  navigator.clipboard.writeText(url).then(() => {
    const toast = document.getElementById('shareToast');
    toast.textContent = '✅ Link copied!';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }).catch(() => {
    // Last resort — show the URL in a selectable input
    const t = document.getElementById('shareToast');
    t.textContent = '📋 Copy: ' + url.slice(0, 40) + '…';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 4000);
  });
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
async function toggleRouteNotification(routeName, btn) {
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

    // Check if already subscribed for this route
    const notifiedRoutes = JSON.parse(localStorage.getItem('notifRoutes') || '[]');
    const isOn = notifiedRoutes.includes(routeName);

    if (isOn) {
      // Unsubscribe for this route
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unsubscribe', route: routeName, endpoint: sub?.endpoint }),
      });
      const updated = notifiedRoutes.filter(r => r !== routeName);
      localStorage.setItem('notifRoutes', JSON.stringify(updated));
      btn.classList.remove('notif-on');
      btn.title = 'Get notified when this route drops below 70%';
      btn.querySelector('span').textContent = '🔔';
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
      notifiedRoutes.push(routeName);
      localStorage.setItem('notifRoutes', JSON.stringify(notifiedRoutes));
      btn.classList.add('notif-on');
      btn.title = 'Notifications on — tap to turn off';
      btn.querySelector('span').textContent = '🔔';
    }
  } catch (err) {
    console.warn('Push toggle error:', err);
  }
}

function isRouteNotified(routeName) {
  const routes = JSON.parse(localStorage.getItem('notifRoutes') || '[]');
  return routes.includes(routeName);
}

// ─────────────────────────────────────────────────────────────────────────
// ── TEST NOTIFICATION ──
// ─────────────────────────────────────────────────────────────────────────
async function testNotification() {
  const btn    = document.getElementById('testNotifBtn');
  const status = document.getElementById('testNotifStatus');

  function setStatus(msg, color) {
    status.textContent = msg;
    status.style.color = color || 'var(--muted)';
    status.style.display = 'block';
  }

  // Check basic support
  if (!('Notification' in window)) {
    setStatus('❌ This browser does not support notifications.', 'var(--red)');
    return;
  }
  if (!('serviceWorker' in navigator)) {
    setStatus('❌ Service workers not supported — try adding the app to your home screen on iOS.', 'var(--red)');
    return;
  }

  btn.disabled = true;
  btn.style.opacity = '0.6';
  setStatus('Requesting permission…', 'var(--muted)');

  // Request permission if not already granted
  if (Notification.permission === 'denied') {
    setStatus('❌ Notifications are blocked. Open your browser settings and allow notifications for this site, then try again.', 'var(--red)');
    btn.disabled = false; btn.style.opacity = '1';
    return;
  }

  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      setStatus("❌ Permission denied — notifications won't work until you allow them.", 'var(--red)');
      btn.disabled = false; btn.style.opacity = '1';
      return;
    }
  }

  setStatus('Sending test notification…', 'var(--muted)');

  try {
    const reg = await navigator.serviceWorker.ready;

    // Use the service worker to show the notification
    // (required on iOS — direct Notification() doesn't work from SW context)
    await reg.showNotification('🚢 Will It Sail? — Test', {
      body: "Notifications are working! You'll receive alerts like this when a starred route drops below 70%.",
      icon: '/icon-120.png',
      badge: '/icon-120.png',
      tag: 'test-notification',
      data: { url: location.href },
      actions: [
        { action: 'view', title: 'View app' },
      ],
    });

    setStatus('✅ Test notification sent! Check your notifications.', 'var(--green)');
  } catch (err) {
    // Fall back to basic Notification API if SW showNotification fails
    try {
      new Notification('🚢 Will It Sail? — Test', {
        body: "Notifications are working! You'll receive alerts when a starred route drops below 70%.",
        icon: '/icon-120.png',
      });
      setStatus('✅ Test notification sent!', 'var(--green)');
    } catch (err2) {
      setStatus(`❌ Failed: ${err2.message}. On iOS, make sure the app is added to your home screen.`, 'var(--red)');
    }
  }

  btn.disabled = false;
  btn.style.opacity = '1';
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
    lastDisruptionFetch = new Date();
    // Re-render so sailing rows reflect live CalMac status
    if (Object.keys(liveDisruptions).length > 0 && allRoutes.length > 0) {
      renderRoutes();
    }
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────
// ── VESSEL TRACKER ──
// ─────────────────────────────────────────────────────────────────────────
function openVesselTracker(routeName, vesselName, mmsi) {
  const ports = ROUTE_PORTS[routeName];
  const midLat = ports ? ((ports.a[0] + ports.b[0]) / 2).toFixed(4) : '57.0';
  const midLon = ports ? ((ports.a[1] + ports.b[1]) / 2).toFixed(4) : '-5.5';
  const zoom   = ports ? 10 : 8;

  document.getElementById('vtVesselName').textContent = vesselName || 'Vessel Tracker';
  document.getElementById('vtRouteName').textContent  = routeName  || '';
  document.getElementById('vtStatus').textContent     = '🟢 Live AIS via MarineTraffic';

  const mtLink = document.getElementById('vtMTLink');
  if (mmsi) {
    mtLink.href          = `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}`;
    mtLink.style.display = '';
  } else {
    mtLink.style.display = 'none';
  }

  // MarineTraffic embed centred on route midpoint — vessel visible in area with live AIS icons
  const embedUrl = `https://www.marinetraffic.com/en/ais/embed/zoom:${zoom}/centery:${midLat}/centerx:${midLon}/maptype:0/shownames:false/mmsi:${mmsi || 0}/shipid:0/fleet:/fleet_id:/vtypes:/showmenu:/remember:false`;

  document.getElementById('vtOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Small delay so overlay transition starts before the iframe begins loading
  setTimeout(() => { document.getElementById('vtFrame').src = embedUrl; }, 80);
}

function closeVesselTracker() {
  document.getElementById('vtOverlay').classList.remove('open');
  document.body.style.overflow = '';
  // Reset iframe so it doesn't keep running in background
  setTimeout(() => { document.getElementById('vtFrame').src = 'about:blank'; }, 300);
}

document.getElementById('vtOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('vtOverlay')) closeVesselTracker();
});

// ─────────────────────────────────────────────────────────────────────────
// ── VESSEL LOOKUP ──
// ─────────────────────────────────────────────────────────────────────────
const vesselCache = {};

async function getVesselForRoute(routeName) {
  if (vesselCache[routeName]) return vesselCache[routeName];
  try {
    const res = await fetch(`/api/vessel?route=${encodeURIComponent(routeName)}`);
    const data = await res.json();
    vesselCache[routeName] = data;
    return data;
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ── CARD ACTION ROW BUILDER ──
// Appended to every route card — share + notification bell
// ─────────────────────────────────────────────────────────────────────────
function buildCardActions(routeName) {
  const notifOn = isRouteNotified(routeName);
  const threshold = getNotifThreshold(routeName);
  const bellTitle = notifOn ? `Alerts on (below ${threshold}%) — tap to turn off` : 'Get notified if sailing chance drops';
  const hasTomorrow = allRoutes.find(r => r.name === routeName)?.tomorrow?.maxGustMph !== null;
  return `
    <div class="card-actions">
      <button class="card-action-btn share-btn" data-route="${routeName}" title="Share this route">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        <span>Share</span>
      </button>
      <button class="card-action-btn notif-btn${notifOn ? ' notif-on' : ''}" data-route="${routeName}" title="${bellTitle}">
        <span>🔔</span>
        <span>${notifOn ? `Alerts <${threshold}%` : 'Alert me'}</span>
      </button>
    </div>`;
}

// Wire up card action buttons (called after render)
function attachCardActions(container) {
  container.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      shareRoute(btn.dataset.route);
    });
  });

  container.querySelectorAll('.notif-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const routeName = btn.dataset.route;
      const isOn = isRouteNotified(routeName);
      if (isOn) {
        // Already on — long-press would set threshold, single tap turns off
        // Check if they held for >500ms (threshold edit) vs quick tap (toggle off)
        toggleRouteNotification(routeName, btn);
        return;
      }
      // Show threshold picker before subscribing
      showThresholdPicker(routeName, btn);
    });
  });
}

// ── SMART NOTIFICATION THRESHOLD ──
function getNotifThreshold(routeName) {
  const thresholds = JSON.parse(localStorage.getItem('notifThresholds') || '{}');
  return thresholds[routeName] || 70;
}
function setNotifThreshold(routeName, value) {
  const thresholds = JSON.parse(localStorage.getItem('notifThresholds') || '{}');
  thresholds[routeName] = value;
  localStorage.setItem('notifThresholds', JSON.stringify(thresholds));
}

function showThresholdPicker(routeName, btn) {
  // Remove any existing picker
  document.querySelectorAll('.threshold-picker').forEach(p => p.remove());

  const current = getNotifThreshold(routeName);
  const picker = document.createElement('div');
  picker.className = 'threshold-picker';
  picker.style.cssText = `
    position:fixed;bottom:calc(80px + env(safe-area-inset-bottom) + 8px);left:50%;transform:translateX(-50%);
    background:var(--white);border-radius:16px;box-shadow:0 8px 40px rgba(0,48,135,0.18);
    padding:18px 20px;z-index:900;width:min(320px,90vw);
  `;
  picker.innerHTML = `
    <div style="font-weight:700;font-size:.9rem;color:var(--navy);margin-bottom:4px">Alert threshold for</div>
    <div style="font-size:.8rem;color:var(--muted);margin-bottom:14px">${routeName}</div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <span style="font-size:.8rem;color:var(--muted)">Always</span>
      <input type="range" min="30" max="90" step="5" value="${current}" id="threshSlider" style="flex:1;accent-color:var(--blue)">
      <span style="font-size:.8rem;color:var(--muted)">Never</span>
    </div>
    <div style="text-align:center;font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;color:var(--blue);margin-bottom:16px" id="threshVal">Below <span id="threshNum">${current}</span>%</div>
    <div style="display:flex;gap:8px">
      <button onclick="document.querySelector('.threshold-picker').remove()" style="flex:1;padding:10px;border-radius:10px;border:1.5px solid var(--light);background:var(--white);font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer">Cancel</button>
      <button id="threshConfirm" style="flex:1;padding:10px;border-radius:10px;border:none;background:var(--blue);color:#fff;font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer">Enable alerts</button>
    </div>
  `;
  document.body.appendChild(picker);

  const slider = picker.querySelector('#threshSlider');
  const numEl = picker.querySelector('#threshNum');
  slider.addEventListener('input', () => { numEl.textContent = slider.value; });

  picker.querySelector('#threshConfirm').addEventListener('click', async () => {
    const val = parseInt(slider.value);
    setNotifThreshold(routeName, val);
    picker.remove();
    // Now proceed with subscription
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
    toggleRouteNotification(routeName, btn);
  });

  // Dismiss on outside tap
  setTimeout(() => {
    document.addEventListener('click', function dismiss(e) {
      if (!picker.contains(e.target) && e.target !== btn) {
        picker.remove();
        document.removeEventListener('click', dismiss);
      }
    });
  }, 100);
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
  if (activeTab === 'tabFavs') renderFavourites();
}


// ─────────────────────────────────────────────────────────────────────────
// ── MODAL: ADD VESSEL + ROUTE INFO ──
// ─────────────────────────────────────────────────────────────────────────
async function enrichModalWithVessel(routeName) {
  const info = ROUTE_INFO[routeName] || {};
  const infoGrid = document.getElementById('modalRouteInfoGrid');
  const vesselEl = document.getElementById('modalVesselChip');
  if (!infoGrid || !vesselEl) return;

  // Static info grid
  infoGrid.innerHTML = `
    ${info.crossing ? `<div class="ri-item"><div class="ri-label">Crossing time</div><div class="ri-value">${info.crossing}</div></div>` : ''}
    ${info.type     ? `<div class="ri-item"><div class="ri-label">Service type</div><div class="ri-value">${info.type}</div></div>` : ''}
    ${info.note     ? `<div class="ri-item" style="grid-column:1/-1"><div class="ri-label">Note</div><div class="ri-value" style="font-weight:400;font-size:.82rem;color:var(--muted)">${info.note}</div></div>` : ''}
  `;

  // Live vessel chip — show scheduled while AIS loads
  const scheduledVessel = info.vessel || 'Unknown';
  vesselEl.innerHTML = `<span class="vessel-chip scheduled">🚢 ${scheduledVessel}</span>`;

  // Fetch live AIS data
  const aisData = await getVesselForRoute(routeName);
  if (aisData?.vessel) {
    const v      = aisData.vessel;
    const isLive = !v.scheduled;
    const speed  = isLive && v.speed != null && v.speed > 0.5 ? ` · ${v.speed.toFixed(1)} kn` : '';
    const label  = isLive ? `(live${speed})` : '(scheduled)';
    const mmsiJs  = v.mmsi || 'null';
    const nameJs  = (v.name || 'Vessel').replace(/'/g, "\\'");
    const routeJs = routeName.replace(/'/g, "\\'");
    vesselEl.innerHTML = `
      <span class="vessel-chip scheduled" style="cursor:pointer" onclick="openVesselTracker('${routeJs}','${nameJs}',${mmsiJs})">
        🚢 ${v.name} <small style="opacity:.7">${label}</small>
        <small style="color:var(--blue);margin-left:6px">📍 Track live →</small>
      </span>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ── MY TRIP MODAL ──
// ─────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────
// ── FORECAST ACCURACY TRACKER ──
// Stores prediction vs reality, surfaces on About tab
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// ── PATCH: renderRoutes — inject card-actions after each card ──
// ─────────────────────────────────────────────────────────────────────────
// Hook into the grid render to add card actions
function postRenderHook(container) {
  // Add card-actions to every card that doesn't already have one
  container.querySelectorAll('.route-card:not([data-actions])').forEach(card => {
    const routeName = card.querySelector('.fav-btn')?.dataset.route;
    if (!routeName) return;
    card.setAttribute('data-actions', '1');
    const actionsHtml = buildCardActions(routeName);
    card.insertAdjacentHTML('beforeend', actionsHtml);
  });
  attachCardClicks(container);
  attachCardActions(container);
}

// ─────────────────────────────────────────────────────────────────────────
// ── PATCH MODAL: add vessel chip + route info grid ──
// ─────────────────────────────────────────────────────────────────────────
const _origOpenModal = openModal;
window.openModal = function(routeName, sailingTime) {
  _origOpenModal(routeName, sailingTime);
  // After modal content is injected, add vessel chip and route info grid
  setTimeout(() => {
    const body = document.getElementById('modalContent')?.querySelector('.modal-body');
    if (!body) return;

    // Add vessel + route info section after profile pills if not already present
    if (!document.getElementById('modalRouteInfoGrid')) {
      const pills = body.querySelector('.profile-pills');
      if (pills) {
        const infoSection = document.createElement('div');
        infoSection.innerHTML = `
          <div class="breakdown-title" style="margin-top:16px">Route details</div>
          <div id="modalVesselChip" style="margin-bottom:8px"></div>
          <div class="route-info-grid" id="modalRouteInfoGrid"></div>`;
        pills.insertAdjacentElement('afterend', infoSection);
      }
    }

    // Add share button to modal if not present
    if (!document.getElementById('modalShareBtn')) {
      const calmacLink = body.querySelector('.modal-calmac-link');
      if (calmacLink) {
        const shareDiv = document.createElement('div');
        shareDiv.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
        shareDiv.innerHTML = `
          <button id="modalShareBtn" class="modal-calmac-link" style="flex:1;background:var(--offwhite);color:var(--navy);border:1.5px solid var(--light);" onclick="shareRoute('${routeName.replace(/'/g,"\'")}'${sailingTime ? ",'" + sailingTime + "'" : ''})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share
          </button>`;
        calmacLink.insertAdjacentElement('beforebegin', shareDiv);
      }
    }

    enrichModalWithVessel(routeName);
  }, 50);
};


// ── HOOK POST-RENDER ──
// ─────────────────────────────────────────────────────────────────────────
// We need to call postRenderHook after renderRoutes. 
// The simplest approach: wrap the existing renderRoutes function.
// Next.js loads this script after the document is parsed, so DOMContentLoaded
// has usually fired already; run on the next tick in that case.
const onDomReady = fn => document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', fn)
  : setTimeout(fn, 0);

onDomReady(() => {
  // Observe routesGrid and favsGrid for new cards
  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      if (m.addedNodes.length) {
        const container = m.target;
        postRenderHook(container);
      }
    });
  });
  const grids = ['routesGrid', 'favsGrid'];
  grids.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { childList: true });
  });
});

// Also hook tab switches
const _origTabSwitch = document.querySelector ? null : null;
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === 'tabAbout') {
      
    }
    if (tab === 'tabRoutes' || tab === 'tabFavs') {
      setTimeout(() => {
        const grid = document.getElementById(tab === 'tabRoutes' ? 'routesGrid' : 'favsGrid');
        if (grid) postRenderHook(grid);
      }, 100);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ── STATUS PAGE ──
// ─────────────────────────────────────────────────────────────────────────
async function runStatusCheck() {
  const container = document.getElementById('statusItems');
  const lastEl    = document.getElementById('statusLastChecked');
  if (!container) return;

  // Show loading state
  container.innerHTML = [
    'Weather API', 'Marine/Wave API', 'CalMac Status API',
    'Push Notifications', 'Service Worker', 'Historical Data'
  ].map(name => `
    <div class="status-item">
      <div class="status-dot grey"></div>
      <div class="status-info"><div class="status-name">${name}</div><div class="status-detail">Checking…</div></div>
      <div class="status-badge grey">–</div>
    </div>`).join('');

  const results = [];

  // ── 1. Weather API ──
  try {
    const t0 = Date.now();
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=57.0&longitude=-5.8&hourly=windspeed_10m&forecast_days=1', { signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - t0;
    const routesLoaded = allRoutes.filter(rt => rt.maxGustMph !== null && rt.maxGustMph !== undefined).length;
    if (!r.ok) {
      results.push({ name:'Weather API', icon:'🌤', dot:'red', badge:'err', badgeText:'✗ Error', detail:`HTTP ${r.status} — weather data unavailable` });
    } else if (routesLoaded === 0) {
      results.push({ name:'Weather API', icon:'🌤', dot:'amber', badge:'warn', badgeText:'⚠ No data', detail:`Open-Meteo responding (${ms}ms) — app data failed to load, try refreshing` });
    } else {
      results.push({ name:'Weather API', icon:'🌤', dot:'green', badge:'ok', badgeText:'✓ OK', detail:`Open-Meteo responding (${ms}ms) · ${routesLoaded}/22 routes loaded` });
    }
  } catch(e) {
    results.push({ name:'Weather API', icon:'🌤', dot:'red', badge:'err', badgeText:'✗ Error', detail: e.message });
  }

  // ── 2. Marine/Wave API ──
  try {
    const t0 = Date.now();
    const r = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=57.0&longitude=-5.8&hourly=wave_height&forecast_days=1', { signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - t0;
    const marineCount = allRoutes.filter(rt => rt.hasMarine).length;
    results.push({
      name: 'Marine / Wave API',
      icon: '🌊',
      dot: r.ok ? 'green' : 'amber',
      badge: r.ok ? 'ok' : 'warn',
      badgeText: r.ok ? '✓ OK' : '⚠ Degraded',
      detail: r.ok
        ? `Open-Meteo Marine responding (${ms}ms) · ${marineCount}/22 routes have wave data`
        : `HTTP ${r.status} — wave predictions estimated from wind`
    });
  } catch(e) {
    results.push({ name:'Marine / Wave API', icon:'🌊', dot:'amber', badge:'warn', badgeText:'⚠ Degraded', detail:'Unavailable — wave risk estimated from wind' });
  }

  // ── 3. CalMac Status API ──
  try {
    const t0 = Date.now();
    const r = await fetch('/api/status', { signal: AbortSignal.timeout(10000) });
    const ms = Date.now() - t0;
    const data = await r.json();
    const isFallback = data.fallback === true;
    const routeCount = data.routes?.length || 0;
    const disruptedCount = data.disrupted?.length || 0;
    results.push({
      name: 'CalMac Status API',
      icon: '🚨',
      dot: isFallback ? 'red' : 'green',
      badge: isFallback ? 'err' : 'ok',
      badgeText: isFallback ? '✗ Fallback' : '✓ Live',
      detail: isFallback
        ? `API unavailable (${data.error || 'unknown error'}) — showing link to CalMac website`
        : `${routeCount} routes · ${disruptedCount} disrupted · fetched in ${ms}ms${lastDisruptionFetch ? ' · last loaded ' + lastDisruptionFetch.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : ''}`
    });
  } catch(e) {
    results.push({ name:'CalMac Status API', icon:'🚨', dot:'red', badge:'err', badgeText:'✗ Error', detail: e.message });
  }

  // ── 4. Push Notifications ──
  const hasSW  = 'serviceWorker' in navigator;
  const hasPush = 'PushManager' in window;
  const hasNotif = 'Notification' in window;
  const notifPerm = hasNotif ? Notification.permission : 'unsupported';
  const subscribedRoutes = JSON.parse(localStorage.getItem('notifRoutes') || '[]');
  let pushDetail = '';
  let pushDot = 'grey';
  let pushBadge = 'grey';
  let pushBadgeText = '–';

  if (!hasSW || !hasPush || !hasNotif) {
    pushDot = 'red'; pushBadge = 'err'; pushBadgeText = '✗ Unsupported';
    pushDetail = 'Push notifications not supported in this browser';
  } else if (notifPerm === 'denied') {
    pushDot = 'red'; pushBadge = 'err'; pushBadgeText = '✗ Blocked';
    pushDetail = 'Notifications blocked — enable in browser settings';
  } else if (notifPerm === 'granted' && pushSupported) {
    pushDot = 'green'; pushBadge = 'ok'; pushBadgeText = '✓ Active';
    pushDetail = subscribedRoutes.length > 0
      ? `Subscribed to ${subscribedRoutes.length} route${subscribedRoutes.length > 1 ? 's' : ''}: ${subscribedRoutes.join(', ').substring(0,60)}`
      : 'Permission granted · No routes subscribed yet — tap "Alert me" on a route';
  } else {
    pushDot = 'amber'; pushBadge = 'warn'; pushBadgeText = '⚠ Not set up';
    pushDetail = 'Tap "Alert me" on a route to enable push notifications';
  }
  results.push({ name:'Push Notifications', icon:'🔔', dot:pushDot, badge:pushBadge, badgeText:pushBadgeText, detail:pushDetail });

  // ── 5. Service Worker ──
  let swDot = 'grey', swBadge = 'grey', swText = '–', swDetail = 'Not supported';
  if (hasSW) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (reg) {
        const state = reg.active?.state || reg.installing?.state || reg.waiting?.state || 'unknown';
        swDot = state === 'activated' ? 'green' : 'amber';
        swBadge = state === 'activated' ? 'ok' : 'warn';
        swText = state === 'activated' ? '✓ Active' : '⚠ ' + state;
        swDetail = `Service worker ${state} · Scope: ${reg.scope}`;
      } else {
        swDot = 'amber'; swBadge = 'warn'; swText = '⚠ Not registered';
        swDetail = 'Service worker not yet registered — reload the page';
      }
    } catch(e) {
      swDot = 'red'; swBadge = 'err'; swText = '✗ Error'; swDetail = e.message;
    }
  }
  results.push({ name:'Service Worker', icon:'⚙️', dot:swDot, badge:swBadge, badgeText:swText, detail:swDetail });

  // ── 6. Historical Data ──
  const calibrated = Object.keys(historicalThresholds).length;
  const hasThresholds = calibrated > 0;
  results.push({
    name: 'Historical Calibration',
    icon: '📊',
    dot: hasThresholds ? 'green' : 'amber',
    badge: hasThresholds ? 'ok' : 'warn',
    badgeText: hasThresholds ? '✓ Loaded' : '⚠ Loading',
    detail: hasThresholds
      ? `${calibrated} routes calibrated with real CalMac data · Last weather fetch: ${lastFetched ? lastFetched.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : 'never'}`
      : 'Historical thresholds not yet loaded — predictions use weather only'
  });

  // ── 7. Prediction Accuracy ──
  try {
    const accResp = await fetch('/api/accuracy', { signal: AbortSignal.timeout(5000) });
    if (accResp.ok) {
      const acc = await accResp.json();
      if (!acc.points) {
        results.push({ name: 'Prediction Accuracy', icon: '🎯', dot: 'amber', badge: 'warn', badgeText: '⚠ No data', detail: 'Accuracy tracking starts from today — check back in a few days' });
      } else if (acc.last30 < 10) {
        results.push({ name: 'Prediction Accuracy', icon: '🎯', dot: 'amber', badge: 'warn', badgeText: '⚠ Building', detail: `${acc.last30} data point${acc.last30 !== 1 ? 's' : ''} collected so far — need more to show accuracy` });
      } else {
        const dot        = acc.accuracy >= 80 ? 'green' : acc.accuracy >= 60 ? 'amber' : 'red';
        const badge      = acc.accuracy >= 80 ? 'ok'    : acc.accuracy >= 60 ? 'warn'  : 'err';
        const badgeText  = `${acc.accuracy >= 80 ? '✓' : acc.accuracy >= 60 ? '⚠' : '✗'} ${acc.accuracy}%`;
        const bucketStr  = acc.buckets
          .filter(b => b.count > 0 && b.sailedPct !== null)
          .map(b => `${b.label} → ${b.sailedPct}% sailed`)
          .join(' · ');
        results.push({ name: 'Prediction Accuracy', icon: '🎯', dot, badge, badgeText, detail: `${acc.accuracy}% accurate (last 30 days · ${acc.last30} predictions)${bucketStr ? ' · ' + bucketStr : ''}` });
      }
    }
  } catch (_) {}

  // ── Render ──
  container.innerHTML = results.map(r => `
    <div class="status-item">
      <div class="status-dot ${r.dot}"></div>
      <div class="status-info">
        <div class="status-name">${r.icon} ${r.name}</div>
        <div class="status-detail">${r.detail}</div>
      </div>
      <div class="status-badge ${r.badge}">${r.badgeText}</div>
    </div>`).join('');

  const now = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  if (lastEl) lastEl.textContent = `Last checked: ${now}`;
}








// Store route for modal open from map panel
window._mapSelectedRoute = null;

// ─────────────────────────────────────────────────────────────────────────
// ── OFFLINE BANNER ──
// ─────────────────────────────────────────────────────────────────────────
let offlineBannerShown = false;
let lastOnlineTime = null;

function updateOfflineBanner() {
  let banner = document.getElementById('offlineBanner');
  if (!navigator.onLine) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offlineBanner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:#1a2c4e;color:#fff;text-align:center;padding:10px 16px;font-size:.82rem;font-weight:600;padding-top:calc(10px + env(safe-area-inset-top))';
      banner.innerHTML = `📵 You're offline — showing cached data${lastOnlineTime ? ' from ' + lastOnlineTime.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : ''}`;
      document.body.prepend(banner);
    }
  } else {
    lastOnlineTime = new Date();
    if (banner) { banner.remove(); }
  }
}

window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
updateOfflineBanner();

// ─────────────────────────────────────────────────────────────────────────
// ── PWA INSTALL PROMPT ──
// ─────────────────────────────────────────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Only show if not dismissed before and not already installed
  if (!localStorage.getItem('pwaInstallDismissed')) {
    showInstallBanner();
  }
});

function showInstallBanner() {
  if (document.getElementById('installBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'installBanner';
  banner.style.cssText = `
    position:fixed;bottom:calc(72px + env(safe-area-inset-bottom));left:12px;right:12px;z-index:800;
    background:var(--navy);color:#fff;border-radius:14px;
    padding:14px 16px;box-shadow:0 8px 32px rgba(0,48,135,.25);
    display:flex;align-items:center;gap:12px;
    animation:fadeUp .3s ease;
  `;
  banner.innerHTML = `
    <div style="font-size:1.4rem">📱</div>
    <div style="flex:1">
      <div style="font-weight:700;font-size:.88rem">Add to Home Screen</div>
      <div style="font-size:.75rem;opacity:.8;margin-top:2px">Get faster access and offline support</div>
    </div>
    <button onclick="installPWA()" style="padding:8px 14px;border-radius:10px;background:var(--sky);border:none;color:var(--navy);font-family:inherit;font-size:.8rem;font-weight:700;cursor:pointer;white-space:nowrap">Install</button>
    <button onclick="dismissInstallBanner()" style="background:none;border:none;color:rgba(255,255,255,.6);font-size:1.2rem;cursor:pointer;padding:4px;line-height:1">✕</button>
  `;
  document.body.appendChild(banner);
}

async function installPWA() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') localStorage.setItem('pwaInstallDismissed', '1');
  deferredInstallPrompt = null;
  document.getElementById('installBanner')?.remove();
}

function dismissInstallBanner() {
  localStorage.setItem('pwaInstallDismissed', '1');
  document.getElementById('installBanner')?.remove();
}

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
      postRenderHook(document.getElementById('routesGrid'));
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


