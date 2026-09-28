// The page's data that React renders from: routes with weather, CalMac
// disruptions, live timetables and thresholds (loaded by lib/data.js), the
// filters, and the status bar. Components subscribe.

const INITIAL = {
  phase: 'idle', // 'idle' before the first load, then 'loading' or 'ready'
  routes: [],
  disruptions: {},
  timetable: {},
  thresholds: {},
  showingTomorrow: false,
  filter: 'all',
  search: '',
  lastFetched: null,
  lastDisruptionFetch: null,
  pushSupported: false,
  status: { type: 'loading', text: 'Loading weather forecasts…' }, // the status bar
  refreshing: false,
  summary: null, // { total, likely, caution, unlikely } after a successful load
};

let state = INITIAL;
const listeners = new Set();

export const getAppState = () => state;
export const getServerAppState = () => INITIAL;

export function subscribeAppState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAppState(patch) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}
