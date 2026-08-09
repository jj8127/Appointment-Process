import { useEffect, useState } from 'react';
import { Keyboard, KeyboardEvent, Platform } from 'react-native';

/**
 * Returns extra bottom padding to lift content above the keyboard.
 * On Android the native window is resized via `softwareKeyboardLayoutMode:
 * resize`, so the keyboard height is intentionally not added a second time.
 */
export function useKeyboardPadding() {
  const [padding, setPadding] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidShow' : 'keyboardWillShow',
      (event: KeyboardEvent) =>
        setPadding(Platform.OS === 'android' ? 0 : event.endCoordinates.height),
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
 * Android uses the native `adjustResize` layout mode.  Consumers must not add
 * the Android keyboard height a second time because the window has already
 * been resized by the OS.  Chat composers still need to know whether the
 * keyboard is open so they can keep their small resting gap.
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
