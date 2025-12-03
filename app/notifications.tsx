import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, KeyboardAvoidingView, Platform, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

const ORANGE = '#f36f21';
const GRAY = '#6b7280';
const BORDER = '#e5e7eb';

export default function NotificationsScreen() {
  const { role, residentId, hydrated } = useSession();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    if (error) {
      if ((error as any)?.code === '42P01') return [];
      throw error;
    }

    return (data ?? []).map((item: any) => ({
      id: `notification:${item.id}`,
      title: item.title,
      body: item.body,
      category: item.category ?? '앱 알림',
      created_at: item.created_at,
      source: 'notification',
    }));
  }, [residentId, role]);

  const fetchNotices = useCallback(async (): Promise<Notice[]> => {
    const { data, error } = await supabase
      .from('notices')
      .select('id,title,body,category,created_at')
      .order('created_at', { ascending: false });

    if (error) {
      if ((error as any)?.code === '42P01') return [];
      throw error;
    }

    return (data ?? []).map((item: any) => ({
      id: `notice:${item.id}`,
      title: item.title,
      body: item.body,
      category: item.category ?? '공지사항',
      created_at: item.created_at,
      source: 'notice',
    }));
  }, []);

  const load = useCallback(async () => {
    if (!hydrated) return;
    setLoading(true);
    setError(null);
    try {
      const [pushRows, noticeRows] = await Promise.all([fetchPushNotifications(), fetchNotices()]);
      const merged = [...pushRows, ...noticeRows].sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
      });
      setNotices(merged);
    } catch (err: any) {
      setError(err?.message ?? '로딩에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [fetchNotices, fetchPushNotifications, hydrated]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>알림</Text>
            <RefreshButton onPress={load} />
          </View>
          {loading ? (
            <ActivityIndicator color={ORANGE} />
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <FlatList
              data={notices}
              keyExtractor={(item) => item.id}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.card}
                  onPress={() => Alert.alert(item.title, item.body, [{ text: '닫기' }])}
                  android_ripple={{ color: '#f3f4f6' }}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.category || '공지사항'}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardBody} numberOfLines={2}>
                    {item.body}
                  </Text>
                  {item.created_at ? (
                    <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                  ) : null}
                </Pressable>
              )}
              ListEmptyComponent={<Text style={styles.empty}>알림이 없습니다.</Text>}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff7f0' },
  container: { flex: 1, padding: 20, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#111827' },
  error: { color: '#dc2626' },
  separator: { height: 12 },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff1e6',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  badgeText: { color: ORANGE, fontWeight: '700', fontSize: 12 },
  cardTitle: { color: '#111827', fontWeight: '800', fontSize: 16 },
  cardBody: { color: GRAY, lineHeight: 20 },
  cardDate: { color: GRAY, fontSize: 12 },
  empty: { color: GRAY, textAlign: 'center', marginTop: 20 },
});
