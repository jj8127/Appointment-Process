import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LinkifiedSelectableText } from '@/components/LinkifiedSelectableText';
import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { useSession } from '@/hooks/use-session';
import { buildBoardActor, fetchBoardDetail, formatFileSize } from '@/lib/board-api';
import { openExternalUrl } from '@/lib/open-external-url';
import { getBoardAuthorRoleLabel, getBoardRoleBadgeStyle } from '@/lib/staff-identity';
import { COLORS } from '@/lib/theme';
import { safeDecodeFileName } from '@/lib/validation';

const safeText = (value?: string | null) => (typeof value === 'string' ? value : '');
type PreviewModalState = {
  images: { url: string; title?: string }[];
  initialIndex: number;
};

export default function BoardDetailScreen() {
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  const postIdValue = useMemo(() => (Array.isArray(postId) ? postId[0] : postId) ?? '', [postId]);
  const { role, residentId, displayName, readOnly } = useSession();
  const [previewImage, setPreviewImage] = useState<PreviewModalState | null>(null);

  const actor = useMemo(
    () =>
      buildBoardActor({
        role,
        residentId,
        displayName: displayName ?? '',
        readOnly,
      }),
    [displayName, readOnly, residentId, role],
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['board', 'detail-screen', postIdValue, actor?.residentId, actor?.role],
    queryFn: () => fetchBoardDetail(actor!, postIdValue),
    enabled: Boolean(actor && postIdValue),
  });

  const openUrl = async (url?: string) => {
    if (!url) return;
    try {
      await openExternalUrl(url);
    } catch {
      // ignore
    }
  };

  const openAttachment = (
    file: {
      id: string;
      fileType: 'image' | 'file';
      signedUrl?: string;
      fileName: string;
    },
    imageAttachments: { id: string; url: string; title?: string }[],
  ) => {
    if (!file.signedUrl) return;
    if (file.fileType === 'image') {
      const imageIndex = imageAttachments.findIndex((image) => image.id === file.id);
      setPreviewImage({
        images: imageAttachments.map((image) => ({ url: image.url, title: image.title })),
        initialIndex: imageIndex >= 0 ? imageIndex : 0,
      });
      return;
    }
    openUrl(file.signedUrl);
  };

  if (!postIdValue) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.message}>게시글 ID가 없습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!actor) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.message}>로그인 후 다시 시도해주세요.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Feather name="alert-circle" size={26} color="#EF4444" />
          <Text style={styles.message}>게시글을 불러오지 못했습니다.</Text>
          <Pressable style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const detail = data;
  const post = detail.post;
  const imageAttachments = detail.attachments
    .filter((file) => file.fileType === 'image' && !!file.signedUrl)
    .map((file) => ({
      id: file.id,
      url: file.signedUrl as string,
      title: safeDecodeFileName(file.fileName),
    }));

  const roleBadgeStyle = getBoardRoleBadgeStyle(post.authorRole);

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.metaRow}>
          <View style={[styles.roleBadge, { backgroundColor: roleBadgeStyle.backgroundColor }]}>
            <Text style={[styles.roleText, { color: roleBadgeStyle.color }]}>{getBoardAuthorRoleLabel(post.authorRole)}</Text>
          </View>
          <Text style={styles.metaText}>{new Date(post.createdAt).toLocaleDateString()}</Text>
        </View>
        <Text style={styles.title} selectable>{safeText(post.title)}</Text>
        <Text style={styles.author} selectable>{`작성자: ${safeText(post.authorName)}`}</Text>
        <View style={styles.divider} />
        <LinkifiedSelectableText text={post.content} style={styles.content} />

        {detail.attachments.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>첨부 파일</Text>
            {detail.attachments.map((file) => (
              <Pressable
                key={file.id}
                style={styles.fileItem}
                onPress={() => openAttachment(file, imageAttachments)}
              >
                <Feather name={file.fileType === 'image' ? 'image' : 'paperclip'} size={14} color={COLORS.primary} />
                <Text style={styles.fileName} numberOfLines={1}>
                  {safeDecodeFileName(file.fileName)}
                </Text>
                <Text style={styles.fileSize}>{formatFileSize(file.fileSize)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>댓글 {detail.comments.length}개</Text>
          {detail.comments.length === 0 ? (
            <Text style={styles.emptyComment}>댓글이 없습니다.</Text>
          ) : (
            detail.comments.map((comment) => (
              <View key={comment.id} style={styles.commentItem}>
                <View style={styles.commentHeader}>
                  <Text style={styles.commentAuthor}>{comment.authorName}</Text>
                  <Text style={styles.commentDate}>{new Date(comment.createdAt).toLocaleDateString()}</Text>
                </View>
                <LinkifiedSelectableText text={comment.content} style={styles.commentContent} />
              </View>
            ))
          )}
        </View>

        <Pressable style={styles.listButton} onPress={() => router.push('/board')}>
          <Text style={styles.listButtonText}>게시판 목록으로</Text>
        </Pressable>
      </ScrollView>

      <ImagePreviewModal
        visible={!!previewImage}
        images={previewImage?.images ?? []}
        initialIndex={previewImage?.initialIndex ?? 0}
        onClose={() => setPreviewImage(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  message: { color: COLORS.text.secondary, fontSize: 14 },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  retryText: { color: COLORS.text.primary, fontWeight: '700' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roleBadge: {
    backgroundColor: '#FFF7ED',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roleText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  metaText: { color: '#9CA3AF', fontSize: 12 },
  title: { marginTop: 10, fontSize: 24, fontWeight: '800', color: COLORS.text.primary },
  author: { marginTop: 8, color: COLORS.text.secondary, fontSize: 13 },
  divider: { marginVertical: 14, height: 1, backgroundColor: '#F3F4F6' },
  content: { color: COLORS.text.primary, fontSize: 15, lineHeight: 24 },
  section: { marginTop: 24, gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text.primary },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fileName: { flex: 1, color: COLORS.text.primary },
  fileSize: { color: COLORS.text.secondary, fontSize: 12 },
  emptyComment: { color: COLORS.text.secondary, fontSize: 13 },
  commentItem: {
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  commentAuthor: { color: COLORS.text.primary, fontWeight: '700', fontSize: 13 },
  commentDate: { color: COLORS.text.secondary, fontSize: 12 },
  commentContent: { color: COLORS.text.primary, fontSize: 14, lineHeight: 20 },
  listButton: {
    marginTop: 28,
    alignSelf: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  listButtonText: { color: '#fff', fontWeight: '700' },
});
