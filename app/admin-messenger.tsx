import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormInput } from '@/components/FormInput';
import { RefreshButton } from '@/components/RefreshButton';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/hooks/use-session';

const CHARCOAL = '#111827';
const MUTED = '#6b7280';

type ChatPreview = {
  fc_id: string;
  name: string;
  phone: string;
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
};

export default function AdminMessengerScreen() {
  const router = useRouter();
  const { role } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const [keyword, setKeyword] = useState('');
  const insets = useSafeAreaInsets();

  const fetchChatList = async () => {
    const { data: fcs, error: fcError } = await supabase
      .from('fc_profiles')
      .select('id,name,phone')
      .order('name');
    if (fcError) throw fcError;

    const previews: ChatPreview[] = [];

    for (const fc of fcs ?? []) {
      const { data: lastMsgs, error: lastErr } = await supabase
        .from('messages')
        .select('content,created_at,sender_id,is_read')
        .or(
          `and(sender_id.eq.admin,receiver_id.eq.${fc.phone}),and(sender_id.eq.${fc.phone},receiver_id.eq.admin)`,
        )
        .order('created_at', { ascending: false })
        .limit(1);
      if (lastErr) throw lastErr;

      const lastMsg = lastMsgs?.[0];

      const { count, error: countErr } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('sender_id', fc.phone)
        .eq('receiver_id', 'admin')
        .eq('is_read', false);
      if (countErr) throw countErr;

      previews.push({
        fc_id: fc.id,
        name: fc.name,
        phone: fc.phone,
        last_message: lastMsg?.content ?? null,
        last_time: lastMsg?.created_at ?? null,
        unread_count: count ?? 0,
      });
    }

    previews.sort((a, b) => {
      if (!a.last_time) return 1;
      if (!b.last_time) return -1;
      return new Date(b.last_time).getTime() - new Date(a.last_time).getTime();
    });

    return previews;
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-chat-list'],
    queryFn: fetchChatList,
    enabled: role === 'admin',
  });

  useEffect(() => {
    if (role !== 'admin') return;
    const channel = supabase
      .channel('admin-chat-list-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, refetch]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday
      ? date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  };

  const renderItem = ({ item }: { item: ChatPreview }) => (
    <Pressable
      style={styles.chatItem}
      onPress={() =>
        router.push({
          pathname: '/chat',
          params: { targetId: item.phone, targetName: item.name },
        })
      }
    >
      <View style={styles.avatar}>
        <Feather name="user" size={24} color="#9CA3AF" />
      </View>
      <View style={styles.content}>
        <View style={styles.row}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.time}>{formatTime(item.last_time)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.message} numberOfLines={1}>
            {item.last_message ?? '메시지가 없습니다.'}
          </Text>
          {item.unread_count > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unread_count}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.safe, { paddingTop: insets.top }]} edges={['left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>메신저</Text>
        <RefreshButton onPress={() => { void refetch(); }} />
      </View>

      <View style={{ paddingHorizontal: 20, marginTop: 8, marginBottom: 4 }}>
        <FormInput
          placeholder="이름 또는 전화번호 검색"
          value={keyword}
          onChangeText={setKeyword}
          leftIcon={<Feather name="search" size={16} color={MUTED} />}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#f36f21" />
        </View>
      ) : (
        <FlatList
          data={(data ?? []).filter((item) => {
            if (!keyword.trim()) return true;
            const q = keyword.trim().toLowerCase();
            return item.name.toLowerCase().includes(q) || item.phone.includes(q);
          })}
          keyExtractor={(item) => item.phone}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingBottom: insets.bottom || 0 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>대화 기록이 없습니다.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  chatItem: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F9FAFB',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: CHARCOAL },
  time: { fontSize: 12, color: MUTED },
  message: { fontSize: 14, color: '#6B7280', flex: 1, marginRight: 8 },
  badge: {
    backgroundColor: '#f36f21',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyText: { color: MUTED },
});
