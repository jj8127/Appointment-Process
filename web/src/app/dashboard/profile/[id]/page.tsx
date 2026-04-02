'use client';

import { fetchPresence } from '@/lib/presence-api';
import { formatPresenceLabel } from '@/lib/presence';
import { getAdminStepDisplay, getStatusDisplay } from '@/lib/shared';
import { useSession } from '@/hooks/use-session';
import { RecommenderSelect } from '@/components/RecommenderSelect';
import type { FcProfile, FcStatus } from '@/types/fc';
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
import { use, useCallback, useEffect, useState } from 'react';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const trimValue = (value?: string | null) => String(value ?? '').trim();

const getRecommenderDisplay = (profile?: Pick<FcProfile, 'recommender' | 'recommender_fc_id'> | null) => {
    const recommenderValue = trimValue(profile?.recommender) || '-';
    if (trimValue(profile?.recommender_fc_id)) {
        return {
            label: '연결된 추천인 FC',
            value: recommenderValue,
            helperText: null,
        };
    }
    if (trimValue(profile?.recommender)) {
        return {
            label: '레거시 추천인 표시값',
            value: recommenderValue,
            helperText: '현재 값은 예전 가입 데이터에 남은 표시값이며, 구조화 추천인 연결은 아닙니다.',
        };
    }
    return {
        label: '연결된 추천인 FC',
        value: '-',
        helperText: null,
    };
};

const readSignupReferralCode = (payload: unknown) => {
    if (!isRecord(payload)) return null;
    const signupReferralCode = 'signupReferralCode' in payload
        ? payload.signupReferralCode
        : ('inviteeReferralCode' in payload ? payload.inviteeReferralCode : null);
    return typeof signupReferralCode === 'string' && signupReferralCode.trim() ? signupReferralCode : null;
};

// --- Constants ---
const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BACKGROUND = '#f8f9fa';

// --- Types ---
type FcProfileDetail = Omit<FcProfile, 'fc_documents' | 'career_type' | 'status'> & {
    step?: string;
    status: FcStatus;
    career_type: FcProfile['career_type'];
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
    const { hydrated, role, isReadOnly } = useSession();

    const [isEditing, setIsEditing] = useState(false);
    const [selectedRecommenderFcId, setSelectedRecommenderFcId] = useState<string | null>(null);
    const [clearRecommenderSelection, setClearRecommenderSelection] = useState(false);
    const [recommenderOverrideReason, setRecommenderOverrideReason] = useState('');

    // --- Form ---
    const form = useForm({
        initialValues: {
            name: '',
            phone: '',
            address: '',
            address_detail: '',
            email: '',
            affiliation: '',
            career_type: '',
            recommender: '',
            admin_memo: '',
        },
    });

    // --- Fetch Data ---
    const { data: profile, isLoading: isProfileLoading, error: profileError } = useQuery({
        queryKey: ['fc-profile', fcId],
        queryFn: async () => {
            const resp = await fetch('/api/admin/fc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    action: 'getProfile',
                    payload: { fcId },
                }),
            });

            const json: unknown = await resp.json().catch(() => null);
            if (!resp.ok || !isRecord(json) || json.ok !== true || !isRecord(json.profile)) {
                if (isRecord(json) && typeof json.error === 'string' && json.error.trim()) {
                    throw new Error(json.error);
                }
                throw new Error('FC 상세 정보를 불러오지 못했습니다.');
            }
            return json.profile as unknown as FcProfileDetail;
        },
        enabled: !!fcId,
    });

    const { data: presence, isError: isPresenceError } = useQuery({
        queryKey: ['fc-profile-presence', profile?.phone],
        queryFn: async () => {
            const rows = await fetchPresence([profile?.phone]);
            return rows[0] ?? null;
        },
        enabled: Boolean(profile?.phone),
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
    });

    const recommenderDisplay = getRecommenderDisplay(profile);

    const { data: residentNumberFull } = useQuery({
        queryKey: ['fc-resident-number-full', fcId, role],
        enabled: hydrated && (role === 'admin' || role === 'manager') && !!fcId,
        queryFn: async () => {
            const resp = await fetch('/api/admin/resident-numbers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ fcIds: [fcId] }),
            });

            const json: unknown = await resp.json().catch(() => null);
            if (!resp.ok || !isRecord(json) || json.ok !== true || !isRecord(json.residentNumbers)) {
                return null;
            }

            const residentNumbers = json.residentNumbers as Record<string, unknown>;
            const value = residentNumbers[fcId];
            return typeof value === 'string' && value.trim() ? value : null;
        },
    });

    // Sync Form with Data
    useEffect(() => {
        if (profile) {
            form.setValues({
                name: profile.name || '',
                phone: profile.phone || '',
                address: profile.address || '',
                address_detail: profile.address_detail || '',
                email: profile.email || '',
                affiliation: profile.affiliation || '',
                career_type: profile.career_type || '',
                recommender: profile.recommender || '',
                admin_memo: profile.admin_memo || '',
            });
            setSelectedRecommenderFcId(profile.recommender_fc_id ?? null);
            setClearRecommenderSelection(false);
            setRecommenderOverrideReason('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profile]);

    const hasAnyRecommender = Boolean(profile?.recommender_fc_id || form.values.recommender.trim());
    const isRecommenderDirty = profile
        ? clearRecommenderSelection
            ? hasAnyRecommender
            : (profile.recommender_fc_id ?? null) !== selectedRecommenderFcId
        : false;
    const isRecommenderReasonMissing = isRecommenderDirty && !recommenderOverrideReason.trim();

    // --- Mutations ---
    const updateProfileMutation = useMutation({
        mutationFn: async (values: typeof form.values) => {
            const normalizedCareerType = values.career_type.trim();
            const payload: Record<string, unknown> = {
                name: values.name.trim(),
                phone: values.phone.trim(),
                affiliation: values.affiliation.trim(),
                address: values.address.trim() || null,
                address_detail: values.address_detail.trim() || null,
                email: values.email.trim() || null,
                career_type: normalizedCareerType === '신입' || normalizedCareerType === '경력' ? normalizedCareerType : null,
            };
            if (isRecommenderDirty) {
                payload.recommenderFcId = clearRecommenderSelection ? null : selectedRecommenderFcId;
                payload.recommenderOverrideReason = recommenderOverrideReason.trim();
            }

            const resp = await fetch('/api/admin/fc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'updateProfile',
                    payload: {
                        fcId,
                        data: payload,
                        phone: profile?.phone ?? payload.phone,
                    },
                }),
            });

            const json: unknown = await resp.json().catch(() => null);
            if (!resp.ok) {
                if (isRecord(json) && typeof json.error === 'string' && json.error.trim()) {
                    throw new Error(json.error);
                }
                throw new Error('프로필 저장에 실패했습니다.');
            }
            return json;
        },
        onSuccess: () => {
            notifications.show({ title: '저장 완료', message: '프로필 정보가 수정되었습니다.', color: 'green' });
            setIsEditing(false);
            setClearRecommenderSelection(false);
            setRecommenderOverrideReason('');
            queryClient.invalidateQueries({ queryKey: ['fc-profile', fcId] });
            queryClient.invalidateQueries({ queryKey: ['fc-signup-referral-code', fcId] });
        },
        onError: (err: Error) => notifications.show({ title: '저장 실패', message: err.message, color: 'red' }),
    });

    const { data: signupReferralCode, isFetching: isSignupReferralCodeFetching } = useQuery({
        queryKey: ['fc-signup-referral-code', fcId],
        queryFn: async () => {
            const resp = await fetch('/api/admin/fc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getInviteeReferralCode', payload: { fcId } }),
            });
            const json: unknown = await resp.json().catch(() => null);
            return readSignupReferralCode(json);
        },
        enabled: !!fcId && hydrated && (role === 'admin' || role === 'manager'),
    });

    const saveMemoMutation = useMutation({
        mutationFn: async () => {
            const resp = await fetch('/api/admin/fc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'updateProfile',
                    payload: {
                        fcId,
                        data: { admin_memo: form.values.admin_memo },
                    },
                }),
            });

            const json: unknown = await resp.json().catch(() => null);
            if (!resp.ok) {
                if (isRecord(json) && typeof json.error === 'string' && json.error.trim()) {
                    throw new Error(json.error);
                }
                throw new Error('관리자 메모 저장에 실패했습니다.');
            }
        },
        onSuccess: () => {
            notifications.show({ title: '메모 저장', message: '관리자 메모가 저장되었습니다.', color: 'green' });
            queryClient.invalidateQueries({ queryKey: ['fc-profile', fcId] });
        },
        onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
    });

    // --- Helpers ---
    const canEdit = hydrated && role === 'admin' && !isReadOnly;

    const handleSaveInfo = () => {
        if (!canEdit) {
            notifications.show({ title: '권한 없음', message: '관리자 계정에서만 수정할 수 있습니다.', color: 'yellow' });
            return;
        }
        if (!form.values.name.trim() || !form.values.phone.trim() || !form.values.affiliation.trim()) {
            notifications.show({ title: '입력 확인', message: '이름, 연락처, 소속은 비워둘 수 없습니다.', color: 'yellow' });
            return;
        }
        updateProfileMutation.mutate(form.values);
    };

    const handleCancelEdit = useCallback(() => {
        if (profile) {
            form.setValues({
                name: profile.name || '',
                phone: profile.phone || '',
                address: profile.address || '',
                address_detail: profile.address_detail || '',
                email: profile.email || '',
                affiliation: profile.affiliation || '',
                career_type: profile.career_type || '',
                recommender: profile.recommender || '',
                admin_memo: profile.admin_memo || '',
            });
            setSelectedRecommenderFcId(profile.recommender_fc_id ?? null);
            setClearRecommenderSelection(false);
            setRecommenderOverrideReason('');
        }
        setIsEditing(false);
    }, [form, profile]);

    const getBirthDate = (residentNum: string | null) => {
        if (!residentNum) return '-';
        const digits = residentNum.replace(/\D/g, '');
        if (digits.length < 6) return '-';
        const prefix = digits.substring(0, 6);
        return `${prefix.substring(0, 2)}.${prefix.substring(2, 4)}.${prefix.substring(4, 6)}`;
    };

    useEffect(() => {
        if (!canEdit && isEditing) {
            handleCancelEdit();
        }
    }, [canEdit, isEditing, handleCancelEdit]);

    if (isProfileLoading) return <LoadingOverlay visible />;
    if (profileError) {
        return (
            <Container py="xl">
                <Text>FC 상세 정보를 불러오지 못했습니다.</Text>
            </Container>
        );
    }
    if (!profile) return <Container py="xl"><Text>FC 정보를 찾을 수 없습니다.</Text></Container>;

    const residentNumberDisplay = residentNumberFull ?? '주민번호 조회 실패';
    const adminStepDisplay = getAdminStepDisplay(profile);
    const documents = profile.fc_documents ?? [];
    const presenceLabel = isPresenceError
        ? '활동 정보 확인 불가'
        : presence
            ? (formatPresenceLabel(presence) ?? '첫 접속 전')
            : '첫 접속 전';
    const presenceBadgeColor = isPresenceError ? 'gray' : presence?.is_online ? 'green' : 'gray';
    const presenceBadgeVariant = !isPresenceError && presence?.is_online ? 'filled' : 'light';
    const statusDisplay = getStatusDisplay(profile);
    const statusTextColor = statusDisplay.color === 'gray' ? 'dimmed' : statusDisplay.color;

    return (
        <Box bg={BACKGROUND} style={{ minHeight: '100vh' }}>
            {/* Header */}
            <Box bg="white" style={{ borderBottom: '1px solid #e9ecef' }} py="md" px="xl">
                <Container size="xl" p={0}>
                    <Group justify="space-between" mb="xs">
                        <Button variant="subtle" color="gray" size="xs" leftSection={<IconArrowLeft size={14} />} onClick={() => router.back()}>
                            목록으로 돌아가기
                        </Button>
                        <Badge size="lg" color={presenceBadgeColor} variant={presenceBadgeVariant}>
                            {presenceLabel}
                        </Badge>
                    </Group>

                    <Group align="center" gap="xl">
                        <Avatar size={80} radius="xl" color="orange" variant="filled">
                            {profile.name[0]}
                        </Avatar>

                        <Stack gap={4}>
                            <Group gap="xs" align="center">
                                <Title order={2} c={CHARCOAL}>{profile.name}</Title>
                                <Badge variant="light" color={!profile.career_type ? 'gray' : 'blue'}>{profile.career_type || '미입력'}</Badge>
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
                            <Text size="xl" fw={800} c={adminStepDisplay.color}>{adminStepDisplay.label}</Text>
                            <Text size="sm" c={statusTextColor}>{statusDisplay.label}</Text>
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
                                <Button variant="default" size="xs" onClick={handleCancelEdit} disabled={!canEdit}>취소</Button>
                            <Button color="green" size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={handleSaveInfo} loading={updateProfileMutation.isPending} disabled={!canEdit || isRecommenderReasonMissing}>저장</Button>
                                    </Group>
                                ) : (
                                    <Button
                                        variant={canEdit ? 'filled' : 'default'}
                                        color={canEdit ? 'orange' : 'gray'}
                                        size="sm"
                                        radius="xl"
                                        leftSection={<IconEdit size={16} />}
                                        onClick={() => setIsEditing(true)}
                                        disabled={!canEdit}
                                        styles={
                                            canEdit
                                                ? {
                                                    root: { boxShadow: '0 10px 24px rgba(243, 111, 33, 0.22)' },
                                                    label: { fontWeight: 700 },
                                                }
                                                : undefined
                                        }
                                    >
                                        수정
                                    </Button>
                                )}
                            </Group>

                            <Stack gap="md">
                                <Grid>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="이름"
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={!isEditing || !canEdit}
                                            {...form.getInputProps('name')}
                                            styles={{ input: { fontWeight: 600, color: CHARCOAL } }}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="연락처"
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={!isEditing || !canEdit}
                                            {...form.getInputProps('phone')}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="주민등록번호"
                                            variant="unstyled"
                                            readOnly
                                            value={residentNumberDisplay || '-'}
                                        />
                                        <Text size="xs" c="dimmed" mt={4}>생년월일: {getBirthDate(residentNumberDisplay)}</Text>
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="이메일"
                                            leftSection={isEditing && canEdit ? <IconMail size={16} /> : undefined}
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={!isEditing || !canEdit}
                                            {...form.getInputProps('email')}
                                            placeholder={isEditing && canEdit ? 'example@email.com' : '-'}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={12}>
                                        <TextInput
                                            label="주소"
                                            leftSection={isEditing && canEdit ? <IconMapPin size={16} /> : undefined}
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={!isEditing || !canEdit}
                                            {...form.getInputProps('address')}
                                            placeholder={isEditing && canEdit ? '주소를 입력하세요' : '-'}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={12}>
                                        <TextInput
                                            label="상세주소"
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={!isEditing || !canEdit}
                                            {...form.getInputProps('address_detail')}
                                            placeholder={isEditing && canEdit ? '상세주소를 입력하세요' : '-'}
                                        />
                                    </Grid.Col>
                                </Grid>

                                <Divider label="위촉/계약 정보" labelPosition="center" />

                                <Grid>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="경력 구분"
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={!isEditing || !canEdit}
                                            {...form.getInputProps('career_type')}
                                            placeholder="신입/경력"
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="소속 (지점)"
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={!isEditing || !canEdit}
                                            {...form.getInputProps('affiliation')}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        {isEditing && canEdit ? (
                                            <Stack gap={6}>
                                                <Box style={{ flex: 1 }}>
                                                    <RecommenderSelect
                                                        label="추천인 연결 FC"
                                                        value={clearRecommenderSelection ? null : selectedRecommenderFcId}
                                                        inviteeFcId={fcId}
                                                        onChange={(candidate) => {
                                                            setSelectedRecommenderFcId(candidate?.fcId ?? null);
                                                            setClearRecommenderSelection(false);
                                                        }}
                                                    />
                                                </Box>
                                                <Text size="xs" fw={600} c="dimmed">
                                                    가입 시 입력한 추천코드:{' '}
                                                    <Text component="span" size="xs" fw={700} c="orange">
                                                        {isSignupReferralCodeFetching ? '조회 중...' : (signupReferralCode ?? '-')}
                                                    </Text>
                                                </Text>
                                                {profile?.recommender && !profile.recommender_fc_id && !clearRecommenderSelection ? (
                                                    <Text size="xs" c="dimmed">
                                                        현재 레거시 추천인 표시값: {profile.recommender}
                                                    </Text>
                                                ) : null}
                                                {hasAnyRecommender ? (
                                                    <Group gap="xs">
                                                        <Button
                                                            size="xs"
                                                            variant="light"
                                                            color="gray"
                                                            onClick={() => {
                                                                setSelectedRecommenderFcId(null);
                                                                setClearRecommenderSelection(true);
                                                            }}
                                                        >
                                                            추천인 연결 해제
                                                        </Button>
                                                    </Group>
                                                ) : null}
                                                {isRecommenderDirty ? (
                                                    <Textarea
                                                        label="추천인 변경 사유"
                                                        placeholder="운영 수정 사유 입력"
                                                        value={recommenderOverrideReason}
                                                        onChange={(event) => setRecommenderOverrideReason(event.currentTarget.value)}
                                                        minRows={2}
                                                    />
                                                ) : null}
                                            </Stack>
                                        ) : (
                                            <Stack gap={6}>
                                                <Text size="sm" fw={500} c={CHARCOAL}>{recommenderDisplay.label}</Text>
                                                <Text size="md" c={CHARCOAL}>
                                                    {recommenderDisplay.value}
                                                </Text>
                                                {recommenderDisplay.helperText ? (
                                                    <Text size="xs" c="dimmed">
                                                        {recommenderDisplay.helperText}
                                                    </Text>
                                                ) : null}
                                                <Text size="xs" fw={600} c="dimmed">
                                                    가입 시 입력한 추천코드:{' '}
                                                    <Text component="span" size="xs" fw={700} c="orange">
                                                        {isSignupReferralCodeFetching ? '조회 중...' : (signupReferralCode ?? '-')}
                                                    </Text>
                                                </Text>
                                            </Stack>
                                        )}
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
                                    <ActionIcon variant="light" color={canEdit ? 'orange' : 'gray'} onClick={() => saveMemoMutation.mutate()} loading={saveMemoMutation.isPending} disabled={!canEdit}>
                                        <IconCheck size={16} />
                                    </ActionIcon>
                                </Group>
                                <Textarea
                                    placeholder="관리자 전용 특이사항을 입력하세요."
                                    minRows={4}
                                    autosize
                                    variant="filled"
                                    readOnly={!canEdit}
                                    {...form.getInputProps('admin_memo')}
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
