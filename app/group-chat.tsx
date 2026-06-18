import { Feather, Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
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
import MessengerLoadingState from '@/components/MessengerLoadingState';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import {
  groupChatBootstrap,
  groupChatClearNotice,
  groupChatDeleteMessage,
  groupChatMarkRead,
  groupChatSend,
  groupChatSetMuted,
  groupChatSetMemberSendPermission,
  groupChatSetNotice,
  groupChatSetReaction,
  type GroupChatActor,
  type GroupChatMember,
  type GroupChatMessage,
  type GroupChatMessageType,
  type GroupChatNotice,
  type GroupChatRoom,
} from '@/lib/group-chat-api';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { safeDecodeFileName } from '@/lib/validation';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6B7280';
const SOFT_BG = '#F9FAFB';
const CHAT_UPLOAD_BUCKET = 'chat-uploads';
const MESSAGE_LIMIT = 80;
const GROUP_CHAT_REFRESH_INTERVAL_MS = 8_000;
const GROUP_CHAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '👏'];

type OptimisticMessageInput = {
  content: string;
  messageType: GroupChatMessageType;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
};

type SearchableGroupChatMember = GroupChatMember & {
  search_key: string;
};

type MemberListRowProps = {
  member: GroupChatMember;
  canManageMemberSendPermissions: boolean;
  permissionUpdating: boolean;
  onToggle: (member: GroupChatMember, nextCanSend: boolean) => void;
};

const roleLabel: Record<string, string> = {
  fc: 'FC',
  manager: '본부장',
  admin: '총무',
};

function isStaffGroupChatActor(actor?: GroupChatActor | null) {
  return actor?.role === 'manager' || actor?.role === 'admin';
}

function resolveCanSendMessages(actor: GroupChatActor | null | undefined, canSendMessages?: boolean | null) {
  return isStaffGroupChatActor(actor) || canSendMessages === true;
}

type MemberStatusTone = 'complete' | 'partial' | 'pending' | 'active';

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

function normalizeMemberSearch(value?: string | null) {
  return String(value ?? '').replace(/\s+/g, '').trim().toLowerCase();
}

function formatTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function getMemberStatusTone(member: GroupChatMember): MemberStatusTone {
  if (member.role !== 'fc') return 'active';
  if (member.appointment_label === '위촉 완료') return 'complete';
  if (member.appointment_label === '위촉 대기') return 'pending';
  return 'partial';
}

function getReplyLabel(message?: GroupChatMessage | null) {
  if (!message) return '';
  if (message.deleted_at) return '삭제된 메시지';
  if (message.message_type === 'image') return '사진';
  if (message.message_type === 'file') return safeDecodeFileName(message.file_name) || '파일';
  return message.content;
}

function getMessageCopyText(message?: GroupChatMessage | null) {
  if (!message || message.deleted_at) return '';
  if (message.message_type === 'file') return safeDecodeFileName(message.file_name) || message.content;
  return message.content;
}

const MemberListRow = memo(function MemberListRow({
  member,
  canManageMemberSendPermissions,
  permissionUpdating,
  onToggle,
}: MemberListRowProps) {
  const statusTone = getMemberStatusTone(member);
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
          <Text style={styles.memberRole}>{roleLabel[member.role] ?? '사용자'}</Text>
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
  const insets = useSafeAreaInsets();
  const keyboardPadding = useKeyboardPadding();
  const flatListRef = useRef<FlatList<GroupChatMessage> | null>(null);
  const pickingRef = useRef(false);
  const isUploadCancelled = useRef(false);
  const messagesRef = useRef<GroupChatMessage[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [room, setRoom] = useState<GroupChatRoom | null>(null);
  const [actor, setActor] = useState<GroupChatActor | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [members, setMembers] = useState<GroupChatMember[]>([]);
  const [memberListVisible, setMemberListVisible] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [muted, setMuted] = useState(false);
  const [canSendMessages, setCanSendMessages] = useState(false);
  const [notice, setNotice] = useState<GroupChatNotice | null>(null);
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [replyTarget, setReplyTarget] = useState<GroupChatMessage | null>(null);
  const [actionMessage, setActionMessage] = useState<GroupChatMessage | null>(null);
  const [selectCopyMessage, setSelectCopyMessage] = useState<GroupChatMessage | null>(null);
  const [noticeUpdating, setNoticeUpdating] = useState(false);
  const [permissionUpdatingIds, setPermissionUpdatingIds] = useState<Set<string>>(() => new Set());

  const bottomSafeInset = Math.max(insets.bottom, Platform.OS === 'android' ? 20 : 12);
  const roomTitle = room?.title ?? '가람PA 단톡방';
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

  const load = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const data = await groupChatBootstrap(MESSAGE_LIMIT);
      setRoom(data.room);
      setActor(data.actor);
      setMemberCount(data.member_count);
      setMembers(data.members ?? []);
      setMuted(data.muted);
      setCanSendMessages(resolveCanSendMessages(data.actor, data.can_send_messages));
      setNotice(data.notice ?? null);
      const localMessages = messagesRef.current.filter((message) => message.id.startsWith('local-'));
      applyMessages([...data.messages, ...localMessages]);
      const topMessageId = data.messages[0]?.id ?? null;
      if (topMessageId) {
        void groupChatMarkRead(topMessageId).catch((error) => {
          logger.debug('[group-chat] mark read after load failed', error);
        });
      }
    } catch (error) {
      logger.warn('[group-chat] load failed', error);
      if (!options?.silent) {
        Alert.alert('단톡방 오류', error instanceof Error ? error.message : '단톡방을 불러오지 못했습니다.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyMessages]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load({ silent: true });
      const intervalId = setInterval(() => {
        void load({ silent: true });
      }, GROUP_CHAT_REFRESH_INTERVAL_MS);
      return () => clearInterval(intervalId);
    }, [load]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void load({ silent: true });
    });
    return () => subscription.remove();
  }, [load]);

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
    setRefreshing(true);
    void load();
  }, [load]);

  const searchableMembers = useMemo<SearchableGroupChatMember[]>(() => {
    return [...members].sort((left, right) => {
      const roleOrder = { manager: 0, admin: 1, fc: 2 } as const;
      const leftOrder = roleOrder[left.role] ?? 9;
      const rightOrder = roleOrder[right.role] ?? 9;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.name ?? '').localeCompare(String(right.name ?? ''), 'ko-KR');
    }).map((member) => ({
      ...member,
      search_key: normalizeMemberSearch(`${member.name ?? ''} ${member.headquarters ?? ''} ${member.phone ?? ''}`),
    }));
  }, [members]);

  const filteredMembers = useMemo(() => {
    const keyword = normalizeMemberSearch(deferredMemberSearch);
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
    const copyText = getMessageCopyText(actionMessage);
    setActionMessage(null);
    if (!copyText) {
      Alert.alert('복사할 수 없어요', '복사할 메시지 내용이 없습니다.');
      return;
    }
    try {
      await Clipboard.setStringAsync(copyText);
      Alert.alert('복사 완료', '메시지를 복사했어요.');
    } catch (error) {
      logger.warn('[group-chat] copy failed', error);
      Alert.alert('복사 실패', '메시지를 복사하지 못했습니다.');
    }
  }, [actionMessage]);

  const handleSelectCopyAction = useCallback(() => {
    const message = actionMessage;
    setActionMessage(null);
    if (!getMessageCopyText(message)) {
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
      Alert.alert('공지 변경 실패', error instanceof Error ? error.message : '공지를 변경하지 못했습니다.');
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
      Alert.alert('공지 해제 실패', error instanceof Error ? error.message : '공지를 해제하지 못했습니다.');
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
      Alert.alert('감정 남기기 실패', '감정을 저장하지 못했습니다.');
    }
  }, [updateMessage]);

  const handleDeleteAction = useCallback(() => {
    const message = actionMessage;
    if (!message || !canDeleteMessage(message)) return;
    setActionMessage(null);
    Alert.alert('메시지 삭제', '이 메시지를 삭제하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          void groupChatDeleteMessage(message.id)
            .then((result) => {
              updateMessage(message.id, result.message);
              if (notice?.message_id === message.id) setNotice(null);
            })
            .catch((error) => {
              logger.warn('[group-chat] delete failed', error);
              Alert.alert('삭제 실패', error instanceof Error ? error.message : '메시지를 삭제하지 못했습니다.');
            });
        },
      },
    ]);
  }, [actionMessage, canDeleteMessage, notice?.message_id, updateMessage]);

  const handleMessagePress = useCallback((message: GroupChatMessage) => {
    if (message.deleted_at) return;
    if ((message.message_type === 'image' || message.message_type === 'file') && message.file_url) {
      void Linking.openURL(message.file_url).catch((error) => {
        logger.warn('[group-chat] attachment open failed', error);
        Alert.alert('열기 실패', '첨부 파일을 열지 못했습니다.');
      });
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
      file_url: input.fileUrl ?? null,
      file_name: input.fileName ?? null,
      file_size: input.fileSize ?? null,
      created_at: now,
      unread_count: Math.max(0, memberCount - 1),
      reply_to_message_id: currentReplyTarget?.id ?? null,
      reply_to_sender_name: currentReplyTarget?.sender_name ?? null,
      reply_to_content: currentReplyTarget ? getReplyLabel(currentReplyTarget) : null,
      deleted_at: null,
      deleted_by_actor_id: null,
      reactions: [],
      send_status: 'sending',
    };
  }, [actor, memberCount, replyTarget, room]);

  const sendOptimisticToServer = useCallback(async (
    localMessageId: string,
    input: OptimisticMessageInput & { replyToMessageId?: string | null },
  ) => {
    try {
      const result = await groupChatSend({
        content: input.content,
        messageType: input.messageType,
        fileUrl: input.fileUrl,
        fileName: input.fileName,
        fileSize: input.fileSize,
        replyToMessageId: input.replyToMessageId,
      });
      applyMessages([
        result.message,
        ...messagesRef.current.filter((message) => message.id !== localMessageId),
      ]);
      void groupChatMarkRead(result.message.id).catch((error) => {
        logger.debug('[group-chat] mark read after send failed', error);
      });
    } catch (error) {
      updateMessage(localMessageId, { send_status: 'failed' });
      logger.warn('[group-chat] send failed', error);
      Alert.alert('전송 실패', error instanceof Error ? error.message : '메시지를 보내지 못했습니다.');
    }
  }, [applyMessages, updateMessage]);

  const sendPayload = useCallback(async (
    content: string,
    messageType: GroupChatMessageType = 'text',
    fileData?: { url: string; name?: string | null; size?: number | null },
  ) => {
    if (!canSendMessages) {
      showSendPermissionAlert();
      return;
    }

    const optimisticMessage = buildOptimisticMessage({
      content,
      messageType,
      fileUrl: fileData?.url,
      fileName: fileData?.name,
      fileSize: fileData?.size,
    });
    if (!optimisticMessage) {
      Alert.alert('전송 실패', '단톡방 정보를 불러온 뒤 다시 시도해주세요.');
      return;
    }

    applyMessages([optimisticMessage, ...messagesRef.current]);
    setReplyTarget(null);
    await sendOptimisticToServer(optimisticMessage.id, {
      content,
      messageType,
      fileUrl: fileData?.url,
      fileName: fileData?.name,
      fileSize: fileData?.size,
      replyToMessageId: optimisticMessage.reply_to_message_id,
    });
  }, [applyMessages, buildOptimisticMessage, canSendMessages, sendOptimisticToServer, showSendPermissionAlert]);

  const handleSendText = useCallback(() => {
    const nextText = text.trim();
    if (!nextText) return;
    if (!canSendMessages) {
      showSendPermissionAlert();
      return;
    }
    setText('');
    isUploadCancelled.current = false;
    void sendPayload(nextText, 'text');
  }, [canSendMessages, sendPayload, showSendPermissionAlert, text]);

  const uploadToSupabase = useCallback(async (uri: string, fileType: string) => {
    try {
      isUploadCancelled.current = false;
      setUploading(true);
      const ext = uri.split('.').pop()?.toLowerCase() ?? 'bin';
      const fileName = `group-chat/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
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
    } catch (error) {
      if (isUploadCancelled.current) return null;
      logger.error('[group-chat] file upload failed', { error });
      Alert.alert('업로드 실패', '파일 업로드 중 오류가 발생했습니다.');
      return null;
    } finally {
      if (!isUploadCancelled.current) setUploading(false);
    }
  }, []);

  const pickImage = useCallback(async () => {
    if (!canSendMessages) {
      showSendPermissionAlert();
      return;
    }

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
      const optimisticMessage = buildOptimisticMessage({
        content: '사진을 보냈습니다.',
        messageType: 'image',
        fileUrl: asset.uri,
        fileName: asset.fileName ?? 'image.jpg',
        fileSize: asset.fileSize,
      });
      if (!optimisticMessage) {
        Alert.alert('전송 실패', '단톡방 정보를 불러온 뒤 다시 시도해주세요.');
        return;
      }

      applyMessages([optimisticMessage, ...messagesRef.current]);
      setReplyTarget(null);
      const publicUrl = await uploadToSupabase(asset.uri, asset.mimeType ?? 'image/jpeg');
      if (!publicUrl) {
        if (isUploadCancelled.current) {
          removeMessage(optimisticMessage.id);
        } else {
          updateMessage(optimisticMessage.id, { send_status: 'failed' });
        }
        return;
      }

      updateMessage(optimisticMessage.id, { file_url: publicUrl });
      await sendOptimisticToServer(optimisticMessage.id, {
        content: '사진을 보냈습니다.',
        messageType: 'image',
        fileUrl: publicUrl,
        fileName: asset.fileName ?? 'image.jpg',
        fileSize: asset.fileSize,
        replyToMessageId: optimisticMessage.reply_to_message_id,
      });
    }
  }, [applyMessages, buildOptimisticMessage, canSendMessages, removeMessage, sendOptimisticToServer, showSendPermissionAlert, updateMessage, uploadToSupabase]);

  const pickDocument = useCallback(async () => {
    if (!canSendMessages) {
      showSendPermissionAlert();
      return;
    }

    if (pickingRef.current) return;
    pickingRef.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (!result.canceled) {
        const file = result.assets[0];
        const optimisticMessage = buildOptimisticMessage({
          content: file.name,
          messageType: 'file',
          fileUrl: file.uri,
          fileName: file.name,
          fileSize: file.size,
        });
        if (!optimisticMessage) {
          Alert.alert('전송 실패', '단톡방 정보를 불러온 뒤 다시 시도해주세요.');
          return;
        }

        applyMessages([optimisticMessage, ...messagesRef.current]);
        setReplyTarget(null);
        const publicUrl = await uploadToSupabase(file.uri, file.mimeType ?? 'application/octet-stream');
        if (!publicUrl) {
          if (isUploadCancelled.current) {
            removeMessage(optimisticMessage.id);
          } else {
            updateMessage(optimisticMessage.id, { send_status: 'failed' });
          }
          return;
        }

        updateMessage(optimisticMessage.id, { file_url: publicUrl });
        await sendOptimisticToServer(optimisticMessage.id, {
          content: file.name,
          messageType: 'file',
          fileUrl: publicUrl,
          fileName: file.name,
          fileSize: file.size,
          replyToMessageId: optimisticMessage.reply_to_message_id,
        });
      }
    } catch (error) {
      logger.debug('[group-chat] document picker failed', { error });
    } finally {
      pickingRef.current = false;
    }
  }, [applyMessages, buildOptimisticMessage, canSendMessages, removeMessage, sendOptimisticToServer, showSendPermissionAlert, updateMessage, uploadToSupabase]);

  const handleAttachment = useCallback(() => {
    if (!canSendMessages) {
      showSendPermissionAlert();
      return;
    }

    Alert.alert('파일 전송', '어떤 파일을 보내시겠습니까?', [
      { text: '사진 보관함', onPress: pickImage },
      { text: '문서 (PDF 등)', onPress: pickDocument },
      { text: '취소', style: 'cancel' },
    ]);
  }, [canSendMessages, pickDocument, pickImage, showSendPermissionAlert]);

  const handleCancelUpload = useCallback(() => {
    isUploadCancelled.current = true;
    setUploading(false);
  }, []);

  const toggleMuted = useCallback(async () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    try {
      const result = await groupChatSetMuted(nextMuted);
      setMuted(result.muted);
    } catch {
      setMuted(!nextMuted);
      Alert.alert('설정 실패', '알림 설정을 저장하지 못했습니다.');
    }
  }, [muted]);

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
      setMembers((prev) => prev.map((row) =>
        row.actor_id === result.member.actor_id ? { ...row, ...result.member } : row,
      ));
      if (result.member.actor_id === actor?.id) {
        setCanSendMessages(resolveCanSendMessages(actor, result.member.can_send_messages));
      }
    } catch (error) {
      setMembers((prev) => prev.map((row) =>
        row.actor_id === member.actor_id ? { ...row, can_send_messages: previousCanSend } : row,
      ));
      logger.warn('[group-chat] member send permission update failed', error);
      Alert.alert('권한 변경 실패', '채팅 권한을 저장하지 못했습니다.');
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
    const unreadCount = Math.max(0, Number(item.unread_count ?? 0));
    const showUnreadCount = unreadCount > 0;
    const reactions = item.reactions ?? [];
    const messageMeta = (
      <View style={[styles.messageSideMeta, isMe ? styles.messageSideMetaMe : styles.messageSideMetaOther]}>
        {showUnreadCount && (
          <Text style={styles.messageUnreadCount}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        )}
        {item.send_status === 'sending' && <BrandedLoadingSpinner size="sm" color={HANWHA_ORANGE} />}
        {item.send_status === 'failed' && <Text style={[styles.messageSendStatus, styles.messageSendStatusFailed]}>실패</Text>}
        <Text style={styles.timeText}>{formatTime(item.created_at)}</Text>
      </View>
    );

    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
        {!isMe && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitial(item.sender_name)}</Text>
          </View>
        )}
        <View style={[styles.msgContainer, { alignItems: isMe ? 'flex-end' : 'flex-start' }]}>
          {!isMe && (
            <Text style={styles.senderName} numberOfLines={1}>
              {item.sender_name || roleLabel[item.sender_role] || '사용자'}
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
  }, [actor?.id, handleMessagePress, handleReactionAction, openMessageActions, renderMessageContent, renderReplyPreview]);

  const headerSubtitle = useMemo(() => `${memberCount.toLocaleString('ko-KR')}명 참여`, [memberCount]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" backgroundColor="#fff" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
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
          <Pressable style={styles.headerButton} onPress={toggleMuted}>
            <Feather name={muted ? 'bell-off' : 'bell'} size={20} color={muted ? MUTED : HANWHA_ORANGE} />
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
            <Text style={styles.noticeText} numberOfLines={2}>{getReplyLabel(notice.message)}</Text>
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

      {loading ? (
        <MessengerLoadingState variant="group-chat" />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 65 : 0}
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
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
                { bottom: 68 + bottomSafeInset + (Platform.OS === 'android' ? keyboardPadding : 0) },
              ]}
            >
              <BrandedLoadingSpinner size="sm" color={HANWHA_ORANGE} />
              <TouchableOpacity onPress={handleCancelUpload} style={styles.cancelUploadBtn} activeOpacity={0.8}>
                <Ionicons name="close-circle" size={20} color="#666" />
                <Text style={styles.cancelUploadText}>취소</Text>
              </TouchableOpacity>
            </View>
          )}

              <View
                style={[
                  styles.inputWrapper,
                  { paddingBottom: bottomSafeInset + (Platform.OS === 'android' ? keyboardPadding : 0) },
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
                        {getReplyLabel(replyTarget)}
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
                <View style={styles.inputContainer}>
              <TouchableOpacity
                onPress={handleAttachment}
                style={[styles.attachBtn, !canSendMessages && styles.attachBtnDisabled]}
                activeOpacity={0.7}
                disabled={!canSendMessages}
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
                editable={canSendMessages}
                textAlignVertical="center"
                scrollEnabled={false}
              />
              <Pressable
                onPress={handleSendText}
                style={[styles.sendBtn, (!canSendMessages || !text.trim()) && styles.sendBtnDisabled]}
                disabled={!canSendMessages || !text.trim()}
              >
                <Feather name="arrow-up" size={20} color="#fff" />
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

      <Modal
        visible={Boolean(actionMessage)}
        transparent
        animationType="fade"
        onRequestClose={closeMessageActions}
      >
        <View style={styles.actionMenuBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeMessageActions} />
          <View style={styles.actionMenu}>
            <View style={styles.sheetHandle} />
            <Text style={styles.actionSheetTitle}>메시지 작업</Text>
            <Text style={styles.actionSheetPreview} numberOfLines={2}>
              {getReplyLabel(actionMessage)}
            </Text>

            <Text style={styles.reactionPickerLabel}>감정 남기기</Text>
            <View style={styles.reactionPickerRow}>
              {GROUP_CHAT_REACTIONS.map((reaction) => (
                <Pressable
                  key={reaction}
                  style={styles.reactionPickerButton}
                  onPress={() => actionMessage && void handleReactionAction(actionMessage, reaction)}
                >
                  <Text style={styles.reactionPickerText}>{reaction}</Text>
                </Pressable>
              ))}
            </View>

            {!actionMessage?.deleted_at && (
              <>
                <Pressable style={styles.actionButton} onPress={handleCopyAction}>
                  <Feather name="copy" size={18} color="#F9FAFB" />
                  <Text style={styles.actionButtonText}>복사</Text>
                </Pressable>

                <Pressable style={styles.actionButton} onPress={handleSelectCopyAction}>
                  <Feather name="type" size={18} color="#F9FAFB" />
                  <Text style={styles.actionButtonText}>선택 복사</Text>
                </Pressable>
              </>
            )}

            <Pressable style={styles.actionButton} onPress={handleReplyAction}>
              <Feather name="corner-up-left" size={18} color="#F9FAFB" />
              <Text style={styles.actionButtonText}>답장</Text>
            </Pressable>

            {canManageNotice && actionMessage && !actionMessage.deleted_at && !actionMessage.id.startsWith('local-') && !actionMessage.send_status && (
              <Pressable style={styles.actionButton} disabled={noticeUpdating} onPress={handleNoticeAction}>
                <Feather name="volume-2" size={18} color="#F9FAFB" />
                <Text style={styles.actionButtonText}>
                  {notice?.message_id === actionMessage.id ? '공지 해제' : '공지'}
                </Text>
              </Pressable>
            )}

            {canDeleteMessage(actionMessage) && (
              <Pressable style={[styles.actionButton, styles.actionButtonDanger]} onPress={handleDeleteAction}>
                <Feather name="trash-2" size={18} color="#DC2626" />
                <Text style={[styles.actionButtonText, styles.actionButtonTextDanger]}>삭제</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(selectCopyMessage)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectCopyMessage(null)}
      >
        <View style={styles.selectCopyBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectCopyMessage(null)} />
          <View style={[styles.selectCopySheet, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.selectCopyHeader}>
              <Text style={styles.selectCopyTitle}>선택 복사</Text>
              <Pressable style={styles.selectCopyCloseButton} onPress={() => setSelectCopyMessage(null)}>
                <Feather name="x" size={20} color={CHARCOAL} />
              </Pressable>
            </View>
            <Text selectable style={styles.selectCopyText}>
              {getMessageCopyText(selectCopyMessage)}
            </Text>
          </View>
        </View>
      </Modal>
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
    width: 42,
    height: 42,
    borderRadius: 21,
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
  list: { flex: 1 },
  listContent: { paddingVertical: 20, paddingHorizontal: 16, gap: 12, flexGrow: 1 },
  msgRow: { flexDirection: 'row', marginBottom: 12, width: '100%' },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
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
  msgText: { fontSize: 15, lineHeight: 22, flexWrap: 'wrap' },
  msgTextMe: { color: '#fff', fontWeight: '500' },
  msgTextOther: { color: CHARCOAL },
  msgLinkText: { color: '#2563EB', textDecorationLine: 'underline', fontWeight: '700' },
  messageSideMeta: { minWidth: 44, paddingBottom: 2 },
  messageSideMetaMe: { alignItems: 'flex-end' },
  messageSideMetaOther: { alignItems: 'flex-start' },
  messageUnreadCount: { fontSize: 11, lineHeight: 13, color: HANWHA_ORANGE, fontWeight: '800' },
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
