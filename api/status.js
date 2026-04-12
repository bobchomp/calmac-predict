// api/status.js — CalMac live service status via GraphQL
// Returns per-sailing cancellation data using startDateTime/endDateTime windows
// and parses time mentions from detail text for specific sailing flags

const CACHE_SECONDS = 120;

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
      startDateTime
      endDateTime
      detail
      disruptionReason
    }
  }
}`;

// CalMac route name → our internal route key
const ROUTE_MAP = {
  'Gourock - Dunoon':                                          'Gourock - Dunoon',
  'Wemyss Bay - Rothesay':                                     'Wemyss Bay - Rothesay (Bute)',
  'Ardrossan - Brodick':                                       'Ardrossan - Brodick (Arran)',
  'Troon - Brodick':                                           'Troon - Brodick (Arran)',
  'Claonaig - Lochranza':                                      'Claonaig - Lochranza (Arran)',
  'Largs - Cumbrae Slip (Millport)':                           'Largs - Cumbrae Slip',
  'Colintraive - Rhubodach':                                   'Colintraive - Rhubodach (Bute)',
  'Tarbert (Loch Fyne) - Portavadie':                          'Tarbert - Portavadie',
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
  'Fionnphort - Iona':                                         'Fionnphort - Iona',
};

// Top-level route status → our status
function normaliseTopStatus(status) {
  const s = (status || '').toUpperCase();
  if (s === 'ALL_SAILINGS_CANCELLED') return 'cancelled';
  if (s === 'DISRUPTIONS') return 'disrupted';
  if (s === 'BE_AWARE') return 'amber';
  if (s === 'NORMAL') return 'normal';
  return 'unknown';
}

// Extract times mentioned in detail text e.g. "06:55 sailing" "the 10:00 and 14:00"
function extractMentionedTimes(detail) {
  if (!detail) return [];
  const times = [];
  // Match HH:MM or H:MM patterns
  const matches = detail.matchAll(/\b(\d{1,2}):(\d{2})\b/g);
  for (const m of matches) {
    const h = m[1].padStart(2, '0');
    const min = m[2];
    times.push(`${h}:${min}`);
  }
  return [...new Set(times)];
}

// Check if a sailing time (HH:MM) falls within a routeStatus window
// windowStart/End are ISO strings, sailingTime is "HH:MM" for today
function sailingInWindow(sailingTime, windowStart, windowEnd) {
  if (!windowStart || !windowEnd) return false;
  const today = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
  const [hh, mm] = sailingTime.split(':').map(Number);
  const sailingMs = new Date(`${today}T${sailingTime}:00Z`).getTime();
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  return sailingMs >= startMs && sailingMs <= endMs;
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
        'Origin': 'https://www.calmac.co.uk',
        'Referer': 'https://www.calmac.co.uk/en-gb/service-status/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      },
      body: JSON.stringify({ variables: {}, query: GRAPHQL_QUERY }),
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) throw new Error(`GraphQL ${resp.status}`);
    const json = await resp.json();
    const rawRoutes = json?.data?.routes || [];
    if (!rawRoutes.length) throw new Error('Empty routes');

    const todayStr = new Date().toISOString().substring(0, 10);

    const routes = rawRoutes
      .filter(r => !r.name?.toLowerCase().includes('freight'))
      .map(r => {
        const routeKey = ROUTE_MAP[r.name] || null;
        const topStatus = normaliseTopStatus(r.status);

        // Find today's SAILING-type routeStatus entries
        const todaySailingEntries = (r.routeStatuses || []).filter(s => {
          if (s.status !== 'SAILING') return false;
          // Check if today falls within this entry's window
          const start = new Date(s.startDateTime);
          const end = new Date(s.endDateTime);
          const now = new Date();
          return now >= start && now <= end;
        });

        // Build per-sailing status map: { "HH:MM": { status, detail, reason } }
        const sailingStatuses = {};

        for (const entry of todaySailingEntries) {
          const subStatus = (entry.subStatus || '').toUpperCase();
          const entryStatus = subStatus === 'ALL_SAILINGS_CANCELLED' ? 'cancelled'
            : subStatus === 'DISRUPTIONS' ? 'disrupted'
            : subStatus === 'BE_AWARE' ? 'amber'
            : 'disrupted'; // default for SAILING entries

          const mentionedTimes = extractMentionedTimes(entry.detail);

          if (mentionedTimes.length > 0 && subStatus !== 'ALL_SAILINGS_CANCELLED') {
            // Only specific sailings mentioned — flag those
            for (const t of mentionedTimes) {
              sailingStatuses[t] = {
                status: entryStatus,
                detail: entry.detail?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')?.replace(/\[(\d+)\]:/g, '')?.replace(/\*\*/g, '').trim().substring(0, 300),
                reason: entry.disruptionReason || null,
              };
            }
          } else {
            // All sailings in window affected — use sentinel '*' meaning all
            sailingStatuses['*'] = {
              status: entryStatus,
              detail: entry.detail?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')?.replace(/\[(\d+)\]:/g, '')?.replace(/\*\*/g, '').trim().substring(0, 300),
              reason: entry.disruptionReason || null,
            };
          }
        }

        return {
          name: r.name,
          routeKey,
          status: topStatus,
          sailingStatuses,   // { "HH:MM": {...} } and/or { "*": {...} }
          isUpcoming: r.isStatusChangeUpcoming || false,
          raw: r.status,
        };
      })
      .filter(r => r.routeKey);

    const disrupted = routes.filter(r => !['normal', 'unknown'].includes(r.status));

    return res.status(200).json({
      routes,
      disrupted,
      source: 'apim.calmac.co.uk/graphql',
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
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