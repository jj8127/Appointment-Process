import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  BackHandler,
  Keyboard,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { logger } from '@/lib/logger';
import { safeStorage } from '@/lib/safe-storage';
import { sensitiveTokenStorage } from '@/lib/secure-token-storage';
import {
  isSignupCompletionToken,
  SIGNUP_COMPLETION_TOKEN_STORAGE_KEY,
} from '@/lib/signup-completion-capability';
import { hasValidStoredSignupReferral } from '@/lib/signup-referral';
import { supabase } from '@/lib/supabase';
import { signupClientHeaders } from '@/lib/signup-client-metadata';
import { readSupabaseFunctionErrorCode } from '@/lib/supabase-function-error';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { validatePassword } from '@/lib/validation';
import type { CommissionCompletionStatus, LicenseStatus } from '@/types/fc';

const AUTH_SCREEN_BACKGROUND = COLORS.primaryPale;

const STORAGE_KEY = 'fc-onboarding/signup';

type SignupPayload = {
  affiliation: string;
  name: string;
  recommender: string;
  email: string;
  phone: string;
  carrier: string;
  license_statuses?: LicenseStatus[];
  commissionStatus?: CommissionCompletionStatus;
  phoneVerified?: boolean;
  referralCode?: string;
  referralInviterFcId?: string;
};

function completionErrorMessage(code: unknown) {
  switch (code) {
    case 'verification_required':
    case 'verification_invalid':
    case 'verification_expired':
      return '휴대폰 인증이 만료되었거나 올바르지 않습니다. 다시 인증해주세요.';
    case 'request_conflict':
      return '가입 정보가 변경되었습니다. 휴대폰 인증부터 다시 진행해주세요.';
    case 'referral_invalid':
      return '추천인 정보를 다시 확인해주세요.';
    case 'invalid_request':
      return '가입 정보를 다시 확인해주세요.';
    case 'weak_password':
      return '비밀번호 조건을 다시 확인해주세요.';
    default:
      return '회원가입 처리에 실패했습니다. 잠시 후 다시 시도해주세요.';
  }
}

function requiresVerificationRestart(code: unknown) {
  return code === 'verification_required'
    || code === 'verification_invalid'
    || code === 'verification_expired'
    || code === 'request_conflict';
}

export default function SignupPasswordScreen() {
  const [payload, setPayload] = useState<SignupPayload | null>(null);
  const [completionToken, setCompletionToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const keyboardPadding = useKeyboardPadding();

  useEffect(() => {
    const load = async () => {
      const [raw, storedCompletionToken] = await Promise.all([
        safeStorage.getItem(STORAGE_KEY),
        sensitiveTokenStorage.getItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY),
      ]);
      if (!raw) {
        Alert.alert('알림', '회원가입 정보를 먼저 입력해주세요.');
        router.replace('/signup');
        return;
      }
      try {
        const parsed = JSON.parse(raw) as SignupPayload;
        if (!parsed?.phone) {
          throw new Error('invalid payload');
        }
        if (!parsed.phoneVerified) {
          Alert.alert('알림', '휴대폰 인증이 필요합니다.');
          router.replace('/signup-verify');
          return;
        }
        if (!isSignupCompletionToken(storedCompletionToken)) {
          Alert.alert('알림', '휴대폰 인증을 다시 완료해주세요.');
          router.replace('/signup-verify');
          return;
        }
        if (!hasValidStoredSignupReferral(parsed)) {
          Alert.alert('알림', '유효한 추천인을 먼저 선택해주세요.');
          router.replace('/signup');
          return;
        }
        setPayload(parsed);
        setCompletionToken(storedCompletionToken);
      } catch {
        await Promise.allSettled([
          safeStorage.removeItem(STORAGE_KEY),
          sensitiveTokenStorage.removeItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY),
        ]);
        router.replace('/signup');
      }
    };
    load();
  }, []);

  const handleBack = useCallback(() => {
    router.replace('/signup-verify');
  }, []);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        handleBack();
        return true;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
      return () => subscription.remove();
    }, [handleBack]),
  );

  const handleComplete = async () => {
    Keyboard.dismiss();
    if (!payload) return;
    if (!isSignupCompletionToken(completionToken)) {
      Alert.alert('알림', '휴대폰 인증을 다시 완료해주세요.');
      router.replace('/signup-verify');
      return;
    }
    if (!hasValidStoredSignupReferral(payload)) {
      Alert.alert('알림', '유효한 추천인을 먼저 선택해주세요.');
      router.replace('/signup');
      return;
    }

    const trimmedPassword = password.trim();
    const trimmedConfirm = confirm.trim();

    // Use validation library
    const passwordValidation = validatePassword(trimmedPassword);
    if (!passwordValidation.isValid) {
      Alert.alert('알림', passwordValidation.error);
      return;
    }

    if (trimmedPassword !== trimmedConfirm) {
      Alert.alert('알림', '비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      // Pass profile data to set-password Edge Function (service role key handles RLS)
      const { data, error } = await supabase.functions.invoke('set-password', {
        body: {
          phone: payload.phone,
          password: trimmedPassword,
          completionToken,
          name: payload.name,
          affiliation: payload.affiliation,
          recommender: payload.recommender,
          email: payload.email,
          carrier: payload.carrier,
          license_statuses: payload.license_statuses,
          commissionStatus: payload.commissionStatus ?? 'none',
          referralCode: payload.referralCode || undefined,
          referralInviterFcId: payload.referralInviterFcId || undefined,
        },
        headers: signupClientHeaders(),
      });
      if (error || !data?.ok) {
        const failureCode = error
          ? await readSupabaseFunctionErrorCode(error)
          : data?.code;
        if (error) {
          logger.warn('signup failed', { reason: 'request_failed' });
        }
        if (failureCode === 'already_set') {
          await Promise.allSettled([
            safeStorage.removeItem(STORAGE_KEY),
            sensitiveTokenStorage.removeItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY),
          ]);
          Alert.alert('안내', '이미 가입된 계정입니다. 로그인해주세요.');
          router.replace('/login');
          return;
        }
        if (requiresVerificationRestart(failureCode)) {
          await sensitiveTokenStorage.removeItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY).catch(() => undefined);
        }
        Alert.alert('오류', completionErrorMessage(failureCode));
        if (requiresVerificationRestart(failureCode)) {
          router.replace('/signup-verify');
        }
        return;
      }

      await Promise.allSettled([
        safeStorage.removeItem(STORAGE_KEY),
        sensitiveTokenStorage.removeItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY),
      ]);
      Alert.alert('완료', '회원가입이 완료되었습니다. 로그인해주세요.');
      router.replace('/login');
    } catch {
      logger.warn('signup failed', { reason: 'unexpected_error' });
      Alert.alert('오류', '회원가입 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
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
                <Text style={styles.title}>비밀번호 설정</Text>
                <Text style={styles.subtitle}>가입용 비밀번호를 설정해주세요.</Text>
              </View>

              <FormInput
                label="비밀번호"
                variant="password"
                placeholder="8자 이상, 영문+숫자+특수문자"
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

              <FormInput
                label="비밀번호 확인"
                variant="password"
                placeholder="비밀번호 다시 입력"
                value={confirm}
                onChangeText={setConfirm}
                autoCapitalize="none"
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

              <Button
                onPress={handleComplete}
                disabled={loading}
                loading={loading}
                variant="primary"
                size="lg"
                fullWidth
                dismissKeyboardOnPress
                style={styles.button}
              >
                회원가입 완료
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
    paddingTop: '18%',
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
  },
  inputContainer: {
    marginBottom: SPACING.base,
  },
  button: {
    marginTop: SPACING.sm,
  },
});
