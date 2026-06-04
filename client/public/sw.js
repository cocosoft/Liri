/**
 * PWA Service Worker
 *
 * 缓存关键静态资源，支持离线基础访问。
 * 策略：Network First for API, Cache First for static assets.
 */

var CACHE_NAME = "liri-v1";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);

  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  // API 请求：网络优先
  if (url.pathname.startsWith("/v1/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 静态资源：缓存优先
  event.respondWith(cacheFirst(request));
});

function networkFirst(request) {
  try {
    return fetch(request).catch(function () {
      return caches.match(request).then(function (cached) {
        return cached || new Response("offline", { status: 503 });
      });
    });
  } catch (_e) {
    return caches.match(request).then(function (cached) {
      return cached || new Response("offline", { status: 503 });
    });
  }
}

function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      var clone = response.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(request, clone);
      });
      return response;
    }).catch(function () {
      return new Response("offline", { status: 503 });
    });
  });
}
