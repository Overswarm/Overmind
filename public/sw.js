// Minimal service worker for Overmind. Two goals:
//   1. Precache the app shell so cold offline launches work.
//   2. Runtime-cache the WASM parser and hashed build assets with a
//      cache-first strategy, so they load instantly on repeat visits.
//
// Dynamically-generated asset filenames (src/assets/*-HASH.js/.css) can't be
// enumerated at install time, so the precache only covers stable paths. The
// fetch handler handles the rest opportunistically.

const VERSION = 'overmind-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App shell navigation: network-first with cache fallback so users get fresh
  // HTML when online but still launch offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('/', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match('/') ?? await cache.match('/index.html');
        if (cached) return cached;
        throw new Error('offline and no cached shell');
      }
    })());
    return;
  }

  // Static assets (hashed JS/CSS, WASM, images): cache-first. Safe because
  // hashed filenames change when content changes.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/wasm/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const resp = await fetch(req);
      if (resp.ok) cache.put(req, resp.clone());
      return resp;
    })());
  }
});
