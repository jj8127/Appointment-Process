import { reportEdgeDiagnostic } from './edge-diagnostic.ts';
import { requireAccountDeletionReceipt } from './ux-mutation-contract.ts';

type CleanupClient = {
  storage: { from(bucket: string): { remove(paths: string[]): PromiseLike<{ error: unknown }> } };
  auth: { admin: { deleteUser(id: string): PromiseLike<{ error: unknown }> } };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  from(table: string): { select(columns: string): { eq(column: string, value: string): {
    maybeSingle(): PromiseLike<{ data: { status?: unknown } | null; error: unknown }>;
  } } };
};

/** Shared by FC self-deletion and coordinated common withdrawal. The durable
 * outbox is completed only after every post-commit cleanup has succeeded. */
export async function drainAccountDeletionCleanup(db: CleanupClient, value: unknown, role = 'fc'): Promise<boolean> {
  const receipt = requireAccountDeletionReceipt(value);
  try {
    const state = await db.from('account_deletion_cleanup_outbox').select('status').eq('id', receipt.cleanup_outbox_id).maybeSingle();
    if (state.error || !state.data) return true;
    if (state.data.status === 'completed') return false;
  } catch { return true; }
  let failed = false;
  for (const [bucket, paths] of [
    ['exam-payment-proofs', receipt.proof_paths], ['fc-documents', receipt.document_paths],
    ['board-attachments', receipt.board_attachment_paths],
  ] as const) {
    if (!paths.length) continue;
    let bucketFailed = false;
    try { bucketFailed = Boolean((await db.storage.from(bucket).remove([...new Set(paths)])).error); }
    catch { bucketFailed = true; }
    if (bucketFailed) {
      failed = true;
      if (bucket === 'exam-payment-proofs') reportEdgeDiagnostic({ event: 'exam_payment_proof.storage', reason: 'storage_remove_failed', errorClass: 'upstream' });
      else reportEdgeDiagnostic({ event: 'delete_account.storage_cleanup',
        reason: bucket === 'fc-documents' ? 'fc_documents_remove_failed' : 'board_attachments_remove_failed', errorClass: 'upstream' });
    }
  }
  for (const id of receipt.auth_user_ids) {
    let authFailed = false;
    try {
      const result = await db.auth.admin.deleteUser(id);
      // A successful earlier attempt may have deleted this Auth user already.
      if (result.error && (result.error as { code?: string }).code !== 'user_not_found') authFailed = true;
    } catch { authFailed = true; }
    if (authFailed) {
      failed = true;
      reportEdgeDiagnostic({ event: 'delete_account.auth_cleanup',
        reason: role === 'manager' ? 'manager_shadow_auth_user_delete_failed' : 'auth_user_delete_failed', errorClass: 'authentication' });
    }
  }
  try {
    const result = await db.rpc('record_account_deletion_cleanup_attempt_v1', {
      p_outbox_id: receipt.cleanup_outbox_id, p_succeeded: !failed,
      p_error_code: failed ? 'post_commit_cleanup_partial_failure' : null,
    });
    return failed || Boolean(result.error) || !Array.isArray(result.data)
      || result.data.length !== 1 || result.data[0]?.status !== 'completed';
  } catch { return true; }
}
