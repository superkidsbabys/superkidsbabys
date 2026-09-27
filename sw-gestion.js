const VERSION = 'superkids-gestion-offline-20260927-v1';
const CACHE_APP = VERSION + '-app';
const CACHE_LIBRERIAS = VERSION + '-librerias';
const ARCHIVOS_APP = [
  './',
  './pedidos.html',
  './manifest-admin.json',
  './pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const LIBRERIAS_FIREBASE = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'
];

self.addEventListener('install', function (evento) {
  evento.waitUntil((async function () {
    const app = await caches.open(CACHE_APP);
    await Promise.allSettled(ARCHIVOS_APP.map(function (url) { return app.add(url); }));
    const librerias = await caches.open(CACHE_LIBRERIAS);
    await Promise.allSettled(LIBRERIAS_FIREBASE.map(function (url) { return librerias.add(url); }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil((async function () {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(function (nombre) {
      return nombre.indexOf('superkids-gestion-offline-') === 0 && nombre !== CACHE_APP && nombre !== CACHE_LIBRERIAS;
    }).map(function (nombre) { return caches.delete(nombre); }));
    await self.clients.claim();
  })());
});

async function redPrimero(solicitud) {
  const cache = await caches.open(CACHE_APP);
  try {
    const respuesta = await fetch(solicitud);
    if (respuesta && respuesta.ok) cache.put(solicitud, respuesta.clone());
    return respuesta;
  } catch (error) {
    return (await cache.match(solicitud)) || (await cache.match('./pedidos.html'));
  }
}

async function cachePrimero(solicitud) {
  const cache = await caches.open(CACHE_LIBRERIAS);
  const guardada = await cache.match(solicitud);
  if (guardada) return guardada;
  const respuesta = await fetch(solicitud);
  if (respuesta && (respuesta.ok || respuesta.type === 'opaque')) cache.put(solicitud, respuesta.clone());
  return respuesta;
}

self.addEventListener('fetch', function (evento) {
  const solicitud = evento.request;
  if (solicitud.method !== 'GET') return;
  const url = new URL(solicitud.url);

  if (solicitud.mode === 'navigate') {
    evento.respondWith(redPrimero(solicitud));
    return;
  }
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') !== -1) {
    evento.respondWith(cachePrimero(solicitud));
    return;
  }
  if (url.origin === self.location.origin) {
    evento.respondWith(redPrimero(solicitud));
  }
});
