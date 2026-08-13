import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('staff proxy exam application contract', () => {
  const edge = read('supabase/functions/exam-payment-proof/index.ts');
  const migration = read(
    'supabase/migrations/20260725091500_add_staff_proxy_exam_applications.sql',
  );
  const schema = read('supabase/schema.sql');
  const api = read('lib/exam-payment-proof-api.ts');

  it('authorizes active manager, general-affairs, and developer actors from the signed session', () => {
    expect(edge).toContain("session.role === 'manager'");
    expect(edge).toContain(".from('manager_accounts')");
    expect(edge).toContain(".from('admin_accounts')");
    expect(edge).toContain("session.staffType === 'developer' ? 'developer' : 'admin'");
    expect(edge).toContain("body.action === 'list_targets'");
  });

  it('binds proof preparation and submission to the selected FC', () => {
    expect(edge).toContain('.eq(\'fc_id\', target.fcId)');
    expect(edge).toContain('p_fc_id: target.fcId');
    expect(edge).toContain('p_resident_id: target.residentId');
    expect(api).toContain("action: 'submit_v3'");
    expect(api).toContain('targetFcId: targetFcId ?? null');
  });

  it('lists and accepts only completed pure FC proxy targets', () => {
    expect(edge).toContain('isLinkedDesignerAffiliation');
    expect(edge).toContain("startsWith('request_board_designer:')");
    expect(edge).toContain("includes('설계매니저')");
    expect(edge).toContain('loadActiveNonFcPhones');
    expect(edge).toContain("|| excludedResult.phones.has(residentId)");

    for (const source of [migration, schema]) {
      expect(source).toContain("p_actor_type = 'fc'");
      expect(source).toContain(
        "coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'",
      );
      expect(source).toContain(
        "replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'",
      );
      expect(source).toContain('from public.manager_accounts manager_target');
      expect(source).toContain('from public.admin_accounts staff_target');
    }
  });

  it('keeps legacy dates but makes v3 date-free and target-month scoped', () => {
    for (const source of [migration, schema]) {
      expect(source).toContain('submit_exam_registration_with_payment_proof_v3');
      expect(source).toContain(
        'if p_fee_paid_date is not null and p_fee_paid_date > current_date',
      );
      expect(source).toContain(
        'fee_paid_date = coalesce(v_registration.fee_paid_date, p_fee_paid_date)',
      );
      expect(source).toContain(
        "where registration.fc_id = p_fc_id",
      );
      expect(source).toContain(
        "registration.status in ('applied', 'confirmed', 'completed', 'no_show')",
      );
    }
  });

  it('records the real actor and target FC in the append-only decision history', () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("actor_type in ('fc', 'manager', 'admin', 'developer', 'service')");
      expect(source).toContain('actor_manager_id_snapshot');
      expect(source).toContain('target_fc_id_snapshot');
      expect(source).toContain('p_actor_manager_id');
    }
  });

  it.each(['app/exam-apply.tsx', 'app/exam-apply2.tsx'])(
    '%s exposes target selection and no payment-date picker',
    (path) => {
      const source = read(path);
      expect(source).toContain('<ExamApplicationTargetSelector');
      expect(source).toContain('listExamApplicationTargets');
      expect(source).toContain('applicationTargetFcId');
      expect(source).not.toContain('DateTimePicker');
      expect(source).not.toContain('setFeePaidDate');
    },
  );
});
