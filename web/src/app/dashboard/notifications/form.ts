import { z } from 'zod';

import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

export const noticeSchema = z.object({
    category: z.string().min(1, '카테고리를 입력해주세요'),
    title: z.string().min(1, '제목을 입력해주세요'),
    body: z.string().min(1, '내용을 입력해주세요'),
});

// White card on the dashboard panel, matching the other admin screens.
export const noticeGlassStyle = {
    backgroundColor: '#ffffff',
    border: 0,
    borderRadius: 24,
};

export async function uploadNoticeAttachment(file: File) {
    const fileExt = file.name.split('.').pop() || 'bin';
    const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID() : Math.random().toString(36).substring(2, 10);
    const filePath = `${Date.now()}_${suffix}.${fileExt}`;
    const storage = supabase.storage.from('notice-attachments');
    const { error } = await storage.upload(filePath, file);
    if (error) {
        logger.error('Upload Error:', error);
        throw new Error('파일 업로드 실패');
    }
    return storage.getPublicUrl(filePath).data.publicUrl;
}
