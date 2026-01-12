import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { useSession } from '@/hooks/use-session';
import { useIdentityStatus } from '@/hooks/use-identity-status';
import { COLORS } from '@/lib/theme';

export default function ApplyGateScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { role, hydrated } = useSession();
  const { data, isLoading } = useIdentityStatus();

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
      return;
    }
    if (role === 'admin') {
      router.replace('/');
      return;
    }
    if (!isLoading && data?.identityCompleted) {
      const nextPath = (typeof next === 'string' && next) ? (next as Href) : ('/' as Href);
      router.replace(nextPath);
    }
  }, [data?.identityCompleted, hydrated, isLoading, next, role]);

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Feather name="shield" size={20} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>위촉(등록) 신청 안내</Text>
          <Text style={styles.body}>지금부터는 설계사 위촉(등록) 신청 절차를 시작합니다.</Text>
          <Text style={styles.body}>임시사번 발급 및 등록 서류 처리에 주민번호/주소가 필수입니다.</Text>
          <Text style={styles.body}>둘러보기/문의 기능은 입력 없이 이용 가능합니다.</Text>
        </View>

        <View style={styles.buttonRow}>
          <Button
            onPress={() => router.replace('/home-lite')}
            variant="outline"
            size="md"
            style={styles.button}
            accessibilityLabel="나중에"
          >
            나중에
          </Button>
          <Button
            onPress={() =>
              router.push({
                pathname: '/identity',
                params: { next: typeof next === 'string' && next ? next : '/' },
              })
            }
            variant="primary"
            size="md"
            style={styles.button}
            accessibilityLabel="등록 신청 시작"
          >
            등록 신청 시작
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 20, gap: 20 },
  card: {
    backgroundColor: '#fff7f0',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#fed7aa',
    gap: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.text.primary },
  body: { fontSize: 14, color: COLORS.text.secondary, lineHeight: 20 },
  buttonRow: { flexDirection: 'row', gap: 12 },
  button: {
    flex: 1,
  },
});
