// The sailing modal: which route/sailing is open, and everything it shows,
// worked out from a route's weather data, CalMac disruptions and timetable.

import { getAppState } from './appState';
import { routeOutlook, sailingChanceAt, sailingsForDay, showsTomorrow } from './card';
import { sailingStatusFor, statusesForDay } from './disruptions';
import { chanceColor, linkifyDetail } from './format';
import { ROUTE_PROFILES, TIDAL_ROUTES, TOMORROW_WINDOW, chanceAt, gustLimitAt, otherReliability } from './risk';

// ── Open/close state ──
// Closing keeps the last route so the content stays while the sheet slides away.
// id changes on every open so the modal starts fresh each time.
let modal = { open: false, route: null, sailingTime: null, id: 0 };
const CLOSED = modal;
const listeners = new Set();

export const getModal = () => modal;
export const getServerModal = () => CLOSED;

export function subscribeModal(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setModal(next) {
  modal = next;
  listeners.forEach(listener => listener());
}

export function openModal(routeName, sailingTime = null) {
  if (!getAppState().routes.some(r => r.name === routeName)) return;
  setModal({ open: true, route: routeName, sailingTime: sailingTime || null, id: modal.id + 1 });
  document.body.style.overflow = 'hidden';
}

export function closeModal() {
  setModal({ ...modal, open: false });
  document.body.style.overflow = '';
}

// ── Contents ──
const EXPOSURE_LABELS = ['', 'Sheltered waters', 'Moderate exposure', 'Exposed crossing', 'Very exposed'];
const REASON_ICONS = { Weather: '🌊', Technical: '🔧', Operational: '🛳️', Tidal: '🌊', Other: 'ℹ️' };

// { label, cls, barPct, barColor } for a factor's share of its limit
function riskLevel(ratio) {
  if (ratio <= 0)    return { label: 'Safe',     cls: 'safe',     barPct: 0,                     barColor: 'var(--green)' };
  if (ratio < 0.45)  return { label: 'Low',      cls: 'low',      barPct: Math.round(ratio * 100), barColor: '#4ade80' };
  if (ratio < 0.75)  return { label: 'Moderate', cls: 'notable',  barPct: Math.round(ratio * 100), barColor: 'var(--amber)' };
  if (ratio < 1.0)   return { label: 'High',     cls: 'high',     barPct: Math.round(ratio * 100), barColor: '#f97316' };
  return               { label: 'Critical', cls: 'critical', barPct: 100,                    barColor: 'var(--red)' };
}

// Props for components/RouteModal.js. Without sailingTime it describes the
// route as a whole, with the card's chance.
export function modalData(r, sailingTime, { disruption, timetable, thresholds, showingTomorrow }) {
  const profile  = ROUTE_PROFILES[r.name] || { threshold: 45, exposure: 2 };
  const tomorrow = showsTomorrow(r, showingTomorrow);
  const { sailings } = sailingsForDay(timetable, r.name, tomorrow);
  const sailing  = sailingTime ? sailings.find(x => x.t === sailingTime) : null;

  // Tomorrow's forecast when the modal is showing tomorrow (as sailingChanceAt)
  const hw = (tomorrow && r.tomorrow?.hourly ? r.tomorrow.hourly : r.hourlyData) || {};
  const hm = (tomorrow && r.tomorrow?.hourly ? r.tomorrow.marine : r.marineData) || null;
  // The breakdown uses the same inputs as the chance (m/s converted to mph)
  // for one hour: the sailing's, or without one the current hour, or
  // tomorrow the worst hour of TOMORROW_WINDOW (what drives the card's chance)
  const worstHourTomorrow = () => {
    let worst = TOMORROW_WINDOW.from;
    for (let hour = TOMORROW_WINDOW.from; hour <= TOMORROW_WINDOW.to; hour++) {
      if (chanceAt(r.name, hour, hw, hm, thresholds) < chanceAt(r.name, worst, hw, hm, thresholds)) worst = hour;
    }
    return worst;
  };
  const h  = sailingTime ? Math.min(parseInt(sailingTime.split(':')[0]), 23) : tomorrow ? worstHourTomorrow() : new Date().getHours();
  const maxWaveM = tomorrow ? r.tomorrow?.maxWaveM : r.maxWaveM;
  const rawGustMs = (hw.windgusts_10m || [])[h];   // null = missing gust data
  const rawWindMs = (hw.windspeed_10m || [])[h];   // null = missing wind data
  const gustMs = rawGustMs != null ? rawGustMs : (rawWindMs ?? 0);
  const gust = gustMs * 2.237;
  const wind = (rawWindMs ?? 0) * 2.237;
  const hasWindData = rawWindMs != null;
  const waveM = hm ? ((hm.wave_height || [])[h] ?? maxWaveM) : maxWaveM;
  const vis   = (hw.visibility || [])[h] ?? r.minVisM;
  const code  = (hw.weathercode || [])[h] ?? r.weatherCode ?? 0;
  const snow  = (hw.snowfall || [])[h] ?? 0;
  const isTidal = TIDAL_ROUTES.has(r.name);
  // No forecast loaded (the card shows ❓): nothing to work a chance out from
  const noForecast = r.maxGustMph === undefined;
  // The gusts that would make this hour a 50/50, with its waves
  const gustLimit = gustLimitAt(r.name, h, hw, hm);

  // Wind
  const gustRatio = gust / gustLimit;
  const windReason = !hasWindData
    ? 'No wind data for this hour'
    : gust < 1
      ? 'Calm at departure time'
      : Math.round(gust) + ' mph gusts · ' + Math.round(wind) + ' mph sustained · 50/50 at ~' + Math.round(gustLimit) + ' mph';

  // Waves
  let waveRatio = 0;
  let waveReason = 'No wave data — estimated from wind';
  if (waveM !== null && waveM !== undefined) {
    const swellH = hm ? ((hm.swell_wave_height || [])[h] || 0) : 0;
    const wavePeriod = hm ? ((hm.wave_period || [])[h] || 8) : 8;
    const periodFactor = wavePeriod > 12 ? 1.3 : wavePeriod > 8 ? 1.1 : 1.0;
    const waveThreshold = profile.exposure === 1 ? 3.0 : profile.exposure === 2 ? 2.5 : profile.exposure === 3 ? 2.0 : 1.5;
    waveRatio = Math.max(waveM, swellH * 0.8) * periodFactor / waveThreshold;
    waveReason = waveM.toFixed(1) + 'm waves (threshold ' + waveThreshold + 'm for this route)';
  } else {
    const est = (wind * 0.04) * profile.exposure;
    waveReason = est > 1.0 ? 'Estimated ~' + est.toFixed(1) + 'm from wind speed' : 'Calm — estimated ~' + est.toFixed(1) + 'm';
  }

  // Visibility
  let visReason = 'Good visibility';
  if (vis !== null && vis !== undefined) {
    if      (vis < 500)  visReason = vis + 'm — dense fog, serious risk';
    else if (vis < 1000) visReason = vis + 'm — poor visibility';
    else if (vis < 3000) visReason = (vis / 1000).toFixed(1) + 'km — reduced visibility';
    else if (vis < 5000) visReason = (vis / 1000).toFixed(1) + 'km — slightly hazy';
    else                 visReason = (vis / 1000).toFixed(0) + 'km+ — clear';
  }
  const visRatio = vis == null ? 0 : vis < 500 ? 1.2 : vis < 1000 ? 0.9 : vis < 3000 ? 0.6 : vis < 5000 ? 0.3 : 0;

  // Snow, thunderstorms and freezing rain (rain alone doesn't stop ferries)
  const thunder = code >= 95 && code <= 99;
  const freezing = code === 56 || code === 57 || code === 66 || code === 67;
  let precipReason = 'No snow, ice or thunderstorms';
  if      (snow > 2 || (code >= 71 && code <= 77) || code === 85 || code === 86) precipReason = snow > 0 ? snow.toFixed(1) + 'cm snow forecast' : 'Heavy snow/wintry showers';
  else if (thunder)  precipReason = 'Thunderstorms forecast';
  else if (freezing) precipReason = 'Freezing rain or drizzle';
  const precipRatio = precipReason.startsWith('No') ? 0 : freezing ? 0.5 : 0.8;

  // How often CalMac runs this route's sailings outside the stormy months:
  // breakdowns, crewing and other non-weather trouble (and tides)
  const reliability = otherReliability(thresholds, r.name);
  const reliabilityReason = reliability < 1
    ? 'CalMac ran ' + Math.round(reliability * 100) + '% of sailings in summer months (breakdowns, crewing' + (isTidal ? ', tides' : '') + ')'
    : 'No CalMac figures for this route';

  // Wind & Wave always show; the rest only when they add risk. Without a
  // forecast, only the rows that don't come from it.
  const rows = [
    { icon: '💨', name: 'Wind & Gusts',  reason: windReason,   level: riskLevel(gustRatio),         always: true,  forecast: true },
    { icon: '🌊', name: 'Wave Height',   reason: waveReason,   level: riskLevel(waveRatio),         always: true,  forecast: true },
    { icon: '🌫', name: 'Visibility',    reason: visReason,    level: riskLevel(visRatio),          always: false, forecast: true },
    { icon: '❄️', name: 'Snow & Storms', reason: precipReason, level: riskLevel(precipRatio),       always: false, forecast: true },
    { icon: '🔧', name: 'Reliability',   reason: reliabilityReason, level: riskLevel(reliability < 0.97 ? (1 - reliability) / 0.25 : 0), always: false },
  ].filter(row => noForecast ? !row.forecast && row.level.cls !== 'safe' : row.always || row.level.cls !== 'safe');

  // CalMac's status for this sailing (or the route)
  const statuses = statusesForDay(disruption, tomorrow);
  const info = sailingTime
    ? sailingStatusFor(statuses, sailingTime, sailing?.f)
    : (statuses['*'] || Object.values(statuses)[0] || null);
  const cancelled = info?.status === 'cancelled';
  const outlook = routeOutlook(r, { disruption, thresholds, showingTomorrow, timetable });
  // Cancelled by CalMac: that's the answer, whatever the weather (as the card)
  const calmacCancelled = sailingTime ? cancelled : outlook.cancelled;

  // Same percentage as the card's sailing row
  const rowChance = sailingTime ? sailingChanceAt(r, sailingTime, tomorrow, thresholds) : null;
  const chance = calmacCancelled ? 0
    : noForecast ? null
    : rowChance !== null ? rowChance
    : sailingTime ? chanceAt(r.name, h, hw, hm, thresholds)
    // The route as a whole: the card's chance
    : outlook.chance;

  return {
    routeName: r.name,
    sailingTime,
    title: sailingTime ? sailingTime + ' · ' + r.name : r.name,
    subtitle: (sailing ? sailing.f + ' → ' + sailing.to + ' · ' : '') + (EXPOSURE_LABELS[profile.exposure] || '') + ' · 50/50 at ~' + Math.round(gustLimit) + ' mph gusts',
    notice: info ? {
      // colors: [background, border, text]
      colors: cancelled ? ['#fceaed', '#ffcdd2', '#c62828'] : ['#fff8e1', '#ffe082', '#e65100'],
      pulse: cancelled ? 'red' : 'amber',
      title: (cancelled ? '🚨 ' : '⚠️ ') + (cancelled
        ? `Cancelled — ${info.reason || 'CalMac advisory'}`
        : info.status === 'amber'
          ? 'Be Aware — CalMac advisory'
          : `Disrupted — ${info.reason || 'CalMac advisory'}`),
      detailHtml: linkifyDetail((info.detail || '').trim()),
      reason: info.reason || null,
      reasonIcon: info.reason ? (REASON_ICONS[info.reason] || 'ℹ️') : '',
    } : null,
    chance,
    basis: calmacCancelled ? 'From CalMac\'s service status' : chance === null ? 'No forecast loaded' : 'Based on weather forecast',
    color: chance === null ? 'var(--muted)' : chanceColor(chance),
    verdict: calmacCancelled ? '🚨 Cancelled by CalMac' : chance === null ? '❓ No forecast' : chance >= 75 ? '✅ Likely to sail' : chance >= 45 ? '⚠️ Caution advised' : '❌ At risk',
    verdictText: calmacCancelled
      ? (sailingTime ? 'CalMac has cancelled this sailing.' : 'CalMac has cancelled sailings on this route.') + (info ? ' See their notice above.' : '')
      : chance === null
      ? "The weather forecast couldn't be loaded, so there's no prediction yet. Tap Refresh to try again."
      : chance >= 75
      ? 'This route looks good to go based on current forecasts.'
      : chance >= 45
      ? 'Conditions are borderline. CalMac may reduce service or cancel some sailings.'
      : 'High risk of disruption or cancellation based on forecast conditions.',
    rows: rows.map(({ icon, name, reason, level }) => ({ icon, name, reason, cls: level.cls, barPct: level.barPct, barColor: level.barColor })),
    pills: [
      '📍 ' + (EXPOSURE_LABELS[profile.exposure] || 'Standard'),
      '💨 50/50 at ~' + Math.round(gustLimit) + ' mph',
      r.hasMarine ? '🌊 Live wave data' : '🌊 Wave estimated',
      isTidal && '🌊 Tidal route',
    ].filter(Boolean),
  };
}
