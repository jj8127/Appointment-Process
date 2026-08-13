'use client';

import {
  buildTrustedNotificationHref,
  parseNotificationTargetV1,
  resolveNotificationDestination,
} from '@/lib/notification-target';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function invoke(body: Record<string, unknown>) {
  const response = await fetch('/api/fc-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok || !payload?.data?.ok) return null;
  return payload.data;
}

export function NotificationReadAcknowledger() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const notificationId = String(searchParams.get('notificationOpenId') ?? '').trim().toLowerCase();

  useEffect(() => {
    if (!UUID_PATTERN.test(notificationId)) return;
    let cancelled = false;

    const acknowledge = () => void (async () => {
      const inbox = await invoke({ type: 'inbox_get', notification_id: notificationId });
      const target = parseNotificationTargetV1(inbox?.notification?.target);
      if (!target || cancelled) return;
      const destination = resolveNotificationDestination(target);
      if (destination.scope !== 'same-origin') return;
      const href = buildTrustedNotificationHref({ destination });
      if (!href) return;
      const expected = new URL(href, window.location.origin);
      if (expected.pathname !== pathname) return;
      for (const [key, value] of expected.searchParams) {
        if (searchParams.get(key) !== value) return;
      }

      // This component mounts inside the authorized destination layout. Receipt
      // creation happens only after the exact destination URL is active.
      await invoke({ type: 'inbox_mark_read', notification_ids: [notificationId] });
    })();

    window.addEventListener('notification-destination-ready', acknowledge);
    return () => {
      cancelled = true;
      window.removeEventListener('notification-destination-ready', acknowledge);
    };
  }, [notificationId, pathname, searchParams]);

  return null;
}
