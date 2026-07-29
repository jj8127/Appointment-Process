import { buildReferralGraphWebUrl } from '../referral-graph-link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('referral graph web link helpers', () => {
  it('returns null when the admin web url is missing', () => {
    expect(buildReferralGraphWebUrl('')).toBeNull();
    expect(buildReferralGraphWebUrl('   ')).toBeNull();
  });

  it('builds the graph view url without duplicating slashes', () => {
    expect(buildReferralGraphWebUrl('https://admin.example.com/')).toBe(
      'https://admin.example.com/dashboard/referrals/graph',
    );
  });

  it('keeps local admin web urls usable for development', () => {
    expect(buildReferralGraphWebUrl('http://localhost:3000')).toBe(
      'http://localhost:3000/dashboard/referrals/graph',
    );
  });

  it('opens the native referral graph from the referral page', () => {
    const referralPageSource = readFileSync(join(process.cwd(), 'app/referral.tsx'), 'utf8');

    expect(referralPageSource).toContain("router.push('/referral-graph')");
    expect(referralPageSource).toContain('추천 관계 그래프로 보기');
    expect(referralPageSource).toContain('앱 안에서 하위 연결을 확대하고 살펴봅니다');
    expect(referralPageSource).not.toContain('buildReferralGraphWebUrl');
    expect(referralPageSource).not.toContain('Linking.openURL');
    expect(referralPageSource).not.toContain('EXPO_PUBLIC_ADMIN_WEB_URL');
  });
});
