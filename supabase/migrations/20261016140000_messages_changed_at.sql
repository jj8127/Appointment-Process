-- 1:1 messages carry the time they last changed, so a client can ask only for
-- what changed after the newest change it already holds (sends, read marks and
-- deletes alike) instead of reloading the whole conversation.
--
-- Existing rows take the time this column is added: a client never sends a
-- cursor older than its first full load, so they are never missed. The stamp
-- uses clock_timestamp() rather than now(): a long transaction must not stamp
-- a row with its start time. Readers still re-read a short overlap window,
-- because a row stamped just before another commits can become visible later.

alter table public.messages
  add column if not exists changed_at timestamptz not null default now();

create or replace function public.messages_touch_changed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.changed_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.messages_touch_changed_at() from public, anon, authenticated;

drop trigger if exists messages_touch_changed_at on public.messages;
create trigger messages_touch_changed_at
  before insert or update on public.messages
  for each row execute function public.messages_touch_changed_at();

create index if not exists idx_messages_thread_changed
  on public.messages (thread_id, changed_at);
create index if not exists idx_messages_sender_receiver_changed
  on public.messages (sender_id, receiver_id, changed_at)
  where conversation_id is null;
