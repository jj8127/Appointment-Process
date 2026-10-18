/** Service-only RPC receipts. A malformed response never confirms a mutation. */
export type DocumentMutationReceipt = { cleanupPending: boolean } & (
  { deleted: true } | { updated: true }
);
export type ExamDeletionReceipt = { deleted: true; alreadyDeleted: boolean };
export type CreationReceipt = { id: string; updated_at?: string };
export type ExamTransitionAction = 'confirm' | 'unconfirm' | 'reject' | 'cancel_by_admin';
export type ExamTransitionReceipt = {
  registration_id: string;
  status: 'confirmed' | 'applied' | 'rejected' | 'cancelled_by_admin';
  proof_path: string | null;
  target_resident_id: string | null;
  exam_type: string | null;
  notification_id: string | null;
  recipient_actor_id: string | null;
};
export type AccountDeletionReceipt = {
  deleted: true;
  cleanup_outbox_id: string;
  proof_paths: string[];
  document_paths: string[];
  board_attachment_paths: string[];
  chat_file_urls: string[];
  auth_user_ids: string[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function requireMutationRowReceipt(
  value: unknown,
  expected: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (!record(value)) throw new Error('mutation_receipt_unverified');
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = value[field];
    if (Object.is(actualValue, expectedValue)) continue;
    if (field.endsWith('_at')
      && typeof actualValue === 'string'
      && typeof expectedValue === 'string'
      && Number.isFinite(Date.parse(actualValue))
      && Date.parse(actualValue) === Date.parse(expectedValue)) continue;
    throw new Error('mutation_receipt_unverified');
  }
  return value;
}
export function mutationRowReceiptMatches(
  value: unknown,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  try {
    requireMutationRowReceipt(value, expected);
    return true;
  } catch {
    return false;
  }
}
export function requireDocumentReceipt(value: unknown, action: 'deleted' | 'updated'): DocumentMutationReceipt {
  if (!record(value) || value[action] !== true || typeof value.cleanupPending !== 'boolean') throw new Error('mutation_receipt_unverified');
  return value as DocumentMutationReceipt;
}
export function requireExamDeletionReceipt(value: unknown): ExamDeletionReceipt {
  if (!record(value) || value.deleted !== true || typeof value.alreadyDeleted !== 'boolean') throw new Error('mutation_receipt_unverified');
  return value as ExamDeletionReceipt;
}
export function requireExamTransitionReceipt(
  value: unknown,
  expectedRegistrationId: string,
  action: ExamTransitionAction,
): ExamTransitionReceipt {
  const receipt = Array.isArray(value)
    ? value.length === 1 ? value[0] : null
    : value;
  const expectedStatus = action === 'confirm'
    ? 'confirmed'
    : action === 'unconfirm'
      ? 'applied'
      : action === 'reject'
        ? 'rejected'
        : 'cancelled_by_admin';
  if (!record(receipt)
    || typeof receipt.registration_id !== 'string'
    || !uuid.test(receipt.registration_id)
    || receipt.registration_id.toLowerCase() !== expectedRegistrationId.toLowerCase()
    || receipt.status !== expectedStatus
    || (receipt.proof_path !== null && typeof receipt.proof_path !== 'string')
    || (receipt.target_resident_id !== null && typeof receipt.target_resident_id !== 'string')
    || (receipt.exam_type !== null && receipt.exam_type !== 'life' && receipt.exam_type !== 'nonlife')
    || (receipt.notification_id !== null
      && (typeof receipt.notification_id !== 'string' || !uuid.test(receipt.notification_id)))
    || (receipt.recipient_actor_id !== null
      && (typeof receipt.recipient_actor_id !== 'string' || !uuid.test(receipt.recipient_actor_id)))) {
    throw new Error('mutation_receipt_unverified');
  }
  return receipt as ExamTransitionReceipt;
}
export function requireAccountDeletionReceipt(value: unknown): AccountDeletionReceipt {
  if (!record(value)
    || value.deleted !== true
    || typeof value.cleanup_outbox_id !== 'string'
    || !uuid.test(value.cleanup_outbox_id)
    || !['proof_paths', 'document_paths', 'board_attachment_paths', 'chat_file_urls'].every((field) => (
      Array.isArray(value[field])
      && value[field].every((item) => typeof item === 'string' && item.trim().length > 0)
    ))
    || !Array.isArray(value.auth_user_ids)
    || !value.auth_user_ids.every((item) => typeof item === 'string' && uuid.test(item))) {
    throw new Error('mutation_receipt_unverified');
  }
  return value as AccountDeletionReceipt;
}
export function requireCreationReceipt(value: unknown, board = false): CreationReceipt {
  if (!record(value) || typeof value.id !== 'string' || !uuid.test(value.id)
    || (board && (typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))))) throw new Error('mutation_receipt_unverified');
  return value as CreationReceipt;
}
