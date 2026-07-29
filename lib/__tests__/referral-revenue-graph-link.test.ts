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

  it('keeps the existing relationship graph CTA before the sample revenue CTA', () => {
    const existingCtaIndex = referralSource.indexOf('추천 관계 그래프로 보기');
    const sampleCtaIndex = referralSource.indexOf('매출 기여 그래프 미리보기');

    expect(existingCtaIndex).toBeGreaterThan(-1);
    expect(sampleCtaIndex).toBeGreaterThan(existingCtaIndex);
    expect(referralSource).toContain("router.push('/referral-graph')");
    expect(referralSource).toContain("router.push('/referral-revenue-graph')");
    expect(referralSource).toContain('샘플 매출 기여 그래프 미리보기');
  });

  it('registers the separate preview route in both stack branches', () => {
    expect(
      layoutSource.match(/name="referral-revenue-graph"/g),
    ).toHaveLength(2);
    expect(
      layoutSource.match(/title: '매출 기여 그래프'/g),
    ).toHaveLength(2);
  });
});
