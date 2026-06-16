import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import BrandedLoadingState from '@/components/BrandedLoadingState';
import { COLORS } from '@/lib/theme';

export default function BoardDetailScreen() {
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  const postIdValue = useMemo(() => {
    const value = Array.isArray(postId) ? postId[0] : postId;
    return typeof value === 'string' ? value.trim() : '';
  }, [postId]);

  useEffect(() => {
    if (postIdValue) {
      router.replace({ pathname: '/board', params: { postId: postIdValue } } as any);
      return;
    }
    router.replace('/board');
  }, [postIdValue, router]);

  return (
    <View style={styles.safe}>
      <BrandedLoadingState variant="detail" />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
});
