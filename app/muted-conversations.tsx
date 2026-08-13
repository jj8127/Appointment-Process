import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import {
  fetchFcChatTargets,
  fetchInternalChatList,
  type InternalChatViewerContext,
} from '@/lib/internal-chat-api';
import {
  buildMessengerRoomRef,
  getMutedMessengerRooms,
  setRoomMuted,
  type MessengerRoomRef,
} from '@/lib/notification-preferences-api';
import {
  rbGetMessengerRoomPreferences,
  rbSetMessengerRoomMuted,
  type RbMessengerRoomPreference,
} from '@/lib/request-board-api';
import { getMessengerHubCapabilities } from '@/lib/messenger-role-capabilities';

const ACCENT = '#F36F21';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const FC_ROOM_PATTERN = new RegExp(`^garamin:(direct-thread|group):(${UUID})$`, 'i');

type MutedConversation = {
  key: string;
  title: string;
  detail: string;
  source: 'garamin' | 'garamlink';
  room: MessengerRoomRef | RbMessengerRoomPreference['room'];
};

type DirectRoomTitles = ReadonlyMap<string, string>;

function addDirectRoomTitle(
  titles: Map<string, string>,
  conversationId: string | null | undefined,
  rawTitle: string | null | undefined,
) {
  const match = FC_ROOM_PATTERN.exec(`garamin:direct-thread:${conversationId ?? ''}`);
  const title = rawTitle?.trim();
  if (!match || !title) return;
  titles.set(buildMessengerRoomRef('direct-thread', match[2]).key, title);
}

function mapFcRoom(
  roomKey: string,
  directRoomTitles: DirectRoomTitles,
  directRoomTitlesUnavailable = false,
): MutedConversation | null {
  const match = FC_ROOM_PATTERN.exec(roomKey);
  if (!match) return null;
  const kind = match[1] === 'group' ? 'group' : 'direct-thread';
  const room = buildMessengerRoomRef(kind, match[2]);
  const directTitle = directRoomTitles.get(room.key);
  const unresolvedDirectTitle = `가람in 1:1 대화 · ${match[2].slice(0, 6)}`;
  return {
    key: room.key,
    title: kind === 'group'
      ? '가람PA 단톡방'
      : directTitle || unresolvedDirectTitle,
    detail: kind === 'group'
      ? '단체 대화 알림 꺼짐'
      : directRoomTitlesUnavailable && !directTitle
        ? '상대방 이름을 불러오지 못함'
        : '가람in 1:1 대화',
    source: 'garamin',
    room,
  };
}

function mapRbRoom(preference: RbMessengerRoomPreference): MutedConversation {
  return {
    key: preference.roomKey,
    title: preference.displayLabel?.trim() || '사용할 수 없는 대화방',
    detail: preference.room.type === 'request' ? '가람Link 설계요청 대화' : '가람Link 1:1 대화',
    source: 'garamlink',
    room: preference.room,
  };
}

export default function MutedConversationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    role,
    residentId,
    readOnly,
    staffType,
    isRequestBoardDesigner,
    hydrated,
    ensureRequestBoardSession,
  } = useSession();
  const capabilities = useMemo(() => getMessengerHubCapabilities({
    role,
    readOnly,
    staffType,
    isRequestBoardDesigner,
  }), [isRequestBoardDesigner, readOnly, role, staffType]);
  const viewerContext = useMemo<InternalChatViewerContext>(() => ({
    role,
    residentId,
    readOnly,
    staffType,
    isRequestBoardDesigner,
  }), [isRequestBoardDesigner, readOnly, residentId, role, staffType]);
  const [items, setItems] = useState<MutedConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const loadDirectRoomTitles = useCallback(async (): Promise<DirectRoomTitles> => {
    const titles = new Map<string, string>();
    if (capabilities.internalPeopleSource === 'fc-targets') {
      const targets = await fetchFcChatTargets(residentId);
      [...targets.managers, ...targets.developers, ...targets.admins].forEach((target) => {
        addDirectRoomTitle(titles, target.conversation_id, target.name);
      });
    } else if (capabilities.internalPeopleSource === 'internal-list') {
      const result = await fetchInternalChatList(viewerContext);
      result.items.forEach((item) => {
        addDirectRoomTitle(titles, item.conversation_id, item.name);
      });
    }
    return titles;
  }, [capabilities.internalPeopleSource, residentId, viewerContext]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    const fcPromise = getMutedMessengerRooms();
    const rbPromise = capabilities.canReadRequestBoard
      ? ensureRequestBoardSession().then(async (session) => {
        if (!session.ok) throw new Error('garamlink_session_unavailable');
        const result = await rbGetMessengerRoomPreferences();
        if (!result.success) throw new Error(result.error);
        return result.data.rooms.filter((room) => room.muted);
      })
      : Promise.resolve([] as RbMessengerRoomPreference[]);
    const directRoomTitlesPromise = fcPromise.then((rooms) => (
      rooms.some((room) => room.roomKey.startsWith('garamin:direct-thread:'))
        ? loadDirectRoomTitles()
        : new Map<string, string>()
    ));
    const [fcResult, rbResult, directRoomTitlesResult] = await Promise.allSettled([
      fcPromise,
      rbPromise,
      directRoomTitlesPromise,
    ]);
    const directRoomTitles = directRoomTitlesResult.status === 'fulfilled'
      ? directRoomTitlesResult.value
      : new Map<string, string>();
    const directRoomTitlesUnavailable = directRoomTitlesResult.status === 'rejected';
    const next: MutedConversation[] = [];
    const nextErrors: string[] = [];
    if (fcResult.status === 'fulfilled') {
      fcResult.value.forEach((row) => {
        const mapped = mapFcRoom(row.roomKey, directRoomTitles, directRoomTitlesUnavailable);
        if (mapped) next.push(mapped);
      });
      if (
        directRoomTitlesUnavailable
        && fcResult.value.some((row) => row.roomKey.startsWith('garamin:direct-thread:'))
      ) {
        nextErrors.push('가람in 대화 이름');
      }
    } else {
      nextErrors.push('가람in');
    }
    if (rbResult.status === 'fulfilled') {
      rbResult.value.forEach((row) => next.push(mapRbRoom(row)));
    } else {
      nextErrors.push('가람Link');
    }
    setItems(next);
    setErrors(nextErrors);
    setLoading(false);
  }, [capabilities.canReadRequestBoard, ensureRequestBoardSession, loadDirectRoomTitles]);

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
      return;
    }
    void load();
  }, [hydrated, load, role, router]);

  const unmute = async (item: MutedConversation) => {
    if (pendingKey) return;
    setPendingKey(item.key);
    setItems((current) => current.filter((candidate) => candidate.key !== item.key));
    try {
      if (item.source === 'garamin') {
        await setRoomMuted(item.room as MessengerRoomRef, false);
      } else {
        const result = await rbSetMessengerRoomMuted(
          item.room as RbMessengerRoomPreference['room'],
          false,
        );
        if (!result.success) throw new Error(result.error);
      }
    } catch {
      setItems((current) => [...current, item]);
      setErrors((current) => Array.from(new Set([...current, '설정 저장'])));
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="뒤로 가기"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Feather name="arrow-left" size={24} color="#111827" />
        </Pressable>
        <Text style={styles.headerTitle}>알림을 끈 대화</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
        <View style={styles.infoCard}>
          <Feather name="info" size={17} color="#6B7280" />
          <Text style={styles.infoText}>음소거해도 메시지와 읽지 않은 개수는 대화 목록에 그대로 남습니다.</Text>
        </View>

        {errors.length > 0 ? (
          <View accessibilityRole="alert" style={styles.errorCard}>
            <Feather name="alert-circle" size={18} color="#B42318" />
            <Text style={styles.errorText}>{errors.join(', ')} 설정을 모두 불러오거나 저장하지 못했어요.</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retryButton}>
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : null}

        {loading && items.length === 0 ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={ACCENT} />
            <Text style={styles.stateText}>알림을 끈 대화를 불러오는 중입니다.</Text>
          </View>
        ) : items.length === 0 && errors.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}><Feather name="bell" size={24} color={ACCENT} /></View>
            <Text style={styles.emptyTitle}>알림을 끈 대화가 없어요</Text>
            <Text style={styles.stateText}>각 대화방 설정에서 알림을 끄고 켤 수 있습니다.</Text>
          </View>
        ) : items.length === 0 ? null : (
          <View style={styles.list}>
            {items.map((item) => (
              <View key={item.key} style={styles.row}>
                <View style={[styles.avatar, item.source === 'garamlink' && styles.avatarBlue]}>
                  <Feather name={item.source === 'garamlink' ? 'link-2' : 'message-circle'} size={19} color={item.source === 'garamlink' ? '#2563EB' : ACCENT} />
                </View>
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text>
                  <Text numberOfLines={1} style={styles.rowDetail}>{item.detail}</Text>
                </View>
                <Pressable
                  accessibilityLabel={`${item.title} 알림 켜기`}
                  accessibilityRole="button"
                  disabled={pendingKey !== null}
                  onPress={() => void unmute(item)}
                  style={({ pressed }) => [styles.unmuteButton, pressed && styles.buttonPressed, pendingKey !== null && styles.disabled]}
                >
                  {pendingKey === item.key ? <ActivityIndicator color={ACCENT} size="small" /> : <Text style={styles.unmuteText}>알림 켜기</Text>}
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F8FA' },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  headerTitle: { flex: 1, textAlign: 'center', color: '#111827', fontSize: 18, fontWeight: '800' },
  pressed: { backgroundColor: '#F3F4F6' },
  content: { padding: 20, gap: 12 },
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  infoText: { flex: 1, color: '#6B7280', fontSize: 12, lineHeight: 17 },
  errorCard: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#FEF3F2', borderWidth: 1, borderColor: '#FECDCA' },
  errorText: { flex: 1, color: '#912018', fontSize: 12, lineHeight: 17 },
  retryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  retryText: { color: '#912018', fontSize: 12, fontWeight: '800' },
  centerState: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyState: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#FFF0E6' },
  emptyTitle: { marginTop: 4, color: '#374151', fontSize: 16, fontWeight: '800' },
  stateText: { color: '#6B7280', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  list: { overflow: 'hidden', borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ECEFF2' },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: '#FFF0E6' },
  avatarBlue: { backgroundColor: '#EFF6FF' },
  flex: { flex: 1, minWidth: 0 },
  rowTitle: { color: '#111827', fontSize: 15, lineHeight: 20, fontWeight: '700' },
  rowDetail: { marginTop: 2, color: '#6B7280', fontSize: 12, lineHeight: 17 },
  unmuteButton: { minWidth: 76, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#F7B58E', backgroundColor: '#FFF7F2', paddingHorizontal: 10 },
  unmuteText: { color: '#B84D0B', fontSize: 12, fontWeight: '800' },
  buttonPressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
});
