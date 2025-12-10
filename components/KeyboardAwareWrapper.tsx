import { ReactElement, ReactNode } from 'react';
import { Keyboard, RefreshControlProps, TouchableWithoutFeedback, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

type Props = {
  children: ReactNode;
  contentContainerStyle?: ViewStyle | ViewStyle[];
  style?: ViewStyle;
  extraScrollHeight?: number;
  refreshControl?: ReactElement<RefreshControlProps>;
};

export function KeyboardAwareWrapper({
  children,
  contentContainerStyle,
  style,
  extraScrollHeight = 24,
  refreshControl,
}: Props) {
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAwareScrollView
        enableOnAndroid
        enableAutomaticScroll
        enableResetScrollToCoords={false}
        extraScrollHeight={extraScrollHeight}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={contentContainerStyle}
        style={style}
        refreshControl={refreshControl}>
        {children}
      </KeyboardAwareScrollView>
    </TouchableWithoutFeedback>
  );
}
