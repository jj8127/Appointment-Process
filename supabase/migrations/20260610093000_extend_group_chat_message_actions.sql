alter table public.group_chat_messages
  add column if not exists reply_to_message_id uuid references public.group_chat_messages(id) on delete set null,
  add column if not exists reply_to_sender_name text,
  add column if not exists reply_to_content text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_id text;

create table if not exists public.group_chat_reactions (
  room_id uuid not null references public.group_chat_rooms(id) on delete cascade,
  message_id uuid not null references public.group_chat_messages(id) on delete cascade,
  actor_id text not null,
  actor_role text not null check (actor_role in ('fc', 'manager', 'admin')),
  reaction text not null check (char_length(reaction) between 1 and 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, message_id, actor_id)
);

create index if not exists idx_group_chat_messages_reply
  on public.group_chat_messages (reply_to_message_id);

create index if not exists idx_group_chat_messages_deleted
  on public.group_chat_messages (room_id, deleted_at);

create index if not exists idx_group_chat_reactions_message
  on public.group_chat_reactions (message_id);

create index if not exists idx_group_chat_reactions_actor
  on public.group_chat_reactions (actor_id);

alter table public.group_chat_reactions enable row level security;

drop policy if exists "group_chat_reactions service role" on public.group_chat_reactions;
create policy "group_chat_reactions service role"
  on public.group_chat_reactions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
