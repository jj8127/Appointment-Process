begin;

create table if not exists public.user_presence (
  phone text primary key,
  garam_in_at timestamptz,
  garam_link_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.user_presence is
  'Cross-platform user activity heartbeat snapshots keyed by phone number.';

comment on column public.user_presence.phone is
  'Shared phone identifier across garamin and garamlink.';

comment on column public.user_presence.garam_in_at is
  'Latest garamin app heartbeat timestamp.';

comment on column public.user_presence.garam_link_at is
  'Latest garamlink heartbeat timestamp.';

comment on column public.user_presence.updated_at is
  'Latest row mutation timestamp.';

alter table public.user_presence enable row level security;

drop policy if exists "user_presence service_role" on public.user_presence;
create policy "user_presence service_role"
  on public.user_presence
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.touch_user_presence(
  p_phone text,
  p_platform text
)
returns table (
  phone text,
  garam_in_at timestamptz,
  garam_link_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean,
  updated_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  touched_at timestamptz := now();
  row_data public.user_presence%rowtype;
begin
  if length(normalized_phone) <> 11 then
    raise exception 'invalid_phone';
  end if;

  if p_platform not in ('garam_in', 'garam_link') then
    raise exception 'invalid_platform';
  end if;

  insert into public.user_presence as up (
    phone,
    garam_in_at,
    garam_link_at,
    updated_at
  )
  values (
    normalized_phone,
    case when p_platform = 'garam_in' then touched_at else null end,
    case when p_platform = 'garam_link' then touched_at else null end,
    touched_at
  )
  on conflict (phone) do update
    set garam_in_at = case when p_platform = 'garam_in' then touched_at else up.garam_in_at end,
        garam_link_at = case when p_platform = 'garam_link' then touched_at else up.garam_link_at end,
        updated_at = touched_at
  returning up.* into row_data;

  return query
  select
    row_data.phone,
    row_data.garam_in_at,
    row_data.garam_link_at,
    greatest(row_data.garam_in_at, row_data.garam_link_at) as last_seen_at,
    coalesce(row_data.garam_in_at > (touched_at - interval '65 seconds'), false)
      or coalesce(row_data.garam_link_at > (touched_at - interval '65 seconds'), false) as is_online,
    row_data.updated_at;
end;
$$;

create or replace function public.stale_user_presence(
  p_phone text,
  p_platform text,
  p_expected_at timestamptz default null
)
returns table (
  phone text,
  garam_in_at timestamptz,
  garam_link_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean,
  updated_at timestamptz,
  applied boolean
)
language plpgsql
set search_path = public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  stale_at constant timestamptz := '1970-01-01 00:00:00+00'::timestamptz;
  changed_at timestamptz := now();
  row_data public.user_presence%rowtype;
  did_apply boolean := false;
begin
  if length(normalized_phone) <> 11 then
    raise exception 'invalid_phone';
  end if;

  if p_platform not in ('garam_in', 'garam_link') then
    raise exception 'invalid_platform';
  end if;

  update public.user_presence as up
     set garam_in_at = case when p_platform = 'garam_in' then stale_at else up.garam_in_at end,
         garam_link_at = case when p_platform = 'garam_link' then stale_at else up.garam_link_at end,
         updated_at = changed_at
   where up.phone = normalized_phone
     and (
       p_expected_at is null
       or (p_platform = 'garam_in' and up.garam_in_at = p_expected_at)
       or (p_platform = 'garam_link' and up.garam_link_at = p_expected_at)
     )
  returning up.* into row_data;

  if found then
    did_apply := true;
  else
    select *
      into row_data
      from public.user_presence
     where phone = normalized_phone;
  end if;

  if row_data.phone is null then
    return;
  end if;

  return query
  select
    row_data.phone,
    row_data.garam_in_at,
    row_data.garam_link_at,
    greatest(row_data.garam_in_at, row_data.garam_link_at) as last_seen_at,
    coalesce(row_data.garam_in_at > (changed_at - interval '65 seconds'), false)
      or coalesce(row_data.garam_link_at > (changed_at - interval '65 seconds'), false) as is_online,
    row_data.updated_at,
    did_apply;
end;
$$;

create or replace function public.get_user_presence(
  p_phones text[]
)
returns table (
  phone text,
  garam_in_at timestamptz,
  garam_link_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean,
  updated_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with normalized as (
    select distinct
      regexp_replace(coalesce(input_phone, ''), '[^0-9]', '', 'g') as phone
    from unnest(coalesce(p_phones, array[]::text[])) as input_phone
  )
  select
    normalized.phone,
    up.garam_in_at,
    up.garam_link_at,
    greatest(up.garam_in_at, up.garam_link_at) as last_seen_at,
    coalesce(up.garam_in_at > (now() - interval '65 seconds'), false)
      or coalesce(up.garam_link_at > (now() - interval '65 seconds'), false) as is_online,
    up.updated_at
  from normalized
  left join public.user_presence up
    on up.phone = normalized.phone
  where length(normalized.phone) = 11;
$$;

revoke all on function public.touch_user_presence(text, text) from public, anon, authenticated;
revoke all on function public.stale_user_presence(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_user_presence(text[]) from public, anon, authenticated;

grant execute on function public.touch_user_presence(text, text) to service_role;
grant execute on function public.stale_user_presence(text, text, timestamptz) to service_role;
grant execute on function public.get_user_presence(text[]) to service_role;

commit;
