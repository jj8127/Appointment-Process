import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('referral permission contract', () => {
  it('keeps insurance invitations outside the common signup referrer', () => {
    const legacy = readFileSync(join(process.cwd(), 'components', 'LegacySignupRedirect.tsx'), 'utf8');
    const common = readFileSync(join(process.cwd(), 'app', 'services', 'signup.tsx'), 'utf8');
    expect(legacy).toContain('!role && code');
    expect(legacy).toContain('savePendingReferralCode(code)');
    expect(legacy).not.toContain("savePendingReferralCode(code, 'care')");
    expect(common).toContain("consumePendingReferralCode('care')");
    expect(common).not.toContain('consumePendingReferralCode()');
  });

  it('keeps the FC referral surface read/share-only', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'referral.tsx'), 'utf8');

    expect(source).toContain('handleCopyCode');
    expect(source).toContain('handleShare');
    expect(source).not.toContain('search-fc-for-referral');
    expect(source).not.toContain('update-my-recommender');
    expect(source).not.toContain('ReferralSearchField');
    expect(source).not.toContain('추천인 관계 저장');
  });

  it('rejects the retired direct recommender write after verifying the app session', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'update-my-recommender', 'index.ts'),
      'utf8',
    );

    const sessionIndex = source.indexOf('requireAppSessionFromRequest(req)');
    const forbiddenIndex = source.indexOf("'forbidden'");
    expect(sessionIndex).toBeGreaterThan(-1);
    expect(forbiddenIndex).toBeGreaterThan(sessionIndex);
    expect(source).not.toContain('applyReferralLinkState');
    expect(source).not.toContain(".from('fc_profiles')");
  });

  it('uses the dedicated relation route without broadening updateProfile', () => {
    const profileSource = readFileSync(
      join(process.cwd(), 'web', 'src', 'app', 'dashboard', 'profile', '[id]', 'page.tsx'),
      'utf8',
    );
    const broadRouteSource = readFileSync(
      join(process.cwd(), 'web', 'src', 'app', 'api', 'admin', 'fc', 'route.ts'),
      'utf8',
    );

    expect(profileSource).toContain("fetch('/api/admin/fc/recommender'");
    expect(profileSource).not.toContain('payload.recommenderFcId');
    expect(broadRouteSource).toContain('const sessionCheck = action ===');
    expect(broadRouteSource).toContain(': await getAdminSession();');
    expect(broadRouteSource).toContain('isRetiredLegacyRecommenderSearchAction(action)');
    expect(broadRouteSource).toContain('hasRetiredLegacyRecommenderMutationFields(data)');
    expect(broadRouteSource).not.toContain('applyRecommenderSelection');
    expect(broadRouteSource).not.toContain("if (action === 'searchRecommenders')");
    expect(broadRouteSource).not.toContain('updateData.recommenderFcId');
  });
});
