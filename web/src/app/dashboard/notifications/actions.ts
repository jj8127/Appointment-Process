'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { sendWebPush } from '@/lib/web-push';
import { adminSupabase } from '@/lib/admin-supabase';

import { logger } from '@/lib/logger';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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

    // 1. Insert Notice
    const { data: insertedNotice, error: noticeError } = await adminSupabase
        .from('notices')
        .insert({
        title,
        body,
        category,
        images: images || [],
        files: files || [],
        })
        .select('id')
        .single();

    if (noticeError) {
        return {
            success: false,
            message: `공지 등록 실패: ${noticeError.message}`,
        };
    }

    const targetUrl = insertedNotice?.id ? `/notice-detail?id=${insertedNotice.id}` : '/notice';

    // 2. Insert Notification History
    const { error: notifError } = await adminSupabase.from('notifications').insert({
        title,
        body,
        category,
        target_url: targetUrl,
        recipient_role: 'fc',
        resident_id: null, // Broadcast
    });

    if (notifError) {
        logger.error('Notification history insert failed:', notifError);
    }

    // 3. Fetch Tokens
    const { data: tokens, error: tokenError } = await adminSupabase
        .from('device_tokens')
        .select('expo_push_token')
        .eq('role', 'fc');

    if (tokenError) {
        logger.error('[push][notice] fetch tokens failed:', tokenError);
    }
    logger.debug('[push][notice] token query', {
        tokenError: tokenError?.message,
        tokenCount: tokens?.length,
        tokens,
    });

    // 4. Send Push
    if (tokens && tokens.length > 0) {
        const payload = tokens.map((t: { expo_push_token: string }) => ({
            to: t.expo_push_token,
            title: `공지: ${title}`,
            body: body,
            data: { type: 'notice', url: targetUrl },
            sound: 'default',
            priority: 'high',
            channelId: 'alerts',
        }));

        try {
            const chunkSize = 100;
            for (let i = 0; i < payload.length; i += chunkSize) {
                const chunk = payload.slice(i, i + chunkSize);
                const resp = await fetch(EXPO_PUSH_URL, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(chunk),
                });
                const text = await resp.text();
                logger.debug('[push][notice] fetch response', {
                    status: resp.status,
                    ok: resp.ok,
                    body: text,
                });
            }
        } catch (pushErr) {
            logger.error('[push][notice] push send error:', pushErr);
        }
    } else {
        logger.warn('[push][notice] no tokens found');
    }

    const { data: webSubs } = await adminSupabase
        .from('web_push_subscriptions')
        .select('endpoint,p256dh,auth')
        .eq('role', 'fc');

    if (webSubs && webSubs.length > 0) {
        const result = await sendWebPush(webSubs, {
            title: `공지: ${title}`,
            body,
            data: { type: 'notice', url: '/dashboard/notifications' },
        });
        if (result.expired.length > 0) {
            await adminSupabase.from('web_push_subscriptions').delete().in('endpoint', result.expired);
        }
    }

    revalidatePath('/dashboard/notifications');
    return { success: true, message: '공지사항이 등록 및 발송되었습니다.' };
}
