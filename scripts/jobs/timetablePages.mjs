// Shared by the daily job (daily.mjs) and the key cleanup (cleanup-keys.mjs).

// Our route keys → their pages, calmac.co.uk/route-information/<slug>/, as
// named in calmac.co.uk/sitemap.xml (two of our routes are two CalMac pages)
export const ROUTE_PAGES = {
  'Ardrossan - Brodick (Arran)':                       ['ardrossan-brodick'],
  'Kennacraig - Port Ellen / Port Askaig (Islay)':     ['kennacraig-port-askaig-islay-port-ellen-islay'],
  'Oban - Craignure (Mull)':                           ['oban-craignure'],
  'Oban - Coll / Tiree':                               ['oban-coll-tiree'],
  'Oban - Colonsay':                                   ['oban-colonsay-port-askaig-kennacraig'],
  'Oban - Castlebay / Lochboisdale':                   ['oban-castlebay', 'mallaigoban-lochboisdale'],
  'Mallaig - Armadale (Skye)':                         ['mallaig-armadale'],
  'Ullapool - Stornoway (Lewis)':                      ['stornoway-ullapool'],
  'Uig - Tarbert / Lochmaddy':                         ['uig-tarbert-harris', 'uig-lochmaddy'],
  'Gourock - Dunoon':                                  ['gourock-dunoon'],
  'Wemyss Bay - Rothesay (Bute)':                      ['wemyss-bay-rothesay'],
  'Colintraive - Rhubodach (Bute)':                    ['colintraive-rhubodach'],
  'Largs - Cumbrae Slip':                              ['largs-cumbrae-slip-millport'],
  'Tarbert - Portavadie':                              ['tarbert-loch-fyne-portavadie'],
  'Claonaig - Lochranza (Arran)':                      ['claonaig-tarbert-loch-fyne-lochranza'],
  'Tobermory - Kilchoan':                              ['tobermory-kilchoan'],
  'Fishnish - Lochaline':                              ['lochaline-fishnish'],
  'Mallaig - Small Isles':                             ['mallaig-small-isles'],
  'Oban - Lismore':                                    ['oban-lismore'],
  'Tayinloan - Gigha':                                 ['tayinloan-gigha'],
  'Sconser - Raasay':                                  ['sconser-raasay'],
  'Fionnphort - Iona':                                 ['fionnphort-iona'],
  'Troon - Brodick (Arran)':                           ['troon-brodick'],
};
