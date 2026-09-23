/* PartyKeys Player — offline service worker.
 *
 * Put this file next to partykeys.html on the same web address (for GitHub Pages: the repo root, so it ends up at
 * https://<user>.github.io/<repo>/sw.js). The app registers it as "sw.js?v=<build>", so every new build gets its
 * own cache and the old one is thrown away — no stale copy can survive a release.
 *
 * Strategy: the app itself is network-first with a short timeout, so a fresh upload is picked up the moment there
 * is a connection and the cached copy takes over the instant there isn't. Everything else it needs (the Firebase
 * SDK, which is optional anyway) is cache-first.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'partykeys-' + VERSION;
const APP = ['./', './partykeys.html'];
const FB_SDK = 'https://cdnjs.cloudflare.com/ajax/libs/firebase/8.10.1/';
const EXTRAS = ['firebase-app.js', 'firebase-firestore.js', 'firebase-auth.js'].map(f => FB_SDK + f);
const NET_TIMEOUT = 4000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // The app shell must be there or offline is a lie, so it is awaited. The Firebase SDK is best-effort: the app
    // runs perfectly well without it (no cloud sync), and a CDN hiccup must not fail the whole install.
    await c.addAll(APP);
    await Promise.all(EXTRAS.map(u => c.add(new Request(u, { mode: 'no-cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('partykeys-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

function fromNetwork(req) {   // a request that gives up quickly, so a flaky connection doesn't hold the app hostage
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), NET_TIMEOUT);
    fetch(req).then(r => { clearTimeout(t); resolve(r); }, err => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const sameOrigin = url.origin === self.location.origin;
  const isApp = sameOrigin && (req.mode === 'navigate' || /\.html?$/.test(url.pathname) || url.pathname.endsWith('/'));

  if (isApp) {
    e.respondWith((async () => {
      try {
        const res = await fromNetwork(req);
        if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
        return res;
      } catch (err) {
        const hit = await caches.match(req, { ignoreSearch: true })
                 || await caches.match('./partykeys.html', { ignoreSearch: true })
                 || await caches.match('./', { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }

  if (EXTRAS.some(u => req.url.startsWith(u)) || sameOrigin) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
        return res;
      } catch (err) {
        if (hit) return hit;
        throw err;
      }
    })());
  }
  // Everything else (Firestore traffic, anything live) is left alone: it has no business being served from a cache.
});
