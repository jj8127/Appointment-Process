import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  InteractionManager,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MessengerPersonProfileSheet } from '@/components/messenger/MessengerPersonProfileSheet';
import {
  MessengerConversationActionsSheet,
  type MessengerConversationAction,
} from '@/components/messenger/MessengerConversationActionsSheet';
import {
  MessengerHubConversationRow,
  MessengerHubEmpty,
  MessengerHubHeader,
  MessengerHubNotice,
  MessengerHubPersonRow,
  MessengerHubSourceLoading,
  MessengerRoleFilterPanel,
  MessengerRoleSectionHeader,
} from '@/components/messenger/MessengerHubRows';
import { MessengerTabBar, type MessengerTab } from '@/components/messenger/MessengerTabBar';
import { useSession } from '@/hooks/use-session';
import { goBackOrReplace } from '@/lib/back-navigation';
import { groupChatBootstrap, groupChatMarkRead, groupChatSetMuted } from '@/lib/group-chat-api';
import {
  markGaraminDirectMessagesRead,
  resolveGaraminDirectConversation,
} from '@/lib/direct-message-api';
import {
  fetchFcChatTargets,
  fetchInternalChatListPage,
} from '@/lib/internal-chat-api';
import { logger } from '@/lib/logger';
import {
  buildMessengerHubCacheScope,
  getMessengerHubSnapshot,
  setMessengerHubSnapshot,
  type MessengerHubSources,
} from '@/lib/messenger-hub-cache';
import {
  buildFcTargetRows,
  buildGroupConversation,
  buildInternalListRows,
  buildRequestConversationRows,
  buildRequestDirectoryPeople,
  buildRequestDmRows,
  applyMessengerRoomPreferences,
  dedupePeople,
  getMessengerTotalUnread,
  groupMessengerPeopleByRole,
  peopleFromConversations,
  isMessengerConversationVisible,
  parseMessengerHubTab,
  sortMessengerConversations,
  type MessengerHubConversation,
  type MessengerHubPerson,
  type MessengerHubRoute,
  type MessengerPersonRole,
  type MessengerPersonRoleFilter,
} from '@/lib/messenger-hub-model';
import { getMessengerHubCapabilities } from '@/lib/messenger-role-capabilities';
import {
  buildMessengerRoomRef,
  getNotificationPreferences,
  leaveRoom,
  setRoomPinned,
  setRoomMuted,
  type MessengerRoomPreference,
} from '@/lib/notification-preferences-api';
import {
  rbCreateDmConversation,
  rbGetConversationsPageOrThrow,
  rbGetDirectMessageUsersOrThrow,
  rbGetDmConversationsPageOrThrow,
  rbGetMessengerRoomPreferences,
  rbLeaveMessengerRoom,
  rbMarkDmMessagesRead,
  rbMarkMessagesRead,
  rbSetMessengerRoomPinned,
  rbSetMessengerRoomMuted,
  type RbMessengerRoomPreference,
} from '@/lib/request-board-api';

type ChannelQuery = 'garam' | 'request-board' | 'group-chat' | null;
type MessengerHubLoadingSource =
  | 'internal'
  | 'group'
  | 'request-conversations'
  | 'request-dms'
  | 'request-people';

const EMPTY_SOURCES: MessengerHubSources = {
  internalPeople: [],
  internalConversations: [],
  groupConversations: [],
  requestConversations: [],
  requestDmConversations: [],
  requestPeople: [],
};
const EMPTY_GARAMIN_ROOM_PREFERENCES: MessengerRoomPreference[] = [];
const EMPTY_REQUEST_ROOM_PREFERENCES: RbMessengerRoomPreference[] = [];

const HUB_REFRESH_COOLDOWN_MS = 120_000;
const ACCENT = '#f36f21';
const conversationKeyExtractor = (item: MessengerHubConversation) => item.key;
const personKeyExtractor = (item: MessengerHubPerson) => item.key;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseChannel(value: string | string[] | undefined): ChannelQuery {
  const normalized = firstParam(value)?.trim().toLowerCase();
  if (normalized === 'garam') return 'garam';
  if (normalized === 'request-board' || normalized === 'request') return 'request-board';
  if (normalized === 'group-chat' || normalized === 'group') return 'group-chat';
  return null;
}

function isExactExistingRoute(route: MessengerHubRoute) {
  if (route.kind === 'internal') return Boolean(route.conversationId);
  return route.kind !== 'request-directory';
}

function canToggleConversationMuted(conversation: MessengerHubConversation): boolean {
  return Boolean(conversation.garaminRoomKey)
    || conversation.route.kind === 'internal'
    || conversation.route.kind === 'request'
    || conversation.route.kind === 'request-dm';
}

function mergeConversationRows(
  current: readonly MessengerHubConversation[],
  incoming: readonly MessengerHubConversation[],
): MessengerHubConversation[] {
  return sortMessengerConversations(Array.from(new Map(
    [...current, ...incoming].map((item) => [item.key, item]),
  ).values()));
}

export default function MessengerHubScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    tab?: string | string[];
    channel?: string | string[];
  }>();
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
  const [activeTab, setActiveTab] = useState<MessengerTab>(() => parseMessengerHubTab(params.tab));
  const [roleFilter, setRoleFilter] = useState<MessengerPersonRoleFilter>('all');
  const [roleFilterVisible, setRoleFilterVisible] = useState(false);
  const [expandedRoles, setExpandedRoles] = useState<ReadonlySet<MessengerPersonRole>>(
    () => new Set<MessengerPersonRole>(),
  );
  const [sources, setSources] = useState<MessengerHubSources>(EMPTY_SOURCES);
  const [garaminRoomPreferences, setGaraminRoomPreferences] =
    useState<MessengerRoomPreference[]>([]);
  const [requestRoomPreferences, setRequestRoomPreferences] =
    useState<RbMessengerRoomPreference[]>([]);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [creatingRequestParticipantId, setCreatingRequestParticipantId] = useState<number | null>(null);
  const [requestCreateRetry, setRequestCreateRetry] = useState<Extract<MessengerHubRoute, { kind: 'request-directory' }> | null>(null);
  const [mutingConversationKey, setMutingConversationKey] = useState<string | null>(null);
  const [mutingTargetMuted, setMutingTargetMuted] = useState<boolean | null>(null);
  const [muteRetry, setMuteRetry] = useState<MessengerHubConversation | null>(null);
  const [muteError, setMuteError] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<MessengerHubConversation | null>(null);
  const [conversationActionPending, setConversationActionPending] =
    useState<MessengerConversationAction | null>(null);
  const [conversationActionError, setConversationActionError] = useState<string | null>(null);
  const [conversationActionSuccess, setConversationActionSuccess] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<MessengerHubPerson | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loadingSources, setLoadingSources] = useState<ReadonlySet<MessengerHubLoadingSource>>(
    () => new Set<MessengerHubLoadingSource>(),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [renderedCacheScope, setRenderedCacheScope] = useState<string | null>(null);
  const oneShotOpenRef = useRef(false);
  const profileActionRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAllPromiseRef = useRef<Promise<void> | null>(null);
  const lastHubRefreshAtRef = useRef(0);
  const sourcesRef = useRef<MessengerHubSources>(EMPTY_SOURCES);
  const garaminRoomPreferencesRef = useRef<MessengerRoomPreference[]>([]);
  const requestRoomPreferencesRef = useRef<RbMessengerRoomPreference[]>([]);
  const activeCacheScopeRef = useRef<string | null>(null);
  const mutingConversationKeyRef = useRef<string | null>(null);
  const requestConversationCursorRef = useRef<string | null>(null);
  const requestDmCursorRef = useRef<string | null>(null);
  const externalPagePromiseRef = useRef<Promise<void> | null>(null);
  const internalConversationCursorRef = useRef<string | null>(null);
  const hubFocusedRef = useRef(false);
  const conversationActionSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showConversationActionSuccess = useCallback((message: string) => {
    if (conversationActionSuccessTimerRef.current) {
      clearTimeout(conversationActionSuccessTimerRef.current);
    }
    setConversationActionSuccess(message);
    conversationActionSuccessTimerRef.current = setTimeout(() => {
      conversationActionSuccessTimerRef.current = null;
      setConversationActionSuccess(null);
    }, 2_200);
  }, []);

  useEffect(() => () => {
    if (conversationActionSuccessTimerRef.current) {
      clearTimeout(conversationActionSuccessTimerRef.current);
    }
  }, []);

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

  const cacheScope = useMemo(() => buildMessengerHubCacheScope({
    role,
    actorId: residentId,
    readOnly,
    staffType,
    isRequestBoardDesigner,
  }), [isRequestBoardDesigner, readOnly, residentId, role, staffType]);

  const expectedLoadingSources = useMemo<ReadonlySet<MessengerHubLoadingSource>>(() => {
    const next = new Set<MessengerHubLoadingSource>();
    if (capabilities.internalPeopleSource !== 'none') next.add('internal');
    if (capabilities.canUseGroupChat) next.add('group');
    if (capabilities.canReadRequestBoard) {
      next.add('request-conversations');
      next.add('request-dms');
      if (capabilities.canLoadRequestBoardDirectory) next.add('request-people');
    }
    return next;
  }, [
    capabilities.canLoadRequestBoardDirectory,
    capabilities.canReadRequestBoard,
    capabilities.canUseGroupChat,
    capabilities.internalPeopleSource,
  ]);

  const storeSnapshot = useCallback((next: {
    sources?: MessengerHubSources;
    garaminRoomPreferences?: MessengerRoomPreference[];
    requestRoomPreferences?: RbMessengerRoomPreference[];
  } = {}) => {
    if (!cacheScope) return;
    setMessengerHubSnapshot(cacheScope, {
      sources: next.sources ?? sourcesRef.current,
      garaminRoomPreferences: next.garaminRoomPreferences ?? garaminRoomPreferencesRef.current,
      requestRoomPreferences: next.requestRoomPreferences ?? requestRoomPreferencesRef.current,
      updatedAt: new Date().getTime(),
    });
  }, [cacheScope]);

  const updateSources = useCallback((
    updater: (current: MessengerHubSources) => MessengerHubSources,
  ) => {
    if (activeCacheScopeRef.current !== cacheScope) return;
    const next = updater(sourcesRef.current);
    sourcesRef.current = next;
    storeSnapshot({ sources: next });
    if (!hubFocusedRef.current) return;
    startTransition(() => {
      setSources(next);
    });
  }, [cacheScope, storeSnapshot]);

  const updateConversationUnreadCount = useCallback((conversationKey: string, unreadCount: number) => {
    updateSources((current) => {
      const updateRows = (rows: MessengerHubConversation[]) => rows.map((row) =>
        row.key === conversationKey ? { ...row, unreadCount } : row,
      );
      return {
        ...current,
        internalConversations: updateRows(current.internalConversations),
        groupConversations: updateRows(current.groupConversations),
        requestConversations: updateRows(current.requestConversations),
        requestDmConversations: updateRows(current.requestDmConversations),
      };
    });
  }, [updateSources]);

  const updateConversationRoomKey = useCallback((conversationKey: string, roomKey: string) => {
    updateSources((current) => {
      const updateRows = (rows: MessengerHubConversation[]) => rows.map((row) =>
        row.key === conversationKey ? { ...row, garaminRoomKey: roomKey } : row,
      );
      return {
        ...current,
        internalConversations: updateRows(current.internalConversations),
        groupConversations: updateRows(current.groupConversations),
      };
    });
  }, [updateSources]);

  const updateGaraminRoomPreferences = useCallback((
    updater: (current: MessengerRoomPreference[]) => MessengerRoomPreference[],
  ) => {
    if (activeCacheScopeRef.current !== cacheScope) return;
    const next = updater(garaminRoomPreferencesRef.current);
    garaminRoomPreferencesRef.current = next;
    storeSnapshot({ garaminRoomPreferences: next });
    if (!hubFocusedRef.current) return;
    startTransition(() => {
      setGaraminRoomPreferences(next);
    });
  }, [cacheScope, storeSnapshot]);

  const updateRequestRoomPreferences = useCallback((
    updater: (current: RbMessengerRoomPreference[]) => RbMessengerRoomPreference[],
  ) => {
    if (activeCacheScopeRef.current !== cacheScope) return;
    const next = updater(requestRoomPreferencesRef.current);
    requestRoomPreferencesRef.current = next;
    storeSnapshot({ requestRoomPreferences: next });
    if (!hubFocusedRef.current) return;
    startTransition(() => {
      setRequestRoomPreferences(next);
    });
  }, [cacheScope, storeSnapshot]);

  useEffect(() => {
    activeCacheScopeRef.current = cacheScope;
    loadSequenceRef.current += 1;
    loadAllPromiseRef.current = null;
    externalPagePromiseRef.current = null;
    requestConversationCursorRef.current = null;
    requestDmCursorRef.current = null;
    internalConversationCursorRef.current = null;
    const cached = getMessengerHubSnapshot(cacheScope);
    lastHubRefreshAtRef.current = cached?.updatedAt ?? 0;
    const nextSources = cached?.sources ?? EMPTY_SOURCES;
    const nextGaraminPreferences = cached?.garaminRoomPreferences ?? [];
    const nextPreferences = cached?.requestRoomPreferences ?? [];
    sourcesRef.current = nextSources;
    garaminRoomPreferencesRef.current = nextGaraminPreferences;
    requestRoomPreferencesRef.current = nextPreferences;
    setSources(nextSources);
    setGaraminRoomPreferences(nextGaraminPreferences);
    setRequestRoomPreferences(nextPreferences);
    setRenderedCacheScope(cacheScope);
    setFailedSources([]);
    setLoadingSources(cached
      ? new Set<MessengerHubLoadingSource>()
      : new Set(expectedLoadingSources));
    setCreatingRequestParticipantId(null);
    setRequestCreateRetry(null);
    setMutingConversationKey(null);
    setMutingTargetMuted(null);
    mutingConversationKeyRef.current = null;
    setMuteRetry(null);
    setMuteError(null);
    setSelectedConversation(null);
    setConversationActionPending(null);
    setConversationActionError(null);
    setSelectedPerson(null);
    setProfileError(null);
    setRoleFilter('all');
    setRoleFilterVisible(false);
    profileActionRef.current = false;
  }, [cacheScope, expectedLoadingSources]);

  const scopeReady = renderedCacheScope === cacheScope;
  const scopedSources = scopeReady ? sources : EMPTY_SOURCES;
  const scopedGaraminRoomPreferences = scopeReady
    ? garaminRoomPreferences
    : EMPTY_GARAMIN_ROOM_PREFERENCES;
  const scopedRequestRoomPreferences = scopeReady
    ? requestRoomPreferences
    : EMPTY_REQUEST_ROOM_PREFERENCES;

  const conversations = useMemo(() => sortMessengerConversations(
    applyMessengerRoomPreferences([
      ...scopedSources.internalConversations,
      ...scopedSources.groupConversations,
      ...scopedSources.requestConversations,
      ...scopedSources.requestDmConversations,
    ].filter((item) => !readOnly || isExactExistingRoute(item.route)),
    scopedGaraminRoomPreferences,
    scopedRequestRoomPreferences),
  ).filter(isMessengerConversationVisible), [
    readOnly,
    scopedGaraminRoomPreferences,
    scopedRequestRoomPreferences,
    scopedSources,
  ]);

  const people = useMemo(() => dedupePeople([
    ...scopedSources.internalPeople,
    ...peopleFromConversations(scopedSources.requestConversations),
    ...peopleFromConversations(scopedSources.requestDmConversations),
    ...scopedSources.requestPeople,
  ]).filter((item) => !readOnly || isExactExistingRoute(item.route)), [readOnly, scopedSources]);

  const groupedPeople = useMemo(
    () => groupMessengerPeopleByRole(people, roleFilter),
    [people, roleFilter],
  );

  const peopleSections = useMemo(() => groupedPeople.map((section) => ({
    ...section,
    count: section.data.length,
    expanded: expandedRoles.has(section.role),
    data: expandedRoles.has(section.role) ? section.data : [],
  })), [expandedRoles, groupedPeople]);

  const totalUnread = useMemo(
    () => getMessengerTotalUnread(conversations),
    [conversations],
  );

  const peopleLoadingLabels = useMemo(() => {
    const labels: string[] = [];
    if (loadingSources.has('internal')) {
      labels.push(
        capabilities.internalPeopleSource === 'fc-targets'
          ? 'FC 및 가람in 구성원 목록'
          : '가람in 구성원 목록',
      );
    }
    if (
      loadingSources.has('request-people')
      || loadingSources.has('request-conversations')
      || loadingSources.has('request-dms')
    ) {
      labels.push(
        capabilities.canLoadRequestBoardDirectory
          ? '설계 매니저 목록'
          : '가람Link 대화 상대 목록',
      );
    }
    return labels;
  }, [
    capabilities.canLoadRequestBoardDirectory,
    capabilities.internalPeopleSource,
    loadingSources,
  ]);

  const conversationLoadingLabels = useMemo(() => {
    const labels: string[] = [];
    if (loadingSources.has('internal')) labels.push('가람in 대화 목록');
    if (loadingSources.has('group')) labels.push('단체 대화');
    if (
      loadingSources.has('request-conversations')
      || loadingSources.has('request-dms')
    ) {
      labels.push('가람Link 대화 목록');
    }
    return labels;
  }, [loadingSources]);

  const visibleFailedSources = useMemo(
    () => failedSources.filter((source) => !source.endsWith('알림 설정')),
    [failedSources],
  );

  const markSourceSettled = useCallback((source: MessengerHubLoadingSource) => {
    if (activeCacheScopeRef.current !== cacheScope) return;
    setLoadingSources((current) => {
      if (!current.has(source)) return current;
      const next = new Set(current);
      next.delete(source);
      return next;
    });
  }, [cacheScope]);

  const loadInternal = useCallback(async (): Promise<string | null> => {
    try {
      if (capabilities.internalPeopleSource === 'fc-targets') {
        internalConversationCursorRef.current = null;
        const result = buildFcTargetRows(await fetchFcChatTargets(residentId));
        updateSources((current) => ({
          ...current,
          internalPeople: result.people,
          internalConversations: result.conversations,
        }));
      } else if (capabilities.internalPeopleSource === 'internal-list') {
        const page = await fetchInternalChatListPage(viewerContext);
        if (activeCacheScopeRef.current !== cacheScope) return null;
        internalConversationCursorRef.current = page.nextCursor;
        const result = buildInternalListRows(page.items);
        updateSources((current) => ({
          ...current,
          internalPeople: result.people,
          internalConversations: result.conversations,
        }));
      } else {
        internalConversationCursorRef.current = null;
        updateSources((current) => ({
          ...current,
          internalPeople: [],
          internalConversations: [],
        }));
      }
      return null;
    } catch (error) {
      logger.debug('[messenger-hub] 가람in 목록을 불러오지 못했습니다.', error);
      return '가람in';
    } finally {
      markSourceSettled('internal');
    }
  }, [
    cacheScope,
    capabilities.internalPeopleSource,
    markSourceSettled,
    residentId,
    updateSources,
    viewerContext,
  ]);

  const loadExternal = useCallback(async (): Promise<string[]> => {
    const tasks: Promise<string | null>[] = [];

    if (capabilities.canUseGroupChat) {
      tasks.push(groupChatBootstrap(1).then((summary) => {
        updateSources((current) => ({
          ...current,
          groupConversations: [buildGroupConversation(summary)],
        }));
        return null;
      }).catch((error: unknown) => {
        logger.debug('[messenger-hub] 단체방을 불러오지 못했습니다.', error);
        return '단체방';
      }).finally(() => markSourceSettled('group')));
    } else {
      updateSources((current) => ({ ...current, groupConversations: [] }));
    }

    if (capabilities.canReadRequestBoard) {
      const requestBoardReady = ensureRequestBoardSession().then((result) => {
        if (!result.ok) throw new Error(result.error || '가람Link 연결이 필요합니다.');
      });

      tasks.push(requestBoardReady.then(() => rbGetConversationsPageOrThrow()).then((page) => {
        if (activeCacheScopeRef.current !== cacheScope) return null;
        requestConversationCursorRef.current = page.nextCursor;
        updateSources((current) => ({
          ...current,
          requestConversations: buildRequestConversationRows(page.items),
        }));
        return null;
      }).catch((error: unknown) => {
        logger.debug('[messenger-hub] 가람Link 설계요청 대화를 불러오지 못했습니다.', error);
        return '가람Link 설계요청';
      }).finally(() => markSourceSettled('request-conversations')));

      tasks.push(requestBoardReady.then(() => rbGetDmConversationsPageOrThrow()).then((page) => {
        if (activeCacheScopeRef.current !== cacheScope) return null;
        requestDmCursorRef.current = page.nextCursor;
        updateSources((current) => ({
          ...current,
          requestDmConversations: buildRequestDmRows(page.items),
        }));
        return null;
      }).catch((error: unknown) => {
        logger.debug('[messenger-hub] 가람Link 1:1 대화를 불러오지 못했습니다.', error);
        return '가람Link 1:1';
      }).finally(() => markSourceSettled('request-dms')));

      if (capabilities.canLoadRequestBoardDirectory) {
        tasks.push(requestBoardReady.then(() => rbGetDirectMessageUsersOrThrow()).then((items) => {
          updateSources((current) => ({
            ...current,
            requestPeople: buildRequestDirectoryPeople(items),
          }));
          return null;
        }).catch((error: unknown) => {
          logger.debug('[messenger-hub] 가람Link 사람 목록을 불러오지 못했습니다.', error);
          return '가람Link 사람';
        }).finally(() => markSourceSettled('request-people')));
      } else {
        updateSources((current) => ({ ...current, requestPeople: [] }));
      }
    } else {
      requestConversationCursorRef.current = null;
      requestDmCursorRef.current = null;
      updateSources((current) => ({
        ...current,
        requestConversations: [],
        requestDmConversations: [],
        requestPeople: [],
      }));
    }

    return (await Promise.all(tasks)).filter((name): name is string => Boolean(name));
  }, [
    capabilities.canLoadRequestBoardDirectory,
    capabilities.canReadRequestBoard,
    capabilities.canUseGroupChat,
    cacheScope,
    ensureRequestBoardSession,
    markSourceSettled,
    updateSources,
  ]);

  const loadNotificationPreferences = useCallback(async (): Promise<string[]> => {
    const tasks: Promise<string | null>[] = [
      getNotificationPreferences().then((preferences) => {
        updateGaraminRoomPreferences(() => preferences.rooms);
        return null;
      }).catch((error: unknown) => {
        logger.debug('[messenger-hub] 가람in 대화 알림 설정을 불러오지 못했습니다.', error);
        return '가람in 알림 설정';
      }),
    ];

    if (capabilities.canReadRequestBoard) {
      tasks.push(ensureRequestBoardSession().then(async (session) => {
        if (!session.ok) throw new Error(session.error || '가람Link 연결이 필요합니다.');
        const result = await rbGetMessengerRoomPreferences();
        if (!result.success) throw new Error(result.error);
        return result;
      }).then((result) => {
        updateRequestRoomPreferences(() => result.data.rooms);
        return null;
      }).catch((error: unknown) => {
        logger.debug('[messenger-hub] 가람Link 대화 알림 설정을 불러오지 못했습니다.', error);
        return '가람Link 알림 설정';
      }));
    } else {
      updateRequestRoomPreferences(() => []);
    }

    return (await Promise.all(tasks)).filter((name): name is string => Boolean(name));
  }, [
    capabilities.canReadRequestBoard,
    ensureRequestBoardSession,
    updateGaraminRoomPreferences,
    updateRequestRoomPreferences,
  ]);

  const loadAll = useCallback((): Promise<void> => {
    if (loadAllPromiseRef.current) return loadAllPromiseRef.current;
    const task = (async () => {
      if (!role) {
        setLoadingSources(new Set<MessengerHubLoadingSource>());
        setRefreshing(false);
        return;
      }
      const sequence = ++loadSequenceRef.current;
      if (activeCacheScopeRef.current === cacheScope) {
        setLoadingSources(new Set(expectedLoadingSources));
      }
      // The people list is the first useful screen for staff. Do not hold it
      // behind GaramLink bridging or preference reads, which are independent
      // and noticeably slower for developer accounts.
      const deferredLoads = Promise.all([loadExternal(), loadNotificationPreferences()]);
      const internalFailure = await loadInternal();
      if (sequence !== loadSequenceRef.current) return;
      setFailedSources(internalFailure ? [internalFailure] : []);

      const [externalFailures, preferenceFailures] = await deferredLoads;
      if (sequence !== loadSequenceRef.current) return;
      const nextFailures = [
        ...(internalFailure ? [internalFailure] : []),
        ...externalFailures,
        ...preferenceFailures,
      ];
      setFailedSources(nextFailures);
      setRefreshing(false);
    })();
    loadAllPromiseRef.current = task;
    void task.then(() => {
      if (loadAllPromiseRef.current === task) loadAllPromiseRef.current = null;
    }, () => {
      if (loadAllPromiseRef.current === task) loadAllPromiseRef.current = null;
    });
    return task;
  }, [
    cacheScope,
    expectedLoadingSources,
    loadExternal,
    loadInternal,
    loadNotificationPreferences,
    role,
  ]);

  const loadMoreExternalConversations = useCallback((): Promise<void> => {
    if (externalPagePromiseRef.current) return externalPagePromiseRef.current;
    const internalCursor = internalConversationCursorRef.current;
    const requestCursor = requestConversationCursorRef.current;
    const dmCursor = requestDmCursorRef.current;
    const requestScope = cacheScope;
    if (!internalCursor && !requestCursor && !dmCursor) return Promise.resolve();

    const task = (async () => {
      await Promise.all([
        internalCursor
          ? fetchInternalChatListPage(viewerContext, internalCursor).then((page) => {
              if (activeCacheScopeRef.current !== requestScope) return;
              internalConversationCursorRef.current = page.nextCursor;
              const incoming = buildInternalListRows(page.items);
              updateSources((current) => ({
                ...current,
                internalPeople: dedupePeople([...current.internalPeople, ...incoming.people]),
                internalConversations: mergeConversationRows(
                  current.internalConversations,
                  incoming.conversations,
                ),
              }));
            }).catch((error: unknown) => {
              logger.debug('[messenger-hub] 다음 가람in 대화 페이지를 불러오지 못했습니다.', error);
            })
          : Promise.resolve(),
        (async () => {
          if (!requestCursor && !dmCursor) return;
          const session = await ensureRequestBoardSession();
          if (!session.ok || activeCacheScopeRef.current !== requestScope) return;
          await Promise.all([
            requestCursor
              ? rbGetConversationsPageOrThrow(requestCursor).then((page) => {
                  if (activeCacheScopeRef.current !== requestScope) return;
                  requestConversationCursorRef.current = page.nextCursor;
                  updateSources((current) => ({
                    ...current,
                    requestConversations: mergeConversationRows(
                      current.requestConversations,
                      buildRequestConversationRows(page.items),
                    ),
                  }));
                }).catch((error: unknown) => {
                  logger.debug('[messenger-hub] 다음 가람Link 설계요청 대화 페이지를 불러오지 못했습니다.', error);
                })
              : Promise.resolve(),
            dmCursor
              ? rbGetDmConversationsPageOrThrow(dmCursor).then((page) => {
                  if (activeCacheScopeRef.current !== requestScope) return;
                  requestDmCursorRef.current = page.nextCursor;
                  updateSources((current) => ({
                    ...current,
                    requestDmConversations: mergeConversationRows(
                      current.requestDmConversations,
                      buildRequestDmRows(page.items),
                    ),
                  }));
                }).catch((error: unknown) => {
                  logger.debug('[messenger-hub] 다음 가람Link 1:1 대화 페이지를 불러오지 못했습니다.', error);
                })
              : Promise.resolve(),
          ]);
        })(),
      ]);
      if (activeCacheScopeRef.current !== requestScope) return;
    })().catch((error: unknown) => {
      logger.debug('[messenger-hub] 다음 대화 페이지를 불러오지 못했습니다.', error);
    });
    externalPagePromiseRef.current = task;
    void task.then(() => {
      if (externalPagePromiseRef.current === task) externalPagePromiseRef.current = null;
    });
    return task;
  }, [cacheScope, ensureRequestBoardSession, updateSources, viewerContext]);

  useEffect(() => {
    setActiveTab(parseMessengerHubTab(params.tab));
  }, [params.tab]);

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
    }
  }, [hydrated, role, router]);

  useEffect(() => {
    if (!hydrated || !role) return;
    router.prefetch('/chat');
    if (capabilities.canUseGroupChat) router.prefetch('/group-chat');
    if (capabilities.canReadRequestBoard) {
      router.prefetch('/request-board-messenger');
    }
  }, [
    capabilities.canReadRequestBoard,
    capabilities.canUseGroupChat,
    hydrated,
    role,
    router,
  ]);

  useFocusEffect(useCallback(() => {
    if (!hydrated || !role) return undefined;
    hubFocusedRef.current = true;
    const refreshIfStale = () => {
      const now = Date.now();
      if (now - lastHubRefreshAtRef.current < HUB_REFRESH_COOLDOWN_MS) return;
      lastHubRefreshAtRef.current = now;
      void loadAll();
    };
    const afterNavigation = InteractionManager.runAfterInteractions(() => {
      if (!hubFocusedRef.current) return;
      startTransition(() => {
        setSources(sourcesRef.current);
        setGaraminRoomPreferences(garaminRoomPreferencesRef.current);
        setRequestRoomPreferences(requestRoomPreferencesRef.current);
      });
      refreshIfStale();
    });
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshIfStale();
    });
    return () => {
      hubFocusedRef.current = false;
      afterNavigation.cancel();
      subscription.remove();
    };
  }, [hydrated, loadAll, role]));

  const openGaramMessenger = useCallback(() => {
    if (role === 'admin' || isRequestBoardDesigner) {
      router.push('/admin-messenger');
      return;
    }
    router.push('/chat');
  }, [isRequestBoardDesigner, role, router]);

  useEffect(() => {
    if (!hydrated || !role || oneShotOpenRef.current) return;
    const channel = parseChannel(params.channel);
    if (!channel) return;
    oneShotOpenRef.current = true;
    if (channel === 'garam') {
      openGaramMessenger();
    } else if (channel === 'group-chat' && capabilities.canUseGroupChat) {
      router.push('/group-chat');
    } else if (channel === 'request-board' && capabilities.canReadRequestBoard) {
      router.push('/request-board-messenger' as never);
    }
  }, [
    capabilities.canReadRequestBoard,
    capabilities.canUseGroupChat,
    hydrated,
    openGaramMessenger,
    params.channel,
    role,
    router,
  ]);

  const openRoute = useCallback(async (route: MessengerHubRoute): Promise<boolean> => {
    if (readOnly && !isExactExistingRoute(route)) return false;
    if (route.kind === 'internal') {
      router.push({
        pathname: '/chat',
        params: {
          ...(route.conversationId ? { conversationId: route.conversationId } : {}),
          ...(route.targetId ? { targetId: route.targetId } : {}),
          targetName: route.targetName,
        },
      });
      return true;
    } else if (route.kind === 'group') {
      router.push('/group-chat');
      return true;
    } else if (route.kind === 'request') {
      router.push({
        pathname: '/request-board-messenger',
        params: { requestDesignerId: String(route.requestDesignerId) },
      } as never);
      return true;
    } else if (route.kind === 'request-dm') {
      router.push({
        pathname: '/request-board-messenger',
        params: { directConversationId: String(route.directConversationId) },
      } as never);
      return true;
    } else if (
      capabilities.canCreateRequestBoardDm
      && Number.isSafeInteger(route.participantId)
      && route.participantId > 0
      && creatingRequestParticipantId === null
    ) {
      const routeScope = activeCacheScopeRef.current;
      setCreatingRequestParticipantId(route.participantId);
      setRequestCreateRetry(null);
      try {
        const result = await rbCreateDmConversation(route.participantId);
        const conversationId = Number(result.data?.id);
        if (activeCacheScopeRef.current !== routeScope) return false;
        if (!result.success || !Number.isSafeInteger(conversationId) || conversationId <= 0) {
          throw new Error('conversation-create-failed');
        }
        router.push({
          pathname: '/request-board-messenger',
          params: { directConversationId: String(conversationId) },
        } as never);
        return true;
      } catch {
        if (activeCacheScopeRef.current !== routeScope) return false;
        setRequestCreateRetry(route);
        return false;
      } finally {
        if (activeCacheScopeRef.current === routeScope) {
          setCreatingRequestParticipantId(null);
        }
      }
    }
    return false;
  }, [capabilities.canCreateRequestBoardDm, creatingRequestParticipantId, readOnly, router]);

  const handleProfileStartChat = useCallback(async () => {
    if (!selectedPerson || profileActionRef.current) return;
    profileActionRef.current = true;
    setProfileError(null);
    try {
      const opened = await openRoute(selectedPerson.route);
      if (opened) {
        setSelectedPerson(null);
      } else {
        setProfileError(readOnly
          ? '읽기 전용 계정은 기존 대화만 열 수 있습니다.'
          : '대화방을 열지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
      }
    } finally {
      profileActionRef.current = false;
    }
  }, [openRoute, readOnly, selectedPerson]);

  const closeProfile = useCallback(() => {
    if (creatingRequestParticipantId !== null) return;
    setSelectedPerson(null);
    setProfileError(null);
  }, [creatingRequestParticipantId]);

  const handleTabChange = useCallback((tab: MessengerTab) => {
    setActiveTab((current) => current === tab ? current : tab);
    if (tab !== 'people') {
      setRoleFilter('all');
      setRoleFilterVisible(false);
    }
  }, []);

  const toggleRoleSection = useCallback((role: MessengerPersonRole) => {
    setExpandedRoles((current) => {
      const next = new Set(current);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }, []);

  const handleRoleFilterChange = useCallback((filter: MessengerPersonRoleFilter) => {
    setRoleFilter(filter);
    if (filter !== 'all') {
      setExpandedRoles((current) => new Set([...current, filter]));
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    lastHubRefreshAtRef.current = Date.now();
    void loadAll();
  }, [loadAll]);

  const handleHubRetry = useCallback(() => {
    setRoleFilter('all');
    setRoleFilterVisible(false);
    void loadAll();
  }, [loadAll]);

  const resolveGaraminConversationRoom = useCallback(async (
    conversation: MessengerHubConversation,
  ) => {
    if (conversation.garaminRoomKey) {
      const match = /^garamin:(direct-thread|group):(.+)$/.exec(conversation.garaminRoomKey);
      if (!match) throw new Error('invalid_messenger_room_key');
      return {
        roomKey: conversation.garaminRoomKey,
        roomRef: buildMessengerRoomRef(match[1] as 'direct-thread' | 'group', match[2]),
      };
    }
    if (conversation.route.kind !== 'internal') {
      throw new Error('messenger_room_preference_unavailable');
    }
    const resolved = conversation.route.conversationId
      ? await resolveGaraminDirectConversation({
          conversationId: conversation.route.conversationId,
        })
      : await resolveGaraminDirectConversation({
          targetId: conversation.route.targetId ?? null,
        });
    const roomRef = buildMessengerRoomRef('direct-thread', resolved.id);
    updateConversationRoomKey(conversation.key, roomRef.key);
    return { roomKey: roomRef.key, roomRef };
  }, [updateConversationRoomKey]);

  const toggleConversationMuted = useCallback(async (conversation: MessengerHubConversation) => {
    if (mutingConversationKeyRef.current === conversation.key) return;
    const operationScope = activeCacheScopeRef.current;
    const nextMuted = !Boolean(conversation.muted);
    mutingConversationKeyRef.current = conversation.key;
    setMutingConversationKey(conversation.key);
    setMutingTargetMuted(nextMuted);
    setMuteError(null);
    setMuteRetry(null);
    setConversationActionSuccess(null);
    try {
      // The shared group room is backed by the established group-chat
      // preference endpoint. Do not send it through the newer generic
      // preferences function: older deployed environments may not have that
      // function (or its table) available yet.
      if (conversation.route.kind === 'group') {
        const groupRoomKey = conversation.garaminRoomKey;
        if (!groupRoomKey) throw new Error('invalid_messenger_room_key');
        const result = await groupChatSetMuted(nextMuted);
        if (result.muted !== nextMuted) throw new Error('group_chat_preference_mismatch');
        updateGaraminRoomPreferences((current) => {
          const existing = current.find((item) => item.roomKey === groupRoomKey);
          return [
            ...current.filter((item) => item.roomKey !== groupRoomKey),
            {
              roomKey: groupRoomKey,
              muted: nextMuted,
              pinnedAt: existing?.pinnedAt ?? null,
              leftAt: existing?.leftAt ?? null,
              updatedAt: new Date().toISOString(),
            },
          ];
        });
        showConversationActionSuccess(nextMuted ? '채팅방 알림을 껐습니다.' : '채팅방 알림을 켰습니다.');
        return;
      }

      if (conversation.garaminRoomKey || conversation.route.kind === 'internal') {
        const { roomRef } = await resolveGaraminConversationRoom(conversation);
        const preferences = await setRoomMuted(roomRef, nextMuted);
        updateGaraminRoomPreferences(() => preferences.rooms);
        showConversationActionSuccess(nextMuted ? '채팅방 알림을 껐습니다.' : '채팅방 알림을 켰습니다.');
        return;
      }

      if (conversation.route.kind === 'request') {
        const result = await rbSetMessengerRoomMuted({
          type: 'request',
          requestDesignerId: conversation.route.requestDesignerId,
        }, nextMuted);
        if (!result.success) throw new Error(result.error);
        updateRequestRoomPreferences((current) => [
          ...current.filter((item) => item.roomKey !== result.data.roomKey),
          result.data,
        ]);
        showConversationActionSuccess(nextMuted ? '채팅방 알림을 껐습니다.' : '채팅방 알림을 켰습니다.');
        return;
      }

      if (conversation.route.kind === 'request-dm') {
        const result = await rbSetMessengerRoomMuted({
          type: 'direct',
          conversationId: conversation.route.directConversationId,
        }, nextMuted);
        if (!result.success) throw new Error(result.error);
        updateRequestRoomPreferences((current) => [
          ...current.filter((item) => item.roomKey !== result.data.roomKey),
          result.data,
        ]);
        showConversationActionSuccess(nextMuted ? '채팅방 알림을 껐습니다.' : '채팅방 알림을 켰습니다.');
        return;
      }

      throw new Error('messenger_room_preference_unavailable');
    } catch {
      if (activeCacheScopeRef.current !== operationScope) return;
      setMuteError(nextMuted
        ? '알림을 끄지 못했습니다. 다시 시도해 주세요.'
        : '알림을 켜지 못했습니다. 다시 시도해 주세요.');
      setMuteRetry(conversation);
    } finally {
      if (activeCacheScopeRef.current === operationScope) {
        mutingConversationKeyRef.current = null;
        setMutingConversationKey(null);
        setMutingTargetMuted(null);
      }
    }
  }, [
    updateGaraminRoomPreferences,
    updateRequestRoomPreferences,
    resolveGaraminConversationRoom,
    showConversationActionSuccess,
  ]);

  const handlePersonPress = useCallback((item: MessengerHubPerson) => {
    setProfileError(null);
    setSelectedPerson(item);
  }, []);

  const handleConversationPress = useCallback((item: MessengerHubConversation) => {
    const previousUnread = item.unreadCount;
    if (previousUnread > 0) updateConversationUnreadCount(item.key, 0);
    void openRoute(item.route).then((opened) => {
      if (!opened && previousUnread > 0) {
        updateConversationUnreadCount(item.key, previousUnread);
      }
    }).catch(() => {
      if (previousUnread > 0) {
        updateConversationUnreadCount(item.key, previousUnread);
      }
    });
  }, [openRoute, updateConversationUnreadCount]);

  const handleConversationMute = useCallback((item: MessengerHubConversation) => {
    void toggleConversationMuted(item);
  }, [toggleConversationMuted]);

  const handleConversationLongPress = useCallback((item: MessengerHubConversation) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setConversationActionError(null);
    setSelectedConversation(item);
  }, []);

  const closeConversationActions = useCallback(() => {
    if (conversationActionPending) return;
    setSelectedConversation(null);
  }, [conversationActionPending]);

  const handleConversationPin = useCallback(async () => {
    const conversation = selectedConversation;
    if (!conversation || conversationActionPending) return;
    const pinned = !Boolean(conversation.pinnedAt);
    const operationScope = activeCacheScopeRef.current;
    setConversationActionPending('pin');
    setConversationActionError(null);
    setConversationActionSuccess(null);
    try {
      if (conversation.garaminRoomKey || conversation.route.kind === 'internal') {
        const { roomRef } = await resolveGaraminConversationRoom(conversation);
        const preferences = await setRoomPinned(
          roomRef,
          pinned,
        );
        updateGaraminRoomPreferences(() => preferences.rooms);
      } else if (conversation.route.kind === 'request') {
        const result = await rbSetMessengerRoomPinned({
          type: 'request',
          requestDesignerId: conversation.route.requestDesignerId,
        }, pinned);
        if (!result.success) throw new Error(result.error);
        updateRequestRoomPreferences((current) => [
          ...current.filter((item) => item.roomKey !== result.data.roomKey),
          result.data,
        ]);
      } else if (conversation.route.kind === 'request-dm') {
        const result = await rbSetMessengerRoomPinned({
          type: 'direct',
          conversationId: conversation.route.directConversationId,
        }, pinned);
        if (!result.success) throw new Error(result.error);
        updateRequestRoomPreferences((current) => [
          ...current.filter((item) => item.roomKey !== result.data.roomKey),
          result.data,
        ]);
      } else {
        throw new Error('messenger_room_preference_unavailable');
      }
      if (activeCacheScopeRef.current === operationScope) {
        setSelectedConversation(null);
        showConversationActionSuccess(pinned
          ? '채팅방을 상단에 고정했습니다.'
          : '채팅방 상단 고정을 해제했습니다.');
      }
    } catch {
      if (activeCacheScopeRef.current === operationScope) {
        setConversationActionError(pinned
          ? '채팅방을 상단에 고정하지 못했습니다.'
          : '채팅방 고정을 해제하지 못했습니다.');
      }
    } finally {
      if (activeCacheScopeRef.current === operationScope) setConversationActionPending(null);
    }
  }, [
    conversationActionPending,
    selectedConversation,
    resolveGaraminConversationRoom,
    updateGaraminRoomPreferences,
    updateRequestRoomPreferences,
    showConversationActionSuccess,
  ]);

  const handleConversationActionMute = useCallback(() => {
    if (!selectedConversation || conversationActionPending) return;
    const conversation = selectedConversation;
    setSelectedConversation(null);
    void toggleConversationMuted(conversation);
  }, [conversationActionPending, selectedConversation, toggleConversationMuted]);

  const handleConversationRead = useCallback(async () => {
    const conversation = selectedConversation;
    if (!conversation || conversationActionPending || conversation.unreadCount === 0) return;
    const operationScope = activeCacheScopeRef.current;
    const previousUnread = conversation.unreadCount;
    setConversationActionPending('read');
    setConversationActionError(null);
    setConversationActionSuccess(null);
    updateConversationUnreadCount(conversation.key, 0);
    try {
      if (conversation.route.kind === 'internal') {
        if (!conversation.route.conversationId) throw new Error('conversation_not_found');
        await markGaraminDirectMessagesRead(conversation.route.conversationId);
      } else if (conversation.route.kind === 'group') {
        await groupChatMarkRead();
      } else if (conversation.route.kind === 'request') {
        const result = await rbMarkMessagesRead(
          conversation.requestConversationIds ?? [conversation.route.requestDesignerId],
        );
        if (!result.success) throw new Error(result.error);
      } else if (conversation.route.kind === 'request-dm') {
        const result = await rbMarkDmMessagesRead(conversation.route.directConversationId);
        if (!result.success) throw new Error(result.error);
      } else {
        throw new Error('conversation_not_found');
      }
      if (activeCacheScopeRef.current === operationScope) {
        setSelectedConversation(null);
        showConversationActionSuccess('채팅방을 읽음 처리했습니다.');
      }
    } catch {
      if (activeCacheScopeRef.current === operationScope) {
        updateConversationUnreadCount(conversation.key, previousUnread);
        setConversationActionError('읽음 처리에 실패했습니다. 다시 시도해 주세요.');
      }
    } finally {
      if (activeCacheScopeRef.current === operationScope) setConversationActionPending(null);
    }
  }, [
    conversationActionPending,
    selectedConversation,
    showConversationActionSuccess,
    updateConversationUnreadCount,
  ]);

  const leaveConversation = useCallback(async (conversation: MessengerHubConversation) => {
    if (conversationActionPending) return;
    const operationScope = activeCacheScopeRef.current;
    setConversationActionPending('leave');
    setConversationActionError(null);
    setConversationActionSuccess(null);
    try {
      if (conversation.garaminRoomKey || conversation.route.kind === 'internal') {
        const { roomRef } = await resolveGaraminConversationRoom(conversation);
        const preferences = await leaveRoom(
          roomRef,
        );
        updateGaraminRoomPreferences(() => preferences.rooms);
      } else if (conversation.route.kind === 'request') {
        const result = await rbLeaveMessengerRoom({
          type: 'request',
          requestDesignerId: conversation.route.requestDesignerId,
        });
        if (!result.success) throw new Error(result.error);
        updateRequestRoomPreferences((current) => [
          ...current.filter((item) => item.roomKey !== result.data.roomKey),
          result.data,
        ]);
      } else if (conversation.route.kind === 'request-dm') {
        const result = await rbLeaveMessengerRoom({
          type: 'direct',
          conversationId: conversation.route.directConversationId,
        });
        if (!result.success) throw new Error(result.error);
        updateRequestRoomPreferences((current) => [
          ...current.filter((item) => item.roomKey !== result.data.roomKey),
          result.data,
        ]);
      } else {
        throw new Error('messenger_room_preference_unavailable');
      }
      if (activeCacheScopeRef.current === operationScope) {
        setSelectedConversation(null);
        showConversationActionSuccess('채팅방에서 나갔습니다.');
      }
    } catch {
      if (activeCacheScopeRef.current === operationScope) {
        setConversationActionError('채팅방을 나가지 못했습니다. 다시 시도해 주세요.');
      }
    } finally {
      if (activeCacheScopeRef.current === operationScope) setConversationActionPending(null);
    }
  }, [
    conversationActionPending,
    resolveGaraminConversationRoom,
    updateGaraminRoomPreferences,
    updateRequestRoomPreferences,
    showConversationActionSuccess,
  ]);

  const handleConversationLeave = useCallback(() => {
    const conversation = selectedConversation;
    if (!conversation || conversationActionPending) return;
    Alert.alert(
      '채팅방 나가기',
      '대화 목록에서 숨깁니다. 대화 내용은 삭제되지 않으며 새 메시지가 오면 다시 표시됩니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '나가기', style: 'destructive', onPress: () => void leaveConversation(conversation) },
      ],
    );
  }, [conversationActionPending, leaveConversation, selectedConversation]);

  const renderPersonItem = useCallback(({ item }: { item: MessengerHubPerson }) => (
    <MessengerHubPersonRow item={item} onPress={handlePersonPress} />
  ), [handlePersonPress]);

  const renderPeopleSectionHeader = useCallback(({
    section,
  }: {
    section: (typeof peopleSections)[number];
  }) => (
    <MessengerRoleSectionHeader
      role={section.role}
      title={section.title}
      count={section.count}
      expanded={section.expanded}
      onToggle={toggleRoleSection}
    />
  ), [toggleRoleSection]);

  const renderConversationItem = useCallback(({
    item,
  }: {
    item: MessengerHubConversation;
  }) => {
    const muting = mutingConversationKey === item.key;
    const visibleItem = muting && mutingTargetMuted !== null
      ? { ...item, muted: mutingTargetMuted }
      : item;
    return (
      <MessengerHubConversationRow
      item={visibleItem}
      muting={muting}
      onPress={handleConversationPress}
      onLongPress={handleConversationLongPress}
      onToggleMuted={canToggleConversationMuted(item) ? handleConversationMute : undefined}
      />
    );
  }, [
    handleConversationLongPress,
    handleConversationMute,
    handleConversationPress,
    mutingConversationKey,
    mutingTargetMuted,
  ]);

  const handleBack = useCallback(() => goBackOrReplace(router, '/'), [router]);
  const handleSearch = useCallback(() => router.push('/messenger-search' as never), [router]);
  const handleFilter = useCallback(() => setRoleFilterVisible((visible) => !visible), []);
  const handleNewConversation = useCallback(() => router.push('/new-conversation' as never), [router]);
  const handleConversationEndReached = useCallback(() => {
    if (activeTab !== 'chats') return;
    void loadMoreExternalConversations();
  }, [activeTab, loadMoreExternalConversations]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <MessengerHubHeader
        onBack={handleBack}
        onSearch={handleSearch}
        onFilter={activeTab === 'people' ? handleFilter : undefined}
        filterActive={roleFilter !== 'all'}
        filterExpanded={roleFilterVisible}
      />
      <MessengerTabBar
        activeTab={activeTab}
        unreadCount={totalUnread}
        onChange={handleTabChange}
      />
      {activeTab === 'people' && roleFilterVisible ? (
        <MessengerRoleFilterPanel value={roleFilter} onChange={handleRoleFilterChange} />
      ) : null}
      {visibleFailedSources.length > 0 ? (
        <MessengerHubNotice
          message={`${visibleFailedSources.join(', ')} 정보를 불러오지 못했습니다. 표시된 목록은 최신 성공 결과입니다.`}
          onRetry={handleHubRetry}
        />
      ) : null}
      {creatingRequestParticipantId !== null ? (
        <MessengerHubNotice
          message="선택한 사람과의 대화방을 준비하고 있습니다."
        />
      ) : requestCreateRetry ? (
        <MessengerHubNotice
          message="대화방을 열지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요."
          onRetry={() => void openRoute(requestCreateRetry)}
        />
      ) : muteError ? (
        <MessengerHubNotice
          message={muteError}
          onRetry={muteRetry ? () => void toggleConversationMuted(muteRetry) : undefined}
        />
      ) : conversationActionError ? (
        <MessengerHubNotice message={conversationActionError} />
      ) : null}
      <View style={styles.tabLists}>
        <View
          accessibilityElementsHidden={activeTab !== 'people'}
          importantForAccessibility={activeTab === 'people' ? 'auto' : 'no-hide-descendants'}
          pointerEvents={activeTab === 'people' ? 'auto' : 'none'}
          style={[styles.tabPane, activeTab !== 'people' && styles.tabPaneInactive]}
        >
          <SectionList
            style={styles.tabList}
            sections={peopleSections}
            keyExtractor={personKeyExtractor}
            renderItem={renderPersonItem}
            renderSectionHeader={renderPeopleSectionHeader}
            ListHeaderComponent={(
              <View>
                <Pressable
                  accessibilityLabel="새 대화 시작"
                  accessibilityRole="button"
                  onPress={handleNewConversation}
                  style={({ pressed }) => [styles.newConversationButton, pressed && styles.newConversationPressed]}
                >
                  <Feather name="edit-3" size={18} color={ACCENT} />
                  <Text style={styles.newConversationText}>새 대화</Text>
                  <Feather name="chevron-right" size={18} color="#9CA3AF" />
                </Pressable>
                <MessengerHubSourceLoading labels={peopleLoadingLabels} />
              </View>
            )}
            ListEmptyComponent={peopleLoadingLabels.length > 0
              ? null
              : <MessengerHubEmpty tab="people" />}
            contentContainerStyle={[
              styles.listContent,
              people.length === 0 && styles.emptyListContent,
              { paddingBottom: Math.max(insets.bottom, 12) + 20 },
            ]}
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={ACCENT}
                colors={[ACCENT]}
              />
            )}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={5}
            removeClippedSubviews
          />
        </View>
        <View
          accessibilityElementsHidden={activeTab !== 'chats'}
          importantForAccessibility={activeTab === 'chats' ? 'auto' : 'no-hide-descendants'}
          pointerEvents={activeTab === 'chats' ? 'auto' : 'none'}
          style={[styles.tabPane, activeTab !== 'chats' && styles.tabPaneInactive]}
        >
          <FlatList
            style={styles.tabList}
            data={conversations}
            keyExtractor={conversationKeyExtractor}
            renderItem={renderConversationItem}
            onEndReached={handleConversationEndReached}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={(
              <MessengerHubSourceLoading labels={conversationLoadingLabels} />
            )}
            ListEmptyComponent={conversationLoadingLabels.length > 0
              ? null
              : <MessengerHubEmpty tab="chats" />}
            contentContainerStyle={[
              styles.listContent,
              conversations.length === 0 && styles.emptyListContent,
              { paddingBottom: Math.max(insets.bottom, 12) + 20 },
            ]}
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={ACCENT}
                colors={[ACCENT]}
              />
            )}
            showsVerticalScrollIndicator={false}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={5}
            removeClippedSubviews
          />
        </View>
      </View>
      <MessengerConversationActionsSheet
        conversation={selectedConversation}
        onClose={closeConversationActions}
        onLeave={handleConversationLeave}
        onMute={handleConversationActionMute}
        onPin={() => void handleConversationPin()}
        onRead={() => void handleConversationRead()}
        pendingAction={conversationActionPending}
        visible={scopeReady && selectedConversation !== null}
      />
      {conversationActionSuccess ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          pointerEvents="none"
          style={[
            styles.actionToast,
            { bottom: Math.max(insets.bottom, 12) + 20 },
          ]}
        >
          <Feather name="check-circle" size={17} color="#FFFFFF" />
          <Text style={styles.actionToastText}>{conversationActionSuccess}</Text>
        </View>
      ) : null}
      <MessengerPersonProfileSheet
        errorMessage={profileError}
        loading={selectedPerson?.route.kind === 'request-directory' && creatingRequestParticipantId !== null}
        onClose={closeProfile}
        onStartChat={handleProfileStartChat}
        person={selectedPerson}
        visible={scopeReady && selectedPerson !== null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  tabLists: { flex: 1, position: 'relative' },
  tabPane: { ...StyleSheet.absoluteFillObject },
  // Keep both virtualized lists mounted so their scroll state is retained, but
  // remove the inactive tree from native layout/draw work. Opacity alone still
  // made the hidden large legacy list participate in every frame.
  tabPaneInactive: { display: 'none' },
  tabList: { flex: 1 },
  listContent: { flexGrow: 1 },
  emptyListContent: { flex: 1 },
  newConversationButton: {
    minHeight: 52,
    marginHorizontal: 20,
    marginVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#FED7C2',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  newConversationPressed: { backgroundColor: '#FFF7F2' },
  newConversationText: { flex: 1, color: '#9A3F0A', fontSize: 15, fontWeight: '800' },
  actionToast: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 50,
    elevation: 12,
    maxWidth: '88%',
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 22,
    backgroundColor: 'rgba(17, 24, 39, 0.86)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionToastText: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    flexShrink: 1,
  },
});
