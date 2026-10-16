// The historical thresholds for the site (/api/thresholds) and server code
// (the sailing log and api/weather.js): { [route]: { base, winter, summer,
// shoulder, samples, updated } }, kept in Redis under `thresholds` since the
// move from the Google Sheet (scripts/import-sheet.mjs).
//
// Until the Sheet is retired it's the fallback if Redis has none: its last
// copy (sailings:thresholds, used while under 6 hours old), then the Sheet.

import { SHEET_SCRIPT_URL as SITE_SHEET_URL } from './config';
import { kvGetJsonMany, kvSetJson } from './kv';

export const THRESHOLDS_KEY = 'thresholds';
const SHEET_COPY_KEY = 'sailings:thresholds';
const FRESH_MS = 6 * 60 * 60 * 1000;

// The site's own Sheet first; then the server's SHEET_SCRIPT_URL, if that's a different one
const SHEETS = [...new Set([SITE_SHEET_URL, process.env.SHEET_SCRIPT_URL].filter(Boolean))];

// { thresholds (or null), at, source: 'upstash' | 'saved copy' | 'sheet' | 'old saved copy' | null, error }
export async function loadThresholds() {
  const [stored, saved] = await kvGetJsonMany([THRESHOLDS_KEY, SHEET_COPY_KEY]).catch(() => [null, null]);
  if (stored?.thresholds) return { thresholds: stored.thresholds, at: stored.at, source: 'upstash' };
  if (saved?.thresholds && Date.now() - Date.parse(saved.at) < FRESH_MS) return { thresholds: saved.thresholds, at: saved.at, source: 'saved copy' };

  const errors = [];
  for (const url of SHEETS) {
    try {
      const r = await fetch(`${url}?action=getThresholds`, { signal: AbortSignal.timeout(25000) });
      const json = await r.json();
      if (!json.thresholds) throw new Error(json.error || 'no thresholds in the reply');
      const at = new Date().toISOString();
      await kvSetJson(SHEET_COPY_KEY, { at, thresholds: json.thresholds }).catch(() => {});
      return { thresholds: json.thresholds, at, source: 'sheet' };
    } catch (err) {
      errors.push(`${url === SITE_SHEET_URL ? "site's Sheet" : 'SHEET_SCRIPT_URL'}: ${err.message}`);
    }
  }
  return { thresholds: saved?.thresholds || null, at: saved?.at || null, source: saved?.thresholds ? 'old saved copy' : null, error: errors.join('; ') };
}
