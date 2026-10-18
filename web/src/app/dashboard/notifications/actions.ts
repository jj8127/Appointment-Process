'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminSupabase } from '@/lib/admin-supabase';

import { logger } from '@/lib/logger';
import { getVerifiedAdminSession } from '@/lib/server-session';
import { isHttpsResponseUrl } from '@/lib/user-intent-policy';
import { isExactNoticeMutationReceipt } from '@/lib/notice-write-contract';
import { loadActorScopedFcExpoTargets } from '@/lib/app-push-preference-service';
import { collectSupabaseRows } from '@/lib/supabase-query-contract';
import {
    classifyExpoPushDelivery,
    mergeExpoPushDeliverySummaries,
    type ExpoPushDeliverySummary,
} from '@/lib/expo-push-delivery';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK_SIZE = 100;
const EXTERNAL_PUSH_TIMEOUT_MS = 8_000;

type NoticeBroadcastTokenRow = {
    expo_push_token: string;
    resident_id: string;
    role: 'fc';
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isNoticeBroadcastTokenRow = (value: unknown): value is NoticeBroadcastTokenRow => (
    isRecord(value)
    && typeof value.expo_push_token === 'string'
    && value.expo_push_token.trim().length > 0
    && value.expo_push_token === value.expo_push_token.trim()
    && typeof value.resident_id === 'string'
    && /^010\d{8}$/.test(value.resident_id)
    && value.role === 'fc'
);

const readErrorCode = (error: unknown): string => (
    isRecord(error) && typeof error.code === 'string' && error.code.trim()
        ? error.code
        : 'invalid_result'
);

const HttpsUrlSchema = z.string().refine(isHttpsResponseUrl, {
    message: 'HTTPS 주소만 사용할 수 있습니다.',
});

const emptyExpoDelivery = (): ExpoPushDeliverySummary => ({
    attempted: 0,
    accepted: 0,
    rejected: 0,
});

const NoticeSchema = z.object({
    category: z.string().trim().min(1, '카테고리를 입력해주세요'),
    title: z.string().trim().min(1, '제목을 입력해주세요'),
    body: z.string().trim().min(1, '내용을 입력해주세요'),
    images: z.array(HttpsUrlSchema).optional(),
    files: z.array(z.object({
        name: z.string(),
        size: z.number(),
        type: z.string(),
        url: HttpsUrlSchema,
    })).optional(),
});

function parseNoticeJsonField(value: FormDataEntryValue | null): unknown {
    if (typeof value !== 'string' || value.trim().length === 0) return [];
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return undefined;
    }
}

export type CreateNoticeState = {
    success: boolean;
    message?: string;
    notificationWarning?: string;
    errors?: {
        category?: string[];
        title?: string[];
        body?: string[];
        images?: string[];
        files?: string[];
    };
};

export async function createNoticeAction(
    prevState: CreateNoticeState,
    formData: FormData
): Promise<CreateNoticeState> {
    void prevState;
    const imagesRaw = formData.get('images');
    const filesRaw = formData.get('files');

    const validatedFields = NoticeSchema.safeParse({
        category: formData.get('category'),
        title: formData.get('title'),
        body: formData.get('body'),
        images: parseNoticeJsonField(imagesRaw),
        files: parseNoticeJsonField(filesRaw),
    });

    if (!validatedFields.success) {
        return {
            success: false,
            errors: validatedFields.error.flatten().fieldErrors,
            message: '입력값을 확인해주세요.',
        };
    }

    const sessionCheck = await getVerifiedAdminSession();
    if (!sessionCheck.ok) {
        return { success: false, message: sessionCheck.error };
    }

    const { category, title, body, images, files } = validatedFields.data;
    const createdBy = sessionCheck.session.residentId;
    const requestId = String(formData.get('requestId') ?? '').trim();
    if (!z.string().uuid().safeParse(requestId).success) {
        return { success: false, message: '요청 식별자를 확인할 수 없습니다. 작성 화면을 다시 열어주세요.' };
    }

    // 1. Insert Notice
    const { data: insertedNotice, error: noticeError } = await adminSupabase
        .rpc('create_notice_idempotent_v1', {
            p_actor_phone: createdBy,
            p_actor_role: sessionCheck.session.role,
            p_request_id: requestId,
            p_notice: { title, body, category, images: images || [], files: files || [] },
        });

    if (noticeError) {
        logger.error('[notice] primary insert failed', {
            category: 'notice',
            reason: 'database_write_failed',
            code: noticeError.code ?? 'unknown',
            status: 'failed',
        });
        return {
            success: false,
            message: '공지 등록에 실패했습니다.',
        };
    }

    if (typeof insertedNotice?.id !== 'string' || !insertedNotice.id.trim()) {
        return { success: false, message: '공지 대상을 확인할 수 없습니다.' };
    }
    const targetUrl = `/notice-detail?id=${insertedNotice.id}`;
    const target = { version: 1, kind: 'notice', noticeId: insertedNotice.id } as const;

    // 2. Insert Notification History
    const { data: insertedNotification, error: notifError } = await adminSupabase
      .from('notifications')
      .upsert({
        title,
        body,
        category,
        target_url: targetUrl,
        target,
        recipient_role: 'fc',
        resident_id: null, // Broadcast
        delivery_key: `notice:${insertedNotice.id}:created`,
      }, { onConflict: 'delivery_key' })
      .select('id')
      .single();
    const notificationId =
      typeof insertedNotification?.id === 'string' ? insertedNotification.id : null;

    if (notifError) {
        logger.error('[notice] notification history insert failed', {
            category: 'notice',
            reason: 'database_write_failed',
            code: notifError.code ?? 'unknown',
            status: 'failed',
        });
    }
    if (!notificationId) {
        logger.warn('[notice] provider delivery skipped because notification persistence failed', {
            category: 'notice',
            reason: 'missing_notification_id',
            status: 'warning',
        });
        revalidatePath('/dashboard/notifications');
        return {
            success: true,
            message: '공지사항은 등록되었지만 알림 기록을 저장하지 못해 푸시를 보내지 않았습니다.',
            notificationWarning: 'notification_persistence_and_delivery_incomplete',
        };
    }

    // 3. Resolve every registered FC token against its current account and preferences.
    let targetQueryFailed = false;
    let targetQueryFailureCode = 'invalid_result';
    let suppressedTargets = 0;
    let mobileTokens: string[] = [];
    try {
        const tokens = await collectSupabaseRows<NoticeBroadcastTokenRow>({
            queryName: 'notice_broadcast_device_tokens',
            isRow: isNoticeBroadcastTokenRow,
            rowKey: (row) => row.expo_push_token,
            fetchPage: async (from, to) => adminSupabase
                .from('device_tokens')
                .select('expo_push_token,resident_id,role')
                .eq('role', 'fc')
                .order('expo_push_token', { ascending: true })
                .range(from, to),
        });
        const eligibility = await loadActorScopedFcExpoTargets(tokens, 'notice');
        targetQueryFailed = eligibility.lookupFailed;
        suppressedTargets = eligibility.suppressedTokens;
        mobileTokens = eligibility.eligibleTokens;
    } catch (error) {
        targetQueryFailed = true;
        targetQueryFailureCode = readErrorCode(error);
    }

    if (targetQueryFailed) {
        logger.error('[notice] mobile target query failed', {
            category: 'notice',
            reason: 'database_read_failed',
            code: targetQueryFailureCode,
            status: 'failed',
        });
    }
    logger.debug('[push][notice] token query', {
        category: 'notice',
        reason: targetQueryFailed ? 'database_read_failed' : 'query_completed',
        status: targetQueryFailed ? 'failed' : 'ready',
        tokenCount: mobileTokens.length,
        suppressedTargets,
    });

    // 4. Send Push
    let mobileDelivery = emptyExpoDelivery();
    if (mobileTokens.length > 0) {
        const payload = mobileTokens.map((token) => ({
            to: token,
            title: `공지: ${title}`,
            body: body,
            data: {
                type: 'notice',
                url: targetUrl,
                target,
                ...(notificationId ? { notificationId } : {}),
            },
            sound: 'default',
            priority: 'high',
            channelId: 'alerts',
        }));

        for (let i = 0; i < payload.length; i += EXPO_PUSH_CHUNK_SIZE) {
            const chunk = payload.slice(i, i + EXPO_PUSH_CHUNK_SIZE);
            let chunkDelivery: ExpoPushDeliverySummary;
            try {
                const resp = await fetch(EXPO_PUSH_URL, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(chunk),
                    signal: AbortSignal.timeout(EXTERNAL_PUSH_TIMEOUT_MS),
                });
                const responseBody = await resp.json().catch(() => null) as unknown;
                chunkDelivery = classifyExpoPushDelivery(chunk.length, resp.status, responseBody);
                logger.debug('[notice] Expo delivery completed', {
                    category: 'notice',
                    reason: resp.ok ? 'provider_response' : 'provider_http_rejected',
                    status: resp.status,
                    attempted: chunkDelivery.attempted,
                    accepted: chunkDelivery.accepted,
                    rejected: chunkDelivery.rejected,
                });
            } catch {
                chunkDelivery = {
                    attempted: chunk.length,
                    accepted: 0,
                    rejected: chunk.length,
                };
                logger.warn('[notice] Expo delivery failed', {
                    category: 'notice',
                    reason: 'provider_request_failed',
                    status: 'failed',
                    attempted: chunk.length,
                });
            }
            mobileDelivery = mergeExpoPushDeliverySummaries([mobileDelivery, chunkDelivery]);
        }
    } else {
        logger.warn('[notice] no mobile targets found', {
            category: 'notice',
            reason: targetQueryFailed ? 'target_query_failed' : 'no_mobile_target',
            status: 'warning',
        });
    }

    const acceptedTargets = mobileDelivery.accepted;
    const failedTargets = mobileDelivery.rejected;
    const targetQueriesFailed = targetQueryFailed;
    let notificationWarning: string | undefined;
    if (notifError && acceptedTargets < 1) {
        notificationWarning = 'notification_persistence_and_delivery_incomplete';
    } else if (notifError) {
        notificationWarning = 'notification_persistence_incomplete';
    } else if (targetQueriesFailed || acceptedTargets < 1) {
        notificationWarning = 'notification_delivery_incomplete';
    } else if (failedTargets > 0) {
        notificationWarning = 'notification_partial_delivery';
    }

    logger.info('[notice] notification delivery summary', {
        category: 'notice',
        reason: notificationWarning ? 'delivery_incomplete' : 'delivery_confirmed',
        status: notificationWarning ? 'warning' : 'success',
        historyLogged: !notifError,
        mobileAttempted: mobileDelivery.attempted,
        mobileAccepted: mobileDelivery.accepted,
        mobileRejected: mobileDelivery.rejected,
    });

    revalidatePath('/dashboard/notifications');
    return {
        success: true,
        message: notificationWarning
            ? '공지사항이 등록되었습니다.'
            : '공지사항이 등록되고 알림이 전달되었습니다.',
        notificationWarning,
    };
}

export type UpdateNoticeState = {
    success: boolean;
    message?: string;
    errors?: {
        category?: string[];
        title?: string[];
        body?: string[];
    };
};

export async function updateNoticeAction(
    prevState: UpdateNoticeState,
    formData: FormData
): Promise<UpdateNoticeState> {
    const id = (formData.get('id') as string | null)?.trim();
    if (!id) {
        return { success: false, message: '공지 ID가 없습니다.' };
    }

    const imagesRaw = formData.get('images');
    const filesRaw = formData.get('files');

    const validatedFields = NoticeSchema.safeParse({
        category: formData.get('category'),
        title: formData.get('title'),
        body: formData.get('body'),
        images: parseNoticeJsonField(imagesRaw),
        files: parseNoticeJsonField(filesRaw),
    });

    if (!validatedFields.success) {
        return {
            success: false,
            errors: validatedFields.error.flatten().fieldErrors,
            message: '입력값을 확인해주세요.',
        };
    }

    const { category, title, body, images, files } = validatedFields.data;

    const sessionCheck = await getVerifiedAdminSession();
    if (!sessionCheck.ok) {
        return { success: false, message: sessionCheck.error };
    }
    const { role, residentId } = sessionCheck.session;

    if (role !== 'admin' && role !== 'manager') {
        return { success: false, message: '권한이 없습니다.' };
    }

    // Managers can only update their own notices
    if (role === 'manager') {
        const { data: existing, error: ownershipError } = await adminSupabase
            .from('notices')
            .select('created_by')
            .eq('id', id)
            .maybeSingle();
        if (ownershipError) {
            logger.error('[notice] ownership lookup failed', {
                category: 'notice',
                reason: 'database_read_failed',
                code: ownershipError.code ?? 'unknown',
                status: 'failed',
            });
            return { success: false, message: '공지 수정에 실패했습니다.' };
        }
        if (!existing) {
            return { success: false, message: '공지를 찾을 수 없습니다.' };
        }
        if (existing.created_by !== residentId) {
            return { success: false, message: '본인이 작성한 공지만 수정할 수 있습니다.' };
        }
    }

    const { data: updatedNotice, error } = await adminSupabase
        .from('notices')
        .update({ title, body, category, images: images ?? [], files: files ?? [] })
        .eq('id', id)
        .select('id,title,body,category,images,files')
        .maybeSingle();

    if (error) {
        logger.error('[notice] update failed', {
            category: 'notice',
            reason: 'database_write_failed',
            code: error.code ?? 'unknown',
            status: 'failed',
        });
        return { success: false, message: '공지 수정에 실패했습니다.' };
    }
    if (!updatedNotice) {
        return { success: false, message: '공지를 찾을 수 없습니다.' };
    }
    if (!isExactNoticeMutationReceipt(updatedNotice, {
        id,
        title,
        body,
        category,
        images: images ?? [],
        files: files ?? [],
    })) {
        logger.error('[notice] update receipt mismatch', {
            category: 'notice',
            reason: 'database_write_unconfirmed',
            status: 'failed',
        });
        return { success: false, message: '공지 수정 결과를 확인하지 못했습니다.' };
    }

    revalidatePath('/dashboard/notifications');
    revalidatePath(`/dashboard/notifications/${id}`);
    return { success: true, message: '공지사항이 수정되었습니다.' };
}
