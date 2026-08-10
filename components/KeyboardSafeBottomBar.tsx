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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getAndroidKeyboardFootprint,
  getKeyboardOverlapFromRestingFrame,
} from '@/lib/mobile-keyboard-layout';

type KeyboardSafeBottomBarProps = PropsWithChildren<{
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardVerticalOffset?: number;
  style?: StyleProp<ViewStyle>;
}>;

/**
 * Keeps a fixed bottom input surface above the measured keyboard overlap.
 *
 * Android detail sheets do not consistently inherit native window resize.
 * Compare the bar's resting frame with its live frame, then add only the IME
 * movement the native window has not already applied.
 */
export function KeyboardSafeBottomBar({
  children,
  contentContainerStyle,
  keyboardVerticalOffset = 0,
  style,
}: KeyboardSafeBottomBarProps) {
  const safeAreaInsets = useSafeAreaInsets();
  const androidBarRef = useRef<View>(null);
  const keyboardFootprintRef = useRef<number | null>(null);
  const overlapRef = useRef(0);
  const restingBottomRef = useRef<number | null>(null);
  const [androidOverlap, setAndroidOverlap] = useState(0);

  const measureRestingBottom = useCallback(() => {
    requestAnimationFrame(() => {
      androidBarRef.current?.measureInWindow((_x, y, _width, height) => {
        if (keyboardFootprintRef.current !== null) return;
        restingBottomRef.current = y + height;
      });
    });
  }, []);

  const measureAndroidOverlap = useCallback((keyboardFootprint: number) => {
    requestAnimationFrame(() => {
      if (keyboardFootprintRef.current !== keyboardFootprint) return;
      androidBarRef.current?.measureInWindow((_x, y, _width, height) => {
        if (keyboardFootprintRef.current !== keyboardFootprint) return;
        const untranslatedBottom = y + height + overlapRef.current;
        const restingBottom = restingBottomRef.current ?? untranslatedBottom;
        const nextOverlap = getKeyboardOverlapFromRestingFrame({
          keyboardFootprint,
          restingBottom,
          verticalOffset: keyboardVerticalOffset,
          viewBottom: untranslatedBottom,
        });
        overlapRef.current = nextOverlap;
        setAndroidOverlap(nextOverlap);
      });
    });
  }, [keyboardVerticalOffset]);

  const getKeyboardFootprint = useCallback((keyboardHeight: number) => (
    getAndroidKeyboardFootprint({
      androidApiLevel: Platform.Version,
      keyboardHeight,
      safeAreaBottom: safeAreaInsets.bottom,
    })
  ), [safeAreaInsets.bottom]);

  const handleAndroidKeyboardFrame = useCallback((event: KeyboardEvent) => {
    const keyboardFootprint = getKeyboardFootprint(event.endCoordinates.height);
    keyboardFootprintRef.current = keyboardFootprint;
    measureAndroidOverlap(keyboardFootprint);
  }, [getKeyboardFootprint, measureAndroidOverlap]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', handleAndroidKeyboardFrame);
    const changeFrame = Keyboard.addListener(
      'keyboardDidChangeFrame',
      handleAndroidKeyboardFrame,
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardFootprintRef.current = null;
      overlapRef.current = 0;
      setAndroidOverlap(0);
      measureRestingBottom();
    });

    return () => {
      show.remove();
      changeFrame.remove();
      hide.remove();
    };
  }, [handleAndroidKeyboardFrame, measureRestingBottom]);

  if (Platform.OS === 'android') {
    return (
      <View
        ref={androidBarRef}
        onLayout={() => {
          const keyboardMetrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined;
          if (keyboardMetrics) {
            const keyboardFootprint = keyboardFootprintRef.current
              ?? getKeyboardFootprint(keyboardMetrics.height);
            keyboardFootprintRef.current = keyboardFootprint;
            measureAndroidOverlap(keyboardFootprint);
          } else {
            keyboardFootprintRef.current = null;
            measureRestingBottom();
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
