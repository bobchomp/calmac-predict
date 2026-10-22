// api/warnings.js — the Met Office's weather warnings for the regions the
// routes are in (lib/metoffice.js), for the site's cards and the tracker:
//   GET /api/warnings → { ok, warnings: [{ id, level, type, areas, from, to, title, url }], failed }

import { METOFFICE_FEED, METOFFICE_REGIONS, mergeWarnings, parseWarnings } from '../../lib/metoffice';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = await Promise.allSettled(METOFFICE_REGIONS.map(async region => {
    const r = await fetch(METOFFICE_FEED(region), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseWarnings(await r.text());
  }));
  const failed = METOFFICE_REGIONS.filter((_, i) => results[i].status === 'rejected');
  if (failed.length === METOFFICE_REGIONS.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: results[0].reason?.message });
  }
  // The Met Office updates its feeds every few minutes at most
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=600');
  return res.status(200).json({ ok: true, warnings: mergeWarnings(results.filter(r => r.status === 'fulfilled').map(r => r.value)), failed });
}
