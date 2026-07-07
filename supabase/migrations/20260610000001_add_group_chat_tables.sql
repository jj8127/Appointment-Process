begin;

create table if not exists public.group_chat_rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.group_chat_rooms(id) on delete cascade,
  sender_actor_id text not null,
  sender_role text not null check (sender_role in ('fc', 'manager', 'admin')),
  sender_phone text not null,
  sender_name text,
  content text not null default '',
  message_type text not null default 'text' check (message_type in ('text', 'image', 'file')),
  file_url text,
  file_name text,
  file_size bigint,
  created_at timestamptz not null default now(),
  check (
    char_length(trim(content)) > 0
    or (message_type in ('image', 'file') and file_url is not null)
  )
);

create table if not exists public.group_chat_reads (
  room_id uuid not null references public.group_chat_rooms(id) on delete cascade,
  actor_id text not null,
  last_read_at timestamptz not null default now(),
  last_read_message_id uuid references public.group_chat_messages(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (room_id, actor_id)
);

create table if not exists public.group_chat_preferences (
  room_id uuid not null references public.group_chat_rooms(id) on delete cascade,
  actor_id text not null,
  muted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (room_id, actor_id)
);

create index if not exists idx_group_chat_messages_room_created
  on public.group_chat_messages (room_id, created_at desc);

create index if not exists idx_group_chat_messages_sender_created
  on public.group_chat_messages (sender_actor_id, created_at desc);

create index if not exists idx_group_chat_reads_actor
  on public.group_chat_reads (actor_id);

create index if not exists idx_group_chat_preferences_actor
  on public.group_chat_preferences (actor_id);

alter table public.group_chat_rooms enable row level security;
alter table public.group_chat_messages enable row level security;
alter table public.group_chat_reads enable row level security;
alter table public.group_chat_preferences enable row level security;

drop policy if exists "group_chat_rooms service role" on public.group_chat_rooms;
create policy "group_chat_rooms service role"
  on public.group_chat_rooms for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "group_chat_messages service role" on public.group_chat_messages;
create policy "group_chat_messages service role"
  on public.group_chat_messages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "group_chat_reads service role" on public.group_chat_reads;
create policy "group_chat_reads service role"
  on public.group_chat_reads for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "group_chat_preferences service role" on public.group_chat_preferences;
create policy "group_chat_preferences service role"
  on public.group_chat_preferences for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

insert into public.group_chat_rooms (slug, title, is_active)
values ('garampa-default', '가람PA 단톡방', true)
on conflict (slug) do update
set title = excluded.title,
    is_active = true,
    updated_at = now();

commit;
