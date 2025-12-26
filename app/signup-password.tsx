import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useState } from 'react';
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
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
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

export default function SignupPasswordScreen() {
  const [payload, setPayload] = useState<SignupPayload | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
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

  const inputStyle = (field: string) => [
    styles.inputWrapper,
    {
      borderColor: focusedField === field ? HANWHA_ORANGE : BORDER,
      backgroundColor: focusedField === field ? '#FFF' : INPUT_BG,
    },
  ];

  const handleComplete = async () => {
    Keyboard.dismiss();
    if (!payload) return;
    const trimmedPassword = password.trim();
    const trimmedConfirm = confirm.trim();
    const hasLetter = /[A-Za-z]/.test(trimmedPassword);
    const hasNumber = /[0-9]/.test(trimmedPassword);
    const hasSpecial = /[^A-Za-z0-9]/.test(trimmedPassword);
    if (trimmedPassword.length < 8 || !hasLetter || !hasNumber || !hasSpecial) {
      Alert.alert('알림', '비밀번호는 8자 이상이며 영문+숫자+특수문자를 포함해야 합니다.');
      return;
    }
    if (trimmedPassword !== trimmedConfirm) {
      Alert.alert('알림', '비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      const { data: existing, error: fetchError } = await supabase
        .from('fc_profiles')
        .select('id')
        .eq('phone', payload.phone)
        .maybeSingle();

      if (fetchError) {
        Alert.alert('오류', '회원 정보 조회에 실패했습니다.');
        return;
      }

      if (existing?.id) {
        const { error: updateError } = await supabase
          .from('fc_profiles')
          .update({
            name: payload.name,
            affiliation: payload.affiliation,
            recommender: payload.recommender,
            email: payload.email,
            carrier: payload.carrier,
          })
          .eq('id', existing.id);
        if (updateError) {
          Alert.alert('오류', '회원 정보 저장에 실패했습니다.');
          return;
        }
      } else {
        const { error: insertError } = await supabase.from('fc_profiles').insert({
          phone: payload.phone,
          name: payload.name,
          affiliation: payload.affiliation,
          recommender: payload.recommender,
          email: payload.email,
          address: '',
          status: 'draft',
          identity_completed: false,
          carrier: payload.carrier,
        });
        if (insertError) {
          Alert.alert('오류', '회원 정보 저장에 실패했습니다.');
          return;
        }
      }

      const { data, error } = await supabase.functions.invoke('set-password', {
        body: { phone: payload.phone, password: trimmedPassword },
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
      console.warn('signup failed', err);
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

              <View style={styles.inputContainer}>
                <Text style={styles.label}>비밀번호</Text>
                <View style={inputStyle('password')}>
                <TextInput
                    style={styles.input}
                    placeholder="8자 이상, 영문+숫자+특수문자"
                    placeholderTextColor="#9CA3AF"
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    autoCapitalize="none"
                    secureTextEntry
                  />
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>비밀번호 확인</Text>
                <View style={inputStyle('confirm')}>
                <TextInput
                    style={styles.input}
                    placeholder="비밀번호 다시 입력 (조건 동일)"
                    placeholderTextColor="#9CA3AF"
                    value={confirm}
                    onChangeText={setConfirm}
                    onFocus={() => setFocusedField('confirm')}
                    onBlur={() => setFocusedField(null)}
                    autoCapitalize="none"
                    secureTextEntry
                  />
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.buttonPressed,
                  loading && styles.buttonDisabled,
                ]}
                onPress={handleComplete}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>회원가입 완료</Text>
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
    paddingTop: '18%',
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
    padding: 28,
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
  },
  inputContainer: {
    gap: 8,
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: CHARCOAL,
    marginLeft: 4,
  },
  inputWrapper: {
    height: 52,
    borderWidth: 1.5,
    borderRadius: 14,
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    fontSize: 15,
    color: CHARCOAL,
  },
  button: {
    height: 54,
    backgroundColor: HANWHA_ORANGE,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: HANWHA_ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonPressed: {
    backgroundColor: HANWHA_ORANGE_DARK,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    backgroundColor: '#FFD4C0',
    shadowOpacity: 0,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
