import { useEffect } from 'react';
import { router, useLocalSearchParams, usePathname } from 'expo-router';
import { useSession } from '@/hooks/use-session';
import { useIdentityStatus } from '@/hooks/use-identity-status';
import {
  buildNotificationTargetRoute,
  parseNotificationPushData,
} from '@/lib/notification-target';
import { canAcceptIdentityGatedDestination } from '@/lib/identity-gate-state';

type GateOptions = {
  nextPath?: string;
  enabled?: boolean;
};

export function useIdentityGate(options: GateOptions = {}) {
  const { nextPath, enabled = true } = options;
  const pathname = usePathname();
  const {
    notificationId,
    notificationTarget,
  } = useLocalSearchParams<{
    notificationId?: string | string[];
    notificationTarget?: string | string[];
  }>();
  const { role, residentId, hydrated, isRequestBoardDesigner } = useSession();
  const { data, isLoading } = useIdentityStatus();
  const destinationAccepted = canAcceptIdentityGatedDestination({
    enabled,
    hydrated,
    role,
    residentId,
    isRequestBoardDesigner,
    isIdentityLoading: isLoading,
    identityCompleted: data?.identityCompleted,
  });

  useEffect(() => {
    if (!enabled) return;
    if (!hydrated) return;
    if (role !== 'fc') return;
    if (isRequestBoardDesigner) return;
    if (!residentId) {
      router.replace('/login');
      return;
    }
    if (!isLoading && (!data || !data.identityCompleted)) {
      const handoff = parseNotificationPushData({
        notificationId:
          typeof notificationId === 'string' ? notificationId : undefined,
        target:
          typeof notificationTarget === 'string'
            ? notificationTarget
            : undefined,
      });
      const notificationNext = handoff
        ? buildNotificationTargetRoute({
            target: handoff.target,
            notificationId: handoff.notificationId,
            viewerRole: 'fc',
          })
        : null;
      router.replace({
        pathname: '/apply-gate',
        params: { next: notificationNext ?? nextPath ?? pathname ?? '/' },
      } as any);
    }
  }, [
    data,
    enabled,
    hydrated,
    isLoading,
    isRequestBoardDesigner,
    nextPath,
    notificationId,
    notificationTarget,
    pathname,
    residentId,
    role,
  ]);

  return { identity: data, isLoading, destinationAccepted };
}
