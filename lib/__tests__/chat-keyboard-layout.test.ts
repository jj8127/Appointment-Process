import {
  CHAT_COMPOSER_KEYBOARD_GAP,
  getChatComposerBottomPadding,
} from '@/lib/chat-keyboard-layout';

describe('mobile chat keyboard layout', () => {
  it('uses the same compact gap while the keyboard is visible', () => {
    for (const platform of ['ios', 'android'] as const) {
      for (const safeAreaBottom of [0, 12, 21, 34]) {
        expect(getChatComposerBottomPadding({
          keyboardHeight: 320,
          platform,
          safeAreaBottom,
        })).toBe(CHAT_COMPOSER_KEYBOARD_GAP);
      }
    }
  });

  it('restores device safe area only after the keyboard closes', () => {
    expect(getChatComposerBottomPadding({
      keyboardHeight: 0,
      platform: 'ios',
      safeAreaBottom: 34,
    })).toBe(34);
    expect(getChatComposerBottomPadding({
      keyboardHeight: 0,
      platform: 'ios',
      safeAreaBottom: 0,
    })).toBe(12);
    expect(getChatComposerBottomPadding({
      keyboardHeight: 0,
      platform: 'android',
      safeAreaBottom: 0,
    })).toBe(20);
  });
});
