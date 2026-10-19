// Upstash Redis over its REST API (server only). Commands are POSTed as JSON
// arrays, so large values travel in the body rather than the URL.

// Vercel preview deployments (dev.willitsail.co.uk and pull request previews)
// use the dev database only, never production's, whatever else is set. The
// GitHub Actions jobs are handed the right one by their workflow.
export const IS_PREVIEW = process.env.VERCEL_ENV === 'preview';
export const KV_URL   = (IS_PREVIEW ? process.env.DEV_UPSTASH_REDIS_REST_URL   : process.env.UPSTASH_REDIS_REST_URL)   || '';
export const KV_TOKEN = (IS_PREVIEW ? process.env.DEV_UPSTASH_REDIS_REST_TOKEN : process.env.UPSTASH_REDIS_REST_TOKEN) || '';

export const kvConfigured = () => !!KV_URL;

async function command(args) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Redis HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`Redis: ${j.error}`);
  return j.result;
}

// JSON values for several keys at once (null where missing)
export async function kvGetJsonMany(keys) {
  if (!KV_URL || !keys.length) return keys.map(() => null);
  const values = await command(['MGET', ...keys]);
  return values.map(v => (v ? JSON.parse(v) : null));
}

export async function kvSetJson(key, value, expireSeconds) {
  if (!KV_URL) return;
  await command(['SET', key, JSON.stringify(value), ...(expireSeconds ? ['EX', String(expireSeconds)] : [])]);
}
