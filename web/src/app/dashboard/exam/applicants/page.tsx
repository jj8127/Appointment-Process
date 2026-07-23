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
import {
    IconCalendarEvent,
    IconCheck,
    IconChevronDown,
    IconDownload,
    IconListDetails,
    IconPhoto,
    IconRefresh,
    IconSearch,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import styles from './page.module.css';

import {
    buildExamApplicantQuickAffiliationOptions,
    buildExamApplicantRoundFilterOptions,
    buildExamApplicantSubjectFilterOptions,
    EXAM_APPLICANT_ALL_AFFILIATION_FILTER_VALUE,
    EXAM_APPLICANT_ALL_FILTER_VALUE,
    EXAM_APPLICANT_EXPORT_COLUMNS,
    EXAM_APPLICANT_TABLE_BADGE_STYLES,
    formatExamApplicantReceptionStatus,
    getExamApplicantRoundFilterValue,
    getExamApplicantCellValue,
    getExamApplicantSubjectKey,
    isExamApplicantRoundFilterValid,
    matchesExamApplicantQuickAffiliation,
    type ExamApplicantExportColumn,
    type ExamApplicantExportColumnKey,
    type ExamApplicantFilterOption,
} from '@/lib/exam-applicant-list-display';
import { notifyFcExamApprovalStatus } from '@/lib/exam-applicant-notification-client';
import {
    buildExamPaymentProofExportLinkMap,
    buildExamPaymentProofImagePath,
    type ExamPaymentProofExportLink,
} from '@/lib/exam-payment-proof-admin';

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
    payment_proof_attached?: boolean;
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
    | 'payment_proof'
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
    kind: 'subject' | 'round';
}

const TopFilterMenu = ({ title, options, value, onChange, kind }: TopFilterMenuProps) => {
    const selected = options.find((option) => option.value === value) ?? options[0];
    const isActive = value !== EXAM_APPLICANT_ALL_FILTER_VALUE;
    const dropdownWidth = kind === 'round' ? 440 : 280;

    const renderOption = (option: ExamApplicantFilterOption) => {
        const isSelected = option.value === value;
        const isAll = option.value === EXAM_APPLICANT_ALL_FILTER_VALUE;

        if (kind === 'round' && !isAll) {
            const [date = '날짜 미정', round = '회차 미정', ...subjectParts] = option.label.split(' · ');
            const subject = subjectParts.join(' · ') || '과목 미정';

            return (
                <Group gap="sm" wrap="nowrap" align="center" w="100%">
                    <div className={styles.roundDateBadge}>{date}</div>
                    <Stack gap={1} style={{ minWidth: 0, flex: 1 }}>
                        <Text size="sm" fw={700} c={isSelected ? 'orange.8' : CHARCOAL} lineClamp={1}>
                            {round}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>{subject}</Text>
                    </Stack>
                </Group>
            );
        }

        return (
            <Group gap="sm" wrap="nowrap">
                {isAll
                    ? <IconListDetails size={17} stroke={1.8} />
                    : kind === 'round'
                        ? <IconCalendarEvent size={17} stroke={1.8} />
                        : null}
                <Text size="sm" fw={isSelected ? 700 : 600}>{isAll ? '전체 보기' : option.label}</Text>
            </Group>
        );
    };

    return (
        <Menu shadow="lg" width={dropdownWidth} position="bottom-start" offset={8} withinPortal>
            <Menu.Target>
                <Button
                    variant="light"
                    color={isActive ? 'orange' : 'gray'}
                    radius="xl"
                    size="sm"
                    rightSection={<IconChevronDown size={14} />}
                    aria-label={`${title} 필터, 현재 ${selected?.label ?? '전체'}`}
                    styles={{
                        root: {
                            maxWidth: kind === 'round' ? 310 : 210,
                            height: 38,
                            paddingTop: 0,
                            paddingBottom: 0,
                            border: `1px solid ${isActive ? '#f7b27d' : '#e5e7eb'}`,
                            boxShadow: isActive ? '0 2px 8px rgba(243, 115, 33, 0.12)' : 'none',
                        },
                        inner: {
                            height: '100%',
                            alignItems: 'center',
                        },
                        label: {
                            display: 'flex',
                            height: '100%',
                            alignItems: 'center',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            lineHeight: 1.2,
                            textAlign: 'left',
                        },
                        section: { flexShrink: 0 },
                    }}
                >
                    {title}: {selected?.label ?? '전체'}
                </Button>
            </Menu.Target>
            <Menu.Dropdown className={styles.topFilterDropdown}>
                <Group justify="space-between" px="sm" py="xs" className={styles.topFilterHeading}>
                    <Text size="xs" fw={800} c="dimmed">{title} 선택</Text>
                    <Text size="xs" c="dimmed">{Math.max(options.length - 1, 0)}개</Text>
                </Group>
                <Divider />
                <div className={styles.topFilterOptions}>
                    {options.map((option) => {
                        const isSelected = option.value === value;
                        return (
                            <Menu.Item
                                key={option.value}
                                className={styles.topFilterItem}
                                data-selected={isSelected || undefined}
                                rightSection={isSelected ? <IconCheck size={17} stroke={2.4} /> : null}
                                onClick={() => onChange(option.value)}
                            >
                                {renderOption(option)}
                            </Menu.Item>
                        );
                    })}
                </div>
            </Menu.Dropdown>
        </Menu>
    );
};

export default function ExamApplicantsPage() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { isReadOnly, hydrated, role } = useSession();
    const [filters, setFilters] = useState<FilterState>({});
    const [quickAffiliation, setQuickAffiliation] = useState(EXAM_APPLICANT_ALL_AFFILIATION_FILTER_VALUE);
    const [examSubjectFilter, setExamSubjectFilter] = useState(EXAM_APPLICANT_ALL_FILTER_VALUE);
    const [examRoundFilter, setExamRoundFilter] = useState(EXAM_APPLICANT_ALL_FILTER_VALUE);
    const [isExporting, setIsExporting] = useState(false);

    const tableColumnCount = EXAM_APPLICANT_EXPORT_COLUMNS.length + 3;
    const proofColumnMinWidth = 120;
    const statusColumnMinWidth = 130;
    const actionsColumnMinWidth = 90;
    const tableMinWidth = EXAM_APPLICANT_EXPORT_COLUMNS.reduce(
        (sum, column) => sum + column.minWidth,
        proofColumnMinWidth + statusColumnMinWidth + actionsColumnMinWidth,
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
        return buildExamApplicantQuickAffiliationOptions(applicants ?? []);
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
    const baseFilteredRows = useMemo(() => {
        if (!applicants) return [];
        return applicants.filter(item => {
            if (!matchesExamApplicantQuickAffiliation(item.affiliation, quickAffiliation)) {
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
                if (field === 'is_confirmed') return true;
                if (!selectedValues || selectedValues.length === 0) return true;
                const val = getRowValue(item, field as RowField);
                return selectedValues.includes(val);
            });
        });
    }, [applicants, effectiveExamRoundFilter, examSubjectFilter, filters, quickAffiliation]);

    const filteredRows = useMemo(() => {
        const selectedStatuses = filters.is_confirmed ?? [];
        if (selectedStatuses.length === 0) return baseFilteredRows;

        return baseFilteredRows.filter((item) =>
            selectedStatuses.includes(formatExamApplicantReceptionStatus(item)),
        );
    }, [baseFilteredRows, filters.is_confirmed]);

    // --- Stats ---
    const stats = useMemo(() => {
        const total = baseFilteredRows.length;
        const confirmed = baseFilteredRows.filter(a => a.is_confirmed).length;
        const pending = total - confirmed;
        return { total, confirmed, pending };
    }, [baseFilteredRows]);

    const selectedReceptionStatus = filters.is_confirmed?.length === 1
        ? filters.is_confirmed[0]
        : null;
    const setReceptionStatusFilter = (nextStatus: '접수 완료' | '미접수' | null) => {
        setFilters((current) => {
            const next = { ...current };
            const currentStatus = current.is_confirmed?.length === 1
                ? current.is_confirmed[0]
                : null;
            if (!nextStatus || currentStatus === nextStatus) {
                delete next.is_confirmed;
            } else {
                next.is_confirmed = [nextStatus];
            }
            return next;
        });
    };

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
            await notifyFcExamApprovalStatus(item, isConfirmed);
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
    const handleDownloadCsv = async () => {
        if (filteredRows.length === 0) {
            notifications.show({ title: '알림', message: '다운로드할 데이터가 없습니다.', color: 'blue' });
            return;
        }

        setIsExporting(true);
        try {
            const attachedRegistrationIds = filteredRows
                .filter((item) => item.payment_proof_attached)
                .map((item) => item.id);
            let proofLinks = new Map<string, ExamPaymentProofExportLink>();

            if (attachedRegistrationIds.length > 0) {
                const response = await fetch('/api/admin/exam-applicants/payment-proof-export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    cache: 'no-store',
                    body: JSON.stringify({ registrationIds: attachedRegistrationIds }),
                });
                const json: unknown = await response.json().catch(() => null);
                const rawLinks =
                    isRecord(json) && Array.isArray(json.links)
                        ? json.links
                        : [];
                const links = rawLinks.filter((value): value is ExamPaymentProofExportLink => (
                    isRecord(value)
                    && typeof value.registrationId === 'string'
                    && typeof value.storagePath === 'string'
                    && typeof value.signedUrl === 'string'
                ));

                if (
                    !response.ok
                    || !isRecord(json)
                    || json.ok !== true
                    || links.length !== rawLinks.length
                    || links.length !== attachedRegistrationIds.length
                ) {
                    const message =
                        isRecord(json) && typeof json.error === 'string'
                            ? json.error
                            : '입금 증빙 링크를 발급하지 못했습니다.';
                    throw new Error(message);
                }
                proofLinks = buildExamPaymentProofExportLinkMap(links);
            }

            const headers = [
                ...EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => column.title),
                '입금 증빙 경로',
                '입금 증빙 URL (30일 유효)',
            ];
            const asExcelText = (value: string) => `="${String(value).replace(/"/g, '""')}"`;
            const pRows = filteredRows.map((item) => {
                const proofLink = proofLinks.get(item.id);
                return [
                    ...EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => {
                        const value = getRowValue(item, column.key);
                        return column.key === 'phone' || column.key === 'resident_id'
                            ? asExcelText(value)
                            : value;
                    }),
                    proofLink?.storagePath ?? '-',
                    proofLink?.signedUrl ?? '-',
                ];
            });

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
        } catch (exportError: unknown) {
            const message = exportError instanceof Error
                ? exportError.message
                : '엑셀 파일을 만들지 못했습니다.';
            notifications.show({ title: '엑셀 다운로드 실패', message, color: 'red' });
        } finally {
            setIsExporting(false);
        }
    };

    const renderHeader = (title: string, field: ColumnField, minWidth?: number) => {
        const headerStyle = {
            minWidth,
            textAlign: 'center' as const,
            whiteSpace: 'normal' as const,
            wordBreak: 'keep-all' as const,
            lineHeight: 1.25,
        };

        if (field === 'actions' || field === 'payment_proof') {
            return (
            <Table.Th key={field} style={headerStyle}>
                <Text fw={700} size="sm" c="dimmed" ta="center" style={{ whiteSpace: 'normal', wordBreak: 'keep-all', lineHeight: 1.25 }}>{title}</Text>
            </Table.Th>
            );
        }

        return (
            <Table.Th key={field} style={headerStyle}>
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
                            loading={isExporting}
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
                        onChange={(value) => setQuickAffiliation(value ?? EXAM_APPLICANT_ALL_AFFILIATION_FILTER_VALUE)}
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
                        kind="subject"
                    />
                    <TopFilterMenu
                        title="시험 회차"
                        options={examRoundFilterOptions}
                        value={effectiveExamRoundFilter}
                        onChange={setExamRoundFilter}
                        kind="round"
                    />
                </Group>
                <Group grow align="stretch">
                    <Paper
                        component="button"
                        type="button"
                        p="md"
                        radius="md"
                        withBorder
                        shadow="sm"
                        className={styles.statCard}
                        data-active={!selectedReceptionStatus || undefined}
                        data-tone="total"
                        aria-pressed={!selectedReceptionStatus}
                        onClick={() => setReceptionStatusFilter(null)}
                    >
                        <Group justify="space-between" gap="xs">
                            <Text size="xs" c="dimmed" fw={700} tt="uppercase">총 신청자 (현재 필터)</Text>
                            {!selectedReceptionStatus && <Badge size="xs" variant="light" color="gray">전체 보기</Badge>}
                        </Group>
                        <Text fw={700} size="xl" mt="xs">{stats.total}명</Text>
                    </Paper>
                    <Paper
                        component="button"
                        type="button"
                        p="md"
                        radius="md"
                        withBorder
                        shadow="sm"
                        className={styles.statCard}
                        data-active={selectedReceptionStatus === '접수 완료' || undefined}
                        data-tone="confirmed"
                        aria-pressed={selectedReceptionStatus === '접수 완료'}
                        onClick={() => setReceptionStatusFilter('접수 완료')}
                    >
                        <Group justify="space-between" gap="xs">
                            <Text size="xs" c="orange" fw={700} tt="uppercase">접수 완료</Text>
                            {selectedReceptionStatus === '접수 완료' && <Badge size="xs" color="orange">선택됨</Badge>}
                        </Group>
                        <Text fw={700} size="xl" mt="xs" c="orange">{stats.confirmed}명</Text>
                    </Paper>
                    <Paper
                        component="button"
                        type="button"
                        p="md"
                        radius="md"
                        withBorder
                        shadow="sm"
                        className={styles.statCard}
                        data-active={selectedReceptionStatus === '미접수' || undefined}
                        data-tone="pending"
                        aria-pressed={selectedReceptionStatus === '미접수'}
                        onClick={() => setReceptionStatusFilter('미접수')}
                    >
                        <Group justify="space-between" gap="xs">
                            <Text size="xs" c="dimmed" fw={700} tt="uppercase">미접수</Text>
                            {selectedReceptionStatus === '미접수' && <Badge size="xs" variant="filled" color="dark">선택됨</Badge>}
                        </Group>
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
                                    {renderHeader('입금 증빙', 'payment_proof', proofColumnMinWidth)}
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
                                        <Tooltip.Floating
                                            key={item.id}
                                            label={`${item.affiliation || '소속 미정'} · ${item.name || '이름 미정'}`}
                                            position="top"
                                            offset={24}
                                            classNames={{ tooltip: styles.floatingIdentityTooltip }}
                                        >
                                        <Table.Tr
                                            className={styles.applicantRow}
                                            data-reception={item.is_confirmed ? 'confirmed' : 'pending'}
                                            role="link"
                                            tabIndex={0}
                                            aria-label={`${item.affiliation || '소속 미정'} ${item.name || '이름 미정'}, ${formatExamApplicantReceptionStatus(item)}, 상세 보기`}
                                            onClick={() => router.push(`/dashboard/exam/applicants/${encodeURIComponent(item.id)}`)}
                                            onKeyDown={(event) => {
                                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                                event.preventDefault();
                                                router.push(`/dashboard/exam/applicants/${encodeURIComponent(item.id)}`);
                                            }}
                                        >
                                            {EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => renderApplicantCell(item, column))}
                                            <Table.Td onClick={(event) => event.stopPropagation()} ta="center">
                                                {item.payment_proof_attached ? (
                                                    <Button
                                                        component="a"
                                                        href={buildExamPaymentProofImagePath(item.id)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        size="compact-sm"
                                                        variant="light"
                                                        color="orange"
                                                        leftSection={<IconPhoto size={15} />}
                                                    >
                                                        보기
                                                    </Button>
                                                ) : (
                                                    <Text size="sm" c="dimmed" ta="center">없음</Text>
                                                )}
                                            </Table.Td>
                                            <Table.Td onClick={(event) => event.stopPropagation()}>
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
                                            <Table.Td onClick={(event) => event.stopPropagation()}>
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
                                        </Tooltip.Floating>
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
