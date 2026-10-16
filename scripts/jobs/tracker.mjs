// GitHub Actions: every 15 minutes (cron-job.org, with an hourly fallback).
// The per-sailing log, and the status-and-weather snapshots that used to go
// to the Google Sheet (lib/tracker.js). Replaces /api/track-sailings and
// /api/record.

import { TRACKER_KEY } from '../../lib/sailingLog.js';
import { runTracker } from '../../lib/tracker.js';
import { kvGetJsonMany } from '../../lib/kv.js';
import { BASE_URL, runJob } from './common.mjs';

// The Vercel tracker's run note (by: 'vercel', or none from before this job)
async function vercelBusy() {
  const [note] = await kvGetJsonMany([TRACKER_KEY]);
  return !!note && note.by !== 'github' && Date.now() - Date.parse(note.at) < 25 * 60 * 1000;
}

await runJob({ name: 'tracker', vercelBusy, skipWithin: 20 * 60 * 1000 }, ({ dry }) =>
  runTracker({ baseUrl: BASE_URL, by: 'github', snapshot: true, dry }));
