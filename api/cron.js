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

// ── Email disruption alerts via Resend ──────────────────────────────────
async function sendDisruptionEmail(newDisruptions) {
  if (!RESEND_API_KEY || !newDisruptions.length) return null;

  const rows = newDisruptions.map(d => {
    const statusLabel = d.status === 'cancelled' ? 'Cancelled' : 'Disrupted';
    const detail = d.detail ? `<p style="margin:4px 0 0;color:#555;font-size:13px">${d.detail}</p>` : '';
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600">${d.routeKey}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee">
          <span style="background:${d.status === 'cancelled' ? '#fee2e2' : '#fef3c7'};color:${d.status === 'cancelled' ? '#b91c1c' : '#92400e'};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${statusLabel}</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;color:#333">
          ${d.reason || ''}${detail}
        </td>
      </tr>`;
  }).join('');

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto">
      <div style="background:#1e3a5f;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:20px">⚠️ CalMac Disruption Alert</h1>
        <p style="margin:4px 0 0;opacity:.8;font-size:13px">${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' })}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:0">
        <p style="margin:16px 20px 12px;color:#374151;font-size:14px">
          ${newDisruptions.length === 1 ? '1 new disruption' : `${newDisruptions.length} new disruptions`} reported on CalMac routes:
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb">Route</th>
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb">Status</th>
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb">Reason / Detail</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin:16px 20px;font-size:13px;color:#6b7280">
          <a href="https://calmac-predict.vercel.app" style="color:#1e3a5f">View live status →</a>
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
        from: ALERT_FROM,
        to:   ALERT_TO,
        subject: newDisruptions.length === 1
          ? `CalMac disruption: ${newDisruptions[0].routeKey}`
          : `CalMac disruptions: ${newDisruptions.length} routes affected`,
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

  // ── Test email action ──
  if (req.query?.action === 'test-email') {
    const result = await sendDisruptionEmail([{
      routeKey: 'Ullapool - Stornoway (Lewis)',
      status:   'disrupted',
      reason:   'Adverse weather conditions',
      detail:   'This is a test alert triggered manually. No real disruption exists.',
    }]);
    return res.status(200).json({ ok: true, test: true, email: result });
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

    // ── Step 4: email alerts for NEW disruptions (first appearance only) ──
    const emailCandidates = [];

    for (const route of (statusData.routes || [])) {
      const routeKey   = route.routeKey;
      if (!routeKey) continue;
      const alertKey   = `alert_sent:${routeKey.replace(/[^a-z0-9]/gi, '_')}`;
      const isDisrupted = route.status && !['normal', 'unknown'].includes(route.status);

      if (isDisrupted) {
        const sentRecord = await kvGet(alertKey);
        // Use status as dedup key — email again only if the status type changes
        const titleNow   = route.status;
        if (!sentRecord || sentRecord.title !== titleNow) {
          await kvSet(alertKey, { title: titleNow, sentAt: Date.now() });
          // Extract the best available detail from sailingStatuses
          const allEntries  = Object.values(route.sailingStatuses || {});
          const wildcard    = route.sailingStatuses?.['*'];
          const best        = wildcard || allEntries[0] || {};
          emailCandidates.push({
            routeKey,
            status: route.status,
            reason: best.reason || '',
            detail: best.detail ? best.detail.substring(0, 300) : '',
          });
        }
      } else {
        // Route back to normal — clear the sent record so we email again next disruption
        if (KV_URL) await kvSet(alertKey, null);
      }
    }

    let emailResult = null;
    if (emailCandidates.length > 0) {
      emailResult = await sendDisruptionEmail(emailCandidates);
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
      emailAlerts: emailResult ? { sent: emailCandidates.length, result: emailResult } : { sent: 0 },
      timetables: timetableResult,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};