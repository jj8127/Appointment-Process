import { cleanupFailed } from '@/lib/upstream-response-policy';
import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { adminRouteAuthErrorResponse, requireAdminRoute } from '@/lib/admin-route-auth';
import { serverError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { requireAccountDeletionReceipt } from '@shared/supabase/functions/_shared/ux-mutation-contract';

type DeleteRequestBody = {
  fcId?: string;
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

async function removeStorageObjects(bucket: string, paths: string[]) {
  if (paths.length === 0) return false;
  const failed = await cleanupFailed(() => adminSupabase.storage.from(bucket).remove(paths));
  const error = failed;
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
    if (error.message === 'account_delete_target_not_found') {
      logger.warn('[api/fc-delete] deletion target not found', { code: error.code ?? 'unknown' });
      return NextResponse.json({ error: '삭제할 FC 계정을 찾을 수 없습니다.' }, { status: 404 });
    }
    return serverError(error, 'api/fc-delete');
  }

  let result: ReturnType<typeof requireAccountDeletionReceipt>;
  try {
    result = requireAccountDeletionReceipt(data);
  } catch {
    return NextResponse.json({ error: '삭제 결과를 확인할 수 없습니다. 목록을 새로고침하여 확인해 주세요.' }, { status: 502 });
  }
  const proofPaths = readStringArray(result.proof_paths);
  const documentPaths = readStringArray(result.document_paths);
  const boardPaths = readStringArray(result.board_attachment_paths);
  const authUserIds = readStringArray(result.auth_user_ids);
  const cleanupOutboxId = result.cleanup_outbox_id;

  const cleanupWarnings = await Promise.all([
    removeStorageObjects('exam-payment-proofs', proofPaths),
    removeStorageObjects('fc-documents', documentPaths),
    removeStorageObjects('board-attachments', boardPaths),
  ]);

  let authCleanupWarning = false;
  for (const authUserId of authUserIds) {
    if (await cleanupFailed(() => adminSupabase.auth.admin.deleteUser(authUserId))) authCleanupWarning = true;
  }

  const postCommitCleanupFailed =
    cleanupWarnings.some(Boolean) || authCleanupWarning;
  const outboxError = await cleanupFailed(async () => await adminSupabase.rpc('record_account_deletion_cleanup_attempt_v1', {
    p_outbox_id: cleanupOutboxId,
    p_succeeded: !postCommitCleanupFailed,
    p_error_code: postCommitCleanupFailed
      ? 'post_commit_cleanup_partial_failure'
      : null,
  }));

  return NextResponse.json({
    ok: true,
    deleted: result.deleted === true,
    cleanupWarning: postCommitCleanupFailed || Boolean(outboxError),
  });
}
