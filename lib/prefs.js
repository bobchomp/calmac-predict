// Per-browser preferences kept in localStorage: favourite routes, routes with
// alerts turned on, and each route's alert threshold. React components
// subscribe to changes; the legacy script uses the same functions.

const KEYS = { favourites: 'wis_favs', notified: 'notifRoutes', thresholds: 'notifThresholds' };
const DEFAULT_THRESHOLD = 70;
const EMPTY = { favourites: [], notified: [], thresholds: {} };

let prefs = null;
const listeners = new Set();

export function getPrefs() {
  if (!prefs) {
    prefs = {
      favourites: JSON.parse(localStorage.getItem(KEYS.favourites) || '[]'),
      notified: JSON.parse(localStorage.getItem(KEYS.notified) || '[]'),
      thresholds: JSON.parse(localStorage.getItem(KEYS.thresholds) || '{}'),
    };
  }
  return prefs;
}

export const getServerPrefs = () => EMPTY;

export function subscribePrefs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(key, value) {
  prefs = { ...getPrefs(), [key]: value };
  localStorage.setItem(KEYS[key], JSON.stringify(value));
  listeners.forEach(listener => listener());
}

export const isFavourite = name => getPrefs().favourites.includes(name);

export function toggleFavourite(name) {
  const { favourites } = getPrefs();
  update('favourites', favourites.includes(name) ? favourites.filter(f => f !== name) : [...favourites, name]);
}

export const isRouteNotified = name => getPrefs().notified.includes(name);

export function setRouteNotified(name, on) {
  const others = getPrefs().notified.filter(r => r !== name);
  update('notified', on ? [...others, name] : others);
}

export const getNotifThreshold = name => getPrefs().thresholds[name] || DEFAULT_THRESHOLD;

export function setNotifThreshold(name, value) {
  update('thresholds', { ...getPrefs().thresholds, [name]: value });
}
