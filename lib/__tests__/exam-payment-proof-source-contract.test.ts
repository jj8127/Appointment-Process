import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..');
const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe.each([
  ['life', 'app/exam-apply.tsx'],
  ['nonlife', 'app/exam-apply2.tsx'],
])('%s exam payment proof source contract', (_examType, relativePath) => {
  const source = readSource(relativePath);

  it('requires and restores payment proof state', () => {
    expect(source).toContain('payment_proof_attached');
    expect(source).toMatch(/hasExamPaymentProof\(\s*\{/);
    expect(source).toContain('<ExamPaymentProofField');
    expect(source).toContain('EXAM_PAYMENT_PROOF_CAUTION');
  });

  it('uses the signed-session server path instead of a direct registration write', () => {
    expect(source).toContain('appSessionToken');
    expect(source).toContain('prepareExamPaymentProofUpload');
    expect(source).toContain('submitExamApplicationWithPaymentProof');
    expect(source).toContain('cancelExamApplicationWithPaymentProof');
    expect(source).not.toMatch(/from\('exam_registrations'\)\s*\.(insert|update|delete)/);
  });

  it('prevents future payment dates in both native picker variants', () => {
    expect(source.match(/maximumDate=\{new Date\(\)\}/g)).toHaveLength(2);
  });
});

describe('exam payment proof field accessibility', () => {
  const source = readSource('components/ExamPaymentProofField.tsx');

  it('exposes pick, preview, and remove labels', () => {
    expect(source).toContain('입금 내역 캡처 첨부');
    expect(source).toContain('accessibilityLabel="선택한 입금 내역 사진 미리보기"');
    expect(source).toContain("accessibilityLabel={hasProof ? '입금 내역 사진 변경' : '입금 내역 사진 선택'}");
    expect(source).toContain('accessibilityLabel="선택한 입금 내역 사진 삭제"');
  });
});

describe('exam payment proof Edge result narrowing', () => {
  const source = readSource('supabase/functions/exam-payment-proof/index.ts');

  it('uses explicit failure discriminants for Deno-safe result unions', () => {
    expect(
      source.match(/if \((?:validated|sessionResult|actorResult)\.ok === false\)/g),
    ).toHaveLength(6);
    expect(source).not.toMatch(/if \(!(?:validated|sessionResult|actorResult)\.ok\)/);
  });
});
