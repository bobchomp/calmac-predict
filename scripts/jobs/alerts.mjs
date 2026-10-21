// GitHub Actions: every 5 minutes (cron-job.org, with an hourly fallback).
// 1. Push alerts to a route's subscribers when CalMac reports disruption and
//    the site's sailing chance is under 70%, which a route CalMac has
//    cancelled always is (at most every 2 hours a route)
// 2. Push alerts for a route's new timetable notices
// 3. An email when one of the services the site needs has been down for
//    15 minutes (not for a moment's hiccup), once until it's been back up
//    for 30 minutes
// New timetable PDFs are checked daily (daily.mjs).

import { kvGetJsonMany, kvSetJson } from '../../lib/kv.js';
import { headlineChances } from '../../lib/card.js';
import { ROUTES } from '../../lib/routes.js';
import { loadThresholds } from '../../lib/thresholds.js';
import { ukDateStr } from '../../lib/timetable.js';
import { fetchForecast } from '../../lib/tracker.js';
import { BASE_URL, getJson, notify, runJob, say } from './common.mjs';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ALERT_FROM = 'Will It Sail <info@willitsail.co.uk>';
const ALERT_TO = ['teddaharry@gmail.com', 'ross.mackenzie1@invernessroyalacademy.org.uk'];

const NOTIFY_THRESHOLD = 70;
const PUSH_EVERY_MS = 2 * 60 * 60 * 1000;

const slug = routeKey => routeKey.replace(/[^a-z0-9]/gi, '_');
const ukParts = () => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', month: 'numeric', hourCycle: 'h23' })
  .formatToParts(new Date()).map(p => [p.type, p.value]));

// Each route's sailing chance for the rest of today, as its card headlines
// it (lib/card.js headlineChances, with the same forecast, thresholds,
// CalMac status and timetable). A forecast Open-Meteo refuses falls back to
// the last one fetched, if recent (fetchForecast).
async function sailingChances({ dry, statusData }) {
  const [forecast, thresholds, timetable] = await Promise.allSettled([
    fetchForecast({ baseUrl: BASE_URL, save: !dry }),
    loadThresholds(),
    getJson(`${BASE_URL}/api/timetable?date=${ukDateStr(0)}`, 20000),
  ]);
  const { wind, marine, saved, errors } = forecast.status === 'fulfilled' ? forecast.value : { wind: null, marine: null, saved: {}, errors: { wind: forecast.reason?.message } };
  if (!wind) return { chances: {}, error: errors.wind };
  const chances = headlineChances({
    wind, marine, status: statusData,
    timetable: timetable.status === 'fulfilled' ? timetable.value?.routes || null : null,
    thresholds: thresholds.status === 'fulfilled' ? thresholds.value.thresholds : null,
    hour: Number(ukParts().hour),
  });
  return { chances, ...(Object.keys(saved).length && { savedMinutesAgo: saved }) };
}

// The services the site needs (as the Status tab checks them): those
// failing, and those that couldn't be judged
async function healthChecks(statusData) {
  const failed = [];
  const unknown = [];
  // Tried again on a busy reply. Open-Meteo still turning this job away
  // (429) is GitHub's shared address being rate-limited, not the site's
  // weather failing (visitors' browsers fetch it themselves), so it
  // doesn't count either way.
  const check = async (name, url, what) => {
    try {
      const j = await getJson(url, 8000);
      const one = Array.isArray(j) ? j[0] : j;
      if (name === 'Weather API' && !one?.hourly?.windspeed_10m?.length) failed.push({ name, detail: 'Open-Meteo responded but returned no hourly data' });
    } catch (e) {
      if (/^HTTP 429\b/.test(e.message)) return unknown.push({ name, detail: 'rate-limited (429) from GitHub’s shared address' });
      failed.push({ name, detail: /^HTTP/.test(e.message) ? `${e.message.split(' from ')[0]} — ${what} unavailable` : e.message });
    }
  };
  await Promise.all([
    check('Weather API', 'https://api.open-meteo.com/v1/forecast?latitude=57.0&longitude=-5.8&hourly=windspeed_10m&forecast_days=1', 'weather data'),
    check('Marine / Wave API', 'https://marine-api.open-meteo.com/v1/marine?latitude=57.0&longitude=-5.8&hourly=wave_height&forecast_days=1', 'wave predictions'),
  ]);
  if (!statusData || statusData.fallback === true) {
    failed.push({ name: 'CalMac Status API', detail: statusData?.error ? `API unavailable: ${statusData.error}` : 'API unavailable — app is showing fallback link to CalMac website' });
  } else if (!statusData.routes?.length) {
    failed.push({ name: 'CalMac Status API', detail: 'API responded but returned 0 routes' });
  }
  return { failed, unknown };
}

const EMAIL_AFTER_MS = 15 * 60 * 1000;
const RECOVERED_AFTER_MS = 30 * 60 * 1000;

// Each service's health over time, in Redis health_state:
// { [service]: { failingSince, okSince, detail, emailedAt } }. A service is
// emailed about once it's been failing since 15 minutes ago, and not again
// until it's been working for 30 minutes, so a flicker sends nothing.
function healthUpdate(state, { failed, unknown }, now) {
  const next = {};
  const names = new Set([...Object.keys(state || {}), ...failed.map(f => f.name), 'Weather API', 'Marine / Wave API', 'CalMac Status API']);
  for (const name of names) {
    const was = state?.[name] || {};
    const fail = failed.find(f => f.name === name);
    if (unknown.some(u => u.name === name)) next[name] = was;
    else if (fail) next[name] = { failingSince: was.failingSince || now, okSince: null, detail: fail.detail, emailedAt: was.emailedAt || null };
    else {
      const okSince = was.okSince || now;
      next[name] = { failingSince: null, okSince, detail: null, emailedAt: was.emailedAt && now - okSince < RECOVERED_AFTER_MS ? was.emailedAt : null };
    }
  }
  const toEmail = Object.entries(next)
    .filter(([, s]) => s.failingSince && now - s.failingSince >= EMAIL_AFTER_MS && !s.emailedAt)
    .map(([name, s]) => ({ name, detail: `${s.detail} (since ${new Date(s.failingSince).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })})` }));
  return { next, toEmail };
}

const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sendHealthEmail(failedChecks) {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not set' };
  const rows = failedChecks.map(c => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600">${escape(c.name)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;color:#b91c1c">${escape(c.detail)}</td>
    </tr>`).join('');
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#7f1d1d;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:20px">🚨 Will It Sail — App Error</h1>
        <p style="margin:4px 0 0;opacity:.8;font-size:13px">${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' })}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
        <p style="margin:16px 20px 12px;color:#374151;font-size:14px">
          ${failedChecks.length === 1 ? '1 service' : `${failedChecks.length} services`} are reporting errors:
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb">Service</th>
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb">Error</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin:16px 20px;font-size:13px;color:#6b7280">
          <a href="https://www.willitsail.co.uk/#status" style="color:#7f1d1d">View Status page →</a>
        </p>
      </div>
    </div>`;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: ALERT_FROM,
        to: ALERT_TO,
        subject: `Will It Sail — ${failedChecks.length === 1 ? failedChecks[0].name : `${failedChecks.length} services`} down`,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, id: data.id, error: data.message };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function alerts({ dry }) {
  const statusData = await getJson(`${BASE_URL}/api/status`, 15000).catch(err => ({ fallback: true, error: err.message, routes: [] }));
  const { chances, error: forecastError, savedMinutesAgo } = await sailingChances({ dry, statusData });
  const health = await healthChecks(statusData);
  const known = new Set(ROUTES.map(r => r.name));

  // ── 1. Disruption pushes ──
  const disrupted = (statusData.disrupted || []).filter(d => d.routeKey && known.has(d.routeKey));
  const routeKeys = [...new Set([...disrupted.map(d => d.routeKey), ...(statusData.routes || []).filter(r => r.routeKey && r.timetableNotice).map(r => r.routeKey)])];
  const stateKeys = routeKeys.flatMap(k => [`subs:${slug(k)}`, `lastsent:${slug(k)}`, `timetablenotice:${slug(k)}`]);
  const values = await kvGetJsonMany([...stateKeys, 'health_state']);
  const state = Object.fromEntries(stateKeys.map((k, i) => [k, values[i]]));
  const healthState = values.at(-1);

  const pushes = [];
  for (const d of disrupted) {
    // As the card: CalMac cancelling the route makes it 0%, whatever the weather
    const chance = d.status === 'cancelled' ? 0 : chances[d.routeKey] ?? null;
    const subs = state[`subs:${slug(d.routeKey)}`] || [];
    const lastSent = state[`lastsent:${slug(d.routeKey)}`] || 0;
    const entry = { route: d.routeKey, calMacStatus: d.status, chance, subscribers: subs.length };
    if (chance === null || chance >= NOTIFY_THRESHOLD) entry.push = `no (chance ${chance ?? 'unknown'})`;
    else if (!subs.length) entry.push = 'no (no subscribers)';
    else if (lastSent >= Date.now() - PUSH_EVERY_MS) entry.push = 'no (sent in the last 2 hours)';
    else if (dry) entry.push = 'would send';
    else {
      try {
        const result = await notify({
          action: 'send', route: d.routeKey, chance,
          message: d.status === 'cancelled'
            ? `All sailings cancelled on ${d.routeKey} today.`
            : `Disruptions reported on ${d.routeKey}. Sailing chance: ${chance}%.`,
        });
        await kvSetJson(`lastsent:${slug(d.routeKey)}`, Date.now());
        entry.push = `sent to ${result?.sent ?? '?'}`;
      } catch (err) {
        entry.push = `failed: ${err.message}`;
      }
    }
    pushes.push(entry);
  }

  // ── 2. New timetable notices ──
  const notices = [];
  for (const route of statusData.routes || []) {
    if (!route.routeKey || !route.timetableNotice) continue;
    const key = `timetablenotice:${slug(route.routeKey)}`;
    if (route.timetableNotice.title === state[key]?.title) continue;
    const subs = state[`subs:${slug(route.routeKey)}`] || [];
    const entry = { route: route.routeKey, notice: route.timetableNotice.title, subscribers: subs.length };
    if (dry) entry.push = subs.length ? 'would send' : 'no (no subscribers)';
    else {
      await kvSetJson(key, { title: route.timetableNotice.title, seen: Date.now() });
      try {
        entry.push = subs.length ? `sent to ${(await notify({ action: 'send', route: route.routeKey, message: `${route.routeKey}: ${route.timetableNotice.title}` }))?.sent ?? '?'}` : 'no (no subscribers)';
      } catch (err) {
        entry.push = `failed: ${err.message}`;
      }
    }
    notices.push(entry);
  }

  // ── 3. Health email, for a service down for 15 minutes ──
  const now = Date.now();
  const { next, toEmail } = healthUpdate(healthState, health, now);
  let email = null;
  if (toEmail.length) {
    if (dry) email = 'would send';
    else {
      email = await sendHealthEmail(toEmail);
      if (email?.ok) for (const { name } of toEmail) next[name].emailedAt = now;
    }
  }
  if (!dry) await kvSetJson('health_state', next);

  say(`${disrupted.length} disrupted routes, ${pushes.filter(p => /^sent|^would/.test(p.push)).length} disruption pushes, ${notices.length} new notices, ${health.failed.length} failed checks.`);
  return {
    ok: true,
    calmacStatus: !statusData.fallback,
    ...(forecastError && { forecastError }),
    ...(savedMinutesAgo && { forecastSavedMinutesAgo: savedMinutesAgo }),
    pushes,
    notices,
    health: { failed: health.failed, unknown: health.unknown, email, failing: Object.fromEntries(Object.entries(next).filter(([, s]) => s.failingSince).map(([n, s]) => [n, new Date(s.failingSince).toISOString()])) },
  };
}

await runJob({ name: 'alerts', skipWithin: 10 * 60 * 1000 }, alerts);
