import * as WebBrowser from 'expo-web-browser';
import { RefreshButton } from '@/components/RefreshButton';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Platform,
  Pressable,
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

const BUCKET = 'fc-documents';
const ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';

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
    mutationFn: async ({ id, tempId, career }: { id: string; tempId?: string; career?: '신입' | '경력' }) => {
      const payload: any = {};
      if (career) payload.career_type = career;
      if (tempId !== undefined) {
        payload.temp_id = tempId;
        payload.status = 'temp-id-issued';
      }
      const { error } = await supabase.from('fc_profiles').update(payload).eq('id', id);
      if (error) throw error;
      await supabase.functions.invoke('fc-notify', {
        body: { type: 'admin_update', fc_id: id, message: '임시번호/경력 정보가 업데이트되었습니다.' },
      });
    },
    onSuccess: () => {
      Alert.alert('저장 완료', '임시번호/경력 정보가 저장되었습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('저장 실패', err.message ?? '저장 중 문제가 발생했습니다.'),
  });

  const updateDocs = useMutation({
    mutationFn: async ({ id, types }: { id: string; types: RequiredDocType[] }) => {
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

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAwareWrapper>
        <View style={styles.headerContainer}>
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>현황 대시보드</Text>
            <RefreshButton onPress={() => refetch()} />
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
            {(['all', ...Object.keys(statusLabels)] as const).map((st) => {
              const active = statusFilter === st;
              return (
                <Pressable
                  key={st}
                  style={[styles.filterTab, active && styles.filterTabActive]}
                  onPress={() => setStatusFilter(st as any)}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>
                    {st === 'all' ? '전체' : statusLabels[st]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <ScrollView contentContainerStyle={[styles.listContent, { paddingBottom: keyboardPadding + 40 }]}>
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
            const missing = selectedDocs.filter((d) => !submitted.find((s) => s.doc_type === d));
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
                      {fc.phone} · {statusLabels[fc.status] ?? fc.status}
                    </Text>
                  </View>
                  <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#9CA3AF" />
                </Pressable>

                {isExpanded && (
                  <View style={styles.listBody}>
                    <View style={styles.divider} />

                    <DetailRow label="임시번호" value={tempDisplay} />
                    <DetailRow label="수당동의" value={allowanceDisplay} />
                    <DetailRow label="경력구분" value={careerDisplay} />
                    <DetailRow label="이메일" value={fc.email ?? '-'} />
                    <DetailRow label="주소" value={`${fc.address ?? '-'} ${fc.address_detail ?? ''}`} />

                    {showTempSection && role === 'admin' && (
                      <View style={styles.adminSection}>
                        <Text style={styles.adminLabel}>관리자 수정</Text>
                        <View style={styles.inputGroup}>
                          <TextInput
                            style={styles.adminInput}
                            placeholder="임시번호 입력"
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
                                career: careerInputs[fc.id] ?? '신입',
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
        </ScrollView>
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
  subText: {
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
});
