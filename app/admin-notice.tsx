import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const INPUT_BG = '#F9FAFB';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type AttachedFile = {
  uri: string;
  name: string;
  type: string;
  size?: number;
};

export default function AdminNoticeScreen() {
  const { role } = useSession();
  const keyboardPadding = useKeyboardPadding();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bodyHeight, setBodyHeight] = useState(120);
  const [category, setCategory] = useState('공지사항');
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<AttachedFile[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const pickingRef = useRef(false);

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (!result.canceled) {
        setImages((prev) => [
          ...prev,
          ...result.assets.map((asset) => ({
            uri: asset.uri,
            name: asset.fileName ?? `image_${Date.now()}.jpg`,
            type: 'image/jpeg', // Default or extract from uri
          })),
        ]);
      }
    } catch (e) {
      Alert.alert('오류', '이미지를 불러오는데 실패했습니다.');
    }
  };

  const pickFile = async () => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (!result.canceled) {
        setFiles((prev) => [
          ...prev,
          ...result.assets.map((asset) => ({
            uri: asset.uri,
            name: asset.name,
            type: asset.mimeType ?? 'application/octet-stream',
            size: asset.size,
          })),
        ]);
      }
    } catch (e) {
      Alert.alert('오류', '파일을 불러오는데 실패했습니다.');
    } finally {
      pickingRef.current = false;
    }
  };

  const uploadToSupabase = async (file: AttachedFile, folder: 'images' | 'files') => {
    try {
      const ext = file.name.split('.').pop();
      const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      let fileBody: any;

      if (Platform.OS === 'web') {
        const response = await fetch(file.uri);
        fileBody = await response.blob();
      } else {
        // Native: fetch also works for local file URIs in React Native
        // Use arrayBuffer() instead of blob() for better compatibility with Supabase/RN networking
        const response = await fetch(file.uri);
        fileBody = await response.arrayBuffer();
      }

      const { data, error } = await supabase.storage
        .from('notice-attachments')
        .upload(fileName, fileBody, {
          contentType: file.type,
          upsert: false,
        });

      if (error) throw error;

      const { data: publicUrlData } = supabase.storage
        .from('notice-attachments')
        .getPublicUrl(fileName);

      return {
        name: file.name,
        url: publicUrlData.publicUrl,
        type: file.type,
      };
    } catch (err: any) {
      console.error('Upload failed', err);
      throw new Error(`${file.name} 업로드 실패: ${err.message}`);
    }
  };

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
            sound: 'default',
            priority: 'high',
            channelId: 'alerts',
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
      // 1. Upload Images
      const uploadedImages = await Promise.all(
        images.map((img) => uploadToSupabase(img, 'images'))
      );

      // 2. Upload Files
      const uploadedFiles = await Promise.all(
        files.map((file) => uploadToSupabase(file, 'files'))
      );

      const imageUrls = uploadedImages.map((img) => img.url); // Store array of strings for simplicity if schema is text[] or jsonb specific
      // Or if schema is jsonb array of objects, verify implementation_plan.
      // Plan said: images (JSONB array of strings), files (JSONB array of objects)

      const { error } = await supabase.from('notices').insert({
        title: title.trim(),
        body: body.trim(),
        category: category.trim() || '공지사항',
        images: imageUrls,
        files: uploadedFiles,
      });
      if (error) throw error;

      await notifyAllFcs(title.trim(), body.trim(), category.trim());
      Alert.alert('등록 완료', '공지사항이 성공적으로 등록되었습니다.');
      setTitle('');
      setBody('');
      setCategory('공지사항');
      setImages([]);
      setFiles([]);
    } catch (err: any) {
      Alert.alert('등록 실패', err?.message ?? '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
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
              style={[styles.input, styles.textArea, { height: bodyHeight }]}
              placeholder="내용을 상세히 입력하세요"
              placeholderTextColor="#9CA3AF"
              value={body}
              onChangeText={setBody}
              multiline
              textAlignVertical="top"
              scrollEnabled={false}
              onContentSizeChange={(e) => {
                const nextHeight = Math.max(120, e.nativeEvent.contentSize.height);
                if (nextHeight !== bodyHeight) setBodyHeight(nextHeight);
              }}
            />
          </View>

          {/* Attachments Section */}
          <View style={styles.field}>
            <Text style={styles.label}>첨부파일</Text>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <Pressable style={styles.attachButton} onPress={pickImage}>
                <Feather name="image" size={20} color={CHARCOAL} />
                <Text style={styles.attachButtonText}>사진 추가</Text>
              </Pressable>
              <Pressable style={styles.attachButton} onPress={pickFile}>
                <Feather name="paperclip" size={20} color={CHARCOAL} />
                <Text style={styles.attachButtonText}>파일 추가</Text>
              </Pressable>
            </View>

            {/* Image Previews */}
            {images.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {images.map((img, idx) => (
                  <View key={idx} style={styles.imagePreview}>
                    <Image source={{ uri: img.uri }} style={styles.previewThumb} />
                    <Pressable style={styles.removeBtn} onPress={() => removeImage(idx)}>
                      <Feather name="x" size={12} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}

            {/* File Previews */}
            {files.map((f, idx) => (
              <View key={idx} style={styles.fileRow}>
                <Feather name="file-text" size={16} color={MUTED} />
                <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                <Pressable onPress={() => removeFile(idx)} style={{ padding: 4 }}>
                  <Feather name="x" size={16} color={MUTED} />
                </Pressable>
              </View>
            ))}
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
  textArea: { minHeight: 150 },

  attachButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  attachButtonText: { fontSize: 14, fontWeight: '600', color: CHARCOAL },

  imagePreview: {
    width: 80,
    height: 80,
    borderRadius: 8,
    marginRight: 8,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: BORDER,
  },
  previewThumb: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 6,
  },
  fileName: {
    flex: 1,
    fontSize: 14,
    color: CHARCOAL,
  },

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
