import { Feather } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { AnimatePresence, MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { RefreshButton } from '@/components/RefreshButton';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { useSession } from '@/hooks/use-session';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { ExamRoundWithLocations, formatDate } from '@/types/exam';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const SOFT_BG = '#F9FAFB';
const ORANGE_FAINT = '#fff1e6';
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const formatKoreanDate = (d: Date) =>
  `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;
const formatExamInfo = (dateStr?: string | null, label?: string | null) => {
  const labelPart = label || '';
  let datePart = '응시 날짜 미정';

  if (dateStr) {
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime())) {
      datePart = `${d.getMonth() + 1}월 ${d.getDate()}일`;
    }
  }

  if (labelPart) return `${labelPart} / ${datePart}`;
  return datePart;
};
const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.05,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};

async function notifyAdmin(title: string, body: string, residentId: string | null) {
  const { data, error } = await supabase.functions.invoke('fc-notify', {
    body: {
      type: 'notify',
      target_role: 'admin',
      target_id: residentId,
      title,
      body,
      category: 'exam_apply',
      url: '/exam-manage',
    },
  });
  if (error) throw error;
  if (!data?.ok) {
    throw new Error(data?.message ?? '알림 전송 실패');
  }
}

async function notifyFcSelf(title: string, body: string, residentId: string) {
  const { data, error } = await supabase.functions.invoke('fc-notify', {
    body: {
      type: 'notify',
      target_role: 'fc',
      target_id: residentId,
      title,
      body,
      category: 'exam_apply',
      url: '/exam-apply',
    },
  });
  if (error) throw error;
  if (!data?.ok) {
    throw new Error(data?.message ?? '알림 전송 실패');
  }
}

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
    logger.debug('fetchRounds error', { error });
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
  exam_rounds?: { exam_date: string; round_label: string | null } | null;
  exam_locations?: { location_name: string } | null;
  is_confirmed?: boolean | null;
};

function normalizeSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

export default function ExamApplyScreen() {
  const { role, residentId, displayName, hydrated } = useSession();
  useIdentityGate({ nextPath: '/exam-apply' });

  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [wantsLife, setWantsLife] = useState(true);
  const [wantsThird, setWantsThird] = useState(false);
  const [feePaidDate, setFeePaidDate] = useState<Date | null>(null);
  const [showFeePaidPicker, setShowFeePaidPicker] = useState(false);
  const [tempFeePaidDate, setTempFeePaidDate] = useState<Date | null>(null);
  const [selectedApplyId, setSelectedApplyId] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);



  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
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

  // FC 프로필 상태 조회 (수당 동의 검토 완료 여부)
  const { data: myProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['my-profile-status', residentId],
    enabled: role === 'fc' && !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fc_profiles')
        .select('status,allowance_date')
        .eq('phone', residentId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const allRounds = useMemo(() => rounds ?? [], [rounds]);

  const isRoundClosed = (round: ExamRoundWithLocations) => {
    const deadline = toDate(round.registration_deadline);
    if (!deadline) return false;
    // 신청 마감일은 당일 23:59:59까지 유효
    deadline.setHours(23, 59, 59, 999);
    return new Date() > deadline;
  };

  const selectedRound = useMemo(
    () => allRounds.find((r) => r.id === selectedRoundId) ?? null,
    [allRounds, selectedRoundId],
  );

  const isSelectedRoundClosed = useMemo(
    () => (selectedRound ? isRoundClosed(selectedRound) : false),
    [selectedRound],
  );

  const { data: myApplies = [], refetch: refetchMyApply } = useQuery<MyExamApply[]>({
    queryKey: ['my-exam-apply-life', residentId],
    enabled: role === 'fc' && !!residentId,
    queryFn: async (): Promise<MyExamApply[]> => {
      const { data, error } = await supabase
        .from('exam_registrations')
        .select(
          'id, round_id, location_id, status, is_confirmed, is_third_exam, created_at, exam_rounds!inner(exam_date, round_label, exam_type), exam_locations(location_name)',
        )
        .eq('resident_id', residentId)
        .eq('exam_rounds.exam_type', 'life')
        .order('created_at', { ascending: false });

      if (error && (error as any).code === '42P01') {
        return [];
      }
      if (error) throw error;

      return (data ?? [])
        .filter((d: any) => d.exam_rounds)
        .map((d: any) => ({
          ...d,
          exam_rounds: normalizeSingle(d.exam_rounds),
          exam_locations: normalizeSingle(d.exam_locations),
        })) as MyExamApply[];
    },
  });

  const currentApply = useMemo(() => {
    if (myApplies.length === 0) return null;
    return myApplies.find((a) => a.id === selectedApplyId) ?? myApplies[0];
  }, [myApplies, selectedApplyId]);

  const existingForRound = useMemo(
    () => myApplies.find((a) => a.round_id === selectedRoundId) ?? null,
    [myApplies, selectedRoundId],
  );
  const isConfirmedForRound = !!existingForRound?.is_confirmed;
  const lockMessage = '시험 접수가 완료되어 시험 일정을 수정할 수 없습니다.';
  // allowance_date가 있고 status가 pending이 아니면 신청 가능
  const isAllowanceApproved = Boolean(myProfile?.allowance_date) && myProfile?.status !== 'allowance-pending';

  // Realtime: 내 시험 접수 상태 변경 시 갱신
  useEffect(() => {
    if (!residentId) return;
    const regChannel = supabase
      .channel(`exam-apply-life-${residentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exam_registrations', filter: `resident_id=eq.${residentId}` },
        () => refetchMyApply(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(regChannel);
    };
  }, [residentId, refetchMyApply]);

  // 선택된 회차에 기존 신청이 있으면 데이터 복원
  useEffect(() => {
    if (existingForRound) {
      if (existingForRound.is_third_exam != null) setWantsThird(!!existingForRound.is_third_exam);
      setSelectedLocationId(existingForRound.location_id);
    } else {
      setSelectedLocationId(null);
      setWantsThird(false);
    }
    setFeePaidDate(null);
    setTempFeePaidDate(null);
  }, [existingForRound]);

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!residentId) {
        throw new Error('본인 식별 정보가 없습니다. 다시 로그인한 뒤 이용해주세요.');
      }
      if (!selectedRoundId || !selectedLocationId) {
        throw new Error('시험 일정과 응시 지역을 모두 선택해주세요.');
      }
      if (!feePaidDate) {
        throw new Error('응시료 납입 일자를 입력해주세요.');
      }

      if (isConfirmedForRound) {
        throw new Error(lockMessage);
      }

      // runtime validation: 방어적으로 undefined/string "undefined"가 넘어가지 않도록 보정
      const roundId = selectedRoundId === 'undefined' ? null : selectedRoundId;
      const locationId = selectedLocationId === 'undefined' ? null : selectedLocationId;

      if (!roundId || !locationId) {
        throw new Error('시험 일정과 응시 지역을 다시 선택해주세요.');
      }

      const round = allRounds?.find((r) => r.id === roundId);
      if (!round) {
        throw new Error('선택한 시험 일정 정보를 다시 확인해주세요.');
      }

      if (isRoundClosed(round)) {
        throw new Error('마감된 일정입니다. 다른 시험 일정을 선택해주세요.');
      }

      if (existingForRound) {
        // 선택된 회차에 기존 신청이 있으면 UPDATE
        const { error } = await supabase
          .from('exam_registrations')
          .update({
            location_id: locationId,
            status: 'applied',
            is_confirmed: false,
            is_third_exam: wantsThird,
            fee_paid_date: toYmd(feePaidDate),
          })
          .eq('id', existingForRound.id);

        if (error) throw error;
      } else {
        // 새 회차 신청 → INSERT
        const { error } = await supabase.from('exam_registrations').insert({
          resident_id: residentId,
          round_id: roundId,
          location_id: locationId,
          status: 'applied',
          is_confirmed: false,
          is_third_exam: wantsThird,
          fee_paid_date: toYmd(feePaidDate),
        });

        if (error) throw error;
      }

      const locName =
        round.locations?.find((l) => l.id === selectedLocationId)?.location_name ?? '';
      const examTitle = `${formatDate(round.exam_date)}${round.round_label ? ` (${round.round_label})` : ''
        }`;
      const actor = displayName?.trim() || residentId;
      const title = `${actor}님이 ${examTitle}을 신청하였습니다.`;
      const body = locName ? `${actor}님이 ${examTitle} (${locName})을 신청하였습니다.` : title;

      await notifyAdmin(title, body, residentId);
      await notifyFcSelf('시험 신청이 접수되었습니다.', `${examTitle}${locName ? ` (${locName})` : ''} 접수가 완료되었습니다.`, residentId);
    },
    onSuccess: () => {
      Alert.alert('신청 완료', '시험 신청이 정상적으로 등록되었습니다.');
      refetchMyApply();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '시험 신청 중 오류가 발생했습니다.';
        Alert.alert('신청 실패', message);
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      const target = myApplies.find((a) => a.id === registrationId);
      if (!target) {
        throw new Error('취소할 신청 내역이 없습니다.');
      }

      if (target.is_confirmed) {
        throw new Error(lockMessage);
      }

      const { error } = await supabase
        .from('exam_registrations')
        .delete()
        .eq('id', registrationId);

      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert('취소 완료', '시험 신청이 취소되었습니다.');
      refetchMyApply();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '시험 신청 취소 중 오류가 발생했습니다.';
        Alert.alert('취소 실패', message);
      }
    },
  });

  const handleCancelPress = (registrationId: string) => {
    const target = myApplies.find((a) => a.id === registrationId);
    if (!target) {
      Alert.alert('알림', '취소할 신청 내역이 없습니다.');
      return;
    }
    if (target.is_confirmed) {
      Alert.alert('알림', lockMessage);
      return;
    }
    if (Platform.OS === 'web') {
      cancelMutation.mutate(registrationId);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert('신청 취소', '정말 취소하시겠습니까?', [
      { text: '아니요', style: 'cancel' },
      { text: '예', style: 'destructive', onPress: () => cancelMutation.mutate(registrationId) },
    ]);
  };

  const handleRoundSelect = (round: ExamRoundWithLocations) => {
    const confirmedForThis = myApplies.find((a) => a.round_id === round.id)?.is_confirmed;
    if (confirmedForThis) {
      Alert.alert('수정 불가', lockMessage);
      return;
    }
    if (isRoundClosed(round)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.selectionAsync();
    setSelectedRoundId(round.id);
  };

  const handleLocationSelect = (id: string) => {
    if (isConfirmedForRound) {
      Alert.alert('수정 불가', lockMessage);
      return;
    }
    Haptics.selectionAsync();
    setSelectedLocationId(id);
  };

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={HANWHA_ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAwareWrapper>
        <ScrollView
          contentContainerStyle={styles.container}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>생명보험/제3보험 시험 신청</Text>
              <Text style={styles.headerSub}>시험 일정과 응시 지역을 선택해주세요.</Text>
            </View>
            <RefreshButton
              onPress={() => {
                refetch();
              }}
            />
          </View>

          {/* Status Card - 내 신청 내역 (드롭다운 방식) */}
          <MotiView
            from={{ opacity: 0, translateY: -10 }}
            animate={{ opacity: 1, translateY: 0 }}
            style={styles.statusCard}
          >
            <View style={styles.statusHeader}>
              <Feather name="info" size={16} color={HANWHA_ORANGE} />
              <Text style={styles.statusTitle}>내 신청 내역</Text>
            </View>

            {myApplies.length === 0 ? (
              <Text style={styles.emptyText}>아직 신청한 시험이 없습니다.</Text>
            ) : (
              <View style={styles.statusContent}>
                {/* 1. 신청 내역 선택 드롭다운 (2건 이상일 때만 활성화) */}
                <Pressable
                  style={[styles.dropdownButton, isDropdownOpen && styles.dropdownButtonActive]}
                  onPress={() => {
                    if (myApplies.length > 1) {
                      Haptics.selectionAsync();
                      setIsDropdownOpen((prev) => !prev);
                    }
                  }}
                  disabled={myApplies.length <= 1}
                >
                  <Text style={styles.dropdownButtonText}>
                    {currentApply
                      ? formatExamInfo(currentApply.exam_rounds?.exam_date, currentApply.exam_rounds?.round_label)
                      : '선택된 내역 없음'}
                  </Text>
                  {myApplies.length > 1 && (
                    <Feather
                      name={isDropdownOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={CHARCOAL}
                    />
                  )}
                </Pressable>

                {/* 2. 드롭다운 리스트 (열렸을 때) */}
                {isDropdownOpen && myApplies.length > 1 && (
                  <MotiView
                    from={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    style={styles.dropdownList}
                  >
                    {myApplies.map((apply) => {
                      const isSelected = currentApply?.id === apply.id;
                      return (
                        <Pressable
                          key={apply.id}
                          style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                          onPress={() => {
                            setSelectedApplyId(apply.id);
                            setIsDropdownOpen(false);
                            Haptics.selectionAsync();
                          }}
                        >
                          <Text
                            style={[
                              styles.dropdownItemText,
                              isSelected && styles.dropdownItemTextActive,
                            ]}
                          >
                            {formatExamInfo(apply.exam_rounds?.exam_date, apply.exam_rounds?.round_label)}
                          </Text>
                          {isSelected && <Feather name="check" size={14} color={HANWHA_ORANGE} />}
                        </Pressable>
                      );
                    })}
                  </MotiView>
                )}

                {/* 3. 선택된 내역 상세 정보 */}
                {currentApply && (
                  <View style={styles.applyDetailCard}>
                    <View style={styles.statusRow}>
                      <Text style={styles.statusLabel}>시험일자</Text>
                      <Text style={styles.statusValue}>
                        {formatExamInfo(currentApply.exam_rounds?.exam_date, currentApply.exam_rounds?.round_label)}
                      </Text>
                    </View>
                    <View style={styles.statusRow}>
                      <Text style={styles.statusLabel}>응시지역</Text>
                      <Text style={styles.statusValue}>
                        {currentApply.exam_locations?.location_name ?? '-'}
                      </Text>
                    </View>
                    <View style={styles.statusRow}>
                      <Text style={styles.statusLabel}>신청 과목</Text>
                      <Text style={styles.statusValue}>
                        {currentApply.is_third_exam ? '생명, 제3' : '생명'}
                      </Text>
                    </View>
                    <View style={styles.statusRow}>
                      <Text style={styles.statusLabel}>상태</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View
                          style={[
                            styles.statusBadge,
                            currentApply.is_confirmed ? styles.badgeConfirmed : styles.badgePending,
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              currentApply.is_confirmed ? styles.textConfirmed : styles.textPending,
                            ]}
                          >
                            {currentApply.is_confirmed ? '접수 완료' : '미접수'}
                          </Text>
                        </View>
                        {!currentApply.is_confirmed && (
                          <Pressable onPress={() => handleCancelPress(currentApply.id)}>
                            <Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '600' }}>취소</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </View>
                )}
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
                  const alreadyApplied = myApplies.some((a) => a.round_id === round.id);
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
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
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
                            {alreadyApplied && (
                              <View style={{ backgroundColor: '#DBEAFE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                <Text style={{ fontSize: 11, color: '#2563EB', fontWeight: '700' }}>신청됨</Text>
                              </View>
                            )}
                          </View>
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
            <Text style={styles.sectionHeader}>✅ 응시 과목</Text>

            <View style={{ gap: 10 }}>
              <Pressable
                style={[styles.toggleCard, wantsLife && styles.toggleCardActive]}
                onPress={() => {
                  if (isConfirmedForRound) {
                    Alert.alert('수정 불가', lockMessage);
                  } else {
                    Haptics.selectionAsync();
                    setWantsLife((v) => !v);
                  }
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Feather
                    name={wantsLife ? 'check-square' : 'square'}
                    size={24}
                    color={wantsLife ? HANWHA_ORANGE : MUTED}
                  />
                  <View>
                    <Text style={styles.toggleTitle}>생명보험</Text>
                    <Text style={styles.toggleDesc}>생명보험 자격 시험을 신청합니다.</Text>
                  </View>
                </View>
              </Pressable>

              <Pressable
                style={[styles.toggleCard, wantsThird && styles.toggleCardActive]}
                onPress={() => {
                  if (isConfirmedForRound) {
                    Alert.alert('수정 불가', lockMessage);
                  } else {
                    Haptics.selectionAsync();
                    setWantsThird((v) => !v);
                  }
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Feather
                    name={wantsThird ? 'check-square' : 'square'}
                    size={24}
                    color={wantsThird ? HANWHA_ORANGE : MUTED}
                  />
                  <View>
                    <Text style={styles.toggleTitle}>제3보험</Text>
                    <Text style={styles.toggleDesc}>제3보험 자격 시험을 신청합니다.</Text>
                  </View>
                </View>
              </Pressable>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.sectionHeader}>📅 응시료 납입 일자</Text>
              <Text style={styles.inputHint}>접수비 반환을 위해 입금 날짜를 반드시 입력해주세요.</Text>
              <Pressable
                style={styles.dateInput}
                onPress={() => {
                  setTempFeePaidDate(feePaidDate ?? new Date());
                  setShowFeePaidPicker(true);
                }}
              >
                <Text style={[styles.dateInputText, !feePaidDate && styles.dateInputPlaceholder]}>
                  {feePaidDate ? formatKoreanDate(feePaidDate) : '날짜를 선택해주세요'}
                </Text>
                <Feather name="calendar" size={18} color={MUTED} />
              </Pressable>
              {showFeePaidPicker && Platform.OS !== 'ios' && (
                <DateTimePicker
                  value={feePaidDate ?? new Date()}
                  mode="date"
                  display="default"
                  locale="ko-KR"
                  onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
                    setShowFeePaidPicker(false);
                    if (event.type === 'dismissed') {
                      return;
                    }
                    if (selectedDate) setFeePaidDate(selectedDate);
                  }}
                />
              )}
            </View>

            <View style={styles.actionButtons}>
              <Pressable
                onPress={() => {
                  if (isConfirmedForRound) {
                    Alert.alert('알림', lockMessage);
                    return;
                  }
                  if (!wantsLife && !wantsThird) {
                    Alert.alert('알림', '응시할 과목을 한 개 이상 선택해주세요.');
                    return;
                  }
                  applyMutation.mutate();
                }}
                disabled={
                  applyMutation.isPending ||
                  !selectedRoundId ||
                  !selectedLocationId ||
                  !feePaidDate ||
                  isSelectedRoundClosed ||
                  isConfirmedForRound
                }
                style={({ pressed }) => [styles.submitBtnWrapper, pressed && styles.pressedScale]}
              >
                <LinearGradient
                  colors={
                    isConfirmedForRound || !selectedRoundId || !selectedLocationId || !feePaidDate
                      ? ['#d1d5db', '#9ca3af']
                      : [HANWHA_ORANGE, '#fb923c']
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.submitBtn}
                >
                  <Text style={styles.submitBtnText}>
                    {isConfirmedForRound ? '시험 접수 완료' : existingForRound ? '신청 내역 수정하기' : '시험 신청하기'}
                  </Text>
                  {applyMutation.isPending && <ActivityIndicator color="#fff" style={{ marginLeft: 8 }} />}
                </LinearGradient>
              </Pressable>
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>

        {Platform.OS === 'ios' && (
          <Modal visible={showFeePaidPicker} transparent animationType="fade">
            <View style={styles.pickerOverlay}>
              <View style={styles.pickerCard}>
                <DateTimePicker
                  value={tempFeePaidDate ?? feePaidDate ?? new Date()}
                  mode="date"
                  display="spinner"
                  locale="ko-KR"
                  onChange={(_, selectedDate) => {
                    if (selectedDate) setTempFeePaidDate(selectedDate);
                  }}
                />
                <View style={styles.pickerButtons}>
                  <Pressable
                    style={[styles.pickerButton, styles.pickerCancel]}
                    onPress={() => {
                      setShowFeePaidPicker(false);
                      setTempFeePaidDate(null);
                    }}
                  >
                    <Text style={styles.pickerCancelText}>취소</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.pickerButton, styles.pickerConfirm]}
                    onPress={() => {
                      if (tempFeePaidDate) setFeePaidDate(tempFeePaidDate);
                      setShowFeePaidPicker(false);
                      setTempFeePaidDate(null);
                    }}
                  >
                    <Text style={styles.pickerConfirmText}>확인</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        )}

        {!profileLoading && role === 'fc' && !isAllowanceApproved && (
          <Pressable
            style={styles.blockOverlay}
            onPress={() => Alert.alert('알림', '수당 동의 검토 후 이용할 수 있습니다.')}
          >
            <Text style={styles.blockText}>수당 동의 검토 중입니다.</Text>
            <Text style={styles.blockSubText}>총무 검토 완료 후 시험 신청이 가능합니다.</Text>
          </Pressable>
        )}
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SOFT_BG },
  container: { padding: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: CHARCOAL, marginBottom: 4 }, // 24 -> 28
  headerSub: { fontSize: 16, color: MUTED }, // 14 -> 16

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
  statusTitle: { fontSize: 16, fontWeight: '700', color: CHARCOAL }, // 14 -> 16
  statusContent: { gap: 12 },

  // Dropdown Styles
  dropdownButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dropdownButtonActive: {
    borderColor: HANWHA_ORANGE,
  },
  dropdownButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: CHARCOAL,
  },
  dropdownList: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    marginTop: -4,
    marginBottom: 8,
    overflow: 'hidden',
    ...CARD_SHADOW,
    zIndex: 10,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  dropdownItemActive: {
    backgroundColor: '#fff7ed',
  },
  dropdownItemText: {
    fontSize: 14,
    color: CHARCOAL,
  },
  dropdownItemTextActive: {
    color: HANWHA_ORANGE,
    fontWeight: '700',
  },
  applyDetailCard: {
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    gap: 10,
  },

  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusLabel: { fontSize: 15, color: MUTED }, // 13 -> 15
  statusValue: { fontSize: 16, fontWeight: '600', color: CHARCOAL }, // 14 -> 16
  statusDivider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  statusBadgeText: { fontSize: 13, fontWeight: '700' }, // 12 -> 13
  badgeConfirmed: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  badgePending: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  textConfirmed: { color: '#059669' },
  textPending: { color: '#b45309' },

  section: { marginBottom: 32 },
  sectionHeader: { fontSize: 20, fontWeight: '800', color: CHARCOAL, marginBottom: 12 }, // 17 -> 20
  listContainer: { gap: 10 },

  selectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18, // 16 -> 18
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
  selectionTitle: { fontSize: 18, fontWeight: '700', color: CHARCOAL, marginBottom: 4 }, // 16 -> 18
  selectionSub: { fontSize: 14, color: MUTED }, // 12 -> 14
  selectionNote: { fontSize: 14, color: HANWHA_ORANGE, marginTop: 4 }, // 12 -> 14
  textActive: { color: HANWHA_ORANGE },
  textDisabled: { color: '#9ca3af' },
  radioCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#d1d5db' }, // 20 -> 24
  checkCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: HANWHA_ORANGE, alignItems: 'center', justifyContent: 'center' }, // 20 -> 24

  placeholderBox: { padding: 20, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: 12 },
  placeholderText: { color: MUTED, fontSize: 15 }, // 13 -> 15
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  locationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 16, // 14 -> 16
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    minHeight: 64, // 60 -> 64
  },
  locationCardActive: { borderColor: HANWHA_ORANGE, backgroundColor: ORANGE_FAINT },
  locationText: { fontWeight: '600', color: CHARCOAL, textAlign: 'center', fontSize: 15 }, // 13 -> 15
  locationTextActive: { color: HANWHA_ORANGE, fontWeight: '800' },

  toggleCard: {
    backgroundColor: '#fff',
    padding: 18, // 16 -> 18
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleCardActive: { borderColor: HANWHA_ORANGE, backgroundColor: ORANGE_FAINT },
  toggleTitle: { fontSize: 17, fontWeight: '700', color: CHARCOAL }, // 15 -> 17
  toggleDesc: { fontSize: 14, color: MUTED, marginTop: 4 }, // 12 -> 14
  inputGroup: { marginTop: 18, marginBottom: 6 },
  dateInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputHint: { fontSize: 13, color: '#b45309', marginBottom: 10 },
  dateInputText: { fontSize: 15, color: CHARCOAL, fontWeight: '600' },
  dateInputPlaceholder: { color: MUTED, fontWeight: '500' },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pickerCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxWidth: 360,
  },
  pickerButtons: { flexDirection: 'row', gap: 12, marginTop: 12 },
  pickerButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
  },
  pickerCancel: { borderColor: BORDER, backgroundColor: '#fff' },
  pickerConfirm: { borderColor: HANWHA_ORANGE, backgroundColor: ORANGE_FAINT },
  pickerCancelText: { color: MUTED, fontWeight: '600' },
  pickerConfirmText: { color: HANWHA_ORANGE, fontWeight: '700' },

  actionButtons: { gap: 12 },
  submitBtnWrapper: { borderRadius: 14, overflow: 'hidden', ...CARD_SHADOW },
  submitBtn: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }, // 16 -> 18
  submitBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' }, // 16 -> 18
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: '#ef4444', fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' }, // 14 -> 16

  emptyText: { color: MUTED, fontSize: 15, textAlign: 'center', marginTop: 10 }, // 13 -> 15
  pressedScale: { transform: [{ scale: 0.98 }] },
  pressedOpacity: { opacity: 0.7 },
  blockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  blockText: { color: CHARCOAL, fontSize: 27, fontWeight: '800', marginBottom: 6 },
  blockSubText: { color: MUTED, fontSize: 16, textAlign: 'center' },
});
