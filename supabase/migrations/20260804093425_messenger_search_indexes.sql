create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_messages_live_content_trgm
  on public.messages using gin (content extensions.gin_trgm_ops)
  where deleted_at is null;

create index if not exists idx_group_chat_messages_live_content_trgm
  on public.group_chat_messages using gin (content extensions.gin_trgm_ops)
  where deleted_at is null;
