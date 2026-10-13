-- Purge expired FC signup completion capabilities, including consumed rows
-- whose result payload contains short-lived signup response data. The existing
-- platform-auth-challenge-cleanup cron job calls this stable function name.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

drop index if exists public.fc_signup_completion_challenges_expires_idx;
create index fc_signup_completion_challenges_expires_idx
  on public.fc_signup_completion_challenges (expires_at);

create or replace function public.cleanup_platform_auth_challenges()
returns void language sql security invoker set search_path=public,pg_temp as $$
  delete from platform_signup_challenges where expires_at<=now()
    and coalesce(locked_until,expires_at)<=now();
  update platform_member_credentials c set reset_token_hash=null,reset_token_expires_at=null,
    reset_sent_at=null,reset_failed_count=0
    from platform_members m where m.id=c.member_id and m.fc_id is null
    and (c.reset_token_expires_at<=now() or (c.reset_token_hash is null and c.reset_sent_at<=now()-interval '60 seconds'));
  delete from platform_sms_delivery_attempts where created_at<now()-interval '31 days';
  delete from fc_signup_completion_challenges where expires_at<=now();
$$;
revoke all on function public.cleanup_platform_auth_challenges() from public,anon,authenticated;
grant execute on function public.cleanup_platform_auth_challenges() to service_role;
