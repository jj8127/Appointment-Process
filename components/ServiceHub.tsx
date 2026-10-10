import { Stack, router } from 'expo-router';
import { Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import ServiceHomeScreen from '@/components/service-home';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { openExternalUrl } from '@/lib/open-external-url';
import { FAMILY_CARE_PROMOTION_URL, resolveInsuranceServiceRoute } from '@/lib/service-home';

export default function ServiceHub() {
  const session = useSession();
  const insets = useSafeAreaInsets();
  const preset = resolveBottomNavPreset(session, { surface: 'service-hub' });
  const openInsurance = () => {
    const route = resolveInsuranceServiceRoute(session);
    if (route) router.push(route);
  };
  const openCarePromotion = async () => {
    try {
      await openExternalUrl(FAMILY_CARE_PROMOTION_URL, { sameWindowOnWeb: true });
    } catch {
      Alert.alert('가족간병 안내를 열지 못했어요', '인터넷 연결을 확인한 뒤 가족간병을 다시 눌러 주세요.');
    }
  };
  const openInformation = (service: 'telecom' | 'car' | 'help') => {
    router.push({ pathname: '/services/[service]', params: { service } });
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: '가람in' }} />
      <ServiceHomeScreen
        isSignedIn={Boolean(session.role)}
        loading={!session.hydrated}
        canResumeInsurance={session.hydrated && session.role === 'fc' && !session.isRequestBoardDesigner}
        bottomInset={insets.bottom}
        onAccountPress={() => router.push('/services/account')}
        onCarePress={openCarePromotion}
        onInsurancePress={openInsurance}
        onTelecomPress={() => openInformation('telecom')}
        onCarPress={() => openInformation('car')}
        onHelpPress={() => openInformation('help')}
        onResumeInsurancePress={openInsurance}
        navigation={preset ? (
          <BottomNavigation
            preset={preset}
            activeKey={resolveBottomNavActiveKey(preset, 'home')}
            bottomInset={insets.bottom}
          />
        ) : null}
      />
    </>
  );
}
