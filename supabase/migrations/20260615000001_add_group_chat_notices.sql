begin;

create table if not exists public.group_chat_notices (
  room_id uuid primary key references public.group_chat_rooms(id) on delete cascade,
  message_id uuid not null references public.group_chat_messages(id) on delete cascade,
  created_by_actor_id text not null,
  created_by_role text not null check (created_by_role in ('manager', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_group_chat_notices_message
  on public.group_chat_notices (message_id);

alter table public.group_chat_notices enable row level security;

drop policy if exists "group_chat_notices service role"
  on public.group_chat_notices;
create policy "group_chat_notices service role"
  on public.group_chat_notices for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

commit;
