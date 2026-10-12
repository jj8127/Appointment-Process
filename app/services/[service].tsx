import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';

import ServiceInformation, { ServiceAction, informationStyles as styles } from '@/components/ServiceInformation';
import { FAMILY_CARE_PROMOTION_URL, resolveInsuranceServiceRoute, resolveServiceInformationKey, SERVICE_INFORMATION_KEYS } from '@/lib/service-home';
import { useSession } from '@/hooks/use-session';
import { openExternalUrl } from '@/lib/open-external-url';

export function generateStaticParams() {
  return SERVICE_INFORMATION_KEYS.map((service) => ({ service }));
}

export default function ServiceInformationRoute() {
  const { service } = useLocalSearchParams();
  const session = useSession();
  const key = resolveServiceInformationKey(service);
  const home = () => router.replace('/');
  const openCarePromotion = async () => {
    try {
      await openExternalUrl(FAMILY_CARE_PROMOTION_URL, { sameWindowOnWeb: true });
    } catch {
      Alert.alert('가족간병 안내를 열지 못했어요', '인터넷 연결을 확인한 뒤 다시 눌러 주세요.');
    }
  };
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
      <Text style={styles.item}>공통 회원가입은 한 번만 합니다. 서비스별로 필요한 추가 정보는 이용을 신청할 때 입력합니다.</Text>
      <Text style={styles.item}>추천 관계는 모든 서비스에서 하나로 연결합니다. 이용료 지급 비율과 정산은 제휴 서비스별로 다릅니다.</Text>
      <Text style={styles.item}>지급 대상 금액은 제휴사별 수수료 정산 완료일부터 일주일 이내에 정해진 비율로 지급합니다. 보험 증원수당과는 별도입니다.</Text>
      <Text style={styles.item}>준비 중인 서비스는 이용 방법이 확정되면 안내합니다.</Text>
    </View>
    <ServiceAction label="내 정보 · 회원가입" onPress={() => router.push('/services/account')} />
    <ServiceAction label="서비스 홈으로" onPress={home} />
  </ServiceInformation>;

  if (key === 'care') return <ServiceInformation title="가족간병 안내" service="care">
    <Text style={styles.badge}>준비 중</Text>
    <Text accessibilityRole="header" style={styles.title}>가족간병, 시작 전에 확인하세요</Text>
    <Text style={styles.body}>간병업체 소속·등록을 요구하는 보험은 간병업체 등록이 필수입니다. 가입한 보험의 조건과 등록 절차를 먼저 확인하세요.</Text>
    <View style={styles.list}>
      <Text style={styles.item}>간병이 필요한 시기와 예상 기간</Text>
      <Text style={styles.item}>환자와 간병을 맡을 가족의 관계</Text>
      <Text style={styles.item}>이용하려는 서비스와 문의할 내용</Text>
    </View>
    <Text style={styles.body}>가족간병 신청 서비스를 준비하고 있습니다. 이용 방법이 확정되면 안내합니다.</Text>
    <ServiceAction label="가족간병 자세히 알아보기" onPress={openCarePromotion} />
  </ServiceInformation>;

  if (key === 'insurance') return <ServiceInformation title="가람in · 보험" service="insurance">
    <Text style={styles.badge}>보험 상담 준비 중</Text>
    <Text accessibilityRole="header" style={styles.title}>가람in 보험 서비스</Text>
    <Text style={styles.body}>보험 상담 서비스를 준비하고 있습니다. FC 전용 시험·서류·설계 업무는 기존 FC 계정으로 이용할 수 있습니다.</Text>
    <ServiceAction label="보험·FC 업무" onPress={() => {
      const route = resolveInsuranceServiceRoute(session); if (route) router.push(route);
    }} />
  </ServiceInformation>;

  if (key === 'hospital') return <ServiceInformation title="제휴병원" service="hospital">
    <Text accessibilityRole="header" style={styles.title}>지역별 병원 안내</Text>
    <Text style={styles.body}>확인된 제휴 병원을 지역과 이름으로 찾아보세요. 병원 방문에 따른 추천 수당은 제공하지 않습니다.</Text>
    <ServiceAction label="제휴병원 찾아보기" onPress={() => router.push('/services/hospitals')} />
  </ServiceInformation>;

  const title = key === 'telecom' ? '통신' : key === 'rental' ? '렌탈' : '자동차';
  return <ServiceInformation title={title} service={key}>
    <Text style={styles.badge}>제휴 준비 중</Text>
    <Text accessibilityRole="header" style={styles.title}>{title} 혜택을 준비하고 있어요</Text>
    <Text style={styles.body}>제휴 상품과 이용 조건은 확정되면 안내합니다.</Text>
  </ServiceInformation>;
}
