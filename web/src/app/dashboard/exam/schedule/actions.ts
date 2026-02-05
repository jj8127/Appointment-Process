'use server';

import { adminSupabase } from '@/lib/admin-supabase';
import { logger } from '@/lib/logger';

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
        logger.info('[deleteExamRound] Starting deletion', { roundId });

        // 1. 시험 신청 삭제 (CASCADE 대신 명시적 삭제)
        const { error: regError, count: regCount } = await adminSupabase
            .from('exam_registrations')
            .delete({ count: 'exact' })
            .eq('round_id', roundId);
        if (regError) throw regError;
        logger.info('[deleteExamRound] Deleted registrations', { roundId, count: regCount });

        // 2. 시험 장소 삭제
        const { error: locError, count: locCount } = await adminSupabase
            .from('exam_locations')
            .delete({ count: 'exact' })
            .eq('round_id', roundId);
        if (locError) throw locError;
        logger.info('[deleteExamRound] Deleted locations', { roundId, count: locCount });

        // 3. 시험 회차 삭제
        const { error: roundError, count: roundCount } = await adminSupabase
            .from('exam_rounds')
            .delete({ count: 'exact' })
            .eq('id', roundId);
        if (roundError) throw roundError;
        logger.info('[deleteExamRound] Deleted round', { roundId, count: roundCount });

        // 검증: 시험 회차가 실제로 삭제되었는지 확인
        if (roundCount === 0) {
            logger.warn('[deleteExamRound] No round deleted', { roundId });
            return { success: false, error: '시험 회차를 찾을 수 없습니다.' };
        }

        logger.info('[deleteExamRound] Deletion completed', {
            roundId,
            deletedRegistrations: regCount,
            deletedLocations: locCount,
            deletedRounds: roundCount
        });

        return { success: true, message: '삭제 완료' };
    } catch (err: any) {
        return { success: false, error: err?.message ?? '삭제 중 오류가 발생했습니다.' };
    }
}
