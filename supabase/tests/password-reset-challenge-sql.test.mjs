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

async function fixture(kind, currentReset = false) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.fc_profiles (id uuid primary key, phone text, signup_completed boolean,
      is_manager_referral_shadow boolean not null default false, affiliation text, status text default 'draft');
    create table public.platform_members (id uuid primary key, phone text, active boolean, fc_id uuid);
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
    grant select, insert, update on all tables in schema public to service_role;
  `);
  await applyMigration(db, migration);
  await applyMigration(db, validationMigration);
  if (currentReset) {
    const unified = await readFile(new URL('../migrations/20261014043557_unified_common_insurance_enrollment.sql', import.meta.url), 'utf8');
    const definition = unified.match(/create or replace function public\.process_password_reset_challenge\([\s\S]*?\n\$\$;/);
    assert.ok(definition, 'unified migration must preserve the existing reset RPC with its recovery extension');
    await db.exec(definition[0]);
    await db.exec('alter table fc_credentials add column session_version bigint not null default 0');
    const generations = await readFile(new URL('../migrations/20261004133155_credential_session_generations.sql', import.meta.url), 'utf8');
    await db.exec(generations.slice(generations.indexOf('create or replace function public.advance_credential_session_version()'),
      generations.indexOf('-- The service verifies')));
    await db.exec('create trigger credential_session_version before update on fc_credentials for each row execute function advance_credential_session_version()');
    const wrappers = await readFile(new URL('../migrations/20261013094543_fc_password_sync_generation_results.sql', import.meta.url), 'utf8');
    await db.exec(wrappers.slice(wrappers.indexOf('create or replace function public.process_password_reset_challenge_v2(')));
  }
  const table = kind === 'fc' ? 'fc_credentials' : `${kind}_accounts`;
  const key = kind === 'fc' ? 'fc_id' : 'id';
  await db.query('insert into fc_profiles(id,phone,signup_completed) values ($1, $2, true)', [id, phone]);
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
    assert.ok(schema.replaceAll('\r\n','\n').includes(migration.slice(rpcStart).replaceAll('\r\n','\n')), 'schema snapshot must preserve the complete RPC and ACL');
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
// lookup, SMS transport, delivery-ledger adapter and the post-commit bridge network call.
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

const accountHelpers = await loadTs('../functions/_shared/password-reset-account.ts', {
  './manager-affiliation.ts': { resolveManagerAffiliation: name => name },
  './request-board-auth.ts': { parseDesignerCompanyNameFromAffiliation: affiliation =>
    affiliation?.includes('설계매니저') ? 'Synthetic company' : null },
});

async function edgeFixture(kind, { currentReset = false, accountOverrides = {} } = {}) {
  const f = await fixture(kind, currentReset);
  const deliveries = [];
  const tracking = [];
  const syncs = [];
  const account = { kind, id, phone, name: 'Fictional account', active: true,
    signupCompleted: true, passwordSetAt: '2026-01-01T00:00:00Z', resetTokenHash: null,
    ...accountOverrides };
  let rpcFailure = false;
  let trackingBeginOk = true;
  let trackingFinalizeOk = true;
  let smsResultOverride = null;
  const supabase = { rpc: async (name, args) => {
    if (rpcFailure) return { error: { message: 'SYNTHETIC_PRIVATE_DATABASE_DIAGNOSTIC' }, data: null };
    if (name === 'cancel_password_reset_challenge') {
      const cancelled = await f.db.query(`update ${f.table}
        set reset_token_hash=null,reset_token_expires_at=null,reset_sent_at=null,reset_failed_count=0
        where ${f.key}=$1 and reset_token_hash=$2 returning ${f.key}`,
      [args.p_account_id,args.p_token_hash]);
      return { data: cancelled.rows.length ? { ok: true, cancelled: true } : { ok: false, code: 'stale_challenge' }, error: null };
    }
    assert.equal(name, 'process_password_reset_challenge_v2');
    const { rows } = await f.db.query(`select public.${currentReset ? 'process_password_reset_challenge_v2' : 'process_password_reset_challenge'}($1,$2,$3,$4,$5,$6,$7) result`,
      [args.p_action, args.p_account_kind, args.p_account_id, args.p_phone, args.p_token_hash, args.p_password_hash, args.p_password_salt]);
    const result = rows[0].result;
    return {
      data: !currentReset && result?.ok === true && args.p_action === 'consume' && args.p_account_kind === 'fc'
        ? { ...result, sessionVersion: 1 }
        : result,
      error: null,
    };
  } };
  const adapter = await loadTs('../functions/_shared/password-reset-challenge.ts', {});
  async function handler(name, overrides = {}) {
    let serveHandler;
    const env = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
      NCP_SENS_ACCESS_KEY: 'synthetic-access', NCP_SENS_SECRET_KEY: 'synthetic-secret',
      NCP_SENS_SERVICE_ID: 'synthetic-service', NCP_SENS_SMS_FROM: phone, NODE_ENV: 'test', ...overrides };
    await loadTs(`../functions/${name}/index.ts`, {
      'https://deno.land/std@0.224.0/http/server.ts': { serve: callback => { serveHandler = callback; } },
      '../_shared/serve-with-cors.ts': { serveWithConfiguredCors: callback => { serveHandler = callback; } },
      'https://esm.sh/@supabase/supabase-js@2.45.4': { createClient: () => supabase },
      '../_shared/password-reset-account.ts': {
        canInitializeFcPassword: accountHelpers.canInitializeFcPassword,
        findPasswordResetAccount: async () => ({ account, error: null }),
        buildRequestBoardPasswordSyncOptions: () => kind === 'admin' ? null : { role: kind },
      },
      '../_shared/password-reset-challenge.ts': adapter,
      '../_shared/sms-delivery-attempt.ts': {
        beginSmsDeliveryAttempt: async (_client, purpose) => {
          tracking.push({ phase: 'begin', purpose });
          return trackingBeginOk
            ? { ok: true, deliveryId: '20000000-0000-4000-8000-000000000001' }
            : { ok: false };
        },
        finalizeSmsDeliveryAttempt: async (_client, purpose, deliveryId, result) => {
          tracking.push({ phase: 'finalize', purpose, deliveryId, result });
          return trackingFinalizeOk;
        },
      },
      '../_shared/signup-sms.ts': { sendSignupSms: async (to, _code, content) => {
        deliveries.push({ content, messages: [{ to }] });
        return smsResultOverride ?? { ok: true, deliveryState: 'accepted', status: 200,
          providerRequestId: 'synthetic-request', providerStatusCode: '202' };
      } },
      '../_shared/request-board-password-sync.ts': { syncRequestBoardPassword: async options => {
        assert.equal((await f.row()).reset_token_hash, null, 'sync must start after durable consume');
        syncs.push(options);
      }, buildFcPasswordSyncUpstream: (fcId, sessionVersion) => ({
        accountId: `fc:${fcId}`,
        credentialVersion: sessionVersion,
      }) },
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
  return { ...f, handler, deliveries, tracking, syncs,
    failRpc: () => { rpcFailure = true; },
    failTrackingBegin: () => { trackingBeginOk = false; },
    failTrackingFinalize: () => { trackingFinalizeOk = false; },
    rejectSms: () => { smsResultOverride = { ok: false, deliveryState: 'rejected', status: 502,
      reason: 'provider_rejected', providerRequestId: null, providerStatusCode: '400', message: 'safe' }; },
  };
}

test('missing FC passwords require completed ordinary identities and preserve staff/designer boundaries', async () => {
  const base = { kind: 'fc', signupCompleted: true, isManagerReferralShadow: false, affiliation: 'Synthetic headquarters' };
  assert.equal(accountHelpers.canInitializeFcPassword(base), true);
  for (const input of [
    { ...base, signupCompleted: false }, { ...base, signupCompleted: null },
    { ...base, isManagerReferralShadow: true }, { ...base, affiliation: 'Synthetic 설계매니저' },
    { ...base, kind: 'admin' }, { ...base, kind: 'manager' },
  ]) assert.equal(accountHelpers.canInitializeFcPassword(input), false);
  const profile = { id, phone, name: 'Synthetic FC', signup_completed: true,
    affiliation: 'Synthetic headquarters', is_manager_referral_shadow: true };
  const lookup = { from: table => {
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: table === 'fc_profiles' ? profile : null, error: null }) };
    return query;
  } };
  const found = await accountHelpers.findPasswordResetAccount(lookup, phone);
  assert.equal(found.account.isManagerReferralShadow, true);
  profile.is_manager_referral_shadow = 'invalid';
  assert.ok((await accountHelpers.findPasswordResetAccount(lookup, phone)).error);

  for (const [kind, accountOverrides, code] of [
    ['fc', { signupCompleted: false, passwordSetAt: null }, 'not_completed'],
    ['fc', { isManagerReferralShadow: true, passwordSetAt: null }, 'not_completed'],
    ['fc', { affiliation: 'Synthetic 설계매니저', passwordSetAt: null }, 'not_set'],
    ['admin', { passwordSetAt: null }, 'not_set'],
    ['manager', { passwordSetAt: null }, 'not_set'],
  ]) {
    const f = await edgeFixture(kind, { accountOverrides });
    try {
      for (const [handler, body] of [
        ['request-password-reset', { phone }],
        ['reset-password', { phone, token: '123456', newPassword: 'SyntheticA!23' }],
      ]) assert.equal((await (await f.handler(handler))(body)).body.code, code);
      assert.equal(f.deliveries.length, 0);
      assert.equal(f.syncs.length, 0);
      assert.equal((await f.row()).reset_token_hash, null);
    } finally { await f.db.close(); }
  }
});

test('initial FC credential creation rejects ineligible sources and keeps five-guess/cooldown limits', async () => {
  const f = await fixture('fc', true);
  try {
    await f.db.query('delete from fc_credentials');
    for (const patch of [
      "signup_completed=false", "signup_completed=true,is_manager_referral_shadow=true",
      "is_manager_referral_shadow=false,affiliation='Synthetic 설계매니저'",
    ]) {
      await f.db.exec(`update fc_profiles set ${patch}`);
      assert.equal((await f.rpc('issue')).code, 'account_unavailable');
      assert.equal(Number((await f.db.query('select count(*) n from fc_credentials')).rows[0].n), 0);
    }
    await f.db.query("update fc_profiles set affiliation='Synthetic headquarters'");
    for (const table of ['admin_accounts', 'manager_accounts']) {
      await f.db.query(`insert into ${table}(id,phone,password_set_at) values($1,$2,null)`, [id, phone]);
      assert.equal((await f.rpc('issue')).code, 'account_unavailable');
      assert.equal(Number((await f.db.query('select count(*) n from fc_credentials')).rows[0].n), 0);
      await f.db.query(`delete from ${table}`);
    }
    assert.equal((await f.rpc('issue')).ok, true);
    const initial = await f.row();
    await f.db.query('update fc_profiles set is_manager_referral_shadow=true');
    assert.equal((await f.rpc('consume')).code, 'account_unavailable');
    assert.equal((await f.row()).reset_failed_count, 0);
    await f.db.query('update fc_profiles set is_manager_referral_shadow=false');
    for (let guess = 0; guess < 5; guess++) {
      assert.equal((await f.rpc('consume', wrongHash)).code, guess === 4 ? 'attempts_exhausted' : 'invalid_token');
    }
    assert.equal((await f.rpc('consume')).code, 'attempts_exhausted');
    assert.equal((await f.rpc('issue')).code, 'cooldown');
    assert.equal((await f.row()).password_set_at, null);
    await f.ageChallenge();
    assert.equal((await f.rpc('issue', replacementHash)).ok, true);
    assert.equal((await f.rpc('consume', replacementHash)).ok, true);
    assert.equal(Number((await f.row()).session_version), Number(initial.session_version) + 1);
  } finally { await f.db.close(); }
});

test('completed FC missing credentials uses the same SMS proof once without rewriting the workflow', async () => {
  for (const missingRow of [true, false]) {
    const f = await edgeFixture('fc', { currentReset: true, accountOverrides: { passwordSetAt: null } });
    try {
      await f.db.query("update fc_profiles set status='appointment-completed'");
      if (missingRow) await f.db.query('delete from fc_credentials');
      else await f.db.query('update fc_credentials set password_set_at=null');
      const profileBefore = (await f.db.query('select * from fc_profiles')).rows[0];
      const reset = await f.handler('reset-password');
      assert.equal((await reset({ phone, token: '123456', newPassword: 'SyntheticA!23' })).body.ok, false);
      assert.equal(f.syncs.length, 0);
      const requestCode = await f.handler('request-password-reset');
      assert.equal((await requestCode({ phone })).body.ok, true);
      assert.equal((await f.row()).password_set_at, null);
      assert.equal((await requestCode({ phone })).status, 429);
      const token = f.deliveries[0].content.match(/: (\d{6}) /)[1];
      assert.equal((await reset({ phone, token: token === '000000' ? '000001' : '000000', newPassword: 'SyntheticA!23' })).body.code, 'invalid_token');
      assert.equal((await f.row()).password_set_at, null);
      assert.equal((await reset({ phone, token, newPassword: 'SyntheticA!23' })).body.ok, true);
      assert.ok((await f.row()).password_set_at);
      assert.equal(f.syncs.length, 1);
      assert.equal(f.syncs[0].upstream.credentialVersion, Number((await f.row()).session_version));
      assert.equal((await reset({ phone, token, newPassword: 'SyntheticB!45' })).body.code, 'invalid_token');
      assert.equal(f.syncs.length, 1);
      assert.deepEqual((await f.db.query('select * from fc_profiles')).rows[0], profileBefore);
    } finally { await f.db.close(); }
  }
});

for (const kind of ['admin', 'manager', 'fc']) {
  test(`${kind}: real Edge handlers count failures and only the successful reset syncs`, async () => {
    const f = await edgeFixture(kind);
    try {
      const requestCode = await f.handler('request-password-reset');
      const issued = await Promise.all([requestCode({ phone }), requestCode({ phone })]);
      assert.equal(issued.filter(r => r.body.ok).length, 1);
      assert.equal(issued.filter(r => r.status === 429).length, 1);
      assert.equal(f.deliveries.length, 1);
      assert.deepEqual(f.tracking.map(item=>[item.phase,item.purpose]),[
        ['begin','password_reset'],['finalize','password_reset'],
      ]);
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
      if (kind === 'fc') assert.deepEqual(f.syncs[0].upstream, {
        accountId: `fc:${id}`,
        credentialVersion: 1,
      });
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

test('password reset never sends untracked SMS and compensates definite rejection only', async () => {
  const beginFailure = await edgeFixture('fc');
  try {
    beginFailure.failTrackingBegin();
    const requestCode = await beginFailure.handler('request-password-reset');
    const result = await requestCode({ phone });
    assert.equal(result.status, 503);assert.equal(result.body.code, 'sms_send_failed');
    assert.equal(beginFailure.deliveries.length, 0);
    assert.equal((await beginFailure.row()).reset_token_hash, null);
  } finally { await beginFailure.db.close(); }

  const finalizeFailure = await edgeFixture('fc');
  try {
    finalizeFailure.failTrackingFinalize();
    const requestCode = await finalizeFailure.handler('request-password-reset');
    const result = await requestCode({ phone });
    assert.equal(result.status, 503);assert.equal(result.body.code, 'sms_delivery_unknown');
    assert.equal(finalizeFailure.deliveries.length, 1);
    assert.notEqual((await finalizeFailure.row()).reset_token_hash, null);
  } finally { await finalizeFailure.db.close(); }

  const rejection = await edgeFixture('fc');
  try {
    rejection.rejectSms();
    const requestCode = await rejection.handler('request-password-reset');
    const result = await requestCode({ phone });
    assert.equal(result.status, 502);assert.equal(result.body.code, 'sms_send_failed');
    assert.equal(rejection.deliveries.length, 1);
    assert.equal((await rejection.row()).reset_token_hash, null);
  } finally { await rejection.db.close(); }
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
