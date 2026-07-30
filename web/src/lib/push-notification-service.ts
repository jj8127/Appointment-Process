import 'server-only';

import { adminSupabase } from '@/lib/admin-supabase';
import { logger } from '@/lib/logger';
import {
  classifyExpoResponse,
  type PushDeliveryFailure,
} from '@/lib/push-notification-delivery-result';
import type { NotificationTargetV1 } from '@/lib/notification-target';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXTERNAL_PUSH_TIMEOUT_MS = 8_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PushPayload = {
  title: string;
  body: string;
  target: NotificationTargetV1;
  data?: Record<string, unknown>;
  category?: string;
};

export type PushNotificationResult = {
  success: boolean;
  warning: 'notification_persistence_incomplete' | null;
  error?: 'Notification delivery incomplete';
  delivery: {
    notificationStored: boolean;
    pushStatus: 'accepted' | 'no_registered_device' | 'provider_rejected' | 'not_attempted';
    retryable: boolean;
    notificationId?: string;
  };
  inbox: {
    attempted: boolean;
    logged: boolean;
  };
  expo: {
    targets: number;
    attempted: number;
    accepted: number;
    rejected: number;
  };
  web: {
    targets: number;
    sent: number;
    failed: number;
  };
  noTarget: boolean;
  failures: PushDeliveryFailure[];
};

export type NotificationPersistenceResult = {
  success: boolean;
  notificationId: string | null;
  delivery: {
    notificationStored: boolean;
    pushStatus: 'not_attempted';
    retryable: boolean;
    notificationId?: string;
  };
  inbox: {
    attempted: boolean;
    logged: boolean;
  };
};

type MutablePushNotificationResult = Omit<
  PushNotificationResult,
  'success' | 'warning' | 'error' | 'delivery'
>;

function createDeliveryResult(): MutablePushNotificationResult {
  return {
    inbox: { attempted: false, logged: false },
    expo: { targets: 0, attempted: 0, accepted: 0, rejected: 0 },
    web: { targets: 0, sent: 0, failed: 0 },
    noTarget: true,
    failures: [],
  };
}

function addFailure(result: MutablePushNotificationResult, failure: PushDeliveryFailure) {
  if (!result.failures.includes(failure)) {
    result.failures.push(failure);
  }
}

function finalizeDeliveryResult(
  result: MutablePushNotificationResult,
  notificationId?: string | null,
): PushNotificationResult {
  const notificationStored = result.inbox.logged;
  const providerFailed = result.failures.some((failure) =>
    failure === 'token_query_failed'
    || failure === 'expo_http_failed'
    || failure === 'expo_invalid_response'
    || failure === 'expo_ticket_rejected'
    || failure === 'web_subscription_query_failed'
    || failure === 'web_delivery_failed'
    || failure === 'unexpected_failure');
  const targetCount = result.expo.targets + result.web.targets;
  const pushStatus = !notificationStored
    ? 'not_attempted' as const
    : providerFailed
      ? 'provider_rejected' as const
      : targetCount === 0
        ? 'no_registered_device' as const
        : 'accepted' as const;

  return {
    ...result,
    success: notificationStored,
    warning: notificationStored ? null : 'notification_persistence_incomplete',
    noTarget: targetCount === 0,
    delivery: {
      notificationStored,
      pushStatus,
      retryable: !notificationStored,
      ...(notificationId ? { notificationId } : {}),
    },
    ...(notificationStored ? {} : { error: 'Notification delivery incomplete' as const }),
  };
}

function buildPersistenceResult(
  success: boolean,
  notificationId: string | null,
  inbox: NotificationPersistenceResult['inbox'],
  retryable = !success,
): NotificationPersistenceResult {
  return {
    success,
    notificationId,
    delivery: {
      notificationStored: success,
      pushStatus: 'not_attempted',
      retryable,
      ...(notificationId ? { notificationId } : {}),
    },
    inbox,
  };
}

async function persistNotification(
  userId: string,
  recipientActorId: string,
  {
    title,
    body,
    data,
    category,
    target,
  }: PushPayload,
  delivery: MutablePushNotificationResult,
): Promise<string | null> {
  const targetUrl = typeof data?.url === 'string' ? data.url : null;
  const notificationBase = {
    title,
    body,
    recipient_role: 'fc',
    resident_id: userId,
    recipient_actor_id: recipientActorId,
    ...(category ? { category } : {}),
  } as const;

  delivery.inbox.attempted = true;
  let { data: inserted, error: notificationError } = await adminSupabase.from('notifications').insert({
    ...notificationBase,
    target_url: targetUrl,
    target,
  }).select('id').single();

  const missingTargetColumn =
    notificationError?.code === '42703' ||
    String(notificationError?.message ?? '').includes('target_url');
  if (missingTargetColumn) {
    const fallback = await adminSupabase.from('notifications')
      .insert({ ...notificationBase, target })
      .select('id')
      .single();
    notificationError = fallback.error ?? null;
    inserted = fallback.data;
  }

  const notificationId =
    typeof inserted?.id === 'string' && inserted.id.trim() ? inserted.id.trim() : null;
  if (notificationError || !notificationId) {
    addFailure(delivery, 'inbox_write_failed');
  } else {
    delivery.inbox.logged = true;
  }
  return notificationId;
}

async function isCanonicalFcRecipient(userId: string, recipientActorId: string) {
  if (!/^010\d{8}$/.test(userId) || !UUID_PATTERN.test(recipientActorId)) return false;
  const { data, error } = await adminSupabase
    .from('fc_profiles')
    .select('id,phone')
    .eq('id', recipientActorId)
    .maybeSingle();
  if (error || !data) return false;
  return String(data.phone ?? '').replace(/\D/g, '') === userId;
}

async function deliverToRegisteredTargets(
  userId: string,
  {
    title,
    body,
    data,
    target,
  }: PushPayload,
  delivery: MutablePushNotificationResult,
  notificationId: string | null,
) {
  const exactData = {
    ...(data ?? {}),
    target,
    ...(notificationId ? { notificationId } : {}),
  };
  try {
    const { data: tokens, error: tokensError } = await adminSupabase
      .from('device_tokens')
      .select('expo_push_token')
      .eq('resident_id', userId)
      .eq('role', 'fc');

    if (tokensError) {
      addFailure(delivery, 'token_query_failed');
    } else {
      const uniqueTokens = Array.from(new Set(
        (tokens ?? [])
          .map((token) => token.expo_push_token)
          .filter((token): token is string => typeof token === 'string' && token.length > 0),
      ));
      delivery.expo.targets = uniqueTokens.length;

      if (uniqueTokens.length > 0) {
        delivery.expo.attempted = uniqueTokens.length;
        const messages = uniqueTokens.map((token) => ({
          to: token,
          title,
          body,
          data: exactData,
          sound: 'default',
          priority: 'high',
          channelId: 'alerts',
        }));

        try {
          const response = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(messages),
            signal: AbortSignal.timeout(EXTERNAL_PUSH_TIMEOUT_MS),
          });

          const providerBody = response.ok
            ? await response.json().catch(() => null)
            : null;
          const expoResult = classifyExpoResponse(
            response.ok,
            providerBody,
            uniqueTokens.length,
          );
          delivery.expo.accepted = expoResult.accepted;
          delivery.expo.rejected = expoResult.rejected;
          for (const failure of expoResult.failures) {
            addFailure(delivery, failure);
          }
        } catch {
          delivery.expo.rejected = uniqueTokens.length;
          addFailure(delivery, 'expo_http_failed');
        }
      }
    }

  } catch {
    addFailure(delivery, 'unexpected_failure');
  }
}

function logDeliveryResult(result: PushNotificationResult) {
  logger.info('[push-notification-service] delivery completed', {
    category: 'push_delivery',
    status: result.success ? 'delivered' : 'incomplete',
    warning: result.warning,
    inboxLogged: result.inbox.logged,
    expoAttempted: result.expo.attempted,
    expoAccepted: result.expo.accepted,
    expoRejected: result.expo.rejected,
    webSent: result.web.sent,
    webFailed: result.web.failed,
    noTarget: result.noTarget,
    failures: result.failures,
  });
}

export async function persistNotificationToResident(
  userId: string,
  payload: PushPayload,
  recipientActorId: string,
): Promise<NotificationPersistenceResult> {
  const delivery = createDeliveryResult();

  if (!userId || !recipientActorId) {
    addFailure(delivery, 'missing_recipient');
    return buildPersistenceResult(false, null, delivery.inbox, false);
  }

  try {
    if (!await isCanonicalFcRecipient(userId, recipientActorId)) {
      addFailure(delivery, 'recipient_mismatch');
      return buildPersistenceResult(false, null, delivery.inbox, false);
    }
    const notificationId = await persistNotification(
      userId,
      recipientActorId,
      payload,
      delivery,
    );
    const success = delivery.inbox.logged && delivery.failures.length === 0;
    logger.info('[push-notification-service] inbox persistence completed', {
      category: 'notification_inbox',
      status: success ? 'persisted' : 'incomplete',
      inboxLogged: delivery.inbox.logged,
      failures: delivery.failures,
    });
    return buildPersistenceResult(success, notificationId, delivery.inbox);
  } catch {
    addFailure(delivery, 'unexpected_failure');
  }
  return buildPersistenceResult(false, null, delivery.inbox);
}

export async function sendPushNotificationToResidentDevices(
  userId: string,
  payload: PushPayload,
  notificationId: string | null,
  recipientActorId: string,
): Promise<PushNotificationResult> {
  const delivery = createDeliveryResult();

  if (!userId || !recipientActorId) {
    addFailure(delivery, 'missing_recipient');
    const result = finalizeDeliveryResult(delivery);
    logDeliveryResult(result);
    return result;
  }
  if (!notificationId) {
    addFailure(delivery, 'inbox_write_failed');
    const result = finalizeDeliveryResult(delivery);
    logDeliveryResult(result);
    return result;
  }
  if (!await isCanonicalFcRecipient(userId, recipientActorId)) {
    addFailure(delivery, 'recipient_mismatch');
    const result = finalizeDeliveryResult(delivery);
    logDeliveryResult(result);
    return result;
  }

  delivery.inbox.attempted = true;
  delivery.inbox.logged = true;
  await deliverToRegisteredTargets(userId, payload, delivery, notificationId);

  const result = finalizeDeliveryResult(delivery, notificationId);
  logDeliveryResult(result);
  return result;
}

export async function sendPushNotificationToResident(
  userId: string,
  payload: PushPayload,
  recipientActorId: string,
): Promise<PushNotificationResult> {
  const delivery = createDeliveryResult();
  let notificationId: string | null = null;

  if (!userId || !recipientActorId) {
    addFailure(delivery, 'missing_recipient');
    const result = finalizeDeliveryResult(delivery);
    logDeliveryResult(result);
    return result;
  }

  try {
    if (!await isCanonicalFcRecipient(userId, recipientActorId)) {
      addFailure(delivery, 'recipient_mismatch');
      const result = finalizeDeliveryResult(delivery);
      logDeliveryResult(result);
      return result;
    }
    notificationId = await persistNotification(
      userId,
      recipientActorId,
      payload,
      delivery,
    );
    if (delivery.inbox.logged && notificationId) {
      await deliverToRegisteredTargets(userId, payload, delivery, notificationId);
    }
  } catch {
    addFailure(delivery, 'unexpected_failure');
  }

  const result = finalizeDeliveryResult(delivery, notificationId);
  logDeliveryResult(result);
  return result;
}
