// api/accuracy.js
// Serves prediction accuracy stats built from data points logged by api/cron.js
// Each point: { ts, r: routeKey, p: predictedChance, s: sailed (bool) }
// GET /api/accuracy

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL   || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function kvGet(key) {
  if (!KV_URL) return null;
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=300');

  const log = (await kvGet('accuracy:log')) || [];
  if (!log.length) {
    return res.status(200).json({ ok: true, points: 0, last30: 0 });
  }

  const now    = Date.now();
  const ms30   = 30 * 24 * 60 * 60 * 1000;
  const ms90   = 90 * 24 * 60 * 60 * 1000;
  const last30 = log.filter(p => p.ts > now - ms30);
  const last90 = log.filter(p => p.ts > now - ms90);

  // Calibration buckets — what % actually sailed when we predicted in this range?
  const buckets = [
    { label: '0–25%',   min: 0,  max: 25  },
    { label: '26–50%',  min: 26, max: 50  },
    { label: '51–75%',  min: 51, max: 75  },
    { label: '76–100%', min: 76, max: 100 },
  ].map(b => {
    const pts    = last90.filter(p => p.p >= b.min && p.p <= b.max);
    const sailed = pts.filter(p => p.s).length;
    return { ...b, count: pts.length, sailedPct: pts.length > 0 ? Math.round(sailed / pts.length * 100) : null };
  });

  // Binary accuracy over last 30 days: correct if (predicted > 50) === sailed
  const correct  = last30.filter(p => (p.p > 50) === p.s).length;
  const accuracy = last30.length > 0 ? Math.round(correct / last30.length * 100) : null;

  return res.status(200).json({
    ok: true,
    points:   last90.length,
    last30:   last30.length,
    accuracy,
    buckets,
    since: last90.length > 0 ? new Date(Math.min(...last90.map(p => p.ts))).toISOString() : null,
  });
};
