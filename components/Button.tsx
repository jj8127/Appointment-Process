import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, TOUCH_TARGET, SHADOWS } from '@/lib/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  // Content
  children: React.ReactNode;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;

  // Behavior
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;

  // Styling
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;

  // Accessibility
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function Button({
  children,
  leftIcon,
  rightIcon,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  // Get variant styles
  const variantStyles = getVariantStyles(variant, isDisabled);

  // Get size styles
  const sizeStyles = getSizeStyles(size);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled }}
      style={[
        styles.base,
        variantStyles.container,
        sizeStyles.container,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading && (
          <ActivityIndicator
            color={variantStyles.text.color}
            size="small"
            style={styles.loader}
          />
        )}
        {!loading && leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <Text
          style={[
            styles.text,
            variantStyles.text,
            sizeStyles.text,
            textStyle,
          ]}
          numberOfLines={1}
        >
          {children}
        </Text>
        {!loading && rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
      </View>
    </TouchableOpacity>
  );
}

function getVariantStyles(variant: ButtonVariant, disabled: boolean) {
  switch (variant) {
    case 'primary':
      return {
        container: {
          backgroundColor: disabled ? COLORS.gray[300] : COLORS.primary,
          ...SHADOWS.sm,
        },
        text: {
          color: COLORS.white,
        },
      };

    case 'secondary':
      return {
        container: {
          backgroundColor: disabled ? COLORS.gray[100] : COLORS.gray[700],
          ...SHADOWS.sm,
        },
        text: {
          color: COLORS.white,
        },
      };

    case 'outline':
      return {
        container: {
          backgroundColor: COLORS.white,
          borderWidth: 1.5,
          borderColor: disabled ? COLORS.border.light : COLORS.primary,
        },
        text: {
          color: disabled ? COLORS.text.disabled : COLORS.primary,
        },
      };

    case 'ghost':
      return {
        container: {
          backgroundColor: 'transparent',
        },
        text: {
          color: disabled ? COLORS.text.disabled : COLORS.primary,
        },
      };

    case 'danger':
      return {
        container: {
          backgroundColor: disabled ? COLORS.gray[300] : COLORS.error,
          ...SHADOWS.sm,
        },
        text: {
          color: COLORS.white,
        },
      };

    default:
      return {
        container: {},
        text: {},
      };
  }
}

function getSizeStyles(size: ButtonSize) {
  switch (size) {
    case 'sm':
      return {
        container: {
          minHeight: TOUCH_TARGET.min,
          paddingHorizontal: SPACING.md,
          paddingVertical: SPACING.sm,
        },
        text: {
          fontSize: TYPOGRAPHY.fontSize.sm,
        },
      };

    case 'md':
      return {
        container: {
          minHeight: TOUCH_TARGET.recommended,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
        },
        text: {
          fontSize: TYPOGRAPHY.fontSize.base,
        },
      };

    case 'lg':
      return {
        container: {
          minHeight: 56,
          paddingHorizontal: SPACING.xl,
          paddingVertical: SPACING.base,
        },
        text: {
          fontSize: TYPOGRAPHY.fontSize.lg,
        },
      };

    default:
      return {
        container: {},
        text: {},
      };
  }
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.6,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    textAlign: 'center',
  },
  leftIcon: {
    marginRight: SPACING.sm,
  },
  rightIcon: {
    marginLeft: SPACING.sm,
  },
  loader: {
    marginRight: SPACING.sm,
  },
});
