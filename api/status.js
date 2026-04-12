// api/status.js
// Fetches live CalMac service status via their internal GraphQL API
// (apim.calmac.co.uk/graphql) — works when Origin header is set to calmac.co.uk

const CACHE_SECONDS = 120; // 2 min cache — this is real-time disruption data

const GRAPHQL_QUERY = `{
  routes {
    name
    routeCode
    status
    isStatusChangeUpcoming
    routeStatuses {
      title
      status
      subStatus
      updatedAtDateTime
    }
  }
}`;

// Map CalMac route names → our internal route keys
const ROUTE_MAP = {
  'Gourock - Dunoon':                                          'Gourock - Dunoon',
  'Wemyss Bay - Rothesay':                                     'Wemyss Bay - Rothesay (Bute)',
  'Ardrossan - Brodick':                                       'Ardrossan - Brodick (Arran)',
  'Troon - Brodick':                                           'Troon - Brodick (Arran)',
  'Claonaig - Lochranza':                                      'Claonaig - Lochranza (Arran)',
  'Largs - Cumbrae Slip (Millport)':                           'Largs - Cumbrae Slip',
  'Colintraive - Rhubodach':                                   'Colintraive - Rhubodach (Bute)',
  'Tarbert (Loch Fyne) - Portavadie':                         'Tarbert - Portavadie',
  'Uig - Lochmaddy':                                           'Uig - Tarbert / Lochmaddy',
  'Uig - Tarbert':                                             'Uig - Tarbert / Lochmaddy',
  'Kennacraig - Port Askaig (Islay) / Port Ellen (Islay)':    'Kennacraig - Port Ellen / Port Askaig (Islay)',
  'Oban - Craignure':                                          'Oban - Craignure (Mull)',
  'Oban - Castlebay':                                          'Oban - Castlebay / Lochboisdale',
  'Mallaig / Oban - Lochboisdale':                             'Oban - Castlebay / Lochboisdale',
  'Mallaig - Armadale':                                        'Mallaig - Armadale (Skye)',
  'Ullapool - Stornoway':                                      'Ullapool - Stornoway (Lewis)',
  'Lochaline - Fishnish':                                      'Fishnish - Lochaline',
  'Mallaig - Eigg/Muck/Rum/Canna':                             'Mallaig - Small Isles',
  'Oban - Coll/Tiree':                                         'Oban - Coll / Tiree',
  'Oban - Colonsay - Port Askaig - Kennacraig':               'Oban - Colonsay',
  'Oban - Lismore':                                            'Oban - Lismore',
  'Tobermory - Kilchoan':                                      'Tobermory - Kilchoan',
  'Tayinloan - Gigha':                                         'Tayinloan - Gigha',
  'Sconser - Raasay':                                          'Sconser - Raasay',
};

// Normalise CalMac status strings → our internal status
function normaliseStatus(status, subStatus) {
  const s = (status || '').toUpperCase();
  const ss = (subStatus || '').toUpperCase();
  if (s === 'ALL_SAILINGS_CANCELLED' || ss === 'ALL_SAILINGS_CANCELLED') return 'cancelled';
  if (s === 'DISRUPTIONS' || ss === 'DISRUPTIONS') return 'disrupted';
  if (s === 'BE_AWARE' || ss === 'BE_AWARE') return 'amber';
  if (s === 'NORMAL' || s === 'NONE') return 'normal';
  if (s === 'SAILING' && ss === 'DISRUPTIONS') return 'disrupted';
  if (s === 'SAILING' && ss === 'BE_AWARE') return 'amber';
  if (s === 'SAILING' && (ss === 'CANCELLED' || ss === 'ALL_SAILINGS_CANCELLED')) return 'cancelled';
  return 'unknown';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=30`);

  try {
    const resp = await fetch('https://apim.calmac.co.uk/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // The APIM endpoint checks Origin — must appear to come from calmac.co.uk
        'Origin': 'https://www.calmac.co.uk',
        'Referer': 'https://www.calmac.co.uk/en-gb/service-status/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      },
      body: JSON.stringify({ variables: {}, query: GRAPHQL_QUERY }),
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      throw new Error(`GraphQL ${resp.status}`);
    }

    const json = await resp.json();
    const rawRoutes = json?.data?.routes || [];

    if (!rawRoutes.length) throw new Error('Empty routes array');

    // Map to our format
    const routes = rawRoutes
      .map(r => {
        const routeKey = ROUTE_MAP[r.name] || null;
        const topStatus = normaliseStatus(r.status, null);

        // Find the most severe routeStatus for today's sailing entry
        let status = topStatus;
        let message = '';
        const todayEntry = r.routeStatuses?.find(s =>
          s.status === 'SAILING' || s.title?.toLowerCase().includes('today') || s.title?.toLowerCase().includes(new Date().toLocaleDateString('en-GB', { weekday: 'long' }).toLowerCase())
        );
        if (todayEntry) {
          const derived = normaliseStatus(todayEntry.status, todayEntry.subStatus);
          if (['cancelled', 'disrupted', 'amber'].includes(derived)) {
            status = derived;
            message = todayEntry.title || '';
          }
        }

        return {
          name: r.name,
          routeKey,
          status,
          message,
          isUpcoming: r.isStatusChangeUpcoming || false,
          raw: r.status, // keep raw for debugging
        };
      })
      .filter(r => r.routeKey); // only routes we know about

    const disrupted = routes.filter(r => !['normal', 'unknown'].includes(r.status));

    return res.status(200).json({
      routes,
      disrupted,
      source: 'apim.calmac.co.uk/graphql',
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    // Fallback — return empty silently, no banner shown
    return res.status(200).json({
      routes: [],
      disrupted: [],
      fallback: true,
      error: err.message,
      fallbackUrl: 'https://www.calmac.co.uk/en-gb/service-status/',
      fetchedAt: new Date().toISOString(),
    });
  }
};