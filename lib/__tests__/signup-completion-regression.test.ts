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

  it('delegates every irreversible signup write to one atomic completion RPC', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'set-password', 'index.ts'),
      'utf8',
    );

    expect(source).toContain("supabase.rpc('complete_fc_otp_signup_v1'");
    expect(source).toContain('p_completion_token_hash: completionTokenHash');
    expect(source).toContain('p_request_fingerprint: requestFingerprint');
    expect(source).toContain('p_password_hash: passwordHash');
    expect(source).toContain('p_referral_code: resolvedReferral.referralCode');
    expect(source).not.toContain('applyReferralLinkState');
    expect(source).not.toContain(".from('fc_credentials')");
    expect(source).not.toContain(".from('fc_profiles').update");
    expect(source).not.toContain('signup_completed: true');
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

  it('keeps the completion capability out of the general signup payload', () => {
    const verifySource = readFileSync(
      join(process.cwd(), 'app', 'signup-verify.tsx'),
      'utf8',
    );
    const passwordSource = readFileSync(
      join(process.cwd(), 'app', 'signup-password.tsx'),
      'utf8',
    );

    expect(verifySource).toContain('sensitiveTokenStorage.setItem(');
    expect(verifySource).toContain('SIGNUP_COMPLETION_TOKEN_STORAGE_KEY');
    expect(verifySource).not.toContain('JSON.stringify({ ...payload, phone: digits, phoneVerified: true, completionToken');
    expect(passwordSource).toContain('sensitiveTokenStorage.getItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY)');
    expect(passwordSource).toContain('completionToken,');
    expect(passwordSource).toContain('sensitiveTokenStorage.removeItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY)');
    expect(passwordSource).not.toContain('context.text()');
    expect(passwordSource).not.toContain('data?.message');
  });

  it('accepts the check-only availability wire contract without inventing a resident id receipt', () => {
    const source = readFileSync(
      join(process.cwd(), 'app', 'signup.tsx'),
      'utf8',
    );

    expect(source).toContain('body: { phone: digits, checkOnly: true }');
    expect(source).toContain('if (!data?.ok)');
    expect(source).not.toContain('requireSignupAvailabilityReceipt');
    expect(source).not.toContain('@/lib/signup-otp-response');
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
    expect(source).not.toContain('profileId, authDeleteError.message');
    expect(source).not.toContain('const text = await res.text()');
    expect(source).toContain("reason: 'auth_cleanup_failed'");
    expect(source).toContain("console.info('[request-signup-otp] test delivery simulated')");
  });
});
