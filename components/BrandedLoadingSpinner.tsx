import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  getBrandedLoadingSpinnerConfig,
  type BrandedLoadingSpinnerSize,
} from '@/lib/branded-loading-spinner';
import { COLORS } from '@/lib/theme';

type Props = {
  size?: BrandedLoadingSpinnerSize;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

export default function BrandedLoadingSpinner({
  size = 'md',
  color = COLORS.primary,
  style,
}: Props) {
  const spinValue = useRef(new Animated.Value(0)).current;
  const {
    arcPath,
    arrowHeadPath,
    iconSize,
    strokeWidth,
    viewBox,
  } = getBrandedLoadingSpinnerConfig(size);

  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    spinLoop.start();

    return () => {
      spinLoop.stop();
      spinValue.stopAnimation();
    };
  }, [spinValue]);

  const rotate = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const wrapperSize = useMemo(() => iconSize + 6, [iconSize]);

  return (
    <View
      style={[
        styles.wrap,
        {
          width: wrapperSize,
          height: wrapperSize,
        },
        style,
      ]}
    >
      <Animated.View style={styles.iconWrap}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Svg width={iconSize} height={iconSize} viewBox={viewBox} fill="none">
            <Path
              d={arcPath}
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={strokeWidth}
            />
            <Path
              d={arrowHeadPath}
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={strokeWidth}
            />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
