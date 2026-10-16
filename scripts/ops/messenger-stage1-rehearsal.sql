-- Messenger stage-1 backfill rehearsal.
-- Run ONLY on a project restored from a production backup, never on production.
-- Each step is run separately and its result is reviewed before the next one.
-- Every step starts with the same guard, so a step pasted alone is still safe.
-- Step 2 applies supabase/migrations/20261016100000_messenger_unified_model.sql
-- and 20261016100100_messenger_unified_backfill.sql (not repeated here).

-- ===========================================================================
-- Step 0. Guard: this database must be the restored rehearsal copy.
-- The operator writes the marker once, right after the restore; production
-- never has it, so every later step refuses to run there.
-- ===========================================================================
-- create table if not exists public.messenger_rehearsal_marker (restored_at timestamptz primary key default now());
-- insert into public.messenger_rehearsal_marker default values;
do $$
begin
  if to_regclass('public.messenger_rehearsal_marker') is null then
    raise exception 'not a rehearsal database: messenger_rehearsal_marker is missing';
  end if;
end;
$$;

-- The restore copies production pg_cron jobs, and one of them calls a
-- production Edge Function through net.http_post with the vaulted service key.
-- Pause every job on the copy before anything else runs.
do $$
begin
  if to_regclass('cron.job') is not null then
    execute 'update cron.job set active = false where active';
  end if;
end;
$$;

-- ===========================================================================
-- Step 1. Preflight: legacy volumes and rows the backfill cannot place.
-- ===========================================================================
do $$
begin
  if to_regclass('public.messenger_rehearsal_marker') is null then
    raise exception 'not a rehearsal database: messenger_rehearsal_marker is missing';
  end if;
end;
$$;
select 'fc_profiles' as item, count(*) as n from public.fc_profiles
union all select 'admin_accounts', count(*) from public.admin_accounts
union all select 'manager_accounts', count(*) from public.manager_accounts
union all select 'platform_members', count(*) from public.platform_members
union all select 'platform_partners', count(*) from public.platform_partners
union all select 'garamin_direct_threads', count(*) from public.garamin_direct_threads
union all select 'messages', count(*) from public.messages
union all select 'messages_without_thread', count(*) from public.messages where thread_id is null
union all select 'group_chat_rooms', count(*) from public.group_chat_rooms
union all select 'group_chat_messages', count(*) from public.group_chat_messages
union all select 'group_chat_reads', count(*) from public.group_chat_reads
union all select 'room_preferences', count(*) from public.messenger_room_notification_preferences
union all select 'phones_shared_by_accounts', count(*) from (
  select phone from (
    select phone from public.fc_profiles
    union all select phone from public.admin_accounts
    union all select phone from public.manager_accounts) p
  group by phone having count(*) > 1) d
union all select 'db_size_mb', (pg_database_size(current_database()) / 1048576)::bigint;

-- ===========================================================================
-- Step 3. Backfill, timed.
-- ===========================================================================
do $$
begin
  if to_regclass('public.messenger_rehearsal_marker') is null then
    raise exception 'not a rehearsal database: messenger_rehearsal_marker is missing';
  end if;
end;
$$;
select clock_timestamp() as started_at;
select public.messenger_backfill_v1() as result;
select clock_timestamp() as finished_at;

-- ===========================================================================
-- Step 4. Reconcile and review issues.
-- ===========================================================================
do $$
begin
  if to_regclass('public.messenger_rehearsal_marker') is null then
    raise exception 'not a rehearsal database: messenger_rehearsal_marker is missing';
  end if;
end;
$$;
select public.messenger_reconcile_v1() as result;

select source, reason, count(*) as n, min(source_key) as example_key
  from public.messenger_sync_issues
 where resolved_at is null
 group by source, reason
 order by n desc;

-- Shape of the new data.
select kind, count(*) as conversations, sum(last_message_seq) as messages
  from public.messenger_conversations group by kind order by kind;
select role, status, count(*) from public.messenger_org_members group by role, status order by role;

-- Unread parity for FCs in 1:1 rooms: legacy unread vs unified unread.
with legacy as (
  select c.fc_id, count(*) filter (where not m.is_read and m.sender_actor_id is distinct from c.fc_id) as unread
    from public.messages m
    join public.garamin_direct_threads t on t.id = m.thread_id
    join public.garamin_direct_conversations c on c.id = t.legacy_conversation_id
   where m.deleted_at is null
   group by c.fc_id
), unified as (
  select l.source_id::uuid as fc_id,
         count(*) filter (where mm.seq > p.last_read_seq and mm.sender_actor_id is distinct from p.actor_id) as unread
    from public.messenger_participants p
    join public.messenger_actor_links l on l.actor_id = p.actor_id and l.source_kind = 'fc'
    join public.messenger_legacy_map map on map.conversation_id = p.conversation_id and map.source_kind = 'garamin_direct_thread'
    join public.messenger_messages mm on mm.conversation_id = p.conversation_id and mm.deleted_at is null
   group by l.source_id
)
select count(*) filter (where coalesce(legacy.unread, 0) <> coalesce(unified.unread, 0)) as fc_unread_mismatches,
       count(*) as fcs_compared
  from legacy full join unified using (fc_id);

-- ===========================================================================
-- Step 5. Idempotency: a second run must add nothing.
-- ===========================================================================
do $$
begin
  if to_regclass('public.messenger_rehearsal_marker') is null then
    raise exception 'not a rehearsal database: messenger_rehearsal_marker is missing';
  end if;
end;
$$;
select clock_timestamp() as started_at;
select public.messenger_backfill_v1() as result;
select clock_timestamp() as finished_at;
select count(*) as messages_after_second_run from public.messenger_messages;

-- ===========================================================================
-- Step 6. Dual-write smoke on a synthetic thread (rehearsal copy only).
-- Uses the first FC that has an inbox thread; only the probe is rolled back.
-- ===========================================================================
do $$
begin
  if to_regclass('public.messenger_rehearsal_marker') is null then
    raise exception 'not a rehearsal database: messenger_rehearsal_marker is missing';
  end if;
end;
$$;
create temp table if not exists rehearsal_probe (mirrored integer);
do $$
declare
  v_mirrored integer;
begin
  begin
    insert into public.messages (sender_id, receiver_id, content, sender_actor_id, thread_id)
    select f.phone, 'admin', 'rehearsal dual-write probe', f.id, t.id
      from public.garamin_direct_threads t
      join public.garamin_direct_conversations c on c.id = t.legacy_conversation_id
      join public.fc_profiles f on f.id = c.fc_id
     where t.counterparty_role = 'admin'
     limit 1;
    select count(*) into v_mirrored from public.messenger_messages
     where content = 'rehearsal dual-write probe';
    -- Undo only this block: the probe never stays in either table.
    raise exception using errcode = 'P0001', message = 'rehearsal_probe_rollback';
  exception when sqlstate 'P0001' then
    null;
  end;
  insert into rehearsal_probe values (v_mirrored);
end;
$$;
select mirrored from rehearsal_probe;
