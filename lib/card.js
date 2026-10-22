// Everything a route card shows, worked out from a route's weather data,
// CalMac disruptions and the timetable.

import { NOTICE_ICONS, disruptionsByRoute, noticeSeverity, sailingInfo, statusesForDay, topNotices } from './disruptions';
import { routeWeather } from './forecast';
import { ROUTE_AREAS, routeWarnings } from './metoffice';
import { departureMs } from './sailingLog';
import { chanceColor, verdictEmoji, weatherDesc, windClass, windDirLabel } from './format';
import { ROUTE_PROFILES, TOMORROW_WINDOW, chanceAt, otherReliability, verdictFromChance, windowChance } from './risk';
import { ROUTES } from './routes';
import { isBeforeDawn } from './sun';
import { TIMETABLE, ukDateStr } from './timetable';

// Whether a route's card shows tomorrow: only when tomorrow's forecast exists
// (routes that failed to load have no tomorrow at all)
export const showsTomorrow = (route, showingTomorrow) => showingTomorrow && route.tomorrow?.maxGustMph != null;

// Sailing chance for one departure, or null without a forecast. With the
// route's CalMac status (its disruptions entry) and the departure port, CalMac's
// word beats the forecast: a sailing it has cancelled is 0 (95% of those in
// the sailing log didn't go, for weather or technical reasons alike).
// Disrupted and Be Aware sailings nearly always went ahead (98-100%: amended
// timetables, delays), so they keep the forecast's chance.
export function sailingChanceAt(route, time, tomorrow, thresholds, disruption = null, from = null) {
  if (disruption && sailingInfo(disruption, tomorrow, time, from)?.status === 'cancelled') return 0;
  const hourly = tomorrow && route.tomorrow?.hourly ? route.tomorrow.hourly : route.hourlyData;
  const marine = tomorrow && route.tomorrow?.marine ? route.tomorrow.marine : route.marineData;
  if (!hourly) return null;
  const hour = Math.min(Number(time.split(':')[0]), 23);
  return chanceAt(route.name, hour, hourly, marine, thresholds);
}

// The weather's chance over a stretch of the day, for a card with no
// sailings left to judge it by: tomorrow over TOMORROW_WINDOW, today over
// the next 12 hours
export function forecastChance(r, tomorrow, thresholds) {
  if (tomorrow) return windowChance(r.name, TOMORROW_WINDOW.from, TOMORROW_WINDOW.to, r.tomorrow.hourly, r.tomorrow.marine, thresholds);
  const hour = new Date().getHours();
  return windowChance(r.name, hour, hour + 11, r.hourlyData || {}, r.marineData || null, thresholds);
}

// What a card headlines for the day in view: its chance, and the verdict
// its icon, the verdict filters and the summary counts all use. The chance
// is the share of the day's sailings still to go (all of tomorrow's) that
// are expected to run: the average of their rows' chances, so 0 for each
// one CalMac has cancelled (bySailing). With none left to go it's the
// weather's over the next 12 hours (forecastChance). forecast is the same
// before CalMac's cancellations. A day with all its remaining sailings
// cancelled is 0% and 'unlikely' whatever the weather; CalMac lists only the
// sailings it has changed, so without a timetable to count from, a day whose
// listed sailings are all cancelled counts as cancelled.
export function routeOutlook(r, { disruption, thresholds, showingTomorrow, timetable }) {
  const tomorrow = showsTomorrow(r, showingTomorrow);
  const statuses = statusesForDay(disruption, tomorrow);
  // The day's sailings, those still to go, and how many of those are running
  const now = new Date();
  const daySailings = timetable ? sailingsForDay(timetable, r.name, tomorrow).sailings : [];
  const toGo = daySailings.filter(s => {
    if (tomorrow) return true;
    const [hh, mm] = s.t.split(':').map(Number);
    return hh > now.getHours() || (hh === now.getHours() && mm > now.getMinutes());
  });
  const running = toGo.filter(s => sailingInfo(disruption, tomorrow, s.t, s.f)?.status !== 'cancelled').length;
  // The route-level status is live, so it only counts for today
  const cancelled = (!tomorrow && disruption?.status === 'cancelled') ||
    (statuses['*']?.status === 'cancelled') ||
    (daySailings.length
      ? toGo.length > 0 && running === 0
      : Object.keys(statuses).length > 0 && Object.values(statuses).every(s => s.status === 'cancelled'));
  if (r.maxGustMph === undefined) return { tomorrow, statuses, cancelled, forecast: null, bySailing: false, chance: cancelled ? 0 : null, verdict: cancelled ? 'unlikely' : 'unknown' };
  // Each sailing still to go: its chance before CalMac's cancellations, and its row's
  const rows = toGo
    .map(s => ({ weather: sailingChanceAt(r, s.t, tomorrow, thresholds), row: sailingChanceAt(r, s.t, tomorrow, thresholds, disruption, s.f) }))
    .filter(x => x.weather !== null);
  const average = xs => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const bySailing = rows.length > 0;
  const forecast = bySailing ? average(rows.map(x => x.weather)) : forecastChance(r, tomorrow && !!r.tomorrow?.hourly, thresholds);
  const chance = cancelled ? 0 : bySailing ? average(rows.map(x => x.row)) : forecast;
  return { tomorrow, statuses, cancelled, forecast, bySailing, chance, verdict: cancelled ? 'unlikely' : verdictFromChance(chance) };
}

// Each route's headline chance for today, as its card shows it, from
// Open-Meteo's responses (forecastUrls), /api/status's data and today's
// /api/timetable routes (or null), for the alerts job. "Still to go" is by
// the clock's time zone, so run it on UK time, as visitors' browsers are.
export function headlineChances({ wind, marine, status, timetable, thresholds, hour = new Date().getHours() }) {
  const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const windArr = asArray(wind), marineArr = asArray(marine);
  const disruptions = status && !status.fallback ? disruptionsByRoute(status) : {};
  const days = timetable ? { [ukDateStr(0)]: timetable } : null;
  const chances = {};
  ROUTES.forEach((route, i) => {
    if (!windArr[i]?.hourly) return;
    const r = { name: route.name, ...routeWeather(windArr[i].hourly, marineArr[i]?.hourly || null, hour) };
    chances[route.name] = routeOutlook(r, { disruption: disruptions[route.name] || null, thresholds, showingTomorrow: false, timetable: days }).chance;
  });
  return chances;
}

// A route's sailings for today or tomorrow: live from /api/timetable when
// loaded (timetable is keyed by UK date), else the built-in TIMETABLE
export function sailingsForDay(timetable, routeName, tomorrow) {
  const live = timetable[ukDateStr(tomorrow ? 1 : 0)]?.[routeName];
  return { sailings: live ?? TIMETABLE[routeName] ?? [], isLive: !!live };
}

const MET_ICONS = { yellow: '🟡', amber: '🟠', red: '🔴' };
// [background, text, border]
const MET_COLORS = { yellow: ['#fffbe6', '#8a6d00', '#ffe58f'], amber: ['#fff3e0', '#e65100', '#ffcc80'], red: ['#fceaed', '#c62828', '#ffcdd2'] };
const ukTime = ms => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });

const REASON_ICONS = { Weather: '🌊', Technical: '🔧', Operational: '⛴️', Tidal: '🌊', Other: 'ℹ️' };
const EXPOSURE_LABELS = ['', '🛡 Sheltered', '🌊 Moderate', '🌊🌊 Exposed', '⚠️ Very exposed'];

// Props for components/RouteCard.js. index staggers the fade-in animation.
export function cardData(r, index, { disruption, timetable, thresholds, showingTomorrow, lastFetched, metWarnings }) {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin  = now.getMinutes();
  const profile  = ROUTE_PROFILES[r.name] || { threshold: 45, exposure: 2 };
  const { tomorrow, statuses, cancelled: allCancelled, forecast, bySailing, chance: overall, verdict } = routeOutlook(r, { disruption, thresholds, showingTomorrow, timetable });
  const routeCoords = ROUTES.find(x => x.name === r.name) || { lat: 57, lon: -5.5 };
  const calMacStatus = disruption?.status || null;
  const notices = topNotices(disruption);
  // Met Office warnings for the route on the day in view (today from now)
  const metToday = routeWarnings(metWarnings, r.name, tomorrow ? departureMs(ukDateStr(1), '00:00') : Date.now(), departureMs(ukDateStr(tomorrow ? 2 : 1), '00:00') - 1);

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
    const pct = sailingChanceAt(r, time, tomorrow, thresholds, disruption, s.f);
    const info = sailingInfo(disruption, tomorrow, time, s.f);
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

  // Only show the calibrated badge if the route's track record meaningfully
  // moved the score (judged before CalMac's cancellations, which aren't its doing)
  const calibration = (() => {
    const t = thresholds[r.name];
    if (!t || t.samples < 2 || allCancelled || forecast === null) return null;
    const reliability = otherReliability(thresholds, r.name);
    const diff = Math.round(forecast / reliability - forecast);
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
      chanceLabel: tomorrow ? 'Tomorrow' : bySailing ? 'Rest of today' : 'Next 12h',
      exposureLabel: EXPOSURE_LABELS[profile.exposure],
      // colors: [background, text, border]; pulse: which warning pulse it has
      badges: [
        calMacStatus === 'cancelled' && { text: '🚨 Cancelled', colors: ['#fceaed', '#c62828', '#ffcdd2'], pulse: 'red' },
        calMacStatus === 'disrupted' && { text: '⚠️ Disrupted', colors: ['#fff3e0', '#e65100', '#ffe082'], pulse: 'amber' },
        calMacStatus === 'amber' && { text: '⚠️ Be Aware', colors: ['#fff8e1', '#e65100', '#ffe082'], pulse: 'amber' },
        disruption?.isUpcoming && !['cancelled', 'disrupted', 'amber'].includes(calMacStatus) && { text: '⏰ Change coming', colors: ['#fff8e1', '#e65100', '#ffe082'], pulse: 'amber' },
        ...metToday.map(w => ({
          text: `${MET_ICONS[w.level]} Met Office: ${w.type}`,
          title: `${w.title}, ${ukTime(w.from)} to ${ukTime(w.to)}`,
          colors: MET_COLORS[w.level],
        })),
        calibration && { text: '📊 Calibrated', title: `Calibrated using ${calibration.samples} months of real CalMac data — shifted score by ${calibration.diff}%` },
      ].filter(Boolean),
    },
    // severity: 'cancelled' (red), 'risk' (yellow) or null (blue information)
    notices: [...metToday.map(w => ({
      severity: w.level === 'yellow' ? 'risk' : 'cancelled',
      icon: MET_ICONS[w.level],
      title: w.title,
      preview: `${ukTime(w.from)} to ${ukTime(w.to)} · ${w.areas.filter(a => ROUTE_AREAS[r.name]?.includes(a)).join(', ')}`,
    })), ...notices.map(n => ({
      severity: noticeSeverity(n),
      icon: { cancelled: '🚨', risk: '⚠️' }[noticeSeverity(n)] || NOTICE_ICONS[n.type] || '📋',
      title: n.title,
      preview: n.detail ? (d => d.length > 120 ? d.substring(0, 120).trimEnd() + '…' : d)(n.detail.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim()) : null,
    }))],
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
