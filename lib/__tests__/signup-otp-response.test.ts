import {
  requireSignupCompletionReceipt,
  requireSignupAvailabilityReceipt,
  requireSignupOtpSentReceipt,
  requireSignupOtpVerifiedReceipt,
} from '@/lib/signup-otp-response';

const residentId = '01012345678';
const profileId = '123e4567-e89b-42d3-a456-426614174000';
const challengeId = '123e4567-e89b-42d3-a456-426614174001';
const verificationProof = 'A'.repeat(43);

describe('signup OTP response contracts', () => {
  it('binds availability and delivery receipts to the requested resident id', () => {
    expect(() => requireSignupAvailabilityReceipt({ ok: true, available: true, residentId }, residentId))
      .not.toThrow();
    expect(() => requireSignupOtpSentReceipt({ ok: true, sent: true, residentId, challengeId }, residentId))
      .not.toThrow();
    expect(() => requireSignupAvailabilityReceipt({ ok: true, available: true }, residentId)).toThrow();
    expect(() => requireSignupOtpSentReceipt({ ok: true, sent: true, residentId: '01099999999', challengeId }, residentId))
      .toThrow();
    expect(() => requireSignupOtpSentReceipt({ ok: true, sent: true, residentId }, residentId))
      .toThrow();
  });

  it('requires an exact verified receipt with a UUID profile', () => {
    expect(() => requireSignupOtpVerifiedReceipt({
      ok: true,
      verified: true,
      residentId,
      profileId,
      verificationProof,
    }, residentId)).not.toThrow();
    expect(() => requireSignupOtpVerifiedReceipt({ ok: true, verified: true, residentId }, residentId))
      .toThrow();
    expect(() => requireSignupOtpVerifiedReceipt({
      ok: true,
      verified: false,
      residentId,
      profileId,
      verificationProof,
    }, residentId)).toThrow();
    expect(() => requireSignupOtpVerifiedReceipt({
      ok: true,
      verified: true,
      residentId,
      profileId,
      verificationProof: 'persisted-looking-but-invalid',
    }, residentId)).toThrow();
  });

  it('requires a request-bound password and signup completion receipt', () => {
    const receipt = {
      ok: true,
      fcId: profileId,
      residentId,
      displayName: '홍길동',
      signupCompleted: true,
      passwordSetAt: '2026-10-13T00:00:00.000Z',
    };
    expect(() => requireSignupCompletionReceipt(receipt, residentId)).not.toThrow();
    expect(() => requireSignupCompletionReceipt({ ...receipt, signupCompleted: false }, residentId))
      .toThrow();
    expect(() => requireSignupCompletionReceipt({ ...receipt, passwordSetAt: 'invalid' }, residentId))
      .toThrow();
  });
});
