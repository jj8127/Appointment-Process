'use server';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { sendPushNotification } from '../../actions';

type UpdateDocStatusState = {
    success: boolean;
    message?: string;
    error?: string;
};

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
    const { fcId, phone, docType, status, reason } = payload;
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

    // 1. Update individual document status
    const reviewerNote =
        status === 'rejected' ? (reason ?? '').trim() || null : status === 'approved' ? null : undefined;
    const { error: updateError } = await supabase
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

    // 2. Check for Auto-Advance logic if Approved
    if (status === 'approved') {
        const { data: allDocs, error: fetchError } = await supabase
            .from('fc_documents')
            .select('status, storage_path')
            .eq('fc_id', fcId);

        if (fetchError) {
            console.error('Error fetching docs for auto-advance check:', fetchError);
        } else {
            const docs = allDocs ?? [];
            const allSubmitted =
                docs.length > 0 &&
                docs.every((d) => d.storage_path && d.storage_path !== 'deleted');
            const allApproved = allSubmitted && docs.every((d) => d.status === 'approved');
            // If all requested docs are submitted and approved, advance status
            if (allApproved) {
                // Update Profile Status
                const { error: profileError } = await supabase
                    .from('fc_profiles')
                    .update({ status: 'docs-approved' })
                    .eq('id', fcId);

                if (!profileError) {
                    message = '모든 서류가 승인되어 위촉 URL 진행 단계로 자동 전환되었습니다.';

                    // Notification
                    const title = '서류 검토 완료';
                    const body = '모든 서류가 승인되었습니다. 위촉 계약 단계로 진행해주세요.';

                    await supabase.from('notifications').insert({
                        title,
                        body,
                        recipient_role: 'fc',
                        resident_id: phone,
                    });

                    await sendPushNotification(phone, {
                        title,
                        body,
                        data: { url: '/appointment' }
                    });
                }
            }
        }
    } else if (status === 'rejected') {
        await supabase
            .from('fc_profiles')
            .update({ status: 'docs-pending' })
            .eq('id', fcId);

        const title = '서류 반려 안내';
        const body = `서류가 반려되었습니다.\n사유: ${(reason ?? '').trim() || '사유 없음'}`;
        await supabase.from('notifications').insert({
            title,
            body,
            recipient_role: 'fc',
            resident_id: phone,
        });
        await sendPushNotification(phone, { title, body, data: { url: '/docs-upload' } });
    }

    revalidatePath('/dashboard');
    return { success: true, message };
}
