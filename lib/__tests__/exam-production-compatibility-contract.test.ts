import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('production exam application compatibility contract', () => {
  it('uses the unambiguous registration-to-round relationship in application and administrator flows', () => {
    for (const path of [
      'app/exam-apply.tsx',
      'app/exam-apply2.tsx',
    ]) {
      const source = read(path);
      expect(source).toContain('exam_registrations_round_exam_type_fkey');
    }

    for (const path of ['app/exam-manage.tsx', 'app/exam-manage2.tsx']) {
      const source = read(path);
      expect(source).toContain('exam_rounds!exam_registrations_round_exam_type_fkey!inner');
      expect(source).not.toContain('exam_rounds!inner');
    }
  });

  it('allows one active life and one active nonlife application in the same month', () => {
    const migration = read('supabase/migrations/20260806110000_allow_exam_type_month_slots.sql');

    expect(migration).toContain("v_exam_month::text || ':' || v_round.exam_type");
    expect(migration).toContain('and registration.exam_month = v_exam_month');
    expect(migration).toContain('and registration.exam_type = v_round.exam_type');
    expect(migration).toContain("status in ('applied', 'confirmed', 'completed', 'no_show')");
    expect(migration).toContain('security invoker');
    expect(migration).toContain('revoke all on function public.submit_exam_registration_with_payment_proof_v3');
  });
});
