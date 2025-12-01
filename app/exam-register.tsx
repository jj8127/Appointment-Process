import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { ExamRoundWithLocations, formatDate } from '@/types/exam';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const SOFT_BG = '#fff7f0';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const formatKoreanDate = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일(${weekdays[d.getDay()]})`;
const toYmd = (d: Date) => {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const parseDate = (value?: string | null) => {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

const emptyRoundForm = { roundLabel: '', notes: '' };

const fetchRounds = async (): Promise<ExamRoundWithLocations[]> => {
  const { data, error } = await supabase
    .from('exam_rounds')
    .select(
      'id,exam_date,registration_deadline,round_label,notes,created_at,updated_at,exam_locations(id,round_id,location_name,sort_order,created_at,updated_at)',
    )
    .order('exam_date', { ascending: true })
    .order('registration_deadline', { ascending: true })
    .order('sort_order', { foreignTable: 'exam_locations', ascending: true });
  if (error) throw error;

  return (
    data?.map((row: any) => ({
      id: row.id,
      exam_date: row.exam_date,
      registration_deadline: row.registration_deadline,
      round_label: row.round_label,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      locations: (row.exam_locations ?? []).sort(
        (a: any, b: any) => a.sort_order - b.sort_order || a.location_name.localeCompare(b.location_name),
      ),
    })) ?? []
  );
};

export default function ExamRegisterScreen() {
  const { role } = useSession();
  const [roundForm, setRoundForm] = useState(emptyRoundForm);
  const [examDate, setExamDate] = useState(new Date());
  const [deadlineDate, setDeadlineDate] = useState(new Date());
  const [showExamPicker, setShowExamPicker] = useState(Platform.OS === 'ios');
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(Platform.OS === 'ios');
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [locationInput, setLocationInput] = useState('');
  const [locationOrder, setLocationOrder] = useState('0');

  useEffect(() => {
    if (role !== 'admin') {
      Alert.alert('접근 불가', '총무만 사용할 수 있는 메뉴입니다.');
      router.replace('/');
    }
  }, [role]);

  const {
    data: rounds,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['exam-rounds'],
    queryFn: fetchRounds,
    enabled: role === 'admin',
  });

  useEffect(() => {
    if (!selectedRoundId) return;
    const current = rounds?.find((r) => r.id === selectedRoundId);
    if (current) {
      setRoundForm({
        roundLabel: current.round_label ?? '',
        notes: current.notes ?? '',
      });
      setExamDate(parseDate(current.exam_date));
      setDeadlineDate(parseDate(current.registration_deadline));
      setLocationOrder(String((current.locations?.length ?? 0) + 1));
    }
  }, [selectedRoundId, rounds]);

  const selectedRound = useMemo(
    () => rounds?.find((r) => r.id === selectedRoundId) ?? null,
    [rounds, selectedRoundId],
  );

  const saveRound = useMutation({
    mutationFn: async (mode: 'create' | 'update') => {
      const payload = {
        exam_date: toYmd(examDate),
        registration_deadline: toYmd(deadlineDate),
        round_label: roundForm.roundLabel.trim() || null,
        notes: roundForm.notes.trim() || null,
      };
      if (mode === 'update') {
        if (!selectedRoundId) throw new Error('수정할 시험 차수가 선택되지 않았습니다.');
        const { error } = await supabase.from('exam_rounds').update(payload).eq('id', selectedRoundId);
        if (error) throw error;
        return { id: selectedRoundId };
      }

      const { data, error } = await supabase.from('exam_rounds').insert(payload).select().single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (res, mode) => {
      Alert.alert('저장 완료', mode === 'create' ? '새 시험 일정이 등록되었습니다.' : '시험 일정이 업데이트되었습니다.');
      refetch();
      if (res?.id) {
        setSelectedRoundId(res.id);
      }
    },
    onError: (err: any) => Alert.alert('저장 실패', err?.message ?? '저장 중 오류가 발생했습니다.'),
  });

  const deleteRound = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('exam_rounds').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      if (selectedRoundId === id) {
        setSelectedRoundId(null);
        setRoundForm(emptyRoundForm);
      }
      refetch();
    },
    onError: (err: any) => Alert.alert('삭제 실패', err?.message ?? '삭제 중 오류가 발생했습니다.'),
  });

  const addLocation = useMutation({
    mutationFn: async () => {
      if (!selectedRoundId) throw new Error('시험 일자를 먼저 선택해주세요.');
      const name = locationInput.trim();
      if (!name) throw new Error('응시 지역명을 입력해주세요.');
      const order = Number.parseInt(locationOrder, 10);
      const sortOrder = Number.isNaN(order) ? 0 : order;
      const { error } = await supabase.from('exam_locations').insert({
        round_id: selectedRoundId,
        location_name: name,
        sort_order: sortOrder,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setLocationInput('');
      setLocationOrder(String((selectedRound?.locations?.length ?? 0) + 1));
      refetch();
    },
    onError: (err: any) => Alert.alert('추가 실패', err?.message ?? '지역 추가 중 오류가 발생했습니다.'),
  });

  const deleteLocation = useMutation({
    mutationFn: async (locationId: string) => {
      const { error } = await supabase.from('exam_locations').delete().eq('id', locationId);
      if (error) throw error;
    },
    onSuccess: () => {
      refetch();
    },
    onError: (err: any) => Alert.alert('삭제 실패', err?.message ?? '지역 삭제 중 오류가 발생했습니다.'),
  });

  const handleDeleteRound = (id: string) => {
    Alert.alert('삭제 확인', '해당 시험 일정과 지역 목록이 모두 삭제됩니다. 계속하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => deleteRound.mutate(id) },
    ]);
  };

  const startNewRound = () => {
    setSelectedRoundId(null);
    setRoundForm(emptyRoundForm);
    setExamDate(new Date());
    setDeadlineDate(new Date());
    setShowExamPicker(Platform.OS === 'ios');
    setShowDeadlinePicker(Platform.OS === 'ios');
    setLocationInput('');
    setLocationOrder('0');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAwareWrapper>
        <View style={[styles.container, { paddingBottom: 200 }]}>
          <View style={styles.headerRow}>
            <RefreshButton onPress={() => refetch()} />
            <Text style={styles.headerTitle}>시험 등록</Text>
          </View>
          <Text style={styles.caption}>
            월별 응시 차수와 마감일을 등록하고, 일자별로 선택 가능한 응시 지역을 관리하세요.
          </Text>

          {/* 1단계: 시험 일정 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>1단계: 시험 일정</Text>

            <Text style={styles.label}>응시 일자</Text>
            <Pressable
              style={[styles.input, styles.dateDisplay]}
              onPress={() => {
                if (Platform.OS === 'ios') return;
                setShowExamPicker(true);
              }}
              disabled={Platform.OS === 'ios'}>
              <Text style={styles.dateText}>{formatKoreanDate(examDate)}</Text>
            </Pressable>
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={examDate}
                mode="date"
                display="spinner"
                locale="ko-KR"
                onChange={(_, d) => d && setExamDate(d)}
                style={{ width: '100%' }}
              />
            ) : (
              showExamPicker && (
                <DateTimePicker
                  value={examDate}
                  mode="date"
                  display="calendar"
                  onChange={(event, d) => {
                    setShowExamPicker(false);
                    if (d) setExamDate(d);
                  }}
                />
              )
            )}

            <Text style={styles.label}>신청 마감일</Text>
            <Pressable
              style={[styles.input, styles.dateDisplay]}
              onPress={() => {
                if (Platform.OS === 'ios') return;
                setShowDeadlinePicker(true);
              }}
              disabled={Platform.OS === 'ios'}>
              <Text style={styles.dateText}>{formatKoreanDate(deadlineDate)}</Text>
            </Pressable>
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={deadlineDate}
                mode="date"
                display="spinner"
                locale="ko-KR"
                onChange={(_, d) => d && setDeadlineDate(d)}
                style={{ width: '100%' }}
              />
            ) : (
              showDeadlinePicker && (
                <DateTimePicker
                  value={deadlineDate}
                  mode="date"
                  display="calendar"
                  onChange={(event, d) => {
                    setShowDeadlinePicker(false);
                    if (d) setDeadlineDate(d);
                  }}
                />
              )
            )}

            <Text style={styles.label}>차수/메모 (선택)</Text>
            <TextInput
              placeholder="예: 12월 2차, 평일 시험"
              placeholderTextColor={MUTED}
              value={roundForm.roundLabel}
              onChangeText={(text) => setRoundForm((prev) => ({ ...prev, roundLabel: text }))}
              style={styles.input}
            />

            <Text style={styles.label}>비고 (선택)</Text>
            <TextInput
              placeholder="추가 안내를 적어주세요."
              placeholderTextColor={MUTED}
              value={roundForm.notes}
              onChangeText={(text) => setRoundForm((prev) => ({ ...prev, notes: text }))}
              style={[styles.input, { minHeight: 72 }]}
              multiline
            />

            <View style={styles.buttonRow}>
              <View style={{ flex: 1 }}>
                <Button
                  title={selectedRoundId ? '선택 일정 업데이트' : '새 일정 저장'}
                  color={ORANGE}
                  onPress={() => saveRound.mutate(selectedRoundId ? 'update' : 'create')}
                  disabled={saveRound.isPending}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Button title="신규 차수 입력" color={ORANGE_LIGHT} onPress={startNewRound} />
              </View>
            </View>
          </View>

          {/* 등록된 시험 일정 리스트 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>등록된 시험 일정</Text>
            {isLoading || isFetching ? (
              <Text style={styles.caption}>불러오는 중...</Text>
            ) : !rounds?.length ? (
              <Text style={styles.caption}>등록된 시험 일정이 없습니다. 새 일정부터 추가하세요.</Text>
            ) : (
              rounds.map((round) => (
                <Pressable
                  key={round.id}
                  onPress={() => {
                    setSelectedRoundId(round.id);
                    setLocationOrder(String((round.locations?.length ?? 0) + 1));
                  }}
                  style={[
                    styles.roundItem,
                    selectedRoundId === round.id ? styles.roundItemActive : undefined,
                  ]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roundTitle}>
                      {formatDate(round.exam_date)} {round.round_label ? `(${round.round_label})` : ''}
                    </Text>
                    <Text style={styles.roundMeta}>마감: {formatDate(round.registration_deadline)}</Text>
                    {round.notes ? <Text style={styles.roundNote}>{round.notes}</Text> : null}
                    <Text style={styles.roundMeta}>지역 {round.locations?.length ?? 0}개 등록됨</Text>
                  </View>
                  <View style={{ gap: 6, width: 90, alignItems: 'flex-end' }}>
                    <Button title="삭제" color="#ef4444" onPress={() => handleDeleteRound(round.id)} />
                  </View>
                </Pressable>
              ))
            )}
          </View>

          {/* 2단계: 응시 지역 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>2단계: 응시 지역</Text>
            {!selectedRoundId ? (
              <Text style={styles.caption}>응시 일자를 선택하면 해당 차수의 지역을 관리할 수 있습니다.</Text>
            ) : (
              <>
                <Text style={styles.label}>
                  {selectedRound
                    ? `${formatDate(selectedRound.exam_date)} 차수의 지역 목록`
                    : '선택된 차수 없음'}
                </Text>
                <View style={styles.inlineRow}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      placeholder="예: 서울 / 부산 / 광주"
                      placeholderTextColor={MUTED}
                      value={locationInput}
                      onChangeText={setLocationInput}
                      style={styles.input}
                    />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ width: 90 }}>
                    <TextInput
                      placeholder="정렬"
                      placeholderTextColor={MUTED}
                      value={locationOrder}
                      onChangeText={setLocationOrder}
                      keyboardType="numeric"
                      style={styles.input}
                    />
                  </View>
                </View>
                <Button
                  title="지역 추가"
                  color={ORANGE}
                  onPress={() => addLocation.mutate()}
                  disabled={addLocation.isPending}
                />

                <View style={{ height: 12 }} />
                {!selectedRound?.locations?.length ? (
                  <Text style={styles.caption}>등록된 지역이 없습니다.</Text>
                ) : (
                  selectedRound.locations.map((loc) => (
                    <View key={loc.id} style={styles.locationItem}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.roundTitle}>{loc.location_name}</Text>
                        <Text style={styles.roundMeta}>정렬: {loc.sort_order}</Text>
                      </View>
                      <Button title="삭제" color="#ef4444" onPress={() => deleteLocation.mutate(loc.id)} />
                    </View>
                  ))
                )}
              </>
            )}
          </View>
        </View>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SOFT_BG },
  container: { padding: 20, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  caption: { color: MUTED },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: CHARCOAL, marginBottom: 4 },
  card: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  label: { fontWeight: '700', color: CHARCOAL },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
  },
  dateDisplay: { alignItems: 'center' },
  dateText: { color: CHARCOAL, fontWeight: '800' },
  buttonRow: { flexDirection: 'row', alignItems: 'center' },
  roundItem: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  roundItemActive: { borderColor: ORANGE, backgroundColor: '#fff7ed' },
  roundTitle: { fontWeight: '700', color: CHARCOAL },
  roundMeta: { color: MUTED, marginTop: 2 },
  roundNote: { color: CHARCOAL, marginTop: 4 },
  inlineRow: { flexDirection: 'row', alignItems: 'center' },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
});
