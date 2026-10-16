// GET /api/stats — the About tab's database figures: months of CalMac
// reliability figures and routes with thresholds, from Redis
// (scripts/import-sheet.mjs). Cached by the CDN for an hour.

import { kvConfigured, kvGetJsonMany } from '../../lib/kv';
import { THRESHOLDS_KEY } from '../../lib/thresholds';

export default async function handler(req, res) {
  try {
    if (!kvConfigured()) throw new Error('Redis not configured');
    const [reliability, thresholds] = await kvGetJsonMany(['reliability', THRESHOLDS_KEY]);
    if (!reliability || !thresholds) throw new Error('No figures saved');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      reliability_months: reliability.rows.length,
      routes_calibrated: Object.keys(thresholds.thresholds || {}).length,
      last_updated: thresholds.at || null,
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: err.message });
  }
}
