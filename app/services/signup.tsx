import { Feather } from '@expo/vector-icons';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import ModuonBrand from '@/components/ModuonBrand';
import { useSession } from '@/hooks/use-session';
import { useDraftExitGuard } from '@/hooks/use-draft-exit-guard';
import { PLATFORM_CONSENT_TEXT, PLATFORM_PRIVACY_POLICY_URL, PLATFORM_TERMS_VERSION, PlatformApiError, platformRequest, type PlatformAuthResponse } from '@/lib/platform-api';
import { openExternalUrl } from '@/lib/open-external-url';
import { consumePendingReferralCode, normalizeReferralInviteCode } from '@/lib/referral-deeplink';
import { captureAppSessionOwner } from '@/lib/request-board-api';
import { COLORS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { resolvePlatformAuthRoute, resolveSessionLandingRoute } from '@/lib/session-landing';
import { useReadAttempt } from '@/lib/use-read-attempt';
import { normalizePhone, validatePassword, validatePhone, validateRequired } from '@/lib/validation';

export default function PlatformSignup() {
  const { service, code: invitationCode, referralNonce } = useLocalSearchParams<{ service?: string; code?: string; referralNonce?: string }>();
  const { hydrated, role, residentId, isRequestBoardDesigner, isPlatformSignedIn, loginPlatformMember } = useSession();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [loading, setLoading] = useState<'otp' | 'signup' | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [otpError, setOtpError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const referralEdited = useRef(false);
  const beginAttempt = useReadAttempt();
  const allowCompletedExit = useDraftExitGuard(Boolean(name || phone || code || password || referralCode || termsAccepted), Boolean(loading));

  useEffect(() => {
    let active = true;
    const ownsSession = captureAppSessionOwner();
    const loadReferralInvite = async () => {
      const explicitCode = normalizeReferralInviteCode(invitationCode);
      if (!isPlatformSignedIn && invitationCode !== undefined) setReferralCode(explicitCode ?? '');
      // Common membership never consumes an insurance-only invitation.
      const savedCode = await consumePendingReferralCode('care').catch(() => null);
      if (!active || !ownsSession() || isPlatformSignedIn || invitationCode !== undefined || referralEdited.current) return;
      if (savedCode) setReferralCode(savedCode);
    };
    void loadReferralInvite();
    return () => { active = false; };
  }, [invitationCode, referralNonce, isPlatformSignedIn]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async (action: 'otp' | 'signup') => {
    if (pending.current || (action === 'otp' && cooldown > 0)) return;
    const validations = [validatePhone(phone), ...(action === 'signup'
      ? [validateRequired(name, '이름'), validatePassword(password)] : [])];
    const invalid = validations.find(value => !value.isValid);
    if (invalid) {
      const message = invalid.error ?? '입력 내용을 확인해주세요.';
      if (action === 'otp') setOtpError(message); else setError(message);
      return;
    }
    if (action === 'signup') {
      if (!/^\d{6}$/.test(code.trim())) { setError('문자로 받은 6자리 인증 코드를 입력해주세요.'); return; }
      if (password.trim() !== confirmation.trim()) { setError('비밀번호가 일치하지 않습니다.'); return; }
      if (!termsAccepted) { setError('필수 동의 내용을 확인해주세요.'); return; }
    }
    Keyboard.dismiss();
    pending.current = true;
    setLoading(action);
    if (action === 'otp') setOtpError(''); else setError('');
    setNotice('');
    const isCurrent = beginAttempt();
    const ownsSession = captureAppSessionOwner();
    try {
      if (action === 'otp') {
        await platformRequest('request_otp', { phone: normalizePhone(phone) });
        if (!isCurrent() || !ownsSession()) return;
        setCooldown(60);
        setNotice('인증 문자 발송 요청이 접수되었습니다.');
      } else {
        const result = await platformRequest<PlatformAuthResponse>('signup', {
          phone: normalizePhone(phone), code: code.trim(), name: name.trim(), password: password.trim(),
          termsAccepted: true, termsVersion: PLATFORM_TERMS_VERSION, ...(referralCode.trim() ? { referralCode: referralCode.trim().toUpperCase() } : {}),
        });
        if (!isCurrent() || !ownsSession()) return;
        if (result.insuranceSession) throw new Error('이미 가입한 보험·FC 계정으로 로그인해 주세요.');
        allowCompletedExit();
        await loginPlatformMember({ id: result.memberId, name: result.displayName }, result.appSessionToken);
        if (isCurrent()) {
          const route = resolveSessionLandingRoute({ role: null, residentId: '',
            isRequestBoardDesigner: false, isPlatformSignedIn: true, requestedService: service })!;
          if (route === '/services/account') router.dismissTo(route);
          else router.replace(route);
        }
      }
    } catch (failure) {
      if (isCurrent()) {
        const message = failure instanceof Error ? failure.message : '처리하지 못했습니다. 입력 내용을 유지했으니 다시 시도해주세요.';
        if (action === 'otp') {
          const ambiguousDelivery = failure instanceof PlatformApiError
            && ['request_timeout','sms_delivery_unknown'].includes(failure.code);
          const throttleSeconds = failure instanceof PlatformApiError && failure.code === 'locked'
            ? 600
            : failure instanceof PlatformApiError && failure.code === 'cooldown'
              ? 60
              : ambiguousDelivery ? 60 : 0;
          if (throttleSeconds > 0) setCooldown(throttleSeconds);
          setOtpError(ambiguousDelivery
            ? '요청 결과를 확인하지 못했습니다. 문자가 오면 인증번호를 입력하고, 오지 않으면 60초 후 다시 요청해 주세요.'
            : message);
        } else setError(message);
      }
    } finally {
      if (isCurrent()) { pending.current = false; setLoading(null); }
    }
  };

  const signedLanding = resolveSessionLandingRoute({ role, residentId, isRequestBoardDesigner,
    isPlatformSignedIn, requestedService: service });
  const returnToAccount = hydrated && signedLanding === '/services/account';
  useEffect(() => {
    if (returnToAccount) router.dismissTo('/services/account');
  }, [returnToAccount]);
  if (hydrated && signedLanding) return returnToAccount ? null : <Redirect href={signedLanding} />;

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false, title: '모두온 회원가입' }} />
      <View style={styles.header}>
        <Pressable accessibilityState={{ disabled: Boolean(loading) }} accessibilityRole="button" accessibilityLabel="모두온 로그인으로 돌아가기"
          disabled={Boolean(loading)} onPress={() => router.replace(resolvePlatformAuthRoute(service, 'login'))} style={styles.back}>
          <Feather name="arrow-left" size={24} color={COLORS.text.primary} />
        </Pressable>
        <ModuonBrand />
      </View>
      <KeyboardAwareWrapper contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>처음에는{`\n`}기본 정보만 입력하세요</Text>
        <Text style={styles.description}>한 번 가입하면 여러 서비스를 이용할 수 있어요.{`\n`}추가 정보는 해당 서비스를 신청할 때 입력합니다.</Text>
        <FormInput label="이름" accessibilityLabel="이름" value={name} onChangeText={setName}
          editable={!loading} autoComplete="name" maxLength={50} containerStyle={styles.field} />
        <FormInput label="휴대폰 번호" accessibilityLabel="휴대폰 번호" value={phone}
          onChangeText={value => { setPhone(value); setCode(''); setCooldown(0); setNotice(''); setOtpError(''); }} keyboardType="phone-pad" autoComplete="tel"
          placeholder="010으로 시작하는 11자리" editable={!loading} containerStyle={styles.field} />
        <Button onPress={() => submit('otp')} variant="outline" loading={loading === 'otp'}
          disabled={Boolean(loading) || cooldown > 0 || !hydrated} fullWidth>
          {cooldown ? `${cooldown}초 후 다시 받기` : '인증 코드 받기'}
        </Button>
        {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
        {otpError ? <Text accessibilityRole="alert" style={styles.otpError}>{otpError}</Text> : null}
        <FormInput label="인증 코드" accessibilityLabel="인증 코드" value={code} onChangeText={setCode}
          keyboardType="number-pad" autoComplete="sms-otp" maxLength={6} placeholder="문자로 받은 6자리"
          editable={!loading} containerStyle={styles.codeField} />
        <FormInput label="비밀번호" accessibilityLabel="비밀번호" value={password} onChangeText={setPassword}
          variant="password" autoCapitalize="none" placeholder="8자 이상, 영문·숫자·특수문자"
          editable={!loading} containerStyle={styles.field} />
        <FormInput label="비밀번호 확인" accessibilityLabel="비밀번호 확인" value={confirmation}
          onChangeText={setConfirmation} variant="password" autoCapitalize="none" editable={!loading} containerStyle={styles.field} />
        <FormInput label="추천 코드 (선택)" accessibilityLabel="추천 코드 선택" value={referralCode}
          onChangeText={value => { referralEdited.current = true; setReferralCode(value); }} autoCapitalize="characters" editable={!loading} containerStyle={styles.field} />
        <Text style={styles.detail}>추천 관계는 모든 제휴 서비스에서 함께 사용됩니다.</Text>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="필수 회원가입 및 개인정보 수집 이용 동의"
          accessibilityState={{ checked: termsAccepted }} disabled={Boolean(loading)}
          onPress={() => setTermsAccepted(value => !value)} style={styles.consent}>
          <Feather name={termsAccepted ? 'check-square' : 'square'} size={22} color={termsAccepted ? COLORS.primary : COLORS.gray[500]} />
          <Text style={styles.consentText}>[필수] 회원가입 및 개인정보 수집·이용에 동의합니다.</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showConsent }} onPress={() => setShowConsent(value => !value)} style={styles.consent}>
          <Text style={styles.detailLink}>수집·이용 내용 확인</Text>
          <Feather name={showConsent ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.text.secondary} />
        </Pressable>
        {showConsent ? <>
          <Text style={styles.detail}>{PLATFORM_CONSENT_TEXT}</Text>
          <Pressable accessibilityRole="link" onPress={() => { void openExternalUrl(PLATFORM_PRIVACY_POLICY_URL).catch(() => setError('개인정보처리방침을 열지 못했습니다. 다시 시도해주세요.')); }} style={styles.link}>
            <Text style={styles.detailLink}>개인정보처리방침</Text>
          </Pressable>
        </> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Button onPress={() => submit('signup')} loading={loading === 'signup'}
          disabled={Boolean(loading) || !hydrated} fullWidth>회원가입 완료</Button>
        <Pressable accessibilityRole="button" disabled={Boolean(loading)} onPress={() => router.replace(resolvePlatformAuthRoute(service, 'login'))} style={styles.link}>
          <Text style={styles.linkText}>이미 계정이 있어요</Text>
        </Pressable>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.base },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center', padding: SPACING.lg, paddingTop: SPACING['2xl'], paddingBottom: 60 },
  title: { fontSize: TYPOGRAPHY.fontSize['2xl'], fontWeight: '700', color: COLORS.text.primary, lineHeight: 34 },
  description: { fontSize: TYPOGRAPHY.fontSize.base, color: COLORS.text.secondary, lineHeight: 23, marginTop: SPACING.sm, marginBottom: SPACING['2xl'] },
  field: { marginBottom: SPACING.lg },
  codeField: { marginTop: SPACING.lg, marginBottom: SPACING.lg },
  notice: { color: COLORS.text.secondary, fontSize: TYPOGRAPHY.fontSize.sm, marginTop: SPACING.sm },
  otpError: { color: COLORS.error, fontSize: TYPOGRAPHY.fontSize.sm, lineHeight: 20, marginTop: SPACING.sm },
  detail: { color: COLORS.text.secondary, fontSize: TYPOGRAPHY.fontSize.sm, lineHeight: 20, marginBottom: SPACING.lg },
  detailLink: { color: COLORS.text.secondary, fontSize: TYPOGRAPHY.fontSize.sm, textDecorationLine: 'underline' },
  consent: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', minHeight: 44, marginBottom: SPACING.sm },
  consentText: { flex: 1, color: COLORS.text.primary, fontSize: TYPOGRAPHY.fontSize.sm, lineHeight: 20 },
  error: { color: COLORS.error, fontSize: TYPOGRAPHY.fontSize.sm, lineHeight: 20, marginBottom: SPACING.base },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.sm },
  linkText: { color: COLORS.text.secondary, fontSize: TYPOGRAPHY.fontSize.base, textDecorationLine: 'underline' },
});
