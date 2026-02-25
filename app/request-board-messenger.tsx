import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { logger } from '@/lib/logger';
import {
  type RbAttachmentMeta,
  type RbDmMessage,
  type RbMessage,
  type RbUser,
  clearAuth,
  rbCheckAuth,
  rbCreateDmConversation,
  rbGetConversations,
  rbGetDesigners,
  rbGetDmConversations,
  rbGetDmMessages,
  rbGetMessages,
  rbLogin,
  rbSendDmMessage,
  rbSendMessage,
  rbUploadAttachments,
} from '@/lib/request-board-api';
import { COLORS, RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '@/lib/theme';

/* ─── Types ─── */

type UnifiedConversation = {
  id: string;
  type: 'request' | 'dm';
  name: string;
  company?: string;
  initial: string;
  avatarColor: string;
  lastMessage: string;
  lastTime: string;
  lastTimestamp: number;
  unreadCount: number;
  primaryConversationId: number;
  conversationIds: number[];
  participantRole: string;
};

type MessageAttachment = {
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
};

type PendingFile = {
  uri: string;
  name: string;
  type: string;
  size?: number;
};

type UnifiedMessage = {
  id: number;
  senderId: number;
  senderName: string;
  message: string;
  createdAt: string;
  isOwn: boolean;
  deleted: boolean;
  attachments: MessageAttachment[];
};

type DesignerItem = {
  id: string;
  designerId: number;
  userId: number;
  name: string;
  company: string;
  initial: string;
  avatarColor: string;
  hasConversation: boolean;
};

/* ─── Helpers ─── */

const AVATAR_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
  '#06B6D4', '#84CC16', '#F97316', '#6366F1', '#EF4444',
];
type FeatherIconName = keyof typeof Feather.glyphMap;

const hashColor = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

const fmtRelative = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일`;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });

const isImageType = (type: string) =>
  /^image\//i.test(type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(type);

const isImageUrl = (url: string) =>
  /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

const fileIcon = (type: string): FeatherIconName => {
  if (/pdf/i.test(type)) return 'file-text';
  if (/sheet|excel|xls/i.test(type)) return 'grid';
  if (/doc|word/i.test(type)) return 'file-text';
  return 'file';
};

const POLL_INTERVAL = 8000;

/* ─── Screen ─── */

export default function RequestBoardMessengerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { residentId } = useSession();

  // Auth
  const [authState, setAuthState] = useState<'checking' | 'login' | 'ready'>('checking');
  const [rbUser, setRbUser] = useState<RbUser | null>(null);
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Conversations + Designers
  const [conversations, setConversations] = useState<UnifiedConversation[]>([]);
  const [designers, setDesigners] = useState<DesignerItem[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convRefreshing, setConvRefreshing] = useState(false);
  const [convError, setConvError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [creatingDm, setCreatingDm] = useState<string | null>(null); // designer id being created

  // Chat detail
  const [activeConv, setActiveConv] = useState<UnifiedConversation | null>(null);
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<UnifiedMessage>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ─── Auth Flow ─── */
  useEffect(() => {
    (async () => {
      const { authenticated, user } = await rbCheckAuth();
      if (authenticated && user) {
        setRbUser(user);
        setAuthState('ready');
      } else {
        setLoginPhone(residentId ?? '');
        setAuthState('login');
      }
    })();
  }, [residentId]);

  const handleLogin = async () => {
    setLoginError('');
    setLoginLoading(true);
    const { success, user, error } = await rbLogin(loginPhone, loginPw);
    setLoginLoading(false);
    if (success && user) {
      setRbUser(user);
      setAuthState('ready');
    } else {
      setLoginError(error ?? '로그인에 실패했습니다.');
    }
  };

  const handleLogout = async () => {
    await clearAuth();
    setRbUser(null);
    setActiveConv(null);
    setConversations([]);
    setDesigners([]);
    setAuthState('login');
  };

  /* ─── Conversation + Designer List ─── */
  const loadConversations = useCallback(async () => {
    if (authState !== 'ready' || !rbUser) return;
    setConvError('');
    try {
      logger.info(`[messenger] loading conversations for user ${rbUser.id} (${rbUser.role})`);

      // Fetch conversations and designers in parallel
      // Use Promise.allSettled to avoid one failure killing everything
      const [reqResult, dmResult, designerResult] = await Promise.allSettled([
        rbGetConversations(),
        rbGetDmConversations(),
        rbUser.role === 'fc' ? rbGetDesigners() : Promise.resolve([]),
      ]);

      const reqConvs = reqResult.status === 'fulfilled' ? reqResult.value : [];
      const dmConvs = dmResult.status === 'fulfilled' ? dmResult.value : [];
      const allDesigners = designerResult.status === 'fulfilled' ? designerResult.value : [];

      if (reqResult.status === 'rejected') {
        logger.warn('[messenger] request conversations failed', reqResult.reason);
      }
      if (dmResult.status === 'rejected') {
        logger.warn('[messenger] DM conversations failed', dmResult.reason);
      }

      logger.info(`[messenger] fetched: ${reqConvs.length} request convs, ${dmConvs.length} DM convs, ${allDesigners.length} designers`);

      const unified: UnifiedConversation[] = [];
      const participantUserIds = new Set<number>();

      for (const c of reqConvs) {
        const isFC = rbUser.role === 'fc';
        const name = isFC
          ? c.designer?.users?.name ?? c.designer?.company_name ?? '설계 매니저'
          : c.fc?.name ?? 'FC';
        const company = isFC ? c.designer?.company_name ?? undefined : undefined;

        if (isFC && c.designer?.users?.id) participantUserIds.add(c.designer.users.id);
        if (!isFC && c.fc?.id) participantUserIds.add(c.fc.id);

        unified.push({
          id: `req-${c.id}`,
          type: 'request',
          name,
          company,
          initial: name.charAt(0),
          avatarColor: hashColor(name),
          lastMessage: c.lastMessage?.message ?? '',
          lastTime: c.lastMessage?.created_at ? fmtRelative(c.lastMessage.created_at) : '',
          lastTimestamp: c.lastMessage?.created_at
            ? new Date(c.lastMessage.created_at).getTime()
            : 0,
          unreadCount: c.unreadCount,
          primaryConversationId: c.primaryConversationId,
          conversationIds: c.conversationIds,
          participantRole: isFC ? 'designer' : 'fc',
        });
      }

      for (const d of dmConvs) {
        const name = d.participant?.name ?? '대화상대';
        if (d.participant?.id) participantUserIds.add(d.participant.id);

        unified.push({
          id: `dm-${d.id}`,
          type: 'dm',
          name,
          initial: name.charAt(0),
          avatarColor: hashColor(name),
          lastMessage: d.lastMessage?.message ?? '',
          lastTime: d.lastMessage?.created_at ? fmtRelative(d.lastMessage.created_at) : '',
          lastTimestamp: d.lastMessage?.created_at
            ? new Date(d.lastMessage.created_at).getTime()
            : 0,
          unreadCount: d.unreadCount,
          primaryConversationId: d.id,
          conversationIds: [d.id],
          participantRole: d.participant?.role ?? 'fc',
        });
      }

      unified.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
      setConversations(unified);

      logger.info(`[messenger] total unified conversations: ${unified.length}`);

      if (unified.length === 0 && reqConvs.length === 0 && dmConvs.length === 0) {
        // Both returned empty - might be an auth or data issue
        if (reqResult.status === 'rejected' || dmResult.status === 'rejected') {
          setConvError('대화 목록을 불러오는데 실패했습니다. 아래로 당겨서 다시 시도해주세요.');
        }
      }

      // Build designer list (filter out those already in conversations)
      const designerItems: DesignerItem[] = allDesigners
        .filter((d) => d.users)
        .map((d) => {
          const name = d.users!.name;
          const userId = d.users!.id;
          return {
            id: `designer-${d.id}`,
            designerId: d.id,
            userId,
            name,
            company: d.company_name ?? '',
            initial: name.charAt(0),
            avatarColor: hashColor(name),
            hasConversation: participantUserIds.has(userId),
          };
        });

      setDesigners(designerItems);
    } catch (err) {
      logger.warn('[messenger] load conversations failed', err);
      setConvError('대화 목록을 불러오는데 실패했습니다. 아래로 당겨서 다시 시도해주세요.');
    } finally {
      setConvLoading(false);
      setConvRefreshing(false);
    }
  }, [authState, rbUser]);

  useEffect(() => {
    if (authState === 'ready') {
      setConvLoading(true);
      loadConversations();
    }
  }, [authState, loadConversations]);

  // Filtered conversations + designers for search
  const filteredConvs = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.company ?? '').toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q),
    );
  }, [conversations, searchQuery]);

  const filteredDesigners = useMemo(() => {
    const noConvDesigners = designers.filter((d) => !d.hasConversation);
    if (!searchQuery.trim()) return noConvDesigners;
    const q = searchQuery.trim().toLowerCase();
    return noConvDesigners.filter(
      (d) => d.name.toLowerCase().includes(q) || d.company.toLowerCase().includes(q),
    );
  }, [designers, searchQuery]);

  const totalUnread = useMemo(
    () => conversations.reduce((acc, c) => acc + c.unreadCount, 0),
    [conversations],
  );

  /* ─── Start new DM conversation ─── */
  const handleStartDm = async (designer: DesignerItem) => {
    if (creatingDm) return;
    setCreatingDm(designer.id);
    try {
      const res = await rbCreateDmConversation(designer.userId);
      if (res.success && res.data) {
        const conv: UnifiedConversation = {
          id: `dm-${res.data.id}`,
          type: 'dm',
          name: designer.name,
          company: designer.company,
          initial: designer.initial,
          avatarColor: designer.avatarColor,
          lastMessage: '',
          lastTime: '',
          lastTimestamp: Date.now(),
          unreadCount: 0,
          primaryConversationId: res.data.id,
          conversationIds: [res.data.id],
          participantRole: 'designer',
        };
        openConversation(conv);
      }
    } catch (err) {
      logger.warn('[messenger] create DM failed', err);
    } finally {
      setCreatingDm(null);
    }
  };

  /* ─── Chat Detail ─── */
  const loadMessages = useCallback(async (conv: UnifiedConversation) => {
    if (!rbUser) return;
    setMsgLoading(true);
    try {
      let raw: (RbMessage | RbDmMessage)[] = [];
      if (conv.type === 'request') {
        raw = await rbGetMessages(conv.conversationIds, 100);
      } else {
        raw = await rbGetDmMessages(conv.primaryConversationId, 100);
      }

      const mapped: UnifiedMessage[] = raw
        .filter((m) => !('deleted_at' in m && m.deleted_at))
        .map((m) => {
          // Extract attachments from either request messages or DM messages
          const rawAttachments =
            (m as RbMessage).message_attachments ??
            (m as RbDmMessage).direct_message_attachments ??
            [];
          const attachments: MessageAttachment[] = rawAttachments.map((a) => ({
            fileName: a.file_name,
            fileType: a.file_type,
            fileSize: a.file_size,
            fileUrl: a.file_url,
          }));

          return {
            id: m.id,
            senderId: m.sender_id,
            senderName: m.sender?.name ?? '알 수 없음',
            message: m.message,
            createdAt: m.created_at,
            isOwn: m.sender_id === rbUser.id,
            deleted: !!('deleted_at' in m && m.deleted_at),
            attachments,
          };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setMessages(mapped);
    } catch (err) {
      logger.warn('[messenger] load messages failed', err);
    } finally {
      setMsgLoading(false);
    }
  }, [rbUser]);

  const openConversation = (conv: UnifiedConversation) => {
    setActiveConv(conv);
    setInputText('');
    setPendingFiles([]);
    loadMessages(conv);
  };

  // Polling for new messages
  useEffect(() => {
    if (!activeConv) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(() => {
      loadMessages(activeConv);
    }, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeConv, loadMessages]);

  /* ─── File Picking ─── */
  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 접근 권한을 허용해주세요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: 5,
    });
    if (result.canceled) return;
    const newFiles: PendingFile[] = result.assets.map((a) => ({
      uri: a.uri,
      name: a.fileName ?? `image_${Date.now()}.jpg`,
      type: a.mimeType ?? 'image/jpeg',
      size: a.fileSize,
    }));
    setPendingFiles((prev) => [...prev, ...newFiles].slice(0, 10));
  };

  const handlePickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/*'],
      multiple: true,
    });
    if (result.canceled) return;
    const newFiles: PendingFile[] = result.assets.map((a) => ({
      uri: a.uri,
      name: a.name,
      type: a.mimeType ?? 'application/octet-stream',
      size: a.size,
    }));
    setPendingFiles((prev) => [...prev, ...newFiles].slice(0, 10));
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  /* ─── Send Message ─── */
  const handleSend = async () => {
    if (!activeConv || (!inputText.trim() && pendingFiles.length === 0) || sending) return;
    const text = inputText.trim();
    const files = [...pendingFiles];
    setInputText('');
    setPendingFiles([]);
    setSending(true);

    try {
      // Upload files first if any
      let attachments: RbAttachmentMeta[] | undefined;
      if (files.length > 0) {
        const uploadRes = await rbUploadAttachments(
          files.map((f) => ({ uri: f.uri, name: f.name, type: f.type })),
        );
        if (!uploadRes.success || !uploadRes.data) {
          Alert.alert('업로드 실패', uploadRes.error ?? '파일 업로드에 실패했습니다.');
          setInputText(text);
          setPendingFiles(files);
          setSending(false);
          return;
        }
        attachments = uploadRes.data;
      }

      let res;
      const msgText = text || (attachments ? '[첨부파일]' : '');
      if (activeConv.type === 'request') {
        res = await rbSendMessage(activeConv.primaryConversationId, msgText, attachments);
      } else {
        res = await rbSendDmMessage(activeConv.primaryConversationId, msgText, attachments);
      }

      if (res.success) {
        await loadMessages(activeConv);
        setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
      } else {
        setInputText(text);
        setPendingFiles(files);
      }
    } catch {
      setInputText(text);
      setPendingFiles(files);
    } finally {
      setSending(false);
    }
  };

  const handleBack = () => {
    if (activeConv) {
      setActiveConv(null);
      setMessages([]);
      setPendingFiles([]);
      setPreviewImage(null);
      loadConversations();
    } else {
      router.back();
    }
  };

  /* ═══════════════════════════════════════════════════
     RENDER: Loading / Checking Auth
     ═══════════════════════════════════════════════════ */
  if (authState === 'checking') {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </View>
    );
  }

  /* ═══════════════════════════════════════════════════
     RENDER: Login Screen
     ═══════════════════════════════════════════════════ */
  if (authState === 'login') {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />

        {/* Header - fixed at top */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 4, paddingBottom: SPACING.md }]}>
          <View style={styles.headerRow}>
            <Pressable style={styles.backBtn} onPress={() => router.back()}>
              <Feather name="arrow-left" size={22} color={COLORS.gray[800]} />
            </Pressable>
            <Text style={styles.headerTitleCenter}>설계요청 메신저</Text>
            <View style={styles.backBtn} />
          </View>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <FlatList
            data={[]}
            renderItem={null}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1 }}
            ListHeaderComponent={
              <View style={styles.loginWrap}>
                <View style={styles.loginIconWrap}>
                  <Feather name="message-circle" size={40} color={COLORS.primary} />
                </View>
                <Text style={styles.loginTitle}>설계요청 계정 로그인</Text>
                <Text style={styles.loginDesc}>
                  설계요청 페이지에서 사용하는{'\n'}전화번호와 비밀번호를 입력해주세요
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>전화번호</Text>
                  <TextInput
                    style={styles.input}
                    value={loginPhone}
                    onChangeText={setLoginPhone}
                    placeholder="01012345678"
                    placeholderTextColor={COLORS.gray[400]}
                    keyboardType="phone-pad"
                    autoCorrect={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>비밀번호</Text>
                  <TextInput
                    style={styles.input}
                    value={loginPw}
                    onChangeText={setLoginPw}
                    placeholder="비밀번호 입력"
                    placeholderTextColor={COLORS.gray[400]}
                    secureTextEntry
                    onSubmitEditing={handleLogin}
                  />
                </View>

                {loginError ? (
                  <View style={styles.errorWrap}>
                    <Feather name="alert-circle" size={14} color={COLORS.error} />
                    <Text style={styles.errorText}>{loginError}</Text>
                  </View>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    styles.loginBtn,
                    pressed && { opacity: 0.85 },
                    loginLoading && { opacity: 0.6 },
                  ]}
                  onPress={handleLogin}
                  disabled={loginLoading || !loginPhone.trim() || !loginPw}
                >
                  <LinearGradient
                    colors={[COLORS.primary, COLORS.primaryDark]}
                    style={styles.loginBtnGradient}
                  >
                    {loginLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.loginBtnText}>로그인</Text>
                    )}
                  </LinearGradient>
                </Pressable>

                {/* Bottom spacing for keyboard */}
                <View style={{ height: 40 }} />
              </View>
            }
          />
        </KeyboardAvoidingView>
      </View>
    );
  }

  /* ═══════════════════════════════════════════════════
     RENDER: Chat Detail
     ═══════════════════════════════════════════════════ */
  if (activeConv) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />

        {/* Chat Header */}
        <View style={[styles.chatHeader, { paddingTop: Math.max(insets.top, 20) }]}>
          <Pressable style={styles.backBtn} onPress={handleBack}>
            <Feather name="arrow-left" size={22} color={COLORS.gray[800]} />
          </Pressable>
          <View style={styles.chatHeaderCenter}>
            <View style={[styles.avatarSm, { backgroundColor: activeConv.avatarColor }]}>
              <Text style={styles.avatarSmText}>{activeConv.initial}</Text>
            </View>
            <View>
              <Text style={styles.chatHeaderName} numberOfLines={1}>
                {activeConv.name}
              </Text>
              {activeConv.company && (
                <Text style={styles.chatHeaderCompany} numberOfLines={1}>
                  {activeConv.company}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.backBtn} />
        </View>

        {/* Messages + Input */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          {msgLoading && messages.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.emptyChatWrap}>
              <Feather name="message-circle" size={36} color={COLORS.gray[200]} />
              <Text style={styles.emptyChatText}>아직 메시지가 없습니다</Text>
              <Text style={styles.emptyChatSub}>첫 메시지를 보내보세요</Text>
            </View>
          ) : (
            <FlatList<UnifiedMessage>
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => String(item.id)}
              inverted
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.msgListContent}
              renderItem={({ item, index }) => {
                const showDate =
                  index === messages.length - 1 ||
                  fmtDate(item.createdAt) !== fmtDate(messages[index + 1].createdAt);

                const imageAttachments = item.attachments.filter(
                  (a: MessageAttachment) => isImageType(a.fileType) || isImageUrl(a.fileUrl),
                );
                const fileAttachments = item.attachments.filter(
                  (a: MessageAttachment) => !isImageType(a.fileType) && !isImageUrl(a.fileUrl),
                );
                const hasText = item.message && item.message !== '[첨부파일]';

                const attachmentContent = (isOwn: boolean) => (
                  <>
                    {imageAttachments.length > 0 && (
                      <View style={styles.attachImageGrid}>
                        {imageAttachments.map((img: MessageAttachment, i: number) => (
                          <Pressable
                            key={i}
                            onPress={() => setPreviewImage(img.fileUrl)}
                          >
                            <Image
                              source={{ uri: img.fileUrl }}
                              style={styles.attachImage}
                              resizeMode="cover"
                            />
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {fileAttachments.map((file: MessageAttachment, i: number) => (
                      <Pressable
                        key={i}
                        style={[
                          styles.fileCard,
                          isOwn ? styles.fileCardOwn : styles.fileCardOther,
                        ]}
                        onPress={() => Linking.openURL(file.fileUrl)}
                      >
                        <Feather
                          name={fileIcon(file.fileType)}
                          size={18}
                          color={isOwn ? '#fff' : COLORS.primary}
                        />
                        <View style={styles.fileCardInfo}>
                          <Text
                            style={[styles.fileCardName, isOwn && styles.fileCardNameOwn]}
                            numberOfLines={1}
                          >
                            {file.fileName}
                          </Text>
                          <Text style={[styles.fileCardSize, isOwn && styles.fileCardSizeOwn]}>
                            {formatFileSize(file.fileSize)}
                          </Text>
                        </View>
                        <Feather
                          name="download"
                          size={14}
                          color={isOwn ? 'rgba(255,255,255,0.7)' : COLORS.gray[400]}
                        />
                      </Pressable>
                    ))}
                  </>
                );

                return (
                  <View>
                    {showDate && (
                      <View style={styles.dateSep}>
                        <View style={styles.dateLine} />
                        <Text style={styles.dateText}>{fmtDate(item.createdAt)}</Text>
                        <View style={styles.dateLine} />
                      </View>
                    )}
                    {item.isOwn ? (
                      <View style={styles.ownRow}>
                        <Text style={styles.msgTime}>{fmtTime(item.createdAt)}</Text>
                        <View style={{ maxWidth: '75%' }}>
                          {hasText && (
                            <View style={styles.ownBubble}>
                              <Text style={styles.ownBubbleText}>{item.message}</Text>
                            </View>
                          )}
                          {attachmentContent(true)}
                        </View>
                      </View>
                    ) : (
                      <View style={styles.otherRow}>
                        <View style={[styles.avatarXs, { backgroundColor: activeConv.avatarColor }]}>
                          <Text style={styles.avatarXsText}>{activeConv.initial}</Text>
                        </View>
                        <View style={styles.otherBubbleWrap}>
                          <Text style={styles.otherSender}>{item.senderName}</Text>
                          {hasText && (
                            <View style={styles.otherBubble}>
                              <Text style={styles.otherBubbleText}>{item.message}</Text>
                            </View>
                          )}
                          {attachmentContent(false)}
                        </View>
                        <Text style={styles.msgTime}>{fmtTime(item.createdAt)}</Text>
                      </View>
                    )}
                  </View>
                );
              }}
            />
          )}

          {/* Pending Files Preview */}
          {pendingFiles.length > 0 && (
            <View style={styles.pendingStrip}>
              <FlatList<PendingFile>
                horizontal
                data={pendingFiles}
                keyExtractor={(_, i) => String(i)}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: SPACING.md, gap: 8 }}
                renderItem={({ item, index }) => {
                  const isImg = isImageType(item.type);
                  return (
                    <View style={styles.pendingItem}>
                      {isImg ? (
                        <Image source={{ uri: item.uri }} style={styles.pendingThumb} />
                      ) : (
                        <View style={styles.pendingFileIcon}>
                          <Feather name={fileIcon(item.type)} size={20} color={COLORS.primary} />
                        </View>
                      )}
                      <Pressable
                        style={styles.pendingRemove}
                        onPress={() => removePendingFile(index)}
                        hitSlop={8}
                      >
                        <Feather name="x" size={12} color="#fff" />
                      </Pressable>
                      <Text style={styles.pendingName} numberOfLines={1}>
                        {item.name.length > 8 ? item.name.slice(0, 8) + '...' : item.name}
                      </Text>
                    </View>
                  );
                }}
              />
            </View>
          )}

          {/* Input Bar */}
          <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <Pressable
              style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.6 }]}
              onPress={handlePickImage}
              disabled={sending}
            >
              <Feather name="image" size={20} color={COLORS.gray[500]} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.6 }]}
              onPress={handlePickDocument}
              disabled={sending}
            >
              <Feather name="paperclip" size={20} color={COLORS.gray[500]} />
            </Pressable>
            <TextInput
              style={styles.chatInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder="메시지를 입력하세요"
              placeholderTextColor={COLORS.gray[400]}
              multiline
              maxLength={2000}
              editable={!sending}
            />
            <Pressable
              style={({ pressed }) => [
                styles.sendBtn,
                (!inputText.trim() && pendingFiles.length === 0 || sending) && styles.sendBtnDisabled,
                pressed && (inputText.trim() || pendingFiles.length > 0) && !sending && { opacity: 0.8 },
              ]}
              onPress={handleSend}
              disabled={(!inputText.trim() && pendingFiles.length === 0) || sending}
            >
              {sending ? (
                <ActivityIndicator color="#fff" size={16} />
              ) : (
                <Feather name="send" size={18} color="#fff" />
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>

        {/* Fullscreen Image Preview Modal */}
        <Modal
          visible={!!previewImage}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewImage(null)}
        >
          <Pressable
            style={styles.previewOverlay}
            onPress={() => setPreviewImage(null)}
          >
            <View style={[styles.previewHeader, { paddingTop: Math.max(insets.top, 20) }]}>
              <Pressable
                style={styles.previewCloseBtn}
                onPress={() => setPreviewImage(null)}
              >
                <Feather name="x" size={24} color="#fff" />
              </Pressable>
            </View>
            {previewImage && (
              <Image
                source={{ uri: previewImage }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}
          </Pressable>
        </Modal>
      </View>
    );
  }

  /* ═══════════════════════════════════════════════════
     RENDER: Conversation List + Designers
     ═══════════════════════════════════════════════════ */

  type SectionItem =
    | { kind: 'conversation'; data: UnifiedConversation }
    | { kind: 'designer'; data: DesignerItem };

  const sections: { title: string; data: SectionItem[] }[] = [];

  if (filteredConvs.length > 0) {
    sections.push({
      title: '대화',
      data: filteredConvs.map((c) => ({ kind: 'conversation' as const, data: c })),
    });
  }

  if (filteredDesigners.length > 0) {
    sections.push({
      title: '설계사 목록',
      data: filteredDesigners.map((d) => ({ kind: 'designer' as const, data: d })),
    });
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={COLORS.gray[800]} />
          </Pressable>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>메신저</Text>
            {totalUnread > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {totalUnread > 99 ? '99+' : totalUnread}
                </Text>
              </View>
            )}
          </View>
          <Pressable style={styles.backBtn} onPress={handleLogout}>
            <Feather name="log-out" size={18} color={COLORS.gray[500]} />
          </Pressable>
        </View>

        {/* Search */}
        <View style={styles.searchRow}>
          <Feather name="search" size={16} color={COLORS.gray[400]} />
          <TextInput
            style={styles.searchInput}
            placeholder="이름 또는 메시지 검색"
            placeholderTextColor={COLORS.gray[400]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Feather name="x" size={16} color={COLORS.gray[400]} />
            </Pressable>
          )}
        </View>
      </View>

      {/* List */}
      {convLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Feather
              name={convError ? 'alert-circle' : 'message-circle'}
              size={44}
              color={convError ? COLORS.error : COLORS.gray[200]}
            />
          </View>
          <Text style={styles.emptyTitle}>
            {convError
              ? '연결 오류'
              : searchQuery
                ? '검색 결과가 없습니다'
                : '대화가 없습니다'}
          </Text>
          <Text style={styles.emptyDesc}>
            {convError
              ? convError
              : searchQuery
                ? '다른 검색어로 시도해보세요'
                : '설계 요청을 하면 매니저와\n대화를 시작할 수 있습니다'}
          </Text>
          {convError && (
            <Pressable
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
              onPress={() => { setConvLoading(true); loadConversations(); }}
            >
              <Feather name="refresh-cw" size={14} color={COLORS.primary} />
              <Text style={styles.retryBtnText}>다시 시도</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) =>
            item.kind === 'conversation' ? item.data.id : item.data.id
          }
          contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={convRefreshing}
              onRefresh={() => { setConvRefreshing(true); loadConversations(); }}
              tintColor={COLORS.primary}
            />
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
              <Text style={styles.sectionHeaderCount}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item, index }) => {
            if (item.kind === 'conversation') {
              const conv = item.data;
              return (
                <MotiView
                  from={{ opacity: 0, translateY: 6 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'timing', duration: 200, delay: Math.min(index * 25, 300) }}
                >
                  <Pressable
                    style={({ pressed }) => [
                      styles.convItem,
                      pressed && { backgroundColor: COLORS.gray[50] },
                    ]}
                    onPress={() => openConversation(conv)}
                  >
                    <View style={[styles.avatar, { backgroundColor: conv.avatarColor }]}>
                      <Text style={styles.avatarText}>{conv.initial}</Text>
                    </View>
                    <View style={styles.convContent}>
                      <View style={styles.convTopRow}>
                        <View style={styles.convNameRow}>
                          <Text style={styles.convName} numberOfLines={1}>
                            {conv.name}
                          </Text>
                          {conv.company && (
                            <Text style={styles.convCompany} numberOfLines={1}>
                              {conv.company}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.convTime}>{conv.lastTime}</Text>
                      </View>
                      <View style={styles.convBottomRow}>
                        <Text style={styles.convMsg} numberOfLines={1}>
                          {conv.lastMessage || '메시지 없음'}
                        </Text>
                        {conv.unreadCount > 0 && (
                          <View style={styles.convBadge}>
                            <Text style={styles.convBadgeText}>
                              {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </Pressable>
                </MotiView>
              );
            }

            // Designer item
            const designer = item.data;
            const isCreating = creatingDm === designer.id;
            return (
              <MotiView
                from={{ opacity: 0, translateY: 6 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: 200, delay: Math.min(index * 25, 300) }}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.convItem,
                    pressed && { backgroundColor: COLORS.gray[50] },
                  ]}
                  onPress={() => handleStartDm(designer)}
                  disabled={isCreating}
                >
                  <View style={[styles.avatar, { backgroundColor: designer.avatarColor }]}>
                    <Text style={styles.avatarText}>{designer.initial}</Text>
                  </View>
                  <View style={styles.convContent}>
                    <View style={styles.convTopRow}>
                      <View style={styles.convNameRow}>
                        <Text style={styles.convName} numberOfLines={1}>
                          {designer.name}
                        </Text>
                        {designer.company ? (
                          <Text style={styles.convCompany} numberOfLines={1}>
                            {designer.company}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.convBottomRow}>
                      {isCreating ? (
                        <ActivityIndicator size="small" color={COLORS.primary} />
                      ) : (
                        <View style={styles.startDmRow}>
                          <Feather name="message-circle" size={13} color={COLORS.primary} />
                          <Text style={styles.startDmText}>대화 시작하기</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
              </MotiView>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </View>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  /* Header */
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    ...SHADOWS.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: TYPOGRAPHY.fontSize.xl, fontWeight: '800', color: COLORS.gray[900] },
  headerTitleCenter: { fontSize: TYPOGRAPHY.fontSize.lg, fontWeight: '700', color: COLORS.gray[900] },
  unreadBadge: {
    backgroundColor: COLORS.primary, borderRadius: 10, minWidth: 20, height: 20,
    paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
  },
  unreadBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  /* Search */
  searchRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.gray[100],
    borderRadius: RADIUS.base, paddingHorizontal: SPACING.md, height: 38, gap: 8,
  },
  searchInput: { flex: 1, fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.gray[900], paddingVertical: 0 },

  /* Section headers */
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.base, paddingTop: SPACING.md, paddingBottom: SPACING.xs,
    backgroundColor: COLORS.gray[50],
  },
  sectionHeaderText: {
    fontSize: TYPOGRAPHY.fontSize.xs, fontWeight: '700', color: COLORS.text.muted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  sectionHeaderCount: {
    fontSize: TYPOGRAPHY.fontSize.xs, fontWeight: '600', color: COLORS.gray[400],
  },

  /* Conv list */
  convItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.base,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginRight: SPACING.md,
  },
  avatarText: { fontSize: TYPOGRAPHY.fontSize.lg, fontWeight: '700', color: '#fff' },
  convContent: { flex: 1 },
  convTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  convNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 8 },
  convName: { fontSize: TYPOGRAPHY.fontSize.md, fontWeight: '700', color: COLORS.gray[900], flexShrink: 1 },
  convCompany: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.text.muted, flexShrink: 1 },
  convTime: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.text.muted },
  convBottomRow: { flexDirection: 'row', alignItems: 'center' },
  convMsg: { flex: 1, fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.text.secondary, marginRight: 8 },
  convBadge: {
    backgroundColor: COLORS.primary, borderRadius: 10, minWidth: 20, height: 20,
    paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
  },
  convBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border.light, marginLeft: 48 + SPACING.md + SPACING.base },

  /* Start DM */
  startDmRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  startDmText: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.primary, fontWeight: '600' },

  /* Empty */
  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: SPACING.xl },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.gray[50],
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.base,
  },
  emptyTitle: { fontSize: TYPOGRAPHY.fontSize.lg, fontWeight: '700', color: COLORS.gray[700], marginBottom: 6 },
  emptyDesc: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.text.muted, textAlign: 'center', lineHeight: 20 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.md, paddingHorizontal: SPACING.base, paddingVertical: SPACING.sm, borderRadius: RADIUS.base, backgroundColor: COLORS.primaryPale },
  retryBtnText: { fontSize: TYPOGRAPHY.fontSize.sm, fontWeight: '600', color: COLORS.primary },

  /* ─── Login ─── */
  loginWrap: { paddingHorizontal: SPACING.xl, paddingTop: 40, alignItems: 'center' },
  loginIconWrap: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.primaryPale,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg,
  },
  loginTitle: { fontSize: TYPOGRAPHY.fontSize.xl, fontWeight: '800', color: COLORS.gray[900], marginBottom: 8 },
  loginDesc: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.text.muted, textAlign: 'center', lineHeight: 20, marginBottom: SPACING['2xl'] },
  inputGroup: { width: '100%', marginBottom: SPACING.base },
  inputLabel: { fontSize: TYPOGRAPHY.fontSize.sm, fontWeight: '600', color: COLORS.gray[700], marginBottom: 6 },
  input: {
    width: '100%', height: 48, backgroundColor: COLORS.gray[50], borderRadius: RADIUS.base,
    borderWidth: 1, borderColor: COLORS.border.light, paddingHorizontal: SPACING.base,
    fontSize: TYPOGRAPHY.fontSize.base, color: COLORS.gray[900],
  },
  errorWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACING.base, width: '100%' },
  errorText: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.error },
  loginBtn: { width: '100%', borderRadius: RADIUS.md, overflow: 'hidden', marginTop: SPACING.sm },
  loginBtnGradient: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  loginBtnText: { fontSize: TYPOGRAPHY.fontSize.md, fontWeight: '700', color: '#fff' },

  /* ─── Chat Detail ─── */
  chatHeader: {
    backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.sm, paddingBottom: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border.light, ...SHADOWS.sm,
  },
  chatHeaderCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  avatarSm: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarSmText: { fontSize: TYPOGRAPHY.fontSize.sm, fontWeight: '700', color: '#fff' },
  chatHeaderName: { fontSize: TYPOGRAPHY.fontSize.md, fontWeight: '700', color: COLORS.gray[900] },
  chatHeaderCompany: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.text.muted },

  msgListContent: { paddingHorizontal: SPACING.base, paddingTop: SPACING.sm, paddingBottom: SPACING.sm },

  dateSep: { flexDirection: 'row', alignItems: 'center', marginVertical: SPACING.md, gap: SPACING.sm },
  dateLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border.light },
  dateText: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.text.muted, paddingHorizontal: 4 },

  /* Own message (right) */
  ownRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end', marginBottom: SPACING.sm, gap: 6 },
  ownBubble: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg,
    borderBottomRightRadius: RADIUS.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2,
  },
  ownBubbleText: { fontSize: TYPOGRAPHY.fontSize.base, color: '#fff', lineHeight: 21 },

  /* Other message (left) */
  otherRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: SPACING.sm, gap: 6 },
  avatarXs: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarXsText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  otherBubbleWrap: { maxWidth: '75%' },
  otherSender: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.text.muted, marginBottom: 2, marginLeft: 4 },
  otherBubble: {
    backgroundColor: COLORS.gray[100], borderRadius: RADIUS.lg,
    borderBottomLeftRadius: RADIUS.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2,
  },
  otherBubbleText: { fontSize: TYPOGRAPHY.fontSize.base, color: COLORS.gray[900], lineHeight: 21 },
  msgTime: { fontSize: 10, color: COLORS.text.muted, marginBottom: 2 },

  emptyChatWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyChatText: { fontSize: TYPOGRAPHY.fontSize.base, fontWeight: '600', color: COLORS.gray[500] },
  emptyChatSub: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.text.muted },

  /* Attachment images in messages */
  attachImageGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4,
  },
  attachImage: {
    width: 160, height: 120, borderRadius: RADIUS.base, backgroundColor: COLORS.gray[100],
  },

  /* File card in messages */
  fileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.base, marginTop: 4, minWidth: 180,
  },
  fileCardOwn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  fileCardOther: {
    backgroundColor: COLORS.gray[50], borderWidth: 1, borderColor: COLORS.border.light,
  },
  fileCardInfo: { flex: 1 },
  fileCardName: {
    fontSize: TYPOGRAPHY.fontSize.sm, fontWeight: '600', color: COLORS.gray[800],
  },
  fileCardNameOwn: { color: '#fff' },
  fileCardSize: {
    fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.gray[400], marginTop: 1,
  },
  fileCardSizeOwn: { color: 'rgba(255,255,255,0.7)' },

  /* Pending files strip */
  pendingStrip: {
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: COLORS.border.light,
    paddingVertical: SPACING.sm,
  },
  pendingItem: {
    alignItems: 'center', width: 64,
  },
  pendingThumb: {
    width: 56, height: 56, borderRadius: RADIUS.base, backgroundColor: COLORS.gray[100],
  },
  pendingFileIcon: {
    width: 56, height: 56, borderRadius: RADIUS.base, backgroundColor: COLORS.gray[50],
    borderWidth: 1, borderColor: COLORS.border.light,
    alignItems: 'center', justifyContent: 'center',
  },
  pendingRemove: {
    position: 'absolute', top: -4, right: 0,
    width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.gray[600],
    alignItems: 'center', justifyContent: 'center',
  },
  pendingName: {
    fontSize: 10, color: COLORS.text.muted, marginTop: 2, textAlign: 'center',
  },

  /* Input bar */
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm, backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: COLORS.border.light, gap: 4,
  },
  attachBtn: {
    width: 36, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  chatInput: {
    flex: 1, minHeight: 40, maxHeight: 100, backgroundColor: COLORS.gray[50],
    borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border.light,
    paddingHorizontal: SPACING.base, paddingVertical: 10,
    fontSize: TYPOGRAPHY.fontSize.base, color: COLORS.gray[900],
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.gray[300] },

  /* Fullscreen Image Preview */
  previewOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingHorizontal: SPACING.base, paddingBottom: SPACING.sm,
    zIndex: 10,
  },
  previewCloseBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewImage: {
    width: '100%', height: '80%',
  },
});
