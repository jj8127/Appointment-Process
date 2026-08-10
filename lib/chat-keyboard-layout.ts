export const CHAT_COMPOSER_KEYBOARD_GAP = 8;

type ChatComposerBottomPaddingInput = {
  keyboardHeight?: number;
  keyboardVisible?: boolean;
  platform: 'android' | 'ios' | 'macos' | 'web' | 'windows';
  safeAreaBottom: number;
};

export function getChatComposerBottomPadding({
  keyboardHeight,
  keyboardVisible,
  platform,
  safeAreaBottom,
}: ChatComposerBottomPaddingInput): number {
  const isKeyboardOpen =
    keyboardVisible ??
    (typeof keyboardHeight === 'number' && Number.isFinite(keyboardHeight) && keyboardHeight > 0);
  if (isKeyboardOpen) {
    return CHAT_COMPOSER_KEYBOARD_GAP;
  }

  const normalizedSafeArea = Number.isFinite(safeAreaBottom)
    ? Math.max(0, safeAreaBottom)
    : 0;
  const minimumRestingInset = platform === 'android' ? 20 : 12;
  return Math.max(normalizedSafeArea, minimumRestingInset);
}
