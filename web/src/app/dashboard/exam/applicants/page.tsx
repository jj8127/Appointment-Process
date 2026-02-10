'use client';

import { useSession } from '@/hooks/use-session';
import {
    ActionIcon,
    Badge,
    Button,
    Checkbox,
    Container,
    Divider,
    Group,
    Loader,
    Paper,
    Popover,
    ScrollArea,
    SegmentedControl,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
    Tooltip,
    UnstyledButton
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconDownload, IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';

import { supabase } from '@/lib/supabase';

// --- Constants ---
const HANWHA_ORANGE = '#F37321';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';

// --- Types ---
type Applicant = {
    id: string; // registration id
    status: string;
    created_at: string;
    resident_id: string;
    name: string;
    phone: string;
    affiliation: string;
    address: string;
    location_name: string;
    round_label: string;
    exam_date: string | null;
    exam_type?: string | null;
    fee_paid_date?: string | null;
    is_confirmed: boolean;
    is_third_exam?: boolean;
};

// Filter state type: key is column key, value is array of selected strings
type FilterState = Record<string, string[]>;

interface ExcelColumnFilterProps {
    title: string;
    field: keyof Applicant | 'round_info' | 'subject_display'; // Expanded fields
    options: string[];
    selected: string[];
    onApply: (selected: string[]) => void;
}

type RowField = ExcelColumnFilterProps['field'];

type ColumnField =
    | 'round_info'
    | 'subject_display'
    | 'affiliation'
    | 'name'
    | 'resident_id'
    | 'address'
    | 'phone'
    | 'location_name'
    | 'fee_paid_date'
    | 'is_confirmed';

const ExcelColumnFilter = ({ title, options, selected, onApply }: ExcelColumnFilterProps) => {
    const [opened, setOpened] = useState(false);
    const [search, setSearch] = useState('');
    const [tempSelected, setTempSelected] = useState<string[]>(selected);

    const handleOpenedChange = (next: boolean) => {
        setOpened(next);
        if (next) {
            setTempSelected(selected);
            setSearch('');
        }
    };

    const filteredOptions = options.filter(opt =>
        opt.toLowerCase().includes(search.toLowerCase())
    );

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            // Select all CURRENTLY FILTERED options
            const newSelected = new Set([...tempSelected, ...filteredOptions]);
            setTempSelected(Array.from(newSelected));
        } else {
            // Deselect all CURRENTLY FILTERED options
            const newSelected = tempSelected.filter(s => !filteredOptions.includes(s));
            setTempSelected(newSelected);
        }
    };

    const isAllSelected = filteredOptions.length > 0 && filteredOptions.every(opt => tempSelected.includes(opt));
    const isIndeterminate = filteredOptions.some(opt => tempSelected.includes(opt)) && !isAllSelected;

    return (
        <Popover opened={opened} onChange={handleOpenedChange} width={280} position="bottom-start" withArrow shadow="md">
            <Popover.Target>
                <UnstyledButton onClick={() => handleOpenedChange(!opened)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Text fw={700} size="sm" c={selected.length > 0 ? 'orange' : 'dimmed'}>
                        {title}
                    </Text>
                    <IconChevronDown size={14} color={selected.length > 0 ? HANWHA_ORANGE : '#868e96'} />
                </UnstyledButton>
            </Popover.Target>
            <Popover.Dropdown p="xs">
                <Stack gap="xs">
                    <TextInput
                        placeholder="검색..."
                        size="xs"
                        leftSection={<IconSearch size={12} />}
                        value={search}
                        onChange={(e) => setSearch(e.currentTarget.value)}
                        rightSection={
                            search ? <IconX size={12} onClick={() => setSearch('')} style={{ cursor: 'pointer' }} /> : null
                        }
                    />
                    <Divider />
                    <ScrollArea h={200} type="auto" offsetScrollbars>
                        <Stack gap={6}>
                            <Checkbox
                                label="(모두 선택)"
                                size="xs"
                                checked={isAllSelected}
                                indeterminate={isIndeterminate}
                                onChange={(e) => handleSelectAll(e.currentTarget.checked)}
                                styles={{ input: { cursor: 'pointer' }, label: { cursor: 'pointer', fontWeight: 600 } }}
                            />
                            {filteredOptions.length === 0 ? (
                                <Text size="xs" c="dimmed" ta="center" py="xs">검색 결과가 없습니다.</Text>
                            ) : (
                                filteredOptions.map(opt => (
                                    <Checkbox
                                        key={opt}
                                        label={opt}
                                        value={opt}
                                        size="xs"
                                        checked={tempSelected.includes(opt)}
                                        onChange={(e) => {
                                            if (e.currentTarget.checked) {
                                                setTempSelected([...tempSelected, opt]);
                                            } else {
                                                setTempSelected(tempSelected.filter(s => s !== opt));
                                            }
                                        }}
                                        styles={{ input: { cursor: 'pointer' }, label: { cursor: 'pointer' } }}
                                    />
                                ))
                            )}
                        </Stack>
                    </ScrollArea>
                    <Divider />
                    <Group justify="flex-end" gap="xs">
                        <Button variant="light" color="gray" size="xs" onClick={() => setOpened(false)}>취소</Button>
                        <Button variant="filled" color="orange" size="xs" onClick={() => {
                            onApply(tempSelected);
                            setOpened(false);
                        }}>확인</Button>
                    </Group>
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
};

type ExamRegistrationRow = {
    id: string;
    status: string;
    created_at: string;
    resident_id: string;
    is_confirmed: boolean;
    is_third_exam?: boolean | null;
    fee_paid_date?: string | null;
    exam_locations?: { location_name?: string | null } | null;
    exam_rounds?: { round_label?: string | null; exam_date?: string | null; exam_type?: string | null } | null;
};

type ProfileRow = {
    phone: string;
    name: string | null;
    affiliation: string | null;
    address: string | null;
    resident_id_masked: string | null;
};

export default function ExamApplicantsPage() {
    const queryClient = useQueryClient();
    const { isReadOnly } = useSession();
    const [filters, setFilters] = useState<FilterState>({});

    const colMinWidth: Record<ColumnField, number> = useMemo(
        () => ({
            round_info: 100,
            subject_display: 120,
            affiliation: 180,
            name: 80,
            resident_id: 130,
            address: 420,
            phone: 120,
            location_name: 70,
            fee_paid_date: 120,
            is_confirmed: 130,
        }),
        []
    );

    // --- Fetch All Recent Applicants ---
    const { data: applicants, isLoading, refetch } = useQuery({
        queryKey: ['exam-applicants-all-recent'],
        queryFn: async () => {
            // limit 1000 for performance
            const { data, error } = await supabase
                .from('exam_registrations')
                .select(`
          id, status, created_at, resident_id, is_confirmed, is_third_exam, fee_paid_date,
          exam_locations ( location_name ),
          exam_rounds ( round_label, exam_date, exam_type )
        `)
                .order('created_at', { ascending: false })
                .limit(1000);

            if (error) throw error;

            const rows = (data ?? []) as ExamRegistrationRow[];
            const base = rows.map((d) => ({
                id: d.id,
                status: d.status,
                created_at: d.created_at,
                resident_id: d.resident_id,
                is_confirmed: d.is_confirmed,
                is_third_exam: d.is_third_exam,
                location_name: d.exam_locations?.location_name || '미정',
                round_label: d.exam_rounds?.round_label || '-',
                exam_date: d.exam_rounds?.exam_date ?? null,
                exam_type: d.exam_rounds?.exam_type ?? null,
                fee_paid_date: d.fee_paid_date ?? null,
            })) as Applicant[];

            const phones = Array.from(new Set(base.map((b) => b.resident_id).filter(Boolean)));
            if (phones.length === 0) return base;

            const { data: profiles } = await supabase
                .from('fc_profiles')
                .select('phone,name,affiliation,address,resident_id_masked')
                .eq('signup_completed', true)
                .in('phone', phones);
            const profileRows = (profiles ?? []) as ProfileRow[];
            const pmap = new Map(profileRows.map((p) => [p.phone, p]));

            return base.map((b) => {
                const p = pmap.get(b.resident_id);
                return {
                    ...b,
                    name: p?.name ?? '이름없음',
                    phone: p?.phone ?? b.resident_id,
                    affiliation: p?.affiliation ?? '-',
                    address: p?.address ?? '-',
                    resident_id: p?.resident_id_masked ?? '-',
                };
            });
        }
    });

    // --- Derived Data Helper ---
    // Calculate display values for filtering and rendering
    const getRowValue = (item: Applicant, field: RowField) => {
        switch (field) {
            case 'round_info': {
                const examDate = item.exam_date ? dayjs(item.exam_date).format('YYYY-MM-DD') : '미정';
                return `${examDate} (${item.round_label})`;
            }
            case 'fee_paid_date':
                return item.fee_paid_date ? dayjs(item.fee_paid_date).format('YYYY-MM-DD') : '-';
            case 'is_confirmed':
                return item.is_confirmed ? '접수 완료' : '미접수';
            case 'subject_display': {
                const label = item.round_label || '';
                const subjects: string[] = [];

                // Prefer explicit exam_type from exam_rounds.
                if (item.exam_type === 'life') subjects.push('생명보험');
                else if (item.exam_type === 'nonlife') subjects.push('손해보험');
                else {
                    // Backward compatible inference from label if exam_type is missing.
                    const isNonLife = label.includes('손해');
                    const isLife = label.includes('생명');
                    if (isNonLife) subjects.push('손해보험');
                    else if (isLife) subjects.push('생명보험');
                    else subjects.push('미정');
                }

                if (item.is_third_exam) {
                    subjects.push('제3보험');
                }

                return subjects.join(', ');
            }
            default:
                return String(item[field] ?? '');
        }
    };

    const filterOptions = useMemo(() => {
        if (!applicants) return {};
        const fields: ColumnField[] = ['round_info', 'name', 'phone', 'affiliation', 'address', 'location_name', 'fee_paid_date', 'is_confirmed', 'subject_display'];
        const options: Record<string, string[]> = {};

        fields.forEach(field => {
            const unique = Array.from(new Set(applicants.map(a => getRowValue(a, field)))).filter(Boolean).sort();
            options[field] = unique;
        });
        return options;
    }, [applicants]);

    // --- Filter Logic ---
    const filteredRows = useMemo(() => {
        if (!applicants) return [];
        return applicants.filter(item => {
            return Object.entries(filters).every(([field, selectedValues]) => {
                if (!selectedValues || selectedValues.length === 0) return true;
                const val = getRowValue(item, field as RowField);
                return selectedValues.includes(val);
            });
        });
    }, [applicants, filters]);

    // --- Stats ---
    const stats = useMemo(() => {
        const total = filteredRows.length;
        const confirmed = filteredRows.filter(a => a.is_confirmed).length;
        const pending = total - confirmed;
        return { total, confirmed, pending };
    }, [filteredRows]);

    // --- Mutations ---
    const updateStatusMutation = useMutation({
        mutationFn: async ({ id, isConfirmed }: { id: string; isConfirmed: boolean }) => {
            const nextStatus = isConfirmed ? 'confirmed' : 'applied';
            const { error } = await supabase
                .from('exam_registrations')
                .update({ is_confirmed: isConfirmed, status: nextStatus })
                .eq('id', id);
            if (error) throw error;
            return { id, isConfirmed };
        },
        onSuccess: ({ id, isConfirmed }) => {
            queryClient.setQueryData(['exam-applicants-all-recent'], (old: unknown) => {
                if (!Array.isArray(old)) return old;
                return (old as Applicant[]).map((item) => (item.id === id ? { ...item, is_confirmed: isConfirmed } : item));
            });
            notifications.show({
                title: '상태 변경 완료',
                message: isConfirmed ? '접수 완료 상태로 변경되었습니다.' : '미접수 상태로 변경되었습니다.',
                color: 'green',
                icon: <IconRefresh size={16} />,
            });
        },
        onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.';
            notifications.show({ title: '오류', message: msg, color: 'red' });
        },
    });

    // --- CSV Download ---
    const handleDownloadCsv = () => {
        if (filteredRows.length === 0) {
            notifications.show({ title: '알림', message: '다운로드할 데이터가 없습니다.', color: 'blue' });
            return;
        }

        const headers = ['시험 구분', '이름', '연락처', '소속', '주소', '주민번호', '시험 응시 과목', '고사장', '응시료 납입일', '상태', '신청일'];
        const asExcelText = (value: string) => `="${String(value).replace(/"/g, '""')}"`;
        const pRows = filteredRows.map(a => [
            getRowValue(a, 'round_info'),
            a.name,
            asExcelText(a.phone),
            a.affiliation,
            a.address,
            asExcelText(a.resident_id),
            getRowValue(a, 'subject_display'), // New Subject Column
            a.location_name,
            a.fee_paid_date ? dayjs(a.fee_paid_date).format('YYYY-MM-DD') : '-',
            a.is_confirmed ? '접수 완료' : '미접수',
            asExcelText(dayjs(a.created_at).format('YYYY-MM-DD HH:mm'))
        ]);

        const csvContent = [
            headers.join(','),
            ...pRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `exam_applicants_${dayjs().format('YYYYMMDD')}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const renderHeader = (title: string, field: ColumnField, minWidth?: number) => (
        <Table.Th style={minWidth ? { minWidth } : undefined}>
            <ExcelColumnFilter
                title={title}
                field={field}
                options={filterOptions[field] || []}
                selected={filters[field] || []}
                onApply={(val) => setFilters(prev => ({ ...prev, [field]: val }))}
            />
        </Table.Th>
    );

    return (
        <Container size="xl" py="xl">
            <Stack gap="xl">
                {/* Header */}
                <Group justify="space-between" align="center">
                    <div>
                        <Title order={2} c={CHARCOAL}>신청자 관리</Title>
                        <Text c={MUTED} size="sm">최근 신청자 목록 및 응시 과목을 확인합니다.</Text>
                    </div>
                    <Group gap="xs">
                        <Button
                            leftSection={<IconDownload size={16} />}
                            variant="filled"
                            color="green"
                            onClick={handleDownloadCsv}
                            radius="md"
                        >
                            엑셀 다운로드
                        </Button>
                        <Tooltip label="데이터 새로고침">
                            <ActionIcon variant="light" color="gray" size="lg" onClick={() => refetch()} loading={isLoading}>
                                <IconRefresh size={20} />
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                </Group>

                {/* Stats */}
                <Group grow>
                    <Paper p="md" radius="md" withBorder shadow="sm">
                        <Text size="xs" c="dimmed" fw={700} tt="uppercase">총 신청자 (현재 필터)</Text>
                        <Text fw={700} size="xl" mt="xs">{stats.total}명</Text>
                    </Paper>
                    <Paper p="md" radius="md" withBorder shadow="sm" style={{ borderLeft: `4px solid ${HANWHA_ORANGE}` }}>
                        <Text size="xs" c="orange" fw={700} tt="uppercase">접수 완료</Text>
                        <Text fw={700} size="xl" mt="xs" c="orange">{stats.confirmed}명</Text>
                    </Paper>
                    <Paper p="md" radius="md" withBorder shadow="sm">
                        <Text size="xs" c="dimmed" fw={700} tt="uppercase">미접수</Text>
                        <Text fw={700} size="xl" mt="xs">{stats.pending}명</Text>
                    </Paper>
                </Group>

                {/* Table */}
                <Paper shadow="sm" radius="md" withBorder p="0" bg="white" style={{ overflow: 'hidden' }}>
                    <ScrollArea h={650} type="always" offsetScrollbars styles={{ viewport: { overflowX: 'auto', overflowY: 'auto' } }}>
                        <Table
                            highlightOnHover
                            verticalSpacing="sm"
                            horizontalSpacing="md"
                            striped
                            withColumnBorders
                            stickyHeader
                            style={{ minWidth: 1950 }}
                        >
                            <Table.Thead bg="gray.0">
                                <Table.Tr>
                                    {renderHeader('시험 구분', 'round_info', colMinWidth.round_info)}
                                    {renderHeader('시험 응시 과목', 'subject_display', colMinWidth.subject_display)}
                                    {renderHeader('소속', 'affiliation', colMinWidth.affiliation)}
                                    {renderHeader('이름', 'name', colMinWidth.name)}
                                    {renderHeader('주민등록번호', 'resident_id', colMinWidth.resident_id)}
                                    {renderHeader('주소', 'address', colMinWidth.address)}
                                    {renderHeader('전화번호', 'phone', colMinWidth.phone)}
                                    {renderHeader('고사장', 'location_name', colMinWidth.location_name)}
                                    {renderHeader('응시료 납입일', 'fee_paid_date', colMinWidth.fee_paid_date)}
                                    {renderHeader('상태', 'is_confirmed', colMinWidth.is_confirmed)}
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {isLoading ? (
                                    <Table.Tr><Table.Td colSpan={10} align="center" py={80}><Loader color="orange" type="dots" /></Table.Td></Table.Tr>
                                ) : filteredRows.length > 0 ? (
                                    filteredRows.map((item) => (
                                        <Table.Tr key={item.id}>
                                            <Table.Td>
                                                <Stack gap={0}>
                                                    <Text size="xs" c="dimmed">
                                                        {item.exam_date ? dayjs(item.exam_date).format('YYYY-MM-DD') : '미정'}
                                                    </Text>
                                                    <Text size="sm" fw={500} style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                                                        {item.round_label}
                                                    </Text>
                                                </Stack>
                                            </Table.Td>
                                            <Table.Td>
                                                <Badge
                                                    variant="light"
                                                    color="blue"
                                                    radius="sm"
                                                    styles={{ label: { whiteSpace: 'normal' } }}
                                                >
                                                    {getRowValue(item, 'subject_display')}
                                                </Badge>
                                            </Table.Td>
                                            <Table.Td><Text size="sm">{item.affiliation}</Text></Table.Td>
                                            <Table.Td><Text fw={600} size="sm">{item.name}</Text></Table.Td>
                                            <Table.Td><Text size="sm" c="dimmed">{item.resident_id}</Text></Table.Td>
                                            <Table.Td>
                                                <Text size="sm" style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                                                    {item.address}
                                                </Text>
                                            </Table.Td>
                                            <Table.Td><Text size="sm">{item.phone}</Text></Table.Td>
                                            <Table.Td><Text size="sm">{item.location_name}</Text></Table.Td>
                                            <Table.Td>
                                                <Text size="sm">{item.fee_paid_date ? dayjs(item.fee_paid_date).format('YYYY-MM-DD') : '-'}</Text>
                                            </Table.Td>
                                            <Table.Td>
                                                <SegmentedControl
                                                    size="xs"
                                                    radius="xl"
                                                    data={[
                                                        { label: '미접수', value: 'false' },
                                                        { label: '접수 완료', value: 'true' },
                                                    ]}
                                                    value={String(item.is_confirmed)}
                                                    onChange={(v) => updateStatusMutation.mutate({ id: item.id, isConfirmed: v === 'true' })}
                                                    color={item.is_confirmed ? 'orange' : 'gray'}
                                                    styles={{
                                                        root: { backgroundColor: item.is_confirmed ? '#fff4e6' : '#f1f3f5' },
                                                        indicator: { backgroundColor: item.is_confirmed ? HANWHA_ORANGE : '#adb5bd' },
                                                        label: { fontWeight: 600 }
                                                    }}
                                                    disabled={
                                                        isReadOnly ||
                                                        (updateStatusMutation.isPending && updateStatusMutation.variables?.id === item.id)
                                                    }
                                                />
                                            </Table.Td>
                                        </Table.Tr>
                                    ))
                                ) : (
                                    <Table.Tr><Table.Td colSpan={10} align="center" py={80} c="dimmed">
                                        <Stack align="center" gap="xs">
                                            <IconSearch size={40} color="#dee2e6" />
                                            <Text>데이터가 없습니다.</Text>
                                        </Stack>
                                    </Table.Td></Table.Tr>
                                )}
                            </Table.Tbody>
                        </Table>
                    </ScrollArea>
                </Paper>
            </Stack>
        </Container>
    );
}
