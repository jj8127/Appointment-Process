import { createContext, ReactElement, ReactNode, Ref, useCallback, useContext, useEffect, useImperativeHandle, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Platform, RefreshControlProps, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

type KeyboardAwareContextType = {
  scrollToInput: (reactNode: any) => void;
};

const KeyboardAwareContext = createContext<KeyboardAwareContextType>({
  scrollToInput: () => { },
});

const DEFAULT_EXTRA_SCROLL_HEIGHT = Platform.OS === 'android' ? 180 : 96;
const SCROLL_SETTLE_MS = 150;

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

  // Android Fabric can drop the native scroll offset when a React commit races its state update.
  // Children are then measured at a stale offset, so Pressable cancels any tap whose finger moves
  // even slightly. Native resends the offset only when it changes, so once scrolling settles we
  // move 1px and back within one frame.
  const scrollY = useRef(0);
  const lastScrollAt = useRef(0);
  const syncTarget = useRef<number | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleScrollStateSync = useCallback(() => {
    if (Platform.OS !== 'android') return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(function sync() {
      syncTimer.current = null;
      const y = Math.round(scrollY.current);
      if (y < 1 || !scrollViewRef.current) return;
      if (Date.now() - lastScrollAt.current < SCROLL_SETTLE_MS) {
        syncTimer.current = setTimeout(sync, SCROLL_SETTLE_MS);
        return;
      }
      syncTarget.current = y;
      scrollViewRef.current.scrollToPosition(0, y - 1, false);
      scrollViewRef.current.scrollToPosition(0, y, false);
    }, SCROLL_SETTLE_MS);
  }, []);
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    if (syncTarget.current !== null && Math.abs(Math.round(y) - syncTarget.current) <= 1) {
      // Our own nudge: do not treat it as user scrolling or schedule another sync.
      if (Math.round(y) === syncTarget.current) syncTarget.current = null;
      return;
    }
    syncTarget.current = null;
    scrollY.current = y;
    lastScrollAt.current = Date.now();
    scheduleScrollStateSync();
  }, [scheduleScrollStateSync]);
  // Any re-render can commit over the native offset, so resync after it settles.
  useEffect(() => { scheduleScrollStateSync(); });
  useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current); }, []);

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
        onScroll={handleScroll}
        onContentSizeChange={scheduleScrollStateSync}
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
