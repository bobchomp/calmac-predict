// sw.js — Will It Sail? Service Worker
// Caches the app shell for offline use, handles push notifications

const CACHE_NAME = 'willitsail-v2';
const SHELL_URLS = ['/', '/index.html', '/favicon.png', '/icon-120.png'];

// ── Install: cache the app shell ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

// ── Activate: delete old caches ───────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for shell ───────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: network only, no caching (weather data must be fresh)
  if (url.pathname.startsWith('/api/')) {
    return; // let it fall through to network
  }

  // App shell: cache first, fall back to network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        // Cache successful GET responses for shell assets
        if (e.request.method === 'GET' && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() => {
        // Offline fallback: return cached index.html for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── Push notification received ────────────────────────────────────────────
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}

  const title = data.title || '⚠️ Will It Sail?';
  const options = {
    body: data.body || 'Sailing conditions have changed.',
    icon: '/icon-120.png',
    badge: '/icon-120.png',
    tag: data.route || 'willitsail',   // collapses duplicate notifications per route
    renotify: true,
    data: data.data || {},
    actions: [
      { action: 'view', title: 'View route' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  if (e.action === 'dismiss') return;

  const targetUrl = e.notification.data?.url || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url.includes('calmac-predict') && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          return;
        }
      }
      // Otherwise open new tab
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── Background sync (for offline feedback reports) ────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'feedback-sync') {
    e.waitUntil(flushOfflineFeedback());
  }
});

async function flushOfflineFeedback() {
  try {
    const db = await openDB();
    const pending = await getAllPending(db);
    for (const item of pending) {
      try {
        const resp = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.data),
        });
        if (resp.ok) await deletePending(db, item.id);
      } catch (_) { /* will retry next sync */ }
    }
  } catch (_) {}
}

// Minimal IndexedDB wrapper for offline feedback queue
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('willitsail', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('pending', { autoIncrement: true, keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function getAllPending(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', 'readonly');
    const req = tx.objectStore('pending').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function deletePending(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', 'readwrite');
    const req = tx.objectStore('pending').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}