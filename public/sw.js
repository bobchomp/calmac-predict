// sw.js — Will It Sail? Service Worker
// Makes the site work offline: the page and its assets are cached, and the
// last good copy of each data request (weather, CalMac status, timetables,
// the Sheet's thresholds) is kept and served when the network is down or
// too slow. Saved copies carry an x-saved-at header (ms since epoch) so the
// page can say how old they are.

// Bump to clear every cache on the next visit
const CACHE_VERSION = 'willitsail-v2';
const STATIC_CACHE  = CACHE_VERSION + '-static';
const DATA_CACHE    = CACHE_VERSION + '-data';

const STATIC_ASSETS = ['/', '/favicon.png', '/icon-120.png'];
// How long a data request gets before a saved copy is used instead
const DATA_TIMEOUT_MS = 8000;

// ── Install: the page, icons, and the scripts and styles the page uses ──
// (the first visit loads them before this worker is in control)
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(STATIC_ASSETS);
    try {
      const html = await (await cache.match('/')).text();
      const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map(m => m[1]))];
      await cache.addAll(assets);
    } catch (_) {}
  })());
  self.skipWaiting();
});

// ── Activate: wipe caches from older versions ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Requests whose last good response is kept for offline use
function isData(url) {
  if (url.origin === self.location.origin) return url.pathname === '/api/status' || url.pathname === '/api/timetable';
  return url.hostname === 'api.open-meteo.com' || url.hostname === 'marine-api.open-meteo.com'
    || (url.hostname === 'script.google.com' && url.searchParams.get('action') === 'getThresholds');
}
const isFont = url => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

// Network first. The saved copy (if any) is used instead when the network
// fails, answers with an error, or takes longer than DATA_TIMEOUT_MS; a slow
// response still updates the saved copy when it arrives.
async function dataFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  const network = fetch(request).then(async resp => {
    if (resp.ok) {
      const headers = new Headers(resp.headers);
      headers.set('x-saved-at', String(Date.now()));
      // Readable by the page for cross-origin (CORS) responses too
      headers.set('access-control-expose-headers', [headers.get('access-control-expose-headers'), 'x-saved-at'].filter(Boolean).join(', '));
      await cache.put(request, new Response(await resp.clone().blob(), { status: resp.status, statusText: resp.statusText, headers }));
    }
    return resp;
  });
  network.catch(() => {}); // a late failure after the saved copy was used
  const saved = () => cache.match(request, { ignoreVary: true });
  let timer;
  const slow = new Promise(resolve => { timer = setTimeout(resolve, DATA_TIMEOUT_MS); });
  try {
    const first = await Promise.race([network, slow.then(saved)]);
    if (!first) return await network; // slow, and nothing saved: keep waiting
    if (first.ok) return first;
    return (await saved()) || first;
  } catch (err) {
    const copy = await saved();
    if (copy) return copy;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Cached copy first, fetched (and saved) otherwise
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (request.method === 'GET' && (resp.ok || resp.type === 'opaque')) {
    const clone = resp.clone();
    caches.open(cacheName).then(c => c.put(request, clone));
  }
  return resp;
}

// ── Fetch ──
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (isData(url)) { e.respondWith(dataFirst(e.request)); return; }
  if (isFont(url)) { e.respondWith(cacheFirst(e.request, STATIC_CACHE)); return; }
  // Other cross-origin requests and API calls: straight to the network
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // The page: network first so it's always fresh; offline, the saved page
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(STATIC_CACHE).then(c => c.put('/', clone));
          }
          return resp;
        })
        .catch(async () => (await caches.match('/')) || Response.error())
    );
    return;
  }

  // Scripts, styles and icons (content-hashed): cache first
  e.respondWith(cacheFirst(e.request, STATIC_CACHE));
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
  // Links may be relative (this site) or absolute (e.g. CalMac timetables)
  const target = new URL(e.notification.data?.url || '/', self.location.origin);
  const ours = target.origin === self.location.origin;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Reuse an open tab of this site for its own links
      const client = ours && list.find(c => new URL(c.url).origin === self.location.origin && 'focus' in c);
      if (client) {
        client.postMessage({ type: 'NAVIGATE', url: target.href });
        return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target.href);
    })
  );
});