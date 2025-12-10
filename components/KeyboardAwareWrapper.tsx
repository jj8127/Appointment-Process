import { ReactElement, ReactNode } from 'react';
import { RefreshControlProps, ViewStyle } from 'react-native';
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
    <KeyboardAwareScrollView
      enableOnAndroid
      enableAutomaticScroll
      nestedScrollEnabled
      keyboardDismissMode="interactive" // 입력창을 잡고 드래그해도 스크롤 우선, 필요 시 자연스럽게 닫힘
      keyboardOpeningTime={0}
      extraScrollHeight={extraScrollHeight}
      keyboardShouldPersistTaps="handled" // 터치 시 스크롤/탭 모두 처리
      scrollEnabled
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
      style={style}
      refreshControl={refreshControl}
      onScrollBeginDrag={() => {
        // 스크롤 제스처가 발생하는지 확인용 (필요 시 콘솔에서 확인)
        // console.log('[KeyboardAwareWrapper] scroll begin');
      }}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
