import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Alert, StyleSheet, Text, View } from 'react-native';

import ServiceInformation, { ServiceAction, informationStyles as styles } from '@/components/ServiceInformation';
import FamilyCareInvitation from '@/components/FamilyCareInvitation';
import { FAMILY_CARE_PROMOTION_URL, resolveInsuranceServiceRoute, resolveServiceInformationKey, SERVICE_INFORMATION_KEYS } from '@/lib/service-home';
import { useSession } from '@/hooks/use-session';
import { openExternalUrl } from '@/lib/open-external-url';
import { COLORS } from '@/lib/theme';

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
      <Text style={styles.item}>보험·FC 업무는 모두온 로그인 후 이용합니다. 처음 이용할 때 필요한 추가 정보와 본인확인을 안내합니다.</Text>
      <Text style={styles.item}>공통 회원가입은 한 번만 합니다. 서비스별로 필요한 추가 정보는 이용을 신청할 때 입력합니다.</Text>
      <Text style={styles.item}>추천 관계는 모든 서비스에서 하나로 연결합니다. 이용료 지급 비율과 정산은 제휴 서비스별로 다릅니다.</Text>
      <Text style={styles.item}>지급 대상 금액은 제휴사별 수수료 정산 완료일부터 일주일 이내에 정해진 비율로 지급합니다. 보험 증원수당과는 별도입니다.</Text>
      <Text style={styles.item}>준비 중인 서비스는 이용 방법이 확정되면 안내합니다.</Text>
    </View>
    <ServiceAction label="내 정보 · 회원가입" onPress={() => router.navigate('/services/account')} />
    <ServiceAction label="서비스 홈으로" onPress={home} />
  </ServiceInformation>;

  if (key === 'care') return <ServiceInformation title="가족간병 안내" service="care">
    <Text style={styles.badge}>준비 중</Text>
    <Text accessibilityRole="header" style={styles.title}>가족간병,{`\n`}먼저 알아보세요</Text>
    <Text style={styles.body}>가족이 간병을 맡기 전, 보험 조건과 필요한 절차를 확인해 주세요.</Text>
    <View style={careStyles.checks}>
      <View style={careStyles.row}>
        <Feather accessible={false} name="shield" size={21} color={COLORS.warning.dark} style={careStyles.icon} />
        <View style={careStyles.detail}>
          <Text style={careStyles.label}>가입한 보험 확인</Text>
          <Text style={careStyles.description}>가족간병에 필요한 조건과 서류를 확인하세요.</Text>
        </View>
      </View>
      <View style={careStyles.row}>
        <Feather accessible={false} name="clipboard" size={21} color={COLORS.warning.dark} style={careStyles.icon} />
        <View style={careStyles.detail}>
          <Text style={careStyles.label}>간병업체 등록 확인</Text>
          <Text style={careStyles.description}>업체 소속·등록을 요구하는 보험은 등록이 필요해요.</Text>
        </View>
      </View>
    </View>
    <Text style={careStyles.note}>앱에서 가족간병을 신청하는 기능은 준비 중이에요.{`\n`}지금은 아래에서 자세한 안내를 확인해 주세요.</Text>
    <ServiceAction label="가족간병 자세히 알아보기" onPress={openCarePromotion} />
    <FamilyCareInvitation />
  </ServiceInformation>;

  if (key === 'insurance') return <ServiceInformation title="가람in · 보험" service="insurance">
    <Text style={styles.badge}>보험 상담 준비 중</Text>
    <Text accessibilityRole="header" style={styles.title}>가람in 보험 서비스</Text>
    <Text style={styles.body}>보험 상담 서비스를 준비하고 있습니다. 모두온 로그인 후 FC 업무에 필요한 정보를 등록하면 시험·서류·설계 업무를 이용할 수 있습니다.</Text>
    <ServiceAction label="보험·FC 업무" onPress={() => {
      const route = resolveInsuranceServiceRoute(session); if (route) router.push(route);
    }} />
  </ServiceInformation>;

  if (key === 'hospital') return <ServiceInformation title="제휴병원" service="hospital">
    <Text accessibilityRole="header" style={styles.title}>지역별 병원 안내</Text>
    <Text style={styles.body}>확인된 제휴 병원을 지역과 이름으로 찾아보세요. 병원 방문에 따른 추천 수당은 제공하지 않습니다.</Text>
    <ServiceAction label="제휴병원 찾아보기" onPress={() => router.navigate('/services/hospitals')} />
  </ServiceInformation>;

  const title = key === 'telecom' ? '통신' : key === 'rental' ? '렌탈' : '자동차';
  return <ServiceInformation title={title} service={key}>
    <Text style={styles.badge}>제휴 준비 중</Text>
    <Text accessibilityRole="header" style={styles.title}>{title} 혜택을 준비하고 있어요</Text>
    <Text style={styles.body}>제휴 상품과 이용 조건은 확정되면 안내합니다.</Text>
  </ServiceInformation>;
}

const careStyles = StyleSheet.create({
  checks: { gap: 19, marginBottom: 22 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { marginTop: 3 },
  detail: { flex: 1, gap: 4 },
  label: { fontSize: 15, lineHeight: 23, fontWeight: '700', color: COLORS.text.primary },
  description: { fontSize: 13, lineHeight: 21, color: COLORS.text.secondary },
  note: { fontSize: 13, lineHeight: 22, color: COLORS.text.secondary, marginBottom: 14 },
});
