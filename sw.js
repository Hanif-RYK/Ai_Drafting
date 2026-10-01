const CACHE_NAME = 'ai-drafting-v6';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './tailwind.css',
  './styles.css',
  './app.js'
];

// Static CDN assets that are safe to keep offline (Supabase client library)
const CACHEABLE_CDN_HOSTS = ['cdn.jsdelivr.net'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// A navigation Request can't be re-created with new options, so fetch its URL instead
function fetchFresh(request) {
  return fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
}

self.addEventListener('fetch', event => {
  const { request } = event;
  // Only GET can be cached. Never touch API calls (Supabase, AI providers):
  // their responses carry private data and must always come from the network.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_CDN_HOSTS.includes(url.hostname)) return;

  // Network first, fall back to cache when offline.
  // Own files are revalidated with the server every time (cheap 304s), so a deploy
  // never mixes a new index.html with an old app.js from the browser's HTTP cache.
  event.respondWith(
    (sameOrigin ? fetchFresh(request) : fetch(request))
      .then(response => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
