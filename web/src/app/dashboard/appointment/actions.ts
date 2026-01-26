'use server';

import { revalidatePath } from 'next/cache';
import { sendPushNotification } from '../../actions';
import { verifyOrigin, checkRateLimit } from '@/lib/csrf';
import { adminSupabase } from '@/lib/admin-supabase';

import { logger } from '@/lib/logger';
type UpdateAppointmentState = {
    success: boolean;
    message?: string;
    error?: string;
};

type AppointmentActionType = 'schedule' | 'confirm' | 'reject';
type AppointmentCategory = 'life' | 'nonlife';

export async function updateAppointmentAction(
    prevState: UpdateAppointmentState,
    payload: {
        fcId: string;
        phone: string;
        type: AppointmentActionType;
        category: AppointmentCategory;
        value: string | null; // 자유 입력 일정 메모 또는 Date(YYYY-MM-DD)
        reason?: string | null;
    }
): Promise<UpdateAppointmentState> {
    // Security: Verify origin to prevent CSRF
    const originCheck = await verifyOrigin();
    if (!originCheck.valid) {
        logger.error('[appointment/actions] Origin verification failed:', originCheck.error);
        return { success: false, error: 'Security check failed' };
    }

    // Security: Rate limiting (max 20 appointment updates per minute per FC)
    const rateLimit = checkRateLimit(`appointment:${payload.fcId}`, 20, 60000);
    if (!rateLimit.allowed) {
        logger.warn('[appointment/actions] Rate limit exceeded for FC:', payload.fcId);
        return { success: false, error: 'Too many requests. Please try again later.' };
    }

    const { fcId, phone, type, category, value, reason } = payload;

    const categoryLabel = category === 'life' ? '생명보험' : '손해보험';
    const updatePayload: Record<string, string | null> = {};
    let notifTitle = '';
    let notifBody = '';

    // 1. Determine Update Logic & Notification
    if (type === 'schedule') {
        // Schedule Update (Free text)
        updatePayload[`appointment_schedule_${category}`] = value;
        notifTitle = '위촉 예정월 안내';
        notifBody = `${categoryLabel} 위촉 예정 정보가 ${value ?? '미입력'}로 업데이트되었습니다.`;
    } else if (type === 'confirm') {
        // Confirm (Date)
        updatePayload[`appointment_date_${category}`] = value;
        updatePayload[`appointment_reject_reason_${category}`] = null;
        notifTitle = '위촉 최종 승인';
        notifBody = `축하합니다! ${categoryLabel} 위촉이 최종 승인되었습니다. (확정일: ${value})`;
    } else if (type === 'reject') {
        // Reject (Clear Date)
        updatePayload[`appointment_date_${category}`] = null;
        updatePayload[`appointment_date_${category}_sub`] = null;
        updatePayload[`appointment_reject_reason_${category}`] = (reason ?? '').trim() || null;
        notifTitle = '위촉 정보 반려';
        notifBody = `${categoryLabel} 위촉 정보가 반려되었습니다.\n사유: ${(reason ?? '').trim() || '사유 없음'}`;
    }

    // 2. Perform DB Update
    const { data: updatedProfile, error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select()
        .single();

    if (updateError) {
        return { success: false, error: `업데이트 실패: ${updateError.message}` };
    }

    // 2.1 Update Status based on Mobile Logic
    // Mobile Logic:
    // const bothSet = Boolean(data?.appointment_date_life) && Boolean(data?.appointment_date_nonlife);
    // const nextStatus = date === null ? 'docs-approved' : bothSet ? 'final-link-sent' : 'appointment-completed';

    // We need to determine the 'nextStatus' based on the UPDATED profile data.
    // 'value' is the input. IF type is 'reject', value is effectively null logic (cleared).
    // IF type is 'confirm', value is set.

    // Mobile logic uses the *input* date to decide if it's a rejection (reset to docs-approved)
    // OR looks at the state.
    // Let's replicate strict logic:
    // If we JUST cleared a date (type === reject), we go back to 'docs-approved'.
    // If we JUST set a date (type === confirm), we check if BOTH are set.

    if (type === 'confirm' || type === 'reject') {
        let nextStatus = '';
        if (type === 'reject') {
            // If rejecting, Mobile logic suggests reverting to docs-approved.
            // "date === null ? 'docs-approved'"
            nextStatus = 'docs-approved';
        } else {
            // Confirming
            const lifeSet = !!updatedProfile.appointment_date_life;
            const nonlifeSet = !!updatedProfile.appointment_date_nonlife;
            if (lifeSet && nonlifeSet) {
                nextStatus = 'final-link-sent';
            } else {
                nextStatus = 'appointment-completed';
            }
        }

        if (nextStatus) {
            const { error: statusError } = await adminSupabase
                .from('fc_profiles')
                .update({ status: nextStatus })
                .eq('id', fcId);

            if (statusError) {
                logger.error('Status update failed:', statusError);
                // Non-fatal, but good to log
            }
        }
    }

    // 3. Insert Notification History
    const { error: notifError } = await adminSupabase.from('notifications').insert({
        title: notifTitle,
        body: notifBody,
        recipient_role: 'fc',
        resident_id: phone,
    });
    if (notifError) logger.error('Notification insert failed:', notifError);

    // 4. Send Push Notification
    const { success, error: pushError } = await sendPushNotification(phone, {
        title: notifTitle,
        body: notifBody,
        data: { url: '/appointment' },
    });

    if (!success) {
        logger.error('[push][appointment] failed:', pushError);
    }

    revalidatePath('/dashboard/appointment');
    return { success: true, message: '처리 완료' };
}
