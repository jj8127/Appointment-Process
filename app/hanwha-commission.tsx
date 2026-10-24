import { useReadAttempt } from '@/lib/use-read-attempt';
import { useReadSessionScope } from '@/hooks/use-read-session-scope';
import { ProfileReadState } from '@/components/ProfileReadState';
import { parseCalendarDate } from '@/lib/calendar-date';
import { Feather } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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

import BrandedLoadingState from '@/components/BrandedLoadingState';
import { Button } from '@/components/Button';
import CompactHeader, { FallbackBackButton } from '@/components/CompactHeader';
import { OnboardingStepNowCard } from '@/components/OnboardingStepNowCard';
import { getHanwhaStepNow } from '@/lib/onboarding-step-now';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { invokeAdminAction } from '@/lib/admin-action-api';
import { invokeFcNotifyForDelivery } from '@/lib/fc-notify-client';
import { presentPostCommitNotificationDelivery } from '@/lib/fc-notify-post-commit';
import { hasHanwhaApprovalEvidence, hasHanwhaPdfMetadata } from '@/lib/fc-workflow';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { downloadRemoteFileToUserStorage } from '@/lib/native-file-actions';
import { NotificationReceiptStatusBanner } from '@/lib/notification-receipt-ui';
import { openExternalUrl } from '@/lib/open-external-url';
import { INSURANCE_HOME_ROUTE } from '@/lib/service-home';
import { supabase } from '@/lib/supabase';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { useNotificationReceiptCompletion } from '@/lib/use-notification-receipt';
import type { FcStatus } from '@/types/fc';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

const formatKoreanDate = (date: Date) =>
  `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]})`;

const formatShortKoreanDate = (date: Date) =>
  `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;

const toYMD = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

type HanwhaProfile = {
  id?: string | null;
  name?: string | null;
  status?: FcStatus | null;
  hanwha_commission_date_sub?: string | null;
  hanwha_commission_date?: string | null;
  hanwha_commission_reject_reason?: string | null;
  hanwha_commission_pdf_path?: string | null;
  hanwha_commission_pdf_name?: string | null;
  dawichok_url_sent_at?: string | null;
  dawichok_url_sent_by?: string | null;
};

type HanwhaSubmissionReceipt = {
  id: string;
  name: string | null;
  status: 'hanwha-commission-review';
  hanwha_commission_date_sub: string;
  hanwha_commission_pdf_path: null;
  hanwha_commission_pdf_name: null;
};

const requireHanwhaSubmissionReceipt = (
  value: unknown,
  expectedProfileId: string,
  expectedDate: string,
): HanwhaSubmissionReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('다위촉 URL 저장 결과를 확인하지 못했습니다. 다시 시도해주세요.');
  }
  const row = value as Record<string, unknown>;
  if (
    row.id !== expectedProfileId
    || (row.name !== null && typeof row.name !== 'string')
    || row.status !== 'hanwha-commission-review'
    || row.hanwha_commission_date_sub !== expectedDate
    || row.hanwha_commission_pdf_path !== null
    || row.hanwha_commission_pdf_name !== null
  ) {
    throw new Error('다위촉 URL 저장 결과를 확인하지 못했습니다. 다시 시도해주세요.');
  }
  return row as HanwhaSubmissionReceipt;
};

const trimString = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const resolveFunctionInvokeErrorMessage = async (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: { json?: () => Promise<any> } }).context;
    if (context?.json) {
      const body = await context.json().catch(() => null);
      const message = trimString(body?.message) ?? trimString(body?.error);
      if (message) return message;
    }
  }
  if (error instanceof Error && trimString(error.message)) {
    return error.message;
  }
  return fallback;
};

export default function HanwhaCommissionScreen() {
  const scope = useReadSessionScope();
  return <HanwhaCommissionScreenContent key={scope} />;
}

function HanwhaCommissionScreenContent() {
  const { role, residentId, appSessionToken } = useSession();
  const { notificationId, notificationTarget } = useLocalSearchParams<{
    notificationId?: string;
    notificationTarget?: string;
  }>();
  const { destinationAccepted: identityGateAccepted } =
    useIdentityGate({ nextPath: '/hanwha-commission' });
  const keyboardPadding = useKeyboardPadding();

  const [profile, setProfile] = useState<HanwhaProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [openingPdf, setOpeningPdf] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date | null>(null);
  const [displayDate, setDisplayDate] = useState<Date | null>(null);
  const [profileLoadState, setProfileLoadState] = useState<
    'loading' | 'success' | 'error'
  >('loading');

  const beginRead = useReadAttempt();
  const load = useCallback(async () => {
    const isCurrentRead = beginRead();
    if (!isCurrentRead()) return;
    try {
    if (!residentId) return;
    const cleanPhone = residentId.replace(/[^0-9]/g, '');
    if (!cleanPhone) return;

    setLoading(true);
    setProfileLoadState('loading');
    const { data, error } = await supabase
      .from('fc_profiles')
      .select(
        'id,name,status,hanwha_commission_date_sub,hanwha_commission_date,hanwha_commission_reject_reason,hanwha_commission_pdf_path,hanwha_commission_pdf_name,dawichok_url_sent_at,dawichok_url_sent_by',
      )
      .eq('phone', cleanPhone)
      .maybeSingle();
      if (!isCurrentRead()) return;
    setLoading(false);

    if (error || !data?.id) {
      setProfileLoadState('error');
      Alert.alert('불러오기 실패', error?.message ?? '정보를 불러오지 못했습니다.');
      return;
    }

    const nextProfile = (data ?? null) as HanwhaProfile | null;
    setProfile(nextProfile);
    setProfileLoadState(nextProfile?.id ? 'success' : 'error');

    const approvedDate = nextProfile?.hanwha_commission_date
      ? parseCalendarDate(nextProfile.hanwha_commission_date)
      : null;
    const submittedDate = nextProfile?.hanwha_commission_date_sub
      ? parseCalendarDate(nextProfile.hanwha_commission_date_sub)
      : null;
    setDisplayDate(approvedDate || submittedDate || null);

    } catch { if (isCurrentRead()) { setProfileLoadState('error'); setLoading(false); } }
  }, [beginRead, residentId]);

  useEffect(() => {
    load();
  }, [load]);
  const notificationReceipt = useNotificationReceiptCompletion({
    params: { notificationId, notificationTarget },
    expectedTarget: profile?.id
      ? {
          version: 1,
          kind: 'onboarding_section',
          fcId: profile.id,
          section: 'hanwha_commission',
        }
      : null,
    loadState: identityGateAccepted ? profileLoadState : 'loading',
  });

  const submittedDate = useMemo(
    () => (profile?.hanwha_commission_date_sub ? parseCalendarDate(profile.hanwha_commission_date_sub) : null),
    [profile?.hanwha_commission_date_sub],
  );
  const rejectReason = trimString(profile?.hanwha_commission_reject_reason);
  const pdfPath = trimString(profile?.hanwha_commission_pdf_path);
  const rawPdfName = trimString(profile?.hanwha_commission_pdf_name);
  const pdfName = rawPdfName ?? '다위촉 URL PDF';
  const status = profile?.status ?? null;

  const isApproved = hasHanwhaApprovalEvidence({
    status: status ?? undefined,
    hanwha_commission_date: profile?.hanwha_commission_date ?? null,
  });
  const canSubmitHanwha = Boolean(
    status === 'docs-approved' ||
    status === 'hanwha-commission-review' ||
    status === 'hanwha-commission-rejected',
  );
  const isRejected = !isApproved && status === 'hanwha-commission-rejected';
  const isPending =
    !isApproved &&
    !isRejected &&
    Boolean(status === 'hanwha-commission-review' || submittedDate);
  const hasAttachedPdf = hasHanwhaPdfMetadata({
    hanwha_commission_pdf_path: pdfPath,
    hanwha_commission_pdf_name: rawPdfName,
  });
  const isPrerequisiteBlocked = !canSubmitHanwha && !isApproved && !isPending;
  const isLocked = isApproved || isPending || isPrerequisiteBlocked;
  const pdfCardTitle = isApproved ? '승인 PDF' : '첨부 PDF';

  const stepNow = getHanwhaStepNow({
    blocked: isPrerequisiteBlocked,
    approved: isApproved,
    hasPdf: hasAttachedPdf,
    rejected: isRejected,
    pending: isPending,
    rejectReason,
  });
  // The date form is only for my turn or a rejection; afterwards the submitted date is shown read-only.
  const showDateForm = !isLocked;

  const handleDateChange = useCallback((event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    if (event.type !== 'set' || !selectedDate) return;
    setDisplayDate(selectedDate);
  }, []);

  const submitDate = useCallback(async () => {
    if (savingRef.current) return;
    if (!residentId || !appSessionToken) {
      Alert.alert('로그인 정보 없음', '로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.');
      return;
    }
    if (!profile?.id) {
      Alert.alert('저장 실패', '현재 프로필을 확인할 수 없습니다. 새로고침 후 다시 시도해주세요.');
      return;
    }
    if (!displayDate) {
      Alert.alert('날짜 선택', '다위촉 URL 완료일을 선택해주세요.');
      return;
    }

    const cleanPhone = residentId.replace(/[^0-9]/g, '');
    if (!cleanPhone) {
      Alert.alert('로그인 정보 없음', '로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    const ymd = toYMD(displayDate);

    try {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        data?: unknown;
        message?: string;
        error?: string;
      }>('fc-submit-hanwha-commission', {
        headers: { 'x-app-session-token': appSessionToken },
        body: {
          hanwha_commission_date_sub: ymd,
        },
      });

      if (error) {
        const message = await resolveFunctionInvokeErrorMessage(error, '다위촉 URL 정보를 저장하지 못했습니다.');
        throw new Error(message);
      }
      if (!data?.ok) {
        throw new Error(data?.message ?? data?.error ?? '다위촉 URL 정보를 저장하지 못했습니다.');
      }
      const updatedProfile = requireHanwhaSubmissionReceipt(data.data, profile.id, ymd);
      const updatedProfileId = updatedProfile.id;

      const notifyAdmins = () => invokeFcNotifyForDelivery({
        type: 'notify',
        target_role: 'admin',
        target_id: null,
        title: '다위촉 URL 완료 보고',
        body: `${updatedProfile.name ?? ''}님이 다위촉 URL 완료를 보고했습니다. (입력일: ${ymd})`,
        category: 'app_event',
        url: `/dashboard?fcId=${encodeURIComponent(updatedProfileId)}&section=hanwha_commission`,
        target: {
          version: 1,
          kind: 'onboarding_section',
          fcId: updatedProfileId,
          section: 'hanwha_commission',
        },
      });
      const notificationDelivery = await notifyAdmins();
      await load();
      presentPostCommitNotificationDelivery({
        delivery: notificationDelivery,
        retryNotification: notifyAdmins,
        successTitle: '제출 완료',
        successMessage:
          '다위촉 URL 완료일이 제출되었습니다. 관리자 검토 후 다음 안내를 기다려주세요.',
        notificationLabel: '관리자',
      });
    } catch (error: any) {
      Alert.alert('저장 실패', error?.message ?? '다위촉 URL 정보를 저장하지 못했습니다.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [appSessionToken, displayDate, load, profile?.id, residentId]);

  const resolvePdfUrl = useCallback(async () => {
    if (!pdfPath) {
    throw new Error('열 수 있는 다위촉 URL PDF가 없습니다.');
    }
    try {
      const { signedUrl } = await invokeAdminAction<{ signedUrl: string }>(
        residentId ?? '',
        'signOwnDocument',
        { storagePath: pdfPath },
      );
      return signedUrl;
    } catch {
      throw new Error('PDF URL을 생성하지 못했습니다.');
    }
  }, [pdfPath, residentId]);

  const openPdf = useCallback(async () => {
    if (!pdfPath) {
      Alert.alert('PDF 없음', '열 수 있는 다위촉 URL PDF가 없습니다.');
      return;
    }

    setOpeningPdf(true);
    try {
      const signedUrl = await resolvePdfUrl();
      await openExternalUrl(signedUrl);
    } catch (error: any) {
      Alert.alert('PDF 열기 실패', error?.message ?? '다위촉 URL PDF를 열지 못했습니다.');
    } finally {
      setOpeningPdf(false);
    }
  }, [pdfPath, resolvePdfUrl]);

  const downloadPdf = useCallback(async () => {
    if (!pdfPath) {
      Alert.alert('PDF 없음', '다운로드할 다위촉 URL PDF가 없습니다.');
      return;
    }

    setDownloadingPdf(true);
    try {
      const signedUrl = await resolvePdfUrl();
      const inferredName = (pdfName?.trim() || 'hanwha-commission.pdf').replace(/[\\/:*?"<>|]/g, '_');
      const safeName = inferredName.toLowerCase().endsWith('.pdf') ? inferredName : `${inferredName}.pdf`;
      const result = await downloadRemoteFileToUserStorage({
        url: signedUrl,
        fileName: safeName,
        mimeType: 'application/pdf',
        tempPrefix: 'hanwha',
      });

      Alert.alert('다운로드 완료', `${result.destinationLabel}에 저장되었습니다.\n${result.fileName}`);
    } catch (error: any) {
      Alert.alert('PDF 다운로드 실패', error?.message ?? '다위촉 URL PDF를 다운로드하지 못했습니다.');
    } finally {
      setDownloadingPdf(false);
    }
  }, [pdfName, pdfPath, resolvePdfUrl]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (role !== 'fc') {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={[styles.container, styles.centeredContainer]}>
          <Text style={styles.infoText}>FC 계정으로 로그인하면 이용할 수 있습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (profileLoadState !== 'success' && !(!!profile)) return (
    <SafeAreaView style={{ flex: 1 }}><ProfileReadState state={profileLoadState} retained={false} onRetry={() => void load()} /></SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ProfileReadState state={profileLoadState} retained={!!profile} onRetry={() => void load()} />
      <NotificationReceiptStatusBanner
        state={notificationReceipt.state}
        onRetry={() => void notificationReceipt.retryMarkRead()}
      />
      <Stack.Screen
        options={{
          headerShown: true,
          title: '다위촉 URL',
          header: (props) => <CompactHeader {...props} />,
          headerLeft: () => <FallbackBackButton href={INSURANCE_HOME_ROUTE} />,
        }}
      />

      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 40 }]}
        contentInsetAdjustmentBehavior="never"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <OnboardingStepNowCard
          step={3}
          now={stepNow}
        />

        {loading ? (
          <BrandedLoadingState variant="hanwha-commission" layout="section" />
        ) : (
          <>
            {showDateForm ? (
            <View style={styles.card}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>다위촉 URL 완료일</Text>
                {Platform.OS === 'web' ? (
                  <View style={styles.webDateWrapper}>
                    <View style={styles.dateInput}>
                      <Text style={[styles.dateText, !displayDate && styles.placeholderText]}>
                        {displayDate ? formatShortKoreanDate(displayDate) : '날짜를 선택하세요'}
                      </Text>
                      <Feather name="calendar" size={18} color={COLORS.primaryButton} />
                    </View>
                    {/* @ts-ignore */}
                    <input
                      type="date"
                      style={styles.webDateInput}
                      value={displayDate ? toYMD(displayDate) : ''}
                      onChange={(event: any) => {
                        const nextDate = event.target.valueAsDate;
                        if (nextDate) {
                          handleDateChange({ type: 'set' } as DateTimePickerEvent, nextDate);
                        }
                      }}
                    />
                  </View>
                ) : (
                  <Pressable
                    style={[styles.dateInput, saving && { opacity: 0.5 }]}
                    disabled={saving}
                    onPress={() => {
                      setTempDate(displayDate ?? new Date());
                      setShowPicker(true);
                    }}
                  >
                    <Text style={[styles.dateText, !displayDate && styles.placeholderText]}>
                      {displayDate ? formatKoreanDate(displayDate) : '날짜를 선택하세요'}
                    </Text>
                    <Feather name="calendar" size={18} color={COLORS.primaryButton} />
                  </Pressable>
                )}

                {showPicker && Platform.OS === 'android' && (
                  <DateTimePicker
                    value={displayDate ?? new Date()}
                    mode="date"
                    onChange={handleDateChange}
                  />
                )}
              </View>

              <Button
                onPress={submitDate}
                disabled={!displayDate || saving}
                loading={saving}
                variant="primary"
                size="lg"
                fullWidth
              >
                완료일 제출하기
              </Button>
            </View>
            ) : submittedDate ? (
              <View style={[styles.card, styles.summaryRow]}>
                <Text style={styles.summaryLabel}>제출한 완료일</Text>
                <Text style={styles.summaryValue}>{formatKoreanDate(submittedDate)}</Text>
              </View>
            ) : null}

            {hasAttachedPdf ? (
            <View style={styles.card}>
              <View style={styles.compactHero}>
                <View style={[styles.heroIconWrap, styles.heroIconWrapSolid]}>
                  <Feather name="file-text" size={20} color={COLORS.white} />
                </View>
                <View style={styles.heroTextWrap}>
                  <Text style={styles.sectionTitle}>{pdfCardTitle}</Text>
                  <Text style={styles.sectionDesc}>{pdfName}</Text>
                </View>
              </View>

              <View style={[styles.pdfDock, hasAttachedPdf ? styles.pdfDockReady : styles.pdfDockPending]}>
                <View style={styles.pdfDockMain}>
                  <View style={[styles.pdfPreviewBadge, hasAttachedPdf ? styles.pdfPreviewBadgeReady : styles.pdfPreviewBadgePending]}>
                    <Feather
                      name={hasAttachedPdf ? 'file-text' : 'download-cloud'}
                      size={22}
                      color={hasAttachedPdf ? COLORS.primary : COLORS.text.disabled}
                    />
                  </View>
                  <View style={styles.pdfDockTextWrap}>
                    <Text style={styles.pdfDockTitle}>
                      {hasAttachedPdf ? `다위촉 URL ${pdfCardTitle}` : 'PDF 도착 대기'}
                    </Text>
                    <Text style={styles.pdfDockDesc}>
                      {hasAttachedPdf
                        ? isApproved
                          ? pdfName
                          : `${pdfName} · 필요하면 바로 열어볼 수 있습니다.`
                        : '총무가 PDF를 등록하면 여기서 바로 확인할 수 있습니다.'}
                    </Text>
                  </View>
                </View>

                <View style={styles.pdfActions}>
                  <Button
                    onPress={openPdf}
                    loading={openingPdf}
                    disabled={!hasAttachedPdf}
                    variant="outline"
                    size="md"
                    style={styles.pdfActionBtn}
                    leftIcon={<Feather name="eye" size={16} color={hasAttachedPdf ? COLORS.primary : COLORS.text.disabled} />}
                  >
                    열람
                  </Button>
                  <Button
                    onPress={downloadPdf}
                    loading={downloadingPdf}
                    disabled={!hasAttachedPdf}
                    variant={hasAttachedPdf ? 'secondary' : 'outline'}
                    size="md"
                    style={styles.pdfActionBtn}
                    leftIcon={<Feather name="download" size={16} color={hasAttachedPdf ? COLORS.white : COLORS.text.disabled} />}
                  >
                    다운로드
                  </Button>
                </View>

              </View>
            </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {Platform.OS === 'ios' && showPicker && (
        <Modal visible transparent animationType="slide">
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={tempDate ?? displayDate ?? new Date()}
                mode="date"
                display="inline"
                locale="ko-KR"
                onChange={(_, nextDate) => {
                  if (nextDate) {
                    setTempDate(nextDate);
                  }
                }}
              />
              <View style={styles.pickerActions}>
                <Pressable
                  style={[styles.pickerBtn, styles.pickerBtnGhost]}
                  onPress={() => {
                    setShowPicker(false);
                    setTempDate(null);
                  }}
                >
                  <Text style={styles.pickerBtnGhostText}>취소</Text>
                </Pressable>
                <Pressable
                  style={[styles.pickerBtn, styles.pickerBtnPrimary]}
                  onPress={() => {
                    if (tempDate) {
                      setDisplayDate(tempDate);
                    }
                    setShowPicker(false);
                    setTempDate(null);
                  }}
                >
                  <Text style={styles.pickerBtnPrimaryText}>확인</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f3f4f6' },
  container: {
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.xl,
  },
  centeredContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  card: {
    marginBottom: 12,
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 20,
    gap: SPACING.base,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 14, color: COLORS.gray[500] },
  summaryValue: { fontSize: 16, fontWeight: '700', color: COLORS.gray[900] },
  compactHero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  heroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconWrapSolid: {
    backgroundColor: COLORS.primaryButton,
  },
  heroTextWrap: {
    flex: 1,
    gap: 4,
  },
  sectionTitle: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
  },
  sectionDesc: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    color: COLORS.text.muted,
    lineHeight: 20,
  },
  pdfDock: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.md,
  },
  pdfDockReady: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  pdfDockPending: {
    backgroundColor: COLORS.background.secondary,
    borderColor: COLORS.border.light,
    borderStyle: 'dashed',
  },
  pdfDockMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  pdfPreviewBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfPreviewBadgeReady: {
    backgroundColor: '#FFE7D1',
  },
  pdfPreviewBadgePending: {
    backgroundColor: COLORS.white,
  },
  pdfDockTextWrap: {
    flex: 1,
    gap: 4,
  },
  pdfDockTitle: {
    fontSize: TYPOGRAPHY.fontSize.base + 1,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
  },
  pdfDockDesc: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    lineHeight: 19,
  },
  pdfActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  pdfActionBtn: {
    flex: 1,
  },
  inputGroup: {
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.text.primary,
  },
  webDateWrapper: {
    position: 'relative',
    width: '100%',
  },
  webDateInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    cursor: 'pointer',
  } as any,
  dateInput: {
    minHeight: 48,
    backgroundColor: COLORS.background.secondary,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    paddingHorizontal: SPACING.sm + 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  dateText: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.text.primary,
  },
  placeholderText: {
    color: COLORS.text.disabled,
  },
  infoText: {
    color: COLORS.text.muted,
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
  },
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
  pickerBtn: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.base,
    borderRadius: RADIUS.base + 2,
  },
  pickerBtnGhost: {
    backgroundColor: COLORS.gray[100],
  },
  pickerBtnPrimary: {
    backgroundColor: COLORS.gray[700],
  },
  pickerBtnGhostText: {
    color: COLORS.text.primary,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  pickerBtnPrimaryText: {
    color: COLORS.white,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
});
