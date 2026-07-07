begin;

create table if not exists public.group_chat_member_send_permissions (
  room_id uuid not null references public.group_chat_rooms(id) on delete cascade,
  actor_id text not null,
  can_send_messages boolean not null default false,
  updated_by_actor_id text,
  updated_by_role text check (updated_by_role in ('manager', 'admin')),
  updated_at timestamptz not null default now(),
  primary key (room_id, actor_id),
  check (actor_id like 'fc:%')
);

create index if not exists idx_group_chat_member_send_permissions_actor
  on public.group_chat_member_send_permissions (actor_id);

create index if not exists idx_group_chat_member_send_permissions_room_enabled
  on public.group_chat_member_send_permissions (room_id, can_send_messages);

alter table public.group_chat_member_send_permissions enable row level security;

drop policy if exists "group_chat_member_send_permissions service role"
  on public.group_chat_member_send_permissions;
create policy "group_chat_member_send_permissions service role"
  on public.group_chat_member_send_permissions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

commit;
