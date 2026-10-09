/* ============================================================
   ScanLike Service Worker —— 离线可用
   策略：
   - vendor/ 下的第三方库不会变 → 缓存优先（pdf.js worker 有 1MB，走缓存最快）
   - 其余本机文件（html / css / js）→ 网络优先，失败回落缓存
     这样改完代码刷新一次就能看到新版，同时断网时依然可用。
   ============================================================ */

const VERSION = 'scanlike-v5';
// Cache Storage 按 origin 共享：同站可能有别的应用（如 tools/ 下的 Tools PWA）
// 也注册了 Service Worker。这里只清理自己的缓存，避免把别人的离线缓存删掉。
const CACHE_PREFIX = 'scanlike-';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './effects.js',
  './office.js',
  './scan-worker.js',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './manifest.webmanifest',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './vendor/pdf-lib.min.js',
  './vendor/jszip.min.js',
  './vendor/docx-preview.min.js',
  './vendor/xlsx.full.min.js',
  './vendor/html-to-image.js',
];

const CACHE_FIRST = /\/vendor\//;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 逐个添加：个别文件缺失不影响整体安装
    await Promise.all(CORE.map((u) => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== VERSION)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const preferCache = CACHE_FIRST.test(url.pathname);

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);

    if (preferCache) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }

    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') await cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
