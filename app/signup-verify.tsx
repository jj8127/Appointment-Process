import { LinearGradient } from 'expo-linear-gradient';
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
import { safeStorage } from '@/lib/safe-storage';
import { supabase } from '@/lib/supabase';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

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
    router.replace('/signup');
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
      const { data, error } = await supabase.functions.invoke('request-signup-otp', {
        body: { phone: digits },
      });
      if (error) throw error;
      if (!data?.ok) {
        Alert.alert('알림', data?.message ?? '인증 코드 발송에 실패했습니다.');
        return;
      }
      setCooldown(60);
      Alert.alert('안내', '인증 코드가 문자로 발송되었습니다.');
    } catch (err: any) {
      Alert.alert('오류', err?.message ?? '인증 코드 발송에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    Keyboard.dismiss();
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
      });
      if (error) throw error;
      if (!data?.ok) {
        Alert.alert('알림', data?.message ?? '인증에 실패했습니다.');
        return;
      }
      if (payload) {
        await safeStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...payload, phone: digits, phoneVerified: true }),
        );
      }
      router.replace('/signup-password');
    } catch (err: any) {
      Alert.alert('오류', err?.message ?? '인증에 실패했습니다.');
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
                <Text style={styles.title}>휴대폰 인증</Text>
                <Text style={styles.subtitle}>문자로 받은 6자리 코드를 입력해주세요.</Text>
              </View>

              <FormInput
                label="휴대폰 번호"
                placeholder="숫자 11자리"
                value={phone}
                onChangeText={setPhone}
                keyboardType="number-pad"
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
