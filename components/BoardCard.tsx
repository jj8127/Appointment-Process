import { Feather } from '@expo/vector-icons';
import { MotiView } from 'moti';
import React, { memo, useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { COLORS, RADIUS, SPACING, TYPOGRAPHY, SHADOWS, ANIMATION } from '@/lib/theme';

// Types
export interface BoardAttachment {
  id: string;
  fileName: string;
  fileType: 'image' | 'file';
  fileSize: number;
  signedUrl?: string | null;
}

export interface BoardReaction {
  type: string;
  count: number;
}

export interface BoardCardData {
  id: string;
  title: string;
  contentPreview: string;
  authorName: string;
  authorRole: 'admin' | 'manager';
  createdAt: string;
  attachments?: BoardAttachment[];
  reactions?: BoardReaction[];
  commentCount?: number;
  isPinned?: boolean;
}

export interface BoardCardProps {
  post: BoardCardData;
  onPress: (post: BoardCardData) => void;
  style?: ViewStyle;
  index?: number;
}

const REACTION_CONFIG: Record<string, { icon: string; color: string }> = {
  like: { icon: 'thumbs-up', color: '#3b82f6' },
  heart: { icon: 'heart', color: '#ef4444' },
  check: { icon: 'check-circle', color: '#10b981' },
  smile: { icon: 'smile', color: '#f59e0b' },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return '방금 전';
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;

  return date.toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
  });
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function BoardCardComponent({ post, onPress, style, index = 0 }: BoardCardProps) {
  const scale = useSharedValue(1);

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.98, ANIMATION.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, ANIMATION.spring.bouncy);
  }, [scale]);

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const imageAttachments = post.attachments?.filter((a) => a.fileType === 'image') ?? [];
  const fileAttachments = post.attachments?.filter((a) => a.fileType === 'file') ?? [];
  const hasAttachments = imageAttachments.length > 0 || fileAttachments.length > 0;
  const hasReactions = (post.reactions?.length ?? 0) > 0;

  return (
    <MotiView
      from={{ opacity: 0, translateY: 20 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{
        type: 'timing',
        duration: ANIMATION.duration.slow,
        delay: index * 50,
      }}
    >
      <AnimatedPressable
        style={[styles.card, animatedCardStyle, post.isPinned && styles.cardPinned, style]}
        onPress={() => onPress(post)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        {/* Pinned indicator */}
        {post.isPinned && (
          <View style={styles.pinnedBadge}>
            <Feather name="bookmark" size={12} color={COLORS.primary} />
            <Text style={styles.pinnedText}>고정</Text>
          </View>
        )}

        {/* Header: Author info */}
        <View style={styles.header}>
          <View style={styles.authorBadge}>
            <View style={[styles.avatar, post.authorRole === 'manager' && styles.avatarManager]}>
              <Text style={styles.avatarText}>{post.authorName?.charAt(0) ?? '?'}</Text>
            </View>
            <View>
              <View style={styles.authorRow}>
                <Text style={styles.authorName}>{post.authorName}</Text>
                <View
                  style={[
                    styles.roleBadge,
                    { backgroundColor: post.authorRole === 'admin' ? COLORS.infoLight : '#e9d5ff' },
                  ]}
                >
                  <Text
                    style={[styles.roleText, { color: post.authorRole === 'admin' ? '#2563eb' : '#9333ea' }]}
                  >
                    {post.authorRole === 'admin' ? '관리자' : '본부장'}
                  </Text>
                </View>
              </View>
              <Text style={styles.date}>{formatDate(post.createdAt)}</Text>
            </View>
          </View>
        </View>

        {/* Content */}
        <Text style={styles.title} numberOfLines={1}>
          {post.title}
        </Text>
        <Text style={styles.content} numberOfLines={2}>
          {post.contentPreview}
        </Text>

        {/* Attachment preview */}
        {hasAttachments && (
          <View style={styles.attachmentPreview}>
            {imageAttachments.length > 0 && (
              <View style={styles.attachmentImages}>
                {imageAttachments.slice(0, 3).map((attachment) => (
                  <View key={attachment.id} style={styles.attachmentThumb}>
                    {attachment.signedUrl ? (
                      <Image source={{ uri: attachment.signedUrl }} style={styles.attachmentImage} />
                    ) : (
                      <View style={styles.attachmentPlaceholder}>
                        <Feather name="image" size={16} color={COLORS.text.muted} />
                      </View>
                    )}
                  </View>
                ))}
                {imageAttachments.length > 3 && (
                  <View style={styles.attachmentMore}>
                    <Text style={styles.attachmentMoreText}>+{imageAttachments.length - 3}</Text>
                  </View>
                )}
              </View>
            )}
            {fileAttachments.length > 0 && (
              <View style={styles.attachmentMeta}>
                <Feather name="paperclip" size={12} color={COLORS.text.muted} />
                <Text style={styles.attachmentMetaText}>
                  파일 {fileAttachments.length}개
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Divider */}
        {(hasReactions || (post.commentCount ?? 0) > 0) && <View style={styles.divider} />}

        {/* Footer: Reactions & Comments */}
        <View style={styles.footer}>
          <View style={styles.reactions}>
            {post.reactions?.map(({ type, count }) => {
              const config = REACTION_CONFIG[type];
              if (!config || count === 0) return null;
              return (
                <View
                  key={type}
                  style={[styles.reactionBadge, { borderColor: config.color }]}
                >
                  <Feather name={config.icon as any} size={12} color={config.color} />
                  <Text style={[styles.reactionCount, { color: config.color }]}>{count}</Text>
                </View>
              );
            })}
          </View>
          {(post.commentCount ?? 0) > 0 && (
            <View style={styles.commentInfo}>
              <Feather name="message-circle" size={14} color={COLORS.text.muted} />
              <Text style={styles.commentCount}>{post.commentCount}</Text>
            </View>
          )}
        </View>
      </AnimatedPressable>
    </MotiView>
  );
}

export const BoardCard = memo(BoardCardComponent);

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.base,
    ...SHADOWS.base,
  },
  cardPinned: {
    borderColor: COLORS.primaryPale,
    backgroundColor: '#fffaf5',
  },
  pinnedBadge: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.primaryPale,
  },
  pinnedText: {
    fontSize: TYPOGRAPHY.fontSize['2xs'],
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  authorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarManager: {
    backgroundColor: '#9333ea',
  },
  avatarText: {
    color: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  authorName: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.text.primary,
  },
  roleBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.base,
  },
  roleText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
  },
  date: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    marginTop: 2,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
    marginBottom: SPACING.xs,
  },
  content: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.secondary,
    lineHeight: TYPOGRAPHY.fontSize.sm * TYPOGRAPHY.lineHeight.relaxed,
  },
  attachmentPreview: {
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  attachmentImages: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  attachmentThumb: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
  },
  attachmentPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background.secondary,
  },
  attachmentMore: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  attachmentMoreText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.text.secondary,
  },
  attachmentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  attachmentMetaText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    fontWeight: TYPOGRAPHY.fontWeight.medium,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border.light,
    marginVertical: SPACING.md,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reactions: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    backgroundColor: COLORS.white,
  },
  reactionCount: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
  },
  commentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  commentCount: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
  },
});
