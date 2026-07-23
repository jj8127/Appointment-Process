'use client';

import { useSession } from '@/hooks/use-session';
import {
  ActionIcon,
  Badge,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFilter, IconFilterOff, IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  EXAM_APPLICANT_EXPORT_COLUMNS,
  EXAM_APPLICANT_TABLE_BADGE_STYLES,
  formatExamApplicantReceptionStatus,
  getExamApplicantCellValue,
  type ExamApplicantExportColumn,
  type ExamApplicantExportColumnKey,
  type ExamApplicantListItem,
} from '@/lib/exam-applicant-list-display';
import { notifyFcExamApprovalStatus } from '@/lib/exam-applicant-notification-client';

type Row = ExamApplicantListItem & {
  id: string;
  status: string;
  created_at: string;
  round_id?: string | null;
};

type FilterState = {
  name: string;
  phone: string;
  affiliation: string;
  address: string;
  location: string;
  status: 'confirmed' | 'pending' | '' | null;
};

const initialFilters: FilterState = {
  name: '',
  phone: '',
  affiliation: '',
  address: '',
  location: '',
  status: null,
};

const HANWHA_ORANGE = '#F37321';
const CHARCOAL = '#111827';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export default function AdminExamManagePage() {
  const { role, hydrated } = useSession();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const roundId = String(params.id ?? '');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(initialFilters);

  const tableColumnCount = EXAM_APPLICANT_EXPORT_COLUMNS.length + 1;
  const statusColumnMinWidth = 180;
  const tableMinWidth = EXAM_APPLICANT_EXPORT_COLUMNS.reduce(
    (sum, column) => sum + column.minWidth,
    statusColumnMinWidth,
  );

  useEffect(() => {
    if (hydrated && role !== 'admin') router.replace('/auth');
  }, [hydrated, role, router]);

  const fetchData = useCallback(async () => {
    if (!roundId) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/admin/exam-applicants?roundId=${encodeURIComponent(roundId)}`, {
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

      setRows(json.applicants as Row[]);
    } catch (e) {
      const err = e as Error;
      notifications.show({ title: '조회 실패', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [roundId]);

  useEffect(() => {
    if (hydrated && role === 'admin' && roundId) {
      void fetchData();
    }
  }, [fetchData, hydrated, role, roundId]);

  const getRowValue = (row: Row, field: ExamApplicantExportColumnKey) =>
    getExamApplicantCellValue(row, field);

  const updateStatus = async (row: Row, newValue: 'confirmed' | 'pending') => {
    const nextConfirmed = newValue === 'confirmed';
    if (processingId === row.id || row.is_confirmed === nextConfirmed) return;

    setProcessingId(row.id);
    try {
      const response = await fetch('/api/admin/exam-applicants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ registrationId: row.id, isConfirmed: nextConfirmed }),
      });
      const json: unknown = await response.json().catch(() => null);
      const isOk = response.ok && isRecord(json) && json.ok === true;

      if (!isOk) {
        const message =
          isRecord(json) && typeof json.error === 'string'
            ? json.error
            : '시험 신청 상태 변경에 실패했습니다.';
        throw new Error(message);
      }

      const nextStatus = nextConfirmed ? 'confirmed' : 'applied';
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, is_confirmed: nextConfirmed, status: nextStatus } : r,
        ),
      );

      notifications.show({
        title: '상태 변경 완료',
        message: `${row.name || '지원자'}님을 ${nextConfirmed ? '접수 완료' : '미접수'} 상태로 변경했습니다.`,
        color: 'green',
        autoClose: 2000,
        icon: <IconRefresh size={16} />,
      });

      await notifyFcExamApprovalStatus(row, nextConfirmed);
    } catch (e) {
      const err = e as Error;
      notifications.show({ title: '변경 실패', message: err.message, color: 'red' });
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const name = getRowValue(row, 'name');
      const phone = getRowValue(row, 'phone');
      const affiliation = getRowValue(row, 'affiliation');
      const address = getRowValue(row, 'address');
      const location = row.location_name || '';
      const status = formatExamApplicantReceptionStatus(row);
      const allColumnValues = EXAM_APPLICANT_EXPORT_COLUMNS
        .map((column) => getRowValue(row, column.key))
        .join(' ');

      if (globalSearch) {
        const target = `${allColumnValues} ${status}`.toLowerCase();
        if (!target.includes(globalSearch.toLowerCase())) return false;
      }

      if (filters.name && !name.includes(filters.name)) return false;
      if (filters.phone && !phone.includes(filters.phone)) return false;
      if (filters.affiliation && !affiliation.includes(filters.affiliation)) return false;
      if (filters.address && !address.includes(filters.address)) return false;
      if (filters.location && !location.includes(filters.location)) return false;
      if (filters.status) {
        if (filters.status === 'confirmed' && !row.is_confirmed) return false;
        if (filters.status === 'pending' && row.is_confirmed) return false;
      }
      return true;
    });
  }, [rows, globalSearch, filters]);

  const stats = useMemo(() => {
    const total = rows.length;
    const confirmed = rows.filter((r) => r.is_confirmed).length;
    const pending = total - confirmed;
    return { total, confirmed, pending };
  }, [rows]);

  const affiliationOptions = useMemo(() => {
    const set = new Set(rows.map((r) => getRowValue(r, 'affiliation')).filter((value) => value && value !== '-'));
    return Array.from(set).sort();
  }, [rows]);

  const locationOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.location_name).filter((value) => value && value !== '-'));
    return Array.from(set).sort();
  }, [rows]);

  const clearFilters = () => {
    setFilters(initialFilters);
    setGlobalSearch('');
  };

  const FilterHeader = ({
    label,
    field,
    minWidth,
    type = 'text',
    options = [],
  }: {
    label: string;
    field: keyof FilterState;
    minWidth?: number;
    type?: 'text' | 'select';
    options?: string[];
  }) => {
    const isActive = !!filters[field];
    const [opened, setOpened] = useState(false);

    return (
      <Table.Th style={{ minWidth, whiteSpace: 'normal', textAlign: 'center', wordBreak: 'keep-all', lineHeight: 1.25 }}>
        <Group justify="center" wrap="nowrap" gap={4} style={{ width: '100%' }}>
          <Text
            fw={700}
            size="sm"
            c={isActive ? 'orange' : 'dimmed'}
            ta="center"
            style={{ whiteSpace: 'normal', wordBreak: 'keep-all', lineHeight: 1.25 }}
          >
            {label}
          </Text>
          <Popover opened={opened} onChange={setOpened} width={220} position="bottom-end" withArrow shadow="md">
            <Popover.Target>
              <ActionIcon
                variant={isActive ? 'filled' : 'transparent'}
                color={isActive ? 'orange' : 'gray'}
                size="sm"
                onClick={() => setOpened((o) => !o)}
              >
                <IconFilter size={14} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown p="xs">
              <Stack gap="xs">
                {type === 'select' ? (
                  <Select
                    placeholder="선택하세요"
                    data={options}
                    value={(filters[field] as string) ?? null}
                    onChange={(val) => setFilters((prev) => ({ ...prev, [field]: val ?? '' }))}
                    size="xs"
                    clearable
                  />
                ) : (
                  <TextInput
                    placeholder="검색어 입력"
                    value={(filters[field] as string) ?? ''}
                    onChange={(e) => setFilters((prev) => ({ ...prev, [field]: e.currentTarget.value }))}
                    size="xs"
                    rightSection={
                      filters[field] ? (
                        <IconX
                          size={12}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setFilters((prev) => ({ ...prev, [field]: '' }))}
                        />
                      ) : null
                    }
                  />
                )}
              </Stack>
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Table.Th>
    );
  };

  const renderColumnHeader = (column: ExamApplicantExportColumn) => {
    if (column.key === 'name' || column.key === 'phone' || column.key === 'address') {
      return (
        <FilterHeader
          key={column.key}
          label={column.title}
          field={column.key}
          minWidth={column.minWidth}
        />
      );
    }

    if (column.key === 'affiliation') {
      return (
        <FilterHeader
          key={column.key}
          label={column.title}
          field="affiliation"
          minWidth={column.minWidth}
          type="select"
          options={affiliationOptions}
        />
      );
    }

    if (column.key === 'life_location' || column.key === 'nonlife_location') {
      return (
        <FilterHeader
          key={column.key}
          label={column.title}
          field="location"
          minWidth={column.minWidth}
          type="select"
          options={locationOptions}
        />
      );
    }

    return (
      <Table.Th key={column.key} style={{ minWidth: column.minWidth, whiteSpace: 'normal', textAlign: 'center', wordBreak: 'keep-all', lineHeight: 1.25 }}>
        <Text fw={700} size="sm" c="dimmed" ta="center" style={{ whiteSpace: 'normal', wordBreak: 'keep-all', lineHeight: 1.25 }}>
          {column.title}
        </Text>
      </Table.Th>
    );
  };

  const renderStatusHeader = () => {
    const isActive = !!filters.status;

    return (
      <Table.Th style={{ minWidth: statusColumnMinWidth, textAlign: 'center', whiteSpace: 'normal', wordBreak: 'keep-all', lineHeight: 1.25 }}>
        <Group justify="center" gap={4} style={{ width: '100%' }}>
          <Text
            fw={700}
            size="sm"
            c={isActive ? 'orange' : 'dimmed'}
            ta="center"
            style={{ whiteSpace: 'normal', wordBreak: 'keep-all', lineHeight: 1.25 }}
          >
            접수 상태
          </Text>
          <Popover position="bottom-end" shadow="md" width={200}>
            <Popover.Target>
              <ActionIcon
                size="sm"
                variant={isActive ? 'filled' : 'transparent'}
                color={isActive ? 'orange' : 'gray'}
              >
                <IconFilter size={14} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown p="xs">
              <Select
                size="xs"
                placeholder="상태 선택"
                data={[
                  { label: '전체', value: '' },
                  { label: '접수 완료', value: 'confirmed' },
                  { label: '미접수', value: 'pending' },
                ]}
                value={filters.status ?? ''}
                onChange={(val) =>
                  setFilters((prev) => ({
                    ...prev,
                    status: (val as 'confirmed' | 'pending' | null) || null,
                  }))
                }
                clearable
              />
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Table.Th>
    );
  };

  const renderApplicantCell = (item: Row, column: ExamApplicantExportColumn) => {
    const value = getRowValue(item, column.key);
    const align = column.key === 'address' ? 'left' : 'center';

    if (column.key === 'subject_display') {
      return (
        <Table.Td key={column.key} ta={align}>
          <Badge variant="light" color="blue" radius="sm" styles={EXAM_APPLICANT_TABLE_BADGE_STYLES}>
            {value}
          </Badge>
        </Table.Td>
      );
    }

    if (column.key === 'application_type') {
      return (
        <Table.Td key={column.key} ta={align}>
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
        <Table.Td key={column.key} ta={align}>
          <Text size="sm" fw={value === '포함' ? 600 : 400} c={value === '포함' ? CHARCOAL : 'dimmed'} ta={align}>
            {value}
          </Text>
        </Table.Td>
      );
    }

    if (column.key === 'address') {
      return (
        <Table.Td key={column.key} ta={align}>
          <Text size="sm" style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
            {value}
          </Text>
        </Table.Td>
      );
    }

    return (
      <Table.Td key={column.key} ta={align}>
        <Text
          size="sm"
          fw={column.key === 'name' ? 600 : 400}
          c={column.key === 'resident_id' ? 'dimmed' : undefined}
          ta={align}
        >
          {value}
        </Text>
      </Table.Td>
    );
  };

  if (!hydrated) return null;

  return (
    <Container size="xl" py="lg">
      <Stack gap="xl">
        <Group justify="space-between" align="center">
          <div>
            <Title order={2} c={CHARCOAL}>응시자 관리</Title>
            <Text c="dimmed" size="sm">각 회차별 응시자 현황을 모니터링하고 접수 상태를 관리합니다.</Text>
          </div>
          <Group gap="xs">
            <Tooltip label="데이터 새로고침">
              <ActionIcon variant="light" color="gray" size="lg" onClick={() => void fetchData()} loading={loading}>
                <IconRefresh size={20} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Group grow>
          <Paper p="md" radius="md" withBorder shadow="sm">
            <Text size="xs" c="dimmed" fw={700} tt="uppercase">총 신청자</Text>
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

        <Paper withBorder radius="md" shadow="sm" p="lg" bg="white">
          <Stack gap="lg">
            <Group justify="space-between" align="center">
              <Group gap="xs">
                <Text fw={600} size="lg">상세 목록</Text>
                <Text c="dimmed" size="sm">({filteredRows.length}명)</Text>
              </Group>
              <Group gap="xs">
                {(globalSearch || Object.values(filters).some((v) => v)) && (
                  <Tooltip label="모든 필터 초기화">
                    <ActionIcon variant="subtle" color="gray" onClick={clearFilters}>
                      <IconFilterOff size={18} />
                    </ActionIcon>
                  </Tooltip>
                )}
                <TextInput
                  placeholder="통합 검색"
                  leftSection={<IconSearch size={16} />}
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.currentTarget.value)}
                  style={{ width: 300 }}
                  radius="md"
                />
              </Group>
            </Group>

            <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
              <ScrollArea h={600} type="always" offsetScrollbars styles={{ viewport: { overflowX: 'auto', overflowY: 'auto' } }}>
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
                      {EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => renderColumnHeader(column))}
                      {renderStatusHeader()}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {loading ? (
                      <Table.Tr>
                        <Table.Td colSpan={tableColumnCount}>
                          <Center py={80}>
                            <Loader color="orange" type="dots" />
                          </Center>
                        </Table.Td>
                      </Table.Tr>
                    ) : filteredRows.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={tableColumnCount} align="center" py={80}>
                          <Stack gap="xs" align="center">
                            <IconSearch size={40} color="#dee2e6" />
                            <Text c="dimmed">조건에 맞는 응시자가 없습니다.</Text>
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      filteredRows.map((row) => (
                        <Table.Tr key={row.id}>
                          {EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => renderApplicantCell(row, column))}
                          <Table.Td ta="center">
                            <SegmentedControl
                              size="xs"
                              radius="xl"
                              fullWidth
                              value={row.is_confirmed ? 'confirmed' : 'pending'}
                              onChange={(val) => updateStatus(row, val as 'confirmed' | 'pending')}
                              disabled={processingId === row.id}
                              data={[
                                { label: '미접수', value: 'pending' },
                                { label: '접수 완료', value: 'confirmed' },
                              ]}
                              color={row.is_confirmed ? 'orange' : 'gray'}
                              styles={{
                                root: { backgroundColor: row.is_confirmed ? '#fff4e6' : '#f1f3f5' },
                                indicator: { backgroundColor: row.is_confirmed ? HANWHA_ORANGE : '#adb5bd' },
                                label: {
                                  transition: 'color 0.2s',
                                  color: processingId === row.id ? '#ced4da' : undefined,
                                  fontWeight: 600,
                                },
                              }}
                            />
                          </Table.Td>
                        </Table.Tr>
                      ))
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
