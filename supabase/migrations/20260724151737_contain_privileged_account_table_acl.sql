-- Critical containment for authorization and credential state.
--
-- Trust boundary:
--   * anon/authenticated/PUBLIC have no direct credential-table access.
--   * authenticated may read only its own public.profiles row.
--   * trusted Edge Functions and server routes use service_role for all writes.
--   * the auth.users trigger continues to create the initial profile as its
--     SECURITY DEFINER owner, not as an untrusted Data API role.

alter table public.profiles enable row level security;
alter table public.fc_credentials enable row level security;
alter table public.admin_accounts enable row level security;
alter table public.manager_accounts enable row level security;

-- Remove every pre-existing policy instead of relying on a historical policy
-- name list. Credential tables intentionally have no client-facing policies.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (
        array[
          'profiles',
          'fc_credentials',
          'admin_accounts',
          'manager_accounts'
        ]::text[]
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

-- Revoke both table-level and any separately granted column-level access.
-- PUBLIC is included explicitly because all database roles inherit from it.
revoke all privileges on table public.profiles from public, anon, authenticated;
revoke all privileges on table public.fc_credentials from public, anon, authenticated;
revoke all privileges on table public.admin_accounts from public, anon, authenticated;
revoke all privileges on table public.manager_accounts from public, anon, authenticated;

do $$
declare
  target_table text;
  column_list text;
begin
  foreach target_table in array array[
    'profiles',
    'fc_credentials',
    'admin_accounts',
    'manager_accounts'
  ]
  loop
    select string_agg(format('%I', column_name), ', ' order by ordinal_position)
      into column_list
    from information_schema.columns
    where table_schema = 'public'
      and information_schema.columns.table_name = target_table;

    if column_list is not null then
      execute format(
        'revoke all privileges (%s) on table public.%I from public, anon, authenticated',
        column_list,
        target_table
      );
    end if;
  end loop;
end;
$$;

grant select on table public.profiles to authenticated;

grant select, insert, update, delete
  on table public.profiles
  to service_role;
grant select, insert, update, delete
  on table public.fc_credentials
  to service_role;
grant select, insert, update, delete
  on table public.admin_accounts
  to service_role;
grant select, insert, update, delete
  on table public.manager_accounts
  to service_role;

create policy "profiles own row select"
  on public.profiles
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and id = (select auth.uid())
  );

-- This trigger is defense in depth against a future accidental client DML
-- grant. PostgreSQL owners and trusted service_role calls remain permitted.
create or replace function public.enforce_profiles_trusted_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise insufficient_privilege
      using message = 'profiles authorization state is server-managed';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profiles_trusted_write()
  from public, anon, authenticated;
grant execute on function public.enforce_profiles_trusted_write()
  to service_role;

drop trigger if exists trg_profiles_trusted_write on public.profiles;
create trigger trg_profiles_trusted_write
before insert or update or delete on public.profiles
for each row execute function public.enforce_profiles_trusted_write();

comment on function public.enforce_profiles_trusted_write() is
  'Defense in depth: profile id, role, and fc_id writes are trusted-server state; Data API client roles are rejected.';
