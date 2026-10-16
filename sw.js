self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('gaslands-pwa-v1').then((cache) => {
      return cache.addAll(['index.html', 'app.js', 'manifest.json']);
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
