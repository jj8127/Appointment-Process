'use client';

import {
    isValidCareerType,
    requireMutationSuccess,
    requireProfileMutationReceipt,
} from '@/lib/user-intent-policy';
import { QueryReadError } from '@/lib/query-read-error';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';

import { fetchPresence } from '@/lib/presence-api';
import { formatPresenceLabel } from '@/lib/presence';
import { ADMIN_STEP_LABELS, getAdminStepDisplay, getStatusDisplay } from '@/lib/shared';
import { useResidentNumber } from '@/hooks/use-resident-number';
import { useSession } from '@/hooks/use-session';
import { showAdminNotificationWarning } from '@/lib/show-admin-notification-warning';
import { resolveAdminTempIdUpdate } from '@/lib/admin-temp-id-update';
import { RecommenderSelect } from '@/components/RecommenderSelect';
import { NotificationDestinationReady } from '@/components/NotificationDestinationReady';
import { ADMIN_DOCUMENT_STATUS_LABELS, isAdminFcProfileDetail } from '@/lib/admin-document-client';
import { isRecommenderSelectionResult } from '@/types/referrals';
import type { FcProfile } from '@/types/fc';
import {
    ActionIcon,
    Alert,
    Anchor,
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
    Select,
    ThemeIcon,
    Timeline,
    Title
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
    IconArrowLeft,
    IconBuilding,
    IconDeviceFloppy,
    IconEdit,
    IconFileText,
    IconInfoCircle,
    IconMail,
    IconMapPin,
    IconPhone
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './page.module.css';
import { HANWHA_ORANGE, CHARCOAL, MUTED } from '@/lib/brand-colors';

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
    if (!isRecord(payload) || (!('signupReferralCode' in payload) && !('inviteeReferralCode' in payload))) {
        throw new QueryReadError(200);
    }
    const signupReferralCode = 'signupReferralCode' in payload
        ? payload.signupReferralCode
        : ('inviteeReferralCode' in payload ? payload.inviteeReferralCode : null);
    if (signupReferralCode !== null && typeof signupReferralCode !== 'string') throw new QueryReadError(200);
    return typeof signupReferralCode === 'string' && signupReferralCode.trim() ? signupReferralCode : null;
};

// --- Constants ---

export default function FcProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id: fcId } = use(params);
    const { role, residentId, isReadOnly } = useSession();
    return <FcProfileContent key={`${role ?? ''}:${residentId ?? ''}:${isReadOnly ? 'read' : 'write'}:${fcId}`} fcId={fcId} />;
}

function FcProfileContent({ fcId }: { fcId: string }) {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { hydrated, role, isReadOnly } = useSession();

    const [memoDraft, setMemoDraft] = useState('');
    const memoSource = useRef<{ owner: string; value: string } | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const profileSubmitting = useRef(false);
    const memoSubmitting = useRef(false);
    const [isEditingRecommender, setIsEditingRecommender] = useState(false);
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
            temp_id: '',
            recommender: '',
            admin_memo: '',
        },
    });

    // --- Fetch Data ---
    const {
        data: profile,
        isLoading: isProfileLoading,
        isFetching: isProfileFetching,
        error: profileError,
        refetch: refetchProfile,
    } = useQuery({
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
            if (!resp.ok) throw new QueryReadError(resp.status);
            if (!isRecord(json) || json.ok !== true || !isAdminFcProfileDetail(json.profile) || json.profile.id !== fcId) throw new QueryReadError();
            return json.profile;
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

    const { residentNumberDisplay, birthDateDisplay } = useResidentNumber({ fcId });

    const hydratedOwner = useRef<string | null>(null);

    useEffect(() => {
        if (!profile) return;
        const storedMemo = profile.admin_memo || '';
        const previous = memoSource.current;
        setMemoDraft((draft) => previous?.owner === fcId && draft !== previous.value ? draft : storedMemo);
        memoSource.current = { owner: fcId, value: storedMemo };
    }, [profile, fcId]);

    // Refetch must not replace a draft owned by the current profile.
    // Sync Form with Data
    useEffect(() => {
        if (profile && (hydratedOwner.current !== fcId || (!isEditing && !isEditingRecommender && !form.isDirty()))) {
            hydratedOwner.current = fcId;
            form.setValues({
                name: profile.name || '',
                phone: profile.phone || '',
                address: profile.address || '',
                address_detail: profile.address_detail || '',
                email: profile.email || '',
                affiliation: profile.affiliation || '',
                career_type: profile.career_type || '',
                temp_id: profile.temp_id || '',
                recommender: profile.recommender || '',
                admin_memo: profile.admin_memo || '',
            });
            form.resetDirty();
            setSelectedRecommenderFcId(profile.recommender_fc_id ?? null);
            setClearRecommenderSelection(false);
            setRecommenderOverrideReason('');
            setIsEditingRecommender(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profile, fcId, isEditing, isEditingRecommender]);

    const hasAnyRecommender = Boolean(profile?.recommender_fc_id || profile?.recommender?.trim());
    const isRecommenderDirty = profile
        ? clearRecommenderSelection
            ? hasAnyRecommender
            : (profile.recommender_fc_id ?? null) !== selectedRecommenderFcId
        : false;

    // --- Mutations ---
    const updateProfileMutation = useMutation({
        mutationFn: async (values: typeof form.values) => {
            const normalizedCareerType = values.career_type.trim();
            if (!isValidCareerType(normalizedCareerType)) throw new Error("경력 구분은 신입 또는 경력을 선택해주세요.");
            const tempIdUpdate = resolveAdminTempIdUpdate(profile?.temp_id, values.temp_id);
            const payload: Record<string, unknown> = {
                name: values.name.trim(),
                phone: values.phone.trim(),
                affiliation: values.affiliation.trim(),
                address: values.address.trim() || null,
                address_detail: values.address_detail.trim() || null,
                email: values.email.trim() || null,
                career_type: normalizedCareerType === '신입' || normalizedCareerType === '경력' ? normalizedCareerType : null,
            };
            if (tempIdUpdate.changed) {
                payload.temp_id = tempIdUpdate.nextTempId;
            }
            const resp = await fetch('/api/admin/fc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'updateProfile',
                    payload: {
                        fcId,
                        data: payload,
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
            const receipt = requireProfileMutationReceipt(json, { id: fcId, ...payload });
            return { response: json, profile: receipt };
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['fc-profile', fcId], (current: unknown) =>
                isRecord(current) ? { ...current, ...result.profile } : current,
            );
            showAdminNotificationWarning(result.response);
            notifications.show({ title: '저장 완료', message: '프로필 정보가 수정되었습니다.', color: 'green' });
            form.resetDirty();
            setIsEditing(false);
            queryClient.invalidateQueries({ queryKey: ['fc-profile', fcId] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
            queryClient.invalidateQueries({ queryKey: ['fc-signup-referral-code', fcId] });
        },
        onError: (err: Error) => notifications.show({ title: '저장 실패', message: err.message, color: 'red' }),
        onSettled: () => { profileSubmitting.current = false; },
    });

    const updateRecommenderMutation = useMutation({
        mutationFn: async () => {
            const expectedInviterFcId = clearRecommenderSelection ? null : selectedRecommenderFcId;
            if (expectedInviterFcId === null && !clearRecommenderSelection) {
                throw new Error('추천인을 선택해주세요.');
            }
            const response = await fetch('/api/admin/fc/recommender', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    inviteeFcId: fcId,
                    inviterFcId: expectedInviterFcId,
                    reason: recommenderOverrideReason.trim(),
                }),
            });
            const json: unknown = await response.json().catch(() => null);
            if (!response.ok) {
                if (isRecord(json) && typeof json.error === 'string' && json.error.trim()) {
                    throw new Error(json.error);
                }
                throw new Error('추천인 관계 저장에 실패했습니다.');
            }
            requireMutationSuccess(json);
            if (!isRecord(json) || !isRecommenderSelectionResult(json.result, {
                inviteeFcId: fcId,
                inviterFcId: expectedInviterFcId,
            })) {
                throw new Error('추천인 관계 저장 결과를 확인하지 못했습니다.');
            }
            return json;
        },
        onSuccess: () => {
            notifications.show({ title: '저장 완료', message: '추천인 관계가 수정되었습니다.', color: 'green' });
            setIsEditingRecommender(false);
            setClearRecommenderSelection(false);
            setRecommenderOverrideReason('');
            queryClient.invalidateQueries({ queryKey: ['fc-profile', fcId] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
            queryClient.invalidateQueries({ queryKey: ['fc-signup-referral-code', fcId] });
        },
        onError: (err: Error) => {
            notifications.show({ title: '저장 실패', message: err.message, color: 'red' });
        },
    });

    const { data: signupReferralCode, isFetching: isSignupReferralCodeFetching, error: signupReferralCodeError, refetch: refetchSignupReferralCode } = useQuery({
        queryKey: ['fc-signup-referral-code', fcId],
        queryFn: async () => {
            const resp = await fetch('/api/admin/fc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getInviteeReferralCode', payload: { fcId } }),
            });
            const json: unknown = await resp.json().catch(() => null);
            if (!resp.ok || !isRecord(json) || json.ok !== true) throw new QueryReadError(resp.status);
            return readSignupReferralCode(json);
        },
        enabled: !!fcId && hydrated && (role === 'admin' || role === 'manager'),
    });

    const saveMemoMutation = useMutation({
        mutationFn: async (memo: string) => {
            const payload = { admin_memo: memo };
            const resp = await fetch('/api/admin/fc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'updateProfile',
                    payload: {
                        fcId,
                        data: payload,
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
            const receipt = requireProfileMutationReceipt(json, { id: fcId, ...payload });
            return { profile: receipt };
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['fc-profile', fcId], (current: unknown) =>
                isRecord(current) ? { ...current, ...result.profile } : current,
            );
            notifications.show({ title: '메모 저장', message: '관리자 메모가 저장되었습니다.', color: 'green' });
            queryClient.invalidateQueries({ queryKey: ['fc-profile', fcId] });
        },
        onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
        onSettled: () => { memoSubmitting.current = false; },
    });

    // --- Helpers ---
    const canEdit = hydrated && role === 'admin' && !isReadOnly;

    const handleSaveInfo = () => {
        if (!canEdit) {
            notifications.show({ title: '권한 없음', message: '관리자 계정에서만 수정할 수 있습니다.', color: 'yellow' });
            return;
        }
        if (profileSubmitting.current || updateProfileMutation.isPending) return;
        if (!form.values.name.trim() || !form.values.phone.trim() || !form.values.affiliation.trim()) {
            notifications.show({ title: '입력 확인', message: '이름, 연락처, 소속은 비워둘 수 없습니다.', color: 'yellow' });
            return;
        }
        profileSubmitting.current = true;
        updateProfileMutation.mutate(form.values);
    };

    const handleSaveMemo = () => {
        if (!canEdit || memoSubmitting.current || saveMemoMutation.isPending) return;
        memoSubmitting.current = true;
        saveMemoMutation.mutate(memoDraft);
    };

    const handleLeave = () => {
        if (profileSubmitting.current || memoSubmitting.current || updateProfileMutation.isPending
            || saveMemoMutation.isPending || updateRecommenderMutation.isPending) return;
        if ((!isEditing && !isEditingRecommender && memoDraft === (memoSource.current?.value ?? ''))
            || window.confirm('저장하지 않은 변경 내용을 버리고 나갈까요?')) router.back();
    };

    const handleCancelEdit = useCallback(() => {
        if (profileSubmitting.current || updateProfileMutation.isPending) return;
        if (form.isDirty() && !window.confirm('변경한 기본정보를 버릴까요?')) return;
        const memoDraft = form.values.admin_memo;
        if (profile) {
            form.setValues({
                name: profile.name || '',
                phone: profile.phone || '',
                address: profile.address || '',
                address_detail: profile.address_detail || '',
                email: profile.email || '',
                affiliation: profile.affiliation || '',
                career_type: profile.career_type || '',
                temp_id: profile.temp_id || '',
                recommender: profile.recommender || '',
                admin_memo: memoDraft,
            });
            setSelectedRecommenderFcId(profile.recommender_fc_id ?? null);
            setClearRecommenderSelection(false);
            setRecommenderOverrideReason('');
        }
        setIsEditing(false);
    }, [form, profile, updateProfileMutation.isPending]);

    const handleCancelRecommenderEdit = useCallback(() => {
        setSelectedRecommenderFcId(profile?.recommender_fc_id ?? null);
        setClearRecommenderSelection(false);
        setRecommenderOverrideReason('');
        setIsEditingRecommender(false);
    }, [profile]);

    const handleSaveRecommender = () => {
        if (!canEdit) {
            notifications.show({ title: '권한 없음', message: '추천인 관계를 수정할 수 없습니다.', color: 'yellow' });
            return;
        }
        if (!isRecommenderDirty) {
            notifications.show({ title: '변경 없음', message: '변경할 추천인을 선택해주세요.', color: 'yellow' });
            return;
        }
        if (!recommenderOverrideReason.trim()) {
            notifications.show({ title: '입력 확인', message: '추천인 변경 사유를 입력해주세요.', color: 'yellow' });
            return;
        }
        updateRecommenderMutation.mutate();
    };

    useEffect(() => {
        if (!canEdit && isEditing) {
            handleCancelEdit();
        }
    }, [canEdit, isEditing, handleCancelEdit]);

    const profileReadOnly = !isEditing || !canEdit || updateProfileMutation.isPending;

    if (isProfileLoading && !profile) return <LoadingOverlay visible />;
    if (profileError && !profile) {
        return (
            <Container py="xl">
                <QueryErrorAlert
                    error={profileError}
                    onRetry={refetchProfile}
                    isFetching={isProfileFetching}
                    hasData={false}
                    subject="FC 상세 정보"
                />
            </Container>
        );
    }
    if (!profile) return <Container py="xl"><Text>FC 정보를 찾을 수 없습니다.</Text></Container>;

    const adminStepDisplay = getAdminStepDisplay(profile);
    const documents = profile.fc_documents ?? [];
    const hasCachedPresence = presence !== undefined;
    const isPresenceUnavailable = isPresenceError && !hasCachedPresence;
    const presenceLabel = isPresenceUnavailable
        ? '활동 정보 확인 불가'
        : presence
            ? (formatPresenceLabel(presence) ?? '첫 접속 전')
            : '첫 접속 전';
    const presenceBadgeColor = presence?.is_online ? 'green' : 'gray';
    const presenceBadgeVariant = presence?.is_online ? 'filled' : 'light';
    const statusDisplay = getStatusDisplay(profile);
    const statusTextColor = statusDisplay.color === 'gray' ? 'dimmed' : statusDisplay.color;

    return (
        <div className={styles.page}>
            <NotificationDestinationReady />
            {profileError ? (
                <QueryErrorAlert
                    error={profileError}
                    onRetry={refetchProfile}
                    isFetching={isProfileFetching}
                    hasData
                    subject="FC 상세 정보"
                />
            ) : null}
            <Group justify="space-between">
                <Button variant="subtle" color="gray" size="xs" radius="xl" leftSection={<IconArrowLeft size={14} />} onClick={handleLeave}>
                    목록으로 돌아가기
                </Button>
            </Group>

            {/* Header card: identity, current step and the 0-5 step bar */}
            <section className={styles.card} style={{ '--i': 0 } as CSSProperties}>
                <div className={styles.headRow}>
                    <span className={styles.avatar}>{profile.name[0]}</span>
                    <Stack gap={6} style={{ minWidth: 0 }}>
                        <Group gap="xs" align="center">
                            <Title order={2} className={styles.name}>{profile.name}</Title>
                            <Badge variant="light" radius="xl" color={!profile.career_type ? 'gray' : 'blue'}>{profile.career_type || '미입력'}</Badge>
                            <Badge
                                radius="xl"
                                color={presenceBadgeColor}
                                variant={presenceBadgeVariant}
                                title={isPresenceError && hasCachedPresence ? '최근 활동 정보를 표시하고 있습니다. 갱신에 실패했습니다.' : undefined}
                            >
                                {presenceLabel}
                            </Badge>
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
                        <Text size="xl" fw={700} c={adminStepDisplay.color}>{adminStepDisplay.label}</Text>
                        <Text size="sm" c={statusTextColor}>{statusDisplay.label}</Text>
                    </Stack>
                </div>
                <div className={styles.stepBar} aria-label={`진행 단계 ${adminStepDisplay.label}`}>
                    {Object.values(ADMIN_STEP_LABELS ?? {}).map((label, index) => (
                        <span
                            key={label}
                            className={styles.stepSegment}
                            data-state={index < (adminStepDisplay.step ?? -1) ? 'done' : index === adminStepDisplay.step ? 'current' : 'todo'}
                        >
                            <i />
                            <span>{label}</span>
                        </span>
                    ))}
                </div>
            </section>

            {isReadOnly && (
                <Alert icon={<IconInfoCircle size={20} />} title="읽기 전용 모드" color="yellow" variant="light" radius="lg">
                    본부장 계정은 조회만 가능합니다. 수정 권한이 필요한 경우 관리자에게 문의하세요.
                </Alert>
            )}

            {/* Body */}
            <div>
                <Grid gutter="lg">

                    {/* Left Column: Info */}
                    <Grid.Col span={{ base: 12, md: 7 }}>
                        <Card radius={24} p="lg" className={styles.card} style={{ '--i': 1 } as CSSProperties}>
                            <Group justify="space-between" mb="md">
                                <Title order={4} c={CHARCOAL}>상세 회원가입</Title>
                                {isEditing ? (
                                    <Group gap="xs">
                                <Button variant="default" size="xs" onClick={handleCancelEdit} disabled={!canEdit}>취소</Button>
                            <Button color="orange" size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={handleSaveInfo} loading={updateProfileMutation.isPending} disabled={!canEdit}>저장</Button>
                                    </Group>
                                ) : (
                                    <Button
                                        variant={canEdit ? 'filled' : 'default'}
                                        color={canEdit ? 'dark' : 'gray'}
                                        size="sm"
                                        radius="xl"
                                        leftSection={<IconEdit size={16} />}
                                        onClick={() => setIsEditing(true)}
                                        disabled={!canEdit}
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
                                            readOnly={profileReadOnly}
                                            {...form.getInputProps('name')}
                                            styles={{ input: { fontWeight: 600, color: CHARCOAL } }}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="연락처"
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={profileReadOnly}
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
                                        <Text size="xs" c="dimmed" mt={4}>생년월일: {birthDateDisplay}</Text>
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="이메일"
                                            leftSection={isEditing && canEdit ? <IconMail size={16} /> : undefined}
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={profileReadOnly}
                                            {...form.getInputProps('email')}
                                            placeholder={isEditing && canEdit ? 'example@email.com' : '-'}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={12}>
                                        <TextInput
                                            label="주소"
                                            leftSection={isEditing && canEdit ? <IconMapPin size={16} /> : undefined}
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={profileReadOnly}
                                            {...form.getInputProps('address')}
                                            placeholder={isEditing && canEdit ? '주소를 입력하세요' : '-'}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={12}>
                                        <TextInput
                                            label="상세주소"
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={profileReadOnly}
                                            {...form.getInputProps('address_detail')}
                                            placeholder={isEditing && canEdit ? '상세주소를 입력하세요' : '-'}
                                        />
                                    </Grid.Col>
                                </Grid>

                                {signupReferralCodeError ? <QueryErrorAlert error={signupReferralCodeError} onRetry={() => void refetchSignupReferralCode()} subject="가입 추천코드" /> : null}
                                <Divider label="위촉/계약 정보" labelPosition="center" />

                                <Grid>
                                    <Grid.Col span={6}>
                                        <Select
                                            data={[{ value: '', label: '미입력' }, '신입', '경력']}
                                            label="경력 구분"
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={profileReadOnly}
                                            {...form.getInputProps('career_type')}
                                            placeholder="신입 또는 경력 선택"
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="임시사번"
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={profileReadOnly}
                                            {...form.getInputProps('temp_id')}
                                            placeholder={isEditing && canEdit ? 'T-123456' : '-'}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <TextInput
                                            label="소속 (지점)"
                                            variant={isEditing && canEdit ? 'default' : 'unstyled'}
                                            readOnly={profileReadOnly}
                                            {...form.getInputProps('affiliation')}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        {isEditingRecommender && canEdit ? (
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
                                                        placeholder="추천인 관계 변경 사유 입력"
                                                        value={recommenderOverrideReason}
                                                        onChange={(event) => setRecommenderOverrideReason(event.currentTarget.value)}
                                                        minRows={2}
                                                        required
                                                    />
                                                ) : null}
                                                <Group gap="xs">
                                                    <Button
                                                        size="xs"
                                                        variant="default"
                                                        onClick={handleCancelRecommenderEdit}
                                                        disabled={updateRecommenderMutation.isPending}
                                                    >
                                                        취소
                                                    </Button>
                                                    <Button
                                                        size="xs"
                                                        color="orange"
                                                        leftSection={<IconDeviceFloppy size={14} />}
                                                        onClick={handleSaveRecommender}
                                                        loading={updateRecommenderMutation.isPending}
                                                        disabled={!isRecommenderDirty || !recommenderOverrideReason.trim()}
                                                    >
                                                        추천인 관계 저장
                                                    </Button>
                                                </Group>
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
                                                {canEdit ? (
                                                    <Button
                                                        size="xs"
                                                        variant="light"
                                                        color="orange"
                                                        onClick={() => setIsEditingRecommender(true)}
                                                    >
                                                        추천인 관계 변경
                                                    </Button>
                                                ) : null}
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
                            <Card radius={24} p="lg" bg="#fff8e6" className={styles.card} style={{ '--i': 2 } as CSSProperties}>
                                <Group justify="space-between" mb="sm">
                                    <Title order={5} c="orange.9">관리자 메모</Title>
                                    <ActionIcon aria-label="관리자 메모 저장" variant="light" color={canEdit ? 'orange' : 'gray'} onClick={handleSaveMemo} loading={saveMemoMutation.isPending} disabled={!canEdit}>
                                        <IconDeviceFloppy size={16} />
                                    </ActionIcon>
                                </Group>
                                <Textarea
                                    placeholder="관리자 전용 특이사항을 입력하세요."
                                    minRows={4}
                                    autosize
                                    variant="filled"
                                    readOnly={!canEdit}
                                    value={memoDraft}
                                    onChange={(event) => setMemoDraft(event.currentTarget.value)}
                                    styles={{ input: { backgroundColor: 'white' } }}
                                />
                            </Card>

                            {/* Documents Timeline */}
                            <Card radius={24} p="lg" className={styles.card} style={{ '--i': 3 } as CSSProperties}>
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
                                                        {ADMIN_DOCUMENT_STATUS_LABELS[doc.status] || doc.status}
                                                    </Badge>
                                                    <Anchor component={Link} href="/dashboard/docs" size="xs" c={HANWHA_ORANGE}>
                                                        보기
                                                    </Anchor>
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
            </div>
        </div>
    );
}
