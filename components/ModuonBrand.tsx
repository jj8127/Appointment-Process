import { Image, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/lib/theme';

export default function ModuonBrand() {
  return <View style={styles.brand} accessible accessibilityLabel="모두온">
    <View style={styles.symbol}>
      <Image source={require('@/assets/images/moduon/moduon-symbol.png')} style={styles.image} resizeMode="contain" accessible={false} />
    </View>
    <Text style={styles.name}>모두온</Text>
  </View>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  symbol: { width: 38, height: 30, overflow: 'hidden' },
  image: { width: 44, height: 44, position: 'absolute', left: -3, top: -7 },
  name: { fontSize: 22, fontWeight: '700', color: COLORS.text.primary, letterSpacing: -0.8, flexShrink: 1 },
});
