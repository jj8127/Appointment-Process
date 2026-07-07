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

  it('shows the admin referral relationship link on the referral page for every referral self-service user', () => {
    const referralPageSource = readFileSync(join(process.cwd(), 'app/referral.tsx'), 'utf8');

    expect(referralPageSource).toContain('buildReferralGraphWebUrl');
    expect(referralPageSource).toContain("DEFAULT_ADMIN_WEB_URL = 'https://adminweb-red.vercel.app'");
    expect(referralPageSource).toContain('process.env.EXPO_PUBLIC_ADMIN_WEB_URL ?? DEFAULT_ADMIN_WEB_URL');
    expect(referralPageSource).toContain('관리자 웹에서 추천 관계 보기');
    expect(referralPageSource).toContain('추천인과 하위 연결을 한눈에 확인합니다');
    expect(referralPageSource).toContain("Alert.alert('페이지를 열 수 없습니다'");
    expect(referralPageSource).not.toContain('REFERRAL_GRAPH_WEB_URL ? (');
    expect(referralPageSource).not.toContain('추천인 그래프 뷰로 보기');
    expect(referralPageSource).not.toContain('isManager && !!ADMIN_WEB_URL');
    expect(referralPageSource).not.toContain('PC 브라우저에서 그래프 뷰로 보기');
  });
});
