const CACHE_NAME = 'batisha-admin-v1';
const urlsToCache = [
  '/admin/',
  '/admin/dashboard/',
  '/admin/orders/',
  '/admin/assets/admin-icon-192.png',
  '/admin/manifest.json'
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

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/admin/dashboard/')
  );
});
