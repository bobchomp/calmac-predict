// GitHub Actions: every 15 minutes (cron-job.org, with an hourly fallback).
// The per-sailing log, and the status-and-weather snapshots (lib/tracker.js).

import { runTracker } from '../../lib/tracker.js';
import { BASE_URL, runJob } from './common.mjs';

await runJob({ name: 'tracker', skipWithin: 20 * 60 * 1000 }, ({ dry }) =>
  runTracker({ baseUrl: BASE_URL, snapshot: true, dry }));
