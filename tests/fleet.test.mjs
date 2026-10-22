// The fleet for live vessel tracking (lib/fleet.js): real-looking MMSIs,
// every route covered, and the scheduled vessel the route modal names

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { ROUTE_INFO, ROUTE_PORTS, ROUTES } from '../lib/routes.js';

const { FLEET, ROUTE_BOXES, scheduledVessel } = createRequire(import.meta.url)('../lib/fleet.js');
const names = ROUTES.map(r => r.name);

test('every MMSI is a 9-digit UK (232-235) or Norwegian (257) ship number, used once', () => {
  for (const v of FLEET) assert.match(String(v.mmsi), /^(23[2-5]|257)\d{6}$/, `${v.name}: ${v.mmsi}`);
  const mmsis = FLEET.map(v => v.mmsi);
  assert.equal(new Set(mmsis).size, mmsis.length);
});

test("every ship's routes are on the site, and every route has ships and a box", () => {
  for (const v of FLEET) for (const route of v.routes) assert.ok(names.includes(route), `${v.name}: ${route}`);
  for (const name of names) {
    assert.ok(FLEET.some(v => v.routes.includes(name)), `${name}: no ship`);
    assert.ok(ROUTE_BOXES[name], `${name}: no box`);
  }
  for (const name of Object.keys(ROUTE_BOXES)) assert.ok(names.includes(name), `box for ${name}, not on the site`);
});

test("each route's box takes in at least one of its ports", () => {
  for (const name of names) {
    const [minLat, maxLat, minLon, maxLon] = ROUTE_BOXES[name];
    const { a, b } = ROUTE_PORTS[name];
    const inside = ([lat, lon]) => lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
    assert.ok(inside(a) || inside(b), `${name}: neither ${a[2]} nor ${b[2]} is in its box`);
  }
});

test("the scheduled vessel is the one the route's details name", () => {
  for (const name of names) {
    const v = scheduledVessel(name);
    const info = `${ROUTE_INFO[name].vessel} ${ROUTE_INFO[name].vessel2 || ''}`;
    assert.ok(info.includes(v.name), `${name}: scheduled ${v.name}, details say "${info.trim()}"`);
  }
  // A relief ship listed on a route is never its scheduled one
  assert.equal(scheduledVessel('Tayinloan - Gigha').name, 'MV Loch Ranza');
  assert.equal(scheduledVessel('Not a route'), null);
});
