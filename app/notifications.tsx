import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  RefreshControl,
  Alert,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { MotiView } from 'moti';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

type Notice = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  created_at?: string | null;
  source: 'notification' | 'notice';
};

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';
const BACKGROUND = '#ffffff';

export default function NotificationsScreen() {
  const { role, residentId, hydrated } = useSession();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPushNotifications = useCallback(async (): Promise<Notice[]> => {
    if (!role) return [];

    const baseQuery = supabase
      .from('notifications')
      .select('id,title,body,category,created_at,resident_id,recipient_role')
      .order('created_at', { ascending: false });

    let data;
    let error;

    if (role === 'fc') {
      const residentFilter = residentId ? [residentId, null] : [null];
      ({ data, error } = await baseQuery.eq('recipient_role', 'fc').in('resident_id', residentFilter));
    } else {
      ({ data, error } = await baseQuery.eq('recipient_role', 'admin'));
    }

    if (error && (error as any)?.code !== '42P01') throw error;

    return (data ?? []).map((item: any) => ({
      id: `notification:${item.id}`,
      title: item.title,
      body: item.body,
      category: item.category ?? '알림',
      created_at: item.created_at,
      source: 'notification',
    }));
  }, [residentId, role]);

  const fetchNotices = useCallback(async (): Promise<Notice[]> => {
    const { data, error } = await supabase
      .from('notices')
      .select('id,title,body,category,created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error && (error as any)?.code !== '42P01') throw error;

    return (data ?? []).map((item: any) => ({
      id: `notice:${item.id}`,
      title: item.title,
      body: item.body,
      category: item.category ?? '공지',
      created_at: item.created_at,
      source: 'notice',
    }));
  }, []);

  const load = useCallback(async () => {
    if (!hydrated) return;
    try {
      const [pushRows, noticeRows] = await Promise.all([fetchPushNotifications(), fetchNotices()]);
      const merged = [...pushRows, ...noticeRows].sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
      });
      setNotices(merged);
    } catch (err: any) {
      console.warn(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchNotices, fetchPushNotifications, hydrated]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const renderItem = ({ item, index }: { item: Notice; index: number }) => {
    const isNotice = item.source === 'notice';
    const iconName = isNotice ? 'mic' : 'bell';
    const iconColor = isNotice ? HANWHA_ORANGE : '#3B82F6';
    const bgIcon = isNotice ? '#FFF7ED' : '#EFF6FF';

    return (
      <MotiView
        from={{ opacity: 0, translateY: 10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ delay: index * 50 }}
      >
        <Pressable
          style={styles.itemContainer}
          onPress={() => Alert.alert(item.title, item.body, [{ text: '확인' }])}
          android_ripple={{ color: '#F3F4F6' }}
        >
          <View style={[styles.iconBox, { backgroundColor: bgIcon }]}>
            <Feather name={iconName} size={20} color={iconColor} />
          </View>
          <View style={styles.contentBox}>
            <View style={styles.titleRow}>
              <Text style={styles.category}>{item.category}</Text>
              <Text style={styles.date}>{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</Text>
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.body} numberOfLines={2}>
              {item.body}
            </Text>
          </View>
        </Pressable>
      </MotiView>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>알림 센터</Text>
        <RefreshButton onPress={load} />
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator color={HANWHA_ORANGE} />
        </View>
      ) : (
        <FlatList
          data={notices}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="bell-off" size={48} color="#E5E7EB" />
              <Text style={styles.emptyText}>새로운 알림이 없습니다.</Text>
            </View>
          }
        />
      )}
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
  headerTitle: { fontSize: 22, fontWeight: '800', color: CHARCOAL },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 20, paddingBottom: 40 },

  itemContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'flex-start',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  contentBox: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  category: { fontSize: 12, fontWeight: '700', color: HANWHA_ORANGE },
  date: { fontSize: 12, color: '#9CA3AF' },
  title: { fontSize: 16, fontWeight: '700', color: CHARCOAL },
  body: { fontSize: 14, color: MUTED, lineHeight: 20 },

  emptyState: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: MUTED },
});
