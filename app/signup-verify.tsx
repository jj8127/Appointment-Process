import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { goBackOrReplace } from '@/lib/back-navigation';
import { safeStorage } from '@/lib/safe-storage';
import { sensitiveTokenStorage } from '@/lib/secure-token-storage';
import {
  isSignupCompletionToken,
  SIGNUP_COMPLETION_TOKEN_STORAGE_KEY,
} from '@/lib/signup-completion-capability';
import { supabase } from '@/lib/supabase';
import { signupClientHeaders } from '@/lib/signup-client-metadata';
import { readSupabaseFunctionErrorCode } from '@/lib/supabase-function-error';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';
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

function requestCodeErrorMessage(code: unknown) {
  switch (code) {
    case 'already_exists':
      return '이미 가입된 휴대폰 번호입니다.';
    case 'cooldown':
      return '잠시 후 인증 코드를 다시 요청해주세요.';
    case 'locked':
      return '요청이 잠시 제한되었습니다. 나중에 다시 시도해주세요.';
    case 'sms_send_failed':
      return '인증 문자 발송에 실패했습니다. 잠시 후 다시 시도해주세요.';
    case 'sms_delivery_unknown':
      return '문자 접수 상태 확인이 늦어지고 있습니다. 문자가 오면 인증번호를 입력해주세요.';
    default:
      return '인증 코드 발송에 실패했습니다.';
  }
}

function verifyCodeErrorMessage(code: unknown) {
  switch (code) {
    case 'no_code':
      return '먼저 인증 코드를 요청해주세요.';
    case 'expired_code':
      return '인증 코드가 만료되었습니다. 다시 요청해주세요.';
    case 'locked':
      return '인증 시도가 너무 많아 잠시 후 다시 시도해주세요.';
    case 'invalid_code':
      return '인증 코드가 올바르지 않습니다.';
    case 'already_completed':
      return '이미 가입이 완료된 계정입니다.';
    default:
      return '인증에 실패했습니다. 잠시 후 다시 시도해주세요.';
  }
}

export default function SignupVerifyScreen() {
  const [payload, setPayload] = useState<SignupPayload | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const keyboardPadding = useKeyboardPadding();

  useEffect(() => {
    const load = async () => {
      const raw = await safeStorage.getItem(STORAGE_KEY);
      if (!raw) {
        Alert.alert('알림', '회원가입 정보를 먼저 입력해주세요.');
        router.replace('/signup');
        return;
      }
      try {
        const parsed = JSON.parse(raw) as SignupPayload;
        if (!parsed?.phone) throw new Error('invalid payload');
        setPayload(parsed);
        setPhone(parsed.phone);
      } catch {
        await safeStorage.removeItem(STORAGE_KEY);
        router.replace('/signup');
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleBack = useCallback(() => {
    goBackOrReplace(router, '/signup');
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

  const requestCode = async () => {
    Keyboard.dismiss();
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length !== 11) {
      Alert.alert('알림', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      await sensitiveTokenStorage.removeItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY);
      const { data, error } = await supabase.functions.invoke('request-signup-otp', {
        body: { phone: digits },
        headers: signupClientHeaders(),
      });
      if (error) {
        const errorCode = await readSupabaseFunctionErrorCode(error);
        if (errorCode === 'sms_delivery_unknown') {
          setCooldown(60);
        }
        Alert.alert('오류', requestCodeErrorMessage(errorCode));
        return;
      }
      if (!data?.ok) {
        if (data?.code === 'sms_delivery_unknown') {
          setCooldown(60);
        }
        Alert.alert('알림', requestCodeErrorMessage(data?.code));
        return;
      }
      setCooldown(60);
      Alert.alert('안내', '인증 코드가 문자로 발송되었습니다.');
    } catch {
      Alert.alert('오류', '인증 코드 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    Keyboard.dismiss();
    if (!payload) {
      Alert.alert('알림', '회원가입 정보를 먼저 입력해주세요.');
      router.replace('/signup');
      return;
    }
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length !== 11) {
      Alert.alert('알림', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      Alert.alert('알림', '인증 코드는 6자리 숫자여야 합니다.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-signup-otp', {
        body: { phone: digits, code: code.trim() },
        headers: signupClientHeaders(),
      });
      if (error) {
        const errorCode = await readSupabaseFunctionErrorCode(error);
        Alert.alert('오류', verifyCodeErrorMessage(errorCode));
        return;
      }
      if (!data?.ok) {
        Alert.alert('알림', verifyCodeErrorMessage(data?.code));
        return;
      }
      if (!isSignupCompletionToken(data.completionToken)) {
        Alert.alert('오류', '인증 정보를 확인하지 못했습니다. 다시 인증해주세요.');
        return;
      }
      await sensitiveTokenStorage.setItem(
        SIGNUP_COMPLETION_TOKEN_STORAGE_KEY,
        data.completionToken,
      );
      try {
        await safeStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...payload, phone: digits, phoneVerified: true }),
        );
      } catch {
        await sensitiveTokenStorage.removeItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY);
        throw new Error('signup_state_storage_failed');
      }
      router.replace('/signup-password');
    } catch {
      Alert.alert('오류', '인증에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const helperText = useMemo(() => {
    if (cooldown > 0) return `인증 코드 재전송까지 ${cooldown}초`;
    return '인증 코드를 받지 못하셨나요? 다시 요청해 주세요.';
  }, [cooldown]);

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
                <Text style={styles.title}>휴대폰 인증</Text>
                <Text style={styles.subtitle}>문자로 받은 6자리 코드를 입력해주세요.</Text>
              </View>

              <FormInput
                label="휴대폰 번호"
                placeholder="숫자 11자리"
                value={phone}
                onChangeText={setPhone}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={requestCode}
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

              <Button
                onPress={requestCode}
                disabled={loading || cooldown > 0}
                loading={loading}
                variant="outline"
                size="md"
                fullWidth
                dismissKeyboardOnPress
                style={styles.subButton}
              >
                {cooldown > 0 ? `재전송 (${cooldown}s)` : '인증 코드 받기'}
              </Button>
              <Text style={styles.helperText}>{helperText}</Text>

              <FormInput
                label="인증 코드"
                placeholder="6자리 숫자"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={verifyCode}
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

              <Button
                onPress={verifyCode}
                disabled={loading}
                loading={loading}
                variant="primary"
                size="lg"
                fullWidth
                dismissKeyboardOnPress
              >
                인증 완료
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
    paddingTop: '12%',
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
    marginBottom: SPACING.xs,
  },
  helperText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.secondary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
});
