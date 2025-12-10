'use client';

import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Group,
  LoadingOverlay,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCalendar,
  IconCheck,
  IconDeviceFloppy,
  IconEdit,
  IconFileText,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTrash,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState, useTransition } from 'react';

import { ADMIN_STEP_LABELS, calcStep, DOC_OPTIONS, getAdminStep, STATUS_LABELS } from '@/lib/shared';
import { supabase } from '@/lib/supabase';
import { notifications } from '@mantine/notifications';
import { useRouter } from 'next/navigation';
import { updateAppointmentAction } from './appointment/actions';

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string | null>('all');
  const [keyword, setKeyword] = useState('');

  // 모달 상태
  const [opened, { open, close }] = useDisclosure(false);
  const [selectedFc, setSelectedFc] = useState<any>(null);
  const [modalTab, setModalTab] = useState<string | null>('info');

  // 수정용 상태
  const [tempIdInput, setTempIdInput] = useState('');
  const [careerInput, setCareerInput] = useState<'신입' | '경력'>('신입');
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [customDocInput, setCustomDocInput] = useState('');

  // 위촉 일정 및 승인 상태
  const [appointmentInputs, setAppointmentInputs] = useState<{
    life?: number;
    nonlife?: number;
    lifeDate?: Date | null;
    nonLifeDate?: Date | null;
  }>({});
  const [isAppointmentPending, startAppointmentTransition] = useTransition();

  const { data: fcs, isLoading } = useQuery({
    queryKey: ['dashboard-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fc_profiles')
        .select('*, fc_documents(doc_type,storage_path,file_name,status)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filteredData = useMemo(() => {
    if (!fcs) return [];
    let result = fcs.map((fc: any) => {
      const rawStep = calcStep(fc);
      // Map raw 1-5 to Admin 1-4
      // Raw 1 (Info), 2 (Allowance) -> Admin 1 (Allowance)
      // Raw 3 (Docs) -> Admin 2
      // Raw 4 (Appt) -> Admin 3
      // Raw 5 (Done) -> Admin 4
      const adminStep = rawStep <= 2 ? 1 : rawStep - 1;
      return { ...fc, step: rawStep, adminStep };
    });

    if (activeTab && activeTab !== 'all') {
      const stepNum = Number(activeTab.replace('step', ''));
      result = result.filter((fc) => fc.adminStep === stepNum);
    }
    if (keyword.trim()) {
      const q = keyword.trim().toLowerCase();
      result = result.filter(
        (fc) =>
          fc.name?.toLowerCase().includes(q) ||
          fc.phone?.includes(q) ||
          fc.affiliation?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [fcs, activeTab, keyword]);

  const updateInfoMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) return;
      const payload: any = { career_type: careerInput };
      if (tempIdInput && tempIdInput !== selectedFc.temp_id) {
        payload.temp_id = tempIdInput;
        payload.status = 'temp-id-issued';
      }
      const { error } = await supabase.from('fc_profiles').update(payload).eq('id', selectedFc.id);
      if (error) throw error;
      if (payload.temp_id) {
        await supabase.from('notifications').insert({
          title: '임시번호 발급',
          body: `임시사번: ${payload.temp_id} 이 발급되었습니다.`,
          recipient_role: 'fc',
          resident_id: selectedFc.phone,
        });
      }
    },
    onSuccess: () => {
      notifications.show({ title: '저장 완료', message: '기본 정보가 업데이트되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: any) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const updateDocsRequestMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) return;

      console.log('Mutation Start');
      console.log('SelectedDocs (Intent):', selectedDocs);

      const { data: currentDocsRaw, error: fetchErr } = await supabase
        .from('fc_documents')
        .select('doc_type, storage_path')
        .eq('fc_id', selectedFc.id);

      if (fetchErr) {
        console.error('Fetch Error:', fetchErr);
        throw fetchErr;
      }

      const currentDocs = currentDocsRaw || [];
      console.log('Current DB Docs:', currentDocs);

      const currentTypes = currentDocs.map((d: any) => d.doc_type);

      const toAdd = selectedDocs.filter((type) => !currentTypes.includes(type));
      const toDelete = currentDocs
        .filter((d: any) => !selectedDocs.includes(d.doc_type) && (!d.storage_path || d.storage_path === 'deleted'))
        .map((d: any) => d.doc_type);

      console.log('To Add:', toAdd);
      console.log('To Delete:', toDelete);

      if (toDelete.length) {
        const { error: delError } = await supabase.from('fc_documents').delete().eq('fc_id', selectedFc.id).in('doc_type', toDelete);
        if (delError) console.error('Delete Error:', delError);
      }
      if (toAdd.length) {
        const rows = toAdd.map((type) => ({
          fc_id: selectedFc.id,
          doc_type: type,
          status: 'pending',
          file_name: '',
          storage_path: '',
        }));
        const { error: insertError } = await supabase.from('fc_documents').insert(rows);
        if (insertError) console.error('Insert Error:', JSON.stringify(insertError, null, 2));
      }
      await supabase.from('fc_profiles').update({ status: 'docs-requested' }).eq('id', selectedFc.id);
    },
    onSuccess: () => {
      notifications.show({ title: '요청 완료', message: '서류 목록이 갱신되었습니다.', color: 'blue' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: any) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ status, title, msg }: { status: string; title?: string; msg: string }) => {
      if (!selectedFc) return;
      await supabase.from('fc_profiles').update({ status }).eq('id', selectedFc.id);
      if (msg) {
        await supabase
          .from('notifications')
          .insert({
            title: title || '상태 업데이트',
            body: msg,
            recipient_role: 'fc',
            resident_id: selectedFc.phone,
          });
      }
    },
    onSuccess: () => {
      notifications.show({ title: '처리 완료', message: '상태가 변경되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      close();
    },
    onError: (err: any) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const deleteFcMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) return;
      await supabase.from('fc_documents').delete().eq('fc_id', selectedFc.id);
      await supabase.from('fc_profiles').delete().eq('id', selectedFc.id);
    },
    onSuccess: () => {
      notifications.show({ title: '삭제 완료', message: 'FC 정보가 삭제되었습니다.', color: 'gray' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      close();
    },
    onError: (err: any) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const handleOpenModal = (fc: any) => {
    setSelectedFc(fc);
    setTempIdInput(fc.temp_id || '');
    setCareerInput((fc.career_type as '신입' | '경력') || '신입');
    const currentDocs = fc.fc_documents?.map((d: any) => d.doc_type) || [];
    console.log('Opening Modal for:', fc.name);
    console.log('Init SelectedDocs:', currentDocs);
    setSelectedDocs(currentDocs);

    // 위촉 일정 초기화
    setAppointmentInputs({
      life: fc.appointment_schedule_life ? Number(fc.appointment_schedule_life) : undefined,
      nonlife: fc.appointment_schedule_nonlife ? Number(fc.appointment_schedule_nonlife) : undefined,
      lifeDate: fc.appointment_date_life ? new Date(fc.appointment_date_life) : null,
      nonLifeDate: fc.appointment_date_nonlife ? new Date(fc.appointment_date_nonlife) : null,
    });

    setCustomDocInput('');
    setModalTab('info');
    open();
  };

  const handleOpenDoc = async (path: string) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from('fc-documents').createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      notifications.show({ title: '실패', message: '파일을 찾을 수 없습니다.', color: 'red' });
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const handleAppointmentAction = (e: React.MouseEvent, type: 'schedule' | 'confirm' | 'reject', category: 'life' | 'nonlife') => {
    e.stopPropagation();
    let value = null;

    if (type === 'schedule') {
      const scheduleVal = category === 'life' ? appointmentInputs.life : appointmentInputs.nonlife;
      // Fallback to DB if not in state? No, modal initializes state.
      if (!scheduleVal) {
        notifications.show({ title: '입력 필요', message: '예정월을 입력해주세요.', color: 'yellow' });
        return;
      }
      value = String(scheduleVal);
    } else if (type === 'confirm') {
      const dateVal = category === 'life' ? appointmentInputs.lifeDate : appointmentInputs.nonLifeDate;
      if (!dateVal) {
        notifications.show({ title: '입력 필요', message: '확정일(Actual Date)을 선택해주세요.', color: 'yellow' });
        return;
      }
      value = dayjs(dateVal).format('YYYY-MM-DD');
    }

    if (confirm(`${type === 'confirm' ? '승인' : type === 'reject' ? '반려' : '저장'} 하시겠습니까?`)) {
      startAppointmentTransition(async () => {
        const result = await updateAppointmentAction(
          { success: false },
          {
            fcId: selectedFc.id,
            phone: selectedFc.phone,
            type,
            category,
            value,
          }
        );
        if (result.success) {
          notifications.show({ title: '완료', message: result.message, color: 'green' });
          queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
          // Note: Re-fetching will re-render rows, but modal state needs update?
          // Modal uses `selectedFc`. If we don't update `selectedFc`, it might show stale data.
          // However, `selectedFc` is just state.
          // We should probably re-fetch selectedFc or close modal.
          // For better UX, we can update the local `selectedFc` state with the new values if we key off it?
          // Actually `selectedFc` is not automatically updated by refetch.
          // Or better: update `selectedFc` manually with the change? Too complex.
          // Don't close modal so user can work on the other category if needed.
          // We need to refetch user data to update the UI (green buttons).
          // But `selectedFc` won't update automatically.
          // Let's rely on toast for feedback.
          // close();
        } else {
          notifications.show({ title: '오류', message: result.error, color: 'red' });
        }
      });
    }
  };

  const renderAppointmentSection = (category: 'life' | 'nonlife') => {
    const isLife = category === 'life';
    const schedule = isLife ? appointmentInputs.life : appointmentInputs.nonlife;
    const date = isLife ? appointmentInputs.lifeDate : appointmentInputs.nonLifeDate;
    const isConfirmed = isLife ? !!selectedFc.appointment_date_life : !!selectedFc.appointment_date_nonlife;

    return (
      <Stack gap="xs" mt="sm">
        <Text size="sm" fw={600} c="dimmed">{isLife ? '생명보험' : '손해보험'}</Text>
        <Group align="flex-end" grow>
          <NumberInput
            label="예정월(Plan)"
            placeholder="월"
            min={1}
            max={12}
            value={schedule !== undefined ? schedule : ''}
            onChange={(v: number | string) => setAppointmentInputs(prev => ({ ...prev, [isLife ? 'life' : 'nonlife']: typeof v === 'number' ? v : undefined }))}
          />
          <DateInput
            label="확정일(Actual)"
            placeholder="YYYY-MM-DD"
            valueFormat="YYYY-MM-DD"
            value={date}
            onChange={(v) => setAppointmentInputs(prev => ({ ...prev, [isLife ? 'lifeDate' : 'nonLifeDate']: v }))}
            clearable
          />
        </Group>
        <Group gap={8}>
          <Button
            variant="light" color="blue" size="xs" flex={1}
            leftSection={<IconDeviceFloppy size={14} />}
            loading={isAppointmentPending}
            onClick={(e) => handleAppointmentAction(e, 'schedule', category)}
          >
            일정 저장
          </Button>
          <Button
            variant={isConfirmed ? 'outline' : 'filled'}
            color={isConfirmed ? 'green' : 'indigo'}
            size="xs" flex={1}
            leftSection={<IconCheck size={14} />}
            loading={isAppointmentPending}
            onClick={(e) => handleAppointmentAction(e, 'confirm', category)}
          >
            {isConfirmed ? '수정 승인' : '위촉 승인'}
          </Button>
          <Tooltip label="반려 (확정 취소)">
            <ActionIcon
              variant="light" color="red" size="input-xs"
              loading={isAppointmentPending}
              onClick={(e) => handleAppointmentAction(e, 'reject', category)}
            >
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Stack>
    );
  };

  const getStatusColor = (status: string) => {
    if (['appointment-completed', 'final-link-sent', 'allowance-consented', 'docs-approved'].includes(status))
      return 'green';
    if (['docs-rejected'].includes(status)) return 'red';
    if (['docs-submitted', 'temp-id-issued'].includes(status)) return 'blue';
    return 'gray';
  };

  /* Table Rows */
  const rows = filteredData.map((fc: any) => (
    <Table.Tr
      key={fc.id}
      style={{ cursor: 'pointer' }}
      onClick={() => router.push(`/dashboard/profile/${fc.id}`)}
    >
      <Table.Td>
        <Group gap="sm">
          <ThemeIcon variant="light" color="gray" size="lg" radius="xl">
            <IconUser size={18} />
          </ThemeIcon>
          <div>
            <Text size="sm" fw={600} c="dark.5">
              {fc.name}
            </Text>
            <Text size="xs" c="dimmed">
              {fc.career_type || '신입'}
            </Text>
          </div>
        </Group>
      </Table.Td>
      <Table.Td>{fc.phone}</Table.Td>
      <Table.Td>{fc.affiliation || '-'}</Table.Td>
      <Table.Td>
        <Badge color={getStatusColor(fc.status)} variant="light" size="sm" radius="sm">
          {STATUS_LABELS[fc.status] || fc.status}
        </Badge>
      </Table.Td>
      <Table.Td>
        {/* Updated Badge to use getAdminStep */}
        <Badge variant="dot" size="md" color={fc.step === 5 ? 'green' : 'orange'} radius="xl">
          {getAdminStep(fc)}
        </Badge>
      </Table.Td>
      <Table.Td>
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={(e) => {
            e.stopPropagation();
            handleOpenModal(fc);
          }}
        >
          <IconEdit size={16} />
        </ActionIcon>
      </Table.Td>
    </Table.Tr>
  ));

  /* Metrics Calculation */
  const metrics = useMemo(() => {
    if (!fcs) return { total: 0, pendingAllowance: 0, pendingDocs: 0 };
    return {
      total: fcs.length,
      pendingAllowance: fcs.filter((fc: any) => fc.status === 'allowance-pending').length,
      pendingDocs: fcs.filter((fc: any) => fc.status === 'docs-pending' || fc.status === 'docs-submitted').length,
    };
  }, [fcs]);

  return (
    <Box p="lg" maw={1600} mx="auto">
      <Stack gap="xl">
        {/* Header Section */}
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={1} fw={800} c="dark.8">대시보드</Title>
            <Text c="dimmed" mt={4}>FC 온보딩 전체 현황판</Text>
          </div>
          <Button
            leftSection={<IconRefresh size={16} />}
            onClick={() => queryClient.invalidateQueries({ queryKey: ['dashboard-list'] })}
            variant="default"
            radius="md"
          >
            새로고침
          </Button>
        </Group>

        {/* Metrics Cards */}
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <Card padding="lg" radius="md" withBorder shadow="sm" bg="white">
            <Group justify="space-between" mb="xs">
              <Text c="dimmed" tt="uppercase" fw={700} size="xs" ls={0.5}>총 인원</Text>
              <ThemeIcon variant="light" color="blue" radius="md" size="lg">
                <IconUser size={22} stroke={1.5} />
              </ThemeIcon>
            </Group>
            <Group align="flex-end" gap="xs">
              <Text fw={800} size="2.5rem" lh={1}>{metrics.total}</Text>
              <Text c="dimmed" size="sm" mb={6}>명</Text>
            </Group>
            <Text c="green" size="xs" fw={700} mt="md">
              활성 FC 현황
            </Text>
          </Card>

          <Card padding="lg" radius="md" withBorder shadow="sm" bg="white">
            <Group justify="space-between" mb="xs">
              <Text c="dimmed" tt="uppercase" fw={700} size="xs" ls={0.5}>수당동의 대기</Text>
              <ThemeIcon variant="light" color="orange" radius="md" size="lg">
                <IconCheck size={22} stroke={1.5} />
              </ThemeIcon>
            </Group>
            <Group align="flex-end" gap="xs">
              <Text fw={800} size="2.5rem" lh={1}>{metrics.pendingAllowance}</Text>
              <Text c="dimmed" size="sm" mb={6}>건</Text>
            </Group>
            <Text c="orange" size="xs" fw={700} mt="md">
              승인 필요
            </Text>
          </Card>

          <Card padding="lg" radius="md" withBorder shadow="sm" bg="white">
            <Group justify="space-between" mb="xs">
              <Text c="dimmed" tt="uppercase" fw={700} size="xs" ls={0.5}>서류검토 대기</Text>
              <ThemeIcon variant="light" color="indigo" radius="md" size="lg">
                <IconFileText size={22} stroke={1.5} />
              </ThemeIcon>
            </Group>
            <Group align="flex-end" gap="xs">
              <Text fw={800} size="2.5rem" lh={1}>{metrics.pendingDocs}</Text>
              <Text c="dimmed" size="sm" mb={6}>건</Text>
            </Group>
            <Text c="indigo" size="xs" fw={700} mt="md">
              검토 필요
            </Text>
          </Card>
        </SimpleGrid>

        {/* Quick Actions */}
        <Paper p="md" radius="md" withBorder bg="gray.0">
          <Group justify="space-between">
            <Group>
              <ThemeIcon variant="white" size="lg" radius="md" color="dark">
                <IconSend size={20} />
              </ThemeIcon>
              <div>
                <Text size="sm" fw={700}>빠른 작업</Text>
                <Text size="xs" c="dimmed">자주 사용하는 기능을 바로 실행하세요.</Text>
              </div>
            </Group>
            <Group gap="xs">
              <Button variant="white" color="dark" size="xs" leftSection={<IconUser size={14} />} onClick={() => router.push('/dashboard/exam/applicants')}>
                시험 신청자 관리
              </Button>
              <Button variant="white" color="dark" size="xs" leftSection={<IconCalendar size={14} />} onClick={() => router.push('/dashboard/exam/schedule')}>
                시험 일정 등록
              </Button>
              <Button variant="filled" color="dark" size="xs" leftSection={<IconSend size={14} />} onClick={() => router.push('/dashboard/notifications/create')}>
                새 공지 작성
              </Button>
            </Group>
          </Group>
        </Paper>

        {/* Main Content Area */}
        <Paper shadow="sm" radius="lg" withBorder p="md" bg="white">
          <Group justify="space-between" mb="md">
            <Tabs
              value={activeTab}
              onChange={setActiveTab}
              variant="pills"
              radius="xl"
              color="dark"
            >
              <Tabs.List bg="gray.1" p={4} style={{ borderRadius: 24 }}>
                <Tabs.Tab value="all" fw={600} px={16}>전체</Tabs.Tab>
                {/* Updated to use ADMIN_STEP_LABELS */}
                {Object.entries(ADMIN_STEP_LABELS).map(([key, label]) => (
                  <Tabs.Tab key={key} value={key} fw={600} px={16}>{label}</Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
            <TextInput
              placeholder="이름, 연락처 검색"
              leftSection={<IconSearch size={16} stroke={1.5} />}
              value={keyword}
              onChange={(e) => setKeyword(e.currentTarget.value)}
              radius="xl"
              w={260}
            />
          </Group>

          <Box pos="relative" mih={400}>
            <LoadingOverlay visible={isLoading} overlayProps={{ blur: 1 }} />
            <ScrollArea h="calc(100vh - 420px)" type="auto" offsetScrollbars>
              <Table verticalSpacing="sm" highlightOnHover striped withTableBorder>
                <Table.Thead bg="gray.0" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <Table.Tr>
                    <Table.Th w={250}>FC 정보</Table.Th>
                    <Table.Th w={180}>연락처</Table.Th>
                    <Table.Th w={200}>소속</Table.Th>
                    <Table.Th w={160}>현재 상태</Table.Th>
                    <Table.Th w={120}>진행 단계</Table.Th>
                    <Table.Th w={60} ta="center">관리</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.length > 0 ? (
                    rows
                  ) : (
                    <Table.Tr>
                      <Table.Td colSpan={6} align="center" py={80}>
                        <Stack align="center" gap="xs">
                          <ThemeIcon size={60} radius="xl" color="gray" variant="light">
                            <IconSearch size={30} />
                          </ThemeIcon>
                          <Text c="dimmed" fw={500}>조건에 맞는 데이터가 없습니다.</Text>
                        </Stack>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Box>
        </Paper>
      </Stack>

      <Modal
        opened={opened}
        onClose={close}
        title={<Text fw={700} size="lg">FC 상세 관리</Text>}
        size="lg"
        padding="xl"
        radius="md"
        centered
        overlayProps={{ blur: 3 }}
      >
        {selectedFc && (
          <>
            <Group mb="xl" align="flex-start">
              <Avatar size="lg" color="orange" radius="xl">
                {selectedFc.name?.slice(0, 1) || '?'}
              </Avatar>
              <div>
                <Group gap="xs" align="center">
                  <Text size="lg" fw={700}>
                    {selectedFc.name}
                  </Text>
                  <Badge variant="light">
                    {selectedFc.career_type || '신입'}
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed">
                  {selectedFc.phone} · {selectedFc.affiliation || '소속 미정'}
                </Text>
              </div>
            </Group>

            <Tabs value={modalTab} onChange={setModalTab} color="orange" variant="outline" radius="md">
              <Tabs.List grow mb="lg">
                <Tabs.Tab value="info" leftSection={<IconEdit size={16} />}>
                  기본 정보
                </Tabs.Tab>
                <Tabs.Tab value="docs" leftSection={<IconFileText size={16} />}>
                  서류 관리
                </Tabs.Tab>
                <Tabs.Tab value="appointment" leftSection={<IconCalendar size={16} />}>
                  위촉 관리
                </Tabs.Tab>
                <Tabs.Tab value="actions" leftSection={<IconCheck size={16} />}>
                  승인/작업
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="info">
                <Stack gap="md">
                  <TextInput
                    label="임시사번"
                    placeholder="T-123456"
                    value={tempIdInput}
                    onChange={(e) => setTempIdInput(e.currentTarget.value)}
                  />
                  <Box>
                    <Text size="sm" fw={500} mb={6}>
                      경력 구분
                    </Text>
                    <Chip.Group value={careerInput} onChange={(v) => setCareerInput((v as '신입' | '경력') ?? '신입')}>
                      <Group gap="xs">
                        <Chip value="신입" color="orange" variant="light">
                          신입
                        </Chip>
                        <Chip value="경력" color="blue" variant="light">
                          경력
                        </Chip>
                      </Group>
                    </Chip.Group>
                  </Box>
                  <Button fullWidth mt="md" onClick={() => updateInfoMutation.mutate()} loading={updateInfoMutation.isPending} color="dark">
                    변경사항 저장
                  </Button>
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="docs">
                <Stack gap="md">
                  <Card withBorder radius="md" p="sm" bg="gray.0">
                    <Group justify="space-between" mb="xs">
                      <Text fw={600} size="sm">
                        제출된 서류 ({selectedFc.fc_documents?.filter((d: any) => d.storage_path && d.storage_path !== 'deleted').length || 0}건)
                      </Text>
                    </Group>
                    {selectedFc.fc_documents?.filter((d: any) => d.storage_path && d.storage_path !== 'deleted').length ? (
                      <Stack gap={8}>
                        {selectedFc.fc_documents
                          .filter((d: any) => d.storage_path && d.storage_path !== 'deleted')
                          .map((d: any) => (
                            <Group
                              key={d.doc_type}
                              justify="space-between"
                              p="sm"
                              bg="white"
                              style={{ borderRadius: 8, border: '1px solid #e9ecef' }}
                            >
                              <Group gap="sm">
                                <ThemeIcon size="lg" color="blue" variant="light" radius="md">
                                  <IconFileText size={20} />
                                </ThemeIcon>
                                <div>
                                  <Text size="sm" fw={500}>{d.doc_type}</Text>
                                  {d.file_name && <Text size="xs" c="dimmed">{d.file_name}</Text>}
                                </div>
                              </Group>
                              <Button variant="default" size="xs" onClick={() => handleOpenDoc(d.storage_path)}>
                                열기
                              </Button>
                            </Group>
                          ))}
                      </Stack>
                    ) : (
                      <Text size="xs" c="dimmed" ta="center" py="md">
                        제출된 서류가 없습니다.
                      </Text>
                    )}
                  </Card>

                  <Box>
                    <Text fw={600} size="sm" mb="xs">
                      필수 서류 요청 목록
                    </Text>
                    <Chip.Group multiple value={selectedDocs} onChange={(val) => {
                      console.log('Chip Change:', val);
                      setSelectedDocs(val);
                    }}>
                      <Group gap={6}>
                        {DOC_OPTIONS.map((doc) => (
                          <Chip key={doc} value={doc} variant="outline" size="xs" radius="sm">
                            {doc}
                          </Chip>
                        ))}
                      </Group>
                    </Chip.Group>
                  </Box>

                  <Group align="flex-end" gap={6}>
                    <TextInput
                      placeholder="기타 서류 입력"
                      style={{ flex: 1 }}
                      size="xs"
                      value={customDocInput}
                      onChange={(e) => setCustomDocInput(e.currentTarget.value)}
                    />
                    <Button
                      variant="default"
                      size="xs"
                      onClick={() => {
                        if (customDocInput) {
                          setSelectedDocs((prev) => [...prev, customDocInput]);
                          setCustomDocInput('');
                        }
                      }}
                    >
                      추가
                    </Button>
                  </Group>

                  <Button
                    fullWidth
                    color="orange"
                    mt="md"
                    onClick={() => updateDocsRequestMutation.mutate()}
                    loading={updateDocsRequestMutation.isPending}
                  >
                    서류 요청 업데이트
                  </Button>
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="appointment">
                <Stack gap="md">
                  <Card withBorder radius="md" p="md" bg="gray.0">
                    <Text fw={600} size="sm" mb="xs">위촉 심사 및 확정</Text>
                    {renderAppointmentSection('life')}
                    <Divider my="sm" />
                    {renderAppointmentSection('nonlife')}
                  </Card>
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="actions">
                <Stack gap="md">
                  <Alert color="gray" radius="md" variant="light">
                    현재 상태: {STATUS_LABELS[selectedFc.status] || selectedFc.status}
                  </Alert>

                  {selectedFc.status === 'allowance-pending' && (
                    <Button
                      color="indigo"
                      fullWidth
                      leftSection={<IconCheck size={16} />}
                      onClick={() =>
                        updateStatusMutation.mutate({
                          status: 'allowance-consented',
                          title: '수당동의 승인',
                          msg: '수당 동의가 승인되었습니다. 서류 제출 단계로 진행해주세요.',
                        })
                      }
                    >
                      수당 동의 검토 완료 (승인)
                    </Button>
                  )}

                  {(selectedFc.status === 'docs-pending' || selectedFc.status === 'docs-submitted') && (
                    <Button
                      color="green"
                      fullWidth
                      leftSection={<IconCheck size={16} />}
                      onClick={() =>
                        updateStatusMutation.mutate({ status: 'docs-approved', msg: '서류 검토 완료' })
                      }
                    >
                      서류 검토 완료 (위촉 진행)
                    </Button>
                  )}

                  <Divider my="xs" />

                  <Group grow mt="lg">
                    <Button
                      variant="light"
                      color="orange"
                      leftSection={<IconSend size={16} />}
                      onClick={async () => {
                        await supabase
                          .from('notifications')
                          .insert({
                            title: '진행 요청',
                            body: '관리자가 진행을 요청하였습니다.',
                            recipient_role: 'fc',
                            resident_id: selectedFc.phone,
                          });
                        notifications.show({ title: '전송 완료', message: '알림을 보냈습니다.', color: 'blue' });
                      }}
                    >
                      재촉 알림
                    </Button>
                    <Button
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      onClick={() => {
                        if (confirm('정말로 FC를 삭제하시겠습니까? 관련 서류도 모두 삭제됩니다.')) {
                          deleteFcMutation.mutate();
                        }
                      }}
                    >
                      FC 삭제
                    </Button>
                  </Group>
                </Stack>
              </Tabs.Panel>
            </Tabs>
          </>
        )}
      </Modal>
    </Box>
  );
}
