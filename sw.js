// ─────────────────────────────────────────────
//  FlashDeck Service Worker  •  sw.js
//  Strategy: Cache-first, network-revalidate
//  Bump CACHE_VERSION whenever you redeploy
// ─────────────────────────────────────────────

const CACHE_VERSION = 'flashdeck-v3';
const OFFLINE_URL   = './index.html';

// Everything we want cached on first install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  // Google Fonts — cached on first visit
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500;600&display=swap',
];

// ── INSTALL ─────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        // Cache what we can; don't fail install if CDN fonts are slow
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] Pre-cache miss:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting()) // Activate immediately, don't wait for old SW to die
  );
});

// ── ACTIVATE ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim()) // Take control of all open pages immediately
  );
});

// ── FETCH ────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and browser-extension requests
  if (request.method !== 'GET') return;
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // Navigation requests (HTML pages) → Cache-first, fallback to offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(OFFLINE_URL)
        .then(cached => {
          if (cached) {
            // Serve from cache AND revalidate in background
            revalidateInBackground(request, CACHE_VERSION);
            return cached;
          }
          return fetch(request).then(response => {
            cacheResponse(CACHE_VERSION, request, response.clone());
            return response;
          });
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Font requests → Cache-first (fonts almost never change)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          cacheResponse(CACHE_VERSION, request, response.clone());
          return response;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // All other requests → Stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(response => {
          if (response.ok) cacheResponse(CACHE_VERSION, request, response.clone());
          return response;
        })
        .catch(() => cached || new Response('Offline', { status: 503 }));

      return cached || networkFetch;
    })
  );
});

// ── HELPERS ─────────────────────────────────
function cacheResponse(cacheName, request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  caches.open(cacheName).then(cache => cache.put(request, response));
}

function revalidateInBackground(request, cacheName) {
  fetch(request)
    .then(response => {
      if (response.ok) cacheResponse(cacheName, request, response.clone());
    })
    .catch(() => {}); // silent — we already served from cache
}

// ── MESSAGE HANDLER ──────────────────────────
// Lets the main app force a cache clear / version check
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_VERSION).then(() => {
      event.ports[0]?.postMessage({ cleared: true });
    });
  }
});
