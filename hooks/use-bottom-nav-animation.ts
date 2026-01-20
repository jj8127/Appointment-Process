import {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  SharedValue,
} from 'react-native-reanimated';

interface UseBottomNavAnimationOptions {
  /** 아래로 스크롤 시 숨김 임계값 (default: 10) */
  hideThreshold?: number;
  /** 위로 스크롤 시 표시 임계값 (default: -10) */
  showThreshold?: number;
  /** 숨김 시 이동 거리 (default: 200) */
  translateDistance?: number;
  /** 애니메이션 지속 시간 ms (default: 300) */
  duration?: number;
}

interface UseBottomNavAnimationReturn {
  /** ScrollView의 onScroll에 전달할 핸들러 */
  scrollHandler: ReturnType<typeof useAnimatedScrollHandler>;
  /** Animated.View의 style에 전달할 애니메이션 스타일 */
  animatedStyle: { transform: { translateY: number }[] };
  /** FAB 등 다른 요소와 동기화하기 위한 translateY 값 */
  translateY: SharedValue<number>;
  /** 네비게이션 바를 즉시 표시 */
  show: () => void;
  /** 네비게이션 바를 즉시 숨김 */
  hide: () => void;
}

/**
 * 스크롤에 따라 하단 네비게이션 바를 숨기거나 표시하는 애니메이션 훅
 *
 * @example
 * ```tsx
 * const { scrollHandler, animatedStyle, translateY } = useBottomNavAnimation();
 *
 * return (
 *   <>
 *     <Animated.ScrollView onScroll={scrollHandler} scrollEventThrottle={16}>
 *       {content}
 *     </Animated.ScrollView>
 *     <Animated.View style={[styles.bottomNav, animatedStyle]}>
 *       {navItems}
 *     </Animated.View>
 *   </>
 * );
 * ```
 */
export function useBottomNavAnimation(
  options?: UseBottomNavAnimationOptions
): UseBottomNavAnimationReturn {
  const {
    hideThreshold = 10,
    showThreshold = -10,
    translateDistance = 200,
    duration = 300,
  } = options ?? {};

  const lastScrollY = useSharedValue(0);
  const bottomNavTranslateY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const currentY = event.contentOffset.y;
      const dy = currentY - lastScrollY.value;

      if (currentY < 0) {
        // 맨 위로 당겼을 때 (bounce) - 네비게이션 표시
        bottomNavTranslateY.value = withTiming(0, { duration });
      } else if (currentY > 0) {
        if (dy > hideThreshold) {
          // 아래로 스크롤 - 네비게이션 숨김
          bottomNavTranslateY.value = withTiming(translateDistance, { duration });
        } else if (dy < showThreshold) {
          // 위로 스크롤 - 네비게이션 표시
          bottomNavTranslateY.value = withTiming(0, { duration });
        }
      }
      lastScrollY.value = currentY;
    },
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bottomNavTranslateY.value }],
  }));

  const show = () => {
    bottomNavTranslateY.value = withTiming(0, { duration });
  };

  const hide = () => {
    bottomNavTranslateY.value = withTiming(translateDistance, { duration });
  };

  return {
    scrollHandler,
    animatedStyle,
    translateY: bottomNavTranslateY,
    show,
    hide,
  };
}
