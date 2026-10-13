// Real, independent PostgreSQL connections against a disposable loopback
// cluster. Never accepts a remote host or production credentials.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import test, { after, before } from 'node:test';

const require = createRequire(import.meta.url);
const { Client } = require(process.env.PG_MODULE_PATH ?? 'pg');
const port = Number(process.env.CI_TEST_LOOPBACK_POSTGRES_PORT ?? process.env.OTP_TEST_POSTGRES_PORT);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'explicit disposable loopback port required');

const database = `fc_signup_otp_${process.pid}`;
const config = {
  host: '127.0.0.1',
  port,
  user: 'otp_fixture',
  password: 'synthetic-local-only',
  ssl: false,
  connectionTimeoutMillis: 3000,
  options: '-c statement_timeout=8000 -c lock_timeout=6000',
};
const migration = await readFile(
  new URL('../migrations/20261013041530_atomic_fc_signup_otp_issue.sql', import.meta.url),
  'utf8',
);
const completionMigration = await readFile(
  new URL('../migrations/20261013024349_fc_signup_completion_capability_v1.sql', import.meta.url),
  'utf8',
);
const clients = [];
let admin;
let db;

const HASH_A = Buffer.alloc(32, 21).toString('base64');
const HASH_B = Buffer.alloc(32, 22).toString('base64');
const PASSWORD_HASH = Buffer.alloc(32, 23).toString('base64');
const PASSWORD_SALT = Buffer.alloc(16, 24).toString('base64');
const PROOF = 'a'.repeat(64);
const FINGERPRINT = 'b'.repeat(64);
const INVITER_ID = '40000000-0000-4000-8000-000000000001';

async function connect() {
  const client = new Client({ ...config, database });
  await client.connect();
  clients.push(client);
  return client;
}

async function issue(client, phone, hash) {
  const { rows } = await client.query(
    'select public.issue_fc_signup_otp_v1($1,$2) result',
    [phone, hash],
  );
  return rows[0].result;
}

async function verify(client, phone, codeHash, proof = PROOF) {
  const { rows } = await client.query(
    'select public.verify_fc_signup_otp_v1($1,$2,$3,false) result',
    [phone, codeHash, proof],
  );
  return rows[0].result;
}

async function complete(client, phone) {
  const { rows } = await client.query(
    'select public.complete_fc_otp_signup_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result',
    [
      phone,
      PROOF,
      FINGERPRINT,
      '홍길동',
      '가람 본점',
      'user@example.com',
      'SKT',
      ['life'],
      'GOODCODE',
      INVITER_ID,
      PASSWORD_HASH,
      PASSWORD_SALT,
    ],
  );
  return rows[0].result;
}

async function seedCompletionReady(phone) {
  await db.query(
    `insert into public.fc_profiles(
       id,phone,name,affiliation,signup_completed,phone_verified
     ) values($1,'01099999999','추천인','가람',true,true)
     on conflict(id) do nothing`,
    [INVITER_ID],
  );
  await db.query(
    `insert into public.referral_codes(fc_id,code,is_active)
     values($1,'GOODCODE',true)
     on conflict(code) do nothing`,
    [INVITER_ID],
  );
  const { rows } = await db.query(
    `insert into public.fc_profiles(
       phone,name,affiliation,phone_verified,phone_verified_at,
       signup_verification_method,signup_verified_at
     ) values($1,'가입 대기','가람',true,clock_timestamp(),'phone_otp',clock_timestamp())
     returning id`,
    [phone],
  );
  await db.query(
    `insert into public.fc_signup_completion_challenges(fc_id,token_hash,expires_at)
     values($1,$2,clock_timestamp()+interval '15 minutes')`,
    [rows[0].id, PROOF],
  );
  return rows[0].id;
}

async function waitForAdvisoryLock(client) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const { rows } = await db.query(
      `select exists(
         select 1 from pg_locks
         where pid=$1 and locktype='advisory' and granted=false
       ) waiting`,
      [client.processID],
    );
    if (rows[0]?.waiting === true) return;
    await delay(10);
  }
  assert.fail('second connection did not wait on the per-phone advisory lock');
}

const fixtureSql = `
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table public.platform_sms_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,
  provider text not null default 'ncp_sens',
  state text not null default 'pending',
  provider_request_id text,
  provider_status_code text,
  failure_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create table public.fc_profiles (
  id uuid primary key default gen_random_uuid(),
  temp_id text,
  name text not null default '',
  affiliation text not null default '',
  resident_id_masked text,
  resident_id_hash text,
  phone text not null unique,
  recommender text,
  recommender_fc_id uuid,
  recommender_code_id uuid,
  recommender_code text,
  recommender_linked_at timestamptz,
  recommender_link_source text,
  email text,
  address text,
  address_detail text,
  allowance_date date,
  allowance_prescreen_requested_at timestamptz,
  allowance_reject_reason text,
  docs_deadline_at date,
  docs_deadline_last_notified_at date,
  hanwha_commission_date_sub date,
  hanwha_commission_date date,
  hanwha_commission_reject_reason text,
  hanwha_commission_pdf_path text,
  hanwha_commission_pdf_name text,
  dawichok_url_sent_at timestamptz,
  dawichok_url_sent_by text,
  appointment_url text,
  appointment_date date,
  appointment_schedule_life text,
  appointment_schedule_nonlife text,
  appointment_date_life date,
  appointment_date_nonlife date,
  appointment_date_life_sub date,
  appointment_date_nonlife_sub date,
  appointment_reject_reason_life text,
  appointment_reject_reason_nonlife text,
  life_commission_completed boolean not null default false,
  nonlife_commission_completed boolean not null default false,
  license_statuses text[],
  carrier text,
  status text not null default 'draft',
  identity_completed boolean not null default false,
  signup_completed boolean not null default false,
  phone_verified boolean not null default false,
  phone_verified_at timestamptz,
  phone_verification_hash text,
  phone_verification_expires_at timestamptz,
  phone_verification_sent_at timestamptz,
  phone_verification_attempts integer not null default 0,
  phone_verification_locked_until timestamptz,
  signup_verification_method text,
  signup_verified_at timestamptz,
  signup_verified_by_admin_id uuid,
  is_manager_referral_shadow boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.fc_credentials (
  fc_id uuid primary key references public.fc_profiles(id) on delete cascade,
  password_hash text not null,
  password_salt text not null,
  session_version bigint not null default 0,
  password_set_at timestamptz,
  failed_count integer not null default 0,
  locked_until timestamptz,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  reset_sent_at timestamptz,
  reset_failed_count integer not null default 0,
  must_change_password boolean not null default false,
  temporary_password_issued_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.fc_identity_secure (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null unique references public.fc_profiles(id) on delete cascade,
  resident_number_encrypted text not null,
  address_encrypted text not null
);
create table public.profiles (
  id uuid primary key,
  fc_id uuid references public.fc_profiles(id) on delete set null
);
create table public.admin_accounts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique
);
create table public.manager_accounts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  active boolean not null default true
);

create table public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null references public.fc_profiles(id) on delete cascade,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);

create or replace function public.apply_referral_link_state(
  p_invitee_fc_id uuid,
  p_inviter_fc_id uuid default null,
  p_referral_code_id uuid default null,
  p_referral_code text default null,
  p_source text default 'self_service',
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  update public.fc_profiles
  set recommender_fc_id = p_inviter_fc_id,
      recommender_code_id = p_referral_code_id,
      recommender_code = p_referral_code,
      recommender_link_source = p_source,
      recommender_linked_at = clock_timestamp()
  where id = p_invitee_fc_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant all privileges on all tables in schema public to service_role;
grant execute on function public.apply_referral_link_state(
  uuid, uuid, uuid, text, text, text, text, text, text
) to service_role;
`;

before(async () => {
  admin = new Client({ ...config, database: 'postgres' });
  await admin.connect();
  await admin.query(`create database ${database}`);
  db = await connect();
  await db.query(fixtureSql);
  await db.query('begin');
  try {
    await db.query(completionMigration);
    await db.query(migration);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
});

after(async () => {
  await Promise.allSettled(clients.map((client) => client.end()));
  if (admin) {
    assert.match(database, /^fc_signup_otp_\d+$/);
    await admin.query(`drop database if exists ${database}`);
    await admin.end();
  }
});

test('existing incomplete profile permits exactly one concurrent issuance', async () => {
  const phone = '01033330001';
  await db.query(
    `insert into public.fc_profiles(phone,phone_verification_hash,
       phone_verification_expires_at,phone_verification_sent_at)
     values($1,$2,clock_timestamp()+interval '4 minutes',clock_timestamp()-interval '61 seconds')`,
    [phone, Buffer.alloc(32, 20).toString('base64')],
  );

  const first = await connect();
  const second = await connect();
  await first.query('set role service_role');
  await second.query('set role service_role');
  await first.query('begin');
  const winner = await issue(first, phone, HASH_A);
  assert.equal(winner.ok, true);

  const pending = issue(second, phone, HASH_B);
  await waitForAdvisoryLock(second);
  await first.query('commit');
  assert.equal((await pending).code, 'cooldown');

  const profile = (
    await db.query(
      `select phone_verification_hash,phone_verification_delivery_id
       from public.fc_profiles where phone=$1`,
      [phone],
    )
  ).rows[0];
  assert.deepEqual(profile, {
    phone_verification_hash: HASH_A,
    phone_verification_delivery_id: winner.deliveryId,
  });
  assert.equal(
    Number((await db.query("select count(*) n from platform_sms_delivery_attempts where purpose='fc_signup'")).rows[0].n),
    1,
  );
});

test('new profile creation is serialized into one success and one cooldown', async () => {
  const phone = '01033330002';
  const first = await connect();
  const second = await connect();
  await first.query('set role service_role');
  await second.query('set role service_role');
  await first.query('begin');
  const winner = await issue(first, phone, HASH_A);
  assert.equal(winner.ok, true);

  const pending = issue(second, phone, HASH_B);
  await waitForAdvisoryLock(second);
  await first.query('commit');
  assert.equal((await pending).code, 'cooldown');

  assert.equal(
    Number((await db.query('select count(*) n from fc_profiles where phone=$1', [phone])).rows[0].n),
    1,
  );
  assert.deepEqual(
    (
      await db.query(
        `select phone_verification_hash,phone_verification_delivery_id
         from fc_profiles where phone=$1`,
        [phone],
      )
    ).rows[0],
    { phone_verification_hash: HASH_A, phone_verification_delivery_id: winner.deliveryId },
  );
  assert.equal(
    Number((await db.query(
      `select count(*) n from platform_sms_delivery_attempts
       where purpose='fc_signup' and id=$1`,
      [winner.deliveryId],
    )).rows[0].n),
    1,
  );
});

test('issuance waits for the fifth failed verification and rechecks the committed lock', async () => {
  const phone = '01033330003';
  await db.query(
    `insert into public.fc_profiles(
       phone,phone_verification_hash,phone_verification_expires_at,
       phone_verification_sent_at,phone_verification_attempts
     ) values($1,$2,clock_timestamp()+interval '5 minutes',
       clock_timestamp()-interval '61 seconds',4)`,
    [phone, HASH_A],
  );

  const verifier = await connect();
  const issuer = await connect();
  await verifier.query('set role service_role');
  await issuer.query('set role service_role');
  await verifier.query('begin');
  assert.equal((await verify(verifier, phone, HASH_B)).code, 'locked');

  const pending = issue(issuer, phone, HASH_B);
  await waitForAdvisoryLock(issuer);
  await verifier.query('commit');
  assert.equal((await pending).code, 'locked');

  const profile = (
    await db.query(
      `select phone_verification_attempts,
              phone_verification_locked_until > clock_timestamp() locked,
              phone_verification_delivery_id
       from public.fc_profiles where phone=$1`,
      [phone],
    )
  ).rows[0];
  assert.deepEqual(profile, {
    phone_verification_attempts: 5,
    locked: true,
    phone_verification_delivery_id: null,
  });
});

test('issuance waits for completion and rechecks the committed active credential', async () => {
  const phone = '01033330004';
  await seedCompletionReady(phone);
  const completer = await connect();
  const issuer = await connect();
  await completer.query('set role service_role');
  await issuer.query('set role service_role');
  await completer.query('begin');
  assert.equal((await complete(completer, phone)).ok, true);

  const pending = issue(issuer, phone, HASH_A);
  await waitForAdvisoryLock(issuer);
  await completer.query('commit');
  assert.equal((await pending).code, 'already_exists');
  assert.equal(
    Number((await db.query(
      `select count(*) n from public.fc_credentials credential
       join public.fc_profiles profile on profile.id=credential.fc_id
       where profile.phone=$1 and profile.signup_completed=true
         and credential.password_set_at is not null`,
      [phone],
    )).rows[0].n),
    1,
  );
});

test('a winning issuance makes a waiting old-code verification stale', async () => {
  const phone = '01033330005';
  await db.query(
    `insert into public.fc_profiles(
       phone,phone_verification_hash,phone_verification_expires_at,
       phone_verification_sent_at,phone_verification_attempts
     ) values($1,$2,clock_timestamp()+interval '5 minutes',
       clock_timestamp()-interval '61 seconds',0)`,
    [phone, HASH_A],
  );
  const issuer = await connect();
  const verifier = await connect();
  await issuer.query('set role service_role');
  await verifier.query('set role service_role');
  await issuer.query('begin');
  const winner = await issue(issuer, phone, HASH_B);
  assert.equal(winner.ok, true);

  const pending = verify(verifier, phone, HASH_A);
  await waitForAdvisoryLock(verifier);
  await issuer.query('commit');
  assert.equal((await pending).code, 'invalid_code');
  assert.deepEqual(
    (
      await db.query(
        `select phone_verification_hash,phone_verification_attempts,
                phone_verification_delivery_id
         from public.fc_profiles where phone=$1`,
        [phone],
      )
    ).rows[0],
    {
      phone_verification_hash: HASH_B,
      phone_verification_attempts: 1,
      phone_verification_delivery_id: winner.deliveryId,
    },
  );
});

test('a winning issuance invalidates a waiting stale completion proof', async () => {
  const phone = '01033330006';
  await seedCompletionReady(phone);
  const issuer = await connect();
  const completer = await connect();
  await issuer.query('set role service_role');
  await completer.query('set role service_role');
  await issuer.query('begin');
  const winner = await issue(issuer, phone, HASH_A);
  assert.equal(winner.ok, true);

  const pending = complete(completer, phone);
  await waitForAdvisoryLock(completer);
  await issuer.query('commit');
  assert.equal((await pending).code, 'proof_required');
  assert.deepEqual(
    (
      await db.query(
        `select phone_verification_hash,phone_verification_delivery_id,signup_completed
         from public.fc_profiles where phone=$1`,
        [phone],
      )
    ).rows[0],
    {
      phone_verification_hash: HASH_A,
      phone_verification_delivery_id: winner.deliveryId,
      signup_completed: false,
    },
  );
});
