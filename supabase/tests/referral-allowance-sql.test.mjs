// Isolated PGlite SQL execution. Install @electric-sql/pglite@0.5.8 only into
// .codex-tmp/referral-allowance-sql-test, then run this file with node --test.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { PGlite } = await import(new URL('../../.codex-tmp/referral-allowance-sql-test/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url));
const migration = await readFile(new URL('../migrations/20260907053913_referral_allowance_pilot.sql', import.meta.url), 'utf8');
const recipientsMigration = await readFile(new URL('../migrations/20260907115710_referral_allowance_recipients.sql', import.meta.url), 'utf8');
const admin = '40000000-0000-4000-8000-000000000001';
const inactiveAdmin = '40000000-0000-4000-8000-000000000002';
const manager = '10000000-0000-4000-8000-000000000001';
const otherManager = '10000000-0000-4000-8000-000000000002';
const fc = '20000000-0000-4000-8000-000000000001';
const otherFc = '20000000-0000-4000-8000-000000000002';
const policy = 'recruitment-2026-09-07-snapshot-pilot-v1';

function snapshot(amount = 1000) {
  return {
    schemaVersion: 1, policyVersion: policy, performanceMonth: '2026-08', paymentDate: '2026-10-25',
    genealogyAsOf: '2026-08-31', sourceSnapshotDates: ['2026-08-31'], usesLaterSnapshot: false,
    eligibilityBasis: 'uploaded_snapshot', status: 'current_month_estimate', previousCarryIncluded: false,
    beneficiary: { nodeId: 'node-0', name: '가상 수령인', eligibleAtBasisDate: true },
    nodes: [
      { id: 'node-0', parentId: null, depth: 0, name: '가상 수령인', affiliation: '가상본부', isBeneficiary: true,
        activeAtPerformance: true, eligibleAtBasisDate: true, finalTargetPerformanceKrw: 0, fpRoundedAmountKrw: 0, contributionKrw: 0 },
      { id: 'node-1', parentId: 'node-0', depth: 1, name: '가상 기여인', affiliation: '가상본부', isBeneficiary: false,
        activeAtPerformance: true, eligibleAtBasisDate: true, finalTargetPerformanceKrw: amount * 10,
        fpRoundedAmountKrw: amount, contributionKrw: amount },
    ],
    summary: { currentMonthNetKrw: amount, newPaymentKrw: amount, carryForwardKrw: 0, extinguishedKrw: 0, excludedByEligibilityKrw: 0 },
    validation: { visiblePeopleCount: 2, contributorCount: 1, maximumDepth: 10, conservationDifferenceKrw: 0 },
  };
}

async function database(expand = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table admin_accounts(id uuid primary key, phone text, active boolean);
    create table manager_accounts(id uuid primary key, phone text, active boolean);
    create table fc_profiles(id uuid primary key, phone text, affiliation text, signup_completed boolean, is_manager_referral_shadow boolean);
    grant select on admin_accounts, manager_accounts, fc_profiles to service_role;
    insert into admin_accounts values ('${admin}', '01000000999', true), ('${inactiveAdmin}', '01000000888', false);
    insert into manager_accounts values ('${manager}', '01000000000', true), ('${otherManager}', '01000000001', true);
    insert into fc_profiles values ('${fc}', '01000000000', '가상본부', false, true), ('${otherFc}', '01000000001', '가상본부', true, false);
  `);
  await db.exec(migration);
  if (expand) await db.exec(recipientsMigration);
  await db.exec('set role service_role');
  return db;
}

async function result(db, sql, values) { return (await db.query(sql, values)).rows[0].result; }
const configure = (db, revision = 0, enabled = true, overrides = {}) => result(db,
  'select configure_referral_allowance_pilot($1::uuid,$2::uuid,$3::uuid,$4::text,$5::boolean,$6::bigint) as result',
  [overrides.actor ?? admin, overrides.manager === undefined ? manager : overrides.manager, overrides.fc ?? fc, overrides.employeeCode ?? '000001', enabled, revision]);
const draft = (db, overrides = {}) => result(db,
  'select create_referral_allowance_draft($1::uuid,$2::bigint,$3::uuid,$4::uuid,$5::text,$6::text,$7::date,$8::date,$9::text,$10::text,$11::jsonb) as result',
  [overrides.actor ?? admin, overrides.pilotRevision ?? 1, overrides.manager === undefined ? manager : overrides.manager, overrides.fc ?? fc, overrides.employeeCode ?? '000001', overrides.month ?? '2026-08',
    overrides.paymentDate ?? '2026-10-25', overrides.genealogyAsOf ?? '2026-08-31', overrides.hash ?? 'a'.repeat(64),
    policy, JSON.stringify(overrides.snapshot ?? snapshot())]);
const publish = (db, row, overrides = {}) => result(db,
  'select publish_referral_allowance_draft($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint) as result',
  [overrides.actor ?? admin, row.id, overrides.hash ?? row.sourceSha256, overrides.revision ?? row.revision,
    overrides.pilotRevision ?? row.pilotRevision]);
const read = (db, action = 'statement', month = null, managerId = manager, fcId = fc) => result(db,
  'select read_referral_allowance_pilot($1::uuid,$2::uuid,$3::text,$4::text) as result', [managerId, fcId, action, month]);
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test('the additive schema mirror exactly matches the executable migration', async () => {
  const schema = (await readFile(new URL('../schema.sql', import.meta.url), 'utf8')).replace(/\r/g, '');
  const marker = '-- 20260907053913_referral_allowance_pilot\n';
  assert.equal(schema.split(marker).length, 2);
  assert.ok(schema.includes(marker + migration.replace(/\r/g, '')));
  assert.ok(schema.includes('-- 20260907115710_referral_allowance_recipients\n' + recipientsMigration.replace(/\r/g, '')));
});

test('FC and manager recipients publish independently and cannot read each other or revive revoked data', async () => {
  const db = await database();
  const independentFc = '20000000-0000-4000-8000-000000000003';
  try {
    await db.exec('reset role');
    await db.query('insert into fc_profiles values ($1, $2, $3, true, false)', [independentFc, '01000000002', '가상본부']);
    await db.exec('set role service_role');
    await configure(db);
    const a = (await draft(db)).import;
    await publish(db, a);
    await configure(db, 0, true, { manager: null, fc: independentFc, employeeCode: '000003' });
    const b = (await draft(db, { manager: null, fc: independentFc, employeeCode: '000003', snapshot: snapshot(2000) })).import;
    await publish(db, b);
    assert.equal((await read(db)).statement.summary.currentMonthNetKrw, 1000);
    assert.equal((await read(db, 'statement', null, null, independentFc)).statement.summary.currentMonthNetKrw, 2000);
    await rejectsCode(read(db, 'statement', null, manager, independentFc), '42501');
    await rejectsCode(read(db, 'statement', null, null, fc), '42501');
    await configure(db, 1, false, { manager: null, fc: independentFc, employeeCode: '000003' });
    assert.equal((await read(db)).enabled, true);
    assert.equal((await read(db, 'access', null, null, independentFc)).enabled, false);
    await configure(db, 2, true, { manager: null, fc: independentFc, employeeCode: '000003' });
    assert.equal((await read(db, 'statement', null, null, independentFc)).statement, null);
  } finally { await db.close(); }
});

test('expanding a populated pilot retains its exact published snapshot and permission revision', async () => {
  const db = await database(false);
  try {
    await configure(db);
    const row = (await draft(db)).import;
    await publish(db, row);
    const before = await read(db);
    await db.exec('reset role');
    await db.exec(recipientsMigration);
    await db.exec('set role service_role');
    assert.deepEqual(await read(db), before);
    assert.equal((await db.query('select revision from referral_allowance_recipients')).rows[0].revision, 1);
    assert.equal((await db.query("select count(*)::int as count from referral_allowance_imports where status='published'")).rows[0].count, 1);
  } finally { await db.close(); }
});

test('tables and functions deny public client roles with RLS enabled and no seeded pilot', async () => {
  const db = await database();
  try {
    assert.equal((await db.query('select count(*)::int as count from referral_allowance_pilot')).rows[0].count, 0);
    const rls = await db.query("select relrowsecurity from pg_class where relname in ('referral_allowance_recipients','referral_allowance_imports')");
    assert.deepEqual(rls.rows.map((row) => row.relrowsecurity), [true, true]);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role}`);
      await rejectsCode(db.query('select * from referral_allowance_recipients'), '42501');
      await rejectsCode(read(db, 'access'), '42501');
      await rejectsCode(configure(db), '42501');
    }
  } finally { await db.close(); }
});

test('configuration is per-recipient, active-admin-only, pair-checked, and versioned', async () => {
  const db = await database();
  try {
    await rejectsCode(configure(db, 0, true, { actor: inactiveAdmin }), '42501');
    await rejectsCode(configure(db, 0, true, { fc: otherFc }), '22023');
    await rejectsCode(configure(db, 0, false, { fc: otherFc }), '22023');
    const created = await configure(db);
    assert.equal(created.pilot.revision, 1);
    assert.equal(created.pilot.employeeCode, '000001');
    await rejectsCode(configure(db, 0), '40001');
    await configure(db, 1, false);
    assert.equal((await db.query('select count(*)::int as count from referral_allowance_recipients')).rows[0].count, 1);
    assert.deepEqual(await read(db, 'access'), { ok: true, enabled: false });
  } finally { await db.close(); }
});

test('draft import is immutable, idempotent, metadata-checked, and invisible before publication', async () => {
  const db = await database();
  try {
    await configure(db);
    const first = await draft(db);
    assert.deepEqual(await draft(db), first);
    assert.deepEqual(await read(db), { ok: true, enabled: true, availableMonths: [], statement: null });
    await rejectsCode(draft(db, { pilotRevision: 99 }), '40001');
    await rejectsCode(draft(db, { month: '2026-07' }), '22023');
    await rejectsCode(draft(db, { genealogyAsOf: '2026-08-30' }), '22023');
    await rejectsCode(draft(db, { paymentDate: '2026-09-25' }), '22023');
    await rejectsCode(draft(db, { snapshot: snapshot(2000) }), '40001');
    await rejectsCode(db.query("update referral_allowance_imports set snapshot = '{}'::jsonb where id=$1", [first.import.id]), '23514');
    await rejectsCode(db.query('delete from referral_allowance_imports where id=$1', [first.import.id]), '42501');
  } finally { await db.close(); }
});

test('a null affiliation preserves eligible manager access while designer affiliations still revoke it', async () => {
  const db = await database();
  try {
    await db.exec('reset role');
    await db.query('update fc_profiles set affiliation = null where id = $1', [fc]);
    await db.exec('set role service_role');
    await configure(db);
    assert.deepEqual(await read(db, 'access'), { ok: true, enabled: true, availableMonths: [] });
    await db.exec('reset role');
    await db.query('update fc_profiles set affiliation = $1 where id = $2', ['가상 설계매니저', fc]);
    await db.exec('set role service_role');
    assert.deepEqual(await read(db, 'access'), { ok: true, enabled: false });
    await rejectsCode(draft(db), '42501');
  } finally { await db.close(); }
});

test('snapshot consistency rejects unbalanced money, raw extra columns, and numeric strings', async () => {
  const db = await database();
  try {
    await configure(db);
    const badTotal = snapshot(); badTotal.summary.currentMonthNetKrw += 1;
    const rawColumn = snapshot(); rawColumn.nodes[0].employeeCode = '000001';
    const numericString = snapshot(); numericString.nodes[1].contributionKrw = '1000';
    const wrongBeneficiary = snapshot(); wrongBeneficiary.beneficiary.nodeId = 'node-1';
    for (const invalid of [badTotal, rawColumn, numericString, wrongBeneficiary]) {
      await rejectsCode(draft(db, { snapshot: invalid }), '22023');
    }
  } finally { await db.close(); }
});

test('source targets preserve hundredths while rounded allowance amounts remain integral', async () => {
  const db = await database();
  try {
    await configure(db);
    const fractional = snapshot(10000);
    fractional.nodes[1].finalTargetPerformanceKrw = 100000.25;
    const row = (await draft(db, { snapshot: fractional })).import;
    await publish(db, row);
    assert.equal((await read(db)).statement.nodes[1].finalTargetPerformanceKrw, 100000.25);
    for (const target of [100000.251, 90071992547410, '100000.25']) {
      const invalid = snapshot(10000); invalid.nodes[1].finalTargetPerformanceKrw = target;
      await rejectsCode(draft(db, { snapshot: invalid }), '22023');
    }
    const fractionalAllowance = snapshot(10000);
    fractionalAllowance.nodes[1].fpRoundedAmountKrw = 10000.25;
    await rejectsCode(draft(db, { snapshot: fractionalAllowance }), '22023');
  } finally { await db.close(); }
});

test('the confirmed pilot preserves later uploaded dates with July reference and August payment', async () => {
  const db = await database();
  try {
    await configure(db);
    const june = { ...snapshot(), performanceMonth: '2026-06', paymentDate: '2026-08-01', genealogyAsOf: '2026-07-31',
      sourceSnapshotDates: ['2026-07-29', '2026-07-30', '2026-08-10', '2026-08-24'], usesLaterSnapshot: true };
    const row = (await draft(db, { month: '2026-06', paymentDate: '2026-08-01', genealogyAsOf: '2026-07-31', snapshot: june })).import;
    await publish(db, row);
    assert.deepEqual((await read(db)).statement, june);
    await rejectsCode(draft(db, { month: '2026-06', paymentDate: '2026-08-01', genealogyAsOf: '2026-08-02',
      snapshot: { ...june, genealogyAsOf: '2026-08-02' } }), '22023');
    await rejectsCode(draft(db, { month: '2026-06', paymentDate: '2026-08-01', genealogyAsOf: '2026-07-31', snapshot: snapshot() }), '22023');
  } finally { await db.close(); }
});

test('source snapshot dates must be real, nonempty, sorted, unique and honestly disclose later data', async () => {
  const db = await database();
  try {
    await configure(db);
    for (const dates of [null, [], ['2026-02-30'], ['2026-13-01'], ['not-a-date'], [42],
      ['2026-08-31', '2026-08-31'], ['2026-08-31', '2026-07-31'], Array(65).fill('2026-08-31')]) {
      await rejectsCode(draft(db, { snapshot: { ...snapshot(), sourceSnapshotDates: dates } }), '22023');
    }
    await rejectsCode(draft(db, { snapshot: { ...snapshot(), usesLaterSnapshot: true } }), '22023');
    await rejectsCode(draft(db, { snapshot: { ...snapshot(), sourceSnapshotDates: ['2026-09-01'] } }), '22023');
    await rejectsCode(draft(db, { snapshot: { ...snapshot(), eligibilityBasis: 'performance_month_end' } }), '22023');
    await draft(db, { snapshot: { ...snapshot(), sourceSnapshotDates: ['2026-08-31', '2026-09-01'], usesLaterSnapshot: true } });
  } finally { await db.close(); }
});

test('publication is atomic, retry-safe, and exposes only the current beneficiary statement', async () => {
  const db = await database();
  try {
    await configure(db);
    const first = (await draft(db)).import;
    await rejectsCode(publish(db, first, { hash: 'b'.repeat(64) }), '40001');
    const published = await publish(db, first);
    assert.deepEqual(await publish(db, first), published);
    const response = await read(db);
    assert.deepEqual(response, { ok: true, enabled: true, availableMonths: ['2026-08'], statement: snapshot() });
    assert.equal(JSON.stringify(response).includes('employeeCode'), false);
    assert.deepEqual(await read(db, 'access', null, otherManager, otherFc), { ok: true, enabled: false });
    await rejectsCode(read(db, 'statement', null, otherManager, otherFc), '42501');
    assert.equal((await read(db, 'statement', '2026-07')).statement, null);

    const second = (await draft(db, { hash: 'b'.repeat(64), snapshot: snapshot(2000) })).import;
    await publish(db, second);
    assert.equal((await read(db)).statement.summary.currentMonthNetKrw, 2000);
    assert.equal((await db.query("select count(*)::int as count from referral_allowance_imports where status='published'")).rows[0].count, 1);
    assert.equal((await db.query('select status from referral_allowance_imports where id=$1', [first.id])).rows[0].status, 'superseded');
    await rejectsCode(publish(db, first), '40001');
  } finally { await db.close(); }
});

test('disable and re-enable revoke old revisions until a newly reviewed draft is published', async () => {
  const db = await database();
  try {
    await configure(db);
    const first = (await draft(db)).import;
    await publish(db, first);
    await configure(db, 1, false);
    await rejectsCode(read(db), '42501');
    await configure(db, 2, true);
    assert.deepEqual(await read(db), { ok: true, enabled: true, availableMonths: [], statement: null });
    await rejectsCode(publish(db, first, { pilotRevision: 3 }), '40001');
    const current = (await draft(db, { pilotRevision: 3 })).import;
    assert.notEqual(current.id, first.id);
    assert.equal(current.revision, 2);
    await publish(db, current);
    assert.equal((await read(db)).statement.summary.currentMonthNetKrw, 1000);
  } finally { await db.close(); }
});

test('queued publication attempts retain one published month and fresh active-account checks', async () => {
  const db = await database();
  try {
    await configure(db);
    const first = (await draft(db)).import;
    const second = (await draft(db, { hash: 'b'.repeat(64), snapshot: snapshot(2000) })).import;
    // PGlite queues a single connection: this exercises serialized transactions, not a multi-connection race.
    await Promise.all([publish(db, first), publish(db, second)]);
    assert.equal((await db.query("select count(*)::int as count from referral_allowance_imports where status='published'")).rows[0].count, 1);
    await db.exec(`reset role; update manager_accounts set active=false where id='${manager}'; set role service_role;`);
    assert.deepEqual(await read(db, 'access'), { ok: true, enabled: false });
    await rejectsCode(read(db), '42501');
    await configure(db, 1, false);
  } finally { await db.close(); }
});
