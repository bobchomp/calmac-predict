// Met Office weather warnings (the National Severe Weather Warning Service),
// from its regional RSS feeds, matched to routes by the council areas each
// warning lists. Read by /api/warnings for the site and the tracker. They're
// shown and recorded; they don't change the chance (yet): a wind warning is
// mostly the same forecast the chance already uses, so whether they should
// is for the sailing log to show.

import { departureMs } from './sailingLog';

export const METOFFICE_FEED = region => `https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/${region}`;
// Strathclyde, and Highlands & Eilean Siar
export const METOFFICE_REGIONS = ['st', 'he'];

// Each route's council areas, as the warnings name them (both ends)
const ARGYLL = 'Argyll and Bute';
export const ROUTE_AREAS = {
  'Ardrossan - Brodick (Arran)':                   ['North Ayrshire'],
  'Troon - Brodick (Arran)':                       ['South Ayrshire', 'North Ayrshire'],
  'Kennacraig - Port Ellen / Port Askaig (Islay)': [ARGYLL],
  'Oban - Craignure (Mull)':                       [ARGYLL],
  'Oban - Coll / Tiree':                           [ARGYLL],
  'Oban - Colonsay':                               [ARGYLL],
  'Oban - Castlebay / Lochboisdale':               [ARGYLL, 'Highland', 'Na h-Eileanan Siar'],
  'Mallaig - Armadale (Skye)':                     ['Highland'],
  'Ullapool - Stornoway (Lewis)':                  ['Highland', 'Na h-Eileanan Siar'],
  'Uig - Tarbert / Lochmaddy':                     ['Highland', 'Na h-Eileanan Siar'],
  'Gourock - Dunoon':                              ['Inverclyde', ARGYLL],
  'Wemyss Bay - Rothesay (Bute)':                  ['Inverclyde', ARGYLL],
  'Colintraive - Rhubodach (Bute)':                [ARGYLL],
  'Largs - Cumbrae Slip':                          ['North Ayrshire'],
  'Tarbert - Portavadie':                          [ARGYLL],
  'Claonaig - Lochranza (Arran)':                  [ARGYLL, 'North Ayrshire'],
  'Tayinloan - Gigha':                             [ARGYLL],
  'Tobermory - Kilchoan':                          [ARGYLL, 'Highland'],
  'Fishnish - Lochaline':                          [ARGYLL, 'Highland'],
  'Mallaig - Small Isles':                         ['Highland'],
  'Oban - Lismore':                                [ARGYLL],
  'Sconser - Raasay':                              ['Highland'],
  'Fionnphort - Iona':                             [ARGYLL],
};

export const LEVELS = ['yellow', 'amber', 'red'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const tag = (xml, name) => decode((xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]?.trim() || '');

// "1700 Sat 24 Oct" (UK time) → ms, in the year that puts it nearest now
function validMs(text, now) {
  const m = text.match(/(\d{2})(\d{2})\s+\w+\s+(\d{1,2})\s+(\w{3})/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[4].toLowerCase());
  if (month < 0) return null;
  const year = new Date(now).getUTCFullYear();
  const options = [year - 1, year, year + 1].map(y =>
    departureMs(`${y}-${String(month + 1).padStart(2, '0')}-${m[3].padStart(2, '0')}`, `${m[1]}:${m[2]}`));
  return options.reduce((best, ms) => (Math.abs(ms - now) < Math.abs(best - now) ? ms : best));
}

// One feed's warnings: [{ id, level, type, areas, from, to, title, url }]
export function parseWarnings(xml, now = Date.now()) {
  const warnings = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = tag(item, 'title');
    const description = tag(item, 'description');
    const url = tag(item, 'link');
    const kind = title.match(/^(Yellow|Amber|Red) warning of (.+?) affecting/i);
    const valid = description.match(/valid from (.+?) to (.+?)$/i);
    if (!kind || !valid) continue;
    const areas = (description.match(/affecting [^:]+:\s*(.+?)\s+valid from/i)?.[1] || '').split(',').map(a => a.trim()).filter(Boolean);
    warnings.push({
      id: url.match(/id=([\w-]+)/)?.[1] || title,
      level: kind[1].toLowerCase(),
      type: kind[2].toLowerCase(),
      areas,
      from: validMs(valid[1], now),
      to: validMs(valid[2], now),
      title, url,
    });
  }
  return warnings;
}

// Warnings from several feeds as one list: a warning in two regions' feeds
// (same id) is one warning covering both regions' areas
export function mergeWarnings(lists) {
  const byId = new Map();
  for (const w of lists.flat()) {
    const seen = byId.get(w.id);
    if (seen) seen.areas = [...new Set([...seen.areas, ...w.areas])];
    else byId.set(w.id, { ...w, areas: [...w.areas] });
  }
  return [...byId.values()];
}

// A route's warnings in force at some point between fromMs and toMs, most
// severe first
export function routeWarnings(warnings, routeName, fromMs, toMs = fromMs) {
  const areas = ROUTE_AREAS[routeName] || [];
  return (warnings || [])
    .filter(w => w.areas.some(a => areas.includes(a)) && w.from != null && w.to != null && w.from <= toMs && w.to >= fromMs)
    .sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level));
}

// As the sailing log keeps them: "yellow wind", most severe first
export const warningLabels = warnings => warnings.map(w => `${w.level} ${w.type}`);
