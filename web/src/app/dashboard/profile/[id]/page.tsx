'use client';

import { getAdminStep } from '@/lib/shared';
import type { FcProfile, FcStatus } from '@/types/fc';
import { supabase } from '@/lib/supabase';
import {
    ActionIcon,
    Avatar,
    Badge,
    Box,
    Button,
    Card,
    Container,
    Divider,
    Grid,
    Group,
    LoadingOverlay,
    Stack,
    Text,
    Textarea,
    TextInput,
    ThemeIcon,
    Timeline,
    Title
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
    IconArrowLeft,
    IconBuilding,
    IconCheck,
    IconDeviceFloppy,
    IconEdit,
    IconFileText,
    IconMail,
    IconMapPin,
    IconPhone
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';

// --- Constants ---
const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BACKGROUND = '#f8f9fa';

// --- Types ---
type FcProfileDetail = {
    id: string;
    name: string;
    phone: string;
    resident_id_masked: string | null;
    address: string | null;
    email: string | null;
    affiliation: string | null;
    step?: string; // Optional since it's not in DB
    status: FcStatus;
    career_type: string | null; // 신입/경력
    temp_id?: string | null;
    identity_completed?: boolean | null;
    created_at: string;
    appointment_schedule_life?: string | null;
    appointment_schedule_nonlife?: string | null;
    appointment_date_life: string | null; // 위촉 예정일 (Life)
    appointment_date_nonlife: string | null; // 위촉 예정일 (NonLife)
    appointment_date_life_sub?: string | null;
    appointment_date_nonlife_sub?: string | null;
    allowance_date: string | null;
    fc_documents?: FcDocument[];
    admin_memo: string | null;
};

type FcDocument = {
    id: string;
    doc_type: string;
    file_name: string;
    status: string;
    created_at: string;
    storage_path: string;
};

export default function FcProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { id: fcId } = use(params);

    const [isEditing, setIsEditing] = useState(false);
    const [memo, setMemo] = useState('');

    // --- Fetch Data ---
    const { data: profile, isLoading: isProfileLoading } = useQuery({
        queryKey: ['fc-profile', fcId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('fc_profiles')
                .select('*, fc_documents(*)')
                .eq('id', fcId)
                .single();
            if (error) throw error;
            return data as FcProfileDetail;
        },
        enabled: !!fcId,
    });

    const { data: documents } = useQuery({
        queryKey: ['fc-documents', fcId],
        queryFn: async () => {
            // Need profile phone to link documents
            if (!profile?.phone) return [];

            const { data: docs, error: docError } = await supabase
                .from('fc_documents')
                .select('*')
                .eq('resident_id', profile.phone)
                .order('created_at', { ascending: false });

            if (docError) throw docError;
            return docs as FcDocument[];
        },
        enabled: !!profile?.phone,
    });

    // --- Form ---
    const form = useForm({
        initialValues: {
            name: '',
            phone: '',
            address: '',
            email: '',
            affiliation: '',
            career_type: '',
        },
    });

    // Sync Form with Data
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    useEffect(() => {
        if (profile) {
            form.setValues({
                name: profile.name || '',
                phone: profile.phone || '',
                address: profile.address || '',
                email: profile.email || '',
                affiliation: profile.affiliation || '',
                career_type: profile.career_type || '', // Assuming column exists
            });
            setMemo(profile.admin_memo || '');
        }
    }, [profile]);

    // --- Mutations ---
    const updateProfileMutation = useMutation({
        mutationFn: async (values: typeof form.values) => {
            const { error } = await supabase
                .from('fc_profiles')
                .update(values)
                .eq('id', fcId);
            if (error) throw error;
        },
        onSuccess: () => {
            notifications.show({ title: '저장 완료', message: '프로필 정보가 수정되었습니다.', color: 'green' });
            setIsEditing(false);
            queryClient.invalidateQueries({ queryKey: ['fc-profile', fcId] });
        },
        onError: (err: Error) => notifications.show({ title: '저장 실패', message: err.message, color: 'red' }),
    });

    const saveMemoMutation = useMutation({
        mutationFn: async () => {
            const { error } = await supabase
                .from('fc_profiles')
                .update({ admin_memo: memo })
                .eq('id', fcId);
            if (error) throw error;
        },
        onSuccess: () => notifications.show({ title: '메모 저장', message: '관리자 메모가 저장되었습니다.', color: 'green' }),
        onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
    });

    // --- Helpers ---
    const handleSaveInfo = () => updateProfileMutation.mutate(form.values);

    const getBirthDate = (residentNum: string | null) => {
        if (!residentNum) return '-';
        const digits = residentNum.replace(/\D/g, '');
        if (digits.length < 6) return '-';
        const prefix = digits.substring(0, 6);
        return `${prefix.substring(0, 2)}.${prefix.substring(2, 4)}.${prefix.substring(4, 6)}`;
    };

    const getStepColor = (stepLabel: string) => {
        if (stepLabel.includes('완료') || stepLabel.includes('4단계')) return 'green';
        return 'blue';
    };

    if (isProfileLoading) return <LoadingOverlay visible />;
    if (!profile) return <Container py="xl"><Text>FC 정보를 찾을 수 없습니다.</Text></Container>;

    const adminStepLabel = getAdminStep(profile as unknown as FcProfile);

    return (
        <Box bg={BACKGROUND} style={{ minHeight: '100vh' }}>
            {/* Header */}
            <Box bg="white" style={{ borderBottom: '1px solid #e9ecef' }} py="md" px="xl">
                <Container size="xl" p={0}>
                    <Group justify="space-between" mb="xs">
                        <Button variant="subtle" color="gray" size="xs" leftSection={<IconArrowLeft size={14} />} onClick={() => router.back()}>
                            목록으로 돌아가기
                        </Button>
                        <Badge size="lg" variant="gradient" gradient={{ from: 'orange', to: 'red' }}>
                            {profile.status === 'final-link-sent' ? '활동중' : profile.status}
                        </Badge>
                    </Group>

                    <Group align="center" gap="xl">
                        <Avatar size={80} radius="xl" color="orange" variant="filled">
                            {profile.name[0]}
                        </Avatar>

                        <Stack gap={4}>
                            <Group gap="xs" align="center">
                                <Title order={2} c={CHARCOAL}>{profile.name}</Title>
                                <Badge variant="light" color={!profile.career_type ? 'gray' : 'blue'}>{profile.career_type || '조회중'}</Badge>
                            </Group>
                            <Group gap="lg">
                                <Group gap={4}>
                                    <ThemeIcon size="xs" variant="transparent" color="gray"><IconBuilding /></ThemeIcon>
                                    <Text size="sm" c={MUTED}>{profile.affiliation || '소속 미정'}</Text>
                                </Group>
                                <Group gap={4}>
                                    <ThemeIcon size="xs" variant="transparent" color="gray"><IconPhone /></ThemeIcon>
                                    <Text size="sm" c={MUTED}>{profile.phone}</Text>
                                </Group>
                            </Group>
                        </Stack>

                        <Stack gap={0} ml="auto" align="flex-end">
                            <Text size="xs" c="dimmed" fw={700} tt="uppercase">Current Step</Text>
                            <Text size="xl" fw={800} c={getStepColor(adminStepLabel)}>{adminStepLabel}</Text>
                        </Stack>
                    </Group>
                </Container>
            </Box>

            {/* Body */}
            <Container size="xl" py="xl">
                <Grid gutter="lg">

                    {/* Left Column: Info */}
                    <Grid.Col span={{ base: 12, md: 7 }}>
                        <Card shadow="sm" radius="md" withBorder>
                            <Group justify="space-between" mb="md">
                                <Title order={4} c={CHARCOAL}>상세 회원가입</Title>
                                {isEditing ? (
                                    <Group gap="xs">
                                        <Button variant="default" size="xs" onClick={() => setIsEditing(false)}>취소</Button>
                                        <Button color="green" size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={handleSaveInfo} loading={updateProfileMutation.isPending}>저장</Button>
                                    </Group>
                                ) : (
                                    <Button variant="subtle" color="orange" size="xs" leftSection={<IconEdit size={14} />} onClick={() => setIsEditing(true)}>수정</Button>
                                )}
                            </Group>

                            <Stack gap="md">
                                <Grid>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="이름"
                                            variant={isEditing ? 'default' : 'unstyled'}
                                            readOnly={!isEditing}
                                            {...form.getInputProps('name')}
                                            styles={{ input: { fontWeight: 600, color: CHARCOAL } }}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="연락처"
                                            variant={isEditing ? 'default' : 'unstyled'}
                                            readOnly={!isEditing}
                                            {...form.getInputProps('phone')}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="주민등록번호"
                                            variant="unstyled"
                                            readOnly
                                            value={profile.resident_id_masked || '-'}
                                        />
                                        <Text size="xs" c="dimmed" mt={4}>생년월일: {getBirthDate(profile.resident_id_masked)}</Text>
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="이메일"
                                            leftSection={isEditing && <IconMail size={16} />}
                                            variant={isEditing ? 'default' : 'unstyled'}
                                            readOnly={!isEditing}
                                            {...form.getInputProps('email')}
                                            placeholder={isEditing ? 'example@email.com' : '-'}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={12}>
                                        <TextInput
                                            label="주소"
                                            leftSection={isEditing && <IconMapPin size={16} />}
                                            variant={isEditing ? 'default' : 'unstyled'}
                                            readOnly={!isEditing}
                                            {...form.getInputProps('address')}
                                            placeholder={isEditing ? '주소를 입력하세요' : '-'}
                                        />
                                    </Grid.Col>
                                </Grid>

                                <Divider label="위촉/계약 정보" labelPosition="center" />

                                <Grid>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="경력 구분"
                                            variant={isEditing ? 'default' : 'unstyled'}
                                            readOnly={!isEditing}
                                            {...form.getInputProps('career_type')}
                                            placeholder="신입/경력"
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="소속 (지점)"
                                            variant={isEditing ? 'default' : 'unstyled'}
                                            readOnly={!isEditing}
                                            {...form.getInputProps('affiliation')}
                                        />
                                    </Grid.Col>
                                </Grid>
                            </Stack>
                        </Card>
                    </Grid.Col>

                    {/* Right Column: Memo & Docs */}
                    <Grid.Col span={{ base: 12, md: 5 }}>
                        <Stack gap="lg">
                            {/* Admin Memo */}
                            <Card shadow="sm" radius="md" withBorder bg="yellow.0">
                                <Group justify="space-between" mb="sm">
                                    <Title order={5} c="orange.9">관리자 메모</Title>
                                    <ActionIcon variant="light" color="orange" onClick={() => saveMemoMutation.mutate()} loading={saveMemoMutation.isPending}>
                                        <IconCheck size={16} />
                                    </ActionIcon>
                                </Group>
                                <Textarea
                                    placeholder="관리자 전용 특이사항을 입력하세요."
                                    minRows={4}
                                    autosize
                                    variant="filled"
                                    value={memo}
                                    onChange={(e) => setMemo(e.currentTarget.value)}
                                    styles={{ input: { backgroundColor: 'white' } }}
                                />
                            </Card>

                            {/* Documents Timeline */}
                            <Card shadow="sm" radius="md" withBorder>
                                <Title order={5} mb="md" c={CHARCOAL}>제출 서류 이력</Title>
                                {documents && documents.length > 0 ? (
                                    <Timeline active={documents.length} bulletSize={24} lineWidth={2}>
                                        {documents.map((doc) => (
                                            <Timeline.Item
                                                key={doc.id}
                                                bullet={<IconFileText size={12} />}
                                                title={doc.doc_type}
                                                lineVariant={doc.status === 'approved' ? 'solid' : 'dashed'}
                                            >
                                                <Text c="dimmed" size="xs" mt={4}>{dayjs(doc.created_at).format('YYYY-MM-DD HH:mm')}</Text>
                                                <Group mt={4}>
                                                    <Badge size="xs" color={doc.status === 'approved' ? 'green' : doc.status === 'rejected' ? 'red' : 'blue'}>
                                                        {doc.status}
                                                    </Badge>
                                                    <Text size="xs" c={HANWHA_ORANGE} style={{ cursor: 'pointer' }} onClick={() => notifications.show({ message: '문서 관리 메뉴에서 확인하세요.', color: 'blue' })}>
                                                        View
                                                    </Text>
                                                </Group>
                                            </Timeline.Item>
                                        ))}
                                    </Timeline>
                                ) : (
                                    <Text size="sm" c="dimmed" ta="center" py="xl">제출된 서류가 없습니다.</Text>
                                )}
                            </Card>
                        </Stack>
                    </Grid.Col>
                </Grid>
            </Container>
        </Box>
    );
}
