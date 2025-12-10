'use client';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import {
  ActionIcon,
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
import dayjs from 'dayjs';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type Row = {
  id: string;
  resident_id: string;
  is_confirmed: boolean;
  created_at: string;
  exam_locations: { location_name: string } | null;
  fc_profiles: {
    name: string | null;
    phone: string | null;
    affiliation: string | null;
    address: string | null;
  } | null;
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

export default function AdminExamManagePage() {
  const { role, hydrated } = useSession();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(initialFilters);

  useEffect(() => {
    if (hydrated && role !== 'admin') router.replace('/auth');
  }, [hydrated, role, router]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('exam_registrations')
        .select(`
          id,resident_id,is_confirmed,created_at,
          exam_locations(location_name),
          fc_profiles(name,phone,affiliation,address)
        `)
        .eq('round_id', params.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedRows: Row[] = (data ?? []).map((row: any) => ({
        id: row.id,
        resident_id: row.resident_id,
        is_confirmed: row.is_confirmed,
        created_at: row.created_at,
        exam_locations: Array.isArray(row.exam_locations)
          ? row.exam_locations[0] ?? null
          : row.exam_locations,
        fc_profiles: Array.isArray(row.fc_profiles)
          ? row.fc_profiles[0] ?? null
          : row.fc_profiles
      }));

      setRows(formattedRows);
    } catch (e) {
      const err = e as Error;
      notifications.show({ title: '조회 실패', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hydrated && params.id) fetchData();
  }, [hydrated, params.id]);

  const updateStatus = async (row: Row, newValue: 'confirmed' | 'pending') => {
    const nextConfirmed = newValue === 'confirmed';
    if (processingId === row.id || row.is_confirmed === nextConfirmed) return;
    setProcessingId(row.id);
    try {
      const nextStatus = nextConfirmed ? 'applied' : 'pending';
      const payload = { is_confirmed: nextConfirmed, status: nextStatus };

      const { error } = await supabase
        .from('exam_registrations')
        .update(payload)
        .eq('id', row.id);

      if (error) throw error;

      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, is_confirmed: nextConfirmed } : r)),
      );

      notifications.show({
        title: '상태 변경 완료',
        message: `${row.fc_profiles?.name ?? '지원자'}님을 ${nextConfirmed ? '접수 완료' : '미접수'} 상태로 변경했습니다.`,
        color: 'green',
        autoClose: 2000,
        icon: <IconRefresh size={16} />,
      });
    } catch (e) {
      const err = e as Error;
      notifications.show({ title: '변경 실패', message: err.message, color: 'red' });
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const name = row.fc_profiles?.name ?? '';
      const phone = row.fc_profiles?.phone ?? '';
      const affiliation = row.fc_profiles?.affiliation ?? '';
      const address = row.fc_profiles?.address ?? '';
      const location = row.exam_locations?.location_name ?? '';

      if (globalSearch) {
        const target = `${name} ${phone} ${affiliation} ${address} ${location}`.toLowerCase();
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
    const confirmed = rows.filter(r => r.is_confirmed).length;
    const pending = total - confirmed;
    return { total, confirmed, pending };
  }, [rows]);

  const affiliationOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.fc_profiles?.affiliation).filter(Boolean));
    return Array.from(set) as string[];
  }, [rows]);

  const locationOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.exam_locations?.location_name).filter(Boolean));
    return Array.from(set) as string[];
  }, [rows]);

  const clearFilters = () => {
    setFilters(initialFilters);
    setGlobalSearch('');
  };

  const FilterHeader = ({
    label,
    field,
    type = 'text',
    options = [],
  }: {
    label: string;
    field: keyof FilterState;
    type?: 'text' | 'select';
    options?: string[];
  }) => {
    const isActive = !!filters[field];
    const [opened, setOpened] = useState(false);

    return (
      <Table.Th style={{ whiteSpace: 'nowrap' }}>
        <Group justify="space-between" wrap="nowrap" gap={4}>
          <Text fw={700} size="sm" c="dimmed">
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

  if (!hydrated) return null;

  return (
    <Container size="xl" py="lg">
      <Stack gap="xl">
        {/* Header Section */}
        <Group justify="space-between" align="center">
          <div>
            <Title order={2} c="#111827">응시자 관리</Title>
            <Text c="dimmed" size="sm">각 회차별 응시자 현황을 모니터링하고 접수 상태를 관리합니다.</Text>
          </div>
          <Group gap="xs">
            <Tooltip label="데이터 새로고침">
              <ActionIcon variant="light" color="gray" size="lg" onClick={fetchData} loading={loading}>
                <IconRefresh size={20} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {/* Stats Section */}
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

        {/* Main Content */}
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
              <ScrollArea h={600} type="auto">
                <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md" striped withColumnBorders>
                  <Table.Thead bg="gray.0" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <Table.Tr>
                      <FilterHeader label="이름" field="name" />
                      <FilterHeader label="연락처" field="phone" />
                      <FilterHeader label="소속" field="affiliation" type="select" options={affiliationOptions} />
                      <FilterHeader label="주소" field="address" />
                      <FilterHeader label="고사장" field="location" type="select" options={locationOptions} />
                      <Table.Th style={{ whiteSpace: 'nowrap' }}><Text size="sm" fw={700} c="dimmed">신청일시</Text></Table.Th>
                      <Table.Th style={{ width: 180, textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <Group justify="center" gap={4}>
                          <Text fw={700} size="sm" c="dimmed">접수 상태</Text>
                          <Popover position="bottom-end" shadow="md" width={200}>
                            <Popover.Target>
                              <ActionIcon
                                size="sm"
                                variant={filters.status ? 'filled' : 'transparent'}
                                color={filters.status ? 'orange' : 'gray'}
                                style={{ transition: 'all 0.2s' }}
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
                                onChange={(val) => setFilters((prev) => ({ ...prev, status: (val as any) || null }))}
                                clearable
                              />
                            </Popover.Dropdown>
                          </Popover>
                        </Group>
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {loading ? (
                      <Table.Tr>
                        <Table.Td colSpan={7}>
                          <Center py={80}>
                            <Loader color="orange" type="dots" />
                          </Center>
                        </Table.Td>
                      </Table.Tr>
                    ) : filteredRows.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={7} align="center" py={80}>
                          <Stack gap="xs" align="center">
                            <IconSearch size={40} color="#dee2e6" />
                            <Text c="dimmed">조건에 맞는 응시자가 없습니다.</Text>
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      filteredRows.map((r) => (
                        <Table.Tr key={r.id}>
                          <Table.Td>
                            <Text fw={600} size="sm">{r.fc_profiles?.name ?? '(이름없음)'}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{r.fc_profiles?.phone ?? r.resident_id}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{r.fc_profiles?.affiliation ?? '-'}</Text>
                          </Table.Td>
                          <Table.Td style={{ maxWidth: 220 }}>
                            <Tooltip label={r.fc_profiles?.address} disabled={!r.fc_profiles?.address}>
                              <Text truncate size="sm">
                                {r.fc_profiles?.address ?? '-'}
                              </Text>
                            </Tooltip>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{r.exam_locations?.location_name ?? '-'}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" c="dimmed">{dayjs(r.created_at).format('YYYY-MM-DD HH:mm')}</Text>
                          </Table.Td>
                          <Table.Td align="center">
                            <SegmentedControl
                              size="xs"
                              radius="xl"
                              fullWidth
                              value={r.is_confirmed ? 'confirmed' : 'pending'}
                              onChange={(val) => updateStatus(r, val as 'confirmed' | 'pending')}
                              disabled={processingId === r.id}
                              data={[
                                { label: '미접수', value: 'pending' },
                                { label: '접수 완료', value: 'confirmed' },
                              ]}
                              color={r.is_confirmed ? 'orange' : 'gray'}
                              styles={{
                                root: { backgroundColor: r.is_confirmed ? '#fff4e6' : '#f1f3f5' },
                                indicator: { backgroundColor: r.is_confirmed ? HANWHA_ORANGE : '#adb5bd' },
                                label: {
                                  transition: 'color 0.2s',
                                  color: processingId === r.id ? '#ced4da' : undefined,
                                  fontWeight: 600
                                }
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
