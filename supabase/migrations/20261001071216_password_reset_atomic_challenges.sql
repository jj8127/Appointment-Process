-- Issue, count guesses, consume the challenge and update the password under
-- the same credential-row lock. No caller may read/check/write this state.
-- Run in a migration transaction. Abort instead of queuing behind a long
-- credential transaction; these settings expire at commit/rollback.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.admin_accounts
  add column if not exists reset_failed_count integer not null default 0;
alter table public.manager_accounts
  add column if not exists reset_failed_count integer not null default 0;
alter table public.fc_credentials
  add column if not exists reset_failed_count integer not null default 0;

-- Enforce every new write immediately, without scanning existing rows while
-- ACCESS EXCLUSIVE is held. Existing rows receive the constant default 0.
-- Validation runs in the following, separately committed migration so its
-- scan holds only SHARE UPDATE EXCLUSIVE and permits ordinary reads/writes.
do $$
declare
  target_table text;
  constraint_name text;
begin
  foreach target_table in array array['admin_accounts', 'manager_accounts', 'fc_credentials'] loop
    constraint_name := target_table || '_reset_failed_count_check';
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = format('public.%I', target_table)::regclass
        and conname = constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I check (reset_failed_count between 0 and 5) not valid',
        target_table, constraint_name
      );
    end if;
  end loop;
end;
$$;

create or replace function public.process_password_reset_challenge(
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
  account_table text;
  account_key text;
  account_row jsonb;
  profile_row public.fc_profiles%rowtype;
  checked_at timestamptz;
  failed_attempts integer;
begin
  if coalesce(p_action, '') not in ('issue', 'consume')
    or p_account_id is null
    or coalesce(p_phone, '') !~ '^[0-9]{11}$'
    or coalesce(p_token_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
    or (p_action = 'consume' and (
      coalesce(p_password_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
      or coalesce(p_password_salt, '') !~ '^[A-Za-z0-9+/]{22}==$'
    )) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  case p_account_kind
    when 'admin' then account_table := 'admin_accounts'; account_key := 'id';
    when 'manager' then account_table := 'manager_accounts'; account_key := 'id';
    when 'fc' then account_table := 'fc_credentials'; account_key := 'fc_id';
    else return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end case;

  -- Match existing FC lifecycle lock order: profile, then credentials. This
  -- also prevents completion/phone changes while a challenge is processed.
  if p_account_kind = 'fc' then
    select * into profile_row from public.fc_profiles
    where id = p_account_id for update;
    if not found or profile_row.phone is distinct from p_phone
      or profile_row.signup_completed is distinct from true then
      return jsonb_build_object('ok', false, 'code', 'account_unavailable');
    end if;
  end if;

  execute format(
    'select to_jsonb(a) from public.%I a where %I = $1 for update',
    account_table, account_key
  ) into account_row using p_account_id;
  if account_row is null
    or account_row->>'password_set_at' is null
    or (p_account_kind <> 'fc' and (
      account_row->>'phone' is distinct from p_phone
      or account_row->>'active' = 'false'
    )) then
    return jsonb_build_object('ok', false, 'code', 'account_unavailable');
  end if;

  -- Evaluate expiry/cooldown after any lock wait, not at transaction start.
  checked_at := clock_timestamp();
  if p_action = 'issue' then
    if (account_row->>'reset_sent_at')::timestamptz > checked_at - interval '60 seconds' then
      return jsonb_build_object('ok', false, 'code', 'cooldown');
    end if;
    execute format(
      'update public.%I set reset_token_hash = $2,
       reset_token_expires_at = $3::timestamptz + interval ''15 minutes'',
       reset_sent_at = $3, reset_failed_count = 0, updated_at = $3
       where %I = $1', account_table, account_key
    ) using p_account_id, p_token_hash, checked_at;
    return jsonb_build_object('ok', true);
  end if;

  failed_attempts := (account_row->>'reset_failed_count')::integer;
  if failed_attempts >= 5 then
    return jsonb_build_object('ok', false, 'code', 'attempts_exhausted');
  end if;
  if account_row->>'reset_token_hash' is null
    or account_row->>'reset_token_expires_at' is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if (account_row->>'reset_token_expires_at')::timestamptz <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'expired_token');
  end if;
  if account_row->>'reset_token_hash' is distinct from p_token_hash then
    failed_attempts := failed_attempts + 1;
    execute format(
      'update public.%I set reset_failed_count = $2, updated_at = $3 where %I = $1',
      account_table, account_key
    ) using p_account_id, failed_attempts, checked_at;
    -- Return, do not raise: a raised exception would roll back the counter.
    return jsonb_build_object('ok', false, 'code',
      case when failed_attempts >= 5 then 'attempts_exhausted' else 'invalid_token' end);
  end if;

  execute format(
    'update public.%I set password_hash = $2, password_salt = $3,
     password_set_at = $4, failed_count = 0, locked_until = null,
     reset_token_hash = null, reset_token_expires_at = null,
     reset_failed_count = 0, updated_at = $4%s where %I = $1',
    account_table,
    case when p_account_kind = 'fc' then
      ', must_change_password = false, temporary_password_issued_at = null'
      else '' end,
    account_key
  ) using p_account_id, p_password_hash, p_password_salt, checked_at;
  -- Preserve reset_sent_at so success cannot bypass the issuance cooldown.
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.process_password_reset_challenge(text, text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.process_password_reset_challenge(text, text, uuid, text, text, text, text)
  to service_role;
