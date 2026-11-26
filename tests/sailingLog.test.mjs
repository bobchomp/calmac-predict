// The sailing log's figures (lib/sailingLog.js): what the Accuracy page shows

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPARE_MIN, addStats, calibration, dayStats, departureMs, figures, formulaComparison, verdictBands } from '../lib/sailingLog.js';

// A logged sailing: the chance we gave it (and the old formula's), whether it
// sailed (cancelled for the weather, unless extra.reason says otherwise)
const rec = (route, chance, sailed, extra = {}) => ({ route, last: { chance, ...extra.last }, first: { chance },
  outcome: { sailed, reason: sailed ? null : 'reason' in extra ? extra.reason : 'Weather' }, ...extra.rec });

test('a day is added up per route: called right, cancellations predicted, false alarms', () => {
  const f = figures(addStats([dayStats({
    a: rec('Oban - Coll / Tiree', 90, true),   // right
    b: rec('Oban - Coll / Tiree', 30, false),  // right: a cancellation predicted
    c: rec('Oban - Coll / Tiree', 80, false),  // wrong: a cancellation missed
    d: rec('Oban - Coll / Tiree', 40, true),   // wrong: a false alarm
    e: { route: 'Oban - Coll / Tiree', last: { chance: 95 } }, // not left yet
  })]));
  assert.deepEqual(
    { sailings: f.sailings, pending: f.pending, resolved: f.resolved, correct: f.correct, accuracy: f.accuracy, cancelled: f.cancelled, cancelledPredicted: f.cancelledPredicted, falseAlarms: f.falseAlarms },
    { sailings: 5, pending: 1, resolved: 4, correct: 2, accuracy: 50, cancelled: 2, cancelledPredicted: 1, falseAlarms: 1 },
  );
});

test("routes CalMac doesn't run are left out of the figures", () => {
  const day = dayStats({ a: rec('Seil - Luing', 99, true), b: rec('Port Askaig - Feolin (Jura)', 99, true), c: rec('Gourock - Dunoon', 90, true) });
  assert.deepEqual(Object.keys(day.routes), ['Gourock - Dunoon']);
  // Nor are they counted from days saved before they were left out
  assert.equal(figures(addStats([{ routes: { 'Seil - Luing': day.routes['Gourock - Dunoon'] } }])).sailings, 0);
});

// The prediction 6 hours ahead: its chance, and both formulas' forecast-only chances
const ahead = (chance, weather, old) => ({ rec: { ahead: { chance, weather, old, at: '2026-11-03T06:00:00Z' } } });

test('the headline judges the prediction 6 hours ahead, not the last one', () => {
  const f = figures(addStats([dayStats({
    // CalMac cancelled it after the 6-hour look: the last chance was 0, the 6-hour one 80
    a: { ...rec('Oban - Coll / Tiree', 0, false), ...ahead(80, 80, 70).rec },
    b: { ...rec('Oban - Coll / Tiree', 90, true), ...ahead(30, 30, 30).rec }, // a false alarm 6 hours out
    c: { ...rec('Oban - Coll / Tiree', 10, false), ...ahead(20, 20, 60).rec },
    d: rec('Oban - Coll / Tiree', 90, true), // logged before 6-hour predictions were
  })]));
  assert.equal(f.accuracy, 100, 'the last chances were all right');
  assert.deepEqual(f.ahead, { sailings: 3, correct: 1, accuracy: 33, cancelled: 2, cancelledPredicted: 1, falseAlarms: 1 });
  assert.equal(figures(addStats([dayStats({ d: rec('Oban - Coll / Tiree', 90, true) })])).ahead, null);
});

test("the new formula's forecast is compared with the old's, 6 hours ahead", () => {
  const c = figures(addStats([dayStats({
    a: rec('Oban - Coll / Tiree', 90, true, ahead(90, 90, 60)),
    // Cancelled by CalMac: both last chances 0, but the forecasts said 20 and 55
    b: rec('Oban - Coll / Tiree', 0, false, { last: { old: 0 }, ...ahead(20, 20, 55) }),
    c: rec('Gourock - Dunoon', 95, true, ahead(95, 95, 40)),
    d: rec('Gourock - Dunoon', 80, true, { last: { old: 80 } }), // logged before 6-hour predictions were
    // Cancelled for a breakdown: no test of a forecast, so left out
    e: rec('Gourock - Dunoon', 0, false, { reason: 'Technical', ...ahead(95, 95, 95) }),
    f: rec('Gourock - Dunoon', 0, false, { reason: null, ...ahead(95, 95, 95) }), // no reason given
  })])).comparison;
  assert.equal(c.otherCancelled, 2);
  // Error: the average of (chance - outcome)², outcomes 1 sailed, 0 cancelled
  assert.equal(c.sailings, 3);
  assert.equal(c.errorNew, Number((((0.9 - 1) ** 2 + 0.2 ** 2 + (0.95 - 1) ** 2) / 3).toFixed(4)));
  assert.equal(c.errorOld, Number((((0.6 - 1) ** 2 + 0.55 ** 2 + (0.4 - 1) ** 2) / 3).toFixed(4)));
  assert.deepEqual({ correctNew: c.correctNew, correctOld: c.correctOld, cancelled: c.cancelled, caughtNew: c.caughtNew, caughtOld: c.caughtOld, falseNew: c.falseNew, falseOld: c.falseOld },
    { correctNew: 100, correctOld: 33, cancelled: 1, caughtNew: 1, caughtOld: 0, falseNew: 0, falseOld: 1 });
});

// What we said for warned sailings is the chance 6 hours before, where there was one
const aheadChance = chance => ({ chance, weather: chance, old: chance, at: '2026-11-03T06:00:00Z' });

test('warned sailings are compared with the rest, counting only sailings checked for warnings', () => {
  const w = figures(addStats([dayStats({
    a: rec('Oban - Coll / Tiree', 0, false, { rec: { warned: true, warnedAt: '2026-10-21T06:00:00Z', ahead: aheadChance(60) } }),
    b: rec('Oban - Coll / Tiree', 80, true, { rec: { warned: false, warnedAt: '2026-10-21T05:00:00Z', ahead: aheadChance(80) } }), // warned earlier, lifted
    c: rec('Oban - Coll / Tiree', 95, true, { rec: { warned: false, ahead: aheadChance(95) } }),
    d: rec('Oban - Coll / Tiree', 90, true), // logged before warnings were
    e: rec('Oban - Coll / Tiree', 90, true, { rec: { warned: true, warnedAt: '2026-10-21T05:00:00Z' } }), // before 6-hour predictions
  })])).warnings;
  assert.deepEqual({ warned: w.warned, notWarned: w.notWarned }, { warned: { sailings: 3, said: 70, sailedPct: 67 }, notWarned: { sailings: 1, said: 95, sailedPct: 100 } });
  assert.equal(w.metWarned.sailings + w.metNotWarned.sailings, 0, 'none checked for Met Office warnings');
});

test('Met Office warnings are compared with the rest, counting only sailings checked for them', () => {
  const w = figures(addStats([dayStats({
    a: rec('Oban - Coll / Tiree', 0, false, { rec: { met: ['amber wind'], metAt: '2026-10-24T06:00:00Z', ahead: aheadChance(50) } }),
    b: rec('Oban - Coll / Tiree', 70, true, { rec: { met: [], metAt: '2026-10-24T05:00:00Z', ahead: aheadChance(70) } }), // warned earlier, then not
    c: rec('Oban - Coll / Tiree', 90, true, { rec: { met: [], ahead: aheadChance(90) } }),
    d: rec('Oban - Coll / Tiree', 90, true), // logged before they were
  })])).warnings;
  assert.deepEqual({ metWarned: w.metWarned, metNotWarned: w.metNotWarned }, { metWarned: { sailings: 2, said: 60, sailedPct: 50 }, metNotWarned: { sailings: 1, said: 90, sailedPct: 100 } });
});

test('the calibration chart and verdict bands use the chance 6 hours before', () => {
  const t = addStats([dayStats({
    a: rec('Oban - Coll / Tiree', 0, false, { rec: { ahead: aheadChance(82) } }), // said 82, CalMac cancelled later
    b: rec('Oban - Coll / Tiree', 90, true, { rec: { ahead: aheadChance(85) } }),
    c: rec('Oban - Coll / Tiree', 10, false, { rec: { ahead: aheadChance(30) } }),
    d: rec('Oban - Coll / Tiree', 95, true), // before 6-hour predictions: not in the chart
  }), { routes: { 'Gourock - Dunoon': { sailings: 1, resolved: 1, bins: Array.from({ length: 20 }, (_, i) => (i === 19 ? [1, 1] : [0, 0])) } } }]); // a day saved before aheadBins
  assert.deepEqual(calibration(t).filter(c => c.count).map(c => [c.from, c.count, c.sailedPct]), [[30, 1, 0], [80, 2, 50]]);
  assert.deepEqual(verdictBands(t).map(b => [b.verdict, b.count, b.sailedPct]), [['likely', 2, 50], ['caution', 0, null], ['unlikely', 1, 0]]);
});

test(`the formula comparison waits for ${COMPARE_MIN.days} days and ${COMPARE_MIN.cancelled} cancellations`, () => {
  // n days, each with 300 sailings compared and c cancellations
  const days = (n, c) => {
    const dates = Array.from({ length: n }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const stats = dates.map(() => ({ routes: { 'Oban - Coll / Tiree': {
      sailings: 300, pending: 0, resolved: 300, correct: 290, firstCorrect: 290, cancelled: c, cancelledPredicted: 0, falseAlarms: 0,
      cmp: 300, cmpBrierNew: 9, cmpBrierOld: 12, cmpCorrectNew: 290, cmpCorrectOld: 285, cmpCancelled: c, cmpCaughtNew: 0, cmpCaughtOld: 0, cmpFalseNew: 0, cmpFalseOld: 0,
      bins: Array.from({ length: 20 }, () => [0, 0]),
    } } }));
    return formulaComparison(dates, stats);
  };
  const short = days(COMPARE_MIN.days - 1, 10);
  assert.equal(short.ready, false);
  assert.deepEqual(short.progress, { since: '2026-11-01', days: 13, sailings: 3900, cancelled: 130 });
  assert.equal(short.total, undefined, 'no figures until ready');
  assert.equal(days(COMPARE_MIN.days, 3).ready, false, '14 days but only 42 cancellations');
  const ready = days(COMPARE_MIN.days, 4);
  assert.equal(ready.ready, true);
  assert.equal(ready.total.sailings, 4200);
  assert.equal(ready.byDay.length, 14);
  assert.deepEqual(ready.byRoute.map(r => r.route), ['Oban - Coll / Tiree']);
  // Days without a comparison (before it started) aren't counted, nor days
  // saved with the old last-chance comparison
  assert.equal(formulaComparison(['2026-10-01'], [null]).progress.days, 0);
  const oldStyle = { routes: { 'Oban - Coll / Tiree': { sailings: 300, resolved: 300, compared: 300, brierNew: 9, brierOld: 12, cancelledCompared: 60, bins: Array.from({ length: 20 }, () => [0, 0]) } } };
  assert.equal(formulaComparison(['2026-10-24'], [oldStyle]).progress.days, 0);
});

test('departureMs knows UK summer and winter time', () => {
  assert.equal(new Date(departureMs('2026-07-01', '09:30')).toISOString(), '2026-07-01T08:30:00.000Z');
  assert.equal(new Date(departureMs('2026-12-01', '09:30')).toISOString(), '2026-12-01T09:30:00.000Z');
});
