import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';

const ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const INPUT_BG = '#F9FAFB';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export default function AdminNoticeScreen() {
  const { role } = useSession();
  const keyboardPadding = useKeyboardPadding();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('공지사항');
  const [loading, setLoading] = useState(false);

  // 공지 등록 후 모든 FC에게 알림 + 푸시 전송
  const notifyAllFcs = async (titleText: string, bodyText: string, categoryText?: string) => {
    try {
      // notifications 테이블에 기록
      await supabase.from('notifications').insert({
        title: titleText,
        body: bodyText,
        category: categoryText || '공지',
        recipient_role: 'fc',
        resident_id: null,
      });

      // 모든 FC 토큰 조회
      const { data: tokens } = await supabase
        .from('device_tokens')
        .select('expo_push_token')
        .eq('role', 'fc');

      const payload =
        tokens?.map((t: any) => ({
          to: t.expo_push_token,
          title: `공지: ${titleText}`,
          body: bodyText,
          data: { type: 'notice' },
        })) ?? [];

      if (payload.length > 0) {
        await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
    } catch (pushErr) {
      console.warn('notifyAllFcs push error', pushErr);
    }
  };

  const submit = async () => {
    if (role !== 'admin') {
      Alert.alert('접근 불가', '관리자만 등록할 수 있습니다.');
      return;
    }
    if (!title.trim() || !body.trim()) {
      Alert.alert('입력 필요', '제목과 내용을 모두 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from('notices').insert({
        title: title.trim(),
        body: body.trim(),
        category: category.trim() || '공지사항',
      });
      if (error) throw error;
      await notifyAllFcs(title.trim(), body.trim(), category.trim());
      Alert.alert('등록 완료', '공지사항이 성공적으로 등록되었습니다.');
      setTitle('');
      setBody('');
    } catch (err: any) {
      Alert.alert('등록 실패', err?.message ?? '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAwareWrapper contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 40 }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>공지사항 등록</Text>
            <Text style={styles.subtitle}>앱 사용자 전체에게 발송될 공지 내용을 입력해주세요.</Text>
          </View>
          <RefreshButton />
        </View>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>카테고리</Text>
            <TextInput
              style={styles.input}
              placeholder="예: 공지사항, 긴급, 이벤트"
              placeholderTextColor="#9CA3AF"
              value={category}
              onChangeText={setCategory}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>제목</Text>
            <TextInput
              style={styles.input}
              placeholder="제목을 입력하세요"
              placeholderTextColor="#9CA3AF"
              value={title}
              onChangeText={setTitle}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>내용</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="내용을 상세히 입력하세요"
              placeholderTextColor="#9CA3AF"
              value={body}
              onChangeText={setBody}
              multiline
              textAlignVertical="top"
            />
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.submitButton,
            pressed && styles.buttonPressed,
            loading && styles.buttonDisabled,
          ]}
          onPress={submit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.submitButtonText}>등록하기</Text>
              <Feather name="send" size={18} color="#fff" />
            </>
          )}
        </Pressable>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 24 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 24, fontWeight: '800', color: CHARCOAL },
  subtitle: { fontSize: 14, color: MUTED, marginTop: 4 },

  form: { gap: 20, marginTop: 16 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: CHARCOAL },
  input: {
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: CHARCOAL,
  },
  textArea: { minHeight: 200 },

  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ORANGE,
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 32,
    shadowColor: ORANGE,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  buttonPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  buttonDisabled: { backgroundColor: '#fed7aa', shadowOpacity: 0 },
  submitButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
