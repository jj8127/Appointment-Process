import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { logger } from '@/lib/logger';
import {
  sanitizePhone,
} from '@/lib/messenger-participants';
import { supabase } from '@/lib/supabase';

const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const HANWHA_ORANGE = '#f36f21';
const AVATAR_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#84CC16',
  '#F97316',
  '#6366F1',
  '#EF4444',
];

type ChatPreview = {
  fc_id: string;
  name: string;
  phone: string;
  affiliation: string | null;
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
  initial: string;
  avatarColor: string;
};

const normalizeAffiliation = (value?: string | null) => (value ?? '').replace(/\s+/g, '');

const isInternalAffiliation = (value?: string | null) => {
  const normalized = normalizeAffiliation(value);
  if (!normalized) return false;
  if (/\d+본부/.test(normalized)) return true;
  if (/\d+팀/.test(normalized)) return true;
  if (normalized.includes('직할')) return true;
  return false;
};

const hashColor = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

export default function AdminMessengerScreen() {
  const router = useRouter();
  const { role, residentId, readOnly } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [optimisticUnreadByPhone, setOptimisticUnreadByPhone] = useState<Record<string, number>>({});
  const insets = useSafeAreaInsets();
  const isManagerSession = role === 'admin' && readOnly;
  const myChatId = isManagerSession ? sanitizePhone(residentId) : 'admin';

  const fetchChatList = async () => {
    if (!myChatId) return [];

    const { data: fcs, error: fcError } = await supabase
      .from('fc_profiles')
      .select('id,name,phone,affiliation')
      .eq('signup_completed', true)
      .order('name');
    if (fcError) throw fcError;

    // 가람지사 내부 소통 대상만 노출: 본부/팀 소속 FC(설계 매니저 회사 소속 계정 제외)
    const scopedFcs = (fcs ?? []).filter(
      (fc) => !!sanitizePhone(fc.phone) && isInternalAffiliation(fc.affiliation),
    );

    const previews: ChatPreview[] = [];

    for (const fc of scopedFcs) {
      const targetPhone = sanitizePhone(fc.phone);
      if (!targetPhone) continue;

      const { data: lastMsgs, error: lastErr } = await supabase
        .from('messages')
        .select('content,created_at,sender_id,is_read')
        .or(
          `and(sender_id.eq.${myChatId},receiver_id.eq.${targetPhone}),and(sender_id.eq.${targetPhone},receiver_id.eq.${myChatId})`,
        )
        .order('created_at', { ascending: false })
        .limit(1);
      if (lastErr) throw lastErr;

      const lastMsg = lastMsgs?.[0];

      const { count, error: countErr } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('sender_id', targetPhone)
        .eq('receiver_id', myChatId)
        .eq('is_read', false);
      if (countErr) throw countErr;

      const displayName = typeof fc.name === 'string' && fc.name.trim().length > 0
        ? fc.name.trim()
        : targetPhone;

      previews.push({
        fc_id: fc.id,
        name: displayName,
        phone: targetPhone,
        affiliation: fc.affiliation ?? null,
        last_message: lastMsg?.content ?? null,
        last_time: lastMsg?.created_at ?? null,
        unread_count: count ?? 0,
        initial: displayName.charAt(0) || 'F',
        avatarColor: hashColor(displayName),
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
    queryKey: ['admin-chat-list', role, residentId, readOnly],
    queryFn: fetchChatList,
    enabled: role === 'admin',
  });

  useEffect(() => {
    setOptimisticUnreadByPhone({});
  }, [data]);

  useEffect(() => {
    if (role !== 'admin') return;
    const channel = supabase
      .channel(`admin-chat-list-changes-${myChatId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myChatId, role, refetch]);

  useFocusEffect(
    useCallback(() => {
      if (role !== 'admin') return;
      void refetch();
    }, [refetch, role]),
  );

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

  const getUnreadCount = useCallback(
    (item: ChatPreview) => optimisticUnreadByPhone[item.phone] ?? item.unread_count,
    [optimisticUnreadByPhone],
  );

  const handleOpenChat = useCallback(
    (item: ChatPreview) => {
      setOptimisticUnreadByPhone((prev) => ({ ...prev, [item.phone]: 0 }));

      void supabase
        .from('messages')
        .update({ is_read: true })
        .eq('sender_id', item.phone)
        .eq('receiver_id', myChatId)
        .eq('is_read', false)
        .then(({ error }) => {
          if (error) {
            logger.debug('[admin-messenger] mark read failed', {
              error: error.message,
              phone: item.phone,
              myChatId,
            });
          }
        });

      router.push({
        pathname: '/chat',
        params: { targetId: item.phone, targetName: item.name },
      });
    },
    [myChatId, router],
  );

  const filteredData = useMemo(() => {
    const source = data ?? [];
    const q = keyword.trim().toLowerCase();
    if (!q) return source;
    return source.filter((item) =>
      item.name.toLowerCase().includes(q)
      || item.phone.includes(q)
      || (item.affiliation ?? '').toLowerCase().includes(q),
    );
  }, [data, keyword]);

  const totalUnread = useMemo(
    () => (data ?? []).reduce((sum, item) => sum + getUnreadCount(item), 0),
    [data, getUnreadCount],
  );

  const renderItem = ({ item }: { item: ChatPreview }) => (
    <Pressable
      style={({ pressed }) => [styles.chatItem, pressed && { backgroundColor: '#F9FAFB' }]}
      onPress={() => handleOpenChat(item)}
    >
      <View style={[styles.avatar, { backgroundColor: item.avatarColor }]}>
        <Text style={styles.avatarText}>{item.initial}</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            {item.affiliation ? (
              <Text style={styles.affiliation} numberOfLines={1}>
                {item.affiliation}
              </Text>
            ) : null}
          </View>
          <Text style={styles.time}>{formatTime(item.last_time)}</Text>
        </View>
        <View style={styles.bottomRow}>
          <Text style={styles.message} numberOfLines={1}>
            {item.last_message ?? '메시지가 없습니다.'}
          </Text>
          {getUnreadCount(item) > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {getUnreadCount(item) > 99 ? '99+' : getUnreadCount(item)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.safe, { paddingTop: insets.top }]} edges={['left', 'right', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.title}>가람지사 메신저</Text>
          {totalUnread > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{totalUnread > 99 ? '99+' : totalUnread}</Text>
            </View>
          )}
        </View>
        <Pressable style={styles.refreshBtn} onPress={() => { void refetch(); }}>
          <Feather name="refresh-cw" size={16} color={MUTED} />
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchRow}>
          <Feather name="search" size={16} color="#9CA3AF" />
          <TextInput
            style={styles.searchInput}
            placeholder="이름/전화번호/소속 검색"
            placeholderTextColor="#9CA3AF"
            value={keyword}
            onChangeText={setKeyword}
            autoCorrect={false}
          />
          {keyword.length > 0 && (
            <Pressable onPress={() => setKeyword('')}>
              <Feather name="x" size={16} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>대화 목록</Text>
        <Text style={styles.sectionCount}>{filteredData.length}</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={HANWHA_ORANGE} />
        </View>
      ) : (
        <FlatList
          data={filteredData}
          keyExtractor={(item) => item.phone}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={HANWHA_ORANGE} />}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 16 }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="message-circle" size={40} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>대화 기록이 없습니다.</Text>
              <Text style={styles.emptyDesc}>
                설계 매니저 계정은 이 목록에서 제외되며{'\n'}가람지사 내부 대화만 표시됩니다.
              </Text>
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  title: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  headerBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HANWHA_ORANGE,
  },
  headerBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
    height: 40,
  },
  searchInput: { flex: 1, color: CHARCOAL, fontSize: 14, paddingVertical: 0 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#F9FAFB',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#F3F4F6',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.6,
  },
  sectionCount: { fontSize: 12, color: '#9CA3AF', fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  content: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '700', color: CHARCOAL, flexShrink: 1 },
  affiliation: { fontSize: 11, color: MUTED, flexShrink: 1 },
  time: { fontSize: 12, color: MUTED },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  message: { fontSize: 14, color: '#6B7280', flex: 1 },
  badge: {
    backgroundColor: HANWHA_ORANGE,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#F3F4F6', marginLeft: 20 + 46 + 12 },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 72,
    paddingHorizontal: 28,
    gap: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: CHARCOAL },
  emptyDesc: { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 20 },
});
