// The vessel API (pages/api/vessel.js) against a fake aisstream.io: a ship's
// live position, the stream refusing the subscription, and silence, each
// saying why there's no position

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
const { scheduledVessel } = require('../lib/fleet.js');
let wss, handler;

before(async () => {
  // Answers by the route's ships: Largs reports a position, Gigha's
  // subscription is refused, anything else hears nothing
  wss = new WebSocketServer({ port: 0 });
  await new Promise(resolve => wss.on('listening', resolve));
  wss.on('connection', ws => ws.on('message', raw => {
    const sub = JSON.parse(raw);
    assert.equal(sub.APIKey, 'test-key');
    const mmsis = sub.FiltersShipMMSI.map(Number);
    if (mmsis.includes(scheduledVessel('Largs - Cumbrae Slip').mmsi)) {
      ws.send(JSON.stringify({ MessageType: 'PositionReport', MetaData: { MMSI_String: String(scheduledVessel('Largs - Cumbrae Slip').mmsi) }, Message: { PositionReport: { Latitude: 55.795, Longitude: -4.88, Sog: 9.5, TrueHeading: 270 } } }));
    } else if (mmsis.includes(scheduledVessel('Tayinloan - Gigha').mmsi)) {
      ws.send(JSON.stringify({ error: 'Api Key Is Not Valid' }));
      ws.close();
    }
  }));
  process.env.AISSTREAM_API_KEY = 'test-key';
  process.env.AISSTREAM_URL = `ws://127.0.0.1:${wss.address().port}`;
  handler = require('../pages/api/vessel.js');
});
after(() => wss.close());

// Calls the handler as Next.js would, resolving with the JSON it sends
const call = query => new Promise(resolve => {
  const res = { setHeader() {}, status() { return this; }, json: resolve };
  handler({ query }, res);
});

test('a ship reporting from inside the route is its live vessel', async () => {
  const r = await call({ route: 'Largs - Cumbrae Slip', live: '1' });
  assert.equal(r.vessel.name, 'MV Loch Shira');
  assert.equal(r.vessel.live, true);
  assert.equal(r.vessel.lat, 55.795);
});

test("the stream's own error is the reason given", async () => {
  const r = await call({ route: 'Tayinloan - Gigha', live: '1' });
  assert.equal(r.vessel, null);
  assert.match(r.why, /Api Key Is Not Valid/);
});

test('silence is reported as no position in the time', { timeout: 10000 }, async () => {
  const r = await call({ route: 'Sconser - Raasay', live: '1' });
  assert.equal(r.vessel, null);
  assert.match(r.why, /no position from these ships in 5s \(0 messages\)/);
});

test('without live, the scheduled vessel', async () => {
  const r = await call({ route: 'Fionnphort - Iona' });
  assert.deepEqual(r.vessel, { name: 'MV Loch Buie', mmsi: 232003368, scheduled: true });
});
