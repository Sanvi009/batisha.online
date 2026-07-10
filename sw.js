const CACHE_NAME = 'batisha-v1';
const urlsToCache = [
  '/',
  '/product/',
  '/cart/',
  '/assets/logo.png',
  '/api/config'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
