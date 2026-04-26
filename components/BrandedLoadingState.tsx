import { StyleSheet, View } from 'react-native';

import type { MessengerLoadingVariant } from '@/lib/messenger-loading';
import { COLORS, SPACING } from '@/lib/theme';

import BrandedLoadingSpinner from './BrandedLoadingSpinner';

type Props = {
  variant?: MessengerLoadingVariant;
  title?: string;
  subtitle?: string;
  layout?: 'screen' | 'section';
};

export default function BrandedLoadingState({
  layout = 'screen',
}: Props) {
  return (
    <View style={[styles.container, layout === 'section' ? styles.sectionContainer : styles.screenContainer]}>
      <BrandedLoadingSpinner
        size={layout === 'section' ? 'md' : 'lg'}
        color={COLORS.primary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  screenContainer: {
    flex: 1,
  },
  sectionContainer: {
    minHeight: 72,
  },
});
