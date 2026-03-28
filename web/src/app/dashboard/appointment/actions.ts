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

const HANWHA_APPROVED_STATUSES = ['hanwha-commission-approved', 'appointment-completed', 'final-link-sent'] as const;

const trimValue = (value?: string | null) => String(value ?? '').trim();

const hasHanwhaApprovedPdf = (profile: {
    status?: string | null;
    hanwha_commission_date?: string | null;
    hanwha_commission_pdf_path?: string | null;
    hanwha_commission_pdf_name?: string | null;
}) =>
    Boolean(
        (profile.hanwha_commission_date || HANWHA_APPROVED_STATUSES.includes(String(profile.status ?? '') as (typeof HANWHA_APPROVED_STATUSES)[number])) &&
        trimValue(profile.hanwha_commission_pdf_path) &&
        trimValue(profile.hanwha_commission_pdf_name),
    );

const hasExistingInsuranceActivity = (profile: {
    appointment_schedule_life?: string | null;
    appointment_schedule_nonlife?: string | null;
    appointment_date_life_sub?: string | null;
    appointment_date_nonlife_sub?: string | null;
    appointment_reject_reason_life?: string | null;
    appointment_reject_reason_nonlife?: string | null;
    appointment_date_life?: string | null;
    appointment_date_nonlife?: string | null;
    life_commission_completed?: boolean | null;
    nonlife_commission_completed?: boolean | null;
}) =>
    Boolean(
        profile.appointment_schedule_life ||
        profile.appointment_schedule_nonlife ||
        profile.appointment_date_life_sub ||
        profile.appointment_date_nonlife_sub ||
        profile.appointment_reject_reason_life ||
        profile.appointment_reject_reason_nonlife ||
        profile.appointment_date_life ||
        profile.appointment_date_nonlife ||
        profile.life_commission_completed ||
        profile.nonlife_commission_completed,
    );

const resolveInsuranceStageStatus = (profile: {
    status?: string | null;
    hanwha_commission_date?: string | null;
    hanwha_commission_pdf_path?: string | null;
    hanwha_commission_pdf_name?: string | null;
    appointment_schedule_life?: string | null;
    appointment_schedule_nonlife?: string | null;
    appointment_date_life_sub?: string | null;
    appointment_date_nonlife_sub?: string | null;
    appointment_reject_reason_life?: string | null;
    appointment_reject_reason_nonlife?: string | null;
    appointment_date_life?: string | null;
    appointment_date_nonlife?: string | null;
    life_commission_completed?: boolean | null;
    nonlife_commission_completed?: boolean | null;
}) => {
    const lifeDone = Boolean(profile.appointment_date_life || profile.life_commission_completed);
    const nonlifeDone = Boolean(profile.appointment_date_nonlife || profile.nonlife_commission_completed);

    if (lifeDone && nonlifeDone) {
        return 'final-link-sent';
    }

    if (hasExistingInsuranceActivity(profile)) {
        return 'appointment-completed';
    }

    if (hasHanwhaApprovedPdf(profile)) {
        return 'hanwha-commission-approved';
    }

    return 'hanwha-commission-review';
};

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

    const { data: currentProfile, error: profileError } = await adminSupabase
        .from('fc_profiles')
        .select('status,hanwha_commission_date,hanwha_commission_pdf_path,hanwha_commission_pdf_name,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,appointment_reject_reason_life,appointment_reject_reason_nonlife,appointment_date_life,appointment_date_nonlife,life_commission_completed,nonlife_commission_completed')
        .eq('id', fcId)
        .single();

    if (profileError) {
        return { success: false, error: `프로필 조회 실패: ${profileError.message}` };
    }

    if (!hasExistingInsuranceActivity(currentProfile) && !hasHanwhaApprovedPdf(currentProfile)) {
        return { success: false, error: '한화 위촉 승인과 PDF 등록이 끝난 뒤에만 보험 위촉 URL 단계를 진행할 수 있습니다.' };
    }

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

    if (type === 'confirm' || type === 'reject') {
        let nextStatus = '';
        nextStatus = resolveInsuranceStageStatus(updatedProfile);

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
        target_url: '/appointment',
        recipient_role: 'fc',
        resident_id: phone,
    });
    if (notifError) logger.error('Notification insert failed:', notifError);

    // 4. Send Push Notification
    const { success, error: pushError } = await sendPushNotification(phone, {
        title: notifTitle,
        body: notifBody,
        data: { url: '/appointment' },
        skipNotificationInsert: true,
    });

    if (!success) {
        logger.error('[push][appointment] failed:', pushError);
    }

    revalidatePath('/dashboard/appointment');
    return { success: true, message: '처리 완료' };
}
