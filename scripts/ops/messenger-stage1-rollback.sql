-- Messenger stage 1 rollback. Run ONE level in the SQL editor, lowest first.
-- Levels never touch the legacy chat tables' rows; the apps keep working at
-- every level because they do not read the unified model yet.
--
--   Level 1  stop      : unschedule both jobs. Mirror triggers keep copying.
--   Level 2  detach    : also remove the mirror triggers from legacy tables.
--   Level 3  remove    : also drop every unified-model object. Only when stage 1
--                        is abandoned; the copies are rebuilt by re-applying
--                        the migrations and running the backfill.
--
-- Each level is its own transaction. Copy from its "-- level N --" line to the
-- next one. Levels 2 and 3 include the earlier levels' statements so each can
-- run alone.

-- level 1 --
begin;
select cron.unschedule(jobid) from cron.job
 where jobname in ('messenger-unified-daily-sync', 'messenger-garamlink-sync');
commit;
-- Then: Dashboard -> Edge Functions -> messenger-garamlink-sync -> remove the
-- REQUEST_BOARD_MESSENGER_EXPORT_TOKEN secret (the function answers 503).

-- level 2 --
begin;
select cron.unschedule(jobid) from cron.job
 where jobname in ('messenger-unified-daily-sync', 'messenger-garamlink-sync');
drop trigger if exists trg_messenger_mirror_direct_insert on public.messages;
drop trigger if exists trg_messenger_mirror_direct_update on public.messages;
drop trigger if exists trg_messenger_mirror_group_message on public.group_chat_messages;
drop trigger if exists trg_messenger_mirror_group_read on public.group_chat_reads;
drop trigger if exists trg_messenger_mirror_group_reaction on public.group_chat_reactions;
drop trigger if exists trg_messenger_mirror_group_notice on public.group_chat_notices;
commit;

-- level 3 --
begin;
select cron.unschedule(jobid) from cron.job
 where jobname in ('messenger-unified-daily-sync', 'messenger-garamlink-sync');
drop trigger if exists trg_messenger_mirror_direct_insert on public.messages;
drop trigger if exists trg_messenger_mirror_direct_update on public.messages;
drop trigger if exists trg_messenger_mirror_group_message on public.group_chat_messages;
drop trigger if exists trg_messenger_mirror_group_read on public.group_chat_reads;
drop trigger if exists trg_messenger_mirror_group_reaction on public.group_chat_reactions;
drop trigger if exists trg_messenger_mirror_group_notice on public.group_chat_notices;

-- Functions created by 20261016104031-100400 only (other messenger_* objects
-- such as attachments, room hub and search predate stage 1 and stay).
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'messenger_actor_by_phone', 'messenger_actor_for', 'messenger_actor_for_account',
         'messenger_actor_for_group_key', 'messenger_append_message', 'messenger_apply_room_preferences',
         'messenger_backfill_v1', 'messenger_can_access', 'messenger_can_start_org_room',
         'messenger_daily_sync_v1', 'messenger_decide_org_member', 'messenger_direct_sender',
         'messenger_ensure_actor', 'messenger_ensure_direct_thread', 'messenger_ensure_group_room',
         'messenger_fill_direct_conversation', 'messenger_fill_direct_thread', 'messenger_fill_group_room',
         'messenger_headquarters_numbers', 'messenger_import_record_error_v1',
         'messenger_import_request_board_batch_v1', 'messenger_import_request_board_deletions_batch_v1',
         'messenger_import_request_board_v1', 'messenger_mirror_direct_message', 'messenger_mirror_direct_update',
         'messenger_mirror_group_message', 'messenger_mirror_group_notice', 'messenger_mirror_group_reaction',
         'messenger_mirror_group_read', 'messenger_next_seq', 'messenger_normalize_phone',
         'messenger_org_by_slug', 'messenger_orphan_purge_candidates_v1', 'messenger_place_orphan_messages',
         'messenger_purge_orphan_messages_v1', 'messenger_reconcile_streak_v1', 'messenger_reconcile_v1',
         'messenger_record_event', 'messenger_record_issue_once', 'messenger_record_orphan_issue',
         'messenger_repair_conversation_order_v1', 'messenger_repair_late_conversations_v1',
         'messenger_sync_headquarters_v1', 'request_messenger_garamlink_sync_v1'
       )
  loop
    execute format('drop function if exists %s cascade', f.signature);
  end loop;
end;
$$;

drop table if exists
  public.messenger_reactions, public.messenger_events, public.messenger_messages,
  public.messenger_participants, public.messenger_conversation_orgs, public.messenger_legacy_map,
  public.messenger_orphan_placements, public.messenger_conversations, public.messenger_member_approvers,
  public.messenger_org_members, public.messenger_actor_links, public.messenger_orgs, public.messenger_actors,
  public.messenger_sync_issues, public.messenger_reconcile_runs, public.messenger_import_cursors;
commit;
-- Then: Dashboard -> Storage -> empty and delete the bucket
-- 'messenger-imported-attachments', and delete the messenger-garamlink-sync
-- Edge function. Remove the Vault secret 'messenger_garamlink_sync_service_key'.
