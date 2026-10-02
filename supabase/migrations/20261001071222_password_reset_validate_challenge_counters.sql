-- Apply only after the challenge migration has committed. Combining the two
-- migrations in one transaction would retain its ACCESS EXCLUSIVE locks
-- through these scans and defeat the lower-blocking validation phase.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.admin_accounts
  validate constraint admin_accounts_reset_failed_count_check;
alter table public.manager_accounts
  validate constraint manager_accounts_reset_failed_count_check;
alter table public.fc_credentials
  validate constraint fc_credentials_reset_failed_count_check;
