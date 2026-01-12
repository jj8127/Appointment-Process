import { Feather } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

export interface FormInputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
  variant?: 'default' | 'password' | 'select';
  onSelectPress?: () => void;
}

/**
 * FormInput - Reusable form input component
 *
 * Provides consistent styling and behavior across all form inputs.
 * Supports three variants:
 * - default: Standard text input with optional icons
 * - password: Text input with show/hide password toggle
 * - select: Read-only input that triggers a modal/picker
 *
 * Features:
 * - Animated border on focus (primary color)
 * - Background color change on focus
 * - Error state with red border and error message
 * - Label support
 * - Icon support (left/right)
 * - Password visibility toggle
 * - Accessibility attributes
 *
 * @example
 * // Basic input
 * <FormInput
 *   label="이름"
 *   placeholder="홍길동"
 *   value={name}
 *   onChangeText={setName}
 * />
 *
 * @example
 * // Password input
 * <FormInput
 *   label="비밀번호"
 *   variant="password"
 *   placeholder="8자 이상"
 *   value={password}
 *   onChangeText={setPassword}
 * />
 *
 * @example
 * // Select input (triggers modal)
 * <FormInput
 *   label="통신사"
 *   variant="select"
 *   placeholder="통신사 선택"
 *   value={carrier}
 *   onSelectPress={() => setShowPicker(true)}
 * />
 */
export function FormInput({
  label,
  error,
  leftIcon,
  rightIcon,
  containerStyle,
  inputStyle,
  variant = 'default',
  onSelectPress,
  editable = true,
  ...textInputProps
}: FormInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isPassword = variant === 'password';
  const isSelect = variant === 'select';
  const hasError = !!error;

  // Determine border color based on state
  const getBorderColor = () => {
    if (hasError) return COLORS.error;
    if (isFocused) return COLORS.primary;
    return COLORS.border.light;
  };

  // Determine background color based on state
  const getBackgroundColor = () => {
    if (isFocused) return COLORS.white;
    return COLORS.background.secondary;
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}

      <MotiView
        animate={{
          borderColor: getBorderColor(),
          backgroundColor: getBackgroundColor(),
        }}
        transition={{ type: 'timing', duration: 200 }}
        style={[
          styles.inputWrapper,
          hasError && styles.inputWrapperError,
        ]}
      >
        {/* Left Icon */}
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}

        {/* Text Input */}
        <TextInput
          style={[
            styles.input,
            !!leftIcon && styles.inputWithLeftIcon,
            !!(rightIcon || isPassword || isSelect) && styles.inputWithRightIcon,
            inputStyle,
          ]}
          placeholderTextColor={COLORS.text.muted}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          editable={editable && !isSelect}
          secureTextEntry={isPassword && !showPassword}
          {...textInputProps}
        />

        {/* Password Toggle */}
        {isPassword && (
          <Pressable
            style={styles.rightIconButton}
            onPress={() => setShowPassword((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
          >
            <Feather
              name={showPassword ? 'eye-off' : 'eye'}
              size={18}
              color={COLORS.text.secondary}
            />
          </Pressable>
        )}

        {/* Select Chevron */}
        {isSelect && (
          <Pressable
            style={styles.rightIconButton}
            onPress={onSelectPress}
            accessibilityRole="button"
            accessibilityLabel="선택 열기"
          >
            <Feather name="chevron-down" size={20} color={COLORS.text.secondary} />
          </Pressable>
        )}

        {/* Custom Right Icon */}
        {rightIcon && !isPassword && !isSelect && (
          <View style={styles.rightIconButton}>{rightIcon}</View>
        )}

        {/* Select Overlay (entire input is clickable) */}
        {isSelect && onSelectPress && (
          <Pressable style={styles.selectOverlay} onPress={onSelectPress} />
        )}
      </MotiView>

      {/* Error Message */}
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
    marginLeft: SPACING.xs,
  },
  inputWrapper: {
    height: 56,
    borderWidth: 1.5,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.base,
  },
  inputWrapperError: {
    borderColor: COLORS.error,
  },
  input: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.text.primary,
    height: '100%',
    paddingVertical: 0, // Remove default padding for better vertical alignment
  },
  inputWithLeftIcon: {
    paddingLeft: SPACING.sm,
  },
  inputWithRightIcon: {
    paddingRight: SPACING.sm,
  },
  leftIcon: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.xs,
  },
  rightIconButton: {
    justifyContent: 'center',
    alignItems: 'center',
    width: SPACING['2xl'],
    height: '100%',
  },
  selectOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  errorText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.error,
    marginLeft: SPACING.xs,
    marginTop: -SPACING.xs,
  },
});
