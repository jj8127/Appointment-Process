-- Messenger stage 1: run the backfill and the reconciliation every day.
-- The backfill maps rooms, members and thread-less messages that appeared
-- since the last run; the reconciliation then records one row in
-- messenger_reconcile_runs. The stage-1 gate is 7 consecutive ok runs.

create or replace function public.messenger_daily_sync_v1()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_started timestamptz := clock_timestamp();
  v_backfill jsonb;
  v_reconcile jsonb;
begin
  -- One run at a time; an overlapping start returns without doing anything.
  if not pg_try_advisory_xact_lock(hashtext('messenger_daily_sync_v1')) then
    return jsonb_build_object('skipped', 'already_running');
  end if;

  begin
    v_backfill := public.messenger_backfill_v1();
    v_reconcile := public.messenger_reconcile_v1();
  exception when others then
    -- The failed work is rolled back; the failure itself is kept as a run row
    -- so the daily check sees it.
    insert into public.messenger_reconcile_runs (ok, result)
    values (false, jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate, 'stage', 'daily_sync'));
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  -- Keep half a year of run history.
  delete from public.messenger_reconcile_runs where ran_at < now() - interval '180 days';

  return jsonb_build_object(
    'ok', coalesce((v_reconcile->>'ok')::boolean, false),
    'backfill', v_backfill,
    'reconcile', v_reconcile,
    'elapsedMs', round(extract(epoch from clock_timestamp() - v_started) * 1000)
  );
end;
$$;

-- How many of the most recent runs passed in a row (the stage-1 gate needs 7).
create or replace function public.messenger_reconcile_streak_v1()
returns integer
language sql stable security invoker set search_path = public, pg_temp as $$
  select count(*)::integer
    from public.messenger_reconcile_runs r
   where r.ok
     and r.ran_at > coalesce((select max(ran_at) from public.messenger_reconcile_runs where not ok), '-infinity');
$$;

revoke all on function public.messenger_daily_sync_v1() from public, anon, authenticated;
grant execute on function public.messenger_daily_sync_v1() to service_role;
revoke all on function public.messenger_reconcile_streak_v1() from public, anon, authenticated;
grant execute on function public.messenger_reconcile_streak_v1() to service_role;

-- schedule --
-- 18:30 UTC is 03:30 KST, the quietest hour for the messenger.
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'messenger-unified-daily-sync';
select cron.schedule('messenger-unified-daily-sync', '30 18 * * *',
  'select public.messenger_daily_sync_v1();');
