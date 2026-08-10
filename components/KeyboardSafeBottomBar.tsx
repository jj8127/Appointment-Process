import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  type KeyboardEvent,
  Platform,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import { getKeyboardFrameOverlap } from '@/lib/mobile-keyboard-layout';

type KeyboardSafeBottomBarProps = PropsWithChildren<{
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardVerticalOffset?: number;
  style?: StyleProp<ViewStyle>;
}>;

/**
 * Keeps a fixed bottom input surface above the measured keyboard overlap.
 *
 * Android detail sheets are absolutely positioned and do not consistently
 * inherit the native window resize. Measure the bar and the keyboard in the
 * same screen coordinate space, then move only by their actual overlap.
 */
export function KeyboardSafeBottomBar({
  children,
  contentContainerStyle,
  keyboardVerticalOffset = 0,
  style,
}: KeyboardSafeBottomBarProps) {
  const androidBarRef = useRef<View>(null);
  const keyboardTopRef = useRef<number | null>(null);
  const overlapRef = useRef(0);
  const [androidOverlap, setAndroidOverlap] = useState(0);

  const measureAndroidOverlap = useCallback((keyboardTop: number) => {
    requestAnimationFrame(() => {
      if (keyboardTopRef.current !== keyboardTop) return;
      androidBarRef.current?.measureInWindow((_x, y, _width, height) => {
        if (keyboardTopRef.current !== keyboardTop) return;
        const untranslatedBottom = y + height + overlapRef.current;
        const nextOverlap = getKeyboardFrameOverlap({
          keyboardTop,
          viewBottom: untranslatedBottom,
          verticalOffset: keyboardVerticalOffset,
        });
        overlapRef.current = nextOverlap;
        setAndroidOverlap(nextOverlap);
      });
    });
  }, [keyboardVerticalOffset]);

  const handleAndroidKeyboardFrame = useCallback((event: KeyboardEvent) => {
    keyboardTopRef.current = event.endCoordinates.screenY;
    measureAndroidOverlap(event.endCoordinates.screenY);
  }, [measureAndroidOverlap]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', handleAndroidKeyboardFrame);
    const changeFrame = Keyboard.addListener(
      'keyboardDidChangeFrame',
      handleAndroidKeyboardFrame,
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTopRef.current = null;
      overlapRef.current = 0;
      setAndroidOverlap(0);
    });

    return () => {
      show.remove();
      changeFrame.remove();
      hide.remove();
    };
  }, [handleAndroidKeyboardFrame]);

  if (Platform.OS === 'android') {
    return (
      <View
        ref={androidBarRef}
        onLayout={() => {
          const keyboardMetrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined;
          const keyboardTop = keyboardTopRef.current ?? keyboardMetrics?.screenY ?? null;
          if (keyboardTop !== null) {
            keyboardTopRef.current = keyboardTop;
            measureAndroidOverlap(keyboardTop);
          }
        }}
        style={[
          style,
          androidOverlap > 0
            ? { marginBottom: androidOverlap }
            : undefined,
        ]}
      >
        <View style={contentContainerStyle}>{children}</View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={style}
    >
      <View style={contentContainerStyle}>{children}</View>
    </KeyboardAvoidingView>
  );
}
