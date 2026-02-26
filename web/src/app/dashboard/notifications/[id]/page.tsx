'use client';

import {
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Image,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconEdit, IconPaperclip, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useSession } from '@/hooks/use-session';

const BOARD_NOTICE_ID_PREFIX = 'board_notice:';

type NoticeFile = {
  name?: string;
  url?: string;
  type?: string;
};

type NoticeItem = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  images?: string[] | null;
  files?: NoticeFile[] | null;
};

type NoticeResponse = {
  ok?: boolean;
  notice?: NoticeItem;
  error?: string;
};

const extractBoardPostId = (noticeId: string): string | null => {
  if (!noticeId.startsWith(BOARD_NOTICE_ID_PREFIX)) return null;
  const postId = noticeId.slice(BOARD_NOTICE_ID_PREFIX.length).trim();
  return postId.length > 0 ? postId : null;
};

async function fetchNotice(id: string): Promise<NoticeItem> {
  const res = await fetch(`/api/admin/notices?id=${encodeURIComponent(id)}`, {
    method: 'GET',
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as NoticeResponse;

  if (!res.ok || !data?.ok || !data.notice) {
    throw new Error(data?.error ?? '공지 상세를 불러오지 못했습니다.');
  }

  return data.notice;
}

export default function NotificationDetailPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? '').trim();
  const boardPostId = extractBoardPostId(id);

  const { role, residentId } = useSession();
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  useEffect(() => {
    if (!boardPostId) return;
    router.replace(`/dashboard/board?postId=${encodeURIComponent(boardPostId)}`);
  }, [boardPostId, router]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['notice-detail', id],
    queryFn: () => fetchNotice(id),
    enabled: Boolean(id) && !boardPostId,
  });

  const canManage =
    role === 'admin' ||
    (role === 'manager' && !!data?.created_by && data.created_by === residentId);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/notices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? '삭제에 실패했습니다.');
    },
    onSuccess: () => {
      notifications.show({ title: '삭제 완료', message: '공지사항이 삭제되었습니다.', color: 'gray' });
      queryClient.invalidateQueries({ queryKey: ['notices'] });
      router.push('/dashboard/notifications');
    },
    onError: (err: Error) => {
      notifications.show({ title: '삭제 실패', message: err.message, color: 'red' });
    },
  });

  if (boardPostId) {
    return (
      <Container size="md" py="xl">
        <Group justify="center" py="xl">
          <Loader color="orange" />
        </Group>
      </Container>
    );
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => router.push('/dashboard/notifications')}
          >
            목록으로
          </Button>

          {canManage ? (
            <Group gap="xs">
              <Button
                variant="light"
                color="blue"
                leftSection={<IconEdit size={16} />}
                onClick={() => router.push(`/dashboard/notifications/${id}/edit`)}
              >
                수정
              </Button>
              <Button
                variant="light"
                color="red"
                leftSection={<IconTrash size={16} />}
                loading={deleteMutation.isPending}
                onClick={openConfirm}
              >
                삭제
              </Button>
            </Group>
          ) : null}
        </Group>

        <Paper withBorder radius="md" p="lg">
          {isLoading ? (
            <Group justify="center" py="xl">
              <Loader color="orange" />
            </Group>
          ) : null}

          {!isLoading && isError ? (
            <Stack gap="xs">
              <Text c="red" fw={600}>
                공지를 불러오지 못했습니다.
              </Text>
              <Text c="dimmed" size="sm">
                {(error as Error)?.message ?? '다시 시도해주세요.'}
              </Text>
            </Stack>
          ) : null}

          {!isLoading && !isError && data ? (
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Badge variant="light" color="blue" radius="sm">
                  {data.category || '공지'}
                </Badge>
                <Text size="sm" c="dimmed">
                  {data.created_at ? dayjs(data.created_at).format('YYYY-MM-DD HH:mm') : '-'}
                </Text>
              </Group>

              <Title order={3}>{data.title}</Title>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                {data.body}
              </Text>

              {Array.isArray(data.images) && data.images.length > 0 ? (
                <Stack gap="xs">
                  <Text fw={600} size="sm">
                    이미지
                  </Text>
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    {data.images.map((url, idx) => (
                      <Anchor key={`${url}-${idx}`} href={url} target="_blank" rel="noreferrer">
                        <Image
                          src={url}
                          alt={`notice-image-${idx + 1}`}
                          style={{
                            width: '100%',
                            height: 'auto',
                            borderRadius: 12,
                            border: '1px solid #e5e7eb',
                            display: 'block',
                          }}
                        />
                      </Anchor>
                    ))}
                  </SimpleGrid>
                </Stack>
              ) : null}

              {Array.isArray(data.files) && data.files.length > 0 ? (
                <Stack gap="xs">
                  <Text fw={600} size="sm">
                    첨부파일
                  </Text>
                  {data.files.map((file, idx) => (
                    <Anchor
                      key={`${file.url ?? 'file'}-${idx}`}
                      href={file.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Group gap={8}>
                        <IconPaperclip size={14} />
                        <Text size="sm">{file.name ?? `첨부파일 ${idx + 1}`}</Text>
                      </Group>
                    </Anchor>
                  ))}
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </Paper>
      </Stack>

      {/* 삭제 확인 모달 */}
      <Modal
        opened={confirmOpened}
        onClose={closeConfirm}
        title={<Text fw={700}>공지사항 삭제</Text>}
        size="sm"
        centered
      >
        <Stack gap="md">
          <Text size="sm">정말 삭제하시겠습니까? (앱 알림 이력은 유지될 수 있습니다)</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeConfirm}>
              취소
            </Button>
            <Button color="red" loading={deleteMutation.isPending} onClick={() => { closeConfirm(); deleteMutation.mutate(); }}>
              삭제
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
