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

  it.each(['signup', 'signup-verify', 'signup-password'])('keeps legacy %s as a redirect rather than issuing FC credentials', route => {
    const source = readFileSync(join(process.cwd(), 'app', `${route}.tsx`), 'utf8');
    expect(source.trim()).toBe("export { default } from '@/components/LegacySignupRedirect';");
    expect(source).not.toContain('set-password');
    expect(source).not.toContain('completionToken');
  });

  it('uses the signed common service enrollment response for FC permissions', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'platform-api.ts'), 'utf8');
    expect(source).toContain("action === 'enroll_insurance' ? enrollmentSchema");
    expect(source).toContain('insuranceSession: insuranceSessionSchema');
    expect(source).toContain("parseSignupReferralSearchResponse(response)");
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
