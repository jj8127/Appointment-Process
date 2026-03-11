'use client';

import { useSession } from '@/hooks/use-session';
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
import { IconArrowRight, IconExternalLink, IconFileText, IconMessageCircle2, IconUsers } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo } from 'react';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
type InboxNotification = {
  category?: string | null;
};

const sanitize = (value: string | null | undefined) => String(value ?? '').replace(/[^0-9]/g, '');

export default function MessengerHubPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { role, residentId, hydrated, isReadOnly, staffType } = useSession();

  const requestBoardBaseUrl = useMemo(
    () => (process.env.NEXT_PUBLIC_REQUEST_BOARD_URL || 'https://requestboard-steel.vercel.app').replace(/\/$/, ''),
    [],
  );

  const requestBoardMessengerUrl = `${requestBoardBaseUrl}/m/chat`;

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
      window.location.href = requestBoardMessengerUrl;
    }
  }, [hydrated, requestBoardMessengerUrl, role, router, searchParams]);

  const { data: counts, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-messenger-hub-counts', role, residentId],
    enabled: hydrated && Boolean(role),
    queryFn: async () => {
      const myChatId =
        role === 'admin' || role === 'manager'
          ? getWebStaffChatActorId({ role, residentId, staffType })
          : sanitize(residentId);

      const { count: internalUnreadCount, error: internalUnreadErr } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', myChatId)
        .eq('is_read', false);

      if (internalUnreadErr) throw internalUnreadErr;

      const requestBoardRole: 'admin' | 'fc' =
        role === 'manager' || isDeveloperSession({ role, isReadOnly, staffType }) ? 'fc' : 'admin';
      const requestBoardResidentId = requestBoardRole === 'fc' ? sanitize(residentId) : null;

      const { data, error } = await supabase.functions.invoke('fc-notify', {
        body: {
          type: 'inbox_list',
          role: requestBoardRole,
          resident_id: requestBoardResidentId,
          limit: 150,
        },
      });

      if (error || !data?.ok) {
        return {
          internalUnread: internalUnreadCount ?? 0,
          requestBoardUnread: 0,
        };
      }

      const notifications: InboxNotification[] = Array.isArray(data.notifications)
        ? (data.notifications as InboxNotification[])
        : [];
      const requestBoardUnread = notifications.filter((item) =>
        (item.category ?? '').trim().toLowerCase() === 'request_board_message',
      ).length;

      return {
        internalUnread: internalUnreadCount ?? 0,
        requestBoardUnread,
      };
    },
  });

  if (!hydrated) {
    return null;
  }

  if (!role) {
    return null;
  }

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
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
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
                {(counts?.requestBoardUnread ?? 0) > 0 && (
                  <Badge color="blue" size="sm" variant="filled">
                    미확인 {counts?.requestBoardUnread}
                  </Badge>
                )}
              </Group>

              <Text size="sm" c="dimmed">
                설계요청 서비스의 메신저 화면으로 이동합니다.
              </Text>

              <Button
                color="blue"
                variant="light"
                leftSection={<IconExternalLink size={16} />}
                rightSection={<IconArrowRight size={14} />}
                onClick={() => {
                  window.open(requestBoardMessengerUrl, '_blank', 'noopener,noreferrer');
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
