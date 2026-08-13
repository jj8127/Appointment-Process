-- Keep profile-backed RLS helpers usable after direct profile-table access is
-- contained. Each helper derives only the current Supabase auth identity and
-- returns a bounded boolean/UUID result; callers never receive arbitrary rows.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.profiles profile
     where profile.id = auth.uid()
       and profile.role = 'admin'
  );
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.profiles profile
     where profile.id = auth.uid()
       and profile.role = 'manager'
  );
$$;

create or replace function public.is_fc()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.profiles profile
     where profile.id = auth.uid()
       and profile.role = 'fc'
  );
$$;

create or replace function public.current_fc_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select profile.fc_id
    from public.profiles profile
   where profile.id = auth.uid();
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_manager() from public;
revoke all on function public.is_fc() from public;
revoke all on function public.current_fc_id() from public;

grant execute on function public.is_admin()
  to anon, authenticated, service_role;
grant execute on function public.is_manager()
  to anon, authenticated, service_role;
grant execute on function public.is_fc()
  to anon, authenticated, service_role;
grant execute on function public.current_fc_id()
  to anon, authenticated, service_role;
