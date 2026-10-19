import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { useSession } from '@/hooks/use-session';

export function useAppLogout(loginPath: string = '/login?skipAuto=1', surface: 'insurance' | 'service-hub' = 'insurance') {
  const router = useRouter();
  const focused = useIsFocused();
  const { logout, role, hydrated, isPlatformSignedIn } = useSession();
  const signedIn = surface === 'service-hub' ? isPlatformSignedIn : Boolean(role);
  const requested = useRef(false);
  const redirected = useRef(false);

  // One focused screen owns the transition, after the local session has cleared.
  // Screens retained behind settings must not also replace their navigation stack.
  useEffect(() => {
    if (!focused || signedIn) {
      redirected.current = false;
      if (signedIn) requested.current = false;
      return;
    }
    if (!hydrated || redirected.current || (surface === 'service-hub' && !requested.current)) return;
    redirected.current = true;
    router.replace(loginPath as any);
  }, [focused, hydrated, loginPath, signedIn, surface, router]);

  return useCallback(() => {
    if (requested.current) return;
    requested.current = true;
    logout();
  }, [logout]);
}
