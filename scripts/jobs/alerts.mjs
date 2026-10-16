// GitHub Actions: every 5 minutes (cron-job.org, with an hourly fallback).
// Replaces /api/cron:
// 1. Push alerts to a route's subscribers when CalMac reports disruption and
//    the site's sailing chance is under 70% (at most every 2 hours a route)
// 2. Push alerts for a route's new timetable notices
// 3. An email when one of the services the site needs breaks (once per
//    change in what's broken)
// The timetable PDF check that /api/cron also ran is now daily (daily.mjs).

import { forecastUrls } from '../../lib/forecast.js';
import { kvGetJsonMany, kvSetJson } from '../../lib/kv.js';
import { calcOverallRisk, chanceFromRisk, historicalReliability } from '../../lib/risk.js';
import { ROUTES } from '../../lib/routes.js';
import { loadThresholds } from '../../lib/thresholds.js';
import { BASE_URL, VERCEL_CRON_KEY, getJson, notify, ranWithin, runJob, say } from './common.mjs';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ALERT_FROM = 'Will It Sail <info@willitsail.co.uk>';
const ALERT_TO = ['teddaharry@gmail.com', 'ross.mackenzie1@invernessroyalacademy.org.uk'];

const NOTIFY_THRESHOLD = 70;
const PUSH_EVERY_MS = 2 * 60 * 60 * 1000;

const slug = routeKey => routeKey.replace(/[^a-z0-9]/gi, '_');
const ukParts = () => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', month: 'numeric', hourCycle: 'h23' })
  .formatToParts(new Date()).map(p => [p.type, p.value]));

// Each route's sailing chance over the next 12 hours, as /api/weather works
// it out (the same forecast, thresholds and sums), for all routes in one go
async function sailingChances() {
  const { windUrl, marineUrl } = forecastUrls();
  const [wind, marine, thresholds] = await Promise.allSettled([getJson(windUrl), getJson(marineUrl), loadThresholds()]);
  if (wind.status === 'rejected') return { chances: {}, error: wind.reason.message };
  const asArray = v => (Array.isArray(v) ? v : [v]);
  const windArr = asArray(wind.value);
  const marineArr = marine.status === 'fulfilled' ? asArray(marine.value) : [];
  const t = thresholds.status === 'fulfilled' ? thresholds.value.thresholds : null;
  const parts = ukParts();
  const hour = Number(parts.hour), month1 = Number(parts.month);
  const chances = {};
  ROUTES.forEach((r, i) => {
    const hourly = windArr[i]?.hourly;
    if (!hourly) return;
    const risk = calcOverallRisk(r.name, hour, hourly, marineArr[i]?.hourly || null, month1 - 1);
    chances[r.name] = chanceFromRisk(risk, historicalReliability(t, r.name, month1));
  });
  return { chances };
}

// The services the site needs (as the Status tab checks them)
async function healthChecks(statusData) {
  const failed = [];
  // Tried again on a busy reply, so a moment's 429 isn't reported as an outage
  const check = async (name, url, what) => {
    try {
      const j = await getJson(url, 8000);
      const one = Array.isArray(j) ? j[0] : j;
      if (name === 'Weather API' && !one?.hourly?.windspeed_10m?.length) failed.push({ name, detail: 'Open-Meteo responded but returned no hourly data' });
    } catch (e) {
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
  return failed;
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
  const [statusData, { chances, error: forecastError }] = await Promise.all([
    getJson(`${BASE_URL}/api/status`, 15000).catch(err => ({ fallback: true, error: err.message, routes: [] })),
    sailingChances(),
  ]);
  const failedChecks = await healthChecks(statusData);
  const known = new Set(ROUTES.map(r => r.name));

  // ── 1. Disruption pushes ──
  const disrupted = (statusData.disrupted || []).filter(d => d.routeKey && known.has(d.routeKey));
  const routeKeys = [...new Set([...disrupted.map(d => d.routeKey), ...(statusData.routes || []).filter(r => r.routeKey && r.timetableNotice).map(r => r.routeKey)])];
  const stateKeys = routeKeys.flatMap(k => [`subs:${slug(k)}`, `lastsent:${slug(k)}`, `timetablenotice:${slug(k)}`]);
  const values = await kvGetJsonMany([...stateKeys, 'health_alert_sent']);
  const state = Object.fromEntries(stateKeys.map((k, i) => [k, values[i]]));
  const lastHealthAlert = values.at(-1);

  const pushes = [];
  for (const d of disrupted) {
    const chance = chances[d.routeKey] ?? null;
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

  // ── 3. Health email, when what's broken changes ──
  let email = null;
  if (failedChecks.length) {
    const fingerprint = failedChecks.map(c => c.name).sort().join(',');
    if (lastHealthAlert?.fingerprint !== fingerprint) {
      if (dry) email = 'would send';
      else {
        await kvSetJson('health_alert_sent', { fingerprint, sentAt: Date.now() });
        email = await sendHealthEmail(failedChecks);
      }
    } else email = 'already sent for this';
  } else if (lastHealthAlert && !dry) {
    // All clear: email again if something breaks later
    await kvSetJson('health_alert_sent', null);
  }

  say(`${disrupted.length} disrupted routes, ${pushes.filter(p => /^sent|^would/.test(p.push)).length} disruption pushes, ${notices.length} new notices, ${failedChecks.length} failed checks.`);
  return {
    ok: true,
    calmacStatus: !statusData.fallback,
    ...(forecastError && { forecastError }),
    pushes,
    notices,
    health: { failed: failedChecks, email },
  };
}

await runJob({ name: 'alerts', vercelBusy: () => ranWithin(VERCEL_CRON_KEY, 12 * 60 * 1000), skipWithin: 10 * 60 * 1000 }, alerts);
