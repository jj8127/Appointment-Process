import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..');

describe('referral revenue demo navigation', () => {
  const referralSource = fs.readFileSync(
    path.join(repoRoot, 'app', 'referral.tsx'),
    'utf8',
  );
  const layoutSource = fs.readFileSync(
    path.join(repoRoot, 'app', '_layout.tsx'),
    'utf8',
  );

  it('keeps relationship navigation separate from allowance and sample revenue screens', () => {
    expect(referralSource).toContain('추천 관계 그래프로 보기');
    expect(referralSource).toContain("router.push('/referral-graph')");
    expect(referralSource).not.toContain("router.push('/referral-revenue-graph')");
    expect(referralSource).not.toContain("router.push('/referral-allowance')");
    expect(referralSource).not.toContain('useReferralAllowanceAccess');
    expect(referralSource).not.toContain('증원수당 흐름 미리보기');
  });

  it('registers the separate preview route in both stack branches', () => {
    expect(
      layoutSource.match(/name="referral-revenue-graph"/g),
    ).toHaveLength(2);
    expect(
      layoutSource.match(/title: '증원수당 흐름'/g),
    ).toHaveLength(2);
  });
});
