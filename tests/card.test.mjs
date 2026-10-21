// What a route card and the route modal show (lib/card.js, lib/modal.js),
// on the saved real CalMac status, timetables and forecast: they must
// always agree, and CalMac's cancellations must count.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardData, routeOutlook, sailingChanceAt } from '../lib/card.js';
import { modalData } from '../lib/modal.js';
import { disruptions, routes, thresholds, timetable } from './helpers.mjs';

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

test("the route's chance is scaled by the share of its remaining sailings still running", () => {
  const r = routes().find(x => x.name === 'Oban - Craignure (Mull)');
  const tt = timetable();
  const opts = { thresholds, showingTomorrow: true, timetable: tt };
  const tomorrow = Object.values(tt)[1][r.name];
  // Half of tomorrow's sailings cancelled
  const half = Object.fromEntries(tomorrow.slice(0, Math.floor(tomorrow.length / 2)).map(s => [s.t, { status: 'cancelled' }]));
  const full = routeOutlook(r, { ...opts, disruption: null });
  const halved = routeOutlook(r, { ...opts, disruption: { status: 'normal', sailingStatuses: {}, sailingStatusesTomorrow: half, notices: [] } });
  const share = (tomorrow.length - Object.keys(half).length) / tomorrow.length;
  assert.equal(halved.chance, Math.round(full.forecast * share));
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
