// Service worker — app shell caching for offline support.
// Uses a network-first strategy for the HTML shell (so updates are picked up
// when online), and cache-first for static assets.

const CACHE_NAME = "envelope-v1";
const PRECACHE = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle GET requests.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Don't touch cross-origin or HMR-related requests.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/webpack-hmr")) return;

  // For navigation requests, network-first with fallback to cache.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          // Fall back to cached root for offline.
          return (await caches.match("/")) ?? Response.error();
        }
      })()
    );
    return;
  }

  // For static assets (/_next/...), cache-first.
  if (url.pathname.startsWith("/_next/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return Response.error();
        }
      })()
    );
    return;
  }
});
