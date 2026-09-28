// Helpers for CalMac disruption data from /api/status

export const NOTICE_ICONS = { WARNING: '⚠️', SAILING: '⛴️', SERVICE: '📋' };

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

// A card's notices: up to 3, de-duplicated by title and ranked
export function topNotices(disruption) {
  if (!disruption) return [];
  const list = disruption.notices || (disruption.timetableNotice ? [disruption.timetableNotice] : []);
  const seen = new Set();
  return list
    .filter(n => { const k = (n.title || '').trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))
    .slice(0, 3);
}
