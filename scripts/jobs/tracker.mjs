// GitHub Actions: every 15 minutes (cron-job.org, with an hourly fallback).
// The per-sailing log, and the status-and-weather snapshots (lib/tracker.js).
// On dev, the log only: the snapshots are production's archive.

import { runTracker } from '../../lib/tracker.js';
import { BASE_URL, IS_DEV, runJob } from './common.mjs';

await runJob({ name: 'tracker', skipWithin: 20 * 60 * 1000 }, ({ dry }) =>
  runTracker({ baseUrl: BASE_URL, snapshot: !IS_DEV, dry }));
