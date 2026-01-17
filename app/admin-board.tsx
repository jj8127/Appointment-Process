import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
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
import {
  buildBoardActor,
  createBoardPost,
  fetchBoardDetail,
  fetchBoardCategories,
  finalizeBoardAttachments,
  formatFileSize,
  deleteBoardAttachments,
  logBoardError,
  signBoardAttachments,
  updateBoardPost,
} from '@/lib/board-api';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const INPUT_BG = '#F9FAFB';
const MAX_ATTACHMENTS = 5;

type LocalAttachment = {
  id: string;
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileType: 'image' | 'file';
};

export default function AdminBoardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ postId?: string }>();
  const postId = typeof params.postId === 'string' ? params.postId : null;
  const { role, displayName, residentId, readOnly } = useSession();
  const queryClient = useQueryClient();
  const keyboardPadding = useKeyboardPadding();

  const actor = useMemo(
    () => buildBoardActor({ role, residentId, displayName, readOnly }),
    [displayName, readOnly, residentId, role],
  );
  const canWrite = actor?.role === 'admin' || actor?.role === 'manager';
  const isEditMode = !!postId;
  const screenTitle = isEditMode ? '게시글 수정' : '게시글 작성';
  const screenSubtitle = isEditMode ? '게시글 내용을 수정합니다.' : '정보 게시판에 새 글을 작성합니다.';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contentHeight, setContentHeight] = useState(200);
  const [loading, setLoading] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<LocalAttachment[]>([]);
  const [didLoadPost, setDidLoadPost] = useState(false);
  const pickingRef = useRef(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['board-categories', actor?.role, actor?.residentId],
    queryFn: () => {
      if (!actor) return Promise.resolve([]);
      return fetchBoardCategories(actor);
    },
    enabled: !!actor,
  });

  const { data: detailData } = useQuery({
    queryKey: ['board-detail', postId],
    queryFn: () => {
      if (!actor || !postId) return Promise.resolve(null);
      return fetchBoardDetail(actor, postId);
    },
    enabled: !!actor && !!postId,
  });

  useEffect(() => {
    if (!isEditMode && !categoryId && categories.length > 0) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId, isEditMode]);

  useEffect(() => {
    if (!detailData?.post || didLoadPost) return;
    if (actor?.role === 'manager' && !detailData.post.isMine) {
      Alert.alert('권한 없음', '본인 게시글만 수정할 수 있습니다.', [
        { text: '확인', onPress: () => router.back() },
      ]);
      setDidLoadPost(true);
      return;
    }
    setTitle(detailData.post.title);
    setContent(detailData.post.content);
    setCategoryId(detailData.post.categoryId);
    setExistingAttachments(detailData.attachments.map((file) => ({
      id: file.id,
      uri: file.signedUrl ?? '',
      fileName: file.fileName,
      mimeType: file.mimeType ?? 'application/octet-stream',
      fileSize: file.fileSize,
      fileType: file.fileType,
    })));
    setDidLoadPost(true);
  }, [actor?.role, detailData, didLoadPost, router]);

  const handleSubmit = async () => {
    if (!canWrite) {
      Alert.alert('접근 불가', '관리자만 게시글을 작성할 수 있습니다.');
      return;
    }
    if (!title.trim() || !content.trim()) {
      Alert.alert('입력 필요', '제목과 내용을 모두 입력해주세요.');
      return;
    }
    if (!categoryId) {
      Alert.alert('입력 필요', '카테고리를 선택해주세요.');
      return;
    }

    setLoading(true);
    try {
      if (!actor) throw new Error('로그인이 필요합니다.');
      const targetPostId = postId
        ?? (await createBoardPost(actor, {
          categoryId,
          title: title.trim(),
          content: content.trim(),
        })).id;

      if (isEditMode) {
        await updateBoardPost(actor, {
          postId: targetPostId,
          categoryId,
          title: title.trim(),
          content: content.trim(),
        });
      }
      if (attachments.length > 0) {
        const signPayload = attachments.map((file) => ({
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          fileType: file.fileType,
        }));
        const signed = await signBoardAttachments(actor, targetPostId, signPayload);

        for (let i = 0; i < signed.length; i += 1) {
          const target = attachments[i];
          const upload = signed[i];
          const response = await fetch(target.uri);
          const body = Platform.OS === 'web' ? await response.blob() : await response.arrayBuffer();
          const uploadRes = await fetch(upload.signedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': target.mimeType },
            body,
          });
          if (!uploadRes.ok) {
            throw new Error(`${target.fileName} 업로드에 실패했습니다.`);
          }
        }

        await finalizeBoardAttachments(
          actor,
          targetPostId,
          attachments.map((file, index) => ({
            storagePath: signed[index].storagePath,
            fileName: file.fileName,
            fileSize: file.fileSize,
            mimeType: file.mimeType,
            fileType: file.fileType,
          })),
        );
      }
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
      if (targetPostId) {
        queryClient.invalidateQueries({ queryKey: ['board-detail', targetPostId] });
      }

      Alert.alert(isEditMode ? '게시글 수정 완료' : '게시글 작성 완료', isEditMode ? '게시글이 수정되었습니다.' : '게시글이 성공적으로 작성되었습니다.', [
        {
          text: '확인',
          onPress: () => {
            setTitle('');
            setContent('');
            setAttachments([]);
            router.back();
          },
        },
      ]);
    } catch (err: any) {
      logBoardError('post-create', err);
      Alert.alert('작성 실패', err?.message ?? '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const addAttachments = (nextFiles: LocalAttachment[]) => {
    setAttachments((prev) => {
      const merged = [...prev, ...nextFiles];
      if (merged.length > MAX_ATTACHMENTS) {
        Alert.alert('첨부 제한', `최대 ${MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`);
        return merged.slice(0, MAX_ATTACHMENTS);
      }
      return merged;
    });
  };

  const pickImages = async () => {
    if (pickingRef.current || !canWrite) return;
    pickingRef.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
      });
      if (!result.canceled) {
        const items = result.assets.map((asset) => ({
          id: `${asset.assetId ?? asset.uri}-${Date.now()}`,
          uri: asset.uri,
          fileName: asset.fileName ?? `image_${Date.now()}.jpg`,
          mimeType: asset.mimeType ?? 'image/jpeg',
          fileSize: asset.fileSize ?? 0,
          fileType: 'image' as const,
        }));
        addAttachments(items);
      }
    } catch (error) {
      logBoardError('pick-image', error);
      Alert.alert('오류', '이미지를 불러오는데 실패했습니다.');
    } finally {
      pickingRef.current = false;
    }
  };

  const pickFiles = async () => {
    if (pickingRef.current || !canWrite) return;
    pickingRef.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (!result.canceled) {
        const items = result.assets.map((asset) => ({
          id: `${asset.uri}-${Date.now()}`,
          uri: asset.uri,
          fileName: asset.name,
          mimeType: asset.mimeType ?? 'application/octet-stream',
          fileSize: asset.size ?? 0,
          fileType: 'file' as const,
        }));
        addAttachments(items);
      }
    } catch (error) {
      logBoardError('pick-file', error);
      Alert.alert('오류', '파일을 불러오는데 실패했습니다.');
    } finally {
      pickingRef.current = false;
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const removeExistingAttachment = (file: LocalAttachment) => {
    if (!actor || !postId) return;
    Alert.alert('첨부 삭제', `'${file.fileName}' 첨부파일을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteBoardAttachments(actor, postId, [file.id]);
            setExistingAttachments((prev) => prev.filter((item) => item.id !== file.id));
            queryClient.invalidateQueries({ queryKey: ['board-detail', postId] });
            queryClient.invalidateQueries({ queryKey: ['board-posts'] });
          } catch (error) {
            logBoardError('attachment-delete', error);
            Alert.alert('오류', '첨부파일 삭제에 실패했습니다.');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAwareWrapper
        contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 20 }]}
      >
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
              onPress={() => router.back()}
            >
              <Feather name="arrow-left" size={24} color={CHARCOAL} />
            </Pressable>
            <View>
              <Text style={styles.title}>{screenTitle}</Text>
              <Text style={styles.subtitle}>{screenSubtitle}</Text>
            </View>
          </View>
          <RefreshButton />
        </View>

        {!canWrite && (
          <View style={styles.warningBanner}>
            <Feather name="alert-circle" size={18} color="#f59e0b" />
            <Text style={styles.warningText}>관리자 계정만 게시글을 작성할 수 있습니다.</Text>
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>카테고리</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
              {categories.length === 0 && (
                <Text style={styles.categoryEmpty}>카테고리를 불러오는 중입니다.</Text>
              )}
              {categories.map((category) => {
                const isSelected = category.id === categoryId;
                return (
                  <Pressable
                    key={category.id}
                    style={({ pressed }) => [
                      styles.categoryChip,
                      isSelected && styles.categoryChipActive,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={() => setCategoryId(category.id)}
                    disabled={!canWrite}
                  >
                    <Text style={[styles.categoryChipText, isSelected && styles.categoryChipTextActive]}>
                      {category.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <FormInput
            label="제목"
            placeholder="게시글 제목을 입력하세요"
            value={title}
            onChangeText={setTitle}
            editable={!!canWrite}
          />

          <View style={styles.field}>
            <Text style={styles.label}>내용</Text>
            <TextInput
              style={[styles.input, styles.textArea, { height: contentHeight }]}
              placeholder="게시글 내용을 입력하세요"
              placeholderTextColor={MUTED}
              value={content}
              onChangeText={setContent}
              multiline
              textAlignVertical="top"
              scrollEnabled={false}
              editable={!!canWrite}
              onContentSizeChange={(e) => {
                const nextHeight = Math.max(200, e.nativeEvent.contentSize.height);
                if (nextHeight !== contentHeight) setContentHeight(nextHeight);
              }}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>첨부파일</Text>
            <View style={styles.attachmentActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.attachmentButton,
                  pressed && { opacity: 0.7 },
                  !canWrite && styles.attachmentButtonDisabled,
                ]}
                onPress={pickImages}
                disabled={!canWrite}
              >
                <Feather name="image" size={16} color={HANWHA_ORANGE} />
                <Text style={styles.attachmentButtonText}>이미지</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.attachmentButton,
                  pressed && { opacity: 0.7 },
                  !canWrite && styles.attachmentButtonDisabled,
                ]}
                onPress={pickFiles}
                disabled={!canWrite}
              >
                <Feather name="paperclip" size={16} color={HANWHA_ORANGE} />
                <Text style={styles.attachmentButtonText}>파일</Text>
              </Pressable>
            </View>
            {isEditMode && existingAttachments.length > 0 && (
              <View style={styles.attachmentList}>
                <Text style={styles.attachmentSectionLabel}>기존 첨부파일</Text>
                {existingAttachments.map((file) => (
                  <View key={file.id} style={styles.attachmentItem}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.attachmentOpen,
                        pressed && { opacity: 0.7 },
                      ]}
                      onPress={() => {
                        if (file.uri) {
                          Linking.openURL(file.uri);
                        }
                      }}
                    >
                      {file.fileType === 'image' && file.uri ? (
                        <Image source={{ uri: file.uri }} style={styles.attachmentThumbnail} />
                      ) : (
                        <View style={styles.attachmentIcon}>
                          <Feather name="file-text" size={16} color={HANWHA_ORANGE} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.attachmentName} numberOfLines={1}>
                          {file.fileName}
                        </Text>
                        <Text style={styles.attachmentSize}>{formatFileSize(file.fileSize)}</Text>
                      </View>
                      <Feather name="download" size={16} color={MUTED} />
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.attachmentRemove,
                        pressed && { opacity: 0.6 },
                      ]}
                      onPress={() => removeExistingAttachment(file)}
                    >
                      <Feather name="trash-2" size={16} color={MUTED} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            {attachments.length > 0 && (
              <View style={styles.attachmentList}>
                {isEditMode && <Text style={styles.attachmentSectionLabel}>추가 첨부파일</Text>}
                {attachments.map((file) => (
                  <View key={file.id} style={styles.attachmentItem}>
                    {file.fileType === 'image' ? (
                      <Image source={{ uri: file.uri }} style={styles.attachmentThumbnail} />
                    ) : (
                      <View style={styles.attachmentIcon}>
                        <Feather name="file-text" size={16} color={HANWHA_ORANGE} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.attachmentName} numberOfLines={1}>
                        {file.fileName}
                      </Text>
                      <Text style={styles.attachmentSize}>{formatFileSize(file.fileSize)}</Text>
                    </View>
                    <Pressable
                      style={({ pressed }) => [
                        styles.attachmentRemove,
                        pressed && { opacity: 0.6 },
                      ]}
                      onPress={() => removeAttachment(file.id)}
                    >
                      <Feather name="x" size={16} color={MUTED} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>

        </View>

        <Button
          onPress={handleSubmit}
          disabled={loading || !canWrite || !categoryId || !title.trim() || !content.trim()}
          loading={loading}
          variant="primary"
          size="lg"
          fullWidth
          rightIcon={
            !loading ? <Feather name="send" size={18} color="#fff" /> : undefined
          }
          style={{ marginTop: 32 }}
        >
          {isEditMode ? '게시글 수정' : '게시글 작성'}
        </Button>

      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 24, paddingTop: 16 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: INPUT_BG,
  },
  title: { fontSize: 24, fontWeight: '800', color: CHARCOAL },
  subtitle: { fontSize: 14, color: MUTED, marginTop: 4 },

  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: '#fef3c7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
    marginBottom: 20,
  },
  warningText: { flex: 1, fontSize: 13, color: '#92400e', fontWeight: '600' },

  form: { gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: CHARCOAL },
  categoryRow: { gap: 10, paddingVertical: 4 },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  categoryChipActive: {
    borderColor: HANWHA_ORANGE,
    backgroundColor: 'rgba(243,111,33,0.12)',
  },
  categoryChipText: { fontSize: 13, fontWeight: '600', color: CHARCOAL },
  categoryChipTextActive: { color: HANWHA_ORANGE },
  categoryEmpty: { fontSize: 12, color: MUTED },
  attachmentActions: {
    flexDirection: 'row',
    gap: 10,
  },
  attachmentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  attachmentButtonDisabled: { opacity: 0.5 },
  attachmentButtonText: { fontSize: 13, fontWeight: '600', color: CHARCOAL },
  attachmentList: {
    marginTop: 12,
    gap: 10,
  },
  attachmentSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: MUTED,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  attachmentOpen: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  attachmentThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
  },
  attachmentIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: 'rgba(243,111,33,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentName: { fontSize: 13, fontWeight: '600', color: CHARCOAL },
  attachmentSize: { fontSize: 12, color: MUTED },
  attachmentRemove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
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


});
