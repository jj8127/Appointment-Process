-- Finish admitted common withdrawals without waiting for the member to reopen
-- the app. The service-role key never enters source control: the operator
-- stores it once in Vault as 'platform_withdrawal_drain_service_key'. Until
-- then the job is a no-op. platform-service accepts the drain only with that
-- exact key in both apikey and Authorization headers and processes at most
-- three due jobs per call, each serialized by its own operation lock.
set local lock_timeout='3s';
set local statement_timeout='30s';
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.request_platform_withdrawal_drain_v1()
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets
    where name='platform_withdrawal_drain_service_key' limit 1;
  if coalesce(service_key,'')='' then return null; end if;
  -- Skip the call when nothing is due; the Edge drain re-checks under locks.
  if not exists(select from platform_account_withdrawals where not completed and next_attempt_at<=clock_timestamp()) then
    return null;
  end if;
  return net.http_post(
    url:='https://ubeginyxaotcamuqpmud.supabase.co/functions/v1/platform-service',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',service_key,'Authorization','Bearer '||service_key),
    body:=jsonb_build_object('action','withdrawal_cleanup_drain'),
    timeout_milliseconds:=60000);
end $$;
revoke all on function public.request_platform_withdrawal_drain_v1() from public,anon,authenticated,service_role;

select cron.unschedule(jobid) from cron.job where jobname='platform-withdrawal-cleanup-drain';
select cron.schedule('platform-withdrawal-cleanup-drain','*/5 * * * *',
  'select public.request_platform_withdrawal_drain_v1()');
