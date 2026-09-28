// The sailing modal: which route/sailing is open, and everything it shows,
// worked out from a route's weather data, CalMac disruptions and timetable.

import { getAppState } from './appState';
import { sailingChanceAt, sailingsForDay, showsTomorrow } from './card';
import { sailingStatusFor, statusesForDay } from './disruptions';
import { chanceColor, linkifyDetail } from './format';
import { ROUTE_PROFILES, TIDAL_ROUTES, calcHourlyRisk, calcOverallRisk, chanceFromRisk, historicalReliability, seasonFactor } from './risk';

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
// route as a whole at the current hour.
export function modalData(r, sailingTime, { disruption, timetable, thresholds, showingTomorrow }) {
  const profile  = ROUTE_PROFILES[r.name] || { threshold: 45, exposure: 2 };
  const tomorrow = showsTomorrow(r, showingTomorrow);
  const { sailings } = sailingsForDay(timetable, r.name, tomorrow);
  const sailing  = sailingTime ? sailings.find(x => x.t === sailingTime) : null;
  const season   = seasonFactor();

  // The breakdown uses the same inputs as calcHourlyRisk (m/s converted to mph)
  // Without a sailing: the current hour, or noon tomorrow (as the card header)
  const h  = sailingTime ? Math.min(parseInt(sailingTime.split(':')[0]), 23) : tomorrow ? 12 : new Date().getHours();
  // Tomorrow's forecast when the modal is showing tomorrow (as sailingChanceAt)
  const hw = (tomorrow && r.tomorrow?.hourly ? r.tomorrow.hourly : r.hourlyData) || {};
  const hm = (tomorrow && r.tomorrow?.hourly ? r.tomorrow.marine : r.marineData) || null;
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
  const effThreshold = profile.threshold * season;

  // Wind
  const gustRatio = gust / effThreshold;
  const windReason = !hasWindData
    ? 'No wind data for this hour'
    : gust < 1
      ? 'Calm at departure time'
      : Math.round(gust) + ' mph gusts · ' + Math.round(wind) + ' mph sustained · threshold ~' + Math.round(effThreshold) + ' mph';

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

  // Precipitation
  let precipReason = 'No significant precipitation';
  if      (snow > 2  || code >= 71)  precipReason = snow > 0 ? snow.toFixed(1) + 'cm snow forecast' : 'Heavy snow/wintry showers';
  else if (snow > 0.5 || code >= 61) precipReason = 'Rain or light snow expected';
  else if (code >= 51)               precipReason = 'Drizzle expected';
  const precipRatio = (snow > 2 || code >= 71) ? 1.2 : (snow > 0.5 || code >= 61) ? 0.75 : (code >= 51) ? 0.35 : 0;

  // Season (already part of effThreshold) and tides
  const seasonReason = season < 0.9
    ? 'Winter — thresholds reduced by 15% (winds cancel sailings at lower speeds)'
    : season < 1.0 ? 'Shoulder season — thresholds slightly reduced'
    : 'Summer — standard thresholds apply';
  const seasonRatio = season < 0.85 ? 0.8 : season < 1.0 ? 0.4 : 0;
  const tidalReason = isTidal ? 'This route has known tidal restrictions that can cause cancellations' : 'No tidal restrictions on this route';

  // Wind & Wave always show; the rest only when they add risk
  const rows = [
    { icon: '💨', name: 'Wind & Gusts',  reason: windReason,   level: riskLevel(gustRatio),         always: true  },
    { icon: '🌊', name: 'Wave Height',   reason: waveReason,   level: riskLevel(waveRatio),         always: true  },
    { icon: '🌫', name: 'Visibility',    reason: visReason,    level: riskLevel(visRatio),          always: false },
    { icon: '🌧', name: 'Precipitation', reason: precipReason, level: riskLevel(precipRatio),       always: false },
    { icon: '📅', name: 'Season',        reason: seasonReason, level: riskLevel(seasonRatio),       always: false },
    { icon: '🌊', name: 'Tidal Factors', reason: tidalReason,  level: riskLevel(isTidal ? 0.35 : 0), always: false },
  ].filter(row => row.always || row.level.cls !== 'safe');

  // Same percentage as the card's sailing row
  const reliability = historicalReliability(thresholds, r.name);
  const rowChance = sailingTime ? sailingChanceAt(r, sailingTime, tomorrow, thresholds) : null;
  const chance = rowChance !== null
    ? rowChance
    : chanceFromRisk(sailingTime ? calcHourlyRisk(r.name, h, hw, hm) : tomorrow ? calcOverallRisk(r.name, 12, hw, hm) : (r.risk || 0), reliability);

  // CalMac's status for this sailing (or the route)
  const statuses = statusesForDay(disruption, tomorrow);
  const info = sailingTime
    ? sailingStatusFor(statuses, sailingTime, sailing?.f)
    : (statuses['*'] || Object.values(statuses)[0] || null);
  const cancelled = info?.status === 'cancelled';

  return {
    routeName: r.name,
    sailingTime,
    title: sailingTime ? sailingTime + ' · ' + r.name : r.name,
    subtitle: (sailing ? sailing.f + ' → ' + sailing.to + ' · ' : '') + (EXPOSURE_LABELS[profile.exposure] || '') + ' · Threshold ~' + Math.round(effThreshold) + ' mph gusts',
    notice: info ? {
      // colors: [background, border, text]
      colors: cancelled ? ['#fceaed', '#ffcdd2', '#c62828'] : ['#fff8e1', '#ffe082', '#e65100'],
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
    color: chanceColor(chance),
    verdict: chance >= 75 ? '✅ Likely to sail' : chance >= 45 ? '⚠️ Caution advised' : '❌ At risk',
    verdictText: chance >= 75
      ? 'This route looks good to go based on current forecasts.'
      : chance >= 45
      ? 'Conditions are borderline. CalMac may reduce service or cancel some sailings.'
      : 'High risk of disruption or cancellation based on forecast conditions.',
    rows: rows.map(({ icon, name, reason, level }) => ({ icon, name, reason, cls: level.cls, barPct: level.barPct, barColor: level.barColor })),
    pills: [
      '📍 ' + (EXPOSURE_LABELS[profile.exposure] || 'Standard'),
      '💨 Threshold ~' + Math.round(effThreshold) + ' mph',
      r.hasMarine ? '🌊 Live wave data' : '🌊 Wave estimated',
      isTidal && '🌊 Tidal route',
      '📅 ' + (season < 0.9 ? 'Winter mode' : season < 1.0 ? 'Shoulder season' : 'Summer mode'),
    ].filter(Boolean),
  };
}
