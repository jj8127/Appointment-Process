import { Feather, Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BrandedLoadingSpinner from '@/components/BrandedLoadingSpinner';
import { LinkifiedSelectableText } from '@/components/LinkifiedSelectableText';
import { MessageUnreadReceiptBadge } from '@/components/MessageUnreadReceiptBadge';
import {
  MessageSelectCopySheet,
  MessengerMessageActionSheet,
  MESSENGER_REACTIONS,
} from '@/components/MessengerMessageActionSheet';
import MessengerLoadingState from '@/components/MessengerLoadingState';
import { ConversationSettingsSheet } from '@/components/messenger/ConversationSettingsSheet';
import { useKeyboardVisible } from '@/hooks/use-keyboard-padding';
import { getChatComposerBottomPadding } from '@/lib/chat-keyboard-layout';
import { classifyGroupChatError } from '@/lib/group-chat-error';
import {
  formatGroupChatTime,
  getGroupChatMemberStatusTone,
  getGroupChatMessageCopyText,
  getGroupChatReplyLabel,
  getGroupChatRoleLabel,
  isStaffGroupChatActor,
  normalizeGroupChatMemberSearch,
  resolveGroupChatSendPermission,
} from '@/lib/group-chat-display';
import {
  openAuthorizedMessengerAttachment,
  openMessengerAttachment,
} from '@/lib/messenger-attachment-actions';
import {
  appendMessengerAttachmentCandidates,
  formatMessengerAttachmentSize,
  isPreparedMessengerAttachmentBatchForDraft,
  MAX_MESSENGER_ATTACHMENTS,
  MESSENGER_ATTACHMENT_MIME_BY_EXTENSION,
  prepareMessengerAttachmentBatch,
  removeSelectedMessengerAttachment,
  uploadMessengerAttachmentBatch,
  type PreparedMessengerAttachmentBatch,
  type SelectedMessengerAttachment,
} from '@/lib/messenger-attachment-api';
import { copyTextWithFeedback } from '@/lib/messenger-copy-actions';
import { confirmMessengerDelete } from '@/lib/messenger-delete-actions';
import {
  groupChatBootstrap,
  groupChatClearNotice,
  groupChatContext,
  groupChatDeleteMessage,
  getGroupChatNotificationRetry,
  hasGroupChatPostCommitWarning,
  groupChatMarkRead,
  groupChatRetryNotification,
  groupChatSend,
  groupChatSetMemberSendPermission,
  groupChatSetMuted,
  groupChatSetNotice,
  groupChatSetReaction,
  type GroupChatActor,
  type GroupChatMember,
  type GroupChatMessage,
  type GroupChatMessageType,
  type GroupChatNotificationRetry,
  type GroupChatNotice,
  type GroupChatRoom,
} from '@/lib/group-chat-api';
import { logger } from '@/lib/logger';
import {
  buildMessengerNotificationPreferenceFailure,
  buildMessengerNotificationPreferenceLoadFailure,
  type MessengerNotificationPreferenceFailure,
} from '@/lib/messenger-notification-preferences';
import {
  buildMessengerRoomRef,
  getNotificationPreferences,
} from '@/lib/notification-preferences-api';
import { NotificationReceiptStatusBanner } from '@/lib/notification-receipt-ui';
import {
  hasPresentRouteParam,
  parseExactlyOneUuidRouteParam,
} from '@/lib/strict-route-params';
import { supabase } from '@/lib/supabase';
import { useNotificationReceiptCompletion } from '@/lib/use-notification-receipt';
import { safeDecodeFileName } from '@/lib/validation';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6B7280';
const SOFT_BG = '#F9FAFB';
const MESSAGE_LIMIT = 80;
const GROUP_CHAT_ANCHOR_CONTEXT_REVALIDATE_MS = 60_000;

function showGroupChatErrorAlert(error: unknown) {
  const userError = classifyGroupChatError(error);
  Alert.alert(userError.title, userError.message);
}

function showGroupChatDeliveryWarning(retryNotification?: () => void) {
  logger.warn('[group-chat] notification inbox persistence failed');
  Alert.alert(
    '메시지 전송 완료 · 알림 등록 실패',
    '메시지는 전송됐지만 수신자 알림함에 등록하지 못했습니다.',
    retryNotification
      ? [
          { text: '확인', style: 'cancel' },
          { text: '알림만 다시 시도', onPress: retryNotification },
        ]
      : [{ text: '확인' }],
  );
}

async function retryGroupChatNotificationOnly(
  retry: GroupChatNotificationRetry,
) {
  try {
    const result = await groupChatRetryNotification(retry);
    if (hasGroupChatPostCommitWarning(result)) {
      const nextRetry = getGroupChatNotificationRetry(result);
      showGroupChatDeliveryWarning(
        nextRetry
          ? () => {
              void retryGroupChatNotificationOnly(nextRetry);
            }
          : undefined,
      );
      return;
    }
    Alert.alert('알림 등록 완료', '수신자 알림함에 알림을 등록했습니다.');
  } catch (error) {
    logger.warn('[group-chat] notification-only retry failed', error);
    showGroupChatErrorAlert(error);
  }
}
type OptimisticMessageInput = {
  content: string;
  messageType: GroupChatMessageType;
};

type SearchableGroupChatMember = GroupChatMember & {
  search_key: string;
};

type GroupChatScrollToIndexFailure = {
  index: number;
  highestMeasuredFrameIndex: number;
  averageItemLength: number;
};

type MemberListRowProps = {
  member: GroupChatMember;
  canManageMemberSendPermissions: boolean;
  permissionUpdating: boolean;
  onToggle: (member: GroupChatMember, nextCanSend: boolean) => void;
};

export const options = { headerShown: false };

const sortMessagesDesc = (rows: GroupChatMessage[]) =>
  [...rows].sort((left, right) => {
    const leftTime = new Date(left.created_at).getTime();
    const rightTime = new Date(right.created_at).getTime();
    if (leftTime !== rightTime) return rightTime - leftTime;
    return right.id.localeCompare(left.id);
  });

const dedupeMessages = (rows: GroupChatMessage[]) => {
  const map = new Map<string, GroupChatMessage>();
  rows.forEach((row) => {
    if (row?.id && !map.has(row.id)) map.set(row.id, row);
  });
  return Array.from(map.values());
};

function getInitial(name?: string | null) {
  const normalized = String(name ?? '').replace(/\s+/g, '').trim();
  return normalized ? normalized.charAt(0) : '가';
}

const MemberListRow = memo(function MemberListRow({
  member,
  canManageMemberSendPermissions,
  permissionUpdating,
  onToggle,
}: MemberListRowProps) {
  const statusTone = getGroupChatMemberStatusTone(member);
  const canManageSendPermission = canManageMemberSendPermissions && member.role === 'fc';
  const handleSwitchChange = useCallback((nextValue: boolean) => {
    onToggle(member, nextValue);
  }, [member, onToggle]);

  return (
    <View style={styles.memberRow}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarText}>{getInitial(member.name)}</Text>
      </View>
      <View style={styles.memberBody}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName} numberOfLines={1}>{member.name ?? '이름 없음'}</Text>
          <Text style={styles.memberRole}>{getGroupChatRoleLabel(member.role)}</Text>
        </View>
        <Text style={styles.memberMeta} numberOfLines={1}>{member.headquarters ?? '본부 미지정'}</Text>
      </View>
      <View style={styles.memberTrailing}>
        <View style={[styles.memberStatusBadge, styles[`memberStatus_${statusTone}`]]}>
          <Text style={[styles.memberStatusText, styles[`memberStatusText_${statusTone}`]]}>
            {member.appointment_label}
          </Text>
        </View>
        {canManageSendPermission && (
          <View style={styles.memberPermissionRow}>
            <Text
              style={[
                styles.memberPermissionText,
                member.can_send_messages && styles.memberPermissionTextOn,
              ]}
            >
              {member.can_send_messages ? '허용' : '금지'}
            </Text>
            <Switch
              value={member.can_send_messages === true}
              disabled={permissionUpdating}
              onValueChange={handleSwitchChange}
              trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
              thumbColor={member.can_send_messages ? HANWHA_ORANGE : '#F9FAFB'}
              ios_backgroundColor="#E5E7EB"
            />
          </View>
        )}
      </View>
    </View>
  );
});

export default function GroupChatScreen() {
  const router = useRouter();
  const { roomId, anchorMessageId, notificationId, notificationTarget } =
    useLocalSearchParams<{
      roomId?: string;
      anchorMessageId?: string;
      notificationId?: string;
      notificationTarget?: string;
    }>();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const flatListRef = useRef<FlatList<GroupChatMessage> | null>(null);
  const pickingRef = useRef(false);
  const attachmentBatchRef = useRef<PreparedMessengerAttachmentBatch | null>(
    null,
  );
  const attachmentBatchReplyTargetRef = useRef<string | null>(null);
  const messagesRef = useRef<GroupChatMessage[]>([]);
  const anchorContextRef = useRef<{
    key: string;
    messages: GroupChatMessage[];
    hasBefore: boolean;
    hasAfter: boolean;
    validatedAt: number;
  } | null>(null);
  const anchorContextAttemptedKeyRef = useRef<string | null>(null);
  const anchorContextLastAttemptAtRef = useRef(0);
  const anchorContextInFlightKeyRef = useRef<string | null>(null);
  const anchorContextRequestGenerationRef = useRef(0);
  const anchorScrollHandledKeyRef = useRef<string | null>(null);
  const pendingAnchorMessageIdRef = useRef<string | null>(null);
  const anchorScrollRetryCountRef = useRef(0);
  const roomPreferenceSequenceRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [room, setRoom] = useState<GroupChatRoom | null>(null);
  const [actor, setActor] = useState<GroupChatActor | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [members, setMembers] = useState<GroupChatMember[]>([]);
  const [memberListVisible, setMemberListVisible] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [muted, setMuted] = useState(false);
  const [conversationSettingsVisible, setConversationSettingsVisible] = useState(false);
  const [roomPreferenceLoading, setRoomPreferenceLoading] = useState(false);
  const [roomPreferenceReady, setRoomPreferenceReady] = useState(false);
  const [roomPreferenceLoadedKey, setRoomPreferenceLoadedKey] =
    useState<string | null>(null);
  const [roomPreferencePending, setRoomPreferencePending] = useState(false);
  const [roomPreferenceFailure, setRoomPreferenceFailure] =
    useState<MessengerNotificationPreferenceFailure | null>(null);
  const [canSendMessages, setCanSendMessages] = useState(false);
  const [notice, setNotice] = useState<GroupChatNotice | null>(null);
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedAttachments, setSelectedAttachments] = useState<
    SelectedMessengerAttachment[]
  >([]);
  const [replyTarget, setReplyTarget] = useState<GroupChatMessage | null>(null);
  const [actionMessage, setActionMessage] = useState<GroupChatMessage | null>(null);
  const [selectCopyMessage, setSelectCopyMessage] = useState<GroupChatMessage | null>(null);
  const [noticeUpdating, setNoticeUpdating] = useState(false);
  const [permissionUpdatingIds, setPermissionUpdatingIds] = useState<Set<string>>(() => new Set());
  const [roomLoadFailed, setRoomLoadFailed] = useState(false);
  const [anchorLoadFailed, setAnchorLoadFailed] = useState(false);
  const [anchorHasHistoryGap, setAnchorHasHistoryGap] = useState(false);
  const [anchorNavigationDismissed, setAnchorNavigationDismissed] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const composerBottomPadding = getChatComposerBottomPadding({
    keyboardVisible,
    platform: Platform.OS,
    safeAreaBottom: insets.bottom,
  });
  const roomTitle = room?.title ?? '가람PA 단톡방';
  const routeRoomId = parseExactlyOneUuidRouteParam(roomId);
  const hasInvalidRoomRoute =
    hasPresentRouteParam(roomId) && !routeRoomId;
  const routeAnchorMessageId = parseExactlyOneUuidRouteParam(anchorMessageId);
  const hasAnchorRouteParam = hasPresentRouteParam(anchorMessageId);
  const hasInvalidAnchorRoute =
    hasAnchorRouteParam && !routeAnchorMessageId;
  const anchorRouteKey = `${routeRoomId ?? 'canonical'}:${routeAnchorMessageId ?? 'none'}:${hasInvalidRoomRoute || hasInvalidAnchorRoute ? 'invalid' : 'valid'}`;
  const notificationReceipt = useNotificationReceiptCompletion({
    params: { notificationId, notificationTarget },
    expectedTarget: !hasInvalidRoomRoute && routeRoomId
      ? { version: 1, kind: 'group_chat', roomId: routeRoomId }
      : null,
    loadState: hasInvalidRoomRoute
      ? 'error'
      : roomLoadFailed
      ? 'error'
      : room?.id === routeRoomId
        ? 'success'
        : loading
          ? 'loading'
          : routeRoomId
            ? 'error'
            : 'idle',
  });
  const canManageMemberSendPermissions = isStaffGroupChatActor(actor);
  const canManageNotice = isStaffGroupChatActor(actor);
  const deferredMemberSearch = useDeferredValue(memberSearch);

  const applyMessages = useCallback((nextRows: GroupChatMessage[]) => {
    const sorted = sortMessagesDesc(dedupeMessages(nextRows));
    messagesRef.current = sorted;
    setMessages(sorted);
  }, []);

  const updateMessage = useCallback((messageId: string, patch: Partial<GroupChatMessage>) => {
    const nextRows = messagesRef.current.map((message) =>
      message.id === messageId ? { ...message, ...patch } : message,
    );
    applyMessages(nextRows);
  }, [applyMessages]);

  const removeMessage = useCallback((messageId: string) => {
    applyMessages(messagesRef.current.filter((message) => message.id !== messageId));
  }, [applyMessages]);

  useEffect(() => {
    anchorContextRequestGenerationRef.current += 1;
    anchorContextRef.current = null;
    anchorContextAttemptedKeyRef.current = null;
    anchorContextLastAttemptAtRef.current = 0;
    anchorContextInFlightKeyRef.current = null;
    anchorScrollHandledKeyRef.current = null;
    pendingAnchorMessageIdRef.current = null;
    setAnchorHasHistoryGap(false);
    setAnchorNavigationDismissed(false);
    anchorScrollRetryCountRef.current = 0;
    setHighlightedMessageId(null);
    setAnchorLoadFailed(
      hasAnchorRouteParam && (hasInvalidRoomRoute || hasInvalidAnchorRoute),
    );
  }, [anchorRouteKey, hasAnchorRouteParam, hasInvalidAnchorRoute, hasInvalidRoomRoute]);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    try {
      setRoomLoadFailed(false);
      const data = await groupChatBootstrap(MESSAGE_LIMIT);
      setRoom(data.room);
      setActor(data.actor);
      setMemberCount(data.member_count);
      setMembers(data.members ?? []);
      setMuted(data.muted);
      setCanSendMessages(resolveGroupChatSendPermission(data.actor, data.can_send_messages));
      setNotice(data.notice ?? null);
      const localMessages = messagesRef.current.filter((message) => message.id.startsWith('local-'));
      let contextMessages: GroupChatMessage[] = [];
      if (routeAnchorMessageId && !hasInvalidRoomRoute && !anchorNavigationDismissed) {
        const contextRoomId = routeRoomId ?? data.room.id;
        const contextKey = `${contextRoomId}:${routeAnchorMessageId}`;
        const bootstrapHasAnchor = data.messages.some(
          (message) => message.id === routeAnchorMessageId,
        );
        const cachedContext = anchorContextRef.current?.key === contextKey
          ? anchorContextRef.current
          : null;
        const now = Date.now();
        const cacheNeedsRevalidation = !cachedContext
          || now - cachedContext.validatedAt >= GROUP_CHAT_ANCHOR_CONTEXT_REVALIDATE_MS;
        const lastAttemptMatches = anchorContextAttemptedKeyRef.current === contextKey;
        const contextAttemptDue = !lastAttemptMatches
          || now - anchorContextLastAttemptAtRef.current >= GROUP_CHAT_ANCHOR_CONTEXT_REVALIDATE_MS;

        if (cachedContext) {
          contextMessages = cachedContext.messages;
          setAnchorHasHistoryGap(
            cachedContext.hasBefore || cachedContext.hasAfter,
          );
        }

        if (
          cacheNeedsRevalidation
          && contextAttemptDue
          && anchorContextInFlightKeyRef.current !== contextKey
        ) {
          anchorContextAttemptedKeyRef.current = contextKey;
          anchorContextLastAttemptAtRef.current = now;
          anchorContextInFlightKeyRef.current = contextKey;
          const requestGeneration = anchorContextRequestGenerationRef.current + 1;
          anchorContextRequestGenerationRef.current = requestGeneration;
          try {
            const context = await groupChatContext(contextRoomId, routeAnchorMessageId);
            if (anchorContextRequestGenerationRef.current !== requestGeneration) return;
            if (
              context.roomRef.roomId !== data.room.id
              || context.anchorMessageId !== routeAnchorMessageId
            ) {
              throw new Error('invalid_group_chat_anchor_context');
            }
            contextMessages = context.messages;
            anchorContextRef.current = {
              key: contextKey,
              messages: contextMessages,
              hasBefore: context.hasBefore,
              hasAfter: context.hasAfter,
              validatedAt: Date.now(),
            };
            setAnchorHasHistoryGap(context.hasBefore || context.hasAfter);
            setAnchorLoadFailed(false);
          } catch {
            if (anchorContextRequestGenerationRef.current !== requestGeneration) return;
            logger.warn('[group-chat] anchor context unavailable', {
              reason: 'anchor_context_unavailable',
            });
            anchorContextRef.current = null;
            contextMessages = [];
            setAnchorHasHistoryGap(false);
            if (bootstrapHasAnchor) {
              setAnchorLoadFailed(false);
            } else {
              anchorScrollHandledKeyRef.current = null;
              pendingAnchorMessageIdRef.current = null;
              setHighlightedMessageId(null);
              setAnchorLoadFailed(true);
            }
          } finally {
            if (
              anchorContextRequestGenerationRef.current === requestGeneration
              && anchorContextInFlightKeyRef.current === contextKey
            ) {
              anchorContextInFlightKeyRef.current = null;
            }
          }
        }
      }
      // Full bootstrap rows precede display-only context rows so canonical
      // message metadata wins whenever the bounded windows overlap.
      applyMessages([...data.messages, ...contextMessages, ...localMessages]);
      const topMessageId = data.messages[0]?.id ?? null;
      if (topMessageId) {
        void groupChatMarkRead(topMessageId).catch((error) => {
          logger.debug('[group-chat] mark read after load failed', error);
        });
      }
    } catch (error) {
      setRoomLoadFailed(true);
      logger.warn('[group-chat] load failed', error);
      if (!options?.silent) {
        showGroupChatErrorAlert(error);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [
    anchorNavigationDismissed,
    applyMessages,
    hasInvalidRoomRoute,
    routeAnchorMessageId,
    routeRoomId,
  ]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const subscription = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') void load({ silent: true });
      });
      return () => subscription.remove();
    }, [load]),
  );

  const handleAnchorScrollToIndexFailed = useCallback((
    info: GroupChatScrollToIndexFailure,
  ) => {
    const pendingAnchorMessageId = pendingAnchorMessageIdRef.current;
    if (!pendingAnchorMessageId) return;
    const currentAnchorIndex = messagesRef.current.findIndex(
      (message) => message.id === pendingAnchorMessageId,
    );
    if (currentAnchorIndex < 0) return;

    const approximateOffset = Math.max(
      0,
      info.averageItemLength * currentAnchorIndex,
    );
    flatListRef.current?.scrollToOffset({
      offset: approximateOffset,
      animated: false,
    });
    if (anchorScrollRetryCountRef.current >= 2) return;

    anchorScrollRetryCountRef.current += 1;
    setTimeout(() => {
      if (pendingAnchorMessageIdRef.current !== pendingAnchorMessageId) return;
      const retryIndex = messagesRef.current.findIndex(
        (message) => message.id === pendingAnchorMessageId,
      );
      if (retryIndex < 0) return;
      flatListRef.current?.scrollToIndex({
        index: retryIndex,
        animated: true,
        viewPosition: 0.5,
      });
    }, 80);
  }, []);

  useEffect(() => {
    if (
      loading
      || anchorNavigationDismissed
      || !room?.id
      || !routeAnchorMessageId
    ) return undefined;
    const scrollKey = `${room.id}:${routeAnchorMessageId}`;
    if (anchorScrollHandledKeyRef.current === scrollKey) return undefined;

    // The inverted list still consumes the newest-first data index directly;
    // reversing this index would jump to the wrong message.
    const anchorIndex = messages.findIndex(
      (message) => message.id === routeAnchorMessageId,
    );
    if (anchorIndex < 0) return undefined;

    anchorScrollHandledKeyRef.current = scrollKey;
    pendingAnchorMessageIdRef.current = routeAnchorMessageId;
    anchorScrollRetryCountRef.current = 0;
    setHighlightedMessageId(routeAnchorMessageId);
    const frame = requestAnimationFrame(() => {
      flatListRef.current?.scrollToIndex({
        index: anchorIndex,
        animated: true,
        viewPosition: 0.5,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    anchorNavigationDismissed,
    loading,
    messages,
    room?.id,
    routeAnchorMessageId,
  ]);

  useEffect(() => {
    if (!highlightedMessageId) return undefined;
    const timeoutId = setTimeout(() => setHighlightedMessageId(null), 4_000);
    return () => clearTimeout(timeoutId);
  }, [highlightedMessageId]);

  const handleReturnToLatest = useCallback(() => {
    setAnchorNavigationDismissed(true);
    anchorContextRequestGenerationRef.current += 1;
    anchorContextRef.current = null;
    anchorContextAttemptedKeyRef.current = null;
    anchorContextLastAttemptAtRef.current = 0;
    anchorContextInFlightKeyRef.current = null;
    anchorScrollHandledKeyRef.current = null;
    pendingAnchorMessageIdRef.current = null;
    anchorScrollRetryCountRef.current = 0;
    setAnchorHasHistoryGap(false);
    setAnchorLoadFailed(false);
    setHighlightedMessageId(null);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  useEffect(() => {
    if (!room?.id) return undefined;
    const channel = supabase
      .channel(`group-chat-room-${room.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_chat_messages',
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const nextMessage = payload.new as GroupChatMessage;
          if (!nextMessage?.id) return;
          const existingMessage = messagesRef.current.find((message) => message.id === nextMessage.id);
          applyMessages([
            {
              ...nextMessage,
              attachments: nextMessage.attachments ?? [],
              unread_count: existingMessage?.unread_count ?? nextMessage.unread_count ?? 0,
            },
            ...messagesRef.current,
          ]);
          void groupChatMarkRead(nextMessage.id).catch((error) => {
            logger.debug('[group-chat] mark read after realtime failed', error);
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [applyMessages, room?.id]);

  const handleRefresh = useCallback(() => {
    if (anchorLoadFailed) {
      anchorContextAttemptedKeyRef.current = null;
      anchorContextLastAttemptAtRef.current = 0;
    }
    setRefreshing(true);
    void load();
  }, [anchorLoadFailed, load]);

  const searchableMembers = useMemo<SearchableGroupChatMember[]>(() => {
    return [...members].sort((left, right) => {
      const roleOrder = { manager: 0, admin: 1, fc: 2 } as const;
      const leftOrder = roleOrder[left.role] ?? 9;
      const rightOrder = roleOrder[right.role] ?? 9;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.name ?? '').localeCompare(String(right.name ?? ''), 'ko-KR');
    }).map((member) => ({
      ...member,
      search_key: normalizeGroupChatMemberSearch(`${member.name ?? ''} ${member.headquarters ?? ''} ${member.phone ?? ''}`),
    }));
  }, [members]);

  const filteredMembers = useMemo(() => {
    const keyword = normalizeGroupChatMemberSearch(deferredMemberSearch);
    if (!keyword) return searchableMembers;
    return searchableMembers.filter((member) => member.search_key.includes(keyword));
  }, [deferredMemberSearch, searchableMembers]);

  const openMemberList = useCallback(() => {
    setMemberSearch('');
    setMemberListVisible(true);
  }, []);

  const openMessageActions = useCallback((message: GroupChatMessage) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch((error) => {
      logger.debug('[group-chat] haptic feedback failed', error);
    });
    setActionMessage(message);
  }, []);

  const closeMessageActions = useCallback(() => {
    setActionMessage(null);
  }, []);

  const canDeleteMessage = useCallback((message?: GroupChatMessage | null) =>
    Boolean(message?.id && !message.deleted_at && message.sender_actor_id === actor?.id), [actor?.id]);

  const showSendPermissionAlert = useCallback(() => {
    Alert.alert('채팅 권한이 꺼져 있어요', '총무 또는 본부장에게 문의해주세요.');
  }, []);

  const handleReplyAction = useCallback(() => {
    if (!actionMessage || actionMessage.deleted_at) {
      setActionMessage(null);
      return;
    }
    setReplyTarget(actionMessage);
    setActionMessage(null);
  }, [actionMessage]);

  const handleCopyAction = useCallback(async () => {
    const copyText = getGroupChatMessageCopyText(actionMessage);
    setActionMessage(null);
    await copyTextWithFeedback(copyText, { logScope: 'group-chat' });
  }, [actionMessage]);

  const handleSelectCopyAction = useCallback(() => {
    const message = actionMessage;
    setActionMessage(null);
    if (!getGroupChatMessageCopyText(message)) {
      Alert.alert('선택 복사할 수 없어요', '선택 복사할 메시지 내용이 없습니다.');
      return;
    }
    setSelectCopyMessage(message);
  }, [actionMessage]);

  const handleNoticeAction = useCallback(async () => {
    const message = actionMessage;
    if (!message || !canManageNotice || message.deleted_at || message.id.startsWith('local-') || message.send_status) {
      setActionMessage(null);
      return;
    }

    const shouldClear = notice?.message_id === message.id;
    setActionMessage(null);
    setNoticeUpdating(true);
    try {
      if (shouldClear) {
        await groupChatClearNotice();
        setNotice(null);
      } else {
        const result = await groupChatSetNotice(message.id);
        setNotice(result.notice);
      }
    } catch (error) {
      logger.warn('[group-chat] notice update failed', error);
      showGroupChatErrorAlert(error);
    } finally {
      setNoticeUpdating(false);
    }
  }, [actionMessage, canManageNotice, notice?.message_id]);

  const handleNoticeClear = useCallback(async () => {
    if (!canManageNotice || !notice) return;
    setNoticeUpdating(true);
    try {
      await groupChatClearNotice();
      setNotice(null);
    } catch (error) {
      logger.warn('[group-chat] notice clear failed', error);
      showGroupChatErrorAlert(error);
    } finally {
      setNoticeUpdating(false);
    }
  }, [canManageNotice, notice]);

  const handleReactionAction = useCallback(async (message: GroupChatMessage, reaction: string) => {
    setActionMessage(null);
    try {
      const alreadyReacted = message.reactions?.some((row) => row.reaction === reaction && row.reacted_by_me);
      const result = await groupChatSetReaction(message.id, alreadyReacted ? null : reaction);
      updateMessage(message.id, { reactions: result.reactions });
    } catch (error) {
      logger.warn('[group-chat] reaction failed', error);
      showGroupChatErrorAlert(error);
    }
  }, [updateMessage]);

  const handleDeleteAction = useCallback(() => {
    const message = actionMessage;
    if (!message || !canDeleteMessage(message)) return;
    setActionMessage(null);
    confirmMessengerDelete({
      logScope: 'group-chat',
      formatFailure: classifyGroupChatError,
      onDelete: async () => {
        const result = await groupChatDeleteMessage(message.id);
        updateMessage(message.id, result.message);
        if (notice?.message_id === message.id) setNotice(null);
      },
    });
  }, [actionMessage, canDeleteMessage, notice?.message_id, updateMessage]);

  const handleMessagePress = useCallback((message: GroupChatMessage) => {
    if (message.deleted_at) return;
    if ((message.message_type === 'image' || message.message_type === 'file') && message.file_url) {
      void openMessengerAttachment(message.file_url, { logScope: 'group-chat' });
    }
  }, []);

  const buildOptimisticMessage = useCallback((input: OptimisticMessageInput): GroupChatMessage | null => {
    if (!actor || !room) return null;
    const now = new Date().toISOString();
    const currentReplyTarget = replyTarget;

    return {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      room_id: room.id,
      sender_actor_id: actor.id,
      sender_role: actor.role,
      sender_phone: actor.phone,
      sender_name: actor.name,
      content: input.content,
      message_type: input.messageType,
      file_url: null,
      file_name: null,
      file_size: null,
      attachments: [],
      created_at: now,
      unread_count: Math.max(0, memberCount - 1),
      reply_to_message_id: currentReplyTarget?.id ?? null,
      reply_to_sender_name: currentReplyTarget?.sender_name ?? null,
      reply_to_content: currentReplyTarget ? getGroupChatReplyLabel(currentReplyTarget) : null,
      deleted_at: null,
      deleted_by_actor_id: null,
      reactions: [],
      send_status: 'sending',
    };
  }, [actor, memberCount, replyTarget, room]);

  const sendOptimisticToServer = useCallback(async (
    localMessageId: string,
    input: OptimisticMessageInput & {
      replyToMessageId?: string | null;
      attachmentBatch?: PreparedMessengerAttachmentBatch | null;
    },
  ) => {
    let notificationRetry: GroupChatNotificationRetry | null = null;
    let shouldShowDeliveryWarning = false;
    const commit = async () => {
      let attachmentIntentIds: string[] | null = null;
      if (input.attachmentBatch) {
        const uploadResult = await uploadMessengerAttachmentBatch(
          input.attachmentBatch,
        );
        if (uploadResult.state === 'committed') {
          return { state: 'committed' as const };
        }
        attachmentIntentIds = uploadResult.intentIds;
      }
      const result = await groupChatSend({
        content: input.content,
        messageType: input.messageType,
        replyToMessageId: input.replyToMessageId,
        ...(input.attachmentBatch && attachmentIntentIds
          ? {
              attachmentIntentIds,
              deliveryKey: input.attachmentBatch.deliveryKey,
              payloadFingerprint: input.attachmentBatch.payloadFingerprint,
            }
          : {}),
      });
      return { state: 'sent' as const, result };
    };
    const commitWithRetry = async (): Promise<
      Awaited<ReturnType<typeof commit>> | null
    > => {
      try {
        return await commit();
      } catch (error) {
        if (!input.attachmentBatch) throw error;
        logger.warn('[group-chat] attachment send result unavailable');
        return new Promise((resolve) => {
          Alert.alert(
            '전송 확인 필요',
            '파일 메시지 전송 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하면 중복 전송되지 않습니다.',
            [
              { text: '취소', style: 'cancel', onPress: () => resolve(null) },
              {
                text: '다시 확인',
                onPress: () => {
                  void commitWithRetry().then(resolve);
                },
              },
            ],
            { cancelable: false },
          );
        });
      }
    };
    try {
      const commitResult = await commitWithRetry();
      if (!commitResult) {
        removeMessage(localMessageId);
        return false;
      }
      if (commitResult.state === 'committed') {
        removeMessage(localMessageId);
        await load({ silent: true });
        return true;
      }
      const { result } = commitResult;
      applyMessages([
        result.message,
        ...messagesRef.current.filter((message) => message.id !== localMessageId),
      ]);
      void groupChatMarkRead(result.message.id).catch((error) => {
        logger.debug('[group-chat] mark read after send failed', error);
      });
      if (result.read_state?.updated === false) {
        logger.warn('[group-chat] post-send read state update failed');
      }
      shouldShowDeliveryWarning = hasGroupChatPostCommitWarning(result);
      notificationRetry = getGroupChatNotificationRetry(result);
    } catch (error) {
      if (input.attachmentBatch) {
        removeMessage(localMessageId);
      } else {
        updateMessage(localMessageId, { send_status: 'failed' });
      }
      logger.warn('[group-chat] send failed', error);
      showGroupChatErrorAlert(error);
      return false;
    }

    if (shouldShowDeliveryWarning) {
      showGroupChatDeliveryWarning(
        notificationRetry
          ? () => {
              void retryGroupChatNotificationOnly(notificationRetry);
            }
          : undefined,
      );
    }
    return true;
  }, [applyMessages, load, removeMessage, updateMessage]);

  const sendPayload = useCallback(async (
    content: string,
    attachments: readonly SelectedMessengerAttachment[],
  ) => {
    if (!canSendMessages) {
      showSendPermissionAlert();
      return false;
    }
    if (!room?.id) {
      Alert.alert('전송 실패', '단톡방 정보를 불러온 뒤 다시 시도해주세요.');
      return false;
    }

    let attachmentBatch: PreparedMessengerAttachmentBatch | null = null;
    try {
      if (attachments.length > 0) {
        const replyToMessageId = replyTarget?.id ?? null;
        const draft = {
          files: attachments,
          context: { kind: 'group' as const, roomId: room.id },
          content,
        };
        const canReuseAttachmentBatch =
          isPreparedMessengerAttachmentBatchForDraft(
            attachmentBatchRef.current,
            draft,
          )
          && attachmentBatchReplyTargetRef.current === replyToMessageId;
        attachmentBatch = canReuseAttachmentBatch
          ? attachmentBatchRef.current
          : await prepareMessengerAttachmentBatch(draft);
        attachmentBatchRef.current = attachmentBatch;
        attachmentBatchReplyTargetRef.current = replyToMessageId;
      }
    } catch (error) {
      Alert.alert(
        '파일 확인 필요',
        error instanceof Error ? error.message : '첨부 파일을 확인해 주세요.',
      );
      return false;
    }

    const optimisticMessage = buildOptimisticMessage({
      content:
        content
        || (attachments.length > 0
          ? `파일 ${attachments.length}개 전송 중`
          : ''),
      messageType: attachments.length > 0 ? 'file' : 'text',
    });
    if (!optimisticMessage) {
      Alert.alert('전송 실패', '단톡방 정보를 불러온 뒤 다시 시도해주세요.');
      return false;
    }

    applyMessages([optimisticMessage, ...messagesRef.current]);
    const sent = await sendOptimisticToServer(optimisticMessage.id, {
      content,
      messageType: attachments.length > 0 ? 'file' : 'text',
      replyToMessageId: optimisticMessage.reply_to_message_id,
      attachmentBatch,
    });
    if (sent) {
      attachmentBatchRef.current = null;
      attachmentBatchReplyTargetRef.current = null;
      setReplyTarget(null);
    }
    return sent;
  }, [
    applyMessages,
    buildOptimisticMessage,
    canSendMessages,
    room?.id,
    replyTarget?.id,
    sendOptimisticToServer,
    showSendPermissionAlert,
  ]);

  const handleSendText = useCallback(() => {
    const nextText = text.trim();
    const attachments = selectedAttachments;
    if ((!nextText && attachments.length === 0) || uploading) return;
    if (!canSendMessages) {
      showSendPermissionAlert();
      return;
    }
    setUploading(true);
    void sendPayload(nextText, attachments)
      .then((sent) => {
        if (!sent) return;
        setText('');
        setSelectedAttachments([]);
      })
      .finally(() => setUploading(false));
  }, [
    canSendMessages,
    selectedAttachments,
    sendPayload,
    showSendPermissionAlert,
    text,
    uploading,
  ]);

  const handleAttachment = useCallback(async () => {
    if (!canSendMessages) {
      showSendPermissionAlert();
      return;
    }
    if (pickingRef.current || uploading) return;
    pickingRef.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: Array.from(
          new Set(Object.values(MESSENGER_ATTACHMENT_MIME_BY_EXTENSION)),
        ),
        copyToCacheDirectory: true,
        multiple: true,
        base64: false,
      });
      if (result.canceled) return;
      const next = await appendMessengerAttachmentCandidates(
        selectedAttachments,
        result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.name,
          size: asset.size,
          mimeType: asset.mimeType,
          webFile: asset.file,
        })),
      );
      setSelectedAttachments(next);
    } catch (error) {
      Alert.alert(
        '파일 선택 실패',
        error instanceof Error ? error.message : '파일을 선택하지 못했습니다.',
      );
    } finally {
      pickingRef.current = false;
    }
  }, [
    canSendMessages,
    selectedAttachments,
    showSendPermissionAlert,
    uploading,
  ]);

  const handleImageAttachment = useCallback(async () => {
    if (!canSendMessages) {
      showSendPermissionAlert();
      return;
    }
    if (pickingRef.current || uploading) return;
    if (selectedAttachments.length >= MAX_MESSENGER_ATTACHMENTS) {
      Alert.alert('첨부 한도', `사진과 파일은 최대 ${MAX_MESSENGER_ATTACHMENTS}개까지 첨부할 수 있습니다.`);
      return;
    }
    pickingRef.current = true;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('사진 권한 필요', '사진을 첨부하려면 사진 접근 권한을 허용해 주세요.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_MESSENGER_ATTACHMENTS - selectedAttachments.length,
        quality: 0.85,
      });
      if (result.canceled) return;
      const selectedAt = Date.now();
      const next = await appendMessengerAttachmentCandidates(
        selectedAttachments,
        result.assets.map((asset, index) => ({
          uri: asset.uri,
          name: asset.fileName ?? `image_${selectedAt}_${index + 1}.jpg`,
          size: asset.fileSize,
          mimeType: asset.mimeType ?? 'image/jpeg',
          webFile: asset.file,
        })),
      );
      setSelectedAttachments(next);
    } catch (error) {
      Alert.alert(
        '사진 선택 실패',
        error instanceof Error ? error.message : '사진을 선택하지 못했습니다.',
      );
    } finally {
      pickingRef.current = false;
    }
  }, [
    canSendMessages,
    selectedAttachments,
    showSendPermissionAlert,
    uploading,
  ]);

  const groupRoomRef = useMemo(() => room?.id
    ? buildMessengerRoomRef('group', room.id)
    : null, [room?.id]);
  const groupSheetRoom = useMemo(() => groupRoomRef ? ({
    version: 1 as const,
    kind: 'group_chat' as const,
    roomId: groupRoomRef.id,
  }) : null, [groupRoomRef]);
  const groupRoomPreferenceReady = Boolean(
    groupRoomRef
    && roomPreferenceReady
    && roomPreferenceLoadedKey === groupRoomRef.key,
  );

  const loadGroupRoomPreference = useCallback(async () => {
    const roomRef = groupRoomRef;
    if (!roomRef) return;
    const sequence = ++roomPreferenceSequenceRef.current;
    setRoomPreferenceLoading(true);
    setRoomPreferenceReady(false);
    setRoomPreferenceLoadedKey(null);
    setRoomPreferenceFailure(null);
    try {
      const preferences = await getNotificationPreferences();
      if (sequence !== roomPreferenceSequenceRef.current) return;
      setMuted(preferences.rooms.some((row) => row.roomKey === roomRef.key));
      setRoomPreferenceLoadedKey(roomRef.key);
      setRoomPreferenceReady(true);
      setRoomPreferenceFailure(null);
    } catch (error) {
      if (sequence !== roomPreferenceSequenceRef.current) return;
      setRoomPreferenceReady(false);
      setRoomPreferenceLoadedKey(null);
      setRoomPreferenceFailure(buildMessengerNotificationPreferenceLoadFailure(error));
    } finally {
      if (sequence === roomPreferenceSequenceRef.current) {
        setRoomPreferenceLoading(false);
      }
    }
  }, [groupRoomRef]);

  useEffect(() => {
    roomPreferenceSequenceRef.current += 1;
    setMuted(false);
    setRoomPreferenceLoading(false);
    setRoomPreferenceReady(false);
    setRoomPreferenceLoadedKey(null);
    setRoomPreferencePending(false);
    setRoomPreferenceFailure(null);
    if (groupRoomRef) void loadGroupRoomPreference();
    return () => {
      roomPreferenceSequenceRef.current += 1;
    };
  }, [groupRoomRef, loadGroupRoomPreference]);

  const saveGroupRoomPreference = useCallback(async (nextMuted: boolean) => {
    const roomRef = groupRoomRef;
    if (
      !roomRef
      || !groupRoomPreferenceReady
      || roomPreferenceLoading
      || roomPreferencePending
    ) return;
    const sequence = ++roomPreferenceSequenceRef.current;
    const previousMuted = muted;
    setMuted(nextMuted);
    setRoomPreferencePending(true);
    setRoomPreferenceFailure(null);

    let confirmedMuted: boolean;
    try {
      const result = await groupChatSetMuted(nextMuted);
      confirmedMuted = result.muted;
    } catch (error) {
      if (sequence !== roomPreferenceSequenceRef.current) return;
      setMuted(previousMuted);
      setRoomPreferenceFailure(buildMessengerNotificationPreferenceFailure(nextMuted, error));
      setRoomPreferencePending(false);
      return;
    }

    if (sequence !== roomPreferenceSequenceRef.current) return;
    setMuted(confirmedMuted);
    setRoomPreferenceLoadedKey(roomRef.key);
    setRoomPreferenceReady(true);

    try {
      const preferences = await getNotificationPreferences();
      if (sequence !== roomPreferenceSequenceRef.current) return;
      setMuted(preferences.rooms.some((row) => row.roomKey === roomRef.key));
      setRoomPreferenceLoadedKey(roomRef.key);
      setRoomPreferenceReady(true);
      setRoomPreferenceFailure(null);
    } catch (error) {
      if (sequence !== roomPreferenceSequenceRef.current) return;
      setRoomPreferenceFailure(buildMessengerNotificationPreferenceLoadFailure(error));
    } finally {
      if (sequence === roomPreferenceSequenceRef.current) {
        setRoomPreferencePending(false);
      }
    }
  }, [
    groupRoomPreferenceReady,
    groupRoomRef,
    muted,
    roomPreferenceLoading,
    roomPreferencePending,
  ]);

  const handleMemberSendPermissionToggle = useCallback(async (member: GroupChatMember, nextCanSend: boolean) => {
    if (!canManageMemberSendPermissions || member.role !== 'fc') return;

    const previousCanSend = member.can_send_messages === true;
    setPermissionUpdatingIds((prev) => {
      const next = new Set(prev);
      next.add(member.actor_id);
      return next;
    });
    setMembers((prev) => prev.map((row) =>
      row.actor_id === member.actor_id ? { ...row, can_send_messages: nextCanSend } : row,
    ));

    try {
      const result = await groupChatSetMemberSendPermission(member.actor_id, nextCanSend);
      const permissionTargetActorId = result.member.actor_id;
      setMembers((prev) => prev.map((row) =>
        row.actor_id === member.actor_id || row.actor_id === permissionTargetActorId
          ? { ...row, ...result.member }
          : row,
      ));
      if (permissionTargetActorId === actor?.id || member.actor_id === actor?.id) {
        setCanSendMessages(resolveGroupChatSendPermission(actor, result.member.can_send_messages));
      }
    } catch (error) {
      setMembers((prev) => prev.map((row) =>
        row.actor_id === member.actor_id ? { ...row, can_send_messages: previousCanSend } : row,
      ));
      logger.warn('[group-chat] member send permission update failed', error);
      showGroupChatErrorAlert(error);
    } finally {
      setPermissionUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(member.actor_id);
        return next;
      });
    }
  }, [actor, canManageMemberSendPermissions]);

  const renderMemberItem = useCallback(({ item }: { item: SearchableGroupChatMember }) => (
    <MemberListRow
      member={item}
      canManageMemberSendPermissions={canManageMemberSendPermissions}
      permissionUpdating={permissionUpdatingIds.has(item.actor_id)}
      onToggle={handleMemberSendPermissionToggle}
    />
  ), [canManageMemberSendPermissions, handleMemberSendPermissionToggle, permissionUpdatingIds]);

  const renderReplyPreview = useCallback((item: GroupChatMessage, isMe: boolean) => {
    if (!item.reply_to_message_id) return null;
    return (
      <View style={[styles.replyPreview, isMe ? styles.replyPreviewMe : styles.replyPreviewOther]}>
        <Text style={[styles.replyPreviewName, isMe ? styles.replyPreviewNameMe : styles.replyPreviewNameOther]} numberOfLines={1}>
          {item.reply_to_sender_name || '원문'}
        </Text>
        <Text style={[styles.replyPreviewText, isMe ? styles.replyPreviewTextMe : styles.replyPreviewTextOther]} numberOfLines={2}>
          {item.reply_to_content || '메시지'}
        </Text>
      </View>
    );
  }, []);

  const renderMessageContent = useCallback((item: GroupChatMessage, isMe: boolean) => {
    if (item.deleted_at) {
      return <Text style={[styles.deletedMessageText, isMe ? styles.deletedMessageTextMe : styles.deletedMessageTextOther]}>삭제된 메시지입니다.</Text>;
    }

    if ((item.attachments ?? []).length > 0) {
      return (
        <View style={styles.attachmentMessageContent}>
          {item.content ? (
            <LinkifiedSelectableText
              text={item.content}
              style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextOther]}
              linkStyle={styles.msgLinkText}
              linkPressBehavior="open"
              selectable={false}
            />
          ) : null}
          {item.attachments.map((attachment) => (
            <Pressable
              key={attachment.id}
              style={[
                styles.fileCard,
                isMe ? styles.fileCardMe : styles.fileCardOther,
              ]}
              onPress={() => {
                void openAuthorizedMessengerAttachment(attachment.id, {
                  logScope: 'group-chat',
                });
              }}
            >
              <View style={[
                styles.fileIconBox,
                isMe ? styles.fileIconBoxMe : styles.fileIconBoxOther,
              ]}>
                <Ionicons
                  name={attachment.mimeType.startsWith('image/')
                    ? 'image-outline'
                    : 'document-text'}
                  size={22}
                  color={isMe ? '#fff' : HANWHA_ORANGE}
                />
              </View>
              <View style={styles.fileTextWrap}>
                <Text
                  style={[
                    styles.fileName,
                    isMe ? styles.fileNameMe : styles.fileNameOther,
                  ]}
                  numberOfLines={2}
                >
                  {attachment.name}
                </Text>
                <Text
                  style={[
                    styles.fileHint,
                    isMe ? styles.fileHintMe : styles.fileHintOther,
                  ]}
                  numberOfLines={1}
                >
                  {formatMessengerAttachmentSize(attachment.size)} · 탭하여 열기
                </Text>
              </View>
              <View style={[
                styles.fileDownloadButton,
                isMe
                  ? styles.fileDownloadButtonMe
                  : styles.fileDownloadButtonOther,
              ]}>
                <Feather
                  name="download"
                  size={16}
                  color={isMe ? '#fff' : HANWHA_ORANGE}
                />
              </View>
            </Pressable>
          ))}
        </View>
      );
    }

    if (item.message_type === 'image' && item.file_url) {
      return (
        <View style={styles.imageTouch}>
          <Image source={{ uri: item.file_url }} style={styles.imagePreview} contentFit="cover" />
        </View>
      );
    }

    if (item.message_type === 'file' && item.file_url) {
      const fileName = safeDecodeFileName(item.file_name) || '파일';
      return (
        <View style={[styles.fileCard, isMe ? styles.fileCardMe : styles.fileCardOther]}>
          <View style={[styles.fileIconBox, isMe ? styles.fileIconBoxMe : styles.fileIconBoxOther]}>
            <Ionicons name="document-text" size={22} color={isMe ? '#fff' : HANWHA_ORANGE} />
          </View>
          <View style={styles.fileTextWrap}>
            <Text style={[styles.fileName, isMe ? styles.fileNameMe : styles.fileNameOther]} numberOfLines={2}>
              {fileName}
            </Text>
            <Text style={[styles.fileHint, isMe ? styles.fileHintMe : styles.fileHintOther]} numberOfLines={1}>
              탭하여 열기
            </Text>
          </View>
          <View style={[styles.fileDownloadButton, isMe ? styles.fileDownloadButtonMe : styles.fileDownloadButtonOther]}>
            <Feather name="download" size={16} color={isMe ? '#fff' : HANWHA_ORANGE} />
          </View>
        </View>
      );
    }

    return (
      <LinkifiedSelectableText
        text={item.content}
        style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextOther]}
        linkStyle={styles.msgLinkText}
        linkPressBehavior="open"
        selectable={false}
      />
    );
  }, []);

  const renderItem = useCallback(({ item }: { item: GroupChatMessage }) => {
    const isMe = item.sender_actor_id === actor?.id;
    const isHighlighted = item.id === highlightedMessageId;
    const unreadCount = Math.max(0, Number(item.unread_count ?? 0));
    const showUnreadCount = unreadCount > 0;
    const reactions = item.reactions ?? [];
    const messageMeta = (
      <View style={[styles.messageSideMeta, isMe ? styles.messageSideMetaMe : styles.messageSideMetaOther]}>
        {showUnreadCount && (
          <MessageUnreadReceiptBadge count={unreadCount} />
        )}
        {item.send_status === 'sending' && <Text style={styles.messageSendStatus}>전송중</Text>}
        {item.send_status === 'failed' && <Text style={[styles.messageSendStatus, styles.messageSendStatusFailed]}>실패</Text>}
        <Text style={styles.timeText}>{formatGroupChatTime(item.created_at)}</Text>
      </View>
    );

    return (
      <View style={[
        styles.msgRow,
        isMe ? styles.msgRowMe : styles.msgRowOther,
        isHighlighted && styles.anchorMessageRow,
      ]}>
        {!isMe && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitial(item.sender_name)}</Text>
          </View>
        )}
        <View style={[styles.msgContainer, { alignItems: isMe ? 'flex-end' : 'flex-start' }]}>
          {!isMe && (
            <Text style={styles.senderName} numberOfLines={1}>
              {item.sender_name || getGroupChatRoleLabel(item.sender_role)}
            </Text>
          )}
          <View style={[styles.messageBubbleLine, isMe ? styles.messageBubbleLineMe : styles.messageBubbleLineOther]}>
            {isMe && messageMeta}
            <Pressable
              onPress={() => handleMessagePress(item)}
              onLongPress={() => openMessageActions(item)}
              delayLongPress={220}
              style={[
                styles.bubble,
                isMe ? styles.bubbleMe : styles.bubbleOther,
                item.message_type === 'image' && !item.deleted_at && styles.bubbleImage,
                item.message_type === 'file' && !item.deleted_at && styles.bubbleFile,
                isHighlighted && styles.anchorMessageBubble,
              ]}
            >
              {renderReplyPreview(item, isMe)}
              {renderMessageContent(item, isMe)}
            </Pressable>
            {!isMe && messageMeta}
          </View>
          {reactions.length > 0 && (
            <View style={[styles.reactionRow, isMe ? styles.reactionRowMe : styles.reactionRowOther]}>
              {reactions.map((row) => (
                <Pressable
                  key={row.reaction}
                  onPress={() => void handleReactionAction(item, row.reaction)}
                  style={[styles.reactionChip, row.reacted_by_me && styles.reactionChipMine]}
                >
                  <Text style={styles.reactionText}>{row.reaction} {row.count}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }, [actor?.id, handleMessagePress, handleReactionAction, highlightedMessageId, openMessageActions, renderMessageContent, renderReplyPreview]);

  const headerSubtitle = useMemo(() => `${memberCount.toLocaleString('ko-KR')}명 참여`, [memberCount]);
  const showAnchorReturnToLatest = Boolean(
    routeAnchorMessageId
    && !hasInvalidRoomRoute
    && !hasInvalidAnchorRoute
    && !anchorLoadFailed
    && !anchorNavigationDismissed
    && room?.id,
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" backgroundColor="#fff" />
      <NotificationReceiptStatusBanner
        state={notificationReceipt.state}
        onRetry={() => void notificationReceipt.retryMarkRead()}
      />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        <Pressable style={styles.headerButton} onPressIn={() => router.back()}>
          <Feather name="arrow-left" size={22} color={CHARCOAL} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{roomTitle}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{headerSubtitle}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.headerButton} onPress={openMemberList}>
            <Feather name="users" size={20} color={CHARCOAL} />
          </Pressable>
          <Pressable
            accessibilityLabel="대화방 설정 열기"
            accessibilityRole="button"
            style={styles.headerButton}
            onPress={() => {
              setConversationSettingsVisible(true);
              void loadGroupRoomPreference();
            }}
          >
            <Feather name={muted ? 'bell-off' : 'more-horizontal'} size={20} color={muted ? MUTED : CHARCOAL} />
          </Pressable>
        </View>
      </View>

      {notice && (
        <Pressable
          style={styles.noticeBanner}
          onPress={() => setSelectCopyMessage(notice.message)}
        >
          <View style={styles.noticeIconBox}>
            <Feather name="volume-2" size={16} color={HANWHA_ORANGE} />
          </View>
          <View style={styles.noticeBody}>
            <Text style={styles.noticeLabel}>공지</Text>
            <Text style={styles.noticeText} numberOfLines={2}>{getGroupChatReplyLabel(notice.message)}</Text>
          </View>
          {canManageNotice && (
            <Pressable
              style={styles.noticeClearButton}
              disabled={noticeUpdating}
              onPress={(event) => {
                event.stopPropagation();
                void handleNoticeClear();
              }}
              hitSlop={8}
            >
              <Feather name="x" size={18} color={MUTED} />
            </Pressable>
          )}
        </Pressable>
      )}

      {(hasInvalidAnchorRoute || anchorLoadFailed) && (
        <View style={styles.anchorUnavailableBanner}>
          <Feather name="info" size={15} color={MUTED} />
          <Text style={styles.anchorUnavailableText}>
            {'\ud574\ub2f9 \uba54\uc2dc\uc9c0 \uc704\uce58\ub97c \uc5f4 \uc218 \uc5c6\uc5b4 \ucd5c\uc2e0 \ub300\ud654\ub97c \ubcf4\uc5ec\ub4dc\ub9bd\ub2c8\ub2e4.'}
          </Text>
        </View>
      )}

      {showAnchorReturnToLatest ? (
        <View style={styles.anchorUnavailableBanner}>
          <Feather name="search" size={15} color={MUTED} />
          <Text style={styles.anchorUnavailableText}>
            {anchorHasHistoryGap
              ? '검색한 메시지와 최신 대화 사이의 일부 메시지는 생략되어 있습니다.'
              : '검색한 메시지 위치를 보고 있습니다.'}
          </Text>
          <Pressable
            accessibilityLabel="최신 메시지로 이동"
            accessibilityRole="button"
            onPress={handleReturnToLatest}
            style={styles.anchorLatestButton}
          >
            <Text style={styles.anchorLatestButtonText}>최신 메시지로</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <MessengerLoadingState variant="group-chat" />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
            onScrollToIndexFailed={handleAnchorScrollToIndexFailed}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={HANWHA_ORANGE} />
            }
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <Feather name="message-circle" size={28} color="#D1D5DB" />
                <Text style={styles.emptyText}>아직 메시지가 없습니다.</Text>
              </View>
            }
          />

          {uploading && (
            <View
              style={[
                styles.uploadingOverlay,
                { bottom: 68 + composerBottomPadding },
              ]}
            >
              <BrandedLoadingSpinner size="sm" color={HANWHA_ORANGE} />
              <Text style={styles.uploadingText}>메시지 전송 중...</Text>
            </View>
          )}

              <View
                style={[
                  styles.inputWrapper,
                  { paddingBottom: composerBottomPadding },
                ]}
              >
                {replyTarget && (
                  <View style={styles.replyTargetBar}>
                    <View style={styles.replyTargetAccent} />
                    <View style={styles.replyTargetBody}>
                      <Text style={styles.replyTargetName} numberOfLines={1}>
                        {replyTarget.sender_name || '메시지'}에게 답장
                      </Text>
                      <Text style={styles.replyTargetText} numberOfLines={1}>
                        {getGroupChatReplyLabel(replyTarget)}
                      </Text>
                    </View>
                    <Pressable onPress={() => setReplyTarget(null)} hitSlop={8}>
                      <Feather name="x" size={18} color={MUTED} />
                    </Pressable>
                  </View>
                )}
                {!canSendMessages && (
                  <View style={styles.sendPermissionNotice}>
                    <Feather name="lock" size={16} color="#92400E" />
                    <Text style={styles.sendPermissionNoticeText}>채팅 권한이 꺼져 있어요</Text>
                  </View>
                )}
                {selectedAttachments.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.selectedAttachmentList}
                    keyboardShouldPersistTaps="handled"
                  >
                    {selectedAttachments.map((attachment) => (
                      <View
                        key={attachment.clientFileId}
                        style={styles.selectedAttachmentChip}
                      >
                        <Ionicons
                          name={attachment.mimeType.startsWith('image/')
                            ? 'image-outline'
                            : 'document-text-outline'}
                          size={17}
                          color={HANWHA_ORANGE}
                        />
                        <View style={styles.selectedAttachmentTextWrap}>
                          <Text
                            style={styles.selectedAttachmentName}
                            numberOfLines={1}
                          >
                            {attachment.name}
                          </Text>
                          <Text style={styles.selectedAttachmentSize}>
                            {formatMessengerAttachmentSize(attachment.size)}
                          </Text>
                        </View>
                        <Pressable
                          hitSlop={8}
                          disabled={uploading}
                          onPress={() => {
                            setSelectedAttachments((current) =>
                              removeSelectedMessengerAttachment(
                                current,
                                attachment.clientFileId,
                              )
                            );
                          }}
                        >
                          <Feather name="x" size={16} color={MUTED} />
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                ) : null}
                <View style={styles.inputContainer}>
              <TouchableOpacity
                onPress={handleImageAttachment}
                style={[
                  styles.attachBtn,
                  (!canSendMessages || uploading) && styles.attachBtnDisabled,
                ]}
                activeOpacity={0.7}
                disabled={!canSendMessages || uploading}
                accessibilityRole="button"
                accessibilityLabel="사진 첨부"
              >
                <Feather name="image" size={22} color="#9CA3AF" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAttachment}
                style={[
                  styles.attachBtn,
                  (!canSendMessages || uploading) && styles.attachBtnDisabled,
                ]}
                activeOpacity={0.7}
                disabled={!canSendMessages || uploading}
                accessibilityRole="button"
                accessibilityLabel="파일 첨부"
              >
                <Feather name="paperclip" size={22} color="#9CA3AF" />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, !canSendMessages && styles.inputDisabled]}
                value={text}
                onChangeText={setText}
                placeholder={canSendMessages ? '메시지를 입력하세요' : '총무 또는 본부장이 채팅을 허용하면 입력할 수 있어요'}
                placeholderTextColor={MUTED}
                multiline
                editable={canSendMessages && !uploading}
                textAlignVertical="center"
                scrollEnabled={false}
              />
              <Pressable
                onPress={handleSendText}
                style={[
                  styles.sendBtn,
                  (
                    !canSendMessages
                    || uploading
                    || (!text.trim() && selectedAttachments.length === 0)
                  ) && styles.sendBtnDisabled,
                ]}
                disabled={
                  !canSendMessages
                  || uploading
                  || (!text.trim() && selectedAttachments.length === 0)
                }
              >
                {uploading ? (
                  <BrandedLoadingSpinner size="sm" color="#fff" />
                ) : (
                  <Feather name="arrow-up" size={20} color="#fff" />
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      <Modal
        visible={memberListVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMemberListVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.memberSheetKeyboardAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.memberSheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMemberListVisible(false)} />
          <View style={[styles.memberSheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.memberSheetHeader}>
              <View>
                <Text style={styles.memberSheetTitle}>대화상대</Text>
                <Text style={styles.memberSheetSubtitle}>{memberCount.toLocaleString('ko-KR')}명 참여</Text>
              </View>
              <Pressable style={styles.memberCloseButton} onPress={() => setMemberListVisible(false)}>
                <Feather name="x" size={22} color={CHARCOAL} />
              </Pressable>
            </View>

            <View style={styles.memberSearchBox}>
              <Feather name="search" size={18} color={MUTED} />
              <TextInput
                value={memberSearch}
                onChangeText={setMemberSearch}
                placeholder="이름으로 검색"
                placeholderTextColor="#9CA3AF"
                style={styles.memberSearchInput}
                autoCorrect={false}
                returnKeyType="search"
              />
              {memberSearch.length > 0 && (
                <Pressable onPress={() => setMemberSearch('')} hitSlop={8}>
                  <Feather name="x" size={18} color={MUTED} />
                </Pressable>
              )}
            </View>

            <FlatList
              data={filteredMembers}
              keyExtractor={(item) => item.actor_id}
              keyboardShouldPersistTaps="handled"
              style={styles.memberList}
              contentContainerStyle={styles.memberListContent}
              renderItem={renderMemberItem}
              extraData={permissionUpdatingIds}
              initialNumToRender={18}
              maxToRenderPerBatch={18}
              updateCellsBatchingPeriod={32}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={
                <View style={styles.memberEmpty}>
                  <Feather name="search" size={24} color="#D1D5DB" />
                  <Text style={styles.memberEmptyText}>검색 결과가 없습니다.</Text>
                </View>
              }
            />
          </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <MessengerMessageActionSheet
        visible={Boolean(actionMessage)}
        preview={getGroupChatReplyLabel(actionMessage)}
        onClose={closeMessageActions}
        reactions={MESSENGER_REACTIONS}
        onReact={(reaction) => actionMessage && void handleReactionAction(actionMessage, reaction)}
        onCopy={!actionMessage?.deleted_at ? handleCopyAction : undefined}
        onSelectCopy={!actionMessage?.deleted_at ? handleSelectCopyAction : undefined}
        onReply={handleReplyAction}
        onNotice={
          canManageNotice &&
          actionMessage &&
          !actionMessage.deleted_at &&
          !actionMessage.id.startsWith('local-') &&
          !actionMessage.send_status
            ? handleNoticeAction
            : undefined
        }
        noticeLabel={notice?.message_id === actionMessage?.id ? '공지 해제' : '공지'}
        noticeDisabled={noticeUpdating}
        onDelete={canDeleteMessage(actionMessage) ? handleDeleteAction : undefined}
      />

      <MessageSelectCopySheet
        visible={Boolean(selectCopyMessage)}
        text={getGroupChatMessageCopyText(selectCopyMessage)}
        onClose={() => setSelectCopyMessage(null)}
        bottomInset={insets.bottom}
      />

      {groupSheetRoom ? (
        <ConversationSettingsSheet
          disabled={roomPreferenceLoading || !groupRoomPreferenceReady}
          disabledReason={roomPreferenceLoading
            ? '이 대화의 알림 설정을 불러오는 중입니다.'
            : !groupRoomPreferenceReady
              ? '알림 설정을 다시 불러와 주세요.'
              : null}
          failure={roomPreferenceFailure}
          muted={muted}
          onClose={() => setConversationSettingsVisible(false)}
          onOpenNotificationSettings={() => {
            setConversationSettingsVisible(false);
            router.push('/notification-settings' as never);
          }}
          onPreferenceChange={(change) => void saveGroupRoomPreference(change.muted)}
          onRetryLoad={() => void loadGroupRoomPreference()}
          onRetryPreferenceChange={(change) => void saveGroupRoomPreference(change.muted)}
          pending={roomPreferencePending}
          room={groupSheetRoom}
          roomTitle={roomTitle}
          visible={conversationSettingsVisible}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SOFT_BG },
  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: CHARCOAL },
  headerSubtitle: { marginTop: 3, fontSize: 12, color: MUTED, fontWeight: '600' },
  noticeBanner: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#FFF7ED',
    borderBottomWidth: 1,
    borderBottomColor: '#FED7AA',
  },
  noticeIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFEDD5',
  },
  noticeBody: { flex: 1, minWidth: 0 },
  noticeLabel: { fontSize: 11, fontWeight: '900', color: HANWHA_ORANGE },
  noticeText: { marginTop: 2, fontSize: 13, lineHeight: 18, color: CHARCOAL, fontWeight: '700' },
  noticeClearButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  anchorUnavailableBanner: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  anchorUnavailableText: { flex: 1, fontSize: 12, lineHeight: 17, color: MUTED },
  anchorLatestButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  anchorLatestButtonText: { color: HANWHA_ORANGE, fontSize: 12, fontWeight: '700' },
  list: { flex: 1 },
  listContent: { paddingVertical: 20, paddingHorizontal: 16, gap: 12, flexGrow: 1 },
  msgRow: { flexDirection: 'row', marginBottom: 12, width: '100%' },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  anchorMessageRow: {
    backgroundColor: '#FFF7ED',
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  avatarText: { fontSize: 15, fontWeight: '800', color: HANWHA_ORANGE },
  msgContainer: { flex: 1, minWidth: 0 },
  senderName: { maxWidth: '82%', fontSize: 12, color: MUTED, marginLeft: 2, marginBottom: 4, fontWeight: '700' },
  messageBubbleLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, width: '100%' },
  messageBubbleLineMe: { justifyContent: 'flex-end' },
  messageBubbleLineOther: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleMe: { backgroundColor: HANWHA_ORANGE, borderTopRightRadius: 2 },
  bubbleOther: { backgroundColor: '#fff', borderTopLeftRadius: 2, borderWidth: 1, borderColor: '#F3F4F6' },
  bubbleImage: { paddingHorizontal: 4, paddingVertical: 4 },
  bubbleFile: { paddingHorizontal: 8, paddingVertical: 8 },
  anchorMessageBubble: {
    borderWidth: 2,
    borderColor: HANWHA_ORANGE,
    shadowColor: HANWHA_ORANGE,
    shadowOpacity: 0.16,
    shadowRadius: 5,
    elevation: 3,
  },
  msgText: { fontSize: 15, lineHeight: 22, flexWrap: 'wrap' },
  msgTextMe: { color: '#fff', fontWeight: '500' },
  msgTextOther: { color: CHARCOAL },
  msgLinkText: { color: '#2563EB', textDecorationLine: 'underline', fontWeight: '700' },
  messageSideMeta: { minWidth: 44, paddingBottom: 2 },
  messageSideMetaMe: { alignItems: 'flex-end' },
  messageSideMetaOther: { alignItems: 'flex-start' },
  messageSendStatus: { fontSize: 10, lineHeight: 13, color: '#9CA3AF', fontWeight: '800' },
  messageSendStatusFailed: { color: '#DC2626' },
  timeText: { fontSize: 11, color: '#9CA3AF' },
  replyPreview: {
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: 3,
  },
  replyPreviewMe: { backgroundColor: 'rgba(255,255,255,0.14)', borderLeftColor: '#fff' },
  replyPreviewOther: { backgroundColor: '#F9FAFB', borderLeftColor: '#D1D5DB' },
  replyPreviewName: { fontSize: 12, fontWeight: '900', marginBottom: 2 },
  replyPreviewNameMe: { color: '#fff' },
  replyPreviewNameOther: { color: HANWHA_ORANGE },
  replyPreviewText: { fontSize: 12, lineHeight: 17 },
  replyPreviewTextMe: { color: 'rgba(255,255,255,0.82)' },
  replyPreviewTextOther: { color: MUTED },
  deletedMessageText: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  deletedMessageTextMe: { color: 'rgba(255,255,255,0.82)' },
  deletedMessageTextOther: { color: MUTED },
  reactionRow: { marginTop: 5, flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: '82%' },
  reactionRowMe: { justifyContent: 'flex-end' },
  reactionRowOther: { justifyContent: 'flex-start' },
  reactionChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  reactionChipMine: { borderColor: HANWHA_ORANGE, backgroundColor: '#FFF7ED' },
  reactionText: { fontSize: 12, fontWeight: '800', color: CHARCOAL },
  imageTouch: { minWidth: 150, minHeight: 150 },
  imagePreview: { width: 200, height: 200, borderRadius: 12 },
  fileCard: {
    width: 240,
    maxWidth: '100%',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  attachmentMessageContent: { gap: 8, minWidth: 190 },
  fileCardMe: { backgroundColor: 'rgba(255,255,255,0.14)' },
  fileCardOther: { backgroundColor: '#FFF7ED' },
  fileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileIconBoxMe: { backgroundColor: 'rgba(255,255,255,0.18)' },
  fileIconBoxOther: { backgroundColor: '#FFEDD5' },
  fileTextWrap: { flex: 1, minWidth: 0 },
  fileName: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  fileNameMe: { color: '#fff' },
  fileNameOther: { color: CHARCOAL },
  fileHint: { marginTop: 2, fontSize: 11 },
  fileHintMe: { color: 'rgba(255,255,255,0.76)' },
  fileHintOther: { color: MUTED },
  fileDownloadButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileDownloadButtonMe: { backgroundColor: 'rgba(255,255,255,0.14)' },
  fileDownloadButtonOther: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  emptyCard: {
    flex: 1,
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyText: { fontSize: 14, color: MUTED, fontWeight: '600' },
  inputWrapper: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  replyTargetBar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  replyTargetAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 999,
    backgroundColor: HANWHA_ORANGE,
  },
  replyTargetBody: { flex: 1, minWidth: 0 },
  replyTargetName: { fontSize: 12, fontWeight: '900', color: HANWHA_ORANGE },
  replyTargetText: { marginTop: 2, fontSize: 13, color: CHARCOAL },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  selectedAttachmentList: {
    gap: 8,
    paddingBottom: 10,
  },
  selectedAttachmentChip: {
    width: 210,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
    backgroundColor: '#FFF7ED',
  },
  selectedAttachmentTextWrap: { flex: 1, minWidth: 0 },
  selectedAttachmentName: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: CHARCOAL,
  },
  selectedAttachmentSize: {
    marginTop: 2,
    fontSize: 11,
    color: MUTED,
  },
  sendPermissionNotice: {
    minHeight: 36,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sendPermissionNoticeText: { flex: 1, fontSize: 13, fontWeight: '800', color: '#92400E' },
  attachBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  attachBtnDisabled: { opacity: 0.45 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    color: CHARCOAL,
  },
  inputDisabled: {
    backgroundColor: '#F3F4F6',
    color: MUTED,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HANWHA_ORANGE,
  },
  sendBtnDisabled: { backgroundColor: '#D1D5DB' },
  uploadingOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#FED7AA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  uploadingText: { flex: 1, fontSize: 13, fontWeight: '700', color: CHARCOAL },
  cancelUploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cancelUploadText: { fontSize: 12, fontWeight: '700', color: '#666' },
  actionMenuBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  actionMenu: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 22,
    backgroundColor: '#202124',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  actionSheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 24, 39, 0.42)',
  },
  actionSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  actionSheetTitle: { fontSize: 16, fontWeight: '900', color: '#F9FAFB' },
  actionSheetPreview: { marginTop: 8, fontSize: 13, lineHeight: 19, color: '#D1D5DB' },
  reactionPickerLabel: { marginTop: 16, fontSize: 12, fontWeight: '900', color: '#D1D5DB' },
  reactionPickerRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  reactionPickerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2F3136',
  },
  reactionPickerText: { fontSize: 22 },
  actionButton: {
    minHeight: 50,
    borderRadius: 10,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
  },
  actionButtonDanger: { backgroundColor: 'transparent' },
  actionButtonText: { fontSize: 17, fontWeight: '800', color: '#F9FAFB' },
  actionButtonTextDanger: { color: '#DC2626' },
  selectCopyBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
  },
  selectCopySheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  selectCopyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  selectCopyTitle: { fontSize: 20, fontWeight: '900', color: CHARCOAL },
  selectCopyCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  selectCopyText: {
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 24,
    color: CHARCOAL,
  },
  memberSheetKeyboardAvoider: {
    flex: 1,
  },
  memberSheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
  },
  memberSheet: {
    width: '100%',
    maxHeight: '82%',
    minHeight: 360,
    flexShrink: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 56,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D1D5DB',
    marginBottom: 18,
  },
  memberSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  memberSheetTitle: { fontSize: 22, fontWeight: '900', color: CHARCOAL },
  memberSheetSubtitle: { marginTop: 4, fontSize: 13, fontWeight: '700', color: MUTED },
  memberCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  memberSearchBox: {
    height: 52,
    marginTop: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F9FAFB',
  },
  memberSearchInput: { flex: 1, fontSize: 16, color: CHARCOAL, paddingVertical: 0 },
  memberList: { flexShrink: 1, marginTop: 12 },
  memberListContent: { paddingBottom: 12 },
  memberRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    paddingVertical: 10,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  memberAvatarText: { fontSize: 17, fontWeight: '900', color: HANWHA_ORANGE },
  memberBody: { flex: 1, minWidth: 0 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberName: { flexShrink: 1, fontSize: 16, fontWeight: '800', color: CHARCOAL },
  memberRole: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '800',
    color: MUTED,
  },
  memberMeta: { marginTop: 4, fontSize: 13, color: MUTED },
  memberTrailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  memberStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  memberStatus_complete: { backgroundColor: '#DCFCE7' },
  memberStatus_partial: { backgroundColor: '#FFEDD5' },
  memberStatus_pending: { backgroundColor: '#F3F4F6' },
  memberStatus_active: { backgroundColor: '#EFF6FF' },
  memberStatusText: { fontSize: 12, fontWeight: '900' },
  memberStatusText_complete: { color: '#059669' },
  memberStatusText_partial: { color: '#EA580C' },
  memberStatusText_pending: { color: MUTED },
  memberStatusText_active: { color: '#2563EB' },
  memberPermissionRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberPermissionText: { minWidth: 28, textAlign: 'right', fontSize: 11, fontWeight: '900', color: MUTED },
  memberPermissionTextOn: { color: HANWHA_ORANGE },
  memberEmpty: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  memberEmptyText: { fontSize: 14, fontWeight: '700', color: MUTED },
});
