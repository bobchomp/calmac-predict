// The Google Sheet's historical thresholds for server code (the sailing log
// and api/weather.js), as the site itself loads them. They change rarely, so
// a copy is kept in Redis: used while it's under 6 hours old, and whenever
// the Sheet can't be reached (Apps Script is slow to start).

import { SHEET_SCRIPT_URL as SITE_SHEET_URL } from './config';
import { kvGetJsonMany, kvSetJson } from './kv';

const KEY = 'sailings:thresholds';
const FRESH_MS = 6 * 60 * 60 * 1000;

// The site's own Sheet first, so the chances match the site's; then the
// server's SHEET_SCRIPT_URL, if that's a different one
const SHEETS = [...new Set([SITE_SHEET_URL, process.env.SHEET_SCRIPT_URL].filter(Boolean))];

// { thresholds (or null), source: 'saved copy' | 'sheet' | 'old saved copy' | null, error }
export async function loadThresholds() {
  const [saved] = await kvGetJsonMany([KEY]).catch(() => [null]);
  if (saved?.thresholds && Date.now() - Date.parse(saved.at) < FRESH_MS) return { thresholds: saved.thresholds, source: 'saved copy' };

  const errors = [];
  for (const url of SHEETS) {
    try {
      const r = await fetch(`${url}?action=getThresholds`, { signal: AbortSignal.timeout(25000) });
      const json = await r.json();
      if (!json.thresholds) throw new Error(json.error || 'no thresholds in the reply');
      await kvSetJson(KEY, { at: new Date().toISOString(), thresholds: json.thresholds }).catch(() => {});
      return { thresholds: json.thresholds, source: 'sheet' };
    } catch (err) {
      errors.push(`${url === SITE_SHEET_URL ? "site's Sheet" : 'SHEET_SCRIPT_URL'}: ${err.message}`);
    }
  }
  return { thresholds: saved?.thresholds || null, source: saved?.thresholds ? 'old saved copy' : null, error: errors.join('; ') };
}
