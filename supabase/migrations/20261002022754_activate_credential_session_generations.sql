set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Activate only after every issuer and verifier has deployed generation support.
drop trigger if exists credential_session_version on public.fc_credentials;
create trigger credential_session_version before update on public.fc_credentials
  for each row execute function public.advance_credential_session_version();
drop trigger if exists credential_session_version on public.admin_accounts;
create trigger credential_session_version before update on public.admin_accounts
  for each row execute function public.advance_credential_session_version();
drop trigger if exists credential_session_version on public.manager_accounts;
create trigger credential_session_version before update on public.manager_accounts
  for each row execute function public.advance_credential_session_version();
