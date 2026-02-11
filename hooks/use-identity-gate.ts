import { useEffect } from 'react';
import { router, usePathname } from 'expo-router';
import { useSession } from '@/hooks/use-session';
import { useIdentityStatus } from '@/hooks/use-identity-status';

type GateOptions = {
  nextPath?: string;
  enabled?: boolean;
};

export function useIdentityGate(options: GateOptions = {}) {
  const { nextPath, enabled = true } = options;
  const pathname = usePathname();
  const { role, residentId, hydrated } = useSession();
  const { data, isLoading } = useIdentityStatus();

  useEffect(() => {
    if (!enabled) return;
    if (!hydrated) return;
    if (role !== 'fc') return;
    if (!residentId) {
      router.replace('/login');
      return;
    }
    if (!isLoading && (!data || !data.identityCompleted)) {
      router.replace({
        pathname: '/apply-gate',
        params: { next: nextPath ?? pathname ?? '/' },
      } as any);
    }
  }, [enabled, hydrated, role, residentId, isLoading, data, nextPath, pathname]);

  return { identity: data, isLoading };
}
