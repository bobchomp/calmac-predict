// api/vessel.js
// Returns the vessel currently operating a given route using AIS position data
// Uses aisstream.io WebSocket (free tier) with a short timeout
// Query: GET /api/vessel?route=Oban+-+Craignure+(Mull)

// Known CalMac fleet: MMSI → vessel name + normal routes
const FLEET = {
  235095079: { name: 'MV Loch Seaforth',      routes: ['Ullapool - Stornoway (Lewis)'] },
  235085609: { name: 'MV Glen Sannox',        routes: ['Troon - Brodick (Arran)'] },
  235066370: { name: 'MV Caledonian Isles',   routes: ['Ardrossan - Brodick (Arran)'] },
  235079850: { name: 'MV Isle of Mull',       routes: ['Oban - Craignure (Mull)'] },
  235083609: { name: 'MV Loch Frisa',         routes: ['Oban - Craignure (Mull)'] },
  235093279: { name: 'MV Finlaggan',          routes: ['Kennacraig - Port Ellen / Port Askaig (Islay)'] },
  235112985: { name: 'MV Isle of Islay',      routes: ['Kennacraig - Port Ellen / Port Askaig (Islay)'] },
  235077130: { name: 'MV Hebrides',           routes: ['Uig - Tarbert / Lochmaddy'] },
  235071469: { name: 'MV Clansman',           routes: ['Oban - Coll / Tiree'] },
  235059939: { name: 'MV Isle of Lewis',      routes: ['Oban - Castlebay / Lochboisdale'] },
  235055539: { name: 'MV Lord of the Isles',  routes: ['Oban - Castlebay / Lochboisdale'] },
  235091199: { name: 'MV Argyle',             routes: ['Wemyss Bay - Rothesay (Bute)'] },
  235091209: { name: 'MV Bute',               routes: ['Wemyss Bay - Rothesay (Bute)'] },
  235098039: { name: 'MV Loch Shira',         routes: ['Gourock - Dunoon'] },
  232003213: { name: 'MV Ali Cat',            routes: ['Gourock - Dunoon'] },
  235004390: { name: 'MV Argyll Flyer',       routes: ['Gourock - Dunoon'] },
  235081779: { name: 'MV Coruisk',            routes: ['Mallaig - Armadale (Skye)'] },
  235056949: { name: 'MV Loch Fyne',          routes: ['Mallaig - Armadale (Skye)'] },
  235079060: { name: 'MV Lochnevis',          routes: ['Mallaig - Small Isles'] },
  235061829: { name: 'MV Loch Striven',       routes: ['Oban - Lismore'] },
  235061819: { name: 'MV Loch Riddon',        routes: ['Tobermory - Kilchoan'] },
  235061799: { name: 'MV Loch Linnhe',        routes: ['Fishnish - Lochaline'] },
  235083579: { name: 'MV Loch Alainn',        routes: ['Oban - Castlebay / Lochboisdale'] },
  235071009: { name: 'MV Catriona',           routes: ['Claonaig - Lochranza (Arran)'] },
  235098079: { name: 'MV Loch Tarbert',       routes: ['Tarbert - Portavadie'] },
  235098089: { name: 'MV Loch Dunvegan',      routes: ['Colintraive - Rhubodach (Bute)'] },
  235098099: { name: 'MV Loch Portain',       routes: ['Uig - Tarbert / Lochmaddy'] },
  235091219: { name: 'MV Argyll',             routes: ['Largs - Cumbrae Slip'] },
  235091229: { name: 'MV Isle of Cumbrae',    routes: ['Largs - Cumbrae Slip'] },
  338237958: { name: 'MV Alfred',             routes: ['Troon - Brodick (Arran)'] },
  235082229: { name: 'MV Isle of Arran',      routes: ['Ardrossan - Brodick (Arran)'] },
  235060249: { name: 'MV Loch Bhrusda',       routes: [] },
};

const AISSTREAM_KEY = process.env.AISSTREAM_API_KEY || '';

// Open a brief WebSocket to aisstream.io, wait up to 5s for a position from any known MMSI in the bounding box
async function getLivePosition(mmsiList, box) {
  if (!AISSTREAM_KEY || !mmsiList.length) return null;
  const [minLat, maxLat, minLon, maxLon] = box;

  const { default: WebSocket } = await import('ws');

  return new Promise(resolve => {
    let done = false;
    const finish = val => { if (!done) { done = true; resolve(val); try { ws.terminate(); } catch (_) {} } };
    const timeout = setTimeout(() => finish(null), 5500);

    let ws;
    try { ws = new WebSocket('wss://stream.aisstream.io/v0/stream'); }
    catch (_) { clearTimeout(timeout); return resolve(null); }

    ws.on('open', () => {
      const sub = {
        APIKey:             AISSTREAM_KEY,
        BoundingBoxes:      [[[minLat, minLon], [maxLat, maxLon]]],
        FiltersShipMMSI:    mmsiList.map(String),
        FilterMessageTypes: ['PositionReport'],
      };
      console.log('[vessel] WS open, mmsis:', mmsiList.join(','), 'box:', box.join(','));
      ws.send(JSON.stringify(sub));
    });

    let msgCount = 0;
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString());
        msgCount++;
        console.log('[vessel] msg#' + msgCount + ' type:', msg.MessageType, JSON.stringify(msg).slice(0, 200));
        if (msg.MessageType === 'PositionReport') {
          const pos  = msg.Message?.PositionReport;
          const mmsi = msg.MetaData?.MMSI_String ? parseInt(msg.MetaData.MMSI_String) : null;
          if (pos && mmsi && pos.Latitude !== 0) {
            clearTimeout(timeout);
            finish({ mmsi, lat: pos.Latitude, lon: pos.Longitude, speed: pos.Sog, heading: pos.TrueHeading });
          }
        }
      } catch (_) {}
    });

    ws.on('error', (err) => { console.log('[vessel] WS error:', err.message); clearTimeout(timeout); finish(null); });
  });
}

// Route bounding boxes [minLat, maxLat, minLon, maxLon]
const ROUTE_BOXES = {
  'Ullapool - Stornoway (Lewis)':              [57.8, 58.3, -6.5, -5.0],
  'Troon - Brodick (Arran)':                  [55.5, 55.7, -5.2, -4.6],
  'Ardrossan - Brodick (Arran)':              [55.5, 55.7, -5.3, -4.9],
  'Oban - Craignure (Mull)':                  [56.4, 56.6, -5.7, -5.4],
  'Kennacraig - Port Ellen / Port Askaig (Islay)': [55.6, 55.9, -6.2, -5.5],
  'Wemyss Bay - Rothesay (Bute)':             [55.8, 55.96, -5.1, -4.9],
  'Gourock - Dunoon':                         [55.93, 56.0, -4.95, -4.75],
  'Tarbert - Portavadie':                     [55.85, 55.95, -5.5, -5.3],
  'Fishnish - Lochaline':                     [56.5, 56.6, -5.85, -5.6],
  'Mallaig - Armadale (Skye)':               [57.0, 57.1, -5.9, -5.7],
  'Uig - Tarbert / Lochmaddy':               [57.5, 57.8, -7.2, -6.3],
  'Oban - Coll / Tiree':                      [56.3, 56.7, -7.0, -5.4],
  'Oban - Castlebay / Lochboisdale':          [56.3, 57.1, -7.5, -5.4],
  'Oban - Colonsay':                          [56.0, 56.3, -6.3, -5.4],
  'Claonaig - Lochranza (Arran)':             [55.7, 55.8, -5.3, -5.0],
  'Colintraive - Rhubodach (Bute)':           [55.9, 56.0, -5.2, -5.1],
  'Largs - Cumbrae Slip':                     [55.77, 55.85, -4.95, -4.85],
  'Oban - Lismore':                           [56.45, 56.6, -5.6, -5.3],
  'Mallaig - Small Isles':                    [56.9, 57.1, -6.3, -5.8],
  'Tobermory - Kilchoan':                     [56.65, 56.75, -6.2, -5.9],
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const route = req.query.route;
  if (!route) return res.status(400).json({ error: 'route param required' });

  const routeEntries = Object.entries(FLEET).filter(([, v]) => v.routes.includes(route));
  const fleetEntry   = routeEntries[0];

  // ?live=1 — called from inside the tracker overlay after the map opens
  // Does the slow WebSocket lookup; no CDN cache
  if (req.query.live === '1') {
    res.setHeader('Cache-Control', 'no-store');
    const box = ROUTE_BOXES[route];
    if (box && routeEntries.length) {
      const routeMMSIs = routeEntries.map(([mmsi]) => parseInt(mmsi));
      const livePos    = await getLivePosition(routeMMSIs, box);
      if (livePos) {
        const known = FLEET[livePos.mmsi];
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
    return res.status(200).json({ vessel: null, note: 'No live position found', route });
  }

  // Default (no ?live) — instant response from FLEET registry, no WS
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=60');
  return res.status(200).json({
    vessel: fleetEntry
      ? { name: fleetEntry[1].name, mmsi: parseInt(fleetEntry[0]), scheduled: true }
      : null,
    route,
    fetchedAt: new Date().toISOString(),
  });
};