import { MobileStatusToggle } from '@/components/MobileStatusToggle';
import { RefreshButton } from '@/components/RefreshButton';
import { Feather, Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { ListSkeleton } from '@/components/LoadingSkeleton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { FcProfile } from '@/types/fc';
import type { FCDocument } from '@/types/dashboard';

const ALLOW_LAYOUT_ANIM = Platform.OS !== 'android';

// Debug: disable Android LayoutAnimation to avoid native addViewAt crashes on logout
if (Platform.OS === 'android') {
  logger.debug('[dashboard] LayoutAnimation disabled on Android to prevent addViewAt crash');
} else if (UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BUCKET = 'fc-documents';
const ORANGE = '#f36f21';
const BLUE = '#2563eb';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

const formatKoreanDate = (d: Date) =>
  `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;

const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseYmd = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

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
  step1: '1단계 회원가입',
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

  // [2단계 우선] 서류 승인 여부 (요청된 모든 서류 제출 + 승인 필요)
  const docs = (profile.fc_documents ?? []) as FCDocument[];
  const allSubmitted =
    docs.length > 0 && docs.every((d) => d.storage_path && d.storage_path !== 'deleted');
  const allApproved = allSubmitted && docs.every((d) => d.status === 'approved');
  if (!allApproved) {
    return 3; // 서류 단계
  }

  // [3단계 우선] 위촉 최종 완료 여부
  if (profile.status !== 'final-link-sent') {
    return 4; // 위촉 진행 단계 (총무 승인 필요)
  }

  // 완료
  return 5;
};

const normalizeDateInput = (value?: string | null) => {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  if (!DATE_RE.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return raw;
};

const normalizeCustomDocInput = (value: string) => {
  const cleaned = value.replace(/\u200B/g, '').trimStart();
  return cleaned.trim().length === 0 ? '' : cleaned;
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
  docs_deadline_at?: string | null;
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
  appointment_reject_reason_life?: string | null;
  appointment_reject_reason_nonlife?: string | null;
  fc_documents?: { doc_type: string; storage_path: string | null; file_name: string | null; status: string | null }[];
};
type FcRowWithStep = FcRow & { stepKey: StepKey };

async function adminAction(
  adminPhone: string,
  action: string,
  payload: Record<string, any>,
): Promise<{ ok: boolean; [key: string]: any }> {
  const { data, error } = await supabase.functions.invoke('admin-action', {
    body: { adminPhone, action, payload },
  });
  if (error) {
    const msg = error instanceof Error ? error.message : 'Edge Function 호출 실패';
    throw new Error(msg);
  }
  if (!data?.ok) {
    throw new Error(data?.message ?? '처리 중 오류가 발생했습니다.');
  }
  return data;
}

async function sendNotificationAndPush(
  adminPhone: string,
  role: 'admin' | 'fc',
  residentId: string | null,
  title: string,
  body: string,
  url?: string,
) {
  // Insert notification via Edge Function (bypasses RLS)
  await adminAction(adminPhone, 'sendNotification', {
    phone: residentId,
    title,
    body,
    role,
    url,
  }).catch(() => { /* ignore notification failures */ });

  // Send push directly (device_tokens has anon-friendly policies)
  const baseQuery = supabase.from('device_tokens').select('expo_push_token');
  const { data: tokens } =
    role === 'fc' && residentId
      ? await baseQuery.eq('role', 'fc').eq('resident_id', residentId)
      : await baseQuery.eq('role', 'admin');

  const payload =
    tokens?.map((t: { expo_push_token: string }) => ({
      to: t.expo_push_token,
      title,
      body,
      data: { type: 'app_event', resident_id: residentId, url },
      sound: 'default',
      priority: 'high',
      channelId: 'alerts',
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
        'id,name,affiliation,phone,temp_id,status,allowance_date,appointment_url,appointment_date,docs_deadline_at,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,appointment_reject_reason_life,appointment_reject_reason_nonlife,resident_id_masked,career_type,email,address,address_detail,fc_documents(doc_type,storage_path,file_name,status)',
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
  if (error) {
    logger.error('[dashboard] fetchFcs query error', {
      message: error.message,
      code: (error as { code?: string; details?: string; hint?: string; message: string }).code,
      details: (error as { code?: string; details?: string; hint?: string; message: string }).details,
      hint: (error as { code?: string; details?: string; hint?: string; message: string }).hint,
      role,
      residentId,
      keyword,
    });
    throw error;
  }
  return data as FcRow[];
};

export default function DashboardScreen() {
  const { role, residentId, hydrated, readOnly } = useSession();
  const router = useRouter();
  const { status } = useLocalSearchParams<{ mode?: string; status?: string }>();
  const [statusFilter, setStatusFilter] = useState<FilterKey>('all');
  const [affiliationFilter, setAffiliationFilter] = useState<string>('전체'); // New: Affiliation Filter
  const [subFilter, setSubFilter] = useState<'all' | 'no-id' | 'has-id' | 'not-requested' | 'requested'>('all');
  const [keyword, setKeyword] = useState('');
  const [tempInputs, setTempInputs] = useState<Record<string, string>>({});
  const [careerInputs, setCareerInputs] = useState<Record<string, '신입' | '경력'>>({});
  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const [docSelections, setDocSelections] = useState<Record<string, Set<string>>>({});
  const [docDeadlineInputs, setDocDeadlineInputs] = useState<Record<string, string>>({});
  const [docDeadlinePickerId, setDocDeadlinePickerId] = useState<string | null>(null);
  const [docDeadlineTempDate, setDocDeadlineTempDate] = useState<Date | null>(null);
  const [customDocInputs, setCustomDocInputs] = useState<Record<string, string>>({});
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, { life?: string; nonlife?: string }>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Delete Modal State
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetName, setDeleteTargetName] = useState<string | null>(null);
  const [deleteTargetPhone, setDeleteTargetPhone] = useState<string | null>(null);
  const [deleteCode, setDeleteCode] = useState('');
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<FcRow | null>(null);
  const [docRejectModalVisible, setDocRejectModalVisible] = useState(false);
  const [docRejectReason, setDocRejectReason] = useState('');
  const [docRejectTarget, setDocRejectTarget] = useState<{
    fcId: string;
    docType: string;
    phone: string;
  } | null>(null);
  const [appointmentRejectModalVisible, setAppointmentRejectModalVisible] = useState(false);
  const [appointmentRejectReason, setAppointmentRejectReason] = useState('');
  const [appointmentRejectTarget, setAppointmentRejectTarget] = useState<{
    id: string;
    type: 'life' | 'nonlife';
    phone: string;
  } | null>(null);
  const keyboardPadding = useKeyboardPadding();
  const filterOptions = useMemo(() => createFilterOptions(role), [role]);

  const [reminderLoading, setReminderLoading] = useState<string | null>(null);

  const canEdit = role === 'admin' && !readOnly;
  const assertCanEdit = () => {
    if (!canEdit) {
      throw new Error('본부장은 조회 전용 계정입니다.');
    }
  };

  const { data, isLoading, isError, error: queryError, refetch } = useQuery({
    queryKey: ['dashboard', role, residentId, keyword],
    queryFn: () => fetchFcs(role, residentId, keyword),
    enabled: !!role,
  });

  // Log query errors
  useEffect(() => {
    if (queryError) {
      const supabaseError = queryError as Error & { code?: string; details?: string; hint?: string };
      logger.error('[dashboard] fetchFcs failed', {
        message: supabaseError?.message ?? queryError,
        code: supabaseError?.code,
        details: supabaseError?.details,
        hint: supabaseError?.hint,
      });
    }
  }, [queryError]);

  useEffect(() => {
    if (!isError) return;
    Alert.alert('대시보드 오류', '데이터를 불러오지 못했습니다. 로그를 확인해주세요.');
  }, [isError]);

  // Compute unique affiliations (After data is declared)
  const affiliationOptions = useMemo(() => {
    if (!data) return ['전체'];
    const affiliations = new Set(data.filter((d) => d.affiliation).map((d) => d.affiliation));
    return ['전체', ...Array.from(affiliations).sort()];
  }, [data]);

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
  }, [status, filterOptions]);

  useEffect(() => {
    setSubFilter('all');
  }, [statusFilter]);

    useEffect(() => {
      if (!data) return;
      const next: Record<string, Set<string>> = {};
      const tempPrefill: Record<string, string> = {};
      const careerPrefill: Record<string, '신입' | '경력'> = {};
      const schedulePrefill: Record<string, { life?: string; nonlife?: string }> = {};
      const deadlinePrefill: Record<string, string> = {};
      data.forEach((fc) => {
        const docs = fc.fc_documents?.map((d) => d.doc_type) ?? [];
        next[fc.id] = new Set(docs);
        if (fc.temp_id) tempPrefill[fc.id] = fc.temp_id;
        if (fc.career_type === '경력' || fc.career_type === '신입') careerPrefill[fc.id] = fc.career_type;
        schedulePrefill[fc.id] = {
          life: fc.appointment_schedule_life ?? '',
          nonlife: fc.appointment_schedule_nonlife ?? '',
        };
        if (fc.docs_deadline_at) deadlinePrefill[fc.id] = fc.docs_deadline_at;
      });
      setDocSelections(next);
      setTempInputs((prev) => ({ ...tempPrefill, ...prev }));
      setCareerInputs((prev) => ({ ...careerPrefill, ...prev }));
      setScheduleInputs((prev) => ({ ...schedulePrefill, ...prev }));
      setDocDeadlineInputs((prev) => ({ ...deadlinePrefill, ...prev }));
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
      assertCanEdit();
      const data: Record<string, any> = {};
      if (career) data.career_type = career;
      const tempIdTrim = tempId?.trim();
      const prevTrim = prevTemp?.trim();
      if (tempIdTrim) {
        if (tempIdTrim !== prevTrim) {
          data.temp_id = tempIdTrim;
          data.status = 'temp-id-issued';
        }
      }
      await adminAction(residentId, 'updateProfile', { fcId: id, data });
      if (phone && tempIdTrim && tempIdTrim !== prevTrim) {
        await sendNotificationAndPush(residentId, 'fc', phone, '임시번호가 발급 되었습니다.', `임시사번: ${tempIdTrim}`, '/consent');
      }
    },
    onSuccess: () => {
      Alert.alert('저장 완료', '임시번호/경력 정보가 저장되었습니다.');
      refetch();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '저장 중 문제가 발생했습니다.';
        Alert.alert('저장 실패', message);
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _updateDocs = useMutation({
    mutationFn: async ({ id, types, phone }: { id: string; types: string[]; phone?: string }) => {
      assertCanEdit();
      const uniqueTypes = Array.from(new Set(types));
      const currentDeadline = (data ?? []).find((fc) => fc.id === id)?.docs_deadline_at ?? null;
      await adminAction(residentId, 'updateDocReqs', {
        fcId: id,
        types: uniqueTypes,
        deadline: currentDeadline,
        currentDeadline,
      });
      if (phone) {
        await sendNotificationAndPush(
          residentId,
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
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '요청 처리 중 문제가 발생했습니다.';
        Alert.alert('요청 실패', message);
      }
    },
  });

    const updateDocReqs = useMutation({
      mutationFn: async ({
        id,
        types,
        phone,
        deadline,
        currentDeadline,
      }: {
        id: string;
        types: string[];
        phone?: string;
        deadline?: string;
        currentDeadline?: string | null;
      }) => {
        assertCanEdit();
        const uniqueTypes = Array.from(new Set(types));
        const normalizedDeadline = normalizeDateInput(deadline);
        const deadlineTrimmed = (deadline ?? '').trim();
        if (deadlineTrimmed && !normalizedDeadline) {
          throw new Error('마감일은 YYYY-MM-DD 형식으로 입력해주세요.');
        }

        await adminAction(residentId, 'updateDocReqs', {
          fcId: id,
          types: uniqueTypes,
          deadline: normalizedDeadline,
          currentDeadline,
        });

        if (phone) {
          await sendNotificationAndPush(
            residentId,
            'fc',
            phone,
            '서류 요청 안내',
            '필수 서류 요청이 수정되었습니다. 새로운 서류를 제출해주세요.',
            '/docs-upload',
          );
        }
      },
    onSuccess: () => {
      Alert.alert('저장 완료', '필수 서류 목록이 수정되었습니다.');
      refetch();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '서류 목록 수정 중 문제가 발생했습니다.';
        Alert.alert('오류', message);
      }
    },
  });

  const deleteFc = useMutation({
    mutationFn: async ({ id, phone }: { id: string; phone?: string | null }) => {
      assertCanEdit();
      if (phone) {
        const { data, error } = await supabase.functions.invoke<{ ok?: boolean; deleted?: boolean; error?: string }>('delete-account', {
          body: { residentId: phone },
        });
        if (error) {
          logger.warn('[deleteFc] delete-account failed, fallback to admin-action', error.message ?? error);
        } else if (data?.ok && data?.deleted) {
          return;
        } else {
          logger.warn('[deleteFc] delete-account returned non-deleted result, fallback to admin-action', data);
        }
      }
      // Fallback: use admin-action Edge Function (bypasses RLS)
      await adminAction(residentId, 'deleteFc', { fcId: id, phone });
    },
    onSuccess: () => {
      Alert.alert('삭제 완료', '선택한 FC 기록이 삭제되었습니다.');
      refetch();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '삭제 중 문제가 발생했습니다.';
        Alert.alert('삭제 실패', message);
      }
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      nextStatus,
      extra,
    }: {
      id: string;
      nextStatus: FcProfile['status'];
      extra?: Record<string, any>;
    }) => {
      assertCanEdit();
      await adminAction(residentId, 'updateStatus', { fcId: id, status: nextStatus, extra });
    },
    onSuccess: () => {
      Alert.alert('처리 완료', '상태가 업데이트되었습니다.');
      refetch();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '상태 업데이트 중 문제가 발생했습니다.';
        Alert.alert('처리 실패', message);
      }
    },
  });

  const updateAppointmentDate = useMutation({
    mutationFn: async ({
      id,
      type,
      date,
      isReject = false,
      phone,
      rejectReason,
    }: {
      id: string;
      type: 'life' | 'nonlife';
      date: string | null;
      isReject?: boolean;
      phone: string;
      rejectReason?: string | null;
    }) => {
      assertCanEdit();
      await adminAction(residentId, 'updateAppointmentDate', {
        fcId: id, type, date, isReject, rejectReason,
      });

      if (isReject) {
        const title = type === 'life' ? '생명보험 위촉 반려' : '손해보험 위촉 반려';
        const body = rejectReason
          ? `위촉 완료일이 반려되었습니다.\n사유: ${rejectReason}`
          : '위촉 완료일이 반려되었습니다. 위촉을 다시 진행해주세요.';
        await sendNotificationAndPush(residentId, 'fc', phone, title, body, '/appointment');
      } else if (date) {
        const title = type === 'life' ? '생명 위촉이 승인되었습니다.' : '손해 위촉이 승인되었습니다.';
        await sendNotificationAndPush(residentId, 'fc', phone, title, title, '/');
      }
    },
    onSuccess: (_, vars) => {
      const label = vars.type === 'life' ? '생명' : '손해';
      Alert.alert('처리 완료', `${label} 위촉 정보가 ${vars.isReject ? '반려' : '저장'}되었습니다.`);
      refetch();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '위촉 정보 처리 중 문제가 발생했습니다.';
        Alert.alert('오류', message);
      }
    },
  });

  const updateAppointmentSchedule = useMutation({
    mutationFn: async ({
      id,
      life,
      nonlife,
      phone,
    }: {
      id: string;
      life?: string | null;
      nonlife?: string | null;
      phone?: string | null;
    }) => {
      assertCanEdit();
      logger.debug('[appointment-schedule] mutate', { id, life, nonlife });
      await adminAction(residentId, 'updateAppointmentSchedule', { fcId: id, life, nonlife });
    },
    onSuccess: async (_, vars) => {
      logger.debug('[appointment-schedule] success', vars);
      Alert.alert('저장 완료', '위촉 예정월이 저장되었습니다.');
      if (vars.phone) {
        await sendNotificationAndPush(
          residentId,
          'fc',
          vars.phone,
          '위촉 차수 안내',
          '총무가 위촉 차수를 입력했습니다. 위촉을 진행해주세요.',
          '/appointment',
        );
      }
      // 최신 데이터 반영
      refetch();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '위촉 예정 월 저장 중 오류가 발생했습니다.';
        logger.debug('[appointment-schedule] error', message);
        Alert.alert('저장 실패', message);
      }
    },
  });

  const updateDocStatus = useMutation({
    mutationFn: async ({
      fcId,
      docType,
      status,
      phone,
      reviewerNote,
    }: {
      fcId: string;
      docType: string;
      status: 'approved' | 'rejected' | 'pending';
      phone: string;
      reviewerNote?: string | null;
    }) => {
      assertCanEdit();
      const result = await adminAction(residentId, 'updateDocStatus', {
        fcId, docType, status, reviewerNote,
      });
      if (result.allApproved) {
        await sendNotificationAndPush(
          residentId,
          'fc',
          phone,
          '서류 검토 완료',
          '모든 서류가 승인되었습니다. 위촉 계약 단계로 진행해주세요.',
        );
      }
    },
    onSuccess: async (_, vars) => {
      const { status, docType, phone, reviewerNote } = vars;
      if (status === 'approved') {
        Alert.alert('승인 완료', `${docType} 서류가 승인되었습니다.`);
        await sendNotificationAndPush(
          residentId,
          'fc',
          phone,
          '서류 승인',
          `${docType} 서류가 승인되었습니다.`,
          '/docs-upload',
        );
      } else if (status === 'rejected') {
        Alert.alert('미승인 처리', `${docType} 서류를 미승인으로 변경했습니다.`);
        await sendNotificationAndPush(
          residentId,
          'fc',
          phone,
          '서류 반려',
          reviewerNote
            ? `${docType} 서류가 미승인 처리되었습니다.\n사유: ${reviewerNote}`
            : `${docType} 서류가 미승인 처리되었습니다. 내용을 확인해주세요.`,
          '/docs-upload',
        );
      } else {
        Alert.alert('승인 해제', `${docType} 서류의 승인이 해제되었습니다.`);
      }
      refetch();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '문서 상태 업데이트 실패';
        Alert.alert('오류', message);
      }
    },
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
    if (!canEdit) {
      Alert.alert('권한 없음', '본부장은 조회 전용 계정입니다.');
      return;
    }
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
            await adminAction(residentId, 'deleteDocFile', { fcId, docType, storagePath });
            Alert.alert('삭제 완료', '파일을 삭제했습니다.');
            refetch();
          } catch (err: unknown) {
            const error = err as Error;
            Alert.alert('삭제 실패', error?.message ?? '파일 삭제 중 문제가 발생했습니다.');
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
    // Affiliation Filter Logic
    if (affiliationFilter !== '전체') {
      filtered = filtered.filter((fc) => fc.affiliation === affiliationFilter);
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
  }, [processedRows, statusFilter, subFilter, filterOptions, affiliationFilter]);

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

  const toggleExpand = (id: string) => {
    if (ALLOW_LAYOUT_ANIM) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } else {
      logger.debug('[dashboard] skip LayoutAnimation (Android)');
    }
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleEditMode = (id: string) => {
    if (ALLOW_LAYOUT_ANIM) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } else {
      logger.debug('[dashboard] skip LayoutAnimation (Android)');
    }
    setEditMode((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSendReminder = async (fc: FcRow) => {
    try {
      setReminderLoading(fc.id);
      await sendNotificationAndPush(
        residentId,
        'fc',
        fc.phone,
        '등록 안내',
        '수당동의를 완료해주세요.',
      );
      Alert.alert('알림 전송', '진행을 재촉하는 알림을 발송했습니다.');
    } catch (err: unknown) {
      const error = err as Error;
      Alert.alert('전송 실패', error?.message ?? '알림 전송 중 문제가 발생했습니다.');
    } finally {
      setReminderLoading(null);
    }
  };

  const handleDeleteRequest = (fc: FcRow) => {
    setDeleteTargetId(fc.id);
    setDeleteTargetName(fc.name || 'FC');
    setDeleteTargetPhone(fc.phone || null);
    setDeleteCode('');
    setDeleteModalVisible(true);
  };

  const confirmDeleteWithCode = () => {
    // Robust check: remove all whitespace
    const code = deleteCode.replace(/\s/g, '');
    if (code === '1111') {
      if (deleteTargetId) {
        deleteFc.mutate({ id: deleteTargetId, phone: deleteTargetPhone });
      }
      setDeleteModalVisible(false);
    } else {
      Alert.alert('인증 실패', '총무 코드가 올바르지 않습니다.');
    }
  };

  const openDocRejectModal = (target: { fcId: string; docType: string; phone: string }) => {
    setDocRejectTarget(target);
    setDocRejectReason('');
    setDocRejectModalVisible(true);
  };

  const openAppointmentRejectModal = (target: { id: string; type: 'life' | 'nonlife'; phone: string }) => {
    setAppointmentRejectTarget(target);
    setAppointmentRejectReason('');
    setAppointmentRejectModalVisible(true);
  };
  const openRejectModal = (fc: FcRow) => {
    setRejectTarget(fc);
    setRejectReason('');
    setRejectModalVisible(true);
  };

  const confirmRejectWithReason = async () => {
    const reason = rejectReason.trim();
    if (!rejectTarget) return;
    if (!reason) {
      Alert.alert('입력 필요', '반려 사유를 입력해주세요.');
      return;
    }
    try {
      await updateStatus.mutateAsync({
        id: rejectTarget.id,
        nextStatus: 'allowance-pending',
        extra: { allowance_date: null, allowance_reject_reason: reason },
      });
      await sendNotificationAndPush(
        residentId,
        'fc',
        rejectTarget.phone,
        '수당 동의 반려',
        `수당 동의가 반려되었습니다.\n사유: ${reason}`,
        '/consent',
      );
      setRejectModalVisible(false);
    } catch (err: unknown) {
      const error = err as Error;
      Alert.alert('처리 실패', error?.message ?? '반려 처리 중 문제가 발생했습니다.');
    }
  };

  const confirmDocRejectWithReason = async () => {
    const reason = docRejectReason.trim();
    if (!docRejectTarget) return;
    if (!reason) {
      Alert.alert('입력 필요', '반려 사유를 입력해주세요.');
      return;
    }
    try {
      await updateDocStatus.mutateAsync({
        fcId: docRejectTarget.fcId,
        docType: docRejectTarget.docType,
        status: 'rejected',
        phone: docRejectTarget.phone,
        reviewerNote: reason,
      });
      setDocRejectModalVisible(false);
    } catch (err: unknown) {
      const error = err as Error;
      Alert.alert('처리 실패', error?.message ?? '반려 처리 중 문제가 발생했습니다.');
    }
  };

  const confirmAppointmentRejectWithReason = async () => {
    const reason = appointmentRejectReason.trim();
    if (!appointmentRejectTarget) return;
    if (!reason) {
      Alert.alert('입력 필요', '반려 사유를 입력해주세요.');
      return;
    }
    try {
      await updateAppointmentDate.mutateAsync({
        id: appointmentRejectTarget.id,
        type: appointmentRejectTarget.type,
        date: null,
        isReject: true,
        phone: appointmentRejectTarget.phone,
        rejectReason: reason,
      });
      setAppointmentRejectModalVisible(false);
    } catch (err: unknown) {
      const error = err as Error;
      Alert.alert('처리 실패', error?.message ?? '반려 처리 중 문제가 발생했습니다.');
    }
  };
  const renderAdminActions = (fc: FcRow) => {
    if (role !== 'admin') return null;
    const isEditing = canEdit ? !!editMode[fc.id] : false;
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
              style={[styles.actionButtonPrimary, !canEdit && styles.actionButtonDisabled]}
              onPress={() => handleSendReminder(fc)}
              disabled={!canEdit || reminderLoading === fc.id}
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
                        { flex: 1, alignItems: 'center', justifyContent: 'center' },
                        !canEdit && { opacity: 0.6 },
                      ]}
                      onPress={() => setCareerInputs((prev) => ({ ...prev, [fc.id]: type }))}
                      disabled={!canEdit}
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
                  placeholderTextColor="#9CA3AF"
                  onChangeText={(t) => setTempInputs((prev) => ({ ...prev, [fc.id]: t }))}
                  editable={canEdit}
                />
                <Pressable
                  style={[
                    styles.saveBtn,
                    { paddingHorizontal: 20 },
                    (!canEdit || updateTemp.isPending) && styles.actionButtonDisabled
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
                  disabled={!canEdit || updateTemp.isPending}
                >
                  <Text style={styles.saveBtnText}>
                    {updateTemp.isPending ? '저장중...' : hasSavedTemp && currentTemp === fc.temp_id ? '수정' : '저장'}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.allowanceInfoRow}>
                <View style={[styles.allowanceBadge, fc.allowance_date ? styles.allowanceBadgeDone : styles.allowanceBadgePending]}>
                  <Text style={[styles.allowanceBadgeText, fc.allowance_date ? styles.allowanceBadgeTextDone : styles.allowanceBadgeTextPending]}>
                    {fc.allowance_date ? '입력됨' : '미입력'}
                  </Text>
                </View>
                <Text style={styles.allowanceDateText}>
                  {fc.allowance_date ? `수당 동의일: ${fc.allowance_date}` : '수당 동의일 입력 대기'}
                </Text>
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: '#F3F4F6', marginBottom: 16 }} />

            {/* Allowance Consent Section */}
            <View style={styles.cardHeaderRow}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: CHARCOAL }}>수당동의 여부</Text>
                <MobileStatusToggle
                  value={
                    fc.status === 'allowance-consented' ||
                    ['docs-requested', 'docs-pending', 'docs-submitted', 'docs-rejected', 'docs-approved', 'appointment-completed', 'final-link-sent'].includes(fc.status)
                      ? 'approved'
                      : 'pending'
                  }
                  neutralPending={!fc.allowance_date || fc.status === 'allowance-pending'}
                  onChange={async (val) => {
                  if (val === 'approved') {
                    try {
                      await updateStatus.mutateAsync({
                        id: fc.id,
                        nextStatus: 'allowance-consented',
                        extra: { allowance_reject_reason: null },
                      });
                      await sendNotificationAndPush(
                        residentId,
                        'fc',
                        fc.phone,
                        '수당동의 승인',
                        '수당 동의가 승인되었습니다. 서류 제출 단계로 진행해주세요.',
                        '/docs-upload',
                      );
                    } catch (err: unknown) {
      const error = err as Error;
                      Alert.alert('처리 실패', error?.message ?? '상태 업데이트 중 문제가 발생했습니다.');
                    }
                    return;
                  }
                  openRejectModal(fc);
                }}
                labelPending="미승인"
                labelApproved="승인 완료"
                showNeutralForPending
                allowPendingPress
                readOnly={!canEdit}
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
        const submittedDocTypes = new Set(submittedDocs.map((d) => d.doc_type));

        actionBlocks.push(
          <View key="docs-actions" style={styles.cardSection}>
            <Text style={styles.cardTitle}>2단계: 제출된 서류 검토</Text>

            {/* Document Request UI */}
            <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: CHARCOAL }}>필수 서류 요청</Text>
                  <Pressable
                    style={[styles.docSaveButton, (!canEdit || updateDocReqs.isPending) && styles.actionButtonDisabled]}
                    onPress={() =>
                      updateDocReqs.mutate({
                        id: fc.id,
                        types: Array.from(docSelections[fc.id] ?? new Set<string>()),
                        phone: fc.phone,
                        deadline: docDeadlineInputs[fc.id],
                        currentDeadline: fc.docs_deadline_at ?? null,
                      })
                    }
                    disabled={!canEdit || updateDocReqs.isPending}
                  >
                    <Text style={styles.docSaveButtonText}>
                      {updateDocReqs.isPending ? '저장중...' : '요청 저장'}
                    </Text>
                  </Pressable>
                </View>

                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: MUTED, minWidth: 70 }}>서류 마감일</Text>
                  <Pressable
                    style={[styles.dateSelectButton, { flex: 1 }, !canEdit && { opacity: 0.6 }]}
                    disabled={!canEdit}
                    onPress={() => {
                      const baseDate = parseYmd(docDeadlineInputs[fc.id]) ?? new Date();
                      setDocDeadlineTempDate(baseDate);
                      setDocDeadlinePickerId(fc.id);
                    }}
                  >
                    <Text
                      style={[
                        styles.dateSelectText,
                        !docDeadlineInputs[fc.id] && styles.dateSelectPlaceholder,
                      ]}
                    >
                      {docDeadlineInputs[fc.id]
                        ? formatKoreanDate(parseYmd(docDeadlineInputs[fc.id]) ?? new Date())
                        : '날짜를 선택하세요'}
                    </Text>
                    <Feather name="calendar" size={16} color={MUTED} />
                  </Pressable>
                </View>
                {Platform.OS !== 'ios' && docDeadlinePickerId === fc.id && (
                  <DateTimePicker
                    value={parseYmd(docDeadlineInputs[fc.id]) ?? new Date()}
                    mode="date"
                    display="default"
                    locale="ko-KR"
                    onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
                      setDocDeadlinePickerId(null);
                      if (event.type === 'dismissed') return;
                      if (selectedDate) {
                        setDocDeadlineInputs((prev) => ({ ...prev, [fc.id]: toYmd(selectedDate) }));
                      }
                    }}
                  />
                )}

                <View style={styles.docChips}>
                {ALL_DOC_OPTIONS.map((doc) => {
                  const isSelected = docSelections[fc.id]?.has(doc);
                  const isSubmitted = submittedDocTypes.has(doc);
                  const textColor = isSubmitted ? BLUE : isSelected ? ORANGE : CHARCOAL;
                  return (
                    <Pressable
                      key={doc}
                      style={[
                        styles.docChip,
                        isSelected && styles.docChipRequested,
                        isSubmitted && styles.docChipSubmitted,
                      ]}
                      onPress={() => toggleDocSelection(fc.id, doc)}
                      disabled={!canEdit}
                    >
                      <Text style={[styles.docChipText, { color: textColor }]}>{doc}</Text>
                    </Pressable>
                  );
                })}
                {Array.from(docSelections[fc.id] ?? []).filter((d) => !ALL_DOC_OPTIONS.includes(d)).map((doc) => {
                  const isSubmitted = submittedDocTypes.has(doc);
                  const textColor = isSubmitted ? BLUE : ORANGE;
                  return (
                    <Pressable
                      key={doc}
                      style={[
                        styles.docChip,
                        styles.docChipRequested,
                        isSubmitted && styles.docChipSubmitted,
                      ]}
                      onPress={() => toggleDocSelection(fc.id, doc)}
                      disabled={!canEdit}
                    >
                      <Text style={[styles.docChipText, { color: textColor }]}>{doc}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                <TextInput
                  style={[styles.miniInput, { flex: 1, backgroundColor: '#fff' }]}
                  placeholder="기타 서류 입력"
                  placeholderTextColor="#6B7280"
                  value={customDocInputs[fc.id] || ''}
                  onChangeText={(text) =>
                    setCustomDocInputs((prev) => ({ ...prev, [fc.id]: normalizeCustomDocInput(text) }))
                  }
                  editable={canEdit}
                />
                <Pressable
                  style={[styles.saveBtn, { backgroundColor: '#4b5563' }, !canEdit && styles.actionButtonDisabled]}
                  onPress={() => addCustomDoc(fc.id)}
                  disabled={!canEdit}
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
                          neutralPending={doc.status === 'pending'}
                          onChange={(val) => {
                            if (doc.status === 'approved' && val !== 'approved') {
                              Alert.alert('승인 해제', '이미 승인된 서류입니다. 미승인으로 변경할까요?', [
                                { text: '취소', style: 'cancel' },
                                  {
                                    text: '변경',
                                    style: 'destructive',
                                    onPress: () =>
                                      openDocRejectModal({ fcId: fc.id, docType, phone: fc.phone }),
                                  },
                                ]);
                              return;
                            }
                            if (val === 'approved') {
                              updateDocStatus.mutate({
                                fcId: fc.id,
                                docType,
                                status: 'approved',
                                phone: fc.phone,
                                reviewerNote: null,
                              });
                              return;
                            }
                            if (doc.status === 'pending') {
                              openDocRejectModal({ fcId: fc.id, docType, phone: fc.phone });
                              return;
                            }
                            updateDocStatus.mutate({
                              fcId: fc.id,
                              docType,
                              status: 'pending',
                              phone: fc.phone,
                              reviewerNote: null,
                            });
                          }}
                          labelPending="미승인"
                          labelApproved="승인"
                        showNeutralForPending
                        allowPendingPress
                        readOnly={!canEdit}
                      />
                      <Pressable
                        style={[styles.deleteIconButton, !canEdit && { opacity: 0.4 }]}
                        disabled={!canEdit}
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
                <Text style={styles.scheduleInputLabel}>생명 위촉 차수</Text>
                <TextInput
                  style={styles.scheduleInput}
                  placeholder="예:12월 1차 / 1월 3차"
                  placeholderTextColor="#9CA3AF"
                  value={scheduleInput.life ?? ''}
                  onChangeText={(t) =>
                    setScheduleInputs((prev) => ({
                      ...prev,
                      [fc.id]: { ...(prev[fc.id] ?? {}), life: t },
                    }))
                  }
                  editable={canEdit}
                />
              </View>
              <View style={styles.scheduleInputGroup}>
                <Text style={styles.scheduleInputLabel}>손해 위촉 차수</Text>
                <TextInput
                  style={styles.scheduleInput}
                  placeholder="예: 12월 1차 / 1월 3차"
                  placeholderTextColor="#9CA3AF"
                  value={scheduleInput.nonlife ?? ''}
                  onChangeText={(t) =>
                    setScheduleInputs((prev) => ({
                      ...prev,
                      [fc.id]: { ...(prev[fc.id] ?? {}), nonlife: t },
                    }))
                  }
                  editable={canEdit}
                />
              </View>
              <Pressable
                style={[styles.saveBtn, (!canEdit || updateAppointmentSchedule.isPending) && styles.actionButtonDisabled]}
                disabled={!canEdit || updateAppointmentSchedule.isPending}
                onPress={() => {
                  const lifeVal = (scheduleInput.life ?? '').trim();
                  const nonlifeVal = (scheduleInput.nonlife ?? '').trim();
                  if (!lifeVal && !nonlifeVal) {
                    Alert.alert('입력 확인', '예정월을 하나 이상 입력해주세요.');
                    return;
                  }
                  logger.debug('[appointment-schedule] press', {
                    id: fc.id,
                    life: lifeVal,
                    nonlife: nonlifeVal,
                  });
                  updateAppointmentSchedule.mutate({
                    id: fc.id,
                    life: lifeVal || null,
                    nonlife: nonlifeVal || null,
                    phone: fc.phone,
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
                  neutralPending={!fc.appointment_date_life_sub && !fc.appointment_reject_reason_life}
                  onChange={(val) => {
                    const fallbackDate = () => fc.appointment_date_life || new Date().toISOString().split('T')[0];

                    if (val === 'approved') {
                      if (!fc.appointment_date_life_sub) {
                        Alert.alert('확인', 'FC가 위촉 완료일(생명)을 제출하지 않았습니다.');
                        return;
                      }
                      if (!lifeVal) {
                        Alert.alert('확인', '위촉 예정월(생명)이 입력되지 않았습니다.\n예정월을 먼저 저장해주세요.');
                        return;
                      }
                      updateAppointmentDate.mutate({
                        id: fc.id,
                        type: 'life',
                        date: fallbackDate(),
                        phone: fc.phone,
                      });
                    } else {
                      openAppointmentRejectModal({ id: fc.id, type: 'life', phone: fc.phone });
                    }
                  }}
                  labelPending="미승인"
                  labelApproved="승인"
                showNeutralForPending
                allowPendingPress
                readOnly={!canEdit}
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
                  neutralPending={!fc.appointment_date_nonlife_sub && !fc.appointment_reject_reason_nonlife}
                  onChange={(val) => {
                    const fallbackDate = () => fc.appointment_date_nonlife || new Date().toISOString().split('T')[0];

                    if (val === 'approved') {
                      if (!fc.appointment_date_nonlife_sub) {
                        Alert.alert('확인', 'FC가 위촉 완료일(손해)을 제출하지 않았습니다.');
                        return;
                      }
                      if (!nonlifeVal) {
                        Alert.alert('확인', '위촉 예정월(손해)이 입력되지 않았습니다.\n예정월을 먼저 저장해주세요.');
                        return;
                      }
                      updateAppointmentDate.mutate({
                        id: fc.id,
                        type: 'nonlife',
                        date: fallbackDate(),
                        phone: fc.phone,
                      });
                    } else {
                      openAppointmentRejectModal({ id: fc.id, type: 'nonlife', phone: fc.phone });
                    }
                  }}
                  labelPending="미승인"
                  labelApproved="승인"
                showNeutralForPending
                allowPendingPress
                readOnly={!canEdit}
              />
            </View>
          </View>,
        );
      }

      if (canEdit) {
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
              onPress={() => handleDeleteRequest(fc)}
              disabled={deleteFc.isPending}
            >
              <Feather name="trash-2" size={16} color="#b91c1c" />
              <Text style={styles.deleteText}>{deleteFc.isPending ? '삭제중...' : 'FC 정보 삭제'}</Text>
            </Pressable>
          </View>,
        );
      }
    }

    return (
      <View style={styles.actionArea}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>{canEdit ? '관리자 액션' : '관리자 현황 (읽기 전용)'}</Text>
          {canEdit && (
            <Pressable style={styles.toggleEditButton} onPress={() => toggleEditMode(fc.id)}>
              <Text style={styles.toggleEditText}>
                {isEditing ? '닫기' : '정보 수정 및 서류 재설정'}
              </Text>
              <Feather name={isEditing ? 'chevron-up' : 'settings'} size={14} color={MUTED} />
            </Pressable>
          )}
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
                  placeholderTextColor={MUTED}
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
                        deadline: docDeadlineInputs[fc.id],
                        currentDeadline: fc.docs_deadline_at ?? null,
                      })
                    }
                    disabled={updateDocReqs.isPending}
                  >
                    <Text style={{ color: ORANGE, fontWeight: '700', fontSize: 13 }}>
                      {updateDocReqs.isPending ? '저장중...' : '적용 저장'}
                    </Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: MUTED, minWidth: 70 }}>서류 마감일</Text>
                  <Pressable
                    style={[styles.dateSelectButton, { flex: 1 }, !canEdit && { opacity: 0.6 }]}
                    disabled={!canEdit}
                    onPress={() => {
                      const baseDate = parseYmd(docDeadlineInputs[fc.id]) ?? new Date();
                      setDocDeadlineTempDate(baseDate);
                      setDocDeadlinePickerId(fc.id);
                    }}
                  >
                    <Text
                      style={[
                        styles.dateSelectText,
                        !docDeadlineInputs[fc.id] && styles.dateSelectPlaceholder,
                      ]}
                    >
                      {docDeadlineInputs[fc.id]
                        ? formatKoreanDate(parseYmd(docDeadlineInputs[fc.id]) ?? new Date())
                        : '날짜를 선택하세요'}
                    </Text>
                    <Feather name="calendar" size={16} color={MUTED} />
                  </Pressable>
                </View>
                {Platform.OS !== 'ios' && docDeadlinePickerId === fc.id && (
                  <DateTimePicker
                    value={parseYmd(docDeadlineInputs[fc.id]) ?? new Date()}
                    mode="date"
                    display="default"
                    locale="ko-KR"
                    onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
                      setDocDeadlinePickerId(null);
                      if (event.type === 'dismissed') return;
                      if (selectedDate) {
                        setDocDeadlineInputs((prev) => ({ ...prev, [fc.id]: toYmd(selectedDate) }));
                      }
                    }}
                  />
                )}
                {(() => {
                const submittedDocTypes = new Set(
                  (fc.fc_documents ?? [])
                    .filter((d) => d.storage_path && d.storage_path !== 'deleted')
                    .map((d) => d.doc_type),
                );
                return (
              <View style={styles.docChips}>
                {ALL_DOC_OPTIONS.map((doc) => {
                  const isSelected = docSelections[fc.id]?.has(doc);
                  const isSubmitted = submittedDocTypes.has(doc);
                  const textColor = isSubmitted ? BLUE : isSelected ? ORANGE : CHARCOAL;
                  return (
                    <Pressable
                      key={doc}
                      style={[
                        styles.docChip,
                        isSelected && styles.docChipRequested,
                        isSubmitted && styles.docChipSubmitted,
                      ]}
                      onPress={() => toggleDocSelection(fc.id, doc)}
                      disabled={!canEdit}
                    >
                      <Text style={[styles.docChipText, { color: textColor }]}>{doc}</Text>
                    </Pressable>
                  );
                })}
                {Array.from(docSelections[fc.id] ?? []).filter((d) => !ALL_DOC_OPTIONS.includes(d)).map((doc) => {
                  const isSubmitted = submittedDocTypes.has(doc);
                  const textColor = isSubmitted ? BLUE : ORANGE;
                  return (
                    <Pressable
                      key={doc}
                      style={[
                        styles.docChip,
                        styles.docChipRequested,
                        isSubmitted && styles.docChipSubmitted,
                      ]}
                      onPress={() => toggleDocSelection(fc.id, doc)}
                      disabled={!canEdit}
                    >
                      <Text style={[styles.docChipText, { color: textColor }]}>{doc}</Text>
                    </Pressable>
                  );
                })}
              </View>
                );
              })()}

              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                <TextInput
                  style={[styles.miniInput, { height: 36 }]}
                  placeholder="기타 서류 입력"
                  placeholderTextColor="#6B7280"
                  value={customDocInputs[fc.id] || ''}
                  onChangeText={(text) =>
                    setCustomDocInputs((prev) => ({ ...prev, [fc.id]: normalizeCustomDocInput(text) }))
                  }
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
        contentContainerStyle={{ paddingBottom: (deleteModalVisible ? 0 : keyboardPadding) + 40 }}
      >
        <Modal
          visible={rejectModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setRejectModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setRejectModalVisible(false)}>
              <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.modalTitle}>수당 동의 반려</Text>
                <Text style={styles.modalText}>
                  {rejectTarget?.name || 'FC'} 님에게 전달할 반려 사유를 입력해주세요.
                </Text>

                <Text style={styles.modalLabel}>반려 사유</Text>
                <TextInput
                  style={[styles.modalInput, styles.rejectReasonInput]}
                  value={rejectReason}
                  onChangeText={setRejectReason}
                  placeholder="예: 서명 누락, 내용 확인 필요"
                  placeholderTextColor="#9CA3AF"
                  multiline
                />

                <View style={styles.modalButtons}>
                  <Pressable
                    style={[styles.modalBtn, styles.modalBtnCancel]}
                    onPress={() => setRejectModalVisible(false)}
                  >
                    <Text style={styles.modalBtnTextCancel}>취소</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalBtn, styles.modalBtnDelete]}
                    onPress={confirmRejectWithReason}
                  >
                    <Text style={styles.modalBtnTextDelete}>반려</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
          </Modal>

          <Modal
            visible={docRejectModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setDocRejectModalVisible(false)}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={{ flex: 1 }}
            >
              <Pressable style={styles.modalOverlay} onPress={() => setDocRejectModalVisible(false)}>
                <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
                  <Text style={styles.modalTitle}>서류 미승인 처리</Text>
                  <Text style={styles.modalText}>
                    {docRejectTarget?.docType ?? '서류'}에 대한 반려 사유를 입력해주세요.
                  </Text>

                  <Text style={styles.modalLabel}>반려 사유</Text>
                  <TextInput
                    style={[styles.modalInput, styles.rejectReasonInput]}
                    value={docRejectReason}
                    onChangeText={setDocRejectReason}
                    placeholder="예: 서명 누락, 내용 확인 필요"
                    placeholderTextColor="#9CA3AF"
                    multiline
                  />

                  <View style={styles.modalButtons}>
                    <Pressable
                      style={[styles.modalBtn, styles.modalBtnCancel]}
                      onPress={() => setDocRejectModalVisible(false)}
                    >
                      <Text style={styles.modalBtnTextCancel}>취소</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.modalBtn, styles.modalBtnDelete]}
                      onPress={confirmDocRejectWithReason}
                    >
                      <Text style={styles.modalBtnTextDelete}>미승인</Text>
                    </Pressable>
                  </View>
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>

          <Modal
            visible={appointmentRejectModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setAppointmentRejectModalVisible(false)}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={{ flex: 1 }}
            >
              <Pressable style={styles.modalOverlay} onPress={() => setAppointmentRejectModalVisible(false)}>
                <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
                  <Text style={styles.modalTitle}>위촉 미승인 처리</Text>
                  <Text style={styles.modalText}>
                    {appointmentRejectTarget?.type === 'life' ? '생명보험' : '손해보험'} 위촉 반려 사유를 입력해주세요.
                  </Text>

                  <Text style={styles.modalLabel}>반려 사유</Text>
                  <TextInput
                    style={[styles.modalInput, styles.rejectReasonInput]}
                    value={appointmentRejectReason}
                    onChangeText={setAppointmentRejectReason}
                    placeholder="예: 서류 누락, 일정 확인 필요"
                    placeholderTextColor="#9CA3AF"
                    multiline
                  />

                  <View style={styles.modalButtons}>
                    <Pressable
                      style={[styles.modalBtn, styles.modalBtnCancel]}
                      onPress={() => setAppointmentRejectModalVisible(false)}
                    >
                      <Text style={styles.modalBtnTextCancel}>취소</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.modalBtn, styles.modalBtnDelete]}
                      onPress={confirmAppointmentRejectWithReason}
                    >
                      <Text style={styles.modalBtnTextDelete}>미승인</Text>
                    </Pressable>
                  </View>
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>

          <Modal
            visible={deleteModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setDeleteModalVisible(false)}
          >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setDeleteModalVisible(false)}>
              <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.modalTitle}>FC 정보 삭제</Text>
                <Text style={styles.modalText}>
                  <Text style={{ fontWeight: '700' }}>{deleteTargetName}</Text> 님의 정보를 정말 삭제하시겠습니까?{'\n'}
                  프로필과 제출된 서류가 모두 삭제되며 복구할 수 없습니다.
                </Text>

                <Text style={styles.modalLabel}>총무 코드 입력</Text>
                <TextInput
                  style={styles.modalInput}
                  value={deleteCode}
                  onChangeText={setDeleteCode}
                  placeholder="1111"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  secureTextEntry
                  textAlign="center"
                  autoFocus
                />

                <View style={styles.modalButtons}>
                  <Pressable
                    style={[styles.modalBtn, styles.modalBtnCancel]}
                    onPress={() => setDeleteModalVisible(false)}
                  >
                    <Text style={styles.modalBtnTextCancel}>취소</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalBtn, styles.modalBtnDelete]}
                    onPress={confirmDeleteWithCode}
                  >
                    <Text style={styles.modalBtnTextDelete}>삭제</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
            </KeyboardAvoidingView>
          </Modal>

          {Platform.OS === 'ios' && (
            <Modal
              visible={Boolean(docDeadlinePickerId)}
              transparent
              animationType="fade"
              onRequestClose={() => setDocDeadlinePickerId(null)}
            >
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
              >
                <Pressable style={styles.modalOverlay} onPress={() => setDocDeadlinePickerId(null)}>
                  <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
                    <Text style={styles.modalTitle}>서류 마감일 선택</Text>
                    <DateTimePicker
                      value={docDeadlineTempDate ?? new Date()}
                      mode="date"
                      display="spinner"
                      locale="ko-KR"
                      onChange={(_, d) => {
                        if (d) setDocDeadlineTempDate(d);
                      }}
                    />
                    <View style={styles.modalButtons}>
                      <Pressable
                        style={[styles.modalBtn, styles.modalBtnCancel]}
                        onPress={() => setDocDeadlinePickerId(null)}
                      >
                        <Text style={styles.modalBtnTextCancel}>취소</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.modalBtn, styles.modalBtnConfirm]}
                        onPress={() => {
                          if (docDeadlinePickerId && docDeadlineTempDate) {
                            setDocDeadlineInputs((prev) => ({
                              ...prev,
                              [docDeadlinePickerId]: toYmd(docDeadlineTempDate),
                            }));
                          }
                          setDocDeadlinePickerId(null);
                        }}
                      >
                        <Text style={styles.modalBtnTextConfirm}>확인</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                </Pressable>
              </KeyboardAvoidingView>
            </Modal>
          )}

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

          {/* New: Affiliation Filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.filterContainer, { marginBottom: 8 }]}
          >
            {affiliationOptions.map((opt) => {
              const active = affiliationFilter === opt;
              return (
                <Pressable
                  key={opt}
                  style={[styles.filterTab, active && styles.filterTabActive]}
                  onPress={() => setAffiliationFilter(opt)}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>
                    {opt}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

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
          {isLoading && <ListSkeleton count={5} itemHeight={100} />}
          {isError && <Text style={{ color: '#dc2626', marginBottom: 8 }}>데이터를 불러오지 못했습니다.</Text>}
          {!isLoading && rows.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>조회된 내용이 없습니다.</Text>
            </View>
          )}

          {!isLoading && rows.map((fc, idx) => {
            const isExpanded = expanded[fc.id];
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
    backgroundColor: ORANGE,
    borderColor: ORANGE,
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
    color: CHARCOAL,
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
    color: CHARCOAL,
    backgroundColor: '#fff',
  },
  dateSelectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  dateSelectText: { fontSize: 13, color: CHARCOAL, fontWeight: '600' },
  dateSelectPlaceholder: { color: MUTED, fontWeight: '500' },
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
  docChipRequested: { borderColor: ORANGE },
  docChipSubmitted: { borderColor: BLUE },
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
    flexWrap: 'wrap',
    rowGap: 8,
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
  allowanceInfoRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  allowanceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  allowanceBadgeDone: { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' },
  allowanceBadgePending: { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb' },
  allowanceBadgeText: { fontSize: 11, fontWeight: '700' },
  allowanceBadgeTextDone: { color: '#059669' },
  allowanceBadgeTextPending: { color: '#6b7280' },
  allowanceDateText: { fontSize: 12, color: CHARCOAL },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: CHARCOAL, marginBottom: 12, textAlign: 'center' },
  modalText: { fontSize: 14, color: '#4b5563', textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: CHARCOAL, marginBottom: 8 },
  modalInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    height: 50,
    fontSize: 20,
    paddingHorizontal: 16,
    letterSpacing: 4,
    marginBottom: 24,
    backgroundColor: '#F9FAFB',
    color: CHARCOAL,
  },
  rejectReasonInput: {
    height: 'auto',
    minHeight: 90,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnCancel: { backgroundColor: '#F3F4F6' },
  modalBtnDelete: { backgroundColor: '#ef4444' },
  modalBtnConfirm: { backgroundColor: ORANGE },
  modalBtnTextCancel: { fontSize: 15, fontWeight: '600', color: '#4b5563' },
  modalBtnTextDelete: { fontSize: 15, fontWeight: '600', color: '#fff' },
  modalBtnTextConfirm: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
