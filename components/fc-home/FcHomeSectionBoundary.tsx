import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ErrorBoundary } from '@/components/ErrorBoundary';

/** One failing home section shows a small retry card instead of replacing the whole home. */
export function FcHomeSectionBoundary({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(_error, resetError) => (
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>이 영역을 표시하지 못했습니다.</Text>
          <Pressable
            onPress={resetError}
            accessibilityRole="button"
            accessibilityLabel={`${title} 다시 시도`}
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, padding: 20, gap: 8, backgroundColor: '#ffffff', borderRadius: 24 },
  title: { fontSize: 18, fontWeight: '800', color: '#111827' },
  message: { fontSize: 14, color: '#4b5563' },
  retry: { alignSelf: 'flex-start', height: 40, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#f3f4f6', justifyContent: 'center' },
  retryPressed: { backgroundColor: '#e5e7eb' },
  retryText: { fontSize: 14, fontWeight: '700', color: '#374151' },
});
