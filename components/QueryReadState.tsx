import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { isReadSessionError } from '@/lib/home-read-state';

type Props = {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  error?: unknown;
};

/** Keep failed reads separate from a successful empty result. */
export function QueryReadState({ message, onRetry, retrying = false, error }: Props) {
  const needsRelogin = isReadSessionError(error);
  return (
    <View style={styles.container}>
      <Text accessibilityRole="alert" style={styles.message}>{needsRelogin ? '세션을 확인할 수 없습니다. 다시 로그인해주세요.' : message}</Text>
      {needsRelogin ? (
        <Pressable accessibilityRole="button" onPress={() => router.replace('/login?skipAuto=1')} style={styles.retry}>
          <Text style={styles.retryText}>다시 로그인</Text>
        </Pressable>
      ) : onRetry && (
        <Pressable accessibilityRole="button" onPress={onRetry} disabled={retrying} style={styles.retry}>
          <Text style={styles.retryText}>{retrying ? '다시 불러오는 중...' : '다시 시도'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8, alignItems: 'center' },
  message: { color: '#6b7280', textAlign: 'center', fontSize: 14 },
  retry: { paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { color: '#f36f21', fontWeight: '700' },
});
