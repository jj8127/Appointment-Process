import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import { COLORS, SPACING, RADIUS } from '@/lib/theme';

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 20,
  borderRadius = RADIUS.base,
  style,
}: SkeletonProps) {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
}

export interface CardSkeletonProps {
  showHeader?: boolean;
  lines?: number;
  style?: ViewStyle;
}

export function CardSkeleton({
  showHeader = true,
  lines = 3,
  style,
}: CardSkeletonProps) {
  return (
    <View style={[styles.card, style]}>
      {showHeader && (
        <View style={styles.cardHeader}>
          <Skeleton width="40%" height={20} />
          <Skeleton width={80} height={32} borderRadius={RADIUS.full} />
        </View>
      )}
      <View style={styles.cardContent}>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            width={i === lines - 1 ? '70%' : '100%'}
            height={16}
            style={{ marginBottom: SPACING.sm }}
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
}

export function ListSkeleton({
  count = 3,
  itemHeight = 80,
  style,
}: ListSkeletonProps) {
  return (
    <View style={style}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.listItem, { height: itemHeight }]}>
          <Skeleton width={60} height={60} borderRadius={RADIUS.md} />
          <View style={styles.listItemContent}>
            <Skeleton width="70%" height={18} style={{ marginBottom: SPACING.xs }} />
            <Skeleton width="50%" height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}

export interface FormSkeletonProps {
  fields?: number;
  style?: ViewStyle;
}

export function FormSkeleton({ fields = 4, style }: FormSkeletonProps) {
  return (
    <View style={style}>
      {Array.from({ length: fields }).map((_, i) => (
        <View key={i} style={styles.formField}>
          <Skeleton width="30%" height={16} style={{ marginBottom: SPACING.xs }} />
          <Skeleton width="100%" height={48} borderRadius={RADIUS.base} />
        </View>
      ))}
      <Skeleton
        width="100%"
        height={56}
        borderRadius={RADIUS.md}
        style={{ marginTop: SPACING.lg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: COLORS.gray[200],
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
});
