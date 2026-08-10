/* 推しごとカレンダー — オフラインで開けるようにするための Service Worker
 *
 * 方針は「ネットワーク優先・失敗したらキャッシュ」。
 * キャッシュ優先にすると更新したのに古い画面が出続ける事故が起きるため、
 * オンラインのときは必ず最新を取りに行き、キャッシュは圏外用の保険としてだけ使う。
 *
 * ⚠️ index.html を更新したら CACHE の版数も上げること。古いキャッシュはその時点で捨てられる。
 */
const CACHE = 'oshi-cal-3.7.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .catch(() => {})          // 1つでも取れないと install ごと失敗するので握りつぶす
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
