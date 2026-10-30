// 홈 화면 앱으로 설치되게 하는 최소 서비스 워커.
// 화면 파일만 저장해 두고(먼저 인터넷에서 새로 받고, 안 되면 저장본), 학교 자료(허브 응답)는 저장하지 않는다.
const CACHE = 'cbg-mobile-v1'
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icon.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith(fetch(request)
    .then(response => {
      const copy = response.clone()
      caches.open(CACHE).then(cache => cache.put(request, copy))
      return response
    })
    .catch(() => caches.match(request)))
})
