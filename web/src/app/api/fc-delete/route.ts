import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { adminRouteAuthErrorResponse, requireAdminRoute } from '@/lib/admin-route-auth';
import { checkRateLimit } from '@/lib/csrf';
import { logger } from '@/lib/logger';

type DeleteRequestBody = {
  fcId?: string;
};

type AccountDeleteResult = {
  deleted?: boolean;
  proof_paths?: unknown;
  document_paths?: unknown;
  board_attachment_paths?: unknown;
  chat_file_urls?: unknown;
  auth_user_ids?: unknown;
  cleanup_outbox_id?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? '').trim())
        .filter(Boolean),
    ),
  );
}

function extractChatUploadPath(fileUrl: string): string | null {
  const marker = '/chat-uploads/';
  const index = fileUrl.indexOf(marker);
  if (index < 0) return null;
  const path = (fileUrl.slice(index + marker.length).split('?')[0] ?? '')
    .replace(/^\/+/, '');
  return path || null;
}

async function removeStorageObjects(bucket: string, paths: string[]) {
  if (paths.length === 0) return false;
  const { error } = await adminSupabase.storage.from(bucket).remove(paths);
  if (error) {
    logger.warn('[api/fc-delete] post-commit storage cleanup failed', {
      bucket,
      pathCount: paths.length,
    });
  }
  return Boolean(error);
}

export async function POST(req: Request) {
  let body: DeleteRequestBody;
  try {
    body = (await req.json()) as DeleteRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const sessionCheck = await requireAdminRoute();
  if (!sessionCheck.ok) {
    return adminRouteAuthErrorResponse(sessionCheck);
  }

  const rateLimit = checkRateLimit(
    `fc-delete:${sessionCheck.session.residentId}`,
    10,
    60_000,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const fcId = String(body.fcId ?? '').trim();
  if (!UUID_PATTERN.test(fcId)) {
    return NextResponse.json({ error: '유효하지 않은 FC 식별자입니다.' }, { status: 400 });
  }

  const { data, error } = await adminSupabase.rpc(
    'delete_account_core_transaction_v1',
    {
      p_target_role: 'fc',
      p_target_id: fcId,
    },
  );
  if (error) {
    const status = error.message === 'account_delete_target_not_found' ? 404 : 409;
    logger.error('[api/fc-delete] transactional account deletion failed', {
      code: error.code ?? 'unknown',
    });
    return NextResponse.json(
      { error: error.message || 'FC 계정 삭제에 실패했습니다.' },
      { status },
    );
  }

  const result = (data ?? {}) as AccountDeleteResult;
  const proofPaths = readStringArray(result.proof_paths);
  const documentPaths = readStringArray(result.document_paths);
  const boardPaths = readStringArray(result.board_attachment_paths);
  const chatPaths = readStringArray(result.chat_file_urls)
    .map(extractChatUploadPath)
    .filter((path): path is string => Boolean(path));
  const authUserIds = readStringArray(result.auth_user_ids)
    .filter((id) => UUID_PATTERN.test(id));
  const cleanupOutboxId = String(result.cleanup_outbox_id ?? '').trim();

  const cleanupWarnings = await Promise.all([
    removeStorageObjects('exam-payment-proofs', proofPaths),
    removeStorageObjects('fc-documents', documentPaths),
    removeStorageObjects('board-attachments', boardPaths),
    removeStorageObjects('chat-uploads', chatPaths),
  ]);

  let authCleanupWarning = false;
  for (const authUserId of authUserIds) {
    const { error: authError } = await adminSupabase.auth.admin.deleteUser(authUserId);
    if (authError) authCleanupWarning = true;
  }

  const postCommitCleanupFailed =
    cleanupWarnings.some(Boolean) || authCleanupWarning;
  const { error: outboxError } = UUID_PATTERN.test(cleanupOutboxId)
    ? await adminSupabase.rpc('record_account_deletion_cleanup_attempt_v1', {
      p_outbox_id: cleanupOutboxId,
      p_succeeded: !postCommitCleanupFailed,
      p_error_code: postCommitCleanupFailed
        ? 'post_commit_cleanup_partial_failure'
        : null,
    })
    : { error: new Error('cleanup_outbox_id_missing') };

  return NextResponse.json({
    ok: true,
    deleted: result.deleted === true,
    cleanupWarning: postCommitCleanupFailed || Boolean(outboxError),
  });
}
