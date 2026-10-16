// Service worker: makes the app shell load offline.
// Bump VERSION whenever you change the shell files so phones pick up the update.
const VERSION = 'setlist-shell-v1';
const FONTS = 'setlist-fonts-v1';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== VERSION && key !== FONTS) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    event.respondWith(staleWhileRevalidate(event, req, VERSION, true));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(event, req, FONTS, false));
  }
  // Everything else (your Worker API, iTunes lookups, audio previews, album art)
  // goes straight to the network and is never cached here.
});

async function staleWhileRevalidate(event, req, cacheName, isShell) {
  const cache = await caches.open(cacheName);
  // Page loads (including Spotify's ?code=... redirect) all map to the one cached index.html
  const key = isShell && req.mode === 'navigate' ? './index.html' : req;
  const cached = await cache.match(key, { ignoreSearch: isShell });

  const network = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network); // refresh in the background for next time
    return cached;
  }
  return (await network) || new Response('You are offline and this file was not saved yet.', {
    status: 503, headers: { 'Content-Type': 'text/plain' }
  });
}
