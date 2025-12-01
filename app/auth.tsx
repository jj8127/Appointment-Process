import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import Logo from '../logo.png';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';

export default function AuthScreen() {
  const { loginAs, role, residentId, hydrated } = useSession();
  const [residentInput, setResidentInput] = useState('');
  const keyboardPadding = useKeyboardPadding();

  useEffect(() => {
    if (!hydrated) return;
    if (role && (role === 'admin' || residentId)) {
      router.replace('/');
    }
  }, [hydrated, residentId, role]);

  const handleLogin = async () => {
    const code = residentInput.trim();
    if (!code) {
      Alert.alert('입력 필요', '주민번호 또는 관리자 코드를 입력해주세요.');
      return;
    }

    if (code === '1111') {
      loginAs('admin', '');
      router.replace('/');
      return;
    }

    const digits = code.replace(/[^0-9]/g, '');
    const masked = digits.length >= 6 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : digits;

    const { data, error } = await supabase
      .from('fc_profiles')
      .select('resident_id_masked,name')
      .in('resident_id_masked', [masked, digits])
      .maybeSingle();

    if (error) {
      Alert.alert('로그인 실패', error.message);
      return;
    }
    if (!data) {
      Alert.alert('FC 정보가 없습니다.', '관리자에게 문의해주세요.');
      return;
    }

    loginAs('fc', data.resident_id_masked ?? masked, data.name ?? '');
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 100 }]}
          keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Image source={Logo} style={styles.logo} resizeMode="contain" />
            <Text style={styles.brand}>한화 FC 패스</Text>
          </View>
          <Text style={styles.title}>로그인</Text>
          <Text style={styles.description}>관리자는 코드, FC는 주민번호로 로그인하세요.</Text>
          <View style={styles.card}>
            <Text style={styles.label}>주민번호 또는 코드</Text>
            <TextInput
              style={styles.input}
              placeholder="예) 9010101234567"
              placeholderTextColor="#9CA3AF"
              value={residentInput}
              onChangeText={setResidentInput}
              autoCapitalize="none"
              keyboardType="number-pad"
            />
            <Button title="로그인하기" onPress={handleLogin} color={ORANGE} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
