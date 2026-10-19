// GitHub Actions, by hand: copies what the dev site needs to start from out
// of the production database into the dev one: CalMac's reliability figures
// and the thresholds worked out from them. Production is only read.

import { say, writeSummary } from './common.mjs';

const KEYS = ['thresholds', 'reliability', 'reports'];
const PROD = { url: process.env.PROD_UPSTASH_REDIS_REST_URL, token: process.env.PROD_UPSTASH_REDIS_REST_TOKEN };
const DEV = { url: process.env.DEV_UPSTASH_REDIS_REST_URL, token: process.env.DEV_UPSTASH_REDIS_REST_TOKEN };

async function command(db, args) {
  const r = await fetch(db.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${db.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Redis HTTP ${r.status}${j.error ? `: ${j.error}` : ''}`);
  return j.result;
}

try {
  if (!PROD.url || !PROD.token || !DEV.url || !DEV.token) throw new Error('both databases\' URL and token are needed (DEV_UPSTASH_REDIS_REST_URL/TOKEN secrets)');
  if (new URL(PROD.url).host === new URL(DEV.url).host) throw new Error('the dev database is the production one');
  const values = await command(PROD, ['MGET', ...KEYS]);
  say('## Copied production → dev');
  for (const [i, key] of KEYS.entries()) {
    if (values[i] == null) { say(`- ${key}: not in production, skipped`); continue; }
    await command(DEV, ['SET', key, values[i]]);
    const v = JSON.parse(values[i]);
    const size = Array.isArray(v) ? v.length : Array.isArray(v?.rows) ? v.rows.length : v?.thresholds ? Object.keys(v.thresholds).length : null;
    say(`- ${key}: copied${size != null ? ` (${size} entries)` : ''}`);
  }
} catch (err) {
  say(`❌ ${err.message}`);
  process.exitCode = 1;
}
writeSummary();
