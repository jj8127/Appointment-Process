'use client';

import {
    Button,
    Container,
    Group,
    LoadingOverlay,
    Paper,
    Stack,
    Text,
    TextInput,
    Textarea,
    Title
} from '@mantine/core';
import { useForm, zodResolver } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconSend } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { z } from 'zod';
import { createNoticeAction } from '../actions';

const schema = z.object({
    category: z.string().min(1, '카테고리를 입력해주세요'),
    title: z.string().min(1, '제목을 입력해주세요'),
    body: z.string().min(1, '내용을 입력해주세요'),
});

export default function CreateNoticePage() {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const form = useForm({
        initialValues: {
            category: '공지사항',
            title: '',
            body: '',
        },
        validate: zodResolver(schema as any),
    });

    const handleSubmit = async (values: typeof form.values) => {
        const formData = new FormData();
        formData.append('category', values.category);
        formData.append('title', values.title);
        formData.append('body', values.body);

        startTransition(async () => {
            const result = await createNoticeAction({ success: false }, formData);

            if (result.success) {
                notifications.show({
                    title: '성공',
                    message: result.message,
                    color: 'green',
                });
                router.push('/dashboard/notifications');
            } else {
                notifications.show({
                    title: '실패',
                    message: result.message || '오류가 발생했습니다.',
                    color: 'red',
                });
                if (result.errors) {
                    form.setErrors(result.errors);
                }
            }
        });
    };

    return (
        <Container size="sm" py="xl">
            <Group mb="lg">
                <Button
                    component={Link}
                    href="/dashboard/notifications"
                    variant="subtle"
                    color="gray"
                    leftSection={<IconArrowLeft size={16} />}
                    size="xs"
                >
                    목록으로
                </Button>
            </Group>

            <Title order={2} mb="xs">
                공지사항 등록
            </Title>
            <Text c="dimmed" size="sm" mb="xl">
                앱 사용자 전체에게 푸시 알림과 함께 공지사항을 전송합니다.
            </Text>

            <Paper withBorder shadow="sm" radius="md" p="xl" pos="relative">
                <LoadingOverlay visible={isPending} overlayProps={{ radius: 'md', blur: 2 }} />

                <form onSubmit={form.onSubmit(handleSubmit)}>
                    <Stack gap="md">
                        <TextInput
                            withAsterisk
                            label="카테고리"
                            placeholder="예: 공지사항, 긴급, 이벤트"
                            {...form.getInputProps('category')}
                        />

                        <TextInput
                            withAsterisk
                            label="제목"
                            placeholder="제목을 입력하세요"
                            {...form.getInputProps('title')}
                        />

                        <Textarea
                            withAsterisk
                            label="내용"
                            placeholder="내용을 입력하세요"
                            minRows={6}
                            autosize
                            {...form.getInputProps('body')}
                        />

                        <Group justify="flex-end" mt="md">
                            <Button
                                type="submit"
                                color="orange"
                                size="md"
                                leftSection={<IconSend size={18} />}
                                loading={isPending}
                            >
                                전송하기
                            </Button>
                        </Group>
                    </Stack>
                </form>
            </Paper>
        </Container>
    );
}
