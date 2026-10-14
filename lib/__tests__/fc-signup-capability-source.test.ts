import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('FC OTP signup completion capability', () => {
  it('issues the opaque capability only through the transactional OTP verification RPC', () => {
    const source = read('supabase/functions/verify-signup-otp/index.ts');

    expect(source).toContain('crypto.getRandomValues(new Uint8Array(32))');
    expect(source).toContain('fc-signup-completion-v1:${phone}:${completionToken}');
    expect(source).toContain("supabase.rpc('verify_fc_signup_otp_v1'");
    expect(source).toContain('p_test_bypass: isTestBypass');
    expect(source).toContain('return json({ ok: true, completionToken });');
    expect(source).not.toContain(".from('fc_profiles')");
    expect(source).not.toContain('phone_verified: true');
    expect(source).not.toContain('error.message');
  });

  it('uses one idempotent RPC for profile, referral, credential, and proof consumption', () => {
    const source = read('supabase/functions/set-password/index.ts');

    expect(source).toContain('hmacSha256Hex(serviceKey, canonicalRequest)');
    expect(source).toContain('fc-signup-completion-v1:${phone}:${completionToken}');
    expect(source).toContain("supabase.rpc('complete_fc_otp_signup_v1'");
    expect(source).toContain('p_request_fingerprint: requestFingerprint');
    expect(source).not.toContain(".from('fc_credentials')");
    expect(source).not.toContain('applyReferralLinkState');
    expect(source).not.toContain('profileError.message');
    expect(source).not.toContain('context.text()');
  });

  it('stops legacy requests before validation or side effects while keeping supplied invalid tokens strict', () => {
    const source = read('supabase/functions/set-password/index.ts');
    const legacyGuard = source.indexOf("Object.prototype.hasOwnProperty.call(body, 'completionToken')");
    const phoneValidation = source.indexOf("const phone = cleanPhone(body.phone ?? '')", legacyGuard);
    const referralLookup = source.indexOf('await resolveReferralDetails({', legacyGuard);
    const completionRpc = source.indexOf("supabase.rpc('complete_fc_otp_signup_v1'", legacyGuard);
    const passwordSync = source.indexOf('await syncRequestBoardPassword({', legacyGuard);
    const tokenNormalization = source.indexOf("const completionToken = typeof body.completionToken === 'string'", legacyGuard);
    const tokenShapeGuard = source.indexOf("if (!/^[A-Za-z0-9_-]{43}$/.test(completionToken))", tokenNormalization);
    const legacyBranch = source.slice(legacyGuard, tokenNormalization);

    expect(legacyGuard).toBeGreaterThan(-1);
    expect(phoneValidation).toBeGreaterThan(legacyGuard);
    expect(referralLookup).toBeGreaterThan(legacyGuard);
    expect(completionRpc).toBeGreaterThan(legacyGuard);
    expect(passwordSync).toBeGreaterThan(legacyGuard);
    expect(legacyBranch).toContain("code: 'upgrade_required'");
    expect(legacyBranch).toContain('안전한 회원가입을 위해 모두온 앱을 최신 버전으로 업데이트한 뒤 다시 시도해주세요.');
    expect(legacyBranch).toContain('}, 200);');

    const tokenShapeBranch = source.slice(tokenNormalization, phoneValidation);
    expect(tokenNormalization).toBeGreaterThan(legacyGuard);
    expect(tokenShapeGuard).toBeGreaterThan(legacyGuard);
    expect(tokenShapeGuard).toBeLessThan(phoneValidation);
    expect(tokenShapeBranch).toContain("typeof body.completionToken === 'string'");
    expect(tokenShapeBranch).toContain("return fail('verification_required'");
    expect(tokenShapeBranch).toContain(', 401);');
  });

  it('returns an idempotent replay before referral events or external password sync', () => {
    const source = read('supabase/functions/set-password/index.ts');
    const replayGuard = source.indexOf('if (alreadyApplied)');
    const referralEvent = source.indexOf('await insertSignupReferralEvent');
    const passwordSync = source.indexOf('await syncRequestBoardPassword');

    expect(replayGuard).toBeGreaterThan(-1);
    expect(source.slice(replayGuard, referralEvent)).toContain('return json({ ok: true');
    expect(replayGuard).toBeLessThan(referralEvent);
    expect(replayGuard).toBeLessThan(passwordSync);
  });

});
