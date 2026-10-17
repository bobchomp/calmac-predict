// The historical thresholds for the site (/api/thresholds) and the GitHub
// Actions jobs: { [route]: { base, winter, summer, shoulder, samples,
// updated } }, kept in Redis under `thresholds` and worked out from CalMac's
// reliability figures by the monthly job (scripts/jobs/reliability/).

import { kvGetJsonMany } from './kv';

export const THRESHOLDS_KEY = 'thresholds';

// { thresholds (or null), at, source: 'upstash' | null, error }
export async function loadThresholds() {
  try {
    const [stored] = await kvGetJsonMany([THRESHOLDS_KEY]);
    if (stored?.thresholds) return { thresholds: stored.thresholds, at: stored.at, source: 'upstash' };
    return { thresholds: null, at: null, source: null, error: 'none saved' };
  } catch (err) {
    return { thresholds: null, at: null, source: null, error: err.message };
  }
}
