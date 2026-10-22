// The CalMac fleet for live vessel tracking (pages/api/vessel.js): each
// ship's MMSI (its AIS identity), name, and the site's routes it serves,
// main route first. Ships are in order of who normally runs a route, so a
// route's scheduled vessel is the first ship whose main route it is.
//
// MMSIs checked in Oct 2026 against at least two of Wikipedia, Ships of
// CalMac and AIS trackers (MarineTraffic, MagicPort, Tradlinx, MarineLink),
// except where marked. Relief ships are listed on the routes they cover: a
// ship only counts when it's inside the route's box (ROUTE_BOXES), so
// listing it on several routes can't put it on the wrong one.

const ARRAN = ['Ardrossan - Brodick (Arran)', 'Troon - Brodick (Arran)'];
const RELIEF = ['Tayinloan - Gigha', 'Sconser - Raasay', 'Fionnphort - Iona', 'Oban - Lismore', 'Tobermory - Kilchoan', 'Fishnish - Lochaline', 'Colintraive - Rhubodach (Bute)'];

const FLEET = [
  { mmsi: 235101635, name: 'MV Loch Seaforth',     routes: ['Ullapool - Stornoway (Lewis)'] },
  { mmsi: 232001580, name: 'MV Caledonian Isles',  routes: ARRAN },
  { mmsi: 232049068, name: 'MV Glen Sannox',       routes: ['Troon - Brodick (Arran)', 'Ardrossan - Brodick (Arran)', 'Uig - Tarbert / Lochmaddy'] },
  { mmsi: 232065396, name: 'MV Glen Rosa',         routes: ARRAN },               // MagicPort only
  { mmsi: 232019501, name: 'MV Alfred',            routes: ['Troon - Brodick (Arran)', 'Ardrossan - Brodick (Arran)'] }, // chartered; MagicPort only
  { mmsi: 235104000, name: 'MV Isle of Arran',     routes: [...ARRAN, 'Kennacraig - Port Ellen / Port Askaig (Islay)'] },
  { mmsi: 235083892, name: 'MV Finlaggan',         routes: ['Kennacraig - Port Ellen / Port Askaig (Islay)'] },
  { mmsi: 232049280, name: 'MV Isle of Islay',     routes: ['Kennacraig - Port Ellen / Port Askaig (Islay)', 'Oban - Colonsay'] }, // Wikipedia only
  { mmsi: 232343000, name: 'MV Isle of Mull',      routes: ['Oban - Craignure (Mull)'] },
  { mmsi: 232039981, name: 'MV Loch Frisa',        routes: ['Oban - Craignure (Mull)'] },  // her UK number (MagicPort)
  { mmsi: 257774600, name: 'MV Loch Frisa',        routes: ['Oban - Craignure (Mull)'] },  // her earlier Norwegian number
  { mmsi: 232002521, name: 'MV Isle of Lewis',     routes: ['Oban - Castlebay / Lochboisdale'] },
  { mmsi: 232003288, name: 'MV Clansman',          routes: ['Oban - Coll / Tiree', 'Oban - Colonsay', 'Oban - Castlebay / Lochboisdale'] },
  { mmsi: 232605000, name: 'MV Lord of the Isles', routes: ['Oban - Colonsay', 'Oban - Castlebay / Lochboisdale', 'Oban - Coll / Tiree'] },
  { mmsi: 235000864, name: 'MV Hebrides',          routes: ['Uig - Tarbert / Lochmaddy'] },
  { mmsi: 235052541, name: 'MV Argyle',            routes: ['Wemyss Bay - Rothesay (Bute)'] },
  { mmsi: 235025112, name: 'MV Bute',              routes: ['Wemyss Bay - Rothesay (Bute)'] },
  { mmsi: 235056506, name: 'MV Ali Cat',           routes: ['Gourock - Dunoon'] },
  { mmsi: 235087611, name: 'MV Argyll Flyer',      routes: ['Gourock - Dunoon'] },
  { mmsi: 235053239, name: 'MV Loch Shira',        routes: ['Largs - Cumbrae Slip'] },
  { mmsi: 232003244, name: 'MV Isle of Cumbrae',   routes: ['Tarbert - Portavadie', 'Largs - Cumbrae Slip'] },
  { mmsi: 235116772, name: 'MV Catriona',          routes: ['Claonaig - Lochranza (Arran)', 'Tarbert - Portavadie'] },
  { mmsi: 232003165, name: 'MV Loch Dunvegan',     routes: ['Colintraive - Rhubodach (Bute)'] },
  { mmsi: 235008929, name: 'MV Coruisk',           routes: ['Mallaig - Armadale (Skye)', 'Gourock - Dunoon'] },
  { mmsi: 232003166, name: 'MV Loch Fyne',         routes: ['Mallaig - Armadale (Skye)', 'Fishnish - Lochaline'] },
  { mmsi: 235099237, name: 'MV Lochinvar',         routes: ['Fishnish - Lochaline', 'Mallaig - Armadale (Skye)', 'Tarbert - Portavadie'] },
  { mmsi: 235000141, name: 'MV Lochnevis',         routes: ['Mallaig - Small Isles', 'Mallaig - Armadale (Skye)'] },
  { mmsi: 232003376, name: 'MV Loch Striven',      routes: ['Oban - Lismore', ...RELIEF] },
  { mmsi: 232003371, name: 'MV Loch Riddon',       routes: ['Tobermory - Kilchoan', ...RELIEF] },
  { mmsi: 232003372, name: 'MV Loch Tarbert',      routes: ['Tobermory - Kilchoan', 'Tarbert - Portavadie', 'Claonaig - Lochranza (Arran)'] },
  { mmsi: 232003370, name: 'MV Loch Ranza',        routes: ['Tayinloan - Gigha'] },
  { mmsi: 235099235, name: 'MV Hallaig',           routes: ['Sconser - Raasay'] },
  { mmsi: 232003368, name: 'MV Loch Buie',         routes: ['Fionnphort - Iona'] },
  // Relief ships, last: no route is theirs
  { mmsi: 232003369, name: 'MV Loch Linnhe',       routes: RELIEF },
  { mmsi: 232002598, name: 'MV Loch Bhrusda',      routes: RELIEF },
];

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
  'Tayinloan - Gigha':                        [55.62, 55.70, -5.78, -5.62],
  'Sconser - Raasay':                         [57.29, 57.37, -6.14, -6.04],
  'Fionnphort - Iona':                        [56.30, 56.35, -6.42, -6.34],
};

// The ship normally on a route: the first whose main route it is, else the
// first that serves it
const scheduledVessel = route => FLEET.find(v => v.routes[0] === route) || FLEET.find(v => v.routes.includes(route)) || null;

module.exports = { FLEET, ROUTE_BOXES, scheduledVessel };
