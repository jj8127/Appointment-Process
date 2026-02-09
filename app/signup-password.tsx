import { LinearGradient } from 'expo-linear-gradient';
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
import { supabase } from '@/lib/supabase';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { validatePassword } from '@/lib/validation';

const STORAGE_KEY = 'fc-onboarding/signup';

type SignupPayload = {
  affiliation: string;
  name: string;
  recommender: string;
  email: string;
  phone: string;
  carrier: string;
  phoneVerified?: boolean;
};

export default function SignupPasswordScreen() {
  const [payload, setPayload] = useState<SignupPayload | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
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
        if (!parsed?.phone) {
          throw new Error('invalid payload');
        }
        if (!parsed.phoneVerified) {
          Alert.alert('알림', '휴대폰 인증이 필요합니다.');
          router.replace('/signup-verify');
          return;
        }
        setPayload(parsed);
      } catch {
        await safeStorage.removeItem(STORAGE_KEY);
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
          name: payload.name,
          affiliation: payload.affiliation,
          recommender: payload.recommender,
          email: payload.email,
          carrier: payload.carrier,
        },
      });
      if (error) {
        let detail = error.message;
        const context = (error as any)?.context as Response | undefined;
        if (context?.text) {
          try {
            detail = await context.text();
          } catch {
            // ignore parse failures
          }
        }
        throw new Error(detail || error.message);
      }
      if (!data?.ok) {
        if (data?.code === 'already_set') {
          Alert.alert('안내', '이미 가입된 계정입니다. 로그인해주세요.');
          router.replace('/login');
          return;
        }
        Alert.alert('오류', data?.message ?? '비밀번호 설정에 실패했습니다.');
        return;
      }

      await safeStorage.removeItem(STORAGE_KEY);
      Alert.alert('완료', '회원가입이 완료되었습니다. 로그인해주세요.');
      router.replace('/login');
    } catch (err: any) {
      logger.warn('signup failed', { error: err });
      const message =
        err?.message ||
        err?.details ||
        err?.error ||
        '회원가입 처리에 실패했습니다.';
      Alert.alert('오류', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#ffffff', '#fff1e6']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <KeyboardAwareWrapper
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(40, keyboardPadding + 40) }]}
          extraScrollHeight={140}
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
