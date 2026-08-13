import {
  parseNotificationTargetV1,
  type NotificationTargetV1,
} from './notification-target.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PersistedNotificationRow = {
  id?: unknown;
  target?: unknown;
  recipient_role?: unknown;
  recipient_actor_id?: unknown;
  resident_id?: unknown;
};

export type PersistedNotificationExpectation = {
  target: NotificationTargetV1;
  recipientRole?: 'admin' | 'fc' | 'manager';
  recipientActorId?: string | null;
  residentId?: string | null;
};

export type PersistedNotificationFailureReason =
  | 'missing_notification_id'
  | 'target_mismatch'
  | 'recipient_mismatch';

export type PersistedNotificationValidation =
  | { ok: true; notificationId: string; target: NotificationTargetV1 }
  | {
      ok: false;
      reason: PersistedNotificationFailureReason;
    };

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

function sameTarget(left: NotificationTargetV1, right: NotificationTargetV1) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function sameNullableString(actual: unknown, expected: string | null | undefined) {
  if (expected === undefined) return true;
  const normalizedActual = typeof actual === 'string' && actual.trim()
    ? actual.trim()
    : null;
  const normalizedExpected = typeof expected === 'string' && expected.trim()
    ? expected.trim()
    : null;
  return normalizedActual === normalizedExpected;
}

export function validatePersistedNotificationForDelivery(
  row: PersistedNotificationRow | null | undefined,
  expected: PersistedNotificationExpectation,
): PersistedNotificationValidation {
  const notificationId = typeof row?.id === 'string' ? row.id.trim() : '';
  if (!UUID_PATTERN.test(notificationId)) {
    return { ok: false, reason: 'missing_notification_id' };
  }

  const persistedTarget = parseNotificationTargetV1(row?.target);
  if (!persistedTarget || !sameTarget(persistedTarget, expected.target)) {
    return { ok: false, reason: 'target_mismatch' };
  }

  if (
    (expected.recipientRole !== undefined && row?.recipient_role !== expected.recipientRole)
    || !sameNullableString(row?.recipient_actor_id, expected.recipientActorId)
    || !sameNullableString(row?.resident_id, expected.residentId)
  ) {
    return { ok: false, reason: 'recipient_mismatch' };
  }

  return {
    ok: true,
    notificationId,
    target: persistedTarget,
  };
}

export async function deliverAfterPersistedNotification<T>(input: {
  persist: () => Promise<{
    row?: PersistedNotificationRow | null;
    error?: unknown;
  }>;
  expected: PersistedNotificationExpectation;
  deliver: (notification: {
    notificationId: string;
    target: NotificationTargetV1;
  }) => Promise<T>;
}): Promise<
  | {
      confirmed: true;
      notificationId: string;
      target: NotificationTargetV1;
      delivery: T;
    }
  | {
      confirmed: false;
      reason:
        | 'notification_insert_failed'
        | PersistedNotificationFailureReason;
    }
> {
  const persisted = await input.persist();
  if (persisted.error) {
    return { confirmed: false, reason: 'notification_insert_failed' };
  }

  const validation = validatePersistedNotificationForDelivery(
    persisted.row,
    input.expected,
  );
  if (validation.ok === false) {
    return { confirmed: false, reason: validation.reason };
  }

  return {
    confirmed: true,
    notificationId: validation.notificationId,
    target: validation.target,
    delivery: await input.deliver({
      notificationId: validation.notificationId,
      target: validation.target,
    }),
  };
}
