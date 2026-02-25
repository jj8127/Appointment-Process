import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { checkRateLimit, validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error(
    'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
  );
}

const adminClient = createClient(supabaseUrl, serviceKey);

type DeleteRequestBody = {
  fcId?: string;
};

type FcProfileRow = {
  id: string;
  name: string | null;
  phone: string | null;
};

type BoardPostRow = { id: string };
type StoragePathRow = { storage_path: string | null };
type ChatFileRow = { file_url: string | null };
type LinkedProfileRow = { id: string };

function cleanPhone(input: string | null | undefined): string {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

function formatPhone(digits: string): string {
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function buildResidentIds(phone: string | null | undefined): string[] {
  const raw = String(phone ?? '').trim();
  const digits = cleanPhone(raw);
  const values = new Set<string>();

  if (digits) values.add(digits);
  if (raw) values.add(raw);
  if (digits) {
    const masked = formatPhone(digits);
    if (masked) values.add(masked);
  }

  return Array.from(values);
}

function extractChatUploadPath(fileUrl: string | null | undefined): string | null {
  const raw = String(fileUrl ?? '').trim();
  if (!raw) return null;

  const marker = '/chat-uploads/';
  const index = raw.indexOf(marker);
  if (index < 0) return null;

  const pathWithQuery = raw.slice(index + marker.length);
  const pathOnly = pathWithQuery.split('?')[0] ?? '';
  const normalized = pathOnly.replace(/^\/+/, '');
  return normalized || null;
}

export async function POST(req: Request) {
  let body: DeleteRequestBody;
  try {
    body = (await req.json()) as DeleteRequestBody;
  } catch (err) {
    logger.error('[api/fc-delete] Invalid JSON payload', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const session = {
    role: cookieStore.get('session_role')?.value ?? null,
    residentId: cookieStore.get('session_resident')?.value ?? '',
  };

  const sessionCheck = validateSession(session);
  if (!sessionCheck.valid) {
    return NextResponse.json({ error: sessionCheck.error ?? 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rateLimit = checkRateLimit(`fc-delete:${session.residentId}`, 10, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const fcId = body.fcId?.trim();
  if (!fcId) {
    return NextResponse.json({ error: 'fcId is required' }, { status: 400 });
  }

  logger.info('[api/fc-delete] Starting deletion process', { fcId, admin: session.residentId });

  // 1. FC 프로필 존재 확인
  const { data: profile, error: profileError } = await adminClient
    .from('fc_profiles')
    .select('id, name, phone')
    .eq('id', fcId)
    .maybeSingle<FcProfileRow>();

  if (profileError) {
    logger.error('[api/fc-delete] profile lookup failed', { fcId, error: profileError });
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profile?.id) {
    logger.warn('[api/fc-delete] profile not found', { fcId });
    return NextResponse.json({ ok: true, deleted: false, message: 'FC not found' }, { status: 200 });
  }

  logger.info('[api/fc-delete] Profile found', { fcId, name: profile.name, phone: profile.phone });

  const residentIds = buildResidentIds(profile.phone);
  if (residentIds.length === 0) {
    logger.warn('[api/fc-delete] Profile has no resident identifiers, skipping resident-based deletion', { fcId });
  } else {
    logger.info('[api/fc-delete] Deleting related data for resident identifiers', { fcId, residentIds });

    const deleteByResident = async (table: string, column: string) => {
      if (residentIds.length === 1) {
        return adminClient.from(table).delete({ count: 'exact' }).eq(column, residentIds[0]);
      }
      return adminClient.from(table).delete({ count: 'exact' }).in(column, residentIds);
    };

    const selectPostsByResident = async () => {
      if (residentIds.length === 1) {
        return adminClient.from('board_posts').select('id').eq('author_resident_id', residentIds[0]);
      }
      return adminClient.from('board_posts').select('id').in('author_resident_id', residentIds);
    };

    // A. Exam Registrations 삭제
    const { error: examByFcError } = await adminClient
      .from('exam_registrations')
      .delete()
      .eq('fc_id', fcId);
    if (examByFcError) logger.error('[api/fc-delete] Exam delete by fc_id failed', examByFcError);
    const { error: examByResidentError } = await deleteByResident('exam_registrations', 'resident_id');
    if (examByResidentError) logger.error('[api/fc-delete] Exam delete by resident_id failed', examByResidentError);

    // B. Notifications 삭제
    const { error: notiByFcError } = await adminClient.from('notifications').delete().eq('fc_id', fcId);
    if (notiByFcError) logger.error('[api/fc-delete] Notification delete by fc_id failed', notiByFcError);
    const { error: notiByResidentError } = await deleteByResident('notifications', 'resident_id');
    if (notiByResidentError) {
      logger.error('[api/fc-delete] Notification delete by resident_id failed', notiByResidentError);
    }

    // C. Push 토큰 삭제
    const { error: deviceTokenError } = await deleteByResident('device_tokens', 'resident_id');
    if (deviceTokenError) logger.error('[api/fc-delete] Device token delete failed', deviceTokenError);
    const { error: webPushError } = await deleteByResident('web_push_subscriptions', 'resident_id');
    if (webPushError) logger.error('[api/fc-delete] Web push subscription delete failed', webPushError);

    // D. Board Data 삭제
    // D-1. Comment likes by FC
    const { error: commentLikeError } = await deleteByResident('board_comment_likes', 'resident_id');
    if (commentLikeError) logger.error('[api/fc-delete] Board comment likes delete failed', commentLikeError);

    // D-2. Reactions
    const { error: reactionError } = await deleteByResident('board_post_reactions', 'resident_id');
    if (reactionError) logger.error('[api/fc-delete] Board reactions delete failed', reactionError);

    // D-3. Comments
    const { error: commentError } = await deleteByResident('board_comments', 'author_resident_id');
    if (commentError) logger.error('[api/fc-delete] Board comments delete failed', commentError);

    // D-4. Posts & Attachments
    const { data: residentPosts, error: residentPostsError } = await selectPostsByResident();
    if (residentPostsError) {
      logger.error('[api/fc-delete] Board posts select failed', residentPostsError);
    }

    if (residentPosts && residentPosts.length > 0) {
      const postIds = (residentPosts as BoardPostRow[]).map((p) => p.id);

      const { data: attachments, error: attachmentSelectError } = await adminClient
        .from('board_attachments')
        .select('storage_path')
        .in('post_id', postIds);
      if (attachmentSelectError) {
        logger.error('[api/fc-delete] Board attachments select failed', attachmentSelectError);
      }

      const attachmentPaths = ((attachments as StoragePathRow[] | null) ?? [])
        .map((a) => a.storage_path)
        .filter((p): p is string => !!p);

      if (attachmentPaths.length > 0) {
        const { error: attachmentStorageError } = await adminClient.storage
          .from('board-attachments')
          .remove(attachmentPaths);
        if (attachmentStorageError) {
          logger.warn('[api/fc-delete] Board attachment storage remove failed', attachmentStorageError);
        }
      }

      const { error: postsDeleteError } = await adminClient.from('board_posts').delete().in('id', postIds);
      if (postsDeleteError) logger.error('[api/fc-delete] Board posts delete failed', postsDeleteError);
    }

    // E. Chat Data 삭제
    // E-1. 업로드 파일 삭제 (FC 발신 파일만)
    let fileMessagesQuery = adminClient
      .from('messages')
      .select('file_url')
      .in('message_type', ['image', 'file']);
    fileMessagesQuery =
      residentIds.length === 1
        ? fileMessagesQuery.eq('sender_id', residentIds[0])
        : fileMessagesQuery.in('sender_id', residentIds);

    const { data: fileMessages, error: fileMessagesError } = await fileMessagesQuery;
    if (fileMessagesError) {
      logger.error('[api/fc-delete] Chat file message select failed', fileMessagesError);
    }

    const chatFilePaths = Array.from(
      new Set(
        ((fileMessages as ChatFileRow[] | null) ?? [])
          .map((m) => extractChatUploadPath(m.file_url))
          .filter((p): p is string => !!p),
      ),
    );

    if (chatFilePaths.length > 0) {
      logger.info('[api/fc-delete] Removing chat files', { count: chatFilePaths.length });
      const { error: chatStorageError } = await adminClient.storage.from('chat-uploads').remove(chatFilePaths);
      if (chatStorageError) {
        logger.warn('[api/fc-delete] Chat storage remove failed', chatStorageError);
      }
    }

    // E-2. 메시지 본문 삭제
    const { error: senderDeleteError } = await deleteByResident('messages', 'sender_id');
    if (senderDeleteError) logger.error('[api/fc-delete] Chat delete by sender failed', senderDeleteError);
    const { error: receiverDeleteError } = await deleteByResident('messages', 'receiver_id');
    if (receiverDeleteError) logger.error('[api/fc-delete] Chat delete by receiver failed', receiverDeleteError);
  }

  // 2. 연관 데이터 확인 (삭제 전 상태 로깅)
  const { data: docs, error: docsError } = await adminClient
    .from('fc_documents')
    .select('id, storage_path, doc_type')
    .eq('fc_id', fcId);

  if (docsError) {
    logger.error('[api/fc-delete] fc_documents select failed', { fcId, error: docsError });
    return NextResponse.json({ error: docsError.message }, { status: 500 });
  }

  logger.info('[api/fc-delete] Documents found', { fcId, documentCount: docs?.length ?? 0 });

  // 3. Storage에서 파일 삭제 (실패해도 계속 진행)
  const storagePaths = (docs ?? [])
    .map((doc) => doc.storage_path)
    .filter((path): path is string => Boolean(path) && path !== 'deleted');

  if (storagePaths.length > 0) {
    logger.info('[api/fc-delete] Deleting storage files', { fcId, fileCount: storagePaths.length });
    const { error: storageError } = await adminClient.storage.from('fc-documents').remove(storagePaths);

    if (storageError) {
      logger.warn('[api/fc-delete] storage remove failed (continuing)', { fcId, error: storageError });
    } else {
      logger.info('[api/fc-delete] Storage files deleted successfully', {
        fcId,
        fileCount: storagePaths.length,
      });
    }
  }

  // 4. fc_documents 명시적 삭제 (CASCADE 전에 먼저 삭제)
  logger.info('[api/fc-delete] Deleting fc_documents records', { fcId });
  const { error: docsDeleteError, count: docsDeleteCount } = await adminClient
    .from('fc_documents')
    .delete({ count: 'exact' })
    .eq('fc_id', fcId);

  if (docsDeleteError) {
    logger.error('[api/fc-delete] fc_documents delete failed', { fcId, error: docsDeleteError });
    return NextResponse.json({ error: docsDeleteError.message }, { status: 500 });
  }

  logger.info('[api/fc-delete] fc_documents deleted', { fcId, deletedCount: docsDeleteCount });

  // 4-1. Cascading 누락 대비 명시 삭제
  const { error: credentialsDeleteError } = await adminClient
    .from('fc_credentials')
    .delete()
    .eq('fc_id', fcId);
  if (credentialsDeleteError) {
    logger.warn('[api/fc-delete] fc_credentials delete failed (continuing)', {
      fcId,
      error: credentialsDeleteError,
    });
  }

  const { error: identityDeleteError } = await adminClient
    .from('fc_identity_secure')
    .delete()
    .eq('fc_id', fcId);
  if (identityDeleteError) {
    logger.warn('[api/fc-delete] fc_identity_secure delete failed (continuing)', {
      fcId,
      error: identityDeleteError,
    });
  }

  // 4-2. Supabase Auth/profile bridge 정리
  const { data: linkedProfiles, error: linkedProfilesError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('fc_id', fcId);
  if (linkedProfilesError) {
    logger.warn('[api/fc-delete] linked profiles lookup failed (continuing)', {
      fcId,
      error: linkedProfilesError,
    });
  }

  const linkedProfileIds = ((linkedProfiles as LinkedProfileRow[] | null) ?? []).map((p) => p.id);
  for (const profileId of linkedProfileIds) {
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(profileId);
    if (authDeleteError) {
      logger.warn('[api/fc-delete] auth user delete failed (continuing)', {
        fcId,
        profileId,
        error: authDeleteError,
      });
    }
  }

  const { error: profilesDeleteError } = await adminClient.from('profiles').delete().eq('fc_id', fcId);
  if (profilesDeleteError) {
    logger.warn('[api/fc-delete] profiles delete failed (continuing)', {
      fcId,
      error: profilesDeleteError,
    });
  }

  // 5. fc_profiles 삭제
  logger.info('[api/fc-delete] Deleting fc_profiles record', { fcId });
  const { error: profileDeleteError, count: profileDeleteCount } = await adminClient
    .from('fc_profiles')
    .delete({ count: 'exact' })
    .eq('id', fcId);

  if (profileDeleteError) {
    logger.error('[api/fc-delete] fc_profiles delete failed', { fcId, error: profileDeleteError });
    return NextResponse.json({ error: profileDeleteError.message }, { status: 500 });
  }

  logger.info('[api/fc-delete] fc_profiles deleted', { fcId, deletedCount: profileDeleteCount });

  // 6. 삭제 검증
  if (profileDeleteCount === 0) {
    logger.warn('[api/fc-delete] No rows deleted from fc_profiles', { fcId });
    return NextResponse.json(
      {
        ok: false,
        deleted: false,
        message: 'Delete operation completed but no rows were affected',
      },
      { status: 200 },
    );
  }

  logger.info('[api/fc-delete] Deletion completed successfully', {
    fcId,
    name: profile.name,
    phone: profile.phone,
    deletedDocuments: docsDeleteCount,
    deletedProfile: profileDeleteCount,
  });

  return NextResponse.json(
    {
      ok: true,
      deleted: true,
      deletedCount: profileDeleteCount,
      message: 'FC deleted successfully',
    },
    { status: 200 },
  );
}

