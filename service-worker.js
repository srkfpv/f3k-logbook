const CACHE_NAME = 'f3k-v37-force-20260526';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (
    url.pathname.includes('/logs/') ||
    url.pathname.endsWith('.csv') ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/')
  ) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  event.respondWith(fetch(req, { cache: 'reload' }).catch(() => caches.match(req)));
});
