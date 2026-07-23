'use server';

import { logger } from '@/lib/logger';
import { adminSupabase } from '@/lib/admin-supabase';
import { parseFcNotificationPhone } from '@/lib/privileged-action-input-policy';
import { sendPushNotificationToResident, type PushPayload } from '@/lib/push-notification-service';
import { getVerifiedAdminSession } from '@/lib/server-session';

export async function sendPushNotification(
    userId: string,
    payload: PushPayload
) {
    logger.debug('[sendPushNotification] start', {
        category: 'push_delivery',
        status: 'pending',
    });

    const sessionCheck = await getVerifiedAdminSession();
    if (!sessionCheck.ok) {
        logger.warn('[sendPushNotification] unauthorized server action', { status: sessionCheck.status });
        return { success: false, error: sessionCheck.error };
    }

    return sendPushNotificationToResident(userId, payload);
}

export async function sendPushNotificationForFc(
    fcId: string,
    payload: PushPayload,
) {
    const sessionCheck = await getVerifiedAdminSession();
    if (!sessionCheck.ok) {
        logger.warn('[sendPushNotificationForFc] unauthorized server action', {
            status: sessionCheck.status,
        });
        return { success: false, error: sessionCheck.error };
    }

    const { data: profile, error } = await adminSupabase
        .from('fc_profiles')
        .select('phone')
        .eq('id', fcId)
        .eq('signup_completed', true)
        .maybeSingle();
    if (error || !profile) {
        logger.warn('[sendPushNotificationForFc] canonical recipient unavailable', {
            reason: error ? 'lookup_failed' : 'not_found',
        });
        return { success: false, error: 'Notification delivery incomplete' as const };
    }

    const phoneResult = parseFcNotificationPhone(profile.phone);
    if (!phoneResult.ok) {
        logger.warn('[sendPushNotificationForFc] canonical recipient unavailable', {
            reason: 'invalid_recipient',
        });
        return { success: false, error: 'Notification delivery incomplete' as const };
    }

    return sendPushNotificationToResident(phoneResult.value, payload);
}
