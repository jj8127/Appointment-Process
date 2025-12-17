import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import Logo from '../logo.png';

const HANWHA_ORANGE = '#f36f21';
const HANWHA_ORANGE_DARK = '#d65a16';
const CHARCOAL = '#1F2937';
const GRAY_TEXT = '#6B7280';
const BORDER = '#E5E7EB';
const INPUT_BG = '#F9FAFB';

const ADMIN_PHONE_NUMBERS = (process.env.EXPO_PUBLIC_ADMIN_PHONES ?? '')
  .split(',')
  .map((phone) => phone.replace(/[^0-9]/g, ''))
  .filter(Boolean);

export default function AuthScreen() {
  const { loginAs, role, residentId, hydrated, displayName } = useSession();
  const [phoneInput, setPhoneInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (role === 'admin') {
      router.replace('/');
      return;
    }
    if (role === 'fc' && residentId) {
      // 기본 정보가 없으면 인적사항 입력 페이지로 유도
      if (!displayName?.trim()) {
        router.replace('/fc/new');
      } else {
        router.replace('/');
      }
    }
  }, [hydrated, residentId, role, displayName]);

  const handleLogin = async () => {
    const code = phoneInput.trim();
    if (!code) {
      Alert.alert('알림', '휴대폰 번호를 입력해주세요.');
      return;
    }
    Haptics.selectionAsync();
    setLoading(true);

    try {
      if (code === '1111') {
        // 식별자가 없으면 푸시 토큰 등록이 스킵되므로 명시적으로 저장
        loginAs('admin', 'admin', '총무');
        router.replace('/');
        return;
      }

      const digits = code.replace(/[^0-9]/g, '');
      if (digits.length !== 11) {
        Alert.alert('알림', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
        return;
      }
      if (ADMIN_PHONE_NUMBERS.includes(digits)) {
        loginAs('admin', digits, '총무');
        router.replace('/');
        return;
      }
      const { data, error } = await supabase
        .from('fc_profiles')
        .select('id,phone,name')
        .eq('phone', digits)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        const { data: inserted, error: insertErr } = await supabase
          .from('fc_profiles')
          .insert({
            phone: digits,
            name: '',
            affiliation: '',
            recommender: '',
            email: '',
            address: '',
            status: 'draft',
          })
          .select('phone,name')
          .single();
        if (insertErr) throw insertErr;
        loginAs('fc', inserted?.phone ?? digits, inserted?.name ?? '');
        router.replace('/fc/new');
        return;
      } else {
        loginAs('fc', data.phone ?? digits, data.name ?? '');
        if (!data.name || data.name.trim() === '') {
          router.replace('/fc/new');
        } else {
          router.replace('/');
        }
        return;
      }
    } catch (err: any) {
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
          contentContainerStyle={styles.scrollContent}
          extraScrollHeight={140}

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
                  관리자는 코드, FC는 휴대폰 번호로{'\n'}로그인해주세요.
                </Text>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>휴대폰 번호 / 관리자 코드</Text>
                <MotiView
                  animate={{
                    borderColor: isFocused ? HANWHA_ORANGE : BORDER,
                    backgroundColor: isFocused ? '#FFF' : INPUT_BG,
                  }}
                  transition={{ type: 'timing', duration: 200 }}
                  style={styles.inputWrapper}
                >
                  <TextInput
                    style={styles.input}
                    placeholder="번호 입력 (- 없이 숫자만)"
                    placeholderTextColor="#9CA3AF"
                    value={phoneInput}
                    onChangeText={(text) => setPhoneInput(text)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    autoCapitalize="none"
                    keyboardType="number-pad"
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
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
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>시작하기</Text>
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
    paddingTop: '15%',
    paddingHorizontal: 20,
    paddingBottom: 40,
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
    bottom: 20,
    width: 40,
    height: 4,
    backgroundColor: HANWHA_ORANGE,
    borderRadius: 2,
    opacity: 0.2, // Subtle decoration
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
    marginBottom: 32,
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: CHARCOAL,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: GRAY_TEXT,
    textAlign: 'center',
    lineHeight: 22,
  },
  inputContainer: {
    gap: 8,
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: CHARCOAL,
    marginLeft: 4,
    marginBottom: 4,
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
  buttonPressed: {
    backgroundColor: HANWHA_ORANGE_DARK,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    backgroundColor: '#FFD4C0',
    shadowOpacity: 0,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
});
