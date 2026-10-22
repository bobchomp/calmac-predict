// The page's data that React renders from: routes with weather, CalMac
// disruptions, Met Office warnings, live timetables and thresholds (loaded by lib/data.js), the
// filters, and the status bar. Components subscribe.

const INITIAL = {
  phase: 'idle', // 'idle' before the first load, then 'loading' or 'ready'
  routes: [],
  disruptions: {},
  metWarnings: [],      // Met Office weather warnings (/api/warnings)
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
