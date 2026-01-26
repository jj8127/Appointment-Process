'use server';

import { adminSupabase } from '@/lib/admin-supabase';

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

    if (!roundId) {
        return { success: false, error: 'roundId가 없습니다.' };
    }

    try {
        const { error: regError } = await adminSupabase
            .from('exam_registrations')
            .delete()
            .eq('round_id', roundId);
        if (regError) throw regError;

        const { error: locError } = await adminSupabase
            .from('exam_locations')
            .delete()
            .eq('round_id', roundId);
        if (locError) throw locError;

        const { error: roundError } = await adminSupabase
            .from('exam_rounds')
            .delete()
            .eq('id', roundId);
        if (roundError) throw roundError;

        return { success: true, message: '삭제 완료' };
    } catch (err: any) {
        return { success: false, error: err?.message ?? '삭제 중 오류가 발생했습니다.' };
    }
}
