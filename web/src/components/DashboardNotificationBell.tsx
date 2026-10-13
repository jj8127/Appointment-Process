'use client';

import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import {
  isInboxNotificationPayload,
  type InboxNotificationPayload,
} from '@/lib/inbox-notification-contract';
import { QueryReadError } from '@/lib/query-read-error';
import { requireMutationSuccess } from '@/lib/user-intent-policy';
import { notifications } from '@mantine/notifications';

import type { StaffType } from '@/lib/staff-identity';
import { parseNotificationTargetV1, type NotificationTargetV1 } from '@/lib/notification-target';
import { redactSensitiveText } from '@/lib/sensitive-text';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Indicator,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconBell, IconChevronRight, IconCircleFilled, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

type DashboardRole = 'admin' | 'manager' | 'fc';

type DashboardNotificationBellProps = {
  role: DashboardRole;
  residentId: string;
  staffType?: StaffType;
};

type InboxListResponse = {
  ok?: boolean;
  notifications?: InboxNotificationPayload[];
};

type InboxProxyResponse = {
  ok?: boolean;
  data?: unknown;
  error?: string;
};

type InboxMarkAllReadResponse = {
  ok: true;
  authorized: true;
  changed: boolean;
  state: 'read' | 'already_read';
  updated: number;
  matched: number;
};

type HeaderNotificationItem = {
  id: string;
  title: string;
  body: string;
  category: string;
  target: NotificationTargetV1 | null;
  createdAt: string | null;
  readAt: string | null;
};

const LIST_LIMIT = 80;
const formatCreatedAt = (value: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
};

const categoryLabel = (target: NotificationTargetV1 | null, fallback: string) => {
  if (!target) return fallback || '알림';
  switch (target.kind) {
    case 'fc_profile':
    case 'onboarding_section':
      return '온보딩';
    case 'board_post':
      return '게시판';
    case 'notice':
      return '공지';
    case 'exam':
      return '시험';
    case 'garamin_direct_chat':
    case 'group_chat':
      return '메신저';
    case 'request':
    case 'request_chat':
    case 'request_direct_chat':
      return '설계요청';
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

async function invokeInboxRequest(body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch('/api/fc-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as InboxProxyResponse | null;
  if (!response.ok || !payload?.ok || !isRecord(payload.data)) {
    throw new QueryReadError(response.status);
  }
  return payload.data;
}

async function invokeInboxList(body: Record<string, unknown>): Promise<InboxNotificationPayload[]> {
  const data = await invokeInboxRequest(body) as InboxListResponse;
  if (data.ok !== true
      || !Array.isArray(data.notifications)
      || !data.notifications.every(isInboxNotificationPayload)) {
    throw new QueryReadError();
  }
  return data.notifications;
}

function requireInboxUnreadCount(value: unknown): number {
  if (
    !isRecord(value)
    || value.ok !== true
    || !Number.isSafeInteger(value.count)
    || Number(value.count) < 0
  ) throw new QueryReadError();
  return Number(value.count);
}

function requireInboxMarkAllReadSuccess(
  value: unknown,
): asserts value is InboxMarkAllReadResponse {
  requireMutationSuccess(value);
  const updated = value.updated;
  const matched = value.matched;
  const changed = value.changed;
  const state = value.state;
  if (
    value.authorized !== true
    || typeof changed !== 'boolean'
    || (state !== 'read' && state !== 'already_read')
    || typeof updated !== 'number'
    || !Number.isSafeInteger(updated)
    || updated < 0
    || !Number.isSafeInteger(matched)
    || Number(matched) < 0
    || Number(updated) > Number(matched)
    || (changed ? state !== 'read' || updated === 0 : state !== 'already_read' || updated !== 0)
  ) {
    throw new Error('읽음 처리 결과를 확인하지 못했습니다. 상태를 확인한 뒤 다시 시도해주세요.');
  }
}

async function invokeInboxUnreadCount(body: Record<string, unknown>): Promise<number> {
  return requireInboxUnreadCount(await invokeInboxRequest(body));
}

async function invokeInboxMarkAllRead(): Promise<InboxMarkAllReadResponse> {
  const data = await invokeInboxRequest({ type: 'inbox_mark_all_read' });
  requireInboxMarkAllReadSuccess(data);
  return data;
}

export function DashboardNotificationBell({
  role,
  residentId,
  staffType = null,
}: DashboardNotificationBellProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);
  const listQueryKey = useMemo(
    () => ['dashboard-header-notifications-v2', 'list', role, residentId, staffType] as const,
    [residentId, role, staffType],
  );
  const countQueryKey = useMemo(
    () => ['dashboard-header-notifications-v2', 'unread-count', role, residentId, staffType] as const,
    [residentId, role, staffType],
  );
  const isPersonalAdminInbox = role === 'manager' || staffType === 'developer';
  const inboxRole = role === 'fc' ? 'fc' : 'admin';
  const inboxResidentId = inboxRole === 'fc' || isPersonalAdminInbox
    ? residentId.replace(/\D/g, '')
    : null;

  const listQuery = useQuery({
    queryKey: listQueryKey,
    refetchInterval: 30_000,
    queryFn: async (): Promise<HeaderNotificationItem[]> => {
      const notifications = await invokeInboxList({
        type: 'inbox_list',
        role: inboxRole,
        resident_id: inboxResidentId,
        limit: LIST_LIMIT,
      });

      return notifications
        .filter((item) => !item.dismissed_at)
        .map((item) => ({
          id: item.id,
          title: redactSensitiveText(item.title, '알림'),
          body: redactSensitiveText(item.body),
          category: redactSensitiveText(item.category ?? '알림'),
          target: parseNotificationTargetV1(item.target),
          createdAt: item.created_at ?? null,
          readAt: item.read_at ?? null,
        }))
        .sort((left, right) =>
          new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime(),
        );
    },
  });
  const countQuery = useQuery({
    queryKey: countQueryKey,
    refetchInterval: 30_000,
    queryFn: () => invokeInboxUnreadCount({
      type: 'inbox_unread_count',
      role: inboxRole,
      resident_id: inboxResidentId,
    }),
  });
  const items = listQuery.data ?? [];
  const unreadCount = countQuery.data ?? 0;
  const inboxError = listQuery.error ?? countQuery.error;
  const isLoading = listQuery.isLoading || countQuery.isLoading;
  const isRefetching = listQuery.isRefetching || countQuery.isRefetching;
  const isSuccess = listQuery.isSuccess && countQuery.isSuccess;
  const refetch = async () => {
    await Promise.all([listQuery.refetch(), countQuery.refetch()]);
  };

  const markAllMutation = useMutation({
    mutationFn: invokeInboxMarkAllRead,
    onError: () => notifications.show({ title: '읽음 처리 실패', message: '알림을 읽음으로 저장하지 못했습니다. 다시 시도해주세요.', color: 'red' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: listQueryKey }),
        queryClient.invalidateQueries({ queryKey: countQueryKey }),
      ]);
    },
  });

  const handleOpen = (item: HeaderNotificationItem) => {
    setOpened(false);
    if (!item.target) {
      router.push(`/dashboard/notification-open/${encodeURIComponent(item.id)}?unavailable=1`);
      return;
    }
    // The open route re-fetches this exact notification for the verified viewer,
    // authorizes the exact entity, and only then creates the read receipt.
    router.push(`/dashboard/notification-open/${encodeURIComponent(item.id)}`);
  };

  return (
    <Menu opened={opened} onChange={setOpened} shadow="md" width={420} position="bottom-end" withinPortal>
      <Menu.Target>
        <Indicator
          disabled={unreadCount === 0 && !countQuery.error}
          label={countQuery.error ? '?' : unreadCount > 99 ? '99+' : unreadCount}
          size={18}
          color="red"
          offset={5}
        >
          <ActionIcon variant="subtle" color="gray" size="lg" radius="xl" aria-label="알림 센터 열기">
            <IconBell size={20} stroke={1.8} />
          </ActionIcon>
        </Indicator>
      </Menu.Target>

      <Menu.Dropdown p={0}>
        <Box px="md" py="sm">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={700} size="sm">알림 센터</Text>
            <Group gap={6} wrap="nowrap">
              <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => void refetch()}
                aria-label="알림 목록 새로고침"
              >
                {isRefetching ? <Loader size={14} /> : <IconRefresh size={14} stroke={1.8} />}
              </ActionIcon>
              <Button
                variant="subtle"
                size="compact-xs"
                color="gray"
                loading={markAllMutation.isPending}
                disabled={unreadCount === 0 || Boolean(countQuery.error) || !countQuery.isSuccess}
                onClick={() => markAllMutation.mutate()}
              >
                모두 읽음
              </Button>
            </Group>
          </Group>
        </Box>
        <Divider />

        {inboxError ? <Box p="sm"><QueryErrorAlert error={inboxError} onRetry={refetch} isFetching={isRefetching} hasData={items.length > 0} subject="알림" /></Box> : null}
        {isLoading ? (
          <Group justify="center" py="xl"><Loader size="sm" color="orange" /></Group>
        ) : items.length === 0 && isSuccess && !inboxError ? (
          <Box px="md" py="xl">
            <Text size="sm" c="dimmed" ta="center">새로운 알림이 없습니다.</Text>
          </Box>
        ) : (
          <ScrollArea.Autosize mah={420}>
            <Stack gap={0}>
              {items.map((item) => {
                const unread = !item.readAt;
                return (
                  <Box key={item.id}>
                    <UnstyledButton
                      onClick={() => handleOpen(item)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        backgroundColor: unread ? '#FFF7ED' : 'transparent',
                      }}
                    >
                      <Group align="flex-start" wrap="nowrap" gap={10}>
                        <Box mt={4} w={10}>
                          {unread ? <IconCircleFilled size={8} color="#f36f21" /> : <Box w={8} h={8} />}
                        </Box>
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Group justify="space-between" mb={4} wrap="nowrap">
                            <Badge
                              size="xs"
                              variant="light"
                              color={item.target?.kind.startsWith('request') ? 'blue' : 'orange'}
                            >
                              {categoryLabel(item.target, item.category)}
                            </Badge>
                            <Text size="xs" c="dimmed">{formatCreatedAt(item.createdAt)}</Text>
                          </Group>
                          <Text size="sm" fw={unread ? 700 : 500} lineClamp={1}>{item.title}</Text>
                          <Text size="xs" c="dimmed" lineClamp={2}>{item.body}</Text>
                          {!item.target ? (
                            <Text size="xs" c="red" mt={4}>대상을 열 수 없음</Text>
                          ) : null}
                        </Box>
                        <IconChevronRight size={14} stroke={1.7} color="#9CA3AF" />
                      </Group>
                    </UnstyledButton>
                    <Divider />
                  </Box>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
