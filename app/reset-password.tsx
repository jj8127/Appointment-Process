import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { FormInput } from '@/components/FormInput';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { platformRequest } from '@/lib/platform-api';
import { resolvePlatformAuthRoute } from '@/lib/session-landing';
import { useReadAttempt } from '@/lib/use-read-attempt';
import { captureAppSessionOwner } from '@/lib/request-board-api';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';
import { validatePhone, validatePassword, normalizePhone } from '@/lib/validation';

const AUTH_SCREEN_BACKGROUND = COLORS.primaryPale;

export default function ResetPasswordScreen() {
  const { audience, service, skipAuto } = useLocalSearchParams<{ audience?: string; service?: string; skipAuto?: string }>();
  const isPlatform = audience === 'platform';
  const { logout } = useSession();
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState<'otp' | 'reset' | null>(null);
  const [requested, setRequested] = useState(false);
  const keyboardPadding = useKeyboardPadding();
  const pending = useRef(false);
  const beginAttempt = useReadAttempt();

  const handleRequest = async () => {
    if (pending.current) return;
    Keyboard.dismiss();
    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.isValid) {
      Alert.alert('알림', phoneValidation.error);
      return;
    }
    const digits = normalizePhone(phone);
    pending.current = true;
    setLoading('otp');
    const isCurrent = beginAttempt();
    const ownsSession = captureAppSessionOwner();
    try {
      const { data, error } = isPlatform
        ? { data: await platformRequest<{ ok: true }>('request_password_reset', { phone: digits }), error: null }
        : await supabase.functions.invoke('request-password-reset', {
        body: { phone: digits },
      });
      if (!isCurrent() || !ownsSession()) return;
      if (error) throw new Error('인증 문자를 요청하지 못했습니다. 잠시 후 다시 시도해주세요.');
      if (!data?.ok) {
        if (data?.code === 'not_found') {
          Alert.alert('알림', data?.message ?? '등록된 계정을 찾을 수 없습니다.');
          return;
        }
        if (data?.code === 'not_set' || data?.code === 'not_completed') {
          Alert.alert(
            '회원가입 미완료',
            '회원가입이 완료되지 않았습니다.\n회원가입 페이지로 이동하시겠습니까?',
            [
              { text: '취소', style: 'cancel' },
              {
                text: '회원가입',
                onPress: () => router.replace(resolvePlatformAuthRoute(service ?? 'insurance', 'signup')),
              },
            ]
          );
          return;
        }
        Alert.alert('알림', data?.message ?? '요청에 실패했습니다.');
        return;
      }
      setRequested(true);
      Alert.alert(
        '안내',
        '인증 코드가 문자로 발송되었습니다.',
      );
    } catch (err: any) {
      if (!isCurrent() || !ownsSession()) return;
      const message = err?.message || '비밀번호 변경 요청에 실패했습니다.';
      Alert.alert('오류', message);
    } finally {
      if (isCurrent()) { pending.current = false; setLoading(null); }
    }
  };

  const handleReset = async () => {
    if (pending.current) return;
    Keyboard.dismiss();
    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.isValid) {
      Alert.alert('알림', phoneValidation.error);
      return;
    }
    if (!/^\d{6}$/.test(token.trim())) {
      Alert.alert('알림', '문자로 받은 6자리 인증 코드를 입력해주세요.');
      return;
    }
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      Alert.alert('알림', passwordValidation.error);
      return;
    }
    const digits = normalizePhone(phone);
    const trimmedNew = newPassword.trim();

    pending.current = true;
    setLoading('reset');
    const isCurrent = beginAttempt();
    const ownsSession = captureAppSessionOwner();
    try {
      const { data, error } = isPlatform
        ? { data: await platformRequest<{ ok: true }>('reset_password', { phone: digits, code: token.trim(), password: trimmedNew }), error: null }
        : await supabase.functions.invoke('reset-password', {
        body: {
          phone: digits,
          token: token.trim(),
          newPassword: trimmedNew,
        },
      });
      if (!isCurrent() || !ownsSession()) return;
      if (error) throw error;
      if (!data?.ok) {
        Alert.alert('알림', data?.message ?? '비밀번호 변경에 실패했습니다.');
        return;
      }

      await supabase.auth.signOut().catch(() => {});
      if (!isCurrent() || !ownsSession()) return;
      logout();
      Alert.alert('완료', '비밀번호가 변경되었습니다.');
      const loginRoute = resolvePlatformAuthRoute(service, 'login');
      router.dismissTo(skipAuto === '1' ? { pathname: '/services/login',
        params: { ...(typeof loginRoute === 'object' ? loginRoute.params : {}), skipAuto } } : loginRoute);
    } catch (error) {
      if (isCurrent() && ownsSession()) Alert.alert('오류', isPlatform && error instanceof Error ? error.message : '비밀번호 변경에 실패했습니다.');
    } finally {
      if (isCurrent()) { pending.current = false; setLoading(null); }
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.authBackground} pointerEvents="none" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <KeyboardAwareWrapper
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(40, keyboardPadding + 40) }]}
          extraScrollHeight={140}
          keyboardDismissMode="none"
        >
          <View style={styles.innerContent}>
            <MotiView
              from={{ opacity: 0, translateY: 30, scale: 0.98 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              transition={{ type: 'spring', damping: 20, stiffness: 100, delay: 200 }}
              style={styles.card}
            >
              <View style={styles.headerSection}>
                <Text style={styles.title}>비밀번호 변경</Text>
                <Text style={styles.subtitle}>문자로 받은 6자리 코드로 비밀번호를 설정하거나 변경합니다.</Text>
              </View>

              <FormInput
                label="휴대폰 번호"
                placeholder="숫자 11자리"
                value={phone}
                onChangeText={value => { setPhone(value); setToken(''); setRequested(false); }}
                keyboardType="number-pad"
                autoComplete="tel"
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

                  <Button
                    onPress={handleRequest}
                    disabled={!!loading}
                    loading={loading === 'otp'}
                    variant="outline"
                    size="md"
                    fullWidth
                    dismissKeyboardOnPress
                    style={styles.subButton}
                  >
                {requested ? '인증 코드 다시 받기' : '인증 코드 받기'}
              </Button>

              <FormInput
                label="인증 코드"
                placeholder="6자리 숫자 코드"
                value={token}
                onChangeText={setToken}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                maxLength={6}
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

              <FormInput
                label="새 비밀번호"
                variant="password"
                placeholder="8자 이상, 영문+숫자+특수문자"
                value={newPassword}
                onChangeText={setNewPassword}
                autoCapitalize="none"
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

                  <Button
                    onPress={handleReset}
                    disabled={!!loading}
                    loading={loading === 'reset'}
                    variant="primary"
                    size="lg"
                    fullWidth
                    dismissKeyboardOnPress
                  >
                비밀번호 변경
              </Button>
            </MotiView>
          </View>
        </KeyboardAwareWrapper>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AUTH_SCREEN_BACKGROUND,
  },
  authBackground: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: AUTH_SCREEN_BACKGROUND,
  },
  safe: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: '10%',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING['2xl'],
  },
  innerContent: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    padding: SPACING['2xl'],
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
    borderWidth: 1,
    borderColor: COLORS.primaryPale,
  },
  headerSection: {
    marginBottom: SPACING['2xl'],
    alignItems: 'center',
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize['2xl'],
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.sm,
  },
  inputContainer: {
    marginBottom: SPACING.base,
  },
  subButton: {
    marginBottom: SPACING.lg,
  },
});
