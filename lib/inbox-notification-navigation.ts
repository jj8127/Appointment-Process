import { authorizeNotificationOpen } from './notification-open-authorization';
import {
  buildNotificationTargetRoute,
  type NotificationTarget,
  type NotificationTargetViewerRole,
} from './notification-target';
import {
  savePendingNotificationNavigation,
  type PendingNotificationOwnerBinding,
} from './pending-notification-navigation';

export type PrepareInboxNotificationNavigationResult =
  | { ok: true; route: string }
  | {
      ok: false;
      reason:
        | 'missing_owner'
        | 'unauthorized'
        | 'unavailable_route'
        | 'storage_failed';
    };

export async function prepareInboxNotificationNavigation(
  input: {
    notificationId: string;
    target: NotificationTarget;
    viewerRole: NotificationTargetViewerRole;
    owner: PendingNotificationOwnerBinding | undefined;
  },
  deps: {
    authorize: typeof authorizeNotificationOpen;
    savePending: typeof savePendingNotificationNavigation;
  } = {
    authorize: authorizeNotificationOpen,
    savePending: savePendingNotificationNavigation,
  },
): Promise<PrepareInboxNotificationNavigationResult> {
  if (!input.owner) return { ok: false, reason: 'missing_owner' };

  const authorization = await deps.authorize({
    notificationId: input.notificationId,
    target: input.target,
  });
  if (!authorization.ok) {
    return { ok: false, reason: 'unauthorized' };
  }

  const route = buildNotificationTargetRoute({
    target: input.target,
    notificationId: input.notificationId,
    viewerRole: input.viewerRole,
  });
  if (!route) return { ok: false, reason: 'unavailable_route' };

  try {
    await deps.savePending({
      notificationId: input.notificationId,
      target: input.target,
      owner: input.owner,
    });
  } catch {
    return { ok: false, reason: 'storage_failed' };
  }
  return { ok: true, route };
}
