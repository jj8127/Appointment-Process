'use server';

import { adminSupabase } from '@/lib/admin-supabase';
import { logger } from '@/lib/logger';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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
};

type SaveRoundPayload = {
    roundId?: string | null;
    exam_date: string | null;
    registration_deadline: string;
    round_label: string;
    exam_type: 'life' | 'nonlife';
    notes?: string | null;
    locations: string[];
    actionLabel?: '등록' | '수정';
};

const errorMessage = (err: unknown, fallback: string) => {
    if (err instanceof Error && err.message) return err.message;
    return fallback;
};

async function notifyExamRoundChanged(title: string, body: string) {
    const { error: notifError } = await adminSupabase.from('notifications').insert({
        title,
        body,
        category: 'exam_round',
        recipient_role: 'fc',
        resident_id: null,
    });
    if (notifError) {
        logger.warn('[saveExamRound] notifications insert failed', notifError);
    }

    const { data: tokens, error: tokenError } = await adminSupabase
        .from('device_tokens')
        .select('expo_push_token')
        .eq('role', 'fc');
    if (tokenError) {
        logger.warn('[saveExamRound] token query failed', tokenError);
        return;
    }

    const payload = (tokens ?? [])
        .map((t: { expo_push_token: string | null }) => t.expo_push_token)
        .filter((token): token is string => Boolean(token))
        .map((token) => ({
            to: token,
            title,
            body,
            data: { type: 'exam_round', url: '/exam/apply' },
            sound: 'default',
            priority: 'high',
            channelId: 'alerts',
        }));

    if (!payload.length) return;

    try {
        await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        logger.warn('[saveExamRound] expo push failed', err);
    }
}

export async function saveExamRoundAction(
    prevState: SaveRoundState,
    payload: SaveRoundPayload,
): Promise<SaveRoundState> {
    void prevState;
    const {
        roundId,
        exam_date,
        registration_deadline,
        round_label,
        exam_type,
        notes,
        locations,
        actionLabel,
    } = payload;

    if (!registration_deadline || !exam_type || !round_label?.trim()) {
        return { success: false, error: '필수 입력값이 누락되었습니다.' };
    }

    const normalizedLocations = Array.from(
        new Set((locations ?? []).map((loc) => loc.trim()).filter(Boolean)),
    );
    if (!normalizedLocations.length) {
        return { success: false, error: '최소 1개의 장소를 등록해주세요.' };
    }

    try {
        const rowPayload = {
            exam_date,
            registration_deadline,
            round_label: round_label.trim(),
            exam_type,
            notes: (notes ?? '').trim() || null,
        };

        let targetRoundId = roundId ?? null;
        if (targetRoundId) {
            const { error } = await adminSupabase
                .from('exam_rounds')
                .update(rowPayload)
                .eq('id', targetRoundId);
            if (error) throw error;
        } else {
            const { data, error } = await adminSupabase
                .from('exam_rounds')
                .insert(rowPayload)
                .select('id')
                .single();
            if (error) throw error;
            targetRoundId = data.id;
        }

        if (!targetRoundId) {
            return { success: false, error: '시험 회차 ID를 확인할 수 없습니다.' };
        }

        const { data: existingLocs, error: locFetchErr } = await adminSupabase
            .from('exam_locations')
            .select('id,location_name')
            .eq('round_id', targetRoundId);
        if (locFetchErr) throw locFetchErr;

        const existingNames = new Set((existingLocs ?? []).map((loc) => loc.location_name));
        const toAdd = normalizedLocations.filter((name) => !existingNames.has(name));
        if (toAdd.length > 0) {
            const { error: addErr } = await adminSupabase.from('exam_locations').insert(
                toAdd.map((name, idx) => ({
                    round_id: targetRoundId,
                    location_name: name,
                    sort_order: idx,
                })),
            );
            if (addErr) throw addErr;
        }

        const toRemove = (existingLocs ?? []).filter((loc) => !normalizedLocations.includes(loc.location_name));
        if (toRemove.length > 0) {
            const { error: delErr } = await adminSupabase
                .from('exam_locations')
                .delete()
                .in('id', toRemove.map((loc) => loc.id));
            if (delErr && delErr.code !== '23503') throw delErr;
        }

        const dateLabel = exam_date ?? '미정';
        const actionText = actionLabel ?? (roundId ? '수정' : '등록');
        const title = `${dateLabel}${round_label ? ` (${round_label})` : ''} 일정 ${actionText}`;
        const body = `시험 일정이 ${actionText}되었습니다.`;
        await notifyExamRoundChanged(title, body);

        return { success: true, message: '저장 완료', roundId: targetRoundId };
    } catch (err: unknown) {
        logger.error('[saveExamRound] failed', err);
        return { success: false, error: errorMessage(err, '저장 중 오류가 발생했습니다.') };
    }
}

export async function deleteExamRoundAction(
    prevState: DeleteRoundState,
    payload: { roundId: string }
): Promise<DeleteRoundState> {
    void prevState;
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
    } catch (err: unknown) {
        return { success: false, error: errorMessage(err, '삭제 중 오류가 발생했습니다.') };
    }
}
