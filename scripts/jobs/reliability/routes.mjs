// Where CalMac publishes each of the site's routes' reliability figures
// (read by calmac.mjs; checked against the site's routes by tests/routes.test.mjs).

// Our route keys → corporate.calmac.co.uk/…/route-performance-reports/<slug>/
// (Troon - Brodick has no report)
export const ROUTE_SLUGS = {
  'Ardrossan - Brodick (Arran)':                       'ardrossan-brodick',
  'Kennacraig - Port Ellen / Port Askaig (Islay)':     'kennacraig-islay',
  'Oban - Craignure (Mull)':                           'oban-craignure',
  'Oban - Coll / Tiree':                               'oban-coll-tiree',
  'Oban - Colonsay':                                   'oban-colonsay',
  'Oban - Castlebay / Lochboisdale':                   'oban-castlebaylochboisdale',
  'Mallaig - Armadale (Skye)':                         'mallaig-armadale',
  'Ullapool - Stornoway (Lewis)':                      'ullapool-stornoway',
  'Uig - Tarbert / Lochmaddy':                         'uig-tarbert-lochmaddy',
  'Gourock - Dunoon':                                  'gourock-dunoon',
  'Wemyss Bay - Rothesay (Bute)':                      'wemyss-bay-rothesay',
  'Colintraive - Rhubodach (Bute)':                    'colintraive-rhubodach',
  'Largs - Cumbrae Slip':                              'largs-cumbrae',
  'Tarbert - Portavadie':                              'tarbert-loch-fyne-portavadie',
  'Claonaig - Lochranza (Arran)':                      'claonaig-lochranza',
  'Tobermory - Kilchoan':                              'tobermory-kilchoan',
  'Fishnish - Lochaline':                              'fishnish-lochaline',
  'Mallaig - Small Isles':                             'mallaig-small-isles',
  'Oban - Lismore':                                    'oban-lismore',
  'Tayinloan - Gigha':                                 'tayinloan-gigha',
  'Sconser - Raasay':                                  'sconser-raasay',
  'Fionnphort - Iona':                                 'fionnphort-iona',
};

// The island packs' route names → our route keys (their other routes aren't
// on the site; Mallaig - Armadale, Mallaig - Small Isles, Oban - Lismore,
// Tayinloan - Gigha and Sconser - Raasay aren't in any pack)
export const PACK_ROUTES = {
  'Ardrossan - Brodick':           'Ardrossan - Brodick (Arran)',
  'Claonaig - Lochranza':          'Claonaig - Lochranza (Arran)',
  'Wemyss Bay - Rothesay':         'Wemyss Bay - Rothesay (Bute)',
  'Colintraive - Rhubodach':       'Colintraive - Rhubodach (Bute)',
  'Oban - Castlebay/Lochboisdale': 'Oban - Castlebay / Lochboisdale',
  'Oban - Coll/Tiree':             'Oban - Coll / Tiree',
  'Oban - Colonsay':               'Oban - Colonsay',
  'Kennacraig - Islay':            'Kennacraig - Port Ellen / Port Askaig (Islay)',
  'Uig - Tarbert/Lochmaddy':       'Uig - Tarbert / Lochmaddy',
  'Ullapool - Stornoway':          'Ullapool - Stornoway (Lewis)',
  'Oban - Craignure':              'Oban - Craignure (Mull)',
  'Tobermory - Kilchoan':          'Tobermory - Kilchoan',
  'Fishnish - Lochaline':          'Fishnish - Lochaline',
  'Gourock - Dunoon':              'Gourock - Dunoon',
  'Tarbert LF - Portavadie':       'Tarbert - Portavadie',
  'Largs - Cumbrae Slip':          'Largs - Cumbrae Slip',
  'Fionnphort - Iona':             'Fionnphort - Iona',
};
