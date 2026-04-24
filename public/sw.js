/**
 * MetabolicSuite Service Worker
 *
 * Provides offline support and caching for the web application.
 */

const CACHE_NAME = 'metabolicsuite-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API calls and external resources
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve JS/TS modules from cache — always fetch fresh to avoid MIME poisoning
  const pathname = new URL(event.request.url).pathname;
  const isModule = /\.(js|jsx|ts|tsx|mjs)(\?.*)?$/.test(pathname) || pathname.startsWith('/@');
  if (isModule) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached response if available
      if (cachedResponse) {
        // Fetch and update cache in background
        event.waitUntil(
          fetch(event.request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, response.clone());
              });
            }
          }).catch(() => {})
        );
        return cachedResponse;
      }

      // Fetch from network and cache
      return fetch(event.request).then((response) => {
        if (!response.ok) return response;

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(() => {
        // Return offline page for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Handle file sharing (Web Share Target API)
self.addEventListener('fetch', (event) => {
  if (event.request.url.endsWith('/share') && event.request.method === 'POST') {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const file = formData.get('model');

        if (file) {
          // Store file in IndexedDB for the app to pick up
          const clients = await self.clients.matchAll({ type: 'window' });
          if (clients.length > 0) {
            clients[0].postMessage({
              type: 'SHARED_FILE',
              file: file
            });
          }
        }

        // Redirect to main app
        return Response.redirect('/', 303);
      })()
    );
  }
});
