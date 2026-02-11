'use client';

import {
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft, IconPaperclip } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useParams, useRouter } from 'next/navigation';

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
  images?: string[] | null;
  files?: NoticeFile[] | null;
};

type NoticeResponse = {
  ok?: boolean;
  notice?: NoticeItem;
  error?: string;
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
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? '').trim();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['notice-detail', id],
    queryFn: () => fetchNotice(id),
    enabled: Boolean(id),
  });

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
                        <img
                          src={url}
                          alt={`notice-image-${idx + 1}`}
                          style={{
                            width: '100%',
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
    </Container>
  );
}

