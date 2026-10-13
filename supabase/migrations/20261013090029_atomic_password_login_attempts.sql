-- Serialize password comparison and failure counters on the credential row.
-- The Edge function derives the candidate PBKDF2 hash; this function compares
-- it with the current hash after locking, then records the outcome atomically.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.process_password_login_attempt_v1(
  p_account_kind text,
  p_account_id uuid,
  p_expected_phone text,
  p_candidate_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_table text;
  v_key text;
  v_account jsonb;
  v_profile public.fc_profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_now timestamptz;
  v_failed_count integer;
  v_locked_until timestamptz;
begin
  if p_account_id is null or v_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_candidate_hash, '')) <> 44
    or p_candidate_hash !~ '^[A-Za-z0-9+/]+={0,2}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  case p_account_kind
    when 'admin' then v_table := 'admin_accounts'; v_key := 'id';
    when 'manager' then v_table := 'manager_accounts'; v_key := 'id';
    when 'fc' then
      v_table := 'fc_credentials'; v_key := 'fc_id';
      select profile.* into v_profile
      from public.fc_profiles profile
      where profile.id = p_account_id
        and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_phone
        and coalesce(profile.is_manager_referral_shadow, false) = false
      for update;
      if not found or v_profile.signup_completed is distinct from true then
        return jsonb_build_object('ok', false, 'code', 'account_unavailable');
      end if;
    else
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end case;

  execute format(
    'select to_jsonb(account) from public.%I account where %I = $1 for update',
    v_table,
    v_key
  ) into v_account using p_account_id;

  if v_account is null
    or v_account->>'password_set_at' is null
    or (p_account_kind <> 'fc' and (
      regexp_replace(coalesce(v_account->>'phone', ''), '[^0-9]', '', 'g') is distinct from v_phone
      or (v_account->>'active')::boolean is distinct from true
    )) then
    return jsonb_build_object('ok', false, 'code', 'account_unavailable');
  end if;

  v_now := clock_timestamp();
  if (v_account->>'locked_until')::timestamptz > v_now then
    return jsonb_build_object(
      'ok', false,
      'code', 'locked',
      'lockedUntil', (v_account->>'locked_until')::timestamptz,
      'remaining', 0
    );
  end if;

  if v_account->>'password_hash' is distinct from p_candidate_hash then
    v_failed_count := coalesce((v_account->>'failed_count')::integer, 0) + 1;
    if v_failed_count >= 5 then
      v_locked_until := v_now + interval '10 minutes';
      execute format(
        'update public.%I set failed_count = 0, locked_until = $2 where %I = $1',
        v_table,
        v_key
      ) using p_account_id, v_locked_until;
      return jsonb_build_object(
        'ok', false,
        'code', 'locked',
        'lockedUntil', v_locked_until,
        'remaining', 0
      );
    end if;

    execute format(
      'update public.%I set failed_count = $2, locked_until = null where %I = $1',
      v_table,
      v_key
    ) using p_account_id, v_failed_count;
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_password',
      'remaining', 5 - v_failed_count
    );
  end if;

  execute format(
    'update public.%I set failed_count = 0, locked_until = null where %I = $1',
    v_table,
    v_key
  ) using p_account_id;
  return jsonb_build_object(
    'ok', true,
    'code', 'authenticated',
    'accountKind', p_account_kind,
    'accountId', p_account_id,
    'residentId', v_phone
  );
end;
$$;

revoke all on function public.process_password_login_attempt_v1(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.process_password_login_attempt_v1(text, uuid, text, text)
  to service_role;

comment on function public.process_password_login_attempt_v1(text, uuid, text, text)
  is 'Atomically compares a derived password hash and records login failure/lock state. Execute is service_role only.';
