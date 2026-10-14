import { QueryReadState } from '@/components/QueryReadState';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { KeyboardAwareWrapper, type KeyboardAwareWrapperHandle } from '@/components/KeyboardAwareWrapper';
import { OptionSheetField } from '@/components/OptionSheetField';
import { ReferralSearchField, ReferralSearchResultList, REFERRAL_SEARCH_MIN_CHARS_HINT, REFERRAL_SEARCH_EMPTY_HINT, type ReferralSearchResult } from '@/components/ReferralSearchField';
import { useDraftExitGuard } from '@/hooks/use-draft-exit-guard';
import { useLogin } from '@/hooks/use-login';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { useIdentityStatus } from '@/hooks/use-identity-status';
import { createCreationRequestTracker } from '@/lib/board-comment-request';
import { ENROLLMENT_FIELD_ORDER, getEnrollmentFieldErrors, type EnrollmentField, type EnrollmentFieldErrors } from '@/lib/insurance-enrollment-errors';
import { LICENSE_STATUS_LABELS, LICENSE_STATUS_NONE, LICENSE_STATUS_OPTIONS, normalizeLicenseStatuses, toggleLicenseStatus } from '@/lib/license-statuses';
import { INSURANCE_CONSENT_VERSION, platformRequest, type PlatformInsuranceEnrollment } from '@/lib/platform-api';
import { consumePendingReferralCode } from '@/lib/referral-deeplink';
import { parseSignupReferralSearchResponse } from '@/lib/referral-read-response';
import { buildStoredSignupReferral, hasValidStoredSignupReferral } from '@/lib/signup-referral';
import { composeEmail, EMAIL_DOMAIN_DIRECT_INPUT, SIGNUP_AFFILIATION_OPTIONS, SIGNUP_CARRIER_OPTIONS, SIGNUP_EMAIL_DOMAIN_CHOICES } from '@/lib/signup-profile-options';
import { useReadAttempt } from '@/lib/use-read-attempt';
import type { LicenseStatus } from '@/types/fc';
import { buildApplyGateIdentityRoute, buildHomeEntryBreadcrumb, normalizeApplyGateNext } from '@/lib/home-entry-flow';
import {
  authorizeNotificationOpen,
  parseNotificationOpenRoute,
} from '@/lib/notification-open-authorization';
import { markNotificationNavigationIdle } from '@/lib/notification-navigation-coordinator';
import { clearPendingNotificationNavigation } from '@/lib/pending-notification-navigation';
import { addSentryBreadcrumb } from '@/lib/sentry-monitor';
import { COLORS, SPACING, TYPOGRAPHY } from '@/lib/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
// The last item is the only step for an existing FC without identity data.
const PREPARATION_ITEMS: { icon: FeatherName; title: string }[] = [
  { icon: 'briefcase', title: '소속 · 이메일 · 통신사' },
  { icon: 'award', title: '자격증 보유 현황' },
  { icon: 'user-check', title: '보험 추천인' },
  { icon: 'shield', title: '주민번호 · 주소' },
];
const UNLOCKED_FEATURES = ['설계 요청', '메신저', '공지·알림', '위촉 진행'];

export default function ApplyGateScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { role, hydrated, platformHydrated, platformMember, isPlatformSignedIn, platformSessionToken, appSessionToken, isRequestBoardDesigner } = useSession();
  const token = platformSessionToken ?? appSessionToken;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const commonOnly = !role && Boolean(platformMember);
  const { acceptLoginResponse } = useLogin();
  const [formShown, setFormShown] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentDetailShown, setConsentDetailShown] = useState(false);
  const [affiliation, setAffiliation] = useState('');
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [customEmailDomain, setCustomEmailDomain] = useState('');
  const email = composeEmail(emailLocal, emailDomain, customEmailDomain);
  const [carrier, setCarrier] = useState('');
  const [licenseStatuses, setLicenseStatuses] = useState<LicenseStatus[]>([LICENSE_STATUS_NONE]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ReferralSearchResult[]>([]);
  const [selectedReferral, setSelectedReferral] = useState<ReferralSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [validating, setValidating] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<EnrollmentFieldErrors>({});
  const scrollHandle = useRef<KeyboardAwareWrapperHandle>(null);
  const formTop = useRef(0);
  const fieldTops = useRef<Partial<Record<EnrollmentField, number>>>({});
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const installingToken = useRef<string | null>(null);
  const referralEditVersion = useRef(0);
  const tracker = useRef(createCreationRequestTracker(randomUUID));
  const beginSearch = useReadAttempt();
  const beginSelection = useReadAttempt();
  const beginSubmit = useReadAttempt();
  const keyboardPadding = useKeyboardPadding();
  const allowExit = useDraftExitGuard(commonOnly && formShown && Boolean(affiliation || emailLocal || emailDomain || carrier || searchQuery), submitting);
  const { data, isLoading, isError, error, refetch, isFetching } = useIdentityStatus();
  const safeNext = useMemo(() => normalizeApplyGateNext(next), [next]);
  const forwardToSafeNext = useCallback(async () => {
    const handoff = parseNotificationOpenRoute(safeNext);
    if (handoff) {
      const authorization = await authorizeNotificationOpen(handoff);
      if (!authorization.ok) {
        await clearPendingNotificationNavigation({
          notificationId: handoff.notificationId,
          target: handoff.target,
        });
        markNotificationNavigationIdle();
        router.replace('/notifications?targetError=unavailable');
        return;
      }
    }
    router.replace(safeNext as Href);
  }, [safeNext]);

  useEffect(() => {
    if (!hydrated || !platformHydrated) return;
    if (!isPlatformSignedIn) {
      router.replace('/services/login?service=insurance');
      return;
    }
    if (role === 'admin') {
      router.replace('/');
      return;
    }
    if (isRequestBoardDesigner) {
      addSentryBreadcrumb(buildHomeEntryBreadcrumb('apply-gate.forward-completed', { next: safeNext }));
      void forwardToSafeNext();
      return;
    }
    if (!isLoading && !isError && data?.identityCompleted) {
      addSentryBreadcrumb(buildHomeEntryBreadcrumb('apply-gate.forward-completed', { next: safeNext }));
      void forwardToSafeNext();
    }
  }, [
    data?.identityCompleted,
    forwardToSafeNext,
    hydrated,
    platformHydrated,
    isPlatformSignedIn,
    isError,
    isLoading,
    isRequestBoardDesigner,
    role,
    safeNext,
  ]);

  const returnHomeLite = useCallback(() => {
    addSentryBreadcrumb(buildHomeEntryBreadcrumb('apply-gate.return-home'));
    router.replace('/');
  }, []);

  const startIdentityInput = useCallback(() => {
    if (commonOnly && !consentAccepted) return;
    if (commonOnly) { setFormShown(true); return; }
    addSentryBreadcrumb(buildHomeEntryBreadcrumb('apply-gate.start-identity', { next: safeNext }));
    router.push(buildApplyGateIdentityRoute(safeNext) as Href);
  }, [commonOnly, consentAccepted, safeNext]);

  const validateReferral = useCallback(async (code: string) => {
    if (!token) return;
    const owns = beginSelection();
    const isCurrent = () => owns() && tokenRef.current === token;
    setValidating(true); setSelectedReferral(null); setReferralError(null);
    try {
      const result = await platformRequest<{ ok: true; inviterFcId: string; inviterName: string; inviterAffiliation: string; referralCode: string }>(
        'validate_insurance_referral', { referralCode: code }, token);
      if (!isCurrent()) return;
      if (result.referralCode !== code) throw new Error('추천인 응답을 확인하지 못했습니다. 다시 선택해 주세요.');
      setSelectedReferral({ fcId: result.inviterFcId, name: result.inviterName, affiliation: result.inviterAffiliation, code });
      setSearchQuery(result.inviterName); setSearchResults([]); clearFieldError('referral');
    } catch (cause) {
      if (isCurrent()) setReferralError(cause instanceof Error ? cause.message : '추천인을 확인하지 못했습니다. 다시 선택해 주세요.');
    } finally { if (isCurrent()) setValidating(false); }
  }, [beginSelection, token]);

  useEffect(() => {
    if (pending.current && token === installingToken.current) return;
    beginSubmit(); beginSelection(); beginSearch(); pending.current = false;
    installingToken.current = null;
    tracker.current.complete(); referralEditVersion.current = 0;
    setFormShown(false); setConsentAccepted(false); setAffiliation(''); setEmailLocal(''); setEmailDomain(''); setCustomEmailDomain(''); setCarrier('');
    setLicenseStatuses([LICENSE_STATUS_NONE]); setSearchQuery(''); setSearchResults([]); setSelectedReferral(null);
    setSubmitting(false); setSearching(false); setValidating(false); setReferralError(null); setSaveError(null); setFieldErrors({});
  }, [token, beginSubmit, beginSelection, beginSearch]);

  useEffect(() => {
    if (!commonOnly || !token) return;
    let current = true;
    const editVersion = referralEditVersion.current;
    void consumePendingReferralCode().then(code => {
      if (current && tokenRef.current === token && referralEditVersion.current === editVersion && code && /^[A-Z0-9]{8}$/.test(code)) {
        void validateReferral(code);
      }
    }).catch(() => { /* Optional insurance invitation must not block manual selection. */ });
    return () => { current = false; };
  }, [commonOnly, token, validateReferral]);

  useEffect(() => {
    const owns = beginSearch();
    if (!commonOnly || !token || selectedReferral || validating || searchQuery.trim().length < 2) {
      setSearching(false); setSearchResults([]); return;
    }
    const timer = setTimeout(() => {
      setSearching(true); setReferralError(null);
      void platformRequest<unknown>('search_insurance_referral', { query: searchQuery.trim() }, token).then(result => {
        if (owns() && tokenRef.current === token) setSearchResults(parseSignupReferralSearchResponse(result));
      }).catch(cause => {
        if (owns() && tokenRef.current === token) { setSearchResults([]); setReferralError(cause instanceof Error ? cause.message : '추천인 검색을 다시 시도해 주세요.'); }
      }).finally(() => { if (owns() && tokenRef.current === token) setSearching(false); });
    }, 300);
    return () => { clearTimeout(timer); beginSearch(); };
  }, [beginSearch, commonOnly, searchQuery, selectedReferral, token, validating]);

  const clearFieldError = (field: EnrollmentField) => setFieldErrors(current => {
    if (!current[field]) return current;
    const next = { ...current }; delete next[field]; return next;
  });

  const revealField = (field: EnrollmentField) => {
    scrollHandle.current?.scrollToY(formTop.current + (fieldTops.current[field] ?? 0) - 24);
  };

  const changeReferralSearch = (value: string) => {
    clearFieldError('referral');
    referralEditVersion.current += 1; beginSelection(); beginSearch();
    setSearchQuery(value); setSelectedReferral(null); setSearchResults([]); setValidating(false); setReferralError(null);
  };

  const submitEnrollment = async () => {
    if (!token || pending.current || !commonOnly) return;
    const referral = buildStoredSignupReferral({ selectedReferral, referralStatus: selectedReferral ? 'valid' : 'idle',
      referralInviterName: selectedReferral?.name ?? '', referralInviterFcId: selectedReferral?.fcId ?? null });
    if (!consentAccepted) { setSaveError('추가정보 수집·이용에 동의해 주세요.'); return; }
    const errors = getEnrollmentFieldErrors({ affiliation, email, carrier, searchQuery, selectedReferral,
      referralReady: !validating && hasValidStoredSignupReferral(referral) });
    setFieldErrors(errors);
    const firstInvalid = ENROLLMENT_FIELD_ORDER.find(field => errors[field]);
    if (firstInvalid) { revealField(firstInvalid); return; }
    const payload = { confirmed: true, consentAccepted: true, consentVersion: INSURANCE_CONSENT_VERSION,
      affiliation, email: email.trim(), carrier, licenseStatuses: normalizeLicenseStatuses(licenseStatuses),
      referralCode: referral.referralCode, referralInviterFcId: referral.referralInviterFcId };
    const idempotencyKey = tracker.current.requestId(JSON.stringify(payload));
    pending.current = true; setSubmitting(true); setSaveError(null);
    const owns = beginSubmit();
    const isCurrent = () => owns() && tokenRef.current === token;
    try {
      const result = await platformRequest<PlatformInsuranceEnrollment>('enroll_insurance', { ...payload, idempotencyKey }, token);
      if (!isCurrent()) return;
      installingToken.current = result.insuranceSession.appSessionToken ?? null;
      const installedRole = await acceptLoginResponse(result.insuranceSession, undefined, isCurrent);
      if (!installedRole || !owns()) return;
      tracker.current.complete(idempotencyKey); allowExit();
      router.replace(buildApplyGateIdentityRoute(safeNext) as Href);
    } catch (cause) {
      if (isCurrent()) setSaveError(cause instanceof Error ? cause.message : '추가 등록을 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally { if (owns()) { pending.current = false; setSubmitting(false); } }
  };

  if (!hydrated || !platformHydrated || !isPlatformSignedIn) return <SafeAreaView style={styles.safe}>
    <QueryReadState message="로그인 정보를 확인하고 있습니다." />
  </SafeAreaView>;

  if (!commonOnly && (isLoading || isError || !data)) return <SafeAreaView style={styles.safe}>
    <QueryReadState error={error} message={isLoading ? '신원 정보를 확인하고 있습니다.' : '신원 정보 확인에 실패했습니다. 미입력 상태로 판단하지 않습니다.'}
      onRetry={isLoading ? undefined : () => void refetch()} retrying={isFetching} />
  </SafeAreaView>;

  const showForm = commonOnly && formShown;
  const preparation = commonOnly ? PREPARATION_ITEMS : PREPARATION_ITEMS.slice(-1);

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAwareWrapper handleRef={scrollHandle} contentContainerStyle={[styles.container, { paddingBottom: Math.max(showForm ? 80 : 32, keyboardPadding + 40) }]} keyboardDismissMode="none">
        <View accessible accessibilityLabel="2단계 중 1단계" style={styles.progress}>
          {[0, 1].map(step => <View key={step} style={[styles.progressBar, step === 0 && styles.progressBarActive]} />)}
        </View>

        {!showForm && <>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>가람in 이용 준비</Text>
            <Text accessibilityRole="header" style={styles.title}>{commonOnly ? '가람in을 이용하려면\n추가 정보가 필요해요' : '신원 정보만 입력하면\n모든 기능을 이용할 수 있어요'}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>준비할 정보</Text>
            {preparation.map(item => <View key={item.title} style={styles.prepRow}>
              <View style={styles.prepIcon}><Feather accessible={false} name={item.icon} size={18} color={COLORS.primaryButton} /></View>
              <Text style={[styles.prepTitle, styles.grow]}>{item.title}</Text>
            </View>)}
          </View>

          {commonOnly && <View style={[styles.consentCard, consentAccepted && styles.consentCardChecked]}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel="가람in 추가정보 수집·이용 동의" accessibilityState={{ checked: consentAccepted, disabled: submitting }} disabled={submitting}
              onPress={() => setConsentAccepted(value => !value)} style={styles.consent}>
              <View style={[styles.checkbox, consentAccepted && styles.checkboxChecked]}>
                {consentAccepted && <Feather accessible={false} name="check" size={16} color={COLORS.white} />}
              </View>
              <Text style={[styles.consentText, styles.grow]}><Text style={styles.required}>[필수] </Text>가람in 추가정보 수집·이용 동의</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={consentDetailShown ? '동의 내용 접기' : '동의 내용 보기'} accessibilityState={{ expanded: consentDetailShown }}
              onPress={() => setConsentDetailShown(value => !value)} style={styles.detailToggle}>
              <Text style={styles.detailToggleText}>{consentDetailShown ? '내용 접기' : '내용 보기'}</Text>
              <Feather accessible={false} name={consentDetailShown ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.text.secondary} />
            </Pressable>
            {consentDetailShown && <View style={styles.consentDetail}>
              <Text style={styles.prepBody}>수집 목적: 가람in 위촉 신청 및 등록 처리</Text>
              <Text style={styles.prepBody}>수집 항목: 소속, 이메일, 통신사, 자격증 보유 현황, 보험 추천인</Text>
              <Text style={styles.prepBody}>보험 추천 관계는 다른 제휴 서비스의 추천인과 별도로 관리합니다. 보관·파기 안내는 다음 신원 입력 단계에서 확인할 수 있습니다.</Text>
            </View>}
          </View>}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>입력을 마치면 이용할 수 있어요</Text>
            <View style={styles.chips}>{UNLOCKED_FEATURES.map(feature => <View key={feature} style={styles.chip}>
              <Feather accessible={false} name="check" size={14} color={COLORS.primaryButton} />
              <Text style={styles.chipText}>{feature}</Text>
            </View>)}</View>
          </View>
        </>}

        {showForm && <View style={styles.fields} onLayout={event => { formTop.current = event.nativeEvent.layout.y; }}>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>1단계 · 추가 정보</Text>
            <Text accessibilityRole="header" style={styles.title}>추가 정보를 입력해 주세요</Text>
          </View>
          <View onLayout={event => { fieldTops.current.affiliation = event.nativeEvent.layout.y; }}>
            <OptionSheetField<string> label="소속" value={affiliation} options={SIGNUP_AFFILIATION_OPTIONS} error={fieldErrors.affiliation}
              onChange={value => { setAffiliation(value); clearFieldError('affiliation'); }} disabled={submitting} />
          </View>
          <View style={styles.fieldGroup} onLayout={event => { fieldTops.current.email = event.nativeEvent.layout.y; }}>
            <Text style={styles.label}>이메일</Text>
            <View style={styles.emailRow}>
              <View style={styles.grow}>
                <FormInput accessibilityLabel="이메일 아이디" placeholder="아이디" value={emailLocal} error={fieldErrors.email ? ' ' : undefined}
                  onChangeText={value => { setEmailLocal(value.replace(/@.*$/, '')); clearFieldError('email'); }}
                  autoCapitalize="none" autoCorrect={false} autoComplete="username" keyboardType="email-address" editable={!submitting} />
              </View>
              <Text style={styles.emailAt}>@</Text>
              <View style={styles.grow}>
                <OptionSheetField<string> label="이메일 도메인" hideLabel value={emailDomain} options={SIGNUP_EMAIL_DOMAIN_CHOICES} placeholder="선택"
                  error={fieldErrors.email && !emailDomain ? ' ' : undefined} disabled={submitting}
                  onChange={value => { setEmailDomain(value); clearFieldError('email'); }} />
              </View>
            </View>
            {emailDomain === EMAIL_DOMAIN_DIRECT_INPUT && <FormInput accessibilityLabel="이메일 도메인 직접 입력" placeholder="example.com" value={customEmailDomain}
              onChangeText={value => { setCustomEmailDomain(value.replace(/^@/, '')); clearFieldError('email'); }}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!submitting} />}
            {fieldErrors.email && <Text accessibilityRole="alert" style={styles.fieldError}>{fieldErrors.email}</Text>}
          </View>
          <View onLayout={event => { fieldTops.current.carrier = event.nativeEvent.layout.y; }}>
            <OptionSheetField<string> label="통신사" value={carrier} options={SIGNUP_CARRIER_OPTIONS} error={fieldErrors.carrier}
              onChange={value => { setCarrier(value); clearFieldError('carrier'); }} disabled={submitting} />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>자격증 보유 현황</Text>
            <View style={styles.options}>{LICENSE_STATUS_OPTIONS.map(option => <Pressable key={option} accessibilityRole="checkbox" accessibilityState={{ checked: licenseStatuses.includes(option), disabled: submitting }} disabled={submitting}
              onPress={() => setLicenseStatuses(current => toggleLicenseStatus(current, option))} style={[styles.option, licenseStatuses.includes(option) && styles.selected]}><Text style={[styles.optionText, licenseStatuses.includes(option) && styles.optionTextSelected]}>{LICENSE_STATUS_LABELS[option]}</Text></Pressable>)}</View>
          </View>
          <View style={styles.fieldGroup} onLayout={event => { fieldTops.current.referral = event.nativeEvent.layout.y; }}>
            <Text style={styles.label}>보험 추천인 <Text style={styles.required}>(필수)</Text></Text>
            <Text style={styles.hint}>다른 제휴 서비스의 추천인과 별도로 선택해요.</Text>
            <ReferralSearchField searchQuery={searchQuery} searching={searching || validating} onChangeText={changeReferralSearch} onClear={() => changeReferralSearch('')}
              textInputProps={{ editable: !submitting, accessibilityLabel: '보험 추천인 이름 검색' }} />
            {!selectedReferral && <Text style={styles.hint}>{searchQuery.trim().length < 2 ? REFERRAL_SEARCH_MIN_CHARS_HINT : !searching && !validating && !referralError && !searchResults.length ? REFERRAL_SEARCH_EMPTY_HINT : ''}</Text>}
            {!submitting && searchResults.length > 0 && <ReferralSearchResultList results={searchResults} onSelect={item => { if (item.code) { referralEditVersion.current += 1; void validateReferral(item.code); } }} />}
            {selectedReferral && <View style={styles.selectedReferral}>
              <Feather accessible={false} name="user-check" size={18} color={COLORS.primaryButton} />
              <Text style={[styles.prepTitle, styles.grow]}>{selectedReferral.name} · {selectedReferral.affiliation}</Text>
            </View>}
          </View>
          {(referralError || fieldErrors.referral) && <Text accessibilityRole="alert" style={styles.fieldError}>{referralError ?? fieldErrors.referral}</Text>}
          {saveError && <Text accessibilityRole="alert" style={styles.failure}>{saveError}</Text>}
          <Button onPress={submitEnrollment} loading={submitting} disabled={submitting || validating || !consentAccepted} fullWidth>저장하고 신원 정보 입력</Button>
          <View style={styles.linkRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="안내로 돌아가기" disabled={submitting} onPress={() => setFormShown(false)} style={styles.link}>
              <Text style={styles.linkText}>이전</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="나중에" disabled={submitting} onPress={returnHomeLite} style={styles.link}>
              <Text style={styles.linkText}>나중에 할게요</Text>
            </Pressable>
          </View>
        </View>}
      </KeyboardAwareWrapper>

      {!showForm && <View style={styles.bottomBar}>
        <Button
          onPress={returnHomeLite}
          variant="outline"
          size="lg"
          style={styles.secondaryAction}
          accessibilityLabel="나중에"
          disabled={submitting}
        >
          나중에
        </Button>
        <Button
          onPress={startIdentityInput}
          variant="primary"
          size="lg"
          style={styles.primaryAction}
          accessibilityLabel={commonOnly ? '추가 정보 입력 시작하기' : '신원 정보 입력'}
          disabled={commonOnly && !consentAccepted}
        >
          {commonOnly ? '시작하기' : '신원 정보 입력'}
        </Button>
      </View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: { paddingHorizontal: 20, paddingTop: 12, gap: 28 },
  progress: { flexDirection: 'row', gap: 6 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: COLORS.gray[100] },
  progressBarActive: { backgroundColor: COLORS.primary },
  header: { gap: 8 },
  eyebrow: { fontSize: 13, fontWeight: '700', color: COLORS.primaryButton },
  title: { fontSize: 24, lineHeight: 33, fontWeight: '800', color: COLORS.text.primary },
  section: { gap: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text.primary },
  prepRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  prepIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primaryPale, alignItems: 'center', justifyContent: 'center' },
  prepTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text.primary },
  prepBody: { fontSize: 13, lineHeight: 19, color: COLORS.text.secondary, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: COLORS.gray[100] },
  chipText: { fontSize: 14, color: COLORS.text.primary },
  consentCard: { borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8 },
  consentCardChecked: { borderColor: COLORS.primary },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: COLORS.border.light, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: COLORS.primaryButton, borderColor: COLORS.primaryButton },
  consentText: { fontSize: 15, fontWeight: '600', color: COLORS.text.primary },
  required: { color: COLORS.primaryButton, fontWeight: '700' },
  detailToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, minHeight: 44, marginLeft: 36 },
  detailToggleText: { fontSize: 14, color: COLORS.text.secondary, textDecorationLine: 'underline' },
  consentDetail: { gap: 6, paddingBottom: 12, marginLeft: 36 },
  bottomBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.border.light, backgroundColor: COLORS.white },
  secondaryAction: { flex: 1 },
  primaryAction: { flex: 2 },
  grow: { flex: 1 },
  fields: { gap: 24 },
  fieldGroup: { gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.text.primary, marginLeft: 4 },
  hint: { fontSize: 13, lineHeight: 19, color: COLORS.text.secondary },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 12, backgroundColor: COLORS.white },
  optionText: { fontSize: 15, color: COLORS.text.primary },
  selected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale },
  optionTextSelected: { color: COLORS.primaryButton, fontWeight: '700' },
  selectedReferral: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, backgroundColor: COLORS.primaryPale },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  linkText: { fontSize: 15, color: COLORS.text.secondary, fontWeight: '600' },
  emailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  emailAt: { fontSize: 16, color: COLORS.text.secondary, lineHeight: 56 },
  fieldError: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.error, marginLeft: SPACING.xs },
  failure: { color: COLORS.error, fontSize: 14 },
});
