import { invokeFcNotify } from './fc-notify-client';
import {
  clearPendingNotificationNavigation,
  getPendingNotificationNavigation,
} from './pending-notification-navigation';
import {
  markNotificationNavigationIdle,
  markNotificationNavigationPending,
  notifyNotificationDestinationAccepted,
} from './notification-navigation-coordinator';
import {
  isNotificationUuid,
  notificationTargetsEqual,
  parseNotificationTarget,
  type NotificationTarget,
} from './notification-target';

export type NotificationReceiptParams = {
  notificationId?: string | string[];
  notificationTarget?: string | string[];
};

export type NotificationReceiptHandoff = {
  notificationId: string;
  target: NotificationTarget;
};

export type MarkNotificationReadResult =
  | {
      ok: true;
      state: 'read' | 'already_read';
      updated: number;
    }
  | {
      ok: false;
      reason:
        | 'invalid_handoff'
        | 'pending_mismatch'
        | 'request_failed';
    };

function firstParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseNotificationReceiptHandoff(
  params: NotificationReceiptParams,
): NotificationReceiptHandoff | null {
  const notificationId = firstParam(params.notificationId);
  const rawTarget = firstParam(params.notificationTarget);
  const target = parseNotificationTarget(rawTarget);
  if (!isNotificationUuid(notificationId) || !target) return null;
  return { notificationId, target };
}

export async function markPendingNotificationRead(input: {
  handoff: NotificationReceiptHandoff;
  expectedTarget: NotificationTarget;
}): Promise<MarkNotificationReadResult> {
  const { handoff, expectedTarget } = input;
  if (!notificationTargetsEqual(handoff.target, expectedTarget)) {
    return { ok: false, reason: 'invalid_handoff' };
  }

  const pending = await getPendingNotificationNavigation();
  if (
    !pending
    || pending.notificationId !== handoff.notificationId
    || !notificationTargetsEqual(pending.target, expectedTarget)
  ) {
    return { ok: false, reason: 'pending_mismatch' };
  }

  try {
    const { data, error } = await invokeFcNotify<{
      ok?: unknown;
      authorized?: unknown;
      state?: unknown;
      updated?: unknown;
    }>({
      type: 'inbox_mark_read',
      notification_ids: [handoff.notificationId],
    });
    if (
      error
      || data?.ok !== true
      || data.authorized !== true
      || (data.state !== 'read' && data.state !== 'already_read')
    ) {
      return { ok: false, reason: 'request_failed' };
    }
    const clearedCurrentPending = await clearPendingNotificationNavigation({
      notificationId: handoff.notificationId,
      target: expectedTarget,
    });
    notifyNotificationDestinationAccepted(handoff.notificationId);
    if (clearedCurrentPending) {
      markNotificationNavigationIdle();
    } else {
      // A newer notification may have been captured while inbox_mark_read was
      // awaiting. Its conditional clear correctly preserves storage, so keep
      // login/default navigation suppressed for that newer pending intent.
      markNotificationNavigationPending();
    }
    return {
      ok: true,
      state: data.state,
      updated: Number.isSafeInteger(data.updated) ? Number(data.updated) : 0,
    };
  } catch {
    return { ok: false, reason: 'request_failed' };
  }
}
