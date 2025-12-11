'use server';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { sendPushNotification } from '../../actions';

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
        fcId: number;
        phone: string;
        type: AppointmentActionType;
        category: AppointmentCategory;
        value: string | null; // 자유 입력 일정 메모 또는 Date(YYYY-MM-DD)
    }
): Promise<UpdateAppointmentState> {
    const { fcId, phone, type, category, value } = payload;
    const cookieStore = await cookies();

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) {
                    try { cookieStore.set({ name, value, ...options }); } catch (error) { }
                },
                remove(name: string, options: CookieOptions) {
                    try { cookieStore.set({ name, value: '', ...options }); } catch (error) { }
                },
            },
        }
    );

    const categoryLabel = category === 'life' ? '생명보험' : '손해보험';
    let updatePayload: any = {};
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
        notifTitle = '위촉 최종 승인';
        notifBody = `축하합니다! ${categoryLabel} 위촉이 최종 승인되었습니다. (확정일: ${value})`;
    } else if (type === 'reject') {
        // Reject (Clear Date)
        updatePayload[`appointment_date_${category}`] = null;
        notifTitle = '위촉 정보 반려';
        notifBody = `${categoryLabel} 위촉 정보가 반려되었습니다. 관리자에게 문의하세요.`;
    }

    // 2. Perform DB Update
    const { data: updatedProfile, error: updateError } = await supabase
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
            const { error: statusError } = await supabase
                .from('fc_profiles')
                .update({ status: nextStatus })
                .eq('id', fcId);

            if (statusError) {
                console.error('Status update failed:', statusError);
                // Non-fatal, but good to log
            }
        }
    }

    // 3. Insert Notification History
    const { error: notifError } = await supabase.from('notifications').insert({
        title: notifTitle,
        body: notifBody,
        recipient_role: 'fc',
        resident_id: phone,
    });
    if (notifError) console.error('Notification insert failed:', notifError);

    // 4. Send Push Notification
    const { success, error: pushError } = await sendPushNotification(phone, {
        title: notifTitle,
        body: notifBody,
        data: { url: '/appointment' },
    });

    if (!success) {
        console.error('[push][appointment] failed:', pushError);
    }

    revalidatePath('/dashboard/appointment');
    return { success: true, message: '처리 완료' };
}
