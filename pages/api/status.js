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

// Sailings mentioned in detail text, as { time: 'HH:MM', from: port | null }.
// The port comes from "Depart <Port> – 13:00 & 18:10", "11:15 sailing
// departing <Port>" or "departed <Port> at 12:02"; arrival times are skipped.
// Port patterns are case-sensitive so "Gourock and" isn't read as a port.
const PORT = "([A-Z][\\w'’()]*(?:\\s+[A-Z(][\\w'’()]*)*)";
const DEPART_LIST_BEFORE = new RegExp(`\\b[Dd]epart(?:s|ing|ure)?\\s+(?:from\\s+)?${PORT}\\s*[-–:]?\\s*(?:\\d{1,2}:\\d{2}\\s*(?:,|&|and)?\\s*)*$`);
const DEPARTED_BEFORE    = new RegExp(`\\b[Dd]eparted\\s+${PORT}\\s+at\\s*$`);
const DEPARTING_AFTER    = new RegExp(`^\\s*(?:sailing\\s+)?(?:departing|from)\\s+${PORT}`);
const ARRIVAL_BEFORE     = /\b(?:arrive|arrives|arriving|arrival|eta)\b[^.\d]{0,30}$/i;

// Date headings like "Friday 16 October", so times listed under a heading in a
// multi-day notice apply only to that day
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DATE_HEADING = /\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/g;

function headingDate(day, monthName, today) {
  const month = MONTHS.indexOf(monthName.toLowerCase()) + 1;
  const [y, m] = today.split('-').map(Number);
  // Notices look at most a few months ahead, so a much earlier month is next year
  const year = month < m - 6 ? y + 1 : month > m + 6 ? y - 1 : y;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractMentionedSailings(detail, today) {
  if (!detail) return [];
  const text = detail.replace(/\*\*/g, '').replace(/\r/g, '');
  const headings = [...text.matchAll(DATE_HEADING)].map(h => ({ index: h.index, date: headingDate(Number(h[1]), h[2], today) }));
  const found = new Map();
  for (const m of text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    const before = text.slice(Math.max(0, m.index - 120), m.index);
    if (ARRIVAL_BEFORE.test(before)) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const port = (before.match(DEPART_LIST_BEFORE) || before.match(DEPARTED_BEFORE) || after.match(DEPARTING_AFTER))?.[1] || null;
    const date = headings.filter(h => h.index < m.index).pop()?.date || null;
    const time = `${m[1].padStart(2, '0')}:${m[2]}`;
    const cue = cancellationCue(text, m.index, m.index + m[0].length);
    found.set(`${time}|${port}|${date}`, { time, from: port, date, cue });
  }
  return [...found.values()];
}

// "Liable to disruption or cancellation" means at risk, not cancelled. These
// phrases are blanked out (same length, so indexes still line up) before
// looking for definite cancellation wording.
const AT_RISK = /\b(?:liable|subject)\s+to\b[^.:]*?\bcancellation\b|\brisk\s+of\b[^.:]*?\bcancellation\b|\bpossible\s+cancellation\b|\b(?:may|might|could)\s+be\s+cancelled\b/gi;
const CANCELLED = /\b(?:is|are|be|been|was|were)\s+cancelled\b|\bcancellations?\s*:|\bno\s+(?:service|sailings)\b|\bnot\s+operat/gi;
const blankAtRisk = text => text.replace(AT_RISK, m => ' '.repeat(m.length));

// Does the detail text definitely say sailings are cancelled?
function detailImpliesCancelled(detail) {
  if (!detail) return false;
  return new RegExp(CANCELLED.source, 'i').test(blankAtRisk(detail));
}

// The cancellation wording that applies to a time mentioned in a notice:
// 'cancelled', 'at-risk' or null, looking only within the time's own
// sentence. The nearest earlier cue wins ("the following sailings are
// cancelled: Depart Kennacraig – 13:00"), otherwise a later one ("the 07:00
// sailing departing Port Askaig is cancelled").
// CalMac puts each paragraph and each list item ("Depart Kennacraig – 13:00")
// on its own line, with the list's header line ending in a colon ("the
// following sailings are cancelled:").
const SENTENCE_BREAK = /[.!?]\s/g;
const LIST_ITEM = /^\s*(?:Depart|Arrive)\b/;

function cancellationCue(text, index, end) {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  let before = text.slice(lineStart, index);
  if (LIST_ITEM.test(before)) {
    // Walk up past the other items to the list's header, if it has one
    const earlier = text.slice(0, lineStart).split('\n').map(l => l.trim()).filter(Boolean);
    while (earlier.length && LIST_ITEM.test(earlier.at(-1))) earlier.pop();
    if (earlier.at(-1)?.endsWith(':')) before = earlier.at(-1) + ' ' + before;
  }
  const breaks = [...before.matchAll(SENTENCE_BREAK)];
  if (breaks.length) { const b = breaks.at(-1); before = before.slice(b.index + b[0].length); }
  let after = text.slice(end, lineEnd < 0 ? undefined : lineEnd);
  const stop = after.search(SENTENCE_BREAK);
  if (stop >= 0) after = after.slice(0, stop);

  const last = (re, s) => { let pos = -1; for (const m of s.matchAll(re)) pos = m.index; return pos; };
  const risk = last(AT_RISK, before);
  const cancel = last(CANCELLED, blankAtRisk(before));
  if (risk >= 0 || cancel >= 0) return cancel > risk ? 'cancelled' : 'at-risk';

  if (new RegExp(CANCELLED.source, 'i').test(blankAtRisk(after))) return 'cancelled';
  if (new RegExp(AT_RISK.source, 'i').test(after)) return 'at-risk';
  return null;
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

const ukDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' });
const ukHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' });

// UTC instant of midnight UK time at the start of a YYYY-MM-DD date
function ukMidnight(date) {
  const utcMidnight = new Date(`${date}T00:00:00Z`);
  return new Date(utcMidnight - Number(ukHour.format(utcMidnight)) * 3600e3);
}

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// CalMac's startDateTime is usually when a notice was published, not when the
// disruption starts: a "Tuesday 29 September" notice runs from Monday
// afternoon to Tuesday midnight. So a notice of 48 hours or less applies only
// to the UK day it ends on; longer ones apply across their whole window.
function effectiveWindow(s) {
  const start = new Date(s.startDateTime), end = new Date(s.endDateTime);
  if (end - start > 48 * 3600e3) return { start, end };
  const endDay = ukDate.format(new Date(end - 60e3));
  return { start: new Date(Math.max(start, ukMidnight(endDay))), end };
}

function appliesDuring(s, from, to) {
  if (!s.startDateTime || !s.endDateTime) return false;
  const w = effectiveWindow(s);
  return w.start < to && w.end > from;
}

// Per-sailing statuses for one UK day (YYYY-MM-DD) from SAILING notices. Keys
// are 'HH:MM|Port' when the notice names the departure port, 'HH:MM' when it
// doesn't, '*' for all.
function buildSailingStatuses(entries, day) {
  const sailingStatuses = {};
  for (const entry of entries) {
    const subStatus = (entry.subStatus || '').toUpperCase();
    const detail = cleanDetail(entry.detail);
    const reason = entry.disruptionReason || null;

    if (subStatus === 'ALL_SAILINGS_CANCELLED') {
      sailingStatuses['*'] = { status: 'cancelled', detail, reason };
      continue;
    }

    const mentioned = extractMentionedSailings(entry.detail, day);
    // Upgrade to cancelled if the text definitely says so
    const sailingStatus = detailImpliesCancelled(entry.detail) ? 'cancelled' : normaliseSubStatus(subStatus);

    if (mentioned.length > 0) {
      for (const { time, from, date, cue } of mentioned) {
        if (date && date !== day) continue; // listed under another day's heading
        const key = from ? `${time}|${from}` : time;
        if (sailingStatuses[key]?.status === 'cancelled') continue; // never downgrade
        // A time only counts as cancelled when its own sentence says so
        const status = cue === 'cancelled' ? 'cancelled' : normaliseSubStatus(subStatus);
        sailingStatuses[key] = { status, detail, reason };
      }
    } else if (sailingStatuses['*']?.status !== 'cancelled') {
      // No specific times — affects all sailings in the window
      sailingStatuses['*'] = { status: sailingStatus, detail, reason };
    }
  }
  return sailingStatuses;
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

    const now = new Date();
    const today = ukDate.format(now);
    const startTomorrow = ukMidnight(addDays(today, 1));
    const endTomorrow = ukMidnight(addDays(today, 2));

    const routes = rawRoutes
      .filter(r => !r.name?.toLowerCase().includes('freight'))
      .map(r => {
        const routeKey = ROUTE_MAP[r.name] || null;
        const topStatus = normaliseTopStatus(r.status);

        // Only SAILING entries are service disruptions; INFORMATION/SERVICE
        // entries are general notices
        const sailingEntries = (r.routeStatuses || []).filter(s => s.status === 'SAILING');

        return {
          name: r.name,
          routeKey,
          status: topStatus,
          sailingStatuses: buildSailingStatuses(sailingEntries.filter(s => appliesDuring(s, now, startTomorrow)), today),
          sailingStatusesTomorrow: buildSailingStatuses(sailingEntries.filter(s => appliesDuring(s, startTomorrow, endTomorrow)), addDays(today, 1)),
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
