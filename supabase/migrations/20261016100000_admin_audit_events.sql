-- Admin action, export and personal-information view log.
-- Records who, when, which target and which action only. Resident numbers, decrypted values
-- and field values are never stored; detail keeps action kinds, status codes and field names.
-- Retention: keep at least 2 years (personal-information access records); no purge job yet.
create table if not exists public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_role text not null check (actor_role in ('admin', 'manager')),
  actor_staff_type text check (actor_staff_type is null or actor_staff_type in ('admin', 'developer')),
  actor_phone text not null check (actor_phone ~ '^[0-9]{9,11}$'),
  category text not null check (category in ('fc_action', 'export', 'personal_info_view')),
  action text not null check (action ~ '^[a-z][a-z0-9_]{0,63}$'),
  target_fc_id uuid,
  target_count integer not null default 0 check (target_count between 0 and 100000),
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and detail::text !~ '[0-9]{6}-?[1-8][0-9]{6}'),
  reason text check (reason is null or char_length(reason) between 1 and 200)
);

create index if not exists admin_audit_events_created_at_idx
  on public.admin_audit_events (created_at desc);
create index if not exists admin_audit_events_category_created_at_idx
  on public.admin_audit_events (category, created_at desc);
create index if not exists admin_audit_events_target_fc_idx
  on public.admin_audit_events (target_fc_id, created_at desc)
  where target_fc_id is not null;

alter table public.admin_audit_events enable row level security;
revoke all on table public.admin_audit_events from public, anon, authenticated;
grant select, insert on table public.admin_audit_events to service_role;

create or replace function public.reject_admin_audit_event_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'admin_audit_events is append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_admin_audit_event_change() from public, anon, authenticated;

drop trigger if exists admin_audit_events_append_only on public.admin_audit_events;
create trigger admin_audit_events_append_only
  before update or delete on public.admin_audit_events
  for each row execute function public.reject_admin_audit_event_change();

drop trigger if exists admin_audit_events_no_truncate on public.admin_audit_events;
create trigger admin_audit_events_no_truncate
  before truncate on public.admin_audit_events
  for each statement execute function public.reject_admin_audit_event_change();

comment on table public.admin_audit_events is
  'Append-only admin action, export and personal-information view log. Never store resident numbers or decrypted values.';
