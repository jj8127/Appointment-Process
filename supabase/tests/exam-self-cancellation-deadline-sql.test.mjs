// Real SQL in an isolated in-memory PostgreSQL engine: no credentials or network.
// PGlite serializes one connection; this suite verifies atomic state/ACL behavior,
// not multi-connection lock contention on a production database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261008060419_exam_self_cancellation_deadline.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const schemaStart = schema.indexOf('-- FC self-cancellation is allowed through');
const schemaPolicy = schema.slice(schemaStart, schema.indexOf('create or replace function public.detach_exam_registration_identity_for_account_deletion(', schemaStart));
const registrationId = '10000000-0000-4000-8000-000000000001';
const roundId = '20000000-0000-4000-8000-000000000001';
const fcId = '30000000-0000-4000-8000-000000000001';
const otherFcId = '30000000-0000-4000-8000-000000000002';
const adminId = '40000000-0000-4000-8000-000000000001';
const developerId = '40000000-0000-4000-8000-000000000002';
const proofPath = 'synthetic-fixture/proof.png';

async function fixture(source = migration) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.exam_rounds (id uuid primary key, exam_type text, registration_deadline date);
    create table public.admin_accounts (id uuid primary key, active boolean, staff_type text);
    create table public.exam_registrations (
      id uuid primary key, round_id uuid, fc_id uuid, resident_id text,
      status text not null check (status in ('applied','confirmed','rejected','completed','no_show','cancelled_by_fc','cancelled_by_admin')),
      is_confirmed boolean not null, payment_proof_attached boolean not null,
      payment_proof_policy_version smallint not null default 1,
      rejection_reason text, rejected_at timestamptz, rejected_by_admin_id uuid, rejected_by_staff_type text,
      check (payment_proof_policy_version = 0 or payment_proof_attached or status in ('cancelled_by_fc','cancelled_by_admin'))
    );
    create table public.exam_payment_proof_uploads (
      id uuid primary key default gen_random_uuid(), registration_id uuid references exam_registrations(id),
      storage_path text, status text not null check (status in ('pending','attached','replaced','discarded'))
    );
    create table public.notifications (
      id uuid primary key default gen_random_uuid(), fc_id uuid, resident_id text, recipient_role text,
      recipient_actor_id uuid, title text, body text, category text, target jsonb, target_url text
    );
  `);
  const confirmationConstraint = schema.match(/alter table public\.exam_registrations\s+add constraint exam_registrations_confirmation_status_check\s+check\s*\([\s\S]*?\);/)?.[0];
  assert.ok(confirmationConstraint, 'fixture must enforce the canonical confirmation/status invariant');
  await db.exec(confirmationConstraint);
  // Use the canonical append-only event table/trigger rather than faking history behavior.
  const eventStart = schema.indexOf('create table if not exists public.exam_registration_decision_events (');
  await db.exec(schema.slice(eventStart, schema.indexOf('create or replace function public.prevent_exam_history_drift()', eventStart)));
  await db.exec(`
    alter table public.exam_registrations enable row level security;
    alter table public.exam_payment_proof_uploads enable row level security;
    grant usage on schema public to anon, authenticated, service_role;
    grant select on all tables in schema public to anon, authenticated;
    grant select, insert, update, delete on exam_rounds, admin_accounts, exam_registrations, exam_payment_proof_uploads, notifications to service_role;
  `);
  await db.exec(source);
  await db.query(`insert into exam_rounds values ($1,'life',(clock_timestamp() at time zone 'Asia/Seoul')::date-1)`, [roundId]);
  await db.query(`insert into admin_accounts values ($1,true,'admin'),($2,true,'developer')`, [adminId, developerId]);
  await db.query(`insert into exam_registrations (id,round_id,fc_id,resident_id,status,is_confirmed,payment_proof_attached)
    values ($1,$2,$3,'synthetic-fixture','applied',false,true)`, [registrationId, roundId, fcId]);
  await db.query(`insert into exam_payment_proof_uploads (registration_id,storage_path,status) values ($1,$2,'attached')`, [registrationId, proofPath]);
  await db.exec('set role service_role');
  async function rpc(options = {}) {
    return db.query('select * from public.transition_exam_registration($1,$2,$3,$4,$5,$6)', [
      options.registrationId ?? registrationId,
      options.action ?? 'cancel_by_fc',
      options.actorType === undefined ? 'fc' : options.actorType,
      options.adminId ?? null,
      options.fcId === undefined ? fcId : options.fcId,
      options.reason ?? null,
    ]);
  }
  async function snapshot() {
    const result = await db.query(`select
      (select jsonb_agg(to_jsonb(r)) from exam_registrations r) registrations,
      (select jsonb_agg(to_jsonb(p)) from exam_payment_proof_uploads p) proofs,
      (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from exam_registration_decision_events e) decisions,
      (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from notifications n) notifications`);
    return result.rows[0];
  }
  return { db, rpc, snapshot };
}

test('deadline includes the whole Seoul day and closes at the next midnight regardless of session zone', async () => {
  const f = await fixture();
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Seoul']) {
      await f.db.query("select set_config('TimeZone',$1,false)", [zone]);
      for (const [timestamp, expected] of [
        ['2026-09-26T15:00:00Z', false], // Seoul deadline 00:00
        ['2026-09-27T14:59:59.999999Z', false], // Seoul deadline 23:59:59.999999
        ['2026-09-27T15:00:00Z', true], // Seoul next day 00:00
      ]) {
        const result = await f.db.query("select public.exam_self_cancellation_deadline_passed('2026-09-27',$1) passed", [timestamp]);
        assert.equal(result.rows[0].passed, expected, `${zone}: ${timestamp}`);
      }
    }
    for (const deadline of [null, 'infinity', '-infinity']) {
      const result = await f.db.query('select public.exam_self_cancellation_deadline_passed($1,clock_timestamp()) passed', [deadline]);
      assert.equal(result.rows[0].passed, true);
    }
    assert.equal((await f.db.query("select public.exam_self_cancellation_deadline_passed('2026-09-27',null) passed")).rows[0].passed, true);
  } finally { await f.db.close(); }
});

test('past-deadline applied cancellation fails atomically before proof, row, history or notification mutation', async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    await assert.rejects(f.rpc(), { code: 'P0001', message: 'exam_cancellation_deadline_passed' });
    assert.deepEqual(await f.snapshot(), before);
  } finally { await f.db.close(); }
});

test('deadline-day FC cancellation succeeds once and retains proof cleanup/history contract', async () => {
  const f = await fixture();
  try {
    await f.db.exec("update exam_rounds set registration_deadline=(clock_timestamp() at time zone 'Asia/Seoul')::date");
    const result = (await f.rpc()).rows[0];
    assert.equal(result.status, 'cancelled_by_fc');
    assert.equal(result.proof_path, proofPath);
    assert.equal(result.notification_id, null);
    const after = await f.snapshot();
    assert.equal(after.registrations[0].payment_proof_attached, false);
    assert.equal(after.proofs[0].status, 'discarded');
    assert.equal(after.decisions.length, 1);
    assert.equal(after.decisions[0].action, 'cancelled_by_fc');
    assert.equal(after.decisions[0].actor_fc_id_snapshot, fcId);
    await assert.rejects(f.rpc(), { code: '55000', message: 'invalid_exam_transition' });
    assert.deepEqual(await f.snapshot(), after, 'retry must not append history or discard another proof');
  } finally { await f.db.close(); }
});

test('admin and developer can cancel past-deadline applied/confirmed rows with existing notifications', async () => {
  for (const [actorType, actorId, status] of [['admin', adminId, 'applied'], ['developer', developerId, 'confirmed']]) {
    const f = await fixture();
    try {
      await f.db.query('update exam_registrations set status=$1,is_confirmed=$2', [status, status === 'confirmed']);
      const result = (await f.rpc({ action: 'cancel_by_admin', actorType, adminId: actorId, fcId: null })).rows[0];
      assert.equal(result.status, 'cancelled_by_admin');
      assert.equal(result.proof_path, proofPath);
      assert.ok(result.notification_id);
      const after = await f.snapshot();
      assert.equal(after.proofs[0].status, 'discarded');
      assert.equal(after.decisions[0].action, 'cancelled_by_admin');
      assert.equal(after.decisions[0].actor_admin_id_snapshot, actorId);
      assert.equal(after.notifications[0].recipient_actor_id, fcId);
    } finally { await f.db.close(); }
  }
});

test('admin unconfirmation after deadline does not reopen FC cancellation; admin can still cancel exactly once', async () => {
  const f = await fixture();
  try {
    await f.db.exec("update exam_rounds set registration_deadline=(clock_timestamp() at time zone 'Asia/Seoul')::date+1");
    const admin = { actorType: 'admin', adminId, fcId: null };
    assert.equal((await f.rpc({ ...admin, action: 'confirm' })).rows[0].status, 'confirmed');
    const confirmed = await f.snapshot();
    assert.equal(confirmed.registrations[0].is_confirmed, true);
    assert.equal(confirmed.proofs[0].status, 'attached');
    assert.equal(confirmed.decisions.length, 1);
    assert.equal(confirmed.decisions[0].action, 'confirmed');

    await f.db.exec("update exam_rounds set registration_deadline=(clock_timestamp() at time zone 'Asia/Seoul')::date-1");
    assert.equal((await f.rpc({ ...admin, action: 'unconfirm' })).rows[0].status, 'applied');
    const unconfirmed = await f.snapshot();
    assert.equal(unconfirmed.registrations[0].is_confirmed, false);
    assert.equal(unconfirmed.registrations[0].payment_proof_attached, true);
    assert.deepEqual(unconfirmed.proofs, confirmed.proofs, 'unconfirmation must retain the attached proof');
    assert.deepEqual(unconfirmed.decisions.map(event => event.action), ['confirmed', 'unconfirmed']);
    assert.equal(unconfirmed.notifications.length, 2);

    await assert.rejects(f.rpc(), { code: 'P0001', message: 'exam_cancellation_deadline_passed' });
    assert.deepEqual(await f.snapshot(), unconfirmed, 'blocked FC attempt must preserve every row and event');

    const result = (await f.rpc({ ...admin, action: 'cancel_by_admin' })).rows[0];
    assert.equal(result.status, 'cancelled_by_admin');
    assert.equal(result.proof_path, proofPath);
    assert.ok(result.notification_id);
    const cancelled = await f.snapshot();
    assert.equal(cancelled.registrations[0].payment_proof_attached, false);
    assert.equal(cancelled.proofs[0].status, 'discarded');
    assert.deepEqual(cancelled.decisions.map(event => event.action), ['confirmed', 'unconfirmed', 'cancelled_by_admin']);
    assert.equal(cancelled.decisions[2].from_status, 'applied');
    assert.equal(cancelled.decisions[2].actor_admin_id_snapshot, adminId);
    assert.equal(cancelled.notifications.length, 3);
    await assert.rejects(f.rpc({ ...admin, action: 'cancel_by_admin' }), { code: '55000', message: 'invalid_exam_transition' });
    assert.deepEqual(await f.snapshot(), cancelled, 'retry must not append another decision or notification');
  } finally { await f.db.close(); }
});

test('canonical constraint disallows applied plus is_confirmed=true even for legacy proof policy rows', async () => {
  const f = await fixture();
  try {
    for (const policyVersion of [0, 1]) {
      await f.db.query('update exam_registrations set payment_proof_policy_version=$1', [policyVersion]);
      const before = await f.snapshot();
      await assert.rejects(f.db.exec('update exam_registrations set is_confirmed=true'), {
        code: '23514', constraint: 'exam_registrations_confirmation_status_check',
      });
      assert.deepEqual(await f.snapshot(), before);
      await assert.rejects(f.rpc(), { code: 'P0001', message: 'exam_cancellation_deadline_passed' });
      assert.deepEqual(await f.snapshot(), before);
    }
  } finally { await f.db.close(); }
});

test('FC ownership and actor checks precede the deadline error and leave all state untouched', async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    for (const options of [{ fcId: otherFcId }, { fcId: null }, { actorType: 'admin' }, { actorType: null }]) {
      await assert.rejects(f.rpc(options), { code: '42501', message: 'exam_transition_forbidden' });
      assert.deepEqual(await f.snapshot(), before);
    }
    await f.db.exec('update exam_registrations set fc_id=null');
    const detached = await f.snapshot();
    await assert.rejects(f.rpc(), { code: '42501', message: 'exam_transition_forbidden' });
    assert.deepEqual(await f.snapshot(), detached);
  } finally { await f.db.close(); }
});

test('confirmed and terminal guards remain effective even before deadline', async () => {
  const f = await fixture();
  try {
    await f.db.exec("update exam_rounds set registration_deadline=(clock_timestamp() at time zone 'Asia/Seoul')::date+1");
    for (const status of ['confirmed', 'completed', 'no_show']) {
      await f.db.query('update exam_registrations set status=$1,is_confirmed=true', [status]);
      const before = await f.snapshot();
      await assert.rejects(f.rpc(), {
        code: '55000', message: status === 'confirmed' ? 'invalid_exam_transition' : 'terminal_exam_registration',
      });
      assert.deepEqual(await f.snapshot(), before);
    }
  } finally { await f.db.close(); }
});

test('missing or invalid deadline and missing round fail closed for FC only', async () => {
  const f = await fixture();
  try {
    // Null/missing-round fixtures intentionally omit current NOT NULL/FK guards
    // to cover legacy or corrupted data without touching a real database.
    for (const deadline of [null, 'infinity', '-infinity']) {
      await f.db.query('update exam_rounds set registration_deadline=$1', [deadline]);
      const before = await f.snapshot();
      await assert.rejects(f.rpc(), { code: 'P0001', message: 'exam_cancellation_deadline_passed' });
      assert.deepEqual(await f.snapshot(), before);
    }
    await f.db.exec('delete from exam_rounds');
    const before = await f.snapshot();
    await assert.rejects(f.rpc(), { code: 'P0001', message: 'exam_cancellation_deadline_passed' });
    assert.deepEqual(await f.snapshot(), before);
    assert.equal((await f.rpc({ action: 'cancel_by_admin', actorType: 'admin', adminId, fcId: null })).rows[0].status, 'cancelled_by_admin');
  } finally { await f.db.close(); }
});

test('mutation/helper are service-role-only invokers, table writes remain closed to client roles', async () => {
  const f = await fixture();
  try {
    await f.db.exec('reset role');
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`set role ${role}`);
      await assert.rejects(f.rpc(), /permission denied for function transition_exam_registration/);
      await assert.rejects(f.db.query('select public.exam_self_cancellation_deadline_passed(null,now())'), /permission denied for function/);
      await assert.rejects(f.db.exec("update exam_registrations set status='cancelled_by_fc'"), /permission denied for table/);
      await assert.rejects(f.db.exec("update exam_payment_proof_uploads set status='discarded'"), /permission denied for table/);
      await f.db.exec('reset role');
    }
    const metadata = await f.db.query(`select proname, prosecdef from pg_proc where proname in
      ('transition_exam_registration','exam_self_cancellation_deadline_passed') order by proname`);
    assert.equal(metadata.rows.length, 2);
    assert.ok(metadata.rows.every(row => row.prosecdef === false));
    await f.db.exec('set role service_role');
    await assert.rejects(f.rpc({ action: 'cancel_by_admin', actorType: 'admin', adminId: otherFcId, fcId: null }), { code: '42501' });
    await f.db.exec('reset role');
    await f.db.exec(migration); // Repeatable replacement must not mutate pending registrations.
    assert.equal((await f.snapshot()).registrations[0].status, 'applied');
  } finally { await f.db.close(); }
});

test('canonical snapshot compiles to the same RPC/helper definitions and ACL as migration', async () => {
  const migrated = await fixture();
  const canonical = await fixture(schemaPolicy);
  try {
    const definitions = `select proname, pg_get_functiondef(oid) definition, proacl::text acl from pg_proc
      where proname in ('transition_exam_registration','exam_self_cancellation_deadline_passed') order by proname`;
    await migrated.db.exec('reset role'); await canonical.db.exec('reset role');
    const normalize = rows => rows.map(row => ({ ...row, definition: row.definition.replaceAll('\r\n', '\n') }));
    assert.deepEqual(normalize((await canonical.db.query(definitions)).rows), normalize((await migrated.db.query(definitions)).rows));
    await canonical.db.exec('set role service_role');
    await assert.rejects(canonical.rpc(), { code: 'P0001', message: 'exam_cancellation_deadline_passed' });
  } finally { await migrated.db.close(); await canonical.db.close(); }
});
