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

const ROUTE_MAP = require('../../lib/route-map');

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

// Clean CalMac markdown detail text to readable plain text, keeping bare URLs
// as plain text so the modal can linkify them client-side.
function cleanDetail(detail) {
  if (!detail) return '';
  let t = detail;
  // Collect reference-style URL definitions before stripping them: [n]: url
  const refs = {};
  t = t.replace(/\[(\d+)\]:\s*(\S+)/g, (_, n, url) => { refs[n] = url; return ''; });
  // [text](url) → "text url"  — keep URL as bare text for client-side linkification
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2');
  // [text][n] → "text url"  — resolve reference
  t = t.replace(/\[([^\]]+)\]\[(\d+)\]/g, (_, text, n) => refs[n] ? text + ' ' + refs[n] : text);
  // stray [n] markers
  t = t.replace(/\[\d+\]/g, '');
  t = t.replace(/\*\*/g, '').replace(/\*/g, ''); // bold / italic
  t = t.replace(/[ \t]{2,}/g, ' ').trim();
  return t.substring(0, 2000);
}

// Scan all routeStatus entries for amended timetable / vessel substitution notices.
// CalMac publishes these as separate entries (often status: INFORMATION or SERVICE)
// alongside the normal SAILING disruption entries. api/cron.js pushes each new one.
function extractTimetableNotice(routeStatuses) {
  const KEYWORDS = /amended\s*timetable|vessel\s*sub|temporary\s*timetable|winter\s*timetable|summer\s*timetable|additional\s*sail|timetable\s*change|replacement\s*vessel/i;
  const now = new Date();

  for (const s of (routeStatuses || [])) {
    const title  = s.title     || '';
    const detail = s.detail    || '';
    const sub    = s.subStatus || '';

    if (SEASONAL_TIMETABLE.test(title)) continue;
    if (!KEYWORDS.test(title) && !KEYWORDS.test(detail) && !KEYWORDS.test(sub)) continue;

    // Skip expired notices
    if (s.endDateTime && new Date(s.endDateTime) < now) continue;

    return {
      title:         title || 'Timetable notice',
      detail:        cleanDetail(detail),
      startDateTime: s.startDateTime || null,
      endDateTime:   s.endDateTime   || null,
    };
  }
  return null;
}

// Notices shown on a route card, most important first (max 3). INFORMATION
// entries are skipped: they're boilerplate CalMac attaches to every route.
// SERVICE entries are mostly roadworks/facilities, so only timetable ones count.
// Seasonal timetable announcements are skipped: /api/timetable already loads
// those sailings from CalMac's schedule.
const MAX_NOTICES = 3;
const TIMETABLE_KEYWORDS = /timetable|vessel\s*sub|additional\s*sail|replacement\s*vessel|tidal\s*amend/i;
const SEASONAL_TIMETABLE = /\b(winter|summer)\b.*\btimetables?\b|\btimetables?\b.*\b(winter|summer)\b/i;

function extractNotices(routeStatuses) {
  const now = new Date();
  const rank = s => {
    if (SEASONAL_TIMETABLE.test(s.title || '')) return null;
    const active = !s.startDateTime || new Date(s.startDateTime) <= now;
    if (s.status === 'WARNING') return 0;
    if (s.status === 'SAILING') return active ? 1 : 3;
    if (s.status === 'SERVICE' && TIMETABLE_KEYWORDS.test(s.title || '')) return 2;
    return null;
  };

  const seen = new Set();
  return (routeStatuses || [])
    .filter(s => !(s.endDateTime && new Date(s.endDateTime) < now))
    .map(s => ({ s, rank: rank(s) }))
    .filter(x => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || new Date(a.s.startDateTime || 0) - new Date(b.s.startDateTime || 0))
    .filter(({ s }) => {
      const key = (s.title || '').trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_NOTICES)
    .map(({ s, rank }) => ({
      title:         s.title || 'Service notice',
      type:          s.status,
      priority:      rank,
      detail:        cleanDetail(s.detail || ''),
      startDateTime: s.startDateTime || null,
      endDateTime:   s.endDateTime   || null,
    }));
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
          timetableNotice: extractTimetableNotice(r.routeStatuses),
          notices: extractNotices(r.routeStatuses),
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
