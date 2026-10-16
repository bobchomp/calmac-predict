// Shared by the GitHub Actions jobs (scripts/jobs/*.mjs): settings, the
// handover from the Vercel jobs they replace, and the run's summary.
//
// Handover: while the Vercel version of a job is still being called by
// cron-job.org, the GitHub one runs dry (works everything out, saves and
// sends nothing) so the two can be compared. Once cron-job.org calls GitHub
// instead, the Vercel one stops and the GitHub one goes live by itself.
// MODE=live or MODE=dry (the workflow's input) overrides that.

import { appendFileSync } from 'node:fs';
import { kvGetJsonMany, kvSetJson } from '../../lib/kv.js';
import { getJson as getJsonRetrying } from '../../lib/tracker.js';

export const BASE_URL = process.env.CRON_BASE_URL || 'https://www.willitsail.co.uk';
export const CRON_SECRET = process.env.CRON_SECRET || '';

// Set by pages/api/cron.js on each run
export const VERCEL_CRON_KEY = 'jobs:vercel:cron';
const lastRunKey = name => `jobs:github:${name}`;

const lines = [];
export const say = (line = '') => { console.log(line); lines.push(line); };
const writeSummary = () => {
  if (process.env.GITHUB_STEP_SUMMARY && lines.length) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
};

// A JSON request, tried again on a busy reply (lib/tracker.js)
export const getJson = (url, ms = 15000) => getJsonRetrying(url, ms);

// Runs a job: job({ dry }) returns a short summary object.
//   name        its Redis note, jobs:github:<name>
//   vercelBusy  async () => whether the Vercel version ran recently (dry if so)
//   skipWithin  ms: a scheduled (fallback) run is skipped if one ran this recently
export async function runJob({ name, vercelBusy, skipWithin }, job) {
  const missing = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'CRON_SECRET'].filter(k => !process.env[k]);
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
    const forced = { live: false, dry: true }[process.env.MODE];
    const dry = forced ?? (vercelBusy ? await vercelBusy() : false);
    say(`## ${name}: ${dry ? (forced ? 'dry run' : 'dry run (the Vercel job is still running)') : 'live'}`);
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

// Whether a Redis timestamp (ms, or { at }) is within the last `ms`
export async function ranWithin(key, ms) {
  const [v] = await kvGetJsonMany([key]);
  const at = typeof v === 'number' ? v : Date.parse(v?.at);
  return Number.isFinite(at) && Date.now() - at < ms;
}

// Asks the site to push a notification (the push keys stay on Vercel)
export async function notify(body) {
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
