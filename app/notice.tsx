import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MotiView } from 'moti';
import { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardSkeleton } from '@/components/LoadingSkeleton';
import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

type AttachedFile = {
  name: string;
  url: string;
  type: string;
};

type Notice = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  created_at: string;
  images: string[] | null;
  files: AttachedFile[] | null;
};

const fetchNotices = async (): Promise<Notice[]> => {
  const { data, error } = await supabase
    .from('notices')
    .select('id,title,body,category,created_at,images,files')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
};

export default function NoticeScreen() {
  const { role } = useSession();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notices', 'list'],
    queryFn: fetchNotices,
  });

  const [refreshing, setRefreshing] = useState(false);
  const notices = useMemo(() => data ?? [], [data]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notices').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert('삭제 완료', '공지사항이 삭제되었습니다.');
      refetch();
    },
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '삭제 중 문제가 발생했습니다.';
        Alert.alert('오류', message);
      }
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = (id: string) => {
    Alert.alert('공지 삭제', '이 공지사항을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  const handleOpenLink = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('오류', '이 파일을 열 수 없습니다.');
      }
    } catch {
      Alert.alert('오류', '파일 링크를 여는 중 문제가 발생했습니다.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>공지사항</Text>
        <RefreshButton onPress={onRefresh} />
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {isLoading && !refreshing && (
          <>
            <CardSkeleton showHeader lines={4} />
            <CardSkeleton showHeader lines={3} />
            <CardSkeleton showHeader lines={5} />
          </>
        )}

        {isError && (
          <View style={styles.emptyBox}>
            <Feather name="alert-circle" size={24} color="#EF4444" />
            <Text style={styles.errorText}>공지를 불러오지 못했습니다.</Text>
          </View>
        )}

        {!isLoading && !notices.length && (
          <View style={styles.emptyBox}>
            <Feather name="inbox" size={40} color="#E5E7EB" />
            <Text style={styles.emptyText}>등록된 공지가 없습니다.</Text>
          </View>
        )}

        {notices.map((n, index) => (
          <MotiView
            key={n.id}
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ delay: index * 50 }}
          >
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{n.category || '공지'}</Text>
                </View>
                <View style={styles.headerActions}>
                  <Text style={styles.date}>{new Date(n.created_at).toLocaleDateString()}</Text>
                  {role === 'admin' && (
                    <Feather name="trash-2" size={18} color="#9CA3AF" onPress={() => handleDelete(n.id)} />
                  )}
                </View>
              </View>
              <Text style={styles.noticeTitle}>{n.title}</Text>
              <View style={styles.divider} />
              <Text style={styles.body}>{n.body}</Text>

              {/* Images Carousel */}
              {n.images && n.images.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll}>
                  {n.images.map((imgUrl, i) => (
                    <Pressable key={i} onPress={() => handleOpenLink(imgUrl)}>
                      <Image source={{ uri: imgUrl }} style={styles.noticeImage} />
                    </Pressable>
                  ))}
                </ScrollView>
              )}

              {/* Files List */}
              {n.files && n.files.length > 0 && (
                <View style={styles.fileList}>
                  {n.files.map((file, i) => (
                    <Pressable key={i} style={styles.fileItem} onPress={() => handleOpenLink(file.url)}>
                      <Feather name="paperclip" size={14} color={COLORS.text.secondary} />
                      <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                      <Feather name="download-cloud" size={14} color={COLORS.primary} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </MotiView>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray[100],
  },
  title: { fontSize: TYPOGRAPHY.fontSize['2xl'], fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary },

  container: { padding: SPACING.xl, paddingBottom: 64, gap: SPACING.lg },

  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.lg,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  badge: {
    backgroundColor: COLORS.warning.light,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  badgeText: { color: COLORS.primary, fontSize: TYPOGRAPHY.fontSize['2xs'], fontWeight: TYPOGRAPHY.fontWeight.bold },
  date: { color: COLORS.text.muted, fontSize: TYPOGRAPHY.fontSize.xs },

  noticeTitle: { fontSize: TYPOGRAPHY.fontSize.lg, fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary, lineHeight: 26 },
  divider: { height: 1, backgroundColor: COLORS.gray[100], marginVertical: SPACING.base },
  body: { color: COLORS.gray[700], lineHeight: 24, fontSize: TYPOGRAPHY.fontSize.base },

  imageScroll: { marginTop: SPACING.base },
  noticeImage: {
    width: 200,
    height: 150,
    borderRadius: RADIUS.base,
    marginRight: SPACING.sm,
    resizeMode: 'cover',
    backgroundColor: COLORS.gray[100],
  },

  fileList: { marginTop: SPACING.base, gap: SPACING.sm },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.sm,
    backgroundColor: COLORS.background.secondary,
    borderRadius: RADIUS.base,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  fileName: { flex: 1, fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.gray[700] },

  emptyBox: { alignItems: 'center', marginTop: 60, gap: SPACING.sm },
  emptyText: { color: COLORS.text.secondary, fontSize: TYPOGRAPHY.fontSize.base },
  errorText: { color: COLORS.error, fontSize: TYPOGRAPHY.fontSize.base },
});
