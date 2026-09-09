import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { useSession } from '@/hooks/use-session';

export function useAppLogout(loginPath: string = '/login?skipAuto=1') {
  const router = useRouter();
  const focused = useIsFocused();
  const { logout, role, hydrated } = useSession();
  const requested = useRef(false);
  const redirected = useRef(false);

  // One focused screen owns the transition, after the local session has cleared.
  // Screens retained behind settings must not also replace their navigation stack.
  useEffect(() => {
    if (!focused || role) {
      redirected.current = false;
      if (role) requested.current = false;
      return;
    }
    if (!hydrated || redirected.current) return;
    redirected.current = true;
    router.replace(loginPath as any);
  }, [focused, hydrated, loginPath, role, router]);

  return useCallback(() => {
    if (requested.current) return;
    requested.current = true;
    logout();
  }, [logout]);
}
