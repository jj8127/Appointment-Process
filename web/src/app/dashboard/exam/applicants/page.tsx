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
    Menu,
    Tabs,
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
import { IconChevronDown, IconDownload, IconRefresh, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';

import {
    buildExamApplicantRoundFilterOptions,
    buildExamApplicantSubjectFilterOptions,
    EXAM_APPLICANT_ALL_FILTER_VALUE,
    EXAM_APPLICANT_EXPORT_COLUMNS,
    EXAM_APPLICANT_TABLE_BADGE_STYLES,
    formatExamApplicantReceptionStatus,
    getExamApplicantRoundFilterValue,
    getExamApplicantCellValue,
    getExamApplicantSubjectKey,
    isExamApplicantRoundFilterValid,
    type ExamApplicantExportColumn,
    type ExamApplicantExportColumnKey,
    type ExamApplicantFilterOption,
} from '@/lib/exam-applicant-list-display';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// --- Constants ---
const HANWHA_ORANGE = '#F37321';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';

// --- Types ---
type Applicant = {
    id: string; // registration id
    status: string;
    created_at: string;
    round_id: string | null;
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
    application_type?: string | null;
};

// Filter state type: key is column key, value is array of selected strings
type FilterState = Record<string, string[]>;

interface ExcelColumnFilterProps {
    title: string;
    field: RowField;
    options: string[];
    selected: string[];
    onApply: (selected: string[]) => void;
}

type RowField = ExamApplicantExportColumnKey | 'is_confirmed';

type ColumnField =
    | ExamApplicantExportColumnKey
    | 'is_confirmed'
    | 'actions';

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
                <UnstyledButton
                    onClick={() => handleOpenedChange(!opened)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, width: '100%' }}
                >
                    <Text
                        fw={700}
                        size="sm"
                        c={selected.length > 0 ? 'orange' : 'dimmed'}
                        ta="center"
                        style={{ whiteSpace: 'normal', wordBreak: 'keep-all', lineHeight: 1.25 }}
                    >
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

interface TopFilterMenuProps {
    title: string;
    options: ExamApplicantFilterOption[];
    value: string;
    onChange: (value: string) => void;
}

const TopFilterMenu = ({ title, options, value, onChange }: TopFilterMenuProps) => {
    const selected = options.find((option) => option.value === value) ?? options[0];
    const isActive = value !== EXAM_APPLICANT_ALL_FILTER_VALUE;

    return (
        <Menu shadow="md" width={300} position="bottom-start" withinPortal>
            <Menu.Target>
                <Button
                    variant={isActive ? 'filled' : 'light'}
                    color={isActive ? 'orange' : 'gray'}
                    radius="xl"
                    size="xs"
                    rightSection={<IconChevronDown size={14} />}
                    styles={{
                        root: { maxWidth: '100%', height: 'auto', minHeight: 30, paddingTop: 6, paddingBottom: 6 },
                        label: { whiteSpace: 'normal', lineHeight: 1.2, wordBreak: 'keep-all', textAlign: 'left' },
                        section: { flexShrink: 0 },
                    }}
                >
                    {title}: {selected?.label ?? '전체'}
                </Button>
            </Menu.Target>
            <Menu.Dropdown style={{ maxHeight: 320, overflowY: 'auto' }}>
                {options.map((option) => (
                    <Menu.Item
                        key={option.value}
                        color={option.value === value ? 'orange' : undefined}
                        onClick={() => onChange(option.value)}
                    >
                        {option.label}
                    </Menu.Item>
                ))}
            </Menu.Dropdown>
        </Menu>
    );
};

const formatExamApprovalInfo = (item: Applicant) => {
    const dateLabel = item.exam_date ? dayjs(item.exam_date).format('YYYY-MM-DD') : '시험 일정';
    const roundLabel = item.round_label && item.round_label !== '-' ? ` (${item.round_label})` : '';
    const locationLabel = item.location_name && item.location_name !== '미정' ? ` [${item.location_name}]` : '';
    return `${dateLabel}${roundLabel}${locationLabel}`;
};

async function notifyFcExamApprovalStatus(item: Applicant, isConfirmed: boolean) {
    const targetId = (item.phone ?? '').replace(/[^0-9]/g, '');
    if (!targetId) {
        throw new Error('FC 전화번호를 찾을 수 없습니다.');
    }

    const response = await fetch('/api/fc-notify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'exam_approval_notify',
            target_id: targetId,
            is_confirmed: isConfirmed,
            exam_info: formatExamApprovalInfo(item),
            exam_type: item.exam_type,
        }),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(data) || data.ok !== true) {
        const message = isRecord(data) && typeof data.error === 'string'
            ? data.error
            : '시험 승인 알림 전송 실패';
        throw new Error(message);
    }
}

export default function ExamApplicantsPage() {
    const queryClient = useQueryClient();
    const { isReadOnly, hydrated, role } = useSession();
    const [filters, setFilters] = useState<FilterState>({});
    const [quickAffiliation, setQuickAffiliation] = useState('전체');
    const [examSubjectFilter, setExamSubjectFilter] = useState(EXAM_APPLICANT_ALL_FILTER_VALUE);
    const [examRoundFilter, setExamRoundFilter] = useState(EXAM_APPLICANT_ALL_FILTER_VALUE);

    const tableColumnCount = EXAM_APPLICANT_EXPORT_COLUMNS.length + 2;
    const statusColumnMinWidth = 130;
    const actionsColumnMinWidth = 90;
    const tableMinWidth = EXAM_APPLICANT_EXPORT_COLUMNS.reduce(
        (sum, column) => sum + column.minWidth,
        statusColumnMinWidth + actionsColumnMinWidth,
    );

    // --- Fetch All Recent Applicants ---
    const { data: applicants, isLoading, error: applicantsError, refetch } = useQuery({
        queryKey: ['exam-applicants-all-recent', role],
        enabled: hydrated,
        queryFn: async () => {
            const response = await fetch('/api/admin/exam-applicants', {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
            });
            const json: unknown = await response.json().catch(() => null);

            const isOk =
                response.ok &&
                isRecord(json) &&
                json.ok === true &&
                Array.isArray(json.applicants);
            if (!isOk) {
                const message =
                    isRecord(json) && typeof json.error === 'string'
                        ? json.error
                        : '시험 신청 목록을 불러오지 못했습니다.';
                throw new Error(message);
            }

            return json.applicants as Applicant[];
        }
    });

    // --- Derived Data Helper ---
    // Calculate display values for filtering and rendering
    const getRowValue = (item: Applicant, field: RowField) => {
        if (field === 'is_confirmed') {
            return formatExamApplicantReceptionStatus(item);
        }

        return getExamApplicantCellValue(item, field);
    };

    const filterOptions = useMemo(() => {
        if (!applicants) return {};
        const fields: RowField[] = [
            ...EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => column.key),
            'is_confirmed',
        ];
        const options: Record<string, string[]> = {};

        fields.forEach(field => {
            const unique = Array.from(new Set(applicants.map(a => getRowValue(a, field)))).filter(Boolean).sort();
            options[field] = unique;
        });
        return options;
    }, [applicants]);

    const quickAffiliationOptions = useMemo(() => {
        if (!applicants) return ['전체'];
        const raw = applicants
            .map((item) => item.affiliation || '-')
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        const unique = Array.from(new Set(raw));
        return ['전체', ...unique];
    }, [applicants]);

    const examSubjectFilterOptions = useMemo(
        () => buildExamApplicantSubjectFilterOptions(applicants ?? []),
        [applicants],
    );

    const examRoundFilterOptions = useMemo(
        () => buildExamApplicantRoundFilterOptions(applicants ?? [], examSubjectFilter),
        [applicants, examSubjectFilter],
    );

    const effectiveExamRoundFilter = useMemo(() => {
        if (!applicants) return EXAM_APPLICANT_ALL_FILTER_VALUE;
        return isExamApplicantRoundFilterValid(applicants, examSubjectFilter, examRoundFilter)
            ? examRoundFilter
            : EXAM_APPLICANT_ALL_FILTER_VALUE;
    }, [applicants, examRoundFilter, examSubjectFilter]);

    const handleExamSubjectFilterChange = (value: string) => {
        setExamSubjectFilter(value);
        setExamRoundFilter((current) =>
            isExamApplicantRoundFilterValid(applicants ?? [], value, current)
                ? current
                : EXAM_APPLICANT_ALL_FILTER_VALUE,
        );
    };

    // --- Filter Logic ---
    const filteredRows = useMemo(() => {
        if (!applicants) return [];
        return applicants.filter(item => {
            if (quickAffiliation !== '전체' && item.affiliation !== quickAffiliation) {
                return false;
            }

            if (
                examSubjectFilter !== EXAM_APPLICANT_ALL_FILTER_VALUE &&
                getExamApplicantSubjectKey(item) !== examSubjectFilter
            ) {
                return false;
            }

            if (
                effectiveExamRoundFilter !== EXAM_APPLICANT_ALL_FILTER_VALUE &&
                getExamApplicantRoundFilterValue(item) !== effectiveExamRoundFilter
            ) {
                return false;
            }

            return Object.entries(filters).every(([field, selectedValues]) => {
                if (!selectedValues || selectedValues.length === 0) return true;
                const val = getRowValue(item, field as RowField);
                return selectedValues.includes(val);
            });
        });
    }, [applicants, effectiveExamRoundFilter, examSubjectFilter, filters, quickAffiliation]);

    // --- Stats ---
    const stats = useMemo(() => {
        const total = filteredRows.length;
        const confirmed = filteredRows.filter(a => a.is_confirmed).length;
        const pending = total - confirmed;
        return { total, confirmed, pending };
    }, [filteredRows]);

    // --- Mutations ---
    const updateStatusMutation = useMutation({
        mutationFn: async ({ item, isConfirmed }: { item: Applicant; isConfirmed: boolean }) => {
            const response = await fetch('/api/admin/exam-applicants', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ registrationId: item.id, isConfirmed }),
            });
            const json: unknown = await response.json().catch(() => null);
            const nextStatus = isConfirmed ? 'confirmed' : 'applied';
            const isOk =
                response.ok &&
                isRecord(json) &&
                json.ok === true;
            if (!isOk) {
                const message =
                    isRecord(json) && typeof json.error === 'string'
                        ? json.error
                        : '시험 신청 상태 변경에 실패했습니다.';
                throw new Error(message);
            }
            return { item, isConfirmed, nextStatus };
        },
        onSuccess: async ({ item, isConfirmed, nextStatus }) => {
            queryClient.setQueryData(['exam-applicants-all-recent', role], (old: unknown) => {
                if (!Array.isArray(old)) return old;
                return (old as Applicant[]).map((row) =>
                    row.id === item.id ? { ...row, is_confirmed: isConfirmed, status: nextStatus } : row,
                );
            });
            notifications.show({
                title: '상태 변경 완료',
                message: isConfirmed ? '접수 완료 상태로 변경되었습니다.' : '미접수 상태로 변경되었습니다.',
                color: 'green',
                icon: <IconRefresh size={16} />,
            });
            if (!isConfirmed) return;

            try {
                await notifyFcExamApprovalStatus(item, true);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : '시험 승인 알림 전송에 실패했습니다.';
                notifications.show({
                    title: '알림 전송 실패',
                    message: `상태는 저장되었지만 FC 앱 알림 전송은 실패했습니다. (${msg})`,
                    color: 'yellow',
                });
            }
        },
        onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.';
            notifications.show({ title: '오류', message: msg, color: 'red' });
        },
    });

    const deleteApplicantMutation = useMutation({
        mutationFn: async (item: Applicant) => {
            const response = await fetch('/api/admin/exam-applicants', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ registrationId: item.id }),
            });

            const json: unknown = await response.json().catch(() => null);
            const isOk = response.ok && isRecord(json) && json.ok === true;
            if (!isOk) {
                const message =
                    isRecord(json) && typeof json.error === 'string'
                        ? json.error
                        : '시험 신청 삭제에 실패했습니다.';
                throw new Error(message);
            }

            return {
                item,
                deleted: !isRecord(json) || typeof json.deleted !== 'boolean' ? true : json.deleted,
            };
        },
        onSuccess: ({ item, deleted }) => {
            queryClient.setQueryData(['exam-applicants-all-recent', role], (old: unknown) => {
                if (!Array.isArray(old)) return old;
                return (old as Applicant[]).filter((row) => row.id !== item.id);
            });
            notifications.show({
                title: deleted ? '삭제 완료' : '이미 삭제됨',
                message: deleted
                    ? `${item.name} 신청 내역을 삭제했습니다.`
                    : '이미 삭제된 신청 내역입니다.',
                color: deleted ? 'green' : 'blue',
                icon: <IconTrash size={16} />,
            });
        },
        onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.';
            notifications.show({ title: '삭제 실패', message: msg, color: 'red' });
        },
    });

    // --- CSV Download ---
    const handleDownloadCsv = () => {
        if (filteredRows.length === 0) {
            notifications.show({ title: '알림', message: '다운로드할 데이터가 없습니다.', color: 'blue' });
            return;
        }

        const headers = EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => column.title);
        const asExcelText = (value: string) => `="${String(value).replace(/"/g, '""')}"`;
        const pRows = filteredRows.map((item) =>
            EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => {
                const value = getRowValue(item, column.key);
                return column.key === 'phone' || column.key === 'resident_id'
                    ? asExcelText(value)
                    : value;
            }),
        );

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

    const renderHeader = (title: string, field: ColumnField, minWidth?: number) => {
        const headerStyle = {
            minWidth,
            textAlign: 'center' as const,
            whiteSpace: 'normal' as const,
            wordBreak: 'keep-all' as const,
            lineHeight: 1.25,
        };

        if (field === 'actions') {
            return (
            <Table.Th style={headerStyle}>
                <Text fw={700} size="sm" c="dimmed" ta="center" style={{ whiteSpace: 'normal', wordBreak: 'keep-all', lineHeight: 1.25 }}>{title}</Text>
            </Table.Th>
            );
        }

        return (
            <Table.Th style={headerStyle}>
                <ExcelColumnFilter
                    title={title}
                    field={field}
                    options={filterOptions[field] || []}
                    selected={filters[field] || []}
                    onApply={(val) => setFilters(prev => ({ ...prev, [field]: val }))}
                />
            </Table.Th>
        );
    };

    const renderApplicantCell = (item: Applicant, column: ExamApplicantExportColumn) => {
        const value = getRowValue(item, column.key);

        if (column.key === 'subject_display') {
            return (
                <Table.Td key={column.key}>
                    <Badge
                        variant="light"
                        color="blue"
                        radius="sm"
                        styles={EXAM_APPLICANT_TABLE_BADGE_STYLES}
                    >
                        {value}
                    </Badge>
                </Table.Td>
            );
        }

        if (column.key === 'application_type') {
            return (
                <Table.Td key={column.key}>
                    <Badge
                        variant="light"
                        color={value === '재신청' ? 'orange' : 'gray'}
                        radius="sm"
                        styles={EXAM_APPLICANT_TABLE_BADGE_STYLES}
                    >
                        {value}
                    </Badge>
                </Table.Td>
            );
        }

        if (column.key === 'fee_paid_date') {
            return (
                <Table.Td key={column.key} ta="center">
                    <Text size="sm" c={value === '-' ? 'dimmed' : undefined} ta="center">
                        {value}
                    </Text>
                </Table.Td>
            );
        }

        if (column.key === 'application_created_at') {
            return (
                <Table.Td key={column.key} ta="center">
                    <Text size="sm" c={value === '-' ? 'dimmed' : undefined} ta="center">
                        {value}
                    </Text>
                </Table.Td>
            );
        }

        if (column.key === 'third_exam') {
            return (
                <Table.Td key={column.key}>
                    <Text size="sm" fw={value === '포함' ? 600 : 400} c={value === '포함' ? CHARCOAL : 'dimmed'}>
                        {value}
                    </Text>
                </Table.Td>
            );
        }

        if (column.key === 'address') {
            return (
                <Table.Td key={column.key}>
                    <Text size="sm" style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                        {value}
                    </Text>
                </Table.Td>
            );
        }

        return (
            <Table.Td key={column.key}>
                <Text size="sm" fw={column.key === 'name' ? 600 : 400} c={column.key === 'resident_id' ? 'dimmed' : undefined}>
                    {value}
                </Text>
            </Table.Td>
        );
    };

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
                <Group gap="xs" align="flex-start" wrap="wrap">
                    <Text size="xs" c="dimmed" fw={500}>빠른 분류:</Text>
                    <Tabs
                        value={quickAffiliation}
                        onChange={(value) => setQuickAffiliation(value ?? '전체')}
                        variant="pills"
                        radius="xl"
                        color="blue"
                    >
                        <Tabs.List bg="blue.0" p={4} style={{ borderRadius: 24, flexWrap: 'wrap' }}>
                            {quickAffiliationOptions.map((option) => (
                                <Tabs.Tab key={option} value={option} fw={600} px={14}>
                                    {option}
                                </Tabs.Tab>
                            ))}
                        </Tabs.List>
                    </Tabs>
                </Group>
                <Group gap="xs" align="center" wrap="wrap">
                    <Text size="xs" c="dimmed" fw={500}>시험 필터:</Text>
                    <TopFilterMenu
                        title="시험 종류"
                        options={examSubjectFilterOptions}
                        value={examSubjectFilter}
                        onChange={handleExamSubjectFilterChange}
                    />
                    <TopFilterMenu
                        title="시험 회차"
                        options={examRoundFilterOptions}
                        value={effectiveExamRoundFilter}
                        onChange={setExamRoundFilter}
                    />
                </Group>
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
                            style={{ minWidth: tableMinWidth }}
                        >
                            <Table.Thead bg="gray.0">
                                <Table.Tr>
                                    {EXAM_APPLICANT_EXPORT_COLUMNS.map((column) =>
                                        renderHeader(column.title, column.key, column.minWidth),
                                    )}
                                    {renderHeader('접수 상태', 'is_confirmed', statusColumnMinWidth)}
                                    {renderHeader('관리', 'actions', actionsColumnMinWidth)}
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {isLoading ? (
                                    <Table.Tr><Table.Td colSpan={tableColumnCount} align="center" py={80}><Loader color="orange" type="dots" /></Table.Td></Table.Tr>
                                ) : applicantsError ? (
                                    <Table.Tr><Table.Td colSpan={tableColumnCount} align="center" py={80} c="red">
                                        <Stack align="center" gap="xs">
                                            <IconX size={36} color="#fa5252" />
                                            <Text fw={600}>목록을 불러오지 못했습니다.</Text>
                                            <Text size="sm" c="dimmed">
                                                {applicantsError instanceof Error ? applicantsError.message : '잠시 후 다시 시도해주세요.'}
                                            </Text>
                                        </Stack>
                                    </Table.Td></Table.Tr>
                                ) : filteredRows.length > 0 ? (
                                    filteredRows.map((item) => (
                                        <Table.Tr key={item.id}>
                                            {EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => renderApplicantCell(item, column))}
                                            <Table.Td>
                                                <SegmentedControl
                                                    size="xs"
                                                    radius="xl"
                                                    data={[
                                                        { label: '미접수', value: 'false' },
                                                        { label: '접수 완료', value: 'true' },
                                                    ]}
                                                    value={String(item.is_confirmed)}
                                                    onChange={(v) => updateStatusMutation.mutate({ item, isConfirmed: v === 'true' })}
                                                    color={item.is_confirmed ? 'orange' : 'gray'}
                                                    styles={{
                                                        root: { backgroundColor: item.is_confirmed ? '#fff4e6' : '#f1f3f5' },
                                                        indicator: { backgroundColor: item.is_confirmed ? HANWHA_ORANGE : '#adb5bd' },
                                                        label: { fontWeight: 600 }
                                                    }}
                                                    disabled={
                                                        isReadOnly ||
                                                        (updateStatusMutation.isPending && updateStatusMutation.variables?.item.id === item.id)
                                                    }
                                                />
                                            </Table.Td>
                                            <Table.Td>
                                                <Tooltip label={isReadOnly ? '본부장은 삭제할 수 없습니다.' : '신청자 삭제'}>
                                                    <ActionIcon
                                                        variant="light"
                                                        color="red"
                                                        size="lg"
                                                        disabled={
                                                            isReadOnly ||
                                                            (deleteApplicantMutation.isPending &&
                                                                deleteApplicantMutation.variables?.id === item.id)
                                                        }
                                                        loading={
                                                            deleteApplicantMutation.isPending &&
                                                            deleteApplicantMutation.variables?.id === item.id
                                                        }
                                                        onClick={() => {
                                                            if (isReadOnly) return;
                                                            if (!window.confirm(`${item.name} 신청 내역을 삭제하시겠습니까?`)) {
                                                                return;
                                                            }
                                                            deleteApplicantMutation.mutate(item);
                                                        }}
                                                    >
                                                        <IconTrash size={16} />
                                                    </ActionIcon>
                                                </Tooltip>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))
                                ) : (
                                    <Table.Tr><Table.Td colSpan={tableColumnCount} align="center" py={80} c="dimmed">
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
