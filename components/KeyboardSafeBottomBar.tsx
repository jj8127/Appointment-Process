import type { PropsWithChildren } from 'react';
import {
  KeyboardAvoidingView,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

type KeyboardSafeBottomBarProps = PropsWithChildren<{
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardVerticalOffset?: number;
  style?: StyleProp<ViewStyle>;
}>;

/**
 * Keeps a fixed bottom input surface above the measured keyboard overlap.
 *
 * `padding` is intentional on both platforms: React Native resolves the
 * remaining overlap to zero when the native window already resized and adds
 * space when an edge-to-edge/custom-modal layout still extends behind the IME.
 */
export function KeyboardSafeBottomBar({
  children,
  contentContainerStyle,
  keyboardVerticalOffset = 0,
  style,
}: KeyboardSafeBottomBarProps) {
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
