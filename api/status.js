// api/status.js — CalMac live service status via GraphQL
// Returns per-sailing cancellation data for all disruption reasons:
// Weather, Technical, Operational, Tidal, Other

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
  if (s === 'DISRUPTIONS')            return 'disrupted';
  if (s === 'BE_AWARE')               return 'amber';
  if (s === 'NORMAL')                 return 'normal';
  return 'unknown';
}

// subStatus → our status
function normaliseSubStatus(subStatus) {
  const s = (subStatus || '').toUpperCase();
  if (s === 'ALL_SAILINGS_CANCELLED') return 'cancelled';
  if (s === 'DISRUPTIONS')            return 'disrupted';
  if (s === 'BE_AWARE')               return 'amber';
  return 'disrupted'; // default for any SAILING entry
}

// Extract HH:MM times mentioned in detail text
function extractMentionedTimes(detail) {
  if (!detail) return [];
  const times = [];
  const matches = detail.matchAll(/\b(\d{1,2}):(\d{2})\b/g);
  for (const m of matches) {
    const h = m[1].padStart(2, '0');
    times.push(`${h}:${m[2]}`);
  }
  return [...new Set(times)];
}

// Does the detail text say specific sailings are cancelled?
// Looks for "cancelled" near time mentions or "all sailings cancelled" etc.
function detailImpliesCancelled(detail) {
  if (!detail) return false;
  const lower = detail.toLowerCase();
  return lower.includes('cancel') || lower.includes('no service') || lower.includes('not operat');
}

// Clean markdown from detail text
function cleanDetail(detail) {
  if (!detail) return '';
  return detail
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
    .replace(/\[(\d+)\]:/g, '')              // [1]: footnotes
    .replace(/\*\*/g, '')                    // bold
    .replace(/\*/g, '')                      // italic
    .trim()
    .substring(0, 350);
}

// Check if a routeStatus window covers today
function coversToday(startDateTime, endDateTime) {
  if (!startDateTime || !endDateTime) return false;
  const now = new Date();
  return now >= new Date(startDateTime) && now <= new Date(endDateTime);
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

    const routes = rawRoutes
      .filter(r => !r.name?.toLowerCase().includes('freight'))
      .map(r => {
        const routeKey = ROUTE_MAP[r.name] || null;
        const topStatus = normaliseTopStatus(r.status);

        // ── Process all routeStatus entries active today ──────────────────
        // We care about SAILING entries (actual service disruptions)
        // and ignore INFORMATION/SERVICE entries (general notices)
        const activeEntries = (r.routeStatuses || []).filter(s =>
          s.status === 'SAILING' && coversToday(s.startDateTime, s.endDateTime)
        );

        const sailingStatuses = {};

        for (const entry of activeEntries) {
          const subStatus = (entry.subStatus || '').toUpperCase();
          const detail = cleanDetail(entry.detail);
          const reason = entry.disruptionReason || null;

          // Determine status — ALL_SAILINGS_CANCELLED at subStatus level means whole route
          if (subStatus === 'ALL_SAILINGS_CANCELLED') {
            // All sailings cancelled — mark with wildcard
            sailingStatuses['*'] = { status: 'cancelled', detail, reason };
            continue;
          }

          // For DISRUPTIONS/BE_AWARE, check if detail text mentions specific times
          const mentionedTimes = extractMentionedTimes(entry.detail);
          // Does the text explicitly say "cancelled" or "no service"?
          const textSaysCancelled = detailImpliesCancelled(entry.detail);
          // Status for specific sailings — upgrade to cancelled if text says so
          const sailingStatus = textSaysCancelled ? 'cancelled' : normaliseSubStatus(subStatus);

          if (mentionedTimes.length > 0) {
            // Specific sailings mentioned — flag those individually
            for (const t of mentionedTimes) {
              // Don't downgrade an existing cancelled entry
              if (sailingStatuses[t]?.status === 'cancelled') continue;
              sailingStatuses[t] = { status: sailingStatus, detail, reason };
            }
          } else {
            // No specific times — affects all sailings in window
            // Don't downgrade existing wildcard cancelled entry
            if (sailingStatuses['*']?.status !== 'cancelled') {
              sailingStatuses['*'] = { status: sailingStatus, detail, reason };
            }
          }
        }

        return {
          name: r.name,
          routeKey,
          status: topStatus,
          sailingStatuses,
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