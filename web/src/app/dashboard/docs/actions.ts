'use server';

import { revalidatePath } from 'next/cache';
import { sendPushNotification } from '../../actions';
import { verifyOrigin, checkRateLimit } from '@/lib/csrf';
import { adminSupabase } from '@/lib/admin-supabase';

import { logger } from '@/lib/logger';
type UpdateDocStatusState = {
    success: boolean;
    message?: string;
    error?: string;
};

function buildDocWorkflowResetPayload() {
    return {
        hanwha_commission_date_sub: null,
        hanwha_commission_date: null,
        hanwha_commission_reject_reason: null,
        hanwha_commission_pdf_path: null,
        hanwha_commission_pdf_name: null,
        appointment_url: null,
        appointment_date: null,
        appointment_schedule_life: null,
        appointment_schedule_nonlife: null,
        appointment_date_life_sub: null,
        appointment_date_nonlife_sub: null,
        appointment_reject_reason_life: null,
        appointment_reject_reason_nonlife: null,
        appointment_date_life: null,
        appointment_date_nonlife: null,
        life_commission_completed: false,
        nonlife_commission_completed: false,
    };
}

export async function updateDocStatusAction(
    prevState: UpdateDocStatusState,
    payload: {
        fcId: string;
        phone: string;
        docType: string;
        status: 'approved' | 'rejected' | 'pending';
        reason?: string | null;
    }
): Promise<UpdateDocStatusState> {
    // Security: Verify origin to prevent CSRF
    const originCheck = await verifyOrigin();
    if (!originCheck.valid) {
        logger.error('[docs/actions] Origin verification failed:', originCheck.error);
        return { success: false, error: 'Security check failed' };
    }

    // Security: Rate limiting (max 30 document updates per minute per FC)
    const rateLimit = checkRateLimit(`docs:${payload.fcId}`, 30, 60000);
    if (!rateLimit.allowed) {
        logger.warn('[docs/actions] Rate limit exceeded for FC:', payload.fcId);
        return { success: false, error: 'Too many requests. Please try again later.' };
    }

    const { fcId, phone, docType, status, reason } = payload;

    // 1. Update individual document status
    const reviewerNote =
        status === 'rejected' ? (reason ?? '').trim() || null : status === 'approved' ? null : undefined;
    const { error: updateError } = await adminSupabase
        .from('fc_documents')
        .update({
            status,
            ...(reviewerNote !== undefined ? { reviewer_note: reviewerNote } : {}),
        })
        .eq('fc_id', fcId)
        .eq('doc_type', docType);

    if (updateError) {
        return { success: false, error: updateError.message };
    }

    let message = '서류 상태가 업데이트되었습니다.';

    const { data: allDocs, error: fetchError } = await adminSupabase
        .from('fc_documents')
        .select('status, storage_path')
        .eq('fc_id', fcId);

    if (fetchError) {
        logger.error('Error fetching docs for auto-advance check:', fetchError);
        return { success: false, error: fetchError.message };
    }

    const docs = allDocs ?? [];
    const allSubmitted =
        docs.length > 0 &&
        docs.every((d) => d.storage_path && d.storage_path !== 'deleted');
    const allApproved = allSubmitted && docs.every((d) => d.status === 'approved');

    const { error: profileError } = await adminSupabase
        .from('fc_profiles')
        .update(
            allApproved
                ? { status: 'docs-approved' }
                : {
                    status: 'docs-pending',
                    ...buildDocWorkflowResetPayload(),
                },
        )
        .eq('id', fcId);

    if (profileError) {
        return { success: false, error: profileError.message };
    }

    if (status === 'approved' && allApproved) {
        message = '모든 서류가 승인되어 한화 위촉 단계로 자동 전환되었습니다.';

        const title = '서류 검토 완료';
        const body = '모든 서류가 승인되었습니다. 한화 위촉 단계로 진행해주세요.';

        await adminSupabase.from('notifications').insert({
            title,
            body,
            target_url: '/hanwha-commission',
            recipient_role: 'fc',
            resident_id: phone,
        });

        await sendPushNotification(phone, {
            title,
            body,
            data: { url: '/hanwha-commission' },
            skipNotificationInsert: true,
        });
    } else if (status === 'rejected') {
        const title = '서류 반려 안내';
        const body = `서류가 반려되었습니다.\n사유: ${(reason ?? '').trim() || '사유 없음'}`;
        await adminSupabase.from('notifications').insert({
            title,
            body,
            target_url: '/docs-upload',
            recipient_role: 'fc',
            resident_id: phone,
        });
        await sendPushNotification(phone, { title, body, data: { url: '/docs-upload' }, skipNotificationInsert: true });
    }

    revalidatePath('/dashboard');
    return { success: true, message };
}
