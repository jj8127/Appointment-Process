import { Image } from 'react-native';

export type ServiceName = 'care' | 'insurance' | 'telecom' | 'car';

const images = {
  care: require('@/assets/images/service-home/care.png'),
  insurance: require('@/assets/images/service-home/insurance.png'),
  telecom: require('@/assets/images/service-home/telecom.png'),
  car: require('@/assets/images/service-home/car.png'),
} as const;

/** Decorative service artwork. The owning button supplies its accessible name. */
export function ServiceIcon({ service, size = 48 }: { service: ServiceName; size?: number }) {
  return (
    <Image
      source={images[service]}
      style={{ width: size, height: size, flexShrink: 0 }}
      resizeMode="contain"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
