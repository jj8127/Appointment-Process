-- Keep the final multi-table onboarding writes inside one PostgreSQL transaction.
-- Edge Functions encrypt/hash identity material before calling these RPCs; neither
-- function accepts or returns a raw resident registration number or password.

create or replace function public.store_fc_identity_atomic_v1(
  p_fc_id uuid,
  p_expected_phone text,
  p_resident_number_encrypted text,
  p_resident_id_masked text,
  p_resident_id_hash text,
  p_address text,
  p_address_detail text,
  p_address_encrypted text,
  p_address_detail_encrypted text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_normalized_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_address text := btrim(coalesce(p_address, ''));
  v_address_detail text := nullif(btrim(coalesce(p_address_detail, '')), '');
  v_has_resident_input boolean := p_resident_number_encrypted is not null
    or p_resident_id_masked is not null
    or p_resident_id_hash is not null;
  v_secure_fc_id uuid;
begin
  if p_fc_id is null
    or v_normalized_phone !~ '^01[0-9]{9}$'
    or char_length(v_address) not between 1 and 500
    or char_length(coalesce(v_address_detail, '')) > 500
    or char_length(coalesce(p_address_encrypted, '')) not between 20 and 8192
    or (v_address_detail is null) <> (p_address_detail_encrypted is null)
    or (p_address_detail_encrypted is not null
      and char_length(p_address_detail_encrypted) not between 20 and 8192) then
    raise exception using errcode = '22023', message = 'identity_payload_invalid';
  end if;

  if v_has_resident_input and (
    p_resident_number_encrypted is null
    or p_resident_id_masked is null
    or p_resident_id_hash is null
    or char_length(p_resident_number_encrypted) not between 20 and 4096
    or p_resident_id_masked !~ '^[0-9]{6}-[*]{7}$'
    or char_length(p_resident_id_hash) <> 44
    or p_resident_id_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
  ) then
    raise exception using errcode = '22023', message = 'identity_payload_invalid';
  end if;

  select profile.*
    into v_profile
  from public.fc_profiles profile
  where profile.id = p_fc_id
    and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_normalized_phone
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'identity_profile_not_found';
  end if;

  if v_has_resident_input then
    insert into public.fc_identity_secure as secure (
      fc_id,
      resident_number_encrypted,
      address_encrypted,
      address_detail_encrypted
    ) values (
      p_fc_id,
      p_resident_number_encrypted,
      p_address_encrypted,
      p_address_detail_encrypted
    )
    on conflict (fc_id) do update
    set resident_number_encrypted = excluded.resident_number_encrypted,
        address_encrypted = excluded.address_encrypted,
        address_detail_encrypted = excluded.address_detail_encrypted
    returning secure.fc_id into v_secure_fc_id;

    update public.fc_profiles
    set resident_id_masked = p_resident_id_masked,
        resident_id_hash = p_resident_id_hash,
        address = v_address,
        address_detail = v_address_detail,
        identity_completed = true
    where id = p_fc_id;
  else
    if v_profile.resident_id_masked is null or v_profile.resident_id_hash is null then
      raise exception using errcode = '22023', message = 'resident_identity_required';
    end if;

    update public.fc_identity_secure
    set address_encrypted = p_address_encrypted,
        address_detail_encrypted = p_address_detail_encrypted
    where fc_id = p_fc_id
    returning fc_id into v_secure_fc_id;

    if v_secure_fc_id is null then
      raise exception using errcode = '22023', message = 'resident_identity_required';
    end if;

    update public.fc_profiles
    set address = v_address,
        address_detail = v_address_detail,
        identity_completed = true
    where id = p_fc_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'fcId', p_fc_id,
    'residentId', v_normalized_phone,
    'identityCompleted', true
  );
end;
$$;

revoke all on function public.store_fc_identity_atomic_v1(
  uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.store_fc_identity_atomic_v1(
  uuid, text, text, text, text, text, text, text, text
) to service_role;

comment on function public.store_fc_identity_atomic_v1(
  uuid, text, text, text, text, text, text, text, text
) is 'Atomically stores pre-encrypted FC identity material and its profile completion receipt. Execute is service_role only.';

create or replace function public.complete_fc_signup_atomic_v1(
  p_fc_id uuid,
  p_expected_phone text,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_normalized_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_existing_password_set_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_fc_id is null
    or v_normalized_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_password_hash, '')) <> 44
    or p_password_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_password_salt, '')) <> 24
    or p_password_salt !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception using errcode = '22023', message = 'signup_completion_payload_invalid';
  end if;

  select profile.*
    into v_profile
  from public.fc_profiles profile
  where profile.id = p_fc_id
    and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_normalized_phone
  for update;

  if not found
    or v_profile.phone_verified is distinct from true
    or coalesce(v_profile.is_manager_referral_shadow, false) then
    raise exception using errcode = '42501', message = 'signup_completion_forbidden';
  end if;

  select credential.password_set_at
    into v_existing_password_set_at
  from public.fc_credentials credential
  where credential.fc_id = p_fc_id
  for update;

  if found and v_existing_password_set_at is not null then
    raise exception using errcode = '55000', message = 'signup_password_already_set';
  end if;

  update public.fc_profiles
  set signup_completed = true,
      signup_verification_method = 'phone_otp',
      signup_verified_at = v_now,
      signup_verified_by_admin_id = null
  where id = p_fc_id;

  insert into public.fc_credentials as credential (
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
    updated_at
  ) values (
    p_fc_id,
    p_password_hash,
    p_password_salt,
    v_now,
    0,
    null,
    null,
    null,
    null,
    0,
    false,
    null,
    v_now
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
    'residentId', v_normalized_phone,
    'displayName', coalesce(v_profile.name, ''),
    'signupCompleted', true,
    'passwordSetAt', v_now
  );
end;
$$;

revoke all on function public.complete_fc_signup_atomic_v1(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_fc_signup_atomic_v1(uuid, text, text, text)
  to service_role;

comment on function public.complete_fc_signup_atomic_v1(uuid, text, text, text)
  is 'Atomically completes a phone-verified FC profile and stores its derived password credential. Execute is service_role only.';
