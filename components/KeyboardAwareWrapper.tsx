import { createContext, ReactElement, ReactNode, Ref, useContext, useImperativeHandle, useRef } from 'react';
import { Platform, RefreshControlProps, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

type KeyboardAwareContextType = {
  scrollToInput: (reactNode: any) => void;
};

const KeyboardAwareContext = createContext<KeyboardAwareContextType>({
  scrollToInput: () => { },
});

const DEFAULT_EXTRA_SCROLL_HEIGHT = Platform.OS === 'android' ? 180 : 96;

export const useKeyboardAware = () => useContext(KeyboardAwareContext);

/** Imperative handle for screens that must reveal a content offset (e.g. a field error). */
export type KeyboardAwareWrapperHandle = { scrollToY: (y: number) => void };

type Props = {
  children: ReactNode;
  contentContainerStyle?: ViewStyle | ViewStyle[];
  style?: ViewStyle;
  extraScrollHeight?: number;
  refreshControl?: ReactElement<RefreshControlProps>;
  keyboardShouldPersistTaps?: 'always' | 'handled' | 'never';
  keyboardDismissMode?: 'none' | 'interactive' | 'on-drag';
  handleRef?: Ref<KeyboardAwareWrapperHandle>;
};

export function KeyboardAwareWrapper({
  children,
  contentContainerStyle,
  style,
  extraScrollHeight = DEFAULT_EXTRA_SCROLL_HEIGHT,
  refreshControl,
  keyboardShouldPersistTaps = 'always',
  keyboardDismissMode = 'none',
  handleRef,
}: Props) {
  const scrollViewRef = useRef<KeyboardAwareScrollView>(null);
  useImperativeHandle(handleRef, () => ({
    scrollToY: (y: number) => scrollViewRef.current?.scrollToPosition(0, Math.max(0, y), true),
  }), []);

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
        // Animating back on keyboard hide captures the next tap and moves targets away from the finger.
        enableResetScrollToCoords={false}
        keyboardDismissMode={keyboardDismissMode}
        keyboardOpeningTime={0}
        extraScrollHeight={extraScrollHeight}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        // A stray scroll event during a tap must not let the JS scroll responder cancel the pressed child;
        // native drag-to-scroll does not depend on it.
        disableScrollViewPanResponder
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
