// Met Office weather warnings (lib/metoffice.js): reading the feed, which
// routes a warning covers and when, and what the card shows

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cardData } from '../lib/card.js';
import { ROUTE_AREAS, mergeWarnings, parseWarnings, routeWarnings, warningLabels } from '../lib/metoffice.js';
import { ROUTES } from '../lib/routes.js';
import { routes, thresholds, timetable } from './helpers.mjs';

// The feeds as saved on Thu 22 Oct 2026, 10:00
const NOW = Date.parse('2026-10-22T10:00:00Z');
const feed = region => readFileSync(new URL(`./fixtures/metoffice-${region}.xml`, import.meta.url), 'utf8');
const warnings = () => mergeWarnings(['st', 'he'].map(r => parseWarnings(feed(r), NOW)));

test('the feed gives each warning its level, type, areas and UK times', () => {
  const st = parseWarnings(feed('st'), NOW);
  assert.equal(st.length, 2);
  const wind = st.find(w => w.type === 'wind');
  assert.equal(wind.level, 'yellow');
  assert.ok(wind.areas.includes('Argyll and Bute') && wind.areas.includes('Inverclyde'));
  // "1700 Sat 24 Oct" is BST; "2100 Sun 25 Oct" is after the clocks go back
  assert.equal(new Date(wind.from).toISOString(), '2026-10-24T16:00:00.000Z');
  assert.equal(new Date(wind.to).toISOString(), '2026-10-25T21:00:00.000Z');
  const rain = st.find(w => w.type === 'rain');
  assert.ok(!rain.areas.includes('Argyll and Bute'), 'the rain warning leaves Argyll out');
});

test('a warning in both regions is one warning covering both', () => {
  const winds = warnings().filter(w => w.type === 'wind');
  assert.equal(winds.length, 1);
  assert.ok(winds[0].areas.includes('Argyll and Bute') && winds[0].areas.includes('Na h-Eileanan Siar'));
});

test('a date is read in the year nearest now', () => {
  const xml = '<item><title>Yellow warning of snow affecting Highlands &amp; Eilean Siar</title><link>x#?id=abc</link><description>Yellow warning of snow affecting Highlands &amp; Eilean Siar: Highland valid from 2300 Thu 31 Dec to 0900 Fri 1 Jan</description></item>';
  const [w] = parseWarnings(xml, Date.parse('2026-12-31T12:00:00Z'));
  assert.equal(new Date(w.from).toISOString(), '2026-12-31T23:00:00.000Z');
  assert.equal(new Date(w.to).toISOString(), '2027-01-01T09:00:00.000Z');
});

test('every route has its council areas', () => {
  for (const { name } of ROUTES) assert.ok(ROUTE_AREAS[name]?.length, name);
});

test('a route gets the warnings for its areas in force at the time', () => {
  const all = warnings();
  const saturdayEvening = Date.parse('2026-10-24T18:00:00Z');
  const fridayNoon = Date.parse('2026-10-23T11:00:00Z');
  assert.deepEqual(warningLabels(routeWarnings(all, 'Oban - Craignure (Mull)', saturdayEvening)), ['yellow wind']);
  assert.deepEqual(warningLabels(routeWarnings(all, 'Ullapool - Stornoway (Lewis)', saturdayEvening)), ['yellow wind']);
  assert.deepEqual(warningLabels(routeWarnings(all, 'Largs - Cumbrae Slip', fridayNoon)), ['yellow rain']);
  assert.deepEqual(routeWarnings(all, 'Oban - Craignure (Mull)', fridayNoon), [], 'the rain warning leaves Argyll out');
  assert.deepEqual(routeWarnings(all, 'Oban - Craignure (Mull)', Date.parse('2026-10-26T12:00:00Z')), [], 'over by Monday');
  // Most severe first
  const amber = { ...all[0], id: 'a', level: 'amber' };
  assert.equal(routeWarnings([all[0], amber], 'Oban - Craignure (Mull)', saturdayEvening)[0].level, 'amber');
});

test('the card shows a warning for the day in view, as a badge and a notice', () => {
  const r = routes().find(x => x.name === 'Oban - Craignure (Mull)');
  // The wind warning, moved to cover tomorrow only
  const wind = warnings().find(w => w.type === 'wind');
  const tomorrowNoon = Date.parse(`${Object.keys(timetable())[1]}T12:00:00Z`);
  const metWarnings = [{ ...wind, from: tomorrowNoon - 3600000, to: tomorrowNoon + 3600000 }];
  const card = showingTomorrow => cardData(r, 0, { disruption: null, timetable: timetable(), thresholds, showingTomorrow, lastFetched: new Date(), metWarnings });
  const tomorrow = card(true);
  assert.ok(tomorrow.head.badges.some(b => b.text === '🟡 Met Office: wind'));
  assert.equal(tomorrow.notices[0].title, 'Yellow warning of wind affecting Strathclyde');
  assert.match(tomorrow.notices[0].preview, /· Argyll and Bute$/, 'only the route\'s own areas');
  assert.ok(!card(false).head.badges.some(b => /Met Office/.test(b.text)), 'not today');
  // The chance doesn't change
  assert.equal(tomorrow.head.chanceText, cardData(r, 0, { disruption: null, timetable: timetable(), thresholds, showingTomorrow: true, lastFetched: new Date() }).head.chanceText);
});
