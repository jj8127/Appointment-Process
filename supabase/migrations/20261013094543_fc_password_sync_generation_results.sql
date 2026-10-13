-- Return the credential generation from the same database transaction that
-- changes the password. A follow-up SELECT in an Edge function can race with a
-- second password change and pair the wrong generation with plaintext.

create or replace function public.complete_admin_assisted_password_change_v2(
  p_fc_id uuid,
  p_phone text,
  p_nonce_hash text,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  credential_session_version bigint;
begin
  result := public.complete_admin_assisted_password_change_v1(
    p_fc_id,
    p_phone,
    p_nonce_hash,
    p_password_hash,
    p_password_salt
  );

  if result is null or result ->> 'ok' is distinct from 'true' then
    raise exception 'assisted_password_change_generation_unavailable';
  end if;

  select credential.session_version
    into credential_session_version
  from public.fc_credentials credential
  where credential.fc_id = p_fc_id;

  if not found or credential_session_version is null then
    raise exception 'assisted_password_change_generation_unavailable';
  end if;

  return result || jsonb_build_object(
    'sessionVersion', credential_session_version
  );
end;
$$;

revoke all on function public.complete_admin_assisted_password_change_v2(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_admin_assisted_password_change_v2(
  uuid, text, text, text, text
) to service_role;

comment on function public.complete_admin_assisted_password_change_v2(
  uuid, text, text, text, text
) is
  'Completes an assisted FC password change and returns the resulting credential sessionVersion from the same transaction.';

create or replace function public.process_password_reset_challenge_v2(
  p_action text,
  p_account_kind text,
  p_account_id uuid,
  p_phone text,
  p_token_hash text,
  p_password_hash text default null,
  p_password_salt text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  credential_session_version bigint;
begin
  result := public.process_password_reset_challenge(
    p_action,
    p_account_kind,
    p_account_id,
    p_phone,
    p_token_hash,
    p_password_hash,
    p_password_salt
  );

  if p_action = 'consume'
    and p_account_kind = 'fc'
    and result ->> 'ok' = 'true' then
    select credential.session_version
      into credential_session_version
    from public.fc_credentials credential
    where credential.fc_id = p_account_id;

    if not found or credential_session_version is null then
      raise exception 'password_reset_generation_unavailable';
    end if;

    result := result || jsonb_build_object(
      'sessionVersion', credential_session_version
    );
  end if;

  return result;
end;
$$;

revoke all on function public.process_password_reset_challenge_v2(
  text, text, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.process_password_reset_challenge_v2(
  text, text, uuid, text, text, text, text
) to service_role;

comment on function public.process_password_reset_challenge_v2(
  text, text, uuid, text, text, text, text
) is
  'Processes a password-reset challenge and, for successful FC consumption, returns the resulting credential sessionVersion from the same transaction.';
