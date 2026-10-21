// The sailing chance formula (lib/risk.js)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chanceAt, gustLimitAt, otherReliability, weatherChanceAt, windowChance } from '../lib/risk.js';
import { hourOf } from './helpers.mjs';

const SHELTERED = 'Colintraive - Rhubodach (Bute)'; // exposure 1
const OPEN_SEA = 'Oban - Castlebay / Lochboisdale'; // exposure 4
const weather = (route, w) => { const h = hourOf(w); return weatherChanceAt(route, 0, h.hourly, h.marine); };

test('the weather chance matches the examples on the About tab', () => {
  // "Roughly, with 1 m waves (sheltered → open sea)"
  const about = { 30: [97, 92], 40: [87, 74], 50: [60, 39], 60: [26, 13] };
  for (const [gust, [sheltered, openSea]] of Object.entries(about)) {
    assert.equal(Math.round(100 * weather(SHELTERED, { gust: +gust, wave: 1 })), sheltered, `${gust} mph, sheltered`);
    assert.equal(Math.round(100 * weather(OPEN_SEA, { gust: +gust, wave: 1 })), openSea, `${gust} mph, open sea`);
  }
});

test('calm weather is near certain, a storm near hopeless', () => {
  assert.ok(weather(OPEN_SEA, { gust: 10, wave: 0.5 }) > 0.97);
  assert.ok(weather(SHELTERED, { gust: 75, wave: 3 }) < 0.05);
});

test('more wind, bigger waves or a more exposed route never raise the chance', () => {
  for (let gust = 10; gust < 80; gust += 5) {
    assert.ok(weather(OPEN_SEA, { gust: gust + 5, wave: 1 }) < weather(OPEN_SEA, { gust, wave: 1 }), `gust ${gust}`);
  }
  assert.ok(weather(OPEN_SEA, { gust: 40, wave: 3 }) < weather(OPEN_SEA, { gust: 40, wave: 1 }));
  assert.ok(weather(OPEN_SEA, { gust: 40, wave: 1 }) < weather(SHELTERED, { gust: 40, wave: 1 }));
});

test('dense fog, snow and thunderstorms take their allowance off; rain does not', () => {
  const clear = weather(SHELTERED, { gust: 20 });
  assert.equal(weather(SHELTERED, { gust: 20, visibility: 400 }), clear * 0.85);
  assert.equal(weather(SHELTERED, { gust: 20, visibility: 800 }), clear * 0.9);
  assert.equal(weather(SHELTERED, { gust: 20, visibility: 3000 }), clear);
  assert.equal(weather(SHELTERED, { gust: 20, code: 73 }), clear * 0.9); // snow
  assert.equal(weather(SHELTERED, { gust: 20, code: 95 }), clear * 0.9); // thunderstorm
  assert.equal(weather(SHELTERED, { gust: 20, code: 66 }), clear * 0.95); // freezing rain
  assert.equal(weather(SHELTERED, { gust: 20, code: 65 }), clear); // heavy rain
});

test('a missing marine forecast counts as no waves, and missing gusts fall back to wind', () => {
  const h = hourOf({ gust: 40 });
  assert.equal(weatherChanceAt(OPEN_SEA, 0, h.hourly, null), weather(OPEN_SEA, { gust: 40, wave: 0 }));
  const noGusts = { ...h.hourly, windgusts_10m: [null] };
  const asWind = hourOf({ gust: 40 * 0.65, wind: 40 * 0.65 });
  assert.equal(weatherChanceAt(OPEN_SEA, 0, noGusts, null), weatherChanceAt(OPEN_SEA, 0, asWind.hourly, null));
});

test("otherReliability is the route's summer figure, or 1 without enough CalMac data", () => {
  assert.ok(Math.abs(otherReliability({ R: { summer: 80.6, base: 79, samples: 34 } }, 'R') - 0.806) < 1e-9);
  assert.equal(otherReliability({ R: { summer: null, base: 90, samples: 34 } }, 'R'), 0.9);
  assert.equal(otherReliability({ R: { summer: 80, samples: 1 } }, 'R'), 1);
  assert.equal(otherReliability({}, 'R'), 1);
  assert.equal(otherReliability(null, 'R'), 1);
});

test('chanceAt is the weather chance times the route reliability, as a whole percentage', () => {
  const h = hourOf({ gust: 45, wave: 1.5 });
  const t = { [OPEN_SEA]: { summer: 96.3, samples: 34 } };
  assert.equal(chanceAt(OPEN_SEA, 0, h.hourly, h.marine, t), Math.round(100 * weatherChanceAt(OPEN_SEA, 0, h.hourly, h.marine) * 0.963));
});

test('windowChance is the average of the three worst hours', () => {
  const gusts = Array.from({ length: 24 }, (_, h) => [10, 50, 20, 60, 15, 40][h % 6]);
  const hourly = { windgusts_10m: gusts.map(g => g / 2.237), windspeed_10m: gusts.map(g => (g * 0.65) / 2.237) };
  const each = gusts.map((_, h) => chanceAt(SHELTERED, h, hourly, null, {}));
  const worst3 = each.slice(0, 6).sort((a, b) => a - b).slice(0, 3);
  assert.equal(windowChance(SHELTERED, 0, 5, hourly, null, {}), Math.round(worst3.reduce((a, b) => a + b) / 3));
  // Late in the day there are fewer than three hours left: the ones there are
  assert.equal(windowChance(SHELTERED, 22, 33, hourly, null, {}), Math.round((each[22] + each[23]) / 2));
});

test("gustLimitAt is the gust that makes the hour's weather a 50/50", () => {
  for (const route of [SHELTERED, OPEN_SEA]) {
    const h = hourOf({ gust: 30, wave: 1.2 });
    const limit = gustLimitAt(route, 0, h.hourly, h.marine);
    assert.ok(Math.abs(weather(route, { gust: limit, wave: 1.2 }) - 0.5) < 0.001, `${route}: ${limit} mph`);
  }
});
