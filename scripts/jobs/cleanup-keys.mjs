// GitHub Actions, by hand, once: deletes Redis keys nothing uses any more,
// left from the Vercel jobs and the Google Sheet, and the timetable PDF lists
// of CalMac pages since renamed. accuracy:log is kept as an archive. Dry
// lists what it would delete.

import { KV_TOKEN, KV_URL } from '../../lib/kv.js';
import { runJob, say } from './common.mjs';
import { ROUTE_PAGES } from './timetablePages.mjs';

const UNUSED = ['jobs:vercel:*', 'diag:*', 'sailings:thresholds', 'import:sheet', 'health_alert_sent'];

async function command(args) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`Redis HTTP ${r.status}${j.error ? `: ${j.error}` : ''}`);
  return j.result;
}

async function keysMatching(pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await command(['SCAN', cursor, 'MATCH', pattern, 'COUNT', '500']);
    keys.push(...batch);
    cursor = String(next);
  } while (cursor !== '0');
  return keys;
}

await runJob({ name: 'cleanup-keys' }, async ({ dry }) => {
  const current = new Set(Object.values(ROUTE_PAGES).flat().map(slug => `timetable_pdfs:${slug}`));
  const found = (await Promise.all(UNUSED.map(keysMatching))).flat();
  const oldPages = (await keysMatching('timetable_pdfs:*')).filter(k => !current.has(k));
  const doomed = [...new Set([...found, ...oldPages])];
  if (!dry && doomed.length) await command(['DEL', ...doomed]);
  say(`${dry ? 'Would delete' : 'Deleted'} ${doomed.length} keys: ${doomed.join(', ') || 'none'}`);
  return { ok: true, deleted: dry ? 0 : doomed.length, keys: doomed };
});
