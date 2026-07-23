export const EXAM_PAYMENT_PROOF_BUCKET = 'exam-payment-proofs';
export const EXAM_PAYMENT_PROOF_EXPORT_VALID_DAYS = 30;
export const EXAM_PAYMENT_PROOF_EXPORT_EXPIRES_IN_SECONDS =
  EXAM_PAYMENT_PROOF_EXPORT_VALID_DAYS * 24 * 60 * 60;

export type ExamPaymentProofExportLink = {
  registrationId: string;
  storagePath: string;
  signedUrl: string;
};

export function buildExamPaymentProofImagePath(registrationId: string): string {
  return `/api/admin/exam-applicants/${encodeURIComponent(registrationId)}/payment-proof`;
}

export function buildExamPaymentProofExportLinkMap(
  links: ExamPaymentProofExportLink[],
): Map<string, ExamPaymentProofExportLink> {
  return new Map(links.map((link) => [link.registrationId, link]));
}
