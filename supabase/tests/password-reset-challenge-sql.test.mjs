// Isolated PostgreSQL engine tests; no network/database credentials.
// Set PGLITE_MODULE_PATH to an already installed @electric-sql/pglite module.
// PGlite queues calls on one connection: overlapping calls below test serialized
// outcomes. password-reset-challenge-postgres.test.mjs separately verifies real
// multi-connection locking against a disposable local PostgreSQL cluster.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pbkdf2Sync, webcrypto } from 'node:crypto';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261001071216_password_reset_atomic_challenges.sql', import.meta.url), 'utf8');
const validationMigration = await readFile(new URL('../migrations/20261001071222_password_reset_validate_challenge_counters.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const id = '10000000-0000-4000-8000-000000000001';
const phone = '00000000001';
const codeHash = Buffer.alloc(32, 1).toString('base64');
const replacementHash = Buffer.alloc(32, 2).toString('base64');
const wrongHash = Buffer.alloc(32, 3).toString('base64');
const passwordHash = Buffer.alloc(32, 4).toString('base64');
const salt = Buffer.alloc(16, 5).toString('base64');

async function applyMigration(db, sql) {
  await db.exec('begin');
  try {
    await db.exec(sql);
    await db.exec('commit');
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

async function fixture(kind) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.fc_profiles (id uuid primary key, phone text, signup_completed boolean);
    create table public.admin_accounts (
      id uuid primary key, phone text, active boolean not null default true,
      password_hash text not null default 'old', password_salt text not null default 'old',
      password_set_at timestamptz default now(), failed_count integer not null default 2,
      locked_until timestamptz, reset_token_hash text, reset_token_expires_at timestamptz,
      reset_sent_at timestamptz, updated_at timestamptz default now()
    );
    create table public.manager_accounts (like public.admin_accounts including all);
    create table public.fc_credentials (like public.admin_accounts including all);
    alter table public.fc_credentials rename column id to fc_id;
    alter table public.fc_credentials add column must_change_password boolean default true;
    alter table public.fc_credentials add column temporary_password_issued_at timestamptz default now();
    grant usage on schema public to anon, authenticated, service_role;
    grant select, update on all tables in schema public to service_role;
  `);
  await applyMigration(db, migration);
  await applyMigration(db, validationMigration);
  const table = kind === 'fc' ? 'fc_credentials' : `${kind}_accounts`;
  const key = kind === 'fc' ? 'fc_id' : 'id';
  await db.query('insert into fc_profiles values ($1, $2, true)', [id, phone]);
  await db.query(`insert into ${table} (${key}, phone) values ($1, $2)`, [id, phone]);
  async function rpc(action, hash = codeHash, options = {}) {
    const result = await db.query('select public.process_password_reset_challenge($1,$2,$3,$4,$5,$6,$7) result',
      [action, kind, options.id ?? id, options.phone ?? phone, hash, options.passwordHash ?? passwordHash, salt]);
    return result.rows[0].result;
  }
  async function row() { return (await db.query(`select * from ${table} where ${key}=$1`, [id])).rows[0]; }
  async function ageChallenge() { await db.exec(`update ${table} set reset_sent_at=now()-interval '61 seconds'`); }
  return { db, rpc, row, ageChallenge, table, key };
}

for (const kind of ['admin', 'manager', 'fc']) {
  test(`${kind}: five guesses exhaust only the challenge; resend replaces it atomically`, async () => {
    const f = await fixture(kind);
    try {
      assert.deepEqual(await f.rpc('issue'), { ok: true });
      const issued = await f.row();
      assert.equal(new Date(issued.reset_token_expires_at) - new Date(issued.reset_sent_at), 15 * 60 * 1000);
      for (let attempt = 1; attempt <= 5; attempt++) {
        const result = await f.rpc('consume', wrongHash);
        assert.equal(result.code, attempt === 5 ? 'attempts_exhausted' : 'invalid_token');
        assert.equal((await f.row()).reset_failed_count, attempt);
      }
      assert.equal((await f.rpc('consume')).code, 'attempts_exhausted');
      assert.equal((await f.rpc('issue', replacementHash)).code, 'cooldown');
      const exhausted = await f.row();
      assert.equal(exhausted.password_hash, 'old');
      assert.equal(exhausted.failed_count, 2);
      assert.equal(exhausted.locked_until, null);
      assert.deepEqual(exhausted.reset_token_expires_at, issued.reset_token_expires_at);
      await f.ageChallenge();
      assert.deepEqual(await f.rpc('issue', replacementHash), { ok: true });
      assert.equal((await f.row()).reset_failed_count, 0);
      assert.equal((await f.rpc('consume', codeHash)).code, 'invalid_token');
      assert.deepEqual(await f.rpc('consume', replacementHash), { ok: true });
      const consumed = await f.row();
      assert.equal(consumed.password_hash, passwordHash);
      assert.equal(consumed.reset_token_hash, null);
      assert.equal(consumed.reset_token_expires_at, null);
      assert.equal(consumed.failed_count, 0);
      if (kind === 'fc') {
        assert.equal(consumed.must_change_password, false);
        assert.equal(consumed.temporary_password_issued_at, null);
      }
      assert.equal((await f.rpc('consume', replacementHash)).code, 'invalid_token');
    } finally { await f.db.close(); }
  });

  test(`${kind}: overlapping valid attempts and resends have exactly one winner`, async () => {
    const f = await fixture(kind);
    try {
      const issue = await Promise.all([f.rpc('issue'), f.rpc('issue', replacementHash)]);
      assert.equal(issue.filter(r => r.ok).length, 1);
      assert.equal(issue.filter(r => r.code === 'cooldown').length, 1);
      const winnerHash = (await f.row()).reset_token_hash;
      const attempts = await Promise.all(Array.from({ length: 10 }, () => f.rpc('consume', winnerHash)));
      assert.equal(attempts.filter(r => r.ok).length, 1);
      assert.equal(attempts.filter(r => r.code === 'invalid_token').length, 9);
      assert.equal((await f.rpc('issue')).code, 'cooldown');
    } finally { await f.db.close(); }
  });

  test(`${kind}: expiry, changed eligibility, missing rows and malformed writes fail closed`, async () => {
    const f = await fixture(kind);
    try {
      assert.deepEqual(await f.rpc('issue'), { ok: true });
      await f.db.exec(`update ${f.table} set reset_token_expires_at=clock_timestamp()`);
      assert.equal((await f.rpc('consume')).code, 'expired_token');
      await f.ageChallenge(); await f.rpc('issue');
      assert.equal((await f.rpc('consume', codeHash, { phone: '00000000002' })).code, 'account_unavailable');
      assert.equal((await f.rpc('consume', codeHash, { passwordHash: 'invalid' })).code, 'invalid_request');
      await f.db.exec(kind === 'fc' ? 'update fc_profiles set signup_completed=false' : `update ${f.table} set active=false`);
      assert.equal((await f.rpc('consume')).code, 'account_unavailable');
      assert.equal((await f.rpc('issue')).code, 'account_unavailable');
      assert.equal((await f.row()).password_hash, 'old');
      await f.db.exec(`delete from ${f.table}`);
      assert.equal((await f.rpc('consume')).ok, false);
    } finally { await f.db.close(); }
  });
}

test('RPC is invoker-only, grants execution only to service_role, and snapshot matches migration', async () => {
  const f = await fixture('admin');
  try {
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`set role ${role}`);
      await assert.rejects(() => f.rpc('issue'), /permission denied for function/);
      await f.db.exec('reset role');
    }
    await f.db.exec('set role service_role');
    assert.deepEqual(await f.rpc('issue'), { ok: true });
    await f.db.exec('reset role');
    const flags = await f.db.query("select prosecdef from pg_proc where proname='process_password_reset_challenge'");
    assert.equal(flags.rows[0].prosecdef, false);
    await applyMigration(f.db, migration); // repeatable; no challenge reset on rerun
    await applyMigration(f.db, validationMigration);
    assert.equal((await f.rpc('issue')).code, 'cooldown');
    const rpcStart = migration.indexOf('create or replace function public.process_password_reset_challenge(');
    assert.ok(schema.includes(migration.slice(rpcStart)), 'schema snapshot must preserve the complete RPC and ACL');
    assert.match(migration, /for update[\s\S]*for update[\s\S]*checked_at := clock_timestamp\(\)/);
    assert.doesNotMatch(migration, /raise exception/i);
  } finally { await f.db.close(); }
});

test('staged constraints enforce writes before separate validation and preserve session timeouts', async () => {
  const f = await fixture('admin');
  try {
    await f.db.exec(`
      alter table admin_accounts drop constraint admin_accounts_reset_failed_count_check;
      alter table manager_accounts drop constraint manager_accounts_reset_failed_count_check;
      alter table fc_credentials drop constraint fc_credentials_reset_failed_count_check;
      set lock_timeout = '7s';
      set statement_timeout = '45s';
    `);
    await applyMigration(f.db, migration);
    const states = async () => (await f.db.query(`
      select convalidated from pg_constraint
      where conname in ('admin_accounts_reset_failed_count_check',
        'manager_accounts_reset_failed_count_check', 'fc_credentials_reset_failed_count_check')
    `)).rows.map(row => row.convalidated);
    assert.deepEqual(await states(), [false, false, false]);
    await assert.rejects(() => f.db.exec('update admin_accounts set reset_failed_count=6'), /check constraint/);
    assert.equal((await f.row()).reset_failed_count, 0);
    await applyMigration(f.db, validationMigration);
    assert.deepEqual(await states(), [true, true, true]);
    assert.equal((await f.db.query('show lock_timeout')).rows[0].lock_timeout, '7s');
    assert.equal((await f.db.query('show statement_timeout')).rows[0].statement_timeout, '45s');
    for (const sql of [migration, validationMigration]) {
      assert.match(sql, /set local lock_timeout = '3s'/);
      assert.match(sql, /set local statement_timeout = '30s'/);
    }
    assert.doesNotMatch(migration, /\bvalidate constraint\b/i);
  } finally { await f.db.close(); }
});

// Execute the real Edge handlers and RPC adapter, replacing only account
// lookup, SMS transport and the post-commit bridge network call.
async function loadTs(relativePath, dependencies, globals = {}) {
  const ts = require(process.env.TYPESCRIPT_MODULE_PATH ?? 'typescript');
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const exports = {};
  const names = Object.keys(globals);
  new Function('require', 'exports', ...names, code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected test dependency: ${name}`);
  }, exports, ...names.map(name => globals[name]));
  return exports;
}

async function edgeFixture(kind) {
  const f = await fixture(kind);
  const deliveries = [];
  const syncs = [];
  const account = { kind, id, phone, name: 'Fictional account', active: true,
    signupCompleted: true, passwordSetAt: '2026-01-01T00:00:00Z', resetTokenHash: null };
  let rpcFailure = false;
  const supabase = { rpc: async (_name, args) => {
    if (rpcFailure) return { error: { message: 'SYNTHETIC_PRIVATE_DATABASE_DIAGNOSTIC' }, data: null };
    const { rows } = await f.db.query('select public.process_password_reset_challenge($1,$2,$3,$4,$5,$6,$7) result',
      [args.p_action, args.p_account_kind, args.p_account_id, args.p_phone, args.p_token_hash, args.p_password_hash, args.p_password_salt]);
    return { data: rows[0].result, error: null };
  } };
  const adapter = await loadTs('../functions/_shared/password-reset-challenge.ts', {});
  async function handler(name, overrides = {}) {
    let serveHandler;
    const env = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
      NCP_SENS_ACCESS_KEY: 'synthetic-access', NCP_SENS_SECRET_KEY: 'synthetic-secret',
      NCP_SENS_SERVICE_ID: 'synthetic-service', NCP_SENS_SMS_FROM: phone, NODE_ENV: 'test', ...overrides };
    await loadTs(`../functions/${name}/index.ts`, {
      'https://deno.land/std@0.224.0/http/server.ts': { serve: callback => { serveHandler = callback; } },
      'https://esm.sh/@supabase/supabase-js@2.45.4': { createClient: () => supabase },
      '../_shared/password-reset-account.ts': {
        findPasswordResetAccount: async () => ({ account, error: null }),
        buildRequestBoardPasswordSyncOptions: () => kind === 'admin' ? null : { role: kind },
      },
      '../_shared/password-reset-challenge.ts': adapter,
      '../_shared/request-board-password-sync.ts': { syncRequestBoardPassword: async options => {
        assert.equal((await f.row()).reset_token_hash, null, 'sync must start after durable consume');
        syncs.push(options);
      } },
    }, {
      globalThis: { Deno: { env: { get: key => env[key] } } }, crypto: webcrypto,
      fetch: async (_url, options) => {
        deliveries.push(JSON.parse(options.body));
        return new Response('{}', { status: 200 });
      },
    });
    return async body => {
      const response = await serveHandler(new Request('http://localhost/fixture', {
        method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
      }));
      return { status: response.status, body: await response.json() };
    };
  }
  return { ...f, handler, deliveries, syncs, failRpc: () => { rpcFailure = true; } };
}

for (const kind of ['admin', 'manager', 'fc']) {
  test(`${kind}: real Edge handlers count failures and only the successful reset syncs`, async () => {
    const f = await edgeFixture(kind);
    try {
      const requestCode = await f.handler('request-password-reset');
      const issued = await Promise.all([requestCode({ phone }), requestCode({ phone })]);
      assert.equal(issued.filter(r => r.body.ok).length, 1);
      assert.equal(issued.filter(r => r.status === 429).length, 1);
      assert.equal(f.deliveries.length, 1);
      const code = f.deliveries[0].content.match(/: (\d{6}) /)[1];
      assert.equal((await f.row()).reset_token_hash, Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(code))).toString('base64'));
      const reset = await f.handler('reset-password');
      const wrong = await reset({ phone, token: '000000', newPassword: 'SyntheticA!23' });
      assert.equal(wrong.body.code, 'invalid_token');
      assert.equal((await f.row()).reset_failed_count, 1);
      assert.equal(f.syncs.length, 0);
      const candidates = ['SyntheticA!23', 'SyntheticB!45'];
      const results = await Promise.all(candidates.map(newPassword => reset({ phone, token: code, newPassword })));
      assert.equal(results.filter(r => r.body.ok).length, 1);
      const winner = results.findIndex(r => r.body.ok);
      const saved = await f.row();
      assert.equal(saved.password_hash, pbkdf2Sync(candidates[winner], Buffer.from(saved.password_salt, 'base64'), 100000, 32, 'sha256').toString('base64'));
      assert.equal(f.syncs.length, kind === 'admin' ? 0 : 1);
      if (kind !== 'admin') assert.equal(f.syncs[0].password, candidates[winner]);
    } finally { await f.db.close(); }
  });
}

test('Edge failures are safe, do not send SMS/sync, and hosted SMS bypass remains prohibited', async () => {
  const f = await edgeFixture('fc');
  try {
    await assert.rejects(() => f.handler('reset-password', { SMS_BYPASS_ENABLED: 'true', SMS_BYPASS_CODE: '123456', DENO_DEPLOYMENT_ID: 'synthetic-hosted' }), /must not be enabled in production/);
    await assert.rejects(() => f.handler('request-password-reset', { TEST_SMS_MODE: 'true', TEST_SMS_CODE: '123456', DENO_DEPLOYMENT_ID: 'synthetic-hosted' }), /must not be enabled in production/);
    const requestCode = await f.handler('request-password-reset');
    const reset = await f.handler('reset-password');
    f.failRpc();
    for (const result of [await requestCode({ phone }), await reset({ phone, token: '123456', newPassword: 'SyntheticA!23' })]) {
      assert.equal(result.status, 500);
      assert.equal(result.body.code, 'db_error');
      assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE/);
    }
    assert.equal(f.deliveries.length, 0);
    assert.equal(f.syncs.length, 0);
  } finally { await f.db.close(); }
});

test('failed password write rolls back challenge consumption and never starts bridge sync', async () => {
  const f = await edgeFixture('fc');
  try {
    const requestCode = await f.handler('request-password-reset');
    const reset = await f.handler('reset-password');
    await requestCode({ phone });
    const token = f.deliveries[0].content.match(/: (\d{6}) /)[1];
    const before = await f.row();
    await f.db.exec(`
      create function fail_synthetic_password_write() returns trigger language plpgsql as $$
      begin
        if new.password_hash is distinct from old.password_hash then
          raise exception 'SYNTHETIC_PRIVATE_WRITE_DIAGNOSTIC';
        end if;
        return new;
      end $$;
      create trigger reject_synthetic_password before update on fc_credentials
      for each row execute function fail_synthetic_password_write();
    `);
    const result = await reset({ phone, token, newPassword: 'SyntheticA!23' });
    assert.equal(result.status, 500);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE/);
    const after = await f.row();
    assert.equal(after.password_hash, before.password_hash);
    assert.equal(after.reset_token_hash, before.reset_token_hash);
    assert.deepEqual(after.reset_token_expires_at, before.reset_token_expires_at);
    assert.equal(f.syncs.length, 0);
    await f.db.exec('drop trigger reject_synthetic_password on fc_credentials');
    assert.equal((await reset({ phone, token, newPassword: 'SyntheticA!23' })).body.ok, true);
    assert.equal(f.syncs.length, 1);
  } finally { await f.db.close(); }
});
