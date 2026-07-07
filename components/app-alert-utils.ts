export type ButtonStyle = 'default' | 'cancel' | 'destructive';

export type AppAlertButton = {
  text?: string;
  onPress?: () => void;
  style?: ButtonStyle;
};

export type AlertButtonAction = {
  onPress?: unknown;
};

export function resolveAlertButtonByIndex<T>(buttons: readonly T[], buttonIndex?: number | null): T | undefined {
  if (typeof buttonIndex !== 'number' || !Number.isInteger(buttonIndex)) return undefined;
  if (buttonIndex < 0 || buttonIndex >= buttons.length) return undefined;
  return buttons[buttonIndex];
}

export function resolveAlertButtonIndex<T>(
  buttons: readonly T[],
  button: T | undefined,
): number {
  if (!button) {
    return -1;
  }

  return buttons.indexOf(button);
}

export function hasCallableAlertAction(
  button?: { onPress?: unknown } | null,
): button is { onPress: () => void } {
  return typeof button?.onPress === 'function';
}

export function invokeAlertButtonByIndex(
  buttons: readonly AlertButtonAction[],
  buttonIndex: number,
  dismiss: () => void,
): void {
  const button = resolveAlertButtonByIndex(buttons, buttonIndex);

  if (hasCallableAlertAction(button)) {
    button.onPress();
  }

  dismiss();
}
