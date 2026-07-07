-- Device tokens are now managed through the service-role-backed
-- device-token-register Edge Function. Do not expose this table to anon or
-- authenticated Data API callers.

alter table if exists public.device_tokens enable row level security;

drop policy if exists "device_tokens select policy" on public.device_tokens;
drop policy if exists "device_tokens insert policy" on public.device_tokens;
drop policy if exists "device_tokens update policy" on public.device_tokens;
drop policy if exists "device_tokens delete policy" on public.device_tokens;

revoke all on table public.device_tokens from anon;
revoke all on table public.device_tokens from authenticated;
