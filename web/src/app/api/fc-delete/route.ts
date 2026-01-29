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

