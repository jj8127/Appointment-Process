import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { FormInput } from '@/components/FormInput';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import Logo from '@/assets/images/logo.png';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';



export default function AuthScreen() {
  const { skipAuto } = useLocalSearchParams<{ skipAuto?: string }>();
  const skipAutoRedirect = skipAuto === '1';
  const { loginAs, role, residentId, hydrated } = useSession();
  const [phoneInput, setPhoneInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loading, setLoading] = useState(false);
  const keyboardPadding = useKeyboardPadding();

  useEffect(() => {
    if (skipAutoRedirect) return;
    if (!hydrated) return;
    if (role === 'admin') {
      router.replace('/');
      return;
    }
    if (role === 'fc' && residentId) {
      router.replace('/home-lite');
    }
  }, [hydrated, residentId, role, skipAutoRedirect]);

  const handleLogin = async () => {
    // Remove all whitespace for robust handling (e.g. '1111 ', ' 1111', '1 1 1 1')
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

      const { data, error } = await supabase.functions.invoke('login-with-password', {
        body: { phone: digits, password: passwordInput.trim() },
      });
      if (error) throw error;
      if (!data?.ok) {
        if (
          (data?.code === 'needs_password_setup' || data?.code === 'not_found')
          && data?.role !== 'admin'
          && data?.role !== 'manager'
        ) {
          Alert.alert('안내', '계정정보가 없습니다. 회원가입 페이지로 이동합니다..');
          router.replace('/signup');
          return;
        }
        Alert.alert('로그인 실패', data?.message ?? '오류가 발생했습니다. 다시 시도해주세요.');
        return;
      }

      const readOnly = data.role === 'manager';
      const nextRole = data.role === 'admin' || data.role === 'manager' ? 'admin' : 'fc';
      loginAs(nextRole, data.residentId ?? digits, data.displayName ?? '', readOnly);
      router.replace(nextRole === 'admin' ? '/' : '/home-lite');
      return;
    } catch {
      Alert.alert('로그인 실패', '오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Background Gradient */}
      <LinearGradient
        // colors={['#FFF', '#FFF8F3', '#FFE4D6']}
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
                <Text style={styles.title}>환영합니다!</Text>
                <Text style={styles.subtitle}>
                  관리자는 지정된 번호 + 비밀번호{'\n'}FC는 휴대폰 번호 + 비밀번호로 로그인해주세요.
                </Text>
              </View>

              <FormInput
                label="휴대폰 번호"
                placeholder="번호 입력 (- 없이 숫자만)"
                value={phoneInput}
                onChangeText={setPhoneInput}
                autoCapitalize="none"
                keyboardType="number-pad"
                returnKeyType="next"
                onSubmitEditing={handleLogin}
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

              <FormInput
                label="비밀번호"
                variant="password"
                placeholder="8자 이상, 영문+숫자+특수문자"
                value={passwordInput}
                onChangeText={setPasswordInput}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                editable={!loading}
                containerStyle={styles.inputContainer}
              />


                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    pressed && styles.buttonPressed,
                    loading && styles.buttonDisabled,
                  ]}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>시작하기</Text>
                  )}
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}
                  onPress={() => router.push('/reset-password')}
                >
                  <Text style={styles.linkButtonText}>비밀번호를 잊으셨나요?</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}
                  onPress={() => router.push('/signup')}
                >
                  <Text style={styles.linkButtonText}>회원가입</Text>
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
    paddingTop: '15%',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING['2xl'],
  },
  innerContent: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 0,
    position: 'relative',
  },
  logo: {
    width: 220,
    height: 240,
  },
  logoDecoration: {
    position: 'absolute',
    bottom: SPACING.lg,
    width: SPACING['2xl'],
    height: SPACING.xs,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.sm,
    opacity: 0.2,
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
    fontSize: TYPOGRAPHY.fontSize['3xl'],
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
    marginBottom: SPACING.sm,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: TYPOGRAPHY.fontSize.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.base,
  },
  inputContainer: {
    marginBottom: SPACING.base,
  },
  button: {
    height: 56,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonPressed: {
    backgroundColor: COLORS.primaryDark,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    backgroundColor: COLORS.primaryLight,
    shadowOpacity: 0,
  },
  buttonText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.white,
  },
  linkButton: {
    marginTop: SPACING.base,
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  linkButtonPressed: {
    opacity: 0.7,
  },
  linkButtonText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.secondary,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    textDecorationLine: 'underline',
  },
});
