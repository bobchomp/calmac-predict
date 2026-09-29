// Helpers for CalMac disruption data from /api/status

export const NOTICE_ICONS = { WARNING: '⚠️', SAILING: '⛴️', SERVICE: '📋' };

// What a CalMac notice says about sailings: 'cancelled' when it announces
// cancelled or suspended sailings, 'risk' when it only warns they might be
// ("liable to disruption or cancellation"), else null (information).
// Judged sentence by sentence, so a warning about later sailings doesn't
// hide a cancellation in the same notice.
const RISK = /\b(liable to|risk of|may be|might be|could be|possible)\b[^.]*\b(cancel|disrupt|suspend)/i;
const CANCELLED = /\bcancell?ed\b|\bsuspended\b|\bno sailings\b|\bno services?\b[^.]*\b(will )?(operate|run)|\bwill not (operate|sail|run)\b/i;
export function noticeSeverity(notice) {
  const sentences = `${notice?.title || ''}. ${notice?.detail || ''}`.split(/(?<=[.!?])\s+|\n+/);
  let risk = false;
  for (const sentence of sentences) {
    if (RISK.test(sentence)) risk = true;
    else if (CANCELLED.test(sentence)) return 'cancelled';
  }
  return risk ? 'risk' : null;
}

// CalMac per-sailing statuses for today or tomorrow (see /api/status)
export function statusesForDay(disruption, tomorrow) {
  return (tomorrow ? disruption?.sailingStatusesTomorrow : disruption?.sailingStatuses) || {};
}

// A sailing's status: a notice naming this departure port first, then one
// giving only the time, then one covering all sailings.
export function sailingStatusFor(statuses, time, from) {
  const norm = p => (p || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
  const origin = norm(from);
  for (const [key, info] of Object.entries(statuses)) {
    const [t, port] = key.split('|');
    if (t === time && port && origin && (origin.startsWith(norm(port)) || norm(port).startsWith(origin))) return info;
  }
  return statuses[time] || statuses['*'] || null;
}

// CalMac's status (/api/status) by site route. Several CalMac routes can
// share one card: their notices and sailing statuses are combined. All
// routes are kept so BE_AWARE ones have statuses too.
export function disruptionsByRoute(data) {
  const disruptions = {};
  (data.routes || data.disrupted || []).forEach(d => {
    if (!d.routeKey) return;
    const prev = disruptions[d.routeKey];
    disruptions[d.routeKey] = {
      ...d,
      notices: [...(prev?.notices || []), ...(d.notices || [])],
      sailingStatuses: mergeStatuses(prev?.sailingStatuses, d.sailingStatuses),
      sailingStatusesTomorrow: mergeStatuses(prev?.sailingStatusesTomorrow, d.sailingStatusesTomorrow),
    };
  });
  return disruptions;
}

// Several CalMac routes can share one card: combine their sailing statuses,
// with a cancellation winning over a lesser status
export function mergeStatuses(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (out[k]?.status !== 'cancelled') out[k] = v;
  return out;
}

// The day a notice applies from, as a UK date string (YYYY-MM-DD); today for
// one already in effect. CalMac's startDateTime is often when the notice
// was published, so the title's first date wins ("Tuesday 29 - Wednesday
// 30 September" → 29 September), unless it's an "Until …" date.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const TITLE_DATE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\b(?:(?!\\buntil\\b)[^])*?\\b(${MONTHS.join('|')})\\b`, 'i');
const ukDay = date => date.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
export function noticeAppliesFrom(notice, now = new Date()) {
  const today = ukDay(now);
  const title = notice?.title || '';
  const m = title.match(TITLE_DATE);
  let from = null;
  if (m && !/\buntil\b/i.test(title.slice(0, m.index))) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    let year = Number(today.slice(0, 4));
    // A date long gone is next year's ("Monday 18 January" in October)
    if (new Date(Date.UTC(year, month, Number(m[1]))) < new Date(now.getTime() - 60 * 86400000)) year++;
    from = `${year}-${String(month + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  } else if (!m && notice?.startDateTime) {
    from = ukDay(new Date(notice.startDateTime));
  }
  return from && from > today ? from : today;
}

// A card's notices: up to 3, de-duplicated by title and ranked: ones
// announcing cancellations first, then warnings of them, then the rest
// (so a cancellation is never cut off). Within each, those in effect now
// come first, then upcoming ones by date, then CalMac's priority order.
const SEVERITY_RANK = { cancelled: 0, risk: 1 };
export function topNotices(disruption) {
  if (!disruption) return [];
  const list = disruption.notices || (disruption.timetableNotice ? [disruption.timetableNotice] : []);
  const seen = new Set();
  const rank = n => SEVERITY_RANK[noticeSeverity(n)] ?? 2;
  const now = new Date();
  return list
    .filter(n => { const k = (n.title || '').trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(n => ({ n, rank: rank(n), from: noticeAppliesFrom(n, now) }))
    .sort((a, b) => a.rank - b.rank || a.from.localeCompare(b.from) || (a.n.priority ?? 9) - (b.n.priority ?? 9))
    .map(x => x.n)
    .slice(0, 3);
}
