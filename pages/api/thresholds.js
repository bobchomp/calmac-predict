// GET /api/thresholds — the historical thresholds the cards use
// (lib/thresholds.js): { thresholds: { [route]: { base, winter, summer,
// shoulder, samples, updated } }, generated, source }. They change monthly
// at most, so the CDN keeps them for an hour.

import { loadThresholds } from '../../lib/thresholds';

export default async function handler(req, res) {
  const { thresholds, at, source } = await loadThresholds();
  if (!thresholds) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Thresholds unavailable' });
  }
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ thresholds, generated: at || null, source });
}
