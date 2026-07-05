const CACHE_NAME = 'bts-mapa-cache-v3';
const ASSETS = [
  './',
  './index.html',
  './css/main.css',
  './js/map-logic.js',
  './js/tech-logic.js',
  './manifest.json',
  './bts-data.json',
  './bts-data-tmobile.json'
];

// Instalace Service Workera a cachování souborů
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cachování offline zdrojů a velkých datových souborů...');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Aktivace a promazání starých cachí
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Odstraňování staré cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Obsluha požadavků - Cache First strategie (ideální pro offline použití)
self.addEventListener('fetch', (event) => {
  // Ignorovat API volání kompasu/výšek a externí mapové podklady (Seznam)
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    // Pro externí věci (Mapy.cz dlaždice) použijeme Network First nebo jen Network
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((response) => {
          // Uložit nové lokální soubory do cache
          if (response.status === 200) {
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseCopy);
            });
          }
          return response;
        });
      })
  );
});
