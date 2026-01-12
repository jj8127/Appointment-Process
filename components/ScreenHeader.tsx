import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '@/lib/theme';
import { RefreshButton } from './RefreshButton';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  showRefresh?: boolean;
  onRefresh?: () => void;
  style?: ViewStyle;
}

export function ScreenHeader({
  title,
  subtitle,
  badge,
  badgeColor = COLORS.primary,
  showRefresh = false,
  onRefresh,
  style,
}: ScreenHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        {badge && (
          <Text style={[styles.badge, { color: badgeColor }]}>
            {badge}
          </Text>
        )}
      </View>
      {showRefresh && onRefresh && <RefreshButton onPress={onRefresh} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize['2xl'],
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    lineHeight: 20,
  },
  badge: {
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    marginTop: SPACING.xs + 2,
    fontSize: TYPOGRAPHY.fontSize.xs + 2, // 13px
  },
});
