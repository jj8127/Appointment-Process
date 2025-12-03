import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { MotiView } from 'moti';

import { RefreshButton } from '@/components/RefreshButton';
import { supabase } from '@/lib/supabase';

const CHARCOAL = '#111827';
const BORDER = '#E5E7EB';
const HANWHA_ORANGE = '#f36f21';
const MUTED = '#6b7280';
const BACKGROUND = '#ffffff';

type Notice = { id: string; title: string; body: string; category: string | null; created_at: string };

const fetchNotices = async (): Promise<Notice[]> => {
  const { data, error } = await supabase
    .from('notices')
    .select('id,title,body,category,created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
};

export default function NoticeScreen() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notices', 'list'],
    queryFn: fetchNotices,
  });

  const [refreshing, setRefreshing] = useState(false);
  const notices = useMemo(() => data ?? [], [data]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
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
                <Text style={styles.date}>{new Date(n.created_at).toLocaleDateString()}</Text>
              </View>
              <Text style={styles.noticeTitle}>{n.title}</Text>
              <View style={styles.divider} />
              <Text style={styles.body}>{n.body}</Text>
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

  emptyBox: { alignItems: 'center', marginTop: 60, gap: 10 },
  emptyText: { color: MUTED, fontSize: 15 },
  errorText: { color: '#EF4444', fontSize: 15 },
});
