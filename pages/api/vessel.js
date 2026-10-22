// api/vessel.js
// Returns the vessel currently operating a given route using AIS position data
// Uses aisstream.io WebSocket (free tier) with a short timeout
// Query: GET /api/vessel?route=Oban+-+Craignure+(Mull)
//   &live=1   look for the ship's live position (up to 5s)
//   &wait=N   with live, wait up to N seconds (at most 25), to diagnose
//   &any=1    with live, take any ship reporting in the route's box, to
//             see whether the stream covers the area at all

// The CalMac fleet, the routes each ship serves and each route's box (lib/fleet.js)
const { FLEET, ROUTE_BOXES, scheduledVessel } = require('../../lib/fleet');

const AISSTREAM_KEY = process.env.AISSTREAM_API_KEY || '';
// Overridable for the tests (tests/vessel.test.mjs)
const AISSTREAM_URL = process.env.AISSTREAM_URL || 'wss://stream.aisstream.io/v0/stream';

// Open a brief WebSocket to aisstream.io, wait up to 5s for a position from
// any known MMSI in the bounding box. Without one, why not: { why, messages }
// (no key, the stream's own error, the connection closing or failing, or
// simply no report from those ships in the time).
async function getLivePosition(mmsiList, box, waitMs = 5500) {
  if (!AISSTREAM_KEY) return { why: 'no AIS key configured', messages: 0 };
  if (mmsiList && !mmsiList.length) return { why: 'no ships known for the route', messages: 0 };
  const [minLat, maxLat, minLon, maxLon] = box;

  const { default: WebSocket } = await import('ws');

  return new Promise(resolve => {
    let done = false;
    const finish = val => { if (!done) { done = true; resolve(val); try { ws.terminate(); } catch (_) {} } };
    // `skipped`: what the first message that wasn't a usable position was
    let msgCount = 0, opened = false, skipped = null;
    const fail = why => finish({ why: skipped ? `${why}; first other message: ${skipped}` : why, messages: msgCount });
    const secs = waitMs / 1000;
    const timeout = setTimeout(() => fail(opened ? `no position from ${mmsiList ? 'these ships' : 'any ship'} in ${secs}s` : `could not connect to the AIS stream in ${secs}s`), waitMs);

    let ws;
    try { ws = new WebSocket(AISSTREAM_URL); }
    catch (err) { clearTimeout(timeout); return resolve({ why: `could not open the AIS stream: ${err.message}`, messages: 0 }); }

    ws.on('open', () => {
      opened = true;
      const sub = {
        APIKey:             AISSTREAM_KEY,
        BoundingBoxes:      [[[minLat, minLon], [maxLat, maxLon]]],
        ...(mmsiList && { FiltersShipMMSI: mmsiList.map(String) }),
        FilterMessageTypes: ['PositionReport'],
      };
      console.log('[vessel] WS open, mmsis:', mmsiList ? mmsiList.join(',') : 'any', 'box:', box.join(','));
      ws.send(JSON.stringify(sub));
    });

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString());
        msgCount++;
        // The stream reports a refused subscription (a bad key, say) as { error }
        if (msg.error) { clearTimeout(timeout); return fail(`AIS stream: ${msg.error}`); }
        console.log('[vessel] msg#' + msgCount + ' type:', msg.MessageType, JSON.stringify(msg).slice(0, 200));
        if (msg.MessageType === 'PositionReport') {
          const pos  = msg.Message?.PositionReport;
          const mmsi = Number(msg.MetaData?.MMSI ?? msg.MetaData?.MMSI_String) || null;
          if (pos && mmsi && pos.Latitude !== 0) {
            clearTimeout(timeout);
            return finish({ mmsi, name: msg.MetaData?.ShipName?.trim() || null, lat: pos.Latitude, lon: pos.Longitude, speed: pos.Sog, heading: pos.TrueHeading });
          }
        }
        skipped ||= `${msg.MessageType || 'no MessageType'} {${Object.keys(msg).join(', ')}}${msg.MetaData ? ` MetaData {${Object.keys(msg.MetaData).join(', ')}}` : ''}`;
      } catch (_) {
        msgCount++;
        skipped ||= `not JSON: ${raw.toString().slice(0, 80)}`;
      }
    });

    ws.on('error', (err) => { console.log('[vessel] WS error:', err.message); clearTimeout(timeout); fail(`AIS stream error: ${err.message}`); });
    ws.on('close', (code, reason) => { clearTimeout(timeout); fail(`AIS stream closed (${code}${reason?.length ? `: ${reason}` : ''})`); });
  });
}


module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const route = req.query.route;
  if (!route) return res.status(400).json({ error: 'route param required' });

  // The ships that serve the route, and the one scheduled on it
  const routeEntries = FLEET.filter(v => v.routes.includes(route));
  const fleetEntry   = scheduledVessel(route);

  // ?live=1 — called from inside the tracker overlay after the map opens
  // Does the slow WebSocket lookup; no CDN cache
  if (req.query.live === '1') {
    res.setHeader('Cache-Control', 'no-store');
    const box = ROUTE_BOXES[route];
    const waitMs = Math.min(25, Math.max(1, Number(req.query.wait) || 5.5)) * 1000;
    if (box && req.query.any === '1') {
      const anyShip = await getLivePosition(null, box, waitMs);
      return res.status(200).json({ anyShip, route });
    }
    let why = box ? 'no ships known for the route' : 'no box for the route';
    if (box && routeEntries.length) {
      const routeMMSIs = routeEntries.map(v => v.mmsi);
      const livePos    = await getLivePosition(routeMMSIs, box, waitMs);
      if (livePos?.why) why = `${livePos.why} (${livePos.messages} messages)`;
      else if (livePos) {
        const known = FLEET.find(v => v.mmsi === livePos.mmsi);
        return res.status(200).json({
          vessel: {
            name:    known?.name || 'Unknown vessel',
            mmsi:    livePos.mmsi,
            lat:     livePos.lat,
            lon:     livePos.lon,
            speed:   livePos.speed,
            heading: livePos.heading,
            live:    true,
          },
          route,
          fetchedAt: new Date().toISOString(),
        });
      }
    }
    return res.status(200).json({ vessel: null, note: 'No live position found', why, route });
  }

  // Default (no ?live) — instant response from FLEET registry, no WS
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=60');
  return res.status(200).json({
    vessel: fleetEntry
      ? { name: fleetEntry.name, mmsi: fleetEntry.mmsi, scheduled: true }
      : null,
    route,
    fetchedAt: new Date().toISOString(),
  });
};

// Long enough for a diagnostic wait (&wait=25)
module.exports.config = { maxDuration: 30 };
