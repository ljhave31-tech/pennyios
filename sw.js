/* Penny service worker
   Its only jobs: keep the app shell and the pinned Firebase SDK available offline.
   It never touches Firestore or Auth traffic. Firebase keeps its own offline copy of
   your data (IndexedDB), so the worker must not cache, replay or reroute those requests. */

const CACHE = 'penny-v8';   // bump this whenever you want every device to drop its old cache
const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SDK = ['app', 'auth', 'firestore'].map(n => `${SDK_BASE}firebase-${n}.js`);
const SHELL = ['./', 'index.html', 'firebase-config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  // Cache each file on its own so one missing file can't break the install.
  // cache:'reload' skips the browser's HTTP cache, so we never store an out-of-date copy.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all([
        ...SHELL.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {})),
        ...SDK.map(u => fetch(u).then(r => r.ok && c.put(u, r)).catch(() => {}))
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  // Delete every cache except the current one. This clears all old data, including any
  // Firebase responses that older versions of this worker may have stored by mistake.
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Pinned Firebase SDK files: the URL contains the version, so they never change. Cache first.
  if (url.href.startsWith(SDK_BASE)) {
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const hit = await c.match(req);
        if (hit) return hit;
        const r = await fetch(req);
        if (r && r.ok) c.put(req, r.clone());
        return r;
      })
    );
    return;
  }

  // 2) Anything from another site (firestore.googleapis.com, identitytoolkit, fonts, ...):
  //    hands off. The browser and the Firebase SDK deal with it directly.
  if (url.origin !== location.origin) return;

  // 3) Our own page, scripts and manifest: network first, so a new deploy shows on the next load.
  //    The cached copy is only used when the network fails (offline).
  const isApp = req.mode === 'navigate' || url.pathname.endsWith('/') ||
    /\.(html|js|webmanifest)$/.test(url.pathname);
  if (isApp) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(r => {
          if (r && r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return r;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then(m => m || caches.match('index.html'))
        )
    );
    return;
  }

  // 4) Our own images and icons: serve from cache, refresh quietly in the background.
  e.respondWith(
    caches.open(CACHE).then(async c => {
      const cached = await c.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then(r => { if (r && r.ok) c.put(req, r.clone()); return r; })
        .catch(() => cached);
      return cached || net;
    })
  );
});
