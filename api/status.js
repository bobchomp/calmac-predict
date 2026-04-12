// api/status.js — CalMac service status via their internal JSON API
// Falls back gracefully if no endpoint works

const CACHE_SECONDS = 300;

const CALMAC_ENDPOINTS = [
  'https://www.calmac.co.uk/umbraco/api/ServiceStatus/GetRouteStatuses',
  'https://www.calmac.co.uk/umbraco/api/servicestatus/getall',
  'https://www.calmac.co.uk/api/service-status',
  'https://api.calmac.co.uk/v1/service-status',
  'https://api.calmac.co.uk/servicestatus',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Referer': 'https://www.calmac.co.uk/en-gb/service-status/',
};

// Map keywords → our route keys
const ROUTE_PATTERNS = [
  [/ardrossan|brodick(?!.*troon)/i, 'Ardrossan - Brodick (Arran)'],
  [/troon/i, 'Troon - Brodick (Arran)'],
  [/ullapool|stornoway/i, 'Ullapool - Stornoway (Lewis)'],
  [/kennacraig|islay|port ellen|port askaig/i, 'Kennacraig - Port Ellen / Port Askaig (Islay)'],
  [/wemyss|rothesay/i, 'Wemyss Bay - Rothesay (Bute)'],
  [/gourock|dunoon/i, 'Gourock - Dunoon'],
  [/tarbert.*portavadie|portavadie/i, 'Tarbert - Portavadie'],
  [/oban.*craignure|craignure/i, 'Oban - Craignure (Mull)'],
  [/lochaline|fishnish/i, 'Fishnish - Lochaline'],
  [/mallaig.*armadale|armadale/i, 'Mallaig - Armadale (Skye)'],
  [/uig|tarbert.*harris|lochmaddy/i, 'Uig - Tarbert / Lochmaddy'],
  [/oban.*coll|coll|tiree/i, 'Oban - Coll / Tiree'],
  [/castlebay|barra|lochboisdale/i, 'Oban - Castlebay / Lochboisdale'],
  [/colonsay/i, 'Oban - Colonsay'],
  [/claonaig|lochranza/i, 'Claonaig - Lochranza (Arran)'],
  [/colintraive|rhubodach/i, 'Colintraive - Rhubodach (Bute)'],
  [/largs|cumbrae/i, 'Largs - Cumbrae Slip'],
  [/lismore/i, 'Oban - Lismore'],
  [/small isles|eigg|muck|rum|canna/i, 'Mallaig - Small Isles'],
  [/tobermory|kilchoan/i, 'Tobermory - Kilchoan'],
];

function matchRoute(name) {
  for (const [re, key] of ROUTE_PATTERNS) {
    if (re.test(name)) return key;
  }
  return null;
}

function normaliseStatus(raw) {
  const s = (raw || '').toLowerCase();
  if (/cancel|suspend/.test(s)) return 'cancelled';
  if (/disrupt|red|severe/.test(s)) return 'disrupted';
  if (/amber|warn|delay/.test(s)) return 'amber';
  if (/normal|green|operat/.test(s)) return 'normal';
  return 'unknown';
}

function parseResponse(data) {
  const arr = Array.isArray(data) ? data
    : Array.isArray(data?.routes) ? data.routes
    : Array.isArray(data?.data) ? data.data
    : Array.isArray(data?.statuses) ? data.statuses
    : (Object.values(data || {})).find(v => Array.isArray(v)) || [];

  return arr.map(item => {
    const name = item.name || item.routeName || item.route || item.title || '';
    const status = normaliseStatus(item.status || item.statusColour || item.colour || item.state || '');
    const message = (item.message || item.statusMessage || item.description || '').slice(0, 200);
    return { name, routeKey: matchRoute(name), status, message };
  }).filter(r => r.name);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60`);

  for (const url of CALMAC_ENDPOINTS) {
    try {
      const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
      if (!resp.ok) continue;
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('json')) continue;
      const data = await resp.json();
      const routes = parseResponse(data);
      if (routes.length > 0) {
        return res.status(200).json({
          routes,
          disrupted: routes.filter(r => !['normal','unknown'].includes(r.status)),
          source: url,
          fetchedAt: new Date().toISOString(),
        });
      }
    } catch (_) { /* try next */ }
  }

  return res.status(200).json({
    routes: [],
    fallback: true,
    fallbackUrl: 'https://www.calmac.co.uk/en-gb/service-status/',
    fetchedAt: new Date().toISOString(),
  });
};