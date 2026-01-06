'use client';

import {
  ActionIcon,
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
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCalendar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
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

import { StatusToggle } from '@/components/StatusToggle';
import {
  ADMIN_STEP_LABELS,
  calcStep,
  DOC_OPTIONS,
  getAdminStep,
  getAppointmentProgress,
  getDocProgress,
  getSummaryStatus
} from '@/lib/shared';
import { supabase } from '@/lib/supabase';
import { notifications } from '@mantine/notifications';
import { useRouter } from 'next/navigation';
import { sendPushNotification } from '../actions';
import { updateAppointmentAction } from './appointment/actions';
import { updateDocStatusAction } from './docs/actions';

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
  const [careerInput, setCareerInput] = useState<'신입' | '경력' | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [customDocInput, setCustomDocInput] = useState('');
  const [docsDeadlineInput, setDocsDeadlineInput] = useState<Date | null>(null);
  const handleDocsDeadlineChange = (value: string | null) => {
    if (!value) {
      setDocsDeadlineInput(null);
      return;
    }
    const nextValue = new Date(value);
    setDocsDeadlineInput(Number.isNaN(nextValue.getTime()) ? null : nextValue);
  };

  // 위촉 일정 및 승인 상태
  const [appointmentInputs, setAppointmentInputs] = useState<{
    life?: string;
    nonlife?: string;
    lifeDate?: Date | null;
    nonLifeDate?: Date | null;
  }>({});
  const [isAppointmentPending, startAppointmentTransition] = useTransition();
  const [rejectOpened, { open: openReject, close: closeReject }] = useDisclosure(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<
    | { kind: 'allowance' }
    | { kind: 'appointment'; category: 'life' | 'nonlife' }
    | { kind: 'doc'; doc: any }
    | null
  >(null);
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  const updateSelectedFc = (updates: Partial<any>) => {
    setSelectedFc((prev: any) => (prev ? { ...prev, ...updates } : prev));
  };

  const openRejectModal = (target: { kind: 'allowance' } | { kind: 'appointment'; category: 'life' | 'nonlife' } | { kind: 'doc'; doc: any }) => {
    setRejectReason('');
    setRejectTarget(target);
    openReject();
  };

  const handleRejectSubmit = async () => {
    if (!selectedFc || !rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      notifications.show({ title: '사유 입력', message: '반려 사유를 입력해주세요.', color: 'red' });
      return;
    }
    setRejectSubmitting(true);
    try {
      if (rejectTarget.kind === 'allowance') {
        const { error } = await supabase
          .from('fc_profiles')
          .update({
            status: 'allowance-pending',
            allowance_date: null,
            allowance_reject_reason: reason,
          })
          .eq('id', selectedFc.id);
        if (error) throw error;
        await supabase.from('notifications').insert({
          title: '수당동의 반려',
          body: `수당 동의가 반려되었습니다.\n사유: ${reason}`,
          recipient_role: 'fc',
          resident_id: selectedFc.phone,
        });
        await sendPushNotification(selectedFc.phone, {
          title: '수당동의 반려',
          body: `수당 동의가 반려되었습니다.\n사유: ${reason}`,
          data: { url: '/consent' },
        });
        updateSelectedFc({ status: 'allowance-pending', allowance_date: null, allowance_reject_reason: reason });
        notifications.show({ title: '처리 완료', message: '수당 동의를 반려했습니다.', color: 'green' });
        queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      }

      if (rejectTarget.kind === 'appointment') {
        const { category } = rejectTarget;
        const result = await updateAppointmentAction(
          { success: false },
          {
            fcId: selectedFc.id,
            phone: selectedFc.phone,
            type: 'reject',
            category,
            value: null,
            reason,
          },
        );
        if (!result.success) throw new Error(result.error || '처리 실패');
        const isLife = category === 'life';
        const dateKey = isLife ? 'lifeDate' : 'nonLifeDate';
        setAppointmentInputs((prev) => ({ ...prev, [dateKey]: null }));
        updateSelectedFc({
          [isLife ? 'appointment_date_life' : 'appointment_date_nonlife']: null,
          [isLife ? 'appointment_date_life_sub' : 'appointment_date_nonlife_sub']: null,
          [isLife ? 'appointment_reject_reason_life' : 'appointment_reject_reason_nonlife']: reason,
          status: 'docs-approved',
        });
        notifications.show({ title: '처리 완료', message: '위촉 정보를 반려했습니다.', color: 'green' });
        queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      }

      if (rejectTarget.kind === 'doc') {
        const doc = rejectTarget.doc;
        const res = await updateDocStatusAction({ success: false }, {
          fcId: selectedFc.id,
          phone: selectedFc.phone,
          docType: doc.doc_type,
          status: 'rejected',
          reason,
        });
        if (!res.success) throw new Error(res.error || '문서 반려 실패');
        const nextDocs = (selectedFc.fc_documents || []).map((d: any) =>
          d.doc_type === doc.doc_type ? { ...d, status: 'rejected', reviewer_note: reason } : d,
        );
        let nextProfileStatus = selectedFc.status;
        if (!['appointment-completed', 'final-link-sent'].includes(selectedFc.status)) {
          nextProfileStatus = 'docs-pending';
        }
        updateSelectedFc({ fc_documents: nextDocs, status: nextProfileStatus });
        notifications.show({ title: '반려 완료', message: '서류가 반려되었습니다.', color: 'green' });
        queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      }

      closeReject();
    } catch (err: any) {
      notifications.show({ title: '오류', message: err?.message ?? '반려 처리 실패', color: 'red' });
    } finally {
      setRejectSubmitting(false);
    }
  };

  const { data: fcs, isLoading } = useQuery({
    queryKey: ['dashboard-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fc_profiles')
        .select('*, appointment_date_life_sub, appointment_date_nonlife_sub, fc_documents(doc_type,storage_path,file_name,status,reviewer_note)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      console.log('[DEBUG] Web: Fetched FC List:', JSON.stringify(data, null, 2));
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
      const adminStep = fc.identity_completed ? (rawStep <= 2 ? 1 : rawStep - 1) : 0;
      return { ...fc, step: rawStep, adminStep };
    });

    if (activeTab && activeTab !== 'all') {
      if (activeTab === 'step0') {
        result = result.filter((fc) => !fc.identity_completed);
      } else {
      const stepNum = Number(activeTab.replace('step', ''));
      result = result.filter((fc) => fc.adminStep === stepNum);
      }
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
        const title = '임시번호 발급';
        const body = `임시사번: ${payload.temp_id} 이 발급되었습니다.`;
        await supabase.from('notifications').insert({
          title,
          body,
          recipient_role: 'fc',
          resident_id: selectedFc.phone,
        });
        await sendPushNotification(selectedFc.phone, { title, body, data: { url: '/consent' } });
      }
    },
    onSuccess: () => {
      notifications.show({ title: '저장 완료', message: '기본 정보가 업데이트되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: any) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const updateDocsRequestMutation = useMutation({
    mutationFn: async ({ types, deadline }: { types: string[]; deadline?: Date | null }) => {
      if (!selectedFc) return;

      const nextTypes = types ?? [];
      console.log('Mutation Start');
      console.log('SelectedDocs (Intent):', nextTypes);
      const normalizedDeadline = deadline ? dayjs(deadline).format('YYYY-MM-DD') : null;
      const shouldResetNotify = normalizedDeadline !== (selectedFc.docs_deadline_at ?? null);

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

      if (nextTypes.length === 0) {
        await supabase.from('fc_documents').delete().eq('fc_id', selectedFc.id);
        await supabase
          .from('fc_profiles')
          .update({
            status: 'allowance-consented',
            docs_deadline_at: null,
            docs_deadline_last_notified_at: null,
          })
          .eq('id', selectedFc.id);
        return;
      }

      const toAdd = nextTypes.filter((type) => !currentTypes.includes(type));
      const toDelete = currentDocs
        .filter((d: any) => !nextTypes.includes(d.doc_type) && (!d.storage_path || d.storage_path === 'deleted'))
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
      const profileUpdate: Record<string, string | null> = {
        docs_deadline_at: normalizedDeadline,
      };
      if (shouldResetNotify) {
        profileUpdate.docs_deadline_last_notified_at = null;
      }

      await supabase
        .from('fc_profiles')
        .update({ status: 'docs-requested', ...profileUpdate })
        .eq('id', selectedFc.id);

      // Notification logic
      const title = '필수 서류 등록 알림';
      const body = '관리자가 필수 서류 목록을 갱신하였습니다. 확인 후 제출해주세요.';
      await supabase.from('notifications').insert({
        title,
        body,
        recipient_role: 'fc',
        resident_id: selectedFc.phone,
      });
      await sendPushNotification(selectedFc.phone, { title, body, data: { url: '/docs-upload' } });
    },
    onSuccess: () => {
      notifications.show({ title: '요청 완료', message: '서류 목록이 갱신되었습니다.', color: 'blue' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: any) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({
      status,
      title,
      msg,
      extra,
    }: {
      status: string;
      title?: string;
      msg: string;
      extra?: Record<string, any>;
    }) => {
      if (!selectedFc) return;
      await supabase.from('fc_profiles').update({ status, ...(extra ?? {}) }).eq('id', selectedFc.id);
      if (msg) {
        const finalTitle = title || '상태 업데이트';
        await supabase
          .from('notifications')
          .insert({
            title: finalTitle,
            body: msg,
            recipient_role: 'fc',
            resident_id: selectedFc.phone,
          });

        // Determine URL based on status
        let url = '/notifications'; // Default
        if (status === 'allowance-consented') url = '/docs-upload'; // Next step
        else if (status === 'docs-approved') url = '/appointment'; // Next step
        else if (status === 'temp-id-issued') url = '/consent'; // Logic (Next step)

        await sendPushNotification(selectedFc.phone, { title: finalTitle, body: msg, data: { url } });
      }
    },
    onSuccess: (_data, variables) => {
      if (variables?.status) {
        updateSelectedFc({ status: variables.status, ...(variables.extra ?? {}) });
      }
      notifications.show({ title: '처리 완료', message: '상태가 변경되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
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
      setCareerInput((fc.career_type as '신입' | '경력') || null);
      const currentDocs = fc.fc_documents?.map((d: any) => d.doc_type) || [];
      console.log('Opening Modal for:', fc.name);
      console.log('Init SelectedDocs:', currentDocs);
      setSelectedDocs(currentDocs);
      setDocsDeadlineInput(fc.docs_deadline_at ? new Date(fc.docs_deadline_at) : null);

    // 위촉 일정 초기화
    setAppointmentInputs({
      life: fc.appointment_schedule_life ?? '',
      nonlife: fc.appointment_schedule_nonlife ?? '',
      lifeDate: fc.appointment_date_life ? new Date(fc.appointment_date_life) : (fc.appointment_date_life_sub ? new Date(fc.appointment_date_life_sub) : null),
      nonLifeDate: fc.appointment_date_nonlife ? new Date(fc.appointment_date_nonlife) : (fc.appointment_date_nonlife_sub ? new Date(fc.appointment_date_nonlife_sub) : null),
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

  const handleDeleteDocFile = async (doc: any) => {
    if (!selectedFc) return;
    if (doc?.status === 'approved') {
      notifications.show({ title: '삭제 불가', message: '승인된 서류는 삭제할 수 없습니다.', color: 'yellow' });
      return;
    }
    if (!confirm(`'${doc?.doc_type}' 파일을 삭제할까요? 서류 상태가 초기화됩니다.`)) return;

    try {
      if (doc?.storage_path) {
        const { error: storageErr } = await supabase.storage.from('fc-documents').remove([doc.storage_path]);
        if (storageErr) throw storageErr;
      }
      const { error: dbError } = await supabase
        .from('fc_documents')
        .update({ storage_path: 'deleted', file_name: 'deleted.pdf', status: 'pending', reviewer_note: null })
        .eq('fc_id', selectedFc.id)
        .eq('doc_type', doc.doc_type);
      if (dbError) throw dbError;

      setSelectedFc((prev: any) =>
        prev
          ? {
            ...prev,
            fc_documents: prev.fc_documents?.map((d: any) =>
              d.doc_type === doc.doc_type
                ? { ...d, storage_path: 'deleted', status: 'pending', file_name: 'deleted.pdf' }
                : d,
            ),
          }
          : prev,
      );

      notifications.show({ title: '삭제 완료', message: '파일을 삭제했습니다.', color: 'gray' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    } catch (err: any) {
      notifications.show({
        title: '삭제 실패',
        message: err?.message ?? '파일 삭제 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  const handleAppointmentAction = (e: React.MouseEvent, type: 'schedule' | 'confirm', category: 'life' | 'nonlife') => {
    e.stopPropagation();
    const isLife = category === 'life';
    let value = null;
    let dateValue: Date | null = null;
    let scheduleValue: string | null = null;

    if (type === 'schedule') {
      const scheduleVal = isLife ? appointmentInputs.life : appointmentInputs.nonlife;
      // Fallback to DB if not in state? No, modal initializes state.
      if (!scheduleVal) {
        notifications.show({ title: '입력 필요', message: '예정월을 입력해주세요.', color: 'yellow' });
        return;
      }
      scheduleValue = String(scheduleVal);
      value = scheduleValue;
    } else if (type === 'confirm') {
      const dateVal = isLife ? appointmentInputs.lifeDate : appointmentInputs.nonLifeDate;
      // Admin simply confirms the existing date.
      if (!dateVal) {
        notifications.show({ title: '확인 불가', message: 'FC가 아직 확정일을 입력하지 않았습니다.', color: 'red' });
        return;
      }
      dateValue = dateVal;
      value = dayjs(dateVal).format('YYYY-MM-DD');
    }

    if (confirm(`${type === 'confirm' ? '승인' : '저장'} 하시겠습니까?`)) {
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
          if (type === 'schedule' && scheduleValue) {
            updateSelectedFc({
              [isLife ? 'appointment_schedule_life' : 'appointment_schedule_nonlife']: scheduleValue,
            });
          }
          if (type === 'confirm' && dateValue) {
            const dateKey = isLife ? 'lifeDate' : 'nonLifeDate';
            setAppointmentInputs((prev) => ({ ...prev, [dateKey]: dateValue }));
            updateSelectedFc({
              [isLife ? 'appointment_date_life' : 'appointment_date_nonlife']: value,
            });
            const nextLife = isLife ? value : selectedFc.appointment_date_life;
            const nextNonlife = !isLife ? value : selectedFc.appointment_date_nonlife;
            const nextStatus = nextLife && nextNonlife ? 'final-link-sent' : 'appointment-completed';
            updateSelectedFc({ status: nextStatus });
          }
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
    const submittedDate = isLife ? selectedFc.appointment_date_life_sub : selectedFc.appointment_date_nonlife_sub;
    const isSubmitted = !isConfirmed && !!submittedDate;

    return (
      <Stack gap="xs" mt="sm">
        <Text size="sm" fw={600} c="dimmed">{isLife ? '생명보험' : '손해보험'}</Text>
        <Group align="flex-end" grow>
          <TextInput
            label="예정(Plan)"
            placeholder="예: 12월 2차 / 1월 1차"
            value={schedule ?? ''}
            onChange={(e) => {
              const val = e.currentTarget?.value || '';
              setAppointmentInputs(prev => ({ ...prev, [isLife ? 'life' : 'nonlife']: val }));
            }}
          />
          {isLife && !!selectedFc.appointment_reject_reason_life && (
            <Badge variant="light" color="red" size="xs">
              생명 반려
            </Badge>
          )}
          {!isLife && !!selectedFc.appointment_reject_reason_nonlife && (
            <Badge variant="light" color="red" size="xs">
              손해 반려
            </Badge>
          )}
          <TextInput
            label={
              <Group gap={6}>
                <Text size="sm">확정일(Actual)</Text>
                {isConfirmed ? (
                  <Badge variant="light" color="green" size="xs">
                    승인 완료
                  </Badge>
                ) : isSubmitted ? (
                  <Badge variant="light" color="orange" size="xs">
                    FC 제출
                  </Badge>
                ) : (
                  <Badge variant="light" color="gray" size="xs">
                    미입력
                  </Badge>
                )}
              </Group>
            }
            value={date ? dayjs(date).format('YYYY-MM-DD') : '미실시'}
            readOnly
            disabled
            pointer
            variant="filled"
            styles={{
              input: {
                color: date ? '#111827' : 'gray',
                cursor: 'default',
                backgroundColor: isSubmitted ? '#fff4e6' : undefined,
                borderColor: isSubmitted ? '#ff922b' : undefined,
              },
            }}
          />
        </Group>
        {isSubmitted && (
          <Text size="xs" c="orange">
            제출일: {dayjs(submittedDate).format('YYYY-MM-DD')}
          </Text>
        )}
        <Group gap={8}>
          <Button
            variant="light" color="blue" size="xs" flex={1}
            leftSection={<IconDeviceFloppy size={14} />}
            loading={isAppointmentPending}
            onClick={(e) => handleAppointmentAction(e, 'schedule', category)}
          >
            일정 저장
          </Button>
          <StatusToggle
            value={isConfirmed ? 'approved' : 'pending'}
            onChange={(val) => {
              if (val === 'approved') {
                handleAppointmentAction({ stopPropagation: () => { } } as any, 'confirm', category);
              } else if (isConfirmed) {
                openRejectModal({ kind: 'appointment', category });
              }
            }}
            labelPending="미승인"
            labelApproved="승인 완료"
            showNeutralForPending
            readOnly={isAppointmentPending}
          />
          <Tooltip label="반려 (확정 취소)">
            <ActionIcon
              variant="light" color="red" size="input-xs"
              loading={isAppointmentPending}
              onClick={() => openRejectModal({ kind: 'appointment', category })}
            >
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Stack>
    );
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
            <Group gap={6} mt={4}>
              {fc.career_type ? (
                <Text size="xs" c="dimmed">{fc.career_type}</Text>
              ) : (
                <Badge color="gray" size="xs" variant="outline">조회중</Badge>
              )}
              <Badge
                color={fc.identity_completed ? 'green' : 'orange'}
                size="xs"
                variant="light"
              >
                {fc.identity_completed ? '본등록' : '사전등록'}
              </Badge>
            </Group>
          </div>
        </Group>
      </Table.Td>
      <Table.Td>{fc.phone}</Table.Td>
      <Table.Td>{fc.affiliation || '-'}</Table.Td>
      <Table.Td>
        {(fc.appointment_date_life || fc.appointment_date_nonlife) ? (
          <Stack gap={4}>
            {fc.appointment_date_life && (
              <Group gap={6}>
                <Badge variant="light" color="orange" size="xs">생명</Badge>
                <Text size="sm" fw={700} c="dark.8">
                  {dayjs(fc.appointment_date_life).format('YYYY-MM-DD')}
                </Text>
              </Group>
            )}
            {fc.appointment_date_nonlife && (
              <Group gap={6}>
                <Badge variant="light" color="blue" size="xs">손해</Badge>
                <Text size="sm" fw={700} c="dark.8">
                  {dayjs(fc.appointment_date_nonlife).format('YYYY-MM-DD')}
                </Text>
              </Group>
            )}
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">-</Text>
        )}
      </Table.Td>
      <Table.Td>
        <Stack gap={6}>
          {(() => {
            const summary = getSummaryStatus(fc);
            if (!summary.label || summary.label === '서류 제출 대기' || summary.label === '서류 반려') {
              return null;
            }
            return (
              <Badge color={summary.color} variant="light" size="md" radius="sm">
                {summary.label}
              </Badge>
            );
          })()}
          <Group gap={6} wrap="wrap">
            {fc.step >= 3 &&
              (() => {
                const doc = getDocProgress(fc);
                const docs = fc.fc_documents ?? [];
                const totalDocs = docs.length;
                const submittedDocs = docs.filter((d: any) => d.storage_path && d.storage_path !== 'deleted').length;
                const approvedDocs = docs.filter((d: any) => d.status === 'approved').length;
                const pendingDocs = docs.filter((d: any) => d.status !== 'approved' && d.status !== 'rejected').length;
                const rejectedDocs = docs.filter((d: any) => d.status === 'rejected').length;
                const isAllDocsApproved = doc.key === 'approved';
                return (
                  <>
                    {totalDocs > 0 && !isAllDocsApproved && (
                      <Group
                        gap={6}
                        style={{
                          border: '1px solid #E5E7EB',
                          borderRadius: 12,
                          padding: 8,
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                          rowGap: 6,
                          columnGap: 6,
                          backgroundColor: '#fff',
                        }}
                      >
                        <Badge color="orange" variant="light" size="md" radius="sm">
                          제출 {submittedDocs}/{totalDocs}
                        </Badge>
                        <Badge color="green" variant="light" size="md" radius="sm">
                          승인 {approvedDocs}/{totalDocs}
                        </Badge>
                        <Badge color="red" variant="light" size="md" radius="sm">
                          반려 {rejectedDocs}/{totalDocs}
                        </Badge>
                        <Badge color="yellow" variant="light" size="md" radius="sm">
                          검토 중 {pendingDocs}/{totalDocs}
                        </Badge>
                      </Group>
                    )}
                  </>
                );
              })()}
            {(fc.step >= 4 || getAppointmentProgress(fc, 'life').key === 'approved') &&
              (() => {
                const life = getAppointmentProgress(fc, 'life');
                if (life.key === 'not-set') return null;
                if (fc.step < 4 && life.key !== 'approved') return null;
                return (
                <Badge color={life.color} variant="light" size="md" radius="sm">
                  생명 {life.label}
                </Badge>
                );
              })()}
            {(fc.step >= 4 || getAppointmentProgress(fc, 'nonlife').key === 'approved') &&
              (() => {
                const nonlife = getAppointmentProgress(fc, 'nonlife');
                if (nonlife.key === 'not-set') return null;
                if (fc.step < 4 && nonlife.key !== 'approved') return null;
                return (
                <Badge color={nonlife.color} variant="light" size="md" radius="sm">
                  손해 {nonlife.label}
                </Badge>
              );
            })()}
          </Group>
        </Stack>
      </Table.Td>
      <Table.Td>
        {/* Updated Badge to use getAdminStep */}
        <Badge
          variant="dot"
          size="md"
          color={fc.step === 5 ? 'green' : 'orange'}
          radius="xl"
          style={{ paddingTop: 6, paddingBottom: 6, height: 'auto', alignItems: 'center' }}
        >
          <Text
            size="xs"
            fw={700}
            style={{ whiteSpace: 'pre-line', lineHeight: 1.25, textAlign: 'center' }}
          >
            {getAdminStep(fc).replace(' ', '\n')}
          </Text>
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
              <Text c="dimmed" tt="uppercase" fw={700} size="xs" style={{ letterSpacing: '0.5px' }}>총 인원</Text>
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
              <Text c="dimmed" tt="uppercase" fw={700} size="xs" style={{ letterSpacing: '0.5px' }}>수당동의 대기</Text>
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
              <Text c="dimmed" tt="uppercase" fw={700} size="xs" style={{ letterSpacing: '0.5px' }}>서류검토 대기</Text>
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
              onChange={(e) => {
                const val = e.currentTarget?.value || '';
                setKeyword(val);
              }}
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
                    <Table.Th w={120}>FC 정보</Table.Th>
                    <Table.Th w={100}>연락처</Table.Th>
                    <Table.Th w={140}>소속</Table.Th>
                    <Table.Th w={150}>위촉 완료일</Table.Th>
                    <Table.Th w={200}>현재 상태</Table.Th>
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
                  <Badge variant="light" color={!selectedFc.career_type ? 'gray' : 'blue'}>
                    {selectedFc.career_type || '조회중'}
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
                  수당 동의
                </Tabs.Tab>
                <Tabs.Tab value="docs" leftSection={<IconFileText size={16} />}>
                  서류 관리
                </Tabs.Tab>
                <Tabs.Tab value="appointment" leftSection={<IconCalendar size={16} />}>
                  위촉 관리
                </Tabs.Tab>

              </Tabs.List>

              <Tabs.Panel value="info">
                <Stack gap="md">
                  <TextInput
                    label="임시사번"
                    placeholder="T-123456"
                    value={tempIdInput}
                    onChange={(e) => {
                      const val = e.currentTarget?.value || '';
                      setTempIdInput(val);
                    }}
                  />
                  <Box>
                    <Text size="sm" fw={500} mb={6}>
                      경력 구분 {careerInput === null && <Text span c="red" size="xs">(선택 필요)</Text>}
                    </Text>
                    <Chip.Group value={careerInput || ''} onChange={(v) => setCareerInput(v as '신입' | '경력' | null)}>
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
                  <Box mt="md">
                    <Group justify="space-between" mb="xs">
                      <Text fw={600} size="sm">수당 동의 검토</Text>
                      <Badge
                        variant="light"
                        color={selectedFc.allowance_date ? 'green' : 'gray'}
                        size="sm"
                      >
                        {selectedFc.allowance_date ? '입력됨' : '미입력'}
                      </Badge>
                    </Group>
                    <TextInput
                      label="동의일(Actual)"
                      value={
                        selectedFc.allowance_date
                          ? dayjs(selectedFc.allowance_date).format('YYYY-MM-DD')
                          : '미실시'
                      }
                      readOnly
                      disabled
                      variant="filled"
                      radius="md"
                      size="md"
                      styles={{
                        label: { fontWeight: 600, color: '#111827' },
                        input: {
                          backgroundColor: '#F9FAFB',
                          color: '#111827',
                          borderColor: '#E5E7EB',
                          fontWeight: 600,
                        },
                      }}
                    />
                    <Divider my="sm" />
                    <Text size="xs" fw={600} c="dimmed" mb={6}>
                      수당 동의 상태
                    </Text>
                    <StatusToggle
                      value={selectedFc.status === 'allowance-consented' || ['docs-pending', 'docs-submitted', 'docs-approved', 'appointment-completed', 'final-link-sent'].includes(selectedFc.status) ? 'approved' : 'pending'}
                      onChange={(val) => {
                        if (val === 'approved') {
                          updateStatusMutation.mutate({
                            status: 'allowance-consented',
                            title: '수당동의 승인',
                            msg: '수당 동의가 승인되었습니다. 서류 제출 단계로 진행해주세요.',
                            extra: { allowance_reject_reason: null },
                          });
                          return;
                        }
                        openRejectModal({ kind: 'allowance' });
                      }}
                      labelPending="미승인"
                      labelApproved="승인 완료"
                      showNeutralForPending
                      allowPendingPress
                      readOnly={false}
                    />
                  </Box>

                  <Button fullWidth mt="md" onClick={() => updateInfoMutation.mutate()} loading={updateInfoMutation.isPending} color="dark">
                    변경사항 저장
                  </Button>

                  <Divider my="sm" />

                  <Group grow>
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
                                <ThemeIcon
                                  size="lg"
                                  color={d.status === 'approved' ? 'green' : d.status === 'rejected' ? 'red' : 'blue'}
                                  variant="light"
                                  radius="md"
                                >
                                  {d.status === 'approved' ? <IconCheck size={20} /> : d.status === 'rejected' ? <IconX size={20} /> : <IconFileText size={20} />}
                                </ThemeIcon>
                                <div>
                                  <Text size="sm" fw={500} td={d.status === 'rejected' ? 'line-through' : undefined} c={d.status === 'rejected' ? 'dimmed' : undefined}>
                                    {d.doc_type}
                                  </Text>
                                  {d.file_name && <Text size="xs" c="dimmed">{d.file_name}</Text>}
                                  <Badge size="xs" variant={d.status === 'pending' ? 'outline' : 'light'} color={d.status === 'approved' ? 'green' : d.status === 'rejected' ? 'red' : 'gray'}>
                                    {d.status === 'approved' ? '승인됨' : d.status === 'rejected' ? '반려됨' : '심사 대기'}
                                  </Badge>
                                </div>
                              </Group>
                              <Group gap={4}>
                                <Button variant="default" size="xs" onClick={() => handleOpenDoc(d.storage_path)}>
                                  열기
                                </Button>
                                <Divider orientation="vertical" />
                                <Group gap={4}>
                                  <StatusToggle
                                    value={d.status === 'approved' ? 'approved' : 'pending'}
                                    onChange={async (val) => {
                                      const nextStatus = val === 'approved' ? 'approved' : 'rejected';
                                      if (val !== 'approved') {
                                        if (d.status === 'rejected') return;
                                        openRejectModal({ kind: 'doc', doc: d });
                                        return;
                                      }
                                      if (nextStatus === d.status) return;
                                      if (nextStatus === 'approved') {
                                        if (!confirm('문서를 승인하시겠습니까?')) return;
                                      }
                                      const res = await updateDocStatusAction({ success: false }, {
                                        fcId: selectedFc.id,
                                        phone: selectedFc.phone,
                                        docType: d.doc_type,
                                        status: nextStatus,
                                        reason: null,
                                      });
                                      if (res.success) {
                                        notifications.show({ title: nextStatus === 'approved' ? '승인' : '취소', message: res.message, color: 'green' });
                                        const nextDocs = (selectedFc.fc_documents || []).map((doc: any) =>
                                          doc.doc_type === d.doc_type ? { ...doc, status: nextStatus, reviewer_note: null } : doc
                                        );
                                        const allSubmitted =
                                          nextDocs.length > 0 &&
                                          nextDocs.every(
                                            (doc: any) => doc.storage_path && doc.storage_path !== 'deleted',
                                          );
                                        const allApproved =
                                          allSubmitted && nextDocs.every((doc: any) => doc.status === 'approved');
                                        let nextProfileStatus = selectedFc.status;
                                        if (!['appointment-completed', 'final-link-sent'].includes(selectedFc.status)) {
                                          if (allApproved) {
                                            nextProfileStatus = 'docs-approved';
                                          } else if (selectedFc.status === 'docs-approved') {
                                            nextProfileStatus = 'docs-pending';
                                          }
                                        }
                                        updateSelectedFc({ fc_documents: nextDocs, status: nextProfileStatus });
                                        queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
                                      } else {
                                        notifications.show({ title: '오류', message: res.error, color: 'red' });
                                      }
                                    }}
                                    labelPending="미승인"
                                    labelApproved="승인"
                                    showNeutralForPending
                                    allowPendingPress
                                    readOnly={false}
                                  />
                                  <Tooltip label="삭제">
                                    <ActionIcon
                                      variant="light"
                                      color="red"
                                      size="input-xs"
                                      onClick={() => handleDeleteDocFile(d)}
                                    >
                                      <IconTrash size={16} />
                                    </ActionIcon>
                                  </Tooltip>
                                </Group>
                              </Group>
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
                      <Box mb="md">
                        <Text size="xs" c="dimmed" fw={500} mb={6}>
                          서류 마감일 (알림용)
                        </Text>
                          <DateInput
                            value={docsDeadlineInput}
                            onChange={handleDocsDeadlineChange}
                            placeholder="YYYY-MM-DD"
                            valueFormat="YYYY-MM-DD"
                            clearable
                            size="sm"
                            leftSection={<IconCalendar size={16} />}
                            previousIcon={<IconChevronLeft size={16} />}
                            nextIcon={<IconChevronRight size={16} />}
                            popoverProps={{ withinPortal: true, shadow: 'md', position: 'bottom-start' }}
                            styles={{
                              calendarHeaderControl: { width: 32, height: 32 },
                              calendarHeaderControlIcon: { width: 14, height: 14 },
                              calendarHeaderLevel: { fontSize: 14, fontWeight: 700 },
                              calendarHeader: { gap: 6 },
                              weekday: {
                                fontSize: 12,
                                fontWeight: 700,
                                textAlign: 'center',
                                width: 36,
                              },
                              day: {
                                width: 36,
                                height: 36,
                                fontSize: 13,
                                fontWeight: 600,
                                textAlign: 'center',
                              },
                              monthCell: { padding: 4 },
                            }}
                          />
                      </Box>
                      {(() => {
                      const submittedDocTypes = new Set(
                        (selectedFc.fc_documents ?? [])
                          .filter((d: any) => d.storage_path && d.storage_path !== 'deleted')
                          .map((d: any) => d.doc_type),
                      );
                      return (
                    <Chip.Group multiple value={selectedDocs} onChange={(val) => {
                      console.log('Chip Change:', val);
                      setSelectedDocs(val);
                    }}>
                      <Group gap={6}>
                        {Array.from(new Set([...DOC_OPTIONS, ...selectedDocs])).map((doc) => {
                          const isRequested = selectedDocs.includes(doc);
                          const isSubmitted = submittedDocTypes.has(doc);
                          const borderColor = isSubmitted ? '#2563eb' : isRequested ? '#f97316' : '#e5e7eb';
                          const textColor = isSubmitted ? '#2563eb' : isRequested ? '#f97316' : '#9CA3AF';
                          return (
                            <Chip
                              key={doc}
                              value={doc}
                              variant="outline"
                              size="xs"
                              radius="sm"
                              color={isSubmitted ? 'blue' : isRequested ? 'orange' : 'gray'}
                              styles={{
                                label: { borderColor, color: textColor },
                              }}
                            >
                              {doc}
                            </Chip>
                          );
                        })}
                      </Group>
                    </Chip.Group>
                      );
                    })()}
                  </Box>

                  <Group align="flex-end" gap={6}>
                    <TextInput
                      placeholder="기타 서류 입력"
                      style={{ flex: 1 }}
                      size="xs"
                      value={customDocInput}
                      onChange={(e) => {
                        const val = e.currentTarget?.value || '';
                        setCustomDocInput(val);
                      }}
                    />
                    <Button
                      variant="default"
                      size="xs"
                      onClick={() => {
                        if (customDocInput.trim()) {
                          const val = customDocInput.trim();
                          if (!selectedDocs.includes(val)) {
                            const nextDocs = [...selectedDocs, val];
                            setSelectedDocs(nextDocs);
                              updateDocsRequestMutation.mutate({ types: nextDocs, deadline: docsDeadlineInput });
                          }
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
                    onClick={() => updateDocsRequestMutation.mutate({ types: selectedDocs, deadline: docsDeadlineInput })}
                    loading={updateDocsRequestMutation.isPending}
                  >
                    서류 요청 업데이트
                  </Button>

                  <Divider my="md" />

                  <Text fw={600} size="sm" mb="xs">서류 심사 완료</Text>
                  <StatusToggle
                    value={['docs-approved', 'appointment-completed', 'final-link-sent'].includes(selectedFc.status) ? 'approved' : 'pending'}
                    onChange={(val) => {
                      if (val === 'approved') {
                        updateStatusMutation.mutate({ status: 'docs-approved', msg: '서류 검토 완료' });
                        return;
                      }
                      if (!confirm('심사 완료 상태를 취소하시겠습니까?')) return;
                      updateStatusMutation.mutate({ status: 'docs-pending', msg: '' });
                    }}
                    labelPending="심사 대기"
                    labelApproved="심사 완료"
                    showNeutralForPending
                    readOnly={['appointment-completed', 'final-link-sent'].includes(selectedFc.status)}
                  />
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


            </Tabs>
          </>
        )}
      </Modal>
      <Modal
        opened={rejectOpened}
        onClose={closeReject}
        title={
          <Text fw={700}>
            {rejectTarget?.kind === 'allowance'
              ? '수당동의 반려 사유'
              : rejectTarget?.kind === 'appointment'
                ? '위촉 반려 사유'
                : '서류 반려 사유'}
          </Text>
        }
        size="md"
        padding="lg"
        radius="md"
        centered
        overlayProps={{ blur: 2 }}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            FC에게 전달될 반려 사유를 입력해주세요. 입력된 사유는 알림과 화면에 표시됩니다.
          </Text>
          <Textarea
            placeholder="예: 서류 식별이 어려워 재제출이 필요합니다."
            minRows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeReject} disabled={rejectSubmitting}>
              취소
            </Button>
            <Button color="red" onClick={handleRejectSubmit} loading={rejectSubmitting}>
              반려 처리
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box >
  );
}
