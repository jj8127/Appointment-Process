'use server';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';

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

    const cookieStore = await cookies();

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) {
                    return cookieStore.get(name)?.value;
                },
                set(name: string, value: string, options: CookieOptions) {
                    try {
                        cookieStore.set({ name, value, ...options });
                    } catch (error) {
                    }
                },
                remove(name: string, options: CookieOptions) {
                    try {
                        cookieStore.set({ name, value: '', ...options });
                    } catch (error) {
                    }
                },
            },
        }
    );

    // 1. Insert Notice
    const { error: noticeError } = await supabase.from('notices').insert({
        title,
        body,
        category,
        images: images || [],
        files: files || [],
    });

    if (noticeError) {
        return {
            success: false,
            message: `공지 등록 실패: ${noticeError.message}`,
        };
    }

    // 2. Insert Notification History
    const { error: notifError } = await supabase.from('notifications').insert({
        title,
        body,
        category,
        recipient_role: 'fc',
        resident_id: null, // Broadcast
    });

    if (notifError) {
        console.error('Notification history insert failed:', notifError);
    }

    // 3. Fetch Tokens
    const { data: tokens, error: tokenError } = await supabase
        .from('device_tokens')
        .select('expo_push_token')
        .eq('role', 'fc');

    if (tokenError) {
        console.error('[push][notice] fetch tokens failed:', tokenError);
    }
    console.log('[push][notice] token query', {
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
            data: { type: 'notice' },
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
                console.log('[push][notice] fetch response', {
                    status: resp.status,
                    ok: resp.ok,
                    body: text,
                });
            }
        } catch (pushErr) {
            console.error('[push][notice] push send error:', pushErr);
        }
    } else {
        console.warn('[push][notice] no tokens found');
    }

    revalidatePath('/dashboard/notifications');
    return { success: true, message: '공지사항이 등록 및 발송되었습니다.' };
}
