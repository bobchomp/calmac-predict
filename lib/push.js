// Push alerts for a route's sailing chance (via /api/notify) and the
// service worker that receives them.

import { setAppState } from './appState';
import { warmOfflineCache } from './data';
import { openModal } from './modal';
import { getNotifThreshold, isRouteNotified, setRouteNotified } from './prefs';

let vapidPublicKey = null;
let pushSupported = false;

// Whether the browser can do push and the server has it set up
export async function initPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const res = await fetch('/api/notify');
    const data = await res.json();
    if (!data.available) return;
    vapidPublicKey = data.publicKey;
    pushSupported = true;
    setAppState({ pushSupported });
  } catch (_) {}
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array([...atob(base64)].map(c => c.charCodeAt(0)));
}

// Turn a route's alerts off, or on at its saved threshold (the card's Alert button)
export async function toggleRouteNotification(routeName) {
  if (!pushSupported) {
    alert('Push notifications are not supported in this browser.');
    return;
  }
  if (Notification.permission === 'denied') {
    alert('Notifications are blocked. Please enable them in your browser settings.');
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (isRouteNotified(routeName)) {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unsubscribe', route: routeName, endpoint: sub?.endpoint }),
      });
      setRouteNotified(routeName, false);
    } else {
      if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') return;
      // Create or reuse this browser's push subscription
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
      }
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', route: routeName, subscription: sub.toJSON(), threshold: getNotifThreshold(routeName) }),
      });
      setRouteNotified(routeName, true);
    }
  } catch (err) {
    console.warn('Push toggle error:', err);
  }
}

// Once the threshold picker (components/Pickers.js) is confirmed. Push
// support may still be being checked, so wait up to 3s for it first.
export async function enableRouteAlerts(routeName) {
  for (let waited = 0; !pushSupported && waited < 3000; waited += 200) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (!pushSupported && !('PushManager' in window)) {
    alert('Push notifications require HTTPS and a modern browser.');
    return;
  }
  if (!pushSupported) await initPush();
  toggleRouteNotification(routeName);
}

// Register the service worker (it also keeps the site working offline). When
// an alert is tapped with the site already open, it asks this tab to open
// the route.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // First install: this visit's data loaded before the worker took over
  if (!navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', warmOfflineCache, { once: true });
  }
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type !== 'NAVIGATE' || !e.data.url) return;
    // Alert links are /?route=…; older ones used #route=…
    const target = new URL(e.data.url, location.href);
    const route = target.searchParams.get('route')
      || (target.hash.startsWith('#route=') ? decodeURIComponent(target.hash.replace('#route=', '')) : null);
    if (route) openModal(route, target.searchParams.get('sailing'));
  });
}
