import { MobileStatusToggle } from '@/components/MobileStatusToggle';
import { RefreshButton } from '@/components/RefreshButton';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { FcProfile } from '@/types/fc';

const ALLOW_LAYOUT_ANIM = Platform.OS !== 'android';

// Debug: disable Android LayoutAnimation to avoid native addViewAt crashes on logout
if (Platform.OS === 'android') {
  console.log('[dashboard] LayoutAnimation disabled on Android to prevent addViewAt crash');
} else if (UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BUCKET = 'fc-documents';
const ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';

const STATUS_LABELS: Record<FcProfile['status'], string> = {
  draft: '임시사번 미발급',
  'temp-id-issued': '임시번호 발급 완료',
  'allowance-pending': '수당동의 검토 중',
  'allowance-consented': '수당동의 완료',
  'docs-requested': '서류 요청',
  'docs-pending': '서류 대기',
  'docs-submitted': '서류 제출됨',
  'docs-rejected': '반려',
  'docs-approved': '위촉 URL 진행',
  'appointment-completed': '위촉 완료',
  'final-link-sent': '최종 완료',
};

const STEP_KEYS = ['step1', 'step2', 'step3', 'step4', 'step5'] as const;
type StepKey = (typeof STEP_KEYS)[number];
const STEP_LABELS: Record<StepKey, string> = {
  step1: '1단계 인적사항',
  step2: '2단계 수당동의',
  step3: '3단계 문서제출',
  step4: '4단계 위촉 진행',
  step5: '5단계 완료',
};

const ADMIN_STEP_LABELS: Record<string, string> = {
  step2: '1단계 수당동의',
  step3: '2단계 문서제출',
  step4: '3단계 위촉 진행',
  step5: '4단계 완료',
};

type FilterOption = { key: FilterKey; label: string; predicate: (fc: FcRowWithStep) => boolean };

const createFilterOptions = (role: string | null): FilterOption[] => {
  if (role === 'admin') {
    const adminKeys = ['step2', 'step3', 'step4', 'step5'] as const;
    return [
      { key: 'all', label: '전체', predicate: (_: FcRowWithStep) => true },
      ...adminKeys.map((key) => ({
        key,
        label: ADMIN_STEP_LABELS[key],
        predicate: (fc: FcRowWithStep) => fc.stepKey === key,
      })),
    ];
  }
  return [
    { key: 'all', label: '전체', predicate: (_: FcRowWithStep) => true },
    ...STEP_KEYS.map((key) => ({
      key,
      label: STEP_LABELS[key],
      predicate: (fc: FcRowWithStep) => fc.stepKey === key,
    })),
  ];
};

type FilterKey = 'all' | StepKey;

const calcStep = (profile: FcRow) => {
  const hasBasicInfo =
    Boolean(profile.name && profile.affiliation && profile.resident_id_masked) &&
    Boolean(profile.email || profile.address);
  if (!hasBasicInfo) return 1;

  // [1단계 우선] 수당 동의 완료 여부
  const allowancePassedStatuses: FcProfile['status'][] = [
    'allowance-consented',
    'docs-requested',
    'docs-pending',
    'docs-submitted',
    'docs-rejected',
    'docs-approved',
    'appointment-completed',
    'final-link-sent',
  ];
  if (!allowancePassedStatuses.includes(profile.status)) {
    return 2; // 수당동의 단계
  }

  // [2단계 우선] 서류 승인 여부
  const docs = profile.fc_documents ?? [];
  const validDocs = docs.filter((d) => d.storage_path && d.storage_path !== 'deleted');
  const hasPendingDocs = validDocs.length === 0 || validDocs.some((d: any) => d.status !== 'approved');
  if (hasPendingDocs) {
    return 3; // 서류 단계
  }

  // [3단계 우선] 위촉 최종 완료 여부
  if (profile.status !== 'final-link-sent') {
    return 4; // 위촉 진행 단계 (총무 승인 필요)
  }

  // 완료
  return 5;
};

const getStepKey = (profile: FcRow): StepKey => {
  const step = Math.max(1, Math.min(5, calcStep(profile)));
  return `step${step}` as StepKey;
};

const docOptions: string[] = [
  '생명보험 합격증',
  '제3보험 합격증',
  '손해보험 합격증',
  '생명보험 수료증(신입)',
  '제3보험 수료증(신입)',
  '손해보험 수료증(신입)',
  '생명보험 수료증(경력)',
  '제3보험 수료증(경력)',
  '손해보험 수료증(경력)',
  '이클린',
  '경력증명서',
];
const ALL_DOC_OPTIONS: string[] = Array.from(
  new Set<string>([
    ...docOptions,
  ]),
);

type FcRow = {
  id: string;
  name: string;
  affiliation: string;
  phone: string;
  temp_id: string | null;
  status: FcProfile['status'];
  allowance_date: string | null;
  appointment_url: string | null;
  appointment_date: string | null;
  resident_id_masked: string | null;
  career_type: string | null;
  email: string | null;
  address: string | null;
  address_detail: string | null;
  appointment_schedule_life: string | null;
  appointment_schedule_nonlife: string | null;
  appointment_date_life: string | null;
  appointment_date_nonlife: string | null;
  appointment_date_life_sub?: string | null;
  appointment_date_nonlife_sub?: string | null;
  fc_documents?: { doc_type: string; storage_path: string | null; file_name: string | null; status: string | null }[];
};
type FcRowWithStep = FcRow & { stepKey: StepKey };

async function sendNotificationAndPush(
  role: 'admin' | 'fc',
  residentId: string | null,
  title: string,
  body: string,
  url?: string,
) {
  await supabase.from('notifications').insert({
    title,
    body,
    category: 'app_event',
    recipient_role: role,
    resident_id: residentId,
  });

  const baseQuery = supabase.from('device_tokens').select('expo_push_token');
  const { data: tokens } =
    role === 'fc' && residentId
      ? await baseQuery.eq('role', 'fc').eq('resident_id', residentId)
      : await baseQuery.eq('role', 'admin');

  const payload =
    tokens?.map((t: any) => ({
      to: t.expo_push_token,
      title,
      body,
      data: { type: 'app_event', resident_id: residentId, url },
    })) ?? [];

  if (payload.length) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

const fetchFcs = async (
  role: 'admin' | 'fc' | null,
  residentId: string,
  keyword: string,
) => {
  let query = supabase
    .from('fc_profiles')
    .select(
      'id,name,affiliation,phone,temp_id,status,allowance_date,appointment_url,appointment_date,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,resident_id_masked,career_type,email,address,address_detail,fc_documents(doc_type,storage_path,file_name,status)',
    )
    .order('created_at', { ascending: false });

  if (role === 'fc' && residentId) {
    query = query.eq('phone', residentId);
  }
  if (keyword) {
    query = query.or(
      `name.ilike.%${keyword}%,affiliation.ilike.%${keyword}%,phone.ilike.%${keyword}%,temp_id.ilike.%${keyword}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as FcRow[];
};

export default function DashboardScreen() {
  const { role, residentId, logout, hydrated } = useSession();
  const router = useRouter();
  const { mode, status } = useLocalSearchParams<{ mode?: string; status?: string }>();
  const [statusFilter, setStatusFilter] = useState<FilterKey>('all');
  const [subFilter, setSubFilter] = useState<'all' | 'no-id' | 'has-id' | 'not-requested' | 'requested'>('all');
  const [keyword, setKeyword] = useState('');
  const [tempInputs, setTempInputs] = useState<Record<string, string>>({});
  const [careerInputs, setCareerInputs] = useState<Record<string, '신입' | '경력'>>({});
  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const [docSelections, setDocSelections] = useState<Record<string, Set<string>>>({});
  const [customDocInputs, setCustomDocInputs] = useState<Record<string, string>>({});
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, { life?: string; nonlife?: string }>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const keyboardPadding = useKeyboardPadding();
  const filterOptions = useMemo(() => createFilterOptions(role), [role]);

  const [reminderLoading, setReminderLoading] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', role, residentId, keyword],
    queryFn: () => fetchFcs(role, residentId, keyword),
    enabled: !!role,
  });

  // Realtime: FC 프로필 / 서류 변경 시 대시보드 갱신
  useEffect(() => {
    const profileChannel = supabase
      .channel('dashboard-profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fc_profiles' }, () => refetch())
      .subscribe();
    const docChannel = supabase
      .channel('dashboard-documents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fc_documents' }, () => refetch())
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
      supabase.removeChannel(docChannel);
    };
  }, [refetch]);

  useEffect(() => {
    if (!status) return;
    const found = filterOptions.find((option) => option.key === status);
    if (found) {
      setStatusFilter(found.key);
    }
    const handleLogout = () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      logout();
    };
  }, [status]);

  useEffect(() => {
    setSubFilter('all');
  }, [statusFilter]);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, Set<string>> = {};
    const tempPrefill: Record<string, string> = {};
    const careerPrefill: Record<string, '신입' | '경력'> = {};
    const schedulePrefill: Record<string, { life?: string; nonlife?: string }> = {};
    data.forEach((fc) => {
      const docs = fc.fc_documents?.map((d) => d.doc_type) ?? [];
      next[fc.id] = new Set(docs);
      if (fc.temp_id) tempPrefill[fc.id] = fc.temp_id;
      if (fc.career_type === '경력' || fc.career_type === '신입') careerPrefill[fc.id] = fc.career_type as any;
      schedulePrefill[fc.id] = {
        life: fc.appointment_schedule_life ?? '',
        nonlife: fc.appointment_schedule_nonlife ?? '',
      };
    });
    setDocSelections(next);
    setTempInputs((prev) => ({ ...tempPrefill, ...prev }));
    setCareerInputs((prev) => ({ ...careerPrefill, ...prev }));
    setScheduleInputs((prev) => ({ ...schedulePrefill, ...prev }));
  }, [data]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const updateTemp = useMutation({
    mutationFn: async ({
      id,
      tempId,
      prevTemp,
      career,
      phone,
    }: { id: string; tempId?: string; prevTemp?: string; career?: '신입' | '경력'; phone?: string }) => {
      const payload: any = {};
      if (career) payload.career_type = career;
      const tempIdTrim = tempId?.trim();
      const prevTrim = prevTemp?.trim();
      if (tempIdTrim) {
        // 같은 값이면 굳이 업데이트하지 않음 (중복/에러 방지)
        if (tempIdTrim !== prevTrim) {
          payload.temp_id = tempIdTrim;
          payload.status = 'temp-id-issued';
        }
      }
      const { error } = await supabase.from('fc_profiles').update(payload).eq('id', id);
      if (error) {
        if ((error as any).code === '23505') {
          throw new Error('이미 사용 중인 임시사번입니다. 다른 번호를 입력하세요.');
        }
        throw error;
      }
      // 알림: 해당 FC에게 임시번호 발급/수정 안내
      if (phone && tempIdTrim && tempIdTrim !== prevTrim) {
        await sendNotificationAndPush('fc', phone, '임시번호가 발급 되었습니다.', `임시사번: ${tempIdTrim}`, '/consent');
      }
    },
    onSuccess: () => {
      Alert.alert('저장 완료', '임시번호/경력 정보가 저장되었습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('저장 실패', err.message ?? '저장 중 문제가 발생했습니다.'),
  });

  const updateDocs = useMutation({
    mutationFn: async ({ id, types, phone }: { id: string; types: string[]; phone?: string }) => {
      const uniqueTypes = Array.from(new Set(types));

      const { data: existingDocs, error: fetchErr } = await supabase
        .from('fc_documents')
        .select('doc_type,storage_path,file_name,status')
        .eq('fc_id', id);
      if (fetchErr) throw fetchErr;

      const existing = existingDocs ?? [];
      const existingTypes = existing.map((d) => d.doc_type);
      const toInsert = uniqueTypes.filter((t) => !existingTypes.includes(t));
      const toDelete = existingTypes.filter((t) => !uniqueTypes.includes(t));

      if (toDelete.length) {
        const { error: delErr } = await supabase
          .from('fc_documents')
          .delete()
          .eq('fc_id', id)
          .in('doc_type', toDelete);
        if (delErr) throw delErr;
      }

      if (toInsert.length) {
        const rows = toInsert.map((t) => ({
          fc_id: id,
          doc_type: t,
          status: 'pending',
          file_name: '',
          storage_path: '',
        }));
        const { error: insertErr } = await supabase.from('fc_documents').insert(rows);
        if (insertErr) throw insertErr;
      }

      await supabase.from('fc_profiles').update({ status: 'docs-requested' }).eq('id', id);
      if (phone) {
        await sendNotificationAndPush(
          'fc',
          phone,
          '서류 요청 안내',
          '필수 서류 요청이 등록되었습니다. 앱에서 확인해 주세요.',
          '/docs-upload',
        );
      }
    },
    onSuccess: () => {
      Alert.alert('요청 완료', '필수 서류 요청을 저장했습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('요청 실패', err.message ?? '요청 처리 중 문제가 발생했습니다.'),
  });

  const updateDocReqs = useMutation({
    mutationFn: async ({ id, types, phone }: { id: string; types: string[]; phone?: string }) => {
      const uniqueTypes = Array.from(new Set(types));

      const { data: currentDocs, error: fetchErr } = await supabase
        .from('fc_documents')
        .select('doc_type,storage_path')
        .eq('fc_id', id);
      if (fetchErr) throw fetchErr;

      const currentTypes = currentDocs?.map((d) => d.doc_type) ?? [];
      const selectedSet = new Set(uniqueTypes);

      const toDelete =
        currentDocs?.filter(
          (d) => !selectedSet.has(d.doc_type) && (!d.storage_path || d.storage_path === 'deleted'),
        ) ?? [];
      const toAdd = uniqueTypes.filter((t) => !currentTypes.includes(t));
      const hasChanges = toDelete.length > 0 || toAdd.length > 0;

      if (toDelete.length) {
        const { error: delErr } = await supabase
          .from('fc_documents')
          .delete()
          .eq('fc_id', id)
          .in('doc_type', toDelete.map((d) => d.doc_type));
        if (delErr) throw delErr;
      }

      if (toAdd.length) {
        const rows = toAdd.map((t) => ({
          fc_id: id,
          doc_type: t,
          status: 'pending',
          file_name: '',
          storage_path: '',
        }));
        const { error: insertErr } = await supabase.from('fc_documents').insert(rows);
        if (insertErr) throw insertErr;
      }

      if (hasChanges) {
        await supabase.from('fc_profiles').update({ status: 'docs-requested' }).eq('id', id);
        if (phone) {
          await sendNotificationAndPush(
            'fc',
            phone,
            '서류 요청 안내',
            '필수 서류 요청이 수정되었습니다. 새로운 서류를 제출해주세요.',
            '/docs-upload',
          );
        }
      }
    },
    onSuccess: () => {
      Alert.alert('저장 완료', '필수 서류 목록이 수정되었습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('오류', err.message ?? '서류 목록 수정 중 문제가 발생했습니다.'),
  });

  const deleteFc = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('fc_documents').delete().eq('fc_id', id);
      const { error } = await supabase.from('fc_profiles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert('삭제 완료', '선택한 FC 기록이 삭제되었습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('삭제 실패', err.message ?? '삭제 중 문제가 발생했습니다.'),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, nextStatus }: { id: string; nextStatus: FcProfile['status'] }) => {
      const { error } = await supabase.from('fc_profiles').update({ status: nextStatus }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert('처리 완료', '상태가 업데이트되었습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('처리 실패', err.message ?? '상태 업데이트 중 문제가 발생했습니다.'),
  });

  const updateAppointmentDate = useMutation({
    mutationFn: async ({
      id,
      type,
      date,
      isReject = false,
      phone,
    }: {
      id: string;
      type: 'life' | 'nonlife';
      date: string | null;
      isReject?: boolean;
      phone: string;
    }) => {
      const field = type === 'life' ? 'appointment_date_life' : 'appointment_date_nonlife';
      const { data, error } = await supabase
        .from('fc_profiles')
        .update({ [field]: date })
        .eq('id', id)
        .select('appointment_date_life, appointment_date_nonlife')
        .single();
      if (error) throw error;

      const bothSet = Boolean(data?.appointment_date_life) && Boolean(data?.appointment_date_nonlife);
      const nextStatus = date === null ? 'docs-approved' : bothSet ? 'final-link-sent' : 'appointment-completed';
      const { error: statusErr } = await supabase.from('fc_profiles').update({ status: nextStatus }).eq('id', id);
      if (statusErr) throw statusErr;

      if (isReject) {
        const title = type === 'life' ? '생명보험 위촉 반려' : '손해보험 위촉 반려';
        await sendNotificationAndPush('fc', phone, title, '입력하신 위촉 완료일이 반려되었습니다. 위촉을 다시 진행해주세요.');
      }
    },
    onSuccess: (_, vars) => {
      const label = vars.type === 'life' ? '생명' : '손해';
      Alert.alert('처리 완료', `${label} 위촉 정보가 ${vars.isReject ? '반려' : '저장'}되었습니다.`);
      refetch();
    },
    onError: (err: any) => Alert.alert('오류', err?.message ?? '위촉 정보 처리 중 문제가 발생했습니다.'),
  });

  const updateAppointmentSchedule = useMutation({
    mutationFn: async ({
      id,
      life,
      nonlife,
    }: {
      id: string;
      life?: string | null;
      nonlife?: string | null;
    }) => {
      console.log('[appointment-schedule] mutate', { id, life, nonlife });
      const payload: any = {};
      if (life !== undefined) payload.appointment_schedule_life = life || null;
      if (nonlife !== undefined) payload.appointment_schedule_nonlife = nonlife || null;
      const { error } = await supabase.from('fc_profiles').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      console.log('[appointment-schedule] success', vars);
      Alert.alert('저장 완료', '위촉 예정월이 저장되었습니다.');
      // 최신 데이터 반영
      refetch();
    },
    onError: (err: any) => {
      console.log('[appointment-schedule] error', err?.message ?? err);
      Alert.alert('저장 실패', err?.message ?? '위촉 예정 월 저장 중 오류가 발생했습니다.');
    },
  });

  const updateDocStatus = useMutation({
    mutationFn: async ({
      fcId,
      docType,
      status,
      phone,
    }: {
      fcId: string;
      docType: string;
      status: 'approved' | 'rejected' | 'pending';
      phone: string;
    }) => {
      // Update individual doc status
      const { error } = await supabase
        .from('fc_documents')
        .update({ status })
        .eq('fc_id', fcId)
        .eq('doc_type', docType);
      if (error) throw error;

      // Check for auto-advance if approved
      if (status === 'approved') {
        const { data: allDocs } = await supabase
          .from('fc_documents')
          .select('status, storage_path')
          .eq('fc_id', fcId);

        const validDocs = (allDocs ?? []).filter((d) => d.storage_path && d.storage_path !== 'deleted');
        // If all valid docs are approved, advance status
        if (validDocs.length > 0 && validDocs.every((d) => d.status === 'approved')) {
          await supabase.from('fc_profiles').update({ status: 'docs-approved' }).eq('id', fcId);
          await sendNotificationAndPush(
            'fc',
            phone,
            '서류 검토 완료',
            '모든 서류가 승인되었습니다. 위촉 계약 단계로 진행해주세요.',
          );
        }
      }
    },
    onSuccess: () => {
      refetch();
    },
    onError: (err: any) => Alert.alert('오류', '문서 상태 업데이트 실패'),
  });

  const deleteDocFile = async ({
    fcId,
    docType,
    storagePath,
    status,
  }: {
    fcId: string;
    docType: string;
    storagePath?: string | null;
    status?: string | null;
  }) => {
    if (status === 'approved') {
      Alert.alert('삭제 불가', '승인된 서류는 삭제할 수 없습니다.');
      return;
    }
    Alert.alert('파일 삭제', `'${docType}' 파일을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            if (storagePath) {
              const { error: storageErr } = await supabase.storage.from(BUCKET).remove([storagePath]);
              if (storageErr) throw storageErr;
            }
            const { error: dbError } = await supabase
              .from('fc_documents')
              .update({ storage_path: 'deleted', file_name: 'deleted.pdf', status: 'pending', reviewer_note: null })
              .eq('fc_id', fcId)
              .eq('doc_type', docType);
            if (dbError) throw dbError;
            Alert.alert('삭제 완료', '파일을 삭제했습니다.');
            refetch();
          } catch (err: any) {
            Alert.alert('삭제 실패', err?.message ?? '파일 삭제 중 문제가 발생했습니다.');
          }
        },
      },
    ]);
  };

  const toggleDocSelection = (fcId: string, doc: string) => {
    setDocSelections((prev) => {
      const set = new Set(prev[fcId] ?? []);
      if (set.has(doc)) set.delete(doc);
      else set.add(doc);
      return { ...prev, [fcId]: set };
    });
  };

  const addCustomDoc = (fcId: string) => {
    const text = customDocInputs[fcId]?.trim();
    if (!text) return;
    toggleDocSelection(fcId, text);
    setCustomDocInputs((prev) => ({ ...prev, [fcId]: '' }));
  };

  const processedRows = useMemo<FcRowWithStep[]>(() => {
    return (data ?? []).map((fc) => ({
      ...fc,
      stepKey: getStepKey(fc),
    }));
  }, [data]);

  const rows = useMemo<FcRowWithStep[]>(() => {
    const mainFilter = filterOptions.find((option) => option.key === statusFilter);
    let filtered = processedRows;
    if (mainFilter) {
      filtered = filtered.filter(mainFilter.predicate);
    }
    if (statusFilter === 'step2') {
      if (subFilter === 'no-id') {
        filtered = filtered.filter((fc) => !fc.temp_id);
      } else if (subFilter === 'has-id') {
        filtered = filtered.filter((fc) => !!fc.temp_id);
      }
    }
    if (statusFilter === 'step3') {
      if (subFilter === 'not-requested') {
        filtered = filtered.filter((fc) => fc.status === 'allowance-consented');
      } else if (subFilter === 'requested') {
        filtered = filtered.filter((fc) => fc.status === 'docs-requested');
      }
    }
    return filtered;
  }, [processedRows, statusFilter, subFilter, filterOptions]);

  const openFile = async (path?: string) => {
    if (!path) {
      Alert.alert('열기 실패', '저장된 파일이 없습니다.');
      return;
    }
    const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !signed?.signedUrl) {
      Alert.alert('열기 실패', error?.message ?? 'URL 생성 실패: 버킷 설정을 확인해주세요.');
      return;
    }
    await WebBrowser.openBrowserAsync(signed.signedUrl);
  };

  const showTempSection = mode !== 'docs';
  const showDocsSection = mode !== 'temp';

  const toggleExpand = (id: string) => {
    if (ALLOW_LAYOUT_ANIM) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } else {
      console.log('[dashboard] skip LayoutAnimation (Android)');
    }
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleEditMode = (id: string) => {
    if (ALLOW_LAYOUT_ANIM) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } else {
      console.log('[dashboard] skip LayoutAnimation (Android)');
    }
    setEditMode((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSendReminder = async (fc: FcRow) => {
    try {
      setReminderLoading(fc.id);
      await sendNotificationAndPush(
        'fc',
        fc.phone,
        '등록 안내',
        '수당동의를 완료해주세요.',
      );
      Alert.alert('알림 전송', '진행을 재촉하는 알림을 발송했습니다.');
    } catch (err: any) {
      Alert.alert('전송 실패', err?.message ?? '알림 전송 중 문제가 발생했습니다.');
    } finally {
      setReminderLoading(null);
    }
  };

  const handleDocReview = (fc: FcRow) => {
    const submitted = fc.fc_documents ?? [];
    const firstDoc = submitted.find((doc) => doc.storage_path && doc.storage_path !== 'deleted');
    if (!firstDoc) {
      Alert.alert('서류 없음', '제출된 서류가 없어 열 수 없습니다.');
      return;
    }
    openFile(firstDoc.storage_path ?? undefined);
  };

  const confirmStatusChange = (fc: FcRow, nextStatus: FcProfile['status'], message: string) => {
    Alert.alert('상태 변경', message, [
      { text: '취소', style: 'cancel' },
      {
        text: '변경',
        style: 'default',
        onPress: () => updateStatus.mutate({ id: fc.id, nextStatus }),
      },
    ]);
  };
  const renderAdminActions = (fc: FcRow) => {
    if (role !== 'admin') return null;
    const isEditing = !!editMode[fc.id];
    const actionBlocks: React.ReactNode[] = [];

    if (!isEditing) {
      if (fc.status === 'draft' || fc.status === 'temp-id-issued') {
        actionBlocks.push(
          <View key="draft-actions" style={styles.actionRow}>
            <Pressable
              style={styles.actionButtonSecondary}
              onPress={() => Linking.openURL(`tel:${fc.phone}`)}
            >
              <Feather name="phone-call" size={16} color={CHARCOAL} />
              <Text style={styles.actionButtonTextSecondary}>전화로 안내하기</Text>
            </Pressable>
            <Pressable
              style={styles.actionButtonPrimary}
              onPress={() => handleSendReminder(fc)}
              disabled={reminderLoading === fc.id}
            >
              <Feather name="send" size={16} color="#fff" />
              <Text style={styles.actionButtonText}>알림 전송</Text>
            </Pressable>
          </View>,
        );
      }

      // 1단계: 임시사번 발급 (Always visible or at least from draft)
      // Statuses: draft, temp-id-issued, allowance-pending, ...
      // User wants history visible. Let's show it always for Admin.
      // 1단계: 기본 정보 및 수당동의 (Step 1 Merged)
      // Statuses: draft, temp-id-issued, allowance-pending, ...
      if (true) {
        const currentCareer = careerInputs[fc.id] ?? fc.career_type ?? '신입';
        const currentTemp = tempInputs[fc.id] ?? fc.temp_id ?? '';
        const hasSavedTemp = currentTemp.trim().length > 0;

        actionBlocks.push(
          <View key="step1-merged" style={styles.cardSection}>
            <Text style={styles.cardTitle}>1단계: 정보 등록 및 수당동의</Text>

            {/* Interim ID Section */}
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                {(['신입', '경력'] as const).map((type) => {
                  const isSelected = currentCareer === type;
                  return (
                    <Pressable
                      key={type}
                      style={[
                        styles.filterTab,
                        isSelected && styles.filterTabActive,
                        { flex: 1, alignItems: 'center', justifyContent: 'center' }
                      ]}
                      onPress={() => setCareerInputs((prev) => ({ ...prev, [fc.id]: type }))}
                    >
                      <Text style={[styles.filterText, isSelected && styles.filterTextActive]}>
                        {type}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.scheduleInput, { flex: 1 }]}
                  value={currentTemp}
                  placeholder="임시사번 입력 (예: T-12345)"
                  onChangeText={(t) => setTempInputs((prev) => ({ ...prev, [fc.id]: t }))}
                />
                <Pressable
                  style={[
                    styles.saveBtn,
                    { paddingHorizontal: 20 },
                    updateTemp.isPending && styles.actionButtonDisabled
                  ]}
                  onPress={() =>
                    updateTemp.mutate({
                      id: fc.id,
                      tempId: currentTemp,
                      prevTemp: fc.temp_id ?? '',
                      career: currentCareer,
                      phone: fc.phone,
                    })
                  }
                  disabled={updateTemp.isPending}
                >
                  <Text style={styles.saveBtnText}>
                    {updateTemp.isPending ? '저장중...' : hasSavedTemp && currentTemp === fc.temp_id ? '수정' : '저장'}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: '#F3F4F6', marginBottom: 16 }} />

            {/* Allowance Consent Section */}
            <View style={styles.cardHeaderRow}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: CHARCOAL }}>수당동의 여부</Text>
              <MobileStatusToggle
                value={
                  fc.status === 'allowance-consented' ||
                    ['docs-requested', 'docs-pending', 'docs-submitted', 'docs-approved', 'appointment-completed', 'final-link-sent'].includes(fc.status)
                    ? 'approved'
                    : 'pending'
                }
                onChange={(val) => {
                  if (val === 'approved') {
                    confirmStatusChange(fc, 'allowance-consented', '수당 동의 검토를 완료 처리할까요?');
                    return;
                  }
                  if (fc.status === 'allowance-consented') {
                    Alert.alert('승인 해제', '이미 승인된 수당동의입니다. 미승인으로 변경할까요?', [
                      { text: '취소', style: 'cancel' },
                      {
                        text: '변경',
                        style: 'destructive',
                        onPress: () => confirmStatusChange(fc, 'allowance-pending', '수당동의 상태를 미승인으로 되돌립니다. 진행할까요?'),
                      },
                    ]);
                    return;
                  }
                }}
                labelPending="미승인"
                labelApproved="승인"
                readOnly={false}
              />
            </View>
          </View>
        );
      }

      // 2단계: 제출된 서류 검토 (Show if status >= allowance-consented) -> Auto-show trigger
      if (['allowance-consented', 'docs-requested', 'docs-pending', 'docs-submitted', 'docs-rejected', 'docs-approved', 'appointment-completed', 'final-link-sent'].includes(fc.status)) {
        const submittedDocs = (fc.fc_documents ?? [])
          .filter((d) => d.storage_path && d.storage_path !== 'deleted')
          .sort((a, b) => (a.doc_type || '').localeCompare(b.doc_type || ''));

        actionBlocks.push(
          <View key="docs-actions" style={styles.cardSection}>
            <Text style={styles.cardTitle}>2단계: 제출된 서류 검토</Text>

            {/* Document Request UI */}
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: CHARCOAL }}>필수 서류 요청</Text>
                <Pressable
                  style={[styles.docSaveButton, updateDocReqs.isPending && styles.actionButtonDisabled]}
                  onPress={() =>
                    updateDocReqs.mutate({
                      id: fc.id,
                      types: Array.from(docSelections[fc.id] ?? new Set<string>()),
                      phone: fc.phone,
                    })
                  }
                  disabled={updateDocReqs.isPending}
                >
                  <Text style={styles.docSaveButtonText}>
                    {updateDocReqs.isPending ? '저장중...' : '요청 저장'}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.docChips}>
                {ALL_DOC_OPTIONS.map((doc) => {
                  const isSelected = docSelections[fc.id]?.has(doc);
                  return (
                    <Pressable
                      key={doc}
                      style={[styles.docChip, isSelected && styles.docChipSelected]}
                      onPress={() => toggleDocSelection(fc.id, doc)}
                    >
                      <Text style={[styles.docChipText, isSelected && { color: '#fff' }]}>{doc}</Text>
                    </Pressable>
                  );
                })}
                {Array.from(docSelections[fc.id] ?? []).filter((d) => !ALL_DOC_OPTIONS.includes(d)).map((doc) => (
                  <Pressable
                    key={doc}
                    style={[styles.docChip, styles.docChipSelected]}
                    onPress={() => toggleDocSelection(fc.id, doc)}
                  >
                    <Text style={[styles.docChipText, { color: '#fff' }]}>{doc}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                <TextInput
                  style={[styles.miniInput, { flex: 1, backgroundColor: '#fff' }]}
                  placeholder="기타 서류 입력"
                  value={customDocInputs[fc.id] || ''}
                  onChangeText={(text) => setCustomDocInputs((prev) => ({ ...prev, [fc.id]: text }))}
                />
                <Pressable
                  style={[styles.saveBtn, { backgroundColor: '#4b5563' }]}
                  onPress={() => addCustomDoc(fc.id)}
                >
                  <Text style={styles.saveBtnText}>추가</Text>
                </Pressable>
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: '#F3F4F6', marginBottom: 12 }} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: CHARCOAL, marginBottom: 8 }}>제출된 서류 목록</Text>
            {submittedDocs.length > 0 ? (
              submittedDocs.map((doc) => {
                const docType = doc.doc_type;
                return (
                  <View key={docType} style={styles.submittedRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.submittedText} numberOfLines={1}>{docType}</Text>
                      {doc.storage_path && (
                        <Pressable onPress={() => openFile(doc.storage_path ?? undefined)}>
                          <Text style={{ color: '#2563eb', fontSize: 12, marginTop: 2 }}>파일 열기</Text>
                        </Pressable>
                      )}
                    </View>
                    <View style={styles.submittedActions}>
                      <MobileStatusToggle
                        value={doc.status === 'approved' ? 'approved' : 'pending'}
                        onChange={(val) => {
                          if (doc.status === 'approved' && val !== 'approved') {
                            Alert.alert('승인 해제', '이미 승인된 서류입니다. 미승인으로 변경할까요?', [
                              { text: '취소', style: 'cancel' },
                              {
                                text: '변경',
                                style: 'destructive',
                                onPress: () =>
                                  updateDocStatus.mutate({ fcId: fc.id, docType, status: val, phone: fc.phone }),
                              },
                            ]);
                            return;
                          }
                          updateDocStatus.mutate({ fcId: fc.id, docType, status: val, phone: fc.phone });
                        }}
                        labelPending="미승인"
                        labelApproved="승인"
                        readOnly={false}
                      />
                      <Pressable
                        style={styles.deleteIconButton}
                        onPress={() =>
                          deleteDocFile({
                            fcId: fc.id,
                            docType,
                            storagePath: doc.storage_path,
                            status: doc.status,
                          })
                        }
                      >
                        <Feather name="trash-2" size={14} color="#b91c1c" />
                        <Text style={styles.deleteText}>삭제</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })) : (
              <Text style={[styles.emptyText, { marginVertical: 8 }]}>제출된 서류가 없습니다.</Text>
            )}
          </View>
        );
      }

      // 3단계: 위촉 진행 관리
      if (fc.status === 'docs-approved' || fc.status === 'final-link-sent' || fc.status === 'appointment-completed') {
        const lifeVal = fc.appointment_schedule_life ?? '';
        const nonlifeVal = fc.appointment_schedule_nonlife ?? '';
        const lifeApproved = Boolean(fc.appointment_date_life);
        const nonlifeApproved = Boolean(fc.appointment_date_nonlife);
        const scheduleInput = scheduleInputs[fc.id] ?? { life: lifeVal, nonlife: nonlifeVal };
        actionBlocks.push(
          <View key="final-actions" style={styles.cardSection}>
            <Text style={styles.cardTitle}>3단계: 위촉 진행 관리</Text>
            {/* Schedule Input Helper (Existing) */}
            <View style={styles.scheduleEditRow}>
              {/* ... Keep existing schedule input logic ... */}
              <View style={styles.scheduleInputGroup}>
                <Text style={styles.scheduleInputLabel}>생명 예정월</Text>
                <TextInput
                  style={styles.scheduleInput}
                  placeholder="예:12월 1차 / 1월 3차"
                  value={scheduleInput.life ?? ''}
                  onChangeText={(t) =>
                    setScheduleInputs((prev) => ({
                      ...prev,
                      [fc.id]: { ...(prev[fc.id] ?? {}), life: t },
                    }))
                  }
                />
              </View>
              <View style={styles.scheduleInputGroup}>
                <Text style={styles.scheduleInputLabel}>손해 예정월</Text>
                <TextInput
                  style={styles.scheduleInput}
                  placeholder="예: 12월 1차 / 1월 3차"
                  value={scheduleInput.nonlife ?? ''}
                  onChangeText={(t) =>
                    setScheduleInputs((prev) => ({
                      ...prev,
                      [fc.id]: { ...(prev[fc.id] ?? {}), nonlife: t },
                    }))
                  }
                />
              </View>
              <Pressable
                style={[styles.saveBtn, updateAppointmentSchedule.isPending && styles.actionButtonDisabled]}
                disabled={updateAppointmentSchedule.isPending}
                onPress={() => {
                  const lifeVal = (scheduleInput.life ?? '').trim();
                  const nonlifeVal = (scheduleInput.nonlife ?? '').trim();
                  if (!lifeVal && !nonlifeVal) {
                    Alert.alert('입력 확인', '예정월을 하나 이상 입력해주세요.');
                    return;
                  }
                  console.log('[appointment-schedule] press', {
                    id: fc.id,
                    life: lifeVal,
                    nonlife: nonlifeVal,
                  });
                  updateAppointmentSchedule.mutate({
                    id: fc.id,
                    life: lifeVal || null,
                    nonlife: nonlifeVal || null,
                  });
                }}
              >
                <Text style={styles.saveBtnText}>저장</Text>
              </Pressable>
            </View>

            {/* Life Appointment Toggle */}
            <View style={styles.scheduleRow}>
              <View style={styles.scheduleInfo}>
                <View style={[styles.badge, { backgroundColor: '#fff7ed' }]}>
                  <Text style={{ color: ORANGE, fontWeight: '700', fontSize: 11 }}>생명</Text>
                </View>
                <Text style={styles.scheduleText}>
                  {fc.appointment_date_life
                    ? `확정: ${fc.appointment_date_life}`
                    : fc.appointment_date_life_sub
                      ? `제출: ${fc.appointment_date_life_sub} (승인 대기)`
                      : lifeVal
                        ? `예정: ${lifeVal}`
                        : '-'}
                </Text>
              </View>
              <MobileStatusToggle
                value={lifeApproved ? 'approved' : 'pending'}
                onChange={(val) => {
                  const fallbackDate = () => fc.appointment_date_life || new Date().toISOString().split('T')[0];

                  if (val === 'approved') {
                    if (!lifeVal) {
                      Alert.alert('확인', '위촉 예정월(생명)이 입력되지 않았습니다.\n예정월을 먼저 저장해주세요.');
                      return;
                    }
                    if (Platform.OS === 'ios') {
                      Alert.prompt(
                        '위촉 확정일 입력',
                        'YYYY-MM-DD 형식으로 입력해주세요',
                        [
                          { text: '취소', style: 'cancel' },
                          {
                            text: '확인',
                            onPress: (date?: string) => {
                              if (date) updateAppointmentDate.mutate({ id: fc.id, type: 'life', date, phone: fc.phone });
                            },
                          },
                        ],
                        'plain-text',
                        fallbackDate(),
                      );
                    } else {
                      const date = fallbackDate();
                      Alert.alert('위촉 확정', `${date}로 저장할까요?`, [
                        { text: '취소', style: 'cancel' },
                        {
                          text: '저장',
                          onPress: () => updateAppointmentDate.mutate({ id: fc.id, type: 'life', date, phone: fc.phone }),
                        },
                      ]);
                    }
                  } else {
                    // Reject: 승인 해제 시 항상 날짜를 초기화
                    Alert.alert('반려 확인', '위촉 확정을 취소(반려)하고 날짜를 초기화할까요?', [
                      { text: '취소', style: 'cancel' },
                      {
                        text: '반려',
                        style: 'destructive',
                        onPress: () =>
                          updateAppointmentDate.mutate({
                            id: fc.id,
                            type: 'life',
                            date: null,
                            isReject: true,
                            phone: fc.phone,
                          }),
                      },
                    ]);
                  }
                }}
                labelPending="미승인"
                labelApproved="승인"
                readOnly={false}
              />
            </View>

            {/* NonLife Appointment Toggle */}
            <View style={styles.scheduleRow}>
              <View style={styles.scheduleInfo}>
                <View style={[styles.badge, { backgroundColor: '#eff6ff' }]}>
                  <Text style={{ color: '#2563eb', fontWeight: '700', fontSize: 11 }}>손해</Text>
                </View>
                <Text style={styles.scheduleText}>
                  {fc.appointment_date_nonlife
                    ? `확정: ${fc.appointment_date_nonlife}`
                    : fc.appointment_date_nonlife_sub
                      ? `제출: ${fc.appointment_date_nonlife_sub} (승인 대기)`
                      : nonlifeVal
                        ? `예정: ${nonlifeVal}`
                        : '-'}
                </Text>
              </View>
              <MobileStatusToggle
                value={nonlifeApproved ? 'approved' : 'pending'}
                onChange={(val) => {
                  const fallbackDate = () => fc.appointment_date_nonlife || new Date().toISOString().split('T')[0];

                  if (val === 'approved') {
                    if (!nonlifeVal) {
                      Alert.alert('확인', '위촉 예정월(손해)이 입력되지 않았습니다.\n예정월을 먼저 저장해주세요.');
                      return;
                    }
                    if (Platform.OS === 'ios') {
                      Alert.prompt(
                        '위촉 확정일 입력',
                        'YYYY-MM-DD 형식으로 입력해주세요',
                        [
                          { text: '취소', style: 'cancel' },
                          {
                            text: '확인',
                            onPress: (date?: string) => {
                              if (date) updateAppointmentDate.mutate({ id: fc.id, type: 'nonlife', date, phone: fc.phone });
                            },
                          },
                        ],
                        'plain-text',
                        fallbackDate(),
                      );
                    } else {
                      const date = fallbackDate();
                      Alert.alert('위촉 확정', `${date}로 저장할까요?`, [
                        { text: '취소', style: 'cancel' },
                        {
                          text: '저장',
                          onPress: () => updateAppointmentDate.mutate({ id: fc.id, type: 'nonlife', date, phone: fc.phone }),
                        },
                      ]);
                    }
                  } else {
                    // Reject: 승인 해제 시 항상 날짜를 초기화
                    Alert.alert('반려 확인', '위촉 확정을 취소(반려)하고 날짜를 초기화할까요?', [
                      { text: '취소', style: 'cancel' },
                      {
                        text: '반려',
                        style: 'destructive',
                        onPress: () =>
                          updateAppointmentDate.mutate({
                            id: fc.id,
                            type: 'nonlife',
                            date: null,
                            isReject: true,
                            phone: fc.phone,
                          }),
                      },
                    ]);
                  }
                }}
                labelPending="미승인"
                labelApproved="승인"
                readOnly={false}
              />
            </View>
          </View>,
        );
      }

      actionBlocks.push(
        <View
          key="danger-zone"
          style={[
            styles.cardSection,
            { backgroundColor: '#fff5f5', borderColor: '#fecdd3' },
          ]}
        >
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#b91c1c', marginBottom: 8 }}>
            FC 정보 삭제
          </Text>
          <Text style={{ color: '#b91c1c', fontSize: 12, marginBottom: 10 }}>
            프로필과 제출된 서류가 모두 삭제됩니다. 복구할 수 없습니다.
          </Text>
          <Pressable
            style={styles.deleteButton}
            onPress={() =>
              Alert.alert(
                '삭제 확인',
                `${fc.name || 'FC'} 정보를 삭제할까요?\n제출된 서류도 함께 삭제됩니다.`,
                [
                  { text: '취소', style: 'cancel' },
                  {
                    text: '삭제',
                    style: 'destructive',
                    onPress: () => deleteFc.mutate(fc.id),
                  },
                ],
              )
            }
            disabled={deleteFc.isPending}
          >
            <Feather name="trash-2" size={16} color="#b91c1c" />
            <Text style={styles.deleteText}>{deleteFc.isPending ? '삭제중...' : 'FC 정보 삭제'}</Text>
          </Pressable>
        </View>,
      );
    }

    return (
      <View style={styles.actionArea}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>관리자 액션</Text>
          <Pressable style={styles.toggleEditButton} onPress={() => toggleEditMode(fc.id)}>
            <Text style={styles.toggleEditText}>
              {isEditing ? '닫기' : '정보 수정 및 서류 재설정'}
            </Text>
            <Feather name={isEditing ? 'chevron-up' : 'settings'} size={14} color={MUTED} />
          </Pressable>
        </View>

        {!isEditing && actionBlocks}

        {isEditing && (
          <View style={styles.cardSection}>
            <View style={styles.editRow}>
              <Text style={styles.editLabel}>임시번호</Text>
              <View style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={styles.miniInput}
                  value={tempInputs[fc.id] ?? fc.temp_id ?? ''}
                  onChangeText={(t) => setTempInputs((p) => ({ ...p, [fc.id]: t }))}
                  placeholder="T-12345"
                />
                {(() => {
                  const currentTemp = tempInputs[fc.id] ?? fc.temp_id ?? '';
                  const hasSavedTemp = currentTemp.trim().length > 0;
                  const buttonLabel = updateTemp.isPending ? '저장중...' : hasSavedTemp ? '수정' : '저장';
                  return (
                    <Pressable
                      style={[styles.saveBtn, updateTemp.isPending && styles.actionButtonDisabled]}
                      onPress={() =>
                        updateTemp.mutate({
                          id: fc.id,
                          tempId: currentTemp,
                          prevTemp: fc.temp_id ?? '',
                          career: careerInputs[fc.id] ?? '신입',
                          phone: fc.phone,
                        })
                      }
                      disabled={updateTemp.isPending}
                    >
                      <Text style={styles.saveBtnText}>{buttonLabel}</Text>
                    </Pressable>
                  );
                })()}
              </View>
            </View>

            <View style={styles.editRowVertical}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                <Text style={styles.editLabel}>필수 서류</Text>
                <Pressable
                  onPress={() =>
                    updateDocReqs.mutate({
                      id: fc.id,
                      types: Array.from(docSelections[fc.id] ?? new Set<string>()),
                      phone: fc.phone,
                    })
                  }
                  disabled={updateDocReqs.isPending}
                >
                  <Text style={{ color: ORANGE, fontWeight: '700', fontSize: 13 }}>
                    {updateDocReqs.isPending ? '저장중...' : '적용 저장'}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.docChips}>
                {ALL_DOC_OPTIONS.map((doc) => {
                  const isSelected = docSelections[fc.id]?.has(doc);
                  return (
                    <Pressable
                      key={doc}
                      style={[styles.docChip, isSelected && styles.docChipSelected]}
                      onPress={() => toggleDocSelection(fc.id, doc)}
                    >
                      <Text style={[styles.docChipText, isSelected && { color: '#fff' }]}>{doc}</Text>
                    </Pressable>
                  );
                })}
                {Array.from(docSelections[fc.id] ?? []).filter((d) => !ALL_DOC_OPTIONS.includes(d)).map((doc) => (
                  <Pressable
                    key={doc}
                    style={[styles.docChip, styles.docChipSelected]}
                    onPress={() => toggleDocSelection(fc.id, doc)}
                  >
                    <Text style={[styles.docChipText, { color: '#fff' }]}>{doc}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                <TextInput
                  style={[styles.miniInput, { height: 36 }]}
                  placeholder="기타 서류 입력"
                  value={customDocInputs[fc.id] || ''}
                  onChangeText={(text) => setCustomDocInputs((prev) => ({ ...prev, [fc.id]: text }))}
                />
                <Pressable
                  style={[styles.saveBtn, { backgroundColor: '#4b5563' }]}
                  onPress={() => addCustomDoc(fc.id)}
                >
                  <Text style={styles.saveBtnText}>추가</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  if (!hydrated || !role) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={[{ alignItems: 'center', justifyContent: 'center', flex: 1 }]}>
          <ActivityIndicator color={ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAwareWrapper
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: keyboardPadding + 40 }}
      >
        <View style={styles.headerContainer}>
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>현황 대시보드</Text>
            <RefreshButton onPress={() => { refetch(); }} />
          </View>
          <Text style={styles.headerSub}>
            {role === 'admin' ? '전체 FC 진행 현황 및 서류 관리' : '나의 진행 현황 확인'}
          </Text>

          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color="#9CA3AF" />
            <TextInput
              style={styles.searchInput}
              placeholder="이름, 연락처 검색"
              placeholderTextColor="#9CA3AF"
              value={keyword}
              onChangeText={setKeyword}
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterContainer}
          >
            {filterOptions.map((option) => {
              const active = statusFilter === option.key;
              return (
                <Pressable
                  key={option.key}
                  style={[styles.filterTab, active && styles.filterTabActive]}
                  onPress={() => setStatusFilter(option.key)}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {statusFilter === 'step2' && (
            <View style={styles.subFilterContainer}>
              <Pressable
                style={[styles.subChip, subFilter === 'all' && styles.subChipActive]}
                onPress={() => setSubFilter('all')}
              >
                <Text style={[styles.subText, subFilter === 'all' && styles.subTextActive]}>전체</Text>
              </Pressable>
              <View style={styles.subDivider} />
              <Pressable
                style={[styles.subChip, subFilter === 'no-id' && styles.subChipActive]}
                onPress={() => setSubFilter('no-id')}
              >
                <Text style={[styles.subText, subFilter === 'no-id' && styles.subTextActive]}>임시번호 미발급</Text>
              </Pressable>
              <Pressable
                style={[styles.subChip, subFilter === 'has-id' && styles.subChipActive]}
                onPress={() => setSubFilter('has-id')}
              >
                <Text style={[styles.subText, subFilter === 'has-id' && styles.subTextActive]}>발급 완료</Text>
              </Pressable>
            </View>
          )}

          {statusFilter === 'step3' && (
            <View style={styles.subFilterContainer}>
              <Pressable
                style={[styles.subChip, subFilter === 'all' && styles.subChipActive]}
                onPress={() => setSubFilter('all')}
              >
                <Text style={[styles.subText, subFilter === 'all' && styles.subTextActive]}>전체</Text>
              </Pressable>
              <View style={styles.subDivider} />
              <Pressable
                style={[styles.subChip, subFilter === 'not-requested' && styles.subChipActive]}
                onPress={() => setSubFilter('not-requested')}
              >
                <Text style={[styles.subText, subFilter === 'not-requested' && styles.subTextActive]}>서류 미요청</Text>
              </Pressable>
              <Pressable
                style={[styles.subChip, subFilter === 'requested' && styles.subChipActive]}
                onPress={() => setSubFilter('requested')}
              >
                <Text style={[styles.subText, subFilter === 'requested' && styles.subTextActive]}>요청 완료</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.listContent}>
          {isLoading && <ActivityIndicator color={ORANGE} style={{ marginVertical: 20 }} />}
          {isError && <Text style={{ color: '#dc2626', marginBottom: 8 }}>데이터를 불러오지 못했습니다.</Text>}
          {!isLoading && rows.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>조회된 내용이 없습니다.</Text>
            </View>
          )}

          {rows.map((fc, idx) => {
            const isExpanded = expanded[fc.id];
            const submitted = (fc.fc_documents ?? []).filter((d) => d.storage_path && d.storage_path !== 'deleted');
            const careerDisplay = careerInputs[fc.id] ?? fc.career_type ?? '-';
            const tempDisplay = tempInputs[fc.id] ?? fc.temp_id ?? '-';
            const allowanceDisplay = fc.allowance_date ?? '없음';

            return (
              <View key={fc.id} style={styles.listItem}>
                <Pressable onPress={() => toggleExpand(fc.id)} style={styles.listHeader}>
                  <View style={styles.listInfo}>
                    <View style={styles.nameRow}>
                      <Text style={styles.nameText}>{fc.name || '-'}</Text>
                      <Text style={styles.affText}>{fc.affiliation || '-'}</Text>
                    </View>
                    <Text style={styles.subText}>
                      {fc.phone} · {STATUS_LABELS[fc.status] ?? fc.status}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {role === 'admin' && (
                      <Pressable
                        style={styles.messageBtn}
                        onPress={() =>
                          router.push({
                            pathname: '/chat',
                            params: { targetId: fc.phone, targetName: fc.name || fc.phone },
                          })
                        }
                      >
                        <Feather name="message-circle" size={18} color={CHARCOAL} />
                      </Pressable>
                    )}
                    <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#9CA3AF" />
                  </View>
                </Pressable>

                {isExpanded && (
                  <View style={styles.listBody}>
                    <View style={styles.cardSection}>
                      <Text style={styles.cardTitle}>기본 정보</Text>
                      <DetailRow label="임시번호" value={tempDisplay} />
                      <DetailRow label="수당동의" value={allowanceDisplay} />
                      <DetailRow
                        label="생명 위촉"
                        value={`${fc.appointment_schedule_life ?? '미정'}월 / 완료 ${fc.appointment_date_life ?? '미입력'}`}
                      />
                      <DetailRow
                        label="손해 위촉"
                        value={`${fc.appointment_schedule_nonlife ?? '미정'}월 / 완료 ${fc.appointment_date_nonlife ?? '미입력'}`}
                      />
                      <DetailRow
                        label="생명 제출"
                        value={fc.appointment_date_life_sub ?? '미입력'}
                      />
                      <DetailRow
                        label="손해 제출"
                        value={fc.appointment_date_nonlife_sub ?? '미입력'}
                      />
                      <DetailRow label="경력구분" value={careerDisplay} />
                      <DetailRow label="이메일" value={fc.email ?? '-'} />
                      <DetailRow label="주소" value={`${fc.address ?? '-'} ${fc.address_detail ?? ''}`} />
                    </View>

                    {renderAdminActions(fc)}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  headerContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: CHARCOAL,
  },
  headerSub: {
    fontSize: 13,
    color: MUTED,
    marginTop: 4,
    marginBottom: 16,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: CHARCOAL,
  },
  filterContainer: {
    gap: 8,
    paddingBottom: 8,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 8,
  },
  filterTabActive: {
    backgroundColor: CHARCOAL,
    borderColor: CHARCOAL,
  },
  filterText: {
    fontSize: 13,
    color: MUTED,
  },
  filterTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  subFilterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
  },
  subChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  subChipActive: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  subText: { fontSize: 12, color: MUTED, fontWeight: '500' },
  subTextActive: { color: CHARCOAL, fontWeight: '700' },
  subDivider: { width: 1, height: 14, backgroundColor: '#CBD5F5' },
  listContent: {
    padding: 20,
    gap: 12,
  },
  listItem: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    overflow: 'hidden',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  messageBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  listInfo: { flex: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  nameText: {
    fontSize: 16,
    fontWeight: '700',
    color: CHARCOAL,
    marginRight: 8,
  },
  affText: {
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  listBody: {
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  cardSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: CHARCOAL,
    marginBottom: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 13,
    color: MUTED,
    width: 80,
  },
  detailValue: {
    fontSize: 13,
    color: CHARCOAL,
    flex: 1,
    textAlign: 'right',
  },
  adminSection: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 10,
  },
  adminLabel: {
    // Migrated to cardTitle
    fontSize: 14, fontWeight: '700', color: CHARCOAL, marginBottom: 8
  },
  actionArea: {
    marginTop: 0,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionColumn: {
    flexDirection: 'column',
    gap: 8,
  },
  actionButtonPrimary: {
    flex: 1,
    backgroundColor: ORANGE,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionButtonSecondary: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  actionButtonTextSecondary: {
    color: CHARCOAL,
    fontWeight: '600',
    fontSize: 14,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  inputGroup: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  adminInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    backgroundColor: '#fff',
  },
  miniInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    backgroundColor: '#fff',
  },
  saveButton: {
    backgroundColor: CHARCOAL,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  docPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  docPill: {
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  docPillSelected: { backgroundColor: '#fff7ed', borderColor: ORANGE },
  docPillSubmitted: { backgroundColor: '#e0f2fe', borderColor: '#38bdf8' },
  docPillText: { color: CHARCOAL, fontSize: 12 },
  docPillTextSelected: { color: ORANGE, fontWeight: '700' },
  docPillTextSubmitted: { color: '#0ea5e9', fontWeight: '700' },
  submittedBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    gap: 6,
  },
  submittedTitle: { fontSize: 13, fontWeight: '700', color: CHARCOAL },
  submittedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 },
  submittedText: { color: CHARCOAL, flex: 1, fontSize: 12 },
  submittedActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  openButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  openButtonText: { color: CHARCOAL, fontSize: 12, fontWeight: '700' },
  deleteIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecdd3',
    backgroundColor: '#fff5f5',
  },
  deleteButton: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecdd3',
    backgroundColor: '#fee2e2',
  },
  deleteText: { color: '#b91c1c', fontSize: 12, fontWeight: '700' },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: MUTED,
    fontSize: 14,
  },
  editPanel: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 14,
  },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editRowVertical: { gap: 6 },
  editLabel: { width: 70, fontSize: 13, fontWeight: '600', color: MUTED },
  saveBtn: {
    backgroundColor: CHARCOAL,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
    borderRadius: 8,
  },
  saveBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  toggleEditButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  toggleEditText: { fontSize: 13, color: MUTED, fontWeight: '600' },
  docChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  docChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  docChipSelected: { backgroundColor: ORANGE, borderColor: ORANGE },
  docChipText: { fontSize: 12, color: CHARCOAL },
  docSaveButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: ORANGE,
    borderWidth: 1,
    borderColor: ORANGE,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docSaveButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  scheduleEditRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  scheduleInputGroup: { flex: 1, minWidth: 150, gap: 6 },
  scheduleInputLabel: { fontSize: 12, color: MUTED },
  scheduleInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: CHARCOAL,
    backgroundColor: '#fff',
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  scheduleInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scheduleText: { fontSize: 13, color: CHARCOAL },
  scheduleButtons: { flexDirection: 'row', gap: 6 },
  confirmBtn: {
    backgroundColor: CHARCOAL,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  confirmBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  rejectBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#fecdd3',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  rejectBtnText: { color: '#b91c1c', fontSize: 11, fontWeight: '600' },
});
