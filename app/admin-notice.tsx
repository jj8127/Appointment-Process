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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const ORANGE = '#f36f21';
const BORDER = '#e5e7eb';
const TEXT_MUTED = '#6b7280';
const CHARCOAL = '#111827';

export default function AdminNoticeScreen() {
  const { role } = useSession();
  const keyboardPadding = useKeyboardPadding();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('공지사항');
  const [loading, setLoading] = useState(false);

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
      Alert.alert('등록 완료', '공지사항이 등록되었습니다.');
      setTitle('');
      setBody('');
    } catch (err: any) {
      Alert.alert('등록 실패', err?.message ?? '등록 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 140 }]}
          keyboardShouldPersistTaps="handled">
          <RefreshButton />
          <Text style={styles.title}>공지 등록</Text>
          <Text style={styles.caption}>총무/관리자가 알림으로 배포할 공지를 작성하세요.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>카테고리</Text>
            <TextInput
              placeholder="예: 공지사항, 리포트"
              style={styles.input}
              value={category}
              onChangeText={setCategory}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>제목</Text>
            <TextInput
              placeholder="제목을 입력하세요"
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>내용</Text>
            <TextInput
              placeholder="내용을 입력하세요"
              style={[styles.input, { height: 160, textAlignVertical: 'top' }]}
              value={body}
              onChangeText={setBody}
              multiline
            />
          </View>

          <Pressable style={styles.button} disabled={loading} onPress={submit}>
            <Text style={styles.buttonText}>{loading ? '등록 중...' : '공지 등록하기'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff7f0' },
  container: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  caption: { color: TEXT_MUTED },
  field: { gap: 6 },
  label: { fontWeight: '700', color: CHARCOAL },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
  },
  button: {
    marginTop: 8,
    backgroundColor: ORANGE,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '800' },
});
