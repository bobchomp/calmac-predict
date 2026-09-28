// GET /api/weather?route=<site route name>[&lat=&lon=]
// The sailing chance the site would show for a route over the next 12 hours,
// using the same Open-Meteo data and risk model. Used by api/cron.js.

import { SHEET_SCRIPT_URL as DEFAULT_SHEET_URL } from "../../lib/config";
import { calcOverallRisk, chanceFromRisk, historicalReliability, verdictFromRisk } from "../../lib/risk";
import { ROUTES } from "../../lib/routes";

const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL || DEFAULT_SHEET_URL;

const ukParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', month: 'numeric', hourCycle: 'h23' });

async function getJson(url, ms) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { route } = req.query;
  // Prefer the site's coordinates so the chance matches what users see
  const site = ROUTES.find(r => r.name === route);
  const lat = site?.lat ?? parseFloat(req.query.lat);
  const lon = site?.lon ?? parseFloat(req.query.lon);
  if (!route || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'route (a site route name) is required, with lat/lon if it is not a known route' });
  }

  const loc = `latitude=${lat}&longitude=${lon}&forecast_days=2&timezone=Europe%2FLondon`;
  const [forecast, marine, sheet] = await Promise.allSettled([
    getJson(`https://api.open-meteo.com/v1/forecast?${loc}&windspeed_unit=ms`
      + '&hourly=windspeed_10m,windgusts_10m,winddirection_10m,weather_code,visibility,precipitation,snowfall', 8000),
    getJson(`https://marine-api.open-meteo.com/v1/marine?${loc}&hourly=wave_height,wave_period,swell_wave_height`, 8000),
    getJson(`${SHEET_SCRIPT_URL}?action=getThresholds`, 6000),
  ]);

  if (forecast.status === 'rejected') {
    console.error('Weather fetch failed:', forecast.reason?.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Weather data unavailable' });
  }

  const parts = Object.fromEntries(ukParts.formatToParts(new Date()).map(p => [p.type, p.value]));
  const hour = Number(parts.hour);
  const month1 = Number(parts.month);

  const hourlyMarine = marine.status === 'fulfilled' ? marine.value.hourly || null : null;
  const risk = calcOverallRisk(route, hour, forecast.value.hourly || {}, hourlyMarine, month1 - 1);
  const thresholds = sheet.status === 'fulfilled' ? sheet.value.thresholds : null;
  const histRel = historicalReliability(thresholds, route, month1);

  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
  return res.status(200).json({
    route,
    risk,
    sailingChance: chanceFromRisk(risk, histRel),
    verdict: verdictFromRisk(risk),
    calibrated: histRel !== null,
    hasMarine: !!hourlyMarine,
  });
}
