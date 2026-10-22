// The vessel API (pages/api/vessel.js) against a fake aisstream.io: a ship's
// live position, the stream refusing the subscription, and silence, each
// saying why there's no position

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
const { FLEET, ROUTE_BOXES, scheduledVessel } = require('../lib/fleet.js');
let wss, handler;

before(async () => {
  // Answers by the route's box (every lookup now listens for the whole
  // fleet): Largs reports its own ship, Iona its ship after a non-position,
  // Wemyss Bay only a relief ship, Raasay only a non-position, Gigha's
  // subscription is refused, anything else hears nothing
  wss = new WebSocketServer({ port: 0 });
  await new Promise(resolve => wss.on('listening', resolve));
  const position = (mmsi, lat, lon, field = 'MMSI_String') =>
    JSON.stringify({ MessageType: 'PositionReport', MetaData: { [field]: field === 'MMSI' ? mmsi : String(mmsi) }, Message: { PositionReport: { Latitude: lat, Longitude: lon, Sog: 9.5, TrueHeading: 270 } } });
  const notPosition = JSON.stringify({ MessageType: 'ShipStaticData', MetaData: { MMSI: 1 }, Message: {} });
  wss.on('connection', ws => ws.on('message', raw => {
    const sub = JSON.parse(raw);
    assert.equal(sub.APIKey, 'test-key');
    // Every CalMac lookup listens for the whole fleet
    if (sub.FiltersShipMMSI) assert.equal(sub.FiltersShipMMSI.length, FLEET.length);
    const [[minLat, minLon]] = sub.BoundingBoxes[0];
    const route = Object.keys(ROUTE_BOXES).find(name => ROUTE_BOXES[name][0] === minLat && ROUTE_BOXES[name][2] === minLon);
    if (route === 'Largs - Cumbrae Slip') ws.send(position(scheduledVessel(route).mmsi, 55.795, -4.88));
    else if (route === 'Fionnphort - Iona') {
      // A position with the MMSI only as a number, after a message that isn't one
      ws.send(notPosition);
      ws.send(position(scheduledVessel(route).mmsi, 56.33, -6.38, 'MMSI'));
    } else if (route === 'Wemyss Bay - Rothesay (Bute)') {
      // Only a relief ship, MV Coruisk, at Rothesay
      ws.send(position(235008929, 55.839, -5.052));
    } else if (route === 'Sconser - Raasay') ws.send(notPosition);
    else if (route === 'Tayinloan - Gigha') {
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

test('a position is found whichever field the MMSI comes in, after other messages', async () => {
  const r = await call({ route: 'Fionnphort - Iona', live: '1' });
  assert.equal(r.vessel.name, 'MV Loch Buie');
});

test('only other messages: the reason says what came instead', { timeout: 10000 }, async () => {
  const r = await call({ route: 'Sconser - Raasay', live: '1', wait: '1' });
  assert.equal(r.vessel, null);
  assert.match(r.why, /no position from CalMac ships in 1s; first other message: ShipStaticData \{MessageType, MetaData, Message\} MetaData \{MMSI\} \(1 messages\)/);
});

test('silence is reported as no position in the time', { timeout: 10000 }, async () => {
  const r = await call({ route: 'Mallaig - Small Isles', live: '1', wait: '1' });
  assert.equal(r.vessel, null);
  assert.match(r.why, /no position from CalMac ships in 1s \(0 messages\)/);
});

test('any=1 takes any ship reporting in the box, and wait sets how long to listen', async () => {
  // The fake stream has nothing for an unfiltered subscription: the reason gives the wait
  const r = await call({ route: 'Mallaig - Small Isles', live: '1', any: '1', wait: '1' });
  assert.match(r.anyShip.why, /no position from any ship in 1s/);
});

test("with none of the route's own ships about, another CalMac ship there (a relief) is its live vessel", async () => {
  const r = await call({ route: 'Wemyss Bay - Rothesay (Bute)', live: '1', wait: '1' });
  assert.equal(r.vessel.name, 'MV Coruisk');
  assert.equal(r.vessel.live, true);
});

test('without live, the scheduled vessel', async () => {
  const r = await call({ route: 'Fionnphort - Iona' });
  assert.deepEqual(r.vessel, { name: 'MV Loch Buie', mmsi: 232003368, scheduled: true });
});
