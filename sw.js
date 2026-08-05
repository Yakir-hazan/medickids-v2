/* ⚠️ CLAUDE: bump this on EVERY push to this repo — keep in sync with APP_VERSION in js/app.js
   (increment the -vNN suffix here whenever APP_VERSION changes there, e.g. 'v17' here when
   APP_VERSION becomes '1.0.0-beta.2'). Without this bump, users' devices keep serving old
   cached files and "בדוק אם יש עדכון" in Settings will report "already up to date" even when it isn't. */
const CACHE_NAME = 'madhom-v65';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/developer-console.js',
  './js/db.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for app shell, network-first fallback for everything else
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return res;
        })
        .catch(() => cached);
    })
  );
});










