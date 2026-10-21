// Every route on the site is wired up everywhere a route needs to be, so a
// route can't be added (or removed) halfway

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { ROUTE_PROFILES } from '../lib/risk.js';
import { NON_CALMAC_ROUTES, ROUTE_INFO, ROUTE_PORTS, ROUTES } from '../lib/routes.js';
import { PACK_ROUTES, ROUTE_SLUGS } from '../scripts/jobs/reliability/routes.mjs';
import { ROUTE_PAGES } from '../scripts/jobs/timetablePages.mjs';
import { forecastMarine, forecastWind, status } from './helpers.mjs';

const ROUTE_MAP = createRequire(import.meta.url)('../lib/route-map.js');
const names = ROUTES.map(r => r.name);

test('route names are unique and every route has forecast coordinates', () => {
  assert.equal(new Set(names).size, names.length);
  for (const r of ROUTES) assert.ok(r.lat > 54 && r.lat < 59 && r.lon > -8 && r.lon < -4, `${r.name}: ${r.lat}, ${r.lon}`);
});

test('only CalMac routes are on the site', () => {
  for (const name of NON_CALMAC_ROUTES) assert.ok(!names.includes(name), name);
});

test('every route has a wind profile, ports for the map and route details', () => {
  for (const name of names) {
    assert.ok(ROUTE_PROFILES[name], `${name}: ROUTE_PROFILES (lib/risk.js)`);
    assert.ok(ROUTE_PORTS[name], `${name}: ROUTE_PORTS (lib/routes.js)`);
    assert.ok(ROUTE_INFO[name], `${name}: ROUTE_INFO (lib/routes.js)`);
  }
});

test("every route gets CalMac's status, its timetable page and its reliability figures", () => {
  const mapped = new Set(Object.values(ROUTE_MAP));
  const reliability = new Set([...Object.keys(ROUTE_SLUGS), ...Object.values(PACK_ROUTES)]);
  for (const name of names) {
    assert.ok(mapped.has(name), `${name}: lib/route-map.js (CalMac status)`);
    assert.ok(ROUTE_PAGES[name]?.length, `${name}: scripts/jobs/timetablePages.mjs (new timetables)`);
    // Troon - Brodick has no CalMac report: its figures are estimates
    if (name !== 'Troon - Brodick (Arran)') assert.ok(reliability.has(name), `${name}: scripts/jobs/reliability/routes.mjs`);
  }
  // ...and nothing points at a route that isn't on the site
  for (const name of [...mapped, ...reliability, ...Object.keys(ROUTE_PAGES)]) assert.ok(names.includes(name), `${name} isn't on the site`);
});

test('the saved test data covers the same routes, in the same order', () => {
  assert.equal(forecastWind.length, ROUTES.length);
  assert.equal(forecastMarine.length, ROUTES.length);
  ROUTES.forEach((r, i) => assert.ok(Math.abs(forecastWind[i].latitude - r.lat) < 0.1 && Math.abs(forecastWind[i].longitude - r.lon) < 0.1, `${r.name}: forecast point ${i}`));
  for (const name of names) assert.ok(status.routes.some(r => r.routeKey === name), `${name}: in the saved CalMac status`);
});
