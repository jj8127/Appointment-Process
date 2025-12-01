import { useEffect, useState } from 'react';
import { Alert, Button, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import Logo from '../logo.png';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';

export default function AuthScreen() {
  const { loginAs, role, residentId, hydrated } = useSession();
  const [phoneInput, setPhoneInput] = useState('');
  const keyboardPadding = useKeyboardPadding();

  useEffect(() => {
    if (!hydrated) return;
    if (role && (role === 'admin' || residentId)) {
      router.replace('/');
    }
  }, [hydrated, residentId, role]);

  const handleLogin = async () => {
    const code = phoneInput.trim();
    if (!code) {
      Alert.alert('입력 필요', '휴대폰 번호를 입력해주세요.');
      return;
    }

    if (code === '1111') {
      loginAs('admin', '');
      router.replace('/');
      return;
    }

    const digits = code.replace(/[^0-9]/g, '');

    const { data, error } = await supabase
      .from('fc_profiles')
      .select('id,phone,name')
      .eq('phone', digits)
      .maybeSingle();

    if (error) {
      Alert.alert('로그인 실패', error.message);
      return;
    }
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
      if (insertErr) {
        Alert.alert('로그인 실패', insertErr.message ?? '가입 중 오류가 발생했습니다.');
        return;
      }
      loginAs('fc', inserted?.phone ?? digits, inserted?.name ?? '');
      router.replace('/');
      return;
    }

    loginAs('fc', data.phone ?? digits, data.name ?? '');
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAwareWrapper contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 100 }]}>
        <View style={styles.hero}>
          <Image source={Logo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brand}>한화 FC 온보딩</Text>
        </View>
          <Text style={styles.title}>로그인</Text>
          <Text style={styles.description}>관리자는 코드, FC는 휴대폰 번호로 로그인하세요.</Text>
          <View style={styles.card}>
            <Text style={styles.label}>휴대폰 번호</Text>
            <TextInput
              style={styles.input}
              placeholder="예) 01012345678"
              placeholderTextColor="#9CA3AF"
              value={phoneInput}
              onChangeText={setPhoneInput}
              autoCapitalize="none"
              keyboardType="number-pad"
            />
            <Button title="로그인" onPress={handleLogin} color={ORANGE} />
          </View>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flexGrow: 1, padding: 24, gap: 16 },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    gap: 10,
  },
  logo: { width: 180, height: 60 },
  brand: {
    color: CHARCOAL,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: { color: CHARCOAL, fontSize: 26, fontWeight: '800', marginTop: 12 },
  description: { color: '#4b5563', fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: ORANGE_LIGHT,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
    marginTop: 12,
  },
  label: { fontWeight: '700', color: CHARCOAL },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
  },
});
