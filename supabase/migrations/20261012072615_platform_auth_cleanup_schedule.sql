-- Hosted rollout requires this schedule. Fail the migration if the extension
-- cannot be enabled; never launch signup with silently skipped expiry cleanup.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('platform-auth-challenge-cleanup','*/5 * * * *',
  'select public.cleanup_platform_auth_challenges();');
