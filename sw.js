const VERSION = 'superkids-compartido-offline-20261003-v37';
const CACHE_APP = VERSION + '-app';
const CACHE_RECURSOS = VERSION + '-recursos';
const ARCHIVOS_APP = ['./', './index.html', './pedidos.html', './manifest.json', './manifest-admin.json', './pwa.js', './icons/icon-192.png', './icons/icon-512.png'];
const LIBRERIAS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'
];

self.addEventListener('install', event => event.waitUntil((async () => {
  const app = await caches.open(CACHE_APP);
  await Promise.allSettled(ARCHIVOS_APP.map(url => app.add(url)));
  const recursos = await caches.open(CACHE_RECURSOS);
  await Promise.allSettled(LIBRERIAS.map(url => recursos.add(url)));
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  const nombres = await caches.keys();
  await Promise.all(nombres.filter(n => (n.startsWith('superkids-compartido-offline-') || n.startsWith('superkids-gestion-offline-')) && n !== CACHE_APP && n !== CACHE_RECURSOS).map(n => caches.delete(n)));
  await self.clients.claim();
})()));

self.addEventListener('message', event => {
  const datos = event.data || {};
  if (datos.tipo !== 'GUARDAR_PANTALLA' || !datos.url) return;
  event.waitUntil((async () => {
    try {
      const respuesta = await fetch(datos.url, { cache: 'reload' });
      if (respuesta && respuesta.ok) {
        const cache = await caches.open(CACHE_APP);
        await cache.put(datos.url, respuesta.clone());
      }
    } catch (e) {}
  })());
});

async function navegacion(request) {
  const cache = await caches.open(CACHE_APP);
  try {
    const respuesta = await fetch(request);
    if (respuesta.ok) await cache.put(request, respuesta.clone());
    return respuesta;
  } catch (e) {
    return (await cache.match(request, { ignoreSearch:true })) ||
      (await cache.match(new URL(request.url).pathname.endsWith('pedidos.html') ? './pedidos.html' : './index.html')) ||
      (await cache.match('./')) ||
      new Response('<h2 style="font-family:sans-serif;text-align:center;margin-top:20vh">Sin conexión. Abre la aplicación una vez con internet para guardarla.</h2>', { headers:{'Content-Type':'text/html; charset=utf-8'} });
  }
}

async function cachePrimero(request) {
  const cache = await caches.open(CACHE_RECURSOS);
  const guardada = await cache.match(request);
  if (guardada) return guardada;
  const respuesta = await fetch(request);
  if (respuesta && (respuesta.ok || respuesta.type === 'opaque')) await cache.put(request, respuesta.clone());
  return respuesta;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') return event.respondWith(navegacion(request));
  if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) return event.respondWith(cachePrimero(request));
  if (request.destination === 'image') return event.respondWith(cachePrimero(request));
  if (url.origin === self.location.origin) return event.respondWith(cachePrimero(request));
});
