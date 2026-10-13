// Isolated PGlite coverage for serialized login failure counters.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const { PGlite } = createRequire(import.meta.url)(
  process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite',
);
const migration = await readFile(
  new URL('../migrations/20261013063142_atomic_password_login_attempts.sql', import.meta.url),
  'utf8',
);
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');

const adminId = '10000000-0000-4000-8000-000000000001';
const managerId = '10000000-0000-4000-8000-000000000002';
const fcId = '10000000-0000-4000-8000-000000000003';
const correctHash = Buffer.alloc(32, 1).toString('base64');
const wrongHash = Buffer.alloc(32, 2).toString('base64');
const salt = Buffer.alloc(16, 3).toString('base64');

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.admin_accounts (
      id uuid primary key, phone text not null unique, active boolean default true,
      password_hash text not null, password_salt text not null, password_set_at timestamptz,
      failed_count integer not null default 0, locked_until timestamptz
    );
    create table public.manager_accounts (
      id uuid primary key, phone text not null unique, active boolean default true,
      password_hash text not null, password_salt text not null, password_set_at timestamptz,
      failed_count integer not null default 0, locked_until timestamptz
    );
    create table public.fc_profiles (
      id uuid primary key, phone text not null unique,
      signup_completed boolean not null default false,
      is_manager_referral_shadow boolean not null default false
    );
    create table public.fc_credentials (
      fc_id uuid primary key references public.fc_profiles(id),
      password_hash text not null, password_salt text not null, password_set_at timestamptz,
      failed_count integer not null default 0, locked_until timestamptz
    );
    insert into public.admin_accounts
      (id,phone,password_hash,password_salt,password_set_at)
      values ('${adminId}','01000000001','${correctHash}','${salt}',now());
    insert into public.manager_accounts
      (id,phone,password_hash,password_salt,password_set_at)
      values ('${managerId}','01000000002','${correctHash}','${salt}',now());
    insert into public.fc_profiles (id,phone,signup_completed)
      values ('${fcId}','01000000003',true);
    insert into public.fc_credentials
      (fc_id,password_hash,password_salt,password_set_at)
      values ('${fcId}','${correctHash}','${salt}',now());
  `);
  await db.exec(migration);

  const identities = {
    admin: { id: adminId, phone: '01000000001' },
    manager: { id: managerId, phone: '01000000002' },
    fc: { id: fcId, phone: '01000000003' },
  };
  async function attempt(kind, candidateHash = wrongHash) {
    const account = identities[kind];
    return (await db.query(
      'select public.process_password_login_attempt_v1($1,$2,$3,$4) receipt',
      [kind, account.id, account.phone, candidateHash],
    )).rows[0].receipt;
  }
  return { db, attempt };
}

for (const kind of ['admin', 'manager', 'fc']) {
  test(`${kind} parallel wrong passwords atomically reach the fifth-attempt lock`, async () => {
    const f = await fixture();
    try {
      const attempts = await Promise.all(Array.from({ length: 5 }, () => f.attempt(kind)));
      assert.equal(attempts.filter((receipt) => receipt.code === 'invalid_password').length, 4);
      assert.equal(attempts.filter((receipt) => receipt.code === 'locked').length, 1);
      const table = kind === 'fc' ? 'fc_credentials' : `${kind}_accounts`;
      const key = kind === 'fc' ? 'fc_id' : 'id';
      const id = kind === 'admin' ? adminId : kind === 'manager' ? managerId : fcId;
      const state = (await f.db.query(
        `select failed_count,locked_until from public.${table} where ${key}=$1`,
        [id],
      )).rows[0];
      assert.equal(state.failed_count, 0);
      assert.ok(state.locked_until);
      assert.equal((await f.attempt(kind, correctHash)).code, 'locked');
    } finally {
      await f.db.close();
    }
  });
}

test('a successful comparison resets stale failure state and returns an exact bounded receipt', async () => {
  const f = await fixture();
  try {
    await f.db.query(
      `update public.admin_accounts
       set failed_count=3,locked_until=now()-interval '1 second' where id=$1`,
      [adminId],
    );
    const receipt = await f.attempt('admin', correctHash);
    assert.deepEqual(receipt, {
      ok: true,
      code: 'authenticated',
      accountKind: 'admin',
      accountId: adminId,
      residentId: '01000000001',
    });
    assert.equal(JSON.stringify(receipt).includes(correctHash), false);
    const state = (await f.db.query(
      'select failed_count,locked_until from public.admin_accounts where id=$1',
      [adminId],
    )).rows[0];
    assert.equal(state.failed_count, 0);
    assert.equal(state.locked_until, null);
  } finally {
    await f.db.close();
  }
});

test('the RPC rejects inactive staff and manager-shadow FC rows without trusting Edge prechecks', async () => {
  const f = await fixture();
  try {
    await f.db.query('update public.admin_accounts set active=null where id=$1', [adminId]);
    assert.deepEqual(await f.attempt('admin', correctHash), {
      ok: false,
      code: 'account_unavailable',
    });

    await f.db.query('update public.manager_accounts set active=false where id=$1', [managerId]);
    assert.deepEqual(await f.attempt('manager', correctHash), {
      ok: false,
      code: 'account_unavailable',
    });

    await f.db.query(
      'update public.fc_profiles set is_manager_referral_shadow=true where id=$1',
      [fcId],
    );
    assert.deepEqual(await f.attempt('fc', correctHash), {
      ok: false,
      code: 'account_unavailable',
    });
  } finally {
    await f.db.close();
  }
});

test('counter update failures roll back and surface instead of authenticating', async () => {
  const f = await fixture();
  try {
    await f.db.exec(`
      create function reject_login_counter_write() returns trigger language plpgsql as $$
      begin raise exception 'synthetic_login_counter_failure'; end $$;
      create trigger reject_login_counter before update on public.admin_accounts
      for each row execute function reject_login_counter_write();
    `);
    await assert.rejects(f.attempt('admin'), /synthetic_login_counter_failure/);
    assert.equal((await f.db.query(
      'select failed_count from public.admin_accounts where id=$1',
      [adminId],
    )).rows[0].failed_count, 0);
  } finally {
    await f.db.close();
  }
});

test('login attempt RPC is service-role only, definer-owned, and mirrored in schema', async () => {
  const f = await fixture();
  try {
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`set role ${role}`);
      await assert.rejects(f.attempt('admin'), /permission denied for function/);
      await f.db.exec('reset role');
    }
    const metadata = (await f.db.query(`
      select prosecdef from pg_proc where proname='process_password_login_attempt_v1'
    `)).rows[0];
    assert.equal(metadata.prosecdef, true);
    assert.ok(schema.replaceAll('\r\n', '\n').includes(migration.replaceAll('\r\n', '\n').trim()));
  } finally {
    await f.db.close();
  }
});
