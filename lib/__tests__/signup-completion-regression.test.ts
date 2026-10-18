import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeIdentityCompleted } from '@/lib/identity-completion';

describe('signup completion regression guards', () => {
  it('does not treat stale public identity fields as completed identity', () => {
    expect(
      normalizeIdentityCompleted({
        identity_completed: false,
        resident_id_masked: '900101-*******',
        address: '서울시 중구',
      }),
    ).toBe(false);

    expect(
      normalizeIdentityCompleted({
        identity_completed: true,
        resident_id_masked: null,
        address: null,
      }),
    ).toBe(true);
  });

  it('keeps profile and referral writes inside the atomic password/signup completion RPC', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'set-password', 'index.ts'),
      'utf8',
    );
    const migration = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '20261013063141_atomic_signup_otp_challenges.sql'),
      'utf8',
    );

    expect(source).toContain('if (!referralCode || !resolvedReferral)');
    expect(source).toContain("code: 'referral_invalid'");

    const alreadySetIndex = source.indexOf("return fail('already_set'");
    const referralRequiredIndex = source.indexOf('if (!referralCode || !resolvedReferral)');
    const atomicCompletionIndex = source.indexOf(".rpc('complete_fc_signup_atomic_v1'");

    expect(alreadySetIndex).toBeGreaterThan(-1);
    expect(referralRequiredIndex).toBeGreaterThan(alreadySetIndex);
    expect(atomicCompletionIndex).toBeGreaterThan(referralRequiredIndex);
    expect(source).not.toContain('applyReferralLinkState');
    expect(source).not.toContain(".from('fc_profiles')\n        .update");
    expect(source).toContain('p_inviter_fc_id: resolvedReferral.inviterFcId');
    expect(migration).toContain('v_referral_result := public.apply_referral_link_state(');
    expect(source).toContain('isSignupCompletionReceipt(completionReceipt, fcId, phone)');
    expect(source).not.toContain(".from('fc_credentials')\n    .upsert");
  });

  it('requires the validated stored referral again on the password screen', () => {
    const source = readFileSync(
      join(process.cwd(), 'app', 'signup-password.tsx'),
      'utf8',
    );

    const referralGuardIndex = source.indexOf('if (!hasValidStoredSignupReferral(payload))');
    const setPasswordInvokeIndex = source.indexOf("supabase.functions.invoke('set-password'");
    expect(referralGuardIndex).toBeGreaterThan(-1);
    expect(setPasswordInvokeIndex).toBeGreaterThan(referralGuardIndex);
  });

  it('keeps signup referral eligibility aligned for manager referral shadow profiles', () => {
    const searchSource = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'search-signup-referral', 'index.ts'),
      'utf8',
    );
    const validateSource = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'validate-referral-code', 'index.ts'),
      'utf8',
    );
    const setPasswordSource = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'set-password', 'index.ts'),
      'utf8',
    );

    expect(searchSource).toContain(
      'profile.signup_completed !== true && profile.is_manager_referral_shadow !== true',
    );
    expect(validateSource).toContain('is_manager_referral_shadow');
    expect(setPasswordSource).toContain('is_manager_referral_shadow');
    expect(validateSource).toContain(
      'inviterProfile.signup_completed !== true && inviterProfile.is_manager_referral_shadow !== true',
    );
    expect(setPasswordSource).toContain(
      'inviterProfile.signup_completed !== true && inviterProfile.is_manager_referral_shadow !== true',
    );
  });

  it('keeps signup OTP diagnostics free of destinations, codes, and provider bodies', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'request-signup-otp', 'index.ts'),
      'utf8',
    );

    expect(source).not.toContain("console.log('[TEST MODE] OTP code for'");
    expect(source).not.toContain('auth.admin.deleteUser');
    expect(source).not.toContain('cleanupPartialSignupArtifacts');
    expect(source).not.toContain('const text = await res.text()');
    expect(source).toContain("console.info('[request-signup-otp] test delivery simulated')");
  });

  it('routes OTP state and one-time signup proof through atomic RPC receipts', () => {
    const requestSource = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'request-signup-otp', 'index.ts'),
      'utf8',
    );
    const verifySource = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'verify-signup-otp', 'index.ts'),
      'utf8',
    );
    const signupSource = readFileSync(join(process.cwd(), 'app', 'signup.tsx'), 'utf8');
    const verifyScreenSource = readFileSync(join(process.cwd(), 'app', 'signup-verify.tsx'), 'utf8');
    const passwordScreenSource = readFileSync(join(process.cwd(), 'app', 'signup-password.tsx'), 'utf8');

    expect(requestSource).toContain("'issue_signup_otp_challenge_v1'");
    expect(requestSource).toContain('mutationRowReceiptMatches(insertReceipt, insertPayload)');
    expect(requestSource).not.toContain(".from('fc_identity_secure').delete()");
    expect(requestSource).not.toContain(".from('fc_credentials').delete()");
    expect(verifySource).toContain("supabase.rpc('process_signup_otp_challenge_v1'");
    expect(verifySource).not.toContain(".from('fc_profiles')");
    expect(signupSource).toContain('requireSignupAvailabilityReceipt(data, digits)');
    expect(verifyScreenSource).toContain('requireSignupOtpSentReceipt(data, digits)');
    expect(verifyScreenSource).toContain('requireSignupOtpVerifiedReceipt(data, digits)');
    expect(verifyScreenSource).toContain('setPendingSignupVerification({');
    expect(passwordScreenSource).toContain('getPendingSignupVerification(parsed.phone)');
    expect(passwordScreenSource).toContain('verificationProof,');
    expect(passwordScreenSource).toContain('requireSignupCompletionReceipt(data, payload.phone)');
    const persistedSignupStart = verifyScreenSource.indexOf('await safeStorage.setItem(');
    const persistedSignupEnd = verifyScreenSource.indexOf("router.replace('/signup-password')");
    expect(verifyScreenSource.slice(persistedSignupStart, persistedSignupEnd))
      .not.toContain('verificationProof');
    const pendingProofSource = readFileSync(
      join(process.cwd(), 'lib', 'pending-signup-verification.ts'),
      'utf8',
    );
    expect(pendingProofSource).not.toMatch(/safeStorage|SecureStore|localStorage/);
  });

  it('validates early and performs all signup state mutations only in proof-consuming completion', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'set-password', 'index.ts'),
      'utf8',
    );
    const proofValidationIndex = source.indexOf("'validate_signup_verification_proof_v1'");
    const completionIndex = source.indexOf("'complete_fc_signup_atomic_v1'", proofValidationIndex);
    expect(proofValidationIndex).toBeGreaterThan(-1);
    expect(completionIndex).toBeGreaterThan(proofValidationIndex);
    expect(source).toContain('p_verification_proof_hash: verificationProofHash');
    expect(source).toContain('p_name: profileName');
    expect(source).toContain('p_referral_code_id: resolvedReferral.referralCodeId');
    expect(source).not.toContain('.update(updatePayload)');
    expect(source).not.toContain('applyReferralLinkState');
    expect(source).not.toContain('profile.phone_verified !== true');
  });
});
