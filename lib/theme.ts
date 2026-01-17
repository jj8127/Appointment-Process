/**
 * Centralized theme configuration for FC Onboarding App
 * Use these constants throughout the app for consistency
 */

// Brand Colors
export const COLORS = {
  // Primary - Hanwha Orange
  primary: '#f36f21',
  primaryDark: '#d65a16',
  primaryLight: '#ff8a4c',
  primaryPale: '#fff1e6',

  // Neutrals
  white: '#ffffff',
  black: '#000000',
  charcoal: '#1a1a1a',
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },

  // Semantic Colors
  success: '#10b981',
  successLight: '#d1fae5',
  warning: {
    main: '#f59e0b',
    light: '#fff7ed',
    border: '#fed7aa',
    dark: '#9a3412',
  },
  error: '#ef4444',
  errorLight: '#fee2e2',
  info: '#3b82f6',
  infoLight: '#dbeafe',

  // Text
  text: {
    primary: '#1a1a1a',
    secondary: '#4b5563',
    muted: '#9ca3af',
    disabled: '#d1d5db',
    inverse: '#ffffff',
  },

  // Background
  background: {
    primary: '#ffffff',
    secondary: '#f9fafb',
    tertiary: '#f3f4f6',
    overlay: 'rgba(0, 0, 0, 0.5)',
  },

  // Border
  border: {
    light: '#e5e7eb',
    medium: '#d1d5db',
    dark: '#9ca3af',
  },
} as const;

// Typography
export const TYPOGRAPHY = {
  fontSize: {
    '2xs': 10,
    xs: 11,
    sm: 13,
    base: 15,
    md: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 28,
    '4xl': 32,
    '5xl': 48,
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.6,
  },
} as const;

// Spacing
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
  '5xl': 64,
} as const;

// Border Radius
export const RADIUS = {
  none: 0,
  sm: 4,
  base: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

// Shadows
export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  base: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;

// Touch Targets
export const TOUCH_TARGET = {
  min: 44, // iOS/Android minimum touch target size
  recommended: 48,
} as const;

// Animation
export const ANIMATION = {
  duration: {
    instant: 100,
    fast: 150,
    base: 200,
    slow: 300,
    slower: 400,
  },
  easing: {
    ease: 'ease',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
  },
  // Spring configs for react-native-reanimated
  spring: {
    gentle: { damping: 20, stiffness: 120, mass: 1 },
    bouncy: { damping: 12, stiffness: 180, mass: 0.8 },
    snappy: { damping: 24, stiffness: 300, mass: 1 },
  },
} as const;

// Alert/Modal Variants
export const ALERT_VARIANTS = {
  info: {
    icon: 'info',
    iconColor: COLORS.info,
    iconBg: COLORS.infoLight,
  },
  success: {
    icon: 'check-circle',
    iconColor: COLORS.success,
    iconBg: COLORS.successLight,
  },
  warning: {
    icon: 'alert-triangle',
    iconColor: COLORS.warning.main,
    iconBg: COLORS.warning.light,
  },
  error: {
    icon: 'x-circle',
    iconColor: COLORS.error,
    iconBg: COLORS.errorLight,
  },
} as const;

// Toast configuration
export const TOAST = {
  duration: {
    short: 2000,
    medium: 3500,
    long: 5000,
  },
  position: {
    top: 60,
    bottom: 100,
  },
} as const;

// Deprecated colors (for migration reference)
// TODO: Remove these after migrating all files
export const DEPRECATED = {
  ORANGE: COLORS.primary,
  ORANGE_LIGHT: COLORS.primaryLight,
  CHARCOAL: COLORS.charcoal,
  GRAY: COLORS.gray[500],
  LIGHT_GRAY: COLORS.gray[200],
  TEXT_MUTED: COLORS.text.muted,
  BG_GRAY: COLORS.background.secondary,
} as const;
