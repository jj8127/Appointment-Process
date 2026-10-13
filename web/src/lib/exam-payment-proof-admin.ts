import { isHttpsResponseUrl } from './user-intent-policy.ts';

export const EXAM_PAYMENT_PROOF_BUCKET = 'exam-payment-proofs';
export const EXAM_PAYMENT_PROOF_EXPORT_VALID_DAYS = 30;
export const EXAM_PAYMENT_PROOF_EXPORT_EXPIRES_IN_SECONDS =
  EXAM_PAYMENT_PROOF_EXPORT_VALID_DAYS * 24 * 60 * 60;

export type ExamPaymentProofExportLink = {
  registrationId: string;
  storagePath: string;
  signedUrl: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

export function parseExamPaymentProofExportLinks(
  value: unknown,
  expectedRegistrationIds?: readonly string[],
): ExamPaymentProofExportLink[] | null {
  if (!Array.isArray(value) || !value.every((link) => (
    isRecord(link)
    && typeof link.registrationId === 'string' && link.registrationId.trim().length > 0
    && typeof link.storagePath === 'string' && link.storagePath.trim().length > 0
    && isHttpsResponseUrl(link.signedUrl)
  ))) return null;
  const links = value as ExamPaymentProofExportLink[];
  if (expectedRegistrationIds) {
    const expectedIds = new Set(expectedRegistrationIds);
    const returnedIds = new Set(links.map((link) => link.registrationId));
    if (
      expectedIds.size !== expectedRegistrationIds.length
      || returnedIds.size !== links.length
      || returnedIds.size !== expectedIds.size
      || [...returnedIds].some((id) => !expectedIds.has(id))
    ) return null;
  }
  return links;
}

export function buildExamPaymentProofImagePath(registrationId: string): string {
  return `/api/admin/exam-applicants/${encodeURIComponent(registrationId)}/payment-proof`;
}

export function buildExamPaymentProofExportLinkMap(
  links: ExamPaymentProofExportLink[],
): Map<string, ExamPaymentProofExportLink> {
  return new Map(links.map((link) => [link.registrationId, link]));
}
