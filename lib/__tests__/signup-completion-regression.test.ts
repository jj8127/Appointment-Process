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

  it('keeps referral linking before irreversible password/signup completion writes', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'set-password', 'index.ts'),
      'utf8',
    );

    expect(source).toContain('if (referralCode && !resolvedReferral)');
    expect(source).toContain("code: 'referral_invalid'");
    expect(source).toContain('const referralResetPayload: Record<string, unknown> = referralCode');

    const referralApplyIndex = source.indexOf('const applyResult = await applyReferralLinkState');
    const credentialUpsertIndex = source.indexOf('password_hash: passwordHash');
    const signupCompletedIndex = source.indexOf('Mark signup as completed');

    expect(referralApplyIndex).toBeGreaterThan(-1);
    expect(credentialUpsertIndex).toBeGreaterThan(-1);
    expect(signupCompletedIndex).toBeGreaterThan(-1);
    expect(referralApplyIndex).toBeLessThan(credentialUpsertIndex);
    expect(referralApplyIndex).toBeLessThan(signupCompletedIndex);
  });
});
