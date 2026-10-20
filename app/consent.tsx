import { useReadAttempt } from '@/lib/use-read-attempt';
import { useReadSessionScope } from '@/hooks/use-read-session-scope';
import { ProfileReadState } from '@/components/ProfileReadState';
import { parseCalendarDate } from '@/lib/calendar-date';
import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { OnboardingStepNowCard } from '@/components/OnboardingStepNowCard';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { invokeFcNotifyForDelivery } from '@/lib/fc-notify-client';
import { presentPostCommitNotificationDelivery } from '@/lib/fc-notify-post-commit';
import { AGREEMENT_GUIDE_IMAGES } from '@/lib/guide-images';
import { useSession } from '@/hooks/use-session';
import { logger } from '@/lib/logger';
import { getConsentStepNow } from '@/lib/onboarding-step-now';
import { INSURANCE_HOME_ROUTE } from '@/lib/service-home';
import { NotificationReceiptStatusBanner } from '@/lib/notification-receipt-ui';
import { openExternalUrl } from '@/lib/open-external-url';
import { copyTextWithFeedback } from '@/lib/messenger-copy-actions';
import { supabase } from '@/lib/supabase';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { useNotificationReceiptCompletion } from '@/lib/use-notification-receipt';
import { returnTo } from '@/lib/back-navigation';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const formatKoreanDate = (d: Date) =>
  `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const CONSENT_LOCKED_STATUSES = [
  'allowance-consented',
  'docs-requested',
  'docs-pending',
  'docs-submitted',
  'docs-approved',
  'hanwha-commission-review',
  'hanwha-commission-rejected',
  'hanwha-commission-approved',
  'appointment-completed',
  'final-link-sent',
] as const;

const isConsentLockedStatus = (status: string | null | undefined) =>
  Boolean(status && CONSENT_LOCKED_STATUSES.includes(status as (typeof CONSENT_LOCKED_STATUSES)[number]));

export default function AllowanceConsentScreen() {
  const scope = useReadSessionScope();
  return <AllowanceConsentScreenContent key={scope} />;
}

function AllowanceConsentScreenContent() {
  const { residentId, appSessionToken } = useSession();
  const { notificationId, notificationTarget } = useLocalSearchParams<{
    notificationId?: string;
    notificationTarget?: string;
  }>();
  const { destinationAccepted: identityGateAccepted } =
    useIdentityGate({ nextPath: '/consent' });
  const [tempId, setTempId] = useState('');
  // TC007: Initialize validation state
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [careerType, setCareerType] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const keyboardPadding = useKeyboardPadding();
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageRatio, setImageRatio] = useState(16 / 9);
  const [refreshing, setRefreshing] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileLoadState, setProfileLoadState] = useState<
    'loading' | 'success' | 'error'
  >('loading');
  const sliderRef = useRef<FlatList>(null);

  const maxIndex = AGREEMENT_GUIDE_IMAGES.length - 1;

  const beginRead = useReadAttempt();
  const loadProfile = useCallback(async () => {
    const isCurrentRead = beginRead();
    if (!isCurrentRead()) return;
    try {
      const phone = (residentId ?? '').replace(/[^0-9]/g, '');
      if (!phone) { setProfileLoadState('error'); return; }
      setProfileLoadState('loading');
      const { data, error } = await supabase
        .from('fc_profiles')
        .select('id, temp_id, allowance_date, career_type, allowance_reject_reason, status')
        .eq('phone', phone)
        .maybeSingle();
      if (!isCurrentRead()) return;
      if (error || !data?.id) {
        setProfileLoadState('error');
        return;
      }
      setProfileId(data.id);
      setProfileLoadState('success');

      setTempId(data?.temp_id ?? '');
      if (data?.allowance_date) {
        setSelectedDate(parseCalendarDate(data.allowance_date));
      } else {
        setSelectedDate(null);
      }
      setCareerType(data?.career_type ?? null);
      setRejectReason(data?.allowance_reject_reason ?? null);

      // Fix: Check status to block edits
      setIsApproved(isConsentLockedStatus(data?.status));
      setProfileStatus(data?.status ?? null);

    } catch { if (isCurrentRead()) { setProfileLoadState('error');  } }
  }, [beginRead, residentId]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const notificationReceipt = useNotificationReceiptCompletion({
    params: { notificationId, notificationTarget },
    expectedTarget: profileId
      ? {
          version: 1,
          kind: 'onboarding_section',
          fcId: profileId,
          section: 'consent',
        }
      : null,
    loadState: identityGateAccepted ? profileLoadState : 'loading',
  });

  useEffect(() => {
    if (AGREEMENT_GUIDE_IMAGES[0]) {
      // Web safety check
      if (typeof Image.resolveAssetSource === 'function') {
        const { width: iw, height: ih } = Image.resolveAssetSource(AGREEMENT_GUIDE_IMAGES[0]);
        if (iw && ih) setImageRatio(ih / iw);
      }
    }
  }, []);

  const ymd = useMemo(() => (selectedDate ? toYMD(selectedDate) : ''), [selectedDate]);
  const stepNow = getConsentStepNow({
    approved: isApproved,
    tempId,
    allowanceDate: selectedDate,
    status: profileStatus,
    rejectReason,
  });

  const submit = async () => {
    if (!tempId) {
      Alert.alert('임시사번 필요', '임시사번이 발급된 후 보증보험 조회 동의일을 입력할 수 있습니다.');
      return;
    }
    if (!selectedDate) {
      Alert.alert('입력 확인', '보증보험 조회 동의일을 선택해주세요.');
      return;
    }
    if (!appSessionToken) {
      Alert.alert('로그인 정보 없음', '로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.');
      return;
    }
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('fc-consent', {
        headers: { 'x-app-session-token': appSessionToken },
        body: { allowance_date: ymd },
      });
      if (error) {
        logger.warn('[consent] fc-consent invoke failed');
        throw new Error('정보를 저장하지 못했습니다.');
      }

      if (!data?.ok || !data?.profile?.id) {
        logger.warn('[consent] fc-consent response invalid');
        throw new Error('정보를 저장하지 못했습니다.');
      }

      const notifyAdmins = () => invokeFcNotifyForDelivery({
        type: 'notify',
        target_role: 'admin',
        target_id: null,
        title: '보증보험 조회 동의일 제출',
        body: `${data.profile.name ?? ''}님이 보증보험 조회 동의일을 입력했습니다.`,
        category: 'app_event',
        url: `/dashboard?fcId=${encodeURIComponent(data.profile.id)}&section=consent`,
        target: {
          version: 1,
          kind: 'onboarding_section',
          fcId: data.profile.id,
          section: 'consent',
        },
      });
      const notificationDelivery = await notifyAdmins();
      presentPostCommitNotificationDelivery({
        delivery: notificationDelivery,
        retryNotification: notifyAdmins,
        successTitle: '저장 완료',
        successMessage:
          '보증보험 조회 동의일이 제출되었습니다. 관리자가 사전 심사를 준비할 예정입니다.',
        notificationLabel: '관리자',
        onDone: () => returnTo(router, INSURANCE_HOME_ROUTE),
        onRetryStart: () => setLoading(true),
        onRetryEnd: () => setLoading(false),
      });
    } catch (err: any) {
      Alert.alert('저장 실패', err?.message ?? '정보를 저장하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const openAllowanceSite = () => {
    openExternalUrl('https://www.sgic.co.kr', { preferExternalBrowser: true }).catch(() => {
      Alert.alert('오류', '사이트를 열 수 없습니다.');
    });
  };

  const copyTempId = useCallback(async () => {
    await copyTextWithFeedback(tempId.trim(), {
      emptyMessage: '임시사번이 발급된 후 다시 시도해주세요.',
      successMessage: '임시사번을 복사했습니다.',
      failureMessage: '임시사번 복사 중 오류가 발생했습니다.',
      logScope: 'consent',
    });
  }, [tempId]);

  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 48, 480); // Constrain max width for desktop
  const cardHeight = cardWidth * imageRatio * 0.8;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadProfile(); } finally { setRefreshing(false); }
  }, [loadProfile]);

  if (profileLoadState !== 'success' && !(!!profileId)) return (
    <SafeAreaView style={{ flex: 1 }}><ProfileReadState state={profileLoadState} retained={false} onRetry={() => void loadProfile()} /></SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ProfileReadState state={profileLoadState} retained={!!profileId} onRetry={() => void loadProfile()} />
      <NotificationReceiptStatusBanner
        state={notificationReceipt.state}
        onRetry={() => void notificationReceipt.retryMarkRead()}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 40 }]}
          keyboardShouldPersistTaps="always" disableScrollViewPanResponder
          keyboardDismissMode="none"
          refreshControl={
            < RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <OnboardingStepNowCard
            step={1}
            now={stepNow}
            style={styles.stepCard}
            action={stepNow.tone === 'mine' || stepNow.tone === 'rejected'
              ? { label: '서울보증보험 열기', onPress: openAllowanceSite, icon: 'external-link' }
              : undefined}
          />

          <View style={styles.card}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>지원 유형</Text>
              <Text style={[styles.infoValue, !careerType && styles.infoValueMuted]}>{careerType || '조회 중'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>임시사번</Text>
              <Text style={[styles.infoValue, !tempId.trim() && styles.infoValueMuted]} selectable>
                {tempId.trim() || '발급 중'}
              </Text>
              {tempId.trim() ? (
                <Pressable
                  onPress={() => { void copyTempId(); }}
                  accessibilityRole="button"
                  accessibilityLabel="임시사번 복사"
                  hitSlop={8}
                  style={({ pressed }) => [styles.tempIdCopyChip, pressed && styles.buttonPressed]}
                >
                  <Feather name="copy" size={13} color={COLORS.primaryButton} />
                  <Text style={styles.tempIdCopyChipLabel}>복사</Text>
                </Pressable>
              ) : null}
            </View>

            {tempId.trim() ? (
            <>
            <View style={styles.inputGroup}>
              <Text style={[styles.label, isApproved && styles.dateLabelDisabled]}>보증보험 조회 동의일</Text>
              <Pressable
                style={[
                  styles.dateInput,
                  !isApproved && styles.dateInputEmphasis,
                ]}
                disabled={isApproved}
                onPress={() => {
                  if (isApproved) return;
                  setTempDate(selectedDate ?? new Date());
                  setShowPicker(true);
                }}
              >
                <Text style={[
                  styles.dateText,
                  !selectedDate && styles.dateTextPlaceholder,
                  isApproved && styles.dateTextDisabled,
                ]}>
                  {selectedDate ? formatKoreanDate(selectedDate) : '날짜를 선택해주세요'}
                </Text>
                <Feather name="calendar" size={18} color={isApproved ? COLORS.text.secondary : COLORS.primaryButton} />
              </Pressable>
              {showPicker && Platform.OS !== 'ios' && (
                <DateTimePicker
                  value={selectedDate ?? new Date()}
                  maximumDate={new Date()}
                  mode="date"
                  display="default"
                  locale="ko-KR"
                  onChange={(event, d) => {
                    setShowPicker(false);
                    if (event.type === 'dismissed') {
                      return;
                    }
                    if (d) setSelectedDate(d);
                  }}
                />
              )}
            </View>

            {!isApproved ? (
              <Button
                onPress={submit}
                disabled={loading}
                loading={loading}
                variant="primary"
                size="lg"
                fullWidth
              >
                저장하기
              </Button>
            ) : null}
            </>
            ) : null}
          </View>

          {!isApproved ? (
          <>
          <Text style={styles.guideTitle}>동의 방법</Text>
          <View style={styles.sliderContainer}>
            <FlatList keyboardShouldPersistTaps="always"
              ref={sliderRef}
              data={AGREEMENT_GUIDE_IMAGES}
              style={[styles.guideList, { height: cardHeight }]}
              keyExtractor={(_, i) => String(i)}
              horizontal
              showsHorizontalScrollIndicator={false}
              pagingEnabled={false} // pagingEnabled can be buggy on web with variable widths, handled by snapToInterval
              decelerationRate="fast"
              snapToInterval={width}
              snapToAlignment="center"
              disableIntervalMomentum
              getItemLayout={(_, index) => ({
                length: width,
                offset: width * index,
                index,
              })}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / width);
                const nextIndex = Math.max(0, Math.min(maxIndex, idx));
                if (nextIndex !== currentIndex) {
                  setCurrentIndex(nextIndex);
                }
              }}
              renderItem={({ item }) => (
                <View style={{ width, alignItems: 'center', paddingHorizontal: 24 }}>
                  <View style={[styles.imageFrame, { height: cardHeight, width: cardWidth }]}>
                    <Image source={item} style={styles.guideImage} resizeMode="contain" />
                  </View>
                </View>
              )}
            />
            <View style={styles.pagination}>
               {AGREEMENT_GUIDE_IMAGES.map((_, i) => (
                <View key={i} style={[styles.dot, currentIndex === i && styles.dotActive]} />
              ))}
            </View>
          </View>
          </>
          ) : null}
        </ScrollView >
      </KeyboardAvoidingView >

      {
        Platform.OS === 'ios' && (
          <Modal visible={showPicker} transparent animationType="slide">
            <View style={styles.pickerOverlay}>
              <View style={styles.pickerCard}>
                <DateTimePicker
                  value={tempDate ?? selectedDate ?? new Date()}
                  maximumDate={new Date()}
                  mode="date"
                  display="inline"
                  locale="ko-KR"
                  accentColor={COLORS.primary}
                  onChange={(_, d) => {
                    if (d) setTempDate(d);
                  }}
                />
                <View style={styles.pickerActions}>
                  <Button
                    variant="ghost"
                    size="md"
                    onPress={() => {
                      setShowPicker(false);
                      setTempDate(null);
                    }}
                  >
                    취소
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    onPress={() => {
                      if (tempDate) setSelectedDate(tempDate);
                      setShowPicker(false);
                      setTempDate(null);
                    }}
                  >
                    확인
                  </Button>
                </View>
              </View>
            </View>
          </Modal>
        )
      }
    </SafeAreaView >
  );
}

const styles = StyleSheet.create({
  stepCard: { marginHorizontal: SPACING.base },
  card: {
    marginHorizontal: SPACING.base,
    marginBottom: SPACING.xl,
    padding: 20,
    borderRadius: 24,
    backgroundColor: COLORS.white,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.gray[100],
  },
  infoLabel: { width: 76, fontSize: 14, color: COLORS.gray[500] },
  infoValue: { flex: 1, fontSize: 16, fontWeight: '700', color: COLORS.gray[900] },
  infoValueMuted: { color: COLORS.gray[400], fontWeight: '500' },
  guideTitle: {
    marginHorizontal: SPACING.base + 4,
    marginBottom: SPACING.sm,
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.gray[900],
  },
  safe: { flex: 1, backgroundColor: '#f3f4f6' },
  container: { paddingTop: SPACING.base, paddingBottom: SPACING['2xl'] + 8 },

  sliderContainer: { marginBottom: SPACING.xl },
  guideList: { flexGrow: 0 },
  imageFrame: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    overflow: 'hidden',
  },
  guideImage: { width: '100%', height: '100%' },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SPACING.md,
    gap: SPACING.xs + 2
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.gray[300]
  },
  dotActive: {
    backgroundColor: COLORS.primaryButton,
    width: 18
  },



  inputGroup: { marginTop: SPACING.base, marginBottom: SPACING.base },
  tempIdCopyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
  },
  tempIdCopyChipLabel: {
    fontSize: 12,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.primaryButton,
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.text.primary,
    marginBottom: SPACING.sm
  },
  dateLabelDisabled: {
    color: COLORS.text.secondary,
  },
  dateInput: {
    height: 48,
    backgroundColor: COLORS.background.secondary,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    paddingHorizontal: SPACING.sm + 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateInputEmphasis: {
    backgroundColor: COLORS.primaryPale,
    borderColor: COLORS.primary,
    borderWidth: 1.5,
  },
  dateText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.text.primary
  },
  dateTextPlaceholder: { color: COLORS.text.disabled },
  dateTextDisabled: { color: COLORS.text.secondary },

  buttonPressed: { opacity: 0.9 },
  pickerOverlay: {
    flex: 1,
    backgroundColor: COLORS.background.overlay,
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: COLORS.white,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.base,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
  },
  pickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.md,
    marginTop: SPACING.sm,
  },
});
