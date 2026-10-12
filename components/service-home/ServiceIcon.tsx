import { Image, View } from 'react-native';

export type ServiceName = 'care' | 'insurance' | 'telecom' | 'rental' | 'car' | 'hospital';

const images = {
  care: { source: require('@/assets/images/service-home/care.png'), scale: 1.06 },
  insurance: { source: require('@/assets/images/service-home/insurance.png'), scale: 1.2 },
  telecom: { source: require('@/assets/images/service-home/telecom.png'), scale: 1.12 },
  rental: { source: require('@/assets/images/service-home/rental.png'), scale: 1.08 },
  car: { source: require('@/assets/images/service-home/car.png'), scale: 1.24 },
  hospital: { source: require('@/assets/images/service-home/hospital.png'), scale: 1 },
} as const;

/** Decorative service artwork. The owning button supplies its accessible name. */
export function ServiceIcon({ service, size = 48 }: { service: ServiceName; size?: number }) {
  const { source, scale } = images[service];
  return (
    <View
      style={{ width: size, height: size, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={source} style={{ width: size * scale, height: size * scale }} resizeMode="contain" accessible={false} />
    </View>
  );
}
