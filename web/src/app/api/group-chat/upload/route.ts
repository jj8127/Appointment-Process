import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS, verifyOrigin } from '@/lib/csrf';
import {
  cleanGroupChatUploadFileName,
  GROUP_CHAT_UPLOAD_BUCKET,
  GROUP_CHAT_UPLOAD_PREFIX,
  MAX_GROUP_CHAT_UPLOAD_BYTES,
  isAllowedGroupChatUploadFile,
} from '@/lib/group-chat-web';
import { getVerifiedServerSession } from '@/lib/server-session';

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: SECURITY_HEADERS,
  });
}

export async function POST(req: Request) {
  const originCheck = await verifyOrigin();
  if (!originCheck.valid) {
    return json({ ok: false, code: 'invalid_origin', message: originCheck.error ?? 'Invalid origin' }, 403);
  }

  const sessionCheck = await getVerifiedServerSession({
    allowedRoles: ['admin', 'manager'],
    requireActive: true,
  });
  if (!sessionCheck.ok) {
    return json({
      ok: false,
      code: sessionCheck.status === 401 ? 'invalid_session' : 'forbidden',
      message: sessionCheck.error,
    }, sessionCheck.status);
  }

  const rateLimit = checkRateLimit(
    `group-chat-upload:${sessionCheck.session.role}:${sessionCheck.session.residentDigits}`,
    30,
    60_000,
  );
  if (!rateLimit.allowed) {
    return json({ ok: false, code: 'rate_limited', message: 'Too many requests' }, 429);
  }

  const formData = await req.formData().catch(() => null);
  const file = formData && typeof (formData as unknown as { get?: unknown }).get === 'function'
    ? (formData as unknown as { get(name: string): unknown }).get('file')
    : null;
  if (!(file instanceof File)) {
    return json({ ok: false, code: 'invalid_payload', message: '업로드할 파일을 찾을 수 없습니다.' }, 400);
  }
  if (!isAllowedGroupChatUploadFile(file)) {
    return json(
      {
        ok: false,
        code: 'invalid_payload',
        message: `허용되지 않는 파일 형식이거나 ${Math.floor(MAX_GROUP_CHAT_UPLOAD_BYTES / 1024 / 1024)}MB를 초과했습니다.`,
      },
      400,
    );
  }

  const safeName = cleanGroupChatUploadFileName(file.name);
  const storagePath = `${GROUP_CHAT_UPLOAD_PREFIX}${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const { error } = await adminSupabase.storage
    .from(GROUP_CHAT_UPLOAD_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (error) {
    return json({ ok: false, code: 'group_chat_upload_failed', message: error.message }, 500);
  }

  const { data } = adminSupabase.storage.from(GROUP_CHAT_UPLOAD_BUCKET).getPublicUrl(storagePath);
  return json({
    ok: true,
    bucket: GROUP_CHAT_UPLOAD_BUCKET,
    path: storagePath,
    url: data.publicUrl,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
  });
}
