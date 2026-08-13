'use client';

import {
  Alert,
  Button,
  Center,
  Loader,
  Stack,
  Text,
} from '@mantine/core';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';

import {
  buildTrustedNotificationHref,
  parseNotificationTargetV1,
  resolveNotificationDestination,
} from '@/lib/notification-target';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTIFICATION_OPEN_TIMEOUT_MS = 10_000;

type OpenState = 'loading' | 'unavailable';

export default function NotificationOpenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const notificationId = (() => {
    try {
      return decodeURIComponent(id).trim().toLowerCase();
    } catch {
      return '';
    }
  })();
  const [state, setState] = useState<OpenState>(() =>
    UUID_PATTERN.test(notificationId) ? 'loading' : 'unavailable',
  );
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!UUID_PATTERN.test(notificationId)) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/fc-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          cache: 'no-store',
          body: JSON.stringify({ type: 'inbox_get', notification_id: notificationId }),
          signal: AbortSignal.timeout(NOTIFICATION_OPEN_TIMEOUT_MS),
        });
        const payload = await response.json().catch(() => null);
        const target = parseNotificationTargetV1(payload?.data?.notification?.target);
        if (!response.ok || !payload?.ok || !payload?.data?.ok || !target || cancelled) {
          if (!cancelled) setState('unavailable');
          return;
        }

        const destination = resolveNotificationDestination(target);
        const href = buildTrustedNotificationHref({
          destination,
          requestBoardOrigin: process.env.NEXT_PUBLIC_REQUEST_BOARD_URL,
        });
        if (!href) {
          setState('unavailable');
          return;
        }

        if (destination.scope === 'request-board') {
          // Cross-origin readiness cannot be proven, so the FC receipt remains unread.
          window.location.assign(href);
          return;
        }

        const targetUrl = new URL(href, window.location.origin);
        targetUrl.searchParams.set('notificationOpenId', notificationId);
        router.replace(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
      } catch {
        if (!cancelled) setState('unavailable');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [notificationId, retryCount, router]);

  if (state === 'loading') {
    return <Center mih={240}><Loader color="orange" /></Center>;
  }

  return (
    <Center mih={300}>
      <Stack maw={480} align="stretch">
        <Alert color="orange" title="대상을 열 수 없음">
          알림 대상이 삭제되었거나 접근 권한이 없거나, 네트워크 연결이 원활하지 않습니다.
          이 알림은 읽음 처리되지 않았습니다.
        </Alert>
        <Text size="sm" c="dimmed" ta="center">
          다시 시도하거나 대시보드에서 다른 알림을 확인할 수 있습니다.
        </Text>
        <Button
          color="orange"
          onClick={() => {
            setState('loading');
            setRetryCount((count) => count + 1);
          }}
        >
          다시 시도
        </Button>
        <Button variant="light" color="orange" onClick={() => router.replace('/dashboard')}>
          대시보드로 돌아가기
        </Button>
      </Stack>
    </Center>
  );
}
