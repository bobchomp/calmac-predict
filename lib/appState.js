// The legacy script's data that React renders from (routes with weather,
// CalMac disruptions, live timetable, filters). The legacy script publishes
// a new snapshot whenever it changes; components subscribe.

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
