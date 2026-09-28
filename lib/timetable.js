// Built-in timetable (summer 2026). The site shows live sailings from
// /api/timetable; this is the fallback when that is unavailable, and the only
// source for the non-CalMac routes (Seil - Luing, Port Askaig - Feolin).
export const TIMETABLE = {
  // ══ SUMMER 2026 (27 Mar – 18 Oct 2026) ══
  // PDF sources fetched directly from assets.calmac.co.uk
  // Mon–Thu representative day shown unless noted.

  // ✅ stt-05-ardrossan-brodick.pdf (updated 10/12/2025)
  'Ardrossan - Brodick (Arran)': [
    {t:'07:00',f:'Ardrossan',to:'Brodick'},{t:'08:20',f:'Brodick',to:'Ardrossan'},
    {t:'09:45',f:'Ardrossan',to:'Brodick'},{t:'11:05',f:'Brodick',to:'Ardrossan'},
    {t:'12:30',f:'Ardrossan',to:'Brodick'},{t:'13:55',f:'Brodick',to:'Ardrossan'},
    {t:'15:20',f:'Ardrossan',to:'Brodick'},{t:'16:40',f:'Brodick',to:'Ardrossan'},
    {t:'18:00',f:'Ardrossan',to:'Brodick'},{t:'19:20',f:'Brodick',to:'Ardrossan'},
  ],

  // ✅ stt-05b1-troon-brodick-alfred-06-04.pdf (updated 06/04/2026, MV Alfred)
  // Mon–Fri peak times; no Wednesday late sailings (WX code)
  'Troon - Brodick (Arran)': [
    {t:'10:00',f:'Troon',to:'Brodick'},{t:'11:50',f:'Brodick',to:'Troon'},
    {t:'14:00',f:'Troon',to:'Brodick'},{t:'15:50',f:'Brodick',to:'Troon'},
    {t:'18:10',f:'Troon',to:'Brodick'},{t:'19:30',f:'Brodick',to:'Troon'},
  ],

  // ✅ stt-09-kennacraig-islay.pdf — two-vessel service (MV Isle of Islay + MV Finlaggan)
  'Kennacraig - Port Ellen / Port Askaig (Islay)': [
    {t:'07:00',f:'Kennacraig',to:'Port Ellen'},{t:'09:10',f:'Port Ellen',to:'Kennacraig'},
    {t:'13:00',f:'Kennacraig',to:'Port Askaig'},{t:'14:55',f:'Port Askaig',to:'Kennacraig'},
    {t:'15:30',f:'Port Ellen',to:'Kennacraig'},{t:'18:00',f:'Kennacraig',to:'Port Ellen'},
    {t:'20:15',f:'Port Ellen',to:'Kennacraig'},
  ],

  // ✅ stt-11-oban-craignure-10apr-16oct-101225.pdf (updated 10/12/2025)
  // Two vessels: MV Isle of Mull + MV Loch Frisa (A-coded sailings = Loch Frisa)
  'Oban - Craignure (Mull)': [
    {t:'06:45',f:'Oban',to:'Craignure'},{t:'07:55',f:'Craignure',to:'Oban'},
    {t:'08:35',f:'Oban',to:'Craignure'},{t:'10:00',f:'Craignure',to:'Oban'},
    {t:'09:55',f:'Oban',to:'Craignure'},{t:'11:05',f:'Craignure',to:'Oban'},
    {t:'11:25',f:'Oban',to:'Craignure'},{t:'12:50',f:'Craignure',to:'Oban'},
    {t:'12:15',f:'Oban',to:'Craignure'},{t:'13:35',f:'Craignure',to:'Oban'},
    {t:'14:15',f:'Oban',to:'Craignure'},{t:'15:40',f:'Craignure',to:'Oban'},
    {t:'15:55',f:'Oban',to:'Craignure'},{t:'17:05',f:'Craignure',to:'Oban'},
    {t:'17:25',f:'Oban',to:'Craignure'},{t:'18:25',f:'Craignure',to:'Oban'},
    {t:'18:15',f:'Oban',to:'Craignure'},{t:'19:25',f:'Craignure',to:'Oban'},
    {t:'20:00',f:'Oban',to:'Craignure'},
  ],

  // ✅ ss-table-oba-col-tir-16052025.pdf (2025 timetable; 2026 structure same)
  // Different sailings each day of week. Shown: typical Mon timetable.
  'Oban - Coll / Tiree': [
    {t:'07:15',f:'Oban',to:'Coll'},{t:'09:55',f:'Coll',to:'Tiree'},
    {t:'11:35',f:'Tiree',to:'Coll'},{t:'12:45',f:'Coll',to:'Oban'},
  ],

  // ✅ stt-table-20-oba-cas.pdf — Oban–Castlebay. Mon–Fri standard day.
  // Note: Wednesdays operate via Coll & Tiree (longer journey)
  'Oban - Castlebay / Lochboisdale': [
    {t:'13:10',f:'Oban',to:'Castlebay'},
    {t:'06:55',f:'Castlebay',to:'Oban (next day)'},
  ],

  // Oban–Colonsay: typically 4 days/week, ~2h20 crossing
  // Standard Mon timetable from CalMac route page
  'Oban - Colonsay': [
    {t:'09:00',f:'Oban',to:'Colonsay'},{t:'11:30',f:'Colonsay',to:'Oban'},
    {t:'16:30',f:'Oban',to:'Colonsay'},{t:'19:00',f:'Colonsay',to:'Oban'},
  ],

  // ✅ stt-18-mallaig-armadale-2.pdf (updated 11/03/2026)
  // Varies considerably by day. Shown: Mon representative day (14 May – 25 Aug period).
  'Mallaig - Armadale (Skye)': [
    {t:'07:25',f:'Mallaig',to:'Armadale'},{t:'08:10',f:'Armadale',to:'Mallaig'},
    {t:'09:00',f:'Mallaig',to:'Armadale'},{t:'10:05',f:'Armadale',to:'Mallaig'},
    {t:'10:55',f:'Mallaig',to:'Armadale'},{t:'11:45',f:'Armadale',to:'Mallaig'},
    {t:'13:05',f:'Mallaig',to:'Armadale'},{t:'14:30',f:'Armadale',to:'Mallaig'},
    {t:'15:00',f:'Mallaig',to:'Armadale'},{t:'15:45',f:'Armadale',to:'Mallaig'},
    {t:'16:00',f:'Mallaig',to:'Armadale'},{t:'16:40',f:'Armadale',to:'Mallaig'},
    {t:'17:15',f:'Mallaig',to:'Armadale'},{t:'18:35',f:'Armadale',to:'Mallaig'},
  ],

  // ✅ stt-25-stornoway-ullapool.pdf (updated 10/12/2025)
  // Mon–Fri: Stornoway 07:00 → Ullapool 09:40; Ullapool 10:30 → Stornoway 13:10;
  // Stornoway 14:00 → Ullapool 16:40; Ullapool 17:30 → Stornoway 20:10
  'Ullapool - Stornoway (Lewis)': [
    {t:'07:00',f:'Stornoway',to:'Ullapool'},
    {t:'10:30',f:'Ullapool',to:'Stornoway'},
    {t:'14:00',f:'Stornoway',to:'Ullapool'},
    {t:'17:30',f:'Ullapool',to:'Stornoway'},
  ],

  // ✅ stt-table-24-uig-tar.pdf + stt-table-22-uig-lma.pdf (Skye Triangle)
  // Uig–Tarbert and Uig–Lochmaddy are run as a triangle; days alternate.
  // Mon: Lochmaddy leg. Tue: Tarbert leg. Combined here for display.
  'Uig - Tarbert / Lochmaddy': [
    {t:'05:15',f:'Uig',to:'Tarbert'},{t:'07:20',f:'Tarbert',to:'Uig'},   // Mon (peak)
    {t:'09:30',f:'Uig',to:'Lochmaddy'},{t:'11:15',f:'Lochmaddy',to:'Uig'}, // Mon
    {t:'09:25',f:'Uig',to:'Tarbert'},{t:'11:05',f:'Tarbert',to:'Uig'},   // Tue
    {t:'14:10',f:'Uig',to:'Tarbert'},{t:'15:50',f:'Tarbert',to:'Uig'},   // Tue
    {t:'14:10',f:'Uig',to:'Lochmaddy'},{t:'15:55',f:'Lochmaddy',to:'Uig'}, // Thu
    {t:'18:40',f:'Uig',to:'Tarbert'},{t:'20:20',f:'Tarbert',to:'Uig'},   // Tue
    {t:'18:30',f:'Uig',to:'Lochmaddy'},                                     // Mon
  ],

  // ✅ stt-01-gourock-dunoon-sv.pdf (updated 26/03/2026)
  // Passenger-only service. Sun timetable shown (hourly). Mon–Sat more frequent.
  'Gourock - Dunoon': [
    {t:'06:10',f:'Gourock',to:'Dunoon'},{t:'06:35',f:'Dunoon',to:'Gourock'},
    {t:'07:15',f:'Gourock',to:'Dunoon'},{t:'07:40',f:'Dunoon',to:'Gourock'},
    {t:'08:15',f:'Gourock',to:'Dunoon'},{t:'08:40',f:'Dunoon',to:'Gourock'},
    {t:'09:15',f:'Gourock',to:'Dunoon'},{t:'09:40',f:'Dunoon',to:'Gourock'},
    {t:'10:05',f:'Gourock',to:'Dunoon'},{t:'10:40',f:'Dunoon',to:'Gourock'},
    {t:'11:15',f:'Gourock',to:'Dunoon'},{t:'11:40',f:'Dunoon',to:'Gourock'},
    {t:'12:15',f:'Gourock',to:'Dunoon'},{t:'12:40',f:'Dunoon',to:'Gourock'},
    {t:'13:15',f:'Gourock',to:'Dunoon'},{t:'13:40',f:'Dunoon',to:'Gourock'},
    {t:'14:30',f:'Gourock',to:'Dunoon'},{t:'14:55',f:'Dunoon',to:'Gourock'},
    {t:'16:00',f:'Gourock',to:'Dunoon'},{t:'16:25',f:'Dunoon',to:'Gourock'},
    {t:'17:00',f:'Gourock',to:'Dunoon'},{t:'17:25',f:'Dunoon',to:'Gourock'},
    {t:'18:15',f:'Gourock',to:'Dunoon'},{t:'18:40',f:'Dunoon',to:'Gourock'},
    {t:'19:15',f:'Gourock',to:'Dunoon'},{t:'19:40',f:'Dunoon',to:'Gourock'},
    {t:'20:15',f:'Gourock',to:'Dunoon'},{t:'20:40',f:'Dunoon',to:'Gourock'},
    {t:'21:40',f:'Gourock',to:'Dunoon'},{t:'22:05',f:'Dunoon',to:'Gourock'},
    {t:'22:40',f:'Gourock',to:'Dunoon'},{t:'23:05',f:'Dunoon',to:'Gourock'},
  ],

  // ✅ stt-table-03-wem-rot.pdf (verified, Mon–Fri)
  'Wemyss Bay - Rothesay (Bute)': [
    {t:'07:15',f:'Wemyss Bay',to:'Rothesay'},{t:'07:40',f:'Rothesay',to:'Wemyss Bay'},
    {t:'08:05',f:'Wemyss Bay',to:'Rothesay'},{t:'08:40',f:'Rothesay',to:'Wemyss Bay'},
    {t:'09:05',f:'Wemyss Bay',to:'Rothesay'},{t:'09:40',f:'Rothesay',to:'Wemyss Bay'},
    {t:'10:05',f:'Wemyss Bay',to:'Rothesay'},{t:'10:40',f:'Rothesay',to:'Wemyss Bay'},
    {t:'11:15',f:'Wemyss Bay',to:'Rothesay'},{t:'11:50',f:'Rothesay',to:'Wemyss Bay'},
    {t:'12:15',f:'Wemyss Bay',to:'Rothesay'},{t:'13:05',f:'Rothesay',to:'Wemyss Bay'},
    {t:'13:05',f:'Wemyss Bay',to:'Rothesay'},{t:'13:40',f:'Rothesay',to:'Wemyss Bay'},
    {t:'14:05',f:'Wemyss Bay',to:'Rothesay'},{t:'14:40',f:'Rothesay',to:'Wemyss Bay'},
    {t:'15:05',f:'Wemyss Bay',to:'Rothesay'},{t:'15:40',f:'Rothesay',to:'Wemyss Bay'},
    {t:'16:05',f:'Wemyss Bay',to:'Rothesay'},{t:'16:35',f:'Rothesay',to:'Wemyss Bay'},
    {t:'17:05',f:'Wemyss Bay',to:'Rothesay'},{t:'17:35',f:'Rothesay',to:'Wemyss Bay'},
    {t:'18:05',f:'Wemyss Bay',to:'Rothesay'},{t:'18:40',f:'Rothesay',to:'Wemyss Bay'},
    {t:'19:05',f:'Wemyss Bay',to:'Rothesay'},{t:'19:40',f:'Rothesay',to:'Wemyss Bay'},
    {t:'20:05',f:'Wemyss Bay',to:'Rothesay'},{t:'20:35',f:'Rothesay',to:'Wemyss Bay'},
  ],

  // ✅ stt-table-04-ctr-rhu.pdf (verified)
  // Every 30 min from 05:30, Mon–Fri until 21:00
  'Colintraive - Rhubodach (Bute)': [
    {t:'05:30',f:'Colintraive',to:'Rhubodach'},{t:'05:40',f:'Rhubodach',to:'Colintraive'},
    {t:'06:00',f:'Colintraive',to:'Rhubodach'},{t:'06:10',f:'Rhubodach',to:'Colintraive'},
    {t:'06:30',f:'Colintraive',to:'Rhubodach'},{t:'06:40',f:'Rhubodach',to:'Colintraive'},
    {t:'07:00',f:'Colintraive',to:'Rhubodach'},{t:'07:10',f:'Rhubodach',to:'Colintraive'},
    {t:'07:30',f:'Colintraive',to:'Rhubodach'},{t:'07:40',f:'Rhubodach',to:'Colintraive'},
    {t:'08:00',f:'Colintraive',to:'Rhubodach'},{t:'08:10',f:'Rhubodach',to:'Colintraive'},
    {t:'08:30',f:'Colintraive',to:'Rhubodach'},{t:'08:40',f:'Rhubodach',to:'Colintraive'},
    {t:'09:00',f:'Colintraive',to:'Rhubodach'},{t:'09:10',f:'Rhubodach',to:'Colintraive'},
    {t:'09:30',f:'Colintraive',to:'Rhubodach'},{t:'09:40',f:'Rhubodach',to:'Colintraive'},
    {t:'10:00',f:'Colintraive',to:'Rhubodach'},{t:'10:10',f:'Rhubodach',to:'Colintraive'},
    {t:'10:30',f:'Colintraive',to:'Rhubodach'},{t:'10:40',f:'Rhubodach',to:'Colintraive'},
    {t:'11:00',f:'Colintraive',to:'Rhubodach'},{t:'11:10',f:'Rhubodach',to:'Colintraive'},
    {t:'11:30',f:'Colintraive',to:'Rhubodach'},{t:'11:40',f:'Rhubodach',to:'Colintraive'},
    {t:'12:00',f:'Colintraive',to:'Rhubodach'},{t:'12:10',f:'Rhubodach',to:'Colintraive'},
    {t:'12:30',f:'Colintraive',to:'Rhubodach'},{t:'12:40',f:'Rhubodach',to:'Colintraive'},
    {t:'13:00',f:'Colintraive',to:'Rhubodach'},{t:'13:10',f:'Rhubodach',to:'Colintraive'},
    {t:'13:30',f:'Colintraive',to:'Rhubodach'},{t:'13:40',f:'Rhubodach',to:'Colintraive'},
    {t:'14:10',f:'Colintraive',to:'Rhubodach'},{t:'14:20',f:'Rhubodach',to:'Colintraive'},
    {t:'14:30',f:'Colintraive',to:'Rhubodach'},{t:'14:40',f:'Rhubodach',to:'Colintraive'},
    {t:'15:00',f:'Colintraive',to:'Rhubodach'},{t:'15:10',f:'Rhubodach',to:'Colintraive'},
    {t:'15:30',f:'Colintraive',to:'Rhubodach'},{t:'15:40',f:'Rhubodach',to:'Colintraive'},
    {t:'16:00',f:'Colintraive',to:'Rhubodach'},{t:'16:10',f:'Rhubodach',to:'Colintraive'},
    {t:'16:30',f:'Colintraive',to:'Rhubodach'},{t:'16:40',f:'Rhubodach',to:'Colintraive'},
    {t:'17:00',f:'Colintraive',to:'Rhubodach'},{t:'17:10',f:'Rhubodach',to:'Colintraive'},
    {t:'17:30',f:'Colintraive',to:'Rhubodach'},{t:'17:40',f:'Rhubodach',to:'Colintraive'},
    {t:'18:00',f:'Colintraive',to:'Rhubodach'},{t:'18:10',f:'Rhubodach',to:'Colintraive'},
    {t:'18:30',f:'Colintraive',to:'Rhubodach'},{t:'18:40',f:'Rhubodach',to:'Colintraive'},
    {t:'19:00',f:'Colintraive',to:'Rhubodach'},{t:'19:10',f:'Rhubodach',to:'Colintraive'},
    {t:'19:30',f:'Colintraive',to:'Rhubodach'},{t:'19:40',f:'Rhubodach',to:'Colintraive'},
    {t:'20:00',f:'Colintraive',to:'Rhubodach'},{t:'20:10',f:'Rhubodach',to:'Colintraive'},
    {t:'20:30',f:'Colintraive',to:'Rhubodach'},{t:'20:40',f:'Rhubodach',to:'Colintraive'},
    {t:'20:55',f:'Colintraive',to:'Rhubodach'},{t:'21:05',f:'Rhubodach',to:'Colintraive'},
  ],

  // Largs–Cumbrae: ~every 15 min. Summer 2026 had community controversy about
  // potential frequency reduction but CalMac confirmed two-vessel summer service.
  // Standard departures every 15 min from ~07:00 to ~21:00.
  'Largs - Cumbrae Slip': [
    {t:'07:00',f:'Largs',to:'Cumbrae'},{t:'07:15',f:'Cumbrae',to:'Largs'},
    {t:'07:30',f:'Largs',to:'Cumbrae'},{t:'07:45',f:'Cumbrae',to:'Largs'},
    {t:'08:00',f:'Largs',to:'Cumbrae'},{t:'08:15',f:'Cumbrae',to:'Largs'},
    {t:'08:30',f:'Largs',to:'Cumbrae'},{t:'08:45',f:'Cumbrae',to:'Largs'},
    {t:'09:00',f:'Largs',to:'Cumbrae'},{t:'09:15',f:'Cumbrae',to:'Largs'},
    {t:'09:30',f:'Largs',to:'Cumbrae'},{t:'09:45',f:'Cumbrae',to:'Largs'},
    {t:'10:00',f:'Largs',to:'Cumbrae'},{t:'10:15',f:'Cumbrae',to:'Largs'},
    {t:'10:30',f:'Largs',to:'Cumbrae'},{t:'10:45',f:'Cumbrae',to:'Largs'},
    {t:'11:00',f:'Largs',to:'Cumbrae'},{t:'11:15',f:'Cumbrae',to:'Largs'},
    {t:'11:30',f:'Largs',to:'Cumbrae'},{t:'11:45',f:'Cumbrae',to:'Largs'},
    {t:'12:00',f:'Largs',to:'Cumbrae'},{t:'12:15',f:'Cumbrae',to:'Largs'},
    {t:'12:30',f:'Largs',to:'Cumbrae'},{t:'12:45',f:'Cumbrae',to:'Largs'},
    {t:'13:00',f:'Largs',to:'Cumbrae'},{t:'13:15',f:'Cumbrae',to:'Largs'},
    {t:'13:30',f:'Largs',to:'Cumbrae'},{t:'13:45',f:'Cumbrae',to:'Largs'},
    {t:'14:00',f:'Largs',to:'Cumbrae'},{t:'14:15',f:'Cumbrae',to:'Largs'},
    {t:'14:30',f:'Largs',to:'Cumbrae'},{t:'14:45',f:'Cumbrae',to:'Largs'},
    {t:'15:00',f:'Largs',to:'Cumbrae'},{t:'15:15',f:'Cumbrae',to:'Largs'},
    {t:'15:30',f:'Largs',to:'Cumbrae'},{t:'15:45',f:'Cumbrae',to:'Largs'},
    {t:'16:00',f:'Largs',to:'Cumbrae'},{t:'16:15',f:'Cumbrae',to:'Largs'},
    {t:'16:30',f:'Largs',to:'Cumbrae'},{t:'16:45',f:'Cumbrae',to:'Largs'},
    {t:'17:00',f:'Largs',to:'Cumbrae'},{t:'17:15',f:'Cumbrae',to:'Largs'},
    {t:'17:30',f:'Largs',to:'Cumbrae'},{t:'17:45',f:'Cumbrae',to:'Largs'},
    {t:'18:00',f:'Largs',to:'Cumbrae'},{t:'18:15',f:'Cumbrae',to:'Largs'},
    {t:'18:30',f:'Largs',to:'Cumbrae'},{t:'18:45',f:'Cumbrae',to:'Largs'},
    {t:'19:00',f:'Largs',to:'Cumbrae'},{t:'19:15',f:'Cumbrae',to:'Largs'},
    {t:'19:30',f:'Largs',to:'Cumbrae'},{t:'19:45',f:'Cumbrae',to:'Largs'},
    {t:'20:00',f:'Largs',to:'Cumbrae'},{t:'20:15',f:'Cumbrae',to:'Largs'},
    {t:'20:30',f:'Largs',to:'Cumbrae'},{t:'20:45',f:'Cumbrae',to:'Largs'},
    {t:'21:00',f:'Largs',to:'Cumbrae'},
  ],

  // ✅ stt-table-02-tlf-por.pdf (verified) — hourly 09:00–18:00 daily
  'Tarbert - Portavadie': [
    {t:'09:00',f:'Tarbert',to:'Portavadie'},{t:'09:30',f:'Portavadie',to:'Tarbert'},
    {t:'10:00',f:'Tarbert',to:'Portavadie'},{t:'10:30',f:'Portavadie',to:'Tarbert'},
    {t:'11:00',f:'Tarbert',to:'Portavadie'},{t:'11:30',f:'Portavadie',to:'Tarbert'},
    {t:'12:00',f:'Tarbert',to:'Portavadie'},{t:'12:30',f:'Portavadie',to:'Tarbert'},
    {t:'13:00',f:'Tarbert',to:'Portavadie'},{t:'13:30',f:'Portavadie',to:'Tarbert'},
    {t:'14:00',f:'Tarbert',to:'Portavadie'},{t:'14:30',f:'Portavadie',to:'Tarbert'},
    {t:'15:00',f:'Tarbert',to:'Portavadie'},{t:'15:30',f:'Portavadie',to:'Tarbert'},
    {t:'16:00',f:'Tarbert',to:'Portavadie'},{t:'16:30',f:'Portavadie',to:'Tarbert'},
    {t:'17:00',f:'Tarbert',to:'Portavadie'},{t:'17:30',f:'Portavadie',to:'Tarbert'},
    {t:'18:00',f:'Tarbert',to:'Portavadie'},{t:'18:30',f:'Portavadie',to:'Tarbert'},
  ],

  // ✅ stt-table-06-lra-cla.pdf (verified) — daily, tidal variations apply on many dates
  'Claonaig - Lochranza (Arran)': [
    {t:'08:50',f:'Claonaig',to:'Lochranza'},{t:'09:30',f:'Lochranza',to:'Claonaig'},
    {t:'10:05',f:'Claonaig',to:'Lochranza'},{t:'10:45',f:'Lochranza',to:'Claonaig'},
    {t:'11:20',f:'Claonaig',to:'Lochranza'},{t:'12:00',f:'Lochranza',to:'Claonaig'},
    {t:'12:35',f:'Claonaig',to:'Lochranza'},{t:'13:15',f:'Lochranza',to:'Claonaig'},
    {t:'13:50',f:'Claonaig',to:'Lochranza'},{t:'14:30',f:'Lochranza',to:'Claonaig'},
    {t:'15:05',f:'Claonaig',to:'Lochranza'},{t:'15:45',f:'Lochranza',to:'Claonaig'},
    {t:'16:20',f:'Claonaig',to:'Lochranza'},{t:'17:05',f:'Lochranza',to:'Claonaig'},
    {t:'17:40',f:'Claonaig',to:'Lochranza'},{t:'18:25',f:'Lochranza',to:'Claonaig'},
    {t:'19:00',f:'Claonaig',to:'Lochranza'},{t:'19:30',f:'Lochranza',to:'Claonaig'},
  ],

  // ✅ stt-table-14-tob-kic.pdf (verified) — Mon–Sat 6 sailings each direction
  'Tobermory - Kilchoan': [
    {t:'07:20',f:'Tobermory',to:'Kilchoan'},{t:'08:00',f:'Kilchoan',to:'Tobermory'},
    {t:'09:30',f:'Tobermory',to:'Kilchoan'},{t:'10:15',f:'Kilchoan',to:'Tobermory'},
    {t:'11:00',f:'Tobermory',to:'Kilchoan'},{t:'11:45',f:'Kilchoan',to:'Tobermory'},
    {t:'13:00',f:'Tobermory',to:'Kilchoan'},{t:'13:45',f:'Kilchoan',to:'Tobermory'},
    {t:'14:30',f:'Tobermory',to:'Kilchoan'},{t:'15:15',f:'Kilchoan',to:'Tobermory'},
    {t:'16:00',f:'Tobermory',to:'Kilchoan'},{t:'16:45',f:'Kilchoan',to:'Tobermory'},
    {t:'18:00',f:'Tobermory',to:'Kilchoan'},{t:'18:40',f:'Kilchoan',to:'Tobermory'},
  ],

  // ✅ stt-12-lochaline-fishnish-260126.pdf (updated 23/01/2026)
  // Mon–Sat: 13 sailings; gaps midday. Shown: representative day.
  'Fishnish - Lochaline': [
    {t:'07:00',f:'Lochaline',to:'Fishnish'},{t:'07:25',f:'Fishnish',to:'Lochaline'},
    {t:'07:50',f:'Lochaline',to:'Fishnish'},{t:'08:15',f:'Fishnish',to:'Lochaline'},
    {t:'08:50',f:'Lochaline',to:'Fishnish'},{t:'09:15',f:'Fishnish',to:'Lochaline'},
    {t:'09:40',f:'Lochaline',to:'Fishnish'},{t:'10:05',f:'Fishnish',to:'Lochaline'},
    {t:'10:30',f:'Lochaline',to:'Fishnish'},{t:'10:55',f:'Fishnish',to:'Lochaline'},
    {t:'11:20',f:'Lochaline',to:'Fishnish'},{t:'11:45',f:'Fishnish',to:'Lochaline'},
    {t:'12:10',f:'Lochaline',to:'Fishnish'},{t:'12:35',f:'Fishnish',to:'Lochaline'},
    {t:'14:15',f:'Lochaline',to:'Fishnish'},{t:'14:40',f:'Fishnish',to:'Lochaline'},
    {t:'15:55',f:'Lochaline',to:'Fishnish'},{t:'16:20',f:'Fishnish',to:'Lochaline'},
    {t:'16:55',f:'Lochaline',to:'Fishnish'},{t:'17:20',f:'Fishnish',to:'Lochaline'},
    {t:'17:45',f:'Lochaline',to:'Fishnish'},{t:'18:10',f:'Fishnish',to:'Lochaline'},
    {t:'18:35',f:'Lochaline',to:'Fishnish'},
  ],

  // Mallaig–Small Isles: MV Lochnevis, different islands each day of week
  'Mallaig - Small Isles': [
    {t:'10:15',f:'Mallaig',to:'Small Isles'},{t:'16:00',f:'Small Isles',to:'Mallaig'},
  ],

  // Oban–Lismore: MV Loch Striven, ~hourly, tidal restrictions on many dates
  'Oban - Lismore': [
    {t:'09:00',f:'Oban',to:'Lismore'},{t:'09:55',f:'Lismore',to:'Oban'},
    {t:'10:50',f:'Oban',to:'Lismore'},{t:'11:45',f:'Lismore',to:'Oban'},
    {t:'12:40',f:'Oban',to:'Lismore'},{t:'13:35',f:'Lismore',to:'Oban'},
    {t:'14:30',f:'Oban',to:'Lismore'},{t:'15:25',f:'Lismore',to:'Oban'},
    {t:'16:20',f:'Oban',to:'Lismore'},{t:'17:15',f:'Lismore',to:'Oban'},
    {t:'18:10',f:'Oban',to:'Lismore'},{t:'19:05',f:'Lismore',to:'Oban'},
  ],

  // Seil–Luing: MV Loch Alainn, ~hourly
  'Seil - Luing': [
    {t:'07:50',f:'Seil',to:'Luing'},{t:'08:10',f:'Luing',to:'Seil'},
    {t:'08:50',f:'Seil',to:'Luing'},{t:'09:10',f:'Luing',to:'Seil'},
    {t:'09:50',f:'Seil',to:'Luing'},{t:'10:10',f:'Luing',to:'Seil'},
    {t:'10:50',f:'Seil',to:'Luing'},{t:'11:10',f:'Luing',to:'Seil'},
    {t:'11:50',f:'Seil',to:'Luing'},{t:'12:10',f:'Luing',to:'Seil'},
    {t:'12:50',f:'Seil',to:'Luing'},{t:'13:10',f:'Luing',to:'Seil'},
    {t:'13:50',f:'Seil',to:'Luing'},{t:'14:10',f:'Luing',to:'Seil'},
    {t:'14:50',f:'Seil',to:'Luing'},{t:'15:10',f:'Luing',to:'Seil'},
    {t:'15:50',f:'Seil',to:'Luing'},{t:'16:10',f:'Luing',to:'Seil'},
    {t:'16:50',f:'Seil',to:'Luing'},{t:'17:10',f:'Luing',to:'Seil'},
    {t:'17:50',f:'Seil',to:'Luing'},{t:'18:10',f:'Luing',to:'Seil'},
    {t:'18:50',f:'Seil',to:'Luing'},
  ],

  // Port Askaig–Feolin: MV Eilean Dhiura, ~hourly
  'Port Askaig - Feolin (Jura)': [
    {t:'08:00',f:'Port Askaig',to:'Feolin'},{t:'08:20',f:'Feolin',to:'Port Askaig'},
    {t:'09:00',f:'Port Askaig',to:'Feolin'},{t:'09:20',f:'Feolin',to:'Port Askaig'},
    {t:'10:00',f:'Port Askaig',to:'Feolin'},{t:'10:20',f:'Feolin',to:'Port Askaig'},
    {t:'11:00',f:'Port Askaig',to:'Feolin'},{t:'11:20',f:'Feolin',to:'Port Askaig'},
    {t:'12:00',f:'Port Askaig',to:'Feolin'},{t:'12:20',f:'Feolin',to:'Port Askaig'},
    {t:'13:00',f:'Port Askaig',to:'Feolin'},{t:'13:20',f:'Feolin',to:'Port Askaig'},
    {t:'14:00',f:'Port Askaig',to:'Feolin'},{t:'14:20',f:'Feolin',to:'Port Askaig'},
    {t:'15:00',f:'Port Askaig',to:'Feolin'},{t:'15:20',f:'Feolin',to:'Port Askaig'},
    {t:'16:00',f:'Port Askaig',to:'Feolin'},{t:'16:20',f:'Feolin',to:'Port Askaig'},
    {t:'17:00',f:'Port Askaig',to:'Feolin'},{t:'17:20',f:'Feolin',to:'Port Askaig'},
    {t:'18:00',f:'Port Askaig',to:'Feolin'},{t:'18:20',f:'Feolin',to:'Port Askaig'},
    {t:'19:00',f:'Port Askaig',to:'Feolin'},{t:'19:20',f:'Feolin',to:'Port Askaig'},
  ],
};

// Today's date in the UK (YYYY-MM-DD), or a number of days later
const ukDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' });

export function ukDateStr(offsetDays = 0) {
  const d = new Date(ukDateFmt.format(new Date()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
