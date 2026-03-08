self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: '알림',
      body: event.data ? event.data.text() : '',
      data: {},
    };
  }

  const title = data.title || 'FC 온보딩 알림';
  const options = {
    body: data.body || '',
    data: data.data || {},
    icon: '/favicon.ico',
    badge: '/favicon.ico',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

const sanitizeDigits = (value) => String(value || '').replace(/[^0-9]/g, '');

const normalizeTargetName = (value) => String(value || '').trim();

const buildDashboardChatUrl = (input) => {
  const params = new URLSearchParams();
  const targetId = sanitizeDigits(input && input.targetId);
  const targetName = normalizeTargetName(input && input.targetName);

  if (targetId) params.set('targetId', targetId);
  if (targetName) params.set('targetName', targetName);

  const query = params.toString();
  return query ? `/dashboard/chat?${query}` : '/dashboard/chat';
};

const normalizeNotificationTargetUrl = (rawUrl) => {
  let trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '/dashboard/notifications';

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      trimmed = `${parsed.pathname}${parsed.search}`;
    } catch {
      return '/dashboard/notifications';
    }
  }

  if (trimmed.startsWith('/dashboard/chat')) return trimmed;

  if (trimmed.startsWith('/dashboard/messenger')) {
    try {
      const parsed = new URL(trimmed, self.location.origin);
      const channel = (parsed.searchParams.get('channel') || '').trim().toLowerCase();
      if (channel === 'garam') {
        return buildDashboardChatUrl({
          targetId: parsed.searchParams.get('targetId'),
          targetName: parsed.searchParams.get('targetName'),
        });
      }
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return '/dashboard/messenger';
    }
  }

  if (trimmed.startsWith('/chat')) {
    try {
      const parsed = new URL(trimmed, self.location.origin);
      return buildDashboardChatUrl({
        targetId: parsed.searchParams.get('targetId'),
        targetName: parsed.searchParams.get('targetName'),
      });
    } catch {
      return '/dashboard/chat';
    }
  }

  return trimmed;
};

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawTargetUrl = (event.notification.data && event.notification.data.url) || '/dashboard/notifications';
  const targetUrl = normalizeNotificationTargetUrl(rawTargetUrl);
  const targetHref = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (client.url === targetHref && 'focus' in client) {
          return client.focus();
        }
      }

      for (const client of clientList) {
        if (!client.url.startsWith(self.location.origin)) continue;
        if ('navigate' in client && 'focus' in client) {
          const navigatedClient = await client.navigate(targetUrl);
          return (navigatedClient || client).focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
