import { router } from 'expo-router';
import { Text } from 'react-native';

import ServiceInformation, { ServiceAction, informationStyles as styles } from '@/components/ServiceInformation';
import { useSession } from '@/hooks/use-session';
import { resolveInsuranceServiceRoute } from '@/lib/service-home';

export default function ServiceActivity() {
  const session = useSession();
  return <ServiceInformation title="이용내역" activity>
    <Text style={styles.badge}>준비 중</Text>
    <Text accessibilityRole="header" style={styles.title}>서비스 이용내역</Text>
    <Text style={styles.body}>통합 이용내역은 준비 중입니다. 보험·FC 업무의 진행 상태는 기존 업무 화면에서 확인할 수 있습니다.</Text>
    <ServiceAction label={session.role ? '보험·FC 진행 상태 보기' : 'FC 계정으로 로그인'} onPress={() => {
      const route = resolveInsuranceServiceRoute(session);
      if (route) router.push(route);
    }} />
  </ServiceInformation>;
}
