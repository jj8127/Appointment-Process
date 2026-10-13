import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(
  new URL('../migrations/20261013024349_fc_signup_completion_capability_v1.sql', import.meta.url),
  'utf8',
);
const cleanupMigration = await readFile(
  new URL('../migrations/20261013035452_cleanup_fc_signup_completion_challenges.sql', import.meta.url),
  'utf8',
);
const atomicIssueMigration = await readFile(
  new URL('../migrations/20261013041530_atomic_fc_signup_otp_issue.sql', import.meta.url),
  'utf8',
);

const TARGET_ID = '10000000-0000-4000-8000-000000000001';
const SECOND_TARGET_ID = '10000000-0000-4000-8000-000000000002';
const THIRD_TARGET_ID = '10000000-0000-4000-8000-000000000003';
const INVITER_ID = '20000000-0000-4000-8000-000000000001';
const PHONE = '01012345678';
const SECOND_PHONE = '01012345679';
const INVITER_PHONE = '01099999999';
const CODE_HASH = 'synthetic-live-code-hash';
const PROOF_A = 'a'.repeat(64);
const PROOF_B = 'b'.repeat(64);
const FINGERPRINT_A = 'c'.repeat(64);
const FINGERPRINT_B = 'd'.repeat(64);
const PASSWORD_HASH = Buffer.alloc(32, 7).toString('base64');
const PASSWORD_SALT = Buffer.alloc(16, 8).toString('base64');
const OTP_HASH_A = Buffer.alloc(32, 11).toString('base64');
const OTP_HASH_B = Buffer.alloc(32, 12).toString('base64');

const fixtureSql = `
create role anon;
create role authenticated;
create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table public.platform_signup_challenges (
  phone text primary key,
  expires_at timestamptz not null,
  locked_until timestamptz
);

create table public.platform_members (
  id uuid primary key,
  fc_id uuid
);

create table public.platform_member_credentials (
  member_id uuid primary key references public.platform_members(id) on delete cascade,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  reset_sent_at timestamptz,
  reset_failed_count integer not null default 0
);

create table public.platform_sms_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('signup','fc_signup','password_reset')),
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
  name text not null default '가입 대기',
  affiliation text not null default '가람',
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

  if p_referral_code = 'FAILAPPLY' then
    raise exception 'synthetic_referral_apply_failure';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant all privileges on all tables in schema public to service_role;
grant execute on function public.apply_referral_link_state(
  uuid, uuid, uuid, text, text, text, text, text, text
) to service_role;
`;

async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(fixtureSql);
    await db.exec(migration);
    await db.exec(cleanupMigration);
    await db.exec(atomicIssueMigration);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function rpc(db, sql, args = []) {
  await db.exec('set role service_role');
  try {
    return (await db.query(sql, args)).rows[0].result;
  } finally {
    await db.exec('reset role');
  }
}

async function issueSignupOtp(db, phone, hash = OTP_HASH_A) {
  return rpc(
    db,
    'select public.issue_fc_signup_otp_v1($1,$2) result',
    [phone, hash],
  );
}

async function finalizeSignupOtp(
  db,
  phone,
  deliveryId,
  state,
  providerRequestId = null,
  providerStatusCode = null,
  failureReason = null,
) {
  return rpc(
    db,
    'select public.finalize_fc_signup_otp_delivery_v1($1,$2,$3,$4,$5,$6) result',
    [phone, deliveryId, state, providerRequestId, providerStatusCode, failureReason],
  );
}

async function seedTarget(db, id = TARGET_ID, phone = PHONE) {
  await db.query(
    `insert into public.fc_profiles(id, phone, name, affiliation)
     values($1, $2, '가입 대기', '가람')`,
    [id, phone],
  );
}

async function seedInviter(db) {
  await db.query(
    `insert into public.fc_profiles(
       id, phone, name, affiliation, signup_completed, phone_verified
     ) values($1, $2, '추천인', '가람', true, true)`,
    [INVITER_ID, INVITER_PHONE],
  );
  await db.query(
    `insert into public.referral_codes(fc_id, code, is_active)
     values($1, 'GOODCODE', true), ($1, 'FAILAPPLY', true)`,
    [INVITER_ID],
  );
}

async function issueOtp(db, id = TARGET_ID, hash = CODE_HASH) {
  await db.query(
    `update public.fc_profiles
     set phone_verification_hash=$2,
         phone_verification_expires_at=clock_timestamp()+interval '5 minutes',
         phone_verification_sent_at=clock_timestamp(),
         phone_verification_attempts=0,
         phone_verification_locked_until=null
     where id=$1`,
    [id, hash],
  );
}

async function verify(db, phone = PHONE, proof = PROOF_A, bypass = false, codeHash = CODE_HASH) {
  return rpc(
    db,
    'select public.verify_fc_signup_otp_v1($1,$2,$3,$4) result',
    [phone, codeHash, proof, bypass],
  );
}

function completionArgs(overrides = {}) {
  const values = {
    phone: PHONE,
    proof: PROOF_A,
    fingerprint: FINGERPRINT_A,
    name: '홍길동',
    affiliation: '가람 본점',
    email: 'user@example.com',
    carrier: 'SKT',
    licenses: ['life', 'third'],
    referralCode: 'GOODCODE',
    inviterId: INVITER_ID,
    passwordHash: PASSWORD_HASH,
    passwordSalt: PASSWORD_SALT,
    ...overrides,
  };
  return [
    values.phone,
    values.proof,
    values.fingerprint,
    values.name,
    values.affiliation,
    values.email,
    values.carrier,
    values.licenses,
    values.referralCode,
    values.inviterId,
    values.passwordHash,
    values.passwordSalt,
  ];
}

async function complete(db, overrides = {}) {
  return rpc(
    db,
    'select public.complete_fc_otp_signup_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result',
    completionArgs(overrides),
  );
}

test('OTP verification requires a live issued challenge for normal and bypass paths', async () => {
  const db = await fixture();
  try {
    await seedTarget(db);
    assert.equal((await verify(db, PHONE, PROOF_A, true, null)).code, 'no_code');

    await issueOtp(db);
    assert.equal((await verify(db, PHONE, PROOF_A, false, 'wrong-code-hash')).code, 'invalid_code');
    assert.equal(
      Number((await db.query('select phone_verification_attempts n from fc_profiles where id=$1', [TARGET_ID])).rows[0].n),
      1,
    );

    const normal = await verify(db);
    assert.equal(normal.ok, true);
    const normalProof = (
      await db.query(
        `select token_hash, consumed_at, request_fingerprint, result
         from fc_signup_completion_challenges where fc_id=$1`,
        [TARGET_ID],
      )
    ).rows[0];
    assert.deepEqual(normalProof, {
      token_hash: PROOF_A,
      consumed_at: null,
      request_fingerprint: null,
      result: null,
    });
    const verifiedProfile = (
      await db.query(
        `select phone_verified, signup_verification_method,
                phone_verification_hash, phone_verification_attempts
         from fc_profiles where id=$1`,
        [TARGET_ID],
      )
    ).rows[0];
    assert.deepEqual(verifiedProfile, {
      phone_verified: true,
      signup_verification_method: 'phone_otp',
      phone_verification_hash: null,
      phone_verification_attempts: 0,
    });

    await seedTarget(db, SECOND_TARGET_ID, SECOND_PHONE);
    await issueOtp(db, SECOND_TARGET_ID, 'another-live-code');
    assert.equal((await verify(db, SECOND_PHONE, PROOF_B, true, null)).ok, true);

    await db.query(
      `update fc_profiles
       set phone_verification_hash='expired-code',
           phone_verification_expires_at=clock_timestamp()-interval '1 second'
       where id=$1`,
      [SECOND_TARGET_ID],
    );
    assert.equal((await verify(db, SECOND_PHONE, PROOF_B, true, null)).code, 'expired_code');
  } finally {
    await db.close();
  }
});

test('wrong, expired and stale completion proofs cannot write signup state', async () => {
  const db = await fixture();
  try {
    await seedTarget(db);
    await seedInviter(db);
    await issueOtp(db);
    assert.equal((await verify(db)).ok, true);

    assert.equal((await complete(db, { proof: PROOF_B })).code, 'proof_invalid');
    assert.equal(
      Number((await db.query('select count(*) n from fc_credentials where fc_id=$1', [TARGET_ID])).rows[0].n),
      0,
    );

    await db.query(
      `update fc_signup_completion_challenges
       set expires_at=clock_timestamp()-interval '1 second',
           created_at=clock_timestamp()-interval '16 minutes'
       where fc_id=$1`,
      [TARGET_ID],
    );
    assert.equal((await complete(db)).code, 'proof_expired');
    assert.equal(
      (await db.query('select signup_completed from fc_profiles where id=$1', [TARGET_ID])).rows[0]
        .signup_completed,
      false,
    );

    await db.query(
      `update fc_signup_completion_challenges
       set expires_at=clock_timestamp()+interval '15 minutes'
       where fc_id=$1`,
      [TARGET_ID],
    );
    await issueOtp(db, TARGET_ID, 'new-otp-generation');
    assert.equal(
      Number(
        (await db.query('select count(*) n from fc_signup_completion_challenges where fc_id=$1', [TARGET_ID]))
          .rows[0].n,
      ),
      0,
    );
    assert.equal((await complete(db)).code, 'proof_required');
  } finally {
    await db.close();
  }
});

test('referral validation and apply failures preserve a reusable proof', async () => {
  const db = await fixture();
  try {
    await seedTarget(db);
    await seedInviter(db);
    await issueOtp(db);
    await verify(db);

    assert.equal((await complete(db, { referralCode: 'MISSING' })).code, 'referral_invalid');
    assert.equal((await complete(db, { referralCode: 'FAILAPPLY' })).code, 'referral_invalid');

    const unchanged = (
      await db.query(
        `select signup_completed, recommender_fc_id
         from fc_profiles where id=$1`,
        [TARGET_ID],
      )
    ).rows[0];
    assert.deepEqual(unchanged, { signup_completed: false, recommender_fc_id: null });
    assert.equal(
      (
        await db.query(
          'select consumed_at from fc_signup_completion_challenges where fc_id=$1',
          [TARGET_ID],
        )
      ).rows[0].consumed_at,
      null,
    );

    assert.equal((await complete(db)).ok, true);
  } finally {
    await db.close();
  }
});

test('profile, referral, credential and proof consumption are atomic and retry-idempotent', async () => {
  const db = await fixture();
  try {
    await seedTarget(db);
    await seedInviter(db);
    await issueOtp(db);
    await verify(db);

    await db.exec(`
      create or replace function reject_synthetic_credential() returns trigger
      language plpgsql as $$ begin raise exception 'synthetic_credential_failure'; end $$;
      create trigger reject_synthetic_credential
      before insert or update on public.fc_credentials
      for each row execute function reject_synthetic_credential();
    `);
    await assert.rejects(complete(db), /synthetic_credential_failure/);

    const rolledBack = (
      await db.query(
        `select signup_completed, recommender_fc_id
         from fc_profiles where id=$1`,
        [TARGET_ID],
      )
    ).rows[0];
    assert.deepEqual(rolledBack, { signup_completed: false, recommender_fc_id: null });
    assert.equal(
      (
        await db.query(
          'select consumed_at from fc_signup_completion_challenges where fc_id=$1',
          [TARGET_ID],
        )
      ).rows[0].consumed_at,
      null,
    );

    await db.exec('drop trigger reject_synthetic_credential on public.fc_credentials');
    const first = await complete(db);
    assert.deepEqual(first, {
      ok: true,
      fcId: TARGET_ID,
      residentId: PHONE,
      displayName: '홍길동',
      affiliation: '가람 본점',
      sessionVersion: 0,
      alreadyApplied: false,
    });

    const committedProfile = (
      await db.query(
        `select name, affiliation, email, carrier, license_statuses, status,
                life_commission_completed, nonlife_commission_completed,
                signup_completed, recommender_fc_id, recommender_code
         from fc_profiles where id=$1`,
        [TARGET_ID],
      )
    ).rows[0];
    assert.deepEqual(committedProfile, {
      name: '홍길동',
      affiliation: '가람 본점',
      email: 'user@example.com',
      carrier: 'SKT',
      license_statuses: ['life', 'third'],
      status: 'draft',
      life_commission_completed: false,
      nonlife_commission_completed: false,
      signup_completed: true,
      recommender_fc_id: INVITER_ID,
      recommender_code: 'GOODCODE',
    });
    assert.equal(
      Number((await db.query('select count(*) n from fc_credentials where fc_id=$1', [TARGET_ID])).rows[0].n),
      1,
    );

    const retry = await complete(db);
    assert.equal(retry.ok, true);
    assert.equal(retry.alreadyApplied, true);
    assert.equal((await complete(db, { fingerprint: FINGERPRINT_B })).code, 'request_conflict');

    await db.query(
      `update fc_signup_completion_challenges
       set expires_at=clock_timestamp()-interval '1 second',
           created_at=clock_timestamp()-interval '16 minutes'
       where fc_id=$1`,
      [TARGET_ID],
    );
    assert.equal((await complete(db)).code, 'proof_expired');
  } finally {
    await db.close();
  }
});

test('bare phone verification and duplicate accounts cannot bypass completion checks', async () => {
  const db = await fixture();
  try {
    await seedTarget(db);
    await seedInviter(db);
    await db.query(
      `update fc_profiles
       set phone_verified=true,
           phone_verified_at=clock_timestamp(),
           signup_verification_method='phone_otp',
           signup_verified_at=clock_timestamp()
       where id=$1`,
      [TARGET_ID],
    );
    assert.equal((await complete(db)).code, 'proof_required');

    await issueOtp(db);
    await verify(db);
    await db.query('insert into admin_accounts(phone) values($1)', [PHONE]);
    assert.equal((await complete(db)).code, 'already_exists');
    await db.query('delete from admin_accounts where phone=$1', [PHONE]);
    await db.query('insert into manager_accounts(phone) values($1)', [PHONE]);
    assert.equal((await complete(db)).code, 'already_exists');
    await db.query('delete from manager_accounts where phone=$1', [PHONE]);
    await db.query(
      `insert into fc_credentials(fc_id,password_hash,password_salt,password_set_at)
       values($1,$2,$3,clock_timestamp())`,
      [TARGET_ID, PASSWORD_HASH, PASSWORD_SALT],
    );
    assert.equal((await complete(db)).code, 'already_exists');
    assert.equal(
      (
        await db.query(
          'select consumed_at from fc_signup_completion_challenges where fc_id=$1',
          [TARGET_ID],
        )
      ).rows[0].consumed_at,
      null,
    );
  } finally {
    await db.close();
  }
});

test('completion capability table and RPCs are service-role only', async () => {
  const db = await fixture();
  try {
    await seedTarget(db);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.query('select * from public.fc_signup_completion_challenges'),
        /permission denied/,
      );
      await assert.rejects(
        db.query('select public.verify_fc_signup_otp_v1($1,$2,$3,false)', [
          PHONE,
          CODE_HASH,
          PROOF_A,
        ]),
        /permission denied/,
      );
      await assert.rejects(
        db.query(
          'select public.complete_fc_otp_signup_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          completionArgs(),
        ),
        /permission denied/,
      );
      await db.exec('reset role');
    }

    const rls = (
      await db.query(
        `select relrowsecurity from pg_class
         where oid='public.fc_signup_completion_challenges'::regclass`,
      )
    ).rows[0];
    assert.equal(rls.relrowsecurity, true);
  } finally {
    await db.close();
  }
});

test('cleanup removes expired consumed and unconsumed proofs while preserving live proofs', async () => {
  const db = await fixture();
  try {
    await seedTarget(db);
    await seedTarget(db, SECOND_TARGET_ID, SECOND_PHONE);
    await seedTarget(db, THIRD_TARGET_ID, '01012345680');

    await db.query(
      `insert into public.fc_signup_completion_challenges(
         fc_id, token_hash, expires_at, consumed_at, request_fingerprint, result, created_at, updated_at
       ) values
       ($1, $4, clock_timestamp()-interval '1 minute', null, null, null,
        clock_timestamp()-interval '16 minutes', clock_timestamp()-interval '1 minute'),
       ($2, $5, clock_timestamp()-interval '1 minute', clock_timestamp()-interval '2 minutes',
        $7, jsonb_build_object('ok', true, 'residentId', '01000000000'),
        clock_timestamp()-interval '16 minutes', clock_timestamp()-interval '2 minutes'),
       ($3, $6, clock_timestamp()+interval '10 minutes', null, null, null,
        clock_timestamp(), clock_timestamp())`,
      [TARGET_ID, SECOND_TARGET_ID, THIRD_TARGET_ID, PROOF_A, PROOF_B, 'e'.repeat(64), FINGERPRINT_A],
    );

    await db.exec('set role service_role');
    try {
      await db.exec('select public.cleanup_platform_auth_challenges()');
    } finally {
      await db.exec('reset role');
    }

    const remaining = (
      await db.query(
        'select fc_id from public.fc_signup_completion_challenges order by fc_id',
      )
    ).rows;
    assert.deepEqual(remaining, [{ fc_id: THIRD_TARGET_ID }]);
  } finally {
    await db.close();
  }
});

test('cleanup index covers all expiry rows and the existing cron keeps the stable function boundary', async () => {
  const db = await fixture();
  try {
    const index = (
      await db.query(
        `select indexdef from pg_indexes
         where schemaname='public'
           and indexname='fc_signup_completion_challenges_expires_idx'`,
      )
    ).rows[0];
    assert.ok(index);
    assert.match(index.indexdef, /\(expires_at\)/i);
    assert.doesNotMatch(index.indexdef, /\bwhere\b/i);
  } finally {
    await db.close();
  }

  const schema = (
    await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
  ).replaceAll('\r\n', '\n');
  assert.match(
    schema,
    /select cron\.schedule\('platform-auth-challenge-cleanup','\*\/5 \* \* \* \*',\s*'select public\.cleanup_platform_auth_challenges\(\);'\);/,
  );
  assert.doesNotMatch(cleanupMigration, /cron\.schedule/i);
});

test('atomic FC OTP issuance owns the challenge and delivery attempt before enforcing cooldown', async () => {
  const db = await fixture();
  const phone = '01022220001';
  try {
    const first = await issueSignupOtp(db, phone);
    assert.equal(first.ok, true);
    assert.match(first.deliveryId, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(first.authProfileIds, []);
    assert.equal(first.resetApplied, false);

    const profile = (
      await db.query(
        `select phone_verification_hash,
                extract(epoch from phone_verification_expires_at-phone_verification_sent_at)::int ttl,
                phone_verification_attempts, phone_verification_locked_until,
                phone_verification_delivery_id
         from public.fc_profiles where phone=$1`,
        [phone],
      )
    ).rows[0];
    assert.deepEqual(profile, {
      phone_verification_hash: OTP_HASH_A,
      ttl: 300,
      phone_verification_attempts: 0,
      phone_verification_locked_until: null,
      phone_verification_delivery_id: first.deliveryId,
    });
    assert.deepEqual(
      (
        await db.query(
          `select purpose,state from public.platform_sms_delivery_attempts
           where id=$1`,
          [first.deliveryId],
        )
      ).rows[0],
      { purpose: 'fc_signup', state: 'pending' },
    );

    assert.equal((await issueSignupOtp(db, phone, OTP_HASH_B)).code, 'cooldown');
    assert.equal(
      Number((await db.query('select count(*) n from platform_sms_delivery_attempts')).rows[0].n),
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
      { phone_verification_hash: OTP_HASH_A, phone_verification_delivery_id: first.deliveryId },
    );

    await db.exec(atomicIssueMigration);
    assert.equal((await issueSignupOtp(db, phone, OTP_HASH_B)).code, 'cooldown');
    assert.equal(
      Number((await db.query('select count(*) n from platform_sms_delivery_attempts')).rows[0].n),
      1,
    );
  } finally {
    await db.close();
  }
});

test('atomic FC OTP issuance resets partial signup artifacts and invalidates the old completion proof', async () => {
  const db = await fixture();
  const authIdA = '30000000-0000-4000-8000-000000000001';
  const authIdB = '30000000-0000-4000-8000-000000000002';
  try {
    await seedTarget(db);
    await db.query(
      `update public.fc_profiles set
         name='이전 이름', affiliation='이전 소속', email='old@example.com', address='이전 주소',
         resident_id_masked='000000-*******', resident_id_hash='old-resident-hash',
         recommender='이전 추천인', recommender_code='OLDCODE', identity_completed=true,
         status='docs-pending', allowance_prescreen_requested_at=clock_timestamp(),
         allowance_reject_reason='이전 반려 사유', phone_verified=true, phone_verified_at=clock_timestamp(),
         phone_verification_hash=$2, signup_verification_method='phone_otp',
         signup_verified_at=clock_timestamp()
       where id=$1`,
      [TARGET_ID, OTP_HASH_B],
    );
    await db.query(
      `insert into public.fc_identity_secure(fc_id,resident_number_encrypted,address_encrypted)
       values($1,'encrypted-resident','encrypted-address')`,
      [TARGET_ID],
    );
    await db.query(
      `insert into public.fc_credentials(fc_id,password_hash,password_salt,password_set_at)
       values($1,$2,$3,null)`,
      [TARGET_ID, PASSWORD_HASH, PASSWORD_SALT],
    );
    await db.query(
      `insert into public.profiles(id,fc_id) values($1,$3),($2,$3)`,
      [authIdA, authIdB, TARGET_ID],
    );
    await db.query(
      `insert into public.fc_signup_completion_challenges(fc_id,token_hash,expires_at)
       values($1,$2,clock_timestamp()+interval '10 minutes')`,
      [TARGET_ID, PROOF_A],
    );

    const issued = await issueSignupOtp(db, PHONE, OTP_HASH_A);
    assert.equal(issued.ok, true);
    assert.equal(issued.resetApplied, true);
    assert.deepEqual(issued.authProfileIds, [authIdA, authIdB]);

    const profile = (
      await db.query(
        `select name,affiliation,email,address,resident_id_masked,resident_id_hash,
                recommender,recommender_fc_id,recommender_code_id,recommender_code,
                identity_completed,status,signup_completed,phone_verified,phone_verified_at,
                allowance_prescreen_requested_at,allowance_reject_reason,
                signup_verification_method,signup_verified_at,phone_verification_hash,
                phone_verification_delivery_id
         from public.fc_profiles where id=$1`,
        [TARGET_ID],
      )
    ).rows[0];
    assert.deepEqual(profile, {
      name: '',
      affiliation: '',
      email: '',
      address: '',
      resident_id_masked: null,
      resident_id_hash: null,
      recommender: '',
      recommender_fc_id: null,
      recommender_code_id: null,
      recommender_code: null,
      identity_completed: false,
      status: 'draft',
      signup_completed: false,
      phone_verified: false,
      phone_verified_at: null,
      allowance_prescreen_requested_at: null,
      allowance_reject_reason: null,
      signup_verification_method: null,
      signup_verified_at: null,
      phone_verification_hash: OTP_HASH_A,
      phone_verification_delivery_id: issued.deliveryId,
    });
    for (const table of ['fc_identity_secure', 'fc_credentials', 'profiles', 'fc_signup_completion_challenges']) {
      assert.equal(
        Number((await db.query(`select count(*) n from public.${table}`)).rows[0].n),
        0,
        `${table} must be cleared in the issuance transaction`,
      );
    }
  } finally {
    await db.close();
  }
});

test('atomic FC OTP issuance rechecks locks and every existing-account boundary before tracking', async () => {
  const db = await fixture();
  const lockedPhone = '01022220005';
  const activePhone = '01022220006';
  const shadowPhone = '01022220007';
  const adminPhone = '01022220008';
  const managerPhone = '01022220009';
  try {
    await seedTarget(db, TARGET_ID, lockedPhone);
    await db.query(
      `update fc_profiles set phone_verification_locked_until=clock_timestamp()+interval '10 minutes'
       where id=$1`,
      [TARGET_ID],
    );
    assert.equal((await issueSignupOtp(db, lockedPhone)).code, 'locked');

    await seedTarget(db, SECOND_TARGET_ID, activePhone);
    await db.query('update fc_profiles set signup_completed=true where id=$1', [SECOND_TARGET_ID]);
    await db.query(
      `insert into fc_credentials(fc_id,password_hash,password_salt,password_set_at)
       values($1,$2,$3,clock_timestamp())`,
      [SECOND_TARGET_ID, PASSWORD_HASH, PASSWORD_SALT],
    );
    assert.equal((await issueSignupOtp(db, activePhone)).code, 'already_exists');

    await seedTarget(db, THIRD_TARGET_ID, shadowPhone);
    await db.query('update fc_profiles set is_manager_referral_shadow=true where id=$1', [THIRD_TARGET_ID]);
    assert.equal((await issueSignupOtp(db, shadowPhone)).code, 'already_exists');

    await db.query('insert into admin_accounts(phone) values($1)', ['010-2222-0008']);
    assert.equal((await issueSignupOtp(db, adminPhone)).code, 'already_exists');
    await db.query('insert into manager_accounts(phone) values($1)', ['010-2222-0009']);
    assert.equal((await issueSignupOtp(db, managerPhone)).code, 'already_exists');

    assert.equal(
      Number((await db.query("select count(*) n from platform_sms_delivery_attempts where purpose='fc_signup'")).rows[0].n),
      0,
    );
  } finally {
    await db.close();
  }
});

test('FC delivery finalization compensates only the currently owned rejected challenge', async () => {
  const db = await fixture();
  const phone = '01022220002';
  try {
    const first = await issueSignupOtp(db, phone, OTP_HASH_A);
    await db.query(
      `update public.fc_profiles
       set phone_verification_sent_at=clock_timestamp()-interval '61 seconds'
       where phone=$1`,
      [phone],
    );
    const second = await issueSignupOtp(db, phone, OTP_HASH_B);
    assert.equal(second.ok, true);

    const stale = await finalizeSignupOtp(
      db,
      phone,
      first.deliveryId,
      'rejected',
      null,
      '400',
      'provider_rejected',
    );
    assert.equal(stale.code, 'stale_delivery');
    assert.deepEqual(
      (
        await db.query(
          `select phone_verification_hash,phone_verification_delivery_id
           from public.fc_profiles where phone=$1`,
          [phone],
        )
      ).rows[0],
      { phone_verification_hash: OTP_HASH_B, phone_verification_delivery_id: second.deliveryId },
    );

    const current = await finalizeSignupOtp(
      db,
      phone,
      second.deliveryId,
      'rejected',
      null,
      '400',
      'provider_rejected',
    );
    assert.deepEqual(current, { ok: true, current: true });
    assert.deepEqual(
      (
        await db.query(
          `select phone_verification_hash,phone_verification_expires_at,
                  phone_verification_sent_at,phone_verification_delivery_id
           from public.fc_profiles where phone=$1`,
          [phone],
        )
      ).rows[0],
      {
        phone_verification_hash: null,
        phone_verification_expires_at: null,
        phone_verification_sent_at: null,
        phone_verification_delivery_id: null,
      },
    );
    assert.equal((await issueSignupOtp(db, phone)).ok, true);

    const acceptedPhone = '01022220003';
    const accepted = await issueSignupOtp(db, acceptedPhone);
    assert.equal((await finalizeSignupOtp(
      db,
      acceptedPhone,
      accepted.deliveryId,
      'accepted',
      'synthetic-request-id',
      '202',
      null,
    )).ok, true);
    assert.equal(
      (
        await db.query(
          'select phone_verification_hash from fc_profiles where phone=$1',
          [acceptedPhone],
        )
      ).rows[0].phone_verification_hash,
      OTP_HASH_A,
    );

    const unknownPhone = '01022220004';
    const unknown = await issueSignupOtp(db, unknownPhone);
    assert.equal((await finalizeSignupOtp(
      db,
      unknownPhone,
      unknown.deliveryId,
      'unknown',
      null,
      null,
      'timeout',
    )).ok, true);
    assert.equal(
      (
        await db.query(
          'select phone_verification_hash from fc_profiles where phone=$1',
          [unknownPhone],
        )
      ).rows[0].phone_verification_hash,
      OTP_HASH_A,
    );
  } finally {
    await db.close();
  }
});

test('FC OTP issuance and delivery finalization RPCs are service-role-only invoker functions', async () => {
  const db = await fixture();
  try {
    assert.equal((await issueSignupOtp(db, 'bad-phone')).code, 'invalid_request');
    assert.equal(
      Number((await db.query("select count(*) n from platform_sms_delivery_attempts where purpose='fc_signup'")).rows[0].n),
      0,
    );

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.query('select public.issue_fc_signup_otp_v1($1,$2)', [PHONE, OTP_HASH_A]),
        /permission denied/,
      );
      await assert.rejects(
        db.query(
          'select public.finalize_fc_signup_otp_delivery_v1($1,$2,$3,$4,$5,$6)',
          [PHONE, TARGET_ID, 'unknown', null, null, 'timeout'],
        ),
        /permission denied/,
      );
      await db.exec('reset role');
    }

    const functions = (
      await db.query(
        `select proname,prosecdef
         from pg_proc join pg_namespace on pg_namespace.oid=pg_proc.pronamespace
         where nspname='public'
           and proname in ('issue_fc_signup_otp_v1','finalize_fc_signup_otp_delivery_v1')
         order by proname`,
      )
    ).rows;
    assert.deepEqual(functions, [
      { proname: 'finalize_fc_signup_otp_delivery_v1', prosecdef: false },
      { proname: 'issue_fc_signup_otp_v1', prosecdef: false },
    ]);
  } finally {
    await db.close();
  }
});

test('canonical schema mirror contains the exact additive migration', async () => {
  const schema = (
    await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
  ).replaceAll('\r\n', '\n');
  const normalizedMigration = migration.replaceAll('\r\n', '\n');
  assert.ok(
    schema.includes(
      `-- Migration: FC signup completion capability v1 (20261013024349).\n${normalizedMigration}`,
    ),
  );
  assert.ok(
    schema.includes(
      `-- Migration: FC signup completion challenge expiry cleanup (20261013035452).\n${cleanupMigration.replaceAll('\r\n', '\n')}`,
    ),
  );
  assert.ok(
    schema.includes(
      `-- Migration: atomic FC signup OTP issuance (20261013041530).\n${atomicIssueMigration.replaceAll('\r\n', '\n')}`,
    ),
  );
});
