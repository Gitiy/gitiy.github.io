/* ============================================================
   Tools PWA Service Worker

   策略：
   - vendor/ 下的第三方库体积大且稳定 → 缓存优先
   - 其余本机文件（html / css / js / json）→ 网络优先，失败回落缓存
     这样改完代码刷新一次就能看到新版，同时断网时依然可用
   - 其它同源请求（图标、cmaps、standard_fonts 等）→ 缓存优先，首次用到时写入
   - 子应用 tools/scanlike/ 有它自己的 Service Worker，本 SW 不插手

   注意：Cache Storage 按 origin 共享。同站有别的应用也注册了 SW，
   所以清理旧缓存时只删自己前缀的，否则会把别人的离线缓存一起删掉。
   ============================================================ */

const VERSION = 'Tools-v3';
const CACHE_PREFIX = 'Tools';

// 应用外壳与全部工具模块：装好即可离线使用
const CORE = [
  './',
  './index.html',
  './styles/index.css',
  './manifest.json',
  './scripts/app.js',
  './scripts/ui.js',
  './scripts/registry.js',

  './scripts/lib/scripts.js',
  './scripts/lib/files.js',
  './scripts/lib/pdfkit.js',
  './scripts/lib/table.js',
  './scripts/lib/ooxml.js',
  './scripts/lib/draw.js',
  './scripts/lib/office.js',

  './scripts/tools/pdf-merge.js',
  './scripts/tools/pdf-split.js',
  './scripts/tools/pdf-pages.js',
  './scripts/tools/pdf-watermark.js',
  './scripts/tools/pdf-pagenum.js',
  './scripts/tools/pdf-meta.js',
  './scripts/tools/pdf-flatten.js',
  './scripts/tools/pdf-resize.js',
  './scripts/tools/pdf-to-image.js',
  './scripts/tools/pdf-text.js',
  './scripts/tools/pdf-img-extract.js',
  './scripts/tools/pdf-convert.js',
  './scripts/tools/image-to-pdf.js',
  './scripts/tools/image-convert.js',
  './scripts/tools/office-convert.js',
  './scripts/tools/sheet-tools.js',
  './scripts/tools/text-dedupe.js',
  './scripts/tools/text-diff.js',

  './scripts/hosts.js',
  './scripts/flacmeta.js',
  './scripts/generator.js',
  './scripts/ifw.js',

  './images/icons/icon-32x32.png',
  './images/icons/icon-64x64.png',
  './images/icons/icon-128x128.png',
  './images/icons/icon-256x256.png',
  './images/icons/icon-512x512.png',
];

// 子应用目录：交给它自己的 SW 处理
const subAppPath = new URL('scanlike/', self.location).pathname;

// 这些路径走网络优先，保证改动后刷新一次即可生效
const NETWORK_FIRST = /\.(?:html|css|js|mjs|json|webmanifest)$/i;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 逐个添加、各自 catch：任何一个文件缺失都不该让整个 SW 安装失败
    await Promise.all(CORE.map((u) => cache.add(u).catch(() => { })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.indexOf(CACHE_PREFIX) === 0 && k !== VERSION)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.origin) return;
  if (url.pathname.indexOf(subAppPath) === 0) return;

  // vendor 里都是体积大且不常变的库，缓存优先能省掉每次 1MB 的 worker 下载
  const inVendor = url.pathname.includes('/vendor/');
  const networkFirst = !inVendor && (req.mode === 'navigate' || NETWORK_FIRST.test(url.pathname));

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);

    if (!networkFirst) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }

    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        await cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await cache.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
