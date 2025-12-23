import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { safeStorage } from '@/lib/safe-storage';
import { supabase } from '@/lib/supabase';

const HANWHA_ORANGE = '#f36f21';
const HANWHA_ORANGE_DARK = '#d65a16';
const CHARCOAL = '#1F2937';
const GRAY_TEXT = '#6B7280';
const BORDER = '#E5E7EB';
const INPUT_BG = '#F9FAFB';
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
        <KeyboardAwareWrapper contentContainerStyle={styles.scrollContent} extraScrollHeight={140}>
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

              <View style={styles.inputContainer}>
                <Text style={styles.label}>휴대폰 번호</Text>
                <MotiView
                  animate={{
                    borderColor: BORDER,
                    backgroundColor: INPUT_BG,
                  }}
                  transition={{ type: 'timing', duration: 200 }}
                  style={styles.inputWrapper}
                >
                  <TextInput
                    style={styles.input}
                    placeholder="숫자 11자리"
                    placeholderTextColor="#9CA3AF"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="number-pad"
                    editable={!loading}
                  />
                </MotiView>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.subButton,
                  pressed && styles.buttonPressed,
                  (loading || cooldown > 0) && styles.buttonDisabled,
                ]}
                onPress={requestCode}
                disabled={loading || cooldown > 0}
              >
                {loading ? (
                  <ActivityIndicator color={HANWHA_ORANGE_DARK} />
                ) : (
                  <Text style={styles.subButtonText}>
                    {cooldown > 0 ? `재전송 (${cooldown}s)` : '인증 코드 받기'}
                  </Text>
                )}
              </Pressable>
              <Text style={styles.helperText}>{helperText}</Text>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>인증 코드</Text>
                <MotiView
                  animate={{
                    borderColor: BORDER,
                    backgroundColor: INPUT_BG,
                  }}
                  transition={{ type: 'timing', duration: 200 }}
                  style={styles.inputWrapper}
                >
                  <TextInput
                    style={styles.input}
                    placeholder="6자리 숫자"
                    placeholderTextColor="#9CA3AF"
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    editable={!loading}
                  />
                </MotiView>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.buttonPressed,
                  loading && styles.buttonDisabled,
                ]}
                onPress={verifyCode}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>인증 완료</Text>
                )}
              </Pressable>
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
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  innerContent: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 32,
    shadowColor: '#f36f21',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(243, 111, 33, 0.05)',
  },
  headerSection: {
    marginBottom: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: CHARCOAL,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: GRAY_TEXT,
    textAlign: 'center',
    lineHeight: 20,
  },
  inputContainer: {
    gap: 8,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: CHARCOAL,
    marginLeft: 4,
  },
  inputWrapper: {
    height: 56,
    borderWidth: 1.5,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    color: CHARCOAL,
    height: '100%',
  },
  button: {
    height: 56,
    backgroundColor: HANWHA_ORANGE,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: HANWHA_ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  subButton: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FCE8DB',
  },
  subButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: HANWHA_ORANGE_DARK,
  },
  buttonPressed: {
    backgroundColor: HANWHA_ORANGE_DARK,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  helperText: {
    fontSize: 12,
    color: GRAY_TEXT,
    marginTop: 8,
    marginBottom: 12,
    textAlign: 'center',
  },
});
