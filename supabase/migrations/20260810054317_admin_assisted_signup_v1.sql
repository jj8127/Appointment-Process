-- Administrator-assisted FC signup based on a documented written-consent check.
-- This is an alternate verification basis. It must never mark phone OTP as verified.

alter table public.fc_profiles
  add column if not exists signup_verification_method text;
alter table public.fc_profiles
  add column if not exists signup_verified_at timestamptz;
alter table public.fc_profiles
  add column if not exists signup_verified_by_admin_id uuid references public.admin_accounts (id) on delete set null;

alter table public.fc_profiles
  drop constraint if exists fc_profiles_signup_verification_method_check;
alter table public.fc_profiles
  add constraint fc_profiles_signup_verification_method_check
  check (
    signup_verification_method is null
    or signup_verification_method in ('phone_otp', 'admin_written_consent')
  );

update public.fc_profiles
set signup_verification_method = 'phone_otp',
    signup_verified_at = coalesce(phone_verified_at, updated_at, created_at)
where signup_completed = true
  and phone_verified = true
  and signup_verification_method is null;

alter table public.fc_credentials
  add column if not exists must_change_password boolean not null default false;
alter table public.fc_credentials
  add column if not exists temporary_password_issued_at timestamptz;

create table if not exists public.admin_assisted_signup_consents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  fc_id uuid not null unique references public.fc_profiles (id) on delete cascade,
  actor_admin_id uuid not null references public.admin_accounts (id) on delete restrict,
  actor_staff_type text not null check (actor_staff_type in ('admin', 'developer')),
  consent_obtained_on date not null,
  evidence_reference text not null check (
    char_length(evidence_reference) between 4 and 64
    and evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{3,63}$'
  ),
  attestation_version text not null default 'admin-written-consent-v1'
    check (attestation_version = 'admin-written-consent-v1'),
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_assisted_signup_consents_actor_created
  on public.admin_assisted_signup_consents (actor_admin_id, created_at desc);

create table if not exists public.fc_password_change_challenges (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null references public.fc_profiles (id) on delete cascade,
  nonce_hash text not null unique check (nonce_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists idx_fc_password_change_challenges_active
  on public.fc_password_change_challenges (fc_id, expires_at desc)
  where used_at is null;

alter table public.admin_assisted_signup_consents enable row level security;
alter table public.fc_password_change_challenges enable row level security;

revoke all privileges on table public.admin_assisted_signup_consents from public, anon, authenticated;
revoke all privileges on table public.fc_password_change_challenges from public, anon, authenticated;
grant select, insert on table public.admin_assisted_signup_consents to service_role;
grant select, insert, update, delete on table public.fc_password_change_challenges to service_role;

create or replace function public.admin_create_assisted_signup_v1(
  p_request_id uuid,
  p_actor_phone text,
  p_actor_staff_type text,
  p_name text,
  p_phone text,
  p_affiliation text,
  p_email text,
  p_carrier text,
  p_license_statuses text[],
  p_inviter_fc_id uuid,
  p_consent_obtained_on date,
  p_evidence_reference text,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_row public.admin_accounts%rowtype;
  target_profile public.fc_profiles%rowtype;
  existing_consent public.admin_assisted_signup_consents%rowtype;
  referral_result jsonb;
  normalized_actor_phone text := regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g');
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_affiliation text := trim(coalesce(p_affiliation, ''));
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_carrier text := trim(coalesce(p_carrier, ''));
  normalized_evidence_reference text := trim(coalesce(p_evidence_reference, ''));
  target_fc_id uuid;
  now_ts timestamptz := now();
begin
  if p_request_id is null then
    raise exception 'assisted_signup_invalid_request_id';
  end if;

  -- Serialize retries and concurrent attempts for the same target identity.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 1));

  if normalized_actor_phone !~ '^01[0-9]{9}$'
    or p_actor_staff_type not in ('admin', 'developer') then
    raise exception 'assisted_signup_forbidden';
  end if;

  select account.*
    into actor_row
  from public.admin_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_actor_phone
    and account.active = true
    and account.staff_type = p_actor_staff_type
  for update;

  if not found then
    raise exception 'assisted_signup_forbidden';
  end if;

  select consent.*
    into existing_consent
  from public.admin_assisted_signup_consents consent
  where consent.request_id = p_request_id
  for update;

  if found then
    if existing_consent.actor_admin_id <> actor_row.id then
      raise exception 'assisted_signup_request_conflict';
    end if;

    return jsonb_build_object(
      'ok', true,
      'fcId', existing_consent.fc_id,
      'verificationMethod', 'admin_written_consent',
      'requiresPasswordChange', true,
      'alreadyApplied', true
    );
  end if;

  if normalized_phone !~ '^01[0-9]{9}$'
    or char_length(normalized_name) not between 2 and 40
    or char_length(normalized_affiliation) not between 2 and 80
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or normalized_carrier not in ('SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰') then
    raise exception 'assisted_signup_invalid_profile';
  end if;

  if p_license_statuses is null
    or cardinality(p_license_statuses) = 0
    or exists (
      select 1
      from unnest(p_license_statuses) status_value
      where status_value not in ('third', 'life', 'nonlife', 'none')
    )
    or (
      'none' = any(p_license_statuses)
      and cardinality(p_license_statuses) > 1
    ) then
    raise exception 'assisted_signup_invalid_license_statuses';
  end if;

  if p_inviter_fc_id is null then
    raise exception 'assisted_signup_referral_required';
  end if;

  if p_consent_obtained_on is null
    or p_consent_obtained_on > current_date
    or p_consent_obtained_on < current_date - 90 then
    raise exception 'assisted_signup_invalid_consent_date';
  end if;

  if char_length(normalized_evidence_reference) not between 4 and 64
    or normalized_evidence_reference !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{3,63}$' then
    raise exception 'assisted_signup_invalid_evidence_reference';
  end if;

  if char_length(coalesce(p_password_hash, '')) <> 44
    or p_password_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_password_salt, '')) <> 24
    or p_password_salt !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'assisted_signup_invalid_credential';
  end if;

  if exists (
    select 1 from public.admin_accounts account
    where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  ) or exists (
    select 1 from public.manager_accounts account
    where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  ) then
    raise exception 'assisted_signup_already_exists';
  end if;

  select profile.*
    into target_profile
  from public.fc_profiles profile
  where regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for update;

  if found then
    if target_profile.signup_completed is true
      or target_profile.is_manager_referral_shadow is true
      or target_profile.phone_verified is true
      or exists (
        select 1
        from public.fc_credentials credential
        where credential.fc_id = target_profile.id
          and credential.password_set_at is not null
      ) then
      raise exception 'assisted_signup_already_exists';
    end if;

    update public.fc_profiles
    set name = normalized_name,
        phone = normalized_phone,
        affiliation = normalized_affiliation,
        email = normalized_email,
        carrier = normalized_carrier,
        license_statuses = p_license_statuses,
        status = 'draft',
        life_commission_completed = false,
        nonlife_commission_completed = false,
        signup_completed = true,
        phone_verified = false,
        phone_verified_at = null,
        phone_verification_hash = null,
        phone_verification_expires_at = null,
        phone_verification_sent_at = null,
        phone_verification_attempts = 0,
        phone_verification_locked_until = null,
        signup_verification_method = 'admin_written_consent',
        signup_verified_at = now_ts,
        signup_verified_by_admin_id = actor_row.id,
        identity_completed = false,
        resident_id_masked = null,
        resident_id_hash = null,
        address = '',
        address_detail = null,
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
        recommender = null,
        recommender_fc_id = null,
        recommender_code_id = null,
        recommender_code = null,
        recommender_linked_at = null,
        recommender_link_source = null,
        updated_at = now_ts
    where id = target_profile.id
    returning id into target_fc_id;
  else
    insert into public.fc_profiles (
      name,
      phone,
      affiliation,
      email,
      carrier,
      license_statuses,
      status,
      signup_completed,
      phone_verified,
      signup_verification_method,
      signup_verified_at,
      signup_verified_by_admin_id,
      identity_completed,
      address,
      life_commission_completed,
      nonlife_commission_completed,
      created_at,
      updated_at
    ) values (
      normalized_name,
      normalized_phone,
      normalized_affiliation,
      normalized_email,
      normalized_carrier,
      p_license_statuses,
      'draft',
      true,
      false,
      'admin_written_consent',
      now_ts,
      actor_row.id,
      false,
      '',
      false,
      false,
      now_ts,
      now_ts
    ) returning id into target_fc_id;
  end if;

  referral_result := public.apply_referral_link_state(
    p_invitee_fc_id => target_fc_id,
    p_inviter_fc_id => p_inviter_fc_id,
    p_referral_code_id => null,
    p_referral_code => null,
    p_source => 'admin_override',
    p_actor_phone => normalized_actor_phone,
    p_actor_role => 'admin',
    p_actor_staff_type => p_actor_staff_type,
    p_reason => 'admin_assisted_signup'
  );

  if coalesce((referral_result ->> 'ok')::boolean, false) is not true then
    raise exception 'assisted_signup_referral_failed';
  end if;

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
    must_change_password,
    temporary_password_issued_at,
    created_at,
    updated_at
  ) values (
    target_fc_id,
    p_password_hash,
    p_password_salt,
    now_ts,
    0,
    null,
    null,
    null,
    null,
    true,
    now_ts,
    now_ts,
    now_ts
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
      must_change_password = true,
      temporary_password_issued_at = now_ts,
      updated_at = now_ts;

  insert into public.admin_assisted_signup_consents (
    request_id,
    fc_id,
    actor_admin_id,
    actor_staff_type,
    consent_obtained_on,
    evidence_reference,
    attestation_version,
    created_at
  ) values (
    p_request_id,
    target_fc_id,
    actor_row.id,
    p_actor_staff_type,
    p_consent_obtained_on,
    normalized_evidence_reference,
    'admin-written-consent-v1',
    now_ts
  );

  return jsonb_build_object(
    'ok', true,
    'fcId', target_fc_id,
    'verificationMethod', 'admin_written_consent',
    'requiresPasswordChange', true,
    'alreadyApplied', false
  );
end;
$$;

create or replace function public.issue_admin_assisted_password_change_v1(
  p_fc_id uuid,
  p_nonce_hash text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  now_ts timestamptz := now();
begin
  if p_fc_id is null
    or coalesce(p_nonce_hash, '') !~ '^[a-f0-9]{64}$'
    or p_expires_at <= now_ts
    or p_expires_at > now_ts + interval '30 minutes' then
    raise exception 'assisted_password_change_invalid_challenge';
  end if;

  perform 1
  from public.fc_credentials credential
  join public.fc_profiles profile on profile.id = credential.fc_id
  where credential.fc_id = p_fc_id
    and credential.must_change_password = true
    and profile.signup_completed = true
    and profile.signup_verification_method = 'admin_written_consent'
  for update of credential;

  if not found then
    raise exception 'assisted_password_change_not_required';
  end if;

  update public.fc_password_change_challenges
  set used_at = now_ts
  where fc_id = p_fc_id
    and used_at is null;

  insert into public.fc_password_change_challenges (
    fc_id,
    nonce_hash,
    expires_at,
    created_at
  ) values (
    p_fc_id,
    p_nonce_hash,
    p_expires_at,
    now_ts
  );

  return jsonb_build_object('ok', true, 'expiresAt', p_expires_at);
end;
$$;

create or replace function public.complete_admin_assisted_password_change_v1(
  p_fc_id uuid,
  p_phone text,
  p_nonce_hash text,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  now_ts timestamptz := now();
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  challenge_row public.fc_password_change_challenges%rowtype;
  profile_row public.fc_profiles%rowtype;
begin
  if p_fc_id is null
    or normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_nonce_hash, '') !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_password_hash, '')) <> 44
    or p_password_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_password_salt, '')) <> 24
    or p_password_salt !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'assisted_password_change_invalid_request';
  end if;

  select challenge.*
    into challenge_row
  from public.fc_password_change_challenges challenge
  where challenge.fc_id = p_fc_id
    and challenge.nonce_hash = p_nonce_hash
    and challenge.used_at is null
    and challenge.expires_at > now_ts
  for update;

  if not found then
    raise exception 'assisted_password_change_invalid_challenge';
  end if;

  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.id = p_fc_id
    and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = normalized_phone
    and profile.signup_completed = true
    and profile.signup_verification_method = 'admin_written_consent'
  for update;

  if not found then
    raise exception 'assisted_password_change_invalid_challenge';
  end if;

  update public.fc_credentials
  set password_hash = p_password_hash,
      password_salt = p_password_salt,
      password_set_at = now_ts,
      failed_count = 0,
      locked_until = null,
      reset_token_hash = null,
      reset_token_expires_at = null,
      reset_sent_at = null,
      must_change_password = false,
      temporary_password_issued_at = null,
      updated_at = now_ts
  where fc_id = p_fc_id
    and must_change_password = true;

  if not found then
    raise exception 'assisted_password_change_not_required';
  end if;

  update public.fc_password_change_challenges
  set used_at = now_ts
  where fc_id = p_fc_id
    and used_at is null;

  return jsonb_build_object(
    'ok', true,
    'fcId', profile_row.id,
    'phone', normalized_phone,
    'name', profile_row.name,
    'affiliation', profile_row.affiliation
  );
end;
$$;

revoke all on function public.admin_create_assisted_signup_v1(
  uuid, text, text, text, text, text, text, text, text[], uuid, date, text, text, text
) from public, anon, authenticated;
revoke all on function public.issue_admin_assisted_password_change_v1(
  uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_admin_assisted_password_change_v1(
  uuid, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.admin_create_assisted_signup_v1(
  uuid, text, text, text, text, text, text, text, text[], uuid, date, text, text, text
) to service_role;
grant execute on function public.issue_admin_assisted_password_change_v1(
  uuid, text, timestamptz
) to service_role;
grant execute on function public.complete_admin_assisted_password_change_v1(
  uuid, text, text, text, text
) to service_role;

comment on column public.fc_profiles.signup_verification_method is
  'Signup verification basis. admin_written_consent is distinct from phone OTP and does not imply phone_verified.';
comment on table public.admin_assisted_signup_consents is
  'Append-only metadata for administrator-confirmed written consent; document contents are deliberately not stored.';
