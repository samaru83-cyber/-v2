// 서비스워커: 앱 파일을 캐시해 오프라인에서도 실행. 고객 데이터는 다루지 않음(IndexedDB에만 있음).
// 앱 파일을 수정해 배포할 때는 VERSION 숫자를 올리면 휴대폰에서 새 버전으로 교체된다.
const VERSION = 'v4';
const CACHE = `bunyang-crm-${VERSION}`;
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './css/team.css',
  './js/app.js', './js/db.js', './js/store.js', './js/utils.js', './js/ui.js', './js/seed.js', './js/team.js', './js/calls.js',
  './js/views/home.js', './js/views/customers.js', './js/views/detail.js', './js/views/form.js',
  './js/views/calendar.js', './js/views/sms.js', './js/views/settings.js',
  './js/views/setup.js', './js/views/team.js', './js/views/sync.js', './js/views/calls.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bunyang-crm-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 캐시 우선 + 백그라운드 갱신 (다음 실행 때 최신 파일 반영)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return; // PC 개발 미리보기는 항상 최신 파일
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      const res = await network;
      return res || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    })
  );
});
