/* Network-first for app code (deploys land immediately when online); cache-first
 * for the SheetJS vendor blob (large, rarely changes). Auto-claim + skipWaiting
 * combined with controllerchange auto-reload in index.html = updates apply
 * themselves; no manual reopen dance. */
var CACHE = "timecard-v9";
var PRECACHE = [
  "./", "./index.html", "./styles.css", "./app.js",
  "./data/wcirb_construction.js", "./data/schema.js",
  "./manifest.webmanifest", "./vendor/xlsx.full.min.js",
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(PRECACHE); }));
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function putCache(req, resp) {
  var copy = resp.clone();
  caches.open(CACHE).then(function (c) { c.put(req, copy); });
  return resp;
}

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  var sameOrigin = url.origin === self.location.origin;
  var isCode = sameOrigin &&
    (e.request.mode === "navigate" || /\.(html|js|css)$/.test(url.pathname)) &&
    !/xlsx\.full\.min\.js$/.test(url.pathname);

  if (isCode) {
    e.respondWith(
      fetch(e.request, { cache: "no-cache" })
        .then(function (resp) { return putCache(e.request, resp); })
        .catch(function () {
          return caches.match(e.request).then(function (r) {
            return r || caches.match("./index.html");
          });
        })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (r) {
      return r || fetch(e.request).then(function (resp) {
        return putCache(e.request, resp);
      }).catch(function () { return caches.match("./index.html"); });
    })
  );
});
