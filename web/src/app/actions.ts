'use server';
import { sendWebPush } from '@/lib/web-push';

import { adminSupabase } from '@/lib/admin-supabase';
import { logger } from '@/lib/logger';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type PushDate = {
    title: string;
    body: string;
    data?: Record<string, unknown>;
};

export async function sendPushNotification(
    userId: string,
    { title, body, data }: PushDate
) {
    logger.debug('[sendPushNotification] start', { userId, title, body });

    if (!userId) {
        logger.warn('[sendPushNotification] No userId provided');
        return { success: false, error: 'No user ID provided' };
    }

    const targetUrl = typeof data?.url === 'string' ? data.url : null;

    // Insert into notifications table (using adminSupabase to bypass RLS)
    const notificationBase = {
        title,
        body,
        recipient_role: 'fc',
        resident_id: userId,
    } as const;

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
        logger.warn('[sendPushNotification] notifications insert failed:', notifError);
    }

    // Fetch Tokens
    const { data: tokens, error: tokensError } = await adminSupabase
        .from('device_tokens')
        .select('expo_push_token')
        .eq('resident_id', userId);

    logger.debug('[sendPushNotification] tokens query result', {
        userId,
        tokenCount: tokens?.length ?? 0,
        tokens: tokens?.map(t => t.expo_push_token),
        error: tokensError
    });

    if (tokensError) {
        logger.error('[actions] Error fetching device tokens:', tokensError);
        return { success: false, error: 'Failed to fetch device tokens' };
    }

    try {
        // Send Expo push notifications
        if (tokens && tokens.length > 0) {
            const uniqueTokens = Array.from(new Set(tokens.map(t => t.expo_push_token)));

            // Construct Expo Messages
            const messages = uniqueTokens.map(token => ({
                to: token,
                title,
                body,
                data,
                sound: 'default',
                priority: 'high',
                channelId: 'alerts',
            }));

            logger.debug('[sendPushNotification] sending to Expo', { messageCount: messages.length });

            const resp = await fetch(EXPO_PUSH_URL, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(messages),
            });

            const respBody = await resp.text();
            logger.debug('[sendPushNotification] Expo response', {
                status: resp.status,
                ok: resp.ok,
                body: respBody
            });

            if (!resp.ok) {
                logger.error('[actions] Expo Push Failed:', respBody);
                return { success: false, error: `Expo push notification failed: ${respBody}` };
            }
        }

        // Send web push notifications
        const { data: subs, error: subsError } = await adminSupabase
            .from('web_push_subscriptions')
            .select('endpoint,p256dh,auth')
            .eq('resident_id', userId);

        if (subsError) {
            logger.error('[actions] Error fetching web push subscriptions:', subsError);
        } else if (subs && subs.length > 0) {
            const result = await sendWebPush(subs, { title, body, data });
            if (result.expired.length > 0) {
                const { error: deleteError } = await adminSupabase
                    .from('web_push_subscriptions')
                    .delete()
                    .in('endpoint', result.expired);

                if (deleteError) {
                    logger.error('[actions] Error deleting expired subscriptions:', deleteError);
                }
            }
        }

        return { success: true };
    } catch (err: unknown) {
        const error = err as Error;
        logger.error('[actions] Push notification error:', error);
        return { success: false, error: error?.message ?? 'Push notification failed' };
    }
}
