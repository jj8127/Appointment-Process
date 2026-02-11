'use client';

import {
    ActionIcon,
    Badge,
    Button,
    Container,
    Group,
    LoadingOverlay,
    Modal,
    Paper,
    ScrollArea,
    Stack,
    Table,
    Text,
    TextInput,
    Title
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useSession } from '@/hooks/use-session';

type NoticeItem = {
    id: string;
    title?: string;
    body?: string;
    category?: string;
    created_at?: string;
    is_push_sent?: boolean;
    image_url?: string;
    attachment_url?: string;
};

type NoticesResponse = {
    ok?: boolean;
    notices?: NoticeItem[];
    error?: string;
};

async function fetchNotices(): Promise<NoticeItem[]> {
    const res = await fetch('/api/admin/notices', {
        method: 'GET',
        credentials: 'include',
    });
    const data = (await res.json().catch(() => ({}))) as NoticesResponse;

    if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? '공지 목록을 불러오지 못했습니다.');
    }

    return data.notices ?? [];
}

export default function NotificationsPage() {
    const queryClient = useQueryClient();
    const router = useRouter();
    const { hydrated, role, isReadOnly } = useSession();
    const [keyword, setKeyword] = useState('');

    // 확인 모달 상태
    const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
    const [confirmConfig, setConfirmConfig] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
    } | null>(null);

    const showConfirm = (config: { title: string; message: string; onConfirm: () => void }) => {
        setConfirmConfig(config);
        openConfirm();
    };

    const handleConfirm = () => {
        if (confirmConfig?.onConfirm) {
            confirmConfig.onConfirm();
        }
        closeConfirm();
    };

    // Fetch Notices
    const { data: noticesData, isLoading } = useQuery({
        queryKey: ['notices', role],
        queryFn: fetchNotices,
        enabled: hydrated && (role === 'admin' || role === 'manager'),
    });

    // Delete Mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch('/api/admin/notices', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ id }),
            });
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
            if (!res.ok || !data?.ok) {
                throw new Error(data?.error ?? '삭제에 실패했습니다.');
            }
        },
        onSuccess: () => {
            notifications.show({
                title: '삭제 완료',
                message: '공지사항이 삭제되었습니다.',
                color: 'gray',
            });
            queryClient.invalidateQueries({ queryKey: ['notices'] });
        },
        onError: (err: Error) => {
            notifications.show({
                title: '삭제 실패',
                message: err.message,
                color: 'red',
            });
        },
    });

    const handleDelete = (id: string) => {
        showConfirm({
            title: '공지사항 삭제',
            message: '정말 삭제하시겠습니까? (앱 알림 이력은 유지될 수 있습니다)',
            onConfirm: () => {
                deleteMutation.mutate(id);
            },
        });
    };

    const filteredNotices = (noticesData || []).filter((notice: NoticeItem) => {
        if (!keyword.trim()) return true;
        const q = keyword.toLowerCase();
        return (
            notice.title?.toLowerCase().includes(q) ||
            notice.body?.toLowerCase().includes(q) ||
            notice.category?.toLowerCase().includes(q)
        );
    });

    const rows = filteredNotices.map((notice: NoticeItem) => (
            <Table.Tr
                key={notice.id}
                style={{ cursor: 'pointer' }}
                onClick={() => router.push(`/dashboard/notifications/${notice.id}`)}
            >
            <Table.Td style={{ width: 120 }}>
                <Text size="sm" c="dimmed">
                    {dayjs(notice.created_at).format('YYYY-MM-DD')}
                </Text>
            </Table.Td>
            <Table.Td style={{ width: 100 }}>
                <Badge variant="light" color="blue" radius="sm">
                    {notice.category}
                </Badge>
            </Table.Td>
            <Table.Td>
                <Text size="sm" fw={600}>
                    {notice.title}
                </Text>
            </Table.Td>
            <Table.Td style={{ maxWidth: 300 }}>
                <Text size="sm" truncate>
                    {notice.body}
                </Text>
            </Table.Td>
            <Table.Td style={{ width: 60 }} align="right">
                {!isReadOnly && role === 'admin' ? (
                    <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(notice.id);
                        }}
                        loading={deleteMutation.isPending && deleteMutation.variables === notice.id}
                    >
                        <IconTrash size={16} />
                    </ActionIcon>
                ) : null}
            </Table.Td>
        </Table.Tr>
    ));

    return (
        <Container size="xl" py="xl">
            <Group justify="space-between" mb="xl" align="flex-end">
                <div>
                    <Title order={2} mb={4}>
                        공지사항 관리
                    </Title>
                    <Text c="dimmed" size="sm">
                        앱 사용자에게 전송된 공지 이력을 관리합니다.
                    </Text>
                </div>

                <Group>
                    {!isReadOnly && role === 'admin' ? (
                        <Button
                            component={Link}
                            href="/dashboard/notifications/create"
                            leftSection={<IconPlus size={16} />}
                            color="orange"
                        >
                            새 공지 등록
                        </Button>
                    ) : null}
                </Group>
            </Group>

            <Paper shadow="sm" radius="md" withBorder p="md" mb="md">
                <Group justify="space-between">
                    <TextInput
                        placeholder="검색어 입력..."
                        leftSection={<IconSearch size={16} />}
                        value={keyword}
                        onChange={(e) => setKeyword(e.currentTarget.value)}
                        style={{ width: 300 }}
                    />
                    <Button
                        variant="light"
                        color="gray"
                        leftSection={<IconRefresh size={16} />}
                        onClick={() => queryClient.invalidateQueries({ queryKey: ['notices'] })}
                    >
                        새로고침
                    </Button>
                </Group>
            </Paper>

            <Paper shadow="sm" radius="md" withBorder pos="relative">
                <LoadingOverlay visible={isLoading} overlayProps={{ blur: 2 }} />
                <ScrollArea>
                    <Table verticalSpacing="sm" highlightOnHover>
                        <Table.Thead bg="gray.0">
                            <Table.Tr>
                                <Table.Th>작성일</Table.Th>
                                <Table.Th>분류</Table.Th>
                                <Table.Th>제목</Table.Th>
                                <Table.Th>내용</Table.Th>
                                <Table.Th style={{ textAlign: 'right' }}>관리</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.length > 0 ? (
                                rows
                            ) : (
                                <Table.Tr>
                                    <Table.Td colSpan={5} align="center" py={40}>
                                        <Text c="dimmed">등록된 공지사항이 없습니다.</Text>
                                    </Table.Td>
                                </Table.Tr>
                            )}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </Paper>

            {/* 확인 모달 */}
            <Modal
                opened={confirmOpened}
                onClose={closeConfirm}
                title={<Text fw={700}>{confirmConfig?.title}</Text>}
                size="sm"
                centered
            >
                <Stack gap="md">
                    <Text size="sm">{confirmConfig?.message}</Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={closeConfirm}>
                            취소
                        </Button>
                        <Button color="red" onClick={handleConfirm}>
                            삭제
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Container>
    );
}
