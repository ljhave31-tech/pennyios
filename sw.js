const CACHE = 'penny-v6';
const FILES = ['./', 'index.html', 'firebase-config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  // Cache each file on its own so one missing file can't break the install.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // App files (page, scripts, manifest): network first, so updates show up on the very next load.
  // Falls back to the cached copy when offline.
  const appFile = url.origin === location.origin &&
    (e.request.mode === 'navigate' || url.pathname.endsWith('/') || /\.(html|js|webmanifest)$/.test(url.pathname));
  if (appFile) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(r => {
          if (r && r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return r;
        })
        .catch(() =>
          caches.match(e.request, { ignoreSearch: true }).then(m => m || caches.match('index.html'))
        )
    );
    return;
  }

  // Everything else (icons, Firebase SDK files): serve from cache, refresh in the background.
  e.respondWith(caches.open(CACHE).then(async c => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request)
      .then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(e.request, r.clone()); return r; })
      .catch(() => cached);
    return cached || net;
  }));
});
