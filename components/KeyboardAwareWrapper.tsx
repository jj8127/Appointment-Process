import { ReactNode, ReactElement } from 'react';
import { Keyboard, TouchableWithoutFeedback, ViewStyle, RefreshControlProps } from 'react-native';
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
        keyboardOpeningTime={0}
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
