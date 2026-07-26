import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), 'utf8');

const migrationName =
  '20260724131931_exam_bundle_monthly_slot_and_decisions.sql';
const typedNotificationMigrationName =
  '20260725004017_add_typed_notification_targets_and_receipts.sql';

const canonicalFunction = (source: string, functionName: string) => {
  const marker = `create or replace function public.${functionName}(`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const end = source.indexOf('\n$$;', start);
  if (end < 0) return '';
  return source.slice(start, end + 4).replace(/\s+/g, ' ').trim();
};

describe('exam bundle database contract', () => {
  const migration = read(`supabase/migrations/${migrationName}`);
  const typedNotificationMigration = read(
    `supabase/migrations/${typedNotificationMigrationName}`,
  );
  const schema = read('supabase/schema.sql');

  it('adds exactly one forward migration for this increment', () => {
    const matching = readdirSync(path.join(root, 'supabase', 'migrations'))
      .filter((name) => name.includes('exam_bundle_monthly_slot_and_decisions'));
    expect(matching).toEqual([migrationName]);
  });

  it('repairs only deterministic legacy ownership and preserves legacy month collisions', () => {
    expect(migration).toContain('exam_bundle_preflight_missing_active_exam_month');
    expect(migration).toContain(
      'exam_bundle_preflight_active_fc_ownership_mismatch',
    );
    expect(migration).toContain('exam_bundle_preflight_confirmation_status_drift');
    expect(migration).toContain('exam_bundle_preflight_active_month_collision');
    expect(migration).toContain('registration.fc_id is null');
    expect(migration).toContain('profile.id = registration.fc_id');
    expect(migration).toContain('having count(*) = 1');
    expect(migration).toContain('set fc_id = candidate.profile_id');
    expect(migration).toContain('regexp_match(');
    expect(migration).toContain('make_date(');
    expect(migration).not.toMatch(
      /update\s+public\.exam_rounds[\s\S]*set\s+exam_date/i,
    );
    expect(migration).toContain('monthly_slot_policy_version = 0');
    expect(migration).toContain(
      'alter column monthly_slot_policy_version set default 1',
    );
    expect(migration).toContain('idx_exam_registrations_active_fc_exam_month');
    expect(migration).toContain(
      "where status in ('applied', 'confirmed', 'completed', 'no_show')",
    );
    expect(migration).toContain('and monthly_slot_policy_version = 1');
    expect(migration).not.toMatch(
      /delete\s+from\s+public\.exam_registrations[\s\S]*preflight/i,
    );
  });

  it('keeps v2 and legacy submits behind the same service-only monthly boundary', () => {
    for (const source of [migration, schema]) {
      expect(source).toContain(
        'submit_exam_registration_with_payment_proof_v2',
      );
      expect(source).toContain('pg_advisory_xact_lock');
      expect(source).toContain('p_includes_primary_exam');
      expect(source).toContain('exam_subject_required');
      expect(source).toContain('active_exam_month_already_registered');
      expect(source).toMatch(
        /where registration\.fc_id = p_fc_id[\s\S]*registration\.exam_month = v_exam_month[\s\S]*registration\.status in \('applied', 'confirmed', 'completed', 'no_show'\)/,
      );
      expect(source).not.toMatch(
        /where registration\.fc_id = p_fc_id[\s\S]{0,300}monthly_slot_policy_version/,
      );
      expect(source).toContain(
        'from public.submit_exam_registration_with_payment_proof_v2',
      );
      expect(source).toContain(
        ') from public, anon, authenticated;',
      );
      expect(source).toContain(') to service_role;');
    }

    expect(migration).toMatch(
      /submit_exam_registration_with_payment_proof_v2\(\s*p_fc_id,\s*p_resident_id,\s*p_round_id,\s*p_location_id,\s*true,\s*coalesce\(p_is_third_exam, false\)/,
    );
  });

  it('makes decisions append-only, preserves rejected proof, and discards cancelled proof', () => {
    for (const source of [migration, schema]) {
      expect(source).toContain('exam_registration_decision_events');
      expect(source).toContain('actor_admin_id_snapshot uuid');
      expect(source).toContain('actor_fc_id_snapshot uuid');
      expect(source).not.toMatch(
        /actor_(?:admin|fc)_id_snapshot\s+uuid\s+references/,
      );
      expect(source).toContain(
        'revoke update, delete, truncate on table public.exam_registration_decision_events',
      );
      expect(source).toContain('exam_decision_events_are_append_only');
      expect(source).toContain(
        'before update or delete or truncate on public.exam_registration_decision_events',
      );
      expect(source).toContain('transition_exam_registration');
      expect(source).toContain("v_registration.status in ('completed', 'no_show')");
      expect(source).toContain("when 'confirm' then 'confirmed'");
      expect(source).toContain("when 'unconfirm' then 'unconfirmed'");
      expect(source).toContain("when 'reject' then 'rejected'");
      expect(source).toContain("v_to_status := 'rejected'");
      expect(source).toContain("set status = 'discarded'");
      expect(source).toContain("p_action = 'reject' then v_reason");
      expect(source).toContain("'/exam-apply2'");
      expect(source).toContain("'/exam-apply'");
    }

    for (const source of [typedNotificationMigration, schema]) {
      expect(source).toMatch(/category,\s+target,\s+target_url/);
      expect(source).toMatch(
        /'kind',\s*'exam',\s*'examType',\s*v_exam_type,\s*'examRegistrationId',\s*v_registration\.id/,
      );
      expect(source).toContain("'examRegistrationId'");
      expect(source).toContain("'examRoundId'");
      expect(source).toContain(
        "array['examRegistrationId','examType','kind','version']",
      );
      expect(source).toContain(
        "array['examRoundId','examType','kind','version']",
      );
    }
  });

  it('locks the registration row before loading scalar round metadata', () => {
    for (const source of [migration, typedNotificationMigration, schema]) {
      const transitionSource = canonicalFunction(source, 'transition_exam_registration');
      expect(transitionSource).toContain('select registration.* into v_registration');
      expect(transitionSource).toContain('for update');
      expect(transitionSource).toContain(
        'select round_row.exam_type into v_exam_type',
      );
      expect(transitionSource).not.toContain(
        'into v_registration, v_exam_type',
      );
    }
  });

  it('enforces the transition matrix and rejects manager or actor spoofing in SQL', () => {
    for (const source of [migration, schema]) {
      const transitionSource = canonicalFunction(source, 'transition_exam_registration');
      expect(transitionSource).toContain("p_actor_type <> 'fc'");
      expect(transitionSource).toContain('p_actor_fc_id <> v_registration.fc_id');
      expect(transitionSource).toContain(
        "p_actor_type not in ('admin', 'developer')",
      );
      expect(transitionSource).toContain('admin_row.active = true');
      expect(transitionSource).toContain(
        "p_actor_type = 'developer' and admin_row.staff_type = 'developer'",
      );
      expect(transitionSource).toContain(
        "p_actor_type = 'admin' and coalesce(admin_row.staff_type, 'admin') = 'admin'",
      );
      expect(transitionSource).not.toContain("p_actor_type = 'manager'");
      expect(transitionSource).toContain("v_from_status <> 'applied'");
      expect(transitionSource).toContain("v_from_status <> 'confirmed'");
      expect(transitionSource).toContain(
        "v_from_status not in ('applied', 'confirmed')",
      );
      expect(transitionSource).toContain(
        "v_registration.status in ('completed', 'no_show')",
      );
    }
  });

  it('keeps confirmation and active-month row shapes internally consistent', () => {
    for (const source of [migration, schema]) {
      expect(source).toContain('exam_registrations_confirmation_status_check');
      expect(source).toContain('exam_registrations_active_month_shape_check');
      expect(source).toContain(
        "status in ('confirmed', 'completed', 'no_show')",
      );
      expect(source).toContain(
        "status not in ('applied', 'confirmed', 'completed', 'no_show')",
      );
      expect(source).toContain("or resident_id like 'deleted-exam:%'");
      expect(source).toContain(
        'detach_exam_registration_identity_for_account_deletion',
      );
      expect(source).toContain("'deleted-exam:' || registration.id::text");
      expect(source).toContain("'identity_detached'");
    }
  });

  it('removes direct anonymous exam writes and locks history-bearing schedule identity', () => {
    expect(migration).toContain(
      'revoke insert, update, delete on table public.exam_registrations',
    );
    expect(migration).toContain('exam_round_history_locked');
    expect(migration).toContain('exam_location_history_locked');
    expect(migration).toContain('on delete restrict');
  });
});

describe('exam bundle client and admin source contract', () => {
  const migration = read(`supabase/migrations/${migrationName}`);
  const schema = read('supabase/schema.sql');
  const lifeApply = read('app/exam-apply.tsx');
  const nonlifeApply = read('app/exam-apply2.tsx');
  const paymentEdge = read('supabase/functions/exam-payment-proof/index.ts');
  const adminEdge = read('supabase/functions/admin-action/index.ts');
  const mobileLifeAdmin = read('app/exam-manage.tsx');
  const mobileNonlifeAdmin = read('app/exam-manage2.tsx');
  const webRoute = read('web/src/app/api/admin/exam-applicants/route.ts');
  const webList = read('web/src/app/dashboard/exam/applicants/page.tsx');
  const webDetail = read('web/src/app/dashboard/exam/applicants/[id]/page.tsx');
  const mobileLifeRoundAdmin = read('app/exam-register.tsx');
  const mobileNonlifeRoundAdmin = read('app/exam-register2.tsx');
  const webNewRound = read('web/src/app/admin/exams/new/page.tsx');
  const deleteAccountEdge = read('supabase/functions/delete-account/index.ts');
  const webFcDelete = read('web/src/app/api/fc-delete/route.ts');

  it.each([
    ['life', lifeApply],
    ['nonlife', nonlifeApply],
  ])('%s history uses the explicit FK and does not hide the other primary type', (_type, source) => {
    expect(source).toContain(
      'exam_locations!exam_registrations_location_round_fkey(location_name)',
    );
    expect(source).not.toContain(".eq('exam_rounds.exam_type'");
    expect(source).toContain("queryKey: ['my-exam-apply-history', applicationResidentId]");
    expect(source).toContain('myAppliesError');
    expect(source).not.toContain("code === '42P01'");
    expect(source).toContain('다시 시도');
    expect(source).toContain('formatExamSubjectSelection');
  });

  it('allows nonlife primary and third to be independently selected', () => {
    expect(nonlifeApply).toContain('const [wantsNonlife, setWantsNonlife]');
    expect(nonlifeApply).toContain('includesPrimaryExam: wantsNonlife');
    expect(nonlifeApply).toContain('hasSelectedSubject: wantsNonlife || wantsThird');
    expect(nonlifeApply).toContain('손해보험 시험');
    expect(nonlifeApply).toContain('제3보험 시험');
  });

  it('uses service transitions instead of reachable registration table update/delete paths', () => {
    expect(paymentEdge).toContain(".rpc('transition_exam_registration'");
    expect(paymentEdge).not.toContain(
      ".from('exam_registrations')\n    .delete()",
    );
    expect(adminEdge).toContain(".rpc('transition_exam_registration'");
    expect(webRoute).toContain(
      "adminSupabase.rpc('transition_exam_registration'",
    );
    expect(webRoute).not.toContain(
      ".from('exam_registrations')\n      .update(",
    );
    expect(webRoute).not.toContain(
      ".from('exam_registrations')\n      .delete(",
    );
  });

  it('exposes rejection on both mobile admin pages and reuses the web reason modal', () => {
    for (const source of [mobileLifeAdmin, mobileNonlifeAdmin]) {
      expect(source).toContain("action: 'reject'");
      expect(source).toContain('maxLength={1000}');
      expect(source).toContain('!canEdit');
    }
    for (const source of [webList, webDetail]) {
      expect(source).toContain('RejectReasonModal');
      expect(source).toContain("action: 'reject'");
      expect(source).toContain('isReadOnly');
    }
  });

  it('routes every reachable round creation path through a verified service boundary', () => {
    for (const source of [mobileLifeRoundAdmin, mobileNonlifeRoundAdmin]) {
      expect(source).toContain("'upsertExamRound'");
      expect(source).not.toContain(".from('exam_locations').insert");
      expect(source).toContain("role === 'admin' && !readOnly");
    }
    expect(adminEdge).toContain(".rpc(\n        'save_exam_round_atomic'");
    expect(adminEdge).not.toContain(".from('exam_rounds')\n          .insert");

    expect(webNewRound).toContain('saveExamRoundAction');
    expect(webNewRound).not.toContain(".from('exam_rounds').insert");
    expect(webNewRound).not.toContain(".from('exam_locations').insert");
    expect(webNewRound).toContain("role !== 'admin'");
  });

  it('commits all database deletion work through one trusted transaction, then cleans storage', () => {
    for (const source of [deleteAccountEdge, webFcDelete]) {
      expect(source).toContain(
        "'delete_account_core_transaction_v1'",
      );
      expect(source).toContain("'exam-payment-proofs'");
      expect(source).toContain('.storage');
      expect(source).not.toMatch(
        /\.from\([^)]*\)[\s\S]{0,120}\.(?:delete|insert|update|upsert)\(/,
      );
      expect(source).not.toMatch(
        /\.from\('exam_registrations'\)[\s\S]{0,100}\.delete\(/,
      );
    }

    const adminDeleteBlock =
      adminEdge.split("if (action === 'deleteFc')")[1]
        ?.split("if (action === 'sendNotification')")[0] ?? '';
    expect(adminDeleteBlock).toContain(
      "'delete_account_core_transaction_v1'",
    );
    expect(adminDeleteBlock).toContain("'exam-payment-proofs'");
    expect(adminDeleteBlock).not.toMatch(
      /\.from\([^)]*\)[\s\S]{0,120}\.(?:delete|insert|update|upsert)\(/,
    );

    for (const source of [migration, schema]) {
      expect(source).toContain('delete_account_core_transaction_v1');
      expect(source).toContain('account_deletion_cleanup_outbox');
      expect(source).toContain(
        'record_account_deletion_cleanup_attempt_v1',
      );
      expect(source).toContain(
        'list_account_deletion_cleanup_pending_v1',
      );
      expect(source).toContain("status in ('pending', 'completed', 'exhausted')");
      expect(source).toContain('attempt_count between 0 and 10');
      expect(source).toContain(
        "auth.role() is distinct from 'service_role'",
      );
      expect(source).toContain(
        'limit least(greatest(coalesce(p_limit, 10), 1), 25)',
      );
      expect(source).toContain('account_delete_exam_ownership_mismatch');
      expect(source).toContain(
        'detach_exam_registration_identity_for_account_deletion(v_fc_id)',
      );
      expect(source).toContain('delete from public.referral_events');
      expect(source).toContain('delete from public.referral_attributions');
      expect(source).toContain("'proof_paths', to_jsonb(v_proof_paths)");
      expect(source).toContain(
        "'board_attachment_paths', to_jsonb(v_board_paths)",
      );
      expect(source).toContain("'cleanup_outbox_id', v_cleanup_outbox_id");
      expect(source).toContain("'identity_detached'");
    }

    for (const source of [deleteAccountEdge, webFcDelete, adminEdge]) {
      expect(source).toContain(
        "'record_account_deletion_cleanup_attempt_v1'",
      );
      expect(source).toContain(
        "'post_commit_cleanup_partial_failure'",
      );
    }
  });

  it('keeps canonical account deletion and cleanup functions identical in migration and schema', () => {
    for (const functionName of [
      'detach_exam_registration_identity_for_account_deletion',
      'record_account_deletion_cleanup_attempt_v1',
      'list_account_deletion_cleanup_pending_v1',
      'delete_account_core_transaction_v1',
    ]) {
      const migrationFunction = canonicalFunction(migration, functionName);
      const schemaFunction = canonicalFunction(schema, functionName);
      expect(migrationFunction).not.toBe('');
      expect(schemaFunction).toBe(migrationFunction);
    }
  });
});
