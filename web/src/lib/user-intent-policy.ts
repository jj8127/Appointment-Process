import { FC_STATUSES } from '../types/fc.ts';
import { isValidIsoDate } from './calendar-date.ts';

/** Enter confirms a composing character; it must not also submit the message. */
export function shouldSubmitOnEnter(event: {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing?: boolean; keyCode?: number };
}): boolean {
  return event.key === 'Enter' && !event.shiftKey
    && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}

export function isValidCareerType(value: unknown): boolean {
  return value === null || value === '' || value === '신입' || value === '경력';
}

const MUTATION_RECEIPT_ERROR =
  '저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 상태를 확인한 뒤 다시 시도해주세요.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireMutationSuccess(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (value as Record<string, unknown>).ok !== true) {
    throw new Error(MUTATION_RECEIPT_ERROR);
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(MUTATION_RECEIPT_ERROR);
  }
  return value as Record<string, unknown>;
}

export function requireProfileMutationReceipt(
  value: unknown,
  expected: Record<string, unknown>,
): Record<string, unknown> {
  requireMutationSuccess(value);
  const profile = requireRecord(value.profile);
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = profile[field];
    if (Object.is(actualValue, expectedValue)) continue;
    if (
      field.endsWith('_at')
      && typeof actualValue === 'string'
      && typeof expectedValue === 'string'
      && Number.isFinite(Date.parse(actualValue))
      && Date.parse(actualValue) === Date.parse(expectedValue)
    ) continue;
    throw new Error(MUTATION_RECEIPT_ERROR);
  }
  return profile;
}

export function requireCleanupMutationReceipt(
  value: unknown,
  confirmationField: 'updated' | 'deleted',
): { cleanupPending: boolean } {
  requireMutationSuccess(value);
  if (value[confirmationField] !== true || typeof value.cleanupPending !== 'boolean') {
    throw new Error(MUTATION_RECEIPT_ERROR);
  }
  return { cleanupPending: value.cleanupPending };
}

export type DocumentStatusReceipt = {
  status: 'pending' | 'approved' | 'rejected';
  reviewerNote: string | null;
  allApproved: boolean | null;
};

export function requireDocumentStatusReceipt(
  value: unknown,
  expected: Pick<DocumentStatusReceipt, 'status' | 'reviewerNote'>,
): DocumentStatusReceipt {
  const result = requireRecord(value);
  if (
    (result.ok !== true && result.success !== true)
    || result.ok === false
    || result.success === false
  ) {
    throw new Error(MUTATION_RECEIPT_ERROR);
  }
  if (
    result.status !== expected.status
    || result.reviewerNote !== expected.reviewerNote
    || (typeof result.allApproved !== 'boolean' && result.allApproved !== null)
  ) {
    throw new Error(MUTATION_RECEIPT_ERROR);
  }
  return {
    status: result.status as DocumentStatusReceipt['status'],
    reviewerNote: result.reviewerNote as string | null,
    allApproved: result.allApproved,
  };
}

export type ExamTransitionAction = 'confirm' | 'unconfirm' | 'reject' | 'cancel_by_admin';

type ExamTransitionResponse = {
  registrationId: string;
  isConfirmed: boolean;
  status: 'confirmed' | 'applied' | 'rejected' | 'cancelled_by_admin';
};

const EXAM_TRANSITION_EXPECTATIONS: Record<ExamTransitionAction, Pick<ExamTransitionResponse, 'isConfirmed' | 'status'>> = {
  confirm: { isConfirmed: true, status: 'confirmed' },
  unconfirm: { isConfirmed: false, status: 'applied' },
  reject: { isConfirmed: false, status: 'rejected' },
  cancel_by_admin: { isConfirmed: false, status: 'cancelled_by_admin' },
};

export function requireExamTransitionSuccess(
  value: unknown,
  expected: { action: ExamTransitionAction; registrationId: string },
): ExamTransitionResponse {
  requireMutationSuccess(value);
  const transition = EXAM_TRANSITION_EXPECTATIONS[expected.action];
  if (
    value.registrationId !== expected.registrationId
    || value.isConfirmed !== transition.isConfirmed
    || value.status !== transition.status
  ) {
    throw new Error(MUTATION_RECEIPT_ERROR);
  }
  return {
    registrationId: value.registrationId,
    isConfirmed: value.isConfirmed,
    status: value.status as ExamTransitionResponse['status'],
  };
}

export function requireExamRoundSaveReceipt(
  value: unknown,
  expectedRoundId: string | null,
): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(MUTATION_RECEIPT_ERROR);
  }
  if (expectedRoundId && value.toLowerCase() !== expectedRoundId.toLowerCase()) {
    throw new Error(MUTATION_RECEIPT_ERROR);
  }
  return value;
}

export function requireExamRoundDeleteReceipt(value: unknown): void {
  const receipt = requireRecord(value);
  if (receipt.deleted !== true || receipt.alreadyDeleted !== false) {
    throw new Error(MUTATION_RECEIPT_ERROR);
  }
}

export function isNonEmptyResponseString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export const isValidYmdResponse = isValidIsoDate;

const FC_STATUS_VALUES = new Set<string>(FC_STATUSES);

export function isValidFcStatusResponse(value: unknown): boolean {
  return typeof value === 'string' && FC_STATUS_VALUES.has(value);
}

export function isHttpsResponseUrl(value: unknown): value is string {
  if (!isNonEmptyResponseString(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
