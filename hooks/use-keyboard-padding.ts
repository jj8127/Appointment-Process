import { useEffect, useState } from 'react';
import { Keyboard, KeyboardEvent, Platform } from 'react-native';

/**
 * Returns extra bottom padding to lift content above the keyboard.
 */
export function useKeyboardPadding() {
  const [padding, setPadding] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidShow' : 'keyboardWillShow',
      (event: KeyboardEvent) => setPadding(event.endCoordinates.height),
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
