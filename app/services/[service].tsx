import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import ServiceInformation, { ServiceAction, informationStyles as styles } from '@/components/ServiceInformation';
import { resolveServiceInformationKey, SERVICE_INFORMATION_KEYS } from '@/lib/service-home';

export function generateStaticParams() {
  return SERVICE_INFORMATION_KEYS.map((service) => ({ service }));
}

export default function ServiceInformationRoute() {
  const { service } = useLocalSearchParams();
  const key = resolveServiceInformationKey(service);
  const home = () => router.replace('/');
  if (!key) return <ServiceInformation title="서비스 안내">
    <Text accessibilityRole="header" style={styles.title}>서비스를 찾을 수 없어요</Text>
    <Text style={styles.body}>홈에서 이용할 서비스를 다시 선택해 주세요.</Text>
    <ServiceAction label="서비스 홈으로" onPress={home} />
  </ServiceInformation>;

  if (key === 'help') return <ServiceInformation title="이용 안내">
    <Text accessibilityRole="header" style={styles.title}>먼저 서비스를 살펴보세요</Text>
    <View style={styles.list}>
      <Text style={styles.item}>서비스 안내는 로그인 전에 확인할 수 있습니다.</Text>
      <Text style={styles.item}>보험·FC 업무는 기존 FC 계정으로 로그인한 후 이용합니다. 필요한 본인확인은 업무 진입 시 안내합니다.</Text>
      <Text style={styles.item}>현재 회원가입은 FC 업무용입니다. 일반 소비자 서비스의 가입 절차는 서비스 오픈 시 안내합니다.</Text>
      <Text style={styles.item}>가족간병은 이용 전 확인사항을 안내합니다. 간병 신청·통신·자동차 서비스는 아직 제공하지 않습니다.</Text>
    </View>
    <ServiceAction label="서비스 홈으로" onPress={home} />
  </ServiceInformation>;

  if (key === 'care') return <ServiceInformation title="가족간병 안내" service="care">
    <Text style={styles.badge}>신청 서비스 준비 중</Text>
    <Text accessibilityRole="header" style={styles.title}>이용 전 확인할 정보</Text>
    <Text style={styles.body}>간병이 필요한 시기와 가족 관계, 문의할 내용을 먼저 확인해 보세요.</Text>
    <View style={styles.list}>
      <Text style={styles.item}>간병이 필요한 시기와 예상 기간</Text>
      <Text style={styles.item}>환자와 간병을 맡을 가족의 관계</Text>
      <Text style={styles.item}>이용하려는 서비스와 문의할 내용</Text>
    </View>
    <Text style={styles.body}>현재는 안내만 제공합니다. 신청은 아직 받지 않으며, 신청 절차와 이용 조건은 서비스 오픈 시 안내합니다.</Text>
    <ServiceAction label="서비스 홈으로" onPress={home} />
  </ServiceInformation>;

  const title = key === 'telecom' ? '통신' : '자동차';
  return <ServiceInformation title={title} service={key}>
    <Text style={styles.badge}>제휴 준비 중</Text>
    <Text accessibilityRole="header" style={styles.title}>{title} 혜택을 준비하고 있어요</Text>
    <Text style={styles.body}>제휴 상품과 이용 조건은 확정되면 안내합니다. 현재는 구매·신청을 받지 않습니다.</Text>
    <ServiceAction label="서비스 홈으로" onPress={home} />
  </ServiceInformation>;
}
