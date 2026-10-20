// GitHub Actions: every 15 minutes (cron-job.org, with an hourly fallback).
// The per-sailing log, and the status-and-weather snapshots (lib/tracker.js).
// On dev, the log only (the snapshots are production's archive), and the
// summary adds how the new formula compares with the old over 30 days.

import { kvGetJsonMany } from '../../lib/kv.js';
import { STATS_KEY, addStats, figures } from '../../lib/sailingLog.js';
import { ukDateStr } from '../../lib/timetable.js';
import { runTracker } from '../../lib/tracker.js';
import { BASE_URL, IS_DEV, runJob } from './common.mjs';

await runJob({ name: 'tracker', skipWithin: 20 * 60 * 1000 }, async ({ dry }) => {
  const result = await runTracker({ baseUrl: BASE_URL, snapshot: !IS_DEV, dry });
  if (!IS_DEV) return result;
  const days = Array.from({ length: 30 }, (_, i) => ukDateStr(-i));
  const stats = await kvGetJsonMany(days.map(STATS_KEY)).catch(() => []);
  return { ...result, formulas30d: figures(addStats(stats)).comparison };
});
