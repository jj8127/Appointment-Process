import * as WebBrowser from 'expo-web-browser';
import { RefreshButton } from '@/components/RefreshButton';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { FcProfile, RequiredDocType } from '@/types/fc';

const BUCKET = 'fc-documents';
const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const YELLOW = '#fde68a';

const statusLabels: Record<FcProfile['status'], string> = {
  draft: '작성 중',
  'temp-id-issued': '임시번호 입력',
  'allowance-consented': '수당동의 완료',
  'docs-requested': '서류 요청',
  'docs-pending': '서류 대기',
  'docs-rejected': '반려',
  'docs-approved': '검토 완료',
  'final-link-sent': '최종 URL 발송',
};

const docOptions: RequiredDocType[] = [
  '주민등록증 사본',
  '통장 사본',
  '최근3개월 급여명세서',
  '주민등록증 이미지(앞)',
  '통장 이미지(앞)',
  '최근3개월 이미지(앞)',
  '주민등록증 이미지(뒤)',
  '통장 이미지(뒤)',
  '최근3개월 이미지(뒤)',
  '신체검사서',
  '개인정보동의서',
];

type FcRow = {
  id: string;
  name: string;
  affiliation: string;
  phone: string;
  temp_id: string | null;
  status: FcProfile['status'];
  allowance_date: string | null;
  resident_id_masked: string | null;
  career_type: string | null;
  email: string | null;
  address: string | null;
  address_detail: string | null;
  fc_documents?: { doc_type: string; storage_path: string | null; file_name: string | null; status: string | null }[];
};

const fetchFcs = async (
  role: 'admin' | 'fc' | null,
  residentId: string,
  status: FcProfile['status'] | 'all',
  keyword: string,
) => {
  let query = supabase
    .from('fc_profiles')
    .select(
      'id,name,affiliation,phone,temp_id,status,allowance_date,resident_id_masked,career_type,email,address,address_detail,fc_documents(doc_type,storage_path,file_name,status)',
    )
    .order('created_at', { ascending: false });

  if (role === 'fc' && residentId) {
    query = query.eq('phone', residentId);
  }
  if (status !== 'all') {
    query = query.eq('status', status);
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
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const [statusFilter, setStatusFilter] = useState<FcProfile['status'] | 'all'>('all');
  const [keyword, setKeyword] = useState('');
  const [tempInputs, setTempInputs] = useState<Record<string, string>>({});
  const [careerInputs, setCareerInputs] = useState<Record<string, '신입' | '경력'>>({});
  const [docSelections, setDocSelections] = useState<Record<string, Set<RequiredDocType>>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const keyboardPadding = useKeyboardPadding();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', role, residentId, statusFilter, keyword],
    queryFn: () => fetchFcs(role, residentId, statusFilter, keyword),
    enabled: !!role,
  });

  useEffect(() => {
    if (!data) return;
    const next: Record<string, Set<RequiredDocType>> = {};
    const tempPrefill: Record<string, string> = {};
    const careerPrefill: Record<string, '신입' | '경력'> = {};
    data.forEach((fc) => {
      const docs = fc.fc_documents?.map((d) => d.doc_type as RequiredDocType) ?? [];
      next[fc.id] = new Set(docs);
      if (fc.temp_id) tempPrefill[fc.id] = fc.temp_id;
      if (fc.career_type === '경력' || fc.career_type === '신입') careerPrefill[fc.id] = fc.career_type as any;
    });
    setDocSelections(next);
    setTempInputs((prev) => ({ ...tempPrefill, ...prev }));
    setCareerInputs((prev) => ({ ...careerPrefill, ...prev }));
  }, [data]);

  const updateTemp = useMutation({
    mutationFn: async ({ id, tempId, career }: { id: string; tempId?: string; career: '신입' | '경력' }) => {
      const payload: any = { career_type: career };
      if (tempId) {
        payload.temp_id = tempId;
        payload.status = 'temp-id-issued';
      }
      const { error } = await supabase.from('fc_profiles').update(payload).eq('id', id);
      if (error) throw error;
      await supabase.functions.invoke('fc-notify', {
        body: { type: 'admin_update', fc_id: id, message: '임시번호/경력 정보가 업데이트되었습니다.' },
      });
    },
    onSuccess: (_, vars) => {
      Alert.alert('저장 완료', '임시번호/경력 정보가 저장되었습니다.');
      setTempInputs((prev) => ({ ...prev, [vars.id]: vars.tempId ?? prev[vars.id] ?? '' }));
      setCareerInputs((prev) => ({ ...prev, [vars.id]: vars.career }));
      refetch();
    },
    onError: (err: any) => Alert.alert('저장 실패', err.message ?? '저장 중 문제가 발생했습니다.'),
  });

  const updateDocs = useMutation({
    mutationFn: async ({ id, types }: { id: string; types: RequiredDocType[] }) => {
      const uniqueTypes = Array.from(new Set(types));

      // 현재 저장된 서류 목록 조회
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
      await supabase.functions.invoke('fc-notify', {
        body: { type: 'admin_update', fc_id: id, message: '필수 서류 요청이 등록되었습니다.' },
      });
    },
    onSuccess: () => {
      Alert.alert('요청 완료', '필수 서류 요청을 저장했습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('요청 실패', err.message ?? '요청 처리 중 문제가 발생했습니다.'),
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

  const toggleDocSelection = (fcId: string, doc: RequiredDocType) => {
    setDocSelections((prev) => {
      const set = new Set(prev[fcId] ?? []);
      if (set.has(doc)) set.delete(doc);
      else set.add(doc);
      return { ...prev, [fcId]: set };
    });
  };

  const rows = useMemo(() => data ?? [], [data]);

  const openFile = async (path?: string) => {
    if (!path) {
      Alert.alert('열기 실패', '저장된 파일이 없습니다.');
      return;
    }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      Alert.alert('열기 실패', error?.message ?? 'URL 생성 실패: 버킷 fc-documents 설정을 확인해주세요.');
      return;
    }
    await WebBrowser.openBrowserAsync(data.signedUrl);
  };

  const showTempSection = mode !== 'docs';
  const showDocsSection = mode !== 'temp';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 180 }]}
          keyboardShouldPersistTaps="handled">
          <RefreshButton />
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>총무 대시보드</Text>
              <Text style={styles.caption}>
                {role === 'admin'
                  ? 'FC 목록을 확인하고 임시번호·서류 요청·업로드 현황을 관리하세요.'
                  : '본인 현황과 제출 서류 상태를 확인할 수 있습니다.'}
              </Text>
            </View>
          </View>

          <View style={styles.filters}>
            <TextInput
              style={styles.search}
              placeholder="이름/소속/번호/임시번호 검색"
              placeholderTextColor="#9CA3AF"
              value={keyword}
              onChangeText={setKeyword}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusRow}>
              {(['all', ...Object.keys(statusLabels)] as (FcProfile['status'] | 'all')[]).map((status) => (
                <Text
                  key={status}
                  style={[styles.pill, statusFilter === status && styles.pillSelected]}
                  onPress={() => setStatusFilter(status)}>
                  {status === 'all' ? '전체' : statusLabels[status as FcProfile['status']]}
                </Text>
              ))}
            </ScrollView>
          </View>

          {isLoading && <ActivityIndicator color={ORANGE} />}
          {isError && <Text style={{ color: '#dc2626' }}>데이터를 불러오지 못했습니다.</Text>}

          <View style={styles.list}>
            {rows.map((fc) => {
              const selectedDocs = Array.from(docSelections[fc.id] ?? new Set<RequiredDocType>());
              const submitted = (fc.fc_documents ?? []).filter((d) => d.storage_path && d.storage_path !== 'deleted');
              const missing = selectedDocs.filter((d) => !submitted.find((s) => s.doc_type === d));
              const isExpanded = expanded[fc.id];
              const careerDisplay = careerInputs[fc.id] ?? fc.career_type ?? '-';
              const tempDisplay = tempInputs[fc.id] ?? fc.temp_id ?? '-';
              const allowanceDisplay = fc.allowance_date ?? '없음';

              return (
                <View key={fc.id} style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.name}>{fc.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {role === 'admin' ? (
                        <Pressable
                          style={styles.trashButton}
                          onPress={() =>
                            Alert.alert('삭제 확인', '이 FC 기록을 삭제할까요?', [
                              { text: '취소', style: 'cancel' },
                              { text: '삭제', style: 'destructive', onPress: () => deleteFc.mutate(fc.id) },
                            ])
                          }>
                          <Text style={styles.trashText}>×</Text>
                        </Pressable>
                      ) : null}
                      <Text style={styles.badge}>{statusLabels[fc.status]}</Text>
                    </View>
                  </View>
                  <Text style={styles.meta}>
                    {fc.affiliation} · {fc.phone}
                  </Text>
                  <Text style={styles.meta}>서류 현황: {submitted.length}/{selectedDocs.length}</Text>
                  <Text style={styles.meta}>수당 동의 날짜: {allowanceDisplay}</Text>
                  {missing.length ? <Text style={styles.meta}>부족한 서류: {missing.join(', ')}</Text> : null}

                  <Pressable
                    style={styles.detailButton}
                    onPress={() => setExpanded((prev) => ({ ...prev, [fc.id]: !prev[fc.id] }))}>
                    <Text style={styles.detailButtonText}>{isExpanded ? '접기' : '상세 보기'}</Text>
                  </Pressable>

                  {isExpanded ? (
                    <View style={styles.detailBox}>
                      <Text style={styles.meta}>임시번호: {tempDisplay}</Text>
                      <Text style={styles.meta}>경력 구분: {careerDisplay}</Text>
                      <Text style={styles.meta}>수당 날짜: {fc.allowance_date ?? '-'}</Text>
                      <Text style={styles.meta}>휴대폰: {fc.phone ?? '-'}</Text>
                      <Text style={styles.meta}>이메일: {fc.email ?? '-'}</Text>
                      <Text style={styles.meta}>
                        주소: {fc.address ?? '-'}
                        {fc.address_detail ? ` ${fc.address_detail}` : ''}
                      </Text>
                    </View>
                  ) : null}

                  {role === 'admin' ? (
                    <>
                      {showTempSection ? (
                        <View style={{ gap: 8, marginTop: 8 }}>
                          <View style={styles.careerRow}>
                            {(['신입', '경력'] as ('신입' | '경력')[]).map((c) => {
                              const active = (careerInputs[fc.id] ?? fc.career_type ?? '신입') === c;
                              return (
                                <Pressable
                                  key={c}
                                  style={[styles.careerPill, active && styles.careerPillActive]}
                                  onPress={() => setCareerInputs((prev) => ({ ...prev, [fc.id]: c }))}>
                                  <Text style={[styles.careerText, active && styles.careerTextActive]}>{c}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          <View style={styles.tempRow}>
                            <TextInput
                              style={styles.input}
                              placeholder="임시번호 입력"
                              placeholderTextColor="#9CA3AF"
                              value={tempInputs[fc.id] ?? fc.temp_id ?? ''}
                              onChangeText={(txt) => setTempInputs((prev) => ({ ...prev, [fc.id]: txt }))}
                            />
                            <Button
                              title="임시번호/경력 저장"
                              onPress={() =>
                                updateTemp.mutate({
                                  id: fc.id,
                                  tempId: tempInputs[fc.id] ?? fc.temp_id ?? '',
                                  career: careerInputs[fc.id] ?? '신입',
                                })
                              }
                              disabled={updateTemp.isPending}
                              color={ORANGE}
                            />
                          </View>
                        </View>
                      ) : null}

                      {showDocsSection ? (
                        <>
                          <View style={styles.docsHeader}>
                            <Text style={styles.docsTitle}>필수 서류 선택</Text>
                            <View style={styles.legendRow}>
                              <View style={[styles.legendDot, { backgroundColor: ORANGE }]} />
                              <Text style={styles.legendText}>요청됨</Text>
                              <View style={[styles.legendDot, { backgroundColor: YELLOW, borderColor: '#f59e0b', borderWidth: 1 }]} />
                              <Text style={styles.legendText}>제출 완료</Text>
                            </View>
                          </View>
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
                                  onPress={() => toggleDocSelection(fc.id, doc)}>
                                  <Text
                                    style={[
                                      styles.docPillText,
                                      active && styles.docPillTextSelected,
                                      submittedDoc && styles.docPillTextSubmitted,
                                    ]}>
                                    {doc}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          <Button
                            title="서류 요청 저장"
                            onPress={() =>
                              updateDocs.mutate({ id: fc.id, types: Array.from(docSelections[fc.id] ?? new Set()) })
                            }
                            disabled={updateDocs.isPending}
                            color={ORANGE}
                          />

                          <View style={styles.submittedBox}>
                            <Text style={styles.submittedTitle}>제출된 서류</Text>
                            {submitted.length ? (
                              submitted.map((doc) => (
                                <View key={doc.doc_type} style={styles.submittedRow}>
                                  <Text style={styles.submittedText}>
                                    {doc.doc_type} · {doc.file_name ?? '-'}
                                  </Text>
                                  {doc.storage_path ? (
                                    <Button title="열기" onPress={() => openFile(doc.storage_path ?? undefined)} color={ORANGE} />
                                  ) : null}
                                </View>
                              ))
                            ) : (
                              <Text style={styles.meta}>제출된 서류가 없습니다.</Text>
                            )}
                          </View>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </View>
              );
            })}
            {!isLoading && !rows.length ? <Text style={styles.empty}>표시할 데이터가 없습니다.</Text> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff7f0' },
  container: { padding: 20, paddingBottom: 96, gap: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  caption: { color: '#4b5563', marginTop: 4 },
  filters: { gap: 10 },
  search: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 10,
    backgroundColor: 'white',
  },
  statusRow: { marginTop: 6 },
  pill: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    color: CHARCOAL,
    marginRight: 8,
  },
  pillSelected: { backgroundColor: ORANGE, color: 'white', borderColor: ORANGE },
  list: { gap: 10 },
  card: {
    backgroundColor: 'white',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ORANGE_LIGHT,
    gap: 8,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontWeight: '800', fontSize: 16, color: CHARCOAL },
  badge: {
    backgroundColor: '#e5e7eb',
    color: CHARCOAL,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontSize: 12,
  },
  meta: { color: '#475569' },
  tempRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 10,
    backgroundColor: 'white',
  },
  careerRow: { flexDirection: 'row', gap: 8 },
  careerPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  careerPillActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  careerText: { color: CHARCOAL },
  careerTextActive: { color: 'white', fontWeight: '700' },
  detailButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: ORANGE_LIGHT,
  },
  detailButtonText: { color: CHARCOAL, fontWeight: '700' },
  detailBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  docsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { color: '#475569', fontSize: 12 },
  docs: { gap: 8, marginTop: 10 },
  docsTitle: { fontWeight: '700', color: CHARCOAL },
  docPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  docPill: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'white',
  },
  docPillSelected: { backgroundColor: ORANGE, borderColor: ORANGE },
  docPillSubmitted: { backgroundColor: YELLOW, borderColor: '#f59e0b' },
  docPillText: { color: CHARCOAL },
  docPillTextSelected: { color: 'white' },
  docPillTextSubmitted: { color: CHARCOAL, fontWeight: '700' },
  submittedBox: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: ORANGE_LIGHT,
    borderRadius: 10,
    gap: 6,
    backgroundColor: '#fff',
  },
  submittedTitle: { fontWeight: '700', color: CHARCOAL },
  submittedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  submittedText: { color: CHARCOAL, flex: 1 },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 20 },
  trashButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  trashText: { fontSize: 16, color: '#b91c1c' },
});
