import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import ServiceHomeScreen from '@/components/service-home';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { resolveInsuranceServiceRoute } from '@/lib/service-home';

export default function ServiceHub() {
  const session = useSession();
  const insets = useSafeAreaInsets();
  const preset = resolveBottomNavPreset(session, { surface: 'service-hub' });
  const openInsurance = () => {
    if (session.hydrated && !session.role) {
      router.push({ pathname: '/services/[service]', params: { service: 'insurance' } });
      return;
    }
    const route = resolveInsuranceServiceRoute(session);
    if (route) router.push(route);
  };
  const openInformation = (service: 'care' | 'telecom' | 'rental' | 'car' | 'help') => {
    router.push({ pathname: '/services/[service]', params: { service } });
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: '모두온' }} />
      <ServiceHomeScreen
        isSignedIn={session.isPlatformSignedIn}
        loading={!session.hydrated}
        canResumeInsurance={session.hydrated && session.role === 'fc' && !session.isRequestBoardDesigner}
        bottomInset={insets.bottom}
        onAccountPress={() => router.push('/services/account')}
        onCarePress={() => openInformation('care')}
        onInsurancePress={openInsurance}
        onTelecomPress={() => openInformation('telecom')}
        onCarPress={() => openInformation('car')}
        onRentalPress={() => openInformation('rental')}
        onHospitalPress={() => router.push('/services/hospitals')}
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
