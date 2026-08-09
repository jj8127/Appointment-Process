-- Server-owned notification preferences. Mobile clients can only reach these
-- tables through signed Edge Functions which derive the immutable actor tuple.
create table if not exists public.app_push_preferences (
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('fc', 'manager', 'admin')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, actor_role)
);

create table if not exists public.app_push_category_preferences (
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('fc', 'manager', 'admin')),
  category text not null check (category in ('messages', 'request_activity', 'notices', 'operations')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, actor_role, category)
);

create table if not exists public.messenger_room_notification_preferences (
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('fc', 'manager', 'admin')),
  room_key text not null check (
    room_key ~ '^garamin:(direct-thread|group):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, actor_role, room_key)
);

create or replace function public.prevent_notification_preference_actor_tuple_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.actor_id is distinct from old.actor_id
     or new.actor_role is distinct from old.actor_role then
    raise exception 'notification_preference_actor_tuple_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_notification_preference_actor_tuple_change()
  from public, anon, authenticated;
grant execute on function public.prevent_notification_preference_actor_tuple_change()
  to service_role;

drop trigger if exists app_push_preferences_actor_tuple_immutable
  on public.app_push_preferences;
create trigger app_push_preferences_actor_tuple_immutable
  before update on public.app_push_preferences
  for each row execute function public.prevent_notification_preference_actor_tuple_change();

drop trigger if exists app_push_category_preferences_actor_tuple_immutable
  on public.app_push_category_preferences;
create trigger app_push_category_preferences_actor_tuple_immutable
  before update on public.app_push_category_preferences
  for each row execute function public.prevent_notification_preference_actor_tuple_change();

drop trigger if exists messenger_room_preferences_actor_tuple_immutable
  on public.messenger_room_notification_preferences;
create trigger messenger_room_preferences_actor_tuple_immutable
  before update on public.messenger_room_notification_preferences
  for each row execute function public.prevent_notification_preference_actor_tuple_change();

create index if not exists idx_app_push_category_preferences_actor
  on public.app_push_category_preferences (actor_id, actor_role);

create index if not exists idx_messenger_room_notification_preferences_actor
  on public.messenger_room_notification_preferences (actor_id, actor_role, muted);

alter table public.app_push_preferences enable row level security;
alter table public.app_push_category_preferences enable row level security;
alter table public.messenger_room_notification_preferences enable row level security;

revoke all on table public.app_push_preferences from public, anon, authenticated;
revoke all on table public.app_push_category_preferences from public, anon, authenticated;
revoke all on table public.messenger_room_notification_preferences from public, anon, authenticated;
grant all on table public.app_push_preferences to service_role;
grant all on table public.app_push_category_preferences to service_role;
grant all on table public.messenger_room_notification_preferences to service_role;

drop policy if exists "app_push_preferences service role" on public.app_push_preferences;
create policy "app_push_preferences service role"
  on public.app_push_preferences
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "app_push_category_preferences service role" on public.app_push_category_preferences;
create policy "app_push_category_preferences service role"
  on public.app_push_category_preferences
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "messenger_room_notification_preferences service role" on public.messenger_room_notification_preferences;
create policy "messenger_room_notification_preferences service role"
  on public.messenger_room_notification_preferences
  for all
  to service_role
  using (true)
  with check (true);

-- Compatibility backfill: the canonical room preference table becomes the
-- single source of truth while retaining existing group-chat mute choices.
insert into public.messenger_room_notification_preferences (
  actor_id,
  actor_role,
  room_key,
  muted,
  updated_at
)
select resolved.actor_id,
       resolved.actor_role,
       'garamin:group:' || preferences.room_id::text,
       preferences.muted,
       preferences.updated_at
from public.group_chat_preferences preferences
join lateral (
  select fc.id as actor_id, 'fc'::text as actor_role
  from public.fc_profiles fc
  where preferences.actor_id = 'fc:' || regexp_replace(fc.phone, '[^0-9]', '', 'g')
  union all
  select manager.id, 'manager'::text
  from public.manager_accounts manager
  where preferences.actor_id = 'manager:' || regexp_replace(manager.phone, '[^0-9]', '', 'g')
  union all
  select admin.id, 'admin'::text
  from public.admin_accounts admin
  where preferences.actor_id = 'admin:' || regexp_replace(admin.phone, '[^0-9]', '', 'g')
) resolved on true
on conflict (actor_id, actor_role, room_key) do update
set muted = excluded.muted,
    updated_at = excluded.updated_at;
