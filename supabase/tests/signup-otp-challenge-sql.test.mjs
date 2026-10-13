// PGlite queues calls on one connection. Overlapping calls still exercise the
// row-locked state transitions and prove no stale read/write split remains.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const { PGlite } = createRequire(import.meta.url)(
  process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite',
);
const baseMigration = await readFile(
  new URL('../migrations/20261013063140_atomic_onboarding_writes.sql', import.meta.url),
  'utf8',
);
const migration = await readFile(
  new URL('../migrations/20261013063141_atomic_signup_otp_challenges.sql', import.meta.url),
  'utf8',
);
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');

const fcId = '10000000-0000-4000-8000-000000000001';
const inviterAId = '10000000-0000-4000-8000-000000000011';
const inviterBId = '10000000-0000-4000-8000-000000000012';
const referralCodeAId = '40000000-0000-4000-8000-000000000011';
const referralCodeBId = '40000000-0000-4000-8000-000000000012';
const phone = '01012345678';
const firstChallenge = '20000000-0000-4000-8000-000000000001';
const secondChallenge = '20000000-0000-4000-8000-000000000002';
const otpHash = Buffer.alloc(32, 1).toString('base64');
const wrongHash = Buffer.alloc(32, 2).toString('base64');
const proofHash = Buffer.alloc(32, 3).toString('base64');
const passwordHash = Buffer.alloc(32, 4).toString('base64');
const passwordSalt = Buffer.alloc(16, 5).toString('base64');

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
      name text not null default '',
      affiliation text not null default '',
      recommender text,
      recommender_fc_id uuid,
      recommender_code_id uuid,
      recommender_code text,
      recommender_linked_at timestamptz,
      recommender_link_source text,
      email text not null default '',
      carrier text,
      license_statuses text[],
      address text not null default '',
      address_detail text,
      resident_id_masked text,
      resident_id_hash text,
      identity_completed boolean not null default false,
      status text not null default 'draft',
      life_commission_completed boolean not null default false,
      nonlife_commission_completed boolean not null default false,
      temp_id text,
      allowance_date date,
      allowance_prescreen_requested_at timestamptz,
      allowance_reject_reason text,
      appointment_url text,
      appointment_date date,
      appointment_schedule_life date,
      appointment_schedule_nonlife date,
      appointment_date_life date,
      appointment_date_nonlife date,
      appointment_date_life_sub date,
      appointment_date_nonlife_sub date,
      appointment_reject_reason_life text,
      appointment_reject_reason_nonlife text,
      docs_deadline_at timestamptz,
      docs_deadline_last_notified_at timestamptz,
      hanwha_commission_date_sub date,
      hanwha_commission_date date,
      hanwha_commission_reject_reason text,
      hanwha_commission_pdf_path text,
      hanwha_commission_pdf_name text,
      dawichok_url_sent_at timestamptz,
      dawichok_url_sent_by uuid,
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
      updated_at timestamptz not null default now()
    );
    create table public.profiles (
      id uuid primary key,
      fc_id uuid references public.fc_profiles(id) on delete cascade
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
    create function public.apply_referral_link_state(
      p_invitee_fc_id uuid,
      p_inviter_fc_id uuid default null,
      p_referral_code_id uuid default null,
      p_referral_code text default null,
      p_source text default 'self_service',
      p_actor_phone text default null,
      p_actor_role text default null,
      p_actor_staff_type text default null,
      p_reason text default null
    ) returns jsonb language plpgsql as $$
    begin
      update public.fc_profiles
      set recommender_fc_id=p_inviter_fc_id,
          recommender_code_id=p_referral_code_id,
          recommender_code=upper(p_referral_code),
          recommender_link_source=p_source,
          recommender_linked_at=now()
      where id=p_invitee_fc_id;
      return jsonb_build_object(
        'ok', true,
        'inviteeFcId', p_invitee_fc_id,
        'inviterFcId', p_inviter_fc_id,
        'referralCodeId', p_referral_code_id,
        'referralCode', upper(p_referral_code)
      );
    end $$;
  `);
  await db.exec(baseMigration);
  await db.exec(migration);
  await db.query(
    `insert into public.fc_profiles (id,phone,name,affiliation,email,status)
     values ($1,$2,'Stale name','Stale branch','stale@example.com','active')`,
    [fcId, phone],
  );
  await db.query(
    `insert into public.fc_profiles (id,phone,name,affiliation,email,status,signup_completed)
     values
       ($1,'01090000001','Inviter A','1본부','a@example.com','active',true),
       ($2,'01090000002','Inviter B','2본부','b@example.com','active',true)`,
    [inviterAId, inviterBId],
  );

  async function issue(challengeId = firstChallenge, hash = otpHash) {
    return (await db.query(
      'select public.issue_signup_otp_challenge_v1($1,$2,$3,$4) receipt',
      [fcId, phone, challengeId, hash],
    )).rows[0].receipt;
  }
  async function verify(challengeId = firstChallenge, hash = otpHash, proof = proofHash) {
    return (await db.query(
      'select public.process_signup_otp_challenge_v1($1,$2,$3,$4,false) receipt',
      [phone, challengeId, hash, proof],
    )).rows[0].receipt;
  }
  async function complete(proof = proofHash, options = {}) {
    const input = {
      name: 'Verified name',
      affiliation: '1본부 서선미',
      email: 'verified@example.com',
      carrier: 'SKT',
      licenseStatuses: ['none'],
      inviterFcId: inviterAId,
      referralCodeId: referralCodeAId,
      referralCode: 'CODEA',
      ...options,
    };
    return (await db.query(
      'select public.complete_fc_signup_atomic_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) receipt',
      [
        fcId,
        phone,
        passwordHash,
        passwordSalt,
        proof,
        input.name,
        input.affiliation,
        input.email,
        input.carrier,
        input.licenseStatuses,
        input.inviterFcId,
        input.referralCodeId,
        input.referralCode,
      ],
    )).rows[0].receipt;
  }
  return { db, issue, verify, complete };
}

test('request issuance changes only challenge state and concurrent issuance respects cooldown', async () => {
  const f = await fixture();
  try {
    await f.db.query(
      `insert into public.fc_identity_secure
       (fc_id,resident_number_encrypted,address_encrypted) values ($1,'resident','address')`,
      [fcId],
    );
    await f.db.query(
      `insert into public.fc_credentials (fc_id,password_hash,password_salt,password_set_at)
       values ($1,$2,$3,now())`,
      [fcId, passwordHash, passwordSalt],
    );
    await f.db.query(
      `update public.fc_profiles
       set signup_verification_proof_hash=$2,
           signup_verification_proof_expires_at=now()+interval '10 minutes'
       where id=$1`,
      [fcId, proofHash],
    );
    const [first, second] = await Promise.all([
      f.issue(firstChallenge),
      f.issue(secondChallenge),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.code, 'cooldown');
    const state = (await f.db.query(
      `select name,status,signup_verification_proof_hash,
       (select count(*)::int from public.fc_identity_secure) secure_count,
       (select count(*)::int from public.fc_credentials) credential_count
       from public.fc_profiles where id=$1`,
      [fcId],
    )).rows[0];
    assert.equal(state.name, 'Stale name');
    assert.equal(state.status, 'active');
    assert.equal(state.signup_verification_proof_hash, proofHash);
    assert.equal(state.secure_count, 1);
    assert.equal(state.credential_count, 1);
  } finally {
    await f.db.close();
  }
});

test('every signup challenge lookup excludes manager referral shadow profiles at selection time', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (migration.match(/and coalesce\(profile\.is_manager_referral_shadow, false\) = false/g) ?? []).length,
      4,
    );
    await f.db.query(
      'update public.fc_profiles set is_manager_referral_shadow=true where id=$1',
      [fcId],
    );
    assert.equal((await f.issue()).code, 'profile_unavailable');
    assert.equal((await f.verify()).code, 'not_found');
    const proofValidation = (await f.db.query(
      'select public.validate_signup_verification_proof_v1($1,$2) receipt',
      [phone, proofHash],
    )).rows[0].receipt;
    assert.equal(proofValidation.code, 'proof_invalid');
    await assert.rejects(f.complete(), /signup_completion_proof_invalid/);
  } finally {
    await f.db.close();
  }
});

test('stale challenge cannot clear a replacement and concurrent guesses reach the lock', async () => {
  const f = await fixture();
  try {
    await f.issue(firstChallenge);
    await f.db.query(
      `update public.fc_profiles set phone_verification_sent_at=now()-interval '61 seconds' where id=$1`,
      [fcId],
    );
    assert.equal((await f.issue(secondChallenge)).ok, true);
    assert.equal((await f.verify(firstChallenge)).code, 'stale_challenge');
    const guesses = await Promise.all(Array.from({ length: 5 }, () => (
      f.verify(secondChallenge, wrongHash)
    )));
    assert.equal(guesses.filter((receipt) => receipt.code === 'invalid_code').length, 4);
    assert.equal(guesses.filter((receipt) => receipt.code === 'locked').length, 1);
    const state = (await f.db.query(
      `select phone_verification_challenge_id,phone_verification_attempts,
       phone_verification_locked_until from public.fc_profiles where id=$1`,
      [fcId],
    )).rows[0];
    assert.equal(state.phone_verification_challenge_id, secondChallenge);
    assert.equal(state.phone_verification_attempts, 0);
    assert.ok(state.phone_verification_locked_until);
  } finally {
    await f.db.close();
  }
});

test('verification cannot reset an account completed after its challenge was issued', async () => {
  const f = await fixture();
  try {
    await f.issue();
    await f.db.query(
      `update public.fc_profiles set signup_completed=true where id=$1`,
      [fcId],
    );
    await f.db.query(
      `insert into public.fc_credentials (fc_id,password_hash,password_salt,password_set_at)
       values ($1,$2,$3,now())`,
      [fcId, passwordHash, passwordSalt],
    );
    assert.deepEqual(await f.verify(), { ok: false, code: 'account_exists' });
    const state = (await f.db.query(
      `select profile.signup_completed,profile.phone_verified,credential.password_hash
       from public.fc_profiles profile
       join public.fc_credentials credential on credential.fc_id=profile.id
       where profile.id=$1`,
      [fcId],
    )).rows[0];
    assert.equal(state.signup_completed, true);
    assert.equal(state.phone_verified, false);
    assert.equal(state.password_hash, passwordHash);
  } finally {
    await f.db.close();
  }
});

test('verification resets DB artifacts atomically and returns no secret material', async () => {
  const f = await fixture();
  try {
    await f.db.query(
      `insert into public.profiles (id,fc_id)
       values ('30000000-0000-4000-8000-000000000001',$1)`,
      [fcId],
    );
    await f.db.query(
      `insert into public.fc_identity_secure
       (fc_id,resident_number_encrypted,address_encrypted) values ($1,'resident','address')`,
      [fcId],
    );
    await f.db.query(
      `insert into public.fc_credentials (fc_id,password_hash,password_salt,password_set_at)
       values ($1,$2,$3,now())`,
      [fcId, passwordHash, passwordSalt],
    );
    await f.issue();
    const receipt = await f.verify();
    assert.equal(receipt.ok, true);
    assert.equal(receipt.verified, true);
    assert.equal(receipt.profileId, fcId);
    assert.equal(JSON.stringify(receipt).includes(proofHash), false);
    assert.equal(JSON.stringify(receipt).includes(otpHash), false);
    const state = (await f.db.query(
      `select name,status,phone_verified,signup_verification_proof_hash,
       (select count(*)::int from public.profiles) profile_count,
       (select count(*)::int from public.fc_identity_secure) secure_count,
       (select count(*)::int from public.fc_credentials) credential_count
       from public.fc_profiles where id=$1`,
      [fcId],
    )).rows[0];
    assert.equal(state.name, '');
    assert.equal(state.status, 'draft');
    assert.equal(state.phone_verified, true);
    assert.equal(state.signup_verification_proof_hash, proofHash);
    assert.equal(state.profile_count, 0);
    assert.equal(state.secure_count, 0);
    assert.equal(state.credential_count, 0);
    assert.equal((await f.verify()).code, 'stale_challenge');
  } finally {
    await f.db.close();
  }
});

test('a reset failure rolls back deletes, profile changes, and challenge consumption', async () => {
  const f = await fixture();
  try {
    await f.db.query(
      `insert into public.fc_identity_secure
       (fc_id,resident_number_encrypted,address_encrypted) values ($1,'resident','address')`,
      [fcId],
    );
    await f.issue();
    await f.db.exec(`
      create function reject_verified_profile_write() returns trigger language plpgsql as $$
      begin
        if new.phone_verified then raise exception 'synthetic_reset_failure'; end if;
        return new;
      end $$;
      create trigger reject_verified_profile before update on public.fc_profiles
      for each row execute function reject_verified_profile_write();
    `);
    await assert.rejects(f.verify(), /synthetic_reset_failure/);
    const state = (await f.db.query(
      `select phone_verified,phone_verification_challenge_id,
       (select count(*)::int from public.fc_identity_secure) secure_count
       from public.fc_profiles where id=$1`,
      [fcId],
    )).rows[0];
    assert.equal(state.phone_verified, false);
    assert.equal(state.phone_verification_challenge_id, firstChallenge);
    assert.equal(state.secure_count, 1);
  } finally {
    await f.db.close();
  }
});

test('signup proof is phone-bound, expiring, single-use, and consumed with credentials', async () => {
  const f = await fixture();
  try {
    await f.issue();
    await f.verify();
    const attempts = await Promise.allSettled([
      f.complete(proofHash, {
        name: 'First winner',
        inviterFcId: inviterAId,
        referralCodeId: referralCodeAId,
        referralCode: 'CODEA',
      }),
      f.complete(proofHash, {
        name: 'Second winner',
        inviterFcId: inviterBId,
        referralCodeId: referralCodeBId,
        referralCode: 'CODEB',
      }),
    ]);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1);
    const winner = attempts.find((result) => result.status === 'fulfilled').value;
    const state = (await f.db.query(
      `select profile.signup_completed,profile.signup_verification_proof_hash,
       profile.name,profile.recommender_fc_id,profile.recommender_code_id,
       profile.recommender_code,credential.password_hash from public.fc_profiles profile
       join public.fc_credentials credential on credential.fc_id=profile.id
       where profile.id=$1`,
      [fcId],
    )).rows[0];
    assert.equal(state.signup_completed, true);
    assert.equal(state.signup_verification_proof_hash, null);
    assert.equal(state.password_hash, passwordHash);
    assert.equal(state.name, winner.displayName);
    assert.equal(state.recommender_fc_id, winner.inviterFcId);
    assert.equal(state.recommender_code_id, winner.referralCodeId);
    assert.equal(state.recommender_code, winner.referralCode);
    await assert.rejects(f.complete(), /signup_completion_proof_invalid/);
  } finally {
    await f.db.close();
  }
});

test('expired proof and credential failure cannot complete or consume proof', async () => {
  const f = await fixture();
  try {
    await f.issue();
    await f.verify();
    await f.db.query(
      `update public.fc_profiles set signup_verification_proof_expires_at=now()-interval '1 second'
       where id=$1`,
      [fcId],
    );
    await assert.rejects(f.complete(), /signup_completion_proof_invalid/);
    await f.db.query(
      `update public.fc_profiles set signup_verification_proof_expires_at=now()+interval '10 minutes'
       where id=$1`,
      [fcId],
    );
    await f.db.exec(`
      create function reject_signup_credential() returns trigger language plpgsql as $$
      begin raise exception 'synthetic_credential_failure'; end $$;
      create trigger reject_signup_credential before insert on public.fc_credentials
      for each row execute function reject_signup_credential();
    `);
    await assert.rejects(f.complete(), /synthetic_credential_failure/);
    const state = (await f.db.query(
      `select signup_completed,signup_verification_proof_hash from public.fc_profiles where id=$1`,
      [fcId],
    )).rows[0];
    assert.equal(state.signup_completed, false);
    assert.equal(state.signup_verification_proof_hash, proofHash);
  } finally {
    await f.db.close();
  }
});

test('signup challenge functions are service-role only and schema mirrors the migration', async () => {
  const f = await fixture();
  try {
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`set role ${role}`);
      await assert.rejects(f.issue(), /permission denied for function/);
      await assert.rejects(f.verify(), /permission denied for function/);
      await assert.rejects(f.complete(), /permission denied for function/);
      await f.db.exec('reset role');
    }
    const metadata = await f.db.query(`
      select proname,prosecdef from pg_proc
      where proname in (
        'issue_signup_otp_challenge_v1',
        'process_signup_otp_challenge_v1',
        'validate_signup_verification_proof_v1',
        'complete_fc_signup_atomic_v1'
      ) order by proname
    `);
    assert.equal(metadata.rows.length, 4);
    assert.ok(metadata.rows.every((row) => row.prosecdef === true));
    assert.ok(schema.replaceAll('\r\n', '\n').includes(migration.replaceAll('\r\n', '\n').trim()));
    assert.doesNotMatch(migration, /verificationProof/);
  } finally {
    await f.db.close();
  }
});
