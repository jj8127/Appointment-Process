import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const SOFT_BG = '#F9FAFB';
const BORDER = '#E5E7EB';

type Message = {
  id: string;
  content: string;
  sender_id: string;
  receiver_id: string;
  created_at: string;
  is_read: boolean;
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
  const flatListRef = useRef<FlatList>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!myId || !otherId) return;

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`,
        )
        .order('created_at', { ascending: false });
      if (error) return;
      setMessages(data ?? []);

      await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('sender_id', otherId)
        .eq('receiver_id', myId)
        .eq('is_read', false);
    };

    fetchMessages();

    const channel = supabase
      .channel(`chat-${myId}-${otherId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as Message;
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
  }, [myId, otherId]);

  // 키보드 높이 감지 (Android/iOS)
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const sendMessage = async () => {
    if (!text.trim() || !myId || !otherId) return;
    const content = text.trim();
    setText('');

    const { error } = await supabase.from('messages').insert({
      sender_id: myId,
      receiver_id: otherId,
      content,
    });

    if (error) {
      console.warn('sendMessage error', error.message);
      return;
    }

    // 수신자에게 알림 기록 추가 (푸시 트리거용)
    const isReceiverAdmin = otherId === 'admin';
    const recipientRole = isReceiverAdmin ? 'admin' : 'fc';
    const residentIdForPush = isReceiverAdmin ? null : otherId;

    supabase
      .from('notifications')
      .insert({
        title: '새 메시지',
        body: content,
        category: 'message',
        recipient_role: recipientRole,
        resident_id: residentIdForPush,
      })
      .then(async ({ error: notifyError }) => {
        if (notifyError) {
          console.warn('notify send error', notifyError.message);
          return;
        }
        // 푸시 알림 트리거 (edge function 활용)
        try {
          await supabase.functions.invoke('fc-notify', {
            body: {
              type: 'message',
              target_role: recipientRole,
              target_id: residentIdForPush,
              message: content,
            },
          });
        } catch (fnErr: any) {
          console.warn('push send error', fnErr?.message ?? fnErr);
        }
      })
      .catch((err) => console.warn('notify send error', err?.message ?? err));
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
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
        <View style={{ gap: 4, maxWidth: '70%' }}>
          {!isMe && <Text style={styles.senderName}>{headerTitle}</Text>}
          <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowOther]}>
            {isMe && <Text style={styles.timeText}>{formatTime(item.created_at)}</Text>}
            <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
              <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextOther]}>{item.content}</Text>
            </View>
            {!isMe && <Text style={styles.timeText}>{formatTime(item.created_at)}</Text>}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
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
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          inverted
          contentContainerStyle={styles.listContent}
          style={styles.list}
        />

        <View
          style={[
            styles.inputWrapper,
            {
              paddingBottom: keyboardHeight > 0 ? keyboardHeight+30 : Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="메시지를 입력하세요"
              placeholderTextColor={MUTED}
              multiline
            />
            <Pressable
              onPress={sendMessage}
              style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
              disabled={!text.trim()}
            >
              <Feather name="arrow-up" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SOFT_BG,
  },
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
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: CHARCOAL,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    gap: 16,
  },
  msgRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  msgRowMe: {
    justifyContent: 'flex-end',
  },
  msgRowOther: {
    justifyContent: 'flex-start',
  },
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
  senderName: {
    fontSize: 12,
    color: MUTED,
    marginLeft: 2,
    marginBottom: 2,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  bubbleRowMe: {},
  bubbleRowOther: {},
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleMe: {
    backgroundColor: HANWHA_ORANGE,
    borderTopRightRadius: 2,
  },
  bubbleOther: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 2,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  msgText: {
    fontSize: 15,
    lineHeight: 22,
  },
  msgTextMe: {
    color: '#ffffff',
    fontWeight: '500',
  },
  msgTextOther: {
    color: CHARCOAL,
  },
  timeText: {
    fontSize: 11,
    color: '#9CA3AF',
    marginBottom: 2,
  },
  inputWrapper: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: CHARCOAL,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: HANWHA_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#E5E7EB',
  },
});
