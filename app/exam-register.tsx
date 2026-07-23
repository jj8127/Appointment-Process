import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { FocusEvent as RNFocusEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { invokeAdminAction } from '@/lib/admin-action-api';
import { invokeFcNotifyForDelivery } from '@/lib/fc-notify-client';
import {
  buildExamRoundLocationRows,
  hasExamRoundLocationsForSave,
} from '@/lib/exam-round-location-payload';
import {
  buildExamRoundNotificationPayload,
  getExamFlowConfig,
  getExamRoundCreateFormState,
  getExamRoundEditFormState,
  sortExamRoundsNewestFirst,
  type ExamNotifyPayload,
} from '@/lib/exam-flow-contract';
import { supabase } from '@/lib/supabase';
import { ExamRoundWithLocations, formatDate } from '@/types/exam';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';
const BACKGROUND = '#F3F4F6';
const INPUT_BG = '#F9FAFB';
const examFlowType = 'life' as const;
const examFlowConfig = getExamFlowConfig(examFlowType);

async function notifyExamFlow(payload: ExamNotifyPayload) {
  return invokeFcNotifyForDelivery(payload);
}

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
    .eq('exam_type', examFlowConfig.examType)
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
  variant?: 'primary' | 'secondary' | 'danger' | 'accent';
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
        : variant === 'accent'
          ? styles.btnAccent
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
  const { role, readOnly, residentId } = useSession();
  const canEdit = role === 'admin' && !readOnly;
  const assertCanEdit = () => {
    if (!canEdit) {
      throw new Error('본부장은 조회 전용 계정입니다.');
    }
  };

  const [roundForm, setRoundForm] = useState<RoundForm>(emptyRoundForm);
  const [examDate, setExamDate] = useState(new Date());
  const [deadlineDate, setDeadlineDate] = useState(new Date());
  const [showExamPicker, setShowExamPicker] = useState(Platform.OS === 'ios');
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(Platform.OS === 'ios');
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [locationInput, setLocationInput] = useState('');
  const [locationOrder, setLocationOrder] = useState('0');
  const [draftLocations, setDraftLocations] = useState<{ id: string; name: string; order: number }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [notesHeight, setNotesHeight] = useState(80);
  const [showForm, setShowForm] = useState(false);
  const isEditMode = Boolean(selectedRoundId);
  const canAddLocation = canEdit && locationInput.trim().length > 0;

  // 애니메이션 값
  const scrollViewRef = useRef<ScrollView | null>(null);
  const focusedInputTargetRef = useRef<RNFocusEvent['target'] | null>(null);
  const formOffsetYRef = useRef(0);
  const formOpacity = useRef(new Animated.Value(0)).current;
  const formTranslateY = useRef(new Animated.Value(24)).current;
  const [pendingFormScroll, setPendingFormScroll] = useState(false);

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
    queryKey: examFlowConfig.registerRoundsQueryKey,
    queryFn: fetchRounds,
  });

  useEffect(() => {
    const roundChannel = supabase
      .channel(examFlowConfig.registerRoundChannel)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_rounds' }, () => refetch())
      .subscribe();
    const locationChannel = supabase
      .channel(examFlowConfig.registerLocationChannel)
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

  const sortedRounds = useMemo(() => sortExamRoundsNewestFirst(rounds ?? []), [rounds]);

  const selectedRound = useMemo(
    () => sortedRounds.find((r) => r.id === selectedRoundId) ?? null,
    [sortedRounds, selectedRoundId],
  );

  // 폼 열릴 때 슬라이드-인 애니메이션
  useEffect(() => {
    if (showForm) {
      formOpacity.setValue(0);
      formTranslateY.setValue(24);
      Animated.parallel([
        Animated.timing(formOpacity, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.spring(formTranslateY, {
          toValue: 0,
          friction: 8,
          tension: 65,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [showForm, formOpacity, formTranslateY]);

  // 폼 닫기 (슬라이드-아웃 후 unmount)
  const closeFormWithAnim = useCallback(() => {
    setPendingFormScroll(false);
    Animated.parallel([
      Animated.timing(formOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(formTranslateY, { toValue: -12, duration: 200, useNativeDriver: true }),
    ]).start(() => setShowForm(false));
  }, [formOpacity, formTranslateY]);

  const scrollToForm = useCallback(() => {
    scrollViewRef.current?.scrollTo({
      y: Math.max(formOffsetYRef.current - 12, 0),
      animated: true,
    });
  }, []);

  const scrollFocusedInputIntoView = useCallback(
    (event: RNFocusEvent) => {
      if (Platform.OS === 'web') return;
      focusedInputTargetRef.current = event.target;
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollResponderScrollNativeHandleToKeyboard(
          event.target,
          28,
          true,
        );
      });
    },
    [],
  );

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const eventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(eventName, () => {
      const target = focusedInputTargetRef.current;
      if (target == null) return;
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollResponderScrollNativeHandleToKeyboard(target, 28, true);
      });
    });
    return () => subscription.remove();
  }, []);

  const requestFormScroll = useCallback(() => {
    setPendingFormScroll(true);
  }, []);

  const handleFormLayout = useCallback(
    (event: LayoutChangeEvent) => {
      formOffsetYRef.current = event.nativeEvent.layout.y;
      if (pendingFormScroll && formOffsetYRef.current > 0) {
        requestAnimationFrame(() => {
          scrollToForm();
          setPendingFormScroll(false);
        });
      }
    },
    [pendingFormScroll, scrollToForm],
  );

  useEffect(() => {
    if (!showForm || !pendingFormScroll || formOffsetYRef.current <= 0) return;
    const timer = setTimeout(() => {
      scrollToForm();
      setPendingFormScroll(false);
    }, 100);
    return () => clearTimeout(timer);
  }, [pendingFormScroll, scrollToForm, showForm]);

  const saveRound = useMutation({
    mutationFn: async (mode: 'create' | 'update') => {
      assertCanEdit();
      const payload = {
        exam_type: examFlowConfig.examType,
        exam_date: toYmd(examDate),
        registration_deadline: toYmd(deadlineDate),
        round_label: roundForm.roundLabel.trim() || null,
        notes: roundForm.notes.trim() || null,
      };
      if (mode === 'update' && !selectedRoundId) {
        throw new Error('수정할 시험 차수가 선택되지 않았습니다.');
      }

      const locationRows = buildExamRoundLocationRows({
        draftLocations,
        pendingLocationName: locationInput,
        pendingLocationOrder: locationOrder,
      });
      const existingLocationCount = mode === 'update' ? (selectedRound?.locations?.length ?? 0) : 0;
      if (!hasExamRoundLocationsForSave(existingLocationCount, locationRows)) {
        throw new Error('응시 지역을 1개 이상 입력해주세요.');
      }

      const result = await invokeAdminAction(residentId ?? '', 'upsertExamRound', {
        roundId: mode === 'update' ? selectedRoundId : null,
        data: payload,
        locations: locationRows,
      });

      const savedId = (result.roundId as string | undefined) ?? selectedRoundId ?? null;
      if (!savedId) {
        throw new Error('시험 일정 저장에 실패했습니다.');
      }
      return { id: savedId };
    },
    onSuccess: async (res, mode) => {
      closeFormWithAnim();
      refetch();
      if (res?.id) {
        setSelectedRoundId(res.id);
      }
      setDraftLocations([]);
      setLocationInput('');
      setLocationOrder('0');

      const examTitle = `${formatDate(toYmd(examDate) || '')}${roundForm.roundLabel ? ` (${roundForm.roundLabel})` : ''}`;
      const actionLabel = mode === 'create' ? '등록' : '수정';
      const notificationPayload = buildExamRoundNotificationPayload({
        examType: examFlowType,
        title: `${examTitle} 일정이 ${actionLabel}되었습니다.`,
        body: '응시를 희망하는 경우 신청해주세요.',
      });
      const notificationResult = await notifyExamFlow(notificationPayload);
      const savedMessage = mode === 'create'
        ? '새 시험 일정이 등록되었습니다.'
        : '시험 일정이 업데이트되었습니다.';
      Alert.alert(
        notificationResult.confirmed ? '저장 완료' : '저장 완료 · 알림 확인 필요',
        notificationResult.confirmed
          ? savedMessage
          : `${savedMessage}\n\n가람in 알림 전달을 확인하지 못했습니다.`,
      );
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.';
        Alert.alert('저장 실패', message);
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _addLocation = useMutation({
    mutationFn: async () => {
      assertCanEdit();
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
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '지역 추가 중 오류가 발생했습니다.';
        Alert.alert('지역 추가 실패', message);
      }
    },
  });

  const deleteRound = useMutation({
    mutationFn: async (id: string) => {
      assertCanEdit();
      await invokeAdminAction(residentId ?? '', 'deleteExamRound', { roundId: id });
    },
    onSuccess: () => {
      refetch();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '삭제 중 오류가 발생했습니다.';
        Alert.alert('삭제 실패', message);
      }
    },
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
    const createState = getExamRoundCreateFormState();
    setSelectedRoundId(createState.selectedRoundId);
    setRoundForm(createState.roundForm);
    setExamDate(createState.examDate);
    setDeadlineDate(createState.deadlineDate);
    setShowExamPicker(Platform.OS === 'ios');
    setShowDeadlinePicker(Platform.OS === 'ios');
    setLocationInput(createState.locationInput);
    setLocationOrder(createState.locationOrder);
    setDraftLocations(createState.draftLocations);
    if (!showForm) {
      setShowForm(true);
    }
    requestFormScroll();
  };

  const handleSelectRound = (round: ExamRoundWithLocations) => {
    const editState = getExamRoundEditFormState(round);
    setSelectedRoundId(editState.selectedRoundId);
    setRoundForm(editState.roundForm);
    setExamDate(editState.examDate);
    setDeadlineDate(editState.deadlineDate);
    setShowExamPicker(Platform.OS === 'ios');
    setShowDeadlinePicker(Platform.OS === 'ios');
    setLocationInput(editState.locationInput);
    setLocationOrder(editState.locationOrder);
    setDraftLocations(editState.draftLocations);
    if (!showForm) {
      setShowForm(true);
    }
    requestFormScroll();
  };

  const screenContent = (
    <ScrollView
      ref={scrollViewRef}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
          <View style={styles.headerRow}>
            <RefreshButton onPress={() => { refetch() }} />
            <Text style={styles.headerTitle}>생명보험 시험 일정 관리</Text>
          </View>
          <Text style={styles.caption}>
            시험 일자, 신청 마감일, 차수/메모, 비고와 응시 지역을 한 번에 입력해 저장합니다.
          </Text>

          {/* 등록된 시험 일정 목록 */}
          <View style={styles.card}>
            <View style={styles.listSectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>등록된 시험 일정</Text>
                {sortedRounds.length > 0 && (
                  <Text style={styles.sectionCount}>{sortedRounds.length}개 등록됨</Text>
                )}
              </View>
              {canEdit && (
                <Pressable
                  onPress={startNewRound}
                  style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
                >
                  <Feather name="plus" size={15} color="#fff" />
                  <Text style={styles.addButtonText}>시험 추가</Text>
                </Pressable>
              )}
            </View>

            {isLoading || isFetching ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyCaption}>불러오는 중...</Text>
              </View>
            ) : !sortedRounds.length ? (
              <View style={styles.emptyState}>
                <Feather name="calendar" size={38} color="#D1D5DB" />
                <Text style={styles.emptyTitle}>등록된 시험 일정이 없습니다</Text>
                {canEdit && (
                  <Text style={styles.emptyCaption}>우측 상단 [시험 추가]를 눌러 등록하세요.</Text>
                )}
              </View>
            ) : (
              <View style={styles.roundList}>
                {sortedRounds.map((round) => {
                  const isSelected = selectedRoundId === round.id;
                  return (
                    <View
                      key={round.id}
                      style={[styles.roundItem, isSelected && styles.roundItemActive]}
                    >
                      {/* 왼쪽 액센트 바 */}
                      <View style={[styles.roundAccent, isSelected && styles.roundAccentActive]} />

                      {/* 내용 */}
                      <View style={styles.roundContent}>
                        <Text style={[styles.roundTitle, isSelected && styles.roundTitleActive]}>
                          {formatDate(round.exam_date)}
                          {round.round_label ? (
                            <Text style={styles.roundLabelInline}> · {round.round_label}</Text>
                          ) : null}
                        </Text>
                        <View style={styles.roundMetaRow}>
                          <Feather name="calendar" size={11} color={MUTED} />
                          <Text style={styles.roundMetaText}>
                            마감 {formatDate(round.registration_deadline)}
                          </Text>
                        </View>
                        <View style={styles.roundMetaRow}>
                          <Feather name="map-pin" size={11} color={MUTED} />
                          <Text style={styles.roundMetaText}>
                            지역 {round.locations?.length ?? 0}개
                          </Text>
                        </View>
                      </View>

                      {/* 액션 버튼 */}
                      <View style={styles.roundActions}>
                        <Pressable
                          onPress={() => handleSelectRound(round)}
                          disabled={!canEdit}
                          style={({ pressed }) => [
                            styles.actionBtn,
                            styles.editActionBtn,
                            !canEdit && styles.badgeDisabled,
                            pressed && styles.actionBtnPressed,
                          ]}
                        >
                          <Feather name="edit-2" size={12} color={canEdit ? '#1d4ed8' : '#9CA3AF'} />
                          <Text style={[styles.actionBtnText, styles.editBtnText, !canEdit && styles.badgeTextDisabled]}>
                            수정
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleDeleteRound(round.id)}
                          disabled={!canEdit}
                          style={({ pressed }) => [
                            styles.actionBtn,
                            styles.deleteActionBtn,
                            !canEdit && styles.badgeDisabled,
                            pressed && styles.actionBtnPressed,
                          ]}
                        >
                          <Feather name="trash-2" size={12} color={canEdit ? '#b91c1c' : '#9CA3AF'} />
                          <Text style={[styles.actionBtnText, styles.deleteBtnText, !canEdit && styles.badgeTextDisabled]}>
                            삭제
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* 입력 폼 (애니메이션 슬라이드) */}
          {showForm && (
            <Animated.View
              onLayout={handleFormLayout}
              style={{
                opacity: formOpacity,
                transform: [{ translateY: formTranslateY }],
              }}
            >
              <View style={[styles.card, styles.formCard]}>
                {/* 폼 헤더 */}
                <View style={styles.formHeader}>
                  <View style={styles.formHeaderLeft}>
                    <View style={[styles.formModeDot, isEditMode && styles.formModeDotEdit]} />
                    <Text style={styles.formModeLabel}>
                      {isEditMode
                        ? `수정 중: ${formatDate(selectedRound?.exam_date ?? '')}${selectedRound?.round_label ? ` · ${selectedRound.round_label}` : ''}`
                        : '새 시험 일정 등록'}
                    </Text>
                  </View>
                  <Pressable onPress={closeFormWithAnim} hitSlop={8} style={styles.formCloseBtn}>
                    <Feather name="x" size={18} color={MUTED} />
                  </Pressable>
                </View>

                <View style={styles.divider} />

                <Text style={styles.label}>시험 일자</Text>
                {Platform.OS === 'ios' || Platform.OS === 'web' ? (
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
                    <Feather name="calendar" size={15} color={CHARCOAL} />
                    <Text style={styles.dateText}>{formatKoreanDate(examDate)}</Text>
                  </Pressable>
                )}
                {showExamPicker && Platform.OS !== 'ios' && (
                  <DateTimePicker
                    value={examDate}
                    mode="date"
                    display="default"
                    onChange={(event, date) => {
                      setShowExamPicker(false);
                      if (event.type === 'set' && date) setExamDate(date);
                    }}
                  />
                )}

                <Text style={styles.label}>신청 마감일</Text>
                {Platform.OS === 'ios' || Platform.OS === 'web' ? (
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
                    <Feather name="calendar" size={15} color={CHARCOAL} />
                    <Text style={styles.dateText}>{formatKoreanDate(deadlineDate)}</Text>
                  </Pressable>
                )}
                {showDeadlinePicker && Platform.OS !== 'ios' && (
                  <DateTimePicker
                    value={deadlineDate}
                    mode="date"
                    display="default"
                    onChange={(event, date) => {
                      setShowDeadlinePicker(false);
                      if (event.type === 'set' && date) setDeadlineDate(date);
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
                  editable={canEdit}
                  onFocus={scrollFocusedInputIntoView}
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
                  editable={canEdit}
                  onFocus={scrollFocusedInputIntoView}
                  style={[styles.input, { height: notesHeight }]}
                  multiline
                  scrollEnabled={false}
                  onContentSizeChange={(e) => {
                    const nextHeight = Math.max(80, e.nativeEvent.contentSize.height);
                    if (nextHeight !== notesHeight) setNotesHeight(nextHeight);
                  }}
                />

                <Text style={styles.label}>응시 지역</Text>
                <View style={styles.row}>
                  <View style={{ flex: 2 }}>
                    <TextInput
                      placeholder="예: 청주, 대전 등"
                      placeholderTextColor={MUTED}
                      value={locationInput}
                      onChangeText={setLocationInput}
                      editable={canEdit}
                      onFocus={scrollFocusedInputIntoView}
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
                      editable={canEdit}
                      onFocus={scrollFocusedInputIntoView}
                      style={styles.input}
                    />
                  </View>
                </View>
                <View style={{ marginTop: 8 }}>
                  <RoundedButton
                    label="지역 추가"
                    onPress={() => {
                      const trimmed = locationInput.trim();
                      if (!trimmed) {
                        Alert.alert('입력 필요', '응시 지역을 입력해주세요.');
                        return;
                      }
                      const order = Number(locationOrder) || 0;
                      setDraftLocations((prev) => [
                        ...prev,
                        { id: `${Date.now()}-${Math.random()}`, name: trimmed, order },
                      ]);
                      setLocationInput('');
                      setLocationOrder('0');
                    }}
                    variant="accent"
                    disabled={!canAddLocation}
                  />
                </View>
                {draftLocations.length > 0 && (
                  <View style={styles.draftLocationsList}>
                    <Text style={styles.draftLocationsLabel}>추가된 지역</Text>
                    {draftLocations.map((loc) => (
                      <View key={loc.id} style={styles.locationRow}>
                        <View style={styles.locationDot} />
                        <Text style={styles.locationName}>
                          {loc.name}
                          <Text style={styles.locationOrder}> (순서: {loc.order})</Text>
                        </Text>
                        <Pressable
                          onPress={() =>
                            setDraftLocations((prev) => prev.filter((item) => item.id !== loc.id))
                          }
                          style={({ pressed }) => [styles.locationDelete, pressed && { opacity: 0.6 }]}
                          disabled={!canEdit}
                        >
                          <Feather name="x" size={13} color="#b91c1c" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                <View style={[styles.row, { marginTop: 16 }]}>
                  <View style={{ flex: 1 }}>
                    <RoundedButton
                      label={saveRound.isPending ? '저장 중...' : (selectedRoundId ? '일정 업데이트' : '일정 저장')}
                      onPress={() =>
                        saveRound.mutate(selectedRoundId ? 'update' : 'create')
                      }
                      variant="primary"
                      disabled={!canEdit || saveRound.isPending}
                    />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <RoundedButton
                      label="취소"
                      onPress={closeFormWithAnim}
                      variant="secondary"
                      disabled={saveRound.isPending}
                    />
                  </View>
                </View>
              </View>
            </Animated.View>
          )}

    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      {Platform.OS === 'web' ? screenContent : (
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          {screenContent}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  keyboardAvoiding: {
    flex: 1,
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
    fontSize: 13,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
    overflow: 'hidden',
  },
  formCard: {
    padding: 16,
    gap: 0,
  },
  listSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: CHARCOAL,
  },
  sectionCount: {
    fontSize: 12,
    color: MUTED,
    marginTop: 2,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: ORANGE,
  },
  addButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.97 }],
  },
  addButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },

  // 라운드 목록
  roundList: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  roundItem: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  roundItemActive: {
    borderColor: ORANGE,
    backgroundColor: '#fff7ed',
  },
  roundAccent: {
    width: 4,
    backgroundColor: '#E5E7EB',
  },
  roundAccentActive: {
    backgroundColor: ORANGE,
  },
  roundContent: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 12,
  },
  roundTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: CHARCOAL,
    lineHeight: 20,
  },
  roundTitleActive: {
    color: ORANGE,
  },
  roundLabelInline: {
    fontWeight: '500',
    color: MUTED,
    fontSize: 13,
  },
  roundMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  roundMetaText: {
    fontSize: 12,
    color: MUTED,
  },
  roundActions: {
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingRight: 12,
    paddingLeft: 6,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  editActionBtn: {
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  deleteActionBtn: {
    borderColor: '#fecdd3',
    backgroundColor: '#FEF2F2',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  editBtnText: {
    color: '#1d4ed8',
  },
  deleteBtnText: {
    color: '#b91c1c',
  },
  actionBtnPressed: {
    opacity: 0.65,
    transform: [{ scale: 0.95 }],
  },
  badgeDisabled: {
    opacity: 0.38,
  },
  badgeTextDisabled: {
    color: '#9CA3AF',
  },

  // 빈 상태
  emptyState: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  emptyCaption: {
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
  },

  // 폼
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  formHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  formModeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ORANGE_LIGHT,
  },
  formModeDotEdit: {
    backgroundColor: ORANGE,
  },
  formModeLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: CHARCOAL,
    flex: 1,
  },
  formCloseBtn: {
    padding: 4,
  },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginBottom: 4,
  },
  label: {
    marginTop: 12,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // 지역 목록
  draftLocationsList: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
    padding: 10,
    gap: 2,
  },
  draftLocationsLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: MUTED,
    marginBottom: 6,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  locationDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: ORANGE_LIGHT,
  },
  locationName: {
    flex: 1,
    color: CHARCOAL,
    fontSize: 14,
    fontWeight: '500',
  },
  locationOrder: {
    color: MUTED,
    fontWeight: '400',
    fontSize: 13,
  },
  locationDelete: {
    padding: 4,
  },

  // 버튼
  btnBase: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 10,
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
  btnAccent: {
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
    transform: [{ scale: 0.97 }],
    opacity: 0.85,
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
