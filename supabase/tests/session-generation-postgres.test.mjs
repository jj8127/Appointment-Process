// Uses only an explicitly supplied disposable loopback PostgreSQL fixture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import test, { before, after, beforeEach } from 'node:test';

const require = createRequire(import.meta.url);
const { Client } = require(process.env.PG_MODULE_PATH ?? 'pg');
const port = Number(process.env.SESSION_TEST_POSTGRES_PORT);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'explicit disposable local port required');
const database = `session_generation_${process.pid}`;
const config = { host: '127.0.0.1', port, user: 'otp_fixture', password: 'synthetic-local-only',
  ssl: false, connectionTimeoutMillis: 3000, options: '-c statement_timeout=8000 -c lock_timeout=6000' };
const migration = await readFile(new URL('../migrations/20261004133155_credential_session_generations.sql', import.meta.url), 'utf8');
const activation = await readFile(new URL('../migrations/20261004143855_activate_credential_session_generations.sql', import.meta.url), 'utf8');
const otpMigration = await readFile(new URL('../migrations/20261001071216_password_reset_atomic_challenges.sql', import.meta.url), 'utf8');
const id = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const phone = '00000000001';
const hash = byte => Buffer.alloc(32, byte).toString('base64');
const salt = Buffer.alloc(16, 5).toString('base64');
const connections = [];
let admin;
let db;
async function connect() {
  const client = new Client({ ...config, database });
  await client.connect(); connections.push(client); return client;
}
async function applyMigration() {
  await db.query('begin');
  try { await db.query(migration); await db.query(activation); await db.query('commit'); }
  catch (error) { await db.query('rollback'); throw error; }
}
async function state(client, role, purpose = 'app', kind = null, accountId = null) {
  const { rows } = await client.query('select get_auth_session_generation($1,$2,$3,$4,$5) result',
    [phone, role, purpose, kind, accountId]);
  return rows[0].result;
}
async function version(client, table = 'fc_credentials') {
  assert.ok(['fc_credentials', 'admin_accounts', 'manager_accounts'].includes(table));
  return Number((await client.query(`select session_version from ${table}`)).rows[0].session_version);
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
    create table fc_profiles (id uuid primary key, phone text, signup_completed boolean, affiliation text, created_at timestamptz default '2000-01-01T00:00:00Z');
    create table admin_accounts (
      id uuid primary key, phone text, active boolean not null default true,
      staff_type text default 'admin', password_hash text not null default 'old', password_salt text not null default 'salt',
      password_set_at timestamptz default now(), failed_count integer not null default 0,
      locked_until timestamptz, reset_token_hash text, reset_token_expires_at timestamptz,
      reset_sent_at timestamptz, updated_at timestamptz default now(), created_at timestamptz default '2000-01-01T00:00:00Z'
    );
    create table manager_accounts (like admin_accounts including all);
    create table fc_credentials (like admin_accounts including all);
    alter table fc_credentials rename column id to fc_id;
    alter table fc_credentials add column must_change_password boolean default false;
    alter table fc_credentials add column temporary_password_issued_at timestamptz;
    grant usage on schema public to anon, authenticated, service_role;
    grant select, update on all tables in schema public to service_role;
  `);
  await db.query(otpMigration);
  // Seed before migration to prove the additive default preserves old accounts.
  await db.query('insert into fc_profiles (id,phone,signup_completed,affiliation) values ($1,$2,true,null)', [id, phone]);
  for (const table of ['admin_accounts', 'manager_accounts', 'fc_credentials']) {
    await db.query(`insert into ${table} (${table === 'fc_credentials' ? 'fc_id' : 'id'},phone) values ($1,$2)`, [id, phone]);
  }
  await applyMigration();
});

beforeEach(async () => {
  await db.query('truncate admin_accounts, manager_accounts, fc_credentials, fc_profiles');
  await db.query('insert into fc_profiles (id,phone,signup_completed,affiliation) values ($1,$2,true,null)', [id, phone]);
  for (const table of ['admin_accounts', 'manager_accounts', 'fc_credentials']) {
    await db.query(`insert into ${table} (${table === 'fc_credentials' ? 'fc_id' : 'id'},phone) values ($1,$2)`, [id, phone]);
  }
});
after(async () => {
  await Promise.allSettled(connections.map(client => client.end()));
  if (admin) {
    assert.match(database, /^session_generation_\d+$/);
    await admin.query(`drop database if exists ${database}`);
    await admin.end();
  }
});

test('legacy accounts stay at zero and unrelated writes cannot change a generation', async () => {
  for (const kind of ['admin', 'manager', 'fc']) {
    const result = await state(db, kind);
    assert.equal(result.accountKind, kind);
    assert.equal(result.accountId, id);
    assert.equal(result.sessionVersion, 0);
    assert.equal(Date.parse(result.createdAt), Date.parse('2000-01-01T00:00:00Z'));
    const table = kind === 'fc' ? 'fc_credentials' : `${kind}_accounts`;
    await db.query(`update ${table} set failed_count=3, session_version=200`);
    assert.equal(await version(db, table), 0);
    await db.query(`update ${table} set password_hash='new'`);
    assert.equal(await version(db, table), 1);
    await db.query(`update ${table} set password_salt='new-salt', session_version=0`);
    assert.equal(await version(db, table), 2);
  }
});

test('password and generation roll back together; migration reapply never resets a generation', async () => {
  await db.query('begin');
  await db.query("update fc_credentials set password_hash='changed'");
  assert.equal(await version(db), 1);
  await db.query('rollback');
  assert.equal(await version(db), 0);
  await db.query("update fc_credentials set password_hash='committed'");
  await applyMigration();
  assert.equal(await version(db), 1);
});

test('the existing OTP consume increments once and replay cannot increment again', async () => {
  await db.query('select process_password_reset_challenge($1,$2,$3,$4,$5,$6,$7)',
    ['issue', 'fc', id, phone, hash(1), null, null]);
  const args = ['consume', 'fc', id, phone, hash(1), hash(2), salt];
  const first = await db.query('select process_password_reset_challenge($1,$2,$3,$4,$5,$6,$7) result', args);
  assert.equal(first.rows[0].result.ok, true);
  assert.equal(await version(db), 1);
  const replay = await db.query('select process_password_reset_challenge($1,$2,$3,$4,$5,$6,$7) result', args);
  assert.equal(replay.rows[0].result.ok, false);
  assert.equal(await version(db), 1);
});

test('independent concurrent password writes serialize to two generations', async () => {
  const first = await connect(); const second = await connect();
  await first.query('begin');
  await first.query("update fc_credentials set password_hash='first'");
  const secondWrite = second.query("update fc_credentials set password_hash='second'");
  let waited = false;
  for (let i = 0; i < 100; i += 1) {
    const { rows } = await db.query('select wait_event_type from pg_stat_activity where pid=$1', [second.processID]);
    if (rows[0]?.wait_event_type === 'Lock') { waited = true; break; }
    await delay(10);
  }
  assert.equal(waited, true);
  await first.query('commit'); await secondWrite;
  assert.equal(await version(db), 2);
});

test('canonical identity, active state and bridge source roles cannot be substituted', async () => {
  assert.equal(await state(db, 'fc', 'app', 'admin', id), null);
  assert.equal(await state(db, 'fc', 'app', 'fc', otherId), null);
  await db.query('update admin_accounts set active=false');
  assert.equal(await state(db, 'admin'), null);
  await db.query('update fc_credentials set must_change_password=true');
  assert.equal(await state(db, 'fc'), null);
  await db.query('update fc_credentials set must_change_password=false');
  await db.query("update fc_profiles set affiliation='Synthetic 설계매니저'");
  assert.equal(await state(db, 'fc', 'bridge'), null);
  assert.equal((await state(db, 'designer', 'bridge')).accountKind, 'fc');
  await db.query("update admin_accounts set active=true, staff_type='developer'");
  assert.equal((await state(db, 'fc', 'bridge', 'admin', id)).accountKind, 'admin');
});

test('only service_role can call the credential-state RPC', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.query(`set role ${role}`);
    await assert.rejects(state(db, 'fc'), error => error.code === '42501');
    await db.query('reset role');
  }
  await db.query('set role service_role');
  assert.equal((await state(db, 'fc')).sessionVersion, 0);
  await db.query('reset role');
});
