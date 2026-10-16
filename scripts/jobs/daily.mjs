// GitHub Actions: daily. Replaces /api/check-timetables (which /api/cron ran
// every 5 minutes): finds new seasonal timetable PDFs on each route's
// calmac.co.uk page and pushes an alert to every subscriber when one appears.
// The PDFs seen so far are kept per route in Redis (timetable_pdfs:<slug>).

import { kvGetJsonMany, kvSetJson } from '../../lib/kv.js';
import { VERCEL_CRON_KEY, notify, ranWithin, runJob, say } from './common.mjs';

const CALMAC_ROUTE_BASE = 'https://www.calmac.co.uk/route-information';

// Our route keys → calmac.co.uk/route-information/<slug>/
const ROUTE_SLUGS = {
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
  'Troon - Brodick (Arran)':                           'troon-brodick',
};

// The timetable PDFs linked from a route's page: only its timetables tab
// (#timetablesContent, up to #faresContent), so fares PDFs aren't included
async function timetablePdfs(slug) {
  const resp = await fetch(`${CALMAC_ROUTE_BASE}/${slug}/`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WillItSailBot/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  const start = html.indexOf('id="timetablesContent"');
  const end = html.indexOf('id="faresContent"');
  const section = start !== -1 ? html.slice(start, end !== -1 ? end : start + 8000) : html;
  return [...new Set([...section.matchAll(/href="(https:\/\/assets\.calmac\.co\.uk\/[^"]+\.pdf)"/gi)].map(m => m[1]))];
}

async function checkTimetables({ dry }) {
  const entries = Object.entries(ROUTE_SLUGS);
  const known = await kvGetJsonMany(entries.map(([, slug]) => `timetable_pdfs:${slug}`));
  const failed = [];
  const newRoutes = [];

  // Five pages at a time, to go easy on calmac.co.uk
  for (let i = 0; i < entries.length; i += 5) {
    await Promise.all(entries.slice(i, i + 5).map(async ([routeKey, slug], j) => {
      try {
        const pdfs = await timetablePdfs(slug);
        const seen = known[i + j] || [];
        const fresh = pdfs.filter(url => !seen.includes(url));
        if (!pdfs.length || !fresh.length) return;
        newRoutes.push({ routeKey, slug, newPdfs: fresh });
        if (!dry) await kvSetJson(`timetable_pdfs:${slug}`, [...new Set([...seen, ...pdfs])]);
      } catch (err) {
        failed.push({ routeKey, error: err.message });
      }
    }));
  }

  let broadcast = null;
  if (newRoutes.length) {
    const names = newRoutes.map(r => r.routeKey);
    const message = names.length === 1
      ? `New timetable available for ${names[0]}.`
      : `New timetables for ${names.length} routes: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`;
    broadcast = dry ? `would send: ${message}` : await notify({
      action: 'broadcast',
      title: '📅 New CalMac Timetable',
      message,
      url: newRoutes.length === 1 ? `${CALMAC_ROUTE_BASE}/${newRoutes[0].slug}/#timetables` : 'https://www.calmac.co.uk/timetables',
    }).catch(err => ({ error: err.message }));
  }

  say(`Checked ${entries.length - failed.length} of ${entries.length} route pages; ${newRoutes.length} with new timetables.`);
  return { ok: failed.length < entries.length, newRoutes, broadcast, failed };
}

await runJob({ name: 'daily', vercelBusy: () => ranWithin(VERCEL_CRON_KEY, 12 * 60 * 1000) }, checkTimetables);
