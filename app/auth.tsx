import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
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
const CHARCOAL = '#111827';
const GRAY_TEXT = '#4B5563';
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
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAwareWrapper
        contentContainerStyle={[styles.container, { paddingBottom: 20 }]}
        extraScrollHeight={140}>
        <View style={styles.logoContainer}>
          <Image source={Logo} style={styles.logo} resizeMode="contain" />
        </View>

        <View style={styles.formSection}>
          <Text style={styles.title}>로그인</Text>
          <Text style={styles.subtitle}>
            관리자는 코드, FC는 휴대폰 번호를 입력해주세요.
          </Text>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>휴대폰 번호 / 관리자 코드</Text>
            <TextInput
              style={styles.input}
              placeholder="휴대폰 번호 (- 없이 숫자만 입력)"
              placeholderTextColor="#9CA3AF"
              value={phoneInput}
              onChangeText={setPhoneInput}
              autoCapitalize="none"
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              editable={!loading}
            />
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
        </View>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
  flexGrow: 1,
  paddingHorizontal: 24,
  // justifyContent: 'center',  <-- 이 줄을 삭제하거나 주석 처리하세요.
  paddingTop: 80, // 여백 축소
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 1,
  },
  logo: {
    width: 220,
    height: 220, // 로고를 더 크게 노출
  },
  formSection: {
    gap: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: CHARCOAL,
    marginBottom: -12, // subtitle과의 간격 조절
  },
  subtitle: {
    fontSize: 15,
    color: GRAY_TEXT,
    lineHeight: 22,
  },
  inputContainer: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: CHARCOAL,
  },
  input: {
    height: 52,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8, // 둥근 정도를 줄여서 더 단정하게
    paddingHorizontal: 16,
    fontSize: 16,
    color: CHARCOAL,
  },
  button: {
    height: 52,
    backgroundColor: HANWHA_ORANGE,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    backgroundColor: '#fed7aa', // 연한 오렌지
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
