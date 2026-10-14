import { QueryReadState } from '@/components/QueryReadState';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { ReferralSearchField, ReferralSearchResultList, REFERRAL_SEARCH_MIN_CHARS_HINT, REFERRAL_SEARCH_EMPTY_HINT, type ReferralSearchResult } from '@/components/ReferralSearchField';
import { useDraftExitGuard } from '@/hooks/use-draft-exit-guard';
import { useLogin } from '@/hooks/use-login';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { useIdentityStatus } from '@/hooks/use-identity-status';
import { createCreationRequestTracker } from '@/lib/board-comment-request';
import { LICENSE_STATUS_LABELS, LICENSE_STATUS_NONE, LICENSE_STATUS_OPTIONS, normalizeLicenseStatuses, toggleLicenseStatus } from '@/lib/license-statuses';
import { INSURANCE_CONSENT_VERSION, platformRequest, type PlatformInsuranceEnrollment } from '@/lib/platform-api';
import { consumePendingReferralCode } from '@/lib/referral-deeplink';
import { parseSignupReferralSearchResponse } from '@/lib/referral-read-response';
import { buildStoredSignupReferral, getSignupReferralSelectionError, hasValidStoredSignupReferral } from '@/lib/signup-referral';
import { SIGNUP_AFFILIATION_OPTIONS, SIGNUP_CARRIER_OPTIONS } from '@/lib/signup-profile-options';
import { useReadAttempt } from '@/lib/use-read-attempt';
import { validateEmail, validateRequired } from '@/lib/validation';
import type { LicenseStatus } from '@/types/fc';
import { buildApplyGateIdentityRoute, buildHomeEntryBreadcrumb, normalizeApplyGateNext } from '@/lib/home-entry-flow';
import {
  authorizeNotificationOpen,
  parseNotificationOpenRoute,
} from '@/lib/notification-open-authorization';
import { markNotificationNavigationIdle } from '@/lib/notification-navigation-coordinator';
import { clearPendingNotificationNavigation } from '@/lib/pending-notification-navigation';
import { addSentryBreadcrumb } from '@/lib/sentry-monitor';
import { COLORS } from '@/lib/theme';

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
  const [affiliation, setAffiliation] = useState('');
  const [email, setEmail] = useState('');
  const [carrier, setCarrier] = useState('');
  const [licenseStatuses, setLicenseStatuses] = useState<LicenseStatus[]>([LICENSE_STATUS_NONE]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ReferralSearchResult[]>([]);
  const [selectedReferral, setSelectedReferral] = useState<ReferralSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [validating, setValidating] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const installingToken = useRef<string | null>(null);
  const referralEditVersion = useRef(0);
  const tracker = useRef(createCreationRequestTracker(randomUUID));
  const beginSearch = useReadAttempt();
  const beginSelection = useReadAttempt();
  const beginSubmit = useReadAttempt();
  const keyboardPadding = useKeyboardPadding();
  const allowExit = useDraftExitGuard(commonOnly && formShown && Boolean(affiliation || email || carrier || searchQuery), submitting);
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
      setSearchQuery(result.inviterName); setSearchResults([]);
    } catch (cause) {
      if (isCurrent()) setReferralError(cause instanceof Error ? cause.message : '추천인을 확인하지 못했습니다. 다시 선택해 주세요.');
    } finally { if (isCurrent()) setValidating(false); }
  }, [beginSelection, token]);

  useEffect(() => {
    if (pending.current && token === installingToken.current) return;
    beginSubmit(); beginSelection(); beginSearch(); pending.current = false;
    installingToken.current = null;
    tracker.current.complete(); referralEditVersion.current = 0;
    setFormShown(false); setConsentAccepted(false); setAffiliation(''); setEmail(''); setCarrier('');
    setLicenseStatuses([LICENSE_STATUS_NONE]); setSearchQuery(''); setSearchResults([]); setSelectedReferral(null);
    setSubmitting(false); setSearching(false); setValidating(false); setReferralError(null); setSaveError(null);
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

  const changeReferralSearch = (value: string) => {
    referralEditVersion.current += 1; beginSelection(); beginSearch();
    setSearchQuery(value); setSelectedReferral(null); setSearchResults([]); setValidating(false); setReferralError(null);
  };

  const submitEnrollment = async () => {
    if (!token || pending.current || !commonOnly) return;
    const referral = buildStoredSignupReferral({ selectedReferral, referralStatus: selectedReferral ? 'valid' : 'idle',
      referralInviterName: selectedReferral?.name ?? '', referralInviterFcId: selectedReferral?.fcId ?? null });
    const invalid = !consentAccepted ? '추가정보 수집·이용 동의를 확인해 주세요.'
      : validateRequired(affiliation, '소속').error ?? validateEmail(email.trim()).error ?? validateRequired(carrier, '통신사').error
      ?? getSignupReferralSelectionError(searchQuery, selectedReferral)
      ?? (validating || !hasValidStoredSignupReferral(referral) ? '유효한 보험 추천인을 선택해 주세요.' : null);
    if (invalid) { Alert.alert('입력 확인', invalid); return; }
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

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAwareWrapper contentContainerStyle={[styles.container, { paddingBottom: Math.max(80, keyboardPadding + 40) }]} keyboardDismissMode="none">
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Feather name="shield" size={20} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>추가 정보 입력 안내</Text>
          <Text style={styles.body}>모두온 계정으로 가람in을 이용합니다. 회원가입과 비밀번호 설정을 다시 하지 않습니다.</Text>
          <Text style={styles.body}>{commonOnly ? '소속·이메일·통신사·자격 상태와 보험 추천인을 확인한 뒤, 다음 단계에서 주민번호와 주소를 입력해 주세요.' : '주민번호와 주소를 입력해 주세요.'}</Text>
          <Text style={styles.body}>입력이 완료되면 설계 요청, 메신저, 공지/알림, 위촉 관련 기능을 모두 이용할 수 있습니다.</Text>
          {commonOnly && <>
            <Text style={styles.body}>수집 목적: 가람in 위촉 신청 및 등록 처리. 신청 정보는 등록 처리에 사용하며 공통 추천 관계와 보험 추천 관계는 별도로 관리합니다. 다음 신원 입력 단계에서 보관·파기 안내를 확인할 수 있습니다.</Text>
            <Pressable accessibilityRole="checkbox" accessibilityLabel="가람in 추가정보 수집·이용 동의" accessibilityState={{ checked: consentAccepted, disabled: submitting }} disabled={submitting}
              onPress={() => setConsentAccepted(value => !value)} style={styles.consent}>
              <Feather accessible={false} name={consentAccepted ? 'check-square' : 'square'} size={22} color={COLORS.primary} />
              <Text style={[styles.body, styles.grow]}>[필수] 가람in 추가정보 수집·이용에 동의합니다.</Text>
            </Pressable>
          </>}
        </View>

        {commonOnly && formShown && <View style={styles.fields}>
          <Text accessibilityRole="header" style={styles.title}>가람in 추가 등록</Text>
          <Text style={styles.body}>{platformMember?.name}님의 공통 가입 정보를 사용합니다.</Text>
          <Text style={styles.label}>소속</Text>
          <View style={styles.options}>{SIGNUP_AFFILIATION_OPTIONS.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: affiliation === option, disabled: submitting }} disabled={submitting}
            onPress={() => setAffiliation(option)} style={[styles.option, affiliation === option && styles.selected]}><Text style={styles.body}>{option}</Text></Pressable>)}</View>
          <FormInput label="이메일" accessibilityLabel="이메일" placeholder="이메일 주소" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" editable={!submitting} />
          <Text style={styles.label}>통신사</Text>
          <View style={styles.options}>{SIGNUP_CARRIER_OPTIONS.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: carrier === option, disabled: submitting }} disabled={submitting}
            onPress={() => setCarrier(option)} style={[styles.option, carrier === option && styles.selected]}><Text style={styles.body}>{option}</Text></Pressable>)}</View>
          <Text style={styles.label}>자격증 보유 현황</Text>
          <View style={styles.options}>{LICENSE_STATUS_OPTIONS.map(option => <Pressable key={option} accessibilityRole="checkbox" accessibilityState={{ checked: licenseStatuses.includes(option), disabled: submitting }} disabled={submitting}
            onPress={() => setLicenseStatuses(current => toggleLicenseStatus(current, option))} style={[styles.option, licenseStatuses.includes(option) && styles.selected]}><Text style={styles.body}>{LICENSE_STATUS_LABELS[option]}</Text></Pressable>)}</View>
          <Text style={styles.label}>보험 추천인 (필수)</Text>
          <Text style={styles.body}>공통 추천인과 별도로 선택합니다.</Text>
          <ReferralSearchField searchQuery={searchQuery} searching={searching || validating} onChangeText={changeReferralSearch} onClear={() => changeReferralSearch('')}
            textInputProps={{ editable: !submitting, accessibilityLabel: '보험 추천인 이름 검색' }} />
          {!selectedReferral && <Text style={styles.body}>{searchQuery.trim().length < 2 ? REFERRAL_SEARCH_MIN_CHARS_HINT : !searching && !validating && !referralError && !searchResults.length ? REFERRAL_SEARCH_EMPTY_HINT : ''}</Text>}
          {!submitting && searchResults.length > 0 && <ReferralSearchResultList results={searchResults} onSelect={item => { if (item.code) { referralEditVersion.current += 1; void validateReferral(item.code); } }} />}
          {selectedReferral && <Text style={styles.body}>선택한 보험 추천인: {selectedReferral.name} · {selectedReferral.affiliation}</Text>}
          {referralError && <Text accessibilityRole="alert" style={styles.failure}>{referralError}</Text>}
          {saveError && <Text accessibilityRole="alert" style={styles.failure}>{saveError}</Text>}
          <Button onPress={submitEnrollment} loading={submitting} disabled={submitting || validating || !consentAccepted} fullWidth>추가 등록 확정 후 신원 정보 입력</Button>
        </View>}

        <View style={styles.buttonRow}>
          <Button
            onPress={returnHomeLite}
            variant="outline"
            size="md"
            style={styles.button}
            accessibilityLabel="나중에"
            disabled={submitting}
          >
            나중에
          </Button>
          {(!commonOnly || !formShown) && <Button
            onPress={startIdentityInput}
            variant="primary"
            size="md"
            style={styles.button}
            accessibilityLabel="추가 정보 입력 시작"
            disabled={commonOnly && !consentAccepted}
          >
            추가 정보 입력 시작
          </Button>}
        </View>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 20, gap: 20 },
  card: {
    backgroundColor: '#fff7f0',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#fed7aa',
    gap: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.text.primary },
  body: { fontSize: 14, color: COLORS.text.secondary, lineHeight: 20 },
  buttonRow: { flexDirection: 'row', gap: 12 },
  button: {
    flex: 1,
  },
  fields: { gap: 12 },
  label: { fontSize: 15, fontWeight: '700', color: COLORS.text.primary },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 44, justifyContent: 'center', padding: 12, borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 12 },
  selected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  grow: { flex: 1 },
  failure: { color: COLORS.error, fontSize: 14 },
});
