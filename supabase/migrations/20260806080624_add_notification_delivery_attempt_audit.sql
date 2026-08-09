-- Persist only aggregate provider outcomes for notification fanout. Token
-- values, provider ticket IDs, and raw provider response bodies are excluded.
create table if not exists public.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  delivery_source text not null check (delivery_source in ('board_create', 'board_update', 'admin_notice')),
  target_role text not null check (target_role in ('fc', 'admin', 'manager')),
  provider text not null check (provider in ('fc_notify', 'expo')),
  provider_response_status smallint check (
    provider_response_status is null
    or provider_response_status between 100 and 599
  ),
  attempted integer not null check (attempted between 0 and 1000000),
  accepted integer not null check (accepted between 0 and attempted),
  rejected integer not null check (rejected between 0 and attempted),
  push_status text not null check (push_status in ('accepted', 'no_registered_device', 'provider_rejected')),
  response_confirmed boolean not null,
  failure_code text check (failure_code is null or failure_code in (
    'missing_configuration',
    'upstream_rejected',
    'invalid_response',
    'delivery_unconfirmed',
    'request_failed'
  )),
  recorded_at timestamptz not null default now(),
  unique (notification_id, delivery_source),
  check (accepted + rejected <= attempted)
);

create index if not exists idx_notification_delivery_attempts_recorded
  on public.notification_delivery_attempts (recorded_at desc);

alter table public.notification_delivery_attempts enable row level security;

revoke all privileges on table public.notification_delivery_attempts
  from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_delivery_attempts
  to service_role;

drop policy if exists "notification_delivery_attempts service role"
  on public.notification_delivery_attempts;
create policy "notification_delivery_attempts service role"
  on public.notification_delivery_attempts
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.notification_delivery_attempts is
  'Privacy-safe aggregate provider outcomes for a persisted notification delivery attempt.';
