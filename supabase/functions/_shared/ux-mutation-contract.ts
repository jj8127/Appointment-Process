/** Service-only RPC receipts. A malformed response never confirms a mutation. */
export type DocumentMutationReceipt = { cleanupPending: boolean } & (
  { deleted: true } | { updated: true }
);
export type ExamDeletionReceipt = { deleted: true; alreadyDeleted: boolean };
export type CreationReceipt = { id: string; updated_at?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function requireDocumentReceipt(value: unknown, action: 'deleted' | 'updated'): DocumentMutationReceipt {
  if (!record(value) || value[action] !== true || typeof value.cleanupPending !== 'boolean') throw new Error('mutation_receipt_unverified');
  return value as DocumentMutationReceipt;
}
export function requireExamDeletionReceipt(value: unknown): ExamDeletionReceipt {
  if (!record(value) || value.deleted !== true || typeof value.alreadyDeleted !== 'boolean') throw new Error('mutation_receipt_unverified');
  return value as ExamDeletionReceipt;
}
export function requireCreationReceipt(value: unknown, board = false): CreationReceipt {
  if (!record(value) || typeof value.id !== 'string' || !uuid.test(value.id)
    || (board && (typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))))) throw new Error('mutation_receipt_unverified');
  return value as CreationReceipt;
}
