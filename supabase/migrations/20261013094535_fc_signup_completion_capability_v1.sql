-- Bind legacy FC signup completion to a short-lived OTP capability and commit
-- profile, referral and credential state in one database transaction.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.fc_signup_completion_challenges (
  fc_id uuid primary key references public.fc_profiles (id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  request_fingerprint text check (
    request_fingerprint is null or request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at),
  check (
    (consumed_at is null and request_fingerprint is null and result is null)
    or (consumed_at is not null and request_fingerprint is not null and result is not null)
  )
);

create index fc_signup_completion_challenges_expires_idx
  on public.fc_signup_completion_challenges (expires_at)
  where consumed_at is null;

alter table public.fc_signup_completion_challenges enable row level security;
revoke all privileges on table public.fc_signup_completion_challenges
  from public, anon, authenticated;
grant select, insert, update, delete on table public.fc_signup_completion_challenges
  to service_role;

create or replace function public.invalidate_fc_signup_completion_challenge_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.phone_verification_hash is not null
    and old.phone_verification_hash is distinct from new.phone_verification_hash then
    delete from public.fc_signup_completion_challenges challenge
    where challenge.fc_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.invalidate_fc_signup_completion_challenge_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists invalidate_fc_signup_completion_challenge_v1 on public.fc_profiles;
create trigger invalidate_fc_signup_completion_challenge_v1
after update of phone_verification_hash on public.fc_profiles
for each row execute function public.invalidate_fc_signup_completion_challenge_v1();

create or replace function public.verify_fc_signup_otp_v1(
  p_phone text,
  p_code_hash text,
  p_completion_token_hash text,
  p_test_bypass boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  profile_row public.fc_profiles%rowtype;
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  checked_at timestamptz;
  next_attempts integer;
  proof_expires_at timestamptz;
begin
  if normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_completion_token_hash, '') !~ '^[a-f0-9]{64}$'
    or (
      coalesce(p_test_bypass, false) is false
      and (p_code_hash is null or char_length(p_code_hash) not between 1 and 128)
    ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));

  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if profile_row.signup_completed is true
    or profile_row.is_manager_referral_shadow is true then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  checked_at := clock_timestamp();

  -- A test bypass changes only the comparison step. It never creates an OTP
  -- challenge and cannot skip expiry or lock enforcement.
  if profile_row.phone_verification_hash is null
    or profile_row.phone_verification_expires_at is null then
    return jsonb_build_object('ok', false, 'code', 'no_code');
  end if;

  if profile_row.phone_verification_expires_at <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'expired_code');
  end if;

  if profile_row.phone_verification_locked_until is not null
    and profile_row.phone_verification_locked_until > checked_at then
    return jsonb_build_object('ok', false, 'code', 'locked');
  end if;

  if coalesce(p_test_bypass, false) is false
    and profile_row.phone_verification_hash is distinct from p_code_hash then
    next_attempts := least(coalesce(profile_row.phone_verification_attempts, 0) + 1, 5);

    update public.fc_profiles
    set phone_verification_attempts = next_attempts,
        phone_verification_locked_until = case
          when next_attempts >= 5 then checked_at + interval '10 minutes'
          else phone_verification_locked_until
        end,
        updated_at = checked_at
    where id = profile_row.id;

    return jsonb_build_object(
      'ok', false,
      'code', case when next_attempts >= 5 then 'locked' else 'invalid_code' end
    );
  end if;

  proof_expires_at := checked_at + interval '15 minutes';

  update public.fc_profiles
  set phone_verified = true,
      phone_verified_at = checked_at,
      signup_verification_method = 'phone_otp',
      signup_verified_at = checked_at,
      signup_verified_by_admin_id = null,
      phone_verification_hash = null,
      phone_verification_expires_at = null,
      phone_verification_sent_at = null,
      phone_verification_attempts = 0,
      phone_verification_locked_until = null,
      updated_at = checked_at
  where id = profile_row.id;

  insert into public.fc_signup_completion_challenges (
    fc_id,
    token_hash,
    expires_at,
    consumed_at,
    request_fingerprint,
    result,
    created_at,
    updated_at
  ) values (
    profile_row.id,
    p_completion_token_hash,
    proof_expires_at,
    null,
    null,
    null,
    checked_at,
    checked_at
  )
  on conflict (fc_id) do update
  set token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      consumed_at = null,
      request_fingerprint = null,
      result = null,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'fcId', profile_row.id,
    'expiresAt', proof_expires_at
  );
end;
$$;

create or replace function public.complete_fc_otp_signup_v1(
  p_phone text,
  p_completion_token_hash text,
  p_request_fingerprint text,
  p_name text,
  p_affiliation text,
  p_email text,
  p_carrier text,
  p_license_statuses text[],
  p_referral_code text,
  p_referral_inviter_fc_id uuid,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  profile_row public.fc_profiles%rowtype;
  credential_row public.fc_credentials%rowtype;
  proof_row public.fc_signup_completion_challenges%rowtype;
  inviter_row public.fc_profiles%rowtype;
  referral_code_row public.referral_codes%rowtype;
  referral_result jsonb;
  stored_result jsonb;
  credential_session_version bigint;
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_affiliation text := trim(coalesce(p_affiliation, ''));
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_carrier text := trim(coalesce(p_carrier, ''));
  normalized_referral_code text := upper(trim(coalesce(p_referral_code, '')));
  normalized_license_statuses text[];
  checked_at timestamptz;
  next_status text;
  next_life_completed boolean;
  next_nonlife_completed boolean;
begin
  select coalesce(array_agg(distinct status_value order by status_value), array[]::text[])
    into normalized_license_statuses
  from unnest(coalesce(p_license_statuses, array[]::text[])) status_value;

  if normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_completion_token_hash, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
    or char_length(normalized_name) not between 2 and 40
    or char_length(normalized_affiliation) not between 2 and 80
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or normalized_carrier not in (
      'SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰'
    )
    or cardinality(normalized_license_statuses) = 0
    or exists (
      select 1
      from unnest(normalized_license_statuses) status_value
      where status_value is null
        or status_value not in ('third', 'life', 'nonlife', 'none')
    )
    or (
      'none' = any(normalized_license_statuses)
      and cardinality(normalized_license_statuses) > 1
    )
    or normalized_referral_code = ''
    or char_length(normalized_referral_code) > 64
    or p_referral_inviter_fc_id is null
    or coalesce(p_password_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
    or coalesce(p_password_salt, '') !~ '^[A-Za-z0-9+/]{22}==$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));

  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select challenge.*
    into proof_row
  from public.fc_signup_completion_challenges challenge
  where challenge.fc_id = profile_row.id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'proof_required');
  end if;

  checked_at := clock_timestamp();

  if proof_row.token_hash is distinct from p_completion_token_hash then
    return jsonb_build_object('ok', false, 'code', 'proof_invalid');
  end if;

  if proof_row.expires_at <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'proof_expired');
  end if;

  if proof_row.consumed_at is not null then
    if proof_row.request_fingerprint is not distinct from p_request_fingerprint
      and proof_row.result is not null then
      return jsonb_set(proof_row.result, '{alreadyApplied}', 'true'::jsonb, true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'request_conflict');
  end if;

  -- phone_verified without the matching, live proof above is never authority.
  if profile_row.phone_verified is distinct from true
    or profile_row.signup_verification_method is distinct from 'phone_otp'
    or profile_row.phone_verified_at is null
    or profile_row.signup_verified_at is null then
    return jsonb_build_object('ok', false, 'code', 'proof_required');
  end if;

  if profile_row.signup_completed is true
    or profile_row.is_manager_referral_shadow is true then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.admin_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.manager_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  select credential.*
    into credential_row
  from public.fc_credentials credential
  where credential.fc_id = profile_row.id
  for update;

  if found and credential_row.password_set_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  if p_referral_inviter_fc_id = profile_row.id then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  select inviter.*
    into inviter_row
  from public.fc_profiles inviter
  where inviter.id = p_referral_inviter_fc_id
  for update;

  if not found
    or (
      inviter_row.signup_completed is distinct from true
      and inviter_row.is_manager_referral_shadow is distinct from true
    ) then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  select referral_code.*
    into referral_code_row
  from public.referral_codes referral_code
  where referral_code.code = normalized_referral_code
    and referral_code.fc_id = p_referral_inviter_fc_id
    and referral_code.is_active is true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  -- Keep the current onboarding gate: license selections do not bypass the
  -- workflow. The database, rather than the client, derives all three fields.
  next_status := 'draft';
  next_life_completed := false;
  next_nonlife_completed := false;

  -- apply_referral_link_state is authoritative for inviter eligibility and
  -- graph invariants. Its writes run in a subtransaction so a failure cannot
  -- leave a partial referral mutation or consume the completion proof.
  begin
    referral_result := public.apply_referral_link_state(
      p_invitee_fc_id => profile_row.id,
      p_inviter_fc_id => p_referral_inviter_fc_id,
      p_referral_code_id => referral_code_row.id,
      p_referral_code => referral_code_row.code,
      p_source => 'signup',
      p_actor_phone => normalized_phone,
      p_actor_role => 'system',
      p_actor_staff_type => null,
      p_reason => 'complete_fc_otp_signup_v1'
    );

    if coalesce((referral_result ->> 'ok')::boolean, false) is not true then
      raise exception 'fc_signup_referral_failed';
    end if;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end;

  update public.fc_profiles
  set name = normalized_name,
      affiliation = normalized_affiliation,
      email = normalized_email,
      carrier = normalized_carrier,
      license_statuses = normalized_license_statuses,
      status = next_status,
      life_commission_completed = next_life_completed,
      nonlife_commission_completed = next_nonlife_completed,
      address = '',
      address_detail = null,
      resident_id_masked = null,
      resident_id_hash = null,
      identity_completed = false,
      temp_id = null,
      allowance_date = null,
      allowance_prescreen_requested_at = null,
      allowance_reject_reason = null,
      docs_deadline_at = null,
      docs_deadline_last_notified_at = null,
      appointment_url = null,
      appointment_date = null,
      appointment_schedule_life = null,
      appointment_schedule_nonlife = null,
      appointment_date_life = null,
      appointment_date_nonlife = null,
      appointment_date_life_sub = null,
      appointment_date_nonlife_sub = null,
      appointment_reject_reason_life = null,
      appointment_reject_reason_nonlife = null,
      hanwha_commission_date_sub = null,
      hanwha_commission_date = null,
      hanwha_commission_reject_reason = null,
      hanwha_commission_pdf_path = null,
      hanwha_commission_pdf_name = null,
      dawichok_url_sent_at = null,
      dawichok_url_sent_by = null,
      signup_completed = true,
      signup_verification_method = 'phone_otp',
      signup_verified_by_admin_id = null,
      updated_at = checked_at
  where id = profile_row.id;

  insert into public.fc_credentials (
    fc_id,
    password_hash,
    password_salt,
    password_set_at,
    failed_count,
    locked_until,
    reset_token_hash,
    reset_token_expires_at,
    reset_sent_at,
    reset_failed_count,
    must_change_password,
    temporary_password_issued_at,
    created_at,
    updated_at
  ) values (
    profile_row.id,
    p_password_hash,
    p_password_salt,
    checked_at,
    0,
    null,
    null,
    null,
    null,
    0,
    false,
    null,
    checked_at,
    checked_at
  )
  on conflict (fc_id) do update
  set password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_set_at = excluded.password_set_at,
      failed_count = 0,
      locked_until = null,
      reset_token_hash = null,
      reset_token_expires_at = null,
      reset_sent_at = null,
      reset_failed_count = 0,
      must_change_password = false,
      temporary_password_issued_at = null,
      updated_at = excluded.updated_at
  returning session_version into credential_session_version;

  stored_result := jsonb_build_object(
    'ok', true,
    'fcId', profile_row.id,
    'residentId', normalized_phone,
    'displayName', normalized_name,
    'affiliation', normalized_affiliation,
    'sessionVersion', credential_session_version,
    'alreadyApplied', false
  );

  update public.fc_signup_completion_challenges
  set consumed_at = checked_at,
      request_fingerprint = p_request_fingerprint,
      result = stored_result,
      updated_at = checked_at
  where fc_id = profile_row.id
    and token_hash = p_completion_token_hash
    and consumed_at is null;

  if not found then
    raise exception 'fc_signup_completion_proof_lost';
  end if;

  return stored_result;
end;
$$;

revoke all on function public.verify_fc_signup_otp_v1(text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.verify_fc_signup_otp_v1(text, text, text, boolean)
  to service_role;

revoke all on function public.complete_fc_otp_signup_v1(
  text, text, text, text, text, text, text, text[], text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.complete_fc_otp_signup_v1(
  text, text, text, text, text, text, text, text[], text, uuid, text, text
) to service_role;

comment on table public.fc_signup_completion_challenges is
  'Service-only, short-lived hashed capability for atomic FC OTP signup completion.';
comment on function public.verify_fc_signup_otp_v1(text, text, text, boolean) is
  'Verifies a live FC signup OTP challenge and issues a 15-minute hashed completion capability.';
comment on function public.complete_fc_otp_signup_v1(
  text, text, text, text, text, text, text, text[], text, uuid, text, text
) is
  'Atomically consumes an OTP capability and commits FC profile, referral and credential state.';
