import React, { useEffect } from 'react';
import { View, StyleSheet, ViewStyle, Dimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { COLORS, SPACING, RADIUS, ANIMATION } from '@/lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Shimmer effect component
function ShimmerEffect({ width }: { width: number | string }) {
  const translateX = useSharedValue(-1);
  const numericWidth = typeof width === 'number' ? width : SCREEN_WIDTH;

  useEffect(() => {
    translateX.value = withRepeat(
      withTiming(1, {
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false,
    );
  }, [translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          translateX.value,
          [-1, 1],
          [-numericWidth, numericWidth],
        ),
      },
    ],
  }));

  return (
    <Animated.View style={[styles.shimmerContainer, animatedStyle]}>
      <LinearGradient
        colors={['transparent', 'rgba(255, 255, 255, 0.4)', 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.shimmerGradient}
      />
    </Animated.View>
  );
}

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
  shimmer?: boolean;
}

export function Skeleton({
  width = '100%',
  height = 20,
  borderRadius = RADIUS.base,
  style,
  shimmer = true,
}: SkeletonProps) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    if (!shimmer) {
      opacity.value = withRepeat(
        withTiming(0.7, { duration: 1000 }),
        -1,
        true,
      );
    }
  }, [opacity, shimmer]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: shimmer ? 1 : opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
        },
        animatedStyle,
        style,
      ]}
    >
      {shimmer && <ShimmerEffect width={width} />}
    </Animated.View>
  );
}

export interface CardSkeletonProps {
  showHeader?: boolean;
  lines?: number;
  style?: ViewStyle;
  shimmer?: boolean;
}

export function CardSkeleton({
  showHeader = true,
  lines = 3,
  style,
  shimmer = true,
}: CardSkeletonProps) {
  return (
    <View style={[styles.card, style]}>
      {showHeader && (
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Skeleton width={44} height={44} borderRadius={22} shimmer={shimmer} />
            <View style={styles.cardHeaderText}>
              <Skeleton width={100} height={16} shimmer={shimmer} />
              <Skeleton width={60} height={12} shimmer={shimmer} style={{ marginTop: 6 }} />
            </View>
          </View>
        </View>
      )}
      <View style={styles.cardContent}>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            width={i === lines - 1 ? '70%' : '100%'}
            height={i === 0 ? 18 : 14}
            shimmer={shimmer}
            style={{ marginBottom: i === lines - 1 ? 0 : SPACING.sm }}
          />
        ))}
      </View>
    </View>
  );
}

export interface ListSkeletonProps {
  count?: number;
  itemHeight?: number;
  style?: ViewStyle;
  shimmer?: boolean;
}

export function ListSkeleton({
  count = 3,
  itemHeight = 80,
  style,
  shimmer = true,
}: ListSkeletonProps) {
  return (
    <View style={style}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.listItem, { height: itemHeight }]}>
          <Skeleton width={56} height={56} borderRadius={RADIUS.md} shimmer={shimmer} />
          <View style={styles.listItemContent}>
            <Skeleton width="70%" height={18} shimmer={shimmer} style={{ marginBottom: SPACING.xs }} />
            <Skeleton width="50%" height={14} shimmer={shimmer} />
          </View>
        </View>
      ))}
    </View>
  );
}

export interface FormSkeletonProps {
  fields?: number;
  style?: ViewStyle;
  shimmer?: boolean;
}

export function FormSkeleton({ fields = 4, style, shimmer = true }: FormSkeletonProps) {
  return (
    <View style={style}>
      {Array.from({ length: fields }).map((_, i) => (
        <View key={i} style={styles.formField}>
          <Skeleton width="30%" height={14} shimmer={shimmer} style={{ marginBottom: SPACING.xs }} />
          <Skeleton width="100%" height={52} borderRadius={RADIUS.md} shimmer={shimmer} />
        </View>
      ))}
      <Skeleton
        width="100%"
        height={52}
        borderRadius={RADIUS.md}
        shimmer={shimmer}
        style={{ marginTop: SPACING.lg }}
      />
    </View>
  );
}

// New: Board-specific skeleton
export interface BoardSkeletonProps {
  count?: number;
  style?: ViewStyle;
  shimmer?: boolean;
}

export function BoardSkeleton({
  count = 3,
  style,
  shimmer = true,
}: BoardSkeletonProps) {
  return (
    <View style={[styles.boardSkeletonContainer, style]}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.boardCard}>
          {/* Header */}
          <View style={styles.boardHeader}>
            <Skeleton width={40} height={40} borderRadius={20} shimmer={shimmer} />
            <View style={{ flex: 1, marginLeft: SPACING.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Skeleton width={60} height={14} shimmer={shimmer} />
                <Skeleton width={40} height={18} borderRadius={RADIUS.sm} shimmer={shimmer} />
              </View>
              <Skeleton width={80} height={12} shimmer={shimmer} style={{ marginTop: 4 }} />
            </View>
          </View>

          {/* Content */}
          <View style={styles.boardContent}>
            <Skeleton width="90%" height={18} shimmer={shimmer} style={{ marginBottom: SPACING.sm }} />
            <Skeleton width="100%" height={14} shimmer={shimmer} />
            <Skeleton width="75%" height={14} shimmer={shimmer} style={{ marginTop: 4 }} />
          </View>

          {/* Footer */}
          <View style={styles.boardFooter}>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <Skeleton width={50} height={24} borderRadius={RADIUS.md} shimmer={shimmer} />
              <Skeleton width={50} height={24} borderRadius={RADIUS.md} shimmer={shimmer} />
            </View>
            <Skeleton width={40} height={20} shimmer={shimmer} />
          </View>
        </View>
      ))}
    </View>
  );
}

// New: Inline text skeleton
export function TextSkeleton({
  lines = 1,
  lastLineWidth = '60%',
  lineHeight = 16,
  lineSpacing = SPACING.xs,
  style,
  shimmer = true,
}: {
  lines?: number;
  lastLineWidth?: number | `${number}%`;
  lineHeight?: number;
  lineSpacing?: number;
  style?: ViewStyle;
  shimmer?: boolean;
}) {
  return (
    <View style={style}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? lastLineWidth : '100%'}
          height={lineHeight}
          shimmer={shimmer}
          style={i < lines - 1 ? { marginBottom: lineSpacing } : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: COLORS.gray[200],
    overflow: 'hidden',
  },
  shimmerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
  },
  shimmerGradient: {
    flex: 1,
    width: '50%',
  },
  card: {
    backgroundColor: COLORS.white,
    padding: SPACING.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    marginBottom: SPACING.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardHeaderText: {
    marginLeft: SPACING.sm,
  },
  cardContent: {
    gap: SPACING.xs,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.base,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  listItemContent: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  formField: {
    marginBottom: SPACING.base,
  },
  boardSkeletonContainer: {
    gap: SPACING.base,
  },
  boardCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.base,
  },
  boardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  boardContent: {
    marginBottom: SPACING.md,
  },
  boardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
});
