// What a route card and the route modal show (lib/card.js, lib/modal.js),
// on the saved real CalMac status, timetables and forecast: they must
// always agree, and CalMac's cancellations must count.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardData, headlineChances, routeOutlook, sailingChanceAt } from '../lib/card.js';
import { modalData } from '../lib/modal.js';
import { windowChance } from '../lib/risk.js';
import { disruptions, forecastMarine, forecastWind, routes, status, thresholds, timetable } from './helpers.mjs';

const ctx = (r, showingTomorrow) => ({ disruption: disruptions()[r.name], timetable: timetable(), thresholds, showingTomorrow, lastFetched: new Date() });
const pct = text => (text === '–' ? null : parseInt(text));

test('every card builds, today and tomorrow, with chances between 0 and 100', () => {
  for (const r of routes()) {
    for (const showingTomorrow of [false, true]) {
      const c = cardData(r, 0, ctx(r, showingTomorrow));
      const head = pct(c.head.chanceText);
      assert.ok(head === null || (head >= 0 && head <= 100), `${r.name}: ${c.head.chanceText}`);
      for (const row of c.sailings.rows) assert.ok(row.pct === null || (row.pct >= 0 && row.pct <= 100), `${r.name} ${row.time}: ${row.pct}`);
    }
  }
});

test("the route modal shows the card's chance, and a sailing's modal its row's", () => {
  for (const r of routes()) {
    for (const showingTomorrow of [false, true]) {
      const c = ctx(r, showingTomorrow);
      const card = cardData(r, 0, c);
      assert.equal(modalData(r, null, c).chance, pct(card.head.chanceText), `${r.name}${showingTomorrow ? ' tomorrow' : ''}`);
      for (const row of card.sailings.rows) {
        assert.equal(modalData(r, row.time, c).chance, row.pct, `${r.name} ${row.time}${showingTomorrow ? ' tomorrow' : ''}`);
      }
    }
  }
});

test("a sailing CalMac has cancelled is 0%, whatever the weather", () => {
  const r = routes().find(x => x.name === 'Oban - Craignure (Mull)');
  const disruption = { status: 'disrupted', sailingStatuses: { '10:00': { status: 'cancelled', reason: 'Technical' } }, notices: [] };
  assert.equal(sailingChanceAt(r, '10:00', false, thresholds, disruption, 'Oban'), 0);
  assert.ok(sailingChanceAt(r, '10:00', false, thresholds) > 0, 'without the cancellation it has a chance');
  // Disrupted and Be Aware sailings keep the forecast's chance
  const amber = { status: 'amber', sailingStatuses: { '10:00': { status: 'amber' } }, notices: [] };
  assert.equal(sailingChanceAt(r, '10:00', false, thresholds, amber, 'Oban'), sailingChanceAt(r, '10:00', false, thresholds));
});

test('a route with every sailing cancelled reads 0% and unlikely', () => {
  const r = routes().find(x => x.name === 'Oban - Craignure (Mull)');
  const outlook = routeOutlook(r, { disruption: { status: 'cancelled', sailingStatuses: {}, notices: [] }, thresholds, showingTomorrow: false, timetable: timetable() });
  assert.equal(outlook.cancelled, true);
  assert.equal(outlook.chance, 0);
  assert.equal(outlook.verdict, 'unlikely');
});

test("the route's chance is the average of its sailings still to go, cancelled ones as 0", () => {
  const r = routes().find(x => x.name === 'Oban - Craignure (Mull)');
  const tt = timetable();
  const tomorrow = Object.values(tt)[1][r.name];
  // Half of tomorrow's sailings cancelled
  const half = Object.fromEntries(tomorrow.slice(0, Math.floor(tomorrow.length / 2)).map(s => [s.t, { status: 'cancelled' }]));
  const disruption = { status: 'normal', sailingStatuses: {}, sailingStatusesTomorrow: half, notices: [] };
  const outlook = routeOutlook(r, { disruption, thresholds, showingTomorrow: true, timetable: tt });
  const rows = tomorrow.map(s => sailingChanceAt(r, s.t, true, thresholds, disruption, s.f));
  assert.equal(outlook.bySailing, true);
  assert.equal(outlook.chance, Math.round(rows.reduce((a, b) => a + b) / rows.length));
  // ...and before CalMac's cancellations, the weather's average
  const weather = tomorrow.map(s => sailingChanceAt(r, s.t, true, thresholds));
  assert.equal(outlook.forecast, Math.round(weather.reduce((a, b) => a + b) / weather.length));
});

test("every card's headline is the average of its rows still to go, labelled for what it covers", () => {
  for (const r of routes()) {
    for (const showingTomorrow of [false, true]) {
      const card = cardData(r, 0, ctx(r, showingTomorrow));
      const toGo = card.sailings.rows.filter(row => !row.isPast && row.pct !== null);
      if (!toGo.length || card.head.cancelled) continue;
      const label = `${r.name}${showingTomorrow ? ' tomorrow' : ''}`;
      assert.equal(pct(card.head.chanceText), Math.round(toGo.reduce((a, row) => a + row.pct, 0) / toGo.length), label);
      assert.equal(card.head.chanceLabel, showingTomorrow ? 'Tomorrow' : 'Rest of today', label);
    }
  }
});

test('with no sailings left today, the headline is the next 12 hours\' weather', () => {
  const r = routes().find(x => x.name === 'Oban - Craignure (Mull)');
  // A timetable whose only sailing has left (00:00 is always past)
  const tt = { ...timetable(), [Object.keys(timetable())[0]]: { [r.name]: [{ t: '00:00', f: 'Oban', to: 'Craignure' }] } };
  const card = cardData(r, 0, { disruption: null, timetable: tt, thresholds, showingTomorrow: false, lastFetched: new Date() });
  const hour = new Date().getHours();
  assert.equal(card.head.chanceLabel, 'Next 12h');
  assert.equal(pct(card.head.chanceText), windowChance(r.name, hour, hour + 11, r.hourlyData, r.marineData, thresholds));
});

test("the alerts job's chance for each route is its card's headline", () => {
  const chances = headlineChances({ wind: forecastWind, marine: forecastMarine, status, timetable: Object.values(timetable())[0], thresholds });
  for (const r of routes()) {
    const card = cardData(r, 0, ctx(r, false));
    assert.equal(chances[r.name], pct(card.head.chanceText), r.name);
  }
});

test("some sailings cancelled and the rest not listed isn't the whole day cancelled", () => {
  // CalMac lists only the sailings it has changed: two cancelled, the rest
  // of the timetable running (as Largs - Cumbrae on 12 Oct 2026)
  const r = routes().find(x => x.name === 'Oban - Craignure (Mull)');
  const tomorrow = Object.values(timetable())[1][r.name];
  const twoCancelled = Object.fromEntries(tomorrow.slice(0, 2).map(s => [s.t, { status: 'cancelled' }]));
  const disruption = { status: 'normal', sailingStatuses: {}, sailingStatusesTomorrow: twoCancelled, notices: [] };
  const outlook = routeOutlook(r, { disruption, thresholds, showingTomorrow: true, timetable: timetable() });
  assert.equal(outlook.cancelled, false);
  assert.ok(outlook.chance > 0);
  // Without a timetable to count from, all the listed sailings cancelled still means the day is
  assert.equal(routeOutlook(r, { disruption, thresholds, showingTomorrow: true, timetable: null }).cancelled, true);
});
