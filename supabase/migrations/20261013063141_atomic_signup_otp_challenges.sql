-- Own signup OTP issuance, guessing, verification, reset, and proof
-- consumption under the FC profile row lock. Only service-role Edge
-- functions may call these boundaries.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.fc_profiles
  add column if not exists phone_verification_challenge_id uuid;
alter table public.fc_profiles
  add column if not exists signup_verification_proof_hash text;
alter table public.fc_profiles
  add column if not exists signup_verification_proof_expires_at timestamptz;

create or replace function public.issue_signup_otp_challenge_v1(
  p_fc_id uuid,
  p_expected_phone text,
  p_challenge_id uuid,
  p_otp_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_now timestamptz;
  v_expires_at timestamptz;
begin
  if p_fc_id is null or p_challenge_id is null
    or v_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_otp_hash, '')) <> 44
    or p_otp_hash !~ '^[A-Za-z0-9+/]+={0,2}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select profile.* into v_profile
  from public.fc_profiles profile
  where profile.id = p_fc_id
    and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_phone
    and coalesce(profile.is_manager_referral_shadow, false) = false
  for update;

  if not found or coalesce(v_profile.is_manager_referral_shadow, false) then
    return jsonb_build_object('ok', false, 'code', 'profile_unavailable');
  end if;
  if v_profile.signup_completed is true and exists (
    select 1 from public.fc_credentials credential
    where credential.fc_id = v_profile.id
      and credential.password_set_at is not null
  ) then
    return jsonb_build_object('ok', false, 'code', 'account_exists');
  end if;

  v_now := clock_timestamp();
  if v_profile.phone_verification_locked_until > v_now then
    return jsonb_build_object(
      'ok', false,
      'code', 'locked',
      'lockedUntil', v_profile.phone_verification_locked_until
    );
  end if;
  if v_profile.phone_verification_sent_at > v_now - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'code', 'cooldown');
  end if;

  v_expires_at := v_now + interval '5 minutes';
  update public.fc_profiles
  set phone_verification_challenge_id = p_challenge_id,
      phone_verification_hash = p_otp_hash,
      phone_verification_expires_at = v_expires_at,
      phone_verification_sent_at = v_now,
      phone_verification_attempts = 0,
      phone_verification_locked_until = null,
      updated_at = v_now
  where id = p_fc_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'issued',
    'profileId', p_fc_id,
    'residentId', v_phone,
    'challengeId', p_challenge_id,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.process_signup_otp_challenge_v1(
  p_expected_phone text,
  p_challenge_id uuid,
  p_submitted_hash text,
  p_verification_proof_hash text,
  p_allow_test_bypass boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_now timestamptz;
  v_attempts integer;
  v_locked_until timestamptz;
  v_proof_expires_at timestamptz;
begin
  if p_challenge_id is null or v_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_submitted_hash, '')) <> 44
    or p_submitted_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_verification_proof_hash, '')) <> 44
    or p_verification_proof_hash !~ '^[A-Za-z0-9+/]+={0,2}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select profile.* into v_profile
  from public.fc_profiles profile
  where regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_phone
    and coalesce(profile.is_manager_referral_shadow, false) = false
  for update;

  if not found or coalesce(v_profile.is_manager_referral_shadow, false) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_profile.signup_completed is true and exists (
    select 1 from public.fc_credentials credential
    where credential.fc_id = v_profile.id
      and credential.password_set_at is not null
  ) then
    return jsonb_build_object('ok', false, 'code', 'account_exists');
  end if;

  v_now := clock_timestamp();
  if v_profile.phone_verification_locked_until > v_now then
    return jsonb_build_object(
      'ok', false,
      'code', 'locked',
      'lockedUntil', v_profile.phone_verification_locked_until
    );
  end if;
  if v_profile.phone_verification_challenge_id is distinct from p_challenge_id then
    return jsonb_build_object('ok', false, 'code', 'stale_challenge');
  end if;
  if v_profile.phone_verification_hash is null
    or v_profile.phone_verification_expires_at is null then
    return jsonb_build_object('ok', false, 'code', 'no_code');
  end if;
  if v_profile.phone_verification_expires_at <= v_now then
    return jsonb_build_object('ok', false, 'code', 'expired_code');
  end if;

  if not p_allow_test_bypass
    and v_profile.phone_verification_hash is distinct from p_submitted_hash then
    v_attempts := coalesce(v_profile.phone_verification_attempts, 0) + 1;
    if v_attempts >= 5 then
      v_locked_until := v_now + interval '10 minutes';
      update public.fc_profiles
      set phone_verification_attempts = 0,
          phone_verification_locked_until = v_locked_until,
          updated_at = v_now
      where id = v_profile.id;
      return jsonb_build_object(
        'ok', false,
        'code', 'locked',
        'lockedUntil', v_locked_until,
        'remaining', 0
      );
    end if;

    update public.fc_profiles
    set phone_verification_attempts = v_attempts,
        updated_at = v_now
    where id = v_profile.id;
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_code',
      'remaining', 5 - v_attempts
    );
  end if;

  -- Old DB-side onboarding artifacts are removed only after the caller has
  -- proved control of the phone, and all changes roll back together.
  delete from public.profiles where fc_id = v_profile.id;
  delete from public.fc_identity_secure where fc_id = v_profile.id;
  delete from public.fc_credentials where fc_id = v_profile.id;

  v_proof_expires_at := v_now + interval '10 minutes';
  update public.fc_profiles
  set name = '',
      affiliation = '',
      recommender = null,
      recommender_fc_id = null,
      recommender_code_id = null,
      recommender_code = null,
      recommender_linked_at = null,
      recommender_link_source = null,
      email = '',
      address = '',
      address_detail = null,
      resident_id_masked = null,
      resident_id_hash = null,
      identity_completed = false,
      status = 'draft',
      life_commission_completed = false,
      nonlife_commission_completed = false,
      temp_id = null,
      allowance_date = null,
      allowance_prescreen_requested_at = null,
      allowance_reject_reason = null,
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
      docs_deadline_at = null,
      docs_deadline_last_notified_at = null,
      hanwha_commission_date_sub = null,
      hanwha_commission_date = null,
      hanwha_commission_reject_reason = null,
      hanwha_commission_pdf_path = null,
      hanwha_commission_pdf_name = null,
      dawichok_url_sent_at = null,
      dawichok_url_sent_by = null,
      signup_completed = false,
      phone_verified = true,
      phone_verified_at = v_now,
      signup_verification_method = 'phone_otp',
      signup_verified_at = v_now,
      signup_verified_by_admin_id = null,
      phone_verification_challenge_id = null,
      phone_verification_hash = null,
      phone_verification_expires_at = null,
      phone_verification_sent_at = null,
      phone_verification_attempts = 0,
      phone_verification_locked_until = null,
      signup_verification_proof_hash = p_verification_proof_hash,
      signup_verification_proof_expires_at = v_proof_expires_at,
      updated_at = v_now
  where id = v_profile.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'verified',
    'verified', true,
    'profileId', v_profile.id,
    'residentId', v_phone,
    'challengeId', p_challenge_id,
    'verifiedAt', v_now,
    'proofExpiresAt', v_proof_expires_at
  );
end;
$$;

create or replace function public.validate_signup_verification_proof_v1(
  p_expected_phone text,
  p_verification_proof_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
begin
  if v_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_verification_proof_hash, '')) <> 44
    or p_verification_proof_hash !~ '^[A-Za-z0-9+/]+={0,2}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select profile.* into v_profile
  from public.fc_profiles profile
  where regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_phone
    and coalesce(profile.is_manager_referral_shadow, false) = false;

  if not found or v_profile.phone_verified is distinct from true
    or v_profile.signup_completed is true
    or coalesce(v_profile.is_manager_referral_shadow, false)
    or v_profile.signup_verification_proof_hash is distinct from p_verification_proof_hash
    or v_profile.signup_verification_proof_expires_at is null
    or v_profile.signup_verification_proof_expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'proof_invalid');
  end if;

  return jsonb_build_object(
    'ok', true,
    'profileId', v_profile.id,
    'residentId', v_phone
  );
end;
$$;

drop function if exists public.complete_fc_signup_atomic_v1(uuid, text, text, text);

create or replace function public.complete_fc_signup_atomic_v1(
  p_fc_id uuid,
  p_expected_phone text,
  p_password_hash text,
  p_password_salt text,
  p_verification_proof_hash text,
  p_name text,
  p_affiliation text,
  p_email text,
  p_carrier text,
  p_license_statuses text[],
  p_inviter_fc_id uuid,
  p_referral_code_id uuid,
  p_referral_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_existing_password_set_at timestamptz;
  v_now timestamptz;
  v_name text := btrim(coalesce(p_name, ''));
  v_affiliation text := btrim(coalesce(p_affiliation, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_carrier text := btrim(coalesce(p_carrier, ''));
  v_referral_result jsonb;
begin
  if p_fc_id is null or v_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_password_hash, '')) <> 44
    or p_password_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_password_salt, '')) <> 24
    or p_password_salt !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_verification_proof_hash, '')) <> 44
    or p_verification_proof_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(v_name) not between 1 and 100
    or char_length(v_affiliation) not between 1 and 100
    or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or v_carrier not in ('SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰')
    or p_license_statuses is null
    or cardinality(p_license_statuses) = 0
    or exists (
      select 1 from unnest(p_license_statuses) status_value
      where status_value not in ('third', 'life', 'nonlife', 'none')
    )
    or ('none' = any(p_license_statuses) and cardinality(p_license_statuses) > 1)
    or p_inviter_fc_id is null
    or p_referral_code_id is null
    or nullif(btrim(coalesce(p_referral_code, '')), '') is null then
    raise exception using errcode = '22023', message = 'signup_completion_payload_invalid';
  end if;

  select profile.* into v_profile
  from public.fc_profiles profile
  where profile.id = p_fc_id
    and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_phone
    and coalesce(profile.is_manager_referral_shadow, false) = false
  for update;

  v_now := clock_timestamp();
  if not found or v_profile.phone_verified is distinct from true
    or v_profile.signup_completed is true
    or coalesce(v_profile.is_manager_referral_shadow, false)
    or v_profile.signup_verification_proof_hash is distinct from p_verification_proof_hash
    or v_profile.signup_verification_proof_expires_at is null
    or v_profile.signup_verification_proof_expires_at <= v_now then
    raise exception using errcode = '42501', message = 'signup_completion_proof_invalid';
  end if;

  select credential.password_set_at into v_existing_password_set_at
  from public.fc_credentials credential
  where credential.fc_id = p_fc_id
  for update;
  if found and v_existing_password_set_at is not null then
    raise exception using errcode = '55000', message = 'signup_password_already_set';
  end if;

  update public.fc_profiles
  set name = v_name,
      affiliation = v_affiliation,
      email = v_email,
      carrier = v_carrier,
      license_statuses = p_license_statuses,
      status = 'draft',
      life_commission_completed = false,
      nonlife_commission_completed = false,
      address = '',
      address_detail = null,
      resident_id_masked = null,
      resident_id_hash = null,
      identity_completed = false,
      temp_id = null,
      allowance_date = null,
      allowance_prescreen_requested_at = null,
      allowance_reject_reason = null,
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
      docs_deadline_at = null,
      docs_deadline_last_notified_at = null,
      hanwha_commission_date_sub = null,
      hanwha_commission_date = null,
      hanwha_commission_reject_reason = null,
      hanwha_commission_pdf_path = null,
      hanwha_commission_pdf_name = null,
      dawichok_url_sent_at = null,
      dawichok_url_sent_by = null,
      recommender = null,
      recommender_fc_id = null,
      recommender_code_id = null,
      recommender_code = null,
      recommender_linked_at = null,
      recommender_link_source = null,
      signup_completed = true,
      signup_verification_method = 'phone_otp',
      signup_verified_at = v_now,
      signup_verified_by_admin_id = null,
      signup_verification_proof_hash = null,
      signup_verification_proof_expires_at = null,
      updated_at = v_now
  where id = p_fc_id;

  v_referral_result := public.apply_referral_link_state(
    p_invitee_fc_id => p_fc_id,
    p_inviter_fc_id => p_inviter_fc_id,
    p_referral_code_id => p_referral_code_id,
    p_referral_code => upper(btrim(p_referral_code)),
    p_source => 'signup',
    p_actor_phone => v_phone,
    p_actor_role => 'system',
    p_actor_staff_type => null,
    p_reason => 'set_password_signup'
  );
  if coalesce((v_referral_result ->> 'ok')::boolean, false) is not true
    or v_referral_result ->> 'inviteeFcId' is distinct from p_fc_id::text
    or v_referral_result ->> 'inviterFcId' is distinct from p_inviter_fc_id::text
    or v_referral_result ->> 'referralCodeId' is distinct from p_referral_code_id::text then
    raise exception using errcode = '55000', message = 'signup_referral_write_unverified';
  end if;

  insert into public.fc_credentials as credential (
    fc_id, password_hash, password_salt, password_set_at,
    failed_count, locked_until, reset_token_hash, reset_token_expires_at,
    reset_sent_at, reset_failed_count, must_change_password,
    temporary_password_issued_at, updated_at
  ) values (
    p_fc_id, p_password_hash, p_password_salt, v_now,
    0, null, null, null, null, 0, false, null, v_now
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
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'fcId', p_fc_id,
    'residentId', v_phone,
    'displayName', v_name,
    'signupCompleted', true,
    'passwordSetAt', v_now,
    'inviterFcId', v_referral_result ->> 'inviterFcId',
    'referralCodeId', v_referral_result ->> 'referralCodeId',
    'referralCode', v_referral_result ->> 'referralCode'
  );
end;
$$;

revoke all on function public.issue_signup_otp_challenge_v1(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.issue_signup_otp_challenge_v1(uuid, text, uuid, text)
  to service_role;
revoke all on function public.process_signup_otp_challenge_v1(text, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.process_signup_otp_challenge_v1(text, uuid, text, text, boolean)
  to service_role;
revoke all on function public.validate_signup_verification_proof_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.validate_signup_verification_proof_v1(text, text)
  to service_role;
revoke all on function public.complete_fc_signup_atomic_v1(
  uuid, text, text, text, text, text, text, text, text, text[], uuid, uuid, text
)
  from public, anon, authenticated;
grant execute on function public.complete_fc_signup_atomic_v1(
  uuid, text, text, text, text, text, text, text, text, text[], uuid, uuid, text
)
  to service_role;

comment on function public.process_signup_otp_challenge_v1(text, uuid, text, text, boolean)
  is 'Atomically verifies a current signup OTP, resets only DB-local partial artifacts, and issues a bounded one-time proof. Service role only.';
comment on function public.complete_fc_signup_atomic_v1(
  uuid, text, text, text, text, text, text, text, text, text[], uuid, uuid, text
)
  is 'Atomically consumes a phone/profile-bound signup proof while storing the profile, referral, credentials, and completed signup. Service role only.';
