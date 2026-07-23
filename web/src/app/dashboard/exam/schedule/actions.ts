'use server';

import { adminSupabase } from '@/lib/admin-supabase';
import { buildExamRoundNotificationPayload } from '@/lib/exam-round-notification';
import { logger } from '@/lib/logger';
import {
    parseExamRoundDeleteInput,
    parseExamRoundSaveInput,
} from '@/lib/privileged-action-input-policy';
import {
    getVerifiedAdminSession,
    getVerifiedReadOnlyAdminSession,
} from '@/lib/server-session';

type DeleteRoundState = {
    success: boolean;
    error?: string;
    message?: string;
};

type SaveRoundState = {
    success: boolean;
    error?: string;
    message?: string;
    roundId?: string;
    notificationWarning?: string;
};

type NotificationDeliveryResult =
    | { ok: true; accepted: number }
    | {
        ok: false;
        reason: 'invoke_failed' | 'invalid_response' | 'not_logged' | 'no_accepted_target';
    };

const errorMessage = (err: unknown, fallback: string) => {
    if (err instanceof Error && err.message) return err.message;
    return fallback;
};

const readErrorCode = (err: unknown) => {
    if (!err || typeof err !== 'object') return '';
    const code = (err as Record<string, unknown>).code;
    return typeof code === 'string' ? code : '';
};

const examRoundSaveErrorMessage = (err: unknown) => {
    if (readErrorCode(err) === 'PGRST202') {
        return '시험 일정 저장 기능의 운영 DB 설정이 아직 반영되지 않았습니다.';
    }
    return errorMessage(err, '저장 중 오류가 발생했습니다.');
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;

const readNonNegativeInteger = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.trunc(value))
        : 0;

async function notifyExamRoundChanged(
    title: string,
    body: string,
    examType: 'life' | 'nonlife',
): Promise<NotificationDeliveryResult> {
    try {
        const { data, error } = await adminSupabase.functions.invoke('fc-notify', {
            body: buildExamRoundNotificationPayload({
                title,
                body,
                examType,
            }),
        });

        if (error) {
            return { ok: false, reason: 'invoke_failed' };
        }

        const response = asRecord(data);
        if (!response || response.ok !== true) {
            return { ok: false, reason: 'invalid_response' };
        }
        if (response.logged !== true) {
            return { ok: false, reason: 'not_logged' };
        }

        const delivery = asRecord(response.delivery);
        const accepted = readNonNegativeInteger(delivery?.accepted);
        if (accepted < 1 || readNonNegativeInteger(response.sent) !== accepted) {
            return { ok: false, reason: 'no_accepted_target' };
        }

        return { ok: true, accepted };
    } catch {
        return { ok: false, reason: 'invoke_failed' };
    }
}

export async function saveExamRoundAction(
    prevState: SaveRoundState,
    payload: unknown,
): Promise<SaveRoundState> {
    void prevState;
    const sessionCheck = await getVerifiedAdminSession();
    if (!sessionCheck.ok) {
        logger.warn('[saveExamRound] unauthorized server action', { status: sessionCheck.status });
        return { success: false, error: sessionCheck.error };
    }

    const parsedInput = parseExamRoundSaveInput(payload);
    if (!parsedInput.ok) {
        return { success: false, error: parsedInput.error };
    }

    const {
        roundId,
        exam_date,
        registration_deadline,
        round_label,
        exam_type,
        notes,
        locations: normalizedLocations,
    } = parsedInput.value;

    try {
        const { data: targetRoundId, error: saveError } = await adminSupabase.rpc(
            'save_exam_round_atomic',
            {
                p_round_id: roundId,
                p_exam_date: exam_date,
                p_registration_deadline: registration_deadline,
                p_round_label: round_label,
                p_exam_type: exam_type,
                p_notes: notes,
                p_locations: normalizedLocations,
            },
        );
        if (saveError) throw saveError;
        if (typeof targetRoundId !== 'string' || !targetRoundId) {
            return { success: false, error: '시험 회차 ID를 확인할 수 없습니다.' };
        }

        const dateLabel = exam_date ?? '미정';
        const actionText = roundId ? '수정' : '등록';
        const title = `${dateLabel}${round_label ? ` (${round_label})` : ''} 일정 ${actionText}`;
        const body = `시험 일정이 ${actionText}되었습니다.`;
        const notificationResult = await notifyExamRoundChanged(title, body, exam_type);
        if (!notificationResult.ok) {
            logger.warn('[saveExamRound] notification delivery incomplete', {
                category: 'exam_round',
                reason: notificationResult.reason,
                status: 'warning',
            });
        }

        return {
            success: true,
            message: '저장 완료',
            roundId: targetRoundId,
            notificationWarning: notificationResult.ok
                ? undefined
                : '시험 일정은 저장됐지만 가람in 알림 전달을 확인하지 못했습니다.',
        };
    } catch (err: unknown) {
        logger.error('[saveExamRound] failed', {
            name: err instanceof Error ? err.name : 'DatabaseError',
            code: readErrorCode(err) || 'unknown',
        });
        return { success: false, error: examRoundSaveErrorMessage(err) };
    }
}

export async function fetchExamRoundsAction(): Promise<{
    success: boolean;
    data?: Array<{
        id: string;
        exam_date: string | null;
        registration_deadline: string;
        round_label: string;
        exam_type?: string;
        notes?: string;
        created_at?: string;
        locations: { id: string; location_name: string }[];
    }>;
    error?: string;
}> {
    const sessionCheck = await getVerifiedReadOnlyAdminSession();
    if (!sessionCheck.ok) {
        logger.warn('[fetchExamRounds] unauthorized server action', { status: sessionCheck.status });
        return { success: false, error: sessionCheck.error };
    }

    try {
        const { data, error } = await adminSupabase
            .from('exam_rounds')
            .select(`*, exam_locations ( id, location_name )`)
            .order('exam_date', { ascending: false, nullsFirst: false })
            .order('registration_deadline', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;

        type RoundRow = {
            id: string;
            exam_date: string | null;
            registration_deadline: string;
            round_label: string;
            exam_type?: string;
            notes?: string;
            created_at?: string;
            exam_locations?: { id: string; location_name: string }[] | null;
        };
        const rounds = (data ?? [] as RoundRow[]).map((r) => {
            const row = r as RoundRow;
            return {
                id: row.id,
                exam_date: row.exam_date,
                registration_deadline: row.registration_deadline,
                round_label: row.round_label,
                exam_type: row.exam_type,
                notes: row.notes,
                created_at: row.created_at,
                locations: row.exam_locations || [],
            };
        });

        return { success: true, data: rounds };
    } catch (err: unknown) {
        logger.error('[fetchExamRounds] failed', err);
        return { success: false, error: errorMessage(err, '시험 일정 조회 실패') };
    }
}

export async function deleteExamRoundAction(
    prevState: DeleteRoundState,
    payload: unknown,
): Promise<DeleteRoundState> {
    void prevState;
    const sessionCheck = await getVerifiedAdminSession();
    if (!sessionCheck.ok) {
        logger.warn('[deleteExamRound] unauthorized server action', { status: sessionCheck.status });
        return { success: false, error: sessionCheck.error };
    }

    const parsedInput = parseExamRoundDeleteInput(payload);
    if (!parsedInput.ok) {
        return { success: false, error: parsedInput.error };
    }
    const { roundId } = parsedInput.value;

        try {
            logger.info('[deleteExamRound] Starting deletion', { roundId });

            // One database statement keeps the destructive operation atomic. The
            // schema cascades locations and registrations from the deleted round.
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
                deletedRounds: roundCount
            });

        return { success: true, message: '삭제 완료' };
    } catch (err: unknown) {
        return { success: false, error: errorMessage(err, '삭제 중 오류가 발생했습니다.') };
    }
}
