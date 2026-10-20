import { Feather } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import ModuonBrand from '@/components/ModuonBrand';
import { useSession } from '@/hooks/use-session';
import { useLogin } from '@/hooks/use-login';
import { PlatformApiError, platformRequest, type PlatformAuthResponse } from '@/lib/platform-api';
import { captureAppSessionOwner } from '@/lib/request-board-api';
import { COLORS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { resolvePlatformAuthRoute, resolveSessionLandingRoute } from '@/lib/session-landing';
import { waitForNotificationNavigationDecision } from '@/lib/notification-navigation-coordinator';
import { clearSavedLoginCredentials, getSavedLoginCredentials, setSavedLoginCredentials } from '@/lib/saved-login-credentials';
import { useReadAttempt } from '@/lib/use-read-attempt';
import { normalizePhone, validatePhone, validateRequired } from '@/lib/validation';
import { returnTo } from '@/lib/back-navigation';

// A manual login yields to a pending notification only while that handoff can still take focus.
const NOTIFICATION_HANDOFF_GRACE_MS = 1200;

export default function PlatformLogin() {
  const navigation = useNavigation();
  const { service, skipAuto } = useLocalSearchParams<{ service?: string; skipAuto?: string }>();
  const { hydrated, role, residentId, appSessionToken, platformSessionToken, isRequestBoardDesigner, isPlatformSignedIn, loginPlatformMember } = useSession();
  const { acceptLoginResponse, handleLoginRejection } = useLogin();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);
  const [manualLoginSucceeded, setManualLoginSucceeded] = useState(false);
  const pending = useRef(false);
  const rememberPasswordPressInHandledRef = useRef(false);
  const beginAttempt = useReadAttempt();
  const sessionKey = JSON.stringify([role, residentId, appSessionToken, platformSessionToken]);
  const currentSessionKey = useRef(sessionKey);
  currentSessionKey.current = sessionKey;

  useEffect(() => {
    let active = true;
    void getSavedLoginCredentials().then(saved => {
      if (!active || !saved) return;
      setPhone(saved.phone); setPassword(saved.password); setRememberPassword(true);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated || (skipAuto === '1' && !manualLoginSucceeded)) return;
    const route = resolveSessionLandingRoute({ role, residentId, isRequestBoardDesigner,
      isPlatformSignedIn, requestedService: service });
    if (!route) return;
    let active = true;
    let handoffFallback: ReturnType<typeof setTimeout> | undefined;
    const land = () => {
      if (route === '/services/account') router.dismissTo(route);
      else router.replace(route);
    };
    void waitForNotificationNavigationDecision().then(hasPending => {
      if (!active) return;
      if (!hasPending) { land(); return; }
      if (!manualLoginSucceeded) return;
      // The pending flag can outlive an intent that was already opened or failed to
      // acknowledge. A user who just signed in here must not be left on this screen.
      handoffFallback = setTimeout(() => {
        if (active && navigation.isFocused()) land();
      }, NOTIFICATION_HANDOFF_GRACE_MS);
    });
    return () => { active = false; if (handoffFallback) clearTimeout(handoffFallback); };
  }, [hydrated, role, residentId, isRequestBoardDesigner, isPlatformSignedIn, service, skipAuto, manualLoginSucceeded, navigation]);

  const toggleRememberPassword = useCallback(() => {
    if (rememberPassword) void clearSavedLoginCredentials().catch(() => undefined);
    setRememberPassword(current => !current);
  }, [rememberPassword]);
  const handleRememberPasswordPressIn = useCallback(() => {
    rememberPasswordPressInHandledRef.current = true;
    toggleRememberPassword();
  }, [toggleRememberPassword]);
  const handleRememberPasswordPress = useCallback(() => {
    if (rememberPasswordPressInHandledRef.current) {
      rememberPasswordPressInHandledRef.current = false;
      return;
    }
    toggleRememberPassword();
  }, [toggleRememberPassword]);

  // Keep the form busy after success until the landing effect navigates away.
  const busy = loading || manualLoginSucceeded;

  const login = async () => {
    if (pending.current) return;
    const invalid = [validatePhone(phone), validateRequired(password, '비밀번호')].find(value => !value.isValid);
    if (invalid) { setError(invalid.error ?? '입력 내용을 확인해주세요.'); return; }
    Keyboard.dismiss();
    pending.current = true;
    setLoading(true);
    setError('');
    const isCurrent = beginAttempt();
    const ownsSession = captureAppSessionOwner();
    try {
      const result = await platformRequest<PlatformAuthResponse>('login', {
        phone: normalizePhone(phone), password: password.trim(),
      });
      if (!isCurrent() || !ownsSession()) return;
      if (result.insuranceSession) {
        const accepted = await acceptLoginResponse(result.insuranceSession, normalizePhone(phone),
          () => isCurrent() && currentSessionKey.current === sessionKey);
        if (!accepted) return;
      }
      else await loginPlatformMember({ id: result.memberId, name: result.displayName }, result.appSessionToken);
      if (!isCurrent()) return;
      setManualLoginSucceeded(true);
      await setSavedLoginCredentials({ rememberPassword, phone, password }).catch(() => undefined);
    } catch (failure) {
      if (!isCurrent() || !ownsSession()) return;
      if (failure instanceof PlatformApiError && await handleLoginRejection({
        ok: false, code: failure.code, ...failure.loginRejection,
      }, service, () => isCurrent() && currentSessionKey.current === sessionKey)) return;
      setError(failure instanceof Error ? failure.message : '로그인하지 못했습니다. 다시 시도해주세요.');
    } finally {
      if (isCurrent()) { pending.current = false; setLoading(false); }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false, title: '모두온 로그인' }} />
      <View style={styles.header}>
        <Pressable accessibilityState={{ disabled: busy }} accessibilityRole="button" accessibilityLabel="전체 서비스로 돌아가기"
          disabled={busy} onPress={() => returnTo(router, '/')} style={styles.back}>
          <Feather name="arrow-left" size={24} color={COLORS.text.primary} />
        </Pressable>
        <ModuonBrand />
      </View>
      <KeyboardAwareWrapper contentContainerStyle={styles.content} keyboardShouldPersistTaps="always">
        <Text style={styles.title}>한 번의 로그인으로{`\n`}여러 서비스를 이용하세요</Text>
        <Text style={styles.description}>기존 가람in 계정으로도 로그인할 수 있습니다.</Text>
        <FormInput label="휴대폰 번호" accessibilityLabel="휴대폰 번호" value={phone}
          onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel"
          placeholder="010으로 시작하는 11자리" editable={!busy} containerStyle={styles.field} />
        <FormInput label="비밀번호" accessibilityLabel="비밀번호" value={password}
          onChangeText={setPassword} variant="password" autoCapitalize="none"
          editable={!busy} returnKeyType="done" onSubmitEditing={login} containerStyle={styles.field} />
        <Pressable accessibilityRole="checkbox" accessibilityLabel="비밀번호 저장"
          accessibilityState={{ checked: rememberPassword }} disabled={busy}
          onPressIn={handleRememberPasswordPressIn} onPress={handleRememberPasswordPress} style={styles.remember}>
          <Feather name={rememberPassword ? 'check-square' : 'square'} size={22} color={COLORS.primary} />
          <Text style={styles.linkText}>비밀번호 저장</Text>
        </Pressable>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Button loading={busy} disabled={busy || !hydrated} onPress={login} submitOnPressIn dismissKeyboardOnPress fullWidth>로그인</Button>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.push({ pathname: '/reset-password', params: { audience: 'platform', ...(typeof service === 'string' ? { service } : {}), ...(skipAuto === '1' ? { skipAuto } : {}) } })} style={styles.link}>
          <Text style={styles.linkText}>비밀번호 찾기</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.replace(resolvePlatformAuthRoute(service, 'signup'))} style={styles.link}>
          <Text style={styles.linkText}>모두온 회원가입</Text>
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
  remember: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', minHeight: 44, marginBottom: SPACING.base },
  error: { color: COLORS.error, fontSize: TYPOGRAPHY.fontSize.sm, lineHeight: 20, marginBottom: SPACING.base },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.sm },
  linkText: { color: COLORS.text.secondary, fontSize: TYPOGRAPHY.fontSize.base, textDecorationLine: 'underline' },
});
