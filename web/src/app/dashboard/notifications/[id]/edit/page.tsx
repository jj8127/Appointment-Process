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
import { createBrowserClient } from '@supabase/ssr';
import { IconArrowLeft, IconCheck, IconFile, IconPhoto, IconDeviceFloppy, IconUpload, IconX } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { z } from 'zod';
import { updateNoticeAction } from '../../actions';

import { logger } from '@/lib/logger';

const schema = z.object({
    category: z.string().min(1, '카테고리를 입력해주세요'),
    title: z.string().min(1, '제목을 입력해주세요'),
    body: z.string().min(1, '내용을 입력해주세요'),
});

type NoticeFile = {
    name?: string;
    url?: string;
    type?: string;
    size?: number;
};

type NoticeItem = {
    id: string;
    title: string;
    body: string;
    category?: string | null;
    images?: string[] | null;
    files?: NoticeFile[] | null;
};

type NoticeResponse = {
    ok?: boolean;
    notice?: NoticeItem;
    error?: string;
};

function createNoticeAttachmentPath(originalName: string) {
    const fileExt = originalName.split('.').pop() || 'bin';
    const suffix =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : Math.random().toString(36).substring(2, 10);
    return `${Date.now()}_${suffix}.${fileExt}`;
}

const glassStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
};

export default function EditNoticePage() {
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const id = String(params?.id ?? '').trim();

    const [isPending, startTransition] = useTransition();
    const [isFetching, setIsFetching] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

    // Images: mix of existing URLs (strings) and new files
    const [existingImages, setExistingImages] = useState<string[]>([]);
    const [newImages, setNewImages] = useState<FileWithPath[]>([]);
    // Files: mix of existing file objects and new files
    const [existingFiles, setExistingFiles] = useState<NoticeFile[]>([]);
    const [newFiles, setNewFiles] = useState<FileWithPath[]>([]);

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

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
        if (!id) return;
        fetch(`/api/admin/notices?id=${encodeURIComponent(id)}`, { credentials: 'include' })
            .then((res) => res.json() as Promise<NoticeResponse>)
            .then((data) => {
                if (!data.ok || !data.notice) throw new Error(data.error ?? '공지를 불러올 수 없습니다.');
                const n = data.notice;
                form.setValues({ category: n.category ?? '', title: n.title, body: n.body });
                setExistingImages(n.images ?? []);
                setExistingFiles(n.files ?? []);
            })
            .catch((err: Error) => setFetchError(err.message))
            .finally(() => setIsFetching(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const uploadToSupabase = async (file: File) => {
        const filePath = createNoticeAttachmentPath(file.name);
        const { error } = await supabase.storage.from('notice-attachments').upload(filePath, file);
        if (error) {
            logger.error('Upload Error:', error);
            throw new Error('파일 업로드 실패');
        }
        const { data } = supabase.storage.from('notice-attachments').getPublicUrl(filePath);
        return data.publicUrl;
    };

    const handleSubmit = async (values: typeof form.values) => {
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

            startTransition(async () => {
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
            });
        } catch (error) {
            logger.error('File upload error', error);
            notifications.show({
                title: '업로드 오류',
                message: '파일 업로드 중 오류가 발생했습니다.',
                color: 'red',
            });
        }
    };

    if (fetchError) {
        return (
            <Container size="sm" py={rem(60)}>
                <Text c="red" fw={600}>{fetchError}</Text>
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
                        onClick={() => router.push(`/dashboard/notifications/${id}`)}
                    >
                        돌아가기
                    </Button>
                </Group>

                <Stack gap="xs" mb={rem(40)}>
                    <Title order={1} style={{ fontSize: rem(32), fontWeight: 800, color: '#333' }}>
                        공지사항 수정
                    </Title>
                    <Text c="dimmed" size="lg">내용을 수정한 후 저장하세요.</Text>
                </Stack>

                <Paper radius="lg" p={rem(40)} pos="relative" style={glassStyle}>
                    <LoadingOverlay visible={isFetching || isPending} overlayProps={{ radius: 'lg', blur: 2 }} />

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
                                                <ActionIcon
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
                                                            <ActionIcon color="red" size="xs" radius="xl" variant="filled" style={{ position: 'absolute', top: 5, right: 5 }} onClick={() => setNewImages((prev) => prev.filter((_, i) => i !== idx))}>
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
                                                    <ActionIcon color="red" variant="subtle" onClick={() => setExistingFiles((prev) => prev.filter((_, i) => i !== idx))}>
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
                                                            <ActionIcon color="red" variant="subtle" onClick={() => setNewFiles((prev) => prev.filter((_, i) => i !== idx))}>
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
