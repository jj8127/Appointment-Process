import { Text } from 'react-native';

import ServiceInformation, { informationStyles as styles } from '@/components/ServiceInformation';

export default function ServiceActivity() {
  return <ServiceInformation title="이용내역" activity>
    <Text style={styles.badge}>준비 중</Text>
    <Text accessibilityRole="header" style={styles.title}>서비스 이용내역</Text>
    <Text style={styles.body}>서비스 이용 방법이 확정되면 내역을 확인할 수 있습니다.</Text>
  </ServiceInformation>;
}
