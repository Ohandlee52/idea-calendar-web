// ───────────────────────────────────────────────────────────────
//  서비스 워커: 앱 화면 파일을 폰에 저장해 두어
//  인터넷이 느리거나 잠깐 끊겨도 앱이 바로 열리게 합니다.
//  (메모 내용은 Supabase에서 받아오므로 인터넷이 필요합니다)
// ───────────────────────────────────────────────────────────────
// 버전을 올리면 예전에 저장해둔 파일이 모두 지워지고 새로 받습니다.
const CACHE = 'idea-calendar-v3';
const FILES = [
  './', './index.html', './app.css', './app.js',
  './logic.js', './holidays.js', './config.js', './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 앱 화면 파일만 저장본을 씁니다. (데이터 요청은 항상 인터넷으로)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // cache: 'reload' → 브라우저가 저장해둔 옛 파일을 건너뛰고 항상 새로 받아옵니다.
  // (앱을 새로 배포했을 때 폰이 옛 화면에 머무는 문제를 막아줍니다)
  e.respondWith(
    fetch(new Request(e.request, { cache: 'reload' }))
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
