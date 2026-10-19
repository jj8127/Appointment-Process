'use client';

import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { QueryReadError } from '@/lib/query-read-error';

import {
    ActionIcon,
    Alert,
    Badge,
    Box,
    Button,
    Grid,
    Group,
    LoadingOverlay,
    Modal,
    Paper,
    ScrollArea,
    SegmentedControl,
    SimpleGrid,
    Switch,
    Stack,
    Table,
    TagsInput,
    Text,
    TextInput,
    ThemeIcon,
    Title
} from '@mantine/core';
import { Calendar, DateInput, MonthPickerInput, type DateInputProps } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { notificationFeedbackColor } from '@/lib/notification-delivery-feedback';
import {
    IconCalendar,
    IconCalendarDue,
    IconCalendarEvent,
    IconCheck,
    IconChevronLeft,
    IconChevronRight,
    IconCircleCheckFilled,
    IconEdit,
    IconHeartbeat,
    IconInfoCircle,
    IconMapPin,
    IconNote,
    IconPlus,
    IconTag,
    IconTrash,
    IconUmbrella,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import 'dayjs/locale/ko';
import { useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';

import { useSession } from '@/hooks/use-session';
import { NotificationDestinationReady } from '@/components/NotificationDestinationReady';
import { sortExamRoundsNewestFirst } from '@/lib/exam-round-sort';
import { HANWHA_ORANGE, CHARCOAL, MUTED } from '@/lib/brand-colors';
import surface from '../../surface.module.css';

// --- Constants ---

// Calendar dropdown styling shared by the exam date and deadline inputs.
const MODAL_CALENDAR_STYLES: DateInputProps['styles'] = {
    calendarHeader: {
        padding: '6px 4px',
        borderBottom: '1px solid #eef1f4',
        display: 'grid',
        gridTemplateColumns: '28px 1fr 28px',
        alignItems: 'center',
    },
    calendarHeaderControlIcon: { margin: '0 auto' },
    calendarHeaderLevel: {
        fontWeight: 700,
        fontSize: 14,
        textAlign: 'center',
        justifySelf: 'center',
    },
    calendarHeaderControl: { borderRadius: 8, justifySelf: 'center' },
    month: {
        width: '100%',
        tableLayout: 'fixed',
        margin: '0 auto',
    },
    monthThead: { textAlign: 'center' },
    monthTbody: { textAlign: 'center' },
    monthRow: {
        textAlign: 'center',
    },
    weekdaysRow: {
        textAlign: 'center',
    },
    monthCell: { padding: 2, textAlign: 'center' },
    weekday: { fontWeight: 600, color: '#6b7280', textAlign: 'center' },
    day: { borderRadius: 8, height: 34, fontWeight: 600, margin: '0 auto' },
};

// --- Types ---
type ExamRound = {
    id: string;
    exam_date: string | null;
    exam_month: string;
    registration_deadline: string;
    round_label: string;
    exam_type?: 'life' | 'nonlife' | string;
    notes?: string;
    created_at?: string;
    locations: { id: string; location_name: string }[];
};

// --- Schema ---
const roundSchema = z.object({
    exam_date: z.date().nullable(),
    exam_month: z.string().nullable(),
    registration_deadline: z.date(),
    round_label: z.string().min(1, '회차명을 입력해주세요'),
    exam_type: z.enum(['life', 'nonlife']),
    notes: z.string().optional(),
    locations: z.array(z.string()).min(1, '최소 1개의 장소를 등록해주세요'),
    is_date_tbd: z.boolean().default(false), // 미정 여부
}).superRefine((values, context) => {
    if (values.is_date_tbd && !values.exam_month) {
        context.addIssue({
            code: 'custom',
            path: ['exam_month'],
            message: '시험일 미정 회차는 시험 월을 선택해 주세요.',
        });
    }
    if (!values.is_date_tbd && !values.exam_date) {
        context.addIssue({
            code: 'custom',
            path: ['exam_date'],
            message: '정확한 시험일을 선택해 주세요.',
        });
    }
});

type RoundFormValues = z.infer<typeof roundSchema>;
const errorMessage = (err: unknown, fallback: string) => {
    if (err instanceof Error && err.message) return err.message;
    return fallback;
};

const validateRoundForm = (values: RoundFormValues) => {
    const result = roundSchema.safeParse(values);
    if (result.success) {
        return {};
    }

    const errors: Record<string, string> = {};
    const issues = result.error?.issues ?? [];
    if (!Array.isArray(issues)) {
        return { form: '입력값을 다시 확인해주세요.' };
    }

    issues.forEach((issue) => {
        const key = issue.path.join('.');
        if (!errors[key]) {
            errors[key] = issue.message;
        }
    });
    return errors;
};

export default function ExamSchedulePage() {
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();
    const notificationRoundId = (searchParams.get('roundId') ?? '').trim();
    const { isReadOnly } = useSession();
    const [opened, { open, close }] = useDisclosure(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
    const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

    // --- Form ---
    const form = useForm<RoundFormValues>({
        validate: validateRoundForm,
        initialValues: {
            exam_date: new Date(),
            exam_month: dayjs().startOf('month').format('YYYY-MM-DD'),
            registration_deadline: new Date(),
            round_label: '',
            exam_type: 'life',
            notes: '',
            locations: ['서울', '부산', '대전', '광주', '대구'], // Defaults
            is_date_tbd: false,
        },
    });

    // --- Fetch Data ---
    const { data: rounds, isLoading, isError, error, refetch, isFetching } = useQuery({
        queryKey: ['exam-rounds'],
        queryFn: async () => {
            const { fetchExamRoundsAction } = await import('./actions');
            const result = await fetchExamRoundsAction();
            if (!result.success || !Array.isArray(result.data)) {
                throw new QueryReadError(result.status);
            }
            return result.data as ExamRound[];
        },
    });

    // --- Mutations ---
    const saveMutation = useMutation({
        mutationFn: async (values: RoundFormValues) => {
            const {
                exam_date,
                exam_month,
                registration_deadline,
                round_label,
                notes,
                is_date_tbd,
            } = values;
            const normalizedExamDate = is_date_tbd || !exam_date
                ? null
                : dayjs(exam_date).format('YYYY-MM-DD');
            const normalizedExamMonth = normalizedExamDate
                ? dayjs(normalizedExamDate).startOf('month').format('YYYY-MM-DD')
                : exam_month;

            const payload = {
                exam_date: normalizedExamDate,
                exam_month: normalizedExamMonth,
                registration_deadline: dayjs(registration_deadline).format('YYYY-MM-DD'),
                round_label,
                exam_type: values.exam_type,
                notes,
                locations: values.locations,
                roundId: editingId,
            };
            const { saveExamRoundAction } = await import('./actions');
            const result = await saveExamRoundAction({ success: false }, payload);
            if (!result.success) {
                throw new Error(result.error || '저장 실패');
            }
            return result;
        },
        onSuccess: (result) => {
            notifications.show({
                title: editingId ? '수정 완료' : '등록 완료',
                message: `시험 일정이 ${editingId ? '수정' : '등록'}되었습니다.`,
                color: 'green',
            });
            if (
                result.notificationDelivery
                && result.notificationDelivery.severity !== 'success'
            ) {
                notifications.show({
                    title: result.notificationDelivery.title,
                    message: result.notificationDelivery.message,
                    color: notificationFeedbackColor(result.notificationDelivery),
                });
            }
            queryClient.invalidateQueries({ queryKey: ['exam-rounds'] });
            handleClose(true);
        },
        onError: (err: unknown) => {
            notifications.show({
                title: '저장 실패',
                message: errorMessage(err, '저장 중 오류가 발생했습니다.'),
                color: 'red',
            });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (roundId: string) => {
            // Use Server Action for Safe Cascading Delete
            const { deleteExamRoundAction } = await import('./actions');
            const result = await deleteExamRoundAction({ success: false }, { roundId });
            if (!result.success) {
                throw new Error(result.error || '삭제 실패');
            }
        },
        onSuccess: () => {
            notifications.show({
                title: '삭제 완료',
                message: '신청자가 없는 시험 일정이 삭제되었습니다.',
                color: 'green',
            });
            queryClient.invalidateQueries({ queryKey: ['exam-rounds'] });
            setDeleteTarget(null);
            closeDelete();
        },
        onError: (err: unknown) => {
            notifications.show({
                title: '삭제 실패',
                message: errorMessage(err, '오류가 발생했습니다.'),
                color: 'red',
            });
        },
    });

    // --- Handlers ---
    const handleOpenCreate = () => {
        setEditingId(null);
        form.reset();
        form.resetDirty();
        open();
    };

    const handleOpenEdit = (round: ExamRound) => {
        setEditingId(round.id);
        const isTBD = !round.exam_date;
        form.setValues({
            exam_date: round.exam_date ? new Date(round.exam_date) : null,
            exam_month: round.exam_month,
            registration_deadline: new Date(round.registration_deadline),
            round_label: round.round_label,
            exam_type: (round.exam_type as 'life' | 'nonlife') ?? 'life',
            notes: round.notes || '',
            locations: round.locations.map(l => l.location_name),
            is_date_tbd: isTBD,
        });
        form.resetDirty();
        open();
    };

    const handleClose = (force = false) => {
        if (!force && saveMutation.isPending) return;
        if (!force && form.isDirty() && !window.confirm('작성 중인 시험 일정을 버릴까요?')) return;
        close();
        form.reset();
        setEditingId(null);
    };

    const handleSubmit = (values: RoundFormValues) => {
        saveMutation.mutate(values);
    };

    const handleOpenDelete = (round: ExamRound) => {
        setDeleteTarget({ id: round.id, label: round.round_label });
        openDelete();
    };

    const handleConfirmDelete = () => {
        if (!deleteTarget) return;
        deleteMutation.mutate(deleteTarget.id);
    };

    // --- Render ---
    const deadlineCutoff = (dateStr: string) => dayjs(dateStr).endOf('day');

    const sortedRounds = sortExamRoundsNewestFirst(rounds ?? []);
    const openRounds = sortedRounds.filter((round) => !dayjs().isAfter(deadlineCutoff(round.registration_deadline)));
    // Table order: rounds still taking registrations first (nearest deadline first), then closed rounds newest first.
    const tableRounds = [
        ...[...openRounds].sort((a, b) => dayjs(a.registration_deadline).diff(dayjs(b.registration_deadline))),
        ...sortedRounds.filter((round) => !openRounds.includes(round)),
    ];

    const rows = tableRounds.map((round) => {
        const cutoff = deadlineCutoff(round.registration_deadline);
        const now = dayjs();
        const isClosed = now.isAfter(cutoff);

        return (
        <Table.Tr key={round.id} data-closed={isClosed || undefined}>
            <Table.Td>
                {round.exam_date ? (
                    <Text fw={600} size="sm">{dayjs(round.exam_date).format('YYYY-MM-DD')}</Text>
                ) : (
                    <span className={surface.pill}>미정</span>
                )}
            </Table.Td>
            <Table.Td>
                <Text fw={600} size="sm">{round.round_label}</Text>
            </Table.Td>
            <Table.Td>
                <Group gap={6} wrap="nowrap">
                    <Text size="sm" c={CHARCOAL}>
                        {dayjs(round.registration_deadline).format('YYYY-MM-DD')}
                    </Text>
                    {isClosed && <span className={surface.pill}>마감</span>}
                </Group>
            </Table.Td>
            <Table.Td>
                <Group gap={4}>
                    {round.locations.map((loc) => (
                        <span key={loc.id} className={surface.pill}>
                            {loc.location_name}
                        </span>
                    ))}
                </Group>
            </Table.Td>
            <Table.Td>
                <Group gap={6}>
                    <ActionIcon variant="light" color={isReadOnly ? "gray" : "orange"} disabled={isReadOnly} onClick={() => handleOpenEdit(round)} aria-label="일정 수정">
                        <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon variant="light" color={isReadOnly ? "gray" : "red"} disabled={isReadOnly} onClick={() => handleOpenDelete(round)} aria-label="일정 삭제">
                        <IconTrash size={16} />
                    </ActionIcon>
                </Group>
            </Table.Td>
        </Table.Tr>
        );
    });

    const renderExamDay = (date: string | Date) => {
        const dayStr = dayjs(date).format('YYYY-MM-DD');
        const round = rounds?.find(r => r.exam_date && r.exam_date === dayStr);
        const isToday = dayjs(date).isSame(dayjs(), 'day');
        const dotColor = round?.exam_type === 'life' ? '#f59f00' : '#4dabf7';

        return (
            <div style={{ height: '100%', width: '100%', display: 'grid', placeItems: 'center' }}>
                <span style={{
                    fontWeight: 700,
                    color: isToday ? HANWHA_ORANGE : '#111827',
                    width: 28,
                    height: 28,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 10,
                    background: round ? '#fff' : 'transparent',
                    boxShadow: round ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}>
                    {dayjs(date).date()}
                </span>
                {round && (
                    <span style={{
                        marginTop: 4,
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: dotColor,
                    }} />
                )}
            </div>
        );
    };

    const today = dayjs().startOf('day');
    const nextExam = sortedRounds
        .filter((round) => round.exam_date && !dayjs(round.exam_date).isBefore(today))
        .sort((a, b) => dayjs(a.exam_date).diff(dayjs(b.exam_date)))[0];
    const nextDeadline = [...openRounds]
        .sort((a, b) => dayjs(a.registration_deadline).diff(dayjs(b.registration_deadline)))[0];
    const daysUntil = (value: string) => dayjs(value).startOf('day').diff(today, 'day');
    const dLabel = (days: number) => (days === 0 ? 'D-day' : `D-${days}`);
    const statTiles = [
        { key: 'all', label: '전체 회차', value: sortedRounds.length },
        { key: 'open', label: '접수 중', value: openRounds.length, hot: true },
        { key: 'closed', label: '접수 마감', value: sortedRounds.length - openRounds.length },
        { key: 'tbd', label: '시험일 미정', value: sortedRounds.filter((round) => !round.exam_date).length },
    ];

    return (
        <div className={surface.page}>
            {notificationRoundId && sortedRounds.some((round) => round.id === notificationRoundId)
                ? <NotificationDestinationReady />
                : null}
            <div className={surface.head} style={{ '--i': 0 } as CSSProperties}>
                <div>
                    <Title order={1} className={surface.title}>시험 일정 관리</Title>
                    <Text className={surface.subtitle}>자격 시험 일정과 접수 가능한 장소를 관리합니다.</Text>
                    {rounds ? (
                        <div className={surface.headMeta}>
                            {nextDeadline ? (
                                <span className={surface.metaChip} data-tone={daysUntil(nextDeadline.registration_deadline) <= 3 ? 'hot' : undefined}>
                                    <i />접수 마감 <b>{dLabel(daysUntil(nextDeadline.registration_deadline))}</b> · {nextDeadline.round_label}
                                </span>
                            ) : (
                                <span className={surface.metaChip}><i />접수 중인 회차 없음</span>
                            )}
                            {nextExam?.exam_date ? (
                                <span className={surface.metaChip}>
                                    <i />다음 시험 <b>{dayjs(nextExam.exam_date).format('MM.DD')}</b> ({dLabel(daysUntil(nextExam.exam_date))})
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                <div className={surface.actions}>
                    <SegmentedControl
                        value={viewMode}
                        onChange={(v) => setViewMode(v as 'list' | 'calendar')}
                        color="orange"
                        radius="xl"
                        size="md"
                        bg="white"
                        data={[
                            { label: '리스트', value: 'list' },
                            { label: '캘린더', value: 'calendar' }
                        ]}
                    />
                    <Button leftSection={<IconPlus size={16} />} color={isReadOnly ? "gray" : "dark"} radius="xl" h={44} disabled={isReadOnly} onClick={handleOpenCreate}>
                        일정 등록
                    </Button>
                </div>
            </div>

            <div className={surface.statGroup} style={{ '--i': 1 } as CSSProperties}>
                {statTiles.map((tile) => (
                    <div key={tile.key} className={surface.statTile} data-hot={tile.hot || undefined}>
                        <span className={surface.statLabel}>{tile.label}</span>
                        <span className={surface.statValue}>{rounds ? tile.value : '-'}</span>
                    </div>
                ))}
            </div>

            {isReadOnly && (
                <Alert
                    icon={<IconInfoCircle size={20} />}
                    title="읽기 전용 모드"
                    color="yellow"
                    variant="light"
                    radius="lg"
                >
                    본부장 계정은 조회만 가능합니다. 수정 권한이 필요한 경우 관리자에게 문의하세요.
                </Alert>
            )}

            {isError && <QueryErrorAlert error={error} onRetry={refetch} isFetching={isFetching} hasData={!!rounds} subject="시험 일정" />}

            {viewMode === 'list' ? (
                <Grid gutter={14} align="flex-start">
                <Grid.Col span={{ base: 12, lg: 8 }}>
                <div className={surface.tableCard} style={{ '--i': 2 } as CSSProperties}>
                    <ScrollArea>
                        <Table verticalSpacing="md" className={surface.table}>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>시험일</Table.Th>
                                    <Table.Th>회차명</Table.Th>
                                    <Table.Th>접수 마감일</Table.Th>
                                    <Table.Th>고사장(장소)</Table.Th>
                                    <Table.Th>관리</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {isLoading ? (
                                    <Table.Tr><Table.Td colSpan={5} align="center" py={40}><LoadingOverlay visible /></Table.Td></Table.Tr>
                                ) : rows && rows.length > 0 ? (
                                    rows
                                ) : (
                                    <Table.Tr><Table.Td colSpan={5} align="center" py={60} c="dimmed">{isError ? '시험 일정을 확인할 수 없습니다.' : '등록된 일정이 없습니다.'}</Table.Td></Table.Tr>
                                )}
                            </Table.Tbody>
                        </Table>
                    </ScrollArea>
                </div>
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 4 }}>
                <div className={surface.card} style={{ '--i': 3 } as CSSProperties}>
                    <Group justify="space-between" mb="sm">
                        <Text className={surface.cardTitle}>시험 일정 캘린더</Text>
                        <Group gap={10}>
                            <Group gap={4}><Box w={8} h={8} bg="orange.5" style={{ borderRadius: 999 }} /><Text size="xs" c="dimmed">생명</Text></Group>
                            <Group gap={4}><Box w={8} h={8} bg="blue.5" style={{ borderRadius: 999 }} /><Text size="xs" c="dimmed">손해</Text></Group>
                        </Group>
                    </Group>
                    <Calendar
                        static
                        size="md"
                        previousIcon={<IconChevronLeft size={16} />}
                        nextIcon={<IconChevronRight size={16} />}
                        locale="ko"
                        monthLabelFormat="YYYY년 M월"
                        styles={{
                            calendarHeader: { maxWidth: 'none' },
                            month: { width: '100%' },
                            day: { borderRadius: 12, width: '100%', height: 44, fontWeight: 600 },
                            weekday: { color: MUTED, fontWeight: 600 },
                        }}
                        renderDay={renderExamDay}
                    />
                </div>
                </Grid.Col>
                </Grid>
            ) : (
                <div className={surface.card} style={{ '--i': 2 } as CSSProperties}>
                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
                        <div className={surface.well}>
                            <Group justify="space-between" mb="md">
                                <Group gap="sm">
                                    <ThemeIcon radius="md" variant="light" color="orange">
                                        <IconCalendar size={18} />
                                    </ThemeIcon>
                                    <div>
                                        <Text fw={700} size="lg">시험 일정 캘린더</Text>
                                        <Text size="xs" c="dimmed">월별 전체 일정을 빠르게 확인하세요.</Text>
                                    </div>
                                </Group>
                                <span className={surface.pill} data-color="orange">Calendar View</span>
                            </Group>

                            <Calendar
                                static
                                size="xl"
                                previousIcon={<IconChevronLeft size={18} />}
                                nextIcon={<IconChevronRight size={18} />}
                                locale="ko"
                                monthLabelFormat="YYYY년 M월"
                                styles={{
                                    day: { borderRadius: 14, height: 56, fontWeight: 600 },
                                    weekday: { color: MUTED, fontWeight: 700 },
                                    month: { fontWeight: 800 },
                                }}
                                renderDay={renderExamDay}
                            />
                        </div>

                        <Stack gap="lg">
                            <div className={surface.well}>
                                <Text fw={700} size="sm" mb="sm">일정 범례</Text>
                                <Group gap="xs" mb="xs">
                                    <Box w={10} h={10} bg="orange.5" style={{ borderRadius: 999 }} />
                                    <Text size="xs">생명보험 시험</Text>
                                </Group>
                                <Group gap="xs">
                                    <Box w={10} h={10} bg="blue.5" style={{ borderRadius: 999 }} />
                                    <Text size="xs">손해보험 시험</Text>
                                </Group>
                            </div>

                            <div className={surface.well}>
                                <Group justify="space-between" mb="sm">
                                    <Text fw={700} size="sm">다가오는 시험</Text>
                                    <span className={surface.pill} style={{ background: '#fff' }}>
                                        {rounds ? `${rounds.length}건` : isError ? '확인 불가' : '조회 중'}
                                    </span>
                                </Group>
                                <Stack gap="xs">
                                    {sortedRounds.filter(r => r.exam_date ? dayjs(r.exam_date).isAfter(dayjs()) : true).slice(0, 4).map(r => (
                                        <Paper key={r.id} p="sm" radius={14} bg="white">
                                            <Text size="sm" fw={700}>{r.round_label}</Text>
                                            <Group gap={6} mt={4}>
                                                <Badge size="xs" color={r.exam_type === 'life' ? 'orange' : 'blue'} variant="light">
                                                    {r.exam_type === 'life' ? '생명' : '손해'}
                                                </Badge>
                                                {r.exam_date ? (
                                                    <Text size="xs" c="dimmed">{dayjs(r.exam_date).format('MM.DD')}</Text>
                                                ) : (
                                                    <Badge size="xs" color="gray" variant="dot">미정</Badge>
                                                )}
                                            </Group>
                                        </Paper>
                                    ))}
                                    {!sortedRounds.filter(r => r.exam_date ? dayjs(r.exam_date).isAfter(dayjs()) : true).length && (
                                        <Text size="xs" c="dimmed">{isLoading ? '시험 일정을 불러오는 중입니다.' : isError ? '시험 일정을 확인할 수 없습니다.' : '예정된 일정이 없습니다.'}</Text>
                                    )}
                                </Stack>
                            </div>

                            <button type="button" className={surface.softButton} style={{ background: 'var(--dashboard-panel)' }} onClick={() => setViewMode('list')}>
                                전체 일정 관리
                            </button>
                        </Stack>
                    </SimpleGrid>
                </div>
            )}

            {/* Modal */}
            <Modal
                opened={opened}
                onClose={() => handleClose()}
                title={
                    <Group gap="sm">
                        <span className={surface.modalIcon}><IconCalendar size={18} /></span>
                        <Text fw={700} size="lg">{editingId ? '일정 수정' : '새 일정 등록'}</Text>
                    </Group>
                }
                size="lg"
                radius={28}
                padding="xl"
                centered
            >
                <form onSubmit={form.onSubmit(handleSubmit)}>
                    <Stack gap="md">
                        <div className={surface.typeCards} role="radiogroup" aria-label="시험 종류">
                            {([
                                { value: 'life', label: '생명 / 제3보험', icon: IconHeartbeat },
                                { value: 'nonlife', label: '손해보험', icon: IconUmbrella },
                            ] as const).map((type) => (
                                <button
                                    key={type.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={form.values.exam_type === type.value}
                                    className={surface.typeCard}
                                    data-active={form.values.exam_type === type.value || undefined}
                                    onClick={() => form.setFieldValue('exam_type', type.value)}
                                >
                                    <span className={surface.typeIcon}><type.icon size={20} /></span>
                                    <span>{type.label}</span>
                                    {form.values.exam_type === type.value ? <IconCircleCheckFilled size={20} className={surface.typeCheck} /> : null}
                                </button>
                            ))}
                        </div>

                        <div className={surface.modalSection}>
                            <div className={surface.formRow}>
                                <Text className={surface.formLabel}><IconTag size={15} />회차명</Text>
                                <TextInput
                                    aria-label="회차명/구분"
                                    placeholder="예: 9월 1차 생명보험"
                                    {...form.getInputProps('round_label')}
                                />
                            </div>
                            <div className={surface.formRow}>
                                <Text className={surface.formLabel}><IconCalendarEvent size={15} />{form.values.is_date_tbd ? '시험 월' : '시험일'}</Text>
                                <Group gap="sm" wrap="nowrap" align="flex-start">
                                    <Box style={{ flex: 1, minWidth: 0 }}>
                                        {form.values.is_date_tbd ? (
                                                <MonthPickerInput
                                                    required
                                                    aria-label="시험 월"
                                                    placeholder="시험 월 선택 (시험일 미정이어도 필수)"
                                                    leftSection={<IconCalendar size={16} />}
                                                    value={form.values.exam_month}
                                                    onChange={(value) => {
                                                        form.setFieldValue(
                                                            'exam_month',
                                                            value
                                                                ? dayjs(value).startOf('month').format('YYYY-MM-DD')
                                                                : null,
                                                        );
                                                    }}
                                                    error={form.errors.exam_month}
                                                    locale="ko"
                                                    valueFormat="YYYY년 MM월"
                                                    popoverProps={{ width: 320, position: 'bottom-start', shadow: 'md' }}
                                                    size="sm"
                                                />
                                        ) : (
                                                <DateInput
                                                    required
                                                    aria-label="시험일"
                                                    placeholder="시험 날짜 선택"
                                                    leftSection={<IconCalendar size={16} />}
                                                    value={form.values.exam_date}
                                                    disabled={form.values.is_date_tbd}
                                                    onChange={(value) => {
                                                        if (!value) {
                                                            form.setFieldValue('exam_date', null);
                                                            return;
                                                        }
                                                        const nextValue =
                                                            typeof value === 'string' ? new Date(value) : (value as Date);
                                                        if (!Number.isNaN(nextValue.getTime())) {
                                                            form.setFieldValue('exam_date', nextValue);
                                                            form.setFieldValue(
                                                                'exam_month',
                                                                dayjs(nextValue).startOf('month').format('YYYY-MM-DD'),
                                                            );
                                                        }
                                                    }}
                                                    locale="ko"
                                                    error={form.errors.exam_date}
                                                    monthLabelFormat="YYYY년 M월"
                                                    previousIcon={<IconChevronLeft size={14} />}
                                                    nextIcon={<IconChevronRight size={14} />}
                                                    valueFormat="YYYY년 MM월 DD일"
                                                    popoverProps={{ width: 320, position: 'bottom-start', shadow: 'md' }}
                                                    size="sm"
                                                    styles={MODAL_CALENDAR_STYLES}
                                                />
                                        )}
                                    </Box>
                                    <Switch
                                        label="미정"
                                        color="orange"
                                        mt={8}
                                        {...form.getInputProps('is_date_tbd', { type: 'checkbox' })}
                                        onChange={(e) => {
                                            const isTbd = e.currentTarget.checked;
                                            form.setFieldValue('is_date_tbd', isTbd);
                                            if (isTbd) {
                                                const monthSource = form.values.exam_date ?? new Date();
                                                form.setFieldValue(
                                                    'exam_month',
                                                    dayjs(monthSource).startOf('month').format('YYYY-MM-DD'),
                                                );
                                                form.setFieldValue('exam_date', null);
                                            } else {
                                                // A month snapshot is not an exact exam date. Require the
                                                // operator to choose the actual day explicitly.
                                                form.setFieldValue('exam_date', null);
                                            }
                                        }}
                                    />
                                </Group>
                            </div>
                            <div className={surface.formRow}>
                                <Text className={surface.formLabel}><IconCalendarDue size={15} />접수 마감일</Text>
                                <Group gap="sm" wrap="nowrap">
                                    <Box style={{ flex: 1, minWidth: 0 }}>
                                        <DateInput
                                            aria-label="접수 마감일"
                                            placeholder="마감 날짜 선택"
                                            leftSection={<IconCalendar size={16} />}
                                            value={form.values.registration_deadline}
                                            onChange={(value) => {
                                                if (!value) return;
                                                const nextValue =
                                                    typeof value === 'string' ? new Date(value) : (value as Date);
                                                if (!Number.isNaN(nextValue.getTime())) {
                                                    form.setFieldValue('registration_deadline', nextValue);
                                                }
                                            }}
                                            locale="ko"
                                            monthLabelFormat="YYYY년 M월"
                                            previousIcon={<IconChevronLeft size={14} />}
                                            nextIcon={<IconChevronRight size={14} />}
                                            valueFormat="YYYY년 MM월 DD일"
                                            popoverProps={{ width: 320, position: 'bottom-start', shadow: 'md' }}
                                            size="sm"
                                            styles={MODAL_CALENDAR_STYLES}
                                        />
                                    </Box>
                                    {form.values.registration_deadline ? (() => {
                                        const daysLeft = dayjs(form.values.registration_deadline).startOf('day').diff(dayjs().startOf('day'), 'day');
                                        return (
                                            <span className={surface.pill} data-color={daysLeft < 0 ? undefined : daysLeft <= 3 ? 'orange' : 'green'}>
                                                {daysLeft < 0 ? '마감' : daysLeft === 0 ? 'D-day' : `D-${daysLeft}`}
                                            </span>
                                        );
                                    })() : null}
                                </Group>
                            </div>
                        </div>

                        <div className={surface.modalSection}>
                            <div className={surface.formRow} data-align="start">
                                <Text className={surface.formLabel}><IconMapPin size={15} />고사장</Text>
                                <Box>
                                    <TagsInput
                                        aria-label="고사장(장소) 관리"
                                        placeholder="Enter로 장소 추가 (예: 서울, 부산)"
                                        {...form.getInputProps('locations')}
                                        data={['서울', '부산', '대구', '인천', '광주', '대전', '울산', '제주']}
                                        clearable
                                    />
                                    <Text size="xs" c="dimmed" mt={6}>
                                        이미 신청자가 있는 장소는 삭제되지 않을 수 있습니다.
                                    </Text>
                                </Box>
                            </div>
                            <div className={surface.formRow}>
                                <Text className={surface.formLabel}><IconNote size={15} />비고</Text>
                                <TextInput
                                    aria-label="비고 (선택)"
                                    placeholder="메모 사항 (선택)"
                                    {...form.getInputProps('notes')}
                                />
                            </div>
                        </div>

                        <Group justify="space-between" mt="xs">
                            <Button variant="default" radius="xl" onClick={() => handleClose()}>취소</Button>
                            <Button type="submit" color="orange" radius="xl" leftSection={<IconCheck size={16} />} loading={saveMutation.isPending}>
                                {editingId ? '수정 저장' : '등록 하기'}
                            </Button>
                        </Group>
                    </Stack>
                </form>
            </Modal>

            {/* Delete Confirm */}
            <Modal opened={deleteOpened} onClose={closeDelete} title="일정 삭제" radius={28} padding="xl" centered>
                <Stack gap="md">
                    <Text size="sm" c="dimmed">
                        {deleteTarget ? `'${deleteTarget.label}' 일정을 삭제하시겠습니까?\n신청자가 있는 회차는 삭제할 수 없으며 신청 이력은 보존됩니다.` : '일정을 삭제하시겠습니까?'}
                    </Text>
                    <Group justify="flex-end">
                        <Button variant="light" color="gray" radius="xl" onClick={closeDelete}>취소</Button>
                        <Button color="red" radius="xl" onClick={handleConfirmDelete} loading={deleteMutation.isPending}>
                            삭제
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </div>
    );
}
