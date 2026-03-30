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
import { useCallback, useMemo, useState, useTransition } from 'react';

import { StatusToggle } from '@/components/StatusToggle';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { updateAppointmentAction } from './actions';

// FC Profile 타입 정의
interface FcProfile {
  id: string;
  name?: string;
  phone?: string;
  affiliation?: string;
  created_at?: string;
  status?: string;
  allowance_date?: string;
  hanwha_commission_date_sub?: string | null;
  hanwha_commission_date?: string | null;
  hanwha_commission_reject_reason?: string | null;
  hanwha_commission_pdf_path?: string | null;
  hanwha_commission_pdf_name?: string | null;
  appointment_date_life?: string;
  appointment_date_nonlife?: string;
  appointment_date_life_sub?: string;
  appointment_date_nonlife_sub?: string;
  appointment_schedule_life?: string;
  appointment_schedule_nonlife?: string;
  appointment_reject_reason_life?: string | null;
  appointment_reject_reason_nonlife?: string | null;
  life_commission_completed?: boolean | null;
  nonlife_commission_completed?: boolean | null;
  fc_documents?: unknown[];
}

const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const HANWHA_ORANGE = '#F37321';
const HANWHA_APPROVED_STATUSES = ['hanwha-commission-approved', 'appointment-completed', 'final-link-sent'] as const;

const trimValue = (value?: string | null) => String(value ?? '').trim();

const hasHanwhaApprovedPdf = (fc: FcProfile) =>
  Boolean(
    (fc.hanwha_commission_date || HANWHA_APPROVED_STATUSES.includes(String(fc.status ?? '') as (typeof HANWHA_APPROVED_STATUSES)[number])) &&
    trimValue(fc.hanwha_commission_pdf_path) &&
    trimValue(fc.hanwha_commission_pdf_name),
  );

const hasInsuranceStageActivity = (fc: FcProfile) =>
  Boolean(
    fc.appointment_schedule_life ||
    fc.appointment_schedule_nonlife ||
    fc.appointment_date_life_sub ||
    fc.appointment_date_nonlife_sub ||
    fc.appointment_reject_reason_life ||
    fc.appointment_reject_reason_nonlife ||
    fc.appointment_date_life ||
    fc.appointment_date_nonlife ||
    fc.life_commission_completed ||
    fc.nonlife_commission_completed,
  );

const isLegacyInsuranceStageRow = (fc: FcProfile) =>
  hasInsuranceStageActivity(fc) && !hasHanwhaApprovedPdf(fc);

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

  // Popover 열릴 때 상태 초기화 (opened 변경 시 핸들러에서 처리)
  const handleOpenChange = (isOpen: boolean) => {
    setOpened(isOpen);
    if (isOpen) {
      setTempSelected(selected);
      setSearch('');
    }
  };

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
    <Popover opened={opened} onChange={handleOpenChange} width={280} position="bottom-start" withArrow shadow="md">
      <Popover.Target>
        <UnstyledButton onClick={() => handleOpenChange(!opened)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
            <Button variant="light" color="gray" size="xs" onClick={() => handleOpenChange(false)}>취소</Button>
            <Button variant="filled" color="orange" size="xs" onClick={() => {
              onApply(tempSelected);
              handleOpenChange(false);
            }}>확인</Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

export default function AppointmentPage() {
  const [, startTransition] = useTransition();
  const { isReadOnly } = useSession();
  const [filterYear, setFilterYear] = useState<string | null>('2025');
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<{ fc: FcProfile; category: 'life' | 'nonlife' } | null>(null);
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
  const [inputs, setInputs] = useState<Record<string, {
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
        .eq('signup_completed', true)
        .in('status', ['docs-approved', 'hanwha-commission-review', 'hanwha-commission-rejected', 'hanwha-commission-approved', 'appointment-completed', 'final-link-sent'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const getHanwhaStatus = useCallback((fc: FcProfile) => {
    if (fc.status === 'docs-approved') {
      return { label: '한화 위촉 URL 대기', color: 'blue' };
    }
    if (fc.status === 'hanwha-commission-review') {
      return { label: '한화 위촉 URL 검토 중', color: 'orange' };
    }
    if (fc.status === 'hanwha-commission-rejected') {
      return { label: '한화 위촉 URL 반려', color: 'red' };
    }
    if (fc.status === 'hanwha-commission-approved') {
      return hasHanwhaApprovedPdf(fc)
        ? { label: '한화 위촉 URL 승인 / PDF 완료', color: 'teal' }
        : { label: '한화 위촉 URL 승인 / PDF 대기', color: 'yellow' };
    }
    if (fc.status === 'appointment-completed' || fc.status === 'final-link-sent') {
      return { label: '한화 위촉 URL 승인 완료', color: 'teal' };
    }
    return { label: '사전 단계', color: 'gray' };
  }, []);

  const canManageInsuranceStage = useCallback((fc: FcProfile) => {
    return hasInsuranceStageActivity(fc) || hasHanwhaApprovedPdf(fc);
  }, []);

  const getOverallStatus = useCallback((fc: FcProfile) => {
    const life = !!fc.appointment_date_life;
    const nonlife = !!fc.appointment_date_nonlife;
    if (life && nonlife) return { label: '위촉 완료', color: 'green' };
    if (life || nonlife) return { label: '부분 완료', color: 'orange' };
    if (!canManageInsuranceStage(fc)) return getHanwhaStatus(fc);
    if (hasInsuranceStageActivity(fc)) return { label: '생명/손해 위촉 진행 중', color: 'blue' };
    return { label: '생명/손해 위촉 진행 가능', color: 'teal' };
  }, [canManageInsuranceStage, getHanwhaStatus]);

  // --- Derived Data for Filtering ---
  // 1. Apply Year/Month Filter first (processedFcs)
  const processedFcs = useMemo(() => {
    if (!fcs) return [] as FcProfile[];
    return fcs.filter((fc: FcProfile) => {
      if (!canManageInsuranceStage(fc)) return false;
      if (filterYear && !dayjs(fc.created_at).isSame(dayjs(`${filterYear}-01-01`), 'year')) return false;
      return true;
    });
  }, [canManageInsuranceStage, fcs, filterYear]);

  // 2. Helper to get values for filtering
  const getRowValue = useCallback((fc: FcProfile, field: string) => {
    if (field === 'name') return fc.name || '';
    if (field === 'affiliation') return fc.affiliation || '-';
    if (field === 'hanwha') return getHanwhaStatus(fc).label;
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
  }, [getHanwhaStatus, getOverallStatus]);

  // 3. Generate Filter Options based on processedFcs
  const filterOptions = useMemo(() => {
    const fields = ['name', 'affiliation', 'hanwha', 'status', 'life', 'nonlife'];
    const options: Record<string, string[]> = {};

    fields.forEach(field => {
      const unique = Array.from(new Set(processedFcs.map(fc => getRowValue(fc, field)))).filter(Boolean).sort();
      options[field] = unique as string[];
    });
    return options;
  }, [processedFcs, getRowValue]);

  // 4. Final Filtered Rows based on Header Filters
  const filteredRows = useMemo(() => {
    return processedFcs.filter(fc => {
      return Object.entries(filters).every(([field, selectedValues]) => {
        if (!selectedValues || selectedValues.length === 0) return true;
        const val = getRowValue(fc, field);
        return selectedValues.includes(val);
      });
    });
  }, [processedFcs, filters, getRowValue]);


  const handleInputChange = (fcId: string, field: string, value: string | Date | null) => {
    setInputs((prev) => ({
      ...prev,
      [fcId]: {
        ...prev[fcId],
        [field]: value,
      },
    }));
  };

  const openRejectModal = (fc: FcProfile, category: 'life' | 'nonlife') => {
    setRejectReason('');
    setRejectTarget({ fc, category });
    setRejectModalOpen(true);
  };

  const handleRejectSubmit = () => {
    if (isReadOnly) return;
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
          fcId: String(rejectTarget.fc.id),
          phone: rejectTarget.fc.phone ?? '',
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

  const executeAction = (fc: FcProfile, type: 'schedule' | 'confirm' | 'reject', category: 'life' | 'nonlife') => {
    if (!canManageInsuranceStage(fc)) {
      notifications.show({
        title: '한화 위촉 URL 대기',
        message: '한화 위촉 URL 승인과 PDF 등록이 끝난 뒤에만 생명/손해 위촉 단계를 진행할 수 있습니다.',
        color: 'orange',
      });
      return;
    }

    const input = inputs[fc.id] || {};

    let value: string | null = null;
    if (type === 'schedule') {
      const scheduleKey = category === 'life' ? 'lifeSchedule' : 'nonLifeSchedule';
      const dbScheduleKey = category === 'life' ? 'appointment_schedule_life' : 'appointment_schedule_nonlife';
      const scheduleVal = input[scheduleKey as keyof typeof input] ?? fc[dbScheduleKey];
      if (!scheduleVal) {
        notifications.show({ title: '입력 필요', message: '예정 정보를 입력해주세요.', color: 'yellow' });
        return;
      }
      value = String(scheduleVal);
    } else if (type === 'confirm') {
      const dateKey = category === 'life' ? 'lifeDate' : 'nonLifeDate';
      const dbDateKey = category === 'life' ? 'appointment_date_life' : 'appointment_date_nonlife';
      const dbDateValue = fc[dbDateKey];
      const dateVal = input[dateKey as keyof typeof input] ?? (dbDateValue ? new Date(dbDateValue) : null);

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
        title: type === 'confirm' ? '생명/손해 위촉 승인' : '생명/손해 위촉 예정월 저장',
      message: `${type === 'confirm' ? '승인' : '저장'} 하시겠습니까?`,
      onConfirm: () => {
        startTransition(async () => {
          const result = await updateAppointmentAction(
            { success: false },
            {
              fcId: String(fc.id),
              phone: fc.phone ?? '',
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

  const renderHanwhaSection = (fc: FcProfile) => {
    const status = getHanwhaStatus(fc);
    const hasPdf = Boolean(trimValue(fc.hanwha_commission_pdf_path) && trimValue(fc.hanwha_commission_pdf_name));

    return (
      <Stack gap="xs">
        <Badge color={status.color} variant="light" w="fit-content">
          {status.label}
        </Badge>
        <Text size="xs" c="dimmed">
          제출일: {fc.hanwha_commission_date_sub ? dayjs(fc.hanwha_commission_date_sub).format('YYYY-MM-DD') : '미제출'}
        </Text>
        <Text size="xs" c="dimmed">
          승인일: {fc.hanwha_commission_date ? dayjs(fc.hanwha_commission_date).format('YYYY-MM-DD') : '미승인'}
        </Text>
        <Badge color={hasPdf ? 'teal' : 'gray'} variant="outline" size="xs" w="fit-content">
          {hasPdf ? 'PDF 등록 완료' : 'PDF 미등록'}
        </Badge>
      </Stack>
    );
  };

  const renderInsuranceSection = (fc: FcProfile, category: 'life' | 'nonlife') => {
    const input = inputs[fc.id] || {};
    const scheduleKey = category === 'life' ? 'lifeSchedule' : 'nonLifeSchedule';
    const dateKey = category === 'life' ? 'lifeDate' : 'nonLifeDate';
    const dbScheduleKey = category === 'life' ? 'appointment_schedule_life' : 'appointment_schedule_nonlife';
    const dbDateKey = category === 'life' ? 'appointment_date_life' : 'appointment_date_nonlife';
    const subDateKey = category === 'life' ? 'appointment_date_life_sub' : 'appointment_date_nonlife_sub';
    const dbSchedule = fc[dbScheduleKey];
    const dbDate = fc[dbDateKey];
    const subDate = fc[subDateKey];

    const scheduleValue = (input[scheduleKey as keyof typeof input] ?? (dbSchedule ?? '')) as string | undefined;

    const dateValueRaw = input[dateKey as keyof typeof input];
    const dateValue = dateValueRaw instanceof Date ? dateValueRaw
      : (dateValueRaw
        ? new Date(dateValueRaw as string)
        : (dbDate ? new Date(dbDate) : (subDate ? new Date(subDate) : null)));

    const isConfirmed = !!dbDate;
    const hasSubmitted = !!subDate && !dbDate;
    const insuranceStageOpen = canManageInsuranceStage(fc);
    const isLegacyException = isLegacyInsuranceStageRow(fc);

    return (
      <Stack gap="xs">
        {!insuranceStageOpen && (
            <Text size="xs" c="dimmed">
              한화 위촉 URL 승인과 PDF 등록이 완료되면 생명/손해 위촉 단계를 진행할 수 있습니다.
            </Text>
        )}
        {isLegacyException && (
          <Badge variant="outline" color="yellow" size="xs" w="fit-content">
            레거시 보험 이력 예외
          </Badge>
        )}
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
            readOnly={isReadOnly || isConfirmed || !insuranceStageOpen}
            disabled={isReadOnly || isConfirmed || !insuranceStageOpen}
          />
          {!isConfirmed && (
            <Tooltip label="예정 메모 저장">
              <ActionIcon variant="light" color="blue" size="md" mb={2} disabled={isReadOnly || !insuranceStageOpen} onClick={() => executeAction(fc, 'schedule', category)}>
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
            readOnly={isReadOnly || isConfirmed || !insuranceStageOpen}
            disabled={isReadOnly || isConfirmed || !insuranceStageOpen}
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
              if (isReadOnly) return;
              if (val === 'approved') {
                executeAction(fc, 'confirm', category);
              }
            }}
            labelPending="미승인"
            labelApproved="위촉 완료"
            showNeutralForPending
            readOnly={isReadOnly || isConfirmed || !insuranceStageOpen}
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
              <Button color="red" onClick={handleRejectSubmit} loading={rejectSubmitting} disabled={isReadOnly}>
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
              <Title order={2} c={CHARCOAL}>생명/손해 위촉 심사 및 확정</Title>
              <Text c={MUTED} size="sm" mt={4}>
            한화 위촉 URL 승인과 PDF 등록이 끝난 FC만 생명/손해 위촉 단계를 진행할 수 있습니다. 기존 보험 위촉 이력이 남아 있는 레거시 행만 예외로 유지됩니다.
              </Text>
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
              {renderHeader('한화 위촉 URL', 'hanwha')}
                  {renderHeader('생명보험 위촉 (Life)', 'life')}
                  {renderHeader('손해보험 위촉 (Non-Life)', 'nonlife')}
                  {renderHeader('상태', 'status')}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredRows.length > 0 ? (
                  filteredRows.map((fc: FcProfile) => {
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
                        {renderHanwhaSection(fc)}
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
                    <Table.Td colSpan={5} align="center" py={40} c="dimmed">
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
