import { createContext, ReactElement, ReactNode, useContext, useRef } from 'react';
import { RefreshControlProps, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

type KeyboardAwareContextType = {
  scrollToInput: (reactNode: any) => void;
};

const KeyboardAwareContext = createContext<KeyboardAwareContextType>({
  scrollToInput: () => { },
});

export const useKeyboardAware = () => useContext(KeyboardAwareContext);

type Props = {
  children: ReactNode;
  contentContainerStyle?: ViewStyle | ViewStyle[];
  style?: ViewStyle;
  extraScrollHeight?: number;
  refreshControl?: ReactElement<RefreshControlProps>;
  keyboardShouldPersistTaps?: 'always' | 'handled' | 'never';
  keyboardDismissMode?: 'none' | 'interactive' | 'on-drag';
};

export function KeyboardAwareWrapper({
  children,
  contentContainerStyle,
  style,
  extraScrollHeight = 24,
  refreshControl,
  keyboardShouldPersistTaps = 'always',
  keyboardDismissMode = 'none',
}: Props) {
  const scrollViewRef = useRef<KeyboardAwareScrollView>(null);

  const scrollToInput = (reactNode: any) => {
    if (scrollViewRef.current && reactNode) {
      scrollViewRef.current.scrollToFocusedInput(reactNode);
    }
  };

  return (
    <KeyboardAwareContext.Provider value={{ scrollToInput }}>
      <KeyboardAwareScrollView
        ref={scrollViewRef}
        enableOnAndroid
        enableAutomaticScroll
        keyboardDismissMode={keyboardDismissMode}
        keyboardOpeningTime={0}
        extraScrollHeight={extraScrollHeight}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        removeClippedSubviews={false} // Android getChildDrawingOrder 보호
        scrollEnabled
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
        style={[{ flex: 1 }, style]}
        onScrollBeginDrag={() => {
          // console.log('[KeyboardAwareWrapper] scroll begin');
        }}
        refreshControl={refreshControl}
      >
        {children}
      </KeyboardAwareScrollView>
    </KeyboardAwareContext.Provider>
  );
}
