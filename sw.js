// sw.js — Will It Sail? Service Worker
// Strategy: network-first for HTML (always fresh), cache-first for static assets
// Cache name includes build timestamp — update this on every deploy to bust old caches

const CACHE_VERSION = 'willitsail-v__BUILD__';
const STATIC_CACHE  = CACHE_VERSION + '-static';

const STATIC_ASSETS = ['/favicon.png', '/icon-120.png'];

// ── Install ───────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting(); // activate immediately, don't wait for old SW to die
});

// ── Activate: wipe ALL old caches ────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => !k.startsWith(CACHE_VERSION))
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. API calls → always network, never cache
  if (url.pathname.startsWith('/api/')) return;

  // 2. HTML navigation (index.html, /) → network-first
  //    Always try to get the freshest version; only fall back to cache if offline
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          // Cache the fresh response for offline fallback
          if (resp.status === 200) {
            const clone = resp.clone();
            caches.open(STATIC_CACHE).then(c => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 3. Static assets (icons etc.) → cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (e.request.method === 'GET' && resp.status === 200) {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
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
    tag: data.route || 'willitsail',
    renotify: true,
    data: data.data || {},
    actions: [
      { action: 'view',    title: 'View route' },
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
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('calmac-predict') && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});