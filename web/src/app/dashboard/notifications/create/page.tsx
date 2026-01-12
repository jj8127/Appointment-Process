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
import { IconArrowLeft, IconCheck, IconFile, IconPhoto, IconSend, IconUpload, IconX } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { z } from 'zod';
import { createNoticeAction } from '../actions';

import { logger } from '@/lib/logger';
const schema = z.object({
    category: z.string().min(1, '카테고리를 입력해주세요'),
    title: z.string().min(1, '제목을 입력해주세요'),
    body: z.string().min(1, '내용을 입력해주세요'),
});

const glassStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
};

export default function CreateNoticePage() {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [images, setImages] = useState<FileWithPath[]>([]);
    const [files, setFiles] = useState<FileWithPath[]>([]);

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const form = useForm({
        initialValues: {
            category: '공지사항',
            title: '',
            body: '',
        },
        validate: zodResolver(schema as any),
    });

    const uploadToSupabase = async (file: File) => {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${fileName}`;

        const { error } = await supabase.storage
            .from('notice-attachments')
            .upload(filePath, file);

        if (error) {
            logger.error('Upload Error:', error);
            throw new Error('파일 업로드 실패');
        }

        const { data } = supabase.storage
            .from('notice-attachments')
            .getPublicUrl(filePath);

        return data.publicUrl;
    };

    const handleSubmit = async (values: typeof form.values) => {
        try {
            // Upload Images
            const imageUrls = await Promise.all(
                images.map((img) => uploadToSupabase(img))
            );

            // Upload Files
            const fileObjects = await Promise.all(
                files.map(async (file) => {
                    const url = await uploadToSupabase(file);
                    return {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        url: url
                    };
                })
            );

            const formData = new FormData();
            formData.append('category', values.category);
            formData.append('title', values.title);
            formData.append('body', values.body);
            formData.append('images', JSON.stringify(imageUrls));
            formData.append('files', JSON.stringify(fileObjects));

            startTransition(async () => {
                const result = await createNoticeAction({ success: false }, formData);

                if (result.success) {
                    notifications.show({
                        title: '전송 완료',
                        message: result.message,
                        color: 'teal',
                        icon: <IconCheck size={18} />,
                        autoClose: 3000,
                    });
                    router.push('/dashboard/notifications');
                } else {
                    notifications.show({
                        title: '전송 실패',
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

    // Images Dropzone handlers
    const handleImageDrop = (files: FileWithPath[]) => {
        setImages((current) => [...current, ...files]);
    };

    const removeImage = (index: number) => {
        setImages((current) => current.filter((_, i) => i !== index));
    };

    // Files Dropzone handlers
    const handleFileDrop = (files: FileWithPath[]) => {
        setFiles((current) => [...current, ...files]);
    };

    const removeFile = (index: number) => {
        setFiles((current) => current.filter((_, i) => i !== index));
    };

    // Image previews
    const imagePreviews = images.map((file, index) => {
        const imageUrl = URL.createObjectURL(file);
        return (
            <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                layout
            >
                <div style={{ position: 'relative' }}>
                    <Image
                        src={imageUrl}
                        onLoad={() => URL.revokeObjectURL(imageUrl)}
                        radius="md"
                        h={100}
                        w="100%"
                        fit="cover"
                        style={{ border: '1px solid rgba(0,0,0,0.05)' }}
                    />
                    <ActionIcon
                        color="red"
                        size="xs"
                        radius="xl"
                        variant="filled"
                        style={{ position: 'absolute', top: 5, right: 5, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                        onClick={() => removeImage(index)}
                    >
                        <IconX size={12} />
                    </ActionIcon>
                </div>
            </motion.div>
        );
    });

    // File list
    const fileList = files.map((file, index) => (
        <motion.div
            key={index}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
        >
            <Paper withBorder p="xs" radius="sm" bg="gray.0">
                <Group justify="space-between">
                    <Group gap="xs">
                        <ThemeIcon color="blue" variant="light" radius="md">
                            <IconFile size={16} />
                        </ThemeIcon>
                        <Text size="sm" truncate="end" maw={200} fw={500}>
                            {file.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                            ({(file.size / 1024).toFixed(1)} KB)
                        </Text>
                    </Group>
                    <ActionIcon color="red" variant="subtle" onClick={() => removeFile(index)}>
                        <IconX size={16} />
                    </ActionIcon>
                </Group>
            </Paper>
        </motion.div>
    ));

    return (
        <Container size="sm" py={rem(60)}>
            {/* Background Decoration */}
            <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: -1,
                background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
                opacity: 0.5
            }} />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <Group mb="xl">
                    <Button
                        component={Link}
                        href="/dashboard/notifications"
                        variant="subtle"
                        color="gray"
                        leftSection={<IconArrowLeft size={18} />}
                        size="sm"
                        styles={{ root: { transition: 'transform 0.2s' }, label: { fontWeight: 500 } }}
                    >
                        목록으로 돌아가기
                    </Button>
                </Group>

                <Stack gap="xs" mb={rem(40)}>
                    <Title order={1} style={{ fontSize: rem(32), fontWeight: 800, color: '#333' }}>
                        공지사항 등록
                    </Title>
                    <Text c="dimmed" size="lg">
                        새로운 소식을 앱 사용자들에게 알리세요.
                    </Text>
                </Stack>

                <Paper
                    radius="lg"
                    p={rem(40)}
                    pos="relative"
                    style={glassStyle}
                >
                    <LoadingOverlay visible={isPending} overlayProps={{ radius: 'lg', blur: 2 }} />

                    <form onSubmit={form.onSubmit(handleSubmit)}>
                        <Stack gap="xl">
                            <TextInput
                                label="카테고리"
                                placeholder="예: 공지사항, 긴급, 이벤트"
                                size="md"
                                required
                                classNames={{ input: 'glass-input' }}
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

                            {/* Image Upload Section */}
                            <Box>
                                <Text size="sm" fw={600} mb="xs" c="dimmed">이미지 첨부</Text>
                                <Dropzone
                                    onDrop={handleImageDrop}
                                    onReject={(files) => logger.debug('rejected files', files)}
                                    maxSize={5 * 1024 * 1024}
                                    accept={IMAGE_MIME_TYPE}
                                    maxFiles={5}
                                    radius="md"
                                    style={{
                                        border: '2px dashed var(--mantine-color-gray-3)',
                                        backgroundColor: 'rgba(255,255,255,0.5)',
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    <Group justify="center" gap="xl" style={{ minHeight: rem(120), pointerEvents: 'none' }}>
                                        <Dropzone.Accept>
                                            <IconUpload
                                                style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-blue-6)' }}
                                                stroke={1.5}
                                            />
                                        </Dropzone.Accept>
                                        <Dropzone.Reject>
                                            <IconX
                                                style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-red-6)' }}
                                                stroke={1.5}
                                            />
                                        </Dropzone.Reject>
                                        <Dropzone.Idle>
                                            <IconPhoto
                                                style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-dimmed)' }}
                                                stroke={1.2}
                                            />
                                        </Dropzone.Idle>

                                        <div style={{ textAlign: 'center' }}>
                                            <Text size="lg" fw={500} inline>
                                                이미지를 여기에 놓으세요
                                            </Text>
                                            <Text size="sm" c="dimmed" inline mt={7}>
                                                또는 클릭하여 파일을 선택하세요 (최대 5개)
                                            </Text>
                                        </div>
                                    </Group>
                                </Dropzone>

                                <AnimatePresence>
                                    {images.length > 0 && (
                                        <SimpleGrid cols={{ base: 2, sm: 4 }} mt="md">
                                            {imagePreviews}
                                        </SimpleGrid>
                                    )}
                                </AnimatePresence>
                            </Box>

                            {/* File Upload Section */}
                            <Box>
                                <Text size="sm" fw={600} mb="xs" c="dimmed">파일 첨부</Text>
                                <Dropzone
                                    onDrop={handleFileDrop}
                                    onReject={(files) => logger.debug('rejected files', files)}
                                    maxSize={10 * 1024 * 1024}
                                    maxFiles={5}
                                    radius="md"
                                    style={{
                                        border: '2px dashed var(--mantine-color-gray-3)',
                                        backgroundColor: 'rgba(255,255,255,0.5)',
                                    }}
                                >
                                    <Group justify="center" gap="lg" style={{ minHeight: rem(80), pointerEvents: 'none' }}>
                                        <Dropzone.Accept>
                                            <IconUpload
                                                style={{ width: rem(40), height: rem(40), color: 'var(--mantine-color-blue-6)' }}
                                                stroke={1.5}
                                            />
                                        </Dropzone.Accept>
                                        <Dropzone.Reject>
                                            <IconX
                                                style={{ width: rem(40), height: rem(40), color: 'var(--mantine-color-red-6)' }}
                                                stroke={1.5}
                                            />
                                        </Dropzone.Reject>
                                        <Dropzone.Idle>
                                            <IconFile
                                                style={{ width: rem(40), height: rem(40), color: 'var(--mantine-color-dimmed)' }}
                                                stroke={1.2}
                                            />
                                        </Dropzone.Idle>

                                        <div style={{ textAlign: 'center' }}>
                                            <Text size="md" fw={500} inline>
                                                파일 업로드
                                            </Text>
                                            <Text size="sm" c="dimmed" inline mt={4}>
                                                드래그하거나 클릭 (최대 5개)
                                            </Text>
                                        </div>
                                    </Group>
                                </Dropzone>

                                <AnimatePresence>
                                    {files.length > 0 && (
                                        <Stack gap="xs" mt="sm">
                                            {fileList}
                                        </Stack>
                                    )}
                                </AnimatePresence>
                            </Box>

                            <Group justify="flex-end" mt="xl">
                                <Button
                                    type="submit"
                                    variant="gradient"
                                    gradient={{ from: 'orange', to: 'red' }}
                                    size="lg"
                                    radius="md"
                                    leftSection={<IconSend size={20} />}
                                    loading={isPending}
                                    style={{
                                        boxShadow: '0 4px 14px 0 rgba(232, 89, 12, 0.39)'
                                    }}
                                >
                                    전송하기
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                </Paper>
            </motion.div>
        </Container>
    );
}
