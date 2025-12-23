import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const HANWHA_ORANGE = '#f36f21';
const HANWHA_ORANGE_DARK = '#d65a16';
const CHARCOAL = '#1F2937';
const GRAY_TEXT = '#6B7280';
const BORDER = '#E5E7EB';
const INPUT_BG = '#F9FAFB';

export default function ResetPasswordScreen() {
  const { logout } = useSession();
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  const handleRequest = async () => {
    Keyboard.dismiss();
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length !== 11) {
      Alert.alert('알림', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-password-reset', {
        body: { phone: digits },
      });
      if (error) {
        let detail = error.message;
        const context = (error as any)?.context as Response | undefined;
        if (context?.text) {
          try {
            detail = await context.text();
          } catch {
            // ignore
          }
        }
        console.warn('reset request failed', detail);
        throw new Error(detail || error.message);
      }
      if (!data?.ok) {
        Alert.alert('알림', data?.message ?? '요청에 실패했습니다.');
        return;
      }
      setRequested(true);
      Alert.alert(
        '안내',
        '인증 코드가 문자로 발송되었습니다.',
      );
    } catch (err: any) {
      const message = err?.message || '비밀번호 재설정 요청에 실패했습니다.';
      Alert.alert('오류', message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    Keyboard.dismiss();
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length !== 11) {
      Alert.alert('알림', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
      return;
    }
    if (!token.trim()) {
      Alert.alert('알림', '암호를 입력해주세요.');
      return;
    }
    const trimmedNew = newPassword.trim();
    const hasLetter = /[A-Za-z]/.test(trimmedNew);
    const hasNumber = /[0-9]/.test(trimmedNew);
    const hasSpecial = /[^A-Za-z0-9]/.test(trimmedNew);
    if (trimmedNew.length < 8 || !hasLetter || !hasNumber || !hasSpecial) {
      Alert.alert('알림', '비밀번호는 8자 이상이며 영문+숫자+특수문자를 포함해야 합니다.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('reset-password', {
        body: {
          phone: digits,
          token: token.trim(),
          newPassword: trimmedNew,
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        Alert.alert('알림', data?.message ?? '재설정에 실패했습니다.');
        return;
      }

      await supabase.auth.signOut().catch(() => {});
      logout();
      Alert.alert('완료', '비밀번호 변경됨');
      router.replace('/login');
    } catch {
      Alert.alert('오류', '비밀번호 재설정에 실패했습니다.');
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
        <KeyboardAwareWrapper contentContainerStyle={styles.scrollContent} extraScrollHeight={140}>
          <View style={styles.innerContent}>
            <MotiView
              from={{ opacity: 0, translateY: 30, scale: 0.98 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              transition={{ type: 'spring', damping: 20, stiffness: 100, delay: 200 }}
              style={styles.card}
            >
              <View style={styles.headerSection}>
                <Text style={styles.title}>비밀번호 재설정</Text>
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
                  loading && styles.buttonDisabled,
                ]}
                onPress={handleRequest}
                disabled={loading}
              >
                <Text style={styles.subButtonText}>
                  {requested ? '인증 코드 다시 받기' : '인증 코드 받기'}
                </Text>
              </Pressable>

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
                    placeholder="6자리 숫자 코드"
                    placeholderTextColor="#9CA3AF"
                    value={token}
                    onChangeText={setToken}
                    keyboardType="number-pad"
                    editable={!loading}
                  />
                </MotiView>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>새 비밀번호</Text>
                <MotiView
                  animate={{
                    borderColor: BORDER,
                    backgroundColor: INPUT_BG,
                  }}
                  transition={{ type: 'timing', duration: 200 }}
                  style={styles.inputWrapper}
                >
                  <TextInput
                    style={[styles.input, styles.inputWithIcon]}
                    placeholder="8자 이상, 영문+숫자+특수문자"
                    placeholderTextColor="#9CA3AF"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    autoCapitalize="none"
                    secureTextEntry={!showPassword}
                    editable={!loading}
                  />
                  <Pressable
                    style={styles.eyeButton}
                    onPress={() => setShowPassword((prev) => !prev)}
                  >
                    <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={GRAY_TEXT} />
                  </Pressable>
                </MotiView>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.buttonPressed,
                  loading && styles.buttonDisabled,
                ]}
                onPress={handleReset}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>비밀번호 변경</Text>
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
    paddingTop: '10%',
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
    marginBottom: 28,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: CHARCOAL,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: GRAY_TEXT,
    textAlign: 'center',
    lineHeight: 20,
  },
  inputContainer: {
    gap: 8,
    marginBottom: 18,
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
  inputWithIcon: {
    paddingRight: 44,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 32,
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
    marginBottom: 18,
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
    backgroundColor: '#FFD4C0',
    shadowOpacity: 0,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
