const CACHE_NAME = 'ai-drafting-v3';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './styles.css',
  './app.js'
];

// Static CDN assets that are safe to keep offline
const CACHEABLE_CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

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

self.addEventListener('fetch', event => {
  const { request } = event;
  // Only GET can be cached. Never touch API calls (Supabase, AI providers):
  // their responses carry private data and must always come from the network.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_CDN_HOSTS.includes(url.hostname)) return;

  // Network first, fall back to cache when offline
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
