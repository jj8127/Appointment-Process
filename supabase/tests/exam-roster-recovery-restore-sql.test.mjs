// Real SQL in an isolated in-memory PostgreSQL engine: no credentials or network.
// Reproduces the 2026-10-14 roster delete/restore with the canonical detach
// function, then verifies the one-time restore migration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261020120000_restore_exam_registrations_cancelled_by_roster_recovery.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');

function slice(startMarker, endMarker) {
  const start = schema.indexOf(startMarker);
  assert.ok(start >= 0, `schema marker missing: ${startMarker}`);
  const end = schema.indexOf(endMarker, start);
  assert.ok(end > start, `schema marker missing: ${endMarker}`);
  return schema.slice(start, end);
}

const fcA = '30000000-0000-4000-8000-00000000000a';
const fcB = '30000000-0000-4000-8000-00000000000b';
const fcC = '30000000-0000-4000-8000-00000000000c';
const pastRound = '20000000-0000-4000-8000-000000000001';
const upcomingRound = '20000000-0000-4000-8000-000000000002';
const reg = {
  aUpcoming: '10000000-0000-4000-8000-000000000001',
  aPastConfirmed: '10000000-0000-4000-8000-000000000002',
  aRejected: '10000000-0000-4000-8000-000000000003',
  bUpcoming: '10000000-0000-4000-8000-000000000004',
  bReapplied: '10000000-0000-4000-8000-000000000005',
  cDeleted: '10000000-0000-4000-8000-000000000006',
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.fc_profiles (id uuid primary key);
    create table public.exam_rounds (id uuid primary key, exam_type text, exam_date date, exam_month date);
    create table public.exam_registrations (
      id uuid primary key, round_id uuid references exam_rounds(id), fc_id uuid, resident_id text,
      exam_month date, exam_type text,
      status text not null check (status in ('applied','confirmed','completed','no_show','rejected','cancelled_by_fc','cancelled_by_admin')),
      is_confirmed boolean not null default false, payment_proof_attached boolean not null default true,
      payment_proof_policy_version smallint not null default 1,
      monthly_slot_policy_version smallint not null default 1,
      rejection_reason text, rejected_at timestamptz, rejected_by_admin_id uuid, rejected_by_staff_type text,
      created_at timestamptz not null default now()
    );
    create table public.exam_payment_proof_uploads (
      id uuid primary key default gen_random_uuid(), fc_id uuid, registration_id uuid references exam_registrations(id),
      storage_path text, status text not null check (status in ('pending','attached','replaced','discarded'))
    );
  `);
  for (const name of ['confirmation_status', 'active_month_shape', 'rejection_shape', 'payment_proof_policy']) {
    // schema.sql replays history; the last definition is the current one.
    const constraint = [...schema.matchAll(new RegExp(`alter table public\\.exam_registrations\\s+add constraint exam_registrations_${name}_check[\\s\\S]*?\\);`, 'g'))].at(-1)?.[0];
    assert.ok(constraint, `fixture must enforce canonical ${name} constraint`);
    await db.exec(constraint);
  }
  await db.exec(slice('create unique index idx_exam_registrations_active_fc_exam_month_type', 'create or replace function public.save_exam_round_atomic_v2('));
  await db.exec(slice('create table if not exists public.exam_registration_decision_events (', 'create or replace function public.prevent_exam_history_drift()'));
  await db.exec('alter table public.exam_registration_decision_events add column if not exists target_fc_id_snapshot uuid');
  await db.exec(slice('create or replace function public.detach_exam_registration_identity_for_account_deletion(', 'revoke all on function public.detach_exam_registration_identity_for_account_deletion('));
  await db.exec('grant usage on schema public to service_role; grant select, insert, update on fc_profiles, exam_rounds, exam_registrations, exam_payment_proof_uploads to service_role;');

  await db.query(`insert into fc_profiles values ($1),($2),($3)`, [fcA, fcB, fcC]);
  await db.query(`insert into exam_rounds values ($1,'life','2026-08-10','2026-08-01'),($2,'life','2026-10-21','2026-10-01')`, [pastRound, upcomingRound]);
  await db.query(`insert into exam_registrations (id,round_id,fc_id,resident_id,exam_month,exam_type,status,is_confirmed) values
    ($1,$6,$7,'fixture-a','2026-10-01','life','applied',false),
    ($2,$5,$7,'fixture-a','2026-08-01','life','confirmed',true),
    ($3,$6,$8,'fixture-b','2026-10-01','life','applied',false),
    ($4,$6,$9,'fixture-c','2026-10-01','life','applied',false)`,
  [reg.aUpcoming, reg.aPastConfirmed, reg.bUpcoming, reg.cDeleted, pastRound, upcomingRound, fcA, fcB, fcC]);
  await db.query(`insert into exam_registrations (id,round_id,fc_id,resident_id,exam_month,exam_type,status,payment_proof_attached,payment_proof_policy_version,
      rejection_reason,rejected_at,rejected_by_staff_type)
    values ($1,$2,$3,'fixture-a','2026-09-01','life','rejected',false,0,'synthetic',now(),'admin')`, [reg.aRejected, pastRound, fcA]);
  await db.query(`insert into exam_payment_proof_uploads (fc_id,registration_id,storage_path,status) values
    ($1,$2,'fixture/a1.png','attached'),($1,$3,'fixture/a2.png','attached'),($4,$5,'fixture/b1.png','attached')`,
  [fcA, reg.aUpcoming, reg.aPastConfirmed, fcB, reg.bUpcoming]);

  // Roster delete: the account deletion path detaches A, B and C.
  await db.exec('set role service_role');
  for (const fcId of [fcA, fcB, fcC]) {
    await db.query('select * from public.detach_exam_registration_identity_for_account_deletion($1)', [fcId]);
  }
  await db.exec('reset role');
  // Place the detach history inside the incident window (fixture-only bypass of the append-only trigger).
  await db.exec(`alter table exam_registration_decision_events disable trigger trg_reject_exam_decision_event_mutation;
    update exam_registration_decision_events set created_at = timestamptz '2026-10-14 16:29:00+09';
    alter table exam_registration_decision_events enable trigger trg_reject_exam_decision_event_mutation;`);
  // Roster restore: A and B re-linked, C stays deleted. B re-applied the same month afterwards.
  await db.query(`update exam_registrations set fc_id=$1, resident_id='fixture-a' where id = any($2::uuid[])`,
    [fcA, [reg.aUpcoming, reg.aPastConfirmed, reg.aRejected]]);
  await db.query(`update exam_registrations set fc_id=$1, resident_id='fixture-b' where id=$2`, [fcB, reg.bUpcoming]);
  await db.query('delete from fc_profiles where id=$1', [fcC]);
  await db.query(`insert into exam_registrations (id,round_id,fc_id,resident_id,exam_month,exam_type,status)
    values ($1,$2,$3,'fixture-b','2026-10-01','life','applied')`, [reg.bReapplied, upcomingRound, fcB]);

  async function snapshot() {
    const result = await db.query(`select
      (select jsonb_object_agg(id, jsonb_build_object('status',status,'is_confirmed',is_confirmed,
        'proof',payment_proof_attached,'policy',payment_proof_policy_version,'fc',fc_id)) from exam_registrations) registrations,
      (select jsonb_agg(status order by storage_path) from exam_payment_proof_uploads) proofs,
      (select jsonb_agg(jsonb_build_object('registration_id',registration_id,'action',action,'from',from_status,'to',to_status,
        'actor',actor_type,'target',target_fc_id_snapshot) order by created_at, registration_id, action)
        from exam_registration_decision_events) events`);
    return result.rows[0];
  }
  return { db, snapshot };
}

test('restores only the incident-window cancellations of restored FCs without a conflicting active slot', async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    assert.equal(before.registrations[reg.aUpcoming].status, 'cancelled_by_fc');
    await f.db.exec(migration);
    const after = await f.snapshot();

    assert.deepEqual(after.registrations[reg.aUpcoming], { status: 'applied', is_confirmed: false, proof: false, policy: 0, fc: fcA });
    assert.deepEqual(after.registrations[reg.aPastConfirmed], { status: 'confirmed', is_confirmed: true, proof: false, policy: 0, fc: fcA });
    for (const id of [reg.aRejected, reg.bUpcoming, reg.bReapplied, reg.cDeleted]) {
      assert.deepEqual(after.registrations[id], before.registrations[id], `${id} must stay untouched`);
    }
    assert.deepEqual(after.proofs, before.proofs, 'deleted proof objects stay discarded');
    assert.ok(after.proofs.every(status => status === 'discarded'));

    const added = after.events.slice(before.events.length);
    assert.deepEqual(after.events.slice(0, before.events.length), before.events, 'history is append-only');
    assert.deepEqual(added.sort((l, r) => l.registration_id.localeCompare(r.registration_id)), [
      { registration_id: reg.aUpcoming, action: 'updated', from: 'cancelled_by_fc', to: 'applied', actor: 'service', target: fcA },
      { registration_id: reg.aPastConfirmed, action: 'updated', from: 'cancelled_by_fc', to: 'confirmed', actor: 'service', target: fcA },
    ]);

    await f.db.exec(migration);
    assert.deepEqual(await f.snapshot(), after, 're-running the repair must be a no-op');
  } finally { await f.db.close(); }
});

test('include_past_rounds=false keeps rounds before the cutoff cancelled, using exam_month when exam_date is empty', async () => {
  const upcomingOnly = migration.replace('true as include_past_rounds', 'false as include_past_rounds');
  assert.notEqual(upcomingOnly, migration);
  for (const withoutExamDate of [false, true]) {
    const f = await fixture();
    try {
      // Without exam_date, August is before the cutoff month and October is not.
      if (withoutExamDate) await f.db.exec('update exam_rounds set exam_date = null');
      const before = await f.snapshot();
      await f.db.exec(upcomingOnly);
      const after = await f.snapshot();
      assert.equal(after.registrations[reg.aUpcoming].status, 'applied');
      assert.deepEqual(after.registrations[reg.aPastConfirmed], before.registrations[reg.aPastConfirmed]);
      assert.equal(after.events.length, before.events.length + 1);
    } finally { await f.db.close(); }
  }
});

test('restored rows still hold the monthly slot and leave cancellations outside the window alone', async () => {
  const f = await fixture();
  try {
    // A cancellation outside the incident window must not be restored.
    await f.db.exec(`alter table exam_registration_decision_events disable trigger trg_reject_exam_decision_event_mutation;
      update exam_registration_decision_events set created_at = timestamptz '2026-10-14 18:10:00+09'
       where registration_id = '${reg.aPastConfirmed}';
      alter table exam_registration_decision_events enable trigger trg_reject_exam_decision_event_mutation;`);
    await f.db.exec(migration);
    const after = await f.snapshot();
    assert.equal(after.registrations[reg.aPastConfirmed].status, 'cancelled_by_fc');
    await assert.rejects(
      f.db.query(`insert into exam_registrations (id,round_id,fc_id,resident_id,exam_month,exam_type,status)
        values (gen_random_uuid(),$1,$2,'fixture-a','2026-10-01','life','applied')`, [upcomingRound, fcA]),
      { code: '23505' },
    );
  } finally { await f.db.close(); }
});
