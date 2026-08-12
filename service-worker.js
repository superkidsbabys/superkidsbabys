const CACHE_NAME = 'superkids-catalogo-pwa-v5';
const APP_ASSETS = [
  './index.html',
  './pedidos.html',
  './pedido.html',
  './manifest.json',
  './pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => {
        const path = new URL(request.url).pathname;
        if (/\/pedidos?\.html$/i.test(path)) {
          return caches.match('./pedidos.html');
        }
        return caches.match('./index.html');
      })
    );
    return;
  }

  event.respondWith(
    fetch(request).then(response => {
      if (response.ok && new URL(request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request))
  );
});
