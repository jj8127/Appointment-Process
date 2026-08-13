-- Request Board designer sessions register native Expo tokens as role='manager'.
-- Keep the table service-role-only; this migration only aligns the existing
-- role constraint with the canonical schema and notification policy.
alter table public.device_tokens
  drop constraint if exists device_tokens_role_check;

alter table public.device_tokens
  add constraint device_tokens_role_check
  check (role in ('admin', 'fc', 'manager'));
