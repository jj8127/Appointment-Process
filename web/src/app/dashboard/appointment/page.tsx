'use client';

import {
  ActionIcon,
  Badge,
  Button,
  Container,
  Group,
  LoadingOverlay,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconRefresh, IconUser, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState, useTransition } from 'react';

import { supabase } from '@/lib/supabase';
import { updateAppointmentAction } from './actions';

const CHARCOAL = '#111827';
const MUTED = '#6b7280';

export default function AppointmentPage() {
  const [isPending, startTransition] = useTransition();
  const [filterYear, setFilterYear] = useState<string | null>('2025');
  const [filterMonth, setFilterMonth] = useState<string | null>('all');

  // Local state for inputs
  // lifeSchedule: number (month), lifeDate: Date | null
  const [inputs, setInputs] = useState<Record<number, {
    lifeSchedule?: number;
    lifeDate?: Date | null;
    nonLifeSchedule?: number;
    nonLifeDate?: Date | null;
  }>>({});

  const { data: fcs, isLoading, refetch } = useQuery({
    queryKey: ['appointment-fcs'],
    queryFn: async () => {
      // Fetch FCs who have consented to allowance (allowance_date is not null)
      const { data, error } = await supabase
        .from('fc_profiles')
        .select('*, fc_documents(*)')
        .not('allowance_date', 'is', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const handleInputChange = (fcId: number, field: string, value: any) => {
    setInputs((prev) => ({
      ...prev,
      [fcId]: {
        ...prev[fcId],
        [field]: value,
      },
    }));
  };

  const executeAction = (fc: any, type: 'schedule' | 'confirm' | 'reject', category: 'life' | 'nonlife') => {
    const input = inputs[fc.id] || {};

    let value = null;
    if (type === 'schedule') {
      const scheduleKey = category === 'life' ? 'lifeSchedule' : 'nonLifeSchedule';
      // Use input value if present, else existing DB value
      const scheduleVal = input[scheduleKey as keyof typeof input] ?? fc[`appointment_schedule_${category}`];
      if (!scheduleVal) {
        notifications.show({ title: '입력 필요', message: '예정월을 입력해주세요.', color: 'yellow' });
        return;
      }
      value = String(scheduleVal);
    } else if (type === 'confirm') {
      const dateKey = category === 'life' ? 'lifeDate' : 'nonLifeDate';
      // Prioritize input date, fall back to DB date only if needed (usually input is required for confirmation if not already set)
      // Actually DB might have string 'YYYY-MM-DD', DateInput works with Date object.
      // If confirming, we expect a VALID date.
      const dateVal = input[dateKey as keyof typeof input] ?? (fc[`appointment_date_${category}`] ? new Date(fc[`appointment_date_${category}`]) : null);

      if (!dateVal) {
        notifications.show({ title: '입력 필요', message: '확정일(Start Date)을 선택해주세요.', color: 'orange' });
        return;
      }
      value = dayjs(dateVal).format('YYYY-MM-DD');
    }
    // Reject: value is null (default)

    if (confirm(`${type === 'confirm' ? '승인' : type === 'reject' ? '반려' : '저장'} 하시겠습니까?`)) {
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
    }
  };

  const getOverallStatus = (fc: any) => {
    const life = !!fc.appointment_date_life;
    const nonlife = !!fc.appointment_date_nonlife;
    if (life && nonlife) return { label: '위촉 완료', color: 'green' };
    if (life || nonlife) return { label: '부분 완료', color: 'orange' };
    return { label: '진행 중', color: 'blue' };
  };

  const renderInsuranceSection = (fc: any, category: 'life' | 'nonlife') => {
    const input = inputs[fc.id] || {};
    const scheduleKey = category === 'life' ? 'lifeSchedule' : 'nonLifeSchedule';
    const dateKey = category === 'life' ? 'lifeDate' : 'nonLifeDate';
    const dbSchedule = fc[`appointment_schedule_${category}`];
    const dbDate = fc[`appointment_date_${category}`];

    // Determine values for inputs
    const scheduleValue = input[scheduleKey as keyof typeof input] !== undefined ? input[scheduleKey as keyof typeof input] : (dbSchedule ? Number(dbSchedule) : '');
    const dateValue = input[dateKey as keyof typeof input] !== undefined ? input[dateKey as keyof typeof input] : (dbDate ? new Date(dbDate) : null);

    const isConfirmed = !!dbDate;

    return (
      <Stack gap="xs">
        <Group align="flex-end" gap="xs">
          <NumberInput
            label="예정월(Plan)"
            placeholder="월"
            min={1}
            max={12}
            size="xs"
            w={70}
            value={scheduleValue}
            onChange={(v) => handleInputChange(fc.id, scheduleKey, typeof v === 'number' ? v : undefined)}
          />
          <Tooltip label="예정월만 저장">
            <ActionIcon variant="light" color="blue" size="md" mb={2} onClick={() => executeAction(fc, 'schedule', category)}>
              <IconDeviceFloppy size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <Group align="flex-end" gap="xs">
          <DateInput
            label="확정일(Actual)"
            placeholder="YYYY-MM-DD"
            valueFormat="YYYY-MM-DD"
            size="xs"
            w={110}
            value={dateValue}
            onChange={(v) => handleInputChange(fc.id, dateKey, v)}
            clearable
          />
        </Group>

        <Group gap={4} mt={4}>
          <Button
            size="compact-xs"
            color={isConfirmed ? 'green' : 'indigo'}
            variant={isConfirmed ? 'outline' : 'filled'}
            onClick={() => executeAction(fc, 'confirm', category)}
          >
            {isConfirmed ? '수정 승인' : '위촉 승인'}
          </Button>
          <Tooltip label="반려 (확정 취소)">
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              onClick={() => executeAction(fc, 'reject', category)}
            >
              <IconX size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Stack>
    );
  };

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
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
            <Select
              value={filterMonth}
              onChange={setFilterMonth}
              data={[
                { value: 'all', label: '전체 월' },
                ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}월` }))
              ]}
              w={120}
              allowDeselect={false}
            />
            <Button variant="outline" color="gray" leftSection={<IconRefresh size={16} />} onClick={() => refetch()}>
              새로고침
            </Button>
          </Group>
        </Group>

        <Paper p="md" radius="lg" withBorder shadow="sm" bg="white" overflow="hidden">
          <LoadingOverlay visible={isLoading} overlayProps={{ blur: 1 }} />
          <ScrollArea h="calc(100vh - 250px)" type="auto">
            <Table stickyHeader verticalSpacing="md" highlightOnHover>
              <Table.Thead bg="#F9FAFB">
                <Table.Tr>
                  <Table.Th w={220}>FC 정보</Table.Th>
                  <Table.Th w={260}>생명보험 위촉 (Life)</Table.Th>
                  <Table.Th w={260}>손해보험 위촉 (Non-Life)</Table.Th>
                  <Table.Th w={100}>상태</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {fcs?.filter((fc: any) => {
                  // Filter by Year (created_at)
                  if (filterYear && !dayjs(fc.created_at).isSame(dayjs(`${filterYear}-01-01`), 'year')) return false;

                  // Filter by Month (appointment_schedule)
                  if (filterMonth && filterMonth !== 'all') {
                    const m = Number(filterMonth);
                    const life = Number(fc.appointment_schedule_life);
                    const nonlife = Number(fc.appointment_schedule_nonlife);
                    // Show if either schedule matches the selected month
                    if (life !== m && nonlife !== m) return false;
                  }
                  return true;
                }).map((fc: any) => {
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
                })}
                {fcs && fcs.length > 0 && fcs.filter((fc: any) => {
                  if (filterYear && !dayjs(fc.created_at).isSame(dayjs(`${filterYear}-01-01`), 'year')) return false;
                  if (filterMonth && filterMonth !== 'all') {
                    const m = Number(filterMonth);
                    const life = Number(fc.appointment_schedule_life);
                    const nonlife = Number(fc.appointment_schedule_nonlife);
                    if (life !== m && nonlife !== m) return false;
                  }
                  return true;
                }).length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={4} align="center" py={40} c="dimmed">
                        조건에 맞는 FC가 없습니다.
                      </Table.Td>
                    </Table.Tr>
                  )}
                {!fcs?.length && (
                  <Table.Tr>
                    <Table.Td colSpan={4} align="center" py={40} c="dimmed">
                      심사 대상 FC가 없습니다.
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
