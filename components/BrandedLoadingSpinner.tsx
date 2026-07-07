import {
  ActivityIndicator,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

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
  const {
    indicatorSize,
    wrapperSize,
  } = getBrandedLoadingSpinnerConfig(size);

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
      <ActivityIndicator color={color} size={indicatorSize} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
