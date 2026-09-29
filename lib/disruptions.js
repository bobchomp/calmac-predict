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

// Several CalMac routes can share one card: combine their sailing statuses,
// with a cancellation winning over a lesser status
export function mergeStatuses(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (out[k]?.status !== 'cancelled') out[k] = v;
  return out;
}

// A card's notices: up to 3, de-duplicated by title and ranked: ones
// announcing cancellations first, then warnings of them, then the rest,
// each in CalMac's priority order (so a cancellation is never cut off)
const SEVERITY_RANK = { cancelled: 0, risk: 1 };
export function topNotices(disruption) {
  if (!disruption) return [];
  const list = disruption.notices || (disruption.timetableNotice ? [disruption.timetableNotice] : []);
  const seen = new Set();
  const rank = n => SEVERITY_RANK[noticeSeverity(n)] ?? 2;
  return list
    .filter(n => { const k = (n.title || '').trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => rank(a) - rank(b) || (a.priority ?? 9) - (b.priority ?? 9))
    .slice(0, 3);
}
