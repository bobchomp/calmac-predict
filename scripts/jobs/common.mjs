// Shared by the GitHub Actions jobs (scripts/jobs/*.mjs): settings and the
// run's summary. MODE=dry (the workflow's input) works everything out but
// saves and sends nothing. SITE=dev (a run from the dev branch) has the dev
// database and never sends anything.

import { appendFileSync } from 'node:fs';
import { kvGetJsonMany, kvSetJson } from '../../lib/kv.js';
import { getJson as getJsonRetrying } from '../../lib/tracker.js';

export const BASE_URL = process.env.CRON_BASE_URL || 'https://www.willitsail.co.uk';
export const CRON_SECRET = process.env.CRON_SECRET || '';
export const IS_DEV = process.env.SITE === 'dev';

const lastRunKey = name => `jobs:github:${name}`;

const lines = [];
export const say = (line = '') => { console.log(line); lines.push(line); };
export const writeSummary = () => {
  if (process.env.GITHUB_STEP_SUMMARY && lines.length) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
};

// A JSON request, tried again on a busy reply (lib/tracker.js)
export const getJson = (url, ms = 15000) => getJsonRetrying(url, ms);

// Runs a job: job({ dry }) returns a short summary object.
//   name        its Redis note, jobs:github:<name>
//   skipWithin  ms: a scheduled (fallback) run is skipped if one ran this recently
export async function runJob({ name, skipWithin }, job) {
  const missing = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', ...(IS_DEV ? [] : ['CRON_SECRET'])].filter(k => !process.env[k]);
  if (missing.length) {
    say(`❌ Missing ${missing.join(', ')}`);
    process.exitCode = 1;
    return writeSummary();
  }
  try {
    const [last] = await kvGetJsonMany([lastRunKey(name)]);
    if (process.env.GITHUB_EVENT_NAME === 'schedule' && skipWithin && last && Date.now() - Date.parse(last.at) < skipWithin) {
      say(`Skipped: the last run was at ${last.at}, so cron-job.org is calling this job (this scheduled run is the fallback).`);
      return writeSummary();
    }
    const dry = process.env.MODE === 'dry';
    say(`## ${name}: ${dry ? 'dry run' : 'live'}${IS_DEV ? ' (dev)' : ''}`);
    const result = await job({ dry });
    say();
    say('```json');
    say(JSON.stringify(result, null, 2));
    say('```');
    await kvSetJson(lastRunKey(name), { at: new Date().toISOString(), dry, ok: result?.ok !== false, event: process.env.GITHUB_EVENT_NAME || null });
    if (result?.ok === false) process.exitCode = 1;
  } catch (err) {
    say(`❌ ${err.stack || err.message}`);
    await kvSetJson(lastRunKey(name), { at: new Date().toISOString(), ok: false, error: err.message }).catch(() => {});
    process.exitCode = 1;
  }
  writeSummary();
}

// Asks the site to push a notification (the push keys stay on Vercel)
export async function notify(body) {
  if (IS_DEV) throw new Error('alerts are off on dev');
  const r = await fetch(`${BASE_URL}/api/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`notify ${body.action}: HTTP ${r.status}${json?.error ? ` (${json.error})` : ''}`);
  return json;
}
