/* Service worker: lets the app install and open fast. It never caches /api, so data is always live. */
const VERSION = 'v1';
const CACHE = 'nbs-receiving-' + VERSION;
const SHELL = ['/', '/index.html', '/app.css', '/core.js', '/help.js', '/ux.js', '/views.js', '/intake.js', '/intake3.js', '/settings.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon.svg', '/offline.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('nbs-receiving-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;           // CDN libraries load normally
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/tolerances/')) return;   // always live
  // network first so updates show up right away; fall back to the cached copy when the server is unreachable
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error()))));
});
