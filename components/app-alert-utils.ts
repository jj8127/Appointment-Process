export type AlertButtonAction = {
  onPress?: unknown;
};

export function resolveAlertButtonIndex<T>(
  buttons: readonly T[],
  button: T | undefined,
): number {
  if (!button) {
    return -1;
  }

  return buttons.indexOf(button);
}

export function invokeAlertButtonByIndex(
  buttons: readonly AlertButtonAction[],
  buttonIndex: number,
  dismiss: () => void,
): void {
  const button = Number.isInteger(buttonIndex) && buttonIndex >= 0
    ? buttons[buttonIndex]
    : undefined;

  if (typeof button?.onPress === 'function') {
    button.onPress();
  }

  dismiss();
}
