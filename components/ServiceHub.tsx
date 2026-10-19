import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import ServiceHomeScreen from '@/components/service-home';
import { useSession } from '@/hooks/use-session';
import { useAppLogout } from '@/hooks/use-app-logout';
import { useRootExitConfirm } from '@/hooks/use-root-exit-confirm';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { resolveInsuranceServiceRoute } from '@/lib/service-home';

export default function ServiceHub() {
  const session = useSession();
  const logout = useAppLogout('/', 'service-hub');
  const insets = useSafeAreaInsets();
  useRootExitConfirm();
  const preset = resolveBottomNavPreset(session, { surface: 'service-hub' });
  const openInsurance = () => {
    const route = resolveInsuranceServiceRoute(session);
    if (route) router.push(route);
  };
  const openInformation = (service: 'care' | 'telecom' | 'rental' | 'car' | 'help') => {
    router.navigate({ pathname: '/services/[service]', params: { service } });
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: '모두온' }} />
      <ServiceHomeScreen
        isSignedIn={session.isPlatformSignedIn}
        accountName={session.platformMember?.name || session.displayName}
        loading={!session.hydrated || !session.platformHydrated}
        canResumeInsurance={session.hydrated && session.role === 'fc' && !session.isRequestBoardDesigner}
        bottomInset={insets.bottom}
        onAccountPress={() => {
          if (!session.hydrated || !session.platformHydrated) return;
          router.navigate(session.isPlatformSignedIn ? '/services/account' : '/services/login');
        }}
        onLogoutPress={logout}
        onCarePress={() => openInformation('care')}
        onInsurancePress={openInsurance}
        onTelecomPress={() => openInformation('telecom')}
        onCarPress={() => openInformation('car')}
        onRentalPress={() => openInformation('rental')}
        onHospitalPress={() => router.navigate('/services/hospitals')}
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
