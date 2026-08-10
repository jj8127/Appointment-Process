import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useSession } from '@/hooks/use-session';

export function useAppLogout(loginPath: string = '/login?skipAuto=1') {
  const router = useRouter();
  const { logout } = useSession();

  return useCallback(() => {
    logout();
    router.replace(loginPath as any);
  }, [loginPath, logout, router]);
}
