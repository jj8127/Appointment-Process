import { invokeFcNotify } from './fc-notify-client';
import {
  isNotificationUuid,
  notificationTargetsEqual,
  parseNotificationTarget,
  type NotificationTarget,
} from './notification-target';

export type NotificationOpenAuthorizationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid_request' | 'request_failed' | 'unauthorized' | 'target_mismatch';
    };

export type NotificationOpenHandoff = {
  notificationId: string;
  target: NotificationTarget;
};

export function parseNotificationOpenRoute(
  route: string,
): NotificationOpenHandoff | null {
  try {
    const parsed = new URL(route, 'https://garamin.invalid');
    const notificationIds = parsed.searchParams.getAll('notificationId');
    const targets = parsed.searchParams.getAll('notificationTarget');
    if (notificationIds.length !== 1 || targets.length !== 1) return null;
    const notificationId = notificationIds[0];
    const target = parseNotificationTarget(targets[0]);
    return isNotificationUuid(notificationId) && target
      ? { notificationId, target }
      : null;
  } catch {
    return null;
  }
}

export async function authorizeNotificationOpen(input: {
  notificationId: string;
  target: NotificationTarget;
}): Promise<NotificationOpenAuthorizationResult> {
  if (!isNotificationUuid(input.notificationId)) {
    return { ok: false, reason: 'invalid_request' };
  }

  try {
    const { data, error } = await invokeFcNotify<{
      ok?: unknown;
      authorized?: unknown;
      notification?: {
        id?: unknown;
        target?: unknown;
      } | null;
    }>({
      type: 'inbox_get',
      notification_id: input.notificationId,
    });
    if (error || !data || data.ok !== true) {
      return { ok: false, reason: 'request_failed' };
    }
    if (data.authorized !== true) {
      return { ok: false, reason: 'unauthorized' };
    }
    const storedTarget = parseNotificationTarget(data.notification?.target);
    if (
      data.notification?.id !== input.notificationId
      || !storedTarget
      || !notificationTargetsEqual(storedTarget, input.target)
    ) {
      return { ok: false, reason: 'target_mismatch' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'request_failed' };
  }
}
