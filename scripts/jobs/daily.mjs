// GitHub Actions: daily. Finds new seasonal timetable PDFs on each route's
// calmac.co.uk page and pushes an alert to every subscriber when one appears.
// The PDFs seen so far are kept per page in Redis (timetable_pdfs:<slug>).

import { kvGetJsonMany, kvSetJson } from '../../lib/kv.js';
import { notify, runJob, say } from './common.mjs';

const CALMAC_ROUTE_BASE = 'https://www.calmac.co.uk/route-information';

// Our route keys → their pages, calmac.co.uk/route-information/<slug>/, as
// named in calmac.co.uk/sitemap.xml (two of our routes are two CalMac pages)
const ROUTE_PAGES = {
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

// The timetable PDFs linked from a page: only its timetables tab
// (#timetablesContent, up to #faresContent), so fares PDFs aren't included.
// calmac.co.uk answers 500 now and then, so a page is tried three times.
async function timetablePdfs(slug) {
  let html;
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch(`${CALMAC_ROUTE_BASE}/${slug}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WillItSailBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    }).catch(err => ({ ok: false, status: err.message }));
    if (resp.ok) { html = await resp.text(); break; }
    if (attempt === 3 || resp.status === 404) throw new Error(`HTTP ${resp.status}`);
    await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
  }
  const start = html.indexOf('id="timetablesContent"');
  if (start === -1) throw new Error('no timetables section on the page');
  const end = html.indexOf('id="faresContent"');
  const section = html.slice(start, end !== -1 ? end : start + 8000);
  return [...new Set([...section.matchAll(/href="(https:\/\/assets\.calmac\.co\.uk\/[^"]+\.pdf)"/gi)].map(m => m[1]))];
}

async function checkTimetables({ dry }) {
  const pages = Object.entries(ROUTE_PAGES).flatMap(([routeKey, slugs]) => slugs.map(slug => ({ routeKey, slug })));
  const known = await kvGetJsonMany(pages.map(p => `timetable_pdfs:${p.slug}`));
  const failed = [];
  const firstSeen = [];
  const fresh = [];

  // Five pages at a time, to go easy on calmac.co.uk
  for (let i = 0; i < pages.length; i += 5) {
    await Promise.all(pages.slice(i, i + 5).map(async ({ routeKey, slug }, j) => {
      try {
        const pdfs = await timetablePdfs(slug);
        if (!pdfs.length) return;
        const seen = known[i + j];
        // A page not checked before: what's on it now is where we start from,
        // not news
        if (!seen) firstSeen.push(slug);
        else {
          const newPdfs = pdfs.filter(url => !seen.includes(url));
          if (!newPdfs.length) return;
          fresh.push({ routeKey, slug, newPdfs });
        }
        if (!dry) await kvSetJson(`timetable_pdfs:${slug}`, [...new Set([...(seen || []), ...pdfs])]);
      } catch (err) {
        failed.push({ routeKey, slug, error: err.message });
      }
    }));
  }

  // One alert for all the routes with new timetables
  const routes = [...new Set(fresh.map(f => f.routeKey))];
  let broadcast = null;
  if (routes.length) {
    const message = routes.length === 1
      ? `New timetable available for ${routes[0]}.`
      : `New timetables for ${routes.length} routes: ${routes.slice(0, 3).join(', ')}${routes.length > 3 ? '…' : ''}`;
    broadcast = dry ? `would send: ${message}` : await notify({
      action: 'broadcast',
      title: '📅 New CalMac Timetable',
      message,
      url: routes.length === 1 ? `${CALMAC_ROUTE_BASE}/${fresh[0].slug}/#timetables` : 'https://www.calmac.co.uk/timetables',
    }).catch(err => ({ error: err.message }));
  }

  say(`Checked ${pages.length - failed.length} of ${pages.length} route pages; ${routes.length} routes with new timetables${firstSeen.length ? `; ${firstSeen.length} pages seen for the first time` : ''}.`);
  return { ok: failed.length < pages.length, newTimetables: fresh, firstSeen, broadcast, failed };
}

await runJob({ name: 'daily' }, checkTimetables);
