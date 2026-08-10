import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import MessengerLoadingState from '@/components/MessengerLoadingState';
import { MessengerHubNotice } from '@/components/messenger/MessengerHubRows';
import { useSession } from '@/hooks/use-session';
import { goBackOrReplace } from '@/lib/back-navigation';
import { fetchFcChatTargets, fetchInternalChatList } from '@/lib/internal-chat-api';
import { logger } from '@/lib/logger';
import {
  buildFcTargetRows,
  buildInternalListRows,
  buildRequestConversationRows,
  buildRequestDirectoryPeople,
  buildRequestDmRows,
  dedupePeople,
  peopleFromConversations,
  type MessengerHubPerson,
  type MessengerHubRoute,
} from '@/lib/messenger-hub-model';
import { getMessengerHubCapabilities } from '@/lib/messenger-role-capabilities';
import {
  rbCreateDmConversation,
  rbGetConversationsOrThrow,
  rbGetDirectMessageUsersOrThrow,
  rbGetDmConversationsOrThrow,
} from '@/lib/request-board-api';

const ACCENT = '#F36F21';

type LoadResult = {
  people: MessengerHubPerson[];
  failedSources: string[];
};

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('ko-KR');
}

function matchesSearch(person: MessengerHubPerson, query: string) {
  const normalized = normalizeSearch(query);
  if (!normalized) return true;
  return [person.name, person.detail]
    .some((value) => value.toLocaleLowerCase('ko-KR').includes(normalized));
}

function isExactExistingRoute(route: MessengerHubRoute) {
  if (route.kind === 'internal') return Boolean(route.conversationId);
  return route.kind !== 'request-directory';
}

function PersonSelectionRow({
  item,
  selected,
  onPress,
}: {
  item: MessengerHubPerson;
  selected: boolean;
  onPress: () => void;
}) {
  const initial = item.name.replace(/\s+/g, '').charAt(0) || '사';
  return (
    <Pressable
      accessibilityLabel={`${item.name}, ${item.detail}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.personRow,
        selected && styles.personRowSelected,
        pressed && styles.personRowPressed,
      ]}
    >
      <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
      <View style={styles.personBody}>
        <Text numberOfLines={1} style={styles.personName}>{item.name}</Text>
        <Text numberOfLines={1} style={styles.personDetail}>
          {item.detail} · {item.sourceLabel}
        </Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <Feather name="check" size={15} color="#FFFFFF" /> : null}
      </View>
    </Pressable>
  );
}

export default function NewConversationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ participantId?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const {
    role,
    residentId,
    hydrated,
    readOnly,
    staffType,
    isRequestBoardDesigner,
    ensureRequestBoardSession,
  } = useSession();
  const [people, setPeople] = useState<MessengerHubPerson[]>([]);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startActionRef = useRef(false);
  const preferredSelectionAppliedRef = useRef<number | null>(null);

  const preferredParticipantId = useMemo(() => {
    const raw = Array.isArray(params.participantId)
      ? params.participantId.length === 1 ? params.participantId[0] : ''
      : params.participantId ?? '';
    const participantId = /^\d+$/.test(raw) ? Number(raw) : 0;
    return Number.isSafeInteger(participantId) && participantId > 0
      ? participantId
      : null;
  }, [params.participantId]);

  useEffect(() => {
    if (preferredSelectionAppliedRef.current !== preferredParticipantId) {
      preferredSelectionAppliedRef.current = null;
    }
    if (
      preferredParticipantId === null
      || preferredSelectionAppliedRef.current === preferredParticipantId
    ) return;
    const preferred = people.find((person) =>
      person.identityKey === `request-user:${preferredParticipantId}`
      || (
        person.route.kind === 'request-directory'
        && person.route.participantId === preferredParticipantId
      )
    );
    if (!preferred) return;
    preferredSelectionAppliedRef.current = preferredParticipantId;
    setSelectedKey(preferred.key);
    setQuery('');
  }, [people, preferredParticipantId]);

  const capabilities = useMemo(() => getMessengerHubCapabilities({
    role,
    readOnly,
    staffType,
    isRequestBoardDesigner,
  }), [isRequestBoardDesigner, readOnly, role, staffType]);

  const viewerContext = useMemo(() => ({
    role,
    residentId,
    readOnly,
    staffType,
    isRequestBoardDesigner,
  }), [isRequestBoardDesigner, readOnly, residentId, role, staffType]);

  const loadCanonicalPeople = useCallback(async (): Promise<LoadResult> => {
    const sources: MessengerHubPerson[][] = [];
    const failures: string[] = [];

    const internalTask = (async () => {
      try {
        if (capabilities.internalPeopleSource === 'fc-targets') {
          sources.push(buildFcTargetRows(await fetchFcChatTargets(residentId)).people);
        } else if (capabilities.internalPeopleSource === 'internal-list') {
          const response = await fetchInternalChatList(viewerContext);
          sources.push(buildInternalListRows(response.items).people);
        }
      } catch (error) {
        logger.debug('[new-conversation] 내부 사람 목록을 불러오지 못했습니다.', error);
        failures.push('가라민');
      }
    })();

    const requestBoardTask = (async () => {
      if (!capabilities.canReadRequestBoard) return;
      try {
        const result = await ensureRequestBoardSession();
        if (!result.ok) throw new Error(result.error || 'GaramLink 연결이 필요합니다.');
      } catch (error) {
        logger.debug('[new-conversation] GaramLink 세션을 준비하지 못했습니다.', error);
        failures.push('GaramLink');
        return;
      }

      const tasks: Promise<void>[] = [
        rbGetConversationsOrThrow().then((items) => {
          sources.push(peopleFromConversations(buildRequestConversationRows(items)));
        }).catch((error: unknown) => {
          logger.debug('[new-conversation] GaramLink 설계요청 대화를 불러오지 못했습니다.', error);
          failures.push('GaramLink 설계요청');
        }),
        rbGetDmConversationsOrThrow().then((items) => {
          sources.push(peopleFromConversations(buildRequestDmRows(items)));
        }).catch((error: unknown) => {
          logger.debug('[new-conversation] GaramLink 1:1 대화를 불러오지 못했습니다.', error);
          failures.push('GaramLink 1:1');
        }),
      ];

      if (capabilities.canLoadRequestBoardDirectory) {
        tasks.push(rbGetDirectMessageUsersOrThrow().then((items) => {
          sources.push(buildRequestDirectoryPeople(items));
        }).catch((error: unknown) => {
          logger.debug('[new-conversation] GaramLink 사람 목록을 불러오지 못했습니다.', error);
          failures.push('GaramLink 사람');
        }));
      }
      await Promise.all(tasks);
    })();

    await Promise.all([internalTask, requestBoardTask]);
    const canonicalPeople = dedupePeople(sources.flat());
    return {
      people: readOnly
        ? canonicalPeople.filter((person) => isExactExistingRoute(person.route))
        : canonicalPeople,
      failedSources: failures,
    };
  }, [
    capabilities.canLoadRequestBoardDirectory,
    capabilities.canReadRequestBoard,
    capabilities.internalPeopleSource,
    ensureRequestBoardSession,
    readOnly,
    residentId,
    viewerContext,
  ]);

  const loadAll = useCallback(async () => {
    if (!role) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const result = await loadCanonicalPeople();
      setPeople(result.people);
      setFailedSources(result.failedSources);
      setSelectedKey((current) => result.people.some((person) => person.key === current)
        ? current
        : null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadCanonicalPeople, role]);

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
      return;
    }
    void loadAll();
  }, [hydrated, loadAll, role, router]);

  const filteredPeople = useMemo(
    () => people.filter((person) => matchesSearch(person, query)),
    [people, query],
  );
  const selectedPerson = useMemo(
    () => people.find((person) => person.key === selectedKey) ?? null,
    [people, selectedKey],
  );

  const openExistingRoute = useCallback((route: Exclude<MessengerHubRoute, { kind: 'request-directory' }>) => {
    if (route.kind === 'internal') {
      router.push({
        pathname: '/chat',
        params: {
          ...(route.conversationId ? { conversationId: route.conversationId } : {}),
          ...(route.targetId ? { targetId: route.targetId } : {}),
          targetName: route.targetName,
        },
      });
    } else if (route.kind === 'group') {
      router.push('/group-chat');
    } else if (route.kind === 'request') {
      router.push({
        pathname: '/request-board-messenger',
        params: { requestDesignerId: String(route.requestDesignerId) },
      } as never);
    } else {
      router.push({
        pathname: '/request-board-messenger',
        params: { directConversationId: String(route.directConversationId) },
      } as never);
    }
  }, [router]);

  const handleStartChat = useCallback(async () => {
    if (!selectedPerson || startActionRef.current) return;
    startActionRef.current = true;
    setStartError(null);
    setStarting(true);
    try {
      const route = selectedPerson.route;
      if (readOnly && !isExactExistingRoute(route)) {
        setStartError('읽기 전용 계정은 기존 대화만 열 수 있습니다.');
        return;
      }
      if (route.kind !== 'request-directory') {
        openExistingRoute(route);
        return;
      }
      if (
        !capabilities.canCreateRequestBoardDm
        || !Number.isSafeInteger(route.participantId)
        || route.participantId <= 0
      ) {
        setStartError('읽기 전용 계정은 기존 대화만 열 수 있습니다.');
        return;
      }
      const result = await rbCreateDmConversation(route.participantId);
      const conversationId = Number(result.data?.id);
      if (!result.success || !Number.isSafeInteger(conversationId) || conversationId <= 0) {
        throw new Error('conversation-create-failed');
      }
      router.push({
        pathname: '/request-board-messenger',
        params: { directConversationId: String(conversationId) },
      } as never);
    } catch (error) {
      logger.debug('[new-conversation] 대화방을 열지 못했습니다.', error);
      setStartError('대화방을 열지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      setStarting(false);
      startActionRef.current = false;
    }
  }, [capabilities.canCreateRequestBoardDm, openExistingRoute, readOnly, router, selectedPerson]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadAll();
  }, [loadAll]);

  const hasLoadError = failedSources.length > 0 && people.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="뒤로 가기"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => goBackOrReplace(router, '/messenger')}
          style={({ pressed }) => [styles.headerButton, pressed && styles.softPressed]}
        >
          <Feather name="arrow-left" size={24} color="#111827" />
        </Pressable>
        <Text style={styles.title}>새 대화</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.searchWrap}>
        <Feather name="search" size={19} color="#6B7280" />
        <TextInput
          accessibilityLabel="이름 또는 소속 검색"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="이름 또는 소속 검색"
          placeholderTextColor="#9CA3AF"
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
        />
        {query ? (
          <Pressable
            accessibilityLabel="검색어 지우기"
            accessibilityRole="button"
            onPress={() => setQuery('')}
            style={({ pressed }) => [styles.clearButton, pressed && styles.softPressed]}
          >
            <Feather name="x-circle" size={19} color="#6B7280" />
          </Pressable>
        ) : null}
      </View>

      {readOnly ? (
        <MessengerHubNotice message="읽기 전용 계정은 기존 대화 상대만 선택할 수 있습니다." />
      ) : null}
      {failedSources.length > 0 && !hasLoadError ? (
        <MessengerHubNotice
          message={`${failedSources.join(', ')} 정보를 불러오지 못했습니다. 표시된 목록은 불러온 결과입니다.`}
          onRetry={() => void loadAll()}
        />
      ) : null}

      {loading ? (
        <MessengerLoadingState variant="hub" />
      ) : hasLoadError ? (
        <View style={styles.centerState} accessibilityRole="alert">
          <Feather name="wifi-off" size={28} color="#9CA3AF" />
          <Text style={styles.stateTitle}>사람 목록을 불러오지 못했습니다.</Text>
          <Text style={styles.stateDetail}>연결을 확인한 뒤 다시 시도해 주세요.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setLoading(true);
              void loadAll();
            }}
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          >
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          accessibilityRole="radiogroup"
          contentContainerStyle={[
            styles.listContent,
            filteredPeople.length === 0 && styles.emptyListContent,
            { paddingBottom: 16 },
          ]}
          data={filteredPeople}
          keyExtractor={(item) => item.key}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={(
            <View style={styles.centerState}>
              <Feather name="users" size={28} color="#D1D5DB" />
              <Text style={styles.stateTitle}>
                {query ? '검색 결과가 없습니다.' : '대화할 수 있는 사람이 없습니다.'}
              </Text>
              <Text style={styles.stateDetail}>
                {query ? '이름이나 소속을 다시 확인해 주세요.' : '잠시 후 다시 불러와 주세요.'}
              </Text>
            </View>
          )}
          refreshControl={(
            <RefreshControl
              colors={[ACCENT]}
              onRefresh={handleRefresh}
              refreshing={refreshing}
              tintColor={ACCENT}
            />
          )}
          renderItem={({ item }) => (
            <PersonSelectionRow
              item={item}
              onPress={() => {
                setStartError(null);
                setSelectedKey(item.key);
              }}
              selected={item.key === selectedKey}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {startError ? <Text accessibilityRole="alert" style={styles.startError}>{startError}</Text> : null}
        {selectedPerson ? (
          <Text numberOfLines={1} style={styles.selectedSummary}>
            선택: {selectedPerson.name} · {selectedPerson.detail}
          </Text>
        ) : null}
        <Pressable
          accessibilityLabel={selectedPerson
            ? `${selectedPerson.name}님과 1:1 대화 시작`
            : '1:1 대화 시작'}
          accessibilityRole="button"
          accessibilityState={{ disabled: !selectedPerson || starting }}
          disabled={!selectedPerson || starting}
          onPress={() => void handleStartChat()}
          style={({ pressed }) => [
            styles.startButton,
            (!selectedPerson || starting) && styles.startButtonDisabled,
            pressed && selectedPerson && !starting && styles.startButtonPressed,
          ]}
        >
          {starting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text numberOfLines={1} style={styles.startButtonText}>
              {selectedPerson ? `${selectedPerson.name}님과 대화 시작` : '1:1 대화 시작'}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    minHeight: 64,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  softPressed: { backgroundColor: '#F3F4F6' },
  title: { flex: 1, color: '#111827', textAlign: 'center', fontSize: 20, fontWeight: '800' },
  searchWrap: {
    minHeight: 48,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingLeft: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
  },
  searchInput: { flex: 1, minHeight: 46, color: '#111827', fontSize: 15, paddingVertical: 0 },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  listContent: { flexGrow: 1 },
  emptyListContent: { flex: 1 },
  personRow: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ECEFF2',
  },
  personRowSelected: { backgroundColor: '#FFF7F2' },
  personRowPressed: { opacity: 0.72 },
  avatar: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#FFF0E6' },
  avatarText: { color: '#B84D0B', fontSize: 17, fontWeight: '800' },
  personBody: { flex: 1, minWidth: 0, gap: 3 },
  personName: { color: '#111827', fontSize: 16, lineHeight: 22, fontWeight: '700' },
  personDetail: { color: '#6B7280', fontSize: 13, lineHeight: 18 },
  radio: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#D1D5DB', borderRadius: 12 },
  radioSelected: { borderColor: ACCENT, backgroundColor: ACCENT },
  centerState: { flex: 1, minHeight: 220, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', gap: 7 },
  stateTitle: { marginTop: 5, color: '#374151', textAlign: 'center', fontSize: 15, fontWeight: '700' },
  stateDetail: { color: '#9CA3AF', textAlign: 'center', fontSize: 13, lineHeight: 19 },
  retryButton: { minHeight: 44, marginTop: 9, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#FFF0E6' },
  retryButtonPressed: { backgroundColor: '#FED7C2' },
  retryButtonText: { color: '#9A3F0A', fontSize: 14, fontWeight: '800' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  startError: { marginBottom: 9, color: '#B42318', fontSize: 13, lineHeight: 18 },
  selectedSummary: { marginBottom: 9, color: '#4B5563', fontSize: 13, lineHeight: 18 },
  startButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: ACCENT },
  startButtonDisabled: { backgroundColor: '#D1D5DB' },
  startButtonPressed: { backgroundColor: '#D85E17' },
  startButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
