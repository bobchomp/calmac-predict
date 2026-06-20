// api/cron.js — daily 8am UTC
// 1. Fetches live CalMac service status via GraphQL
// 2. Records any cancellations/disruptions to Google Sheet (ground truth log)
// 3. Sends push notifications to subscribers of affected routes
// 4. Emails teddaharry@gmail.com + ross.mackenzie1@invernessroyalacademy.org.uk
//    when NEW disruptions appear (first seen, not every day ongoing)

const BASE_URL = process.env.CRON_BASE_URL || 'https://calmac-predict.vercel.app';

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL   || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const SHEET_URL = process.env.FEEDBACK_SHEET_URL || '';

const RESEND_API_KEY  = process.env.RESEND_API_KEY || '';
const ALERT_FROM      = 'noreply@rossmackenzie.co.uk';
const ALERT_TO        = ['teddaharry@gmail.com', 'ross.mackenzie1@invernessroyalacademy.org.uk'];

const NOTIFY_THRESHOLD = 70;

// ── Upstash helpers ──────────────────────────────────────────────────────
async function kvGet(key) {
  if (!KV_URL) return null;
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}

async function kvSet(key, value) {
  if (!KV_URL) return;
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

async function kvKeys(pattern) {
  if (!KV_URL) return [];
  const r = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const j = await r.json();
  return j.result || [];
}

// ── Route coords for weather lookup ────────────────────────────────────
const ROUTE_COORDS = {
  'Ullapool - Stornoway (Lewis)':                      { lat: 58.05, lon: -5.85 },
  'Troon - Brodick (Arran)':                           { lat: 55.60, lon: -5.00 },
  'Ardrossan - Brodick (Arran)':                       { lat: 55.60, lon: -5.10 },
  'Oban - Craignure (Mull)':                           { lat: 56.49, lon: -5.56 },
  'Kennacraig - Port Ellen / Port Askaig (Islay)':     { lat: 55.75, lon: -5.90 },
  'Wemyss Bay - Rothesay (Bute)':                      { lat: 55.88, lon: -5.02 },
  'Gourock - Dunoon':                                  { lat: 55.96, lon: -4.86 },
  'Tarbert - Portavadie':                              { lat: 55.88, lon: -5.42 },
  'Fishnish - Lochaline':                              { lat: 56.53, lon: -5.72 },
  'Mallaig - Armadale (Skye)':                         { lat: 57.04, lon: -5.82 },
  'Uig - Tarbert / Lochmaddy':                         { lat: 57.65, lon: -6.75 },
  'Oban - Coll / Tiree':                               { lat: 56.55, lon: -6.50 },
  'Oban - Castlebay / Lochboisdale':                   { lat: 56.70, lon: -7.00 },
  'Oban - Colonsay':                                   { lat: 56.15, lon: -6.10 },
  'Claonaig - Lochranza (Arran)':                      { lat: 55.73, lon: -5.17 },
  'Colintraive - Rhubodach (Bute)':                    { lat: 55.92, lon: -5.15 },
  'Largs - Cumbrae Slip':                              { lat: 55.81, lon: -4.90 },
  'Oban - Lismore':                                    { lat: 56.52, lon: -5.47 },
  'Mallaig - Small Isles':                             { lat: 56.98, lon: -6.10 },
  'Tobermory - Kilchoan':                              { lat: 56.69, lon: -6.07 },
};

// ── App health checks (mirrors the Status tab in the UI) ─────────────────
// Returns array of failed checks: { name, detail }
// Push Notifications and Service Worker are client-side only — skipped here.
async function runHealthChecks(statusData) {
  const failed = [];

  // 1. Weather API
  try {
    const t0 = Date.now();
    const r  = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=57.0&longitude=-5.8&hourly=windspeed_10m&forecast_days=1',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) failed.push({ name: 'Weather API', detail: `HTTP ${r.status} — weather data unavailable` });
    else {
      const ms  = Date.now() - t0;
      const j   = await r.json().catch(() => null);
      const pts = j?.hourly?.windspeed_10m?.length || 0;
      if (pts === 0) failed.push({ name: 'Weather API', detail: `Open-Meteo responded (${ms}ms) but returned no hourly data` });
    }
  } catch (e) {
    failed.push({ name: 'Weather API', detail: e.message });
  }

  // 2. Marine / Wave API (amber in UI, but still worth alerting if fully down)
  try {
    const r = await fetch(
      'https://marine-api.open-meteo.com/v1/marine?latitude=57.0&longitude=-5.8&hourly=wave_height&forecast_days=1',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) failed.push({ name: 'Marine / Wave API', detail: `HTTP ${r.status} — wave predictions unavailable` });
  } catch (e) {
    failed.push({ name: 'Marine / Wave API', detail: e.message });
  }

  // 3. CalMac Status API — already fetched, just inspect the result
  if (!statusData || statusData.fallback === true) {
    failed.push({
      name:   'CalMac Status API',
      detail: statusData?.error
        ? `API unavailable: ${statusData.error}`
        : 'API unavailable — app is showing fallback link to CalMac website',
    });
  } else if (!statusData.routes?.length) {
    failed.push({ name: 'CalMac Status API', detail: 'API responded but returned 0 routes' });
  }

  return failed;
}

// ── Email health alert via Resend ─────────────────────────────────────────
async function sendHealthAlertEmail(failedChecks, isTest = false, overrideTo = null) {
  if (!RESEND_API_KEY || !failedChecks.length) return null;

  const rows = failedChecks.map(c => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600">${c.name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;color:#b91c1c">${c.detail}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#7f1d1d;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:20px">🚨 Will It Sail — App Error${isTest ? ' (test)' : ''}</h1>
        <p style="margin:4px 0 0;opacity:.8;font-size:13px">${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' })}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
        <p style="margin:16px 20px 12px;color:#374151;font-size:14px">
          ${failedChecks.length === 1 ? '1 service' : `${failedChecks.length} services`} ${isTest ? 'would be' : 'are'} reporting errors:
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
          <a href="https://willitsail.rossmackenzie.co.uk/#status" style="color:#7f1d1d">View Status page →</a>
        </p>
      </div>
    </div>`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    ALERT_FROM,
        ...(overrideTo ? { to: overrideTo } : { to: ALERT_FROM, bcc: ALERT_TO }),
        subject: isTest
          ? 'Will It Sail — test health alert'
          : `Will It Sail — ${failedChecks.length === 1 ? failedChecks[0].name : `${failedChecks.length} services`} down`,
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

// ── Write a cancellation record to Google Sheet ────────────────────────
async function recordToSheet(route, calMacStatus, predictedChance) {
  if (!SHEET_URL) return;
  const row = {
    timestamp:       new Date().toISOString(),
    route,
    sailed:          calMacStatus === 'cancelled' ? 'NO' : 'YES',
    calMacStatus,
    predictedChance: predictedChance ?? '',
    source:          'calmac-graphql-api',
  };
  try {
    await fetch(SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('Sheet write failed:', err.message);
  }
}

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  // Accept auth from:
  // 1. Vercel cron: Authorization: Bearer <secret>
  // 2. cron-job.org: GET /api/cron?secret=<secret>
  const headerAuth = req.headers['authorization'] === `Bearer ${secret}`;
  const queryAuth  = req.query?.secret === secret;
  if (!headerAuth && !queryAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Test email action — returns an HTML page ──
  if (req.query?.action === 'test-email') {
    const customTo = (req.query?.to || '').trim();
    let sendResult = null;

    if (customTo) {
      sendResult = await sendHealthAlertEmail([
        { name: 'Weather API',       detail: 'HTTP 503 — test alert only, no real error' },
        { name: 'CalMac Status API', detail: 'API unavailable — test alert only, no real error' },
      ], true, customTo);
      if (sendResult) sendResult.to = customTo;
    } else {
      // Default test — fake health alert to the normal BCC recipients
      sendResult = await sendHealthAlertEmail([
        { name: 'Weather API',       detail: 'HTTP 503 — test alert only, no real error' },
        { name: 'CalMac Status API', detail: 'API unavailable — test alert only, no real error' },
      ], true);
      if (sendResult) sendResult.to = ALERT_TO.join(', ') + ' (BCC)';
    }

    const resultBox = sendResult
      ? sendResult.ok
        ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:12px 16px;margin-bottom:20px;color:#166534">
            ✓ Sent successfully${sendResult.id ? ` · ID: <code>${sendResult.id}</code>` : ''}<br>
            <span style="font-size:13px;opacity:.8">To: ${sendResult.to || '—'}</span>
           </div>`
        : `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:12px 16px;margin-bottom:20px;color:#991b1b">
            ✗ Failed: ${sendResult.error || 'unknown error'}
           </div>`
      : '';

    const pageSecret = encodeURIComponent(secret || '');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Will It Sail — Email Test</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 48px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 1.2rem; margin: 0 0 4px; }
    p.sub { color: #6b7280; font-size: 13px; margin: 0 0 24px; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .card h2 { font-size: .95rem; margin: 0 0 12px; color: #374151; }
    .card p { font-size: 13px; color: #6b7280; margin: 0 0 12px; }
    input[type=email] { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; margin-bottom: 10px; }
    button { background: #1e3a5f; color: #fff; border: none; border-radius: 6px; padding: 9px 18px; font-size: 14px; cursor: pointer; }
    button:hover { background: #2d5282; }
    a.btn { display:inline-block; background:#374151; color:#fff; border-radius:6px; padding:9px 18px; font-size:14px; text-decoration:none; }
    a.btn:hover { background:#1f2937; }
  </style>
</head>
<body>
  <h1>Will It Sail — Email Test</h1>
  <p class="sub">Send test alerts to verify Resend is working.</p>

  ${resultBox}

  <div class="card">
    <h2>Standard test</h2>
    <p>Sends a fake health-alert email to the normal BCC recipients (teddaharry@gmail.com &amp; ross.mackenzie1@invernessroyalacademy.org.uk).</p>
    <a class="btn" href="?secret=${pageSecret}&action=test-email">Send test alert</a>
  </div>

  <div class="card">
    <h2>One-off send</h2>
    <p>Send a plain test email to any address.</p>
    <form method="GET" action="">
      <input type="hidden" name="secret" value="${secret || ''}">
      <input type="hidden" name="action" value="test-email">
      <input type="email" name="to" placeholder="recipient@example.com" required>
      <button type="submit">Send</button>
    </form>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  }

  const results = [];

  try {
    // ── Step 1: fetch live CalMac status ──
    const statusResp = await fetch(`${BASE_URL}/api/status`, {
      signal: AbortSignal.timeout(12000),
    });
    const statusData = statusResp.ok ? await statusResp.json() : { routes: [], disrupted: [] };
    const disrupted = statusData.disrupted || [];

    // ── Step 2: for each disrupted route, get predicted chance & record to sheet ──
    for (const disruption of disrupted) {
      const routeKey = disruption.routeKey;
      if (!routeKey || !ROUTE_COORDS[routeKey]) continue;

      const coords = ROUTE_COORDS[routeKey];
      let predictedChance = null;

      try {
        const weatherResp = await fetch(
          `${BASE_URL}/api/weather?lat=${coords.lat}&lon=${coords.lon}&route=${encodeURIComponent(routeKey)}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (weatherResp.ok) {
          const weather = await weatherResp.json();
          predictedChance = weather?.sailingChance ?? weather?.chance ?? null;
        }
      } catch (_) {}

      // Record to Google Sheet as ground truth
      await recordToSheet(routeKey, disruption.status, predictedChance);
      results.push({ route: routeKey, calMacStatus: disruption.status, predictedChance, recorded: true });

      // ── Step 3: send push notifications if subscribed & below threshold ──
      if (predictedChance !== null && predictedChance < NOTIFY_THRESHOLD && KV_URL) {
        const subKey = `subs:${routeKey.replace(/[^a-z0-9]/gi, '_')}`;
        const subs = (await kvGet(subKey)) || [];
        if (subs.length > 0) {
          const lastSent = (await kvGet(`lastsent:${routeKey.replace(/[^a-z0-9]/gi, '_')}`)) || 0;
          const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
          if (lastSent < twoHoursAgo) {
            try {
              const notifyResp = await fetch(`${BASE_URL}/api/notify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'send',
                  route: routeKey,
                  chance: predictedChance,
                  message: disruption.status === 'cancelled'
                    ? `All sailings cancelled on ${routeKey} today.`
                    : `Disruptions reported on ${routeKey}. Sailing chance: ${predictedChance}%.`,
                }),
              });
              const notifyResult = await notifyResp.json();
              await kvSet(`lastsent:${routeKey.replace(/[^a-z0-9]/gi, '_')}`, Date.now());
              results[results.length - 1].pushed = notifyResult.sent;
            } catch (_) {}
          }
        }
      }
    }

    // ── Step 4: health check — email if any service is broken ──
    const failedChecks = await runHealthChecks(statusData);
    let emailResult = null;

    if (failedChecks.length > 0 && KV_URL) {
      // Dedup: store a fingerprint of which services are failing; only email when it changes
      const fingerprint = failedChecks.map(c => c.name).sort().join(',');
      const lastAlert   = await kvGet('health_alert_sent');
      if (lastAlert?.fingerprint !== fingerprint) {
        await kvSet('health_alert_sent', { fingerprint, sentAt: Date.now() });
        emailResult = await sendHealthAlertEmail(failedChecks);
      }
    } else if (failedChecks.length === 0 && KV_URL) {
      // All clear — reset so we email again if something breaks later
      await kvSet('health_alert_sent', null);
    }

    // ── Check for new timetable notices (amended timetable / vessel substitution) ──
    for (const route of (statusData.routes || [])) {
      const routeKey = route.routeKey;
      if (!routeKey || !route.timetableNotice) continue;

      const notice    = route.timetableNotice;
      const noticeKey = `timetablenotice:${routeKey.replace(/[^a-z0-9]/gi, '_')}`;
      const lastNotice = await kvGet(noticeKey);

      // Push only when this is a title we haven't seen before for this route
      if (notice.title !== lastNotice?.title && KV_URL) {
        await kvSet(noticeKey, { title: notice.title, seen: Date.now() });

        try {
          const subKey = `subs:${routeKey.replace(/[^a-z0-9]/gi, '_')}`;
          const subs = (await kvGet(subKey)) || [];
          if (subs.length > 0) {
            await fetch(`${BASE_URL}/api/notify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action:  'send',
                route:   routeKey,
                message: `${routeKey}: ${notice.title}`,
              }),
            });
          }
          results.push({ route: routeKey, timetableNotice: notice.title, pushed: true });
        } catch (_) {}
      }
    }

    // ── Check for new seasonal timetable PDFs on calmac.co.uk ────────────
    let timetableResult = null;
    try {
      const ttResp = await fetch(`${BASE_URL}/api/check-timetables?secret=${encodeURIComponent(secret || '')}`, {
        signal: AbortSignal.timeout(55000),
      });
      timetableResult = ttResp.ok ? await ttResp.json() : { error: `HTTP ${ttResp.status}` };
    } catch (err) {
      timetableResult = { error: err.message };
    }

    return res.status(200).json({
      ok: true,
      disrupted: disrupted.length,
      recorded: results.filter(r => r.recorded).length,
      results,
      healthChecks: { failed: failedChecks.length, checks: failedChecks, emailSent: !!emailResult, emailResult },
      timetables: timetableResult,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};