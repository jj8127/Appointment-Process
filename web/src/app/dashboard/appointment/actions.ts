'use server';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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
        value: string | null; // Month (1-12) or Date (YYYY-MM-DD)
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
        // Schedule Update (Month)
        updatePayload[`appointment_schedule_${category}`] = value;
        notifTitle = '위촉 예정월 안내';
        notifBody = `${categoryLabel} 위촉 예정월이 ${value}월로 업데이트되었습니다.`;
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
    const { error: updateError } = await supabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId);

    if (updateError) {
        return { success: false, error: `업데이트 실패: ${updateError.message}` };
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
    // 모바일 앱은 resident_id(전화번호) 기준으로 토큰을 저장하므로 동일 키로 조회해야 한다.
    const { data: tokens, error: tokenQueryError } = await supabase
        .from('device_tokens')
        .select('expo_push_token')
        .eq('resident_id', phone);

    console.log('[push][appointment] token query', {
        fcId,
        phone,
        tokenQueryError: tokenQueryError?.message,
        tokenCount: tokens?.length,
        tokens,
    });

    if (tokens && tokens.length > 0) {
        // Deduplicate tokens
        const uniqueTokens = Array.from(new Set(tokens.map(t => t.expo_push_token)));

        const pushPayload = uniqueTokens.map((token) => ({
            to: token,
            title: notifTitle,
            body: notifBody,
            data: { type: 'appointment' },
        }));

        try {
            const resp = await fetch(EXPO_PUSH_URL, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(pushPayload),
            });
            const text = await resp.text();
            console.log('[push][appointment] fetch response', {
                status: resp.status,
                ok: resp.ok,
                body: text,
            });
        } catch (e) {
            console.error('[push][appointment] fetch error', e);
        }
    } else {
        console.warn('[push][appointment] no tokens found', { fcId, phone });
    }

    revalidatePath('/dashboard/appointment');
    return { success: true, message: '처리 완료' };
}
