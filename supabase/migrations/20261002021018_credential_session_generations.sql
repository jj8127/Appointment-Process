set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Additive zero preserves every unchanged account's legacy signed sessions.
alter table public.fc_credentials
  add column if not exists session_version bigint not null default 0 check (session_version >= 0);
alter table public.admin_accounts
  add column if not exists session_version bigint not null default 0 check (session_version >= 0);
alter table public.manager_accounts
  add column if not exists session_version bigint not null default 0 check (session_version >= 0);

create or replace function public.advance_credential_session_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- All writers, including the existing reset/assisted/config paths, share
  -- this transaction boundary. Failed login counters do not revoke sessions.
  if old.password_hash is distinct from new.password_hash
    or old.password_salt is distinct from new.password_salt then
    new.session_version := old.session_version + 1;
  else
    new.session_version := old.session_version;
  end if;
  return new;
end;
$$;
revoke all on function public.advance_credential_session_version() from public, anon, authenticated;

-- The service verifies the token signature before this narrow identity lookup.
-- Null is an unavailable/inactive/mismatched account, never generation zero.
create or replace function public.get_auth_session_generation(
  p_phone text,
  p_role text,
  p_purpose text,
  p_account_kind text default null,
  p_account_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  phone_candidates text[];
  resolved_kind text;
  resolved_id uuid;
  resolved_version bigint;
  resolved_created_at timestamptz;
begin
  if length(normalized_phone) <> 11 or p_purpose is null or p_role is null
    or p_purpose not in ('app', 'bridge') then return null; end if;
  phone_candidates := array[normalized_phone, btrim(p_phone),
    substr(normalized_phone, 1, 3) || '-' || substr(normalized_phone, 4, 4) || '-' || substr(normalized_phone, 8, 4)];
  if p_purpose = 'app' and p_role not in ('fc', 'admin', 'manager') then return null; end if;
  if p_purpose = 'bridge' and p_role not in ('fc', 'designer', 'admin', 'manager') then return null; end if;
  if p_account_kind is not null and p_account_kind not in ('fc', 'admin', 'manager') then return null; end if;

  if p_role = 'admin' or (p_purpose = 'bridge' and p_role = 'fc') then
    select 'admin', account.id, account.session_version, account.created_at
      into resolved_kind, resolved_id, resolved_version, resolved_created_at
      from public.admin_accounts account
      where account.phone = any(phone_candidates)
        and account.active = true and account.password_set_at is not null
        and (p_role = 'admin' or account.staff_type = 'developer')
        and (p_account_kind is null or p_account_kind = 'admin')
        and (p_account_id is null or account.id = p_account_id);
  end if;
  if resolved_id is null and p_role = 'manager' then
    select 'manager', account.id, account.session_version, account.created_at
      into resolved_kind, resolved_id, resolved_version, resolved_created_at
      from public.manager_accounts account
      where account.phone = any(phone_candidates)
        and account.active = true and account.password_set_at is not null
        and (p_account_kind is null or p_account_kind = 'manager')
        and (p_account_id is null or account.id = p_account_id);
  end if;
  if resolved_id is null and (p_role = 'fc' or (p_purpose = 'bridge' and p_role = 'designer')) then
    select 'fc', profile.id, credential.session_version, profile.created_at
      into resolved_kind, resolved_id, resolved_version, resolved_created_at
      from public.fc_profiles profile
      join public.fc_credentials credential on credential.fc_id = profile.id
      where profile.phone = any(phone_candidates)
        and profile.signup_completed = true and credential.password_set_at is not null
        and coalesce(credential.must_change_password, false) = false
        and (p_account_kind is null or p_account_kind = 'fc')
        and (p_account_id is null or profile.id = p_account_id)
        and (p_purpose = 'app' or (
          (p_role = 'designer') = (position('설계매니저' in coalesce(profile.affiliation, '')) > 0)
        ));
  end if;
  if resolved_id is null then return null; end if;
  return jsonb_build_object('accountKind', resolved_kind, 'accountId', resolved_id,
    'sessionVersion', resolved_version, 'createdAt', resolved_created_at);
end;
$$;
revoke all on function public.get_auth_session_generation(text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_auth_session_generation(text, text, text, text, uuid) to service_role;
