'use client';

import { showAdminNotificationWarning } from '@/lib/show-admin-notification-warning';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';

import {
    Anchor,
    Button,
    Group,
    Image,
    Loader,
    LoadingOverlay,
    Modal,
    ScrollArea,
    SegmentedControl,
    SimpleGrid,
    Stack,
    Text,
    TextInput,
    Title
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconEdit,
    IconExternalLink,
    IconMessageCircle,
    IconNews,
    IconPaperclip,
    IconPhoto,
    IconPinFilled,
    IconPlus,
    IconRefresh,
    IconSearch,
    IconSpeakerphone,
    IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type CSSProperties } from 'react';

import { ConfirmModal } from '@/components/ConfirmModal';
import { useSession } from '@/hooks/use-session';
import { deleteAdminNotice, fetchAdminNotices, type AdminNoticeItem } from '@/lib/admin-notice-client';
import {
    buildBoardActor,
    fetchBoardCategories,
    fetchBoardDetail,
    fetchBoardList,
    formatFileSize,
    type BoardCategory,
    type BoardDetail,
    type BoardListItem,
} from '@/lib/board-api';
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

const boardPostPath = (postId: string) => `/dashboard/board?postId=${encodeURIComponent(postId)}`;

// One row of the combined list: an FC notice or a board post.
type FeedItem =
    | { kind: 'notice'; id: string; title: string; preview: string; createdAt: string; notice: AdminNoticeItem }
    | { kind: 'post'; id: string; title: string; preview: string; createdAt: string; post: BoardListItem };

type FeedFilter = 'all' | 'notice' | 'post';

type PostAttachment = BoardDetail['attachments'][number];

const isPdfAttachment = (file: PostAttachment) =>
    file.mimeType === 'application/pdf' || file.fileName.toLowerCase().endsWith('.pdf');

// Attachment strip with a preview of the chosen file: images inline, PDFs in the browser viewer, others as a link.
function AttachmentPreview({ attachments }: { attachments: PostAttachment[] }) {
    const [activeId, setActiveId] = useState(attachments[0]?.id ?? null);
    const active = attachments.find((file) => file.id === activeId) ?? attachments[0];
    if (!active) return null;
    return (
        <div className={styles.attachments}>
            <div className={styles.attachmentTabs} role="tablist" aria-label="첨부파일">
                {attachments.map((file) => (
                    <button
                        key={file.id}
                        type="button"
                        role="tab"
                        aria-selected={file.id === active.id}
                        className={styles.attachmentTab}
                        data-active={file.id === active.id || undefined}
                        onClick={() => setActiveId(file.id)}
                    >
                        {file.fileType === 'image' ? <IconPhoto size={14} /> : <IconPaperclip size={14} />}
                        <span>{file.fileName}</span>
                    </button>
                ))}
            </div>
            <div className={styles.attachmentView}>
                {!active.signedUrl ? (
                    <Text size="sm" c="dimmed">미리보기 주소를 받지 못했습니다.</Text>
                ) : active.fileType === 'image' ? (
                    <Image src={active.signedUrl} alt={active.fileName} fit="contain" mah={420} />
                ) : isPdfAttachment(active) ? (
                    <iframe key={active.signedUrl} src={active.signedUrl} title={`${active.fileName} 미리보기`} className={styles.attachmentFrame} />
                ) : (
                    <Stack gap={4} align="center">
                        <IconPaperclip size={22} />
                        <Text size="sm" fw={600}>미리보기를 지원하지 않는 형식입니다.</Text>
                    </Stack>
                )}
            </div>
            {active.signedUrl ? (
                <Anchor href={active.signedUrl} target="_blank" rel="noreferrer" size="xs" c="dimmed" className={styles.openFull}>
                    <IconExternalLink size={12} /> {active.fileName} · {formatFileSize(active.fileSize)} · 새 창에서 열기
                </Anchor>
            ) : null}
        </div>
    );
}

// Composer choice: who receives it and how they are notified decides where it is published.
const COMPOSE_TARGETS = [
    {
        key: 'notice',
        icon: IconSpeakerphone,
        title: 'FC 공지',
        audience: 'FC 전체',
        delivery: '푸시 알림 + 알림함',
        place: "앱 '공지'에 게시",
        href: '/dashboard/notifications/create',
    },
    {
        key: 'post',
        icon: IconNews,
        title: '게시판 글',
        audience: 'FC · 본부장 · 총무',
        delivery: '푸시 알림 + 알림함',
        place: '댓글·반응 가능',
        href: '/dashboard/board?compose=1',
    },
] as const;

export default function NotificationsPage() {
    const queryClient = useQueryClient();
    const router = useRouter();
    const { hydrated, role, residentId, displayName, isReadOnly } = useSession();
    const [keyword, setKeyword] = useState('');
    const [filter, setFilter] = useState<FeedFilter>('all');
    const [postCategory, setPostCategory] = useState<string>('all');
    // Only a post the user clicks loads its detail; each detail read is recorded as a view.
    const [openedPostId, setOpenedPostId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [composeOpened, { open: openCompose, close: closeCompose }] = useDisclosure(false);

    // 확인 모달 상태
    const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
    const [confirmConfig, setConfirmConfig] = useState<{
        title: string;
        message: string;
        onConfirm: () => void | Promise<unknown>;
    } | null>(null);

    const showConfirm = (config: { title: string; message: string; onConfirm: () => void | Promise<unknown> }) => {
        setConfirmConfig(config);
        openConfirm();
    };

    const [confirmSubmitting, setConfirmSubmitting] = useState(false);
    const confirmSubmittingRef = useRef(false);
    const handleConfirm = async () => {
        if (!confirmConfig || confirmSubmittingRef.current) return;
        confirmSubmittingRef.current = true;
        setConfirmSubmitting(true);
        try {
            await confirmConfig.onConfirm();
            closeConfirm();
        } finally {
            confirmSubmittingRef.current = false;
            setConfirmSubmitting(false);
        }
    };

    // 공지 작성/수정/삭제 가능 여부
    // 공지 등록은 관리자만, 본부장(manager)은 본인글 수정-삭제만 허용
    const canCreate = role === 'admin';
    const canWritePost = role === 'admin' || role === 'manager';
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

    // Latest board posts for the same list; comments and reactions stay on the board page.
    const boardActor = useMemo(
        () => buildBoardActor({ role, residentId, displayName, readOnly: isReadOnly }),
        [displayName, isReadOnly, residentId, role],
    );
    const boardQuery = useQuery({
        queryKey: ['board-posts', boardActor?.role, boardActor?.residentId, 'hub'],
        queryFn: () => fetchBoardList(boardActor!, { limit: 50 }),
        enabled: hydrated && Boolean(boardActor),
    });
    const boardPosts: BoardListItem[] = Array.isArray(boardQuery.data?.items) ? boardQuery.data.items : [];
    const categoriesQuery = useQuery({
        queryKey: ['board-categories', boardActor?.role, boardActor?.residentId],
        queryFn: () => fetchBoardCategories(boardActor!),
        enabled: hydrated && Boolean(boardActor),
    });
    const boardCategories: BoardCategory[] = Array.isArray(categoriesQuery.data) ? categoriesQuery.data : [];
    const postDetailQuery = useQuery({
        queryKey: ['board-detail', 'hub', boardActor?.residentId, openedPostId],
        queryFn: () => fetchBoardDetail(boardActor!, openedPostId!),
        enabled: Boolean(boardActor && openedPostId),
    });
    const listRefreshing = isFetching || boardQuery.isFetching;
    const categoryNameOf = (categoryId: string) => boardCategories.find((category) => category.id === categoryId)?.name ?? '게시글';

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
            // onError already notifies; the promise only tells the dialog when to close.
            onConfirm: () => deleteMutation.mutateAsync(id).catch(() => undefined),
        });
    };

    // Board posts already mirrored into the notice list show once, as board posts.
    const boardPostIds = new Set(boardPosts.map((post) => post.id));
    const feed: FeedItem[] = [
        ...(noticesData || [])
            .filter((notice) => {
                const postId = extractBoardPostId(notice.id);
                return !postId || !boardPostIds.has(postId);
            })
            .map((notice): FeedItem => ({
                kind: 'notice', id: notice.id, title: notice.title, preview: notice.body, createdAt: notice.created_at, notice,
            })),
        ...boardPosts.map((post): FeedItem => ({
            kind: 'post', id: `post:${post.id}`, title: post.title, preview: post.contentPreview, createdAt: post.createdAt, post,
        })),
    ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const query = keyword.trim().toLowerCase();
    const visibleFeed = feed.filter((item) => {
        if (filter !== 'all' && item.kind !== filter) return false;
        if (filter === 'post' && postCategory !== 'all' && item.kind === 'post' && item.post.categoryId !== postCategory) return false;
        if (!query) return true;
        const extra = item.kind === 'notice' ? [item.notice.category ?? ''] : [item.post.authorName, categoryNameOf(item.post.categoryId)];
        return [item.title, item.preview, ...extra].some((value) => value?.toLowerCase().includes(query));
    });

    // The detail pane shows the clicked item, or the first one in the current list.
    const selected = visibleFeed.find((item) => item.id === selectedId) ?? visibleFeed[0] ?? null;
    const editPathOf = (notice: AdminNoticeItem) => {
        const postId = extractBoardPostId(notice.id);
        return postId ? boardPostPath(postId) : `/dashboard/notifications/${notice.id}/edit`;
    };
    const noticeCount = feed.filter((item) => item.kind === 'notice').length;
    const postCount = feed.length - noticeCount;

    return (
        <div className={styles.page}>
            <div className={styles.head} style={{ '--i': 0 } as CSSProperties}>
                <div>
                    <Title order={2} className={styles.title} mb={4}>
                        공지·게시판
                    </Title>
                    <Text c="dimmed" size="sm">
                        FC 공지와 게시판 글을 한곳에서 관리합니다.
                    </Text>
                    {noticesData || boardQuery.data ? (
                        <div className={surface.headMeta}>
                            <span className={surface.metaChip}><i />공지 <b>{noticeCount}</b></span>
                            <span className={surface.metaChip}><i />게시글 <b>{postCount}</b></span>
                            <span className={surface.metaChip} data-tone="ok">
                                <i />이번 달 <b>{feed.filter((item) => dayjs(item.createdAt).isSame(dayjs(), 'month')).length}</b>
                            </span>
                        </div>
                    ) : null}
                </div>

                <Group gap="xs">
                    <TextInput
                        placeholder="제목, 내용, 작성자 검색"
                        leftSection={<IconSearch size={16} />}
                        value={keyword}
                        onChange={(e) => setKeyword(e.currentTarget.value)}
                        radius="xl"
                        w={240}
                        classNames={{ input: styles.searchInput }}
                    />
                    <button
                        type="button"
                        className={styles.softButton}
                        disabled={listRefreshing}
                        aria-busy={listRefreshing || undefined}
                        onClick={() => {
                            queryClient.invalidateQueries({ queryKey: ['notices'] });
                            queryClient.invalidateQueries({ queryKey: ['board-posts'] });
                        }}
                    >
                        {listRefreshing ? <Loader size={14} /> : <IconRefresh size={16} stroke={1.8} />} 새로고침
                    </button>
                    {canCreate || canWritePost ? (
                        <Button
                            leftSection={<IconPlus size={16} />}
                            color="orange"
                            radius="xl"
                            h={44}
                            disabled={isReadOnly && !canCreate}
                            onClick={openCompose}
                        >
                            새 글 쓰기
                        </Button>
                    ) : null}
                </Group>
            </div>

            {isError && <QueryErrorAlert error={error} onRetry={refetch} isFetching={isFetching} hasData={!!noticesData} subject="공지 목록" />}
            {boardQuery.isError && (
                <QueryErrorAlert error={boardQuery.error} onRetry={boardQuery.refetch} isFetching={boardQuery.isFetching} hasData={Boolean(boardQuery.data)} subject="게시판 목록" />
            )}

            <div className={styles.split}>
                <section className={styles.card} style={{ '--i': 1 } as CSSProperties} aria-label="공지·게시판 목록">
                    <LoadingOverlay visible={isLoading} overlayProps={{ blur: 2 }} />
                    <div className={styles.feedHead}>
                        <SegmentedControl
                            value={filter}
                            onChange={(value) => setFilter(value as FeedFilter)}
                            color="orange"
                            radius="xl"
                            size="sm"
                            data={[
                                { value: 'all', label: `전체 ${feed.length}` },
                                { value: 'notice', label: `공지 ${noticeCount}` },
                                { value: 'post', label: `게시글 ${postCount}` },
                            ]}
                        />
                    </div>
                    {filter === 'post' && boardCategories.length > 0 ? (
                        <div className={styles.categoryChips} role="group" aria-label="게시글 카테고리">
                            {[{ id: 'all', name: '전체' }, ...boardCategories].map((category) => {
                                const count = category.id === 'all'
                                    ? postCount
                                    : boardPosts.filter((post) => post.categoryId === category.id).length;
                                return (
                                    <button
                                        key={category.id}
                                        type="button"
                                        className={styles.categoryChip}
                                        data-active={postCategory === category.id || undefined}
                                        aria-pressed={postCategory === category.id}
                                        onClick={() => setPostCategory(category.id)}
                                    >
                                        {category.name} <span>{count}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                    <ScrollArea.Autosize mah="calc(100dvh - 330px)">
                        <div className={styles.feed} role="list">
                            {visibleFeed.length > 0 ? visibleFeed.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    role="listitem"
                                    className={styles.feedRow}
                                    data-kind={item.kind}
                                    data-selected={item.id === selected?.id || undefined}
                                    onClick={() => {
                                        setSelectedId(item.id);
                                        if (item.kind === 'post') setOpenedPostId(item.post.id);
                                    }}
                                >
                                    <span className={styles.kindIcon}>
                                        {item.kind === 'notice' ? <IconSpeakerphone size={16} /> : <IconNews size={16} />}
                                    </span>
                                    <span className={styles.feedBody}>
                                        <span className={styles.feedTitle}>
                                            {item.kind === 'post' && item.post.isPinned ? <IconPinFilled size={13} className={styles.pin} /> : null}
                                            {item.title}
                                        </span>
                                        <span className={styles.feedPreview}>{item.preview}</span>
                                    </span>
                                    <span className={styles.feedMeta}>
                                        <span className={styles.kindPill} data-kind={item.kind}>
                                            {item.kind === 'notice' ? item.notice.category || '공지' : categoryNameOf(item.post.categoryId)}
                                        </span>
                                        <span>{dayjs(item.createdAt).format('MM.DD')}</span>
                                        {item.kind === 'post' && item.post.stats.commentCount > 0 ? (
                                            <span className={styles.comments}><IconMessageCircle size={12} />{item.post.stats.commentCount}</span>
                                        ) : null}
                                    </span>
                                </button>
                            )) : (
                                <Text c="dimmed" ta="center" py={40}>
                                    {isLoading ? '목록을 불러오는 중입니다.' : isError && boardQuery.isError ? '목록을 확인할 수 없습니다.' : '등록된 글이 없습니다.'}
                                </Text>
                            )}
                        </div>
                    </ScrollArea.Autosize>
                </section>

                {/* Detail of the selected item, beside the list */}
                <section key={selected?.id ?? 'empty'} className={`${styles.card} ${styles.detail}`} style={{ '--i': 2 } as CSSProperties} aria-label="공지 상세">
                    {selected?.kind === 'notice' ? (
                        <Stack gap="md">
                            <Group justify="space-between" align="center">
                                <span className={styles.kindPill} data-kind="notice">{selected.notice.category || '공지'}</span>
                                <Text size="sm" c="dimmed">
                                    {selected.createdAt ? dayjs(selected.createdAt).format('YYYY-MM-DD HH:mm') : '-'}
                                </Text>
                            </Group>
                            <Title order={3} className={styles.detailTitle}>{selected.title}</Title>
                            <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                                {selected.notice.body}
                            </Text>

                            {Array.isArray(selected.notice.images) && selected.notice.images.length > 0 ? (
                                <Stack gap="xs">
                                    <Text fw={600} size="sm">이미지</Text>
                                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                        {selected.notice.images.map((url, idx) => (
                                            <Anchor key={`${url}-${idx}`} href={url} target="_blank" rel="noreferrer">
                                                <Image src={url} alt={`notice-image-${idx + 1}`} className={styles.image} />
                                            </Anchor>
                                        ))}
                                    </SimpleGrid>
                                </Stack>
                            ) : null}

                            {Array.isArray(selected.notice.files) && selected.notice.files.length > 0 ? (
                                <Stack gap="xs">
                                    <Text fw={600} size="sm">첨부파일</Text>
                                    {selected.notice.files.map((file, idx) => (
                                        <Anchor key={`${file.url ?? 'file'}-${idx}`} href={file.url ?? '#'} target="_blank" rel="noreferrer" className={styles.file}>
                                            <IconPaperclip size={14} />
                                            <span>{file.name ?? `첨부파일 ${idx + 1}`}</span>
                                        </Anchor>
                                    ))}
                                </Stack>
                            ) : null}

                            <Group justify="space-between" mt="xs">
                                <Anchor component={Link} href={resolveNoticePath(selected.notice.id)} size="sm" c="dimmed" className={styles.openFull}>
                                    <IconExternalLink size={14} /> {extractBoardPostId(selected.notice.id) ? '게시판에서 보기' : '상세 화면으로 열기'}
                                </Anchor>
                                {canManageNotice(selected.notice) ? (
                                    <Group gap="xs">
                                        <Button component={Link} href={editPathOf(selected.notice)} variant="default" radius="xl" size="xs" leftSection={<IconEdit size={14} />}>
                                            수정
                                        </Button>
                                        <Button
                                            variant="light"
                                            color="red"
                                            radius="xl"
                                            size="xs"
                                            leftSection={<IconTrash size={14} />}
                                            loading={deleteMutation.isPending && deleteMutation.variables === selected.notice.id}
                                            onClick={() => handleDelete(selected.notice.id)}
                                        >
                                            삭제
                                        </Button>
                                    </Group>
                                ) : null}
                            </Group>
                        </Stack>
                    ) : selected?.kind === 'post' ? (
                        <Stack gap="md">
                            <Group justify="space-between" align="center">
                                <Group gap={6}>
                                    <span className={styles.kindPill} data-kind="post">{categoryNameOf(selected.post.categoryId)}</span>
                                    {selected.post.isPinned ? <span className={styles.kindPill} data-kind="pinned"><IconPinFilled size={11} />필독</span> : null}
                                </Group>
                                <Text size="sm" c="dimmed">{dayjs(selected.createdAt).format('YYYY-MM-DD HH:mm')}</Text>
                            </Group>
                            <Title order={3} className={styles.detailTitle}>{selected.title}</Title>
                            <Text size="sm" c="dimmed">{selected.post.authorName}</Text>
                            {(() => {
                                const detail = postDetailQuery.data && !Array.isArray(postDetailQuery.data) && postDetailQuery.data.post?.id === selected.post.id
                                    ? postDetailQuery.data
                                    : null;
                                const listImages = (selected.post.attachments ?? []).filter((file) => file.signedUrl) as PostAttachment[];
                                const attachments = detail?.attachments ?? listImages;
                                return (
                                    <>
                                        <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                                            {detail?.post.content ?? selected.post.contentPreview}
                                        </Text>
                                        {attachments.length > 0 ? <AttachmentPreview key={`${selected.id}:${attachments.length}`} attachments={attachments} /> : null}
                                        {!detail && openedPostId === selected.post.id && postDetailQuery.isError ? (
                                            <Text size="xs" c="red">첨부파일을 불러오지 못했습니다. 다시 시도해 주세요.</Text>
                                        ) : null}
                                        {!detail && selected.post.stats.attachmentCount > attachments.length ? (
                                            <Button
                                                variant="default"
                                                radius="xl"
                                                size="xs"
                                                w="fit-content"
                                                leftSection={<IconPaperclip size={14} />}
                                                loading={postDetailQuery.isFetching}
                                                onClick={() => {
                                                    // Same post again means a retry; another post starts its own read.
                                                    if (openedPostId === selected.post.id) void postDetailQuery.refetch();
                                                    else setOpenedPostId(selected.post.id);
                                                }}
                                            >
                                                첨부파일 {selected.post.stats.attachmentCount}개 보기
                                            </Button>
                                        ) : null}
                                    </>
                                );
                            })()}
                            <div className={styles.postStats}>
                                <span>댓글 <b>{selected.post.stats.commentCount}</b></span>
                                <span>반응 <b>{selected.post.stats.reactionCount}</b></span>
                                <span>첨부 <b>{selected.post.stats.attachmentCount}</b></span>
                                <span>조회 <b>{selected.post.stats.viewCount}</b></span>
                            </div>
                            <Group justify="flex-end" mt="xs">
                                <Button component={Link} href={boardPostPath(selected.post.id)} variant="default" radius="xl" size="xs" leftSection={<IconExternalLink size={14} />}>
                                    게시판에서 열기 (댓글·수정)
                                </Button>
                            </Group>
                        </Stack>
                    ) : (
                        <Text c="dimmed" size="sm" ta="center" py={40}>
                            {isLoading ? '목록을 불러오는 중입니다.' : '선택한 글이 없습니다.'}
                        </Text>
                    )}
                </section>
            </div>

            {/* 새 글: 받는 사람과 알림 방식을 먼저 고른다 */}
            <Modal
                opened={composeOpened}
                onClose={closeCompose}
                title={<Text fw={700} size="lg">누구에게 알릴까요?</Text>}
                size="lg"
                radius={28}
                padding="xl"
                centered
            >
                <div className={styles.composeChoices}>
                    {COMPOSE_TARGETS.map((target) => {
                        const allowed = target.key === 'notice' ? canCreate : canWritePost && !isReadOnly;
                        return (
                            <button
                                key={target.key}
                                type="button"
                                className={styles.composeChoice}
                                disabled={!allowed}
                                onClick={() => {
                                    closeCompose();
                                    router.push(target.href);
                                }}
                            >
                                <span className={styles.composeIcon}><target.icon size={22} /></span>
                                <span className={styles.composeTitle}>{target.title}</span>
                                <span className={styles.composeFact}><b>받는 사람</b>{target.audience}</span>
                                <span className={styles.composeFact}><b>알림</b>{target.delivery}</span>
                                <span className={styles.composeFact}><b>게시</b>{target.place}</span>
                            </button>
                        );
                    })}
                </div>
            </Modal>

            {/* 확인 모달 */}
            <ConfirmModal
                opened={confirmOpened}
                onClose={closeConfirm}
                onConfirm={() => void handleConfirm()}
                title={confirmConfig?.title}
                message={confirmConfig?.message}
                confirmLabel="삭제"
                color="red"
                submitting={confirmSubmitting}
            />
        </div>
    );
}
