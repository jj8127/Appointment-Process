import 'server-only';

import { adminSupabase } from '@/lib/admin-supabase';
import { logger } from '@/lib/logger';
import {
  classifyDeliverySummary,
  classifyExpoResponse,
  type PushDeliveryFailure,
} from '@/lib/push-notification-delivery-result';
import { sendWebPush } from '@/lib/web-push';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXTERNAL_PUSH_TIMEOUT_MS = 8_000;

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  category?: string;
};

export type PushNotificationResult = {
  success: boolean;
  warning: 'partial_failure' | 'no_target' | null;
  error?: 'Notification delivery incomplete';
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
  inbox: {
    attempted: boolean;
    logged: boolean;
  };
};

type MutablePushNotificationResult = Omit<PushNotificationResult, 'success' | 'warning' | 'error'>;

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

function finalizeDeliveryResult(result: MutablePushNotificationResult): PushNotificationResult {
  const summary = classifyDeliverySummary({
    failures: result.failures,
    expoTargets: result.expo.targets,
    webTargets: result.web.targets,
  });

  return {
    ...result,
    ...summary,
    ...(summary.warning === null ? {} : { error: 'Notification delivery incomplete' as const }),
  };
}

async function persistNotification(
  userId: string,
  {
    title,
    body,
    data,
    category,
  }: PushPayload,
  delivery: MutablePushNotificationResult,
) {
  const targetUrl = typeof data?.url === 'string' ? data.url : null;
  const notificationBase = {
    title,
    body,
    recipient_role: 'fc',
    resident_id: userId,
    ...(category ? { category } : {}),
  } as const;

  delivery.inbox.attempted = true;
  let { error: notificationError } = await adminSupabase.from('notifications').insert({
    ...notificationBase,
    target_url: targetUrl,
  });

  const missingTargetColumn =
    notificationError?.code === '42703' ||
    String(notificationError?.message ?? '').includes('target_url');
  if (missingTargetColumn) {
    const fallback = await adminSupabase.from('notifications').insert(notificationBase);
    notificationError = fallback.error ?? null;
  }

  if (notificationError) {
    addFailure(delivery, 'inbox_write_failed');
  } else {
    delivery.inbox.logged = true;
  }
}

async function deliverToRegisteredTargets(
  userId: string,
  {
    title,
    body,
    data,
  }: PushPayload,
  delivery: MutablePushNotificationResult,
) {
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
          data,
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

    const { data: subscriptions, error: subscriptionsError } = await adminSupabase
      .from('web_push_subscriptions')
      .select('endpoint,p256dh,auth')
      .eq('resident_id', userId)
      .eq('role', 'fc');

    if (subscriptionsError) {
      addFailure(delivery, 'web_subscription_query_failed');
    } else {
      delivery.web.targets = subscriptions?.length ?? 0;
      if (subscriptions && subscriptions.length > 0) {
        try {
          const webResult = await sendWebPush(subscriptions, { title, body, data });
          delivery.web.sent = webResult.sent;
          delivery.web.failed = webResult.failed;
          if (webResult.failed > 0) {
            addFailure(delivery, 'web_delivery_failed');
          }

          if (webResult.expired.length > 0) {
            const { error: deleteError } = await adminSupabase
              .from('web_push_subscriptions')
              .delete()
              .in('endpoint', webResult.expired);

            if (deleteError) {
              logger.warn('[push-notification-service] expired subscription cleanup failed', {
                category: 'web_push_subscriptions',
                reason: 'database_delete_failed',
                status: 'failed',
              });
            }
          }
        } catch {
          delivery.web.failed = subscriptions.length;
          addFailure(delivery, 'web_delivery_failed');
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
): Promise<NotificationPersistenceResult> {
  const delivery = createDeliveryResult();

  if (!userId) {
    addFailure(delivery, 'missing_recipient');
    return { success: false, inbox: delivery.inbox };
  }

  try {
    await persistNotification(userId, payload, delivery);
  } catch {
    addFailure(delivery, 'unexpected_failure');
  }

  const success = delivery.inbox.logged && delivery.failures.length === 0;
  logger.info('[push-notification-service] inbox persistence completed', {
    category: 'notification_inbox',
    status: success ? 'persisted' : 'incomplete',
    inboxLogged: delivery.inbox.logged,
    failures: delivery.failures,
  });
  return { success, inbox: delivery.inbox };
}

export async function sendPushNotificationToResidentDevices(
  userId: string,
  payload: PushPayload,
): Promise<PushNotificationResult> {
  const delivery = createDeliveryResult();

  if (!userId) {
    addFailure(delivery, 'missing_recipient');
    const result = finalizeDeliveryResult(delivery);
    logDeliveryResult(result);
    return result;
  }

  await deliverToRegisteredTargets(userId, payload, delivery);

  const result = finalizeDeliveryResult(delivery);
  logDeliveryResult(result);
  return result;
}

export async function sendPushNotificationToResident(
  userId: string,
  payload: PushPayload,
): Promise<PushNotificationResult> {
  const delivery = createDeliveryResult();

  if (!userId) {
    addFailure(delivery, 'missing_recipient');
    const result = finalizeDeliveryResult(delivery);
    logDeliveryResult(result);
    return result;
  }

  try {
    await persistNotification(userId, payload, delivery);
  } catch {
    addFailure(delivery, 'unexpected_failure');
  }
  await deliverToRegisteredTargets(userId, payload, delivery);

  const result = finalizeDeliveryResult(delivery);
  logDeliveryResult(result);
  return result;
}
