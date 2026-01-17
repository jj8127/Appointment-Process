'use client';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import {
  ActionIcon,
  Button,
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
import {
  IconFilter,
  IconFilterOff,
  IconRefresh,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

type Row = {
  id: string;
  resident_id: string;
  is_confirmed: boolean;
  created_at: string;
  fee_paid_date?: string | null;
  exam_locations: { location_name: string } | null;
  fc_profiles: {
    name: string | null;
    phone: string | null;
    affiliation: string | null;
    address: string | null; // 주소 추가
  } | null;
};

// 필터 상태 타입
type FilterState = {
  name: string;
  phone: string;
  affiliation: string;
  address: string;
  location: string;
  status: string | null; // 'all' | 'confirmed' | 'pending'
};

const initialFilters: FilterState = {
  name: '',
  phone: '',
  affiliation: '',
  address: '',
  location: '',
  status: null,
};

// ----------------------------------------------------------------------
// Main Component
// ----------------------------------------------------------------------

export default function AdminExamManagePage() {
  const { role, hydrated } = useSession();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 검색 및 필터 상태
  const [globalSearch, setGlobalSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(initialFilters);

  useEffect(() => {
    if (hydrated && role !== 'admin') router.replace('/auth');
  }, [hydrated, role, router]);

  // 데이터 조회
  const fetchData = async () => {
    setLoading(true);
    try {
      // 주소(address)까지 조회하도록 쿼리 수정
      const { data, error } = await supabase
        .from('exam_registrations')
        .select(`
          id,resident_id,is_confirmed,created_at,fee_paid_date,
          exam_locations(location_name),
          fc_profiles(name,phone,affiliation,address) 
        `)
        .eq('round_id', params.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRows((data ?? []) as unknown as Row[]);
    } catch (e) {
      const err = e as Error;
      notifications.show({ title: '조회 실패', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hydrated && params.id) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, params.id]);

  // 상태 변경 함수 (SegmentedControl)
  const updateStatus = async (row: Row, newValue: string) => {
    const nextConfirmed = newValue === 'confirmed';
    if (processingId === row.id || row.is_confirmed === nextConfirmed) return;

    setProcessingId(row.id);
    try {
      const { error } = await supabase
        .from('exam_registrations')
        .update({ is_confirmed: nextConfirmed })
        .eq('id', row.id);

      if (error) throw error;

      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, is_confirmed: nextConfirmed } : r))
      );

      notifications.show({
        title: '상태 변경 완료',
        message: `${row.fc_profiles?.name ?? '지원자'}님을 ${nextConfirmed ? '접수 완료' : '미접수'} 상태로 변경했습니다.`,
        color: 'green',
        autoClose: 2000,
      });
    } catch (e) {
      const err = e as Error;
      notifications.show({ title: '변경 실패', message: err.message, color: 'red' });
    } finally {
      setProcessingId(null);
    }
  };

  // ----------------------------------------------------------------------
  // Filtering Logic
  // ----------------------------------------------------------------------

  // 필터링된 데이터 계산
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      // 1. Global Search (전체 검색)
      if (globalSearch) {
        const searchLower = globalSearch.toLowerCase();
        const allText = [
          row.fc_profiles?.name,
          row.fc_profiles?.phone,
          row.fc_profiles?.affiliation,
          row.fc_profiles?.address,
          row.exam_locations?.location_name,
        ]
          .join(' ')
          .toLowerCase();

        if (!allText.includes(searchLower)) return false;
      }

      // 2. Column Filters (헤더별 필터)
      if (filters.name && !row.fc_profiles?.name?.includes(filters.name)) return false;
      if (filters.phone && !row.fc_profiles?.phone?.includes(filters.phone)) return false;
      if (filters.affiliation && !row.fc_profiles?.affiliation?.includes(filters.affiliation)) return false;
      if (filters.address && !row.fc_profiles?.address?.includes(filters.address)) return false;
      if (filters.location && !row.exam_locations?.location_name?.includes(filters.location)) return false;
      
      if (filters.status) {
        const isConfirmed = row.is_confirmed;
        if (filters.status === 'confirmed' && !isConfirmed) return false;
        if (filters.status === 'pending' && isConfirmed) return false;
      }

      return true;
    });
  }, [rows, globalSearch, filters]);

  // 소속(Affiliation) 목록 추출 (Select 옵션용)
  const affiliationOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.fc_profiles?.affiliation).filter(Boolean));
    return Array.from(set) as string[];
  }, [rows]);

  // 고사장(Location) 목록 추출
  const locationOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.exam_locations?.location_name).filter(Boolean));
    return Array.from(set) as string[];
  }, [rows]);

  // 필터 초기화
  const clearFilters = () => {
    setFilters(initialFilters);
    setGlobalSearch('');
  };

  // ----------------------------------------------------------------------
  // Render Helpers
  // ----------------------------------------------------------------------

  // 엑셀 스타일 헤더 필터 컴포넌트
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
      <Table.Th>
        <Group justify="space-between" wrap="nowrap" gap={4}>
          <Text fw={700} size="sm">{label}</Text>
          <Popover
            opened={opened}
            onChange={setOpened}
            width={220}
            position="bottom-end"
            withArrow
            shadow="md"
          >
            <Popover.Target>
              <ActionIcon
                variant={isActive ? 'filled' : 'subtle'}
                color={isActive ? 'orange' : 'gray'}
                size="sm"
                onClick={() => setOpened((o) => !o)}
              >
                <IconFilter size={14} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown p="xs">
              <Stack gap="xs">
                <Text size="xs" fw={500} c="dimmed">{label} 필터링</Text>
                {type === 'select' ? (
                  <Select
                    placeholder="선택하세요"
                    data={options}
                    value={filters[field] ?? null}
                    onChange={(val) => setFilters((prev) => ({ ...prev, [field]: val }))}
                    size="xs"
                    clearable
                  />
                ) : (
                  <TextInput
                    placeholder="검색어 입력"
                    value={filters[field] ?? ''}
                    onChange={(e) => {
                        const val = e.currentTarget.value;
                        setFilters((prev) => ({ ...prev, [field]: val }));
                    }}
                    size="xs"
                    rightSection={
                        filters[field] ? (
                            <IconX size={12} style={{cursor:'pointer'}} onClick={() => setFilters((prev) => ({ ...prev, [field]: '' }))} />
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
      <Paper withBorder radius="md" shadow="sm" p="lg" bg="white">
        <Stack gap="lg">
          
          {/* --- Header Section --- */}
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Title order={3} c="dark">응시자 관리</Title>
              <Text c="dimmed" size="sm">({filteredRows.length}명)</Text>
            </Group>
            
            <Group>
                {/* 필터 초기화 버튼 (활성화시에만 보임) */}
                {(globalSearch || Object.values(filters).some(Boolean)) && (
                    <Button 
                        leftSection={<IconFilterOff size={16} />} 
                        variant="subtle" 
                        color="gray" 
                        size="xs"
                        onClick={clearFilters}
                    >
                        필터 초기화
                    </Button>
                )}
                
                {/* 글로벌 검색창 */}
                <TextInput
                    placeholder="전체 검색 (이름, 번호, 소속...)"
                    leftSection={<IconSearch size={16} />}
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.currentTarget.value)}
                    style={{ width: 280 }}
                    radius="md"
                />

                <Tooltip label="새로고침">
                    <ActionIcon variant="light" color="gray" size="lg" onClick={fetchData} loading={loading}>
                        <IconRefresh size={20} />
                    </ActionIcon>
                </Tooltip>
            </Group>
          </Group>

          {/* --- Table Section --- */}
          <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
            <ScrollArea>
                <Table 
                    highlightOnHover 
                    verticalSpacing="sm" 
                    horizontalSpacing="md" 
                    striped
                    withColumnBorders
                >
                <Table.Thead bg="gray.0">
                    <Table.Tr>
                        <FilterHeader label="이름" field="name" />
                        <FilterHeader label="연락처" field="phone" />
                        <FilterHeader label="소속" field="affiliation" type="select" options={affiliationOptions} />
                        <FilterHeader label="주소" field="address" />
                        <FilterHeader label="고사장" field="location" type="select" options={locationOptions} />
                        <Table.Th>신청일시</Table.Th>
                        <Table.Th>응시료 납입일</Table.Th>
                        <FilterHeader 
                            label="상태" 
                            field="status" 
                            type="select" 
                            options={['confirmed', 'pending'].map(v => v === 'confirmed' ? '접수 완료' : '미접수')}
                            // 상태 필터는 값이 영문이므로 별도 처리 필요하지만, 
                            // 편의상 Select onChange에서 매핑하거나 위 options를 { value, label } 형태로 쓰는게 정석입니다.
                            // 여기서는 간단히 UI 보여주기 위해 텍스트 입력과 유사하게 처리하거나 커스텀 로직을 씁니다.
                        />
                        {/* 상태 필터용 커스텀 헤더 (위 FilterHeader 재사용 한계로 직접 구현) */}
                         <Table.Th style={{ width: 220, textAlign: 'center' }}>
                            <Group justify="center" gap={4}>
                                <Text fw={700} size="sm">접수 상태</Text>
                                <Popover position="bottom-end" shadow="md">
                                    <Popover.Target>
                                        <ActionIcon size="sm" variant={filters.status ? 'filled' : 'subtle'} color={filters.status ? 'orange' : 'gray'}>
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
                                            onChange={(val) => setFilters(prev => ({ ...prev, status: val || null }))}
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
                            <Table.Td colSpan={8}>
                                <Center py={50}><Loader color="orange" /></Center>
                            </Table.Td>
                        </Table.Tr>
                    ) : filteredRows.length === 0 ? (
                    <Table.Tr>
                        <Table.Td colSpan={8} align="center" py="xl">
                        <Text c="dimmed">
                            {rows.length === 0 ? '신청 내역이 없습니다.' : '검색 결과가 없습니다.'}
                        </Text>
                        </Table.Td>
                    </Table.Tr>
                    ) : (
                    filteredRows.map((r) => (
                        <Table.Tr key={r.id}>
                        <Table.Td>
                            <Text fw={600}>{r.fc_profiles?.name ?? '(이름없음)'}</Text>
                        </Table.Td>
                        <Table.Td>{r.fc_profiles?.phone ?? r.resident_id}</Table.Td>
                        <Table.Td>{r.fc_profiles?.affiliation ?? '-'}</Table.Td>
                        <Table.Td style={{ maxWidth: 200 }}>
                            <Text truncate size="sm">{r.fc_profiles?.address ?? '-'}</Text>
                        </Table.Td>
                        <Table.Td>{r.exam_locations?.location_name ?? '-'}</Table.Td>
                        <Table.Td>{dayjs(r.created_at).format('YY.MM.DD HH:mm')}</Table.Td>
                        <Table.Td>{r.fee_paid_date ? dayjs(r.fee_paid_date).format('YYYY-MM-DD') : '-'}</Table.Td>
                        
                        <Table.Td align="center">
                            <SegmentedControl
                            size="xs"
                            radius="xl"
                            value={r.is_confirmed ? 'confirmed' : 'pending'}
                            onChange={(val) => updateStatus(r, val)}
                            disabled={processingId === r.id}
                            data={[
                                { label: '미접수', value: 'pending' },
                                { label: '접수 완료', value: 'confirmed' },
                            ]}
                            color={r.is_confirmed ? 'blue' : 'gray'}
                            style={{ transition: 'all 0.2s' }}
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
    </Container>
  );
}
