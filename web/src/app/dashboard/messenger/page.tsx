'use client';

import { useSession } from '@/hooks/use-session';
import { resolveRequestBoardMessengerConfig } from '@/lib/request-board-url';
import { getDashboardRoleLabel, getWebStaffChatActorId, isDeveloperSession } from '@/lib/staff-identity';
import { supabase } from '@/lib/supabase';
import {
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { IconArrowRight, IconExternalLink, IconFileText, IconMessageCircle2, IconMessages, IconUsers } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
type InboxNotification = {
  category?: string | null;
};

type FcNotifyProxyEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: string;
};

const sanitize = (value: string | null | undefined) => String(value ?? '').replace(/[^0-9]/g, '');

async function invokeFcNotifyProxy<T>(body: Record<string, unknown>) {
  const response = await fetch('/api/fc-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as FcNotifyProxyEnvelope<T> | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? 'fc-notify proxy request failed');
  }
  return payload.data as T;
}

export default function MessengerHubPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { role, residentId, hydrated, isReadOnly, staffType } = useSession();
  const requestBoardConfig = resolveRequestBoardMessengerConfig({
    requestBoardUrl: process.env.NEXT_PUBLIC_REQUEST_BOARD_URL,
  });

  useEffect(() => {
    if (!hydrated || !role) return;

    const channel = (searchParams.get('channel') ?? '').trim().toLowerCase();
    if (channel === 'garam') {
      const targetId = sanitize(searchParams.get('targetId'));
      const targetName = (searchParams.get('targetName') ?? '').trim();
      const next = new URLSearchParams();
      if (targetId) next.set('targetId', targetId);
      if (targetName) next.set('targetName', targetName);
      router.replace(next.size > 0 ? `/dashboard/chat?${next.toString()}` : '/dashboard/chat');
      return;
    }

    if (channel === 'request-board') {
      if (!requestBoardConfig.available) {
        router.replace('/dashboard/messenger');
        return;
      }

      window.location.href = requestBoardConfig.messengerUrl;
    }
  }, [hydrated, requestBoardConfig, role, router, searchParams]);

  const { data: counts, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-messenger-hub-counts', role, residentId],
    enabled: hydrated && Boolean(role),
    queryFn: async () => {
      const myChatId =
        role === 'admin' || role === 'manager'
          ? getWebStaffChatActorId({ role, residentId, staffType })
          : sanitize(residentId);

      const internalViewerRole: 'admin' | 'fc' = role === 'fc' ? 'fc' : 'admin';
      let internalUnreadCount = 0;

      let internalUnreadData: { ok?: boolean; count?: number } | null = null;
      let internalUnreadError: unknown = null;
      try {
        internalUnreadData = await invokeFcNotifyProxy<{ ok?: boolean; count?: number }>({
          type: 'internal_unread_count',
          viewer_id: myChatId,
          viewer_role: internalViewerRole,
          viewer_staff_type: staffType,
          viewer_read_only: isReadOnly,
          viewer_is_request_board_designer: false,
        });
      } catch (error) {
        internalUnreadError = error;
      }

      if (!internalUnreadError && internalUnreadData?.ok) {
        internalUnreadCount = Number(internalUnreadData.count ?? 0) || 0;
      } else {
        const { count: fallbackCount, error: internalUnreadFallbackErr } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('receiver_id', myChatId)
          .eq('is_read', false);

        if (internalUnreadFallbackErr) throw internalUnreadFallbackErr;
        internalUnreadCount = fallbackCount ?? 0;
      }

      let groupChatUnreadCount = 0;
      if (role !== 'fc') {
        try {
          const groupChatResponse = await fetch('/api/group-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'group_chat_bootstrap', limit: 1 }),
          });
          const groupChatData = await groupChatResponse.json();
          if (groupChatResponse.ok && groupChatData?.ok) {
            groupChatUnreadCount = Number(groupChatData.unread_count ?? 0) || 0;
          }
        } catch {
          groupChatUnreadCount = 0;
        }
      }

      const requestBoardRole: 'admin' | 'fc' =
        role === 'manager' || isDeveloperSession({ role, isReadOnly, staffType }) ? 'fc' : 'admin';
      const requestBoardResidentId = requestBoardRole === 'fc' ? sanitize(residentId) : null;

      let data: { ok?: boolean; notifications?: InboxNotification[] } | null = null;
      let error: unknown = null;
      try {
        data = await invokeFcNotifyProxy<{ ok?: boolean; notifications?: InboxNotification[] }>({
          type: 'inbox_list',
          role: requestBoardRole,
          resident_id: requestBoardResidentId,
          limit: 150,
        });
      } catch (err) {
        error = err;
      }

      if (error || !data?.ok) {
        return {
          internalUnread: internalUnreadCount,
          requestBoardUnread: 0,
          groupChatUnread: groupChatUnreadCount,
        };
      }

      const notifications: InboxNotification[] = Array.isArray(data.notifications)
        ? (data.notifications as InboxNotification[])
        : [];
      const requestBoardUnread = notifications.filter((item) =>
        (item.category ?? '').trim().toLowerCase() === 'request_board_message',
      ).length;

      return {
        internalUnread: internalUnreadCount,
        requestBoardUnread,
        groupChatUnread: groupChatUnreadCount,
      };
    },
  });

  if (!hydrated) {
    return null;
  }

  if (!role) {
    return null;
  }

  const dashboardHost = typeof window === 'undefined' ? '' : window.location.host;
  const requestBoardEnvironmentLabel = dashboardHost.includes('localhost') || dashboardHost.includes('127.0.0.1')
    ? `로컬 개발 환경(${dashboardHost})`
    : '이 관리자 웹 배포 환경';
  const requestBoardDescription = requestBoardConfig.available
    ? '설계요청 서비스의 메신저 화면으로 이동합니다.'
    : requestBoardConfig.reason === 'invalid-public-url'
      ? '설계요청 메신저 주소(NEXT_PUBLIC_REQUEST_BOARD_URL)가 올바른 URL이 아니어서 열 수 없습니다.'
      : `${requestBoardEnvironmentLabel}에 설계요청 메신저 주소(NEXT_PUBLIC_REQUEST_BOARD_URL)가 설정되어 있지 않아 이동할 수 없습니다.`;

  return (
    <Container size="lg" py="xl">
      <Stack gap="xs" mb="lg">
        <Title order={2} c={CHARCOAL}>메신저</Title>
        <Text c={MUTED} size="sm">
          가람지사 내부 대화와 설계요청 대화를 한 화면에서 선택할 수 있습니다.
        </Text>
      </Stack>

      {isLoading ? (
        <Group justify="center" py="xl">
          <Loader color={HANWHA_ORANGE} />
        </Group>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
          <Card withBorder radius="lg" shadow="sm" padding="lg">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon radius="xl" size={42} color="orange" variant="light">
                    <IconUsers size={20} />
                  </ThemeIcon>
                  <div>
                    <Text fw={700}>가람지사 메신저</Text>
                    <Text size="sm" c="dimmed">
                      FC, 본부장, 총무, 개발자 대화
                    </Text>
                  </div>
                </Group>
                {(counts?.internalUnread ?? 0) > 0 && (
                  <Badge color="red" size="sm" variant="filled">
                    미확인 {counts?.internalUnread}
                  </Badge>
                )}
              </Group>

              <Text size="sm" c="dimmed">
                {isReadOnly
                  ? '본부장 계정은 조회 전용으로 채팅을 확인할 수 있습니다.'
                  : staffType === 'developer'
                    ? `${getDashboardRoleLabel({ role, staffType, isReadOnly })} 계정에서 FC와 1:1 대화를 관리합니다.`
                    : '총무 계정에서 FC 전체 대화를 관리합니다.'}
              </Text>

              <Group justify="space-between">
                <Button
                  color="orange"
                  leftSection={<IconMessageCircle2 size={16} />}
                  rightSection={<IconArrowRight size={14} />}
                  onClick={() => router.push('/dashboard/chat')}
                >
                  채팅 열기
                </Button>
                <Button variant="subtle" color="gray" onClick={() => { void refetch(); }}>
                  새로고침
                </Button>
              </Group>
            </Stack>
          </Card>

          <Card withBorder radius="lg" shadow="sm" padding="lg">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon radius="xl" size={42} color="orange" variant="light">
                    <IconMessages size={20} />
                  </ThemeIcon>
                  <div>
                    <Text fw={700}>가람PA 단톡방</Text>
                    <Text size="sm" c="dimmed">
                      관리자, 본부장, FC 공용 채팅
                    </Text>
                  </div>
                </Group>
                {(counts?.groupChatUnread ?? 0) > 0 && (
                  <Badge color="orange" size="sm" variant="filled">
                    미확인 {counts?.groupChatUnread}
                  </Badge>
                )}
              </Group>

              <Text size="sm" c="dimmed">
                공지, 첨부, 답장, 반응과 FC 발언 권한을 한 화면에서 관리합니다.
              </Text>

              <Button
                color="orange"
                variant="light"
                leftSection={<IconMessages size={16} />}
                rightSection={<IconArrowRight size={14} />}
                onClick={() => router.push('/dashboard/group-chat')}
              >
                단톡방 열기
              </Button>
            </Stack>
          </Card>

          <Card withBorder radius="lg" shadow="sm" padding="lg">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon radius="xl" size={42} color="blue" variant="light">
                    <IconFileText size={20} />
                  </ThemeIcon>
                  <div>
                    <Text fw={700}>설계요청 메신저</Text>
                    <Text size="sm" c="dimmed">
                      설계 매니저와 대화
                    </Text>
                  </div>
                </Group>
                {!requestBoardConfig.available ? (
                  <Badge color="gray" size="sm" variant="light">
                    연결 필요
                  </Badge>
                ) : (counts?.requestBoardUnread ?? 0) > 0 && (
                  <Badge color="blue" size="sm" variant="filled">
                    미확인 {counts?.requestBoardUnread}
                  </Badge>
                )}
              </Group>

              <Text size="sm" c="dimmed">
                {requestBoardDescription}
              </Text>

              <Button
                color="blue"
                variant="light"
                leftSection={<IconExternalLink size={16} />}
                rightSection={<IconArrowRight size={14} />}
                disabled={!requestBoardConfig.available}
                onClick={() => {
                  if (!requestBoardConfig.available) return;
                  window.open(requestBoardConfig.messengerUrl, '_blank', 'noopener,noreferrer');
                }}
              >
                설계요청 메신저 열기
              </Button>
            </Stack>
          </Card>
        </SimpleGrid>
      )}
    </Container>
  );
}
