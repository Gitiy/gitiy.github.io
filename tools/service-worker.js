/* ============================================================
   Tools PWA Service Worker

   策略：
   - 页面导航与本地脚本/样式：网络优先，失败回落缓存
     （改完代码刷新一次就能看到新版，不必等缓存名变化）
   - 其他同源 GET（图片等）：缓存优先，首次用到时写入缓存
   - 子应用 tools/scanlike/ 有它自己的 Service Worker，本 SW 不插手

   注意：Cache Storage 按 origin 共享。同站可能有别的应用也注册了 SW，
   所以清理旧缓存时只删自己前缀的，否则会把别人的离线缓存一起删掉。
   ============================================================ */

const VERSION = 'Tools-v2';
const CACHE_PREFIX = 'Tools';

const CORE = [
    './',
    './index.html',
    './scripts/app.js',
    './scripts/ui.js',
    './scripts/hosts.js',
    './scripts/flacmeta.js',
    './scripts/generator.js',
    './scripts/ifw.js',
    './styles/index.css',
    './manifest.json',
];

// 子应用目录：交给它自己的 SW 处理
const subAppPath = new URL('scanlike/', self.location).pathname;

// 这些路径走网络优先，保证改动后刷新一次即可生效
const NETWORK_FIRST = /\.(?:html|css|js|mjs|json|webmanifest)$/i;

self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        const cache = await caches.open(VERSION);
        // 逐个添加、各自 catch：任何一个文件 404 都不该让整个 SW 安装失败
        await Promise.all(CORE.map((u) => cache.add(u).catch(() => {})));
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

    const networkFirst = req.mode === 'navigate' || NETWORK_FIRST.test(url.pathname);

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
