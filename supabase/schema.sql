-- Supabase 스키마/정책 정의
-- Supabase SQL Editor나 supabase CLI로 실행하세요.
-- governance sync marker: 2026-03-28 (migration 20260328000001_add_hanwha_commission_contract.sql)

create extension if not exists "uuid-ossp";

create table if not exists public.fc_profiles (
  id uuid primary key default gen_random_uuid(),
  temp_id text unique,
  name text not null,
  affiliation text not null,
  resident_id_masked text,
  resident_id_hash text,
  phone text not null,
  recommender text,
  recommender_fc_id uuid references public.fc_profiles (id) on delete set null,
  recommender_code_id uuid,
  recommender_code text,
  recommender_linked_at timestamptz,
  recommender_link_source text check (
    recommender_link_source is null
    or recommender_link_source in ('signup', 'self_service', 'admin_override', 'legacy_migration')
  ),
  email text,
  address text,
  address_detail text,
  career_type text check (career_type in ('신입', '경력')),
  allowance_date date,
  allowance_prescreen_requested_at timestamp with time zone,
  allowance_reject_reason text,
  docs_deadline_at date,
  docs_deadline_last_notified_at date,
  hanwha_commission_date_sub date,
  hanwha_commission_date date,
  hanwha_commission_reject_reason text,
  hanwha_commission_pdf_path text,
  hanwha_commission_pdf_name text,
  appointment_url text,
  appointment_date date,
  appointment_schedule_life text,
  appointment_schedule_nonlife text,
  appointment_date_life date,
  appointment_date_nonlife date,
  appointment_date_life_sub date,
  appointment_date_nonlife_sub date,
  appointment_reject_reason_life text,
  appointment_reject_reason_nonlife text,
  life_commission_completed boolean not null default false,
  nonlife_commission_completed boolean not null default false,
  status text not null default 'draft',
  identity_completed boolean not null default false,
  signup_completed boolean not null default false,
  phone_verified boolean not null default false,
  phone_verified_at timestamptz,
  phone_verification_hash text,
  phone_verification_expires_at timestamptz,
  phone_verification_sent_at timestamptz,
  phone_verification_attempts integer not null default 0,
  phone_verification_locked_until timestamptz,
  is_manager_referral_shadow boolean not null default false,
  admin_memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fc_profiles
  drop constraint if exists fc_profiles_allowance_flow_requires_date;

comment on column public.fc_profiles.status is
  'FC onboarding workflow: draft -> temp-id-issued -> allowance-pending -> allowance-consented -> docs-requested -> docs-pending -> docs-submitted -> docs-rejected -> docs-approved -> hanwha-commission-review -> hanwha-commission-rejected -> hanwha-commission-approved -> appointment-completed -> final-link-sent';

-- 주민번호 마스킹 기준 upsert를 위해 유니크 인덱스 추가
drop index if exists idx_fc_profiles_resident_id_masked;
create unique index if not exists idx_fc_profiles_resident_id_hash on public.fc_profiles (resident_id_hash);
create unique index if not exists idx_fc_profiles_phone on public.fc_profiles (phone);
alter table public.fc_profiles
  add column if not exists life_commission_completed boolean not null default false;
alter table public.fc_profiles
  add column if not exists nonlife_commission_completed boolean not null default false;
alter table public.fc_profiles
  add column if not exists admin_memo text;
alter table public.fc_profiles
  add column if not exists allowance_prescreen_requested_at timestamp with time zone;
alter table public.fc_profiles
  add column if not exists is_manager_referral_shadow boolean not null default false;

comment on column public.fc_profiles.allowance_prescreen_requested_at is
  '총무가 수당동의 사전 심사를 실제로 요청한 시각';

create table if not exists public.fc_identity_secure (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null references public.fc_profiles (id) on delete cascade,
  resident_number_encrypted text not null,
  address_encrypted text not null,
  address_detail_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fc_id)
);

create table if not exists public.fc_credentials (
  fc_id uuid primary key references public.fc_profiles (id) on delete cascade,
  password_hash text not null,
  password_salt text not null,
  password_set_at timestamptz,
  failed_count integer not null default 0,
  locked_until timestamptz,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  reset_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  staff_type text not null default 'admin' check (staff_type in ('admin', 'developer')),
  password_hash text not null,
  password_salt text not null,
  password_set_at timestamptz,
  failed_count integer not null default 0,
  locked_until timestamptz,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  reset_sent_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  password_hash text not null,
  password_salt text not null,
  password_set_at timestamptz,
  failed_count integer not null default 0,
  locked_until timestamptz,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  reset_sent_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
      'code_generated',
      'code_rotated',
      'code_disabled',
      'admin_override_applied',
      'referral_linked',
      'referral_changed',
      'referral_cleared'
    )
  ),
  source text check (
    source is null
    or source in (
      'auto_prefill',
      'manual_entry',
      'admin_override',
      'signup',
      'self_service',
      'legacy_migration'
    )
  ),
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

create table if not exists public.affiliation_manager_mappings (
  id uuid primary key default gen_random_uuid(),
  affiliation text not null,
  manager_phone text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (affiliation, manager_phone)
);

create index if not exists idx_affiliation_manager_mappings_affiliation
  on public.affiliation_manager_mappings (affiliation);
create index if not exists idx_affiliation_manager_mappings_manager_phone
  on public.affiliation_manager_mappings (manager_phone);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'fc', 'manager')),
  fc_id uuid references public.fc_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 알림용 디바이스 토큰 저장 테이블
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null,
  display_name text,
  role text check (role in ('admin','fc','manager')) not null,
  expo_push_token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  unique (expo_push_token)
);

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  resident_id text,
  role text check (role in ('admin','fc','manager')),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid references public.fc_profiles (id) on delete set null,
  resident_id text,
  recipient_role text check (recipient_role in ('admin','fc','manager')),
  title text not null,
  body text not null,
  category text,
  target_url text,
  created_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists target_url text;

alter table public.device_tokens
  drop constraint if exists device_tokens_role_check;
alter table public.device_tokens
  add constraint device_tokens_role_check check (role in ('admin','fc','manager'));

alter table public.web_push_subscriptions
  drop constraint if exists web_push_subscriptions_role_check;
alter table public.web_push_subscriptions
  add constraint web_push_subscriptions_role_check check (role in ('admin','fc','manager'));

alter table public.notifications
  drop constraint if exists notifications_recipient_role_check;
alter table public.notifications
  add constraint notifications_recipient_role_check check (recipient_role in ('admin','fc','manager'));

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text,
  created_at timestamptz not null default now(),
  created_by text
);

-- keep schema parity with migration history
alter table public.notices
  add column if not exists created_by text;

create table if not exists public.exam_rounds (
  id uuid primary key default gen_random_uuid(),
  exam_date date not null,
  registration_deadline date not null,
  round_label text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_locations (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.exam_rounds (id) on delete cascade,
  location_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, round_id),
  unique (round_id, location_name)
);

create table if not exists public.fc_documents (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null references public.fc_profiles (id) on delete cascade,
  doc_type text not null,
  storage_path text not null,
  file_name text not null,
  status text not null default 'pending',
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fc_id, doc_type)
);

create sequence if not exists public.temp_id_seq start 10000;

create or replace function public.generate_temp_id() returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_num bigint;
begin
  next_num := nextval('public.temp_id_seq');
  return 'T-' || to_char(next_num, 'FM00000');
end;
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, fc_id)
  values (new.id, 'fc', null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_users_create_profile on auth.users;
create trigger trg_auth_users_create_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

drop trigger if exists trg_fc_profiles_updated_at on public.fc_profiles;
create trigger trg_fc_profiles_updated_at
before update on public.fc_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_fc_documents_updated_at on public.fc_documents;
create trigger trg_fc_documents_updated_at
before update on public.fc_documents
for each row execute function public.set_updated_at();

drop trigger if exists trg_fc_identity_secure_updated_at on public.fc_identity_secure;
create trigger trg_fc_identity_secure_updated_at
before update on public.fc_identity_secure
for each row execute function public.set_updated_at();

drop trigger if exists trg_fc_credentials_updated_at on public.fc_credentials;
create trigger trg_fc_credentials_updated_at
before update on public.fc_credentials
for each row execute function public.set_updated_at();

drop trigger if exists trg_admin_accounts_updated_at on public.admin_accounts;
create trigger trg_admin_accounts_updated_at
before update on public.admin_accounts
for each row execute function public.set_updated_at();

drop trigger if exists trg_manager_accounts_updated_at on public.manager_accounts;
create trigger trg_manager_accounts_updated_at
before update on public.manager_accounts
for each row execute function public.set_updated_at();

drop trigger if exists trg_referral_codes_updated_at on public.referral_codes;
create trigger trg_referral_codes_updated_at
before update on public.referral_codes
for each row execute function public.set_updated_at();

drop trigger if exists trg_referral_attributions_updated_at on public.referral_attributions;
create trigger trg_referral_attributions_updated_at
before update on public.referral_attributions
for each row execute function public.set_updated_at();

drop trigger if exists trg_affiliation_manager_mappings_updated_at on public.affiliation_manager_mappings;
create trigger trg_affiliation_manager_mappings_updated_at
before update on public.affiliation_manager_mappings
for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_web_push_subscriptions_updated_at on public.web_push_subscriptions;
create trigger trg_web_push_subscriptions_updated_at
before update on public.web_push_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists trg_exam_rounds_updated_at on public.exam_rounds;
create trigger trg_exam_rounds_updated_at
before update on public.exam_rounds
for each row execute function public.set_updated_at();

drop trigger if exists trg_exam_locations_updated_at on public.exam_locations;
create trigger trg_exam_locations_updated_at
before update on public.exam_locations
for each row execute function public.set_updated_at();

alter table public.fc_profiles enable row level security;
alter table public.fc_documents enable row level security;
alter table public.fc_identity_secure enable row level security;
alter table public.fc_credentials enable row level security;
alter table public.admin_accounts enable row level security;
alter table public.manager_accounts enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referral_attributions enable row level security;
alter table public.referral_events enable row level security;
alter table public.affiliation_manager_mappings enable row level security;
alter table public.profiles enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.notices enable row level security;
alter table public.exam_rounds enable row level security;
alter table public.exam_locations enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.is_manager() returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'manager'
  );
$$;

create or replace function public.is_fc() returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'fc'
  );
$$;

create or replace function public.current_fc_id() returns uuid
language sql stable
set search_path = public
as $$
  select p.fc_id from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.generate_referral_code_candidate() returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  next_code text := '';
  idx integer;
begin
  for idx in 1..8 loop
    next_code := next_code || substr(alphabet, floor(random() * length(alphabet))::integer + 1, 1);
  end loop;

  return next_code;
end;
$$;

create or replace function public.get_invitee_referral_code(p_fc_id uuid) returns text
language sql
stable
security definer
set search_path = public
as $$
  with target_fc as (
    select fp.id, fp.recommender_fc_id
    from public.fc_profiles fp
    where fp.id = p_fc_id
  ),
  linked_recommender_code as (
    select rc.code
    from target_fc tf
    join public.referral_codes rc
      on rc.fc_id = tf.recommender_fc_id
     and rc.is_active = true
    order by rc.created_at desc
    limit 1
  ),
  latest_confirmed_attribution as (
    select
      ra.referral_code,
      ra.referral_code_id,
      ra.inviter_fc_id
    from public.referral_attributions ra
    where ra.invitee_fc_id = p_fc_id
      and ra.status = 'confirmed'
    order by coalesce(ra.confirmed_at, ra.created_at) desc, ra.created_at desc
    limit 1
  ),
  confirmed_referral_code_row as (
    select rc.code
    from latest_confirmed_attribution lca
    join public.referral_codes rc
      on rc.id = lca.referral_code_id
    limit 1
  ),
  confirmed_inviter_active_code as (
    select rc.code
    from latest_confirmed_attribution lca
    join public.referral_codes rc
      on rc.fc_id = lca.inviter_fc_id
     and rc.is_active = true
    order by rc.created_at desc
    limit 1
  )
  select coalesce(
    (
      select code
      from confirmed_referral_code_row
    ),
    (
      select referral_code
      from latest_confirmed_attribution
      limit 1
    ),
    (
      select code
      from confirmed_inviter_active_code
      limit 1
    ),
    (
      select code
      from linked_recommender_code
      limit 1
    )
  );
$$;

comment on function public.get_invitee_referral_code(uuid)
  is 'Trusted helper for admin-action to read the invitee-facing referral code. Execute grant is service_role only.';

create or replace function public.get_referral_subtree(
  root_fc_id uuid,
  max_depth int default 2
) returns table (
  fc_id uuid,
  name text,
  affiliation text,
  active_code text,
  parent_fc_id uuid,
  node_depth int,
  relationship_source text,
  direct_invitee_count int,
  total_descendant_count int,
  is_ancestor boolean
)
language sql
security definer
set search_path = public
as $$
  with recursive
  params as (
    select greatest(1, least(coalesce(max_depth, 2), 5)) as safe_depth
  ),
  root_profile as (
    select
      fp.id,
      fp.name,
      fp.affiliation,
      fp.recommender_fc_id
    from public.fc_profiles fp
    where fp.id = root_fc_id
    limit 1
  ),
  active_codes as (
    select distinct on (rc.fc_id)
      rc.fc_id,
      rc.code
    from public.referral_codes rc
    where rc.is_active = true
    order by rc.fc_id, rc.created_at desc, rc.id desc
  ),
  ancestor_walk as (
    select
      parent.id as fc_id,
      parent.name,
      parent.affiliation,
      parent.recommender_fc_id as next_parent_fc_id,
      -1 as node_depth,
      array[root_fc_id, parent.id]::uuid[] as path
    from root_profile root
    join public.fc_profiles parent
      on parent.id = root.recommender_fc_id
    union all

    select
      parent.id as fc_id,
      parent.name,
      parent.affiliation,
      parent.recommender_fc_id as next_parent_fc_id,
      aw.node_depth - 1 as node_depth,
      aw.path || parent.id
    from ancestor_walk aw
    join public.fc_profiles parent
      on parent.id = aw.next_parent_fc_id
    where aw.node_depth > -10
      and parent.id <> all(aw.path)
  ),
  edge_candidates as (
    select
      child.recommender_fc_id as parent_fc_id,
      child.id as child_fc_id,
      'structured'::text as source_kind
    from public.fc_profiles child
    join public.fc_profiles parent
      on parent.id = child.recommender_fc_id
    where child.recommender_fc_id is not null
      and child.is_manager_referral_shadow is not true
      and (parent.is_manager_referral_shadow is not true or parent.id = root_fc_id)
      and child.id <> child.recommender_fc_id

    union all

    select
      ra.inviter_fc_id as parent_fc_id,
      ra.invitee_fc_id as child_fc_id,
      'confirmed'::text as source_kind
    from public.referral_attributions ra
    join public.fc_profiles child
      on child.id = ra.invitee_fc_id
    join public.fc_profiles parent
      on parent.id = ra.inviter_fc_id
    where ra.status = 'confirmed'
      and ra.inviter_fc_id is not null
      and ra.invitee_fc_id is not null
      and child.is_manager_referral_shadow is not true
      and (parent.is_manager_referral_shadow is not true or parent.id = root_fc_id)
      and ra.inviter_fc_id <> ra.invitee_fc_id
  ),
  edge_sources as (
    select
      ec.parent_fc_id,
      ec.child_fc_id,
      case
        when bool_or(ec.source_kind = 'structured') and bool_or(ec.source_kind = 'confirmed') then 'both'
        when bool_or(ec.source_kind = 'structured') then 'structured'
        else 'confirmed'
      end as relationship_source
    from edge_candidates ec
    where ec.parent_fc_id is not null
      and ec.child_fc_id is not null
    group by ec.parent_fc_id, ec.child_fc_id
  ),
  reachable_all as (
    select
      es.parent_fc_id,
      es.child_fc_id,
      1 as node_depth,
      array[root_fc_id, es.child_fc_id]::uuid[] as path
    from edge_sources es
    where es.parent_fc_id = root_fc_id

    union all

    select
      es.parent_fc_id,
      es.child_fc_id,
      ra.node_depth + 1 as node_depth,
      ra.path || es.child_fc_id
    from reachable_all ra
    join edge_sources es
      on es.parent_fc_id = ra.child_fc_id
    where ra.node_depth < 20
      and es.child_fc_id <> all(ra.path)
  ),
  reachable_nodes as (
    select distinct on (ra.child_fc_id)
      ra.child_fc_id as fc_id,
      ra.parent_fc_id,
      ra.node_depth
    from reachable_all ra
    order by ra.child_fc_id, ra.node_depth asc, ra.parent_fc_id
  ),
  subtree_nodes as (
    select root_fc_id as fc_id
    union
    select rn.fc_id
    from reachable_nodes rn
  ),
  direct_counts as (
    select
      es.parent_fc_id as fc_id,
      count(distinct es.child_fc_id)::int as direct_invitee_count
    from edge_sources es
    join subtree_nodes parent_node
      on parent_node.fc_id = es.parent_fc_id
    join subtree_nodes child_node
      on child_node.fc_id = es.child_fc_id
    group by es.parent_fc_id
  ),
  closure as (
    select
      es.parent_fc_id as ancestor_fc_id,
      es.child_fc_id as descendant_fc_id,
      array[es.parent_fc_id, es.child_fc_id]::uuid[] as path
    from edge_sources es
    join subtree_nodes parent_node
      on parent_node.fc_id = es.parent_fc_id
    join subtree_nodes child_node
      on child_node.fc_id = es.child_fc_id

    union all

    select
      c.ancestor_fc_id,
      es.child_fc_id as descendant_fc_id,
      c.path || es.child_fc_id
    from closure c
    join edge_sources es
      on es.parent_fc_id = c.descendant_fc_id
    join subtree_nodes child_node
      on child_node.fc_id = es.child_fc_id
    where es.child_fc_id <> all(c.path)
  ),
  total_counts as (
    select
      c.ancestor_fc_id as fc_id,
      count(distinct c.descendant_fc_id)::int as total_descendant_count
    from closure c
    group by c.ancestor_fc_id
  ),
  returned_descendants as (
    select
      rn.fc_id,
      fp.name,
      fp.affiliation,
      ac.code as active_code,
      rn.parent_fc_id,
      rn.node_depth,
      coalesce(dc.direct_invitee_count, 0) as direct_invitee_count,
      coalesce(tc.total_descendant_count, 0) as total_descendant_count,
      es.relationship_source
    from reachable_nodes rn
    join params p
      on true
    join public.fc_profiles fp
      on fp.id = rn.fc_id
    left join active_codes ac
      on ac.fc_id = rn.fc_id
    left join direct_counts dc
      on dc.fc_id = rn.fc_id
    left join total_counts tc
      on tc.fc_id = rn.fc_id
    left join edge_sources es
      on es.parent_fc_id = rn.parent_fc_id
     and es.child_fc_id = rn.fc_id
    where rn.node_depth <= p.safe_depth
  )
  select
    root.id as fc_id,
    root.name,
    root.affiliation,
    ac.code as active_code,
    null::uuid as parent_fc_id,
    0 as node_depth,
    'root'::text as relationship_source,
    coalesce(dc.direct_invitee_count, 0) as direct_invitee_count,
    coalesce(tc.total_descendant_count, 0) as total_descendant_count,
    false as is_ancestor
  from root_profile root
  left join active_codes ac
    on ac.fc_id = root.id
  left join direct_counts dc
    on dc.fc_id = root.id
  left join total_counts tc
    on tc.fc_id = root.id

  union all

  select
    aw.fc_id,
    aw.name,
    aw.affiliation,
    ac.code as active_code,
    aw.next_parent_fc_id as parent_fc_id,
    aw.node_depth,
    'structured'::text as relationship_source,
    0 as direct_invitee_count,
    0 as total_descendant_count,
    true as is_ancestor
  from ancestor_walk aw
  left join active_codes ac
    on ac.fc_id = aw.fc_id

  union all

  select
    rd.fc_id,
    rd.name,
    rd.affiliation,
    rd.active_code,
    rd.parent_fc_id,
    rd.node_depth,
    rd.relationship_source,
    rd.direct_invitee_count,
    rd.total_descendant_count,
    false as is_ancestor
  from returned_descendants rd

  order by node_depth asc, name asc nulls last, fc_id asc;
$$;

comment on function public.get_referral_subtree(uuid, int)
  is 'Trusted referral tree reader for mobile self-service drill-down. Execute grant is service_role only.';

create or replace function public.is_request_board_designer_affiliation(p_affiliation text) returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(trim(p_affiliation), '') like '%설계매니저%';
$$;

create or replace function public.resolve_manager_referral_affiliation(
  p_manager_phone text,
  p_manager_name text default null
) returns text
language plpgsql
stable
set search_path = public
as $$
declare
  normalized_phone text := nullif(regexp_replace(coalesce(p_manager_phone, ''), '[^0-9]', '', 'g'), '');
  resolved_affiliation text;
begin
  if normalized_phone is not null then
    select nullif(trim(amm.affiliation), '')
      into resolved_affiliation
    from public.affiliation_manager_mappings amm
    where amm.manager_phone = normalized_phone
      and amm.active = true
    order by amm.created_at asc, amm.affiliation asc
    limit 1;
  end if;

  if resolved_affiliation is not null then
    return resolved_affiliation;
  end if;

  return coalesce(nullif(trim(coalesce(p_manager_name, '')), ''), '본부장');
end;
$$;

create or replace function public.ensure_manager_referral_shadow_profile(
  p_manager_phone text,
  p_manager_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone text := nullif(regexp_replace(coalesce(p_manager_phone, ''), '[^0-9]', '', 'g'), '');
  manager_row public.manager_accounts%rowtype;
  existing_profile public.fc_profiles%rowtype;
  resolved_name text;
  resolved_affiliation text;
begin
  if normalized_phone is null or normalized_phone !~ '^[0-9]{11}$' then
    raise exception 'manager_phone is required';
  end if;

  select *
    into manager_row
  from public.manager_accounts
  where phone = normalized_phone
    and active = true
  limit 1;

  if not found then
    raise exception 'Active manager account not found';
  end if;

  resolved_name := coalesce(
    nullif(trim(coalesce(p_manager_name, '')), ''),
    nullif(trim(coalesce(manager_row.name, '')), ''),
    '본부장'
  );
  resolved_affiliation := public.resolve_manager_referral_affiliation(normalized_phone, resolved_name);

  select *
    into existing_profile
  from public.fc_profiles
  where phone = normalized_phone
  limit 1
  for update;

  if found then
    if existing_profile.is_manager_referral_shadow = true then
      update public.fc_profiles
      set name = resolved_name,
          affiliation = resolved_affiliation,
          is_manager_referral_shadow = true
      where id = existing_profile.id
      returning *
      into existing_profile;

      return existing_profile.id;
    end if;

    if existing_profile.signup_completed = true
       and not public.is_request_board_designer_affiliation(existing_profile.affiliation) then
      return existing_profile.id;
    end if;

    raise exception 'Manager referral profile conflict';
  end if;

  insert into public.fc_profiles (
    name,
    affiliation,
    phone,
    status,
    signup_completed,
    phone_verified,
    identity_completed,
    is_manager_referral_shadow
  )
  values (
    resolved_name,
    resolved_affiliation,
    normalized_phone,
    'draft',
    false,
    false,
    false,
    true
  )
  returning *
  into existing_profile;

  return existing_profile.id;
end;
$$;

revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from public;
revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from anon;
revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from authenticated;
grant execute on function public.ensure_manager_referral_shadow_profile(text, text) to service_role;

comment on function public.ensure_manager_referral_shadow_profile(text, text)
  is 'Create or refresh the referral-only fc_profiles shadow row for an active manager_accounts identity. Execute grant is service_role only.';

create or replace function public.admin_issue_referral_code(
  p_fc_id uuid,
  p_actor_phone text,
  p_actor_role text,
  p_actor_staff_type text,
  p_reason text default null,
  p_rotate boolean default false
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  target_fc public.fc_profiles%rowtype;
  active_code public.referral_codes%rowtype;
  inserted_code public.referral_codes%rowtype;
  candidate_code text;
  attempts integer := 0;
  event_type text := 'code_generated';
  target_is_active_manager boolean := false;
  actor_role text := nullif(trim(coalesce(p_actor_role, '')), '');
  actor_staff_type text := nullif(trim(coalesce(p_actor_staff_type, '')), '');
  actor_phone text := nullif(regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g'), '');
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_fc_id is null then
    raise exception 'fc_id is required';
  end if;

  select *
    into target_fc
  from public.fc_profiles
  where id = p_fc_id
  for update;

  if not found then
    raise exception 'FC profile not found';
  end if;

  select exists (
    select 1
    from public.manager_accounts ma
    where ma.phone = target_fc.phone
      and ma.active = true
  )
    into target_is_active_manager;

  if target_fc.signup_completed is distinct from true
     and not (target_fc.is_manager_referral_shadow = true and target_is_active_manager) then
    raise exception 'Referral code can only be issued to completed FC profiles or active manager referral profiles';
  end if;

  if coalesce(target_fc.phone, '') !~ '^[0-9]{11}$' then
    raise exception 'Referral code requires normalized 11-digit FC phone';
  end if;

  if exists (
    select 1
    from public.admin_accounts aa
    where aa.phone = target_fc.phone
  ) then
    raise exception 'Admin accounts cannot receive referral codes';
  end if;

  if public.is_request_board_designer_affiliation(target_fc.affiliation) then
    raise exception 'Request-board linked designer profiles cannot receive referral codes';
  end if;

  select *
    into active_code
  from public.referral_codes
  where fc_id = p_fc_id
    and is_active = true
  order by created_at desc
  limit 1
  for update;

  if found and not p_rotate then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'action', 'noop_active_exists',
      'fcId', p_fc_id,
      'previousCodeId', active_code.id,
      'previousCode', active_code.code,
      'codeId', active_code.id,
      'code', active_code.code,
      'eventType', null
    );
  end if;

  if found then
    update public.referral_codes
    set is_active = false,
        disabled_at = now()
    where id = active_code.id;

    event_type := 'code_rotated';
  end if;

  loop
    attempts := attempts + 1;
    if attempts > 10 then
      raise exception 'Failed to generate unique referral code after 10 attempts';
    end if;

    candidate_code := public.generate_referral_code_candidate();

    begin
      insert into public.referral_codes (
        fc_id,
        code,
        is_active,
        disabled_at
      )
      values (
        p_fc_id,
        candidate_code,
        true,
        null
      )
      returning *
      into inserted_code;

      exit;
    exception
      when unique_violation then
        select *
          into active_code
        from public.referral_codes
        where fc_id = p_fc_id
          and is_active = true
        order by created_at desc
        limit 1
        for update;

        if found then
          return jsonb_build_object(
            'ok', true,
            'changed', false,
            'action', 'noop_active_exists',
            'fcId', p_fc_id,
            'previousCodeId', active_code.id,
            'previousCode', active_code.code,
            'codeId', active_code.id,
            'code', active_code.code,
            'eventType', null
          );
        end if;

        candidate_code := null;
    end;
  end loop;

  insert into public.referral_events (
    referral_code_id,
    referral_code,
    inviter_fc_id,
    inviter_phone,
    inviter_name,
    event_type,
    metadata
  )
  values (
    inserted_code.id,
    inserted_code.code,
    target_fc.id,
    target_fc.phone,
    nullif(trim(coalesce(target_fc.name, '')), ''),
    event_type,
    jsonb_strip_nulls(
      jsonb_build_object(
        'actorPhone', actor_phone,
        'actorRole', actor_role,
        'actorStaffType', actor_staff_type,
        'reason', reason,
        'previousCode', active_code.code,
        'previousCodeId', active_code.id,
        'nextCode', inserted_code.code,
        'nextCodeId', inserted_code.id
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'action', case when event_type = 'code_rotated' then 'rotated' else 'generated' end,
    'fcId', p_fc_id,
    'previousCodeId', active_code.id,
    'previousCode', active_code.code,
    'codeId', inserted_code.id,
    'code', inserted_code.code,
    'eventType', event_type
  );
end;
$$;

create or replace function public.admin_backfill_referral_codes(
  p_limit integer default 100,
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default 'initial_backfill'
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  candidate_fc_ids uuid[] := array[]::uuid[];
  candidate_fc_id uuid;
  issue_result jsonb;
  processed integer := 0;
  created integer := 0;
  skipped integer := 0;
  remaining integer := 0;
  normalized_reason text := coalesce(
    nullif(trim(coalesce(p_reason, '')), ''),
    'initial_backfill'
  );
begin
  select coalesce(array_agg(candidate.id), array[]::uuid[])
    into candidate_fc_ids
  from (
    select fp.id
    from public.fc_profiles fp
    where coalesce(fp.phone, '') ~ '^[0-9]{11}$'
      and not public.is_request_board_designer_affiliation(fp.affiliation)
      and not exists (
        select 1
        from public.admin_accounts aa
        where aa.phone = fp.phone
      )
      and (
        fp.signup_completed = true
        or (
          fp.is_manager_referral_shadow = true
          and exists (
            select 1
            from public.manager_accounts ma
            where ma.phone = fp.phone
              and ma.active = true
          )
        )
      )
      and not exists (
        select 1
        from public.referral_codes rc
        where rc.fc_id = fp.id
          and rc.is_active = true
      )
    order by fp.created_at asc, fp.id asc
    limit safe_limit
    for update of fp skip locked
  ) candidate;

  foreach candidate_fc_id in array candidate_fc_ids loop
    processed := processed + 1;

    begin
      issue_result := public.admin_issue_referral_code(
        candidate_fc_id,
        p_actor_phone,
        p_actor_role,
        p_actor_staff_type,
        normalized_reason,
        false
      );

      if coalesce((issue_result ->> 'changed')::boolean, false) then
        created := created + 1;
      else
        skipped := skipped + 1;
      end if;
    exception
      when others then
        skipped := skipped + 1;
    end;
  end loop;

  select count(*)
    into remaining
  from public.fc_profiles fp
  where coalesce(fp.phone, '') ~ '^[0-9]{11}$'
    and not public.is_request_board_designer_affiliation(fp.affiliation)
    and not exists (
      select 1
      from public.admin_accounts aa
      where aa.phone = fp.phone
    )
    and (
      fp.signup_completed = true
      or (
        fp.is_manager_referral_shadow = true
        and exists (
          select 1
          from public.manager_accounts ma
          where ma.phone = fp.phone
            and ma.active = true
        )
      )
    )
    and not exists (
      select 1
      from public.referral_codes rc
      where rc.fc_id = fp.id
        and rc.is_active = true
    );

  return jsonb_build_object(
    'ok', true,
    'processed', processed,
    'created', created,
    'skipped', skipped,
    'remaining', remaining,
    'limit', safe_limit
  );
end;
$$;

create or replace function public.admin_disable_referral_code(
  p_fc_id uuid,
  p_actor_phone text,
  p_actor_role text,
  p_actor_staff_type text,
  p_reason text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  target_fc public.fc_profiles%rowtype;
  active_code public.referral_codes%rowtype;
  actor_role text := nullif(trim(coalesce(p_actor_role, '')), '');
  actor_staff_type text := nullif(trim(coalesce(p_actor_staff_type, '')), '');
  actor_phone text := nullif(regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g'), '');
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_fc_id is null then
    raise exception 'fc_id is required';
  end if;

  select *
    into target_fc
  from public.fc_profiles
  where id = p_fc_id
  for update;

  if not found then
    raise exception 'FC profile not found';
  end if;

  select *
    into active_code
  from public.referral_codes
  where fc_id = p_fc_id
    and is_active = true
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Active referral code not found';
  end if;

  update public.referral_codes
  set is_active = false,
      disabled_at = now()
  where id = active_code.id;

  insert into public.referral_events (
    referral_code_id,
    referral_code,
    inviter_fc_id,
    inviter_phone,
    inviter_name,
    event_type,
    metadata
  )
  values (
    active_code.id,
    active_code.code,
    target_fc.id,
    target_fc.phone,
    nullif(trim(coalesce(target_fc.name, '')), ''),
    'code_disabled',
    jsonb_strip_nulls(
      jsonb_build_object(
        'actorPhone', actor_phone,
        'actorRole', actor_role,
        'actorStaffType', actor_staff_type,
        'reason', reason,
        'previousCode', active_code.code,
        'previousCodeId', active_code.id,
        'nextCode', null,
        'nextCodeId', null
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'action', 'disabled',
    'fcId', p_fc_id,
    'previousCodeId', active_code.id,
    'previousCode', active_code.code,
    'codeId', null,
    'code', null,
    'eventType', 'code_disabled'
  );
end;
$$;

create or replace function public.admin_apply_recommender_override(
  p_invitee_fc_id uuid,
  p_inviter_fc_id uuid default null,
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  invitee_fc public.fc_profiles%rowtype;
  inviter_fc public.fc_profiles%rowtype;
  inviter_active_code public.referral_codes%rowtype;
  primary_confirmed public.referral_attributions%rowtype;
  confirmed_ids uuid[] := array[]::uuid[];
  secondary_confirmed_ids uuid[] := array[]::uuid[];
  actor_role text := nullif(trim(coalesce(p_actor_role, '')), '');
  actor_staff_type text := nullif(trim(coalesce(p_actor_staff_type, '')), '');
  actor_phone text := nullif(regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g'), '');
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  normalized_invitee_phone text;
  normalized_inviter_phone text := null;
  next_recommender_name text := null;
  attribution_id uuid := null;
  changed boolean := false;
  now_ts timestamptz := now();
begin
  if p_invitee_fc_id is null then
    raise exception '추천인 대상 FC를 찾을 수 없습니다.';
  end if;
  if reason is null then
    raise exception '추천인 변경 사유를 입력해주세요.';
  end if;
  if p_inviter_fc_id is not null and p_inviter_fc_id = p_invitee_fc_id then
    raise exception '자기 자신을 추천인으로 지정할 수 없습니다.';
  end if;

  select *
    into invitee_fc
  from public.fc_profiles
  where id = p_invitee_fc_id
  for update;

  if not found then
    raise exception '추천인 대상 FC를 찾을 수 없습니다.';
  end if;

  normalized_invitee_phone := regexp_replace(coalesce(invitee_fc.phone, ''), '[^0-9]', '', 'g');
  if normalized_invitee_phone !~ '^[0-9]{11}$' then
    raise exception '추천 관계 대상 FC 전화번호가 올바르지 않습니다.';
  end if;

  if p_inviter_fc_id is not null then
    select *
      into inviter_fc
    from public.fc_profiles
    where id = p_inviter_fc_id
    for update;

    if not found then
      raise exception '추천인 후보 FC를 찾을 수 없습니다.';
    end if;

    normalized_inviter_phone := regexp_replace(coalesce(inviter_fc.phone, ''), '[^0-9]', '', 'g');
    if normalized_inviter_phone !~ '^[0-9]{11}$' then
      raise exception '추천인 후보 FC 전화번호가 올바르지 않습니다.';
    end if;

    select *
      into inviter_active_code
    from public.referral_codes
    where fc_id = p_inviter_fc_id
      and is_active = true
    order by created_at desc
    limit 1
    for update;

    if not found then
      raise exception '활성 추천코드가 있는 FC만 추천인으로 선택할 수 있습니다.';
    end if;

    next_recommender_name := nullif(trim(coalesce(inviter_fc.name, '')), '');
  end if;

  select coalesce(array_agg(ra.id order by coalesce(ra.confirmed_at, ra.created_at) desc, ra.created_at desc), array[]::uuid[])
    into confirmed_ids
  from public.referral_attributions ra
  where ra.invitee_fc_id = p_invitee_fc_id
    and ra.status = 'confirmed';

  if coalesce(array_length(confirmed_ids, 1), 0) > 0 then
    select *
      into primary_confirmed
    from public.referral_attributions
    where id = confirmed_ids[1]
    for update;

    if coalesce(array_length(confirmed_ids, 1), 0) > 1 then
      secondary_confirmed_ids := confirmed_ids[2:array_length(confirmed_ids, 1)];
    end if;
  end if;

  changed :=
    invitee_fc.recommender_fc_id is distinct from p_inviter_fc_id
    or nullif(trim(coalesce(invitee_fc.recommender, '')), '') is distinct from next_recommender_name
    or (
      p_inviter_fc_id is not null
      and (
        primary_confirmed.id is null
        or primary_confirmed.inviter_fc_id is distinct from p_inviter_fc_id
        or primary_confirmed.referral_code_id is distinct from inviter_active_code.id
      )
    )
    or (
      p_inviter_fc_id is null
      and coalesce(array_length(confirmed_ids, 1), 0) > 0
    );

  if not changed then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'inviteeFcId', p_invitee_fc_id,
      'inviterFcId', p_inviter_fc_id,
      'recommenderName', next_recommender_name,
      'referralCode', case when p_inviter_fc_id is not null then inviter_active_code.code else null end
    );
  end if;

  if p_inviter_fc_id is not null then
    if primary_confirmed.id is not null then
      update public.referral_attributions
      set inviter_fc_id = p_inviter_fc_id,
          inviter_phone = normalized_inviter_phone,
          inviter_name = inviter_fc.name,
          invitee_fc_id = p_invitee_fc_id,
          invitee_phone = normalized_invitee_phone,
          referral_code_id = inviter_active_code.id,
          referral_code = inviter_active_code.code,
          source = 'admin_override',
          capture_source = 'manual_entry',
          selection_source = 'admin_override',
          status = 'confirmed',
          cancelled_at = null,
          confirmed_at = now_ts
      where id = primary_confirmed.id
      returning id into attribution_id;
    else
      insert into public.referral_attributions (
        inviter_fc_id,
        inviter_phone,
        inviter_name,
        invitee_fc_id,
        invitee_phone,
        referral_code_id,
        referral_code,
        source,
        capture_source,
        selection_source,
        status,
        captured_at,
        confirmed_at
      )
      values (
        p_inviter_fc_id,
        normalized_inviter_phone,
        inviter_fc.name,
        p_invitee_fc_id,
        normalized_invitee_phone,
        inviter_active_code.id,
        inviter_active_code.code,
        'admin_override',
        'manual_entry',
        'admin_override',
        'confirmed',
        now_ts,
        now_ts
      )
      returning id into attribution_id;
    end if;

    if coalesce(array_length(secondary_confirmed_ids, 1), 0) > 0 then
      update public.referral_attributions
      set status = 'overridden',
          source = 'admin_override',
          selection_source = 'admin_override',
          cancelled_at = now_ts
      where id = any(secondary_confirmed_ids);
    end if;
  elsif coalesce(array_length(confirmed_ids, 1), 0) > 0 then
    update public.referral_attributions
    set status = 'overridden',
        source = 'admin_override',
        selection_source = 'admin_override',
        cancelled_at = now_ts
    where id = any(confirmed_ids);
  end if;

  update public.fc_profiles
  set recommender_fc_id = p_inviter_fc_id,
      recommender = next_recommender_name
  where id = p_invitee_fc_id;

  insert into public.referral_events (
    attribution_id,
    referral_code_id,
    referral_code,
    inviter_fc_id,
    inviter_phone,
    inviter_name,
    invitee_fc_id,
    invitee_phone,
    event_type,
    source,
    metadata
  )
  values (
    attribution_id,
    case when p_inviter_fc_id is not null then inviter_active_code.id else null end,
    case when p_inviter_fc_id is not null then inviter_active_code.code else null end,
    p_inviter_fc_id,
    normalized_inviter_phone,
    case when p_inviter_fc_id is not null then inviter_fc.name else null end,
    p_invitee_fc_id,
    normalized_invitee_phone,
    'admin_override_applied',
    'admin_override',
    jsonb_strip_nulls(
      jsonb_build_object(
        'actorPhone', actor_phone,
        'actorRole', actor_role,
        'actorStaffType', actor_staff_type,
        'reason', reason,
        'beforeRecommenderName', nullif(trim(coalesce(invitee_fc.recommender, '')), ''),
        'beforeRecommenderFcId', invitee_fc.recommender_fc_id,
        'beforeConfirmedAttributionIds', to_jsonb(confirmed_ids),
        'afterRecommenderName', next_recommender_name,
        'afterRecommenderFcId', p_inviter_fc_id,
        'afterReferralCode', case when p_inviter_fc_id is not null then inviter_active_code.code else null end,
        'cleared', p_inviter_fc_id is null
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'inviteeFcId', p_invitee_fc_id,
    'inviterFcId', p_inviter_fc_id,
    'recommenderName', next_recommender_name,
    'referralCode', case when p_inviter_fc_id is not null then inviter_active_code.code else null end
  );
end;
$$;

drop policy if exists "profiles select" on public.profiles;
create policy "profiles select"
  on public.profiles
  for select
  using (public.is_admin() or id = auth.uid());

drop policy if exists "profiles insert" on public.profiles;
create policy "profiles insert"
  on public.profiles
  for insert
  with check (public.is_admin() or id = auth.uid());

drop policy if exists "profiles update" on public.profiles;
create policy "profiles update"
  on public.profiles
  for update
  using (public.is_admin() or id = auth.uid())
  with check (public.is_admin() or id = auth.uid());

drop policy if exists "profiles delete" on public.profiles;
create policy "profiles delete"
  on public.profiles
  for delete
  using (public.is_admin());

drop policy if exists "fc_profiles select" on public.fc_profiles;
create policy "fc_profiles select"
  on public.fc_profiles
  for select
  using (
    auth.role() = 'anon'
    or public.is_admin()
    or public.is_manager()
    or (public.is_fc() and id = public.current_fc_id())
  );

drop policy if exists "fc_profiles insert" on public.fc_profiles;
create policy "fc_profiles insert"
  on public.fc_profiles
  for insert
  with check (public.is_admin() or public.is_fc());

drop policy if exists "fc_profiles update" on public.fc_profiles;
create policy "fc_profiles update"
  on public.fc_profiles
  for update
  using (public.is_admin() or (public.is_fc() and id = public.current_fc_id()))
  with check (public.is_admin() or (public.is_fc() and id = public.current_fc_id()));

drop policy if exists "fc_documents select" on public.fc_documents;
create policy "fc_documents select"
  on public.fc_documents
  for select
  using (
    public.is_admin()
    or public.is_manager()
    or (public.is_fc() and fc_id = public.current_fc_id())
  );

drop policy if exists "fc_documents insert" on public.fc_documents;
create policy "fc_documents insert"
  on public.fc_documents
  for insert
  with check (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "fc_documents anon insert" on public.fc_documents;
create policy "fc_documents anon insert"
  on public.fc_documents
  for insert
  with check (auth.role() = 'anon');

drop policy if exists "fc_documents update" on public.fc_documents;
create policy "fc_documents update"
  on public.fc_documents
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "notifications select" on public.notifications;
create policy "notifications select"
  on public.notifications
  for select
  using (
    public.is_admin()
    or public.is_manager()
    or public.is_fc()
  );

drop policy if exists "notifications insert" on public.notifications;
create policy "notifications insert"
  on public.notifications
  for insert
  with check (public.is_admin());

drop policy if exists "device_tokens select policy" on public.device_tokens;
create policy "device_tokens select policy"
  on public.device_tokens
  for select
  using (auth.role() in ('anon', 'authenticated'));

drop policy if exists "device_tokens insert policy" on public.device_tokens;
create policy "device_tokens insert policy"
  on public.device_tokens
  for insert
  with check (auth.role() in ('anon', 'authenticated'));

drop policy if exists "device_tokens update policy" on public.device_tokens;
create policy "device_tokens update policy"
  on public.device_tokens
  for update
  using (auth.role() in ('anon', 'authenticated'))
  with check (auth.role() in ('anon', 'authenticated'));

drop policy if exists "device_tokens delete policy" on public.device_tokens;
create policy "device_tokens delete policy"
  on public.device_tokens
  for delete
  using (auth.role() in ('anon', 'authenticated'));

drop policy if exists "web_push_subscriptions select" on public.web_push_subscriptions;
create policy "web_push_subscriptions select"
  on public.web_push_subscriptions
  for select
  using (
    public.is_admin()
    or public.is_manager()
    or public.is_fc()
  );

drop policy if exists "web_push_subscriptions insert" on public.web_push_subscriptions;
create policy "web_push_subscriptions insert"
  on public.web_push_subscriptions
  for insert
  with check (public.is_admin() or public.is_fc());

drop policy if exists "web_push_subscriptions update" on public.web_push_subscriptions;
create policy "web_push_subscriptions update"
  on public.web_push_subscriptions
  for update
  using (public.is_admin() or public.is_fc())
  with check (public.is_admin() or public.is_fc());

drop policy if exists "web_push_subscriptions delete" on public.web_push_subscriptions;
create policy "web_push_subscriptions delete"
  on public.web_push_subscriptions
  for delete
  using (public.is_admin() or public.is_fc());

drop policy if exists "notices select" on public.notices;
create policy "notices select"
  on public.notices
  for select
  using (
    public.is_admin()
    or public.is_manager()
    or public.is_fc()
  );

drop policy if exists "notices insert" on public.notices;
create policy "notices insert"
  on public.notices
  for insert
  with check (public.is_admin());

drop policy if exists "exam_rounds select" on public.exam_rounds;
create policy "exam_rounds select"
  on public.exam_rounds
  for select
  using (
    auth.role() = 'anon'
    or public.is_admin()
    or public.is_manager()
    or public.is_fc()
  );

drop policy if exists "exam_rounds insert" on public.exam_rounds;
create policy "exam_rounds insert"
  on public.exam_rounds
  for insert
  with check (public.is_admin());

drop policy if exists "exam_rounds anon insert" on public.exam_rounds;
create policy "exam_rounds anon insert"
  on public.exam_rounds
  for insert
  with check (auth.role() = 'anon');

drop policy if exists "exam_rounds update" on public.exam_rounds;
create policy "exam_rounds update"
  on public.exam_rounds
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "exam_rounds delete" on public.exam_rounds;
create policy "exam_rounds delete"
  on public.exam_rounds
  for delete
  using (public.is_admin());

drop policy if exists "exam_locations select" on public.exam_locations;
create policy "exam_locations select"
  on public.exam_locations
  for select
  using (
    auth.role() = 'anon'
    or public.is_admin()
    or public.is_manager()
    or public.is_fc()
  );

drop policy if exists "exam_locations insert" on public.exam_locations;
create policy "exam_locations insert"
  on public.exam_locations
  for insert
  with check (public.is_admin());

drop policy if exists "exam_locations anon insert" on public.exam_locations;
create policy "exam_locations anon insert"
  on public.exam_locations
  for insert
  with check (auth.role() = 'anon');

drop policy if exists "exam_locations update" on public.exam_locations;
create policy "exam_locations update"
  on public.exam_locations
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "exam_locations delete" on public.exam_locations;
create policy "exam_locations delete"
  on public.exam_locations
  for delete
  using (public.is_admin());

drop policy if exists "fc_credentials select" on public.fc_credentials;
create policy "fc_credentials select"
  on public.fc_credentials
  for select
  using (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "fc_credentials insert" on public.fc_credentials;
create policy "fc_credentials insert"
  on public.fc_credentials
  for insert
  with check (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "fc_credentials update" on public.fc_credentials;
create policy "fc_credentials update"
  on public.fc_credentials
  for update
  using (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()))
  with check (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "fc_credentials delete" on public.fc_credentials;
create policy "fc_credentials delete"
  on public.fc_credentials
  for delete
  using (public.is_admin());

drop policy if exists "fc_identity_secure select" on public.fc_identity_secure;
create policy "fc_identity_secure select"
  on public.fc_identity_secure
  for select
  using (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "fc_identity_secure insert" on public.fc_identity_secure;
create policy "fc_identity_secure insert"
  on public.fc_identity_secure
  for insert
  with check (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "fc_identity_secure update" on public.fc_identity_secure;
create policy "fc_identity_secure update"
  on public.fc_identity_secure
  for update
  using (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()))
  with check (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "fc_identity_secure delete" on public.fc_identity_secure;
create policy "fc_identity_secure delete"
  on public.fc_identity_secure
  for delete
  using (public.is_admin());

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

drop policy if exists "admin_accounts select" on public.admin_accounts;
create policy "admin_accounts select"
  on public.admin_accounts
  for select
  using (public.is_admin());

drop policy if exists "admin_accounts insert" on public.admin_accounts;
create policy "admin_accounts insert"
  on public.admin_accounts
  for insert
  with check (public.is_admin());

drop policy if exists "admin_accounts update" on public.admin_accounts;
create policy "admin_accounts update"
  on public.admin_accounts
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin_accounts delete" on public.admin_accounts;
create policy "admin_accounts delete"
  on public.admin_accounts
  for delete
  using (public.is_admin());

drop policy if exists "affiliation_manager_mappings select" on public.affiliation_manager_mappings;
create policy "affiliation_manager_mappings select"
  on public.affiliation_manager_mappings
  for select
  using (public.is_admin() or public.is_manager());

drop policy if exists "affiliation_manager_mappings insert" on public.affiliation_manager_mappings;
create policy "affiliation_manager_mappings insert"
  on public.affiliation_manager_mappings
  for insert
  with check (public.is_admin());

drop policy if exists "affiliation_manager_mappings update" on public.affiliation_manager_mappings;
create policy "affiliation_manager_mappings update"
  on public.affiliation_manager_mappings
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "affiliation_manager_mappings delete" on public.affiliation_manager_mappings;
create policy "affiliation_manager_mappings delete"
  on public.affiliation_manager_mappings
  for delete
  using (public.is_admin());

-- 스토리지 버킷
insert into storage.buckets (id, name, public) values ('fc-documents', 'fc-documents', false)
on conflict (id) do nothing;

-- 스토리지 RLS
drop policy if exists "fc-documents read" on storage.objects;
create policy "fc-documents read"
  on storage.objects for select
  using (
    bucket_id = 'fc-documents'
    and (public.is_admin() or public.is_manager() or public.is_fc())
  );

drop policy if exists "fc-documents write" on storage.objects;
create policy "fc-documents write"
  on storage.objects for insert
  with check (bucket_id = 'fc-documents' and (public.is_admin() or public.is_fc()));

drop policy if exists "fc-documents update" on storage.objects;
create policy "fc-documents update"
  on storage.objects for update
  using (bucket_id = 'fc-documents' and public.is_admin());

drop policy if exists "fc-documents delete" on storage.objects;
create policy "fc-documents delete"
  on storage.objects for delete
  using (bucket_id = 'fc-documents' and (public.is_admin() or public.is_fc()));
-- delete policy for fc_profiles

drop policy if exists "fc_profiles delete" on public.fc_profiles;
create policy "fc_profiles delete"
  on public.fc_profiles
  for delete
  using (public.is_admin());

alter table public.fc_profiles
  add column if not exists address_detail text;

alter table public.fc_profiles
  add column if not exists allowance_reject_reason text;

alter table public.fc_profiles
  add column if not exists hanwha_commission_date_sub date;

alter table public.fc_profiles
  add column if not exists hanwha_commission_date date;

alter table public.fc_profiles
  add column if not exists hanwha_commission_reject_reason text;

alter table public.fc_profiles
  add column if not exists hanwha_commission_pdf_path text;

alter table public.fc_profiles
  add column if not exists hanwha_commission_pdf_name text;

alter table public.fc_profiles
  add column if not exists appointment_schedule_life text;

alter table public.fc_profiles
  add column if not exists appointment_schedule_nonlife text;

alter table public.fc_profiles
  add column if not exists appointment_date_life date;

alter table public.fc_profiles
  add column if not exists appointment_date_nonlife date;

alter table public.fc_profiles
  add column if not exists appointment_date_life_sub date;

alter table public.fc_profiles
  add column if not exists appointment_date_nonlife_sub date;

alter table public.fc_profiles
  add column if not exists appointment_reject_reason_life text;

alter table public.fc_profiles
  add column if not exists appointment_reject_reason_nonlife text;

comment on column public.fc_profiles.hanwha_commission_date_sub is
  'Date the FC submitted Hanwha commission review materials.';

comment on column public.fc_profiles.hanwha_commission_date is
  'Date Hanwha commission review was approved.';

comment on column public.fc_profiles.hanwha_commission_reject_reason is
  'Latest rejection reason for Hanwha commission review.';

comment on column public.fc_profiles.hanwha_commission_pdf_path is
  'Storage path for the Hanwha commission PDF used to gate review/approval.';

comment on column public.fc_profiles.hanwha_commission_pdf_name is
  'Original file name for the Hanwha commission PDF used to gate review/approval.';

alter table public.fc_profiles
  drop column if exists resident_number;

alter table public.fc_profiles
  add column if not exists resident_id_hash text;

alter table public.fc_profiles
  add column if not exists identity_completed boolean default false;

alter table public.fc_profiles
  add column if not exists recommender_fc_id uuid references public.fc_profiles (id) on delete set null;

create index if not exists idx_fc_profiles_recommender_fc_id
  on public.fc_profiles (recommender_fc_id);

alter table public.fc_profiles
  add column if not exists appointment_url text;

alter table public.fc_profiles
  add column if not exists appointment_date date;

alter table public.fc_profiles
  add column if not exists docs_deadline_at date;

alter table public.fc_profiles
  add column if not exists docs_deadline_last_notified_at date;

alter table public.fc_profiles
  add column if not exists carrier text;

alter table public.fc_profiles
  add column if not exists phone_verified boolean default false;

alter table public.fc_profiles
  add column if not exists phone_verified_at timestamptz;

alter table public.fc_profiles
  add column if not exists phone_verification_hash text;

alter table public.fc_profiles
  add column if not exists phone_verification_expires_at timestamptz;

alter table public.fc_profiles
  add column if not exists phone_verification_sent_at timestamptz;
alter table public.fc_profiles
  add column if not exists phone_verification_attempts integer default 0;
alter table public.fc_profiles
  add column if not exists phone_verification_locked_until timestamptz;

alter table public.fc_credentials
  add column if not exists reset_sent_at timestamptz;


select id, exam_date, registration_deadline, round_label, created_at
from public.exam_rounds
order by created_at;

-- ============================
-- 시험 신청 테이블
-- ============================

create table if not exists public.exam_registrations (
  id uuid primary key default gen_random_uuid(),

  -- FC 식별용
  -- resident_id: 세션에서 사용하는 고유 식별자(현재는 전화번호/주민번호 마스킹 등 텍스트)
  resident_id text not null,

  -- 선택: fc_profiles와 연결 (있으면 join해서 더 많은 정보 조회 가능)
  fc_id uuid references public.fc_profiles (id) on delete set null,

  -- 시험 회차 / 응시 지역
  round_id uuid not null references public.exam_rounds (id) on delete cascade,
  location_id uuid not null references public.exam_locations (id) on delete cascade,
  constraint exam_registrations_location_round_fkey
    foreign key (location_id, round_id)
    references public.exam_locations (id, round_id)
    on delete cascade,

  -- 신청 상태
  status text not null default 'applied'
    check (
      status in (
        'applied',          -- FC가 신청 완료
        'cancelled_by_fc',  -- FC가 직접 취소
        'cancelled_by_admin', -- 관리자 취소
        'confirmed',        -- 시험 응시 확정(예: 수험표 발급 등)
        'completed',        -- 시험 완료
        'no_show'           -- 미응시
      )
    ),

  -- 메모 필드(선택)
  memo text,        -- FC가 남긴 요청사항 등
  admin_memo text,  -- 관리자가 남기는 내부 메모

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 한 사람(resident_id)은 한 회차(round_id)에 한 번만 신청 가능하도록 제약
create unique index if not exists idx_exam_registrations_round_resident
  on public.exam_registrations (round_id, resident_id);

-- 조회 최적화용 인덱스
create index if not exists idx_exam_registrations_resident
  on public.exam_registrations (resident_id);

create index if not exists idx_exam_registrations_round
  on public.exam_registrations (round_id);

create index if not exists idx_exam_registrations_location
  on public.exam_registrations (location_id);

create index if not exists idx_exam_registrations_location_round
  on public.exam_registrations (location_id, round_id);

create index if not exists idx_exam_registrations_fc_id
  on public.exam_registrations (fc_id);

-- updated_at 자동 갱신 트리거 (기존 public.set_updated_at() 재사용)
drop trigger if exists trg_exam_registrations_updated_at on public.exam_registrations;
create trigger trg_exam_registrations_updated_at
before update on public.exam_registrations
for each row execute function public.set_updated_at();


-- ============================
-- exam_registrations RLS
-- ============================

alter table public.exam_registrations enable row level security;

drop policy if exists "exam_registrations select" on public.exam_registrations;
create policy "exam_registrations select"
  on public.exam_registrations
  for select
  using (
    auth.role() = 'anon'
    or public.is_admin()
    or public.is_manager()
    or (public.is_fc() and fc_id = public.current_fc_id())
  );

drop policy if exists "exam_registrations insert" on public.exam_registrations;
create policy "exam_registrations insert"
  on public.exam_registrations
  for insert
  with check (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "exam_registrations anon insert" on public.exam_registrations;
create policy "exam_registrations anon insert"
  on public.exam_registrations
  for insert
  with check (auth.role() = 'anon');

drop policy if exists "exam_registrations update" on public.exam_registrations;
create policy "exam_registrations update"
  on public.exam_registrations
  for update
  using (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()))
  with check (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "exam_registrations anon update" on public.exam_registrations;
create policy "exam_registrations anon update"
  on public.exam_registrations
  for update
  using (auth.role() = 'anon');

drop policy if exists "exam_registrations delete" on public.exam_registrations;
create policy "exam_registrations delete"
  on public.exam_registrations
  for delete
  using (public.is_admin());

drop policy if exists "exam_registrations anon delete" on public.exam_registrations;
create policy "exam_registrations anon delete"
  on public.exam_registrations
  for delete
  using (auth.role() = 'anon');

-- 1) exam_type 컬럼 추가 (life / nonlife)
alter table public.exam_rounds
  add column if not exists exam_type text
  check (exam_type in ('life', 'nonlife'))
  default 'life';

-- 2) NOT NULL 보장 (기존 row는 default 'life'가 들어감)
alter table public.exam_rounds
  alter column exam_type set not null;

-- 3) 조회용 인덱스
create index if not exists idx_exam_rounds_exam_type_exam_date
  on public.exam_rounds (exam_type, exam_date);

-- 손해보험 회차에 대해 exam_type 수동 정리
update public.exam_rounds
set exam_type = 'nonlife'
where round_label like '%손해보험%';

-- 2025-01-11: exam_date를 nullable로 변경 (미정 상태 지원)
alter table public.exam_rounds
  alter column exam_date drop not null;

alter table public.exam_registrations
  add column if not exists is_confirmed boolean default false;

alter table public.exam_registrations
  add column if not exists is_confirmed boolean default false;

-- 제3보험 응시 여부
alter table public.exam_registrations
  add column if not exists is_third_exam boolean default false;

-- 응시료 납입 일자
alter table public.exam_registrations
  add column if not exists fee_paid_date date;

-- ============================
-- 게시판 (Board) 테이블
-- ============================

create table if not exists public.board_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.board_categories(id),
  title text not null,
  content text not null,
  author_role text not null check (author_role in ('admin','manager')),
  author_resident_id text not null,
  author_name text not null,
  is_pinned boolean not null default false,
  pinned_at timestamptz,
  pinned_by_resident_id text,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.board_posts(id) on delete cascade,
  file_type text not null check (file_type in ('image','file')),
  file_name text not null,
  file_size bigint not null,
  mime_type text,
  storage_path text not null unique,
  created_by_resident_id text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.board_post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.board_posts(id) on delete cascade,
  resident_id text not null,
  role text not null check (role in ('admin','manager','fc')),
  reaction_type text not null check (reaction_type in ('like','heart','check','smile')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, resident_id)
);

create table if not exists public.board_post_views (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.board_posts(id) on delete cascade,
  resident_id text not null,
  role text not null check (role in ('admin','manager','fc')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.board_posts(id) on delete cascade,
  parent_id uuid references public.board_comments(id) on delete cascade,
  content text not null,
  author_role text not null check (author_role in ('admin','manager','fc')),
  author_resident_id text not null,
  author_name text not null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_comment_likes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.board_comments(id) on delete cascade,
  resident_id text not null,
  role text not null check (role in ('admin','manager','fc')),
  created_at timestamptz not null default now(),
  unique (comment_id, resident_id)
);

create index if not exists idx_board_posts_category_created
  on public.board_posts (category_id, created_at desc);

create index if not exists idx_board_posts_pinned
  on public.board_posts (is_pinned, pinned_at desc);

create index if not exists idx_board_attachments_post
  on public.board_attachments (post_id);

create index if not exists idx_board_attachments_post_sort
  on public.board_attachments (post_id, sort_order, created_at);

create index if not exists idx_board_post_reactions_post
  on public.board_post_reactions (post_id);

create index if not exists idx_board_post_views_post
  on public.board_post_views (post_id);

create index if not exists idx_board_post_views_resident
  on public.board_post_views (resident_id);

create index if not exists idx_board_comments_post_parent
  on public.board_comments (post_id, parent_id, created_at);

create index if not exists idx_board_comment_likes_comment
  on public.board_comment_likes (comment_id);

-- 검색용 tsvector (제목/본문/작성자)
alter table public.board_posts
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'') || ' ' || coalesce(author_name,''))
  ) stored;

create index if not exists idx_board_posts_search
  on public.board_posts using gin(search_vector);

-- updated_at 트리거
drop trigger if exists trg_board_categories_updated_at on public.board_categories;
create trigger trg_board_categories_updated_at
before update on public.board_categories
for each row execute function public.set_updated_at();

drop trigger if exists trg_board_posts_updated_at on public.board_posts;
create trigger trg_board_posts_updated_at
before update on public.board_posts
for each row execute function public.set_updated_at();

drop trigger if exists trg_board_post_reactions_updated_at on public.board_post_reactions;
create trigger trg_board_post_reactions_updated_at
before update on public.board_post_reactions
for each row execute function public.set_updated_at();

drop trigger if exists trg_board_post_views_updated_at on public.board_post_views;
create trigger trg_board_post_views_updated_at
before update on public.board_post_views
for each row execute function public.set_updated_at();

drop trigger if exists trg_board_comments_updated_at on public.board_comments;
create trigger trg_board_comments_updated_at
before update on public.board_comments
for each row execute function public.set_updated_at();

-- 게시판 기본 카테고리 시드
insert into public.board_categories (name, slug, sort_order)
values
  ('공지','notice',1),
  ('교육','education',2),
  ('일반','general',3),
  ('서류','documents',4)
on conflict (slug) do nothing;

-- RLS 활성화 (서비스 롤 전용 접근)
alter table public.board_categories enable row level security;
alter table public.board_posts enable row level security;
alter table public.board_attachments enable row level security;
alter table public.board_post_reactions enable row level security;
alter table public.board_post_views enable row level security;
alter table public.board_comments enable row level security;
alter table public.board_comment_likes enable row level security;

drop policy if exists "board_categories service_role" on public.board_categories;
create policy "board_categories service_role"
  on public.board_categories
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "board_posts service_role" on public.board_posts;
create policy "board_posts service_role"
  on public.board_posts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "board_attachments service_role" on public.board_attachments;
create policy "board_attachments service_role"
  on public.board_attachments
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "board_post_reactions service_role" on public.board_post_reactions;
create policy "board_post_reactions service_role"
  on public.board_post_reactions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "board_post_views service_role" on public.board_post_views;
create policy "board_post_views service_role"
  on public.board_post_views
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "board_comments service_role" on public.board_comments;
create policy "board_comments service_role"
  on public.board_comments
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "board_comment_likes service_role" on public.board_comment_likes;
create policy "board_comment_likes service_role"
  on public.board_comment_likes
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- 집계 뷰 (SQL View)
create or replace view public.board_post_stats
with (security_invoker = true) as
select
  p.id as post_id,
  count(distinct c.id) as comment_count,
  count(distinct r.id) as reaction_count,
  count(distinct a.id) as attachment_count,
  count(v.id) as view_count
from public.board_posts p
left join public.board_comments c on c.post_id = p.id
left join public.board_post_reactions r on r.post_id = p.id
left join public.board_attachments a on a.post_id = p.id
left join public.board_post_views v on v.post_id = p.id
group by p.id;

create or replace view public.board_comment_stats
with (security_invoker = true) as
select
  c.id as comment_id,
  count(distinct l.id) as like_count,
  count(distinct r.id) as reply_count
from public.board_comments c
left join public.board_comment_likes l on l.comment_id = c.id
left join public.board_comments r on r.parent_id = c.id
group by c.id;

create or replace view public.board_posts_with_stats
with (security_invoker = true) as
select
  p.*,
  coalesce(s.comment_count, 0) as comment_count,
  coalesce(s.reaction_count, 0) as reaction_count,
  coalesce(s.attachment_count, 0) as attachment_count,
  coalesce(s.view_count, 0) as view_count
from public.board_posts p
left join public.board_post_stats s on s.post_id = p.id;

create or replace view public.board_comments_with_stats
with (security_invoker = true) as
select
  c.*,
  coalesce(s.like_count, 0) as like_count,
  coalesce(s.reply_count, 0) as reply_count
from public.board_comments c
left join public.board_comment_stats s on s.comment_id = c.id;

-- 스토리지 버킷 (게시판 첨부)
insert into storage.buckets (id, name, public) values ('board-attachments', 'board-attachments', false)
on conflict (id) do nothing;

drop policy if exists "board-attachments read" on storage.objects;
create policy "board-attachments read"
  on storage.objects for select
  using (bucket_id = 'board-attachments' and auth.role() = 'service_role');

drop policy if exists "board-attachments write" on storage.objects;
create policy "board-attachments write"
  on storage.objects for insert
  with check (bucket_id = 'board-attachments' and auth.role() = 'service_role');

drop policy if exists "board-attachments update" on storage.objects;
create policy "board-attachments update"
  on storage.objects for update
  using (bucket_id = 'board-attachments' and auth.role() = 'service_role');

drop policy if exists "board-attachments delete" on storage.objects;
create policy "board-attachments delete"
  on storage.objects for delete
  using (bucket_id = 'board-attachments' and auth.role() = 'service_role');

-- 스토리지 버킷 (메신저 첨부)
insert into storage.buckets (id, name, public) values ('chat-uploads', 'chat-uploads', true)
on conflict (id) do nothing;

drop policy if exists "chat-uploads write" on storage.objects;
create policy "chat-uploads write"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-uploads'
    and (public.is_admin() or public.is_manager() or public.is_fc())
  );

drop policy if exists "chat-uploads delete" on storage.objects;
create policy "chat-uploads delete"
  on storage.objects for delete
  using (
    bucket_id = 'chat-uploads'
    and (public.is_admin() or public.is_manager() or public.is_fc())
  );

create table if not exists public.user_presence (
  phone text primary key,
  garam_in_at timestamptz,
  garam_link_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.user_presence is
  'Cross-platform user activity heartbeat snapshots keyed by phone number.';

comment on column public.user_presence.phone is
  'Shared phone identifier across garamin and garamlink.';

comment on column public.user_presence.garam_in_at is
  'Latest garamin app heartbeat timestamp.';

comment on column public.user_presence.garam_link_at is
  'Latest garamlink heartbeat timestamp.';

comment on column public.user_presence.updated_at is
  'Latest row mutation timestamp.';

alter table public.user_presence enable row level security;

drop policy if exists "user_presence service_role" on public.user_presence;
create policy "user_presence service_role"
  on public.user_presence
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.touch_user_presence(
  p_phone text,
  p_platform text
)
returns table (
  phone text,
  garam_in_at timestamptz,
  garam_link_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean,
  updated_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  touched_at timestamptz := now();
  row_data public.user_presence%rowtype;
begin
  if length(normalized_phone) <> 11 then
    raise exception 'invalid_phone';
  end if;

  if p_platform not in ('garam_in', 'garam_link') then
    raise exception 'invalid_platform';
  end if;

  insert into public.user_presence as up (
    phone,
    garam_in_at,
    garam_link_at,
    updated_at
  )
  values (
    normalized_phone,
    case when p_platform = 'garam_in' then touched_at else null end,
    case when p_platform = 'garam_link' then touched_at else null end,
    touched_at
  )
  on conflict (phone) do update
    set garam_in_at = case when p_platform = 'garam_in' then touched_at else up.garam_in_at end,
        garam_link_at = case when p_platform = 'garam_link' then touched_at else up.garam_link_at end,
        updated_at = touched_at
  returning up.* into row_data;

  return query
  select
    row_data.phone,
    row_data.garam_in_at,
    row_data.garam_link_at,
    greatest(row_data.garam_in_at, row_data.garam_link_at) as last_seen_at,
    coalesce(row_data.garam_in_at > (touched_at - interval '65 seconds'), false)
      or coalesce(row_data.garam_link_at > (touched_at - interval '65 seconds'), false) as is_online,
    row_data.updated_at;
end;
$$;

create or replace function public.stale_user_presence(
  p_phone text,
  p_platform text,
  p_expected_at timestamptz default null
)
returns table (
  phone text,
  garam_in_at timestamptz,
  garam_link_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean,
  updated_at timestamptz,
  applied boolean
)
language plpgsql
set search_path = public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  stale_at constant timestamptz := '1970-01-01 00:00:00+00'::timestamptz;
  changed_at timestamptz := now();
  row_data public.user_presence%rowtype;
  did_apply boolean := false;
begin
  if length(normalized_phone) <> 11 then
    raise exception 'invalid_phone';
  end if;

  if p_platform not in ('garam_in', 'garam_link') then
    raise exception 'invalid_platform';
  end if;

  update public.user_presence as up
     set garam_in_at = case when p_platform = 'garam_in' then stale_at else up.garam_in_at end,
         garam_link_at = case when p_platform = 'garam_link' then stale_at else up.garam_link_at end,
         updated_at = changed_at
   where up.phone = normalized_phone
     and (
       p_expected_at is null
       or (p_platform = 'garam_in' and up.garam_in_at = p_expected_at)
       or (p_platform = 'garam_link' and up.garam_link_at = p_expected_at)
     )
  returning up.* into row_data;

  if found then
    did_apply := true;
  else
    select *
      into row_data
      from public.user_presence
     where phone = normalized_phone;
  end if;

  if row_data.phone is null then
    return;
  end if;

  return query
  select
    row_data.phone,
    row_data.garam_in_at,
    row_data.garam_link_at,
    greatest(row_data.garam_in_at, row_data.garam_link_at) as last_seen_at,
    coalesce(row_data.garam_in_at > (changed_at - interval '65 seconds'), false)
      or coalesce(row_data.garam_link_at > (changed_at - interval '65 seconds'), false) as is_online,
    row_data.updated_at,
    did_apply;
end;
$$;

create or replace function public.get_user_presence(
  p_phones text[]
)
returns table (
  phone text,
  garam_in_at timestamptz,
  garam_link_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean,
  updated_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with normalized as (
    select distinct
      regexp_replace(coalesce(input_phone, ''), '[^0-9]', '', 'g') as phone
    from unnest(coalesce(p_phones, array[]::text[])) as input_phone
  )
  select
    normalized.phone,
    up.garam_in_at,
    up.garam_link_at,
    greatest(up.garam_in_at, up.garam_link_at) as last_seen_at,
    coalesce(up.garam_in_at > (now() - interval '65 seconds'), false)
      or coalesce(up.garam_link_at > (now() - interval '65 seconds'), false) as is_online,
    up.updated_at
  from normalized
  left join public.user_presence up
    on up.phone = normalized.phone
  where length(normalized.phone) = 11;
$$;

alter table public.fc_profiles
  add column if not exists recommender_code_id uuid;

alter table public.fc_profiles
  add column if not exists recommender_code text;

alter table public.fc_profiles
  add column if not exists recommender_linked_at timestamptz;

alter table public.fc_profiles
  add column if not exists recommender_link_source text;

alter table public.fc_profiles
  drop constraint if exists fc_profiles_recommender_link_source_check;

alter table public.fc_profiles
  drop constraint if exists fc_profiles_recommender_code_id_fkey;

alter table public.fc_profiles
  add constraint fc_profiles_recommender_code_id_fkey
  foreign key (recommender_code_id) references public.referral_codes (id) on delete set null;

alter table public.fc_profiles
  add constraint fc_profiles_recommender_link_source_check
  check (
    recommender_link_source is null
    or recommender_link_source in ('signup', 'self_service', 'admin_override', 'legacy_migration')
  );

create index if not exists idx_fc_profiles_recommender_code_id
  on public.fc_profiles (recommender_code_id);

alter table public.referral_events
  drop constraint if exists referral_events_event_type_check;

alter table public.referral_events
  add constraint referral_events_event_type_check
  check (
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
      'code_generated',
      'code_rotated',
      'code_disabled',
      'admin_override_applied',
      'referral_linked',
      'referral_changed',
      'referral_cleared'
    )
  );

alter table public.referral_events
  drop constraint if exists referral_events_source_check;

alter table public.referral_events
  add constraint referral_events_source_check
  check (
    source is null
    or source in (
      'auto_prefill',
      'manual_entry',
      'admin_override',
      'signup',
      'self_service',
      'legacy_migration'
    )
  );

create or replace function public.get_invitee_referral_code(p_fc_id uuid) returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when fp.recommender_fc_id is null then null
    else nullif(trim(coalesce(fp.recommender_code, '')), '')
  end
  from public.fc_profiles fp
  where fp.id = p_fc_id
  limit 1;
$$;

comment on function public.get_invitee_referral_code(uuid)
  is 'Trusted helper for admin-action to read the invitee-facing referral code from canonical fc_profiles snapshot state. Execute grant is service_role only.';

create or replace function public.get_referral_subtree(
  root_fc_id uuid,
  max_depth int default 2
) returns table (
  fc_id uuid,
  name text,
  affiliation text,
  active_code text,
  parent_fc_id uuid,
  node_depth int,
  relationship_source text,
  direct_invitee_count int,
  total_descendant_count int,
  is_ancestor boolean
)
language sql
security definer
set search_path = public
as $$
  with recursive
  params as (
    select greatest(1, least(coalesce(max_depth, 2), 5)) as safe_depth
  ),
  root_profile as (
    select
      fp.id,
      fp.name,
      fp.affiliation,
      fp.recommender_fc_id
    from public.fc_profiles fp
    where fp.id = root_fc_id
    limit 1
  ),
  active_codes as (
    select distinct on (rc.fc_id)
      rc.fc_id,
      rc.code
    from public.referral_codes rc
    where rc.is_active = true
    order by rc.fc_id, rc.created_at desc, rc.id desc
  ),
  ancestor_walk as (
    select
      parent.id as fc_id,
      parent.name,
      parent.affiliation,
      parent.recommender_fc_id as next_parent_fc_id,
      -1 as node_depth,
      array[root_fc_id, parent.id]::uuid[] as path
    from root_profile root
    join public.fc_profiles parent
      on parent.id = root.recommender_fc_id
    union all
    select
      parent.id as fc_id,
      parent.name,
      parent.affiliation,
      parent.recommender_fc_id as next_parent_fc_id,
      aw.node_depth - 1 as node_depth,
      aw.path || parent.id
    from ancestor_walk aw
    join public.fc_profiles parent
      on parent.id = aw.next_parent_fc_id
    where aw.node_depth > -10
      and parent.id <> all(aw.path)
  ),
  edge_sources as (
    select
      child.recommender_fc_id as parent_fc_id,
      child.id as child_fc_id,
      'linked'::text as relationship_source
    from public.fc_profiles child
    join public.fc_profiles parent
      on parent.id = child.recommender_fc_id
    where child.recommender_fc_id is not null
      and child.is_manager_referral_shadow is not true
      and (parent.is_manager_referral_shadow is not true or parent.id = root_fc_id)
      and child.id <> child.recommender_fc_id
  ),
  reachable_all as (
    select
      es.parent_fc_id,
      es.child_fc_id,
      1 as node_depth,
      array[root_fc_id, es.child_fc_id]::uuid[] as path
    from edge_sources es
    where es.parent_fc_id = root_fc_id
    union all
    select
      es.parent_fc_id,
      es.child_fc_id,
      ra.node_depth + 1 as node_depth,
      ra.path || es.child_fc_id
    from reachable_all ra
    join edge_sources es
      on es.parent_fc_id = ra.child_fc_id
    where ra.node_depth < 20
      and es.child_fc_id <> all(ra.path)
  ),
  reachable_nodes as (
    select distinct on (ra.child_fc_id)
      ra.child_fc_id as fc_id,
      ra.parent_fc_id,
      ra.node_depth
    from reachable_all ra
    order by ra.child_fc_id, ra.node_depth asc, ra.parent_fc_id
  ),
  subtree_nodes as (
    select root_fc_id as fc_id
    union
    select rn.fc_id
    from reachable_nodes rn
  ),
  direct_counts as (
    select
      es.parent_fc_id as fc_id,
      count(distinct es.child_fc_id)::int as direct_invitee_count
    from edge_sources es
    join subtree_nodes parent_node
      on parent_node.fc_id = es.parent_fc_id
    join subtree_nodes child_node
      on child_node.fc_id = es.child_fc_id
    group by es.parent_fc_id
  ),
  closure as (
    select
      es.parent_fc_id as ancestor_fc_id,
      es.child_fc_id as descendant_fc_id,
      array[es.parent_fc_id, es.child_fc_id]::uuid[] as path
    from edge_sources es
    join subtree_nodes parent_node
      on parent_node.fc_id = es.parent_fc_id
    join subtree_nodes child_node
      on child_node.fc_id = es.child_fc_id
    union all
    select
      cl.ancestor_fc_id,
      es.child_fc_id,
      cl.path || es.child_fc_id
    from closure cl
    join edge_sources es
      on es.parent_fc_id = cl.descendant_fc_id
    join subtree_nodes child_node
      on child_node.fc_id = es.child_fc_id
    where es.child_fc_id <> all(cl.path)
      and cardinality(cl.path) < 32
  ),
  total_counts as (
    select
      cl.ancestor_fc_id as fc_id,
      count(distinct cl.descendant_fc_id)::int as total_descendant_count
    from closure cl
    group by cl.ancestor_fc_id
  ),
  descendant_rows as (
    select
      child.id as fc_id,
      child.name,
      child.affiliation,
      ac.code as active_code,
      rn.parent_fc_id,
      rn.node_depth,
      'linked'::text as relationship_source,
      coalesce(dc.direct_invitee_count, 0) as direct_invitee_count,
      coalesce(tc.total_descendant_count, 0) as total_descendant_count,
      false as is_ancestor
    from reachable_nodes rn
    join params p
      on rn.node_depth <= p.safe_depth
    join public.fc_profiles child
      on child.id = rn.fc_id
    left join active_codes ac
      on ac.fc_id = child.id
    left join direct_counts dc
      on dc.fc_id = child.id
    left join total_counts tc
      on tc.fc_id = child.id
  ),
  ancestor_rows as (
    select
      aw.fc_id,
      aw.name,
      aw.affiliation,
      ac.code as active_code,
      null::uuid as parent_fc_id,
      aw.node_depth,
      'linked'::text as relationship_source,
      0::int as direct_invitee_count,
      0::int as total_descendant_count,
      true as is_ancestor
    from ancestor_walk aw
    left join active_codes ac
      on ac.fc_id = aw.fc_id
  ),
  root_row as (
    select
      root.id as fc_id,
      root.name,
      root.affiliation,
      ac.code as active_code,
      null::uuid as parent_fc_id,
      0 as node_depth,
      'root'::text as relationship_source,
      coalesce(dc.direct_invitee_count, 0) as direct_invitee_count,
      coalesce(tc.total_descendant_count, 0) as total_descendant_count,
      false as is_ancestor
    from root_profile root
    left join active_codes ac
      on ac.fc_id = root.id
    left join direct_counts dc
      on dc.fc_id = root.id
    left join total_counts tc
      on tc.fc_id = root.id
  )
  select * from root_row
  union all
  select * from ancestor_rows
  union all
  select * from descendant_rows;
$$;

create or replace function public.apply_referral_link_state(
  p_invitee_fc_id uuid,
  p_inviter_fc_id uuid default null,
  p_referral_code_id uuid default null,
  p_referral_code text default null,
  p_source text default 'self_service',
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invitee_fc public.fc_profiles%rowtype;
  inviter_fc public.fc_profiles%rowtype;
  selected_code public.referral_codes%rowtype;
  normalized_source text := nullif(trim(coalesce(p_source, '')), '');
  actor_role text := nullif(trim(coalesce(p_actor_role, '')), '');
  actor_staff_type text := nullif(trim(coalesce(p_actor_staff_type, '')), '');
  actor_phone text := nullif(regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g'), '');
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  normalized_invitee_phone text;
  normalized_inviter_phone text := null;
  next_recommender_name text := null;
  next_code_id uuid := null;
  next_code text := null;
  next_linked_at timestamptz := null;
  next_link_source text := null;
  event_type text := null;
  changed boolean := false;
  now_ts timestamptz := now();
begin
  if normalized_source is null or normalized_source not in ('signup', 'self_service', 'admin_override', 'legacy_migration') then
    raise exception '추천인 변경 source가 올바르지 않습니다.';
  end if;

  if p_invitee_fc_id is null then
    raise exception '추천인 대상 FC를 찾을 수 없습니다.';
  end if;

  if normalized_source = 'admin_override' and reason is null then
    raise exception '추천인 변경 사유를 입력해주세요.';
  end if;

  if p_inviter_fc_id is not null and p_inviter_fc_id = p_invitee_fc_id then
    raise exception '자기 자신을 추천인으로 지정할 수 없습니다.';
  end if;

  select *
    into invitee_fc
  from public.fc_profiles
  where id = p_invitee_fc_id
  for update;

  if not found then
    raise exception '추천인 대상 FC를 찾을 수 없습니다.';
  end if;

  normalized_invitee_phone := regexp_replace(coalesce(invitee_fc.phone, ''), '[^0-9]', '', 'g');
  if normalized_invitee_phone !~ '^[0-9]{11}$' then
    raise exception '추천 관계 대상 FC 전화번호가 올바르지 않습니다.';
  end if;

  if p_inviter_fc_id is not null then
    select *
      into inviter_fc
    from public.fc_profiles
    where id = p_inviter_fc_id
    for update;

    if not found then
      raise exception '추천인 후보 FC를 찾을 수 없습니다.';
    end if;

    normalized_inviter_phone := regexp_replace(coalesce(inviter_fc.phone, ''), '[^0-9]', '', 'g');
    if normalized_inviter_phone !~ '^[0-9]{11}$' then
      raise exception '추천인 후보 FC 전화번호가 올바르지 않습니다.';
    end if;

    if public.is_request_board_designer_affiliation(inviter_fc.affiliation) then
      raise exception '추천인으로 지정할 수 없는 FC입니다.';
    end if;

    if inviter_fc.signup_completed is not true and inviter_fc.is_manager_referral_shadow is not true then
      raise exception '추천인으로 지정할 수 없는 FC입니다.';
    end if;

    if exists (
      select 1
      from public.admin_accounts admin_row
      where admin_row.phone = normalized_inviter_phone
    ) then
      raise exception '추천인으로 지정할 수 없는 FC입니다.';
    end if;

    next_recommender_name := nullif(trim(coalesce(inviter_fc.name, '')), '');

    if p_referral_code_id is not null then
      select *
        into selected_code
      from public.referral_codes
      where id = p_referral_code_id
        and fc_id = p_inviter_fc_id
        and is_active = true
      limit 1
      for update;
    elsif nullif(trim(coalesce(p_referral_code, '')), '') is not null then
      select *
        into selected_code
      from public.referral_codes
      where fc_id = p_inviter_fc_id
        and code = upper(trim(p_referral_code))
        and is_active = true
      order by created_at desc, id desc
      limit 1
      for update;
    else
      select *
        into selected_code
      from public.referral_codes
      where fc_id = p_inviter_fc_id
        and is_active = true
      order by created_at desc, id desc
      limit 1
      for update;
    end if;

    if not found then
      raise exception '활성 추천코드가 있는 FC만 추천인으로 선택할 수 있습니다.';
    end if;

    next_code_id := selected_code.id;
    next_code := selected_code.code;
    next_linked_at := now_ts;
    next_link_source := normalized_source;

    if invitee_fc.recommender_fc_id is not distinct from p_inviter_fc_id
      and invitee_fc.recommender_code_id is not distinct from next_code_id
      and nullif(trim(coalesce(invitee_fc.recommender_code, '')), '') is not distinct from next_code then
      next_linked_at := coalesce(invitee_fc.recommender_linked_at, now_ts);
      next_link_source := coalesce(invitee_fc.recommender_link_source, normalized_source);
    end if;
  end if;

  changed :=
    invitee_fc.recommender_fc_id is distinct from p_inviter_fc_id
    or nullif(trim(coalesce(invitee_fc.recommender, '')), '') is distinct from next_recommender_name
    or invitee_fc.recommender_code_id is distinct from next_code_id
    or nullif(trim(coalesce(invitee_fc.recommender_code, '')), '') is distinct from next_code
    or invitee_fc.recommender_link_source is distinct from next_link_source
    or invitee_fc.recommender_linked_at is distinct from next_linked_at;

  if not changed then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'inviteeFcId', invitee_fc.id,
      'inviterFcId', invitee_fc.recommender_fc_id,
      'recommenderName', nullif(trim(coalesce(invitee_fc.recommender, '')), ''),
      'referralCodeId', invitee_fc.recommender_code_id,
      'referralCode', nullif(trim(coalesce(invitee_fc.recommender_code, '')), ''),
      'recommenderLinkSource', invitee_fc.recommender_link_source,
      'recommenderLinkedAt', invitee_fc.recommender_linked_at,
      'eventType', null
    );
  end if;

  if p_inviter_fc_id is null then
    event_type := 'referral_cleared';
  elsif invitee_fc.recommender_fc_id is null then
    event_type := 'referral_linked';
  else
    event_type := 'referral_changed';
  end if;

  update public.fc_profiles
  set recommender_fc_id = p_inviter_fc_id,
      recommender = next_recommender_name,
      recommender_code_id = next_code_id,
      recommender_code = next_code,
      recommender_linked_at = next_linked_at,
      recommender_link_source = next_link_source
  where id = p_invitee_fc_id;

  insert into public.referral_events (
    attribution_id,
    referral_code_id,
    referral_code,
    inviter_fc_id,
    inviter_phone,
    inviter_name,
    invitee_fc_id,
    invitee_phone,
    event_type,
    source,
    metadata
  )
  values (
    null,
    next_code_id,
    next_code,
    p_inviter_fc_id,
    normalized_inviter_phone,
    next_recommender_name,
    invitee_fc.id,
    normalized_invitee_phone,
    event_type,
    normalized_source,
    jsonb_strip_nulls(
      jsonb_build_object(
        'source', normalized_source,
        'reason', reason,
        'actorPhone', actor_phone,
        'actorRole', actor_role,
        'actorStaffType', actor_staff_type,
        'beforeRecommenderName', nullif(trim(coalesce(invitee_fc.recommender, '')), ''),
        'beforeRecommenderFcId', invitee_fc.recommender_fc_id,
        'beforeCodeId', invitee_fc.recommender_code_id,
        'beforeCode', nullif(trim(coalesce(invitee_fc.recommender_code, '')), ''),
        'beforeLinkedAt', invitee_fc.recommender_linked_at,
        'beforeLinkSource', invitee_fc.recommender_link_source,
        'afterRecommenderName', next_recommender_name,
        'afterRecommenderFcId', p_inviter_fc_id,
        'afterCodeId', next_code_id,
        'afterCode', next_code,
        'afterLinkedAt', next_linked_at,
        'afterLinkSource', next_link_source,
        'cleared', p_inviter_fc_id is null
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'inviteeFcId', invitee_fc.id,
    'inviterFcId', p_inviter_fc_id,
    'recommenderName', next_recommender_name,
    'referralCodeId', next_code_id,
    'referralCode', next_code,
    'recommenderLinkSource', next_link_source,
    'recommenderLinkedAt', next_linked_at,
    'eventType', event_type
  );
end;
$$;

create or replace function public.admin_apply_recommender_override(
  p_invitee_fc_id uuid,
  p_inviter_fc_id uuid default null,
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default null
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.apply_referral_link_state(
    p_invitee_fc_id => p_invitee_fc_id,
    p_inviter_fc_id => p_inviter_fc_id,
    p_referral_code_id => null,
    p_referral_code => null,
    p_source => 'admin_override',
    p_actor_phone => p_actor_phone,
    p_actor_role => p_actor_role,
    p_actor_staff_type => p_actor_staff_type,
    p_reason => p_reason
  );
$$;

with active_codes as (
  select distinct on (rc.fc_id)
    rc.fc_id,
    rc.id as referral_code_id,
    rc.code as referral_code
  from public.referral_codes rc
  where rc.is_active = true
  order by rc.fc_id, rc.created_at desc, rc.id desc
),
latest_confirmed as (
  select distinct on (ra.invitee_fc_id)
    ra.invitee_fc_id,
    ra.inviter_fc_id,
    nullif(trim(coalesce(ra.inviter_name, '')), '') as inviter_name,
    ra.referral_code_id,
    nullif(trim(coalesce(ra.referral_code, '')), '') as referral_code,
    case
      when ra.source = 'admin_override' then 'admin_override'
      else 'signup'
    end as link_source,
    coalesce(ra.confirmed_at, ra.created_at) as linked_at
  from public.referral_attributions ra
  where ra.status = 'confirmed'
    and ra.invitee_fc_id is not null
    and ra.inviter_fc_id is not null
  order by ra.invitee_fc_id, coalesce(ra.confirmed_at, ra.created_at) desc, ra.created_at desc, ra.id desc
),
eligible_profiles as (
  select
    fp.id,
    fp.name,
    fp.created_at,
    nullif(regexp_replace(trim(coalesce(fp.name, '')), '\s+', ' ', 'g'), '') as normalized_name
  from public.fc_profiles fp
  where (fp.signup_completed = true or fp.is_manager_referral_shadow = true)
    and regexp_replace(coalesce(fp.phone, ''), '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
    and public.is_request_board_designer_affiliation(fp.affiliation) is not true
),
legacy_candidates as (
  select
    invitee.id as invitee_fc_id,
    inviter.id as inviter_fc_id,
    nullif(trim(coalesce(inviter.name, '')), '') as inviter_name,
    active_codes.referral_code_id,
    active_codes.referral_code,
    count(*) over (partition by invitee.id) as candidate_count,
    row_number() over (partition by invitee.id order by inviter.created_at desc, inviter.id) as candidate_rank
  from public.fc_profiles invitee
  join eligible_profiles inviter
    on inviter.normalized_name = nullif(regexp_replace(trim(coalesce(invitee.recommender, '')), '\s+', ' ', 'g'), '')
   and inviter.id <> invitee.id
  join active_codes
    on active_codes.fc_id = inviter.id
  where invitee.recommender_fc_id is null
    and nullif(regexp_replace(trim(coalesce(invitee.recommender, '')), '\s+', ' ', 'g'), '') is not null
    and nullif(regexp_replace(trim(coalesce(invitee.recommender, '')), '\s+', ' ', 'g'), '') is distinct from nullif(regexp_replace(trim(coalesce(invitee.name, '')), '\s+', ' ', 'g'), '')
),
unique_legacy_matches as (
  select
    invitee_fc_id,
    inviter_fc_id,
    inviter_name,
    referral_code_id,
    referral_code
  from legacy_candidates
  where candidate_count = 1
    and candidate_rank = 1
),
resolved_state as (
  select
    fp.id as invitee_fc_id,
    coalesce(lc.inviter_fc_id, fp.recommender_fc_id, ulm.inviter_fc_id) as next_recommender_fc_id,
    case
      when lc.inviter_fc_id is not null then coalesce(lc.inviter_name, current_inviter.name)
      when fp.recommender_fc_id is not null then nullif(trim(coalesce(current_inviter.name, fp.recommender)), '')
      when ulm.inviter_fc_id is not null then ulm.inviter_name
      else null
    end as next_recommender_name,
    coalesce(lc.referral_code_id, current_code.referral_code_id, ulm.referral_code_id) as next_recommender_code_id,
    coalesce(lc.referral_code, current_code.referral_code, ulm.referral_code) as next_recommender_code,
    case
      when lc.inviter_fc_id is not null then lc.linked_at
      when fp.recommender_fc_id is not null then coalesce(fp.recommender_linked_at, fp.updated_at, fp.created_at, now())
      when ulm.inviter_fc_id is not null then coalesce(fp.recommender_linked_at, fp.updated_at, fp.created_at, now())
      else null
    end as next_recommender_linked_at,
    case
      when lc.inviter_fc_id is not null then lc.link_source
      when fp.recommender_fc_id is not null then coalesce(fp.recommender_link_source, 'legacy_migration')
      when ulm.inviter_fc_id is not null then 'legacy_migration'
      else null
    end as next_recommender_link_source
  from public.fc_profiles fp
  left join latest_confirmed lc
    on lc.invitee_fc_id = fp.id
  left join public.fc_profiles current_inviter
    on current_inviter.id = fp.recommender_fc_id
  left join active_codes current_code
    on current_code.fc_id = fp.recommender_fc_id
  left join unique_legacy_matches ulm
    on ulm.invitee_fc_id = fp.id
)
update public.fc_profiles fp
set recommender_fc_id = resolved_state.next_recommender_fc_id,
    recommender = case
      when resolved_state.next_recommender_fc_id is null then null
      else resolved_state.next_recommender_name
    end,
    recommender_code_id = resolved_state.next_recommender_code_id,
    recommender_code = resolved_state.next_recommender_code,
    recommender_linked_at = resolved_state.next_recommender_linked_at,
    recommender_link_source = resolved_state.next_recommender_link_source
from resolved_state
where fp.id = resolved_state.invitee_fc_id;

revoke all on function public.touch_user_presence(text, text) from public, anon, authenticated;
revoke all on function public.stale_user_presence(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_user_presence(text[]) from public, anon, authenticated;
revoke all on function public.generate_referral_code_candidate() from public, anon, authenticated;
revoke all on function public.is_request_board_designer_affiliation(text) from public, anon, authenticated;
revoke all on function public.admin_issue_referral_code(uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_disable_referral_code(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_backfill_referral_codes(integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_apply_recommender_override(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_invitee_referral_code(uuid) from public, anon, authenticated;
revoke all on function public.get_referral_subtree(uuid, int) from public, anon, authenticated;
revoke all on function public.apply_referral_link_state(uuid, uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.touch_user_presence(text, text) to service_role;
grant execute on function public.stale_user_presence(text, text, timestamptz) to service_role;
grant execute on function public.get_user_presence(text[]) to service_role;
grant execute on function public.generate_referral_code_candidate() to service_role;
grant execute on function public.get_invitee_referral_code(uuid) to service_role;
grant execute on function public.get_referral_subtree(uuid, int) to service_role;
grant execute on function public.is_request_board_designer_affiliation(text) to service_role;
grant execute on function public.admin_issue_referral_code(uuid, text, text, text, text, boolean) to service_role;
grant execute on function public.admin_disable_referral_code(uuid, text, text, text, text) to service_role;
grant execute on function public.admin_backfill_referral_codes(integer, text, text, text, text) to service_role;
grant execute on function public.admin_apply_recommender_override(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.apply_referral_link_state(uuid, uuid, uuid, text, text, text, text, text, text) to service_role;
