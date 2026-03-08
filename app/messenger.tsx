import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { logger } from '@/lib/logger';
import { ADMIN_CHAT_ID, sanitizePhone } from '@/lib/messenger-participants';
import { rbGetUnreadCount } from '@/lib/request-board-api';
import { supabase } from '@/lib/supabase';

type ChannelQuery = 'garam' | 'request-board' | null;

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';

function parseChannel(value: string | string[] | undefined): ChannelQuery {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'garam') return 'garam';
  if (normalized === 'request-board' || normalized === 'request') return 'request-board';
  return null;
}

export default function MessengerHubScreen() {
  const router = useRouter();
  const { channel } = useLocalSearchParams<{ channel?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { role, residentId, hydrated, readOnly, ensureRequestBoardSession } = useSession();
  const oneShotOpenRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [internalUnread, setInternalUnread] = useState(0);
  const [requestBoardMessageCount, setRequestBoardMessageCount] = useState(0);

  const myChatId = useMemo(() => {
    if (role === 'admin') {
      return readOnly ? sanitizePhone(residentId) : ADMIN_CHAT_ID;
    }
    return sanitizePhone(residentId);
  }, [readOnly, residentId, role]);

  const openGaramMessenger = useCallback(() => {
    if (role === 'admin') {
      router.push('/admin-messenger');
      return;
    }
    router.push('/chat');
  }, [role, router]);

  const openRequestBoardMessenger = useCallback(() => {
    router.push('/request-board-messenger' as never);
  }, [router]);

  const loadCounts = useCallback(async () => {
    if (!role) {
      setInternalUnread(0);
      setRequestBoardMessageCount(0);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const internalCountPromise = myChatId
        ? supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('receiver_id', myChatId)
            .eq('is_read', false)
            .then(({ count, error }) => {
              if (error) throw error;
              return count ?? 0;
            })
        : Promise.resolve(0);

      const requestBoardCountPromise = (async () => {
        const sync = await ensureRequestBoardSession();
        if (!sync.ok) return 0;
        return rbGetUnreadCount();
      })();

      const [internalCount, rbMessageCount] = await Promise.all([
        internalCountPromise,
        requestBoardCountPromise,
      ]);
      setInternalUnread(internalCount);
      setRequestBoardMessageCount(rbMessageCount);
    } catch (err) {
      logger.debug('[messenger-hub] count load failed', err);
      setInternalUnread(0);
      setRequestBoardMessageCount(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ensureRequestBoardSession, myChatId, role]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
      return;
    }
    void loadCounts();
  }, [hydrated, loadCounts, role, router]);

  useFocusEffect(
    useCallback(() => {
      if (!hydrated || !role) return;
      void loadCounts();
    }, [hydrated, loadCounts, role]),
  );

  useEffect(() => {
    if (!hydrated || !role || oneShotOpenRef.current) return;
    const requestedChannel = parseChannel(channel);
    if (!requestedChannel) return;

    oneShotOpenRef.current = true;
    if (requestedChannel === 'garam') {
      openGaramMessenger();
      return;
    }
    openRequestBoardMessenger();
  }, [channel, hydrated, openGaramMessenger, openRequestBoardMessenger, role]);

  const garamDescription = role === 'admin'
    ? readOnly
      ? '본부장/총무 화면에서 모든 FC와 대화'
      : '총무 화면에서 모든 FC와 1:1 대화'
    : 'FC, 본부장, 총무 간 내부 소통';

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 10) }]}>
        <Text style={styles.headerTitle}>메신저</Text>
        <Text style={styles.headerSub}>채널을 선택해 바로 대화를 시작하세요.</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={HANWHA_ORANGE} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={HANWHA_ORANGE} />}
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            style={({ pressed }) => [styles.channelCard, pressed && { opacity: 0.88 }]}
            onPress={openGaramMessenger}
          >
            <View style={[styles.channelIconWrap, { backgroundColor: '#FFF7ED' }]}>
              <Feather name="users" size={22} color={HANWHA_ORANGE} />
            </View>
            <View style={styles.channelBody}>
              <View style={styles.channelHeadRow}>
                <Text style={styles.channelTitle}>가람지사 메신저</Text>
                {internalUnread > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{internalUnread > 99 ? '99+' : internalUnread}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.channelDesc}>{garamDescription}</Text>
            </View>
            <Feather name="chevron-right" size={18} color="#9CA3AF" />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.channelCard, pressed && { opacity: 0.88 }]}
            onPress={openRequestBoardMessenger}
          >
            <View style={[styles.channelIconWrap, { backgroundColor: '#EFF6FF' }]}>
              <Feather name="file-text" size={22} color="#2563EB" />
            </View>
            <View style={styles.channelBody}>
              <View style={styles.channelHeadRow}>
                <Text style={styles.channelTitle}>설계요청 메신저</Text>
                {requestBoardMessageCount > 0 && (
                  <View style={[styles.badge, styles.badgeBlue]}>
                    <Text style={styles.badgeText}>
                      {requestBoardMessageCount > 99 ? '99+' : requestBoardMessageCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.channelDesc}>설계 매니저와 대화</Text>
            </View>
            <Feather name="chevron-right" size={18} color="#9CA3AF" />
          </Pressable>

          <View style={styles.helperCard}>
            <Feather name="info" size={14} color="#9CA3AF" />
            <Text style={styles.helperText}>
              알림에서 특정 대화를 탭하면 해당 채널의 대화방으로 바로 이동합니다.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 4,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: CHARCOAL },
  headerSub: { fontSize: 13, color: MUTED },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  channelCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  channelIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelBody: { flex: 1, gap: 2, minWidth: 0 },
  channelHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  channelTitle: { fontSize: 16, fontWeight: '700', color: CHARCOAL },
  channelDesc: { fontSize: 13, color: MUTED },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
  },
  badgeBlue: {
    backgroundColor: '#2563EB',
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  helperCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  helperText: { flex: 1, fontSize: 12, color: '#6B7280', lineHeight: 18 },
});
