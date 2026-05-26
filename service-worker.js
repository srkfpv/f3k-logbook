const CACHE='f3k-logbook-v14-pinkv36';
const ASSETS=['./','./index.html','./style.css','./app.js','./manifest.json','./icon.svg','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./favicon-32.png','./logs/index.csv'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
// v36 network-first logs/csv
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.includes('/logs/') || url.pathname.endsWith('.csv')) {
    event.respondWith(fetch(event.request, {cache:'no-store'}).catch(() => caches.match(event.request)));
  }
});
self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});
