import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('referral permission contract', () => {
  it('discards authenticated invite state and keeps signup referral wording mandatory', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'signup.tsx'), 'utf8');

    expect(source).toContain('추천인 (필수)');
    expect(source).not.toContain('추천인 (선택)');
    expect(source).not.toContain('savePendingReferralCode');
    expect(source).not.toContain("router.replace({ pathname: '/referral'");
    expect(source).toContain('void consumePendingReferralCode()');
    expect(source).not.toContain('입력값을 지워주세요');
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
