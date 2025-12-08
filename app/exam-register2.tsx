import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { ExamRoundWithLocations, formatDate } from '@/types/exam';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';
const BACKGROUND = '#F3F4F6';
const INPUT_BG = '#F9FAFB';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const formatKoreanDate = (d: Date) =>
  `${d.getMonth() + 1}월 ${d.getDate()}일(${weekdays[d.getDay()]})`;

const toYmd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}` : null;

const emptyRoundForm = {
  roundLabel: '',
  notes: '',
};

type RoundForm = typeof emptyRoundForm;

const fetchRounds = async (): Promise<ExamRoundWithLocations[]> => {
  const { data, error } = await supabase
    .from('exam_rounds')
    .select(
      'id,exam_date,registration_deadline,round_label,notes,created_at,updated_at,exam_locations(id,round_id,location_name,sort_order,created_at,updated_at)',
    )
    .eq('exam_type', 'nonlife')
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
        (a: any, b: any) =>
          a.sort_order - b.sort_order || a.location_name.localeCompare(b.location_name),
      ),
    })) ?? []
  );
};

type RoundedButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  fullWidth?: boolean;
};

function RoundedButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  fullWidth = true,
}: RoundedButtonProps) {
  const variantStyle =
    variant === 'primary'
      ? styles.btnPrimary
      : variant === 'secondary'
      ? styles.btnSecondary
      : styles.btnDanger;

  const textStyle =
    variant === 'secondary'
      ? styles.btnTextSecondary
      : variant === 'danger'
      ? styles.btnTextDanger
      : styles.btnTextPrimary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btnBase,
        variantStyle,
        fullWidth && styles.btnFullWidth,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

export default function ExamRegisterScreen() {
  const { role } = useSession();
  const [roundForm, setRoundForm] = useState<RoundForm>(emptyRoundForm);
  const [examDate, setExamDate] = useState(new Date());
  const [deadlineDate, setDeadlineDate] = useState(new Date());
  const [showExamPicker, setShowExamPicker] = useState(Platform.OS === 'ios');
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(Platform.OS === 'ios');
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [locationInput, setLocationInput] = useState('');
  const [locationOrder, setLocationOrder] = useState('0');
  const [refreshing, setRefreshing] = useState(false);

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
    queryKey: ['exam-rounds-nonlife'],
    queryFn: fetchRounds,
  });

  // Realtime: exam_rounds / exam_locations 변경 시 즉시 갱신
  useEffect(() => {
    const roundChannel = supabase
      .channel('exam-register-nonlife-rounds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_rounds' }, () => refetch())
      .subscribe();
    const locationChannel = supabase
      .channel('exam-register-nonlife-locations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_locations' }, () => refetch())
      .subscribe();

    return () => {
      supabase.removeChannel(roundChannel);
      supabase.removeChannel(locationChannel);
    };
  }, [refetch]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const sortedRounds = useMemo(
    () =>
      (rounds ?? []).slice().sort((a, b) => {
        const da = a.exam_date ?? '';
        const db = b.exam_date ?? '';
        if (da < db) return -1;
        if (da > db) return 1;
        return 0;
      }),
    [rounds],
  );

  const saveRound = useMutation({
    mutationFn: async (mode: 'create' | 'update') => {
      const payload = {
        exam_type: 'nonlife' as const,
        exam_date: toYmd(examDate),
        registration_deadline: toYmd(deadlineDate),
        round_label: roundForm.roundLabel.trim() || null,
        notes: roundForm.notes.trim() || null,
      };
      if (mode === 'update') {
        if (!selectedRoundId) throw new Error('수정할 시험 차수가 선택되지 않았습니다.');
        const { error } = await supabase
          .from('exam_rounds')
          .update(payload)
          .eq('id', selectedRoundId);
        if (error) throw error;
        return { id: selectedRoundId };
      } else {
        const { data, error } = await supabase
          .from('exam_rounds')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        return { id: data.id as string };
      }
    },
    onSuccess: async (res, mode) => {
      Alert.alert(
        '저장 완료',
        mode === 'create' ? '새 시험 일정이 등록되었습니다.' : '시험 일정이 업데이트되었습니다.',
      );
      refetch();
      if (res?.id) {
        setSelectedRoundId(res.id);
      }

      if (mode === 'create') {
        const examTitle = `${formatDate(toYmd(examDate) || '')}${roundForm.roundLabel ? ` (${roundForm.roundLabel})` : ''}`;
        await supabase.from('notifications').insert({
          title: `${examTitle} 일정이 등록되었습니다.`,
          body: '응시를 희망하는 경우 신청해주세요.',
          category: 'exam_round',
          recipient_role: 'fc',
          resident_id: null,
        });

        // FC 전체 푸시 전송
        try {
          const { data: tokens } = await supabase
            .from('device_tokens')
            .select('expo_push_token')
            .eq('role', 'fc');
          const payload =
            tokens?.map((t: any) => ({
              to: t.expo_push_token,
              title: `${examTitle} 일정이 등록되었습니다.`,
              body: '응시를 희망하는 경우 신청해주세요.',
              data: { type: 'exam_round', url: '/exam-apply2' },
            })) ?? [];
          if (payload.length > 0) {
            await fetch(EXPO_PUSH_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
          }
        } catch (pushErr) {
          console.warn('fc push failed', pushErr);
        }
      }
    },
    onError: (err: any) =>
      Alert.alert('저장 실패', err?.message ?? '저장 중 오류가 발생했습니다.'),
  });

  const addLocation = useMutation({
    mutationFn: async () => {
      if (!selectedRoundId) throw new Error('시험 일정을 먼저 선택해주세요.');
      const trimmed = locationInput.trim();
      if (!trimmed) throw new Error('지역명을 입력해주세요.');

      const order = Number(locationOrder) || 0;

      const { error } = await supabase.from('exam_locations').insert({
        round_id: selectedRoundId,
        location_name: trimmed,
        sort_order: order,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setLocationInput('');
      setLocationOrder('0');
      refetch();
    },
    onError: (err: any) =>
      Alert.alert('지역 추가 실패', err?.message ?? '지역 추가 중 오류가 발생했습니다.'),
  });

  const deleteRound = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('exam_rounds').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetch();
    },
    onError: (err: any) =>
      Alert.alert('삭제 실패', err?.message ?? '지역 삭제 중 오류가 발생했습니다.'),
  });

  const handleDeleteRound = (id: string) => {
    Alert.alert(
      '삭제 확인',
      '해당 시험 일정과 지역 목록이 모두 삭제됩니다. 계속하시겠습니까?',
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => deleteRound.mutate(id) },
      ],
    );
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

  // 현재 폼 내용으로 항상 새 차수를 추가
  const handleCreateNewRound = () => {
    saveRound.mutate('create');
  };

  const handleSelectRound = (round: ExamRoundWithLocations) => {
    setSelectedRoundId(round.id);
    setRoundForm({
      roundLabel: round.round_label ?? '',
      notes: round.notes ?? '',
    });
    setExamDate(round.exam_date ? new Date(round.exam_date) : new Date());
    setDeadlineDate(
      round.registration_deadline ? new Date(round.registration_deadline) : new Date(),
    );
    setShowExamPicker(Platform.OS === 'ios');
    setShowDeadlinePicker(Platform.OS === 'ios');
    setLocationInput('');
    setLocationOrder('0');
  };

  const selectedRound = useMemo(
    () => sortedRounds.find((r) => r.id === selectedRoundId) ?? null,
    [sortedRounds, selectedRoundId],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAwareWrapper>
        <ScrollView
          contentContainerStyle={styles.container}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.headerRow}>
            <RefreshButton onPress={() => {refetch()}} />
            <Text style={styles.headerTitle}>손해보험 시험 일정 관리</Text>
          </View>
          <Text style={styles.caption}>
            시험 일자와 신청 마감일, 차수/메모, 비고를 입력해 등록한 뒤 응시 지역을 추가로
            관리할 수 있습니다.
          </Text>

          {/* 1단계: 시험 일정 입력 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>1단계: 시험 일정 입력</Text>

            <Text style={styles.label}>시험 일자</Text>
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={examDate}
                mode="date"
                onChange={(_, date) => date && setExamDate(date)}
              />
            ) : (
              <Pressable
                onPress={() => setShowExamPicker(true)}
                style={styles.dateBox}
              >
                <Text style={styles.dateText}>{formatKoreanDate(examDate)}</Text>
              </Pressable>
            )}
            {showExamPicker && Platform.OS === 'android' && (
              <DateTimePicker
                value={examDate}
                mode="date"
                onChange={(_, date) => {
                  if (date) setExamDate(date);
                  setShowExamPicker(false);
                }}
              />
            )}

            <Text style={styles.label}>신청 마감일</Text>
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={deadlineDate}
                mode="date"
                onChange={(_, date) => date && setDeadlineDate(date)}
              />
            ) : (
              <Pressable
                onPress={() => setShowDeadlinePicker(true)}
                style={styles.dateBox}
              >
                <Text style={styles.dateText}>{formatKoreanDate(deadlineDate)}</Text>
              </Pressable>
            )}
            {showDeadlinePicker && Platform.OS === 'android' && (
              <DateTimePicker
                value={deadlineDate}
                mode="date"
                onChange={(_, date) => {
                  if (date) setDeadlineDate(date);
                  setShowDeadlinePicker(false);
                }}
              />
            )}

            <Text style={styles.label}>차수/메모 (선택)</Text>
            <TextInput
              placeholder="예: 12월 1차 / 12월 2차"
              placeholderTextColor={MUTED}
              value={roundForm.roundLabel}
              onChangeText={(text) =>
                setRoundForm((prev) => ({ ...prev, roundLabel: text }))
              }
              style={styles.input}
            />

            <Text style={styles.label}>비고 (선택)</Text>
            <TextInput
              placeholder="추가 안내를 적어주세요."
              placeholderTextColor={MUTED}
              value={roundForm.notes}
              onChangeText={(text) =>
                setRoundForm((prev) => ({ ...prev, notes: text }))
              }
              style={[styles.input, { height: 80 }]}
              multiline
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <RoundedButton
                  label={
                    selectedRoundId ? '선택 일정 업데이트' : '새 일정 저장'
                  }
                  onPress={() =>
                    saveRound.mutate(selectedRoundId ? 'update' : 'create')
                  }
                  variant="primary"
                  disabled={saveRound.isPending}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <RoundedButton
                  label="신규 차수 입력"
                  onPress={handleCreateNewRound}
                  variant="secondary"
                />
              </View>
            </View>
          </View>

          {/* 2단계: 등록된 시험 일정 목록 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>등록된 시험 일정</Text>
            {isLoading || isFetching ? (
              <Text style={styles.caption}>등록된 시험 일정을 불러오는 중입니다...</Text>
            ) : !sortedRounds.length ? (
              <Text style={styles.caption}>
                아직 등록된 시험 일정이 없습니다. 상단에서 일정을 먼저 등록하세요.
              </Text>
            ) : (
              sortedRounds.map((round) => (
                <Pressable
                  key={round.id}
                  onPress={() => handleSelectRound(round)}
                  style={[
                    styles.roundItem,
                    selectedRoundId === round.id && styles.roundItemActive,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roundTitle}>
                      {formatDate(round.exam_date)}{' '}
                      {round.round_label ? `(${round.round_label})` : ''}
                    </Text>
                    <Text style={styles.roundMeta}>
                      마감: {formatDate(round.registration_deadline)}
                    </Text>
                    <Text style={styles.roundMeta}>
                      지역 {round.locations?.length ?? 0}개 등록됨
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleDeleteRound(round.id)}
                    style={styles.deleteBadge}
                  >
                    <Text style={styles.deleteText}>삭제</Text>
                  </Pressable>
                </Pressable>
              ))
            )}
          </View>

          {/* 3단계: 선택된 시험 일정의 응시 지역 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>2단계: 응시 지역 관리</Text>
            {!selectedRound ? (
              <Text style={styles.caption}>
                상단에서 시험 일정을 선택하면, 해당 일정의 응시 지역을 추가/삭제할 수 있습니다.
              </Text>
            ) : (
              <>
                <Text style={styles.roundSummary}>
                  선택된 일정:{' '}
                  {formatDate(selectedRound.exam_date)}{' '}
                  {selectedRound.round_label ? `(${selectedRound.round_label})` : ''}
                </Text>

                <Text style={styles.label}>응시 지역 추가</Text>
                <View style={styles.row}>
                  <View style={{ flex: 2 }}>
                    <TextInput
                      placeholder="예: 청주, 대전 등"
                      placeholderTextColor={MUTED}
                      value={locationInput}
                      onChangeText={setLocationInput}
                      style={styles.input}
                    />
                  </View>
                  <View style={{ width: 8 }} />
                  <View style={{ flex: 1 }}>
                    <TextInput
                      placeholder="정렬순서"
                      placeholderTextColor={MUTED}
                      value={locationOrder}
                      onChangeText={setLocationOrder}
                      keyboardType="number-pad"
                      style={styles.input}
                    />
                  </View>
                </View>
                <View style={{ marginTop: 8 }}>
                  <RoundedButton
                    label="지역 추가"
                    onPress={() => addLocation.mutate()}
                    variant="primary"
                    disabled={addLocation.isPending}
                  />
                </View>

                <View style={{ marginTop: 16 }}>
                  <Text style={styles.label}>등록된 응시 지역</Text>
                  {!selectedRound.locations?.length ? (
                    <Text style={styles.caption}>
                      아직 등록된 응시 지역이 없습니다. 위에서 지역을 추가해주세요.
                    </Text>
                  ) : (
                    selectedRound.locations.map((loc) => (
                      <View key={loc.id} style={styles.locationRow}>
                        <Text style={styles.locationName}>
                          {loc.location_name} (정렬: {loc.sort_order})
                        </Text>
                        <Pressable
                          onPress={async () => {
                            const { error } = await supabase
                              .from('exam_locations')
                              .delete()
                              .eq('id', loc.id);
                            if (error) {
                              Alert.alert(
                                '삭제 실패',
                                error.message ?? '지역 삭제 중 오류가 발생했습니다.',
                              );
                            } else {
                              refetch();
                            }
                          }}
                          style={styles.locationDelete}
                        >
                          <Text style={styles.locationDeleteText}>삭제</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  container: {
    padding: 16,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: CHARCOAL,
  },
  caption: {
    color: MUTED,
  },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: CHARCOAL,
    marginBottom: 4,
  },
  label: {
    marginTop: 8,
    marginBottom: 6,
    fontWeight: '600',
    color: '#374151',
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: INPUT_BG,
    fontSize: 15,
    color: CHARCOAL,
  },
  dateBox: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: INPUT_BG,
  },
  dateText: {
    fontWeight: '600',
    color: CHARCOAL,
  },
  row: {
    flexDirection: 'row',
    marginTop: 12,
    alignItems: 'center',
  },
  roundItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  roundItemActive: {
    borderColor: ORANGE,
    backgroundColor: '#fff7ed',
  },
  roundTitle: {
    fontWeight: '700',
    color: CHARCOAL,
  },
  roundMeta: {
    color: MUTED,
    marginTop: 2,
  },
  deleteBadge: {
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fecdd3',
    backgroundColor: '#FEF2F2',
  },
  deleteText: {
    color: '#b91c1c',
    fontWeight: '700',
    fontSize: 13,
  },
  roundSummary: {
    fontWeight: '700',
    color: CHARCOAL,
    marginBottom: 8,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  locationName: {
    flex: 1,
    color: CHARCOAL,
    fontSize: 14,
  },
  locationDelete: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fecdd3',
    backgroundColor: '#FEF2F2',
  },
  locationDeleteText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '700',
  },
  btnBase: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFullWidth: {
    width: '100%',
  },
  btnPrimary: {
    backgroundColor: CHARCOAL,
  },
  btnSecondary: {
    backgroundColor: ORANGE,
  },
  btnDanger: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPressed: {
    transform: [{ scale: 0.98 }],
  },
  btnTextPrimary: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15,
  },
  btnTextSecondary: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15,
  },
  btnTextDanger: {
    color: '#b91c1c',
    fontWeight: '800',
    fontSize: 14,
  },
});
