import { Feather } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';

import { ALERT_VARIANTS, ANIMATION, COLORS, RADIUS, SPACING, TYPOGRAPHY } from '@/lib/theme';

type ButtonStyle = 'default' | 'cancel' | 'destructive';
type AlertVariant = 'info' | 'success' | 'warning' | 'error';

type AppAlertButton = {
  text?: string;
  onPress?: () => void;
  style?: ButtonStyle;
};

type AppAlertOptions = {
  cancelable?: boolean;
  variant?: AlertVariant;
};

type AppAlert = {
  title: string;
  message?: string;
  buttons: AppAlertButton[];
  options?: AppAlertOptions;
};

type AppAlertHandler = (
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
  options?: AppAlertOptions,
) => void;

const AlertContext = createContext<AppAlertHandler>(() => { });

export function useAppAlert() {
  return useContext(AlertContext);
}

function normalizeButtons(buttons?: AppAlertButton[]) {
  if (!buttons || buttons.length === 0) {
    return [{ text: '확인' }];
  }
  return buttons.map((button) => ({
    text: button.text || '확인',
    onPress: button.onPress,
    style: button.style,
  }));
}

function resolveButtonStyle(button: AppAlertButton) {
  if (button.style === 'destructive') {
    return {
      container: [styles.button, styles.buttonDestructive],
      text: [styles.buttonText, styles.buttonTextDestructive],
    };
  }
  if (button.style === 'cancel') {
    return {
      container: [styles.button, styles.buttonSecondary],
      text: [styles.buttonText, styles.buttonTextSecondary],
    };
  }
  return {
    container: [styles.button, styles.buttonPrimary],
    text: [styles.buttonText, styles.buttonTextPrimary],
  };
}

function getVariantConfig(variant: AlertVariant = 'info') {
  return ALERT_VARIANTS[variant];
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function AlertCard({
  alert,
  onButtonPress,
  onBackdropPress,
}: {
  alert: AppAlert;
  onButtonPress: (button?: AppAlertButton) => void;
  onBackdropPress: () => void;
}) {
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);
  const variant = getVariantConfig(alert.options?.variant);
  const isStacked = (alert.buttons?.length ?? 0) > 2;

  useEffect(() => {
    scale.value = withSpring(1, ANIMATION.spring.bouncy);
    opacity.value = withTiming(1, { duration: ANIMATION.duration.fast });
  }, [opacity, scale]);

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const handleClose = useCallback(
    (button?: AppAlertButton) => {
      scale.value = withTiming(0.9, { duration: ANIMATION.duration.fast });
      opacity.value = withTiming(0, { duration: ANIMATION.duration.fast }, (finished) => {
        if (finished) {
          runOnJS(onButtonPress)(button);
        }
      });
    },
    [onButtonPress, opacity, scale],
  );

  return (
    <AnimatedPressable
      style={styles.backdrop}
      onPress={() => {
        if (alert.options?.cancelable) {
          const cancelButton = alert.buttons.find((b) => b.style === 'cancel');
          handleClose(cancelButton);
        }
      }}
      entering={FadeIn.duration(ANIMATION.duration.fast)}
      exiting={FadeOut.duration(ANIMATION.duration.fast)}
    >
      <Animated.View style={[styles.card, animatedCardStyle]}>
        {/* Icon */}
        <View style={[styles.iconCircle, { backgroundColor: variant.iconBg }]}>
          <Feather name={variant.icon as keyof typeof Feather.glyphMap} size={22} color={variant.iconColor} />
        </View>

        {/* Title */}
        <Text style={styles.title}>{alert.title}</Text>

        {/* Message */}
        {!!alert.message && <Text style={styles.message}>{alert.message}</Text>}

        {/* Buttons */}
        <View style={[styles.buttonRow, isStacked && styles.buttonStack]}>
          {alert.buttons.map((button, index) => {
            const buttonStyle = resolveButtonStyle(button);
            return (
              <Pressable
                key={`${button.text ?? 'button'}-${index}`}
                style={({ pressed }) => [
                  buttonStyle.container,
                  isStacked ? styles.buttonFull : styles.buttonCompact,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => handleClose(button)}
              >
                <Text style={buttonStyle.text}>{button.text ?? '확인'}</Text>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </AnimatedPressable>
  );
}

export function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<AppAlert[]>([]);
  const currentAlert = queue[0] ?? null;
  const showRef = useRef<AppAlertHandler>(() => { });

  const showAlert = useCallback<AppAlertHandler>((title, message, buttons, options) => {
    const normalizedButtons = normalizeButtons(buttons);
    setQueue((prev) => [...prev, { title, message, buttons: normalizedButtons, options }]);
  }, []);

  const dismissAlert = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  const handleButtonPress = useCallback(
    (button?: AppAlertButton) => {
      if (button?.onPress) {
        button.onPress();
      }
      dismissAlert();
    },
    [dismissAlert],
  );

  useEffect(() => {
    showRef.current = showAlert;
  }, [showAlert]);

  useEffect(() => {
    const originalAlert = Alert.alert;
    Alert.alert = (title, message, buttons, options) => {
      showRef.current(title, message, buttons, options);
    };
    return () => {
      Alert.alert = originalAlert;
    };
  }, []);

  const handleBackdropPress = useCallback(() => {
    if (!currentAlert?.options?.cancelable) return;
    const cancelButton = currentAlert?.buttons.find((button) => button.style === 'cancel');
    if (cancelButton?.onPress) {
      cancelButton.onPress();
    }
    dismissAlert();
  }, [currentAlert?.buttons, currentAlert?.options?.cancelable, dismissAlert]);

  return (
    <AlertContext.Provider value={showAlert}>
      {children}
      <Modal visible={!!currentAlert} transparent statusBarTranslucent onRequestClose={handleBackdropPress}>
        {currentAlert && (
          <AlertCard alert={currentAlert} onButtonPress={handleButtonPress} onBackdropPress={handleBackdropPress} />
        )}
      </Modal>
    </AlertContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
    paddingTop: SPACING.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.base,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
    textAlign: 'center',
  },
  message: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: TYPOGRAPHY.fontSize.sm * TYPOGRAPHY.lineHeight.relaxed,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  buttonRow: {
    marginTop: SPACING.lg,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  buttonStack: {
    flexDirection: 'column',
  },
  button: {
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  buttonCompact: {
    width: 100,
  },
  buttonFull: {
    width: '100%',
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  buttonPrimary: {
    backgroundColor: COLORS.primary,
  },
  buttonSecondary: {
    backgroundColor: COLORS.gray[100],
    borderColor: COLORS.border.light,
  },
  buttonDestructive: {
    backgroundColor: COLORS.errorLight,
    borderColor: '#fecaca',
  },
  buttonText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
  },
  buttonTextPrimary: {
    color: COLORS.white,
  },
  buttonTextSecondary: {
    color: COLORS.text.primary,
  },
  buttonTextDestructive: {
    color: '#b91c1c',
  },
});
