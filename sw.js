const VERSION = 'superkids-compartido-offline-20261010-sofia-v49';
// Mostrar los avisos de Sofía una sola vez y esperar su publicación.
self.addEventListener('push', event => {
  let payload;try{payload=event.data?.json();}catch{return;}
  const notice=payload?.notification;
  if(notice?.title!=='SuperKids · Sofía'||typeof notice.body!=='string')return;
  event.stopImmediatePropagation();
  event.waitUntil(self.registration.showNotification(notice.title,{
    body:notice.body.slice(0,500),
    tag:payload.webpush?.notification?.tag||'sofia-equipo',
    renotify:true,silent:false,vibrate:[200,100,200],
    icon:new URL('./icons/icon-192.png',self.location.href).href,
    data:{sofia:true,url:new URL('./pedidos.html',self.location.href).href}
  }));
});
self.addEventListener('notificationclick', event => {
  if(!event.notification.data?.sofia)return;
  event.stopImmediatePropagation();event.notification.close();
  const url=new URL('./pedidos.html',self.location.href).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(w=>w.url.split('?')[0].split('#')[0]===url);
    if(existing)return existing.focus();
    return self.clients.openWindow(url);
  })());
});
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
  firebase.initializeApp({apiKey:'AIzaSyBn5zp89TGHUj6OkA8jyKm_ROfEazCRgUc',projectId:'superkidsbabys-222b0',messagingSenderId:'564588158910',appId:'1:564588158910:web:d478f56a15aa1c3f3223ef'});
  firebase.messaging();
} catch(error) {console.warn('FCM no disponible; modo offline conservado');}
const CACHE_APP = VERSION + '-app';
const CACHE_RECURSOS = VERSION + '-recursos';
const ARCHIVOS_APP = ['./', './index.html', './pedidos.html', './manifest.json', './manifest-admin.json', './pwa.js', './sofia-gestion-v43.js?v=48', './icons/icon-192.png', './icons/icon-512.png'];
const LIBRERIAS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'
];

self.addEventListener('install', event => event.waitUntil((async () => {
  const app = await caches.open(CACHE_APP);
  // La nueva versión solo se activa cuando la portada quedó guardada. Esto
  // evita reemplazar una caché funcional por otra vacía durante un corte.
  await app.add(new Request('./index.html', { cache: 'reload' }));
  await Promise.allSettled(ARCHIVOS_APP.filter(url => url !== './index.html').map(url => app.add(url)));
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
  // Las fotos del catálogo viven en R2 y ya usan la caché del CDN/navegador.
  // No interceptarlas evita conservar respuestas externas fallidas.
  if (request.destination === 'image' && url.origin !== self.location.origin) return;
  if (request.destination === 'image') return event.respondWith(cachePrimero(request));
  if (url.origin === self.location.origin) return event.respondWith(cachePrimero(request));
});
