import { useEffect, useState } from 'react';
import { Keyboard, KeyboardEvent, Platform } from 'react-native';

import { normalizeKeyboardPadding } from '@/lib/mobile-keyboard-layout';

/**
 * Returns explicit scroll room equal to the reported keyboard height.
 *
 * Android callers using a plain ScrollView depend on this even when
 * `softwareKeyboardLayoutMode` is `resize`: edge-to-edge and custom overlay
 * layouts do not consistently receive a usable resize on every device.
 * Fixed bottom bars should use KeyboardAvoidingView/KeyboardSafeBottomBar so
 * their actual screen-frame overlap is resolved instead of adding this height
 * directly to their position.
 */
export function useKeyboardPadding() {
  const [padding, setPadding] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidShow' : 'keyboardWillShow',
      (event: KeyboardEvent) => setPadding(normalizeKeyboardPadding(event.endCoordinates.height)),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidHide' : 'keyboardWillHide',
      () => setPadding(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return padding;
}

/**
 * Reports keyboard visibility without exposing the keyboard height.
 *
 * Chat composers use visibility to keep a small resting gap while their
 * KeyboardAvoidingView owns the actual measured overlap.
 */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidShow' : 'keyboardWillShow',
      () => setVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidHide' : 'keyboardWillHide',
      () => setVisible(false),
    );

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}
