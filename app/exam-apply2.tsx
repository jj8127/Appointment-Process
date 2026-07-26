import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { AnimatePresence, MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BrandedLoadingSpinner from '@/components/BrandedLoadingSpinner';
import BrandedLoadingState from '@/components/BrandedLoadingState';
import { ExamApplicationTargetSelector } from '@/components/ExamApplicationTargetSelector';
import { ExamPaymentProofField } from '@/components/ExamPaymentProofField';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { RefreshButton } from '@/components/RefreshButton';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { useSession } from '@/hooks/use-session';
import { canUseFcExamApply, isExamProxyApplicationActor } from '@/lib/exam-role';
import { invokeFcNotifyForDelivery } from '@/lib/fc-notify-client';
import {
  formatMissingExamApplicationFields,
  getMissingExamApplicationFields,
} from '@/lib/exam-application-validation';
import { showExamMonthConflictFeedback } from '@/lib/exam-month-conflict-feedback';
import {
  INVALID_EXAM_LOCATION_MESSAGE,
  buildExamApplyNotificationPayloads,
  createExamApplyRealtimeChannelTopic,
  getExamApplyRestoredSelectionState,
  getExamFeeAccountCopyText,
  getExamFlowConfig,
  formatExamRegistrationStatus,
  formatExamSubjectSelection,
  getExamMonthKey,
  getExamRoundSelectionState,
  isExamMonthSlotConsumed,
  isLocationInRound,
  sendExamApplyNotificationsBestEffort,
  type ExamNotifyPayload,
} from '@/lib/exam-flow-contract';
import {
  cancelExamApplicationWithPaymentProof,
  discardExamPaymentProofUpload,
  listExamApplicationTargets,
  prepareExamPaymentProofUpload,
  submitExamApplicationWithPaymentProof,
  uploadExamPaymentProof,
  type ExamApplicationTarget,
} from '@/lib/exam-payment-proof-api';
import {
  hasExamPaymentProof,
  normalizeExamPaymentProofSelection,
  type ExamPaymentProofSelection,
} from '@/lib/exam-payment-proof';
import { NONLIFE_EXAM_FEE_ROWS } from '@/lib/exam-fees';
import { logger } from '@/lib/logger';
import { isNotificationUuid } from '@/lib/notification-target';
import {
  hasConflictingRouteParams,
  hasPresentRouteParam,
  parseExactlyOneUuidRouteParam,
} from '@/lib/strict-route-params';
import { NotificationReceiptStatusBanner } from '@/lib/notification-receipt-ui';
import { supabase } from '@/lib/supabase';
import { useNotificationReceiptCompletion } from '@/lib/use-notification-receipt';
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
const ROUND_DEADLINE_RETENTION_DAYS = 7;
const examFlowType = 'nonlife' as const;
const examFlowConfig = getExamFlowConfig(examFlowType);
const feeAccountCopy = getExamFeeAccountCopyText(examFlowType);
const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.05,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};

async function notifyExamFlow(payload: ExamNotifyPayload) {
  const result = await invokeFcNotifyForDelivery(payload);
  if (!result.confirmed && result.reason === 'invalid_recipient') {
    throw new Error('notification_invalid_recipient');
  }
  if (!result.confirmed && result.notificationStored === false) {
    throw new Error('notification_persistence_failed');
  }
}

const fetchRounds = async (): Promise<ExamRoundWithLocations[]> => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ROUND_DEADLINE_RETENTION_DAYS);

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
    .eq('exam_type', examFlowConfig.examType)
    .gte('registration_deadline', toYmd(cutoffDate))
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

const formatFeePaidDate = (value?: string | null) => {
  const paidDate = toDate(value);
  return paidDate ? formatKoreanDate(paidDate) : '-';
};

type MyExamApply = {
  id: string;
  round_id: string;
  location_id: string;
  status: string;
  includes_primary_exam?: boolean | null;
  rejection_reason?: string | null;
  rejected_at?: string | null;
  is_third_exam?: boolean | null;
  fee_paid_date?: string | null;
  payment_proof_attached?: boolean | null;
  created_at: string;
  exam_rounds?: {
    exam_date: string;
    round_label: string | null;
    exam_type: 'life' | 'nonlife';
  } | null;
  exam_locations?: { location_name: string } | null;
  is_confirmed?: boolean | null;
};

function getExamRegistrationErrorMessage(error: unknown) {
  if (!error) return '시험 신청 중 오류가 발생했습니다.';

  if (error instanceof Error) {
    const message = error.message ?? '';
    if (message.includes('exam_registrations_location_round_fkey')) {
      return INVALID_EXAM_LOCATION_MESSAGE;
    }
    return message || '시험 신청 중 오류가 발생했습니다.';
  }

  if (typeof error === 'object') {
    const maybeError = error as { code?: string; message?: string; details?: string; hint?: string };
    const text = [maybeError.message, maybeError.details, maybeError.hint].filter(Boolean).join(' ');
    if (text.includes('exam_registrations_location_round_fkey')) {
      return INVALID_EXAM_LOCATION_MESSAGE;
    }
    if (maybeError.code === '23503' && text.includes('exam_locations')) {
      return INVALID_EXAM_LOCATION_MESSAGE;
    }
    if (text) {
      return text;
    }
  }

  return '시험 신청 중 오류가 발생했습니다.';
}

export default function ExamApplyScreen() {
  const {
    role,
    residentId,
    displayName,
    hydrated,
    readOnly,
    staffType,
    appSessionToken,
  } = useSession();
  const {
    registrationId,
    roundId,
    notificationId,
    notificationTarget,
  } = useLocalSearchParams<{
    registrationId?: string;
    roundId?: string;
    notificationId?: string;
    notificationTarget?: string;
  }>();
  const { destinationAccepted: identityGateAccepted } =
    useIdentityGate({ nextPath: examFlowConfig.applyRoute });
  const canApplyExam = canUseFcExamApply({ role, readOnly, staffType });
  const isProxyApplication = isExamProxyApplicationActor({ role, readOnly, staffType });

  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [wantsNonlife, setWantsNonlife] = useState(true);
  const [wantsThird, setWantsThird] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<ExamApplicationTarget | null>(null);
  const [selectedPaymentProof, setSelectedPaymentProof] =
    useState<ExamPaymentProofSelection | null>(null);
  const preparedPaymentProofRef = useRef<{
    requestId: string;
    uploadId: string;
  } | null>(null);
  const [selectedApplyId, setSelectedApplyId] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
      return;
    }
    if (!canApplyExam) {
      Alert.alert('접근 불가', '시험 신청 권한이 없습니다.');
      router.replace('/');
    }
  }, [canApplyExam, role, hydrated]);

  const {
    data: rounds,
    isLoading,
    isError: isRoundsError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: examFlowConfig.applyRoundsQueryKey,
    queryFn: fetchRounds,
    enabled: canApplyExam,
  });

  const allRounds = useMemo(() => rounds ?? [], [rounds]);
  const {
    data: applicationTargets = [],
    isLoading: isLoadingApplicationTargets,
    refetch: refetchApplicationTargets,
  } = useQuery<ExamApplicationTarget[]>({
    queryKey: ['exam-application-targets', role, readOnly, staffType],
    enabled: canApplyExam && isProxyApplication && !!appSessionToken,
    queryFn: () => listExamApplicationTargets(appSessionToken ?? ''),
  });
  const applicationResidentId = isProxyApplication
    ? selectedTarget?.residentId ?? null
    : residentId;
  const applicationTargetFcId = isProxyApplication ? selectedTarget?.fcId ?? null : null;

  const isRoundClosed = (round: ExamRoundWithLocations) => {
    const deadline = toDate(round.registration_deadline);
    if (!deadline) return false;
    // 신청 마감일은 당일 23:59:59까지 유효
    deadline.setHours(23, 59, 59, 999);
    return new Date() > deadline;
  };

  const hasAvailableRounds = allRounds.some((round) => !isRoundClosed(round));

  const selectedRound = useMemo(
    () => allRounds.find((r) => r.id === selectedRoundId) ?? null,
    [allRounds, selectedRoundId],
  );

  const isSelectedRoundClosed = useMemo(
    () => (selectedRound ? isRoundClosed(selectedRound) : false),
    [selectedRound],
  );

  const {
    data: myApplies = [],
    error: myAppliesError,
    isLoading: isLoadingMyApplies,
    isFetching: isFetchingMyApplies,
    refetch: refetchMyApply,
  } = useQuery<MyExamApply[]>({
    queryKey: ['my-exam-apply-history', applicationResidentId],
    enabled: canApplyExam && !!applicationResidentId,
    queryFn: async (): Promise<MyExamApply[]> => {
      const { data, error } = await supabase
        .from('exam_registrations')
        .select(
          'id, round_id, location_id, status, is_confirmed, includes_primary_exam, is_third_exam, fee_paid_date, payment_proof_attached, rejection_reason, rejected_at, created_at, exam_rounds!inner(exam_date, round_label, exam_type), exam_locations!exam_registrations_location_round_fkey(location_name)',
        )
        .eq('resident_id', applicationResidentId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });

      if (error) throw error;

      const normalize = (obj: any) => (Array.isArray(obj) ? obj[0] : obj);
      return (data ?? [])
        .filter((d: any) => d.exam_rounds)
        .map((d: any) => ({
          ...d,
          exam_rounds: normalize(d.exam_rounds),
          exam_locations: normalize(d.exam_locations),
        })) as MyExamApply[];
    },
  });

  const currentApply = useMemo(() => {
    if (myApplies.length === 0) return null;
    return myApplies.find((a) => a.id === selectedApplyId) ?? myApplies[0];
  }, [myApplies, selectedApplyId]);
  const routeRegistrationId = parseExactlyOneUuidRouteParam(registrationId);
  const routeRoundId = parseExactlyOneUuidRouteParam(roundId);
  const hasAmbiguousExamRoute =
    hasConflictingRouteParams(registrationId, roundId)
    || (hasPresentRouteParam(registrationId) && !routeRegistrationId)
    || (hasPresentRouteParam(roundId) && !routeRoundId);
  const exactRouteRegistration = !hasAmbiguousExamRoute
    ? myApplies.find(
        (row) =>
          row.id === routeRegistrationId
          && row.exam_rounds?.exam_type === examFlowType,
      )
    : undefined;
  const notificationReceipt = useNotificationReceiptCompletion({
    params: { notificationId, notificationTarget },
    expectedTarget: !hasAmbiguousExamRoute && routeRegistrationId
      ? {
          version: 1,
          kind: 'exam',
          examType: 'nonlife',
          examRegistrationId: routeRegistrationId,
        }
      : !hasAmbiguousExamRoute && routeRoundId
        ? {
            version: 1,
            kind: 'exam',
            examType: 'nonlife',
            examRoundId: routeRoundId,
          }
        : null,
    loadState: !identityGateAccepted
      ? 'loading'
      : hasAmbiguousExamRoute
      ? 'error'
      : routeRegistrationId
      ? myAppliesError
        ? 'error'
        : exactRouteRegistration
          ? 'success'
          : isLoadingMyApplies
            ? 'loading'
            : 'error'
      : routeRoundId
        ? isRoundsError
          ? 'error'
          : allRounds.some((row) => row.id === routeRoundId)
            ? 'success'
            : isLoading
              ? 'loading'
              : 'error'
        : 'idle',
  });

  useEffect(() => {
    if (hasAmbiguousExamRoute) return;
    if (routeRegistrationId) {
      const registration = exactRouteRegistration;
      if (!registration) return;
      setSelectedApplyId(registration.id);
      setSelectedRoundId(registration.round_id);
      return;
    }
    if (routeRoundId && allRounds.some((row) => row.id === routeRoundId)) {
      setSelectedRoundId(routeRoundId);
    }
  }, [
    allRounds,
    exactRouteRegistration,
    hasAmbiguousExamRoute,
    routeRegistrationId,
    routeRoundId,
  ]);

  const existingForRound = useMemo(
    () => myApplies.find(
      (a) => a.round_id === selectedRoundId && isExamMonthSlotConsumed(a.status),
    ) ?? null,
    [myApplies, selectedRoundId],
  );
  const isConfirmedForRound = !!existingForRound?.is_confirmed;
  const existingProofAttached = !!existingForRound?.payment_proof_attached;
  const lockMessage = '시험 접수가 완료되어 시험 일정을 수정할 수 없습니다.';
  // Realtime: 내 시험 접수 상태 변경 시 갱신
  useEffect(() => {
    if (!applicationResidentId) return;
    const regChannel = supabase
      .channel(createExamApplyRealtimeChannelTopic(examFlowConfig.applyRealtimeChannelPrefix))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exam_registrations', filter: `resident_id=eq.${applicationResidentId}` },
        () => refetchMyApply(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(regChannel);
    };
  }, [applicationResidentId, refetchMyApply]);

  // 선택된 회차에 기존 신청이 있으면 데이터 복원
  useEffect(() => {
    const restoredState = getExamApplyRestoredSelectionState({
      existingForRound,
      selectedRound,
    });
    setSelectedLocationId(restoredState.selectedLocationId);
    setWantsNonlife(restoredState.wantsPrimary);
    setWantsThird(restoredState.wantsThird);
  }, [existingForRound, selectedRound]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetch(),
        ...(applicationResidentId ? [refetchMyApply()] : []),
        ...(isProxyApplication ? [refetchApplicationTargets()] : []),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    applicationResidentId,
    isProxyApplication,
    refetch,
    refetchApplicationTargets,
    refetchMyApply,
  ]);

  const copyFeeAccount = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(feeAccountCopy.value);
      void Haptics.selectionAsync().catch(() => {});
      Alert.alert('복사 완료', '응시료 납입 계좌를 복사했습니다.');
    } catch {
      Alert.alert('복사 실패', '응시료 납입 계좌를 복사하지 못했습니다.');
    }
  }, []);

  const discardPreparedPaymentProof = useCallback(async () => {
    const pending = preparedPaymentProofRef.current;
    preparedPaymentProofRef.current = null;
    if (!pending || !appSessionToken) return;

    try {
      await discardExamPaymentProofUpload(
        appSessionToken,
        pending.uploadId,
        applicationTargetFcId,
      );
    } catch {
      logger.warn('[exam-apply2] pending payment proof cleanup was deferred');
    }
  }, [appSessionToken, applicationTargetFcId]);

  const pickPaymentProof = useCallback(async () => {
    if (isConfirmedForRound) {
      Alert.alert('수정 불가', lockMessage);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.9,
    });
    if (result.canceled) return;

    const normalized = normalizeExamPaymentProofSelection(
      result.assets[0] ?? {},
      Crypto.randomUUID(),
    );
    if (!normalized.ok) {
      Alert.alert('첨부 불가', normalized.message);
      return;
    }

    await discardPreparedPaymentProof();
    setSelectedPaymentProof(normalized.value);
  }, [discardPreparedPaymentProof, isConfirmedForRound, lockMessage]);

  const removePaymentProof = useCallback(async () => {
    await discardPreparedPaymentProof();
    setSelectedPaymentProof(null);
  }, [discardPreparedPaymentProof]);

  const selectApplicationTarget = useCallback(async (target: ExamApplicationTarget) => {
    if (target.fcId === selectedTarget?.fcId) return;
    await discardPreparedPaymentProof();
    setSelectedPaymentProof(null);
    setSelectedApplyId(null);
    setSelectedRoundId(null);
    setSelectedLocationId(null);
    setSelectedTarget(target);
  }, [discardPreparedPaymentProof, selectedTarget?.fcId]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!applicationResidentId) {
        throw new Error('시험 신청 대상 FC를 선택해주세요.');
      }
      const missingMessage = formatMissingExamApplicationFields(getMissingExamApplicationFields({
        hasApplicationTarget: !isProxyApplication || !!selectedTarget,
        hasPaymentProof: hasExamPaymentProof({
          selectedProof: selectedPaymentProof,
          existingProofAttached,
        }),
        selectedRoundId,
        selectedLocationId,
        hasSelectedSubject: wantsNonlife || wantsThird,
      }));
      if (missingMessage) {
        throw new Error(missingMessage);
      }
      if (!appSessionToken) {
        throw new Error('시험 신청을 계속하려면 다시 로그인해주세요.');
      }

      if (isConfirmedForRound) {
        throw new Error(lockMessage);
      }

      const round = allRounds?.find((r) => r.id === selectedRoundId);
      if (!round) {
        throw new Error('선택한 시험 일정 정보를 다시 확인해주세요.');
      }

      if (isRoundClosed(round)) {
        throw new Error('마감된 일정입니다. 다른 시험 일정을 선택해주세요.');
      }

      if (!isLocationInRound(round, selectedLocationId)) {
        throw new Error(INVALID_EXAM_LOCATION_MESSAGE);
      }

      let uploadId: string | null = null;
      if (selectedPaymentProof) {
        const prepared = await prepareExamPaymentProofUpload(
          appSessionToken,
          selectedPaymentProof,
          applicationTargetFcId,
        );
        uploadId = prepared.uploadId;
        preparedPaymentProofRef.current = {
          requestId: selectedPaymentProof.requestId,
          uploadId,
        };
        if (!prepared.alreadyAttached) {
          if (!prepared.signedUrl) {
            throw new Error('입금 내역 사진 업로드를 준비하지 못했습니다.');
          }
          await uploadExamPaymentProof(prepared.signedUrl, selectedPaymentProof);
        }
      }

      const submissionResult = await submitExamApplicationWithPaymentProof({
        appSessionToken,
        uploadId,
        roundId: selectedRoundId!,
        locationId: selectedLocationId!,
        examType: examFlowType,
        targetFcId: applicationTargetFcId,
        includesPrimaryExam: wantsNonlife,
        isThirdExam: wantsThird,
      });
      preparedPaymentProofRef.current = null;

      const locName =
        round.locations?.find((l) => l.id === selectedLocationId)?.location_name ?? '';
      const examTitle = `${formatDate(round.exam_date)}${round.round_label ? ` (${round.round_label})` : ''
        }`;
      const actor = displayName?.trim() || residentId || '담당자';
      const registrationId = submissionResult.registrationId;
      const notificationPayloads = isNotificationUuid(registrationId)
        ? buildExamApplyNotificationPayloads({
            examType: examFlowType,
            examRegistrationId: registrationId,
            actor,
            residentId: applicationResidentId,
            examTitle,
            locationName: locName,
          })
        : null;
      const { failedTargets, invalidTargets } = notificationPayloads
        ? await sendExamApplyNotificationsBestEffort(
            notificationPayloads,
            notifyExamFlow,
          )
        : {
            failedTargets: [] as const,
            invalidTargets: ['admin', 'fcSelf'] as const,
          };
      if (failedTargets.length > 0 || invalidTargets.length > 0) {
        logger.warn('[exam-apply2] registration saved but notification delivery was incomplete', {
          examType: examFlowType,
          failedTargets,
          invalidTargets,
        });
      }
      return {
        failedTargets: [...failedTargets],
        invalidTargets: [...invalidTargets],
        notificationPayloads,
      };
    },
    onSuccess: (result) => {
      setSelectedPaymentProof(null);
      if (result.invalidTargets.length > 0) {
        Alert.alert(
          '신청 완료 · 알림 대상 오류',
          '시험 신청은 저장되었습니다. 알림을 받을 사용자 정보를 확인할 수 없습니다.',
        );
        refetchMyApply();
        return;
      }
      if (result.failedTargets.length > 0) {
        let retryTargets = result.failedTargets;
        const retryNotificationDelivery = async () => {
          if (!result.notificationPayloads) {
            Alert.alert(
              '알림 대상 오류',
              '저장된 시험 신청 식별자를 확인할 수 없어 알림을 등록하지 못했습니다.',
            );
            return;
          }
          const retryResult = await sendExamApplyNotificationsBestEffort(
            result.notificationPayloads,
            notifyExamFlow,
            retryTargets,
          );
          if (retryResult.invalidTargets.length > 0) {
            Alert.alert(
              '알림 대상 오류',
              '알림을 받을 사용자 정보를 확인할 수 없습니다.',
            );
            return;
          }
          if (retryResult.failedTargets.length === 0) {
            Alert.alert(
              '알림 등록 완료',
              '저장된 시험 신청 알림을 등록했습니다.',
            );
            return;
          }
          retryTargets = retryResult.failedTargets;
          Alert.alert(
            '알림 등록 실패',
            '시험 신청은 저장되었지만 알림을 다시 등록하지 못했습니다.',
            [
              { text: '확인' },
              {
                text: '다시 등록',
                onPress: () => void retryNotificationDelivery(),
              },
            ],
          );
        };
        Alert.alert(
          '신청 완료 · 알림 등록 실패',
          '시험 신청은 저장되었습니다. 관련 알림을 등록하지 못했습니다.',
          [
            { text: '확인' },
            {
              text: '알림 다시 등록',
              onPress: () => void retryNotificationDelivery(),
            },
          ],
        );
        refetchMyApply();
        return;
      }
      Alert.alert('신청 완료', '시험 신청이 정상적으로 등록되었습니다.');
      refetchMyApply();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = getExamRegistrationErrorMessage(error);
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
      if (!appSessionToken) {
        throw new Error('시험 신청을 취소하려면 다시 로그인해주세요.');
      }
      await cancelExamApplicationWithPaymentProof(appSessionToken, registrationId);
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
    const roundMonth = getExamMonthKey(round.exam_date);
    const activeForMonth = myApplies.find(
      (application) =>
        isExamMonthSlotConsumed(application.status)
        && getExamMonthKey(application.exam_rounds?.exam_date) === roundMonth,
    );
    if (activeForMonth && activeForMonth.round_id !== round.id) {
      showExamMonthConflictFeedback();
      return;
    }
    if (activeForMonth?.is_confirmed) {
      Alert.alert('수정 불가', lockMessage);
      return;
    }
    if (isRoundClosed(round)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.selectionAsync();
    const selectionState = getExamRoundSelectionState(round);
    setSelectedLocationId(selectionState.selectedLocationId);
    setSelectedRoundId(selectionState.selectedRoundId);
  };

  const handleLocationSelect = (id: string) => {
    if (isConfirmedForRound) {
      Alert.alert('수정 불가', lockMessage);
      return;
    }
    Haptics.selectionAsync();
    setSelectedLocationId(id);
  };

  const handleApplyPress = () => {
    if (applyMutation.isPending) return;
    if (isConfirmedForRound) {
      Alert.alert('알림', lockMessage);
      return;
    }
    if (isSelectedRoundClosed) {
      Alert.alert('알림', '마감된 일정입니다. 다른 시험 일정을 선택해주세요.');
      return;
    }

    const missingMessage = formatMissingExamApplicationFields(getMissingExamApplicationFields({
      hasApplicationTarget: !isProxyApplication || !!selectedTarget,
      hasPaymentProof: hasExamPaymentProof({
        selectedProof: selectedPaymentProof,
        existingProofAttached,
      }),
      selectedRoundId,
      selectedLocationId,
      hasSelectedSubject: true,
    }));
    if (missingMessage) {
      Alert.alert('입력 확인', missingMessage);
      return;
    }

    applyMutation.mutate();
  };

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <BrandedLoadingState variant="exam" />
      </SafeAreaView>
    );
  }

  const screenRefreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
  );

  const screenContent = (
    <>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>손해보험 시험 신청</Text>
            <Text style={styles.headerSub}>시험 일정과 응시 지역을 선택해주세요.</Text>
          </View>
          <RefreshButton
            onPress={() => {
              onRefresh();
            }}
          />
        </View>

        {isProxyApplication ? (
          <View style={styles.section}>
            <ExamApplicationTargetSelector
              targets={applicationTargets}
              value={selectedTarget}
              isLoading={isLoadingApplicationTargets}
              disabled={applyMutation.isPending}
              onChange={(target) => {
                void selectApplicationTarget(target);
              }}
            />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>📅 응시료 납입 안내</Text>
          <Text style={styles.inputHint}>응시료 미입금 시 시험 접수 불가능하며, 납입한 접수비는 반환되지 않습니다.</Text>
          <View style={styles.accountCard}>
            <View style={styles.accountHeaderRow}>
              <Text style={styles.accountLabel}>{feeAccountCopy.label}</Text>
              <Pressable
                onPress={() => { void copyFeeAccount(); }}
                accessibilityRole="button"
                accessibilityLabel={feeAccountCopy.accessibilityLabel}
                accessibilityHint={feeAccountCopy.accessibilityHint}
                style={({ pressed }) => [styles.accountCopyChip, pressed && styles.accountCopyChipPressed]}
              >
                <Feather name="copy" size={13} color={HANWHA_ORANGE} />
                <Text style={styles.accountCopyChipLabel}>{feeAccountCopy.copyLabel}</Text>
              </Pressable>
            </View>
            <Text style={styles.accountValue}>{feeAccountCopy.value}</Text>
          </View>
          <View style={styles.feeCard}>
            <View style={styles.feeHeaderRow}>
              <Feather name="info" size={14} color={HANWHA_ORANGE} />
              <Text style={styles.feeTitle}>응시료 안내</Text>
            </View>
            {NONLIFE_EXAM_FEE_ROWS.map((item) => (
              <View key={item.label} style={styles.feeRow}>
                <Text style={styles.feeLabel}>{item.label}</Text>
                <Text style={styles.feeAmount}>{item.amount}</Text>
              </View>
            ))}
          </View>
          <ExamPaymentProofField
            selectedProof={selectedPaymentProof}
            existingProofAttached={existingProofAttached}
            disabled={isConfirmedForRound || applyMutation.isPending}
            onPick={() => {
              void pickPaymentProof();
            }}
            onRemove={() => {
              void removePaymentProof();
            }}
          />
        </View>

          <MotiView
            from={{ opacity: 0, translateY: -10 }}
            animate={{ opacity: 1, translateY: 0 }}
            style={styles.statusCard}
          >
            <View style={styles.statusHeader}>
              <Feather name="info" size={16} color={HANWHA_ORANGE} />
              <Text style={styles.statusTitle}>
                {isProxyApplication ? '선택한 FC 신청 내역' : '내 신청 내역'}
              </Text>
            </View>

            {myAppliesError ? (
              <View style={{ gap: 8, alignItems: 'center' }}>
                <Text style={styles.emptyText}>신청 내역을 불러오지 못했습니다.</Text>
                <Pressable
                  onPress={() => void refetchMyApply()}
                  disabled={isFetchingMyApplies}
                  style={{ paddingHorizontal: 12, paddingVertical: 8 }}
                >
                  <Text style={{ color: HANWHA_ORANGE, fontWeight: '700' }}>
                    {isFetchingMyApplies ? '다시 불러오는 중...' : '다시 시도'}
                  </Text>
                </Pressable>
              </View>
            ) : myApplies.length === 0 ? (
              <Text style={styles.emptyText}>아직 신청한 시험이 없습니다.</Text>
            ) : (
              <View style={styles.statusContent}>
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
                        {formatExamSubjectSelection({
                          examType: currentApply.exam_rounds?.exam_type,
                          includesPrimaryExam: currentApply.includes_primary_exam,
                          isThirdExam: currentApply.is_third_exam,
                        })}
                      </Text>
                    </View>
                    <View style={styles.statusRow}>
                      <Text style={styles.statusLabel}>응시료 납입일</Text>
                      <Text style={styles.statusValue}>
                        {formatFeePaidDate(currentApply.fee_paid_date)}
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
                            {formatExamRegistrationStatus(currentApply.status)}
                          </Text>
                        </View>
                        {!isProxyApplication && currentApply.status === 'applied' && (
                          <Pressable onPress={() => handleCancelPress(currentApply.id)}>
                            <Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '600' }}>취소</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                    {currentApply.status === 'rejected' && currentApply.rejection_reason ? (
                      <View style={styles.statusRow}>
                        <Text style={styles.statusLabel}>반려 사유</Text>
                        <Text style={[styles.statusValue, { color: '#dc2626' }]}>
                          {currentApply.rejection_reason}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            )}
          </MotiView>

          <View style={styles.section}>
            <Text style={styles.sectionHeader}>📅 시험 일정 선택</Text>
            {isLoading || isFetching ? (
              <BrandedLoadingState variant="exam" layout="section" />
            ) : (
              <View style={styles.listContainer}>
                {!hasAvailableRounds && (
                  <View style={styles.availableRoundsEmptyState}>
                    <Feather name="calendar" size={28} color={MUTED} />
                    <Text style={styles.availableRoundsEmptyText}>
                      현재 신청 가능한 시험이 없습니다.
                    </Text>
                  </View>
                )}
                {allRounds.map((round, idx) => {
                  const closed = isRoundClosed(round);
                  const roundMonth = getExamMonthKey(round.exam_date);
                  const activeApplicationsForMonth = myApplies.filter(
                    (application) =>
                      isExamMonthSlotConsumed(application.status)
                      && getExamMonthKey(application.exam_rounds?.exam_date) === roundMonth,
                  );
                  const isAppliedRound = activeApplicationsForMonth.some(
                    (application) => application.round_id === round.id,
                  );
                  const blockedByMonth =
                    activeApplicationsForMonth.length > 0 && !isAppliedRound;
                  const unavailable = closed || blockedByMonth;
                  const visuallyDisabled =
                    blockedByMonth || (closed && !isAppliedRound);
                  const isActive =
                    isAppliedRound
                    || (round.id === selectedRoundId && !blockedByMonth);
                  return (
                    <MotiView
                      key={round.id}
                      from={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 50 }}
                    >
                      <Pressable
                        onPress={() => handleRoundSelect(round)}
                        disabled={unavailable}
                        accessibilityState={{
                          disabled: unavailable,
                          selected: isActive,
                        }}
                        style={[
                          styles.selectionCard,
                          isActive && styles.selectionCardActive,
                          visuallyDisabled && styles.selectionCardDisabled,
                        ]}
                      >
                        <View style={styles.selectionInfo}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text
                              style={[
                                styles.selectionTitle,
                                isActive && styles.textActive,
                                visuallyDisabled && styles.textDisabled,
                              ]}
                            >
                              {formatDate(round.exam_date)}
                              {round.round_label ? ` (${round.round_label})` : ''}
                            </Text>
                            {isAppliedRound && (
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
                        {isActive ? (
                          <View style={styles.checkCircle}>
                            <Feather name="check" size={14} color="#fff" />
                          </View>
                        ) : unavailable ? (
                          <Feather name="lock" size={20} color={MUTED} />
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

          <View style={styles.section}>
            <Text style={styles.sectionHeader}>✅ 응시 과목</Text>

            <Pressable
              style={[styles.toggleCard, wantsNonlife && styles.toggleCardActive]}
              onPress={() => {
                if (isConfirmedForRound) {
                  Alert.alert('수정 불가', lockMessage);
                } else {
                  Haptics.selectionAsync();
                  setWantsNonlife((value) => !value);
                }
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Feather
                  name={wantsNonlife ? 'check-square' : 'square'}
                  size={24}
                  color={wantsNonlife ? HANWHA_ORANGE : MUTED}
                />
                <View>
                  <Text style={styles.toggleTitle}>손해보험 시험</Text>
                  <Text style={styles.toggleDesc}>손해보험 자격 시험을 신청합니다.</Text>
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
                  <Text style={styles.toggleTitle}>제3보험 시험</Text>
                  <Text style={styles.toggleDesc}>제3보험 자격 시험을 신청합니다.</Text>
                </View>
              </View>
            </Pressable>

            <View style={styles.actionButtons}>
              <Pressable
                onPress={handleApplyPress}
                disabled={applyMutation.isPending}
                style={({ pressed }) => [styles.submitBtnWrapper, pressed && styles.pressedScale]}
              >
                <View
                  style={[
                    styles.submitBtn,
                    applyMutation.isPending || isConfirmedForRound
                      ? styles.submitBtnDisabled
                      : styles.submitBtnActive,
                  ]}
                >
                  <Text style={styles.submitBtnText}>
                    {isConfirmedForRound ? '시험 접수 완료' : existingForRound ? '신청 내역 수정하기' : '시험 신청하기'}
                  </Text>
                  {applyMutation.isPending && (
                    <BrandedLoadingSpinner size="sm" color="#fff" style={{ marginLeft: 8 }} />
                  )}
                </View>
              </Pressable>
            </View>
          </View>

        <View style={{ height: 40 }} />

      </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <NotificationReceiptStatusBanner
        state={notificationReceipt.state}
        onRetry={() => void notificationReceipt.retryMarkRead()}
      />
      {Platform.OS === 'android' ? (
        <ScrollView
          contentContainerStyle={styles.container}
          refreshControl={screenRefreshControl}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {screenContent}
        </ScrollView>
      ) : (
        <KeyboardAwareWrapper
          contentContainerStyle={styles.container}
          refreshControl={screenRefreshControl}
        >
          {screenContent}
        </KeyboardAwareWrapper>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SOFT_BG },
  container: { padding: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: CHARCOAL, marginBottom: 4 },
  headerSub: { fontSize: 16, color: MUTED },
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
  statusTitle: { fontSize: 16, fontWeight: '700', color: CHARCOAL },
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
  statusLabel: { fontSize: 15, color: MUTED },
  statusValue: { fontSize: 16, fontWeight: '600', color: CHARCOAL },
  statusDivider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  statusBadgeText: { fontSize: 13, fontWeight: '700' },
  badgeConfirmed: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  badgePending: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  textConfirmed: { color: '#059669' },
  textPending: { color: '#b45309' },

  section: { marginBottom: 32 },
  sectionHeader: { fontSize: 20, fontWeight: '800', color: CHARCOAL, marginBottom: 12 },
  listContainer: { gap: 10 },
  availableRoundsEmptyState: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  availableRoundsEmptyText: {
    color: MUTED,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  selectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
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
  selectionTitle: { fontSize: 18, fontWeight: '700', color: CHARCOAL, marginBottom: 4 },
  selectionSub: { fontSize: 14, color: MUTED },
  selectionNote: { fontSize: 14, color: HANWHA_ORANGE, marginTop: 4 },
  textActive: { color: HANWHA_ORANGE },
  textDisabled: { color: '#9ca3af' },
  radioCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#d1d5db' },
  checkCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: HANWHA_ORANGE, alignItems: 'center', justifyContent: 'center' },
  placeholderBox: { padding: 20, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: 12 },
  placeholderText: { color: MUTED, fontSize: 15 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  locationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    minHeight: 64,
  },
  locationCardActive: { borderColor: HANWHA_ORANGE, backgroundColor: ORANGE_FAINT },
  locationText: { fontWeight: '600', color: CHARCOAL, textAlign: 'center', fontSize: 15 },
  locationTextActive: { color: HANWHA_ORANGE, fontWeight: '800' },
  toggleCard: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleCardActive: { borderColor: HANWHA_ORANGE, backgroundColor: ORANGE_FAINT },
  toggleTitle: { fontSize: 17, fontWeight: '700', color: CHARCOAL },
  toggleDesc: { fontSize: 14, color: MUTED, marginTop: 4 },
  accountCard: {
    backgroundColor: '#fff7ed',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fdba74',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  accountHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  accountLabel: { fontSize: 12, fontWeight: '700', color: '#9a3412' },
  accountValue: { fontSize: 16, fontWeight: '800', color: CHARCOAL },
  accountCopyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fdba74',
    backgroundColor: '#ffffff',
  },
  accountCopyChipPressed: {
    opacity: 0.8,
  },
  accountCopyChipLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: HANWHA_ORANGE,
  },
  feeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    gap: 8,
  },
  feeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feeTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: CHARCOAL,
  },
  feeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  feeLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: MUTED,
  },
  feeAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: HANWHA_ORANGE,
  },
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
  submitBtn: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  submitBtnActive: { backgroundColor: HANWHA_ORANGE },
  submitBtnDisabled: { backgroundColor: '#9ca3af' },
  submitBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: '#ef4444', fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' },
  emptyText: { color: MUTED, fontSize: 15, textAlign: 'center', marginTop: 10 },
  pressedScale: { transform: [{ scale: 0.98 }] },
  pressedOpacity: { opacity: 0.7 },
});
