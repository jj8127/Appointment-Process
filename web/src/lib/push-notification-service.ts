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
  logger.debug('[sendPushNotificationToResident] start', { userId, title, body });

  if (!userId) {
    logger.warn('[sendPushNotificationToResident] No userId provided');
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
      logger.warn('[sendPushNotificationToResident] notifications insert failed:', notifError);
    }
  }

  const { data: tokens, error: tokensError } = await adminSupabase
    .from('device_tokens')
    .select('expo_push_token')
    .eq('resident_id', userId);

  logger.debug('[sendPushNotificationToResident] tokens query result', {
    userId,
    tokenCount: tokens?.length ?? 0,
    tokens: tokens?.map((token) => token.expo_push_token),
    error: tokensError,
  });

  if (tokensError) {
    logger.error('[push-notification-service] Error fetching device tokens:', tokensError);
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

      logger.debug('[sendPushNotificationToResident] sending to Expo', { messageCount: messages.length });

      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      const respBody = await resp.text();
      logger.debug('[sendPushNotificationToResident] Expo response', {
        status: resp.status,
        ok: resp.ok,
        body: respBody,
      });

      if (!resp.ok) {
        logger.error('[push-notification-service] Expo Push Failed:', respBody);
        return { success: false, error: `Expo push notification failed: ${respBody}` };
      }
    }

    const { data: subs, error: subsError } = await adminSupabase
      .from('web_push_subscriptions')
      .select('endpoint,p256dh,auth')
      .eq('resident_id', userId);

    if (subsError) {
      logger.error('[push-notification-service] Error fetching web push subscriptions:', subsError);
    } else if (subs && subs.length > 0) {
      const result = await sendWebPush(subs, { title, body, data });
      if (result.expired.length > 0) {
        const { error: deleteError } = await adminSupabase
          .from('web_push_subscriptions')
          .delete()
          .in('endpoint', result.expired);

        if (deleteError) {
          logger.error('[push-notification-service] Error deleting expired subscriptions:', deleteError);
        }
      }
    }

    return { success: true };
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[push-notification-service] Push notification error:', error);
    return { success: false, error: error?.message ?? 'Push notification failed' };
  }
}
