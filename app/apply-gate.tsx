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
  const { role, hydrated, isRequestBoardDesigner } = useSession();
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
    if (isRequestBoardDesigner) {
      const nextPath = (typeof next === 'string' && next) ? (next as Href) : ('/' as Href);
      router.replace(nextPath);
      return;
    }
    if (!isLoading && data?.identityCompleted) {
      const nextPath = (typeof next === 'string' && next) ? (next as Href) : ('/' as Href);
      router.replace(nextPath);
    }
  }, [data?.identityCompleted, hydrated, isLoading, isRequestBoardDesigner, next, role]);

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Feather name="shield" size={20} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>추가 정보 입력 안내</Text>
          <Text style={styles.body}>앱의 모든 기능을 사용하기 위해서는 추가 정보 입력이 필요합니다.</Text>
          <Text style={styles.body}>먼저 주민번호와 주소를 입력해 주세요.</Text>
          <Text style={styles.body}>입력이 완료되면 설계 요청, 메신저, 공지/알림, 위촉 관련 기능을 모두 이용할 수 있습니다.</Text>
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
            accessibilityLabel="추가 정보 입력 시작"
          >
            추가 정보 입력 시작
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
