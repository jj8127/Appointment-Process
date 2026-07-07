'use server';

import { logger } from '@/lib/logger';
import { sendPushNotificationToResident, type PushPayload } from '@/lib/push-notification-service';
import { getVerifiedAdminSession } from '@/lib/server-session';

export async function sendPushNotification(
    userId: string,
    payload: PushPayload
) {
    logger.debug('[sendPushNotification] start', { userId, title: payload.title, body: payload.body });

    const sessionCheck = await getVerifiedAdminSession();
    if (!sessionCheck.ok) {
        logger.warn('[sendPushNotification] unauthorized server action', { status: sessionCheck.status });
        return { success: false, error: sessionCheck.error };
    }

    return sendPushNotificationToResident(userId, payload);
}
