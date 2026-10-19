// Real, independent PostgreSQL connections against a disposable local cluster.
// Never accepts a URL/host or production credentials. Start an isolated server
// as otp_fixture; set OTP_TEST_POSTGRES_PORT and PG_MODULE_PATH (installed pg).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import test, { before, after } from 'node:test';

const require = createRequire(import.meta.url);
const { Client } = require(process.env.PG_MODULE_PATH ?? 'pg');
const port = Number(process.env.OTP_TEST_POSTGRES_PORT);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'explicit disposable local port required');
const database = `otp_regression_${process.pid}`;
const config = { host: '127.0.0.1', port, user: 'otp_fixture', password: 'synthetic-local-only',
  ssl: false, connectionTimeoutMillis: 3000, options: '-c statement_timeout=8000 -c lock_timeout=6000' };
const migration = await readFile(new URL('../migrations/20261001071216_password_reset_atomic_challenges.sql', import.meta.url), 'utf8');
const validation = await readFile(new URL('../migrations/20261001071222_password_reset_validate_challenge_counters.sql', import.meta.url), 'utf8');
const clients = [];
let admin;
let db;
const id = '10000000-0000-4000-8000-000000000001';
const phone = '00000000001';
const hash = byte => Buffer.alloc(32, byte).toString('base64');
const salt = Buffer.alloc(16, 5).toString('base64');

async function connect() {
  const client = new Client({ ...config, database });
  await client.connect(); clients.push(client); return client;
}
async function apply(client, sql) {
  await client.query('begin');
  try { await client.query(sql); await client.query('commit'); }
  catch (error) { await client.query('rollback'); throw error; }
}
async function waitForLock(client) {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const { rows } = await db.query('select wait_event_type from pg_stat_activity where pid=$1', [client.processID]);
    if (rows[0]?.wait_event_type === 'Lock') return;
    await delay(10);
  }
  assert.fail('second connection did not wait for the first transaction lock');
}
async function rpc(client, kind, action, token = hash(1), password = hash(4)) {
  const { rows } = await client.query('select public.process_password_reset_challenge($1,$2,$3,$4,$5,$6,$7) result',
    [action, kind, id, phone, token, password, salt]);
  return rows[0].result;
}
const tableFor = kind => kind === 'fc' ? 'fc_credentials' : `${kind}_accounts`;
async function reset(kind) {
  await db.query(`update ${tableFor(kind)} set reset_token_hash=null, reset_token_expires_at=null,
    reset_sent_at=null, reset_failed_count=0, password_hash='old', failed_count=2`);
}

before(async () => {
  admin = new Client({ ...config, database: 'postgres' }); await admin.connect();
  await admin.query(`create database ${database}`);
  db = await connect();
  await db.query(`
    do $$ begin
      if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists (select from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create table fc_profiles (id uuid primary key, phone text, signup_completed boolean,
      is_manager_referral_shadow boolean not null default false, affiliation text, status text default 'draft');
    create table platform_members (id uuid primary key, phone text, active boolean, fc_id uuid);
    create table admin_accounts (
      id uuid primary key, phone text, active boolean not null default true,
      password_hash text not null default 'old', password_salt text not null default 'old',
      password_set_at timestamptz default now(), failed_count integer not null default 2,
      locked_until timestamptz, reset_token_hash text, reset_token_expires_at timestamptz,
      reset_sent_at timestamptz, updated_at timestamptz default now()
    );
    create table manager_accounts (like admin_accounts including all);
    create table fc_credentials (like admin_accounts including all);
    alter table fc_credentials rename column id to fc_id;
    alter table fc_credentials add column must_change_password boolean default true;
    alter table fc_credentials add column temporary_password_issued_at timestamptz default now();
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update on all tables in schema public to service_role;
  `);
  await db.query('insert into fc_profiles(id,phone,signup_completed) values ($1,$2,true)', [id, phone]);
  for (const kind of ['admin', 'manager', 'fc']) {
    await db.query(`insert into ${tableFor(kind)} (${kind === 'fc' ? 'fc_id' : 'id'},phone) values ($1,$2)`, [id, phone]);
  }
});

after(async () => {
  await Promise.allSettled(clients.map(client => client.end()));
  if (admin) {
    // Only the freshly created fixture database can be removed.
    assert.match(database, /^otp_regression_\d+$/);
    await admin.query(`drop database if exists ${database}`);
    await admin.end();
  }
});

test('DDL lock wait is bounded and rolls back; separate validation permits credential writes', async () => {
  const blocker = await connect(); const migrator = await connect(); const writer = await connect();
  await blocker.query('begin'); await blocker.query('select * from admin_accounts');
  const started = Date.now();
  await assert.rejects(() => apply(migrator, migration), error => error.code === '55P03');
  assert.ok(Date.now() - started >= 2500 && Date.now() - started < 7500);
  await blocker.query('rollback');
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where column_name='reset_failed_count'")).rows[0].n, 0);
  await apply(migrator, migration);
  const constraintStates = async () => (await db.query("select convalidated from pg_constraint where conname like '%_reset_failed_count_check' order by conname")).rows.map(row => row.convalidated);
  assert.deepEqual(await constraintStates(), [false, false, false]);
  await assert.rejects(() => db.query('update admin_accounts set reset_failed_count=6'), error => error.code === '23514');
  await migrator.query('begin'); await migrator.query(validation);
  assert.equal((await migrator.query('show lock_timeout')).rows[0].lock_timeout, '3s');
  assert.equal((await migrator.query('show statement_timeout')).rows[0].statement_timeout, '30s');
  const locks = await db.query("select mode from pg_locks where pid=$1 and relation='admin_accounts'::regclass and granted", [migrator.processID]);
  assert.ok(locks.rows.some(row => row.mode === 'ShareUpdateExclusiveLock'));
  assert.ok(!locks.rows.some(row => row.mode === 'AccessExclusiveLock'));
  await writer.query('update admin_accounts set failed_count=3');
  await writer.query('select * from admin_accounts');
  await migrator.query('commit');
  assert.deepEqual(await constraintStates(), [true, true, true]);
  assert.equal((await migrator.query('show lock_timeout')).rows[0].lock_timeout, '6s');
  assert.equal((await migrator.query('show statement_timeout')).rows[0].statement_timeout, '8s');
  await apply(migrator, migration); await apply(migrator, validation);
});

for (const kind of ['admin', 'manager', 'fc']) {
  test(`${kind}: a blocked second consume rechecks committed consumption and cannot overwrite the winner`, async () => {
    await reset(kind); const first = await connect(); const second = await connect();
    await first.query('set role service_role'); await second.query('set role service_role');
    await rpc(first, kind, 'issue'); await first.query('begin');
    assert.equal((await rpc(first, kind, 'consume', hash(1), hash(4))).ok, true);
    const pending = rpc(second, kind, 'consume', hash(1), hash(6));
    await waitForLock(second); await first.query('commit');
    assert.equal((await pending).code, 'invalid_token');
    const { rows } = await db.query(`select password_hash,reset_token_hash from ${tableFor(kind)}`);
    assert.equal(rows[0].password_hash, hash(4)); assert.equal(rows[0].reset_token_hash, null);
  });

  test(`${kind}: concurrent wrong attempts cannot lose increments or exceed five`, async () => {
    await reset(kind); await rpc(db, kind, 'issue');
    const first = await connect(); const second = await connect(); const third = await connect();
    await first.query('begin'); assert.equal((await rpc(first, kind, 'consume', hash(3))).code, 'invalid_token');
    const pending = rpc(second, kind, 'consume', hash(3)); await waitForLock(second);
    await first.query('commit'); assert.equal((await pending).code, 'invalid_token');
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => rpc(i % 2 ? second : third, kind, 'consume', hash(3))));
    assert.equal(results.filter(row => row.code === 'invalid_token').length, 2);
    assert.equal(results.filter(row => row.code === 'attempts_exhausted').length, 6);
    const { rows } = await db.query(`select reset_failed_count,password_hash,failed_count from ${tableFor(kind)}`);
    assert.equal(rows[0].reset_failed_count, 5); assert.equal(rows[0].password_hash, 'old'); assert.equal(rows[0].failed_count, 2);
  });

  test(`${kind}: concurrent issuance rechecks cooldown; replacement rejects a waiting old-code consume`, async () => {
    await reset(kind); const first = await connect(); const second = await connect();
    await first.query('begin'); assert.equal((await rpc(first, kind, 'issue')).ok, true);
    const pendingIssue = rpc(second, kind, 'issue', hash(2)); await waitForLock(second);
    await first.query('commit'); assert.equal((await pendingIssue).code, 'cooldown');
    await db.query(`update ${tableFor(kind)} set reset_sent_at=now()-interval '61 seconds',reset_failed_count=4`);
    await first.query('begin'); assert.equal((await rpc(first, kind, 'issue', hash(2))).ok, true);
    const pendingConsume = rpc(second, kind, 'consume', hash(1)); await waitForLock(second);
    await first.query('commit'); assert.equal((await pendingConsume).code, 'invalid_token');
    const { rows } = await db.query(`select reset_failed_count,password_hash,reset_token_hash from ${tableFor(kind)}`);
    assert.equal(rows[0].reset_failed_count, 1); assert.equal(rows[0].password_hash, 'old'); assert.equal(rows[0].reset_token_hash, hash(2));
    assert.equal((await rpc(second, kind, 'consume', hash(2))).ok, true);
  });
}

test('completed FC credential initialization serializes SMS issue and consumes once with the committed generation', async () => {
  const unified = await readFile(new URL('../migrations/20261014043557_unified_common_insurance_enrollment.sql', import.meta.url), 'utf8');
  const definition = unified.match(/create or replace function public\.process_password_reset_challenge\([\s\S]*?\n\$\$;/);
  assert.ok(definition, 'current migration must extend the existing reset RPC');
  await db.query(definition[0]);
  await db.query('alter table fc_credentials add column session_version bigint not null default 0');
  const generations = await readFile(new URL('../migrations/20261004133155_credential_session_generations.sql', import.meta.url), 'utf8');
  await db.query(generations.slice(generations.indexOf('create or replace function public.advance_credential_session_version()'),
    generations.indexOf('-- The service verifies')));
  await db.query('create trigger credential_session_version before update on fc_credentials for each row execute function advance_credential_session_version()');
  const wrappers = await readFile(new URL('../migrations/20261013094543_fc_password_sync_generation_results.sql', import.meta.url), 'utf8');
  await db.query(wrappers.slice(wrappers.indexOf('create or replace function public.process_password_reset_challenge_v2(')));
  await db.query('delete from admin_accounts');
  await db.query('delete from manager_accounts');
  await db.query('delete from fc_credentials');
  await db.query("update fc_profiles set status='appointment-completed'");
  const profileBefore = (await db.query('select * from fc_profiles')).rows[0];
  assert.equal((await rpc(db, 'fc', 'consume')).ok, false);
  assert.equal(Number((await db.query('select count(*) n from fc_credentials')).rows[0].n), 0);
  const first = await connect(); const second = await connect();
  await first.query('set role service_role'); await second.query('set role service_role');
  await first.query('begin');
  assert.equal((await rpc(first, 'fc', 'issue')).ok, true);
  const pendingIssue = rpc(second, 'fc', 'issue', hash(2));
  await waitForLock(second); await first.query('commit');
  assert.equal((await pendingIssue).code, 'cooldown');
  assert.equal((await db.query('select password_set_at from fc_credentials')).rows[0].password_set_at, null);
  const consume = async client => (await client.query('select process_password_reset_challenge_v2($1,$2,$3,$4,$5,$6,$7) result',
    ['consume', 'fc', id, phone, hash(1), hash(4), salt])).rows[0].result;
  await first.query('begin');
  const winner = await consume(first);
  assert.equal(winner.ok, true);
  assert.equal(winner.sessionVersion, 1);
  const pendingConsume = consume(second);
  await waitForLock(second); await first.query('commit');
  assert.equal((await pendingConsume).code, 'invalid_token');
  const credential = (await db.query('select password_hash,password_set_at,session_version from fc_credentials')).rows[0];
  assert.equal(credential.password_hash, hash(4)); assert.ok(credential.password_set_at);
  assert.equal(Number(credential.session_version), winner.sessionVersion);
  assert.deepEqual((await db.query('select * from fc_profiles')).rows[0], profileBefore);
});
