// Keeps Track Log Live opening with no signal. Our own files: network first, cache as fallback.
// The Firebase library files never change for a given version, so they are served from cache once fetched.
const CACHE = "track-log-live-v1";
const FILES = ["./", "index.html", "manifest.json", "../fb.js", "../icon-180.png", "../icon-192.png", "../icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("track-log-live") && k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.origin === "https://www.gstatic.com" && u.pathname.startsWith("/firebasejs/")) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })));
    return;
  }
  if (u.origin !== location.origin) return; // database traffic goes straight to Google
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
