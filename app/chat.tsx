import { Feather, Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
} from '@/components/MessengerMessageActionSheet';
import { useKeyboardVisible } from '@/hooks/use-keyboard-padding';
import { getChatComposerBottomPadding } from '@/lib/chat-keyboard-layout';
import { useSession } from '@/hooks/use-session';
import MessengerLoadingState from '@/components/MessengerLoadingState';
import { ConversationSettingsSheet } from '@/components/messenger/ConversationSettingsSheet';
import { goBackOrReplace } from '@/lib/back-navigation';
import {
  deleteGaraminDirectMessage,
  fetchGaraminDirectMessageContext,
  fetchGaraminDirectMessages,
  markGaraminDirectMessagesRead,
  resolveGaraminDirectConversation,
  sendGaraminDirectMessage,
  type GaraminDirectMessageSendResult,
} from '@/lib/direct-message-api';
import { fetchFcChatTargets } from '@/lib/internal-chat-api';
import { getChatTargetPickerHeaderConfig } from '@/lib/chat-navigation';
import { logger } from '@/lib/logger';
import { NotificationReceiptStatusBanner } from '@/lib/notification-receipt-ui';
import { isNotificationUuid } from '@/lib/notification-target';
import {
  hasConflictingRouteParams,
  hasPresentRouteParam,
  parseExactlyOneRouteString,
  parseExactlyOneUuidRouteParam,
} from '@/lib/strict-route-params';
import { copyTextWithFeedback } from '@/lib/messenger-copy-actions';
import { confirmMessengerDelete } from '@/lib/messenger-delete-actions';
import {
  buildMessengerNotificationPreferenceFailure,
  buildMessengerNotificationPreferenceLoadFailure,
  type MessengerNotificationPreferenceFailure,
} from '@/lib/messenger-notification-preferences';
import {
  buildMessengerRoomRef,
  getNotificationPreferences,
  setRoomMuted,
} from '@/lib/notification-preferences-api';
import { getDirectMessageUnreadCount } from '@/lib/message-read-receipts';
import {
  openAuthorizedMessengerAttachment,
  openMessengerAttachment,
} from '@/lib/messenger-attachment-actions';
import {
  appendMessengerAttachmentCandidates,
  formatMessengerAttachmentSize,
  isPreparedMessengerAttachmentBatchForDraft,
  MESSENGER_ATTACHMENT_MIME_BY_EXTENSION,
  prepareMessengerAttachmentBatch,
  removeSelectedMessengerAttachment,
  uploadMessengerAttachmentBatch,
  type MessengerAttachmentMetadata,
  type PreparedMessengerAttachmentBatch,
  type SelectedMessengerAttachment,
} from '@/lib/messenger-attachment-api';
import {
  getLastMessageTimestamp,
  sortConversationsByLastMessageTime,
} from '@/lib/messenger-room-ordering';
import { formatOperationsMessengerName } from '@/lib/messenger-hub-model';
import {
  aggregatePresence,
  formatPresenceLabel,
  getPresenceColor,
  normalizePresencePhone,
} from '@/lib/presence';
import { fetchUserPresence, type AppPresenceSnapshot } from '@/lib/user-presence-api';
import { supabase } from '@/lib/supabase';
import { isValidMobilePhone, safeDecodeFileName } from '@/lib/validation';
import {
  ADMIN_CHAT_ID,
  formatManagerMessengerDetail,
  sanitizePhone,
} from '@/lib/messenger-participants';
import {
  getStaffChatActorId,
} from '@/lib/staff-identity';
import { useNotificationReceiptCompletion } from '@/lib/use-notification-receipt';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const SOFT_BG = '#F9FAFB';
const SCREEN_WIDTH = Dimensions.get('window').width;
const ANCHOR_HIGHLIGHT_DURATION_MS = 2_400;
const ANCHOR_SCROLL_RETRY_DELAY_MS = 120;
const ANCHOR_SCROLL_RETRY_LIMIT = 3;
const ANCHOR_CONTEXT_UNAVAILABLE_MESSAGE =
  '요청한 메시지를 열 수 없습니다. 현재 대화에서 다시 확인해 주세요.';
const FILE_CARD_WIDTH = Math.min(SCREEN_WIDTH * 0.64, 260);
const LEGACY_SESSION_ERROR = '세션이 오래되었습니다. 로그아웃 후 다시 로그인해주세요.';
const HEADER_AVATAR_COLORS = [
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

function getHeaderAvatarColor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return HEADER_AVATAR_COLORS[Math.abs(hash) % HEADER_AVATAR_COLORS.length];
}

function getHeaderAvatarInitial(value: string) {
  const normalized = value.replace(/\s+/g, '').trim();
  if (!normalized) return '메';
  if (/^[0-9]+$/.test(normalized)) return 'F';
  return normalized.charAt(0);
}

function getFcTargetLoadErrorMessage(message?: string | null) {
  const normalized = String(message ?? '').trim();
  if (!normalized) return '대화 상대 목록을 불러오지 못했습니다.';

  const lower = normalized.toLowerCase();
  if (lower.includes('fc profile not found') || lower.includes('resident_id is required')) {
    return LEGACY_SESSION_ERROR;
  }

  return normalized;
}

export const options = { headerShown: false };

type Message = {
  id: string;
  content: string;
  sender_id: string;
  receiver_id: string;
  conversation_id?: string | null;
  created_at: string;
  is_read: boolean;
  message_type?: 'text' | 'image' | 'file';
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  attachments: MessengerAttachmentMetadata[];
  sender_label?: string | null;
  is_context_preview?: boolean;
};

type AnchorScrollFailureInfo = {
  index: number;
  highestMeasuredFrameIndex: number;
  averageItemLength: number;
};

const getMessageCopyText = (message: Message | null | undefined): string => {
  if (!message) return '';

  const content = String(message.content ?? '').trim();
  if (content) return content;
  if (message.attachments.length > 0) {
    return message.attachments.map((attachment) => attachment.name).join('\n');
  }
  return String(message.file_url ?? '').trim();
};

type FcChatTarget = {
  id: string;
  label: string;
  subtitle: string;
  kind: 'manager' | 'admin' | 'developer';
  presencePhones: string[];
  unreadCount: number;
  lastTimestamp: number;
};

type ChatTargetContact = {
  name?: string | null;
  phone?: string | null;
  affiliation?: string | null;
  staff_type?: string | null;
  unread_count?: number | null;
  last_message?: string | null;
  last_time?: string | null;
};

const sortMessagesDesc = (rows: Message[]) =>
  [...rows].sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    if (aTime !== bTime) return bTime - aTime;
    return b.id.localeCompare(a.id);
  });

const dedupeMessagesById = (rows: Message[]) => {
  const map = new Map<string, Message>();
  rows.forEach((row) => {
    if (!row?.id) return;
    if (!map.has(row.id)) {
      map.set(row.id, row);
    }
  });
  return Array.from(map.values());
};

const areMessagesEqual = (prev: Message[], next: Message[]) => {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (
      a.id !== b.id
      || a.content !== b.content
      || a.sender_id !== b.sender_id
      || a.receiver_id !== b.receiver_id
      || a.created_at !== b.created_at
      || a.is_read !== b.is_read
      || (a.sender_label ?? null) !== (b.sender_label ?? null)
      || Boolean(a.is_context_preview) !== Boolean(b.is_context_preview)
      || (a.message_type ?? 'text') !== (b.message_type ?? 'text')
      || (a.file_url ?? null) !== (b.file_url ?? null)
      || (a.file_name ?? null) !== (b.file_name ?? null)
      || (a.file_size ?? null) !== (b.file_size ?? null)
      || a.attachments.length !== b.attachments.length
      || a.attachments.some((attachment, index) => {
        const other = b.attachments[index];
        return !other
          || attachment.id !== other.id
          || attachment.name !== other.name
          || attachment.size !== other.size
          || attachment.mimeType !== other.mimeType
          || attachment.sha256 !== other.sha256;
      })
    ) {
      return false;
    }
  }
  return true;
};

export default function ChatScreen() {
  const router = useRouter();
  const { role, residentId, readOnly, logout, staffType } = useSession();
  const {
    targetId,
    targetName,
    conversationId,
    anchorMessageId,
    notificationId,
    notificationTarget,
  } = useLocalSearchParams<{
    targetId?: string | string[];
    targetName?: string | string[];
    conversationId?: string | string[];
    anchorMessageId?: string | string[];
    notificationId?: string | string[];
    notificationTarget?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const bottomSafeInset = Math.max(insets.bottom, Platform.OS === 'android' ? 20 : 12);
  const composerBottomPadding = getChatComposerBottomPadding({
    keyboardVisible,
    platform: Platform.OS,
    safeAreaBottom: insets.bottom,
  });
  const pickerListBottomPadding = bottomSafeInset + 24;
  const targetPickerHeader = getChatTargetPickerHeaderConfig();
  const targetIdValue = parseExactlyOneRouteString(targetId) ?? undefined;
  const targetNameValue =
    parseExactlyOneRouteString(targetName) ?? undefined;
  const conversationIdValue =
    parseExactlyOneUuidRouteParam(conversationId) ?? '';
  const anchorMessageIdValue =
    parseExactlyOneUuidRouteParam(anchorMessageId) ?? '';
  const hasInvalidAnchorRouteParam =
    hasPresentRouteParam(anchorMessageId)
    && (!anchorMessageIdValue || !conversationIdValue);
  const hasAmbiguousConversationParams =
    hasConflictingRouteParams(targetId, conversationId)
    || (hasPresentRouteParam(targetId) && !targetIdValue)
    || (hasPresentRouteParam(conversationId) && !conversationIdValue)
    || (hasPresentRouteParam(targetName) && !targetNameValue);

  const myId = role === 'admin'
    ? getStaffChatActorId({ residentId, readOnly, staffType })
    : sanitizePhone(residentId);
  const normalizedTargetId = (targetIdValue ?? '').trim().toLowerCase() === ADMIN_CHAT_ID
    ? ADMIN_CHAT_ID
    : sanitizePhone(targetIdValue);
  const [resolvedConversation, setResolvedConversation] = useState<{
    id: string;
    counterpartyId: string;
    counterpartyName: string | null;
  } | null>(null);
  const [conversationResolutionState, setConversationResolutionState] =
    useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [conversationResolutionError, setConversationResolutionError] =
    useState('');
  const [conversationRetryKey, setConversationRetryKey] = useState(0);
  const otherId = resolvedConversation?.counterpartyId ?? normalizedTargetId;
  const [resolvedTargetName, setResolvedTargetName] = useState('');
  const [fcTargets, setFcTargets] = useState<FcChatTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [presenceByPhone, setPresenceByPhone] = useState<Record<string, AppPresenceSnapshot>>({});
  const selectedFcTarget = role === 'fc'
    ? fcTargets.find((target) => target.id === otherId) ?? null
    : null;
  const showFcTargetPicker =
    role === 'fc' && !otherId && !conversationIdValue;
  const headerTitle = role === 'admin'
    ? resolvedTargetName || targetIdValue || 'FC'
    : targetNameValue?.trim()
      || selectedFcTarget?.label
      || resolvedConversation?.counterpartyName
      || '메신저';
  const getPresenceSnapshot = useCallback(
    (phone: string | null | undefined) => presenceByPhone[normalizePresencePhone(phone)] ?? null,
    [presenceByPhone],
  );
  const getPresenceGroupSnapshot = useCallback(
    (phones: (string | null | undefined)[]) => aggregatePresence(presenceByPhone, phones),
    [presenceByPhone],
  );
  const headerPresence = role === 'admin'
    ? getPresenceSnapshot(otherId)
    : getPresenceGroupSnapshot(selectedFcTarget?.presencePhones ?? []);
  const headerPresenceLabel = formatPresenceLabel(headerPresence);
  const headerAvatarColor = getHeaderAvatarColor(headerTitle || otherId || '메신저');
  const headerAvatarInitial = getHeaderAvatarInitial(headerTitle);
  const trackedPresencePhones = useMemo(
    () => Array.from(
      new Set(
        [
          role === 'admin' ? otherId : null,
          ...fcTargets.flatMap((target) => target.presencePhones),
        ]
          .map((phone) => normalizePresencePhone(phone))
          .filter((phone) => phone.length === 11),
      ),
    ),
    [fcTargets, otherId, role],
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [messageLoadState, setMessageLoadState] =
    useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [messageLoadError, setMessageLoadError] = useState('');
  const [anchorContextError, setAnchorContextError] = useState('');
  const [anchorContextRetryKey, setAnchorContextRetryKey] = useState(0);
  const [pendingAnchorMessageId, setPendingAnchorMessageId] = useState('');
  const [anchorNavigationDismissed, setAnchorNavigationDismissed] = useState(false);
  const [conversationSettingsVisible, setConversationSettingsVisible] = useState(false);
  const [roomMuted, setRoomMutedState] = useState(false);
  const [roomPreferenceLoading, setRoomPreferenceLoading] = useState(false);
  const [roomPreferenceReady, setRoomPreferenceReady] = useState(false);
  const [roomPreferenceLoadedKey, setRoomPreferenceLoadedKey] =
    useState<string | null>(null);
  const [roomPreferencePending, setRoomPreferencePending] = useState(false);
  const [roomPreferenceFailure, setRoomPreferenceFailure] =
    useState<MessengerNotificationPreferenceFailure | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState('');
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [selectCopyMessage, setSelectCopyMessage] = useState<Message | null>(null);
  const [text, setText] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<
    SelectedMessengerAttachment[]
  >([]);
  const [sendingAttachments, setSendingAttachments] = useState(false);
  const pickingRef = useRef(false);
  const attachmentBatchRef = useRef<PreparedMessengerAttachmentBatch | null>(
    null,
  );
  const flatListRef = useRef<FlatList<Message>>(null);
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<Message[]>([]);
  const contextMessagesRef = useRef<Message[]>([]);
  const anchorContextRequestKeyRef = useRef('');
  const anchorScrollTargetMessageIdRef = useRef('');
  const anchorScrollRetryCountRef = useRef(0);
  const anchorScrollGenerationRef = useRef(0);
  const anchorLastScrollSignatureRef = useRef('');
  const anchorHistoryStabilizedRef = useRef(false);
  const anchorScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorScrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomPreferenceSequenceRef = useRef(0);
  const directMessagePrefetchRef = useRef<{
    conversationId: string;
    request: Promise<
      | { result: Awaited<ReturnType<typeof fetchGaraminDirectMessages>> }
      | { error: unknown }
    >;
  } | null>(null);

  const loadPresence = useCallback(async (phones = trackedPresencePhones) => {
    if (phones.length === 0) {
      setPresenceByPhone({});
      return;
    }

    const rows = await fetchUserPresence(phones);
    const nextPresenceByPhone = rows.reduce<Record<string, AppPresenceSnapshot>>((acc, row) => {
      acc[normalizePresencePhone(row.phone)] = row;
      return acc;
    }, {});

    setPresenceByPhone(nextPresenceByPhone);
  }, [trackedPresencePhones]);

  useEffect(() => {
    if (trackedPresencePhones.length === 0) {
      setPresenceByPhone({});
      return;
    }

    void loadPresence(trackedPresencePhones);
  }, [loadPresence, trackedPresencePhones]);

  useFocusEffect(useCallback(() => {
    if (trackedPresencePhones.length === 0) {
      return undefined;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void loadPresence(trackedPresencePhones);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [loadPresence, trackedPresencePhones]));

  const applyMessages = useCallback((rows: Message[]) => {
    const uniqueRows = dedupeMessagesById(rows);
    const sorted = sortMessagesDesc(uniqueRows);
    if (areMessagesEqual(messagesRef.current, sorted)) return false;
    messagesRef.current = sorted;
    setMessages(sorted);
    return true;
  }, []);

  const highlightAnchorMessage = useCallback((messageId: string) => {
    setHighlightedMessageId(messageId);
    if (anchorHighlightTimerRef.current) {
      clearTimeout(anchorHighlightTimerRef.current);
    }
    anchorHighlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId((current) => current === messageId ? '' : current);
      anchorHighlightTimerRef.current = null;
    }, ANCHOR_HIGHLIGHT_DURATION_MS);
  }, []);

  const activateAnchorMessage = useCallback((messageId: string) => {
    if (!messagesRef.current.some((message) => message.id === messageId)) {
      return false;
    }

    setAnchorContextError('');
    setPendingAnchorMessageId(messageId);
    highlightAnchorMessage(messageId);
    return true;
  }, [highlightAnchorMessage]);

  const createOptimisticMessage = useCallback(
    (
      content: string,
      type: 'text' | 'image' | 'file' = 'text',
      fileData?: { url: string; name: string; size?: number },
    ): Message | null => {
      if (!myId || !otherId) {
        return null;
      }

      return {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content,
        sender_id: myId,
        receiver_id: otherId,
        conversation_id: resolvedConversation?.id ?? null,
        created_at: new Date().toISOString(),
        is_read: false,
        message_type: type,
        file_url: fileData?.url ?? null,
        file_name: fileData?.name ?? null,
        file_size: fileData?.size ?? null,
        attachments: [],
      };
    },
    [myId, otherId, resolvedConversation?.id],
  );

  const markIncomingAsRead = useCallback(async () => {
    if (!myId || !otherId || !resolvedConversation?.id) return false;

    try {
      await markGaraminDirectMessagesRead(resolvedConversation.id);
    } catch (error) {
      logger.debug('[chat] mark read failed', {
        error: error instanceof Error ? error.message : String(error),
        conversationId: resolvedConversation.id,
      });
      return false;
    }

    const updated = messagesRef.current.map((message) =>
      message.sender_id === otherId && message.receiver_id === myId
        ? { ...message, is_read: true }
        : message,
    );

    messagesRef.current = updated;
    setMessages(updated);
    return true;
  }, [myId, otherId, resolvedConversation?.id]);

  const loadFcTargets = useCallback(async () => {
    if (role !== 'fc') return;
    setTargetsLoading(true);
    setTargetsError(null);

    try {
      const residentPhone = sanitizePhone(residentId);
      if (!isValidMobilePhone(residentPhone)) {
        throw new Error(LEGACY_SESSION_ERROR);
      }

      const data = await fetchFcChatTargets(residentPhone);
      const managers: ChatTargetContact[] = Array.isArray(data.managers) ? data.managers : [];
      const developers: ChatTargetContact[] = Array.isArray(data.developers) ? data.developers : [];
      const admins: ChatTargetContact[] = Array.isArray(data.admins) ? data.admins : [];

      const managerTargets: FcChatTarget[] = [];
      managers.forEach((manager) => {
        const phone = sanitizePhone(manager.phone);
        if (!phone) return;
        const rawName = (manager.name ?? '').trim();
        const managerName = rawName.replace(/\s*본부장(?:님)?\s*$/, '').trim();
        const displayName = managerName ? `${managerName} 본부장` : phone;
        managerTargets.push({
          id: phone,
          label: displayName,
          subtitle: formatManagerMessengerDetail(manager.affiliation),
          kind: 'manager',
          presencePhones: [phone],
          unreadCount: Number((manager as ChatTargetContact & { unread_count?: number }).unread_count ?? 0),
          lastTimestamp: getLastMessageTimestamp({ created_at: manager.last_time }),
        });
      });

      const deduped = Array.from(
        managerTargets.reduce((map, target) => {
          if (!map.has(target.id)) {
            map.set(target.id, target);
          }
          return map;
        }, new Map<string, FcChatTarget>()).values(),
      );

      const developerTargets = Array.from(
        developers.reduce((map, developer) => {
          const phone = sanitizePhone(developer.phone);
          if (!phone || map.has(phone)) return map;
          map.set(phone, {
              id: phone,
              label: '개발자',
              subtitle: '개발자',
              kind: 'developer' as const,
              presencePhones: [phone],
              unreadCount: Number((developer as ChatTargetContact & { unread_count?: number }).unread_count ?? 0),
              lastTimestamp: getLastMessageTimestamp({ created_at: developer.last_time }),
            });
          return map;
        }, new Map<string, FcChatTarget>()).values(),
      );
      const adminTargets = Array.from(
        admins.reduce((map, admin) => {
          const phone = sanitizePhone(admin.phone);
          if (!phone || admin.staff_type === 'developer' || map.has(phone)) return map;
          map.set(phone, {
            id: phone,
            label: formatOperationsMessengerName(admin.name),
            subtitle: '총무',
            kind: 'admin' as const,
            presencePhones: [phone],
            unreadCount: Number((admin as ChatTargetContact & { unread_count?: number }).unread_count ?? 0),
            lastTimestamp: getLastMessageTimestamp({ created_at: admin.last_time }),
          });
          return map;
        }, new Map<string, FcChatTarget>()).values(),
      );

      const nextTargets = sortConversationsByLastMessageTime<FcChatTarget>([
        ...deduped,
        ...developerTargets,
        ...adminTargets,
      ]);

      setFcTargets(nextTargets);
    } catch (error) {
      const message = getFcTargetLoadErrorMessage(error instanceof Error ? error.message : null);
      logger.debug('[chat] fc target list load failed', { message });
      setTargetsError(message);
    } finally {
      setTargetsLoading(false);
    }
  }, [residentId, role]);

  useEffect(() => {
    const hasConversationRoute = Boolean(conversationIdValue);
    const hasAmbiguousConversationRoute = Boolean(
      hasAmbiguousConversationParams
      || (hasConversationRoute && normalizedTargetId),
    );
    if (hasAmbiguousConversationRoute) {
      setResolvedConversation(null);
      setConversationResolutionState('error');
      setConversationResolutionError('대화 대상이 중복되어 열 수 없습니다.');
      return;
    }
    if (!hasConversationRoute && !normalizedTargetId) {
      setResolvedConversation(null);
      setConversationResolutionState('idle');
      setConversationResolutionError('');
      return;
    }
    if (
      hasConversationRoute
      && !isNotificationUuid(conversationIdValue)
    ) {
      setResolvedConversation(null);
      setConversationResolutionState('error');
      setConversationResolutionError('알림의 대상 대화를 열 수 없습니다.');
      return;
    }

    if (hasConversationRoute) {
      const current = directMessagePrefetchRef.current;
      if (current?.conversationId !== conversationIdValue) {
        directMessagePrefetchRef.current = {
          conversationId: conversationIdValue,
          request: fetchGaraminDirectMessages(conversationIdValue).then(
            (result) => ({ result }),
            (error: unknown) => ({ error }),
          ),
        };
      }
    } else {
      directMessagePrefetchRef.current = null;
    }

    let active = true;
    setConversationResolutionState('loading');
    setConversationResolutionError('');
    setResolvedConversation(null);

    void (async () => {
      try {
        const conversation = await resolveGaraminDirectConversation(
          hasConversationRoute
            ? { conversationId: conversationIdValue }
            : {
                targetId: normalizedTargetId || null,
              },
        );
        if (!active) return;
        setResolvedConversation(conversation);
        if (conversation.counterpartyName) {
          setResolvedTargetName(conversation.counterpartyName);
        }
        setConversationResolutionState('success');
      } catch {
        if (!active) return;
        setConversationResolutionState('error');
        setConversationResolutionError(
          '대상 대화를 열 수 없습니다. 다시 시도해 주세요.',
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [
    conversationIdValue,
    conversationRetryKey,
    normalizedTargetId,
    role,
    hasAmbiguousConversationParams,
  ]);

  const fetchMessages = useCallback(async () => {
    if (!myId || !otherId || !resolvedConversation?.id) return;
    setMessageLoadState('loading');
    setMessageLoadError('');
    try {
      const prefetched = directMessagePrefetchRef.current;
      let result: Awaited<ReturnType<typeof fetchGaraminDirectMessages>>;
      if (prefetched?.conversationId === resolvedConversation.id) {
        const response = await prefetched.request;
        if ('error' in response) throw response.error;
        result = response.result;
        if (directMessagePrefetchRef.current === prefetched) {
          directMessagePrefetchRef.current = null;
        }
      } else {
        result = await fetchGaraminDirectMessages(resolvedConversation.id);
      }
      if (result.conversation.counterpartyId !== otherId) {
        throw new Error('대화 상대가 일치하지 않습니다.');
      }
      const filtered = result.messages.filter(
        (message) => !deletedIdsRef.current.has(message.id),
      );
      applyMessages([...filtered, ...contextMessagesRef.current]);

      const hasUnreadIncoming = filtered.some(
        (message) =>
          message.sender_id === otherId
          && message.receiver_id === myId
          && !message.is_read,
      );
      if (hasUnreadIncoming) {
        await markIncomingAsRead();
      }
      setMessageLoadState('success');
    } catch (error) {
      logger.debug('[messages] fetch error', {
        error: error instanceof Error ? error.message : String(error),
        conversationId: resolvedConversation.id,
      });
      setMessageLoadState('error');
      setMessageLoadError('대화 내용을 불러오지 못했습니다.');
    }
  }, [
    applyMessages,
    markIncomingAsRead,
    myId,
    otherId,
    resolvedConversation?.id,
  ]);

  const loadAnchorContext = useCallback(async () => {
    if (hasInvalidAnchorRouteParam) {
      setAnchorContextError(ANCHOR_CONTEXT_UNAVAILABLE_MESSAGE);
      return;
    }
    if (
      !anchorMessageIdValue
      || !myId
      || !otherId
      || !resolvedConversation?.id
    ) return;

    const requestKey = JSON.stringify([
      resolvedConversation.id,
      anchorMessageIdValue,
      myId,
      otherId,
      anchorContextRetryKey,
    ]);
    if (anchorContextRequestKeyRef.current === requestKey) return;
    anchorContextRequestKeyRef.current = requestKey;
    setAnchorContextError('');

    try {
      const context = await fetchGaraminDirectMessageContext({
        conversationId: resolvedConversation.id,
        messageId: anchorMessageIdValue,
      });
      if (anchorContextRequestKeyRef.current !== requestKey) return;

      const contextMessages: Message[] = context.messages
        .filter((message) => !deletedIdsRef.current.has(message.messageId))
        .map((message) => {
          const isIncoming = message.senderSide === 'counterparty';
          return {
            id: message.messageId,
            content: message.content,
            sender_id: isIncoming ? otherId : myId,
            receiver_id: isIncoming ? myId : otherId,
            conversation_id: resolvedConversation.id,
            created_at: message.sentAt,
            is_read: true,
            message_type: 'text',
            file_url: null,
            file_name: null,
            file_size: null,
            attachments: [],
            sender_label: message.senderLabel,
            is_context_preview: true,
          };
        });
      if (!contextMessages.some((message) => message.id === context.anchorMessageId)) {
        if (!activateAnchorMessage(anchorMessageIdValue)) {
          setAnchorContextError(ANCHOR_CONTEXT_UNAVAILABLE_MESSAGE);
        }
        return;
      }

      contextMessagesRef.current = contextMessages;
      applyMessages([...messagesRef.current, ...contextMessages]);
      activateAnchorMessage(context.anchorMessageId);
    } catch {
      if (anchorContextRequestKeyRef.current !== requestKey) return;
      if (!activateAnchorMessage(anchorMessageIdValue)) {
        setAnchorContextError(ANCHOR_CONTEXT_UNAVAILABLE_MESSAGE);
      }
    }
  }, [
    activateAnchorMessage,
    anchorContextRetryKey,
    anchorMessageIdValue,
    applyMessages,
    hasInvalidAnchorRouteParam,
    myId,
    otherId,
    resolvedConversation?.id,
  ]);

  useEffect(() => {
    anchorContextRequestKeyRef.current = '';
    contextMessagesRef.current = [];
    anchorScrollTargetMessageIdRef.current = '';
    anchorScrollRetryCountRef.current = 0;
    anchorScrollGenerationRef.current += 1;
    anchorLastScrollSignatureRef.current = '';
    anchorHistoryStabilizedRef.current = false;
    if (anchorScrollTimerRef.current) {
      clearTimeout(anchorScrollTimerRef.current);
      anchorScrollTimerRef.current = null;
    }
    if (anchorScrollRetryTimerRef.current) {
      clearTimeout(anchorScrollRetryTimerRef.current);
      anchorScrollRetryTimerRef.current = null;
    }
    if (anchorHighlightTimerRef.current) {
      clearTimeout(anchorHighlightTimerRef.current);
      anchorHighlightTimerRef.current = null;
    }
    setPendingAnchorMessageId('');
    setAnchorNavigationDismissed(false);
    setHighlightedMessageId('');
    setAnchorContextError(
      hasInvalidAnchorRouteParam ? ANCHOR_CONTEXT_UNAVAILABLE_MESSAGE : '',
    );

    const liveMessages = messagesRef.current.filter(
      (message) => !message.is_context_preview,
    );
    if (liveMessages.length !== messagesRef.current.length) {
      applyMessages(liveMessages);
    }
  }, [
    anchorMessageIdValue,
    applyMessages,
    hasInvalidAnchorRouteParam,
    resolvedConversation?.id,
  ]);

  useEffect(() => {
    if (
      hasInvalidAnchorRouteParam
      || !anchorMessageIdValue
      || !resolvedConversation?.id
    ) return;
    void loadAnchorContext();
  }, [
    anchorMessageIdValue,
    hasInvalidAnchorRouteParam,
    loadAnchorContext,
    resolvedConversation?.id,
  ]);

  useEffect(() => {
    if (
      anchorNavigationDismissed
      || hasInvalidAnchorRouteParam
      || !anchorMessageIdValue
      || pendingAnchorMessageId === anchorMessageIdValue
      || !messages.some((message) => message.id === anchorMessageIdValue)
    ) return;

    // The regular history can already contain the target even when the bounded
    // context request fails or completes later. Prefer that canonical row.
    activateAnchorMessage(anchorMessageIdValue);
  }, [
    activateAnchorMessage,
    anchorMessageIdValue,
    anchorNavigationDismissed,
    hasInvalidAnchorRouteParam,
    messages,
    pendingAnchorMessageId,
  ]);

  const handleAnchorScrollFailure = useCallback((info: AnchorScrollFailureInfo) => {
    const targetMessageId = anchorScrollTargetMessageIdRef.current;
    if (!targetMessageId) return;

    const targetIndex = messagesRef.current.findIndex(
      (message) => message.id === targetMessageId,
    );
    if (targetIndex < 0) return;

    const estimatedOffset = Math.max(0, Math.max(info.averageItemLength, 1) * targetIndex);
    try {
      flatListRef.current?.scrollToOffset({
        offset: estimatedOffset,
        animated: false,
      });
    } catch {
      logger.debug('[chat] anchor offset fallback unavailable');
    }
    if (anchorScrollRetryCountRef.current >= ANCHOR_SCROLL_RETRY_LIMIT) return;

    anchorScrollRetryCountRef.current += 1;
    const retryAttempt = anchorScrollRetryCountRef.current;
    const retryGeneration = anchorScrollGenerationRef.current;
    if (anchorScrollRetryTimerRef.current) {
      clearTimeout(anchorScrollRetryTimerRef.current);
    }
    anchorScrollRetryTimerRef.current = setTimeout(() => {
      anchorScrollRetryTimerRef.current = null;
      if (
        anchorScrollGenerationRef.current !== retryGeneration
        || anchorScrollTargetMessageIdRef.current !== targetMessageId
      ) return;

      const retryIndex = messagesRef.current.findIndex(
        (message) => message.id === targetMessageId,
      );
      if (retryIndex < 0) return;
      try {
        flatListRef.current?.scrollToIndex({
          index: retryIndex,
          animated: true,
          viewPosition: 0.5,
        });
      } catch {
        logger.debug('[chat] anchor scroll retry unavailable');
      }
    }, ANCHOR_SCROLL_RETRY_DELAY_MS * retryAttempt);
  }, []);

  useEffect(() => {
    if (
      anchorNavigationDismissed
      || anchorHistoryStabilizedRef.current
      || !pendingAnchorMessageId
    ) return;
    const targetIndex = messages.findIndex(
      (message) => message.id === pendingAnchorMessageId,
    );
    if (targetIndex < 0) return;

    const targetMessage = messages[targetIndex];
    const historyPhase = messageLoadState === 'success' ? 'settled' : 'pending';
    const scrollSignature = [
      pendingAnchorMessageId,
      targetIndex,
      targetMessage.is_context_preview ? 'context' : 'live',
      historyPhase,
    ].join(':');
    if (anchorLastScrollSignatureRef.current === scrollSignature) return;

    anchorScrollTargetMessageIdRef.current = pendingAnchorMessageId;
    anchorScrollRetryCountRef.current = 0;
    anchorScrollGenerationRef.current += 1;
    const scrollGeneration = anchorScrollGenerationRef.current;
    if (anchorScrollTimerRef.current) {
      clearTimeout(anchorScrollTimerRef.current);
    }
    anchorScrollTimerRef.current = setTimeout(() => {
      anchorScrollTimerRef.current = null;
      if (
        anchorScrollGenerationRef.current !== scrollGeneration
        || anchorScrollTargetMessageIdRef.current !== pendingAnchorMessageId
      ) return;

      const currentTargetIndex = messagesRef.current.findIndex(
        (message) => message.id === pendingAnchorMessageId,
      );
      if (currentTargetIndex < 0) return;
      anchorLastScrollSignatureRef.current = scrollSignature;
      highlightAnchorMessage(pendingAnchorMessageId);
      try {
        flatListRef.current?.scrollToIndex({
          index: currentTargetIndex,
          animated: true,
          viewPosition: 0.5,
        });
      } catch {
        handleAnchorScrollFailure({
          index: currentTargetIndex,
          highestMeasuredFrameIndex: 0,
          averageItemLength: 80,
        });
      } finally {
        if (historyPhase === 'settled') {
          anchorHistoryStabilizedRef.current = true;
        }
      }
    }, 0);

    return () => {
      if (anchorScrollTimerRef.current) {
        clearTimeout(anchorScrollTimerRef.current);
        anchorScrollTimerRef.current = null;
      }
    };
  }, [
    anchorNavigationDismissed,
    handleAnchorScrollFailure,
    highlightAnchorMessage,
    messageLoadState,
    messages,
    pendingAnchorMessageId,
  ]);

  useFocusEffect(useCallback(() => {
    if (!myId || !otherId || !resolvedConversation?.id) return undefined;

    void fetchMessages();
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void fetchMessages();
      }
    });

    return () => {
      appStateSub.remove();
    };
  }, [
    fetchMessages,
    myId,
    otherId,
    resolvedConversation?.id,
  ]));

  useFocusEffect(
    useCallback(() => {
      if (role !== 'fc') return undefined;
      void loadFcTargets();
      const appStateSub = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') {
          void loadFcTargets();
        }
      });
      return () => appStateSub.remove();
    }, [loadFcTargets, role]),
  );

  useEffect(() => {
    if (role !== 'admin') return;

    const paramName = (targetNameValue ?? '').trim();
    if (paramName && paramName !== 'FC') {
      setResolvedTargetName(paramName);
      return;
    }

    if (!otherId) {
      setResolvedTargetName(paramName || 'FC');
      return;
    }

    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from('fc_profiles')
        .select('name')
        .eq('phone', otherId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        logger.debug('[chat] resolve target name failed', { error: error.message, otherId });
      }

      const profileName = (data?.name ?? '').trim();
      setResolvedTargetName(profileName || paramName || otherId || 'FC');
    })();

    return () => {
      active = false;
    };
  }, [otherId, role, targetNameValue]);

  useEffect(() => {
    return () => {
      anchorContextRequestKeyRef.current = '';
      Keyboard.dismiss();
      if (anchorScrollTimerRef.current) {
        clearTimeout(anchorScrollTimerRef.current);
      }
      if (anchorScrollRetryTimerRef.current) {
        clearTimeout(anchorScrollRetryTimerRef.current);
      }
      if (anchorHighlightTimerRef.current) {
        clearTimeout(anchorHighlightTimerRef.current);
      }
    };
  }, []);

  // 세션 user id 확인 로그
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        logger.debug('[session] error', { error: error.message });
        return;
      }
      logger.debug('[session] userId', { userId: data?.session?.user?.id });
    })();
  }, []);

  const notificationReceipt = useNotificationReceiptCompletion({
    params: { notificationId, notificationTarget },
    expectedTarget: isNotificationUuid(conversationIdValue)
      ? {
          version: 1,
          kind: 'garamin_direct_chat',
          conversationId: conversationIdValue,
        }
      : null,
    loadState:
      hasAmbiguousConversationParams
      || Boolean(conversationIdValue && normalizedTargetId)
      || !isNotificationUuid(conversationIdValue)
      || conversationResolutionState === 'error'
      || messageLoadState === 'error'
        ? 'error'
        : conversationResolutionState === 'success'
          && resolvedConversation?.id === conversationIdValue
          && messageLoadState === 'success'
          ? 'success'
          : 'loading',
  });

  const sendPayload = async (
    content: string,
    attachments: readonly SelectedMessengerAttachment[],
  ) => {
    if (!myId || !otherId) {
      if (role === 'fc') {
        Alert.alert('대상 선택 필요', '메신저에서 대화할 대상을 먼저 선택해주세요.');
      }
      return false;
    }
    if (!resolvedConversation?.id) {
      Alert.alert(
        '대화 연결 중',
        '대화 연결이 완료된 뒤 다시 전송해 주세요.',
      );
      return false;
    }

    let attachmentBatch: Awaited<
      ReturnType<typeof prepareMessengerAttachmentBatch>
    > | null = null;
    try {
      if (attachments.length > 0) {
        const draft = {
          files: attachments,
          context: {
            kind: 'direct' as const,
            conversationId: resolvedConversation.id,
          },
          content,
        };
        attachmentBatch =
          isPreparedMessengerAttachmentBatchForDraft(
            attachmentBatchRef.current,
            draft,
          )
            ? attachmentBatchRef.current
            : await prepareMessengerAttachmentBatch(draft);
        attachmentBatchRef.current = attachmentBatch;
      }
    } catch (error) {
      Alert.alert(
        '파일 확인 필요',
        error instanceof Error ? error.message : '첨부 파일을 확인해 주세요.',
      );
      return false;
    }

    const optimisticContent =
      content
      || (attachments.length > 0
        ? `파일 ${attachments.length}개 전송 중`
        : '');
    const optimisticMessage = createOptimisticMessage(
      optimisticContent,
      attachments.length > 0 ? 'file' : 'text',
    );
    if (optimisticMessage) {
      applyMessages([optimisticMessage, ...messagesRef.current]);
    }

    const clientMessageId = randomUUID();
    let uploadedIntentIds: string[] | null = null;
    const sendCommittedMessage = (
      attachmentIntentIds: readonly string[] | null,
    ) =>
      sendGaraminDirectMessage({
        conversationId: resolvedConversation.id,
        clientMessageId,
        content,
        ...(attachmentBatch && attachmentIntentIds
          ? {
              attachmentIntentIds,
              deliveryKey: attachmentBatch.deliveryKey,
              payloadFingerprint: attachmentBatch.payloadFingerprint,
            }
          : {}),
      });
    const commitMessage = async (): Promise<
      | { state: 'sent'; result: GaraminDirectMessageSendResult }
      | { state: 'committed' }
    > => {
      if (!attachmentBatch) {
        return { state: 'sent', result: await sendCommittedMessage(null) };
      }
      const uploadResult = await uploadMessengerAttachmentBatch(
        attachmentBatch,
      );
      if (uploadResult.state === 'committed') {
        return { state: 'committed' };
      }
      uploadedIntentIds = uploadResult.intentIds;
      return {
        state: 'sent',
        result: await sendCommittedMessage(uploadedIntentIds),
      };
    };
    const commitMessageWithRetry = async (): Promise<
      Awaited<ReturnType<typeof commitMessage>> | null
    > => {
      try {
        return await commitMessage();
      } catch (error) {
        logger.warn('sendMessage error', {
          error: error instanceof Error ? error.message : String(error),
          conversationId: resolvedConversation.id,
          clientMessageId,
        });
        return new Promise((resolve) => {
          Alert.alert(
            '전송 확인 필요',
            '메시지 전송 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하면 중복 전송되지 않습니다.',
            [
              { text: '취소', style: 'cancel', onPress: () => resolve(null) },
              {
                text: '다시 확인',
                onPress: () => {
                  void commitMessageWithRetry().then(resolve);
                },
              },
            ],
            { cancelable: false },
          );
        });
      }
    };
    const commitResult = await commitMessageWithRetry();
    if (!commitResult) {
      if (optimisticMessage) {
        applyMessages(
          messagesRef.current.filter(
            (message) => message.id !== optimisticMessage.id,
          ),
        );
      }
      return false;
    }
    if (commitResult.state === 'committed') {
      if (optimisticMessage) {
        applyMessages(
          messagesRef.current.filter(
            (message) => message.id !== optimisticMessage.id,
          ),
        );
      }
      await fetchMessages();
      attachmentBatchRef.current = null;
      return true;
    }
    const sendResult = commitResult.result;
    const inserted: Message = sendResult.message;
    if (!deletedIdsRef.current.has(inserted.id)) {
      applyMessages([
        inserted,
        ...messagesRef.current.filter((message) =>
          message.id !== optimisticMessage?.id && message.id !== inserted.id
        ),
      ]);
    }

    const retryNotificationOnly = async (): Promise<void> => {
      try {
        const retryResult = await sendCommittedMessage(uploadedIntentIds);
        const retryDelivery = retryResult.delivery;
        if (
          !retryDelivery.confirmed
          && retryDelivery.reason === 'invalid_recipient'
        ) {
          Alert.alert(
            '알림 대상 오류',
            '메시지는 전송됐지만 알림을 받을 사용자를 확인할 수 없습니다.',
          );
          return;
        }
        if (
          !retryDelivery.confirmed
          && retryDelivery.notificationStored === false
        ) {
          Alert.alert(
            '알림 등록 실패',
            '메시지는 전송됐지만 알림을 다시 등록하지 못했습니다.',
            [
              { text: '나중에' },
              {
                text: '다시 등록',
                onPress: () => void retryNotificationOnly(),
              },
            ],
          );
          return;
        }
        Alert.alert('알림 등록 완료', '메시지 알림을 등록했습니다.');
      } catch (error) {
        logger.warn('[chat] notification retry result unavailable', {
          error: error instanceof Error ? error.message : String(error),
          conversationId: resolvedConversation.id,
          clientMessageId,
        });
        Alert.alert(
          '알림 등록 확인 필요',
          '알림 등록 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해도 메시지는 중복 전송되지 않습니다.',
          [
            { text: '나중에' },
            {
              text: '다시 확인',
              onPress: () => void retryNotificationOnly(),
            },
          ],
        );
      }
    };
    const notificationDelivery = sendResult.delivery;
    if (
      !notificationDelivery.confirmed
      && notificationDelivery.reason === 'invalid_recipient'
    ) {
      Alert.alert(
        '메시지 전송 완료 · 알림 대상 오류',
        '메시지는 전송됐지만 알림을 받을 사용자를 확인할 수 없습니다.',
      );
    } else if (
      !notificationDelivery.confirmed
      && notificationDelivery.notificationStored === false
    ) {
      Alert.alert(
        '메시지 전송 완료 · 알림 등록 실패',
        '메시지는 전송됐지만 알림을 등록하지 못했습니다.',
        [
          { text: '나중에' },
          {
            text: '알림 다시 등록',
            onPress: () => void retryNotificationOnly(),
          },
        ],
      );
    }
    attachmentBatchRef.current = null;
    return true;
  };

  const handleSendText = () => {
    const content = text.trim();
    const attachments = selectedAttachments;
    if ((!content && attachments.length === 0) || sendingAttachments) return;
    setSendingAttachments(true);
    void sendPayload(content, attachments)
      .then((sent) => {
        if (!sent) return;
        setText('');
        setSelectedAttachments([]);
      })
      .finally(() => setSendingAttachments(false));
  };

  const handleAttachment = async () => {
    if (pickingRef.current || sendingAttachments) return;
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
  };

  const handleDeleteMessage = (message: Message) => {
    if (
      message.sender_id !== myId
      || message.is_context_preview
      || !resolvedConversation?.id
      || !isNotificationUuid(message.id)
    ) {
      return;
    }
    confirmMessengerDelete({
      logScope: 'chat',
      onDelete: async () => {
        logger.debug('[delete] request', {
          conversationId: resolvedConversation.id,
          msgId: message.id,
        });
        await deleteGaraminDirectMessage({
          conversationId: resolvedConversation.id,
          messageId: message.id,
        });

        logger.debug('[delete] success', { messageId: message.id });
        deletedIdsRef.current.add(message.id);
        contextMessagesRef.current = contextMessagesRef.current.filter(
          (current) => current.id !== message.id,
        );
        applyMessages(
          messagesRef.current.filter((current) => current.id !== message.id),
        );
      },
    });
  };

  const handleCopyMessage = async (message: Message) => {
    await copyTextWithFeedback(getMessageCopyText(message), { logScope: 'chat' });
  };

  const openMessageActions = (message: Message) => {
    setActionMessage(message);
  };

  const closeMessageActions = () => {
    setActionMessage(null);
  };

  const handleCopyAction = () => {
    const message = actionMessage;
    setActionMessage(null);
    if (message) void handleCopyMessage(message);
  };

  const handleSelectCopyAction = () => {
    const message = actionMessage;
    setActionMessage(null);
    if (!getMessageCopyText(message)) {
      Alert.alert('선택 복사할 수 없어요', '선택 복사할 메시지 내용이 없습니다.');
      return;
    }
    setSelectCopyMessage(message);
  };

  const handleDeleteAction = () => {
    const message = actionMessage;
    setActionMessage(null);
    if (message) handleDeleteMessage(message);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  const openFcChatTarget = (target: FcChatTarget) => {
    router.push({
      pathname: '/chat',
      params: {
        targetId: target.id,
        targetName: target.label,
      },
    });
  };

  const handleBack = useCallback(() => {
    goBackOrReplace(router, '/messenger');
  }, [router]);

  const handleTargetPickerBack = useCallback(() => {
    goBackOrReplace(router, targetPickerHeader.fallbackHref);
  }, [router, targetPickerHeader.fallbackHref]);

  const renderMessageContent = (item: Message, isMe: boolean) => {
    if (item.attachments.length > 0) {
      return (
        <View style={styles.attachmentMessageContent}>
          {item.content ? (
            <LinkifiedSelectableText
              text={item.content}
              style={[
                styles.msgText,
                isMe ? styles.msgTextMe : styles.msgTextOther,
                { textAlign: 'left', width: '100%' },
              ]}
              linkStyle={styles.msgLinkText}
              linkPressBehavior="open"
            />
          ) : null}
          {item.attachments.map((attachment) => (
            <TouchableOpacity
              key={attachment.id}
              style={[
                styles.fileCard,
                isMe ? styles.fileCardMe : styles.fileCardOther,
              ]}
              onPress={() => {
                void openAuthorizedMessengerAttachment(attachment.id, {
                  logScope: 'chat',
                });
              }}
              activeOpacity={0.82}
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
                  ellipsizeMode="tail"
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
              <Feather
                name="download"
                size={15}
                color={isMe ? 'rgba(255,255,255,0.82)' : '#9CA3AF'}
              />
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    if (item.message_type === 'image' && item.file_url) {
      return (
        <TouchableOpacity
          onPress={() => {
            void openMessengerAttachment(item.file_url, { logScope: 'chat' });
          }}
          style={{ minWidth: 150, minHeight: 150 }}
        >
          <Image source={{ uri: item.file_url }} style={{ width: 200, height: 200, borderRadius: 8 }} contentFit="cover" />
        </TouchableOpacity>
      );
    }

    if (item.message_type === 'file' && item.file_url) {
      const fileName = safeDecodeFileName(item.file_name) || '파일';
      return (
        <TouchableOpacity
          style={[styles.fileCard, isMe ? styles.fileCardMe : styles.fileCardOther]}
          onPress={() => {
            void openMessengerAttachment(item.file_url, { logScope: 'chat' });
          }}
          activeOpacity={0.82}
        >
          <View style={[styles.fileIconBox, isMe ? styles.fileIconBoxMe : styles.fileIconBoxOther]}>
            <Ionicons name="document-text" size={22} color={isMe ? '#fff' : HANWHA_ORANGE} />
          </View>
          <View style={styles.fileTextWrap}>
            <Text
              style={[styles.fileName, isMe ? styles.fileNameMe : styles.fileNameOther]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {fileName}
            </Text>
            <Text style={[styles.fileHint, isMe ? styles.fileHintMe : styles.fileHintOther]} numberOfLines={1}>
              탭하여 다운로드
            </Text>
          </View>
          <Feather
            name="download"
            size={15}
            color={isMe ? 'rgba(255,255,255,0.82)' : '#9CA3AF'}
          />
        </TouchableOpacity>
      );
    }

    return (
      <LinkifiedSelectableText
        text={item.content}
        style={[
          styles.msgText,
          isMe ? styles.msgTextMe : styles.msgTextOther,
          { textAlign: 'left', width: '100%' },
        ]}
        linkStyle={styles.msgLinkText}
        linkPressBehavior="open"
      />
    );
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isMe = item.sender_id === myId;
    const isHighlighted = highlightedMessageId === item.id;
    const unreadReceiptCount = getDirectMessageUnreadCount({
      isOwn: isMe,
      isRead: item.is_read,
    });
    const messageMeta = (
      <View style={[styles.messageSideMeta, isMe ? styles.messageSideMetaMe : styles.messageSideMetaOther]}>
        <MessageUnreadReceiptBadge count={unreadReceiptCount} />
        <Text style={styles.timeText}>{formatTime(item.created_at)}</Text>
      </View>
    );

    return (
      <View
        style={[
          styles.msgRow,
          isMe ? styles.msgRowMe : styles.msgRowOther,
          isHighlighted && styles.msgRowHighlighted,
        ]}
      >
        {!isMe && (
          <View style={styles.avatar}>
            <Feather name="user" size={20} color={MUTED} />
          </View>
        )}

        <View style={[styles.msgContainer, { alignItems: isMe ? 'flex-end' : 'flex-start' }]}>
          {!isMe && (
            <Text style={styles.senderName}>
              {item.sender_label || headerTitle}
            </Text>
          )}

          <View style={[styles.messageBubbleLine, isMe ? styles.messageBubbleLineMe : styles.messageBubbleLineOther]}>
            {isMe && messageMeta}
            <Pressable
              onLongPress={() => openMessageActions(item)}
              delayLongPress={500}
              style={({ pressed }) => [
                styles.bubbleWrapper,
                isMe ? styles.bubbleWrapperMe : styles.bubbleWrapperOther,
                pressed && { opacity: 0.9 },
              ]}>
              <View
                style={[
                  styles.bubble,
                  isMe ? styles.bubbleMe : styles.bubbleOther,
                  item.message_type === 'image' && {
                    paddingHorizontal: 4,
                    paddingVertical: 4,
                    backgroundColor: isMe ? HANWHA_ORANGE : '#fff',
                  },
                  item.message_type === 'file' && {
                    paddingHorizontal: 8,
                    paddingVertical: 8,
                  },
                ]}>
                {renderMessageContent(item, isMe)}
              </View>
            </Pressable>
            {!isMe && messageMeta}
          </View>
        </View>
      </View>
    );
  };

  const renderFcTargetItem = ({ item }: { item: FcChatTarget }) => {
    const targetPresence = getPresenceGroupSnapshot(item.presencePhones);
    const targetPresenceLabel = formatPresenceLabel(targetPresence);

    return (
      <Pressable
        style={({ pressed }) => [
          styles.targetItem,
          pressed && { opacity: 0.85 },
        ]}
        onPress={() => openFcChatTarget(item)}
      >
        <View style={styles.targetAvatarWrap}>
          <View style={styles.targetAvatar}>
            <Feather
              name={item.kind === 'admin' ? 'shield' : item.kind === 'developer' ? 'tool' : 'user'}
              size={20}
              color={item.kind === 'admin' || item.kind === 'developer' ? HANWHA_ORANGE : MUTED}
            />
          </View>
          {targetPresenceLabel ? (
            <View
              style={[
                styles.targetPresenceDot,
                { backgroundColor: getPresenceColor(targetPresence) },
              ]}
            />
          ) : null}
        </View>
        <View style={styles.targetBody}>
          <Text style={styles.targetName}>{item.label}</Text>
          <Text style={styles.targetSubtitle}>{item.subtitle}</Text>
          {targetPresenceLabel ? (
            <Text
              style={[
                styles.targetPresenceText,
                targetPresence?.is_online && styles.targetPresenceTextOnline,
              ]}
              numberOfLines={1}
            >
              {targetPresenceLabel}
            </Text>
          ) : null}
        </View>
        <View style={styles.targetMeta}>
          {item.unreadCount > 0 && (
            <View style={styles.targetUnreadBadge}>
              <Text style={styles.targetUnreadBadgeText}>
                {item.unreadCount > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          )}
          <View style={styles.targetBadge}>
            <Text style={styles.targetBadgeText}>
              {item.kind === 'admin' ? '총무' : item.kind === 'developer' ? '개발자' : '본부장'}
            </Text>
          </View>
        </View>
        <Feather name="chevron-right" size={18} color="#9CA3AF" />
      </Pressable>
    );
  };

  const directRoomRef = useMemo(() => {
    if (!resolvedConversation?.id || !isNotificationUuid(resolvedConversation.id)) return null;
    return buildMessengerRoomRef('direct-thread', resolvedConversation.id);
  }, [resolvedConversation?.id]);
  const directSheetRoom = useMemo(() => directRoomRef ? ({
    version: 1 as const,
    kind: 'garamin_direct_chat' as const,
    conversationId: directRoomRef.id,
  }) : null, [directRoomRef]);
  const directRoomPreferenceReady = Boolean(
    directRoomRef
    && roomPreferenceReady
    && roomPreferenceLoadedKey === directRoomRef.key,
  );

  const loadDirectRoomPreference = useCallback(async () => {
    const roomRef = directRoomRef;
    if (!roomRef) return;
    const sequence = ++roomPreferenceSequenceRef.current;
    setRoomPreferenceLoading(true);
    setRoomPreferenceReady(false);
    setRoomPreferenceLoadedKey(null);
    setRoomPreferenceFailure(null);
    try {
      const preferences = await getNotificationPreferences();
      if (sequence !== roomPreferenceSequenceRef.current) return;
      setRoomMutedState(preferences.rooms.some((row) => row.roomKey === roomRef.key));
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
  }, [directRoomRef]);

  useEffect(() => {
    roomPreferenceSequenceRef.current += 1;
    setRoomMutedState(false);
    setRoomPreferenceLoading(false);
    setRoomPreferenceReady(false);
    setRoomPreferenceLoadedKey(null);
    setRoomPreferencePending(false);
    setRoomPreferenceFailure(null);
    if (directRoomRef) void loadDirectRoomPreference();
    return () => {
      roomPreferenceSequenceRef.current += 1;
    };
  }, [directRoomRef, loadDirectRoomPreference]);

  const saveDirectRoomPreference = useCallback(async (nextMuted: boolean) => {
    const roomRef = directRoomRef;
    if (
      !roomRef
      || !directRoomPreferenceReady
      || roomPreferenceLoading
      || roomPreferencePending
    ) return;
    const sequence = ++roomPreferenceSequenceRef.current;
    const previousMuted = roomMuted;
    setRoomMutedState(nextMuted);
    setRoomPreferencePending(true);
    setRoomPreferenceFailure(null);
    try {
      const preferences = await setRoomMuted(roomRef, nextMuted);
      if (sequence !== roomPreferenceSequenceRef.current) return;
      setRoomMutedState(preferences.rooms.some((row) => row.roomKey === roomRef.key));
      setRoomPreferenceLoadedKey(roomRef.key);
      setRoomPreferenceReady(true);
    } catch (error) {
      if (sequence !== roomPreferenceSequenceRef.current) return;
      setRoomMutedState(previousMuted);
      setRoomPreferenceFailure(buildMessengerNotificationPreferenceFailure(nextMuted, error));
    } finally {
      if (sequence === roomPreferenceSequenceRef.current) {
        setRoomPreferencePending(false);
      }
    }
  }, [
    directRoomPreferenceReady,
    directRoomRef,
    roomMuted,
    roomPreferenceLoading,
    roomPreferencePending,
  ]);

  const handleReturnToLatest = useCallback(() => {
    setAnchorNavigationDismissed(true);
    setPendingAnchorMessageId('');
    setHighlightedMessageId('');
    setAnchorContextError('');
    anchorContextRequestKeyRef.current = '';
    anchorScrollTargetMessageIdRef.current = '';
    anchorScrollRetryCountRef.current = 0;
    anchorLastScrollSignatureRef.current = '';
    anchorHistoryStabilizedRef.current = true;
    anchorScrollGenerationRef.current += 1;
    if (anchorScrollTimerRef.current) {
      clearTimeout(anchorScrollTimerRef.current);
      anchorScrollTimerRef.current = null;
    }
    if (anchorScrollRetryTimerRef.current) {
      clearTimeout(anchorScrollRetryTimerRef.current);
      anchorScrollRetryTimerRef.current = null;
    }
    if (anchorHighlightTimerRef.current) {
      clearTimeout(anchorHighlightTimerRef.current);
      anchorHighlightTimerRef.current = null;
    }
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const showAnchorReturnToLatest = Boolean(
    anchorMessageIdValue
    && !hasInvalidAnchorRouteParam
    && !anchorNavigationDismissed
    && resolvedConversation?.id,
  );

  const visibleLoadError = conversationResolutionState === 'error'
    ? conversationResolutionError
    : messageLoadState === 'error'
      ? messageLoadError
      : anchorContextError;
  const canRetryVisibleLoadError =
    conversationResolutionState === 'error'
    || messageLoadState === 'error'
    || Boolean(
      anchorContextError
      && anchorMessageIdValue
      && !hasInvalidAnchorRouteParam,
    );

  if (showFcTargetPicker) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" backgroundColor="#fff" />
        <View
          style={[
            styles.header,
            { paddingTop: Math.max(insets.top, 20) + 4 },
          ]}
        >
          {targetPickerHeader.showBackButton ? (
            <Pressable style={styles.backBtn} onPress={handleTargetPickerBack}>
              <Feather name="arrow-left" size={22} color={CHARCOAL} />
            </Pressable>
          ) : (
            <View style={styles.backBtn} />
          )}
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>{targetPickerHeader.title}</Text>
          </View>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.targetIntroCard}>
          <Text style={styles.targetIntroTitle}>대화 상대를 선택하세요</Text>
          <Text style={styles.targetIntroText}>
            본부장, 총무 또는 개발자를 선택하면 바로 채팅을 시작할 수 있습니다.
          </Text>
        </View>

        {targetsLoading ? (
          <MessengerLoadingState variant="targets" />
        ) : targetsError ? (
          <View style={styles.center}>
            <Text style={styles.targetHelperText}>{targetsError}</Text>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.9 }]}
              onPress={() => {
                if (targetsError === LEGACY_SESSION_ERROR) {
                  logout();
                  router.replace('/login?skipAuto=1');
                  return;
                }
                void loadFcTargets();
              }}
            >
              <Text style={styles.retryButtonText}>
                {targetsError === LEGACY_SESSION_ERROR ? '다시 로그인' : '다시 시도'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={fcTargets}
            keyExtractor={(item) => item.id}
            renderItem={renderFcTargetItem}
            contentContainerStyle={[
              styles.targetListContent,
              { paddingBottom: pickerListBottomPadding },
            ]}
            ListEmptyComponent={(
              <View style={styles.targetEmptyCard}>
                <Text style={styles.targetHelperText}>대화 가능한 대상이 없습니다.</Text>
              </View>
            )}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" backgroundColor="#fff" />
      <NotificationReceiptStatusBanner
        state={notificationReceipt.state}
        onRetry={notificationReceipt.retryMarkRead}
      />
      <View style={[styles.conversationHeader, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        <Pressable
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="메신저 목록으로 돌아가기"
          onPress={handleBack}
        >
          <Feather name="arrow-left" size={22} color={CHARCOAL} />
        </Pressable>
        <View style={styles.conversationHeaderCenter}>
          <View style={styles.conversationAvatarWrap}>
            <View style={[styles.conversationAvatar, { backgroundColor: headerAvatarColor }]}>
              <Text style={styles.conversationAvatarText}>{headerAvatarInitial}</Text>
            </View>
            {headerPresenceLabel ? (
              <View
                style={[
                  styles.conversationAvatarPresenceDot,
                  { backgroundColor: getPresenceColor(headerPresence) },
                ]}
              />
            ) : null}
          </View>
          <View style={styles.conversationHeaderTextWrap}>
            <Text style={styles.conversationHeaderTitle} numberOfLines={1}>
              {headerTitle}
            </Text>
            {headerPresenceLabel ? (
              <View style={styles.conversationPresenceRow}>
                <View
                  style={[
                    styles.conversationPresenceTinyDot,
                    { backgroundColor: getPresenceColor(headerPresence) },
                  ]}
                />
                <Text
                  style={[
                    styles.conversationPresenceText,
                    headerPresence?.is_online && styles.conversationPresenceTextOnline,
                  ]}
                  numberOfLines={1}
                >
                  {headerPresenceLabel}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <Pressable
          accessibilityLabel="대화방 설정 열기"
          accessibilityRole="button"
          disabled={!directRoomRef}
          hitSlop={4}
          onPress={() => {
            setConversationSettingsVisible(true);
            void loadDirectRoomPreference();
          }}
          style={({ pressed }) => [
            styles.conversationSettingsButton,
            pressed && styles.conversationSettingsButtonPressed,
            !directRoomRef && styles.conversationSettingsButtonDisabled,
          ]}
        >
          <Feather name={roomMuted ? 'bell-off' : 'more-horizontal'} size={21} color={roomMuted ? MUTED : CHARCOAL} />
        </Pressable>
      </View>
      {visibleLoadError ? (
        <View style={styles.targetIntroCard}>
          <Text style={styles.targetHelperText}>
            {visibleLoadError}
          </Text>
          {canRetryVisibleLoadError ? (
            <Pressable
              style={({ pressed }) => [
                styles.retryButton,
                pressed && { opacity: 0.9 },
              ]}
              onPress={() => {
                if (conversationResolutionState === 'error') {
                  setConversationRetryKey((current) => current + 1);
                  return;
                }
                if (messageLoadState === 'error') {
                  void fetchMessages();
                  return;
                }
                setAnchorContextRetryKey((current) => current + 1);
              }}
            >
              <Text style={styles.retryButtonText}>다시 시도</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showAnchorReturnToLatest ? (
        <View style={styles.anchorNavigationBanner}>
          <Text style={styles.anchorNavigationText}>검색한 메시지를 보고 있습니다.</Text>
          <Pressable
            accessibilityLabel="최신 메시지로 이동"
            accessibilityRole="button"
            onPress={handleReturnToLatest}
            style={({ pressed }) => [
              styles.anchorLatestButton,
              pressed && styles.anchorLatestButtonPressed,
            ]}
          >
            <Feather name="arrow-down" size={15} color={HANWHA_ORANGE} />
            <Text style={styles.anchorLatestButtonText}>최신 메시지로</Text>
          </Pressable>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={highlightedMessageId}
          inverted
          onScrollToIndexFailed={handleAnchorScrollFailure}
          contentContainerStyle={styles.listContent}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />

        <View
          style={[
            styles.inputWrapper,
            {
              paddingBottom: composerBottomPadding,
            },
          ]}>
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
                    <Text style={styles.selectedAttachmentName} numberOfLines={1}>
                      {attachment.name}
                    </Text>
                    <Text style={styles.selectedAttachmentSize}>
                      {formatMessengerAttachmentSize(attachment.size)}
                    </Text>
                  </View>
                  <Pressable
                    hitSlop={8}
                    disabled={sendingAttachments}
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
              onPress={handleAttachment}
              style={[
                styles.attachBtn,
                sendingAttachments && styles.attachBtnDisabled,
              ]}
              activeOpacity={0.7}
              disabled={sendingAttachments}
            >
              <Feather name="paperclip" size={22} color="#9CA3AF" />
            </TouchableOpacity>

            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="메시지를 입력하세요"
              placeholderTextColor={MUTED}
              multiline
              textAlignVertical="center"
              scrollEnabled={false}
              editable={!sendingAttachments}
            />
            <Pressable
              onPress={handleSendText}
              style={[
                styles.sendBtn,
                (
                  sendingAttachments
                  || (!text.trim() && selectedAttachments.length === 0)
                ) && styles.sendBtnDisabled,
              ]}
              disabled={
                sendingAttachments
                || (!text.trim() && selectedAttachments.length === 0)
              }>
              {sendingAttachments ? (
                <BrandedLoadingSpinner size="sm" color="#fff" />
              ) : (
                <Feather name="arrow-up" size={20} color="#fff" />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <MessengerMessageActionSheet
        visible={Boolean(actionMessage)}
        preview={actionMessage ? getMessageCopyText(actionMessage) : ''}
        onClose={closeMessageActions}
        onCopy={actionMessage ? handleCopyAction : undefined}
        onSelectCopy={actionMessage ? handleSelectCopyAction : undefined}
        onDelete={
          actionMessage?.sender_id === myId && !actionMessage.is_context_preview
            ? handleDeleteAction
            : undefined
        }
      />

      <MessageSelectCopySheet
        visible={Boolean(selectCopyMessage)}
        text={getMessageCopyText(selectCopyMessage)}
        onClose={() => setSelectCopyMessage(null)}
        bottomInset={insets.bottom}
      />

      {directSheetRoom ? (
        <ConversationSettingsSheet
          disabled={roomPreferenceLoading || !directRoomPreferenceReady}
          disabledReason={roomPreferenceLoading
            ? '이 대화의 알림 설정을 불러오는 중입니다.'
            : !directRoomPreferenceReady
              ? '알림 설정을 다시 불러와 주세요.'
              : null}
          failure={roomPreferenceFailure}
          muted={roomMuted}
          onClose={() => setConversationSettingsVisible(false)}
          onOpenNotificationSettings={() => {
            setConversationSettingsVisible(false);
            router.push('/notification-settings' as never);
          }}
          onPreferenceChange={(change) => void saveDirectRoomPreference(change.muted)}
          onRetryLoad={() => void loadDirectRoomPreference()}
          onRetryPreferenceChange={(change) => void saveDirectRoomPreference(change.muted)}
          pending={roomPreferencePending}
          room={directSheetRoom}
          roomTitle={headerTitle}
          visible={conversationSettingsVisible}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SOFT_BG },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: CHARCOAL, textAlign: 'center' },
  headerPresenceText: { marginTop: 4, fontSize: 12, color: MUTED, textAlign: 'center' },
  headerPresenceTextOnline: { color: '#15803D', fontWeight: '600' },
  conversationHeader: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  conversationHeaderCenter: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
  },
  conversationAvatarWrap: {
    position: 'relative',
  },
  conversationAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conversationAvatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  conversationAvatarPresenceDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 2,
    borderColor: '#fff',
  },
  conversationHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  conversationHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: CHARCOAL,
  },
  conversationPresenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  conversationPresenceTinyDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  conversationPresenceText: {
    fontSize: 12,
    color: MUTED,
    flexShrink: 1,
  },
  conversationPresenceTextOnline: {
    color: '#15803D',
    fontWeight: '600',
  },
  list: { flex: 1 },
  listContent: { paddingVertical: 20, paddingHorizontal: 16, gap: 16 },
  anchorNavigationBanner: {
    minHeight: 48,
    paddingLeft: 16,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderBottomWidth: 1,
    borderBottomColor: '#FED7AA',
  },
  anchorNavigationText: {
    flex: 1,
    minWidth: 0,
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  anchorLatestButton: {
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 10,
  },
  anchorLatestButtonPressed: { backgroundColor: '#FFEDD5' },
  anchorLatestButtonText: { color: HANWHA_ORANGE, fontSize: 12, fontWeight: '700' },
  msgRow: { flexDirection: 'row', marginBottom: 12, width: '100%' },
  msgRowHighlighted: {
    backgroundColor: '#FFF1E8',
    borderRadius: 16,
  },
  conversationSettingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conversationSettingsButtonPressed: { backgroundColor: '#F3F4F6' },
  conversationSettingsButtonDisabled: { opacity: 0.32 },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  senderName: { fontSize: 12, color: MUTED, marginLeft: 2, marginBottom: 4 },
  msgContainer: { flex: 1, minWidth: 0 },
  bubbleWrapper: { maxWidth: SCREEN_WIDTH * 0.82, width: 'auto', minWidth: 0 },
  bubbleWrapperMe: { alignSelf: 'flex-end' },
  bubbleWrapperOther: { alignSelf: 'flex-start' },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
    flexShrink: 1,
    maxWidth: '100%',
    minWidth: 0,
  },
  bubbleMe: { backgroundColor: HANWHA_ORANGE, borderTopRightRadius: 2 },
  bubbleOther: { backgroundColor: '#ffffff', borderTopLeftRadius: 2, borderWidth: 1, borderColor: '#F3F4F6' },
  msgText: { fontSize: 15, lineHeight: 22, flexWrap: 'wrap', flexShrink: 1, width: '100%' },
  msgTextMe: { color: '#ffffff', fontWeight: '500' },
  msgTextOther: { color: CHARCOAL },
  msgLinkText: { color: '#2563EB', textDecorationLine: 'underline', fontWeight: '700' },
  messageBubbleLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, width: '100%' },
  messageBubbleLineMe: { justifyContent: 'flex-end' },
  messageBubbleLineOther: { justifyContent: 'flex-start' },
  messageSideMeta: { minWidth: 30, paddingBottom: 2 },
  messageSideMetaMe: { alignItems: 'flex-end' },
  messageSideMetaOther: { alignItems: 'flex-start' },
  timeText: { fontSize: 11, color: '#9CA3AF', marginBottom: 2, minWidth: 30 },
  inputWrapper: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  attachBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  attachBtnDisabled: { opacity: 0.55 },
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
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: HANWHA_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#E5E7EB' },
  fileIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fileIconBoxMe: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  fileIconBoxOther: {
    backgroundColor: '#fff',
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: FILE_CARD_WIDTH,
    maxWidth: '100%',
    minWidth: 190,
  },
  attachmentMessageContent: { gap: 8, minWidth: 190 },
  fileCardMe: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  fileCardOther: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  fileTextWrap: {
    flex: 1,
    flexBasis: 0,
    minWidth: 72,
    gap: 2,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  fileNameMe: { color: '#fff' },
  fileNameOther: { color: CHARCOAL },
  fileHint: {
    fontSize: 11,
  },
  fileHintMe: { color: 'rgba(255,255,255,0.84)' },
  fileHintOther: { color: '#6B7280' },
  uploadingOverlay: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  uploadingText: { fontSize: 13, color: HANWHA_ORANGE, fontWeight: '600' },
  cancelUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eee',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  cancelUploadText: { fontSize: 12, color: '#555', fontWeight: '500' },
  targetIntroCard: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  targetIntroTitle: { fontSize: 14, fontWeight: '700', color: '#9A3412' },
  targetIntroText: { fontSize: 12, color: '#C2410C' },
  targetListContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 10,
  },
  targetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  targetAvatarWrap: {
    position: 'relative',
  },
  targetAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetPresenceDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },
  targetBody: { flex: 1, minWidth: 0, gap: 2 },
  targetName: { fontSize: 15, fontWeight: '700', color: CHARCOAL },
  targetSubtitle: { fontSize: 12, color: MUTED },
  targetPresenceText: { fontSize: 12, color: MUTED },
  targetPresenceTextOnline: { color: '#15803D', fontWeight: '600' },
  targetMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 12 },
  targetBadge: {
    borderRadius: 999,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  targetBadgeText: { fontSize: 11, fontWeight: '700', color: '#C2410C' },
  targetUnreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HANWHA_ORANGE,
  },
  targetUnreadBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  targetEmptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 20,
    alignItems: 'center',
  },
  targetHelperText: { fontSize: 13, color: MUTED, fontWeight: '600' },
  retryButton: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  retryButtonText: { fontSize: 13, color: CHARCOAL, fontWeight: '700' },
});
