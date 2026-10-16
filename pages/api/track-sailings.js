// api/track-sailings.js — the per-sailing log (lib/tracker.js), until the
// GitHub Actions tracker takes over. Called by cron-job.org every 15 minutes:
//   GET /api/track-sailings  with header  Authorization: Bearer <CRON_SECRET>

import { kvConfigured } from '../../lib/kv';
import { runTracker } from '../../lib/tracker';

const BASE_URL = process.env.CRON_BASE_URL || 'https://www.willitsail.co.uk';
const CRON_SECRET = process.env.CRON_SECRET || '';

export default async function handler(req, res) {
  const secret = req.query?.secret || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!CRON_SECRET || secret !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!kvConfigured()) return res.status(200).json({ ok: false, note: 'Redis not configured' });

  const result = await runTracker({ baseUrl: BASE_URL, by: 'vercel' });
  if (!result.ok) console.error('[track-sailings] failed', result.error);
  return res.status(result.ok ? 200 : 500).json(result);
}
