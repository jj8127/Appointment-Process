alter table public.admin_accounts
  add column if not exists reset_token_hash text;

alter table public.admin_accounts
  add column if not exists reset_token_expires_at timestamptz;

alter table public.admin_accounts
  add column if not exists reset_sent_at timestamptz;

alter table public.manager_accounts
  add column if not exists reset_token_hash text;

alter table public.manager_accounts
  add column if not exists reset_token_expires_at timestamptz;

alter table public.manager_accounts
  add column if not exists reset_sent_at timestamptz;
