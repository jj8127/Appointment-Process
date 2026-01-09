'use client';

import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Container,
  Divider,
  Group,
  LoadingOverlay,
  Modal,
  Paper,
  Popover,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconDeviceFloppy, IconRefresh, IconSearch, IconUser, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState, useTransition } from 'react';

import { StatusToggle } from '@/components/StatusToggle';
import { supabase } from '@/lib/supabase';
import { updateAppointmentAction } from './actions';

const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const HANWHA_ORANGE = '#F37321';

// --- Filter Types & Components ---
type FilterState = Record<string, string[]>;

interface ExcelColumnFilterProps {
  title: string;
  field: string;
  options: string[];
  selected: string[];
  onApply: (selected: string[]) => void;
}

const ExcelColumnFilter = ({ title, options, selected, onApply }: ExcelColumnFilterProps) => {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [tempSelected, setTempSelected] = useState<string[]>(selected);

  useEffect(() => {
    if (opened) {
      setTempSelected(selected);
      setSearch('');
    }
  }, [opened, selected]);

  const filteredOptions = options.filter(opt =>
    opt.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const newSelected = new Set([...tempSelected, ...filteredOptions]);
      setTempSelected(Array.from(newSelected));
    } else {
      const newSelected = tempSelected.filter(s => !filteredOptions.includes(s));
      setTempSelected(newSelected);
    }
  };

  const isAllSelected = filteredOptions.length > 0 && filteredOptions.every(opt => tempSelected.includes(opt));
  const isIndeterminate = filteredOptions.some(opt => tempSelected.includes(opt)) && !isAllSelected;

  return (
    <Popover opened={opened} onChange={setOpened} width={280} position="bottom-start" withArrow shadow="md">
      <Popover.Target>
        <UnstyledButton onClick={() => setOpened((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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

export default function AppointmentPage() {
  const [isPending, startTransition] = useTransition();
  const [filterYear, setFilterYear] = useState<string | null>('2025');
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<{ fc: any; category: 'life' | 'nonlife' } | null>(null);
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // 확인 모달 상태
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const showConfirm = (config: { title: string; message: string; onConfirm: () => void }) => {
    setConfirmConfig(config);
    openConfirm();
  };

  const handleConfirm = () => {
    if (confirmConfig?.onConfirm) {
      confirmConfig.onConfirm();
    }
    closeConfirm();
  };


  // Header Filtering State
  const [filters, setFilters] = useState<FilterState>({});

  // Local state for inputs
  const [inputs, setInputs] = useState<Record<number, {
    lifeSchedule?: string;
    lifeDate?: Date | null;
    nonLifeSchedule?: string;
    nonLifeDate?: Date | null;
  }>>({});

  const { data: fcs, isLoading, refetch } = useQuery({
    queryKey: ['appointment-fcs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fc_profiles')
        .select('*, fc_documents(*)')
        .not('allowance_date', 'is', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const getOverallStatus = (fc: any) => {
    const life = !!fc.appointment_date_life;
    const nonlife = !!fc.appointment_date_nonlife;
    if (life && nonlife) return { label: '위촉 완료', color: 'green' };
    if (life || nonlife) return { label: '부분 완료', color: 'orange' };
    return { label: '진행 중', color: 'blue' };
  };

  // --- Derived Data for Filtering ---
  // 1. Apply Year/Month Filter first (processedFcs)
  const processedFcs = useMemo(() => {
    if (!fcs) return [];
    return fcs.filter((fc: any) => {
      if (filterYear && !dayjs(fc.created_at).isSame(dayjs(`${filterYear}-01-01`), 'year')) return false;
      return true;
    });
  }, [fcs, filterYear]);

  // 2. Helper to get values for filtering
  const getRowValue = (fc: any, field: string) => {
    if (field === 'name') return fc.name || '';
    if (field === 'affiliation') return fc.affiliation || '-';
    if (field === 'status') return getOverallStatus(fc).label;
    if (field === 'phone') return fc.phone || '';
    if (field === 'life') {
      // Return schedule text or confirmed date string for filtering
      if (fc.appointment_date_life) return dayjs(fc.appointment_date_life).format('YYYY-MM-DD');
      return fc.appointment_schedule_life || '';
    }
    if (field === 'nonlife') {
      if (fc.appointment_date_nonlife) return dayjs(fc.appointment_date_nonlife).format('YYYY-MM-DD');
      return fc.appointment_schedule_nonlife || '';
    }
    return '';
  };

  // 3. Generate Filter Options based on processedFcs
  const filterOptions = useMemo(() => {
    const fields = ['name', 'affiliation', 'status', 'life', 'nonlife']; // Fields we want to filter by
    const options: Record<string, string[]> = {};

    fields.forEach(field => {
      const unique = Array.from(new Set(processedFcs.map(fc => getRowValue(fc, field)))).filter(Boolean).sort();
      options[field] = unique;
    });
    return options;
  }, [processedFcs]);

  // 4. Final Filtered Rows based on Header Filters
  const filteredRows = useMemo(() => {
    return processedFcs.filter(fc => {
      return Object.entries(filters).every(([field, selectedValues]) => {
        if (!selectedValues || selectedValues.length === 0) return true;
        const val = getRowValue(fc, field);
        return selectedValues.includes(val);
      });
    });
  }, [processedFcs, filters]);


  const handleInputChange = (fcId: number, field: string, value: any) => {
    setInputs((prev) => ({
      ...prev,
      [fcId]: {
        ...prev[fcId],
        [field]: value,
      },
    }));
  };

  const openRejectModal = (fc: any, category: 'life' | 'nonlife') => {
    setRejectReason('');
    setRejectTarget({ fc, category });
    setRejectModalOpen(true);
  };

  const handleRejectSubmit = () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      notifications.show({ title: '사유 입력', message: '반려 사유를 입력해주세요.', color: 'red' });
      return;
    }
    setRejectSubmitting(true);
    startTransition(async () => {
      const result = await updateAppointmentAction(
        { success: false },
        {
          fcId: rejectTarget.fc.id,
          phone: rejectTarget.fc.phone,
          type: 'reject',
          category: rejectTarget.category,
          value: null,
          reason,
        }
      );

      if (result.success) {
        notifications.show({ title: '성공', message: result.message, color: 'green' });
        setRejectModalOpen(false);
        setRejectTarget(null);
        setRejectReason('');
        refetch();
      } else {
        notifications.show({ title: '실패', message: result.error, color: 'red' });
      }
      setRejectSubmitting(false);
    });
  };

  const executeAction = (fc: any, type: 'schedule' | 'confirm' | 'reject', category: 'life' | 'nonlife') => {
    const input = inputs[fc.id] || {};

    let value = null;
    if (type === 'schedule') {
      const scheduleKey = category === 'life' ? 'lifeSchedule' : 'nonLifeSchedule';
      const scheduleVal = input[scheduleKey as keyof typeof input] ?? fc[`appointment_schedule_${category}`];
      if (!scheduleVal) {
        notifications.show({ title: '입력 필요', message: '예정 정보를 입력해주세요.', color: 'yellow' });
        return;
      }
      value = String(scheduleVal);
    } else if (type === 'confirm') {
      const dateKey = category === 'life' ? 'lifeDate' : 'nonLifeDate';
      const dateVal = input[dateKey as keyof typeof input] ?? (fc[`appointment_date_${category}`] ? new Date(fc[`appointment_date_${category}`]) : null);

      if (!dateVal) {
        notifications.show({ title: '입력 필요', message: '확정일(Start Date)을 선택해주세요.', color: 'orange' });
        return;
      }
      value = dayjs(dateVal).format('YYYY-MM-DD');
    } else if (type === 'reject') {
      openRejectModal(fc, category);
      return;
    }

    showConfirm({
      title: type === 'confirm' ? '위촉 승인' : '위촉 예정월 저장',
      message: `${type === 'confirm' ? '승인' : '저장'} 하시겠습니까?`,
      onConfirm: () => {
        startTransition(async () => {
          const result = await updateAppointmentAction(
            { success: false },
            {
              fcId: fc.id,
              phone: fc.phone,
              type,
              category,
              value,
            }
          );

          if (result.success) {
            notifications.show({ title: '성공', message: result.message, color: 'green' });
            refetch();
          } else {
            notifications.show({ title: '실패', message: result.error, color: 'red' });
          }
        });
      },
    });
  };

  const renderInsuranceSection = (fc: any, category: 'life' | 'nonlife') => {
    const input = inputs[fc.id] || {};
    const scheduleKey = category === 'life' ? 'lifeSchedule' : 'nonLifeSchedule';
    const dateKey = category === 'life' ? 'lifeDate' : 'nonLifeDate';
    const dbSchedule = fc[`appointment_schedule_${category}`];
    const dbDate = fc[`appointment_date_${category}`];
    const subDate = fc[`appointment_date_${category}_sub`];

    const scheduleValue = (input[scheduleKey as keyof typeof input] ?? (dbSchedule ?? '')) as string | undefined;

    const dateValueRaw = input[dateKey as keyof typeof input];
    const dateValue = dateValueRaw instanceof Date ? dateValueRaw
      : (dateValueRaw
        ? new Date(dateValueRaw as any)
        : (dbDate ? new Date(dbDate) : (subDate ? new Date(subDate) : null)));

    const isConfirmed = !!dbDate;
    const hasSubmitted = !!subDate && !dbDate;

    return (
      <Stack gap="xs">
        {hasSubmitted && (
          <Badge variant="light" color="orange" size="xs" w="fit-content">
            FC 제출 {dayjs(subDate).format('YYYY-MM-DD')}
          </Badge>
        )}
        <Group align="flex-end" gap="xs">
          <TextInput
            label="예정 메모"
            placeholder="예: 6월 / 7월 예정 / 주소 메모"
            size="xs"
            w={160}
            value={scheduleValue}
            onChange={(v) => handleInputChange(fc.id, scheduleKey, v.currentTarget.value)}
            readOnly={isConfirmed}
            disabled={isConfirmed}
          />
          {!isConfirmed && (
            <Tooltip label="예정 메모 저장">
              <ActionIcon variant="light" color="blue" size="md" mb={2} onClick={() => executeAction(fc, 'schedule', category)}>
                <IconDeviceFloppy size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>

        <Group align="flex-end" gap="xs">
          <DateInput
            label="확정일(Actual)"
            placeholder={hasSubmitted ? `제출: ${dayjs(subDate).format('YYYY-MM-DD')}` : 'YYYY-MM-DD'}
            valueFormat="YYYY-MM-DD"
            size="xs"
            w={110}
            value={dateValue}
            onChange={(v) => handleInputChange(fc.id, dateKey, v)}
            clearable={!isConfirmed}
            readOnly={isConfirmed}
            disabled={isConfirmed}
          />
          {hasSubmitted && (
            <Badge variant="light" color="orange" size="xs" mt={20}>
              FC 제출 {dayjs(subDate).format('YYYY-MM-DD')}
            </Badge>
          )}
        </Group>

        <Group gap={4} mt={4}>
          <StatusToggle
            value={isConfirmed ? 'approved' : 'pending'}
            onChange={(val) => {
              if (val === 'approved') {
                executeAction(fc, 'confirm', category);
              }
            }}
            labelPending="미승인"
            labelApproved="위촉 완료"
            showNeutralForPending
            readOnly={isConfirmed}
          />
        </Group>
      </Stack>
    );
  };

  const renderHeader = (title: string, field: string) => (
    <Table.Th w={field === 'name' ? 220 : 100}>
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
      <Stack gap="lg">
        <Modal
          opened={rejectModalOpen}
          onClose={() => setRejectModalOpen(false)}
          centered
          title="반려 사유 입력"
        >
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              FC에게 전달될 반려 사유를 입력해주세요.
            </Text>
            <Textarea
              label="반려 사유"
              placeholder="예: 제출된 위촉 완료일이 확인되지 않아 재입력이 필요합니다."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.currentTarget.value)}
              minRows={4}
              autosize
            />
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={() => setRejectModalOpen(false)}>
                취소
              </Button>
              <Button color="red" onClick={handleRejectSubmit} loading={rejectSubmitting}>
                반려 처리
              </Button>
            </Group>
          </Stack>
        </Modal>

        {/* 확인 모달 */}
        <Modal
          opened={confirmOpened}
          onClose={closeConfirm}
          title={<Text fw={700}>{confirmConfig?.title}</Text>}
          size="sm"
          centered
        >
          <Stack gap="md">
            <Text size="sm">{confirmConfig?.message}</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={closeConfirm}>
                취소
              </Button>
              <Button color="blue" onClick={handleConfirm}>
                확인
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={2} c={CHARCOAL}>위촉 심사 및 확정</Title>
            <Text c={MUTED} size="sm" mt={4}>수당 동의가 완료된 FC의 위촉 일정을 관리하고 최종 승인합니다.</Text>
          </div>
          <Group>
            <Select
              value={filterYear}
              onChange={setFilterYear}
              data={['2025', '2024']}
              w={100}
              allowDeselect={false}
            />
            <Button variant="outline" color="gray" leftSection={<IconRefresh size={16} />} onClick={() => refetch()}>
              새로고침
            </Button>
          </Group>
        </Group>

        <Paper p="md" radius="lg" withBorder shadow="sm" bg="white" style={{ overflow: 'hidden' }}>
          <LoadingOverlay visible={isLoading} overlayProps={{ blur: 1 }} />
          <ScrollArea h="calc(100vh - 250px)" type="auto">
            <Table stickyHeader verticalSpacing="md" highlightOnHover>
              <Table.Thead bg="#F9FAFB">
                <Table.Tr>
                  {renderHeader('FC 정보 (이름)', 'name')}
                  {/* {renderHeader('소속', 'affiliation')} */}
                  {renderHeader('생명보험 위촉 (Life)', 'life')}
                  {renderHeader('손해보험 위촉 (Non-Life)', 'nonlife')}
                  {renderHeader('상태', 'status')}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredRows.length > 0 ? (
                  filteredRows.map((fc: any) => {
                    const status = getOverallStatus(fc);
                    return (
                      <Table.Tr key={fc.id}>
                        <Table.Td>
                          <Group gap="sm">
                            <ThemeIcon variant="light" color="gray" size="md" radius="xl">
                              <IconUser size={16} />
                            </ThemeIcon>
                            <div>
                              <Text size="sm" fw={600} c="dark.5">
                                {fc.name}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {fc.phone}<br />{fc.affiliation || '-'}
                              </Text>
                            </div>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {renderInsuranceSection(fc, 'life')}
                        </Table.Td>
                        <Table.Td>
                          {renderInsuranceSection(fc, 'nonlife')}
                        </Table.Td>
                        <Table.Td>
                          <Badge color={status.color} variant="light">
                            {status.label}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })
                ) : (
                  <Table.Tr>
                    <Table.Td colSpan={4} align="center" py={40} c="dimmed">
                      {isLoading ? '로딩 중...' : '조건에 맞는 FC가 없습니다.'}
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      </Stack>
    </Container>
  );
}
