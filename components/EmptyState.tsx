import { Feather } from '@expo/vector-icons';
import { MotiView } from 'moti';
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { Button, ButtonProps } from './Button';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY, ANIMATION } from '@/lib/theme';

export interface EmptyStateProps {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  action?: {
    label: string;
    onPress: () => void;
    variant?: ButtonProps['variant'];
  };
  style?: ViewStyle;
  compact?: boolean;
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  style,
  compact = false,
}: EmptyStateProps) {
  return (
    <MotiView
      from={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        type: 'timing',
        duration: ANIMATION.duration.slow,
      }}
      style={[styles.container, compact && styles.containerCompact, style]}
    >
      {/* Icon */}
      <MotiView
        from={{ opacity: 0, translateY: -10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{
          type: 'spring',
          damping: 15,
          stiffness: 100,
          delay: 100,
        }}
        style={[styles.iconContainer, compact && styles.iconContainerCompact]}
      >
        <View style={[styles.iconCircle, compact && styles.iconCircleCompact]}>
          <Feather
            name={icon}
            size={compact ? 28 : 36}
            color={COLORS.text.muted}
          />
        </View>
      </MotiView>

      {/* Text content */}
      <MotiView
        from={{ opacity: 0, translateY: 10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{
          type: 'spring',
          damping: 15,
          stiffness: 100,
          delay: 200,
        }}
        style={styles.textContainer}
      >
        <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
        {description && (
          <Text style={[styles.description, compact && styles.descriptionCompact]}>
            {description}
          </Text>
        )}
      </MotiView>

      {/* Action button */}
      {action && (
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{
            type: 'spring',
            damping: 15,
            stiffness: 100,
            delay: 300,
          }}
          style={styles.actionContainer}
        >
          <Button
            variant={action.variant ?? 'primary'}
            size={compact ? 'sm' : 'md'}
            onPress={action.onPress}
          >
            {action.label}
          </Button>
        </MotiView>
      )}
    </MotiView>
  );
}

// Preset empty states for common use cases
export function EmptyPostsState({
  onCreatePost,
  style,
}: {
  onCreatePost?: () => void;
  style?: ViewStyle;
}) {
  return (
    <EmptyState
      icon="edit-3"
      title="아직 게시글이 없습니다"
      description="첫 번째 게시글을 작성해보세요"
      action={onCreatePost ? { label: '글쓰기', onPress: onCreatePost } : undefined}
      style={style}
    />
  );
}

export function EmptyCommentsState({ style }: { style?: ViewStyle }) {
  return (
    <EmptyState
      icon="message-circle"
      title="댓글이 없습니다"
      description="첫 댓글을 남겨보세요!"
      compact
      style={style}
    />
  );
}

export function EmptyNotificationsState({ style }: { style?: ViewStyle }) {
  return (
    <EmptyState
      icon="bell-off"
      title="알림이 없습니다"
      description="새로운 알림이 오면 여기에 표시됩니다"
      style={style}
    />
  );
}

export function EmptySearchState({
  query,
  style,
}: {
  query?: string;
  style?: ViewStyle;
}) {
  return (
    <EmptyState
      icon="search"
      title="검색 결과가 없습니다"
      description={query ? `"${query}"에 대한 검색 결과가 없습니다` : '다른 검색어를 입력해보세요'}
      style={style}
    />
  );
}

export function ErrorState({
  message = '데이터를 불러오는데 실패했습니다',
  onRetry,
  style,
}: {
  message?: string;
  onRetry?: () => void;
  style?: ViewStyle;
}) {
  return (
    <EmptyState
      icon="alert-circle"
      title="오류가 발생했습니다"
      description={message}
      action={onRetry ? { label: '다시 시도', onPress: onRetry, variant: 'outline' } : undefined}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING['3xl'],
    paddingHorizontal: SPACING.xl,
  },
  containerCompact: {
    paddingVertical: SPACING.xl,
  },
  iconContainer: {
    marginBottom: SPACING.lg,
  },
  iconContainerCompact: {
    marginBottom: SPACING.md,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleCompact: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  textContainer: {
    alignItems: 'center',
    maxWidth: 280,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  titleCompact: {
    fontSize: TYPOGRAPHY.fontSize.base,
  },
  description: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    textAlign: 'center',
    lineHeight: TYPOGRAPHY.fontSize.sm * TYPOGRAPHY.lineHeight.relaxed,
  },
  descriptionCompact: {
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  actionContainer: {
    marginTop: SPACING.lg,
  },
});
