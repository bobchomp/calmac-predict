// Everything a route card shows, worked out from a route's weather data,
// CalMac disruptions and the timetable.

import { NOTICE_ICONS, sailingStatusFor, statusesForDay, topNotices } from './disruptions';
import { chanceColor, verdictEmoji, weatherDesc, windClass, windDirLabel } from './format';
import { ROUTE_PROFILES, calcHourlyRisk, calcOverallRisk, chanceFromRisk, historicalReliability } from './risk';
import { ROUTES } from './routes';
import { isBeforeDawn } from './sun';
import { TIMETABLE, ukDateStr } from './timetable';

// Whether a route's card shows tomorrow: only when tomorrow's forecast exists
export const showsTomorrow = (route, showingTomorrow) => showingTomorrow && route.tomorrow?.maxGustMph !== null;

const chanceFor = (risk, routeName, thresholds) =>
  chanceFromRisk(risk, routeName ? historicalReliability(thresholds, routeName) : null);

// Sailing chance for one departure, or null without a forecast
export function sailingChanceAt(route, time, tomorrow, thresholds) {
  const hourly = tomorrow && route.tomorrow?.hourly ? route.tomorrow.hourly : route.hourlyData;
  const marine = tomorrow && route.tomorrow?.marine ? route.tomorrow.marine : route.marineData;
  if (!hourly) return null;
  const hour = Math.min(Number(time.split(':')[0]), 23);
  return chanceFor(calcHourlyRisk(route.name, hour, hourly, marine), route.name, thresholds);
}

// A route's sailings for today or tomorrow: live from /api/timetable when
// loaded (timetable is keyed by UK date), else the built-in TIMETABLE
export function sailingsForDay(timetable, routeName, tomorrow) {
  const live = timetable[ukDateStr(tomorrow ? 1 : 0)]?.[routeName];
  return { sailings: live ?? TIMETABLE[routeName] ?? [], isLive: !!live };
}

const REASON_ICONS = { Weather: '🌊', Technical: '🔧', Operational: '⛴️', Tidal: '🌊', Other: 'ℹ️' };
const EXPOSURE_LABELS = ['', '🛡 Sheltered', '🌊 Moderate', '🌊🌊 Exposed', '⚠️ Very exposed'];

// Props for components/RouteCard.js. index staggers the fade-in animation.
export function cardData(r, index, { disruption, timetable, thresholds, showingTomorrow, lastFetched }) {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin  = now.getMinutes();
  const v        = r.verdict || 'unknown';
  const profile  = ROUTE_PROFILES[r.name] || { threshold: 45, exposure: 2 };
  const tomorrow = showsTomorrow(r, showingTomorrow);
  // Tomorrow's overall chance is taken from noon
  const tomorrowRisk = tomorrow && r.tomorrow?.hourly
    ? calcOverallRisk(r.name, 12, r.tomorrow.hourly, r.tomorrow.marine)
    : null;
  const overall  = r.maxGustMph !== undefined
    ? (tomorrow && tomorrowRisk !== null ? chanceFor(tomorrowRisk, r.name, thresholds) : chanceFor(r.risk || 0, r.name, thresholds))
    : null;
  const routeCoords = ROUTES.find(x => x.name === r.name) || { lat: 57, lon: -5.5 };
  const calMacStatus = disruption?.status || null;
  const notices = topNotices(disruption);

  // All sailings cancelled? The route-level status is live, so it only
  // counts for today.
  const statuses = statusesForDay(disruption, tomorrow);
  const allCancelled = (!tomorrow && calMacStatus === 'cancelled') ||
    (statuses['*']?.status === 'cancelled') ||
    (Object.keys(statuses).length > 0 && Object.values(statuses).every(s => s.status === 'cancelled'));

  const { sailings, isLive } = sailingsForDay(timetable, r.name, tomorrow);
  // CalMac has an amended service or disruption in place (e.g. replacement
  // sailings described only in a notice, or a diversion to another port)
  const hasServiceChange = Object.keys(statuses).length > 0 || notices.some(n => n.type === 'SAILING');
  // Tomorrow has no "next" or "past" sailing
  const isPastTime = (hh, mm) => (hh < currentHour) || (hh === currentHour && mm <= currentMin);
  const nextSailingTime = tomorrow ? null : (sailings.find(s => {
    const [hh, mm] = s.t.split(':').map(Number);
    return !isPastTime(hh, mm);
  })?.t || null);

  const rows = sailings.map(s => {
    const time = s.t;
    const [hh, mm] = time.split(':').map(Number);
    const isNext = time === nextSailingTime;
    const pct = sailingChanceAt(r, time, tomorrow, thresholds);
    const info = sailingStatusFor(statuses, time, s.f);
    const status = info?.status || null;
    return {
      time, from: s.f, to: s.to, pct,
      color: pct !== null ? chanceColor(pct) : 'var(--muted)',
      isPast: tomorrow ? false : isPastTime(hh, mm),
      isNext,
      nextLabel: isNext ? (isBeforeDawn(hh, routeCoords.lat, routeCoords.lon) ? '🌙 Pre-dawn · Next' : 'Next sailing') : null,
      status: status === 'cancelled' ? 'cancelled' : (status === 'disrupted' || status === 'amber') ? 'disrupted' : null,
      statusTitle: status === 'cancelled' ? (info.detail || '').substring(0, 120) : null,
      reasonIcon: info?.reason ? (REASON_ICONS[info.reason] || 'ℹ️') : null,
      reasonLabel: info?.reason && info.reason !== 'Other' ? info.reason : null,
    };
  });

  // Only show the calibrated badge if history meaningfully moved the score
  const calibration = (() => {
    const t = thresholds[r.name];
    if (!t || t.samples < 2) return null;
    const weatherOnly = Math.max(0, Math.min(100, Math.round(100 - (r.risk || 0))));
    const diff = Math.abs((overall || 0) - weatherOnly);
    return diff < 3 ? null : { samples: t.samples, diff };
  })();

  const gustShown = tomorrow && r.tomorrow?.maxGustMph !== null ? r.tomorrow.maxGustMph : r.maxGustMph;
  const waveShown = tomorrow ? r.tomorrow?.maxWaveM : r.maxWaveM;
  const day = tomorrow ? 'tomorrow' : 'today';

  return {
    name: r.name,
    delay: Math.min(index * 30, 350),
    head: {
      verdictClass: allCancelled ? 'unlikely' : v,
      verdictIcon: allCancelled ? '❌' : verdictEmoji(v),
      name: r.name,
      cancelled: allCancelled,
      chanceText: overall !== null ? overall + '%' : '–',
      chanceColor: overall !== null ? chanceColor(overall) : 'var(--muted)',
      chanceLabel: tomorrow ? 'Tomorrow' : 'Next 12h',
      exposureLabel: EXPOSURE_LABELS[profile.exposure],
      // colors: [background, text, border]
      badges: [
        calMacStatus === 'cancelled' && { text: '🚨 Cancelled', colors: ['#fceaed', '#c62828', '#ffcdd2'] },
        calMacStatus === 'disrupted' && { text: '⚠️ Disrupted', colors: ['#fff3e0', '#e65100', '#ffe082'] },
        calMacStatus === 'amber' && { text: '⚠️ Be Aware', colors: ['#fff8e1', '#e65100', '#ffe082'] },
        disruption?.isUpcoming && !['cancelled', 'disrupted', 'amber'].includes(calMacStatus) && { text: '⏰ Change coming', colors: ['#fff8e1', '#e65100', '#ffe082'] },
        calibration && { text: '📊 Calibrated', title: `Calibrated using ${calibration.samples} months of real CalMac data — shifted score by ${calibration.diff}%` },
      ].filter(Boolean),
    },
    notices: notices.map(n => ({
      icon: NOTICE_ICONS[n.type] || '📋',
      title: n.title,
      preview: n.detail ? (d => d.length > 120 ? d.substring(0, 120).trimEnd() + '…' : d)(n.detail.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim()) : null,
    })),
    weather: {
      gust: gustShown !== undefined ? gustShown + ' mph' : '–',
      windDir: r.windDirDeg !== null && r.windDirDeg !== undefined ? windDirLabel(r.windDirDeg) : null,
      wave: waveShown !== null && waveShown !== undefined ? waveShown + 'm' : '–',
      vis: r.minVisM !== null && r.minVisM !== undefined && r.minVisM < 5000 ? (r.minVisM < 1000 ? r.minVisM + 'm' : Math.round(r.minVisM / 1000 * 10) / 10 + 'km') : null,
      desc: r.weatherCode !== undefined ? weatherDesc(r.weatherCode, r.minVisM) : '',
    },
    windClass: windClass(r.maxGustMph || 0),
    gustPct: Math.min(100, Math.round(((r.maxGustMph || 0) / 65) * 100)),
    sailings: {
      title: tomorrow ? "Tomorrow's sailings" : "Today's sailings",
      rows,
      emptyText: !isLive ? 'No timetable available'
        : hasServiceChange ? `Normal sailings aren't running ${day} — see CalMac's service update above`
        : `No sailings scheduled ${day}`,
    },
    foot: {
      pips: r.maxGustMph !== undefined ? (r.hasMarine ? 3 : 2) : 1,
      updated: lastFetched ? lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–',
    },
  };
}
