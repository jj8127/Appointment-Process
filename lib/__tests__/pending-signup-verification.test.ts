import {
  clearPendingSignupVerification,
  getPendingSignupVerification,
  setPendingSignupVerification,
} from '@/lib/pending-signup-verification';

describe('pending signup verification proof', () => {
  afterEach(() => clearPendingSignupVerification());

  it('keeps a proof only in process memory and binds it to the normalized phone', () => {
    const proof = 'A'.repeat(43);
    setPendingSignupVerification({ residentId: '010-1234-5678', verificationProof: proof });
    expect(getPendingSignupVerification('01012345678')).toBe(proof);
    expect(getPendingSignupVerification('01099999999')).toBeNull();
    clearPendingSignupVerification();
    expect(getPendingSignupVerification('01012345678')).toBeNull();
  });

  it('rejects malformed phone and proof values', () => {
    expect(() => setPendingSignupVerification({
      residentId: '01012345678',
      verificationProof: 'short',
    })).toThrow();
  });
});
