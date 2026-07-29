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

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);
const isPositiveSafeInteger = (value) => Number.isSafeInteger(value) && value > 0;
const exactKeys = (value, keys) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isNotificationTargetV1 = (value) => {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'fc_profile':
      return exactKeys(value, ['version', 'kind', 'fcId']) && isUuid(value.fcId);
    case 'onboarding_section':
      return exactKeys(value, ['version', 'kind', 'fcId', 'section'])
        && isUuid(value.fcId)
        && ['home', 'consent', 'docs_upload', 'hanwha_commission', 'appointment'].includes(value.section);
    case 'board_post':
      return exactKeys(value, ['version', 'kind', 'postId']) && isUuid(value.postId);
    case 'notice':
      return exactKeys(value, ['version', 'kind', 'noticeId']) && isUuid(value.noticeId);
    case 'exam': {
      if (value.examType !== 'life' && value.examType !== 'nonlife') return false;
      return (
        exactKeys(value, ['version', 'kind', 'examType', 'examRegistrationId'])
        && isUuid(value.examRegistrationId)
      ) || (
        exactKeys(value, ['version', 'kind', 'examType', 'examRoundId'])
        && isUuid(value.examRoundId)
      );
    }
    case 'garamin_direct_chat':
      return exactKeys(value, ['version', 'kind', 'conversationId']) && isUuid(value.conversationId);
    case 'group_chat':
      return exactKeys(value, ['version', 'kind', 'roomId']) && isUuid(value.roomId);
    case 'request':
      return exactKeys(value, ['version', 'kind', 'requestId'])
        && isPositiveSafeInteger(value.requestId);
    case 'request_chat':
      return exactKeys(value, ['version', 'kind', 'requestDesignerId'])
        && isPositiveSafeInteger(value.requestDesignerId);
    case 'request_direct_chat':
      return exactKeys(value, ['version', 'kind', 'directConversationId'])
        && isPositiveSafeInteger(value.directConversationId);
    default:
      return false;
  }
};

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const notificationData = isRecord(data.data) ? data.data : {};
  event.waitUntil(self.registration.showNotification(
    typeof data.title === 'string' && data.title.trim() ? data.title : '가람in 알림',
    {
      body: typeof data.body === 'string' ? data.body : '',
      data: {
        notificationId: isUuid(notificationData.notificationId)
          ? notificationData.notificationId.toLowerCase()
          : null,
        target: isNotificationTargetV1(notificationData.target) ? notificationData.target : null,
      },
      icon: '/favicon.ico',
      badge: '/favicon.ico',
    },
  ));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = isRecord(event.notification.data) ? event.notification.data : {};
  const notificationId = isUuid(data.notificationId) ? data.notificationId.toLowerCase() : null;
  const targetValid = isNotificationTargetV1(data.target);
  const targetUrl = notificationId
    ? `/api/notification-open/prepare?notificationId=${encodeURIComponent(notificationId)}${targetValid ? '' : '&unavailable=1'}`
    : '/auth';
  const targetHref = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
    for (const client of clientList) {
      if (!client.url.startsWith(self.location.origin)) continue;
      if ('navigate' in client && 'focus' in client) {
        const navigatedClient = await client.navigate(targetHref);
        return (navigatedClient || client).focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(targetHref) : undefined;
  }));
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
