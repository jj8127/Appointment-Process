-- Serialize FC signup OTP issuance with verification and completion. The
-- challenge, its privacy-safe delivery attempt, and partial-signup cleanup
-- are committed together before an SMS can be sent.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.fc_profiles
  add column if not exists phone_verification_delivery_id uuid
    references public.platform_sms_delivery_attempts(id) on delete set null;

create index if not exists fc_profiles_phone_verification_delivery_idx
  on public.fc_profiles(phone_verification_delivery_id)
  where phone_verification_delivery_id is not null;

create or replace function public.issue_fc_signup_otp_v1(
  p_phone text,
  p_code_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  profile_row public.fc_profiles%rowtype;
  credential_row public.fc_credentials%rowtype;
  profile_exists boolean := false;
  credential_exists boolean := false;
  should_reset boolean := false;
  checked_at timestamptz;
  delivery_id uuid;
  auth_profile_ids jsonb := '[]'::jsonb;
begin
  if normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_code_hash, '') !~ '^[A-Za-z0-9+/]{43}=$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- verify_fc_signup_otp_v1 and complete_fc_otp_signup_v1 use this exact
  -- namespace. Issuance must participate in the same per-phone lifecycle.
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));

  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;
  profile_exists := found;

  if profile_exists then
    select credential.*
      into credential_row
    from public.fc_credentials credential
    where credential.fc_id = profile_row.id
    for update;
    credential_exists := found;

    if profile_row.is_manager_referral_shadow is true
      or (
        profile_row.signup_completed is true
        and credential_exists
        and credential_row.password_set_at is not null
      ) then
      return jsonb_build_object('ok', false, 'code', 'already_exists');
    end if;
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

  -- Evaluate lock and cooldown after every lock wait, never from an Edge
  -- timestamp captured before the critical section.
  checked_at := clock_timestamp();

  if profile_exists
    and profile_row.phone_verification_locked_until is not null
    and profile_row.phone_verification_locked_until > checked_at then
    return jsonb_build_object('ok', false, 'code', 'locked');
  end if;

  if profile_exists
    and profile_row.phone_verification_sent_at is not null
    and profile_row.phone_verification_sent_at > checked_at - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'code', 'cooldown');
  end if;

  insert into public.platform_sms_delivery_attempts(purpose)
    values('fc_signup')
    returning id into delivery_id;

  if not profile_exists then
    insert into public.fc_profiles (
      phone,
      name,
      affiliation,
      recommender,
      recommender_fc_id,
      recommender_code_id,
      recommender_code,
      recommender_linked_at,
      recommender_link_source,
      email,
      address,
      status,
      identity_completed,
      signup_completed,
      phone_verified,
      phone_verified_at,
      phone_verification_hash,
      phone_verification_expires_at,
      phone_verification_sent_at,
      phone_verification_attempts,
      phone_verification_locked_until,
      phone_verification_delivery_id,
      signup_verification_method,
      signup_verified_at,
      signup_verified_by_admin_id,
      updated_at
    ) values (
      normalized_phone,
      '',
      '',
      '',
      null,
      null,
      null,
      null,
      null,
      '',
      '',
      'draft',
      false,
      false,
      false,
      null,
      p_code_hash,
      checked_at + interval '5 minutes',
      checked_at,
      0,
      null,
      delivery_id,
      null,
      null,
      null,
      checked_at
    )
    returning * into profile_row;
  else
    should_reset := profile_row.phone_verified is true
      or profile_row.signup_completed is true
      or profile_row.status is distinct from 'draft'
      or profile_row.identity_completed is true
      or credential_exists
      or exists (
        select 1 from public.profiles auth_profile
        where auth_profile.fc_id = profile_row.id
      );

    if should_reset then
      delete from public.fc_identity_secure secure
      where secure.fc_id = profile_row.id;

      delete from public.fc_credentials credential
      where credential.fc_id = profile_row.id;

      with deleted_auth_profile as (
        delete from public.profiles auth_profile
        where auth_profile.fc_id = profile_row.id
        returning auth_profile.id
      )
      select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
        into auth_profile_ids
      from deleted_auth_profile;

      update public.fc_profiles
      set phone_verification_hash = p_code_hash,
          phone_verification_expires_at = checked_at + interval '5 minutes',
          phone_verification_sent_at = checked_at,
          phone_verification_attempts = 0,
          phone_verification_locked_until = null,
          phone_verification_delivery_id = delivery_id,
          name = '',
          affiliation = '',
          recommender = '',
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
          phone_verified = false,
          phone_verified_at = null,
          signup_verification_method = null,
          signup_verified_at = null,
          signup_verified_by_admin_id = null,
          updated_at = checked_at
      where id = profile_row.id;
    else
      update public.fc_profiles
      set phone_verification_hash = p_code_hash,
          phone_verification_expires_at = checked_at + interval '5 minutes',
          phone_verification_sent_at = checked_at,
          phone_verification_attempts = 0,
          phone_verification_locked_until = null,
          phone_verification_delivery_id = delivery_id,
          updated_at = checked_at
      where id = profile_row.id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'deliveryId', delivery_id,
    'authProfileIds', auth_profile_ids,
    'resetApplied', should_reset
  );
end;
$$;

create or replace function public.finalize_fc_signup_otp_delivery_v1(
  p_phone text,
  p_delivery_id uuid,
  p_state text,
  p_provider_request_id text default null,
  p_provider_status_code text default null,
  p_failure_reason text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  profile_row public.fc_profiles%rowtype;
  profile_exists boolean := false;
  updated_attempt uuid;
  checked_at timestamptz;
begin
  if normalized_phone !~ '^01[0-9]{9}$'
    or p_delivery_id is null
    or p_state not in ('accepted','unknown','rejected')
    or (p_provider_request_id is not null and (
      length(p_provider_request_id) not between 1 and 200
      or p_provider_request_id !~ '^[A-Za-z0-9._:-]+$'
    ))
    or (p_provider_status_code is not null and (
      length(p_provider_status_code) not between 1 and 40
      or p_provider_status_code !~ '^[A-Za-z0-9._:-]+$'
    ))
    or (p_failure_reason is not null and p_failure_reason not in (
      'missing_configuration','request_build_failed','provider_rejected',
      'invalid_provider_response','network_error','timeout'
    ))
    or (p_state = 'accepted' and (
      p_failure_reason is not null or not (
        (p_provider_status_code = '202' and p_provider_request_id is not null)
        or (p_provider_status_code = 'simulated' and p_provider_request_id is null)
      )
    ))
    or (p_state = 'rejected' and (
      coalesce(p_failure_reason, '') not in (
        'missing_configuration','request_build_failed','provider_rejected'
      )
      or p_provider_request_id is not null
    ))
    or (p_state = 'unknown' and coalesce(p_failure_reason, '') not in (
      'invalid_provider_response','network_error','timeout'
    )) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));

  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;
  profile_exists := found;

  checked_at := clock_timestamp();
  update public.platform_sms_delivery_attempts
  set state = p_state,
      provider_request_id = p_provider_request_id,
      provider_status_code = p_provider_status_code,
      failure_reason = p_failure_reason,
      updated_at = checked_at,
      completed_at = case when p_state in ('accepted','rejected') then checked_at else null end
  where id = p_delivery_id
    and purpose = 'fc_signup'
    and state = 'pending'
  returning id into updated_attempt;

  if updated_attempt is null then
    return jsonb_build_object('ok', false, 'code', 'delivery_not_pending');
  end if;

  if not profile_exists
    or profile_row.phone_verification_delivery_id is distinct from p_delivery_id then
    return jsonb_build_object('ok', false, 'code', 'stale_delivery');
  end if;

  if p_state = 'rejected' then
    update public.fc_profiles
    set phone_verification_hash = null,
        phone_verification_expires_at = null,
        phone_verification_sent_at = null,
        phone_verification_attempts = 0,
        phone_verification_locked_until = null,
        phone_verification_delivery_id = null,
        updated_at = checked_at
    where id = profile_row.id
      and phone_verification_delivery_id = p_delivery_id;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'stale_delivery');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'current', true);
end;
$$;

revoke all on function public.issue_fc_signup_otp_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.issue_fc_signup_otp_v1(text, text)
  to service_role;

revoke all on function public.finalize_fc_signup_otp_delivery_v1(text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_fc_signup_otp_delivery_v1(text, uuid, text, text, text, text)
  to service_role;

comment on function public.issue_fc_signup_otp_v1(text, text) is
  'Atomically reserves one FC signup OTP and its privacy-safe SMS delivery attempt per phone cooldown.';
comment on function public.finalize_fc_signup_otp_delivery_v1(text, uuid, text, text, text, text) is
  'Finalizes one FC signup SMS attempt and compensates only the currently owned rejected challenge.';
