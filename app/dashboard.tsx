import * as WebBrowser from 'expo-web-browser';
import { RefreshButton } from '@/components/RefreshButton';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { Feather, Ionicons } from '@expo/vector-icons';

import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { FcProfile, RequiredDocType } from '@/types/fc';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
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

const FILTER_OPTIONS = [
  { key: 'all', label: '전체', predicate: (_: FcRowWithStep) => true },
  ...STEP_KEYS.map((key) => ({
    key,
    label: STEP_LABELS[key],
    predicate: (fc: FcRowWithStep) => fc.stepKey === key,
  })),
] as const;
type FilterKey = (typeof FILTER_OPTIONS)[number]['key'];

const calcStep = (profile: FcRow) => {
  const hasBasicInfo =
    Boolean(profile.name && profile.affiliation && profile.resident_id_masked) &&
    Boolean(profile.email || profile.address);
  if (!hasBasicInfo) return 1;

  const hasAllowance = Boolean(profile.allowance_date);
  if (!hasAllowance) return 2;

  const docs = profile.fc_documents ?? [];
  const totalDocs = docs.length;
  const uploaded = docs.filter((d) => d.storage_path && d.storage_path !== 'deleted').length;
  const docsComplete = totalDocs > 0 && uploaded === totalDocs;
  if (!docsComplete) return 3;

  const approvedStatuses: FcProfile['status'][] = ['docs-approved', 'appointment-completed', 'final-link-sent'];
  const isApproved = approvedStatuses.includes(profile.status);
  if (!isApproved) return 3;

  const appointmentDone = Boolean(profile.appointment_date) || profile.status === 'final-link-sent';
  if (!appointmentDone) return 4;

  return 5;
};

const getStepKey = (profile: FcRow): StepKey => {
  const step = Math.max(1, Math.min(5, calcStep(profile)));
  return `step${step}` as StepKey;
};

const docOptions: RequiredDocType[] = [
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
const ALL_DOC_OPTIONS: RequiredDocType[] = Array.from(
  new Set<RequiredDocType>([
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
  fc_documents?: { doc_type: string; storage_path: string | null; file_name: string | null; status: string | null }[];
};
type FcRowWithStep = FcRow & { stepKey: StepKey };

async function sendNotificationAndPush(
  role: 'admin' | 'fc',
  residentId: string | null,
  title: string,
  body: string,
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
      data: { type: 'app_event', resident_id: residentId },
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
      'id,name,affiliation,phone,temp_id,status,allowance_date,appointment_url,appointment_date,resident_id_masked,career_type,email,address,address_detail,fc_documents(doc_type,storage_path,file_name,status)',
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
  const { role, residentId } = useSession();
  const { mode, status } = useLocalSearchParams<{ mode?: string; status?: string }>();
  const [statusFilter, setStatusFilter] = useState<FilterKey>('all');
  const [subFilter, setSubFilter] = useState<'all' | 'no-id' | 'has-id' | 'not-requested' | 'requested'>('all');
  const [keyword, setKeyword] = useState('');
  const [tempInputs, setTempInputs] = useState<Record<string, string>>({});
  const [careerInputs, setCareerInputs] = useState<Record<string, '신입' | '경력'>>({});
  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const [urlInputs, setUrlInputs] = useState<Record<string, string>>({});
  const [docSelections, setDocSelections] = useState<Record<string, Set<RequiredDocType>>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const keyboardPadding = useKeyboardPadding();

  const [reminderLoading, setReminderLoading] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', role, residentId, keyword],
    queryFn: () => fetchFcs(role, residentId, keyword),
    enabled: !!role,
  });

  useEffect(() => {
    if (!status) return;
    const found = FILTER_OPTIONS.find((option) => option.key === status);
    if (found) {
      setStatusFilter(found.key);
    }
  }, [status]);

  useEffect(() => {
    setSubFilter('all');
  }, [statusFilter]);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, Set<RequiredDocType>> = {};
    const tempPrefill: Record<string, string> = {};
    const careerPrefill: Record<string, '신입' | '경력'> = {};
    const urlPrefill: Record<string, string> = {};
    data.forEach((fc) => {
      const docs = fc.fc_documents?.map((d) => d.doc_type as RequiredDocType) ?? [];
      next[fc.id] = new Set(docs);
      if (fc.temp_id) tempPrefill[fc.id] = fc.temp_id;
      if (fc.career_type === '경력' || fc.career_type === '신입') careerPrefill[fc.id] = fc.career_type as any;
      if (fc.appointment_url) urlPrefill[fc.id] = fc.appointment_url;
    });
    setDocSelections(next);
    setTempInputs((prev) => ({ ...tempPrefill, ...prev }));
    setCareerInputs((prev) => ({ ...careerPrefill, ...prev }));
    setUrlInputs((prev) => ({ ...urlPrefill, ...prev }));
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
        await sendNotificationAndPush('fc', phone, '임시번호가 수정 되었습니다.', `임시사번: ${tempIdTrim}`);
      }
    },
    onSuccess: () => {
      Alert.alert('저장 완료', '임시번호/경력 정보가 저장되었습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('저장 실패', err.message ?? '저장 중 문제가 발생했습니다.'),
  });

  const saveUrl = useMutation({
    mutationFn: async ({ id, url }: { id: string; url: string }) => {
      const trimmed = (url ?? '').trim();
      if (!trimmed) throw new Error('URL을 입력해주세요.');

      const { error } = await supabase.from('fc_profiles').update({ appointment_url: trimmed }).eq('id', id);
      if (error) throw error;

      const { error: notifyError } = await supabase.functions.invoke('fc-notify', {
        body: {
          type: 'admin_update',
          fc_id: id,
          message: '위촉 URL이 등록되었습니다. 위촉을 진행해주세요.',
        },
      });
      if (notifyError) throw notifyError;
    },
    onSuccess: () => {
      Alert.alert('발송 완료', 'URL이 저장되고 알림이 발송되었습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('오류', err?.message ?? 'URL 발송 중 문제가 발생했습니다.'),
  });

  const updateDocs = useMutation({
    mutationFn: async ({ id, types, phone }: { id: string; types: RequiredDocType[]; phone?: string }) => {
      const uniqueTypes = Array.from(new Set(types));

      const { data: existingDocs, error: fetchErr } = await supabase
        .from('fc_documents')
        .select('doc_type,storage_path,file_name,status')
        .eq('fc_id', id);
      if (fetchErr) throw fetchErr;

      const existing = existingDocs ?? [];
      const existingTypes = existing.map((d) => d.doc_type as RequiredDocType);
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
    mutationFn: async ({ id, types }: { id: string; types: RequiredDocType[] }) => {
      const uniqueTypes = Array.from(new Set(types));

      const { data: currentDocs, error: fetchErr } = await supabase
        .from('fc_documents')
        .select('doc_type,storage_path')
        .eq('fc_id', id);
      if (fetchErr) throw fetchErr;

      const currentTypes = currentDocs?.map((d) => d.doc_type as RequiredDocType) ?? [];
      const selectedSet = new Set(uniqueTypes);

      const toDelete =
        currentDocs?.filter(
          (d) => !selectedSet.has(d.doc_type as RequiredDocType) && (!d.storage_path || d.storage_path === 'deleted'),
        ) ?? [];
      const toAdd = uniqueTypes.filter((t) => !currentTypes.includes(t));

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

  const toggleDocSelection = (fcId: string, doc: RequiredDocType) => {
    setDocSelections((prev) => {
      const set = new Set(prev[fcId] ?? []);
      if (set.has(doc)) set.delete(doc);
      else set.add(doc);
      return { ...prev, [fcId]: set };
    });
  };

  const processedRows = useMemo<FcRowWithStep[]>(() => {
    return (data ?? []).map((fc) => ({
      ...fc,
      stepKey: getStepKey(fc),
    }));
  }, [data]);

  const rows = useMemo<FcRowWithStep[]>(() => {
    const mainFilter = FILTER_OPTIONS.find((option) => option.key === statusFilter);
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
  }, [processedRows, statusFilter, subFilter]);

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
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleEditMode = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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

      if (fc.status === 'docs-pending') {
        actionBlocks.push(
          <View key="docs-actions" style={styles.actionColumn}>
            <Pressable style={styles.actionButtonPrimary} onPress={() => handleDocReview(fc)}>
              <Feather name="file-text" size={16} color="#fff" />
              <Text style={styles.actionButtonText}>서류 검토하기</Text>
            </Pressable>
            <Pressable
              style={styles.actionButtonSecondary}
              onPress={() => confirmStatusChange(fc, 'docs-approved', '문서 검토를 완료 처리할까요?')}
              disabled={updateStatus.isPending}
            >
              <Feather name="check-circle" size={16} color={CHARCOAL} />
              <Text style={styles.actionButtonTextSecondary}>검토 완료 처리</Text>
            </Pressable>
          </View>,
        );
      }

      if (fc.status === 'docs-approved' || fc.status === 'docs-submitted') {
        const currentUrl = urlInputs[fc.id] ?? fc.appointment_url ?? '';
        actionBlocks.push(
          <View key="final-actions" style={[styles.actionColumn, { gap: 10 }]}>
            <View style={styles.urlInputGroup}>
              <Text style={styles.urlLabel}>위촉 URL 입력</Text>
              <View style={styles.urlRow}>
                <TextInput
                  style={styles.urlInput}
                  placeholder="https://..."
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  value={currentUrl}
                  onChangeText={(t) => setUrlInputs((prev) => ({ ...prev, [fc.id]: t }))}
                />
                <Pressable
                  style={[styles.urlSendButton, saveUrl.isPending && styles.actionButtonDisabled]}
                  onPress={() => saveUrl.mutate({ id: fc.id, url: currentUrl })}
                  disabled={saveUrl.isPending}
                >
                  {saveUrl.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.urlSendButtonText}>전송</Text>
                  )}
                </Pressable>
              </View>
            </View>
            <Pressable
              style={styles.actionButtonPrimary}
              onPress={() => confirmStatusChange(fc, 'final-link-sent', '위촉 완료 상태로 변경할까요?')}
              disabled={updateStatus.isPending}
            >
              <Feather name="check-square" size={16} color="#fff" />
              <Text style={styles.actionButtonText}>위촉 완료 처리</Text>
            </Pressable>
          </View>,
        );
      }
    }

    return (
      <View style={styles.actionArea}>
        <View style={[styles.actionRow, { justifyContent: 'space-between', alignItems: 'center' }]}>
          <Text style={styles.adminLabel}>관리자 액션</Text>
          <Pressable style={styles.toggleEditButton} onPress={() => toggleEditMode(fc.id)}>
            <Text style={styles.toggleEditText}>
              {isEditing ? '수정 완료 (닫기)' : '정보 수정 및 서류 재설정'}
            </Text>
            <Feather name={isEditing ? 'chevron-up' : 'settings'} size={14} color={MUTED} />
          </Pressable>
        </View>

        {isEditing ? (
          <View style={styles.editPanel}>
            <View style={styles.editRow}>
              <Text style={styles.editLabel}>임시번호</Text>
              <View style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={styles.miniInput}
                  value={tempInputs[fc.id] ?? fc.temp_id ?? ''}
                  onChangeText={(t) => setTempInputs((p) => ({ ...p, [fc.id]: t }))}
                  placeholder="T-12345"
                />
                <Pressable
                  style={styles.saveBtn}
                  onPress={() =>
                    updateTemp.mutate({
                      id: fc.id,
                      tempId: tempInputs[fc.id] ?? fc.temp_id ?? '',
                      prevTemp: fc.temp_id ?? '',
                      career: careerInputs[fc.id] ?? '신입',
                      phone: fc.phone,
                    })
                  }
                >
                  <Text style={styles.saveBtnText}>변경</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.editRowVertical}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                <Text style={styles.editLabel}>필수 서류</Text>
                <Pressable
                  onPress={() =>
                    updateDocReqs.mutate({
                      id: fc.id,
                      types: Array.from(docSelections[fc.id] ?? new Set<RequiredDocType>()),
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
              </View>
            </View>
          </View>
        ) : (
          actionBlocks
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
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
            {FILTER_OPTIONS.map((option) => {
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
            const selectedDocs = Array.from(docSelections[fc.id] ?? new Set<RequiredDocType>());
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
                  <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#9CA3AF" />
                </Pressable>

                {isExpanded && (
                  <View style={styles.listBody}>
                    <View style={styles.divider} />

                    <DetailRow label="임시번호" value={tempDisplay} />
                    <DetailRow label="수당동의" value={allowanceDisplay} />
                    <DetailRow label="위촉 URL" value={fc.appointment_url ?? '발송 대기'} />
                    <DetailRow label="위촉 완료일" value={fc.appointment_date ?? '미입력'} />
                    <DetailRow label="경력구분" value={careerDisplay} />
                    <DetailRow label="이메일" value={fc.email ?? '-'} />
                    <DetailRow label="주소" value={`${fc.address ?? '-'} ${fc.address_detail ?? ''}`} />

                    {renderAdminActions(fc)}

                    {showTempSection && role === 'admin' && (
                      <View style={styles.adminSection}>
                        <Text style={styles.adminLabel}>관리자 수정</Text>
                        <View style={styles.inputGroup}>
                          <TextInput
                            style={styles.adminInput}
                            placeholder="임시번호 발급 완료"
                            placeholderTextColor="#9CA3AF"
                            value={tempInputs[fc.id] ?? fc.temp_id ?? ''}
                            onChangeText={(t) => setTempInputs((p) => ({ ...p, [fc.id]: t }))}
                          />
                          <Pressable
                            style={styles.saveButton}
                            onPress={() =>
                              updateTemp.mutate({
                                id: fc.id,
                                tempId: tempInputs[fc.id] ?? fc.temp_id ?? '',
                                prevTemp: fc.temp_id ?? '',
                                career: careerInputs[fc.id] ?? '신입',
                                phone: fc.phone,
                              })
                            }
                          >
                            <Text style={styles.saveButtonText}>저장</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}

                    {showDocsSection && role === 'admin' && (
                      <View style={{ marginTop: 12, gap: 10 }}>
                        <Text style={styles.adminLabel}>필수 서류 선택</Text>
                        <View style={styles.docPills}>
                          {docOptions.map((doc) => {
                            const set = docSelections[fc.id] ?? new Set<RequiredDocType>();
                            const active = set.has(doc);
                            const submittedDoc = submitted.find((s) => s.doc_type === doc);
                            return (
                              <Pressable
                                key={doc}
                                style={[
                                  styles.docPill,
                                  active && styles.docPillSelected,
                                  submittedDoc && styles.docPillSubmitted,
                                ]}
                                onPress={() => toggleDocSelection(fc.id, doc)}
                              >
                                <Text
                                  style={[
                                    styles.docPillText,
                                    active && styles.docPillTextSelected,
                                    submittedDoc && styles.docPillTextSubmitted,
                                  ]}
                                >
                                  {doc}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Pressable
                          style={[styles.saveButton, { alignSelf: 'flex-start' }]}
                            onPress={() =>
                              updateDocs.mutate({
                                id: fc.id,
                                types: Array.from(docSelections[fc.id] ?? new Set()),
                                phone: fc.phone,
                              })
                            }
                          >
                          <Text style={styles.saveButtonText}>서류 요청 저장</Text>
                        </Pressable>

                        <View style={styles.submittedBox}>
                          <Text style={styles.submittedTitle}>제출된 서류</Text>
                          {submitted.length ? (
                            submitted.map((doc) => (
                              <View key={doc.doc_type} style={styles.submittedRow}>
                                <Text style={styles.submittedText}>
                                  {doc.doc_type} · {doc.file_name ?? '-'}
                                </Text>
                                {doc.storage_path ? (
                                  <Pressable style={styles.openButton} onPress={() => openFile(doc.storage_path ?? undefined)}>
                                    <Text style={styles.openButtonText}>열기</Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            ))
                          ) : (
                            <Text style={styles.emptyText}>제출된 서류가 없습니다.</Text>
                          )}
                        </View>

                        <Pressable
                          style={styles.deleteButton}
                          onPress={() =>
                            Alert.alert('삭제 확인', '이 FC 기록을 삭제할까요?', [
                              { text: '취소', style: 'cancel' },
                              { text: '삭제', style: 'destructive', onPress: () => deleteFc.mutate(fc.id) },
                            ])
                          }
                        >
                          <Feather name="trash-2" size={14} color="#b91c1c" />
                          <Text style={styles.deleteText}>FC 정보 삭제</Text>
                        </Pressable>
                      </View>
                    )}
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
    fontSize: 13,
    color: MUTED,
  },
  listBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  detailLabel: {
    fontSize: 13,
    color: MUTED,
  },
  detailValue: {
    fontSize: 13,
    color: CHARCOAL,
    fontWeight: '500',
  },
  adminSection: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 10,
  },
  adminLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: CHARCOAL,
  },
  actionArea: {
    marginTop: 12,
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
  saveButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  urlInputGroup: { gap: 6 },
  urlLabel: { fontSize: 12, fontWeight: '700', color: CHARCOAL },
  urlRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  urlInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    backgroundColor: '#fff',
  },
  urlSendButton: {
    backgroundColor: ORANGE,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlSendButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
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
  submittedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  submittedText: { color: CHARCOAL, flex: 1, fontSize: 12 },
  openButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  openButtonText: { color: CHARCOAL, fontSize: 12, fontWeight: '700' },
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
});
