import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const migrationName = '20260804081357_exam_round_month_for_tbd.sql';
const parityStart = `-- BEGIN ${migrationName.replace('.sql', '')} canonical parity block`;
const parityEnd = `-- END ${migrationName.replace('.sql', '')} canonical parity block`;
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const canonicalFunction = (source: string, functionName: string) => {
  const marker = `create or replace function public.${functionName}(`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const end = source.indexOf('\n$$;', start);
  if (end < 0) return '';
  return source.slice(start, end + 4);
};

const finalCanonicalFunction = (source: string, functionName: string) => {
  const marker = `create or replace function public.${functionName}(`;
  const start = source.lastIndexOf(marker);
  if (start < 0) return '';
  const end = source.indexOf('\n$$;', start);
  if (end < 0) return '';
  return source.slice(start, end + 4);
};

describe('date-TBD exam month database contract', () => {
  const migration = read(`supabase/migrations/${migrationName}`);
  const schema = read('supabase/schema.sql');
  const adminAction = read('supabase/functions/admin-action/index.ts');
  const parityBlock = schema
    .slice(schema.indexOf(parityStart) + parityStart.length, schema.indexOf(parityEnd))
    .trim();

  it('uses exactly one new forward migration and keeps the schema final block identical', () => {
    const matching = readdirSync(path.join(root, 'supabase', 'migrations'))
      .filter((name) => name.endsWith('_exam_round_month_for_tbd.sql'));

    expect(matching).toEqual([migrationName]);
    expect(schema.indexOf(parityStart)).toBeGreaterThanOrEqual(0);
    expect(schema.indexOf(parityEnd)).toBeGreaterThan(schema.indexOf(parityStart));
    expect(parityBlock).toBe(migration.trim());
  });

  it('backfills a canonical round month without guessing referenced history', () => {
    expect(migration).toContain('add column if not exists exam_month date');
    expect(migration).toContain("date_trunc('month', exam_date)::date");
    expect(migration).toContain('count(distinct registration.exam_month)');
    expect(migration).toContain('resolved.distinct_exam_month_count = 1');
    expect(migration).toMatch(
      /round_row\.exam_date is null[\s\S]*round_row\.exam_month is null[\s\S]*not exists \([\s\S]*from public\.exam_registrations registration/,
    );
    expect(migration).toContain(
      "'^(?:([0-9]{2}|[0-9]{4})년[[:space:]]*)?([0-9]{1,2})월(?:[[:space:]]|$)'",
    );
    expect(migration).toContain(
      'exam_month_number < extract(month from registration_deadline)::integer',
    );
    expect(migration).toContain('then make_date(base_year + 1, exam_month_number, 1)');
    expect(migration).toContain('exam_round_month_backfill_unresolved');
    expect(migration).toContain('exam_round_month_active_registration_drift');
  });

  it('enforces month-start and exact-date consistency on every round', () => {
    expect(migration).toContain('alter column exam_month set not null');
    expect(migration).toContain('exam_rounds_exam_month_start_check');
    expect(migration).toContain(
      "check (exam_month = date_trunc('month', exam_month)::date)",
    );
    expect(migration).toContain('exam_rounds_exam_date_month_check');
    expect(migration).toMatch(
      /exam_date is null\s+or exam_month = date_trunc\('month', exam_date\)::date/,
    );
  });

  it('snapshots round type and enforces one active bundle per insurance type', () => {
    expect(migration).toContain('add column if not exists exam_type text');
    expect(migration).toMatch(
      /update public\.exam_registrations registration\s+set exam_type = round_row\.exam_type\s+from public\.exam_rounds round_row\s+where round_row\.id = registration\.round_id\s+and registration\.exam_type is null/,
    );
    expect(migration).toContain('exam_registration_type_backfill_unresolved');
    expect(migration).toContain('exam_registration_round_type_drift');
    expect(migration).toContain('exam_registration_type_active_collision');
    expect(migration).toMatch(
      /where registration\.fc_id is not null\s+and registration\.status in \('applied', 'confirmed', 'completed', 'no_show'\)/,
    );
    expect(migration).toContain('alter column exam_type set not null');
    expect(migration).toContain('exam_registrations_exam_type_check');
    expect(migration).toContain("check (exam_type in ('life', 'nonlife'))");
    expect(migration).toMatch(
      /create unique index if not exists idx_exam_rounds_id_exam_type\s+on public\.exam_rounds \(id, exam_type\)/,
    );
    expect(migration).toMatch(
      /foreign key \(round_id, exam_type\)\s+references public\.exam_rounds \(id, exam_type\)\s+on delete restrict/,
    );

    const typeIndex = migration.match(
      /create unique index idx_exam_registrations_active_fc_exam_month_type[\s\S]*?;/,
    )?.[0];
    expect(typeIndex).toContain('(fc_id, exam_month, exam_type)');
    expect(typeIndex).toContain(
      "where status in ('applied', 'confirmed', 'completed', 'no_show')",
    );
    expect(typeIndex).toContain('monthly_slot_policy_version = 1');
    expect(typeIndex).not.toContain('is_third_exam');

    expect(migration).toContain(
      'drop index if exists public.idx_exam_registrations_active_fc_exam_month;',
    );
    expect(migration).not.toMatch(
      /create unique index idx_exam_registrations_active_fc_exam_month\s/,
    );
    expect(migration).not.toContain(
      'idx_exam_registrations_active_fc_exam_month_third',
    );
    expect(migration).not.toContain('exam_registration_third_active_collision');
  });

  it('adds an explicit service-only save v2 and keeps the legacy signature compatible', () => {
    const saveV2 = canonicalFunction(migration, 'save_exam_round_atomic_v2');
    const legacySave = canonicalFunction(migration, 'save_exam_round_atomic');

    expect(saveV2).toContain('p_exam_month date');
    expect(saveV2).toContain('security invoker');
    expect(saveV2).toContain("auth.role() is distinct from 'service_role'");
    expect(saveV2).toContain('invalid exam month');
    expect(saveV2).toContain('exam date and month mismatch');
    expect(saveV2).toMatch(/insert into public\.exam_rounds \([\s\S]*exam_month/);
    expect(saveV2).toMatch(/update public\.exam_rounds[\s\S]*exam_month = p_exam_month/);
    expect(saveV2).toContain('delete from public.exam_locations');

    expect(legacySave).toContain("date_trunc('month', p_exam_date)::date");
    expect(legacySave).toContain('security invoker');
    expect(legacySave).toMatch(
      /if p_round_id is not null then[\s\S]*select round_row\.exam_date,[\s\S]*round_row\.exam_month/,
    );
    expect(legacySave).toMatch(
      /v_existing_exam_date is null\s+and p_exam_date is not null[\s\S]*exam_month_required_for_tbd_round/,
    );
    expect(legacySave).toContain('exam_month_required_for_tbd_round');
    expect(legacySave).toContain('public.save_exam_round_atomic_v2(');

    for (const signature of [
      'public.save_exam_round_atomic_v2(',
      'public.save_exam_round_atomic(',
    ]) {
      expect(migration).toContain(`revoke all on function ${signature}`);
    }
    expect(migration).toMatch(
      /grant execute on function public\.save_exam_round_atomic_v2\([\s\S]*\) to service_role;/,
    );
  });

  it('makes admin-action the explicit-month v2 boundary and fails closed for legacy TBD edits', () => {
    const actionStart = adminAction.indexOf("if (action === 'upsertExamRound')");
    const actionEnd = adminAction.indexOf("if (action === 'deleteExamRound')", actionStart);
    const action = adminAction.slice(actionStart, actionEnd);

    expect(action).toContain('exam_month?: string | null');
    expect(action).toContain("Object.prototype.hasOwnProperty.call(data, 'exam_month')");
    expect(adminAction).toContain("/^\\d{4}-\\d{2}-01$/");
    expect(action).toContain('isCanonicalMonthStart(explicitExamMonth)');
    expect(action).toContain('exam date and month mismatch');
    expect(action).toContain(".select('exam_date,exam_month')");
    expect(action).toContain('existingRound.exam_date === null');
    expect(action).toContain('exam_month_required_for_tbd_round');
    expect(action).toContain("'save_exam_round_atomic_v2'");
    expect(action).toContain('p_exam_month: examMonth');
    expect(action).not.toContain("'save_exam_round_atomic',");
  });

  it('scopes v2 and v3 by round type for every subject bundle', () => {
    for (const functionName of [
      'submit_exam_registration_with_payment_proof_v2',
      'submit_exam_registration_with_payment_proof_v3',
    ]) {
      const submit = canonicalFunction(migration, functionName);
      expect(submit).toContain('v_round.exam_month is null');
      expect(submit).not.toContain('v_round.exam_date is null');
      expect(submit).toContain('v_exam_month := v_round.exam_month');
      expect(submit).toContain('pg_advisory_xact_lock');
      expect(submit).toContain(
        "hashtextextended(p_fc_id::text || ':' || v_exam_month::text, 0)",
      );
      expect(submit).toContain('registration.exam_month = v_exam_month');
      expect(submit).toContain('registration.exam_type = v_round.exam_type');
      expect(submit).toContain('active_exam_month_already_registered');
      expect(submit).toContain('exam_payment_proof_uploads');
      expect(submit).toContain('exam_registration_decision_events');
      expect(submit).toMatch(
        /insert into public\.exam_registrations \([\s\S]*exam_type[\s\S]*\) values \([\s\S]*v_round\.exam_type/,
      );
      expect(submit).not.toContain('third_registration');
    }

    const submitV3 = canonicalFunction(
      migration,
      'submit_exam_registration_with_payment_proof_v3',
    );
    expect(submitV3).toContain('p_actor_manager_id');
    expect(submitV3).toContain('target_fc_id_snapshot');
    expect(submitV3).toContain(
      'fee_paid_date = coalesce(v_registration.fee_paid_date, p_fee_paid_date)',
    );
  });

  it('keeps the effective final schema v3 identical to the migration v3', () => {
    const marker =
      'create or replace function public.submit_exam_registration_with_payment_proof_v3(';
    const migrationV3 = canonicalFunction(
      migration,
      'submit_exam_registration_with_payment_proof_v3',
    );
    const finalSchemaV3 = finalCanonicalFunction(
      schema,
      'submit_exam_registration_with_payment_proof_v3',
    );

    expect(schema.lastIndexOf(marker)).toBeGreaterThan(schema.indexOf(parityEnd));
    expect(finalSchemaV3).toBe(migrationV3);
    expect(finalSchemaV3).toContain('v_round.exam_month is null');
    expect(finalSchemaV3).not.toContain('v_round.exam_date is null');
    expect(finalSchemaV3).toContain('v_exam_month := v_round.exam_month');
    expect(finalSchemaV3).toContain('registration.exam_type = v_round.exam_type');
    expect(finalSchemaV3).not.toContain('third_registration');
  });

  it('locks canonical history but permits TBD to become exact within the same month', () => {
    const guard = canonicalFunction(migration, 'prevent_exam_history_drift');

    expect(guard).toContain('new.exam_month is distinct from old.exam_month');
    expect(guard).toContain('new.exam_type is distinct from old.exam_type');
    expect(guard).toMatch(
      /old\.exam_date is null\s+and new\.exam_date is not null\s+and date_trunc\('month', new\.exam_date\)::date = old\.exam_month/,
    );
    expect(guard).toContain("message = 'exam_round_history_locked'");
    expect(guard).toContain("message = 'exam_location_history_locked'");
  });

  it('revokes every replaced callable from public clients', () => {
    for (const functionName of [
      'save_exam_round_atomic_v2',
      'save_exam_round_atomic',
      'prevent_exam_history_drift',
      'submit_exam_registration_with_payment_proof_v2',
      'submit_exam_registration_with_payment_proof_v3',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\([\\s\\S]*?\\) from public, anon, authenticated;`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}\\([\\s\\S]*?\\) to service_role;`,
        ),
      );
    }
  });
});
