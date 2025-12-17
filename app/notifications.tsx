import { Feather } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

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

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  };

  const handleLongPress = (id: string) => {
    setSelectionMode(true);
    toggleSelection(id);
  };

  const handlePressItem = (item: Notice) => {
    if (selectionMode) {
      toggleSelection(item.id);
      return;
    }

    // 서류 검토 완료 알림이면 위촉 페이지로 이동
    const lowerTitle = item.title?.toLowerCase?.() ?? '';
    const lowerBody = item.body?.toLowerCase?.() ?? '';
    const isDocsApproved =
      lowerTitle.includes('서류') && lowerTitle.includes('완료') ||
      lowerBody.includes('서류') && lowerBody.includes('완료');

    if (item.source === 'notification' && isDocsApproved) {
      router.replace('/appointment');
      return;
    }

    Alert.alert(item.title, item.body, [{ text: '확인' }]);
  };

  const selectedCounts = useMemo(() => {
    let notif = 0;
    let notice = 0;
    selectedIds.forEach((sid) => {
      if (sid.startsWith('notification:')) notif += 1;
      else if (sid.startsWith('notice:')) notice += 1;
    });
    return { notif, notice };
  }, [selectedIds]);

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleDeleteSelected = () => {
    if (!selectedIds.size) return;
    Alert.alert('알림 삭제', `선택한 ${selectedIds.size}개를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            const notifIds = Array.from(selectedIds)
              .filter((id) => id.startsWith('notification:'))
              .map((id) => id.replace('notification:', ''));
            const noticeIds = Array.from(selectedIds)
              .filter((id) => id.startsWith('notice:'))
              .map((id) => id.replace('notice:', ''));

            if (notifIds.length) {
              const { error } = await supabase.from('notifications').delete().in('id', notifIds);
              if (error) throw error;
            }
            if (noticeIds.length) {
              const { error } = await supabase.from('notices').delete().in('id', noticeIds);
              if (error) throw error;
            }
            setSelectedIds(new Set());
            setSelectionMode(false);
            load();
            Alert.alert('삭제 완료', '선택한 항목을 삭제했습니다.');
          } catch (err: any) {
            Alert.alert('오류', err?.message ?? '삭제 중 문제가 발생했습니다.');
          }
        },
      },
    ]);
  };

  const handleSelectAll = () => {
    if (!notices.length) return;
    setSelectionMode(true);
    setSelectedIds(new Set(notices.map((n) => n.id)));
  };

  const renderItem = ({ item, index }: { item: Notice; index: number }) => {
    const isNotice = item.source === 'notice';
    const iconName = isNotice ? 'mic' : 'bell';
    const iconColor = isNotice ? HANWHA_ORANGE : '#3B82F6';
    const bgIcon = isNotice ? '#FFF7ED' : '#EFF6FF';
    const isSelected = selectedIds.has(item.id);

    return (
      <MotiView
        from={{ opacity: 0, translateY: 10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ delay: index * 50 }}
      >
        <Pressable
          style={[styles.itemContainer, isSelected && styles.itemSelected]}
          onPress={() => handlePressItem(item)}
          onLongPress={() => handleLongPress(item.id)}
          android_ripple={{ color: '#F3F4F6' }}
        >
          <View style={[styles.iconBox, { backgroundColor: bgIcon }]}>
            <Feather name={iconName} size={20} color={iconColor} />
          </View>
          <View style={styles.contentBox}>
            <View style={styles.titleRow}>
              <Text style={styles.category}>{item.category === 'app_event' ? '앱 알림' : item.category}</Text>
              <Text style={styles.date}>{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</Text>
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.body} numberOfLines={2}>
              {item.body}
            </Text>
          </View>
          {selectionMode && (
            <Feather
              name={isSelected ? 'check-circle' : 'circle'}
              size={20}
              color={isSelected ? HANWHA_ORANGE : '#D1D5DB'}
            />
          )}
        </Pressable>
      </MotiView>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.header}>
        {selectionMode ? (
          <View style={styles.selectionHeader}>
            <Pressable onPress={cancelSelection}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable onPress={handleSelectAll} disabled={!notices.length}>
                <Text style={[styles.selectAllText, !notices.length && { opacity: 0.4 }]}>모두 선택</Text>
              </Pressable>
              <Text style={styles.selectionTitle}>{selectedIds.size}개 선택됨</Text>
              <Pressable onPress={handleDeleteSelected} disabled={!selectedIds.size}>
                <Text style={[styles.deleteText, !selectedIds.size && { opacity: 0.5 }]}>삭제</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.headerTitle}>알림 센터</Text>
            <RefreshButton onPress={load} />
          </>
        )}
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
  itemSelected: {
    borderColor: HANWHA_ORANGE,
    backgroundColor: '#FFF7ED',
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
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  cancelText: { fontSize: 14, color: MUTED, fontWeight: '600' },
  selectionTitle: { fontSize: 16, fontWeight: '700', color: CHARCOAL },
  deleteText: { fontSize: 14, color: '#EF4444', fontWeight: '700' },
  selectAllText: { fontSize: 14, color: HANWHA_ORANGE, fontWeight: '700' },
});
