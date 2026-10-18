const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesResidentId(value: unknown, expectedResidentId: string): boolean {
  return typeof value === 'string'
    && value.replace(/\D/g, '') === expectedResidentId.replace(/\D/g, '');
}

export function requireSignupAvailabilityReceipt(value: unknown, expectedResidentId: string): void {
  if (!record(value)
    || value.ok !== true
    || value.available !== true
    || !matchesResidentId(value.residentId, expectedResidentId)) {
    throw new Error('가입 가능 여부 확인 결과를 확인하지 못했습니다.');
  }
}

export function requireSignupOtpSentReceipt(
  value: unknown,
  expectedResidentId: string,
): { challengeId: string } {
  if (!record(value)
    || value.ok !== true
    || value.sent !== true
    || !matchesResidentId(value.residentId, expectedResidentId)
    || typeof value.challengeId !== 'string'
    || !UUID_PATTERN.test(value.challengeId)) {
    throw new Error('인증 코드 발송 결과를 확인하지 못했습니다.');
  }
  return { challengeId: value.challengeId };
}

export function requireSignupOtpVerifiedReceipt(
  value: unknown,
  expectedResidentId: string,
): { profileId: string; verificationProof: string } {
  if (!record(value)
    || value.ok !== true
    || value.verified !== true
    || !matchesResidentId(value.residentId, expectedResidentId)
    || typeof value.profileId !== 'string'
    || !UUID_PATTERN.test(value.profileId)
    || typeof value.verificationProof !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/.test(value.verificationProof)) {
    throw new Error('휴대폰 인증 결과를 확인하지 못했습니다.');
  }
  return {
    profileId: value.profileId,
    verificationProof: value.verificationProof,
  };
}

export function requireSignupCompletionReceipt(value: unknown, expectedResidentId: string): void {
  if (!record(value)
    || value.ok !== true
    || value.signupCompleted !== true
    || !matchesResidentId(value.residentId, expectedResidentId)
    || typeof value.fcId !== 'string'
    || !UUID_PATTERN.test(value.fcId)
    || typeof value.displayName !== 'string'
    || typeof value.passwordSetAt !== 'string'
    || !Number.isFinite(Date.parse(value.passwordSetAt))) {
    throw new Error('회원가입 완료 결과를 확인하지 못했습니다.');
  }
}
