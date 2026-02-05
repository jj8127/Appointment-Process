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
    .maybeSingle();

  if (profileError) {
    logger.error('[api/fc-delete] profile lookup failed', { fcId, error: profileError });
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profile?.id) {
    logger.warn('[api/fc-delete] profile not found', { fcId });
    return NextResponse.json({ ok: true, deleted: false, message: 'FC not found' }, { status: 200 });
  }

  logger.info('[api/fc-delete] Profile found', { fcId, name: profile.name, phone: profile.phone });

  const residentId = profile.phone;
  if (!residentId) {
    logger.warn('[api/fc-delete] Profile has no phone (residentId), skipping related data deletion', { fcId });
  } else {
    logger.info('[api/fc-delete] Deleting related data for residentId', { fcId, residentId });

    // A. Exam Registrations 삭제
    const { error: examError } = await adminClient
      .from('exam_registrations')
      .delete()
      .eq('resident_id', residentId);
    if (examError) logger.error('[api/fc-delete] Exam delete failed', examError);

    // B. Notifications 삭제
    const { error: notiError } = await adminClient
      .from('notifications')
      .delete()
      .eq('resident_id', residentId);
    if (notiError) logger.error('[api/fc-delete] Notification delete failed', notiError);

    // C. Board Data 삭제
    // C-1. Reactions
    await adminClient.from('board_post_reactions').delete().eq('resident_id', residentId);

    // C-2. Comments
    await adminClient.from('board_comments').delete().eq('author_resident_id', residentId);

    // C-3. Posts & Attachments
    const { data: residentPosts } = await adminClient
      .from('board_posts')
      .select('id')
      .eq('author_resident_id', residentId);

    if (residentPosts && residentPosts.length > 0) {
      const postIds = residentPosts.map(p => p.id);

      // Attachments storage cleanup
      const { data: attachments } = await adminClient
        .from('board_attachments')
        .select('storage_path')
        .in('post_id', postIds);

      const attachmentPaths = (attachments || [])
        .map(a => a.storage_path)
        .filter((p): p is string => !!p);

      if (attachmentPaths.length > 0) {
        await adminClient.storage.from('board-attachments').remove(attachmentPaths);
      }

      // Delete posts (Cascade should handle attachments/comments/reactions linked to these posts, but we delete posts explicitly)
      await adminClient.from('board_posts').delete().in('id', postIds);
    }

    // D. Chat Data 삭제
    // D-1. Chat Files (Sent by FC)
    // Find messages with files sent by this FC
    const { data: fileMessages } = await adminClient
      .from('messages')
      .select('file_url')
      .eq('sender_id', residentId)
      .in('message_type', ['image', 'file']);

    const chatFilePaths = (fileMessages || [])
      .map(m => {
        if (!m.file_url) return null;
        // Public URL: .../chat-uploads/chat/xyz.jpg
        // We need to extract 'chat/xyz.jpg'
        const parts = m.file_url.split('/chat-uploads/');
        return parts.length > 1 ? parts[1] : null;
      })
      .filter((p): p is string => !!p);

    if (chatFilePaths.length > 0) {
      logger.info('[api/fc-delete] Removing chat files', { count: chatFilePaths.length });
      await adminClient.storage.from('chat-uploads').remove(chatFilePaths);
    }

    // D-2. Messages (Sent by or Received by FC)
    const { error: chatError } = await adminClient
      .from('messages')
      .delete()
      .or(`sender_id.eq.${residentId},receiver_id.eq.${residentId}`);

    if (chatError) logger.error('[api/fc-delete] Chat delete failed', chatError);
  }

  // 2. 연관 데이터 확인 (삭제 전 상태 로깅) - Existing Logic
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
    const { error: storageError } = await adminClient.storage
      .from('fc-documents')
      .remove(storagePaths);

    if (storageError) {
      logger.warn('[api/fc-delete] storage remove failed (continuing)', { fcId, error: storageError });
    } else {
      logger.info('[api/fc-delete] Storage files deleted successfully', { fcId, fileCount: storagePaths.length });
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

  // 5. fc_profiles 삭제 (CASCADE로 fc_credentials, fc_identity_secure도 자동 삭제됨)
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
    return NextResponse.json({
      ok: false,
      deleted: false,
      message: 'Delete operation completed but no rows were affected',
    }, { status: 200 });
  }

  logger.info('[api/fc-delete] Deletion completed successfully', {
    fcId,
    name: profile.name,
    phone: profile.phone,
    deletedDocuments: docsDeleteCount,
    deletedProfile: profileDeleteCount,
  });

  return NextResponse.json({
    ok: true,
    deleted: true,
    deletedCount: profileDeleteCount,
    message: 'FC deleted successfully',
  }, { status: 200 });
}

