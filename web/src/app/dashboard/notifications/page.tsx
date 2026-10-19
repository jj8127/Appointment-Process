'use client';

import { showAdminNotificationWarning } from '@/lib/show-admin-notification-warning';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';

import {
    ActionIcon,
    Anchor,
    Button,
    Group,
    Image,
    LoadingOverlay,
    Modal,
    ScrollArea,
    SimpleGrid,
    Stack,
    Table,
    Text,
    TextInput,
    Title
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconEdit, IconExternalLink, IconPaperclip, IconPlus, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties } from 'react';

import { useSession } from '@/hooks/use-session';
import { deleteAdminNotice, fetchAdminNotices, type AdminNoticeItem } from '@/lib/admin-notice-client';
import styles from './page.module.css';
import surface from '../surface.module.css';

const BOARD_NOTICE_ID_PREFIX = 'board_notice:';

const extractBoardPostId = (noticeId: string): string | null => {
    if (!noticeId.startsWith(BOARD_NOTICE_ID_PREFIX)) return null;
    const postId = noticeId.slice(BOARD_NOTICE_ID_PREFIX.length).trim();
    return postId.length > 0 ? postId : null;
};

const resolveNoticePath = (noticeId: string): string => {
    const postId = extractBoardPostId(noticeId);
    if (postId) {
        return `/dashboard/board?postId=${encodeURIComponent(postId)}`;
    }
    return `/dashboard/notifications/${noticeId}`;
};

export default function NotificationsPage() {
    const queryClient = useQueryClient();
    const router = useRouter();
    const { hydrated, role, residentId } = useSession();
    const [keyword, setKeyword] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);

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

    // 공지 작성/수정/삭제 가능 여부
    // 공지 등록은 관리자만, 본부장(manager)은 본인글 수정-삭제만 허용
    const canCreate = role === 'admin';
    const canManageNotice = (notice: AdminNoticeItem) => {
        if (role === 'admin') return true;
        // 본부장은 본인 게시글만 수정/삭제 가능
        if (role === 'manager') return notice.created_by === residentId;
        return false;
    };

    // Fetch Notices
    const { data: noticesData, isLoading, isError, error, refetch, isFetching } = useQuery({
        queryKey: ['notices', role],
        queryFn: fetchAdminNotices,
        enabled: hydrated && (role === 'admin' || role === 'manager'),
    });

    // Delete Mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const data = await deleteAdminNotice(id);
            showAdminNotificationWarning(data);
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

    const filteredNotices = (noticesData || []).filter((notice: AdminNoticeItem) => {
        if (!keyword.trim()) return true;
        const q = keyword.toLowerCase();
        return (
            notice.title?.toLowerCase().includes(q) ||
            notice.body?.toLowerCase().includes(q) ||
            notice.category?.toLowerCase().includes(q)
        );
    });

    // The detail pane shows the clicked notice, or the first one in the current list.
    const selected = filteredNotices.find((notice) => notice.id === selectedId) ?? filteredNotices[0] ?? null;
    const editPathOf = (notice: AdminNoticeItem) => {
        const postId = extractBoardPostId(notice.id);
        return postId ? `/dashboard/board?postId=${encodeURIComponent(postId)}` : `/dashboard/notifications/${notice.id}/edit`;
    };

    const rows = filteredNotices.map((notice: AdminNoticeItem) => {
        const canManage = canManageNotice(notice);
        const editPath = editPathOf(notice);

        return (
            <Table.Tr
                key={notice.id}
                className={styles.row}
                data-selected={notice.id === selected?.id || undefined}
                onClick={() => setSelectedId(notice.id)}
            >
                <Table.Td style={{ width: 110 }}>
                    <Text size="sm" c="dimmed">
                        {dayjs(notice.created_at).format('YYYY-MM-DD')}
                    </Text>
                </Table.Td>
                <Table.Td style={{ width: 96 }}>
                    <span className={styles.pill}>
                        {notice.category}
                    </span>
                </Table.Td>
                <Table.Td>
                    <Text size="sm" fw={600}>
                        {notice.title}
                    </Text>
                </Table.Td>
                <Table.Td style={{ maxWidth: 220 }}>
                    <Text size="sm" truncate c="dimmed">
                        {notice.body}
                    </Text>
                </Table.Td>
                <Table.Td style={{ width: 80 }} align="right">
                    {canManage ? (
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                            <ActionIcon aria-label="공지 수정"
                                variant="subtle"
                                color="dark"
                                radius="xl"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(editPath);
                                }}
                            >
                                <IconEdit size={16} />
                            </ActionIcon>
                            <ActionIcon aria-label="공지 삭제"
                                variant="subtle"
                                color="red"
                                radius="xl"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(notice.id);
                                }}
                                loading={deleteMutation.isPending && deleteMutation.variables === notice.id}
                            >
                                <IconTrash size={16} />
                            </ActionIcon>
                        </Group>
                    ) : null}
                </Table.Td>
            </Table.Tr>
        );
    });

    return (
        <div className={styles.page}>
            <div className={styles.head} style={{ '--i': 0 } as CSSProperties}>
                <div>
                    <Title order={2} className={styles.title} mb={4}>
                        공지사항 관리
                    </Title>
                    <Text c="dimmed" size="sm">
                        앱 사용자에게 전송된 공지 이력을 관리합니다.
                    </Text>
                    {noticesData ? (
                        <div className={surface.headMeta}>
                            <span className={surface.metaChip}><i />전체 <b>{noticesData.length}</b></span>
                            <span className={surface.metaChip} data-tone="ok">
                                <i />이번 달 <b>{noticesData.filter((notice) => dayjs(notice.created_at).isSame(dayjs(), 'month')).length}</b>
                            </span>
                        </div>
                    ) : null}
                </div>

                <Group gap="xs">
                    <TextInput
                        placeholder="검색어 입력..."
                        leftSection={<IconSearch size={16} />}
                        value={keyword}
                        onChange={(e) => setKeyword(e.currentTarget.value)}
                        radius="xl"
                        w={260}
                        classNames={{ input: styles.searchInput }}
                    />
                    <button
                        type="button"
                        className={styles.softButton}
                        onClick={() => queryClient.invalidateQueries({ queryKey: ['notices'] })}
                    >
                        <IconRefresh size={16} stroke={1.8} /> 새로고침
                    </button>
                    {canCreate ? (
                        <Button
                            component={Link}
                            href="/dashboard/notifications/create"
                            leftSection={<IconPlus size={16} />}
                            color="dark"
                            radius="xl"
                            h={44}
                        >
                            새 공지 등록
                        </Button>
                    ) : null}
                </Group>
            </div>

            {isError && <QueryErrorAlert error={error} onRetry={refetch} isFetching={isFetching} hasData={!!noticesData} subject="공지 목록" />}

            <div className={styles.split}>
                <section className={styles.card} style={{ '--i': 1 } as CSSProperties} aria-label="공지 목록">
                    <LoadingOverlay visible={isLoading} overlayProps={{ blur: 2 }} />
                    <ScrollArea>
                        <Table verticalSpacing="sm" className={styles.table}>
                            <Table.Thead>
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
                                            <Text c="dimmed">{isLoading ? '공지 목록을 불러오는 중입니다.' : isError ? '공지 목록을 확인할 수 없습니다.' : '등록된 공지사항이 없습니다.'}</Text>
                                        </Table.Td>
                                    </Table.Tr>
                                )}
                            </Table.Tbody>
                        </Table>
                    </ScrollArea>
                </section>

                {/* Detail of the selected notice, beside the list */}
                <section key={selected?.id ?? 'empty'} className={`${styles.card} ${styles.detail}`} style={{ '--i': 2 } as CSSProperties} aria-label="공지 상세">
                    {selected ? (
                        <Stack gap="md">
                            <Group justify="space-between" align="center">
                                <span className={styles.pill}>{selected.category || '공지'}</span>
                                <Text size="sm" c="dimmed">
                                    {selected.created_at ? dayjs(selected.created_at).format('YYYY-MM-DD HH:mm') : '-'}
                                </Text>
                            </Group>
                            <Title order={3} className={styles.detailTitle}>{selected.title}</Title>
                            <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                                {selected.body}
                            </Text>

                            {Array.isArray(selected.images) && selected.images.length > 0 ? (
                                <Stack gap="xs">
                                    <Text fw={600} size="sm">이미지</Text>
                                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                        {selected.images.map((url, idx) => (
                                            <Anchor key={`${url}-${idx}`} href={url} target="_blank" rel="noreferrer">
                                                <Image src={url} alt={`notice-image-${idx + 1}`} className={styles.image} />
                                            </Anchor>
                                        ))}
                                    </SimpleGrid>
                                </Stack>
                            ) : null}

                            {Array.isArray(selected.files) && selected.files.length > 0 ? (
                                <Stack gap="xs">
                                    <Text fw={600} size="sm">첨부파일</Text>
                                    {selected.files.map((file, idx) => (
                                        <Anchor key={`${file.url ?? 'file'}-${idx}`} href={file.url ?? '#'} target="_blank" rel="noreferrer" className={styles.file}>
                                            <IconPaperclip size={14} />
                                            <span>{file.name ?? `첨부파일 ${idx + 1}`}</span>
                                        </Anchor>
                                    ))}
                                </Stack>
                            ) : null}

                            <Group justify="space-between" mt="xs">
                                <Anchor component={Link} href={resolveNoticePath(selected.id)} size="sm" c="dimmed" className={styles.openFull}>
                                    <IconExternalLink size={14} /> {extractBoardPostId(selected.id) ? '게시판에서 보기' : '상세 화면으로 열기'}
                                </Anchor>
                                {canManageNotice(selected) ? (
                                    <Group gap="xs">
                                        <Button component={Link} href={editPathOf(selected)} variant="light" color="gray" c="dark" radius="xl" size="xs" leftSection={<IconEdit size={14} />}>
                                            수정
                                        </Button>
                                        <Button
                                            variant="light"
                                            color="red"
                                            radius="xl"
                                            size="xs"
                                            leftSection={<IconTrash size={14} />}
                                            loading={deleteMutation.isPending && deleteMutation.variables === selected.id}
                                            onClick={() => handleDelete(selected.id)}
                                        >
                                            삭제
                                        </Button>
                                    </Group>
                                ) : null}
                            </Group>
                        </Stack>
                    ) : (
                        <Text c="dimmed" size="sm" ta="center" py={40}>
                            {isLoading ? '공지 목록을 불러오는 중입니다.' : '선택한 공지가 없습니다.'}
                        </Text>
                    )}
                </section>
            </div>

            {/* 확인 모달 */}
            <Modal
                opened={confirmOpened}
                onClose={closeConfirm}
                title={<Text fw={700}>{confirmConfig?.title}</Text>}
                size="sm"
                radius="lg"
                centered
            >
                <Stack gap="md">
                    <Text size="sm">{confirmConfig?.message}</Text>
                    <Group justify="flex-end">
                        <Button variant="default" radius="xl" onClick={closeConfirm}>
                            취소
                        </Button>
                        <Button color="red" radius="xl" onClick={handleConfirm}>
                            삭제
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </div>
    );
}
