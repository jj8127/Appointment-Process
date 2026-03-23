create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null references public.fc_profiles (id) on delete cascade,
  code text not null,
  is_active boolean not null default true,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code),
  check (char_length(trim(code)) > 0)
);

create unique index if not exists idx_referral_codes_one_active_per_fc
  on public.referral_codes (fc_id)
  where is_active = true;

create index if not exists idx_referral_codes_fc_id
  on public.referral_codes (fc_id);

create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  inviter_fc_id uuid references public.fc_profiles (id) on delete set null,
  inviter_phone text not null,
  inviter_name text,
  invitee_fc_id uuid references public.fc_profiles (id) on delete set null,
  invitee_phone text not null,
  referral_code_id uuid references public.referral_codes (id) on delete set null,
  referral_code text not null,
  source text check (source is null or source in ('auto_prefill', 'manual_entry', 'admin_override')),
  capture_source text not null default 'unknown' check (capture_source in ('invite_link', 'manual_entry', 'unknown')),
  selection_source text check (selection_source is null or selection_source in ('auto_prefill_kept', 'auto_prefill_edited', 'manual_entry_only', 'admin_override')),
  status text not null default 'captured' check (status in ('captured', 'pending_signup', 'confirmed', 'rejected', 'cancelled', 'overridden')),
  landing_session_id text,
  device_hint text,
  rejection_reason text,
  captured_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (inviter_fc_id is null or invitee_fc_id is null or inviter_fc_id <> invitee_fc_id),
  check (inviter_phone ~ '^[0-9]{11}$'),
  check (invitee_phone ~ '^[0-9]{11}$'),
  check (char_length(trim(referral_code)) > 0)
);

create unique index if not exists idx_referral_attributions_one_confirmed_per_phone
  on public.referral_attributions (invitee_phone)
  where status = 'confirmed';

create unique index if not exists idx_referral_attributions_one_confirmed_per_fc
  on public.referral_attributions (invitee_fc_id)
  where status = 'confirmed' and invitee_fc_id is not null;

create index if not exists idx_referral_attributions_inviter_status
  on public.referral_attributions (inviter_fc_id, status);

create index if not exists idx_referral_attributions_inviter_phone_status
  on public.referral_attributions (inviter_phone, status);

create index if not exists idx_referral_attributions_invitee_fc_status
  on public.referral_attributions (invitee_fc_id, status);

create index if not exists idx_referral_attributions_invitee_phone_status
  on public.referral_attributions (invitee_phone, status);

create index if not exists idx_referral_attributions_referral_code
  on public.referral_attributions (referral_code);

create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid references public.referral_attributions (id) on delete set null,
  referral_code_id uuid references public.referral_codes (id) on delete set null,
  referral_code text,
  inviter_fc_id uuid references public.fc_profiles (id) on delete set null,
  inviter_phone text,
  inviter_name text,
  invitee_fc_id uuid references public.fc_profiles (id) on delete set null,
  invitee_phone text,
  event_type text not null check (
    event_type in (
      'link_clicked',
      'link_landing_opened',
      'app_opened_from_link',
      'code_auto_prefilled',
      'code_edited_before_signup',
      'pending_attribution_saved',
      'code_entered',
      'code_validated',
      'signup_completed',
      'referral_confirmed',
      'referral_rejected',
      'admin_override_applied'
    )
  ),
  source text check (source in ('auto_prefill', 'manual_entry', 'admin_override')),
  landing_session_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_referral_events_attribution_created_at
  on public.referral_events (attribution_id, created_at desc);

create index if not exists idx_referral_events_referral_code_created_at
  on public.referral_events (referral_code_id, created_at desc);

create index if not exists idx_referral_events_referral_code_text_created_at
  on public.referral_events (referral_code, created_at desc);

create index if not exists idx_referral_events_inviter_created_at
  on public.referral_events (inviter_fc_id, created_at desc);

create index if not exists idx_referral_events_inviter_phone_created_at
  on public.referral_events (inviter_phone, created_at desc);

create index if not exists idx_referral_events_invitee_created_at
  on public.referral_events (invitee_fc_id, created_at desc);

create index if not exists idx_referral_events_invitee_phone_created_at
  on public.referral_events (invitee_phone, created_at desc);

drop trigger if exists trg_referral_codes_updated_at on public.referral_codes;
create trigger trg_referral_codes_updated_at
before update on public.referral_codes
for each row execute function public.set_updated_at();

drop trigger if exists trg_referral_attributions_updated_at on public.referral_attributions;
create trigger trg_referral_attributions_updated_at
before update on public.referral_attributions
for each row execute function public.set_updated_at();

alter table public.referral_codes enable row level security;
alter table public.referral_attributions enable row level security;
alter table public.referral_events enable row level security;

drop policy if exists "referral_codes select" on public.referral_codes;
create policy "referral_codes select"
  on public.referral_codes
  for select
  using (public.is_admin());

drop policy if exists "referral_codes insert" on public.referral_codes;
create policy "referral_codes insert"
  on public.referral_codes
  for insert
  with check (public.is_admin());

drop policy if exists "referral_codes update" on public.referral_codes;
create policy "referral_codes update"
  on public.referral_codes
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "referral_codes delete" on public.referral_codes;
create policy "referral_codes delete"
  on public.referral_codes
  for delete
  using (public.is_admin());

drop policy if exists "referral_attributions select" on public.referral_attributions;
create policy "referral_attributions select"
  on public.referral_attributions
  for select
  using (public.is_admin());

drop policy if exists "referral_attributions insert" on public.referral_attributions;
create policy "referral_attributions insert"
  on public.referral_attributions
  for insert
  with check (public.is_admin());

drop policy if exists "referral_attributions update" on public.referral_attributions;
create policy "referral_attributions update"
  on public.referral_attributions
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "referral_attributions delete" on public.referral_attributions;
create policy "referral_attributions delete"
  on public.referral_attributions
  for delete
  using (public.is_admin());

drop policy if exists "referral_events select" on public.referral_events;
create policy "referral_events select"
  on public.referral_events
  for select
  using (public.is_admin());

drop policy if exists "referral_events insert" on public.referral_events;
create policy "referral_events insert"
  on public.referral_events
  for insert
  with check (public.is_admin());

drop policy if exists "referral_events update" on public.referral_events;
create policy "referral_events update"
  on public.referral_events
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "referral_events delete" on public.referral_events;
create policy "referral_events delete"
  on public.referral_events
  for delete
  using (public.is_admin());
