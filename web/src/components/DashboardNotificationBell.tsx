'use client';

import { isDeveloperSession, type StaffType } from '@/lib/staff-identity';
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
import { useLocalStorage } from '@mantine/hooks';
import { IconBell, IconChevronRight, IconCircleFilled, IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

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
  target_url?: string | null;
  created_at?: string | null;
};

type InboxNoticePayload = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  created_at?: string | null;
};

type InboxListResponse = {
  ok?: boolean;
  message?: string;
  notifications?: InboxNotificationPayload[];
  notices?: InboxNoticePayload[];
};

type InboxProxyResponse = {
  ok?: boolean;
  status?: number;
  data?: InboxListResponse;
  error?: string;
};

type HeaderNotificationItem = {
  id: string;
  rawId: string;
  title: string;
  body: string;
  category?: string | null;
  targetUrl?: string | null;
  createdAt?: string | null;
  source: 'notification' | 'notice';
  origin: 'request_board' | 'fc_onboarding' | 'notice';
};

const BOARD_NOTICE_ID_PREFIX = 'board_notice:';
const REQUEST_BOARD_CATEGORY_PREFIX = 'request_board_';
const STORAGE_KEY_PREFIX = 'dashboard-notification-seen';
const LIST_LIMIT = 60;

const REQUEST_BOARD_CATEGORY_LABELS: Record<string, string> = {
  request_board_new_request: '의뢰 도착',
  request_board_accepted: '의뢰 수락',
  request_board_rejected: '의뢰 거절',
  request_board_completed: '설계 완료',
  request_board_cancelled: '의뢰 취소',
  'request_board_fc-accepted': 'FC 승인',
  'request_board_fc-rejected': 'FC 거절',
  request_board_message: '새 메시지',
  request_board_bridge_test: '연동 테스트',
};

const sanitize = (value?: string | null) => String(value ?? '').replace(/[^0-9]/g, '');

const isRequestBoardCategory = (category?: string | null): boolean =>
  (category ?? '').trim().toLowerCase().startsWith(REQUEST_BOARD_CATEGORY_PREFIX);

const getCategoryLabel = (item: HeaderNotificationItem): string => {
  if (item.source === 'notice') return '공지';

  const category = (item.category ?? '').trim();
  if (!category) return '알림';
  const normalized = category.toLowerCase();
  if (normalized === 'app_event') return '앱 알림';
  if (item.origin === 'request_board') {
    return REQUEST_BOARD_CATEGORY_LABELS[normalized] ?? '설계요청 알림';
  }
  return category;
};

const getOriginLabel = (item: HeaderNotificationItem): string => {
  if (item.origin === 'request_board') return '설계요청';
  if (item.source === 'notice') return '공지';
  return '온보딩';
};

const extractBoardPostId = (rawId: string): string | null => {
  if (!rawId.startsWith(BOARD_NOTICE_ID_PREFIX)) return null;
  const postId = rawId.slice(BOARD_NOTICE_ID_PREFIX.length).trim();
  return postId || null;
};

const normalizeTargetUrlForWeb = (url: string): string => {
  let trimmed = url.trim();
  if (!trimmed) return '/dashboard';

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      trimmed = `${parsed.pathname}${parsed.search}`;
    } catch {
      return '/dashboard';
    }
  }

  if (trimmed.startsWith('/dashboard/messenger')) return trimmed;
  if (trimmed.startsWith('/dashboard/chat')) return trimmed;
  if (trimmed.startsWith('/dashboard/board')) return trimmed;
  if (trimmed.startsWith('/dashboard/docs')) return trimmed;
  if (trimmed.startsWith('/dashboard/appointment')) return trimmed;
  if (trimmed.startsWith('/dashboard/exam')) return trimmed;
  if (trimmed.startsWith('/dashboard/profile')) return trimmed;
  if (trimmed.startsWith('/dashboard/settings')) return trimmed;
  if (trimmed.startsWith('/dashboard')) return '/dashboard';

  if (trimmed.startsWith('/chat')) return `/dashboard${trimmed}`;
  if (trimmed === '/admin-messenger') return '/dashboard/messenger?channel=garam';
  if (trimmed === '/request-board-messenger') return '/dashboard/messenger?channel=request-board';
  if (trimmed.startsWith('/board')) return `/dashboard${trimmed}`;
  if (trimmed.startsWith('/docs-upload')) return '/dashboard/docs';
  if (trimmed.startsWith('/appointment')) return '/dashboard/appointment';
  if (trimmed.startsWith('/exam/apply')) return '/dashboard/exam/schedule';
  if (trimmed.startsWith('/consent')) return '/dashboard/profile';
  if (trimmed.startsWith('/notice-detail')) {
    const match = trimmed.match(/[?&]id=([^&]+)/i);
    const noticeId = match?.[1] ? decodeURIComponent(match[1]) : '';
    return noticeId ? `/dashboard/notifications/${encodeURIComponent(noticeId)}` : '/dashboard/board';
  }
  if (trimmed === '/notice' || trimmed.startsWith('/dashboard/notifications')) return '/dashboard/board';

  return '/dashboard';
};

const resolveRoute = (item: HeaderNotificationItem): string => {
  if (item.source === 'notice') {
    const boardPostId = extractBoardPostId(item.rawId);
    if (boardPostId) {
      return `/dashboard/board?postId=${encodeURIComponent(boardPostId)}`;
    }
    return `/dashboard/notifications/${encodeURIComponent(item.rawId)}`;
  }

  const category = (item.category ?? '').trim().toLowerCase();
  if (item.origin === 'request_board') {
    if (category === 'request_board_message') {
      return '/dashboard/messenger?channel=request-board';
    }
    return '/dashboard/messenger?channel=request-board';
  }

  if (item.targetUrl) {
    return normalizeTargetUrlForWeb(item.targetUrl);
  }

  const text = `${item.title} ${item.body} ${category}`.toLowerCase();
  if (text.includes('메시지') || text.includes('message')) return '/dashboard/messenger?channel=garam';
  if (text.includes('서류') || text.includes('docs')) return '/dashboard/docs';
  if (text.includes('시험')) return '/dashboard/exam/schedule';
  if (text.includes('위촉')) return '/dashboard/appointment';
  if (text.includes('게시판') || text.includes('board')) return '/dashboard/board';

  return '/dashboard';
};

const formatCreatedAt = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
};

const compareByCreatedAtDesc = (a: HeaderNotificationItem, b: HeaderNotificationItem) => {
  const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return bTime - aTime;
};

export function DashboardNotificationBell({ role, residentId, staffType = null }: DashboardNotificationBellProps) {
  const router = useRouter();
  const [opened, setOpened] = useState(false);

  const storageKey = useMemo(() => {
    const identity = sanitize(residentId) || role;
    return `${STORAGE_KEY_PREFIX}:${role}:${identity}`;
  }, [residentId, role]);

  const [seenIdList, setSeenIdList] = useLocalStorage<string[]>({
    key: storageKey,
    defaultValue: [],
  });

  const seenIds = useMemo(
    () => new Set(seenIdList.filter((id): id is string => typeof id === 'string' && id.length > 0)),
    [seenIdList],
  );

  const { data: items = [], isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['dashboard-header-notifications', role, residentId, staffType],
    refetchInterval: 30_000,
    queryFn: async (): Promise<HeaderNotificationItem[]> => {
      const fetchInbox = async (inboxRole: 'admin' | 'fc') => {
        const inboxResidentId = inboxRole === 'fc' ? sanitize(residentId) : null;
        const response = await fetch('/api/fc-notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'inbox_list',
            role: inboxRole,
            resident_id: inboxResidentId,
            limit: LIST_LIMIT,
          }),
        });

        const payload = (await response.json()) as InboxProxyResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? payload.data?.message ?? '알림을 불러오지 못했습니다.');
        }

        const inbox = payload.data;
        if (!inbox?.ok) {
          throw new Error(inbox?.message ?? '알림을 불러오지 못했습니다.');
        }

        return inbox;
      };

      const isDeveloper = isDeveloperSession({ role, staffType });
      const [primaryInbox, developerFcInbox] = await Promise.all([
        fetchInbox(role === 'fc' ? 'fc' : 'admin'),
        isDeveloper ? fetchInbox('fc') : Promise.resolve(null),
      ]);

      const mappedNotifications: HeaderNotificationItem[] = [
        ...(primaryInbox.notifications ?? []),
        ...((developerFcInbox?.notifications ?? []).filter((item) => isRequestBoardCategory(item.category))),
      ].map((item) => ({
        id: `notification:${item.id}`,
        rawId: item.id,
        title: item.title,
        body: item.body,
        category: item.category ?? '알림',
        targetUrl: item.target_url ?? null,
        createdAt: item.created_at ?? null,
        source: 'notification',
        origin: isRequestBoardCategory(item.category) ? 'request_board' : 'fc_onboarding',
      }));

      const mappedNotices: HeaderNotificationItem[] = (primaryInbox.notices ?? []).map((item) => ({
        id: `notice:${item.id}`,
        rawId: item.id,
        title: item.title,
        body: item.body,
        category: item.category ?? '공지',
        targetUrl: null,
        createdAt: item.created_at ?? null,
        source: 'notice',
        origin: 'notice',
      }));

      const deduped = new Map<string, HeaderNotificationItem>();
      [...mappedNotifications, ...mappedNotices].forEach((item) => {
        if (!deduped.has(item.id)) {
          deduped.set(item.id, item);
        }
      });
      return Array.from(deduped.values()).sort(compareByCreatedAtDesc);
    },
  });

  const markSeen = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setSeenIdList((prev) => {
      const next = new Set(Array.isArray(prev) ? prev : []);
      ids.forEach((id) => {
        if (!next.has(id)) {
          next.add(id);
        }
      });
      return Array.from(next).slice(-500);
    });
  }, [setSeenIdList]);

  const unreadCount = useMemo(
    () => items.reduce((acc, item) => (seenIds.has(item.id) ? acc : acc + 1), 0),
    [items, seenIds],
  );

  const handleOpenItem = (item: HeaderNotificationItem) => {
    markSeen([item.id]);
    setOpened(false);
    router.push(resolveRoute(item));
  };

  const markAllAsSeen = () => {
    markSeen(items.map((item) => item.id));
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
                onClick={() => {
                  void refetch();
                }}
                aria-label="알림 목록 새로고침"
              >
                {isRefetching ? <Loader size={14} /> : <IconRefresh size={14} stroke={1.8} />}
              </ActionIcon>
              <Button
                variant="subtle"
                size="compact-xs"
                color="gray"
                onClick={markAllAsSeen}
                disabled={unreadCount === 0}
              >
                모두 확인
              </Button>
            </Group>
          </Group>
        </Box>
        <Divider />

        {isLoading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" color="orange" />
          </Group>
        ) : items.length === 0 ? (
          <Box px="md" py="xl">
            <Text size="sm" c="dimmed" ta="center">
              새로운 알림이 없습니다.
            </Text>
          </Box>
        ) : (
          <ScrollArea.Autosize mah={420}>
            <Stack gap={0}>
              {items.map((item) => {
                const unread = !seenIds.has(item.id);
                return (
                  <Box key={item.id}>
                    <UnstyledButton
                      onClick={() => handleOpenItem(item)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        backgroundColor: unread ? '#FFF7ED' : 'transparent',
                      }}
                    >
                      <Group align="flex-start" wrap="nowrap" gap={10}>
                        <Box mt={4} w={10}>
                          {unread ? (
                            <IconCircleFilled size={8} style={{ color: '#f36f21' }} />
                          ) : (
                            <Box w={8} h={8} />
                          )}
                        </Box>

                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Group justify="space-between" align="center" mb={4} wrap="nowrap">
                            <Group gap={6} wrap="nowrap">
                              <Badge
                                size="xs"
                                variant="light"
                                color={item.origin === 'request_board' ? 'blue' : item.source === 'notice' ? 'orange' : 'gray'}
                              >
                                {getOriginLabel(item)}
                              </Badge>
                              <Text size="xs" c="dimmed" lineClamp={1}>
                                {getCategoryLabel(item)}
                              </Text>
                            </Group>
                            <Text size="xs" c="dimmed">
                              {formatCreatedAt(item.createdAt)}
                            </Text>
                          </Group>

                          <Text size="sm" fw={unread ? 700 : 500} lineClamp={1}>
                            {item.title}
                          </Text>
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {item.body}
                          </Text>
                        </Box>

                        <IconChevronRight size={14} stroke={1.7} style={{ color: '#9CA3AF', marginTop: 6 }} />
                      </Group>
                    </UnstyledButton>
                    <Divider />
                  </Box>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        )}

        <Box px="md" py="xs">
          <Group justify="space-between" wrap="nowrap">
            <Button
              variant="subtle"
              size="compact-sm"
              color="gray"
              onClick={() => {
                setOpened(false);
                router.push('/dashboard/notifications');
              }}
            >
              공지 관리
            </Button>
            <Button
              variant="subtle"
              size="compact-sm"
              color="gray"
              onClick={() => {
                setOpened(false);
                router.push('/dashboard/board');
              }}
            >
              게시판
            </Button>
          </Group>
        </Box>
      </Menu.Dropdown>
    </Menu>
  );
}
