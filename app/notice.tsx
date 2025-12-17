import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MotiView } from 'moti';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const CHARCOAL = '#111827';
const BORDER = '#E5E7EB';
const HANWHA_ORANGE = '#f36f21';
const MUTED = '#6b7280';
const BACKGROUND = '#ffffff';

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
    onError: (err: any) => Alert.alert('오류', err?.message ?? '삭제 중 문제가 발생했습니다.'),
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
    } catch (error) {
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
        {isLoading && !refreshing && <ActivityIndicator color={HANWHA_ORANGE} style={{ marginTop: 20 }} />}

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
                      <Feather name="paperclip" size={14} color={MUTED} />
                      <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                      <Feather name="download-cloud" size={14} color={HANWHA_ORANGE} />
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
  safe: { flex: 1, backgroundColor: BACKGROUND },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  title: { fontSize: 22, fontWeight: '800', color: CHARCOAL },

  container: { padding: 24, paddingBottom: 64, gap: 20 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
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
    marginBottom: 12,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: { color: HANWHA_ORANGE, fontSize: 12, fontWeight: '700' },
  date: { color: '#9CA3AF', fontSize: 13 },

  noticeTitle: { fontSize: 18, fontWeight: '800', color: CHARCOAL, lineHeight: 26 },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 16 },
  body: { color: '#374151', lineHeight: 24, fontSize: 15 },

  imageScroll: { marginTop: 16 },
  noticeImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
    marginRight: 10,
    resizeMode: 'cover',
    backgroundColor: '#F3F4F6',
  },

  fileList: { marginTop: 16, gap: 8 },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  fileName: { flex: 1, fontSize: 14, color: '#374151' },

  emptyBox: { alignItems: 'center', marginTop: 60, gap: 10 },
  emptyText: { color: MUTED, fontSize: 15 },
  errorText: { color: '#EF4444', fontSize: 15 },
});
