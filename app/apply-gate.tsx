import { QueryReadState } from '@/components/QueryReadState';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { KeyboardAwareWrapper, type KeyboardAwareWrapperHandle } from '@/components/KeyboardAwareWrapper';
import { ReferralSearchField, ReferralSearchResultList, REFERRAL_SEARCH_MIN_CHARS_HINT, REFERRAL_SEARCH_EMPTY_HINT, type ReferralSearchResult } from '@/components/ReferralSearchField';
import {
  StackButton,
  StackDockedNext,
  StackField,
  StackItem,
  StackLabel,
  StackSelectValue,
  StackSheet,
  StackSheetOption,
  StackSubmit,
  stackFormStyles,
} from '@/components/StackedForm';
import { useDraftExitGuard } from '@/hooks/use-draft-exit-guard';
import { useLogin } from '@/hooks/use-login';
import { useKeyboardPadding, useKeyboardVisible } from '@/hooks/use-keyboard-padding';
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
import { advanceStackReveal, getStackOrder, INSURANCE_ENROLLMENT_STEPS, SIGNUP_MOTION, type InsuranceEnrollmentStep } from '@/lib/signup-steps';
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
import { resetTo, returnTo } from '@/lib/back-navigation';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
// The last item is the only step for an existing FC without identity data.
const PREPARATION_ITEMS: { icon: FeatherName; title: string }[] = [
  { icon: 'briefcase', title: '소속 · 이메일 · 통신사' },
  { icon: 'award', title: '자격증 보유 현황' },
  { icon: 'user-check', title: '보험 추천인' },
  { icon: 'shield', title: '주민번호 · 주소' },
];
const UNLOCKED_FEATURES = ['설계 요청', '메신저', '공지·알림', '위촉 진행'];
type EnrollmentSheet = 'affiliation' | 'carrier' | 'license' | 'domain';
const ENROLLMENT_SHEET_TITLES: Record<EnrollmentSheet, string> = {
  affiliation: '소속을 선택해 주세요',
  carrier: '통신사를 선택해 주세요',
  license: '보유한 자격증을 선택해 주세요',
  domain: '이메일 주소를 선택해 주세요',
};
type TypingField = 'emailLocal' | 'customDomain' | 'referral';

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
  const keyboardVisible = useKeyboardVisible();
  const insets = useSafeAreaInsets();
  const [revealed, setRevealed] = useState(1);
  const revealedRef = useRef(1);
  const [sheet, setSheet] = useState<EnrollmentSheet | null>(null);
  const [focusedField, setFocusedField] = useState<TypingField | null>(null);
  const emailLocalRef = useRef<TextInput>(null);
  const customDomainRef = useRef<TextInput>(null);
  const referralInputRef = useRef<TextInput>(null);
  // An invitation fills the referrer search by itself; only a search the user changed is a draft.
  const allowExit = useDraftExitGuard(commonOnly && formShown && Boolean(affiliation || emailLocal || emailDomain || carrier || (searchQuery && referralEditVersion.current > 0)), submitting);
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
        // A network or session hiccup is not proof the target is gone.
        router.replace(authorization.reason === 'request_failed' ? '/notifications' : '/notifications?targetError=unavailable');
        return;
      }
    }
    router.replace(safeNext as Href);
  }, [safeNext]);

  useEffect(() => {
    if (!hydrated || !platformHydrated) return;
    if (!isPlatformSignedIn) {
      resetTo(router, '/services/login?service=insurance');
      return;
    }
    if (role === 'admin') {
      returnTo(router, '/');
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
    returnTo(router, '/');
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
    revealedRef.current = 1; setRevealed(1); setSheet(null); setFocusedField(null);
  }, [token, beginSubmit, beginSelection, beginSearch]);

  /** Reveals the next question when the newest one was answered; editing an earlier answer keeps the stack. */
  const advance = useCallback((answered: InsuranceEnrollmentStep) => {
    const next = advanceStackReveal(INSURANCE_ENROLLMENT_STEPS, revealedRef.current, answered);
    revealedRef.current = next.revealed;
    setRevealed(next.revealed);
    return next.advanced;
  }, []);

  const focusAfterInsert = (ref: { current: TextInput | null }) => {
    setTimeout(() => ref.current?.focus(), SIGNUP_MOTION.focusDelay);
  };

  const openSheet = (next: EnrollmentSheet) => {
    Keyboard.dismiss();
    setFocusedField(null);
    setSheet(next);
  };

  // The form opens on its first question, like the reference's picker-first step.
  useEffect(() => {
    if (formShown && revealedRef.current === 1 && !affiliation) setSheet('affiliation');
    if (!formShown) setSheet(null);
  }, [formShown, affiliation]);

  /** A picked option stays highlighted briefly, then the same sheet moves on to the next picker. */
  const pickAndContinue = (answered: InsuranceEnrollmentStep, nextSheet: EnrollmentSheet | null) => {
    setTimeout(() => setSheet(advance(answered) ? nextSheet : null), SIGNUP_MOTION.pickHold);
  };

  const finishLicense = () => {
    setSheet(null);
    if (advance('license')) focusAfterInsert(emailLocalRef);
  };

  const pickDomain = (domain: string) => {
    setEmailDomain(domain); clearFieldError('email');
    setTimeout(() => {
      setSheet(null);
      if (domain === EMAIL_DOMAIN_DIRECT_INPUT) setTimeout(() => customDomainRef.current?.focus(), SIGNUP_MOTION.sheet);
      else if (advance('email')) focusAfterInsert(referralInputRef);
    }, SIGNUP_MOTION.pickHold);
  };

  const emailLocalNext = () => {
    if (!emailDomain) openSheet('domain');
    else if (emailDomain === EMAIL_DOMAIN_DIRECT_INPUT) customDomainRef.current?.focus();
    else if (advance('email')) focusAfterInsert(referralInputRef);
    else Keyboard.dismiss();
  };

  const customDomainNext = () => {
    if (advance('email')) focusAfterInsert(referralInputRef);
    else Keyboard.dismiss();
  };

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
  // Web reports no keyboard events, so the bar follows focus there.
  const typingVisible = (keyboardVisible || Platform.OS === 'web') && !sheet;
  const isTyping = (field: TypingField) => focusedField === field && typingVisible;
  const dockedActions: Partial<Record<TypingField, { ready: boolean; onPress: () => void }>> = {
    emailLocal: { ready: Boolean(emailLocal), onPress: emailLocalNext },
    customDomain: { ready: Boolean(customEmailDomain), onPress: customDomainNext },
  };
  const docked = focusedField && typingVisible ? dockedActions[focusedField] : undefined;
  const allRevealed = revealed >= INSURANCE_ENROLLMENT_STEPS.length;
  const licenseSummary = normalizeLicenseStatuses(licenseStatuses).map(status => LICENSE_STATUS_LABELS[status]).join(', ');
  const typingProps = (field: TypingField) => ({
    onFocus: () => setFocusedField(field),
    editable: !submitting,
    scrollEnabled: false,
    placeholderTextColor: COLORS.text.muted,
  });

  const renderStep = (step: InsuranceEnrollmentStep) => {
    switch (step) {
      case 'affiliation':
        return (
          <StackField label="소속" active={sheet === 'affiliation'} error={fieldErrors.affiliation}>
            <StackSelectValue value={affiliation} placeholder="소속 선택" accessibilityLabel={`소속 선택, ${affiliation || '미선택'}`} onPress={() => openSheet('affiliation')} />
          </StackField>
        );
      case 'carrier':
        return (
          <StackField label="통신사" active={sheet === 'carrier'} error={fieldErrors.carrier}>
            <StackSelectValue value={carrier} placeholder="통신사 선택" accessibilityLabel={`통신사 선택, ${carrier || '미선택'}`} onPress={() => openSheet('carrier')} />
          </StackField>
        );
      case 'license':
        return (
          <StackField label="자격증 보유 현황" active={sheet === 'license'}>
            <StackSelectValue value={licenseSummary} placeholder="자격증 선택" accessibilityLabel={`자격증 보유 현황, ${licenseSummary}`} onPress={() => openSheet('license')} />
          </StackField>
        );
      case 'email':
        return (
          <StackField label="이메일" active={isTyping('emailLocal') || isTyping('customDomain') || sheet === 'domain'} error={fieldErrors.email}>
            <View style={styles.emailRow}>
              <TextInput ref={emailLocalRef} {...typingProps('emailLocal')} style={[stackFormStyles.input, styles.grow]} accessibilityLabel="이메일 아이디" placeholder="아이디"
                value={emailLocal} onChangeText={value => { setEmailLocal(value.replace(/@.*$/, '')); clearFieldError('email'); }}
                autoCapitalize="none" autoCorrect={false} autoComplete="username" keyboardType="email-address" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={emailLocalNext} />
              <Text style={styles.emailAt}>@</Text>
              {emailDomain === EMAIL_DOMAIN_DIRECT_INPUT ? (
                <TextInput ref={customDomainRef} {...typingProps('customDomain')} style={[stackFormStyles.input, styles.grow]} accessibilityLabel="이메일 도메인 직접 입력" placeholder="example.com"
                  value={customEmailDomain} onChangeText={value => { setCustomEmailDomain(value.replace(/^@/, '')); clearFieldError('email'); }}
                  autoCapitalize="none" autoCorrect={false} keyboardType="email-address" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={customDomainNext} />
              ) : (
                <View style={styles.grow}>
                  <StackSelectValue value={emailDomain} placeholder="선택" accessibilityLabel={`이메일 도메인 선택, ${emailDomain || '미선택'}`} onPress={() => openSheet('domain')} />
                </View>
              )}
            </View>
          </StackField>
        );
      case 'referral':
        return (
          <View style={styles.fieldGroup}>
            <StackLabel>보험 추천인 (필수)</StackLabel>
            <Text style={styles.hint}>다른 제휴 서비스의 추천인과 별도로 선택해요.</Text>
            <ReferralSearchField inputRef={referralInputRef} searchQuery={searchQuery} searching={searching || validating} onChangeText={changeReferralSearch} onClear={() => changeReferralSearch('')}
              textInputProps={{ ...typingProps('referral'), accessibilityLabel: '보험 추천인 이름 검색' }} />
            {!selectedReferral && <Text style={styles.hint}>{searchQuery.trim().length < 2 ? REFERRAL_SEARCH_MIN_CHARS_HINT : !searching && !validating && !referralError && !searchResults.length ? REFERRAL_SEARCH_EMPTY_HINT : ''}</Text>}
            {!submitting && searchResults.length > 0 && <ReferralSearchResultList results={searchResults} onSelect={item => { if (item.code) { Keyboard.dismiss(); referralEditVersion.current += 1; void validateReferral(item.code); } }} />}
            {selectedReferral && <View style={styles.selectedReferral}>
              <Feather accessible={false} name="user-check" size={18} color={COLORS.primaryButton} />
              <Text style={[styles.prepTitle, styles.grow]}>{selectedReferral.name} · {selectedReferral.affiliation}</Text>
            </View>}
            {(referralError || fieldErrors.referral) && <Text accessibilityRole="alert" style={styles.fieldError}>{referralError ?? fieldErrors.referral}</Text>}
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <KeyboardAwareWrapper handleRef={scrollHandle} contentContainerStyle={[styles.container, { paddingBottom: Math.max(showForm ? 120 : 32, keyboardPadding + 40) }]} keyboardDismissMode="none" keyboardShouldPersistTaps="handled">
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
          <View style={stackFormStyles.content}>
            <LayoutAnimationConfig skipEntering>
              {getStackOrder(INSURANCE_ENROLLMENT_STEPS, revealed).map(step => (
                <StackItem key={step}>
                  <View onLayout={event => { fieldTops.current[step as EnrollmentField] = event.nativeEvent.layout.y; }}>{renderStep(step)}</View>
                </StackItem>
              ))}
            </LayoutAnimationConfig>
          </View>
          {saveError && <Text accessibilityRole="alert" style={styles.failure}>{saveError}</Text>}
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

      {showForm && docked?.ready ? <StackDockedNext onPress={docked.onPress} /> : null}
      {showForm && allRevealed && !sheet && !keyboardVisible ? (
        <StackSubmit label={submitting ? '저장하는 중...' : '저장하고 신원 정보 입력'} disabled={submitting || validating || !consentAccepted} onPress={() => { void submitEnrollment(); }} />
      ) : null}

      {!showForm && <View style={[styles.bottomBar, { paddingBottom: 12 + insets.bottom }]}>
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
      <StackSheet
        contentKey={showForm ? sheet : null}
        title={sheet ? ENROLLMENT_SHEET_TITLES[sheet] : ''}
        onClose={() => setSheet(null)}
        footer={sheet === 'license' ? <StackButton label="선택 완료" onPress={finishLicense} /> : null}
      >
        {sheet === 'affiliation' && SIGNUP_AFFILIATION_OPTIONS.map(option => (
          <StackSheetOption key={option} label={option} selected={affiliation === option}
            onPress={() => { setAffiliation(option); clearFieldError('affiliation'); pickAndContinue('affiliation', 'carrier'); }} />
        ))}
        {sheet === 'carrier' && SIGNUP_CARRIER_OPTIONS.map(option => (
          <StackSheetOption key={option} label={option} selected={carrier === option}
            onPress={() => { setCarrier(option); clearFieldError('carrier'); pickAndContinue('carrier', 'license'); }} />
        ))}
        {sheet === 'license' && LICENSE_STATUS_OPTIONS.map(option => (
          <StackSheetOption key={option} label={LICENSE_STATUS_LABELS[option]} multiple selected={licenseStatuses.includes(option)}
            onPress={() => setLicenseStatuses(current => toggleLicenseStatus(current, option))} />
        ))}
        {sheet === 'domain' && SIGNUP_EMAIL_DOMAIN_CHOICES.map(option => (
          <StackSheetOption key={option} label={option} selected={emailDomain === option} onPress={() => pickDomain(option)} />
        ))}
      </StackSheet>
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
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emailAt: { fontSize: 16, color: COLORS.text.secondary },
  fieldError: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.error, marginLeft: SPACING.xs },
  failure: { color: COLORS.error, fontSize: 14 },
});
