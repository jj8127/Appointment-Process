'use client';

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

type InboxNotificationPayload = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  target?: unknown;
  target_url?: string | null;
  created_at?: string | null;
  read_at?: string | null;
  dismissed_at?: string | null;
};

type InboxListResponse = {
  ok?: boolean;
  message?: string;
  notifications?: InboxNotificationPayload[];
};

type InboxProxyResponse = {
  ok?: boolean;
  data?: InboxListResponse;
  error?: string;
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
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function invokeInbox(body: Record<string, unknown>) {
  const response = await fetch('/api/fc-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as InboxProxyResponse | null;
  if (!response.ok || !payload?.ok || !payload.data?.ok) {
    throw new Error(payload?.error ?? payload?.data?.message ?? '알림을 불러오지 못했습니다.');
  }
  return payload.data;
}

export function DashboardNotificationBell({
  role,
  residentId,
  staffType = null,
}: DashboardNotificationBellProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);
  const queryKey = useMemo(
    () => ['dashboard-header-notifications-v1', role, residentId, staffType] as const,
    [residentId, role, staffType],
  );

  const { data: items = [], isLoading, isRefetching, refetch } = useQuery({
    queryKey,
    refetchInterval: 30_000,
    queryFn: async (): Promise<HeaderNotificationItem[]> => {
      const fetchRole = async (inboxRole: 'admin' | 'fc') => invokeInbox({
          type: 'inbox_list',
          role: inboxRole,
          resident_id: inboxRole === 'fc' || role === 'manager' || staffType === 'developer'
            ? residentId.replace(/\D/g, '')
            : null,
          limit: LIST_LIMIT,
        });
      const [primaryInbox, developerFcInbox] = await Promise.all([
        fetchRole(role === 'fc' ? 'fc' : 'admin'),
        role === 'admin' && staffType === 'developer' ? fetchRole('fc') : Promise.resolve(null),
      ]);
      const deduped = new Map<string, InboxNotificationPayload>();
      for (const item of [
        ...(primaryInbox.notifications ?? []),
        ...(developerFcInbox?.notifications ?? []),
      ]) {
        if (!deduped.has(item.id)) deduped.set(item.id, item);
      }

      return Array.from(deduped.values())
        .filter((item) => !item.dismissed_at && UUID_PATTERN.test(String(item.id ?? '')))
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

  const markAllMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      await invokeInbox({ type: 'inbox_mark_read', notification_ids: ids });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const unreadIds = items.filter((item) => !item.readAt).map((item) => item.id);
  const unreadCount = unreadIds.length;

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
          disabled={unreadCount === 0}
          label={unreadCount > 99 ? '99+' : unreadCount}
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
                disabled={unreadCount === 0}
                onClick={() => markAllMutation.mutate(unreadIds)}
              >
                모두 읽음
              </Button>
            </Group>
          </Group>
        </Box>
        <Divider />

        {isLoading ? (
          <Group justify="center" py="xl"><Loader size="sm" color="orange" /></Group>
        ) : items.length === 0 ? (
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
