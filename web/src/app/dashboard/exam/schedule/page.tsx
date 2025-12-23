'use client';

import {
    ActionIcon,
    Badge,
    Box,
    Button,
    Container,
    Group,
    LoadingOverlay,
    Modal,
    Paper,
    ScrollArea,
    SegmentedControl,
    SimpleGrid,
    Stack,
    Table,
    TagsInput,
    Text,
    TextInput,
    ThemeIcon,
    Title
} from '@mantine/core';
import { Calendar, DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconCalendar,
    IconChevronLeft,
    IconChevronRight,
    IconEdit,
    IconPlus,
    IconTrash
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { z } from 'zod';

import { supabase } from '@/lib/supabase';

// --- Constants ---
const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';

// --- Types ---
type ExamRound = {
    id: string;
    exam_date: string;
    registration_deadline: string;
    round_label: string;
    exam_type?: 'life' | 'nonlife' | string;
    notes?: string;
    locations: { id: string; location_name: string }[];
};

// --- Schema ---
const roundSchema = z.object({
    exam_date: z.date(),
    registration_deadline: z.date(),
    round_label: z.string().min(1, '회차명을 입력해주세요'),
    exam_type: z.enum(['life', 'nonlife']),
    notes: z.string().optional(),
    locations: z.array(z.string()).min(1, '최소 1개의 장소를 등록해주세요'),
});

type RoundFormValues = z.infer<typeof roundSchema>;

const validateRoundForm = (values: RoundFormValues) => {
    const result = roundSchema.safeParse(values);
    if (result.success) {
        return {};
    }

    const errors: Record<string, string> = {};
    const issues = result.error?.issues ?? (result.error as any)?.errors ?? [];
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
            registration_deadline: new Date(),
            round_label: '',
            exam_type: 'life',
            notes: '',
            locations: ['서울', '부산', '대전', '광주', '대구'], // Defaults
        },
    });

    // --- Fetch Data ---
    const { data: rounds, isLoading } = useQuery({
        queryKey: ['exam-rounds'],
        queryFn: async () => {
            // Fetch rounds
            const { data: roundsData, error: roundError } = await supabase
                .from('exam_rounds')
                .select(`
          *,
          exam_locations ( id, location_name )
        `)
                .order('exam_date', { ascending: false });

            if (roundError) throw roundError;

            // Transform to cleaner type
            return (roundsData || []).map((r: any) => ({
                ...r,
                locations: r.exam_locations || [],
            })) as ExamRound[];
        },
    });

    // --- Mutations ---
    const saveMutation = useMutation({
        mutationFn: async (values: RoundFormValues) => {
            const { exam_date, registration_deadline, round_label, notes, locations } = values;

            const payload = {
                exam_date: dayjs(exam_date).format('YYYY-MM-DD'),
                registration_deadline: dayjs(registration_deadline).format('YYYY-MM-DD'),
                round_label,
                exam_type: values.exam_type,
                notes,
            };

            let roundId = editingId;

            if (!roundId) {
                // Insert Round
                const { data, error } = await supabase
                    .from('exam_rounds')
                    .insert(payload)
                    .select()
                    .single();
                if (error) throw error;
                roundId = data.id;
            } else {
                // Update Round
                const { error } = await supabase
                    .from('exam_rounds')
                    .update(payload)
                    .eq('id', roundId);
                if (error) throw error;
            }

            if (!roundId) throw new Error('Round ID missing');

            // Manage Locations
            // Strategy: 
            // 1. Fetch existing locations for this round
            // 2. Determine which to add (new tags)
            // 3. For editing, we DO NOT delete existing locations to prevent FK errors with applications.
            //    We only ADD new ones. If user removed a tag, we try to delete, but ignore FK error or checking it?
            //    Simplest safe MVP: Only Insert new ones. Users cannot delete locations yet via this UI if it risks data integrity.
            //    Or: Try to delete locations NOT in the new list. If creation fails, so be it.

            const { data: existingLocs } = await supabase
                .from('exam_locations')
                .select('location_name, id')
                .eq('round_id', roundId);

            const existingNames = new Set(existingLocs?.map(l => l.location_name) || []);
            const newNames = values.locations;

            // To Add
            const toAdd = newNames.filter(n => !existingNames.has(n));

            if (toAdd.length > 0) {
                const { error: insertErr } = await supabase.from('exam_locations').insert(
                    toAdd.map((name, idx) => ({
                        round_id: roundId,
                        location_name: name,
                        sort_order: idx // Simple order
                    }))
                );
                if (insertErr) throw insertErr;
            }

            // To Delete (Only if user removed from tags)
            // Warning: This will fail if applications exist. We wrap in try/catch or just let it fail silently/show warning.
            const toRemove = existingLocs?.filter(l => !newNames.includes(l.location_name)) || [];
            if (toRemove.length > 0) {
                const { error: delError } = await supabase
                    .from('exam_locations')
                    .delete()
                    .in('id', toRemove.map(l => l.id));

                if (delError) {
                    console.warn('Failed to delete some locations due to existing applications', delError);
                    // Optional: Notify user
                    if (delError.code === '23503') { // ForeignKeyViolation
                        // We suppress this specific error for UX or show a warning toast?
                        // Let's suppress and just log.
                    } else {
                        throw delError;
                    }
                }
            }
        },
        onSuccess: () => {
            notifications.show({
                title: editingId ? '수정 완료' : '등록 완료',
                message: `시험 일정이 ${editingId ? '수정' : '등록'}되었습니다.`,
                color: 'green',
            });
            queryClient.invalidateQueries({ queryKey: ['exam-rounds'] });
            handleClose();
        },
        onError: (err: any) => {
            notifications.show({
                title: '저장 실패',
                message: err.message,
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
                message: '시험 일정과 모든 신청 내역이 삭제되었습니다.',
                color: 'green',
            });
            queryClient.invalidateQueries({ queryKey: ['exam-rounds'] });
            setDeleteTarget(null);
            closeDelete();
        },
        onError: (err: any) => {
            notifications.show({
                title: '삭제 실패',
                message: err.message || '오류가 발생했습니다.',
                color: 'red',
            });
        },
    });

    // --- Handlers ---
    const handleOpenCreate = () => {
        setEditingId(null);
        form.reset();
        open();
    };

    const handleOpenEdit = (round: ExamRound) => {
        setEditingId(round.id);
        form.setValues({
            exam_date: new Date(round.exam_date),
            registration_deadline: new Date(round.registration_deadline),
            round_label: round.round_label,
            exam_type: (round.exam_type as 'life' | 'nonlife') ?? 'life',
            notes: round.notes || '',
            locations: round.locations.map(l => l.location_name),
        });
        open();
    };

    const handleClose = () => {
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
    const rows = rounds?.map((round) => (
        <Table.Tr key={round.id}>
            <Table.Td>
                <Text fw={600} size="sm">{dayjs(round.exam_date).format('YYYY-MM-DD')}</Text>
            </Table.Td>
            <Table.Td>
                <Text fw={600} size="sm">{round.round_label}</Text>
            </Table.Td>
            <Table.Td>
                <Text
                    size="sm"
                    c={dayjs().isAfter(dayjs(round.registration_deadline).endOf('day')) ? 'red' : CHARCOAL}
                >
                    {dayjs(round.registration_deadline).format('YYYY-MM-DD')}{' '}
                    {dayjs().isAfter(dayjs(round.registration_deadline).endOf('day')) && '(마감)'}
                </Text>
            </Table.Td>
            <Table.Td>
                <Group gap={4}>
                    {round.locations.map((loc) => (
                        <Badge key={loc.id} variant="light" color="gray" size="sm">
                            {loc.location_name}
                        </Badge>
                    ))}
                </Group>
            </Table.Td>
            <Table.Td>
                <Group gap={6}>
                    <ActionIcon variant="light" color="orange" onClick={() => handleOpenEdit(round)} aria-label="일정 수정">
                        <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon variant="light" color="red" onClick={() => handleOpenDelete(round)} aria-label="일정 삭제">
                        <IconTrash size={16} />
                    </ActionIcon>
                </Group>
            </Table.Td>
        </Table.Tr>
    ));

    return (
        <Container size="xl" py="xl">
            <Group justify="space-between" mb="lg">
                <div>
                    <Title order={2} c={CHARCOAL}>시험 일정 관리</Title>
                    <Text c={MUTED} size="sm">자격 시험 일정과 접수 가능한 장소를 관리합니다.</Text>
                </div>
                <Group>
                    <SegmentedControl
                        value={viewMode}
                        onChange={(v) => setViewMode(v as 'list' | 'calendar')}
                        data={[
                            { label: '리스트', value: 'list' },
                            { label: '캘린더', value: 'calendar' }
                        ]}
                    />
                    <Button leftSection={<IconPlus size={16} />} color="orange" onClick={handleOpenCreate}>
                        일정 등록
                    </Button>
                </Group>
            </Group>

            {viewMode === 'list' ? (
                <Paper shadow="sm" radius="lg" withBorder style={{ overflow: 'hidden' }}>
                    <ScrollArea>
                        <Table verticalSpacing="md" highlightOnHover>
                            <Table.Thead bg="#F9FAFB">
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
                                    <Table.Tr><Table.Td colSpan={5} align="center" py={60} c="dimmed">등록된 일정이 없습니다.</Table.Td></Table.Tr>
                                )}
                            </Table.Tbody>
                        </Table>
                    </ScrollArea>
                </Paper>
            ) : (
                <Paper shadow="sm" radius="lg" withBorder p="xl" bg="white">
                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
                        <Paper
                            withBorder
                            radius="lg"
                            p="lg"
                            style={{
                                background: 'linear-gradient(180deg, #ffffff 0%, #fff7ed 100%)',
                                borderColor: '#f3f4f6',
                            }}
                        >
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
                                <Badge variant="light" color="orange" radius="xl">Calendar View</Badge>
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
                                renderDay={(date) => {
                                    const dayStr = dayjs(date).format('YYYY-MM-DD');
                                    const round = rounds?.find(r => r.exam_date === dayStr);
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
                                }}
                            />
                        </Paper>

                        <Stack gap="lg">
                            <Paper withBorder radius="lg" p="md" bg="#f8f9fa">
                                <Text fw={700} size="sm" mb="sm">일정 범례</Text>
                                <Group gap="xs" mb="xs">
                                    <Box w={10} h={10} bg="orange.5" style={{ borderRadius: 999 }} />
                                    <Text size="xs">생명보험 시험</Text>
                                </Group>
                                <Group gap="xs">
                                    <Box w={10} h={10} bg="blue.5" style={{ borderRadius: 999 }} />
                                    <Text size="xs">손해보험 시험</Text>
                                </Group>
                            </Paper>

                            <Paper withBorder radius="lg" p="md">
                                <Group justify="space-between" mb="sm">
                                    <Text fw={700} size="sm">다가오는 시험</Text>
                                    <Badge variant="outline" color="gray" radius="xl">
                                        {rounds?.length ?? 0}건
                                    </Badge>
                                </Group>
                                <Stack gap="xs">
                                    {rounds?.filter(r => dayjs(r.exam_date).isAfter(dayjs())).slice(0, 4).map(r => (
                                        <Paper key={r.id} withBorder p="sm" radius="md" bg="white">
                                            <Text size="sm" fw={700}>{r.round_label}</Text>
                                            <Group gap={6} mt={4}>
                                                <Badge size="xs" color={r.exam_type === 'life' ? 'orange' : 'blue'} variant="light">
                                                    {r.exam_type === 'life' ? '생명' : '손해'}
                                                </Badge>
                                                <Text size="xs" c="dimmed">{dayjs(r.exam_date).format('MM.DD')}</Text>
                                            </Group>
                                        </Paper>
                                    ))}
                                    {!rounds?.filter(r => dayjs(r.exam_date).isAfter(dayjs())).length && (
                                        <Text size="xs" c="dimmed">예정된 일정이 없습니다.</Text>
                                    )}
                                </Stack>
                            </Paper>

                            <Button variant="light" size="sm" fullWidth onClick={() => setViewMode('list')}>
                                전체 일정 관리
                            </Button>
                        </Stack>
                    </SimpleGrid>
                </Paper>
            )}

            {/* Modal */}
            <Modal
                opened={opened}
                onClose={handleClose}
                title={
                    <Group gap="sm">
                        <ThemeIcon radius="md" variant="light" color="orange">
                            <IconCalendar size={18} />
                        </ThemeIcon>
                        <div>
                            <Text fw={700} size="lg">{editingId ? '일정 수정' : '새 일정 등록'}</Text>
                            <Text size="xs" c="dimmed">시험 일정과 접수 정보를 빠르게 정리하세요.</Text>
                        </div>
                    </Group>
                }
                size="lg"
                centered
            >
                <form onSubmit={form.onSubmit(handleSubmit)}>
                    <Stack gap="lg">
                        <Paper withBorder radius="lg" p="md" bg="gray.0">
                            <Text fw={700} size="sm" mb="sm">시험 일정</Text>
                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                                <DateInput
                                    label="시험일"
                                    placeholder="시험 날짜 선택"
                                    leftSection={<IconCalendar size={16} />}
                                    {...form.getInputProps('exam_date')}
                                    locale="ko"
                                    monthLabelFormat="YYYY년 M월"
                                    previousIcon={<IconChevronLeft size={14} />}
                                    nextIcon={<IconChevronRight size={14} />}
                                    valueFormat="YYYY년 MM월 DD일"
                                    popoverProps={{ width: 320, position: 'bottom-start', shadow: 'md' }}
                                    size="sm"
                                    styles={{
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
                                    }}
                                />
                                <DateInput
                                    label="접수 마감일"
                                    placeholder="마감 날짜 선택"
                                    leftSection={<IconCalendar size={16} />}
                                    {...form.getInputProps('registration_deadline')}
                                    locale="ko"
                                    monthLabelFormat="YYYY년 M월"
                                    previousIcon={<IconChevronLeft size={14} />}
                                    nextIcon={<IconChevronRight size={14} />}
                                    valueFormat="YYYY년 MM월 DD일"
                                    popoverProps={{ width: 320, position: 'bottom-start', shadow: 'md' }}
                                    size="sm"
                                    styles={{
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
                                    }}
                                />
                            </SimpleGrid>
                        </Paper>

                        <Paper withBorder radius="lg" p="md">
                            <Text fw={700} size="sm" mb="sm">시험 정보</Text>
                            <SegmentedControl
                                fullWidth
                                radius="md"
                                data={[
                                    { value: 'life', label: '생명 / 제3보험' },
                                    { value: 'nonlife', label: '손해보험' },
                                ]}
                                {...form.getInputProps('exam_type')}
                            />
                            <TextInput
                                label="회차명/구분"
                                placeholder="예: 9월 1차 생명보험"
                                mt="md"
                                {...form.getInputProps('round_label')}
                            />
                        </Paper>

                        <Paper withBorder radius="lg" p="md">
                            <Text fw={700} size="sm" mb="sm">고사장 및 비고</Text>
                            <Box>
                                <Text size="sm" fw={500} mb={4}>고사장(장소) 관리</Text>
                                <TagsInput
                                    placeholder="Enter로 장소 추가 (예: 서울, 부산)"
                                    {...form.getInputProps('locations')}
                                    data={['서울', '부산', '대구', '인천', '광주', '대전', '울산', '제주']}
                                    clearable
                                />
                                <Text size="xs" c="dimmed" mt={4}>
                                    * 이미 신청자가 있는 장소는 삭제되지 않을 수 있습니다.
                                </Text>
                            </Box>

                            <TextInput
                                label="비고 (선택)"
                                placeholder="메모 사항"
                                mt="md"
                                {...form.getInputProps('notes')}
                            />
                        </Paper>

                        <Group justify="space-between" mt="xs">
                            <Button variant="default" onClick={handleClose}>취소</Button>
                            <Button type="submit" color="orange" loading={saveMutation.isPending}>
                                {editingId ? '수정 저장' : '등록 하기'}
                            </Button>
                        </Group>
                    </Stack>
                </form>
            </Modal>

            {/* Delete Confirm */}
            <Modal opened={deleteOpened} onClose={closeDelete} title="일정 삭제" centered>
                <Stack gap="md">
                    <Text size="sm" c="dimmed">
                        {deleteTarget ? `'${deleteTarget.label}' 일정을 삭제하시겠습니까?\n주의: 해당 회차의 모든 FC 신청 내역이 초기화(삭제)됩니다.` : '일정을 삭제하시겠습니까?'}
                    </Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={closeDelete}>취소</Button>
                        <Button color="red" onClick={handleConfirmDelete} loading={deleteMutation.isPending}>
                            삭제
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Container>
    );
}