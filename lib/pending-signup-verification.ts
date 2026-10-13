const VERIFICATION_PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type PendingSignupVerification = {
  residentId: string;
  verificationProof: string;
};

let pendingVerification: PendingSignupVerification | null = null;

function normalizeResidentId(value: string): string {
  return value.replace(/\D/g, '');
}

export function setPendingSignupVerification(value: PendingSignupVerification): void {
  const residentId = normalizeResidentId(value.residentId);
  if (!/^01[0-9]{9}$/.test(residentId) || !VERIFICATION_PROOF_PATTERN.test(value.verificationProof)) {
    throw new Error('휴대폰 인증 증명을 확인하지 못했습니다.');
  }
  pendingVerification = { residentId, verificationProof: value.verificationProof };
}

export function getPendingSignupVerification(residentId: string): string | null {
  const normalizedResidentId = normalizeResidentId(residentId);
  return pendingVerification?.residentId === normalizedResidentId
    ? pendingVerification.verificationProof
    : null;
}

export function clearPendingSignupVerification(): void {
  pendingVerification = null;
}
