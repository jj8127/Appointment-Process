import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import MessengerSearchHeader from '@/components/messenger/MessengerSearchHeader';
import MessengerSearchLanding from '@/components/messenger/MessengerSearchLanding';
import MessengerSearchResults from '@/components/messenger/MessengerSearchResults';
import MessengerSearchTabs from '@/components/messenger/MessengerSearchTabs';
import { useSession } from '@/hooks/use-session';
import { groupChatBootstrap, groupChatSearch } from '@/lib/group-chat-api';
import { searchGaraminDirectMessages } from '@/lib/direct-message-api';
import {
  fetchFcChatTargets,
  fetchInternalChatList,
  type InternalChatViewerContext,
} from '@/lib/internal-chat-api';
import { formatManagerMessengerDetail } from '@/lib/messenger-participants';
import {
  messengerSearchHistory,
  type MessengerSearchHistorySnapshot,
} from '@/lib/messenger-search-history';
import {
  aggregateMessengerSearchSources,
  buildInternalMessengerSearchTarget,
  buildMessengerSearchRoute,
  filterMessengerSearchItems,
  filterMessengerSearchTab,
  LatestMessengerSearchSequence,
  MESSENGER_SEARCH_DEBOUNCE_MS,
  messengerSearchResultKey,
  normalizeMessengerSearchQuery,
  type MessengerSearchMessage,
  type MessengerSearchResult,
  type MessengerSearchRoom,
  type MessengerSearchSource,
  type MessengerSearchSourceResult,
  type MessengerSearchSourceStatus,
  type MessengerSearchTab,
} from '@/lib/messenger-search-model';
import { getMessengerHubCapabilities } from '@/lib/messenger-role-capabilities';
import {
  rbGetConversationsOrThrow,
  rbGetDesignersOrThrow,
  rbGetDirectMessageUsersOrThrow,
  rbGetDmConversationsOrThrow,
  rbSearchDirectMessages,
  rbSearchMessages,
  type RbConversation,
  type RbDmConversation,
} from '@/lib/request-board-api';

type SourceStore = {
  status: MessengerSearchSourceStatus;
  items: MessengerSearchResult[];
  error?: string;
};

type SourceStores = Record<MessengerSearchSource, SourceStore>;

const EMPTY_SOURCES: SourceStores = {
  internal: { status: 'loading', items: [] },
  group: { status: 'loading', items: [] },
  garamlink: { status: 'loading', items: [] },
};

function sourceErrorMessage(source: MessengerSearchSource): string {
  if (source === 'internal') return '가람in 1:1 목록을 불러오지 못했습니다.';
  if (source === 'group') return '단체 채팅 범위를 불러오지 못했습니다.';
  return '가람Link 목록을 불러오지 못했습니다.';
}

function requestConversationTitle(conversation: RbConversation): string {
  return conversation.designer?.users?.name
    ?? conversation.designer?.company_name
    ?? conversation.fc?.name
    ?? '설계 요청 채팅';
}

function directConversationTitle(conversation: RbDmConversation): string {
  return conversation.participant?.name ?? '가람Link 채팅';
}

export default function MessengerSearchScreen() {
  const router = useRouter();
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
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeTab, setActiveTab] = useState<MessengerSearchTab>('all');
  const [sources, setSources] = useState<SourceStores>(EMPTY_SOURCES);
  const [history, setHistory] = useState<MessengerSearchHistorySnapshot>(
    messengerSearchHistory.snapshot(),
  );
  const sequences = useRef<Record<'internal' | 'group', LatestMessengerSearchSequence>>({
    internal: new LatestMessengerSearchSequence(),
    group: new LatestMessengerSearchSequence(),
  });
  const garamlinkDirectorySequence = useRef(new LatestMessengerSearchSequence());
  const internalMessageSequence = useRef(new LatestMessengerSearchSequence());
  const groupMessageSequence = useRef(new LatestMessengerSearchSequence());
  const garamlinkMessageSequence = useRef(new LatestMessengerSearchSequence());
  const internalMetadataRef = useRef<MessengerSearchResult[]>([]);
  const groupMetadataRef = useRef<MessengerSearchResult[]>([]);
  const internalMessagesRef = useRef<MessengerSearchMessage[]>([]);
  const groupMessagesRef = useRef<MessengerSearchMessage[]>([]);
  const internalMessagePendingRef = useRef(false);
  const groupMessagePendingRef = useRef(false);
  const internalMetadataErrorRef = useRef<string | null>(null);
  const groupMetadataErrorRef = useRef<string | null>(null);
  const internalMessageErrorRef = useRef<string | null>(null);
  const groupMessageErrorRef = useRef<string | null>(null);
  const garamlinkDirectoryRef = useRef<MessengerSearchResult[]>([]);
  const garamlinkDirectoryErrorRef = useRef<string | null>(null);
  const garamlinkMessageErrorRef = useRef<string | null>(null);
  const garamlinkMessagesRef = useRef<MessengerSearchMessage[]>([]);
  const garamlinkMessagePendingRef = useRef(false);
  const requestConversationIdsRef = useRef<number[]>([]);
  const requestRoomLabelRef = useRef(new Map<number, string>());
  const directRoomLabelRef = useRef(new Map<number, string>());

  const viewerContext = useMemo<InternalChatViewerContext>(() => ({
    role,
    residentId,
    readOnly,
    staffType,
    isRequestBoardDesigner,
  }), [isRequestBoardDesigner, readOnly, residentId, role, staffType]);
  const capabilities = useMemo(() => getMessengerHubCapabilities({
    role,
    readOnly,
    staffType,
    isRequestBoardDesigner,
  }), [isRequestBoardDesigner, readOnly, role, staffType]);

  useEffect(() => {
    const actorKey = hydrated && role ? `${role}:${staffType ?? 'member'}:${residentId}` : null;
    setHistory(messengerSearchHistory.setActor(actorKey));
  }, [hydrated, residentId, role, staffType]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const normalized = normalizeMessengerSearchQuery(query);
      setDebouncedQuery(normalized);
      if (normalized) setHistory(messengerSearchHistory.add(normalized));
    }, MESSENGER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const updateSource = (
    source: MessengerSearchSource,
    next: SourceStore | ((current: SourceStore) => SourceStore),
  ) => {
    setSources((current) => ({
      ...current,
      [source]: typeof next === 'function' ? next(current[source]) : next,
    }));
  };

  const loadInternal = async (retrying = false) => {
    const sequence = sequences.current.internal.issue();
    updateSource('internal', (current) => ({ ...current, status: retrying ? 'retrying' : 'loading', error: undefined }));
    internalMetadataErrorRef.current = null;
    try {
      const items: MessengerSearchResult[] = [];
      if (capabilities.internalPeopleSource === 'internal-list') {
        const result = await fetchInternalChatList(viewerContext);
        result.items.forEach((entry) => {
          const route = buildInternalMessengerSearchTarget({
            conversationId: entry.conversation_id,
            targetId: entry.phone,
            targetName: entry.name,
          });
          if (!route) return;
          const canonicalKey = 'conversationId' in route ? route.conversationId : route.targetId;
          items.push({
            kind: 'person',
            key: messengerSearchResultKey('internal', 'person', entry.fc_id || canonicalKey),
            source: 'internal',
            name: entry.name,
            detail: entry.affiliation ?? 'FC',
            route,
          });
          items.push({
            kind: 'room',
            key: messengerSearchResultKey('internal', 'room', canonicalKey),
            source: 'internal',
            title: entry.name,
            detail: entry.last_message ?? '가람in 1:1 채팅',
            route,
          });
        });
      } else if (capabilities.internalPeopleSource === 'fc-targets') {
        const result = await fetchFcChatTargets(residentId);
        const appendTarget = (
          target: (typeof result.managers)[number],
          detail: string,
          targetId: string,
          targetName = target.name,
        ) => {
          const route = buildInternalMessengerSearchTarget({ targetId, targetName });
          if (!route) return;
          const canonicalKey = 'targetId' in route ? route.targetId : route.conversationId;
          items.push({
            kind: 'person',
            key: messengerSearchResultKey('internal', 'person', canonicalKey),
            source: 'internal',
            name: targetName,
            detail,
            route,
          });
          if (target.last_message || target.last_time || target.unread_count > 0) {
            items.push({
              kind: 'room',
              key: messengerSearchResultKey('internal', 'room', canonicalKey),
              source: 'internal',
              title: targetName,
              detail: target.last_message ?? '가람in 1:1 채팅',
              route,
            });
          }
        };
        result.managers.forEach((target) => appendTarget(
          target,
          formatManagerMessengerDetail(target.affiliation),
          target.phone,
        ));
        result.developers.forEach((target) => appendTarget(target, '개발자', target.phone));
        const adminLatest = [...result.admins].sort((left, right) =>
          new Date(right.last_time ?? 0).getTime() - new Date(left.last_time ?? 0).getTime()
        )[0] ?? {
          name: '총무',
          phone: 'admin',
          unread_count: result.adminUnreadCount,
          last_message: null,
          last_time: null,
        };
        appendTarget(
          { ...adminLatest, unread_count: result.adminUnreadCount },
          '가람in 운영',
          'admin',
          '총무',
        );
      }
      if (!sequences.current.internal.owns(sequence)) return;
      internalMetadataRef.current = items;
      const combinedItems = [...items, ...internalMessagesRef.current];
      const error = internalMessageErrorRef.current;
      updateSource('internal', {
        status: error ? 'error' : internalMessagePendingRef.current
          ? 'loading'
          : combinedItems.length ? 'ready' : 'empty',
        items: combinedItems,
        ...(error ? { error } : {}),
      });
    } catch {
      if (!sequences.current.internal.owns(sequence)) return;
      const error = sourceErrorMessage('internal');
      internalMetadataErrorRef.current = error;
      updateSource('internal', (current) => ({ ...current, status: 'error', error }));
    }
  };

  const loadGroup = async (retrying = false) => {
    const sequence = sequences.current.group.issue();
    updateSource('group', (current) => ({ ...current, status: retrying ? 'retrying' : 'loading', error: undefined }));
    groupMetadataErrorRef.current = null;
    if (!capabilities.canUseGroupChat) {
      updateSource('group', { status: 'empty', items: [] });
      return;
    }
    try {
      const snapshot = await groupChatBootstrap(50);
      const route = { kind: 'group' as const, roomId: snapshot.room.id };
      const items: MessengerSearchResult[] = [{
        kind: 'room',
        key: messengerSearchResultKey('group', 'room', snapshot.room.id),
        source: 'group',
        title: snapshot.room.title,
        detail: `${snapshot.member_count}명 참여`,
        route,
      } satisfies MessengerSearchRoom];
      if (!sequences.current.group.owns(sequence)) return;
      groupMetadataRef.current = items;
      const combinedItems = [...items, ...groupMessagesRef.current];
      const error = groupMessageErrorRef.current;
      updateSource('group', {
        status: error ? 'error' : groupMessagePendingRef.current
          ? 'loading'
          : combinedItems.length ? 'ready' : 'empty',
        items: combinedItems,
        ...(error ? { error } : {}),
      });
    } catch {
      if (!sequences.current.group.owns(sequence)) return;
      const error = sourceErrorMessage('group');
      groupMetadataErrorRef.current = error;
      updateSource('group', (current) => ({ ...current, status: 'error', error }));
    }
  };

  const loadGaramlinkDirectory = async (retrying = false) => {
    const sequence = garamlinkDirectorySequence.current.issue();
    if (!capabilities.canReadRequestBoard) {
      garamlinkDirectoryRef.current = [];
      garamlinkMessagesRef.current = [];
      requestConversationIdsRef.current = [];
      updateSource('garamlink', { status: 'empty', items: [] });
      return;
    }
    updateSource('garamlink', (current) => ({ ...current, status: retrying ? 'retrying' : 'loading', error: undefined }));
    try {
      const session = await ensureRequestBoardSession();
      if (!session.ok) throw new Error('request board session unavailable');
      const [requestRooms, directRooms] = await Promise.all([
        rbGetConversationsOrThrow(),
        rbGetDmConversationsOrThrow(),
      ]);
      const people = capabilities.canLoadRequestBoardDirectory
        ? await (isRequestBoardDesigner
          ? rbGetDirectMessageUsersOrThrow(undefined, 'fc')
          : rbGetDesignersOrThrow())
        : [];
      const items: MessengerSearchResult[] = [];
      requestConversationIdsRef.current = requestRooms.flatMap((room) => room.conversationIds);
      requestRoomLabelRef.current = new Map();
      directRoomLabelRef.current = new Map();
      const routeByParticipant = new Map<number, MessengerSearchRoom['route']>();
      requestRooms.forEach((room) => {
        const route = { kind: 'garamlink-request' as const, requestDesignerId: room.primaryConversationId };
        if (room.participantUserId) routeByParticipant.set(room.participantUserId, route);
        const participantName = requestConversationTitle(room);
        room.conversationIds.forEach((conversationId) => {
          requestRoomLabelRef.current.set(conversationId, participantName);
        });
        items.push({
          kind: 'room',
          key: messengerSearchResultKey('garamlink', 'room', `request:${room.primaryConversationId}`),
          source: 'garamlink',
          title: participantName,
          detail: room.lastMessage?.message ?? '설계 요청 채팅',
          route,
        });
        if (room.participantUserId) {
          items.push({
            kind: 'person',
            key: messengerSearchResultKey('garamlink', 'person', room.participantUserId),
            source: 'garamlink',
            name: participantName,
            detail: room.participantRole === 'designer' ? '설계 매니저' : 'FC',
            route,
          });
        }
      });
      directRooms.forEach((room) => {
        const route = { kind: 'garamlink-direct' as const, directConversationId: room.id };
        if (room.participant?.id) routeByParticipant.set(room.participant.id, route);
        const participantName = directConversationTitle(room);
        directRoomLabelRef.current.set(room.id, participantName);
        items.push({
          kind: 'room',
          key: messengerSearchResultKey('garamlink', 'room', `direct:${room.id}`),
          source: 'garamlink',
          title: participantName,
          detail: room.lastMessage?.message ?? '가람Link 1:1 채팅',
          route,
        });
        if (room.participant?.id) {
          items.push({
            kind: 'person',
            key: messengerSearchResultKey('garamlink', 'person', room.participant.id),
            source: 'garamlink',
            name: participantName,
            detail: room.participant.company_name ?? room.participant.affiliation ?? '가람Link',
            route,
          });
        }
      });
      people.forEach((person) => {
        const isDesigner = 'users' in person;
        const personId = isDesigner ? person.users?.id ?? person.id : person.id;
        const personName = isDesigner
          ? person.users?.name ?? person.contact_name ?? person.company_name ?? '설계 매니저'
          : person.name;
        const detail = isDesigner
          ? person.company_name ?? person.users?.affiliation ?? '설계 매니저'
          : person.affiliation ?? person.company_name ?? 'FC';
        items.push({
          kind: 'person',
          key: messengerSearchResultKey('garamlink', 'person', personId),
          source: 'garamlink',
          name: personName,
          detail,
          route: routeByParticipant.get(personId)
            ?? (capabilities.canCreateRequestBoardDm
              ? { kind: 'new-conversation' as const, participantId: personId }
              : null),
        });
      });
      if (!garamlinkDirectorySequence.current.owns(sequence)) return;
      garamlinkDirectoryErrorRef.current = null;
      garamlinkDirectoryRef.current = items;
      const combinedItems = [...items, ...garamlinkMessagesRef.current];
      const error = garamlinkMessageErrorRef.current;
      updateSource('garamlink', {
        status: error ? 'error' : garamlinkMessagePendingRef.current
          ? 'loading'
          : combinedItems.length ? 'ready' : 'empty',
        items: combinedItems,
        ...(error ? { error } : {}),
      });
    } catch {
      if (!garamlinkDirectorySequence.current.owns(sequence)) return;
      const error = sourceErrorMessage('garamlink');
      garamlinkDirectoryErrorRef.current = error;
      updateSource('garamlink', (current) => ({ ...current, status: 'error', error }));
    }
  };

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
      return;
    }
    void loadInternal();
    void loadGroup();
    void loadGaramlinkDirectory();
    // Loads are intentionally keyed to the canonical actor context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, residentId, role, staffType, isRequestBoardDesigner]);

  const runInternalMessageSearch = async (searchQuery: string, retrying = false) => {
    const sequence = internalMessageSequence.current.issue();
    const queryLength = Array.from(searchQuery).length;
    if (queryLength < 2 || queryLength > 100) {
      internalMessagePendingRef.current = false;
      internalMessageErrorRef.current = null;
      internalMessagesRef.current = [];
      const items = internalMetadataRef.current;
      const error = internalMetadataErrorRef.current;
      updateSource('internal', {
        status: error ? 'error' : items.length ? 'ready' : 'empty',
        items,
        ...(error ? { error } : {}),
      });
      return;
    }
    internalMessagePendingRef.current = true;
    internalMessageErrorRef.current = null;
    if (!retrying) internalMessagesRef.current = [];
    updateSource('internal', {
      status: retrying ? 'retrying' : 'loading',
      items: [...internalMetadataRef.current, ...internalMessagesRef.current],
    });
    try {
      const results = await searchGaraminDirectMessages({ q: searchQuery, limit: 50 });
      if (!internalMessageSequence.current.owns(sequence)) return;
      const messages = results.map((result): MessengerSearchMessage => ({
        kind: 'message',
        key: messengerSearchResultKey('internal', 'message', result.messageId),
        source: 'internal',
        senderName: `${result.senderLabel} · ${result.roomLabel}`,
        text: result.excerpt,
        createdAt: result.sentAt,
        coverage: 'partial',
        route: {
          kind: 'internal',
          conversationId: result.room.conversationId,
          anchorMessageId: result.messageId,
        },
      }));
      internalMessagePendingRef.current = false;
      internalMessagesRef.current = messages;
      const items = [...internalMetadataRef.current, ...messages];
      const error = internalMetadataErrorRef.current;
      updateSource('internal', {
        status: error ? 'error' : items.length ? 'ready' : 'empty',
        items,
        ...(error ? { error } : {}),
      });
    } catch {
      if (!internalMessageSequence.current.owns(sequence)) return;
      internalMessagePendingRef.current = false;
      const error = '가람in 1:1 메시지를 검색하지 못했습니다.';
      internalMessageErrorRef.current = error;
      updateSource('internal', {
        status: 'error',
        items: [...internalMetadataRef.current, ...internalMessagesRef.current],
        error,
      });
    }
  };

  const runGroupMessageSearch = async (searchQuery: string, retrying = false) => {
    const sequence = groupMessageSequence.current.issue();
    const queryLength = Array.from(searchQuery).length;
    if (!capabilities.canUseGroupChat) {
      groupMessagePendingRef.current = false;
      groupMessagesRef.current = [];
      updateSource('group', { status: 'empty', items: [] });
      return;
    }
    if (queryLength < 2 || queryLength > 100) {
      groupMessagePendingRef.current = false;
      groupMessageErrorRef.current = null;
      groupMessagesRef.current = [];
      const items = groupMetadataRef.current;
      const error = groupMetadataErrorRef.current;
      updateSource('group', {
        status: error ? 'error' : items.length ? 'ready' : 'empty',
        items,
        ...(error ? { error } : {}),
      });
      return;
    }
    groupMessagePendingRef.current = true;
    groupMessageErrorRef.current = null;
    if (!retrying) groupMessagesRef.current = [];
    updateSource('group', {
      status: retrying ? 'retrying' : 'loading',
      items: [...groupMetadataRef.current, ...groupMessagesRef.current],
    });
    try {
      const response = await groupChatSearch(searchQuery, 50);
      if (!groupMessageSequence.current.owns(sequence)) return;
      const messages = response.results.map((result): MessengerSearchMessage => ({
        kind: 'message',
        key: messengerSearchResultKey('group', 'message', result.messageId),
        source: 'group',
        senderName: `${result.senderLabel} · ${result.roomLabel}`,
        text: result.excerpt,
        createdAt: result.sentAt,
        coverage: 'partial',
        route: {
          kind: 'group',
          roomId: result.ref.roomId,
          anchorMessageId: result.messageId,
        },
      }));
      groupMessagePendingRef.current = false;
      groupMessagesRef.current = messages;
      const items = [...groupMetadataRef.current, ...messages];
      const error = groupMetadataErrorRef.current;
      updateSource('group', {
        status: error ? 'error' : items.length ? 'ready' : 'empty',
        items,
        ...(error ? { error } : {}),
      });
    } catch {
      if (!groupMessageSequence.current.owns(sequence)) return;
      groupMessagePendingRef.current = false;
      const error = '단체 채팅 메시지를 검색하지 못했습니다.';
      groupMessageErrorRef.current = error;
      updateSource('group', {
        status: 'error',
        items: [...groupMetadataRef.current, ...groupMessagesRef.current],
        error,
      });
    }
  };

  const runGaramlinkMessageSearch = async (searchQuery: string, retrying = false) => {
    const sequence = garamlinkMessageSequence.current.issue();
    const queryLength = Array.from(searchQuery).length;
    if (!capabilities.canReadRequestBoard) {
      garamlinkMessagePendingRef.current = false;
      garamlinkMessagesRef.current = [];
      updateSource('garamlink', { status: 'empty', items: [] });
      return;
    }
    if (queryLength < 2 || queryLength > 100) {
      garamlinkMessagePendingRef.current = false;
      garamlinkMessageErrorRef.current = null;
      garamlinkMessagesRef.current = [];
      const items = garamlinkDirectoryRef.current;
      updateSource('garamlink', {
        status: garamlinkDirectoryErrorRef.current ? 'error' : items.length ? 'ready' : 'empty',
        items,
        ...(garamlinkDirectoryErrorRef.current ? { error: garamlinkDirectoryErrorRef.current } : {}),
      });
      return;
    }
    garamlinkMessagePendingRef.current = true;
    garamlinkMessageErrorRef.current = null;
    if (!retrying) garamlinkMessagesRef.current = [];
    updateSource('garamlink', {
      status: retrying ? 'retrying' : 'loading',
      items: [...garamlinkDirectoryRef.current, ...garamlinkMessagesRef.current],
    });
    const previousMessages = garamlinkMessagesRef.current;
    const [requestResult, directResult] = await Promise.all([
      rbSearchMessages(searchQuery, requestConversationIdsRef.current),
      rbSearchDirectMessages(searchQuery),
    ]);
    if (!garamlinkMessageSequence.current.owns(sequence)) return;
    garamlinkMessagePendingRef.current = false;
    const messages: MessengerSearchMessage[] = [];
    if (requestResult.status === 'ready') {
      requestResult.items.forEach((message) => messages.push({
        kind: 'message',
        key: messengerSearchResultKey('garamlink', 'message', `request:${message.id}`),
        source: 'garamlink',
        senderName: `${message.sender?.name ?? '가람Link 사용자'} · ${requestRoomLabelRef.current.get(message.request_designer_id) ?? '설계 요청 채팅'}`,
        text: message.message,
        createdAt: message.created_at,
        coverage: 'partial',
        route: {
          kind: 'garamlink-request',
          requestDesignerId: message.request_designer_id,
          anchorMessageId: message.id,
        },
      }));
    }
    if (directResult.status === 'ready') {
      directResult.items.forEach((message) => messages.push({
        kind: 'message',
        key: messengerSearchResultKey('garamlink', 'message', `direct:${message.id}`),
        source: 'garamlink',
        senderName: `${message.sender?.name ?? '가람Link 사용자'} · ${directRoomLabelRef.current.get(message.direct_conversation_id) ?? '가람Link 1:1 채팅'}`,
        text: message.message,
        createdAt: message.created_at,
        coverage: 'partial',
        route: {
          kind: 'garamlink-direct',
          directConversationId: message.direct_conversation_id,
          anchorMessageId: message.id,
        },
      }));
    }
    if (retrying && requestResult.status === 'error') {
      messages.push(...previousMessages.filter((message) =>
        message.key.startsWith('garamlink:message:request:')
      ));
    }
    if (retrying && directResult.status === 'error') {
      messages.push(...previousMessages.filter((message) =>
        message.key.startsWith('garamlink:message:direct:')
      ));
    }
    const failed = requestResult.status === 'error' || directResult.status === 'error';
    garamlinkMessagesRef.current = messages;
    const items = [...garamlinkDirectoryRef.current, ...messages];
    const error = failed
      ? '가람Link 메시지 검색 일부를 완료하지 못했습니다.'
      : garamlinkDirectoryErrorRef.current;
    garamlinkMessageErrorRef.current = failed ? error : null;
    updateSource('garamlink', {
      status: error ? 'error' : items.length ? 'ready' : 'empty',
      items,
      ...(error ? { error } : {}),
    });
  };

  useEffect(() => {
    void runInternalMessageSearch(debouncedQuery);
    void runGroupMessageSearch(debouncedQuery);
    void runGaramlinkMessageSearch(debouncedQuery);
    // Each source owns an independent latest-search sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, capabilities.canReadRequestBoard, capabilities.canUseGroupChat]);

  const visibleSources = useMemo<MessengerSearchSourceResult[]>(() => {
    const sourceOrder: MessengerSearchSource[] = ['internal', 'group', 'garamlink'];
    const queryLength = Array.from(debouncedQuery).length;
    return sourceOrder.map((source) => {
      const store = sources[source];
      const supportsMessageSearch = source === 'internal'
        ? capabilities.internalPeopleSource !== 'none'
        : source === 'group'
          ? capabilities.canUseGroupChat
          : capabilities.canReadRequestBoard;
      const filteredMetadata = filterMessengerSearchItems(
        store.items.filter((item) => item.kind !== 'message'),
        debouncedQuery,
      );
      // Server message search already matched the full canonical body. Do not
      // filter its bounded excerpt again or matches beyond the excerpt vanish.
      const filtered = filterMessengerSearchTab([
        ...filteredMetadata,
        ...store.items.filter((item) => item.kind === 'message'),
      ], activeTab);
      const status = queryLength === 1 && supportsMessageSearch && store.status !== 'error'
        ? 'hint'
        : store.status === 'ready' && filtered.length === 0 ? 'empty' : store.status;
      return { source, status, items: filtered, error: store.error };
    });
  }, [activeTab, capabilities, debouncedQuery, sources]);

  const resultCount = aggregateMessengerSearchSources(visibleSources).length;

  const openResult = (item: MessengerSearchResult) => {
    const target = item.route;
    if (!target) return;
    const route = buildMessengerSearchRoute(target);
    if (!route) return;
    router.push({ pathname: route.pathname, params: route.params } as never);
  };

  const retrySource = (source: MessengerSearchSource) => {
    if (source === 'internal') {
      void loadInternal(true);
      void runInternalMessageSearch(debouncedQuery, true);
    }
    if (source === 'group') {
      void loadGroup(true);
      void runGroupMessageSearch(debouncedQuery, true);
    }
    if (source === 'garamlink') {
      void loadGaramlinkDirectory(true);
      void runGaramlinkMessageSearch(debouncedQuery, true);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      <MessengerSearchHeader
        onBack={() => router.back()}
        onChangeText={(value) => setQuery(Array.from(value).slice(0, 100).join(''))}
        onClear={() => setQuery('')}
        value={query}
      />
      {debouncedQuery ? (
        <MessengerSearchTabs activeTab={activeTab} onChange={setActiveTab} />
      ) : null}
      <ScrollView
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {!debouncedQuery ? (
          <MessengerSearchLanding
            onClearAll={() => setHistory(messengerSearchHistory.clear())}
            onRemove={(item) => setHistory(messengerSearchHistory.remove(item))}
            onSelect={setQuery}
            onToggleSave={(enabled) => setHistory(messengerSearchHistory.setSaveEnabled(enabled))}
            recentQueries={history.queries}
            saveEnabled={history.saveEnabled}
          />
        ) : (
          <View accessibilityLabel={`검색 결과 ${resultCount}개`}>
        <MessengerSearchResults
          activeTab={activeTab}
          onOpen={openResult}
              onRetry={retrySource}
              query={debouncedQuery}
              sources={visibleSources}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#FFFFFF', flex: 1 },
});
