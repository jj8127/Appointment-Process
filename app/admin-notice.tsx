import * as Crypto from 'expo-crypto';
import { invokeAdminAction } from '@/lib/admin-action-api';
import { useDraftExitGuard } from '@/hooks/use-draft-exit-guard';
import { useReadSessionScope } from '@/hooks/use-read-session-scope';
import { useReadAttempt } from '@/lib/use-read-attempt';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import {
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

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { invokeFcNotifyForDelivery } from '@/lib/fc-notify-client';
import { presentPostCommitNotificationDelivery } from '@/lib/fc-notify-post-commit';
import { logger } from '@/lib/logger';
import { isNotificationUuid } from '@/lib/notification-target';
import { supabase } from '@/lib/supabase';

const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const INPUT_BG = '#F9FAFB';

type AttachedFile = {
  uri: string;
  name: string;
  type: string;
  size?: number;
};

export default function AdminNoticeScreen() {
  const scope = useReadSessionScope();
  return <AdminNoticeComposer key={scope} />;
}

function AdminNoticeComposer() {
  const { role, readOnly, residentId } = useSession();
  const keyboardPadding = useKeyboardPadding();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bodyHeight, setBodyHeight] = useState(120);
  const [category, setCategory] = useState('공지사항');
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<AttachedFile[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const pickingRef = useRef(false);
  const submitRef = useRef(false);
  const beginSubmit = useReadAttempt();
  const createIntent = useRef<{ requestId: string; notice: Record<string, unknown> } | null>(null);
  useDraftExitGuard(!!(title.trim() || body.trim() || images.length || files.length), loading);

  const pickImage = async () => {
    if (loading || createIntent.current) return;
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
    } catch {
      Alert.alert('오류', '이미지를 불러오는데 실패했습니다.');
    }
  };

  const pickFile = async () => {
    if (pickingRef.current || loading || createIntent.current) return;
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
    } catch {
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

      const { error } = await supabase.storage
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
      logger.error('Upload failed', { error: err });
      throw new Error(`${file.name} 업로드 실패: ${err.message}`);
    }
  };

  // 공지 등록 후 모든 FC에게 알림 + 푸시 전송
  const notifyAllFcs = async (
    noticeId: string,
    titleText: string,
    bodyText: string,
    categoryText?: string,
  ) => {
    return invokeFcNotifyForDelivery({
      type: 'notify',
      target_role: 'fc',
      target_id: null,
      title: `공지: ${titleText}`,
      body: bodyText,
      category: categoryText || '공지',
      url: `/notice-detail?id=${noticeId}`,
      target: {
        version: 1,
        kind: 'notice',
        noticeId,
      },
    });
  };

  const submit = async () => {
    if (submitRef.current) return;
    if (role !== 'admin') {
      Alert.alert('접근 불가', '관리자만 등록할 수 있습니다.');
      return;
    }
    if (readOnly) {
      Alert.alert('조회 전용', '본부장은 공지를 등록할 수 없습니다.');
      return;
    }
    if (!title.trim() || !body.trim()) {
      Alert.alert('입력 필요', '제목과 내용을 모두 입력해주세요.');
      return;
    }
    submitRef.current = true;
    const isCurrentSubmit = beginSubmit();
    if (!isCurrentSubmit()) return;
    setLoading(true);
    try {
      // Upload once for a creation intent. Retry only its stable payload/key.
      const uploadedImages = createIntent.current ? [] : await Promise.all(
        images.map((img) => uploadToSupabase(img, 'images'))
      );
      if (!isCurrentSubmit()) return;

      // 2. Upload Files
      const uploadedFiles = createIntent.current ? [] : await Promise.all(
        files.map((file) => uploadToSupabase(file, 'files'))
      );
      if (!isCurrentSubmit()) return;

      const imageUrls = uploadedImages.map((img) => img.url); // Store array of strings for simplicity if schema is text[] or jsonb specific
      // Or if schema is jsonb array of objects, verify implementation_plan.
      // Plan said: images (JSONB array of strings), files (JSONB array of objects)

      createIntent.current ??= { requestId: Crypto.randomUUID(), notice: {
        title: title.trim(), body: body.trim(), category: category.trim() || '공지사항', images: imageUrls, files: uploadedFiles,
      } };
      const result = await invokeAdminAction<{ notice: { id: string } }>(residentId ?? '', 'createNotice', createIntent.current);
      if (!isCurrentSubmit()) return;
      const insertedNotice = result.notice;

      const noticeId = String(insertedNotice?.id ?? '').trim();
      const notifyCreatedNotice = isNotificationUuid(noticeId)
        ? () => notifyAllFcs(
            noticeId,
            title.trim(),
            body.trim(),
            category.trim(),
          )
        : null;
      const notificationDelivery = notifyCreatedNotice
        ? await notifyCreatedNotice()
        : {
            confirmed: false as const,
            notificationStored: false as const,
            reason: 'invalid_recipient' as const,
          };
      if (!isCurrentSubmit()) return;
      createIntent.current = null;
      setTitle('');
      setBody('');
      setCategory('공지사항');
      setImages([]);
      setFiles([]);
      presentPostCommitNotificationDelivery({
        canAct: isCurrentSubmit,
        delivery: notificationDelivery,
        retryNotification: notifyCreatedNotice ?? (async () => notificationDelivery),
        successTitle: '등록 완료',
        successMessage: '공지사항이 성공적으로 등록되었습니다.',
        notificationLabel: 'FC 공지',
      });
    } catch {
      if (!isCurrentSubmit()) return;
      Alert.alert('등록 확인 필요', createIntent.current ? '서버 저장 결과를 확인하지 못했습니다. 등록 버튼을 다시 누르면 같은 공지만 확인·재시도합니다.' : '공지 등록을 완료하지 못했습니다. 작성 내용은 유지됩니다.');
    } finally {
      if (isCurrentSubmit()) { submitRef.current = false; setLoading(false); }
    }
  };

  const removeImage = (index: number) => {
    if (loading || createIntent.current) return;
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeFile = (index: number) => {
    if (loading || createIntent.current) return;
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAwareWrapper
        contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 40 }]}
        keyboardDismissMode="none"
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>공지사항 등록</Text>
            <Text style={styles.subtitle}>앱 사용자 전체에게 발송될 공지 내용을 입력해주세요.</Text>
          </View>
          <RefreshButton />
        </View>

        <View style={styles.form}>
          <FormInput
            label="카테고리"
            placeholder="예: 공지사항, 긴급, 이벤트"
            value={category}
            editable={!loading && !createIntent.current}
              onChangeText={setCategory}
          />

          <FormInput
            label="제목"
            placeholder="제목을 입력하세요"
            value={title}
            editable={!loading && !createIntent.current}
              onChangeText={setTitle}
          />

          <View style={styles.field}>
            <Text style={styles.label}>내용</Text>
            <TextInput
              style={[styles.input, styles.textArea, { height: bodyHeight }]}
              placeholder="내용을 상세히 입력하세요"
              placeholderTextColor="#9CA3AF"
              value={body}
              editable={!loading && !createIntent.current}
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
              <Button
                onPress={pickImage}
                disabled={readOnly}
                variant="outline"
                size="md"
                leftIcon={<Feather name="image" size={20} color={CHARCOAL} />}
                style={{ flex: 1, backgroundColor: '#F3F4F6' }}
              >
                사진 추가
              </Button>
              <Button
                onPress={pickFile}
                disabled={readOnly}
                variant="outline"
                size="md"
                leftIcon={<Feather name="paperclip" size={20} color={CHARCOAL} />}
                style={{ flex: 1, backgroundColor: '#F3F4F6' }}
              >
                파일 추가
              </Button>
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

        <Button
          onPress={submit}
          disabled={loading || readOnly}
          loading={loading}
          variant="primary"
          size="lg"
          fullWidth
          rightIcon={!loading ? <Feather name="send" size={18} color="#fff" /> : undefined}
          style={{ marginTop: 32 }}
        >
          등록하기
        </Button>
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
});
