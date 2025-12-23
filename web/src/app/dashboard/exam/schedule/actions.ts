'use server';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

type DeleteRoundState = {
    success: boolean;
    error?: string;
    message?: string;
};

export async function deleteExamRoundAction(
    prevState: DeleteRoundState,
    payload: { roundId: string }
): Promise<DeleteRoundState> {
    const { roundId } = payload;
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

    if (!roundId) {
        return { success: false, error: 'roundId가 없습니다.' };
    }

    try {
        const { error: regError } = await supabase
            .from('exam_registrations')
            .delete()
            .eq('round_id', roundId);
        if (regError) throw regError;

        const { error: locError } = await supabase
            .from('exam_locations')
            .delete()
            .eq('round_id', roundId);
        if (locError) throw locError;

        const { error: roundError } = await supabase
            .from('exam_rounds')
            .delete()
            .eq('id', roundId);
        if (roundError) throw roundError;

        return { success: true, message: '삭제 완료' };
    } catch (err: any) {
        return { success: false, error: err?.message ?? '삭제 중 오류가 발생했습니다.' };
    }
}
