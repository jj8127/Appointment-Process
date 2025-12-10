import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const SOFT_BG = '#F9FAFB';
const BORDER = '#E5E7EB';
const SCREEN_WIDTH = Dimensions.get('window').width;

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

export default function ChatScreen() {
  const router = useRouter();
  const { role, residentId } = useSession();
  const { targetId, targetName } = useLocalSearchParams<{ targetId?: string; targetName?: string }>();
  const insets = useSafeAreaInsets();

  const myId = role === 'admin' ? 'admin' : residentId ?? '';
  const otherId = role === 'admin' ? targetId ?? '' : 'admin';
  const headerTitle = role === 'admin' ? targetName ?? 'FC' : '총무팀';

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const isUploadCancelled = useRef(false);
  const flatListRef = useRef<FlatList>(null);
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const fetchMessages = useCallback(async () => {
    if (!myId || !otherId) return;
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`)
      .order('created_at', { ascending: false });
    if (error) {
      console.log('[messages] fetch error', error.message);
      return;
    }
    const filtered = (data ?? []).filter((m) => !deletedIdsRef.current.has(m.id));
    setMessages(filtered);

    await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('sender_id', otherId)
      .eq('receiver_id', myId)
      .eq('is_read', false);
  }, [myId, otherId]);

  useEffect(() => {
    if (!myId || !otherId) return;

    fetchMessages();

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
              setMessages((prev) => prev.filter((m) => m.id !== deletedId));
              return;
            }
            // old 정보가 없으면 전체 재조회
            fetchMessages();
            return;
          }
          const newMsg = payload.new as Message;
          if (deletedIdsRef.current.has(newMsg.id)) return;
          const related =
            (newMsg.sender_id === myId && newMsg.receiver_id === otherId) ||
            (newMsg.sender_id === otherId && newMsg.receiver_id === myId);
          if (!related) return;

          if (payload.eventType === 'INSERT') {
            setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [newMsg, ...prev]));
            if (newMsg.sender_id === otherId) {
              supabase.from('messages').update({ is_read: true }).eq('id', newMsg.id);
            }
          } else if (payload.eventType === 'UPDATE') {
            setMessages((prev) => prev.map((m) => (m.id === newMsg.id ? newMsg : m)));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMessages, myId, otherId]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // 세션 user id 확인 로그
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.log('[session] error', error.message);
        return;
      }
      console.log('[session] userId', data?.session?.user?.id);
    })();
  }, []);

  const sendPayload = async (
    content: string,
    type: 'text' | 'image' | 'file' = 'text',
    fileData?: { url: string; name: string; size?: number },
  ) => {
    if (!myId || !otherId) return;
    if (isUploadCancelled.current) return;

    const { error } = await supabase.from('messages').insert({
      sender_id: myId,
      receiver_id: otherId,
      content,
      message_type: type,
      file_url: fileData?.url ?? null,
      file_name: fileData?.name ?? null,
      file_size: fileData?.size ?? null,
    });

    if (error) {
      console.warn('sendMessage error', error.message);
      Alert.alert('전송 실패', '메시지를 보내지 못했습니다.');
      return;
    }

    const isReceiverAdmin = otherId === 'admin';
    const recipientRole = isReceiverAdmin ? 'admin' : 'fc';
    const residentIdForPush = isReceiverAdmin ? null : otherId;
    const notiBody = type === 'text' ? content : type === 'image' ? '사진을 보냈습니다.' : '파일을 보냈습니다.';

    supabase
      .from('notifications')
      .insert({
        title: '새 메시지',
        body: notiBody,
        category: 'message',
        recipient_role: recipientRole,
        resident_id: residentIdForPush,
      })
      .then(async () => {
        try {
          await supabase.functions.invoke('fc-notify', {
            body: {
              type: 'message',
              target_role: recipientRole,
              target_id: residentIdForPush,
              message: notiBody,
              sender_id: myId,
            },
          });
        } catch (e) {
          console.warn(e);
        }
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

      const formData = new FormData();
      formData.append('file', {
        uri,
        name: fileName,
        type: fileType,
      } as any);

      const { data, error } = await supabase.storage.from('chat-uploads').upload(fileName, formData, {
        contentType: fileType,
      });
      if (isUploadCancelled.current) return null;
      if (error) throw error;

      const { data: urlData } = supabase.storage.from('chat-uploads').getPublicUrl(fileName);
      return urlData.publicUrl;
    } catch (e) {
      if (isUploadCancelled.current) return null;
      console.error(e);
      Alert.alert('업로드 실패', '파일 업로드 중 오류가 발생했습니다.');
      return null;
    } finally {
      if (!isUploadCancelled.current) setUploading(false);
    }
  };

  const pickImage = async () => {
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
      console.log(e);
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
            console.log('[delete] request', {
              authUserId: authRes?.user?.id,
              myId,
              msgId: message.id,
              senderId: message.sender_id,
            });
            const { error } = await supabase.from('messages').delete().eq('id', message.id);
            if (error) {
              console.log('[delete] supabase error', error);
              Alert.alert('삭제 실패', error.message ?? '메시지를 삭제하지 못했습니다.');
            } else {
              console.log('[delete] success', message.id);
              deletedIdsRef.current.add(message.id);
              setMessages((prev) => prev.filter((m) => m.id !== message.id));
            }
          } catch (err: any) {
            console.log('[delete] exception', err?.message ?? err);
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

  const renderMessageContent = (item: Message, isMe: boolean) => {
    if (item.message_type === 'image' && item.file_url) {
      return (
        <TouchableOpacity onPress={() => Linking.openURL(item.file_url!)} style={{ minWidth: 150, minHeight: 150 }}>
          <Image source={{ uri: item.file_url }} style={{ width: 200, height: 200, borderRadius: 8 }} contentFit="cover" />
        </TouchableOpacity>
      );
    }

    if (item.message_type === 'file' && item.file_url) {
      return (
        <TouchableOpacity style={styles.fileContainer} onPress={() => Linking.openURL(item.file_url!)}>
          <View style={styles.fileIconBox}>
            <Ionicons name="document-text" size={24} color={HANWHA_ORANGE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextOther]} numberOfLines={1}>
              {item.file_name || '파일'}
            </Text>
            <Text style={{ fontSize: 11, color: isMe ? '#eee' : '#999' }}>탭하여 다운로드</Text>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <Text
        style={[
          styles.msgText,
          isMe ? styles.msgTextMe : styles.msgTextOther,
          { textAlign: isMe ? 'right' : 'left', width: '100%' },
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

  return (
    <View style={styles.container}>
      <StatusBar style="dark" backgroundColor="#fff" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Feather name="chevron-left" size={28} color={CHARCOAL} />
        </Pressable>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          inverted
          contentContainerStyle={styles.listContent}
          style={styles.list}
        />

        {uploading && (
          <View style={styles.uploadingOverlay}>
            <ActivityIndicator size="small" color={HANWHA_ORANGE} />
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
              paddingBottom: keyboardHeight > 0 ? keyboardHeight + 65 : Math.max(insets.bottom, 12),
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
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: CHARCOAL },
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
  bubbleWrapper: { maxWidth: SCREEN_WIDTH * 0.82, width: 'auto' },
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
  fileContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fileIconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
});
