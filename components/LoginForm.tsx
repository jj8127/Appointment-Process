import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import Logo from '@/assets/images/logo.png';

const HANWHA_ORANGE = '#f36f21';
const HANWHA_ORANGE_DARK = '#d65a16';
const CHARCOAL = '#1F2937';
const GRAY_TEXT = '#6B7280';
const BORDER = '#E5E7EB';
const INPUT_BG = '#F9FAFB';

type LoginFormProps = {
  title?: string;
  onSuccess?: () => void;
};

type LoginResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  role?: 'admin' | 'fc' | 'manager';
  residentId?: string;
  displayName?: string;
};

export function LoginForm({ title = '로그인', onSuccess }: LoginFormProps) {
  const { loginAs } = useSession();
  const [phoneInput, setPhoneInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const keyboardPadding = useKeyboardPadding();

  const handleLogin = async () => {
    Keyboard.dismiss();

    const code = phoneInput.replace(/\s/g, '');
    if (!code) {
      Alert.alert('알림', '휴대폰 번호를 입력해주세요.');
      return;
    }

    Haptics.selectionAsync();
    setLoading(true);

    try {
      const digits = code.replace(/[^0-9]/g, '');
      if (digits.length !== 11) {
        Alert.alert('알림', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
        return;
      }

      if (!passwordInput.trim()) {
        Alert.alert('알림', '비밀번호를 입력해주세요.');
        return;
      }

      const { data, error } = await supabase.functions.invoke<LoginResponse>('login-with-password', {
        body: { phone: digits, password: passwordInput.trim() },
      });

      if (error) {
        const message = error instanceof Error ? error.message : '오류가 발생했습니다. 다시 시도해주세요.';
        Alert.alert('로그인 실패', message);
        return;
      }

      if (!data?.ok) {
        if (data?.code === 'not_found') {
          Alert.alert('안내', '회원가입이 되어 있지 않은 번호입니다. 회원가입 후 로그인해주세요.');
          if (data?.role !== 'admin' && data?.role !== 'manager') {
            router.replace('/signup');
          }
          return;
        }
        if (data?.code === 'needs_password_setup' && data?.role !== 'admin' && data?.role !== 'manager') {
          Alert.alert('안내', '비밀번호 설정이 필요합니다. 회원가입을 완료해주세요.');
          router.replace('/signup');
          return;
        }
        Alert.alert('로그인 실패', data?.message ?? '오류가 발생했습니다. 다시 시도해주세요.');
        return;
      }

      const readOnly = data.role === 'manager';
      const nextRole = data.role === 'admin' || data.role === 'manager' ? 'admin' : 'fc';
      loginAs(nextRole, data.residentId ?? digits, data.displayName ?? '', readOnly);

      if (onSuccess) {
        onSuccess();
      } else {
        router.replace(nextRole === 'admin' ? '/' : '/home-lite');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '오류가 발생했습니다. 다시 시도해주세요.';
      Alert.alert('로그인 실패', message);
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
          contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardPadding + 40 }]}
          extraScrollHeight={140}
          keyboardShouldPersistTaps="always"
        >
          <View style={styles.innerContent}>
            {/* Logo Section */}
            <MotiView
              from={{ opacity: 0, translateY: -20 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 800, delay: 100 }}
              style={styles.logoContainer}
            >
              <Image source={Logo} style={styles.logo} resizeMode="contain" />
              <View style={styles.logoDecoration} />
            </MotiView>

            {/* Login Card */}
            <MotiView
              from={{ opacity: 0, translateY: 30, scale: 0.98 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              transition={{ type: 'spring', damping: 20, stiffness: 100, delay: 300 }}
              style={styles.card}
            >
              <View style={styles.headerSection}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>
                  관리자는 지정된 번호 + 비밀번호{'\n'}FC는 휴대폰 번호 + 비밀번호로 로그인해주세요.
                </Text>
              </View>

              {/* Phone Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.label}>휴대폰 번호</Text>
                <MotiView
                  animate={{
                    borderColor: isFocused ? HANWHA_ORANGE : BORDER,
                    shadowOpacity: isFocused ? 0.1 : 0,
                  }}
                  transition={{ type: 'timing', duration: 200 }}
                  style={styles.inputWrapper}
                >
                  <Feather name="smartphone" size={20} color={isFocused ? HANWHA_ORANGE : GRAY_TEXT} />
                  <TextInput
                    style={styles.input}
                    placeholder="01012345678"
                    placeholderTextColor={GRAY_TEXT}
                    value={phoneInput}
                    onChangeText={setPhoneInput}
                    keyboardType="phone-pad"
                    maxLength={13}
                    autoCapitalize="none"
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                  />
                </MotiView>
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.label}>비밀번호</Text>
                <MotiView
                  animate={{
                    borderColor: isPasswordFocused ? HANWHA_ORANGE : BORDER,
                    shadowOpacity: isPasswordFocused ? 0.1 : 0,
                  }}
                  transition={{ type: 'timing', duration: 200 }}
                  style={styles.inputWrapper}
                >
                  <Feather name="lock" size={20} color={isPasswordFocused ? HANWHA_ORANGE : GRAY_TEXT} />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="비밀번호"
                    placeholderTextColor={GRAY_TEXT}
                    value={passwordInput}
                    onChangeText={setPasswordInput}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    onFocus={() => setIsPasswordFocused(true)}
                    onBlur={() => setIsPasswordFocused(false)}
                    onSubmitEditing={handleLogin}
                  />
                  <Pressable
                    onPress={() => {
                      Haptics.selectionAsync();
                      setShowPassword(!showPassword);
                    }}
                    hitSlop={8}
                  >
                    <Feather
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={20}
                      color={GRAY_TEXT}
                    />
                  </Pressable>
                </MotiView>
              </View>

              {/* Login Button */}
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: 500, delay: 500 }}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.loginButton,
                    pressed && styles.loginButtonPressed,
                    loading && styles.loginButtonDisabled,
                  ]}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  <LinearGradient
                    colors={loading ? ['#ccc', '#aaa'] : [HANWHA_ORANGE, HANWHA_ORANGE_DARK]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.loginButtonGradient}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.loginButtonText}>로그인</Text>
                    )}
                  </LinearGradient>
                </Pressable>
              </MotiView>
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
  },
  innerContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 220,
    height: 240,
  },
  logoDecoration: {
    width: 60,
    height: 4,
    backgroundColor: HANWHA_ORANGE,
    borderRadius: 2,
    marginTop: -20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  headerSection: {
    marginBottom: 28,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: CHARCOAL,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: GRAY_TEXT,
    textAlign: 'center',
    lineHeight: 20,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: CHARCOAL,
    marginBottom: 8,
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: INPUT_BG,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 8,
    elevation: 0,
  },
  input: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: CHARCOAL,
    fontWeight: '500',
  },
  loginButton: {
    marginTop: 8,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: HANWHA_ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  loginButtonDisabled: {
    shadowOpacity: 0.1,
  },
  loginButtonGradient: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
