import { readFileSync } from 'node:fs';
import path from 'node:path';

const deployment = readFileSync(
  path.join(__dirname, '..', '..', 'docs', 'deployment', 'DEPLOYMENT.md'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('exam deployment gate contract', () => {
  const examGateStart = deployment.indexOf('#### Exam v2 검증 gate와 고정 rollout 순서');
  const examGateEnd = deployment.indexOf('\n## 5.', examGateStart);
  const examGate = deployment.slice(examGateStart, examGateEnd);

  it('treats the legacy migration and RPC as insufficient for activation', () => {
    expect(deployment).toContain(
      '`20260712000002_atomic_exam_round_save.sql`은 legacy exact-date RPC의 기초 migration일 뿐이다.',
    );
    expect(deployment).toContain('legacy `save_exam_round_atomic`만 확인한 상태는 **불충분**');
    expect(deployment).toContain('`20260804081357_exam_round_month_for_tbd.sql`을 적용');
  });

  it('pins the exact v2 signature and service-only invoker checks', () => {
    expect(examGateStart).toBeGreaterThanOrEqual(0);
    expect(examGate).toContain(
      "to_regprocedure('public.save_exam_round_atomic_v2(uuid,date,date,date,text,text,text,text[])')",
    );
    expect(examGate).toContain('`SECURITY INVOKER`(`pg_proc.prosecdef = false`)');
    expect(examGate).toContain('`PUBLIC`, `anon`, `authenticated`의 `EXECUTE`가 모두 없고');
    expect(examGate).toContain('`service_role`에만 명시적 `EXECUTE`');
  });

  it('requires representative success, failure, atomicity, and legacy exact scenarios', () => {
    expect(examGate).toContain('exact date + 같은 `exam_month` 저장 성공');
    expect(examGate).toContain('`exam_date = null` + 명시적 월 시작 `exam_month`인 TBD 저장 성공');
    expect(examGate).toContain('exact date와 다른 월의 `exam_month`, `exam_month = null`, 중복 location 입력');
    expect(examGate).toContain('round와 location row 수·값을 비교해 둘 다 partial write가 **0건**');
    expect(examGate).toContain('legacy `save_exam_round_atomic`의 exact-date 호출');
  });

  it('keeps the rollout held in migration-to-mobile order', () => {
    const order = [
      '**DB migration 적용**',
      '**정확한 RPC·보안 속성 검증**',
      '**대표 transaction 검증**',
      '**서버 caller 활성화와 인증 smoke**',
      '**mobile 배포**',
    ].map((marker) => examGate.indexOf(marker));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(examGate).toContain('admin web과 `admin-action` Edge를 활성화');
    expect(examGate).toContain('마지막 증거가 승인될 때까지 결론은 계속 **릴리스 HOLD**');
  });
});
