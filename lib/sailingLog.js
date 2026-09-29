// The per-sailing log: for every CalMac sailing, the chance the site showed
// for it before it left, whether it sailed, and whether the prediction was
// right. Written by pages/api/track-sailings.js, read by pages/api/sailings.js.
//
// Stored in Redis as one key per UK date, `sailings:YYYY-MM-DD`, holding
// { [route|time|from]: record }:
//   { route, date, time, from, to,
//     first: { chance, at },          earliest prediction (can be the day before)
//     last:  { chance, at },          latest prediction before departure
//     seen:  { status, reason, at },  CalMac's status at the latest look before departure
//     outcome: { sailed, status, reason, at } | undefined until resolved
//                                     (sailed null: couldn't tell, left out of the figures)
//     correct: true | false | null }  the last prediction against the outcome

import { sailingStatusFor, statusesForDay } from './disruptions';
import { verdictFromChance } from './risk';

export const LOG_KEY = date => `sailings:${date}`;

// A prediction of 50% or more is a call that it sails
export const SAILS_FROM = 50;
export const predictsSailing = chance => chance >= SAILS_FROM;

// When a sailing leaves, from its UK date and 'HH:MM'
const ukClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function departureMs(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  const [uh, um] = ukClock.format(new Date(asUtc)).split(':').map(Number);
  let offset = (uh * 60 + um) - (hh * 60 + mm);
  if (offset < -720) offset += 1440;
  if (offset > 720) offset -= 1440;
  return asUtc - offset * 60000;
}

// CalMac's status for one of today's sailings, from its route's combined
// disruption (lib/disruptions.js disruptionsByRoute). A route cancelled with
// no per-sailing detail cancels every sailing.
export function sailingOutcome(disruption, time, from) {
  const statuses = statusesForDay(disruption, false);
  const info = sailingStatusFor(statuses, time, from);
  const cancelled = info?.status === 'cancelled' || (disruption?.status === 'cancelled' && !Object.keys(statuses).length);
  return {
    status: cancelled ? 'cancelled' : info?.status || 'normal',
    reason: info?.reason || null,
  };
}

// The figures for a set of records
export function summarise(records) {
  const resolved = records.filter(r => r.outcome && r.outcome.sailed !== null && r.last);
  const cancelled = resolved.filter(r => !r.outcome.sailed);
  const correct = resolved.filter(r => r.correct).length;
  const firstCorrect = resolved.filter(r => r.first && predictsSailing(r.first.chance) === r.outcome.sailed).length;
  const bands = ['likely', 'caution', 'unlikely'].map(verdict => {
    const inBand = resolved.filter(r => verdictFromChance(r.last.chance) === verdict);
    return { verdict, count: inBand.length, sailedPct: inBand.length ? Math.round(inBand.filter(r => r.outcome.sailed).length / inBand.length * 100) : null };
  });
  return {
    sailings: records.length,
    resolved: resolved.length,
    pending: records.filter(r => !r.outcome).length,
    correct,
    accuracy: resolved.length ? Math.round(correct / resolved.length * 100) : null,
    // The earliest prediction instead (for tomorrow's sailings, the day before)
    firstAccuracy: resolved.length ? Math.round(firstCorrect / resolved.length * 100) : null,
    cancelled: cancelled.length,
    cancelledPredicted: cancelled.filter(r => !predictsSailing(r.last.chance)).length,
    falseAlarms: resolved.filter(r => r.outcome.sailed && !predictsSailing(r.last.chance)).length,
    bands,
  };
}
