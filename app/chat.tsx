import { Feather, Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
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
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BrandedLoadingSpinner from '@/components/BrandedLoadingSpinner';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import MessengerLoadingState from '@/components/MessengerLoadingState';
import { goBackOrReplace } from '@/lib/back-navigation';
import { fetchFcChatTargets } from '@/lib/internal-chat-api';
import { getChatTargetPickerHeaderConfig } from '@/lib/chat-navigation';
import { logger } from '@/lib/logger';
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
  sanitizePhone,
} from '@/lib/messenger-participants';
import {
  getStaffChatActorId,
  getStaffChatSenderName,
} from '@/lib/staff-identity';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const SOFT_BG = '#F9FAFB';
const SCREEN_WIDTH = Dimensions.get('window').width;
const PRESENCE_POLL_INTERVAL_MS = 30_000;
const CHAT_UPLOAD_BUCKET = 'chat-uploads';
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
  created_at: string;
  is_read: boolean;
  message_type?: 'text' | 'image' | 'file';
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
};

type FcChatTarget = {
  id: string;
  label: string;
  subtitle: string;
  kind: 'manager' | 'admin' | 'developer';
  presencePhones: string[];
  unreadCount: number;
};

type ChatTargetContact = {
  name?: string | null;
  phone?: string | null;
  staff_type?: string | null;
  unread_count?: number | null;
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
      || (a.message_type ?? 'text') !== (b.message_type ?? 'text')
      || (a.file_url ?? null) !== (b.file_url ?? null)
      || (a.file_name ?? null) !== (b.file_name ?? null)
      || (a.file_size ?? null) !== (b.file_size ?? null)
    ) {
      return false;
    }
  }
  return true;
};

export default function ChatScreen() {
  const router = useRouter();
  const { role, residentId, displayName, readOnly, logout, staffType } = useSession();
  const { targetId, targetName } = useLocalSearchParams<{
    targetId?: string | string[];
    targetName?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const keyboardPadding = useKeyboardPadding();
  const bottomSafeInset = Math.max(insets.bottom, Platform.OS === 'android' ? 20 : 12);
  const pickerListBottomPadding = bottomSafeInset + 24;
  const targetPickerHeader = getChatTargetPickerHeaderConfig();
  const targetIdValue = Array.isArray(targetId) ? targetId[0] : targetId;
  const targetNameValue = Array.isArray(targetName) ? targetName[0] : targetName;

  const myId = role === 'admin'
    ? getStaffChatActorId({ residentId, readOnly, staffType })
    : sanitizePhone(residentId);
  const normalizedTargetId = (targetIdValue ?? '').trim().toLowerCase() === ADMIN_CHAT_ID
    ? ADMIN_CHAT_ID
    : sanitizePhone(targetIdValue);
  const otherId = normalizedTargetId;
  const [resolvedTargetName, setResolvedTargetName] = useState('');
  const [fcTargets, setFcTargets] = useState<FcChatTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [presenceByPhone, setPresenceByPhone] = useState<Record<string, AppPresenceSnapshot>>({});
  const selectedFcTarget = role === 'fc'
    ? fcTargets.find((target) => target.id === otherId) ?? null
    : null;
  const showFcTargetPicker = role === 'fc' && !otherId;
  const headerTitle = role === 'admin'
    ? resolvedTargetName || targetIdValue || 'FC'
    : targetNameValue?.trim() || selectedFcTarget?.label || '메신저';
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
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const pickingRef = useRef(false);
  const isUploadCancelled = useRef(false);
  const flatListRef = useRef<FlatList>(null);
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<Message[]>([]);

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

  useEffect(() => {
    if (trackedPresencePhones.length === 0) {
      return;
    }

    const intervalId = setInterval(() => {
      void loadPresence(trackedPresencePhones);
    }, PRESENCE_POLL_INTERVAL_MS);

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void loadPresence(trackedPresencePhones);
      }
    });

    return () => {
      clearInterval(intervalId);
      subscription.remove();
    };
  }, [loadPresence, trackedPresencePhones]);

  const applyMessages = useCallback((rows: Message[]) => {
    const uniqueRows = dedupeMessagesById(rows);
    const sorted = sortMessagesDesc(uniqueRows);
    if (areMessagesEqual(messagesRef.current, sorted)) return false;
    messagesRef.current = sorted;
    setMessages(sorted);
    return true;
  }, []);

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
        created_at: new Date().toISOString(),
        is_read: true,
        message_type: type,
        file_url: fileData?.url ?? null,
        file_name: fileData?.name ?? null,
        file_size: fileData?.size ?? null,
      };
    },
    [myId, otherId],
  );

  const markIncomingAsRead = useCallback(async () => {
    if (!myId || !otherId) return false;

    const { error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('sender_id', otherId)
      .eq('receiver_id', myId)
      .eq('is_read', false);

    if (error) {
      logger.debug('[chat] mark read failed', { error: error.message, myId, otherId });
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
  }, [myId, otherId]);

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
          subtitle: '본부장',
          kind: 'manager',
          presencePhones: [phone],
          unreadCount: Number((manager as ChatTargetContact & { unread_count?: number }).unread_count ?? 0),
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
            });
          return map;
        }, new Map<string, FcChatTarget>()).values(),
      );
      const adminPresencePhones = Array.from(
        new Set(
          admins
            .filter((admin) => admin.staff_type !== 'developer')
            .map((admin) => sanitizePhone(admin.phone))
            .filter(Boolean),
        ),
      );

      const nextTargets: FcChatTarget[] = [
        ...deduped,
        ...developerTargets,
        {
          id: ADMIN_CHAT_ID,
          label: '총무',
          subtitle: '총무팀',
          kind: 'admin',
          presencePhones: adminPresencePhones,
          unreadCount: data.adminUnreadCount,
        },
      ];

      setFcTargets(nextTargets);
    } catch (error) {
      const message = getFcTargetLoadErrorMessage(error instanceof Error ? error.message : null);
      logger.debug('[chat] fc target list load failed', { message });
      setTargetsError(message);
    } finally {
      setTargetsLoading(false);
    }
  }, [residentId, role]);

  const fetchMessages = useCallback(async () => {
    if (!myId || !otherId) return;
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`)
      .order('created_at', { ascending: false });
    if (error) {
      logger.debug('[messages] fetch error', { error: error.message });
      return;
    }
    const filtered = (data ?? []).filter((m) => !deletedIdsRef.current.has(m.id));
    applyMessages(filtered as Message[]);

    const hasUnreadIncoming = filtered.some(
      (message) => message.sender_id === otherId && message.receiver_id === myId && !message.is_read,
    );
    if (hasUnreadIncoming) {
      await markIncomingAsRead();
    }
  }, [applyMessages, markIncomingAsRead, myId, otherId]);

  useEffect(() => {
    if (!myId || !otherId) return;

    void fetchMessages();

    const channel = supabase
      .channel(`chat-${myId}-${otherId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload as any).old?.id;
            if (deletedId) {
              deletedIdsRef.current.add(deletedId);
              const next = messagesRef.current.filter((m) => m.id !== deletedId);
              messagesRef.current = next;
              setMessages(next);
              return;
            }
            // old 정보가 없으면 전체 재조회
            void fetchMessages();
            return;
          }
          const newMsg = payload.new as Message;
          if (deletedIdsRef.current.has(newMsg.id)) return;
          const related =
            (newMsg.sender_id === myId && newMsg.receiver_id === otherId) ||
            (newMsg.sender_id === otherId && newMsg.receiver_id === myId);
          if (!related) return;

          if (payload.eventType === 'INSERT') {
            applyMessages(
              messagesRef.current.some((m) => m.id === newMsg.id)
                ? messagesRef.current
                : [newMsg, ...messagesRef.current],
            );
            if (newMsg.sender_id === otherId) {
              void markIncomingAsRead();
            }
          } else if (payload.eventType === 'UPDATE') {
            applyMessages(messagesRef.current.map((m) => (m.id === newMsg.id ? newMsg : m)));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [applyMessages, fetchMessages, markIncomingAsRead, myId, otherId]);

  useEffect(() => {
    if (!myId || !otherId) return;

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void fetchMessages();
      }
    });

    return () => {
      appStateSub.remove();
    };
  }, [fetchMessages, myId, otherId]);

  useFocusEffect(
    useCallback(() => {
      if (role !== 'fc') return undefined;
      void loadFcTargets();
      return undefined;
    }, [loadFcTargets, role]),
  );

  useEffect(() => {
    if (role !== 'fc' || !myId || !showFcTargetPicker) return;

    const channel = supabase
      .channel(`chat-target-unread-${myId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${myId}`,
        },
        () => {
          void loadFcTargets();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadFcTargets, myId, role, showFcTargetPicker]);

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
      Keyboard.dismiss();
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

  const sendPayload = async (
    content: string,
    type: 'text' | 'image' | 'file' = 'text',
    fileData?: { url: string; name: string; size?: number },
  ) => {
    if (!myId || !otherId) {
      if (role === 'fc') {
        Alert.alert('대상 선택 필요', '메신저에서 대화할 대상을 먼저 선택해주세요.');
      }
      return;
    }
    if (isUploadCancelled.current) return;

    const optimisticMessage = createOptimisticMessage(content, type, fileData);
    if (optimisticMessage) {
      applyMessages([optimisticMessage, ...messagesRef.current]);
    }

    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({
        sender_id: myId,
        receiver_id: otherId,
        content,
        message_type: type,
        file_url: fileData?.url ?? null,
        file_name: fileData?.name ?? null,
        file_size: fileData?.size ?? null,
      })
      .select('*')
      .single();

    if (error) {
      if (optimisticMessage) {
        applyMessages(messagesRef.current.filter((message) => message.id !== optimisticMessage.id));
      }
      logger.warn('sendMessage error', { error: error.message });
      Alert.alert('전송 실패', '메시지를 보내지 못했습니다.');
      return;
    }
    if (inserted && !deletedIdsRef.current.has(inserted.id)) {
      applyMessages([
        inserted as Message,
        ...messagesRef.current.filter((message) =>
          message.id !== optimisticMessage?.id && message.id !== inserted.id
        ),
      ]);
    }

    const isSenderStaff = role === 'admin';
    const recipientRole: 'admin' | 'fc' = isSenderStaff ? 'fc' : 'admin';
    const residentIdForPush = otherId || null;
    const notiBody = type === 'text' ? content : type === 'image' ? '사진을 보냈습니다.' : '파일을 보냈습니다.';
    const senderName = role === 'admin'
      ? getStaffChatSenderName({ displayName, residentId, readOnly, staffType })
      : displayName?.trim() || residentId || 'FC';
    const notiTitle = `${senderName}: ${notiBody}`;
    const notifyUrl = `/chat?targetId=${encodeURIComponent(myId)}&targetName=${encodeURIComponent(senderName)}`;

    void supabase.functions.invoke('fc-notify', {
      body: {
        type: 'notify',
        target_role: recipientRole,
        target_id: residentIdForPush,
        title: notiTitle,
        body: notiBody,
        category: 'message',
        url: notifyUrl,
        sender_id: myId,
        sender_name: senderName,
      },
    }).then(({ data: notifyData, error: notifyError }) => {
      if (notifyError || !notifyData?.ok) {
        logger.warn('Error in message notification', { error: notifyError ?? notifyData?.message });
      }
    }).catch((e) => {
      logger.warn('Error in message notification', { error: e });
    });
  };

  const handleSendText = () => {
    if (!text.trim()) return;
    isUploadCancelled.current = false;
    sendPayload(text.trim(), 'text');
    setText('');
  };

  const uploadToSupabase = async (uri: string, fileType: string) => {
    try {
      isUploadCancelled.current = false;
      setUploading(true);
      const ext = uri.split('.').pop()?.toLowerCase() ?? 'bin';
      const fileName = `chat/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const uploadMimeType = fileType?.trim() || 'application/octet-stream';
      if (Platform.OS === 'web') {
        const localFileResponse = await fetch(uri);
        if (!localFileResponse.ok) {
          throw new Error(`파일을 읽지 못했습니다. (${localFileResponse.status})`);
        }
        const fileBlob = await localFileResponse.blob();
        const byteArray = new Uint8Array(await fileBlob.arrayBuffer());

        const { error } = await supabase.storage.from(CHAT_UPLOAD_BUCKET).upload(fileName, byteArray, {
          contentType: uploadMimeType,
          upsert: false,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.storage
          .from(CHAT_UPLOAD_BUCKET)
          .createSignedUploadUrl(fileName);
        if (error || !data?.signedUrl) {
          throw error ?? new Error('Signed upload URL 생성 실패');
        }

        const uploadResult = await FileSystem.uploadAsync(data.signedUrl, uri, {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': uploadMimeType },
        });

        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          throw new Error(`업로드 실패 (status ${uploadResult.status})`);
        }
      }

      if (isUploadCancelled.current) return null;

      const { data: urlData } = supabase.storage.from(CHAT_UPLOAD_BUCKET).getPublicUrl(fileName);
      return urlData.publicUrl;
    } catch (e) {
      if (isUploadCancelled.current) return null;
      logger.error('File upload error', { error: e });
      Alert.alert('업로드 실패', '파일 업로드 중 오류가 발생했습니다.');
      return null;
    } finally {
      if (!isUploadCancelled.current) setUploading(false);
    }
  };

  const pickImage = async () => {
    if (Platform.OS === 'ios') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('사진 접근 권한 필요', '설정 > 가람in > 사진 접근을 허용해 주세요.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      const publicUrl = await uploadToSupabase(asset.uri, asset.mimeType ?? 'image/jpeg');
      if (publicUrl && !isUploadCancelled.current) {
        await sendPayload('사진을 보냈습니다.', 'image', {
          url: publicUrl,
          name: asset.fileName ?? 'image.jpg',
          size: asset.fileSize,
        });
      }
    }
  };

  const pickDocument = async () => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled) {
        const file = result.assets[0];
        const publicUrl = await uploadToSupabase(file.uri, file.mimeType ?? 'application/octet-stream');
        if (publicUrl && !isUploadCancelled.current) {
          await sendPayload(file.name, 'file', {
            url: publicUrl,
            name: file.name,
            size: file.size,
          });
        }
      }
    } catch (e) {
      logger.debug('Image picker error', { error: e });
    } finally {
      pickingRef.current = false;
    }
  };

  const handleAttachment = () => {
    Alert.alert('파일 전송', '어떤 파일을 보내시겠습니까?', [
      { text: '사진 보관함', onPress: pickImage },
      { text: '문서 (PDF 등)', onPress: pickDocument },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const handleCancelUpload = () => {
    isUploadCancelled.current = true;
    setUploading(false);
  };

  const handleDeleteMessage = (message: Message) => {
    if (message.sender_id !== myId) return;
    Alert.alert('메시지 삭제', '이 메시지를 삭제하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            const { data: authRes } = await supabase.auth.getUser();
            logger.debug('[delete] request', {
              authUserId: authRes?.user?.id,
              myId,
              msgId: message.id,
              senderId: message.sender_id,
            });
            const { error } = await supabase.from('messages').delete().eq('id', message.id);
            if (error) {
              logger.debug('[delete] supabase error', { error });
              Alert.alert('삭제 실패', error.message ?? '메시지를 삭제하지 못했습니다.');
            } else {
              logger.debug('[delete] success', { messageId: message.id });
              deletedIdsRef.current.add(message.id);
              setMessages((prev) => prev.filter((m) => m.id !== message.id));
            }
          } catch (err: any) {
            logger.debug('[delete] exception', { error: err?.message ?? err });
            Alert.alert('삭제 실패', '예외가 발생했습니다.');
          }
        },
      },
    ]);
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

  const handleBack = () => {
    router.back();
  };

  const handleTargetPickerBack = useCallback(() => {
    goBackOrReplace(router, targetPickerHeader.fallbackHref);
  }, [router, targetPickerHeader.fallbackHref]);

  const renderMessageContent = (item: Message, isMe: boolean) => {
    if (item.message_type === 'image' && item.file_url) {
      return (
        <TouchableOpacity onPress={() => Linking.openURL(item.file_url!)} style={{ minWidth: 150, minHeight: 150 }}>
          <Image source={{ uri: item.file_url }} style={{ width: 200, height: 200, borderRadius: 8 }} contentFit="cover" />
        </TouchableOpacity>
      );
    }

    if (item.message_type === 'file' && item.file_url) {
      const fileName = safeDecodeFileName(item.file_name) || '파일';
      return (
        <TouchableOpacity
          style={[styles.fileCard, isMe ? styles.fileCardMe : styles.fileCardOther]}
          onPress={() => Linking.openURL(item.file_url!)}
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
      <Text
        style={[
          styles.msgText,
          isMe ? styles.msgTextMe : styles.msgTextOther,
          { textAlign: 'left', width: '100%' },
        ]}>
        {item.content}
      </Text>
    );
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isMe = item.sender_id === myId;
    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
        {!isMe && (
          <View style={styles.avatar}>
            <Feather name="user" size={20} color={MUTED} />
          </View>
        )}

        <View style={[styles.msgContainer, { alignItems: isMe ? 'flex-end' : 'flex-start' }]}>
          {!isMe && <Text style={styles.senderName}>{headerTitle}</Text>}

          <Pressable
            onLongPress={() => handleDeleteMessage(item)}
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

          <Text
            style={[
              styles.timeText,
              { textAlign: isMe ? 'right' : 'left', alignSelf: isMe ? 'flex-end' : 'flex-start' },
            ]}>
            {formatTime(item.created_at)}
          </Text>
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
      <View style={[styles.conversationHeader, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        <Pressable style={styles.backBtn} onPress={handleBack}>
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
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 65 : 0}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          inverted
          contentContainerStyle={styles.listContent}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />

        {uploading && (
          <View
            style={[
              styles.uploadingOverlay,
              {
                bottom: 68 + bottomSafeInset + (Platform.OS === 'android' ? keyboardPadding : 0),
              },
            ]}>
            <BrandedLoadingSpinner size="sm" color={HANWHA_ORANGE} />
            <Text style={styles.uploadingText}>파일 전송 중...</Text>
            <TouchableOpacity onPress={handleCancelUpload} style={styles.cancelUploadBtn} activeOpacity={0.8}>
              <Ionicons name="close-circle" size={20} color="#666" />
              <Text style={styles.cancelUploadText}>취소</Text>
            </TouchableOpacity>
          </View>
        )}

        <View
          style={[
            styles.inputWrapper,
            {
              paddingBottom: bottomSafeInset + (Platform.OS === 'android' ? keyboardPadding : 0),
            },
          ]}>
          <View style={styles.inputContainer}>
            <TouchableOpacity onPress={handleAttachment} style={styles.attachBtn} activeOpacity={0.7}>
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
            />
            <Pressable
              onPress={handleSendText}
              style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
              disabled={!text.trim()}>
              <Feather name="arrow-up" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  msgRow: { flexDirection: 'row', marginBottom: 12, width: '100%' },
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
