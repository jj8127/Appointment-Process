// Isolated PostgreSQL tests for the two final onboarding transaction boundaries.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const { PGlite } = createRequire(import.meta.url)(
  process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite',
);
const migration = await readFile(
  new URL('../migrations/20261013063140_atomic_onboarding_writes.sql', import.meta.url),
  'utf8',
);
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');

const fcId = '10000000-0000-4000-8000-000000000001';
const secondFcId = '10000000-0000-4000-8000-000000000002';
const phone = '01000000001';
const secondPhone = '01000000002';
const residentHash = Buffer.alloc(32, 7).toString('base64');
const passwordHash = Buffer.alloc(32, 8).toString('base64');
const passwordSalt = Buffer.alloc(16, 9).toString('base64');

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    grant usage on schema public to anon, authenticated, service_role;

    create table public.fc_profiles (
      id uuid primary key,
      phone text not null unique,
      name text,
      resident_id_masked text,
      resident_id_hash text unique,
      address text,
      address_detail text,
      identity_completed boolean not null default false,
      signup_completed boolean not null default false,
      phone_verified boolean not null default false,
      signup_verification_method text,
      signup_verified_at timestamptz,
      signup_verified_by_admin_id uuid,
      is_manager_referral_shadow boolean not null default false
    );
    create table public.fc_identity_secure (
      id uuid primary key default gen_random_uuid(),
      fc_id uuid not null unique references public.fc_profiles(id) on delete cascade,
      resident_number_encrypted text not null,
      address_encrypted text not null,
      address_detail_encrypted text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.fc_credentials (
      fc_id uuid primary key references public.fc_profiles(id) on delete cascade,
      password_hash text not null,
      password_salt text not null,
      password_set_at timestamptz,
      failed_count integer not null default 0,
      locked_until timestamptz,
      reset_token_hash text,
      reset_token_expires_at timestamptz,
      reset_sent_at timestamptz,
      reset_failed_count integer not null default 0,
      must_change_password boolean not null default false,
      temporary_password_issued_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(migration);
  await db.query(
    `insert into public.fc_profiles (id,phone,name,phone_verified)
     values ($1,$2,'Synthetic FC',true),($3,$4,'Rollback FC',true)`,
    [fcId, phone, secondFcId, secondPhone],
  );

  async function storeIdentity(options = {}) {
    const result = await db.query(
      'select public.store_fc_identity_atomic_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) receipt',
      [
        options.fcId ?? fcId,
        options.phone ?? phone,
        options.residentEncrypted === undefined
          ? 'encrypted-resident-material'
          : options.residentEncrypted,
        options.masked === undefined ? '900101-*******' : options.masked,
        options.hash === undefined ? residentHash : options.hash,
        options.address ?? 'Synthetic address',
        options.addressDetail === undefined ? 'Unit 1' : options.addressDetail,
        options.addressEncrypted ?? 'encrypted-address-material',
        options.addressDetailEncrypted === undefined
          ? 'encrypted-address-detail'
          : options.addressDetailEncrypted,
      ],
    );
    return result.rows[0].receipt;
  }

  async function completeSignup(options = {}) {
    const result = await db.query(
      'select public.complete_fc_signup_atomic_v1($1,$2,$3,$4) receipt',
      [
        options.fcId ?? fcId,
        options.phone ?? phone,
        options.passwordHash ?? passwordHash,
        options.passwordSalt ?? passwordSalt,
      ],
    );
    return result.rows[0].receipt;
  }

  return { db, storeIdentity, completeSignup };
}

test('identity RPC commits encrypted and profile state together and returns only a bounded receipt', async () => {
  const f = await fixture();
  try {
    const receipt = await f.storeIdentity();
    assert.deepEqual(receipt, {
      ok: true,
      fcId,
      residentId: phone,
      identityCompleted: true,
    });
    assert.equal(JSON.stringify(receipt).includes(residentHash), false);
    assert.equal(JSON.stringify(receipt).includes('encrypted-'), false);
    const state = (await f.db.query(`select
      profile.resident_id_masked,
      profile.resident_id_hash,
      profile.identity_completed,
      secure.resident_number_encrypted,
      secure.address_encrypted
      from public.fc_profiles profile
      join public.fc_identity_secure secure on secure.fc_id=profile.id
      where profile.id=$1`, [fcId])).rows[0];
    assert.equal(state.identity_completed, true);
    assert.equal(state.resident_id_hash, residentHash);
    assert.equal(state.resident_number_encrypted, 'encrypted-resident-material');

    const addressReceipt = await f.storeIdentity({
      residentEncrypted: null,
      masked: null,
      hash: null,
      address: 'Changed address',
      addressDetail: null,
      addressEncrypted: 'changed-encrypted-address',
      addressDetailEncrypted: null,
    });
    assert.deepEqual(addressReceipt, receipt);
    const changed = (await f.db.query(
      `select profile.address,secure.address_encrypted
       from public.fc_profiles profile join public.fc_identity_secure secure on secure.fc_id=profile.id
       where profile.id=$1`,
      [fcId],
    )).rows[0];
    assert.equal(changed.address, 'Changed address');
    assert.equal(changed.address_encrypted, 'changed-encrypted-address');
  } finally {
    await f.db.close();
  }
});

test('identity profile failure rolls back the preceding secure identity upsert', async () => {
  const f = await fixture();
  try {
    await f.db.exec(`
      create function reject_identity_profile_write() returns trigger language plpgsql as $$
      begin
        if new.identity_completed then raise exception 'synthetic_profile_failure'; end if;
        return new;
      end $$;
      create trigger reject_identity_profile before update on public.fc_profiles
      for each row execute function reject_identity_profile_write();
    `);
    await assert.rejects(
      f.storeIdentity({ fcId: secondFcId, phone: secondPhone }),
      /synthetic_profile_failure/,
    );
    assert.equal((await f.db.query(
      'select count(*)::int count from public.fc_identity_secure where fc_id=$1',
      [secondFcId],
    )).rows[0].count, 0);
    const profile = (await f.db.query(
      'select identity_completed,resident_id_hash from public.fc_profiles where id=$1',
      [secondFcId],
    )).rows[0];
    assert.equal(profile.identity_completed, false);
    assert.equal(profile.resident_id_hash, null);
  } finally {
    await f.db.close();
  }
});

test('credential failure rolls back signup completion and a retry commits both rows', async () => {
  const f = await fixture();
  try {
    await f.db.exec(`
      create function reject_signup_credential_write() returns trigger language plpgsql as $$
      begin raise exception 'synthetic_credential_failure'; end $$;
      create trigger reject_signup_credential before insert or update on public.fc_credentials
      for each row execute function reject_signup_credential_write();
    `);
    await assert.rejects(f.completeSignup(), /synthetic_credential_failure/);
    assert.equal((await f.db.query(
      'select signup_completed from public.fc_profiles where id=$1',
      [fcId],
    )).rows[0].signup_completed, false);
    assert.equal((await f.db.query(
      'select count(*)::int count from public.fc_credentials where fc_id=$1',
      [fcId],
    )).rows[0].count, 0);

    await f.db.exec('drop trigger reject_signup_credential on public.fc_credentials');
    const receipt = await f.completeSignup();
    assert.equal(receipt.ok, true);
    assert.equal(receipt.fcId, fcId);
    assert.equal(receipt.residentId, phone);
    assert.equal(receipt.displayName, 'Synthetic FC');
    assert.equal(receipt.signupCompleted, true);
    assert.ok(Number.isFinite(Date.parse(receipt.passwordSetAt)));
    assert.equal(JSON.stringify(receipt).includes(passwordHash), false);
    const state = (await f.db.query(`select
      profile.signup_completed,
      profile.signup_verification_method,
      credential.password_hash,
      credential.password_set_at,
      credential.must_change_password
      from public.fc_profiles profile
      join public.fc_credentials credential on credential.fc_id=profile.id
      where profile.id=$1`, [fcId])).rows[0];
    assert.equal(state.signup_completed, true);
    assert.equal(state.signup_verification_method, 'phone_otp');
    assert.equal(state.password_hash, passwordHash);
    assert.ok(state.password_set_at);
    assert.equal(state.must_change_password, false);
  } finally {
    await f.db.close();
  }
});

test('both definer RPCs are executable only by service_role and schema preserves the migration', async () => {
  const f = await fixture();
  try {
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`set role ${role}`);
      await assert.rejects(f.storeIdentity(), /permission denied for function/);
      await assert.rejects(f.completeSignup(), /permission denied for function/);
      await f.db.exec('reset role');
    }

    const metadata = await f.db.query(`select proname,prosecdef from pg_proc
      where proname in ('store_fc_identity_atomic_v1','complete_fc_signup_atomic_v1')
      order by proname`);
    assert.equal(metadata.rows.length, 2);
    assert.ok(metadata.rows.every((row) => row.prosecdef === true));

    await f.db.exec('set role service_role');
    assert.equal((await f.storeIdentity()).ok, true);
    await f.db.exec('reset role');
    await f.db.exec(migration);

    const normalizedSchema = schema.replaceAll('\r\n', '\n');
    const normalizedMigration = migration.replaceAll('\r\n', '\n').trim();
    assert.ok(normalizedSchema.includes(normalizedMigration));
    assert.doesNotMatch(migration, /p_resident_number\s+text/i);
    assert.doesNotMatch(migration, /p_password\s+text/i);
  } finally {
    await f.db.close();
  }
});
