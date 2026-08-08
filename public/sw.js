// Absolute Cinema — Service Worker v1.0
// Strategy:
//  - HTML: network-first, fallback ke cache saat offline
//  - CSS/JS/Font: stale-while-revalidate
//  - Images: cache-first dengan TTL 30 hari
//  - API: network-only (jangan cache)
const VERSION = 'ac-v1';
const STATIC_CACHE = `${VERSION}-static`;
const IMAGES_CACHE = `${VERSION}-images`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const TTL_30D = 30 * 24 * 60 * 60 * 1000;
const TTL_7D = 7 * 24 * 60 * 60 * 1000;

const PRECACHE_URLS = [
    '/',
    '/style.css?v=stadv19',
    '/app.js?v=ios2616',
    '/favicon.svg',
    '/manifest.json',
    '/about',
    '/privacy',
    '/terms',
    '/contact'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            return cache.addAll(PRECACHE_URLS).catch(() => {
                // Best-effort precache; if a URL fails, continue
                return Promise.all(
                    PRECACHE_URLS.map((u) => cache.add(u).catch(() => null))
                );
            });
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Skip non-GET, chrome-extension, ads, analytics
    if (req.method !== 'GET') return;
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (/highperformanceformat\.com|profitabledisplaynetwork\.com|googletagmanager|google-analytics|facebook|doubleclick|adsystem|adnxs|exoclick/.test(url.hostname + url.pathname)) return;

    // API: network only (always fresh)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(req).catch(() => new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } })));
        return;
    }

    // TMDB images: cache-first w/ TTL
    if (url.hostname === 'image.tmdb.org') {
        event.respondWith(cacheFirstWithTTL(req, IMAGES_CACHE, TTL_30D));
        return;
    }

    // Static assets (CSS/JS/Font): stale-while-revalidate
    if (/\.(css|js|woff2?|ttf|eot|svg)$/.test(url.pathname)) {
        event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
        return;
    }

    // Same-origin HTML navigations: network-first
    if (url.origin === self.location.origin && (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html'))) {
        event.respondWith(networkFirst(req, STATIC_CACHE));
        return;
    }

    // Other GET: try cache then network
    event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
            if (resp.ok && url.origin === self.location.origin) {
                const copy = resp.clone();
                caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
            }
            return resp;
        }).catch(() => cached))
    );
});

async function staleWhileRevalidate(req, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then((resp) => {
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
    }).catch(() => null);
    return cached || networkPromise || new Response('Offline', { status: 503 });
}

async function networkFirst(req, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
    } catch (e) {
        const cached = await cache.match(req) || await cache.match('/');
        return cached || new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/html' }
        });
    }
}

async function cacheFirstWithTTL(req, cacheName, ttl) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    if (cached) {
        const dateHeader = cached.headers.get('date');
        const age = dateHeader ? Date.now() - new Date(dateHeader).getTime() : 0;
        if (age < ttl) return cached;
    }
    try {
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
    } catch (e) {
        return cached || new Response('Image offline', { status: 503 });
    }
}