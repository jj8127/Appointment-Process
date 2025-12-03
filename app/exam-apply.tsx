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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** 시험 회차 + 지역 목록 조회 (관리자/FC 공용) */
// 시험 회차 + 지역 목록 조회 (생명보험용)
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
    // 생명보험 시험만
    .eq('exam_type', 'life')
    .order('exam_date', { ascending: true })
    .order('registration_deadline', { ascending: true })
    .order('sort_order', { foreignTable: 'exam_locations', ascending: true });

  if (error) {
    console.log('fetchRounds error', error);
    throw error;
  }

  // Supabase가 반환한 raw 데이터를 우리 타입에 맞게 변환
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

/** 둥근 공통 버튼 */
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

/** 내 최근 신청 내역 타입 (조인 결과 포함) */
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

  /** ① FC가 아닌 사용자는 접근 제한 */
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

  /** ② 시험 회차/지역 불러오기 */
  const {
    data: rounds,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['exam-rounds-for-apply','life'],
    queryFn: fetchRounds,
    enabled: role === 'fc',
  });

  /** 전체 등록된 시험 일정 (필터 없이) */
  const allRounds = useMemo(() => rounds ?? [], [rounds]);

  /** 회차가 마감되었는지 여부 */
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

  /** ③ 내 최근 시험 신청 내역 (가장 최근 1건) */
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
      return data as MyExamApply | null;
    },
  });

  /** exam_rounds / exam_locations가 배열이든 객체든 안전하게 한 개만 꺼내는 헬퍼 */
  const lastApplyRound =
    myLastApply && myLastApply.exam_rounds
      ? Array.isArray(myLastApply.exam_rounds)
        ? myLastApply.exam_rounds[0]
        : myLastApply.exam_rounds
      : null;

  const lastApplyLocation =
    myLastApply && myLastApply.exam_locations
      ? Array.isArray(myLastApply.exam_locations)
        ? myLastApply.exam_locations[0]
        : myLastApply.exam_locations
      : null;

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

      // ⭐ 핵심: 이미 신청 내역이 있으면 UPDATE(접수상태 초기화), 없으면 INSERT
      if (myLastApply) {
        const { error } = await supabase
          .from('exam_registrations')
          .update({
            round_id: selectedRoundId,
            location_id: selectedLocationId,
            status: 'applied',
            is_confirmed: false, // 일정 변경 시 총무 확인을 다시 받도록 초기화
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

      // 관리자 알림 기록
      const locName =
        round.locations?.find((l) => l.id === selectedLocationId)?.location_name ?? '';
      const examTitle = `${formatDate(round.exam_date)}${round.round_label ? ` (${round.round_label})` : ''}`;
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

  
  // ✅ 시험 신청 취소용 mutation
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

  const handleApply = () => {
    applyMutation.mutate();
  };

  // ✅ 취소 버튼 눌렀을 때 동작
  const handleCancel = () => {
    if (!myLastApply) {
      Alert.alert('취소 불가', '취소할 시험 신청 내역이 없습니다.');
      return;
    }

    Alert.alert('신청 취소', '현재 신청한 시험을 취소하시겠습니까?', [
      { text: '아니요', style: 'cancel' },
      {
        text: '예',
        style: 'destructive',
        onPress: () => cancelMutation.mutate(),
      },
    ]);
  };

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.caption}>정보를 불러오는 중입니다...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAwareWrapper>
        <ScrollView contentContainerStyle={styles.container}>
          {/* 상단 헤더 */}
          <View style={styles.headerRow}>
            <RefreshButton
              onPress={() => {
                refetch();
              }}
            />
            <Text style={styles.headerTitle}>생명보험 시험 신청</Text>
          </View>
          <Text style={styles.caption}>
            총무가 등록한 시험 일정에서 응시 일자와 지역을 선택해 신청할 수 있습니다.
            마감된 일정은 회색으로 표시되며 신청할 수 없습니다.
          </Text>

          {/* 내 최근 신청 내역 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>내 신청 내역</Text>
            {!myLastApply ? (
              <Text style={styles.caption}>아직 신청한 시험이 없습니다.</Text>
            ) : (
              <View style={styles.summaryBox}>
                <Text style={styles.summaryText}>
                  최근 신청일:{' '}
                  {myLastApply.created_at
                    ? new Date(myLastApply.created_at).toLocaleString('ko-KR')
                    : '-'}
                </Text>
                <Text style={styles.summaryText}>
                  시험 일자:{' '}
                  {lastApplyRound?.exam_date
                    ? formatDate(lastApplyRound.exam_date)
                    : '-'}
                  {lastApplyRound?.round_label
                    ? ` (${lastApplyRound.round_label})`
                    : ''}
                </Text>
                <Text style={styles.summaryText}>
                  응시 지역: {lastApplyLocation?.location_name ?? '-'}
                </Text>
                <Text style={styles.summaryText}>상태: {myLastApply.status ?? '-'}</Text>
                <Text style={styles.summaryText}>제3보험 응시: {myLastApply.is_third_exam ? '예' : '아니오'}</Text>
              </View>
            )}
          </View>

          {/* 1단계: 시험 일정 선택 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>1단계: 시험 일정 선택</Text>
            {isLoading || isFetching ? (
              <Text style={styles.caption}>시험 일정을 불러오는 중입니다...</Text>
            ) : !allRounds.length ? (
              <Text style={styles.caption}>
                등록된 시험 일정이 없습니다. 총무에게 문의해주세요.
              </Text>
            ) : (
              allRounds.map((round) => {
                const isActive = round.id === selectedRoundId;
                const closed = isRoundClosed(round);
                return (
                  <Pressable
                    key={round.id}
                    onPress={() => {
                      if (closed) {
                        Alert.alert(
                          '마감된 일정',
                          '신청 마감이 지난 일정입니다. 다른 시험 일정을 선택해주세요.',
                        );
                        return;
                      }
                      setSelectedRoundId(round.id);
                      setSelectedLocationId(null);
                    }}
                    style={[
                      styles.roundItem,
                      isActive && !closed && styles.roundItemActive,
                      closed && styles.roundItemClosed,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.roundTitle}>
                        {formatDate(round.exam_date)}{' '}
                        {round.round_label ? `(${round.round_label})` : ''}
                      </Text>
                      <Text style={styles.roundMeta}>
                        신청 마감: {formatDate(round.registration_deadline)}
                        {closed ? ' (마감됨)' : ''}
                      </Text>
                      {round.notes ? (
                        <Text style={styles.roundNote}>{round.notes}</Text>
                      ) : null}
                      <Text style={styles.roundMeta}>
                        응시 가능 지역 {round.locations?.length ?? 0}개
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>

          {/* 2단계: 응시 지역 선택 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>2단계: 응시 지역 선택</Text>
            {!selectedRound ? (
              <Text style={styles.caption}>
                먼저 상단에서 시험 일정을 선택하면, 해당 일정의 응시 지역 목록이 표시됩니다.
              </Text>
            ) : isSelectedRoundClosed ? (
              <Text style={styles.caption}>
                선택한 시험 일정은 신청 마감된 상태입니다. 다른 시험 일정을 선택해주세요.
              </Text>
            ) : !selectedRound.locations?.length ? (
              <Text style={styles.caption}>
                선택한 시험 일정에 등록된 응시 지역이 없습니다. 관리자에게 문의해주세요.
              </Text>
            ) : (
              selectedRound.locations.map((loc) => {
                const isActive = loc.id === selectedLocationId;
                return (
                  <Pressable
                    key={loc.id}
                    onPress={() => setSelectedLocationId(loc.id)}
                    style={[
                      styles.locationItem,
                      isActive && styles.locationItemActive,
                    ]}
                  >
                    <Text style={styles.locationName}>{loc.location_name}</Text>
                    <Text style={styles.locationMeta}>정렬: {loc.sort_order}</Text>
                  </Pressable>
                );
              })
            )}
          </View>

            {/* 3단계: 최종 신청 버튼 */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>3단계: 신청 완료하기</Text>
            <Text style={styles.caption}>
              시험 일정과 응시 지역을 모두 선택한 후 아래 버튼을 눌러 신청을 완료하세요.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable
                style={[styles.toggleBox, wantsThird ? styles.toggleOn : styles.toggleOff]}
                onPress={() => setWantsThird((v) => !v)}
              >
                <Text style={wantsThird ? styles.toggleTextOn : styles.toggleTextOff}>{wantsThird ? '예' : '아니오'}</Text>
              </Pressable>
              <Text style={styles.caption}>제3보험도 같이 응시</Text>
            </View>
            {isSelectedRoundClosed && selectedRound && (
              <Text style={styles.warningText}>
                선택한 시험 일정은 이미 신청 마감되었습니다. 다른 일정을 선택해야 신청할 수
                있습니다.
              </Text>
            )}

            {/* ✅ 이미 신청 내역이 있으면 '시험 신청 수정하기' 로 표시 */}
            <RoundedButton
              label={myLastApply ? '시험 신청 수정하기' : '시험 신청하기'}
              onPress={handleApply}
              variant="primary"
              disabled={
                applyMutation.isPending ||
                cancelMutation.isPending ||
                !selectedRoundId ||
                !selectedLocationId ||
                isSelectedRoundClosed
              }
            />

            {/* ✅ 신청 내역이 있을 때만 취소 버튼 노출 */}
            {myLastApply && (
              <View style={{ marginTop: 8 }}>
                <RoundedButton
                  label="시험 신청 취소"
                  onPress={handleCancel}
                  variant="danger"
                  disabled={cancelMutation.isPending}
                />
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SOFT_BG },
  container: { padding: 20, gap: 12 },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  caption: { color: MUTED },

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

  sectionTitle: { fontSize: 16, fontWeight: '800', color: CHARCOAL, marginBottom: 4 },

  summaryBox: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#f9fafb',
    gap: 4,
  },
  summaryText: {
    color: CHARCOAL,
  },

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
  roundItemClosed: {
    backgroundColor: '#f9fafb',
    borderColor: BORDER,
    opacity: 0.5,
  },
  roundTitle: { fontWeight: '700', color: CHARCOAL },
  roundMeta: { color: MUTED, marginTop: 2 },
  roundNote: { color: CHARCOAL, marginTop: 4 },

  locationItem: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 6,
    backgroundColor: '#fff',
  },
  locationItemActive: {
    borderColor: ORANGE,
    backgroundColor: '#fffbeb',
  },
  locationName: {
    fontWeight: '700',
    color: CHARCOAL,
  },
  locationMeta: {
    color: MUTED,
    marginTop: 2,
  },

  /** 둥근 버튼 스타일 */
  btnBase: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFullWidth: {
    width: '100%',
  },
  btnPrimary: {
    backgroundColor: ORANGE,
  },
  btnSecondary: {
    backgroundColor: ORANGE_LIGHT,
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
    color: '#7c2d12',
    fontWeight: '800',
    fontSize: 15,
  },
  btnTextDanger: {
    color: '#b91c1c',
    fontWeight: '800',
    fontSize: 14,
  },

  warningText: {
    color: '#b91c1c',
    marginBottom: 6,
  },
  toggleBox: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  toggleOn: { backgroundColor: ORANGE_LIGHT, borderColor: ORANGE },
  toggleOff: { backgroundColor: '#fff', borderColor: BORDER },
  toggleTextOn: { color: '#fff', fontWeight: '800' },
  toggleTextOff: { color: CHARCOAL, fontWeight: '800' },
});
