// Reading CalMac's notices (lib/disruptions.js): warnings that sailings are
// liable to disruption or cancellation, and which sailings they cover

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noticeSeverity, noticeWarns, warnedFor } from '../lib/disruptions.js';
import { departureMs } from '../lib/sailingLog.js';

test('a notice warns when any sentence says sailings might be disrupted or cancelled', () => {
  assert.equal(noticeWarns({ title: 'Wednesday 21 October', detail: 'Due to a forecast of westerly winds gusting up to 38mph, service is liable to disruption or cancellation at short notice.' }), true);
  assert.equal(noticeWarns({ title: 'x', detail: 'There is a risk of cancellation later today.' }), true);
  // Inside a notice that also announces cancellations
  assert.equal(noticeWarns({ title: 'x', detail: 'The 10:00 is cancelled. Later sailings may be disrupted.' }), true);
  assert.equal(noticeWarns({ title: 'Additional sailings', detail: 'Extra sailings will run on Saturday.' }), false);
  assert.equal(noticeWarns({ title: 'x', detail: 'The 10:00 sailing is cancelled.' }), false);
});

test('noticeSeverity ranks a cancellation above a warning', () => {
  assert.equal(noticeSeverity({ title: 'x', detail: 'The 10:00 sailing is cancelled.' }), 'cancelled');
  assert.equal(noticeSeverity({ title: 'x', detail: 'Sailings are liable to disruption.' }), 'risk');
  assert.equal(noticeSeverity({ title: 'x', detail: 'Mobility assistance is available.' }), null);
});

test('a warning covers the sailings from its day until it ends', () => {
  const now = new Date('2026-10-20T18:00:00Z');
  // As CalMac publishes one: titled with its day, ending at that day's (UK) midnight
  const disruption = { notices: [{ title: 'Wednesday 21 October', detail: 'Service is liable to disruption or cancellation at short notice.', startDateTime: '2026-10-20T14:36:00.000Z', endDateTime: '2026-10-21T23:00:00.000Z' }] };
  const warned = (date, time) => warnedFor(disruption, date, departureMs(date, time), now);
  assert.equal(warned('2026-10-20', '18:30'), false, 'the day before');
  assert.equal(warned('2026-10-21', '06:05'), true, 'first sailing on the day');
  assert.equal(warned('2026-10-21', '23:30'), true, 'last sailing on the day');
  assert.equal(warned('2026-10-22', '06:05'), false, 'the day after');
});

test('an information notice, or no notices, warns nothing', () => {
  const now = new Date('2026-10-20T18:00:00Z');
  const info = { notices: [{ title: 'Additional sailings', detail: 'Extra sailings will run.', startDateTime: '2026-10-01T00:00:00Z', endDateTime: '2026-12-01T00:00:00Z' }] };
  assert.equal(warnedFor(info, '2026-10-21', departureMs('2026-10-21', '10:00'), now), false);
  assert.equal(warnedFor({ notices: [] }, '2026-10-21', departureMs('2026-10-21', '10:00'), now), false);
  assert.equal(warnedFor(null, '2026-10-21', departureMs('2026-10-21', '10:00'), now), false);
});
