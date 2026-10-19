import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { inferAlertVariantFromTitle, inferUserFacingAlertFallback, toUserFacingAlertMessage } from '@/lib/user-facing-error';
import {
  hasCallableAlertAction,
  resolveAlertButtonByIndex,
  type AppAlertButton,
} from '@/components/app-alert-utils';

type AlertVariant = 'info' | 'success' | 'warning' | 'error';

type AppAlertOptions = {
  cancelable?: boolean;
  variant?: AlertVariant;
};

type AppAlert = {
  id: number;
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
      text: [styles.buttonText, styles.buttonTextOnFill],
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
    text: [styles.buttonText, styles.buttonTextOnFill],
  };
}

/**
 * Platform dialog convention: in a row the dismissive action sits on the
 * leading side; in a stack the primary action leads and cancel goes last.
 * Original indexes are kept so dispatch still resolves the caller's button.
 */
function orderButtons(buttons: AppAlertButton[]) {
  const indexed = buttons.map((button, index) => ({ button, index }));
  const cancels = indexed.filter(({ button }) => button.style === 'cancel');
  const others = indexed.filter(({ button }) => button.style !== 'cancel');
  return buttons.length > 2 ? [...others, ...cancels] : [...cancels, ...others];
}

function AlertCard({
  alert,
  onButtonPress,
}: {
  alert: AppAlert;
  onButtonPress: (buttonIndex?: number) => void;
}) {
  const isStacked = (alert.buttons?.length ?? 0) > 2;

  return (
    <Pressable
      style={styles.backdrop}
      onPress={() => {
        if (alert.options?.cancelable) {
          const cancelButtonIndex = alert.buttons.findIndex((button) => button.style === 'cancel');
          onButtonPress(cancelButtonIndex >= 0 ? cancelButtonIndex : undefined);
        }
      }}
    >
      {/* Modal visibility must never depend on a worklet or animation callback.
          Store navigation/backgrounding can interrupt those callbacks. */}
      <View style={styles.card} onStartShouldSetResponder={() => true} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.title}>{alert.title}</Text>

        {!!alert.message && <Text style={styles.message}>{alert.message}</Text>}

        <View style={[styles.buttonRow, isStacked && styles.buttonStack]}>
          {orderButtons(alert.buttons).map(({ button, index }) => {
            const buttonStyle = resolveButtonStyle(button);
            return (
              <Pressable
                key={`${button.text ?? 'button'}-${index}`}
                style={({ pressed }) => [
                  buttonStyle.container,
                  isStacked ? styles.buttonFull : styles.buttonFlex,
                  pressed && styles.buttonPressed,
                ]}
                accessibilityRole="button"
                onPress={() => onButtonPress(index)}
              >
                <Text style={buttonStyle.text}>{button.text ?? '확인'}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Pressable>
  );
}

export function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<AppAlert[]>([]);
  const queueRef = useRef<AppAlert[]>([]);
  const nextId = useRef(0);
  const currentAlert = queue[0] ?? null;
  const showRef = useRef<AppAlertHandler>(() => { });

  const showAlert = useCallback<AppAlertHandler>((title, message, buttons, options) => {
    const normalizedButtons = normalizeButtons(buttons);
    const normalizedMessage =
      typeof message === 'string'
        ? toUserFacingAlertMessage(message, inferUserFacingAlertFallback(title))
        : message;
    const normalizedOptions: AppAlertOptions = {
      ...options,
      variant: options?.variant ?? inferAlertVariantFromTitle(title),
    };
    const alert = { id: ++nextId.current, title, message: normalizedMessage, buttons: normalizedButtons, options: normalizedOptions };
    queueRef.current = [...queueRef.current, alert];
    setQueue(queueRef.current);
  }, []);

  const handleButtonPress = useCallback(
    (buttonIndex?: number) => {
      if (!currentAlert || queueRef.current[0]?.id !== currentAlert.id) return;
      const button = resolveAlertButtonByIndex(currentAlert.buttons, buttonIndex);
      // Claim and remove before invoking user code: a repeated press, thrown
      // action, synchronous navigation or follow-up alert cannot strand the modal.
      queueRef.current = queueRef.current.slice(1);
      setQueue(queueRef.current);
      if (hasCallableAlertAction(button)) {
        button.onPress();
      }
    },
    [currentAlert],
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
    const cancelButtonIndex = currentAlert.buttons.findIndex((button) => button.style === 'cancel');
    handleButtonPress(cancelButtonIndex >= 0 ? cancelButtonIndex : undefined);
  }, [currentAlert, handleButtonPress]);

  return (
    <AlertContext.Provider value={showAlert}>
      {children}
      <Modal visible={!!currentAlert} transparent animationType="none" statusBarTranslucent onRequestClose={handleBackdropPress}>
        {currentAlert && (
          <AlertCard key={currentAlert.id} alert={currentAlert} onButtonPress={handleButtonPress} />
        )}
      </Modal>
    </AlertContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.base,
    alignItems: 'stretch',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    lineHeight: TYPOGRAPHY.fontSize.lg * TYPOGRAPHY.lineHeight.normal,
    color: COLORS.text.primary,
  },
  message: {
    fontSize: TYPOGRAPHY.fontSize.base,
    lineHeight: TYPOGRAPHY.fontSize.base * TYPOGRAPHY.lineHeight.relaxed,
    color: COLORS.text.secondary,
    marginTop: SPACING.sm,
  },
  buttonRow: {
    marginTop: SPACING.xl,
    width: '100%',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  buttonStack: {
    flexDirection: 'column',
  },
  button: {
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.base,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonFlex: {
    flex: 1,
  },
  buttonFull: {
    width: '100%',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonPrimary: {
    backgroundColor: COLORS.primaryButton,
  },
  buttonSecondary: {
    backgroundColor: COLORS.gray[100],
  },
  buttonDestructive: {
    backgroundColor: COLORS.errorButton,
  },
  buttonText: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    textAlign: 'center',
  },
  buttonTextOnFill: {
    color: COLORS.white,
  },
  buttonTextSecondary: {
    color: COLORS.text.primary,
  },
});
