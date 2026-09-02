/* Bump CACHE whenever site files change, so clients pick up the new version. */
var CACHE = "nsa-checklist-v6";

var ASSETS = [
  "./",
  "./index.html",
  "./analyze/",
  "./analyze/index.html",
  "./manifest.webmanifest",
  "./assets/checklist.css",
  "./assets/checklist.js",
  "./assets/analyze.css",
  "./assets/analyze.js",
  "./assets/fonts.css",
  "./assets/fonts/archivo-normal-1.woff2",
  "./assets/fonts/ibm-plex-mono-normal-2.woff2",
  "./assets/fonts/ibm-plex-mono-normal-3.woff2",
  "./assets/fonts/source-serif-4-italic-4.woff2",
  "./assets/fonts/source-serif-4-normal-5.woff2",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* Network-first for the page so updates land; cache-first for static assets. */
self.addEventListener("fetch", function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") !== -1) return;   // analysis is always live, never cached

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match("./index.html");
          });
        })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      });
    })
  );
});
