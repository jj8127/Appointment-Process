import { Feather } from '@expo/vector-icons';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import ModuonBrand from '@/components/ModuonBrand';
import {
  StackButton,
  StackDockedNext,
  StackField,
  StackItem,
  StackSheet,
  StackSubmit,
  stackFormStyles,
} from '@/components/StackedForm';
import { useKeyboardVisible } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { useDraftExitGuard } from '@/hooks/use-draft-exit-guard';
import { PLATFORM_CONSENT_TEXT, PLATFORM_PRIVACY_POLICY_URL, PLATFORM_TERMS_VERSION, PlatformApiError, platformRequest, type PlatformAuthResponse } from '@/lib/platform-api';
import { openExternalUrl } from '@/lib/open-external-url';
import { consumePendingReferralCode } from '@/lib/referral-deeplink';
import { captureAppSessionOwner } from '@/lib/request-board-api';
import { COLORS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { resolvePlatformAuthRoute } from '@/lib/session-landing';
import { advanceStackReveal, getStackOrder, PLATFORM_SIGNUP_STEPS, SIGNUP_MOTION, type PlatformSignupStep } from '@/lib/signup-steps';
import { useReadAttempt } from '@/lib/use-read-attempt';
import { isValidMobilePhone, normalizePhone, validatePassword, validatePhone, validateRequired } from '@/lib/validation';

type DockedAction = { label: string; ready: boolean; disabled?: boolean; onPress: () => void };

export default function PlatformSignup() {
  const { service, code: invitationCode } = useLocalSearchParams<{ service?: string; code?: string }>();
  const { hydrated, isPlatformSignedIn, loginPlatformMember } = useSession();
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
  const [revealed, setRevealed] = useState(1);
  const [focusedField, setFocusedField] = useState<PlatformSignupStep | null>('name');
  const [stepError, setStepError] = useState('');
  const [showTerms, setShowTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [codeChecking, setCodeChecking] = useState(false);
  const [codeVerified, setCodeVerified] = useState(false);
  const [codeError, setCodeError] = useState('');
  const codeCheckRef = useRef(0);
  const revealedRef = useRef(1);
  const inputRefs = useRef<Partial<Record<PlatformSignupStep, TextInput | null>>>({});
  const keyboardVisible = useKeyboardVisible();
  const pending = useRef(false);
  const referralEdited = useRef(false);
  const beginAttempt = useReadAttempt();
  const allowCompletedExit = useDraftExitGuard(Boolean(name || phone || code || password || referralCode || termsAccepted), Boolean(loading));

  useEffect(() => {
    if (typeof invitationCode === 'string' && invitationCode.trim()) {
      setReferralCode(invitationCode.trim().toUpperCase());
      return;
    }
    let active = true;
    void consumePendingReferralCode().then(value => {
      if (active && value && !referralEdited.current) setReferralCode(value);
    }).catch(() => { /* Optional invitation recovery does not block signup. */ });
    return () => { active = false; };
  }, [invitationCode]);

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
        if (isCurrent()) router.replace(resolvePlatformAuthRoute(service));
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

  /** Reveals the next question when the newest one was answered and moves the caret there. */
  const advance = useCallback((answered: PlatformSignupStep) => {
    const next = advanceStackReveal(PLATFORM_SIGNUP_STEPS, revealedRef.current, answered);
    revealedRef.current = next.revealed;
    setRevealed(next.revealed);
    setStepError('');
    if (next.advanced) {
      const target = PLATFORM_SIGNUP_STEPS[next.revealed - 1];
      setTimeout(() => inputRefs.current[target]?.focus(), SIGNUP_MOTION.focusDelay);
    }
    return next.advanced;
  }, []);

  // A sent code (the only path that sets this notice) opens the code question, like an ambiguous delivery that may still arrive.
  useEffect(() => {
    if (notice || otpError.startsWith('요청 결과를 확인하지 못했습니다')) advance('phone');
  }, [advance, notice, otpError]);

  /** Confirms the SMS code on its own step; the final signup checks the same code again. */
  const verifyCode = async (value: string) => {
    if (!/^\d{6}$/.test(value)) { setCodeError('문자로 받은 6자리 인증 코드를 입력해주세요.'); return; }
    const requestId = ++codeCheckRef.current;
    setCodeChecking(true);
    setCodeError('');
    try {
      await platformRequest('check_signup_otp', { phone: normalizePhone(phone), code: value });
      if (requestId !== codeCheckRef.current) return;
      setCodeVerified(true);
      advance('code');
    } catch (failure) {
      if (requestId === codeCheckRef.current) setCodeError(failure instanceof Error ? failure.message : '인증 코드를 확인하지 못했습니다.');
    } finally {
      if (requestId === codeCheckRef.current) setCodeChecking(false);
    }
  };

  const handleCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    codeCheckRef.current += 1;
    setCode(digits);
    setCodeVerified(false);
    setCodeChecking(false);
    setCodeError('');
    // Six digits confirm on their own, like the reference's auto-advance.
    if (digits.length === 6) void verifyCode(digits);
  };

  const openTerms = () => {
    Keyboard.dismiss();
    setFocusedField(null);
    setError('');
    setShowTerms(true);
  };

  const dockedAction = (field: PlatformSignupStep): DockedAction | null => {
    switch (field) {
      case 'name':
        return { label: '다음', ready: Boolean(name.trim()), onPress: () => advance('name') };
      case 'phone':
        return {
          label: cooldown ? `${cooldown}초 후 다시 받기` : '인증 코드 받기',
          ready: isValidMobilePhone(phone),
          disabled: cooldown > 0 || Boolean(loading) || !hydrated,
          onPress: () => { void submit('otp'); },
        };
      case 'code':
        return {
          label: codeChecking ? '확인 중...' : '확인',
          ready: Boolean(code) && !codeVerified,
          disabled: codeChecking,
          onPress: () => { void verifyCode(code); },
        };
      case 'password':
        return {
          label: '다음',
          ready: Boolean(password),
          onPress: () => {
            const result = validatePassword(password);
            if (!result.isValid) { setStepError(result.error ?? '비밀번호를 확인해주세요.'); return; }
            advance('password');
          },
        };
      case 'confirmation':
        return {
          label: '다음',
          ready: Boolean(confirmation),
          onPress: () => {
            if (password.trim() !== confirmation.trim()) { setStepError('비밀번호가 일치하지 않습니다.'); return; }
            advance('confirmation');
          },
        };
      case 'referral':
        return { label: referralCode.trim() ? '다음' : '건너뛰기', ready: true, onPress: openTerms };
    }
  };

  const inputProps = (field: PlatformSignupStep) => ({
    ref: (input: TextInput | null) => { inputRefs.current[field] = input; },
    onFocus: () => setFocusedField(field),
    editable: !loading,
    scrollEnabled: false,
    placeholderTextColor: COLORS.text.muted,
    style: stackFormStyles.input,
  });

  if (hydrated && isPlatformSignedIn) return <Redirect href={resolvePlatformAuthRoute(service)} />;

  // Web reports no keyboard events, so the bar follows focus there.
  const typingVisible = (keyboardVisible || Platform.OS === 'web') && !showTerms;
  const isTyping = (field: PlatformSignupStep) => focusedField === field && typingVisible;
  const docked = focusedField && typingVisible ? dockedAction(focusedField) : null;
  const showFinal = revealed >= PLATFORM_SIGNUP_STEPS.length && !docked?.ready && !keyboardVisible && !showTerms;

  const renderStep = (step: PlatformSignupStep) => {
    switch (step) {
      case 'name':
        return (
          <StackField label="이름" active={isTyping('name')}>
            <TextInput {...inputProps('name')} accessibilityLabel="이름" value={name} onChangeText={setName} autoFocus
              autoComplete="name" maxLength={50} placeholder="이름 입력" returnKeyType="next" blurOnSubmit={false}
              onSubmitEditing={() => { if (name.trim()) advance('name'); }} />
          </StackField>
        );
      case 'phone':
        return (
          <StackField label="휴대폰 번호" active={isTyping('phone')} message={notice} error={otpError}>
            <TextInput {...inputProps('phone')} accessibilityLabel="휴대폰 번호" value={phone}
              onChangeText={value => { setPhone(value.replace(/\D/g, '').slice(0, 11)); handleCodeChange(''); setCooldown(0); setNotice(''); setOtpError(''); }}
              keyboardType="number-pad" autoComplete="tel" placeholder="010으로 시작하는 11자리" />
          </StackField>
        );
      case 'code':
        return (
          <StackField label="인증 코드" active={isTyping('code')} message={codeVerified ? '인증되었습니다.' : null} error={codeError}>
            <TextInput {...inputProps('code')} accessibilityLabel="인증 코드" value={code} onChangeText={handleCodeChange}
              keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} placeholder="문자로 받은 6자리" />
          </StackField>
        );
      case 'password':
      case 'confirmation': {
        const isPassword = step === 'password';
        return (
          <StackField label={isPassword ? '비밀번호' : '비밀번호 확인'} active={isTyping(step)} error={focusedField === step ? stepError : null}>
            <View style={styles.passwordRow}>
              <TextInput {...inputProps(step)} style={[stackFormStyles.input, styles.flex]}
                accessibilityLabel={isPassword ? '비밀번호' : '비밀번호 확인'}
                value={isPassword ? password : confirmation}
                onChangeText={value => { setStepError(''); if (isPassword) setPassword(value); else setConfirmation(value); }}
                secureTextEntry={!showPassword} autoCapitalize="none" autoComplete={isPassword ? 'new-password' : 'off'}
                placeholder={isPassword ? '8자 이상, 영문·숫자·특수문자' : '한 번 더 입력'}
                returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => dockedAction(step)?.onPress()} />
              <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} hitSlop={8} onPress={() => setShowPassword(value => !value)}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={20} color={COLORS.text.secondary} />
              </Pressable>
            </View>
          </StackField>
        );
      }
      case 'referral':
        return (
          <StackField label="추천 코드 (선택)" active={isTyping('referral')} message="추천 관계는 모든 제휴 서비스에서 함께 사용됩니다.">
            <TextInput {...inputProps('referral')} accessibilityLabel="추천 코드 선택" value={referralCode}
              onChangeText={value => { referralEdited.current = true; setReferralCode(value); }} autoCapitalize="characters"
              placeholder="추천 코드 입력" returnKeyType="next" onSubmitEditing={openTerms} />
          </StackField>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false, title: '모두온 회원가입' }} />
      <View style={styles.header}>
        <Pressable accessibilityState={{ disabled: Boolean(loading) }} accessibilityRole="button" accessibilityLabel="모두온 로그인으로 돌아가기"
          disabled={Boolean(loading)} onPress={() => router.replace(resolvePlatformAuthRoute(service, 'login'))} style={styles.back}>
          <Feather name="arrow-left" size={24} color={COLORS.text.primary} />
        </Pressable>
        <ModuonBrand />
      </View>
      <Text style={stackFormStyles.title}>회원가입 정보를 입력해 주세요</Text>
      <KeyboardAwareWrapper contentContainerStyle={[stackFormStyles.content, styles.content]} keyboardShouldPersistTaps="handled">
        <LayoutAnimationConfig skipEntering>
          {getStackOrder(PLATFORM_SIGNUP_STEPS, revealed).map(step => (
            <StackItem key={step}>{renderStep(step)}</StackItem>
          ))}
        </LayoutAnimationConfig>
        <Pressable accessibilityRole="button" disabled={Boolean(loading)} onPress={() => router.replace(resolvePlatformAuthRoute(service, 'login'))} style={styles.link}>
          <Text style={styles.linkText}>이미 계정이 있어요</Text>
        </Pressable>
      </KeyboardAwareWrapper>
      {docked?.ready ? <StackDockedNext label={docked.label} disabled={docked.disabled} onPress={docked.onPress} /> : null}
      {showFinal ? <StackSubmit label="가입하기" onPress={openTerms} /> : null}

      <StackSheet
        contentKey={showTerms ? 'terms' : null}
        title="회원가입을 위해 동의가 필요해요"
        onClose={() => setShowTerms(false)}
        footer={<>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <StackButton
            label={loading === 'signup' ? '가입하는 중...' : '동의하고 가입하기'}
            disabled={!termsAccepted || Boolean(loading) || !hydrated}
            onPress={() => { void submit('signup'); }}
          />
        </>}
      >
        <Pressable accessibilityRole="checkbox" accessibilityLabel="필수 회원가입 및 개인정보 수집 이용 동의"
          accessibilityState={{ checked: termsAccepted }} disabled={Boolean(loading)}
          onPress={() => setTermsAccepted(value => !value)} style={styles.consent}>
          <Feather name={termsAccepted ? 'check-circle' : 'circle'} size={24} color={termsAccepted ? COLORS.primary : COLORS.gray[400]} />
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
      </StackSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.base },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center', paddingBottom: 120 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  detail: { color: COLORS.text.secondary, fontSize: TYPOGRAPHY.fontSize.sm, lineHeight: 20, marginBottom: SPACING.sm },
  detailLink: { color: COLORS.text.secondary, fontSize: TYPOGRAPHY.fontSize.sm, textDecorationLine: 'underline' },
  consent: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', minHeight: 44 },
  consentText: { flex: 1, color: COLORS.text.primary, fontSize: TYPOGRAPHY.fontSize.md, lineHeight: 22, fontWeight: '600' },
  error: { color: COLORS.error, fontSize: TYPOGRAPHY.fontSize.sm, lineHeight: 20, marginBottom: SPACING.sm },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.sm },
  linkText: { color: COLORS.text.secondary, fontSize: TYPOGRAPHY.fontSize.base, textDecorationLine: 'underline' },
});
