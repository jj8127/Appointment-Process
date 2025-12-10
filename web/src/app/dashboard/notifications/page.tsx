'use client';

import {
    ActionIcon,
    Badge,
    Button,
    Container,
    Group,
    LoadingOverlay,
    Paper,
    Table,
    Text,
    TextInput,
    Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useState } from 'react';

import { supabase } from '@/lib/supabase';

export default function NotificationsPage() {
    const queryClient = useQueryClient();
    const [keyword, setKeyword] = useState('');

    // Fetch Notices
    const { data: noticesData, isLoading } = useQuery({
        queryKey: ['notices'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('notices')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data;
        },
    });

    // Delete Mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('notices').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            notifications.show({
                title: '삭제 완료',
                message: '공지사항이 삭제되었습니다.',
                color: 'gray',
            });
            queryClient.invalidateQueries({ queryKey: ['notices'] });
        },
        onError: (err: any) => {
            notifications.show({
                title: '삭제 실패',
                message: err.message,
                color: 'red',
            });
        },
    });

    const handleDelete = (id: string) => {
        if (confirm('정말 삭제하시겠습니까? (앱 알림 이력은 유지될 수 있습니다)')) {
            deleteMutation.mutate(id);
        }
    };

    const filteredNotices = (noticesData || []).filter((notice: any) => {
        if (!keyword.trim()) return true;
        const q = keyword.toLowerCase();
        return (
            notice.title?.toLowerCase().includes(q) ||
            notice.body?.toLowerCase().includes(q) ||
            notice.category?.toLowerCase().includes(q)
        );
    });

    const rows = filteredNotices.map((notice: any) => (
        <Table.Tr key={notice.id}>
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
                <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => handleDelete(notice.id)}
                    loading={deleteMutation.isPending && deleteMutation.variables === notice.id}
                >
                    <IconTrash size={16} />
                </ActionIcon>
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
                    <Button
                        component={Link}
                        href="/dashboard/notifications/create"
                        leftSection={<IconPlus size={16} />}
                        color="orange"
                    >
                        새 공지 등록
                    </Button>
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

            <Paper shadow="sm" radius="md" withBorder overflow="hidden" pos="relative">
                <LoadingOverlay visible={isLoading} overlayProps={{ blur: 2 }} />
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
            </Paper>
        </Container>
    );
}
