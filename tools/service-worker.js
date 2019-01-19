var dataCacheName = "ToolsData-v1";
var cacheName = 'Tools-v1';
var filesToCache = [
    './',
    './index.html',
    './scripts/app.js',
    './scripts/index.js',
    './styles/index.css',
];

self.addEventListener('install', function (e) {
    console.log('[ServiceWorker] Install');
    e.waitUntil(
        caches.open(cacheName).then(function (cache) {
            console.log('[ServiceWorker] Caching app shell');
            return cache.addAll(filesToCache);
        })
    );
});

self.addEventListener('activate', function (e) {
    console.log('[ServiceWorker] Activate');
    e.waitUntil(
        caches.keys().then(keyList => {
            return Promise.all(keyList.map(key => {
                if (key !== cacheName && key !== dataCacheName) {
                    console.log('[ServiceWorker] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', function (e) {
    console.log('[Service Worker] Fetch', e.request.url);
    let requestURL = new URL(e.request.url);

    if (requestURL.origin !== self.origin) {
        return;
    }

    // 需要从网络请求的url
    var dataUrls = ['/scripts/'];
    if (dataUrls.some(x => requestURL.pathname.includes(x))) {
        e.respondWith(
            caches.open(dataCacheName).then(function (cache) {
                return fetch(e.request).then( response =>{
                    cache.put(e.request.url, response.clone());
                    return response;
                }).catch((err) => {
                    return caches.match(e.request).then(response=>response);
                });
            })
        );
    } else {
        e.respondWith(
            caches.match(e.request).then(function (response) {
                return response || fetch(e.request);
            })
        );
    }
});