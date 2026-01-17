import { Feather } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInUp,
  SlideOutUp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, RADIUS, SPACING, TYPOGRAPHY, ANIMATION, TOAST, ALERT_VARIANTS } from '@/lib/theme';

type ToastVariant = 'info' | 'success' | 'warning' | 'error';

interface ToastConfig {
  id: string;
  message: string;
  variant?: ToastVariant;
  duration?: number;
  action?: {
    label: string;
    onPress: () => void;
  };
}

interface ToastContextValue {
  showToast: (config: Omit<ToastConfig, 'id'>) => void;
  hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

function getVariantConfig(variant: ToastVariant = 'info') {
  return ALERT_VARIANTS[variant];
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastConfig;
  onDismiss: (id: string) => void;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);
  const progressWidth = useSharedValue(100);
  const variant = getVariantConfig(toast.variant);
  const duration = toast.duration ?? TOAST.duration.medium;
  const screenWidth = Dimensions.get('window').width;

  // Auto dismiss timer
  useEffect(() => {
    progressWidth.value = withTiming(0, { duration });
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss, progressWidth, toast.id]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          translateX.value = event.translationX;
          translateY.value = Math.min(0, event.translationY);
          opacity.value = 1 - Math.abs(event.translationX) / screenWidth;
        })
        .onEnd((event) => {
          const shouldDismiss =
            Math.abs(event.translationX) > 100 ||
            Math.abs(event.velocityX) > 500 ||
            event.translationY < -50;

          if (shouldDismiss) {
            const direction = event.translationX > 0 ? 1 : -1;
            translateX.value = withTiming(direction * screenWidth, { duration: ANIMATION.duration.fast });
            opacity.value = withTiming(0, { duration: ANIMATION.duration.fast }, (finished) => {
              if (finished) {
                runOnJS(onDismiss)(toast.id);
              }
            });
          } else {
            translateX.value = withSpring(0, ANIMATION.spring.snappy);
            translateY.value = withSpring(0, ANIMATION.spring.snappy);
            opacity.value = withTiming(1, { duration: ANIMATION.duration.fast });
          }
        }),
    [onDismiss, opacity, screenWidth, toast.id, translateX, translateY],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[styles.toast, animatedStyle]}
        entering={SlideInUp.duration(ANIMATION.duration.slow).springify()}
        exiting={SlideOutUp.duration(ANIMATION.duration.base)}
      >
        {/* Progress bar */}
        <Animated.View style={[styles.progressBar, { backgroundColor: variant.iconColor }, progressStyle]} />

        <View style={styles.toastContent}>
          {/* Icon */}
          <View style={[styles.iconContainer, { backgroundColor: variant.iconBg }]}>
            <Feather name={variant.icon as keyof typeof Feather.glyphMap} size={18} color={variant.iconColor} />
          </View>

          {/* Message */}
          <Text style={styles.message} numberOfLines={2}>
            {toast.message}
          </Text>

          {/* Action button */}
          {toast.action && (
            <Text
              style={[styles.actionButton, { color: variant.iconColor }]}
              onPress={() => {
                toast.action?.onPress();
                onDismiss(toast.id);
              }}
            >
              {toast.action.label}
            </Text>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastConfig[]>([]);
  const insets = useSafeAreaInsets();
  const toastIdRef = useRef(0);

  const showToast = useCallback((config: Omit<ToastConfig, 'id'>) => {
    const id = `toast-${++toastIdRef.current}`;
    setToasts((prev) => [...prev, { ...config, id }]);
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const contextValue = useMemo(() => ({ showToast, hideToast }), [hideToast, showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <View style={[styles.container, { top: insets.top + SPACING.md }]} pointerEvents="box-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={hideToast} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

// Convenience functions
export const toast = {
  info: (message: string, options?: Partial<Omit<ToastConfig, 'id' | 'message' | 'variant'>>) => ({
    message,
    variant: 'info' as const,
    ...options,
  }),
  success: (message: string, options?: Partial<Omit<ToastConfig, 'id' | 'message' | 'variant'>>) => ({
    message,
    variant: 'success' as const,
    ...options,
  }),
  warning: (message: string, options?: Partial<Omit<ToastConfig, 'id' | 'message' | 'variant'>>) => ({
    message,
    variant: 'warning' as const,
    ...options,
  }),
  error: (message: string, options?: Partial<Omit<ToastConfig, 'id' | 'message' | 'variant'>>) => ({
    message,
    variant: 'error' as const,
    ...options,
  }),
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: SPACING.base,
    right: SPACING.base,
    zIndex: 9999,
    gap: SPACING.sm,
  },
  toast: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 3,
    borderTopLeftRadius: RADIUS.lg,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.base,
    gap: SPACING.md,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.medium,
    color: COLORS.text.primary,
    lineHeight: TYPOGRAPHY.fontSize.sm * TYPOGRAPHY.lineHeight.normal,
  },
  actionButton: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
});
