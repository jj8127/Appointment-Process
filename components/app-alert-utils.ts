export type ButtonStyle = 'default' | 'cancel' | 'destructive';

export type AppAlertButton = {
  text?: string;
  onPress?: () => void;
  style?: ButtonStyle;
};

export function resolveAlertButtonByIndex(buttons: readonly AppAlertButton[], buttonIndex?: number | null) {
  if (typeof buttonIndex !== 'number' || !Number.isInteger(buttonIndex)) return undefined;
  if (buttonIndex < 0 || buttonIndex >= buttons.length) return undefined;
  return buttons[buttonIndex];
}

export function hasCallableAlertAction(
  button?: { onPress?: unknown } | null,
): button is { onPress: () => void } {
  return typeof button?.onPress === 'function';
}
