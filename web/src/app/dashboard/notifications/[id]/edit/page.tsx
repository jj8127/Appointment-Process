'use client';

import {
    ActionIcon,
    Box,
    Button,
    Container,
    Group,
    Image,
    LoadingOverlay,
    Paper,
    SimpleGrid,
    Stack,
    Text,
    TextInput,
    Textarea,
    ThemeIcon,
    Title,
    rem
} from '@mantine/core';
import { Dropzone, FileWithPath, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { useForm, zodResolver } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconCheck, IconFile, IconPhoto, IconDeviceFloppy, IconUpload, IconX } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { updateNoticeAction } from '../../actions';

import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { fetchAdminNotice, type AdminNoticeFile } from '@/lib/admin-notice-client';
import { logger } from '@/lib/logger';
import { noticeSchema as schema, noticeGlassStyle as glassStyle, uploadNoticeAttachment as uploadToSupabase } from '../../form';
import { useSession } from '@/hooks/use-session';
import { CHARCOAL } from '@/lib/brand-colors';

const BOARD_NOTICE_ID_PREFIX = 'board_notice:';

const extractBoardPostId = (noticeId: string): string | null => {
    if (!noticeId.startsWith(BOARD_NOTICE_ID_PREFIX)) return null;
    const postId = noticeId.slice(BOARD_NOTICE_ID_PREFIX.length).trim();
    return postId.length > 0 ? postId : null;
};

export default function EditNoticePage() {
    const params = useParams<{ id: string }>();
    const id = String(params?.id ?? '').trim();
    const { role, residentId } = useSession();
    return <EditNoticeContent key={`${role ?? ''}:${residentId ?? ''}:${id}`} id={id} />;
}

function EditNoticeContent({ id }: { id: string }) {
    const router = useRouter();
    const boardPostId = extractBoardPostId(id);

    const [isPending, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const [submitPhase, setSubmitPhase] = useState('');
    const [isFetching, setIsFetching] = useState(true);
    const [fetchError, setFetchError] = useState<unknown>(null);
    const [fetchAttempt, setFetchAttempt] = useState(0);

    // Images: mix of existing URLs (strings) and new files
    const [existingImages, setExistingImages] = useState<string[]>([]);
    const [newImages, setNewImages] = useState<FileWithPath[]>([]);
    // Files: mix of existing file objects and new files
    const [existingFiles, setExistingFiles] = useState<AdminNoticeFile[]>([]);
    const [newFiles, setNewFiles] = useState<FileWithPath[]>([]);
    const originalAttachments = useRef('');

    const form = useForm({
        initialValues: {
            category: '',
            title: '',
            body: '',
        },
        validate: zodResolver(schema as unknown as Parameters<typeof zodResolver>[0]),
    });

    // Load existing notice
    useEffect(() => {
        if (boardPostId) {
            router.replace(`/dashboard/board?postId=${encodeURIComponent(boardPostId)}`);
            return;
        }
        if (!id) return;
        setIsFetching(true);
        setFetchError(null);
        fetchAdminNotice(id)
            .then((n) => {
                form.setValues({ category: n.category ?? '', title: n.title, body: n.body });
                form.resetDirty({ category: n.category ?? '', title: n.title, body: n.body });
                setExistingImages(n.images ?? []);
                setExistingFiles(n.files ?? []);
                originalAttachments.current = JSON.stringify([n.images ?? [], n.files ?? []]);
            })
            .catch((error: unknown) => setFetchError(error))
            .finally(() => setIsFetching(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boardPostId, fetchAttempt, id, router]);

    if (boardPostId) {
        return (
            <Container size="sm" py={rem(60)}>
                <Text c="dimmed">게시판으로 이동 중입니다...</Text>
            </Container>
        );
    }

    const handleLeave = () => {
        if (submittingRef.current) return;
        const dirty = form.isDirty() || newImages.length > 0 || newFiles.length > 0
            || JSON.stringify([existingImages, existingFiles]) !== originalAttachments.current;
        if (dirty && !window.confirm('수정 중인 공지와 첨부를 버릴까요?')) return;
        router.push(`/dashboard/notifications/${id}`);
    };

    const handleSubmit = async (values: typeof form.values) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        setSubmitPhase('첨부 업로드 중');
        try {
            // Upload new images
            const newImageUrls = await Promise.all(newImages.map((img) => uploadToSupabase(img)));
            const allImages = [...existingImages, ...newImageUrls];

            // Upload new files
            const newFileObjects = await Promise.all(
                newFiles.map(async (file) => {
                    const url = await uploadToSupabase(file);
                    return { name: file.name, size: file.size, type: file.type, url };
                })
            );
            const allFiles = [...existingFiles, ...newFileObjects];

            const formData = new FormData();
            formData.append('id', id);
            formData.append('category', values.category);
            formData.append('title', values.title);
            formData.append('body', values.body);
            formData.append('images', JSON.stringify(allImages));
            formData.append('files', JSON.stringify(allFiles));

            setSubmitPhase('공지 저장 중');
                const result = await updateNoticeAction({ success: false }, formData);

                if (result.success) {
                    notifications.show({
                        title: '수정 완료',
                        message: result.message,
                        color: 'teal',
                        icon: <IconCheck size={18} />,
                        autoClose: 3000,
                    });
                    router.push(`/dashboard/notifications/${id}`);
                } else {
                    notifications.show({
                        title: '수정 실패',
                        message: result.message || '오류가 발생했습니다.',
                        color: 'red',
                        icon: <IconX size={18} />,
                    });
                    if (result.errors) {
                        form.setErrors(result.errors);
                    }
                }
        } catch (error) {
            logger.error('File upload error', error);
            notifications.show({
                title: '업로드 오류',
                message: '처리 결과를 확인하지 못했습니다. 입력은 유지됩니다. 공지 목록을 확인한 뒤 다시 시도해주세요.',
                color: 'red',
            });
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
            setSubmitPhase('');
        }
    };

    if (fetchError) {
        return (
            <Container size="sm" py={rem(60)}>
                <QueryErrorAlert
                    error={fetchError}
                    onRetry={() => setFetchAttempt((attempt) => attempt + 1)}
                    isFetching={isFetching}
                    subject="공지 상세"
                />
                <Button mt="md" variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => router.back()}>
                    돌아가기
                </Button>
            </Container>
        );
    }

    return (
        <Container size="sm" py={rem(60)}>
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: -1,
                background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)', opacity: 0.5
            }} />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <Group mb="xl">
                    <Button
                        variant="subtle"
                        color="gray"
                        leftSection={<IconArrowLeft size={18} />}
                        size="sm"
                        onClick={handleLeave}
                    >
                        돌아가기
                    </Button>
                </Group>

                <Stack gap="xs" mb={rem(40)}>
                    <Title order={2} c={CHARCOAL}>
                        공지사항 수정
                    </Title>
                    <Text c="dimmed" size="lg">내용을 수정한 후 저장하세요.</Text>
                </Stack>

                <Paper radius="lg" p={rem(40)} pos="relative" style={glassStyle}>
                    <LoadingOverlay visible={isFetching || isPending} overlayProps={{ radius: 'lg', blur: 2 }} />
                    {isPending ? <Text role="status" size="sm">{submitPhase}</Text> : null}

                    <form onSubmit={form.onSubmit(handleSubmit)}>
                        <Stack gap="xl">
                            <TextInput
                                label="카테고리"
                                placeholder="예: 공지사항, 긴급, 이벤트"
                                size="md"
                                required
                                {...form.getInputProps('category')}
                            />

                            <TextInput
                                label="제목"
                                placeholder="제목을 입력하세요"
                                size="md"
                                required
                                {...form.getInputProps('title')}
                            />

                            <Textarea
                                label="내용"
                                placeholder="내용을 입력하세요"
                                minRows={8}
                                autosize
                                size="md"
                                required
                                {...form.getInputProps('body')}
                            />

                            {/* 기존 이미지 */}
                            {existingImages.length > 0 && (
                                <Box>
                                    <Text size="sm" fw={600} mb="xs" c="dimmed">기존 이미지</Text>
                                    <SimpleGrid cols={{ base: 2, sm: 4 }}>
                                        {existingImages.map((url, idx) => (
                                            <div key={idx} style={{ position: 'relative' }}>
                                                <Image
                                                    src={url}
                                                    alt={`기존 이미지 ${idx + 1}`}
                                                    radius="md"
                                                    h={100}
                                                    w="100%"
                                                    fit="cover"
                                                    style={{ border: '1px solid rgba(0,0,0,0.05)' }}
                                                />
                                                <ActionIcon aria-label="기존 이미지 제거"
                                                    color="red" size="xs" radius="xl" variant="filled"
                                                    style={{ position: 'absolute', top: 5, right: 5 }}
                                                    onClick={() => setExistingImages((prev) => prev.filter((_, i) => i !== idx))}
                                                >
                                                    <IconX size={12} />
                                                </ActionIcon>
                                            </div>
                                        ))}
                                    </SimpleGrid>
                                </Box>
                            )}

                            {/* 새 이미지 업로드 */}
                            <Box>
                                <Text size="sm" fw={600} mb="xs" c="dimmed">이미지 추가</Text>
                                <Dropzone
                                    onDrop={(files) => setNewImages((prev) => [...prev, ...files])}
                                    onReject={(files) => logger.debug('rejected files', files)}
                                    maxSize={5 * 1024 * 1024}
                                    accept={IMAGE_MIME_TYPE}
                                    maxFiles={5}
                                    radius="md"
                                    style={{ border: '2px dashed var(--mantine-color-gray-3)', backgroundColor: 'rgba(255,255,255,0.5)' }}
                                >
                                    <Group justify="center" gap="xl" style={{ minHeight: rem(100), pointerEvents: 'none' }}>
                                        <Dropzone.Accept><IconUpload style={{ width: rem(40), height: rem(40), color: 'var(--mantine-color-blue-6)' }} stroke={1.5} /></Dropzone.Accept>
                                        <Dropzone.Reject><IconX style={{ width: rem(40), height: rem(40), color: 'var(--mantine-color-red-6)' }} stroke={1.5} /></Dropzone.Reject>
                                        <Dropzone.Idle><IconPhoto style={{ width: rem(40), height: rem(40), color: 'var(--mantine-color-dimmed)' }} stroke={1.2} /></Dropzone.Idle>
                                        <Text size="sm" c="dimmed">클릭하거나 드래그하여 이미지 추가</Text>
                                    </Group>
                                </Dropzone>
                                <AnimatePresence>
                                    {newImages.length > 0 && (
                                        <SimpleGrid cols={{ base: 2, sm: 4 }} mt="md">
                                            {newImages.map((file, idx) => {
                                                const url = URL.createObjectURL(file);
                                                return (
                                                    <motion.div key={idx} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} layout>
                                                        <div style={{ position: 'relative' }}>
                                                            <Image src={url} alt={`새 이미지 ${idx + 1}`} onLoad={() => URL.revokeObjectURL(url)} radius="md" h={100} w="100%" fit="cover" style={{ border: '1px solid rgba(0,0,0,0.05)' }} />
                                                            <ActionIcon aria-label="새 이미지 제거" color="red" size="xs" radius="xl" variant="filled" style={{ position: 'absolute', top: 5, right: 5 }} onClick={() => setNewImages((prev) => prev.filter((_, i) => i !== idx))}>
                                                                <IconX size={12} />
                                                            </ActionIcon>
                                                        </div>
                                                    </motion.div>
                                                );
                                            })}
                                        </SimpleGrid>
                                    )}
                                </AnimatePresence>
                            </Box>

                            {/* 기존 첨부파일 */}
                            {existingFiles.length > 0 && (
                                <Box>
                                    <Text size="sm" fw={600} mb="xs" c="dimmed">기존 첨부파일</Text>
                                    <Stack gap="xs">
                                        {existingFiles.map((file, idx) => (
                                            <Paper key={idx} withBorder p="xs" radius="sm" bg="gray.0">
                                                <Group justify="space-between">
                                                    <Group gap="xs">
                                                        <ThemeIcon color="blue" variant="light" radius="md"><IconFile size={16} /></ThemeIcon>
                                                        <Text size="sm" truncate="end" maw={200} fw={500}>{file.name ?? `파일 ${idx + 1}`}</Text>
                                                    </Group>
                                                    <ActionIcon aria-label="기존 파일 제거" color="red" variant="subtle" onClick={() => setExistingFiles((prev) => prev.filter((_, i) => i !== idx))}>
                                                        <IconX size={16} />
                                                    </ActionIcon>
                                                </Group>
                                            </Paper>
                                        ))}
                                    </Stack>
                                </Box>
                            )}

                            {/* 새 파일 업로드 */}
                            <Box>
                                <Text size="sm" fw={600} mb="xs" c="dimmed">파일 추가</Text>
                                <Dropzone
                                    onDrop={(files) => setNewFiles((prev) => [...prev, ...files])}
                                    onReject={(files) => logger.debug('rejected files', files)}
                                    maxSize={10 * 1024 * 1024}
                                    maxFiles={5}
                                    radius="md"
                                    style={{ border: '2px dashed var(--mantine-color-gray-3)', backgroundColor: 'rgba(255,255,255,0.5)' }}
                                >
                                    <Group justify="center" gap="lg" style={{ minHeight: rem(80), pointerEvents: 'none' }}>
                                        <Dropzone.Accept><IconUpload style={{ width: rem(36), height: rem(36), color: 'var(--mantine-color-blue-6)' }} stroke={1.5} /></Dropzone.Accept>
                                        <Dropzone.Reject><IconX style={{ width: rem(36), height: rem(36), color: 'var(--mantine-color-red-6)' }} stroke={1.5} /></Dropzone.Reject>
                                        <Dropzone.Idle><IconFile style={{ width: rem(36), height: rem(36), color: 'var(--mantine-color-dimmed)' }} stroke={1.2} /></Dropzone.Idle>
                                        <Text size="sm" c="dimmed">파일 추가 (드래그 또는 클릭)</Text>
                                    </Group>
                                </Dropzone>
                                <AnimatePresence>
                                    {newFiles.length > 0 && (
                                        <Stack gap="xs" mt="sm">
                                            {newFiles.map((file, idx) => (
                                                <motion.div key={idx} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                                                    <Paper withBorder p="xs" radius="sm" bg="gray.0">
                                                        <Group justify="space-between">
                                                            <Group gap="xs">
                                                                <ThemeIcon color="blue" variant="light" radius="md"><IconFile size={16} /></ThemeIcon>
                                                                <Text size="sm" truncate="end" maw={200} fw={500}>{file.name}</Text>
                                                                <Text size="xs" c="dimmed">({(file.size / 1024).toFixed(1)} KB)</Text>
                                                            </Group>
                                                            <ActionIcon aria-label="새 파일 제거" color="red" variant="subtle" onClick={() => setNewFiles((prev) => prev.filter((_, i) => i !== idx))}>
                                                                <IconX size={16} />
                                                            </ActionIcon>
                                                        </Group>
                                                    </Paper>
                                                </motion.div>
                                            ))}
                                        </Stack>
                                    )}
                                </AnimatePresence>
                            </Box>

                            <Group justify="flex-end" mt="xl">
                                <Button
                                    type="submit"
                                    variant="gradient"
                                    gradient={{ from: 'blue', to: 'cyan' }}
                                    size="lg"
                                    radius="md"
                                    leftSection={<IconDeviceFloppy size={20} />}
                                    loading={isPending}
                                    style={{ boxShadow: '0 4px 14px 0 rgba(12, 89, 232, 0.39)' }}
                                >
                                    저장하기
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                </Paper>
            </motion.div>
        </Container>
    );
}
