-- Reminds platform admins when a care reservation passes its first-contact due
-- time. Reuses the Vault secret of the withdrawal drain (the service-role key);
-- without it the job is a no-op. platform-service accepts the sweep only with
-- that exact key in both apikey and Authorization headers, and each overdue
-- request is claimed once by claim_overdue_hospital_care_v1.
set local lock_timeout='3s';
set local statement_timeout='30s';
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.request_hospital_care_sla_sweep_v1()
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare service_key text;
begin
  -- Skip the call when nothing is overdue; the Edge sweep claims under its own update.
  if not exists(select from platform_hospital_care_requests where status in ('requested','reviewing')
    and first_contact_at is null and sla_escalated_at is null and first_contact_due_at<clock_timestamp()) then
    return null;
  end if;
  select decrypted_secret into service_key from vault.decrypted_secrets
    where name='platform_withdrawal_drain_service_key' limit 1;
  if coalesce(service_key,'')='' then return null; end if;
  return net.http_post(
    url:='https://ubeginyxaotcamuqpmud.supabase.co/functions/v1/platform-service',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',service_key,'Authorization','Bearer '||service_key),
    body:=jsonb_build_object('action','hospital_care_sla_sweep'),
    timeout_milliseconds:=30000);
end $$;
revoke all on function public.request_hospital_care_sla_sweep_v1() from public,anon,authenticated,service_role;

select cron.unschedule(jobid) from cron.job where jobname='hospital-care-sla-sweep';
select cron.schedule('hospital-care-sla-sweep','*/5 * * * *',
  'select public.request_hospital_care_sla_sweep_v1()');
