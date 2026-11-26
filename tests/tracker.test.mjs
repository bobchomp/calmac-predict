// The tracker (lib/tracker.js): its forecast, falling back to the last one
// when Open-Meteo refuses, and a run end to end, against a fake Redis and
// the saved real CalMac and forecast data instead of the network

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { fakeRedis, fixture, forecastMarine, forecastWind, status, thresholds } from './helpers.mjs';

let redis, tracker, timetableLib, ROUTES, sailingsForDay;
let refuse = false;
const requests = [];

before(async () => {
  redis = await fakeRedis();
  process.env.UPSTASH_REDIS_REST_URL = redis.url;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname.endsWith('open-meteo.com')) {
      requests.push(u.hostname);
      if (refuse) return new Response('{"error":true,"reason":"Daily API request limit exceeded"}', { status: 429 });
      return Response.json(u.hostname.startsWith('marine') ? forecastMarine : forecastWind);
    }
    if (u.hostname === 'site.test') {
      if (u.pathname === '/api/status') return Response.json(siteStatus);
      if (u.pathname === '/api/warnings') return Response.json({ ok: true, warnings: metWarnings });
      if (u.pathname === '/api/timetable') return Response.json(fixture(u.searchParams.get('date') === timetableLib.ukDateStr(0) ? 'timetable-day1' : 'timetable-day2'));
      return new Response('not found', { status: 404 });
    }
    return realFetch(url, init);
  };
  // Imported after the fake Redis is set up (lib/kv.js reads it on load)
  tracker = await import('../lib/tracker.js');
  timetableLib = await import('../lib/timetable.js');
  ({ ROUTES } = await import('../lib/routes.js'));
  ({ sailingsForDay } = await import('../lib/card.js'));
});
after(() => redis.close());
beforeEach(() => { redis.data.clear(); refuse = false; requests.length = 0; });

// The saved CalMac status, with a warning in force today and tomorrow on one route
const WARNED_ROUTE = 'Tobermory - Kilchoan';
const siteStatus = {
  ...status,
  routes: status.routes.map(r => (r.routeKey === WARNED_ROUTE ? { ...r, notices: [...(r.notices || []), {
    title: 'Weather warning', detail: 'Sailings are liable to disruption or cancellation at short notice.',
    startDateTime: new Date(Date.now() - 3600000).toISOString(), endDateTime: new Date(Date.now() + 3 * 86400000).toISOString(),
  }] } : r)),
};

// A Met Office wind warning for North Ayrshire, in force from now for three days
const metWarnings = [{ id: 'w1', level: 'amber', type: 'wind', areas: ['North Ayrshire'], from: Date.now() - 3600000, to: Date.now() + 3 * 86400000, title: 'Amber warning of wind', url: 'x' }];
const MET_ROUTES = ['Ardrossan - Brodick (Arran)', 'Troon - Brodick (Arran)', 'Largs - Cumbrae Slip', 'Claonaig - Lochranza (Arran)'];

const restamp = (part, change) => {
  const key = tracker.SAVED_FORECAST_KEY(part);
  redis.data.set(key, JSON.stringify({ ...JSON.parse(redis.data.get(key)), ...change }));
};

test('a good forecast is used and saved (unless told not to save)', async () => {
  const f = await tracker.fetchForecast({ baseUrl: 'https://site.test', save: false });
  assert.ok(f.wind && f.marine);
  assert.equal(redis.data.size, 0);
  await tracker.fetchForecast({ baseUrl: 'https://site.test' });
  assert.ok(redis.data.has('forecast:wind') && redis.data.has('forecast:marine'));
});

test('when Open-Meteo refuses, a saved forecast from today under an hour old is used', { timeout: 30000 }, async () => {
  await tracker.fetchForecast({ baseUrl: 'https://site.test' });
  refuse = true;
  const f = await tracker.fetchForecast({ baseUrl: 'https://site.test' });
  assert.deepEqual(f.wind, forecastWind);
  assert.deepEqual(f.saved, { wind: 0, marine: 0 });
  assert.match(f.errors.wind, /429/);
  assert.ok(requests.length > 2, 'it tried Open-Meteo again before falling back');
});

test('a saved forecast over an hour old, or from yesterday, is not used', { timeout: 60000 }, async () => {
  await tracker.fetchForecast({ baseUrl: 'https://site.test' });
  refuse = true;
  for (const part of ['wind', 'marine']) restamp(part, { at: new Date(Date.now() - 61 * 60000).toISOString() });
  assert.equal((await tracker.fetchForecast({ baseUrl: 'https://site.test' })).wind, null);
  for (const part of ['wind', 'marine']) restamp(part, { at: new Date().toISOString(), date: timetableLib.ukDateStr(-1) });
  assert.equal((await tracker.fetchForecast({ baseUrl: 'https://site.test' })).wind, null);
});

test('a run logs every sailing still to go with both chances, and the warnings', async () => {
  redis.data.set('thresholds', JSON.stringify({ at: '2026-10-16T00:00:00Z', thresholds }));
  const result = await tracker.runTracker({ baseUrl: 'https://site.test', snapshot: true });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.inputs.forecast, true);
  assert.equal(result.inputs.metOffice, true);
  assert.equal(result.inputs.thresholds, 'upstash');
  assert.ok(result.predicted > 300, `${result.predicted} predicted`);
  assert.equal(result.snapshot.withWeather, ROUTES.length);

  const tomorrow = JSON.parse(redis.data.get(`sailings:${timetableLib.ukDateStr(1)}`));
  const sailings = Object.values(tomorrow);
  // Tomorrow's sailings as the cards list them: the live timetable, else the built-in one
  const expected = ROUTES.reduce((n, r) => n + sailingsForDay({ [timetableLib.ukDateStr(1)]: fixture('timetable-day2').routes }, r.name, true).sailings.length, 0);
  assert.equal(sailings.length, expected);
  for (const s of sailings) {
    for (const k of ['chance', 'weather', 'old']) assert.ok(s.last[k] >= 0 && s.last[k] <= 100, `${s.route} ${s.time} ${k}: ${s.last[k]}`);
    assert.equal(s.warned, s.route === WARNED_ROUTE, `${s.route} ${s.time} warned`);
    assert.deepEqual(s.met, MET_ROUTES.includes(s.route) ? ['amber wind'] : [], `${s.route} ${s.time} Met Office`);
    assert.equal(!!s.metAt, MET_ROUTES.includes(s.route));
  }
  assert.ok(sailings.some(s => s.route === WARNED_ROUTE && s.warnedAt));

  // The prediction 6 hours or more ahead, with both formulas' forecast-only chances
  const { AHEAD_MS, departureMs } = await import('../lib/sailingLog.js');
  const today = Object.values(JSON.parse(redis.data.get(`sailings:${timetableLib.ukDateStr(0)}`)));
  for (const s of [...today, ...sailings]) {
    const farEnough = departureMs(s.date, s.time) - Date.parse(s.last.at) >= AHEAD_MS;
    assert.equal(!!s.ahead, farEnough, `${s.route} ${s.date} ${s.time} ahead`);
    if (s.ahead) {
      assert.equal(s.ahead.chance, s.last.chance);
      assert.equal(s.ahead.weather, s.last.weather);
      for (const k of ['chance', 'weather', 'old']) assert.ok(s.ahead[k] >= 0 && s.ahead[k] <= 100, `${s.route} ${s.time} ahead ${k}`);
    }
  }
  assert.ok(sailings.some(s => s.ahead), 'tomorrow has sailings 6 hours off');
});

test('a run Open-Meteo refuses still predicts, from the saved forecast', { timeout: 30000 }, async () => {
  await tracker.fetchForecast({ baseUrl: 'https://site.test' });
  refuse = true;
  const result = await tracker.runTracker({ baseUrl: 'https://site.test', snapshot: false, dry: true });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.predicted > 300);
  assert.deepEqual(result.inputs.forecastSavedMinutesAgo, { wind: 0, marine: 0 });
});

test("a rebuild works each day's figures out again from its log", async () => {
  const day = timetableLib.ukDateStr(-10), empty = timetableLib.ukDateStr(-11);
  const log = { a: { route: 'Gourock - Dunoon', date: day, time: '09:00', last: { chance: 0 }, ahead: { chance: 90, weather: 90, old: 90, at: 'x' }, outcome: { sailed: false, status: 'cancelled', reason: 'Technical' } } };
  redis.data.set(`sailings:${day}`, JSON.stringify(log));
  redis.data.set(`sailings:stats:${day}`, JSON.stringify({ routes: { 'Gourock - Dunoon': { sailings: 1, cmp: 1, cmpCancelled: 1, bins: [] } } })); // saved by an older version
  assert.deepEqual(await tracker.rebuildStats({ days: 30, dry: true }), { rebuilt: 1, from: day, to: day });
  assert.equal(JSON.parse(redis.data.get(`sailings:stats:${day}`)).routes['Gourock - Dunoon'].cmp, 1, 'a dry run saves nothing');
  await tracker.rebuildStats({ days: 30 });
  const s = JSON.parse(redis.data.get(`sailings:stats:${day}`)).routes['Gourock - Dunoon'];
  assert.deepEqual({ cmp: s.cmp, cmpOther: s.cmpOther, ahead: s.ahead }, { cmp: 0, cmpOther: 1, ahead: 1 });
  assert.ok(!redis.data.has(`sailings:stats:${empty}`), 'days with no log are left alone');
  // Logs read a week at a time (Upstash's 10 MB reply limit), none missed
  const older = timetableLib.ukDateStr(-20);
  redis.data.set(`sailings:${older}`, JSON.stringify(log));
  redis.stats.maxMget = 0;
  assert.deepEqual(await tracker.rebuildStats({ days: 30, dry: true }), { rebuilt: 2, from: older, to: day });
  assert.equal(redis.stats.maxMget, 7);
});
