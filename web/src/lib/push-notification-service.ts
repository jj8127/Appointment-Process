import 'server-only';

import { adminSupabase } from '@/lib/admin-supabase';
import { logger } from '@/lib/logger';
import { sendWebPush } from '@/lib/web-push';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  skipNotificationInsert?: boolean;
};

export async function sendPushNotificationToResident(
  userId: string,
  { title, body, data, skipNotificationInsert = false }: PushPayload,
) {
  logger.debug('[sendPushNotificationToResident] start', {
    category: 'push_delivery',
    reason: 'started',
    status: 'pending',
    skipNotificationInsert,
  });

  if (!userId) {
    logger.warn('[sendPushNotificationToResident] recipient rejected', {
      category: 'push_delivery',
      reason: 'missing_recipient',
      status: 'rejected',
    });
    return { success: false, error: 'No user ID provided' };
  }

  const targetUrl = typeof data?.url === 'string' ? data.url : null;
  const notificationBase = {
    title,
    body,
    recipient_role: 'fc',
    resident_id: userId,
  } as const;

  if (!skipNotificationInsert) {
    let { error: notifError } = await adminSupabase.from('notifications').insert({
      ...notificationBase,
      target_url: targetUrl,
    });

    const missingTargetColumn =
      notifError?.code === '42703' || String(notifError?.message ?? '').includes('target_url');
    if (missingTargetColumn) {
      const fallback = await adminSupabase.from('notifications').insert(notificationBase);
      notifError = fallback.error ?? null;
    }

    if (notifError) {
      logger.warn('[sendPushNotificationToResident] notifications insert failed', {
        category: 'notification_insert',
        reason: 'database_write_failed',
        status: 'failed',
      });
    }
  }

  const { data: tokens, error: tokensError } = await adminSupabase
    .from('device_tokens')
    .select('expo_push_token')
    .eq('resident_id', userId);

  logger.debug('[sendPushNotificationToResident] tokens query result', {
    category: 'expo_tokens',
    reason: tokensError ? 'database_read_failed' : 'query_completed',
    status: tokensError ? 'failed' : 'ready',
    tokenCount: tokensError ? 0 : tokens?.length ?? 0,
  });

  if (tokensError) {
    logger.error('[push-notification-service] token query failed', {
      category: 'expo_tokens',
      reason: 'database_read_failed',
      status: 'failed',
    });
    return { success: false, error: 'Failed to fetch device tokens' };
  }

  try {
    if (tokens && tokens.length > 0) {
      const uniqueTokens = Array.from(new Set(tokens.map((token) => token.expo_push_token)));
      const messages = uniqueTokens.map((token) => ({
        to: token,
        title,
        body,
        data,
        sound: 'default',
        priority: 'high',
        channelId: 'alerts',
      }));

      logger.debug('[sendPushNotificationToResident] sending to Expo', {
        category: 'expo_push',
        reason: 'delivery_started',
        status: 'sending',
        messageCount: messages.length,
      });

      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      logger.debug('[sendPushNotificationToResident] Expo response', {
        category: 'expo_push',
        reason: resp.ok ? 'provider_accepted' : 'provider_rejected',
        status: resp.status,
        ok: resp.ok,
      });

      if (!resp.ok) {
        logger.error('[push-notification-service] Expo push failed', {
          category: 'expo_push',
          reason: 'provider_rejected',
          status: resp.status,
        });
        return { success: false, error: 'Expo push notification failed' };
      }
    }

    const { data: subs, error: subsError } = await adminSupabase
      .from('web_push_subscriptions')
      .select('endpoint,p256dh,auth')
      .eq('resident_id', userId);

    if (subsError) {
      logger.error('[push-notification-service] web push subscription query failed', {
        category: 'web_push_subscriptions',
        reason: 'database_read_failed',
        status: 'failed',
      });
    } else if (subs && subs.length > 0) {
      const result = await sendWebPush(subs, { title, body, data });
      if (result.expired.length > 0) {
        const { error: deleteError } = await adminSupabase
          .from('web_push_subscriptions')
          .delete()
          .in('endpoint', result.expired);

        if (deleteError) {
          logger.error('[push-notification-service] expired subscription cleanup failed', {
            category: 'web_push_subscriptions',
            reason: 'database_delete_failed',
            status: 'failed',
          });
        }
      }
    }

    return { success: true };
  } catch {
    logger.error('[push-notification-service] push notification failed', {
      category: 'push_delivery',
      reason: 'unexpected_failure',
      status: 'failed',
    });
    return { success: false, error: 'Push notification failed' };
  }
}
