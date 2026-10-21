// Shared by the tests: the saved real data in tests/fixtures (CalMac's status
// and timetables from /api/status and /api/timetable, Open-Meteo's forecast
// and the thresholds, all from 20 Oct 2026), shaped as the site uses it, and
// a fake Upstash for code that talks to Redis.

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { disruptionsByRoute } from '../lib/disruptions.js';
import { routeWeather } from '../lib/forecast.js';
import { ROUTES } from '../lib/routes.js';
import { ukDateStr } from '../lib/timetable.js';

export const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

export const status = fixture('status');
export const thresholds = fixture('thresholds').thresholds;
export const forecastWind = fixture('forecast-wind');
export const forecastMarine = fixture('forecast-marine');

// The saved timetables, as today's and tomorrow's whatever the date
export const timetable = () => ({
  [ukDateStr(0)]: fixture('timetable-day1').routes,
  [ukDateStr(1)]: fixture('timetable-day2').routes,
});

export const disruptions = () => disruptionsByRoute(status);

// Every route as the page builds it from the forecast (lib/data.js)
export const routes = (hour = new Date().getHours()) =>
  ROUTES.map((r, i) => ({ name: r.name, ...routeWeather(forecastWind[i].hourly, forecastMarine[i]?.hourly || null, hour) }));

// One hour of weather for the chance functions: gusts and wind in mph, waves in m
export function hourOf({ gust, wind = gust * 0.65, wave = null, visibility = 20000, code = 3, snow = 0 }) {
  const ms = mph => mph / 2.237;
  return {
    hourly: { windgusts_10m: [ms(gust)], windspeed_10m: [ms(wind)], visibility: [visibility], weather_code: [code], snowfall: [snow] },
    marine: wave === null ? null : { wave_height: [wave], wave_period: [6], swell_wave_height: [wave / 2] },
  };
}

// A fake Upstash REST database (GET, SET with EX, MGET, DEL), on a free
// port. Set UPSTASH_REDIS_REST_URL to its url before lib/kv.js is first
// imported. data is the store itself.
export async function fakeRedis() {
  const data = new Map();
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const [cmd, ...args] = JSON.parse(body || '[]');
    const reply = result => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ result })); };
    if (cmd === 'GET') return reply(data.get(args[0]) ?? null);
    if (cmd === 'MGET') return reply(args.map(k => data.get(k) ?? null));
    if (cmd === 'SET') { data.set(args[0], args[1]); return reply('OK'); }
    if (cmd === 'DEL') { args.forEach(k => data.delete(k)); return reply(args.length); }
    res.writeHead(400); res.end(JSON.stringify({ error: `unknown command ${cmd}` }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, data, close: () => server.close() };
}
