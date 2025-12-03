import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView, AnimatePresence } from 'moti';
import * as Haptics from 'expo-haptics';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { ExamRoundWithLocations, formatDate } from '@/types/exam';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';

const HANWHA_ORANGE = '#f36f21';
const HANWHA_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const SOFT_BG = '#F9FAFB';
const ORANGE_FAINT = '#fff1e6';
const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.05,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const fetchRounds = async (): Promise<ExamRoundWithLocations[]> => {
  const { data, error } = await supabase
    .from('exam_rounds')
    .select(
      `
      id,
      exam_date,
      registration_deadline,
      round_label,
      notes,
      created_at,
      updated_at,
      exam_locations (
        id,
        round_id,
        location_name,
        sort_order,
        created_at,
        updated_at
      )
    `,
    )
    .eq('exam_type', 'life')
    .order('exam_date', { ascending: true })
    .order('registration_deadline', { ascending: true })
    .order('sort_order', { foreignTable: 'exam_locations', ascending: true });

  if (error) {
    console.log('fetchRounds error', error);
    throw error;
  }

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
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          a.location_name.localeCompare(b.location_name),
      ),
    })) ?? []
  );
};

const toDate = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

type MyExamApply = {
  id: string;
  round_id: string;
  location_id: string;
  status: string;
  is_third_exam?: boolean | null;
  created_at: string;
  exam_rounds?:
    | { exam_date: string; round_label: string | null }[]
    | { exam_date: string; round_label: string | null }
    | null;
  exam_locations?:
    | { location_name: string }[]
    | { location_name: string }
    | null;
};

export default function ExamApplyScreen() {
  const { role, residentId, displayName, hydrated } = useSession();

  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [wantsThird, setWantsThird] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/auth');
      return;
    }
    if (role !== 'fc') {
      Alert.alert('접근 불가', '시험 신청은 FC만 사용할 수 있습니다.');
      router.replace('/');
    }
  }, [role, hydrated]);

  const {
    data: rounds,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['exam-rounds-for-apply', 'life'],
    queryFn: fetchRounds,
    enabled: role === 'fc',
  });

  const allRounds = useMemo(() => rounds ?? [], [rounds]);

  const isRoundClosed = (round: ExamRoundWithLocations) => {
    const deadline = toDate(round.registration_deadline);
    if (!deadline) return false;
    deadline.setHours(23, 59, 59, 999);
    return deadline < new Date();
  };

  const selectedRound = useMemo(
    () => allRounds.find((r) => r.id === selectedRoundId) ?? null,
    [allRounds, selectedRoundId],
  );

  const isSelectedRoundClosed = useMemo(
    () => (selectedRound ? isRoundClosed(selectedRound) : false),
    [selectedRound],
  );

  const { data: myLastApply } = useQuery<MyExamApply | null>({
    queryKey: ['my-exam-apply', residentId],
    enabled: role === 'fc' && !!residentId,
    queryFn: async (): Promise<MyExamApply | null> => {
      const { data, error } = await supabase
        .from('exam_registrations')
        .select(
          'id, round_id, location_id, status, is_third_exam, created_at, exam_rounds(exam_date, round_label), exam_locations(location_name)',
        )
        .eq('resident_id', residentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && (error as any).code === '42P01') {
        return null;
      }
      if (error) throw error;
      const normalize = (obj: any) => (Array.isArray(obj) ? obj[0] : obj);
      return {
        ...data,
        exam_rounds: normalize(data?.exam_rounds),
        exam_locations: normalize(data?.exam_locations),
      } as MyExamApply | null;
    },
  });

  useEffect(() => {
    if (myLastApply?.is_third_exam != null) {
      setWantsThird(!!myLastApply.is_third_exam);
    }
  }, [myLastApply]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!residentId) {
        throw new Error('본인 식별 정보가 없습니다. 다시 로그인한 뒤 이용해주세요.');
      }
      if (!selectedRoundId || !selectedLocationId) {
        throw new Error('시험 일정과 응시 지역을 모두 선택해주세요.');
      }

      const round = allRounds?.find((r) => r.id === selectedRoundId);
      if (!round) {
        throw new Error('선택한 시험 일정 정보를 다시 확인해주세요.');
      }

      if (isRoundClosed(round)) {
        throw new Error('마감된 일정입니다. 다른 시험 일정을 선택해주세요.');
      }

      if (myLastApply) {
        const { error } = await supabase
          .from('exam_registrations')
          .update({
            round_id: selectedRoundId,
            location_id: selectedLocationId,
            status: 'applied',
            is_confirmed: false,
            is_third_exam: wantsThird,
          })
          .eq('id', myLastApply.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('exam_registrations').insert({
          resident_id: residentId,
          round_id: selectedRoundId,
          location_id: selectedLocationId,
          status: 'applied',
          is_confirmed: false,
          is_third_exam: wantsThird,
        });

        if (error) throw error;
      }

      const locName =
        round.locations?.find((l) => l.id === selectedLocationId)?.location_name ?? '';
      const examTitle = `${formatDate(round.exam_date)}${
        round.round_label ? ` (${round.round_label})` : ''
      }`;
      const actor = displayName?.trim() || residentId;
      const title = `${actor}이/가 ${examTitle}을 신청하였습니다.`;
      const body = locName ? `${actor}이/가 ${examTitle} (${locName})을 신청하였습니다.` : title;

      await supabase.from('notifications').insert({
        title,
        body,
        category: 'exam_apply',
        recipient_role: 'admin',
        resident_id: residentId,
      });

      // 관리자 푸시 전송 (존재하는 토큰에 한해 전송 시도)
      try {
        const { data: tokens } = await supabase
          .from('device_tokens')
          .select('expo_push_token')
          .eq('role', 'admin');
        const payload =
          tokens?.map((t: any) => ({
            to: t.expo_push_token,
            title,
            body,
            data: { type: 'exam_apply', resident_id: residentId },
          })) ?? [];
        if (payload.length > 0) {
          await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }
      } catch (pushErr) {
        console.warn('admin push failed', pushErr);
      }
    },
    onSuccess: () => {
      Alert.alert('신청 완료', '시험 신청이 정상적으로 등록되었습니다.');
      router.replace('/'); // 홈으로 이동
    },
    onError: (err: any) => {
      Alert.alert('신청 실패', err?.message ?? '시험 신청 중 오류가 발생했습니다.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!myLastApply) {
        throw new Error('취소할 신청 내역이 없습니다.');
      }

      const { error } = await supabase
        .from('exam_registrations')
        .delete()
        .eq('id', myLastApply.id);

      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert('취소 완료', '시험 신청이 취소되었습니다.');
      router.replace('/'); // 취소 후에도 홈으로 이동
    },
    onError: (err: any) => {
      Alert.alert('취소 실패', err?.message ?? '시험 신청 취소 중 오류가 발생했습니다.');
    },
  });

  const handleRoundSelect = (round: ExamRoundWithLocations) => {
    if (isRoundClosed(round)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.selectionAsync();
    setSelectedRoundId(round.id);
    setSelectedLocationId(null);
  };

  const handleLocationSelect = (id: string) => {
    Haptics.selectionAsync();
    setSelectedLocationId(id);
  };

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={HANWHA_ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAwareWrapper>
        <ScrollView contentContainerStyle={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>생명보험 시험 신청</Text>
              <Text style={styles.headerSub}>시험 일정과 응시 지역을 선택해주세요.</Text>
            </View>
            <RefreshButton
              onPress={() => {
                refetch();
              }}
            />
          </View>

          {/* Status Card */}
          <MotiView
            from={{ opacity: 0, translateY: -10 }}
            animate={{ opacity: 1, translateY: 0 }}
            style={styles.statusCard}
          >
            <View style={styles.statusHeader}>
              <Feather name="info" size={16} color={HANWHA_ORANGE} />
              <Text style={styles.statusTitle}>내 신청 내역</Text>
            </View>
            {!myLastApply ? (
              <Text style={styles.emptyText}>아직 신청한 시험이 없습니다.</Text>
            ) : (
              <View style={styles.statusContent}>
                <View style={styles.statusRow}>
                  <Text style={styles.statusLabel}>시험일자</Text>
                  <Text style={styles.statusValue}>
                    {myLastApply.exam_rounds?.exam_date
                      ? formatDate(myLastApply.exam_rounds.exam_date)
                      : '-'}
                  </Text>
                </View>
                <View style={styles.statusRow}>
                  <Text style={styles.statusLabel}>응시지역</Text>
                  <Text style={styles.statusValue}>
                    {myLastApply.exam_locations?.location_name ?? '-'}
                  </Text>
                </View>
                <View style={styles.statusRow}>
                  <Text style={styles.statusLabel}>제3보험</Text>
                  <Text style={styles.statusValue}>{myLastApply.is_third_exam ? '신청함' : '미신청'}</Text>
                </View>
                <View style={styles.statusDivider} />
                <View style={styles.statusRow}>
                  <Text style={styles.statusLabel}>상태</Text>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>
                      {myLastApply.status === 'applied' ? '접수완료' : myLastApply.status}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </MotiView>

          {/* Step 1: Rounds */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>📅 시험 일정 선택</Text>
            {isLoading || isFetching ? (
              <ActivityIndicator color={HANWHA_ORANGE} style={{ marginTop: 20 }} />
            ) : (
              <View style={styles.listContainer}>
                {allRounds.map((round, idx) => {
                  const isActive = round.id === selectedRoundId;
                  const closed = isRoundClosed(round);
                  return (
                    <MotiView
                      key={round.id}
                      from={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 50 }}
                    >
                      <Pressable
                        onPress={() => handleRoundSelect(round)}
                        style={[
                          styles.selectionCard,
                          isActive && styles.selectionCardActive,
                          closed && styles.selectionCardDisabled,
                        ]}
                      >
                        <View style={styles.selectionInfo}>
                          <Text
                            style={[
                              styles.selectionTitle,
                              isActive && styles.textActive,
                              closed && styles.textDisabled,
                            ]}
                          >
                            {formatDate(round.exam_date)}
                            {round.round_label ? ` (${round.round_label})` : ''}
                          </Text>
                          <Text style={styles.selectionSub}>
                            마감: {formatDate(round.registration_deadline)}
                          </Text>
                          {round.notes ? (
                            <Text style={styles.selectionNote}>{round.notes}</Text>
                          ) : null}
                        </View>
                        {closed ? (
                          <Feather name="lock" size={20} color={MUTED} />
                        ) : isActive ? (
                          <View style={styles.checkCircle}>
                            <Feather name="check" size={14} color="#fff" />
                          </View>
                        ) : (
                          <View style={styles.radioCircle} />
                        )}
                      </Pressable>
                    </MotiView>
                  );
                })}
              </View>
            )}
          </View>

          {/* Step 2: Locations */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>📍 응시 지역 선택</Text>
            <AnimatePresence>
              {!selectedRound ? (
                <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.placeholderBox}>
                  <Text style={styles.placeholderText}>위에서 시험 일정을 먼저 선택해주세요.</Text>
                </MotiView>
              ) : isSelectedRoundClosed ? (
                <View style={styles.placeholderBox}>
                  <Text style={[styles.placeholderText, { color: '#ef4444' }]}>마감된 일정입니다.</Text>
                </View>
              ) : (
                <View style={styles.gridContainer}>
                  {selectedRound.locations?.map((loc, idx) => {
                    const isActive = loc.id === selectedLocationId;
                    return (
                      <MotiView
                        key={loc.id}
                        from={{ opacity: 0, translateY: 10 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        transition={{ delay: idx * 30 }}
                        style={{ width: '48%' }}
                      >
                        <Pressable
                          onPress={() => handleLocationSelect(loc.id)}
                          style={[
                            styles.locationCard,
                            isActive && styles.locationCardActive,
                          ]}
                        >
                          <Text style={[styles.locationText, isActive && styles.locationTextActive]}>
                            {loc.location_name}
                          </Text>
                          {isActive ? (
                            <Feather
                              name="check-circle"
                              size={16}
                              color={HANWHA_ORANGE}
                              style={{ marginTop: 4 }}
                            />
                          ) : null}
                        </Pressable>
                      </MotiView>
                    );
                  })}
                  {!selectedRound.locations?.length && (
                    <Text style={styles.emptyText}>등록된 지역이 없습니다.</Text>
                  )}
                </View>
              )}
            </AnimatePresence>
          </View>

          {/* Step 3: Final */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>✅ 최종 확인</Text>

            <Pressable
              style={[styles.toggleCard, wantsThird && styles.toggleCardActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setWantsThird((v) => !v);
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Feather
                  name={wantsThird ? 'check-square' : 'square'}
                  size={24}
                  color={wantsThird ? HANWHA_ORANGE : MUTED}
                />
                <View>
                  <Text style={styles.toggleTitle}>제3보험 동시 응시</Text>
                  <Text style={styles.toggleDesc}>제3보험 자격 시험도 함께 신청합니다.</Text>
                </View>
              </View>
            </Pressable>

            <View style={styles.actionButtons}>
              <Pressable
                onPress={() => applyMutation.mutate()}
                disabled={
                  applyMutation.isPending ||
                  !selectedRoundId ||
                  !selectedLocationId ||
                  isSelectedRoundClosed
                }
                style={({ pressed }) => [styles.submitBtnWrapper, pressed && styles.pressedScale]}
              >
                <LinearGradient
                  colors={
                    !selectedRoundId || !selectedLocationId
                      ? ['#d1d5db', '#9ca3af']
                      : [HANWHA_ORANGE, '#fb923c']
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.submitBtn}
                >
                  <Text style={styles.submitBtnText}>
                    {myLastApply ? '신청 내역 수정하기' : '시험 신청하기'}
                  </Text>
                  {applyMutation.isPending && <ActivityIndicator color="#fff" style={{ marginLeft: 8 }} />}
                </LinearGradient>
              </Pressable>

              {myLastApply && (
                <Pressable
                  onPress={() => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    Alert.alert('신청 취소', '정말 취소하시겠습니까?', [
                      { text: '아니요', style: 'cancel' },
                      { text: '예', style: 'destructive', onPress: () => cancelMutation.mutate() },
                    ]);
                  }}
                  disabled={cancelMutation.isPending}
                  style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressedOpacity]}
                >
                  <Text style={styles.cancelBtnText}>신청 취소하기</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SOFT_BG },
  container: { padding: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: CHARCOAL, marginBottom: 4 },
  headerSub: { fontSize: 14, color: MUTED },

  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    ...CARD_SHADOW,
    borderLeftWidth: 4,
    borderLeftColor: HANWHA_ORANGE,
  },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  statusTitle: { fontSize: 14, fontWeight: '700', color: CHARCOAL },
  statusContent: { gap: 8 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusLabel: { fontSize: 13, color: MUTED },
  statusValue: { fontSize: 14, fontWeight: '600', color: CHARCOAL },
  statusDivider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 4 },
  statusBadge: { backgroundColor: ORANGE_FAINT, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  statusBadgeText: { fontSize: 12, fontWeight: '700', color: HANWHA_ORANGE },

  section: { marginBottom: 32 },
  sectionHeader: { fontSize: 17, fontWeight: '800', color: CHARCOAL, marginBottom: 12 },
  listContainer: { gap: 10 },

  selectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'transparent',
    ...CARD_SHADOW,
  },
  selectionCardActive: { borderColor: HANWHA_ORANGE, backgroundColor: '#fffbf7' },
  selectionCardDisabled: { backgroundColor: '#f3f4f6', opacity: 0.7 },
  selectionInfo: { flex: 1 },
  selectionTitle: { fontSize: 16, fontWeight: '700', color: CHARCOAL, marginBottom: 2 },
  selectionSub: { fontSize: 12, color: MUTED },
  selectionNote: { fontSize: 12, color: HANWHA_ORANGE, marginTop: 2 },
  textActive: { color: HANWHA_ORANGE },
  textDisabled: { color: '#9ca3af' },
  radioCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#d1d5db' },
  checkCircle: { width: 20, height: 20, borderRadius: 10, backgroundColor: HANWHA_ORANGE, alignItems: 'center', justifyContent: 'center' },

  placeholderBox: { padding: 20, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: 12 },
  placeholderText: { color: MUTED, fontSize: 13 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  locationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    minHeight: 60,
  },
  locationCardActive: { borderColor: HANWHA_ORANGE, backgroundColor: ORANGE_FAINT },
  locationText: { fontWeight: '600', color: CHARCOAL, textAlign: 'center', fontSize: 13 },
  locationTextActive: { color: HANWHA_ORANGE, fontWeight: '800' },

  toggleCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleCardActive: { borderColor: HANWHA_ORANGE, backgroundColor: ORANGE_FAINT },
  toggleTitle: { fontSize: 15, fontWeight: '700', color: CHARCOAL },
  toggleDesc: { fontSize: 12, color: MUTED, marginTop: 2 },

  actionButtons: { gap: 12 },
  submitBtnWrapper: { borderRadius: 14, overflow: 'hidden', ...CARD_SHADOW },
  submitBtn: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: '#ef4444', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },

  emptyText: { color: MUTED, fontSize: 13, textAlign: 'center', marginTop: 10 },
  pressedScale: { transform: [{ scale: 0.98 }] },
  pressedOpacity: { opacity: 0.7 },
});
