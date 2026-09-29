// Everything a route card shows, worked out from a route's weather data,
// CalMac disruptions and the timetable.

import { NOTICE_ICONS, sailingStatusFor, statusesForDay, topNotices } from './disruptions';
import { chanceColor, verdictEmoji, weatherDesc, windClass, windDirLabel } from './format';
import { ROUTE_PROFILES, TOMORROW_WINDOW, calcHourlyRisk, calcWindowRisk, chanceFromRisk, historicalReliability, verdictFromChance } from './risk';
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

// What a card headlines for the day in view: its chance, and the verdict
// its icon, the verdict filters and the summary counts all use. Tomorrow is
// judged over TOMORROW_WINDOW. A day CalMac has cancelled outright is
// 'unlikely' whatever the weather.
export function routeOutlook(r, { disruption, thresholds, showingTomorrow }) {
  const tomorrow = showsTomorrow(r, showingTomorrow);
  const statuses = statusesForDay(disruption, tomorrow);
  // The route-level status is live, so it only counts for today
  const cancelled = (!tomorrow && disruption?.status === 'cancelled') ||
    (statuses['*']?.status === 'cancelled') ||
    (Object.keys(statuses).length > 0 && Object.values(statuses).every(s => s.status === 'cancelled'));
  if (r.maxGustMph === undefined) return { tomorrow, statuses, cancelled, risk: null, chance: null, verdict: cancelled ? 'unlikely' : 'unknown' };
  const risk = tomorrow && r.tomorrow?.hourly
    ? calcWindowRisk(r.name, TOMORROW_WINDOW.from, TOMORROW_WINDOW.to, r.tomorrow.hourly, r.tomorrow.marine)
    : (r.risk || 0);
  const chance = chanceFor(risk, r.name, thresholds);
  return { tomorrow, statuses, cancelled, risk, chance, verdict: cancelled ? 'unlikely' : verdictFromChance(chance) };
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
  const profile  = ROUTE_PROFILES[r.name] || { threshold: 45, exposure: 2 };
  const { tomorrow, statuses, cancelled: allCancelled, risk, chance: overall, verdict } = routeOutlook(r, { disruption, thresholds, showingTomorrow });
  const routeCoords = ROUTES.find(x => x.name === r.name) || { lat: 57, lon: -5.5 };
  const calMacStatus = disruption?.status || null;
  const notices = topNotices(disruption);

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
    const weatherOnly = Math.max(0, Math.min(100, Math.round(100 - (risk || 0))));
    const diff = Math.abs((overall || 0) - weatherOnly);
    return diff < 3 ? null : { samples: t.samples, diff };
  })();

  // The weather line and wind bar describe the same day as the chance
  const wx = tomorrow
    ? { gust: r.tomorrow.maxGustMph, wave: r.tomorrow.maxWaveM, dir: r.tomorrow.windDirDeg, vis: r.tomorrow.minVisM, code: r.tomorrow.weatherCode }
    : { gust: r.maxGustMph, wave: r.maxWaveM, dir: r.windDirDeg, vis: r.minVisM, code: r.weatherCode };
  const day = tomorrow ? 'tomorrow' : 'today';

  return {
    name: r.name,
    delay: Math.min(index * 30, 350),
    head: {
      verdictClass: verdict,
      verdictIcon: verdictEmoji(verdict),
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
      gust: wx.gust !== undefined ? wx.gust + ' mph' : '–',
      windDir: wx.dir != null ? windDirLabel(wx.dir) : null,
      wave: wx.wave != null ? wx.wave + 'm' : '–',
      vis: wx.vis != null && wx.vis < 5000 ? (wx.vis < 1000 ? wx.vis + 'm' : Math.round(wx.vis / 1000 * 10) / 10 + 'km') : null,
      desc: wx.code !== undefined ? weatherDesc(wx.code, wx.vis) : '',
    },
    windClass: windClass(wx.gust || 0),
    gustPct: Math.min(100, Math.round(((wx.gust || 0) / 65) * 100)),
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
