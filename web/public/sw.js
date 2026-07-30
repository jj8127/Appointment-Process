const OFFLINE_DOCUMENT = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f97316" />
    <title>가람in 관리자 - 연결 필요</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #fff7ed; color: #111827; }
      main { min-height: 100vh; display: grid; place-content: center; padding: 24px; text-align: center; }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0; color: #4b5563; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <div>
        <h1>인터넷 연결이 필요합니다.</h1>
        <p>연결 상태를 확인한 뒤 가람in 관리자를 다시 열어 주세요.</p>
      </div>
    </main>
  </body>
</html>`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

async function retireSystemNotifications() {
  const pushManager = self.registration.pushManager;
  if (pushManager) {
    const subscription = await pushManager.getSubscription().catch(() => null);
    if (subscription) {
      await subscription.unsubscribe().catch(() => false);
    }
  }

  const notifications = await self.registration.getNotifications().catch(() => []);
  for (const notification of notifications) {
    notification.close();
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    retireSystemNotifications(),
  ]));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => new Response(OFFLINE_DOCUMENT, {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })),
    );
    return;
  }

  event.respondWith(fetch(request));
});
