'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminSupabase } from '@/lib/admin-supabase';

import { logger } from '@/lib/logger';
import { getVerifiedAdminSession } from '@/lib/server-session';
import {
    classifyExpoPushDelivery,
    mergeExpoPushDeliverySummaries,
    type ExpoPushDeliverySummary,
} from '@/lib/expo-push-delivery';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK_SIZE = 100;
const EXTERNAL_PUSH_TIMEOUT_MS = 8_000;

const emptyExpoDelivery = (): ExpoPushDeliverySummary => ({
    attempted: 0,
    accepted: 0,
    rejected: 0,
});

const NoticeSchema = z.object({
    category: z.string().min(1, '카테고리를 입력해주세요'),
    title: z.string().min(1, '제목을 입력해주세요'),
    body: z.string().min(1, '내용을 입력해주세요'),
    images: z.array(z.string()).optional(),
    files: z.array(z.object({
        name: z.string(),
        size: z.number(),
        type: z.string(),
        url: z.string()
    })).optional(),
});

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
        images: imagesRaw ? JSON.parse(imagesRaw as string) : [],
        files: filesRaw ? JSON.parse(filesRaw as string) : [],
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

    // 1. Insert Notice
    const { data: insertedNotice, error: noticeError } = await adminSupabase
        .from('notices')
        .insert({
        title,
        body,
        category,
        images: images || [],
        files: files || [],
        created_by: createdBy,
        })
        .select('id')
        .single();

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

    if (!insertedNotice?.id) {
        return { success: false, message: '공지 대상을 확인할 수 없습니다.' };
    }
    const targetUrl = `/notice-detail?id=${insertedNotice.id}`;
    const target = { version: 1, kind: 'notice', noticeId: insertedNotice.id } as const;

    // 2. Insert Notification History
    const { data: insertedNotification, error: notifError } = await adminSupabase
      .from('notifications')
      .insert({
        title,
        body,
        category,
        target_url: targetUrl,
        target,
        recipient_role: 'fc',
        resident_id: null, // Broadcast
      })
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

    // 3. Fetch Tokens
    const { data: tokens, error: tokenError } = await adminSupabase
        .from('device_tokens')
        .select('expo_push_token')
        .eq('role', 'fc');

    if (tokenError) {
        logger.error('[notice] mobile target query failed', {
            category: 'notice',
            reason: 'database_read_failed',
            code: tokenError.code ?? 'unknown',
            status: 'failed',
        });
    }
    const mobileTokens = tokenError
        ? []
        : Array.from(new Set(
            (tokens ?? [])
                .map((token: { expo_push_token: string | null }) => token.expo_push_token?.trim())
                .filter((token): token is string => Boolean(token)),
        ));
    logger.debug('[push][notice] token query', {
        category: 'notice',
        reason: tokenError ? 'database_read_failed' : 'query_completed',
        status: tokenError ? 'failed' : 'ready',
        tokenCount: mobileTokens.length,
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
            reason: tokenError ? 'target_query_failed' : 'no_mobile_target',
            status: 'warning',
        });
    }

    const acceptedTargets = mobileDelivery.accepted;
    const failedTargets = mobileDelivery.rejected;
    const targetQueriesFailed = Boolean(tokenError);
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
        images: imagesRaw ? JSON.parse(imagesRaw as string) : [],
        files: filesRaw ? JSON.parse(filesRaw as string) : [],
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
        const { data: existing } = await adminSupabase
            .from('notices')
            .select('created_by')
            .eq('id', id)
            .maybeSingle();
        if (!existing) {
            return { success: false, message: '공지를 찾을 수 없습니다.' };
        }
        if (existing.created_by !== residentId) {
            return { success: false, message: '본인이 작성한 공지만 수정할 수 있습니다.' };
        }
    }

    const { error } = await adminSupabase
        .from('notices')
        .update({ title, body, category, images: images ?? [], files: files ?? [] })
        .eq('id', id);

    if (error) {
        return { success: false, message: `수정 실패: ${error.message}` };
    }

    revalidatePath('/dashboard/notifications');
    revalidatePath(`/dashboard/notifications/${id}`);
    return { success: true, message: '공지사항이 수정되었습니다.' };
}
