-- Messenger stage 1: pull GaramLink chats into the unified model.
-- The request board exports batches at GET /api/messenger-export (its own
-- database). The messenger-garamlink-sync Edge Function fetches them and hands
-- each one to messenger_import_request_board_batch_v1, which imports the batch
-- and moves the stored cursor in one transaction. A batch whose cursor no
-- longer matches (another run got there first) is refused as a whole.

create table if not exists public.messenger_import_cursors (
  source text primary key,
  cursor jsonb,
  batches bigint not null default 0,
  messages bigint not null default 0,
  last_imported_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.messenger_import_cursors enable row level security;
revoke all on public.messenger_import_cursors from public, anon, authenticated;
grant select, insert, update, delete on public.messenger_import_cursors to service_role;

create or replace function public.messenger_import_request_board_batch_v1(
  p_payload jsonb,
  p_expected_cursor jsonb,
  p_next_cursor jsonb
)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_current jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or (p_next_cursor is not null and jsonb_typeof(p_next_cursor) <> 'object') then
    raise exception 'invalid_payload';
  end if;

  insert into public.messenger_import_cursors (source) values ('request_board') on conflict do nothing;
  select cursor into v_current from public.messenger_import_cursors where source = 'request_board' for update;
  if v_current is distinct from p_expected_cursor then
    raise exception 'cursor_conflict';
  end if;

  v_result := public.messenger_import_request_board_v1(p_payload);

  update public.messenger_import_cursors
     set cursor = coalesce(p_next_cursor, cursor),
         batches = batches + 1,
         messages = messages + coalesce((v_result->>'messages')::bigint, 0),
         last_imported_at = now(),
         last_error = null,
         last_error_at = null,
         updated_at = now()
   where source = 'request_board';
  return v_result || jsonb_build_object('cursor', coalesce(p_next_cursor, v_current));
end;
$$;

-- Failures are kept beside the cursor so the daily check can see a stuck sync.
create or replace function public.messenger_import_record_error_v1(p_source text, p_error text)
returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.messenger_import_cursors (source, last_error, last_error_at, updated_at)
  values (p_source, left(p_error, 500), now(), now())
  on conflict (source) do update
     set last_error = excluded.last_error, last_error_at = excluded.last_error_at, updated_at = now();
$$;

revoke all on function public.messenger_import_request_board_batch_v1(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.messenger_import_request_board_batch_v1(jsonb, jsonb, jsonb) to service_role;
revoke all on function public.messenger_import_record_error_v1(text, text) from public, anon, authenticated;
grant execute on function public.messenger_import_record_error_v1(text, text) to service_role;

-- schedule --
-- The service-role key never enters source control: the operator stores it once
-- in Vault as 'messenger_garamlink_sync_service_key'. Until then the job is a
-- no-op. Every 10 minutes keeps the unified copy close to GaramLink while both
-- messengers run side by side.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.request_messenger_garamlink_sync_v1()
returns bigint language plpgsql security definer set search_path = pg_catalog, public as $$
declare service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets
    where name = 'messenger_garamlink_sync_service_key' limit 1;
  if coalesce(service_key, '') = '' then return null; end if;
  return net.http_post(
    url := 'https://ubeginyxaotcamuqpmud.supabase.co/functions/v1/messenger-garamlink-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', service_key, 'Authorization', 'Bearer ' || service_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
end $$;
revoke all on function public.request_messenger_garamlink_sync_v1() from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'messenger-garamlink-sync';
select cron.schedule('messenger-garamlink-sync', '*/10 * * * *',
  'select public.request_messenger_garamlink_sync_v1();');
