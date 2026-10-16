-- Supabase 스키마/정책 정의
-- Supabase SQL Editor나 supabase CLI로 실행하세요.
-- governance sync marker: 2026-03-28 (migration 20260328000001_add_hanwha_commission_contract.sql)


create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm with schema extensions;

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
  dawichok_url_sent_at timestamptz,
  dawichok_url_sent_by text,
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
  license_statuses text[],
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
  add column if not exists license_statuses text[];
alter table public.fc_profiles
  add column if not exists admin_memo text;
alter table public.fc_profiles
  add column if not exists allowance_prescreen_requested_at timestamp with time zone;
alter table public.fc_profiles
  add column if not exists is_manager_referral_shadow boolean not null default false;

comment on column public.fc_profiles.allowance_prescreen_requested_at is
  '총무가 보증 보험 동의 사전 심사를 실제로 요청한 시각';

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
  reset_failed_count integer not null default 0 check (reset_failed_count between 0 and 5),
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
  reset_failed_count integer not null default 0 check (reset_failed_count between 0 and 5),
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
  reset_failed_count integer not null default 0 check (reset_failed_count between 0 and 5),
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
  recipient_actor_id uuid,
  title text not null,
  body text not null,
  category text,
  target jsonb,
  target_url text,
  delivery_key text,
  created_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists target_url text,
  add column if not exists target jsonb,
  add column if not exists recipient_actor_id uuid,
  add column if not exists delivery_key text;

create or replace function public.is_valid_notification_target_v1(p_target jsonb)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, public
as $$
  select
    jsonb_typeof(p_target) = 'object'
    and p_target->'version' = '1'::jsonb
    and case p_target->>'kind'
      when 'fc_profile' then
        (select array_agg(key order by key) = array['fcId','kind','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'fcId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      when 'onboarding_section' then
        (select array_agg(key order by key) = array['fcId','kind','section','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'fcId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and p_target->>'section' in ('home','consent','docs_upload','hanwha_commission','appointment')
      when 'board_post' then
        (select array_agg(key order by key) = array['kind','postId','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'postId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      when 'notice' then
        (select array_agg(key order by key) = array['kind','noticeId','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'noticeId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      when 'exam' then
        p_target->>'examType' in ('life','nonlife')
        and (
          (
            (select array_agg(key order by key) =
                    array['examRegistrationId','examType','kind','version']
               from jsonb_object_keys(p_target) key)
            and coalesce(p_target->>'examRegistrationId', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
          or
          (
            (select array_agg(key order by key) =
                    array['examRoundId','examType','kind','version']
               from jsonb_object_keys(p_target) key)
            and coalesce(p_target->>'examRoundId', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        )
      when 'garamin_direct_chat' then
        (select array_agg(key order by key) = array['conversationId','kind','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'conversationId', '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      when 'group_chat' then
        (select array_agg(key order by key) = array['kind','roomId','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'roomId', '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      when 'request' then
        (select array_agg(key order by key) = array['kind','requestId','version']
           from jsonb_object_keys(p_target) key)
        and jsonb_typeof(p_target->'requestId') = 'number'
        and (p_target->>'requestId') ~ '^[1-9][0-9]*$'
        and (p_target->>'requestId')::numeric <= 9007199254740991
      when 'request_chat' then
        (select array_agg(key order by key) = array['kind','requestDesignerId','version']
           from jsonb_object_keys(p_target) key)
        and jsonb_typeof(p_target->'requestDesignerId') = 'number'
        and (p_target->>'requestDesignerId') ~ '^[1-9][0-9]*$'
        and (p_target->>'requestDesignerId')::numeric <= 9007199254740991
      when 'request_direct_chat' then
        (select array_agg(key order by key) = array['directConversationId','kind','version']
           from jsonb_object_keys(p_target) key)
        and jsonb_typeof(p_target->'directConversationId') = 'number'
        and (p_target->>'directConversationId') ~ '^[1-9][0-9]*$'
        and (p_target->>'directConversationId')::numeric <= 9007199254740991
      else false
    end;
$$;

revoke all on function public.is_valid_notification_target_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.is_valid_notification_target_v1(jsonb)
  to service_role;

alter table public.notifications
  drop constraint if exists notifications_target_v1_check;
alter table public.notifications
  add constraint notifications_target_v1_check
  check (target is null or public.is_valid_notification_target_v1(target));
alter table public.notifications
  drop constraint if exists notifications_direct_recipient_actor_check;
alter table public.notifications
  add constraint notifications_direct_recipient_actor_check
  check (resident_id is null or recipient_actor_id is not null)
  not valid;

comment on column public.notifications.target is
  'Strict notification target v1. target_url is legacy display-only.';
comment on column public.notifications.recipient_actor_id is
  'Immutable UUID of an exact recipient. Null means a role-scoped broadcast.';
comment on column public.notifications.delivery_key is
  'Server-owned idempotency key for one domain event and one exact recipient.';

create index if not exists idx_notifications_recipient_actor_created
  on public.notifications (recipient_actor_id, created_at desc);
create index if not exists idx_notifications_target_gin
  on public.notifications using gin (target);
create unique index if not exists idx_notifications_delivery_key_unique
  on public.notifications (delivery_key);

create table if not exists public.notification_receipts (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  viewer_actor_id uuid not null,
  viewer_role text not null check (viewer_role in ('fc','manager','admin','developer')),
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (notification_id, viewer_actor_id, viewer_role)
);

create index if not exists idx_notification_receipts_viewer_unread
  on public.notification_receipts (viewer_actor_id, viewer_role, notification_id)
  where dismissed_at is null;

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

create table if not exists public.garamin_direct_conversations (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null references public.fc_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fc_id)
);

do $$
declare
  v_policy record;
  v_column record;
begin
  if to_regclass('public.messages') is not null then
    execute '
      alter table public.messages
        add column if not exists conversation_id uuid,
        add column if not exists sender_actor_id uuid,
        add column if not exists receiver_actor_id uuid
    ';
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.messages'::regclass
         and conname = 'messages_conversation_id_fkey'
    ) then
      execute '
        alter table public.messages
        add constraint messages_conversation_id_fkey
        foreign key (conversation_id)
        references public.garamin_direct_conversations(id)
        on delete set null
        not valid
      ';
    end if;
    execute '
      create index if not exists idx_messages_conversation_created
      on public.messages (conversation_id, created_at)
    ';
    execute '
      create index if not exists idx_messages_conversation_unread
      on public.messages (conversation_id, receiver_id, is_read, created_at)
    ';
    execute 'alter table public.messages enable row level security';
    execute '
      revoke all privileges on table public.messages
      from public, anon, authenticated, service_role
    ';
    for v_column in
      select column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'messages'
    loop
      execute format(
        'revoke all privileges (%I) on table public.messages from public, anon, authenticated, service_role',
        v_column.column_name
      );
    end loop;
    for v_policy in
      select policyname
        from pg_policies
       where schemaname = 'public'
         and tablename = 'messages'
    loop
      execute format('drop policy if exists %I on public.messages', v_policy.policyname);
    end loop;
    execute '
      create policy "messages service role"
      on public.messages
      for all
      to service_role
      using (true)
      with check (true)
    ';
    execute '
      grant select, insert, update, delete
      on table public.messages
      to service_role
    ';
  end if;
end
$$;

create or replace function public.send_garamin_direct_message_with_notification(
  p_message_id uuid,
  p_conversation_id uuid,
  p_sender_id text,
  p_receiver_id text,
  p_sender_actor_id uuid,
  p_receiver_actor_id uuid,
  p_content text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_fc_id uuid;
  v_fc_phone text;
  v_existing_message record;
  v_notification_rows jsonb;
begin
  if p_message_id is null
     or p_conversation_id is null
     or p_sender_actor_id is null
     or coalesce(length(btrim(p_content)), 0) = 0
     or length(p_content) > 4000 then
    raise exception 'invalid_direct_message_payload';
  end if;

  select conversation.fc_id, profile.phone
    into v_fc_id, v_fc_phone
    from public.garamin_direct_conversations conversation
    join public.fc_profiles profile on profile.id = conversation.fc_id
   where conversation.id = p_conversation_id
     and profile.signup_completed = true;
  if v_fc_id is null or v_fc_phone is null then
    raise exception 'direct_conversation_not_found';
  end if;

  if p_sender_id = v_fc_phone and p_receiver_id = 'admin' then
    if p_sender_actor_id <> v_fc_id or p_receiver_actor_id is not null then
      raise exception 'direct_message_actor_mismatch';
    end if;
    if not exists (
      select 1 from public.admin_accounts account where account.active = true
    ) then
      raise exception 'direct_message_recipient_not_found';
    end if;
  elsif p_sender_id = 'admin' and p_receiver_id = v_fc_phone then
    if p_receiver_actor_id <> v_fc_id
       or not exists (
         select 1
           from public.admin_accounts account
          where account.id = p_sender_actor_id
            and account.active = true
       ) then
      raise exception 'direct_message_actor_mismatch';
    end if;
  else
    raise exception 'direct_message_identity_mismatch';
  end if;

  insert into public.messages (
    id,
    conversation_id,
    sender_id,
    receiver_id,
    sender_actor_id,
    receiver_actor_id,
    content,
    message_type,
    is_read
  )
  values (
    p_message_id,
    p_conversation_id,
    p_sender_id,
    p_receiver_id,
    p_sender_actor_id,
    p_receiver_actor_id,
    p_content,
    'text',
    false
  )
  on conflict (id) do nothing;

  select message.*
    into v_existing_message
    from public.messages message
   where message.id = p_message_id;
  if v_existing_message.id is null
     or v_existing_message.conversation_id is distinct from p_conversation_id
     or v_existing_message.sender_id is distinct from p_sender_id
     or v_existing_message.receiver_id is distinct from p_receiver_id
     or v_existing_message.sender_actor_id is distinct from p_sender_actor_id
     or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
     or v_existing_message.content is distinct from p_content
     or v_existing_message.message_type is distinct from 'text' then
    raise exception 'direct_message_idempotency_conflict';
  end if;

  if p_receiver_id = 'admin' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      select
        '새 메시지',
        left(p_content, 160),
        'message',
        v_fc_id,
        account.phone,
        account.id,
        'admin',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':' || account.id::text
      from public.admin_accounts account
      where account.active = true
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning id, resident_id, recipient_actor_id, recipient_role, target
    )
    select coalesce(
      jsonb_agg(to_jsonb(inserted) order by inserted.recipient_actor_id),
      '[]'::jsonb
    )
      into v_notification_rows
      from inserted;
  else
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      values (
        '새 메시지',
        left(p_content, 160),
        'message',
        v_fc_id,
        v_fc_phone,
        v_fc_id,
        'fc',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':' || v_fc_id::text
      )
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning id, resident_id, recipient_actor_id, recipient_role, target
    )
    select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
      into v_notification_rows
      from inserted;
  end if;

  if jsonb_array_length(coalesce(v_notification_rows, '[]'::jsonb)) = 0 then
    raise exception 'direct_message_notification_not_persisted';
  end if;

  return jsonb_build_object(
    'message_id', p_message_id,
    'notifications', v_notification_rows
  );
end;
$$;

revoke all on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) to service_role;

alter table public.device_tokens
  drop constraint if exists device_tokens_role_check;
alter table public.device_tokens
  -- Paired migration: 20260721052837_allow_manager_device_tokens.sql
  add constraint device_tokens_role_check check (role in ('admin','fc','manager'));

alter table public.web_push_subscriptions
  drop constraint if exists web_push_subscriptions_role_check;
alter table public.web_push_subscriptions
  add constraint web_push_subscriptions_role_check check (role in ('admin','fc','manager'));

alter table public.notifications
  drop constraint if exists notifications_recipient_role_check;
alter table public.notifications
  add constraint notifications_recipient_role_check check (recipient_role in ('admin','fc','manager'));

create table if not exists public.group_chat_rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.group_chat_rooms(id) on delete cascade,
  sender_actor_id text not null,
  sender_role text not null check (sender_role in ('fc', 'manager', 'admin')),
  sender_phone text not null,
  sender_name text,
  content text not null default '',
  message_type text not null default 'text' check (message_type in ('text', 'image', 'file')),
  file_url text,
  file_name text,
  file_size bigint,
  created_at timestamptz not null default now(),
  reply_to_message_id uuid references public.group_chat_messages(id) on delete set null,
  reply_to_sender_name text,
  reply_to_content text,
  deleted_at timestamptz,
  deleted_by_actor_id text,
  check (
    char_length(trim(content)) > 0
    or (message_type in ('image', 'file') and file_url is not null)
  )
);

create table if not exists public.group_chat_reads (
  room_id uuid not null references public.group_chat_rooms(id) on delete cascade,
  actor_id text not null,
  last_read_at timestamptz not null default now(),
  last_read_message_id uuid references public.group_chat_messages(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (room_id, actor_id)
);

create table if not exists public.group_chat_preferences (
  room_id uuid not null references public.group_chat_rooms(id) on delete cascade,
  actor_id text not null,
  muted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (room_id, actor_id)
);

create table if not exists public.group_chat_reactions (
  room_id uuid not null references public.group_chat_rooms(id) on delete cascade,
  message_id uuid not null references public.group_chat_messages(id) on delete cascade,
  actor_id text not null,
  actor_role text not null check (actor_role in ('fc', 'manager', 'admin')),
  reaction text not null check (char_length(reaction) between 1 and 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, message_id, actor_id)
);

create table if not exists public.group_chat_member_send_permissions (
  room_id uuid not null references public.group_chat_rooms(id) on delete cascade,
  actor_id text not null,
  can_send_messages boolean not null default false,
  updated_by_actor_id text,
  updated_by_role text check (updated_by_role in ('manager', 'admin')),
  updated_at timestamptz not null default now(),
  primary key (room_id, actor_id),
  check (actor_id like 'fc:%')
);

create table if not exists public.group_chat_notices (
  room_id uuid primary key references public.group_chat_rooms(id) on delete cascade,
  message_id uuid not null references public.group_chat_messages(id) on delete cascade,
  created_by_actor_id text not null,
  created_by_role text not null check (created_by_role in ('manager', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_group_chat_messages_room_created
  on public.group_chat_messages (room_id, created_at desc);

create index if not exists idx_group_chat_messages_sender_created
  on public.group_chat_messages (sender_actor_id, created_at desc);

create index if not exists idx_group_chat_messages_reply
  on public.group_chat_messages (reply_to_message_id);

create index if not exists idx_group_chat_messages_deleted
  on public.group_chat_messages (room_id, deleted_at);

create index if not exists idx_group_chat_messages_live_content_trgm
  on public.group_chat_messages using gin (content extensions.gin_trgm_ops)
  where deleted_at is null;

create index if not exists idx_group_chat_reads_actor
  on public.group_chat_reads (actor_id);

create index if not exists idx_group_chat_preferences_actor
  on public.group_chat_preferences (actor_id);

create index if not exists idx_group_chat_reactions_message
  on public.group_chat_reactions (message_id);

create index if not exists idx_group_chat_reactions_actor
  on public.group_chat_reactions (actor_id);

create index if not exists idx_group_chat_member_send_permissions_actor
  on public.group_chat_member_send_permissions (actor_id);

create index if not exists idx_group_chat_member_send_permissions_room_enabled
  on public.group_chat_member_send_permissions (room_id, can_send_messages);

create index if not exists idx_group_chat_notices_message
  on public.group_chat_notices (message_id);

insert into public.group_chat_rooms (slug, title, is_active)
values ('garampa-default', '가람PA 단톡방', true)
on conflict (slug) do update
set title = excluded.title,
    is_active = true,
    updated_at = now();

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

create or replace function public.enforce_profiles_trusted_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise insufficient_privilege
      using message = 'profiles authorization state is server-managed';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profiles_trusted_write()
  from public, anon, authenticated;
grant execute on function public.enforce_profiles_trusted_write()
  to service_role;

comment on function public.enforce_profiles_trusted_write() is
  'Defense in depth: profile id, role, and fc_id writes are trusted-server state; Data API client roles are rejected.';

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

drop trigger if exists trg_profiles_trusted_write on public.profiles;
create trigger trg_profiles_trusted_write
before insert or update or delete on public.profiles
for each row execute function public.enforce_profiles_trusted_write();

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
alter table public.notification_receipts enable row level security;
alter table public.garamin_direct_conversations enable row level security;
alter table public.group_chat_rooms enable row level security;
alter table public.group_chat_messages enable row level security;
alter table public.group_chat_reads enable row level security;
alter table public.group_chat_preferences enable row level security;
alter table public.group_chat_reactions enable row level security;
alter table public.group_chat_member_send_permissions enable row level security;
alter table public.group_chat_notices enable row level security;
alter table public.notices enable row level security;
alter table public.exam_rounds enable row level security;
alter table public.exam_locations enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.is_manager() returns boolean
language sql stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'manager'
  );
$$;

create or replace function public.is_fc() returns boolean
language sql stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'fc'
  );
$$;

create or replace function public.current_fc_id() returns uuid
language sql stable
security definer
set search_path = pg_catalog, public
as $$
  select p.fc_id from public.profiles p where p.id = auth.uid();
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_manager() from public;
revoke all on function public.is_fc() from public;
revoke all on function public.current_fc_id() from public;

grant execute on function public.is_admin()
  to anon, authenticated, service_role;
grant execute on function public.is_manager()
  to anon, authenticated, service_role;
grant execute on function public.is_fc()
  to anon, authenticated, service_role;
grant execute on function public.current_fc_id()
  to anon, authenticated, service_role;

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

create or replace function public.link_manager_profile_to_default_recommender(
  p_manager_fc_id uuid,
  p_actor_phone text default null,
  p_reason text default 'default_manager_recommender_kim_hyeongsu'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_fc public.fc_profiles%rowtype;
  default_fc public.fc_profiles%rowtype;
  active_code public.referral_codes%rowtype;
  normalized_actor_phone text := nullif(regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g'), '');
  target_phone text;
  target_is_active_manager boolean := false;
  issue_result jsonb;
begin
  if p_manager_fc_id is null then
    raise exception 'manager fc id is required';
  end if;

  select *
    into target_fc
  from public.fc_profiles
  where id = p_manager_fc_id
  for update;

  if not found then
    raise exception 'manager fc profile not found';
  end if;

  target_phone := regexp_replace(coalesce(target_fc.phone, ''), '[^0-9]', '', 'g');

  select exists (
    select 1
    from public.manager_accounts manager_row
    where manager_row.phone = target_phone
      and manager_row.active = true
  )
  into target_is_active_manager;

  if target_is_active_manager is not true and target_fc.is_manager_referral_shadow is not true then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'skipped', 'target_not_active_manager'
    );
  end if;

  select *
    into default_fc
  from public.fc_profiles
  where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = '01094272550'
    and nullif(trim(coalesce(name, '')), '') = '김형수'
    and (signup_completed = true or is_manager_referral_shadow = true)
    and public.is_request_board_designer_affiliation(affiliation) is not true
  order by signup_completed desc, created_at asc, id asc
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'skipped', 'default_recommender_not_found'
    );
  end if;

  if default_fc.id = target_fc.id then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'skipped', 'self_link_blocked'
    );
  end if;

  select *
    into active_code
  from public.referral_codes
  where fc_id = default_fc.id
    and is_active = true
  order by created_at desc, id desc
  limit 1
  for update;

  if not found then
    begin
      issue_result := public.admin_issue_referral_code(
        default_fc.id,
        coalesce(normalized_actor_phone, '01094272550'),
        'admin',
        'admin',
        'default_manager_recommender_kim_hyeongsu',
        false
      );
    exception when others then
      return jsonb_build_object(
        'ok', true,
        'changed', false,
        'skipped', 'default_recommender_code_unavailable',
        'error', sqlerrm
      );
    end;

    select *
      into active_code
    from public.referral_codes
    where fc_id = default_fc.id
      and is_active = true
    order by created_at desc, id desc
    limit 1
    for update;
  end if;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'skipped', 'default_recommender_code_missing'
    );
  end if;

  begin
    return public.apply_referral_link_state(
      p_invitee_fc_id => target_fc.id,
      p_inviter_fc_id => default_fc.id,
      p_referral_code_id => active_code.id,
      p_referral_code => active_code.code,
      p_source => 'admin_override',
      p_actor_phone => coalesce(normalized_actor_phone, '01094272550'),
      p_actor_role => 'admin',
      p_actor_staff_type => 'admin',
      p_reason => coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'default_manager_recommender_kim_hyeongsu')
    );
  exception when others then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'skipped', 'default_recommender_apply_failed',
      'error', sqlerrm
    );
  end;
end;
$$;

revoke all on function public.link_manager_profile_to_default_recommender(uuid, text, text) from public;
revoke all on function public.link_manager_profile_to_default_recommender(uuid, text, text) from anon;
revoke all on function public.link_manager_profile_to_default_recommender(uuid, text, text) from authenticated;
grant execute on function public.link_manager_profile_to_default_recommender(uuid, text, text) to service_role;

comment on function public.link_manager_profile_to_default_recommender(uuid, text, text)
  is 'Attach an active manager fc_profiles row to 김형수(01094272550) as default recommender. Service-role only; self-link is blocked.';

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

      perform public.link_manager_profile_to_default_recommender(
        existing_profile.id,
        normalized_phone,
        'manager_shadow_refresh'
      );

      return existing_profile.id;
    end if;

    if existing_profile.signup_completed = true
       and not public.is_request_board_designer_affiliation(existing_profile.affiliation) then
      perform public.link_manager_profile_to_default_recommender(
        existing_profile.id,
        normalized_phone,
        'manager_profile_refresh'
      );

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

  perform public.link_manager_profile_to_default_recommender(
    existing_profile.id,
    normalized_phone,
    'manager_shadow_created'
  );

  return existing_profile.id;
end;
$$;

revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from public;
revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from anon;
revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from authenticated;
grant execute on function public.ensure_manager_referral_shadow_profile(text, text) to service_role;

comment on function public.ensure_manager_referral_shadow_profile(text, text)
  is 'Create or refresh the referral-only fc_profiles shadow row for an active manager_accounts identity, then attach it to 김형수 as default recommender. Execute grant is service_role only.';

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
drop policy if exists "profiles insert" on public.profiles;
drop policy if exists "profiles update" on public.profiles;
drop policy if exists "profiles delete" on public.profiles;
drop policy if exists "profiles own row select" on public.profiles;

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
drop policy if exists "notifications insert" on public.notifications;

revoke all privileges on table public.notifications from public, anon, authenticated;
grant select, insert, update, delete on table public.notifications to service_role;

revoke all privileges on table public.notification_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_receipts to service_role;

revoke all privileges on table public.garamin_direct_conversations from public, anon, authenticated;
grant select, insert, update, delete on table public.garamin_direct_conversations to service_role;

drop policy if exists "group_chat_rooms service role" on public.group_chat_rooms;
create policy "group_chat_rooms service role"
  on public.group_chat_rooms for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "group_chat_messages service role" on public.group_chat_messages;
create policy "group_chat_messages service role"
  on public.group_chat_messages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "group_chat_reads service role" on public.group_chat_reads;
create policy "group_chat_reads service role"
  on public.group_chat_reads for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "group_chat_preferences service role" on public.group_chat_preferences;
create policy "group_chat_preferences service role"
  on public.group_chat_preferences for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "group_chat_reactions service role" on public.group_chat_reactions;
create policy "group_chat_reactions service role"
  on public.group_chat_reactions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "group_chat_member_send_permissions service role"
  on public.group_chat_member_send_permissions;
create policy "group_chat_member_send_permissions service role"
  on public.group_chat_member_send_permissions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "group_chat_notices service role"
  on public.group_chat_notices;
create policy "group_chat_notices service role"
  on public.group_chat_notices for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "device_tokens select policy" on public.device_tokens;
drop policy if exists "device_tokens insert policy" on public.device_tokens;
drop policy if exists "device_tokens update policy" on public.device_tokens;
drop policy if exists "device_tokens delete policy" on public.device_tokens;
revoke all on table public.device_tokens from anon;
revoke all on table public.device_tokens from authenticated;

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
drop policy if exists "fc_credentials insert" on public.fc_credentials;
drop policy if exists "fc_credentials update" on public.fc_credentials;
drop policy if exists "fc_credentials delete" on public.fc_credentials;

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
drop policy if exists "admin_accounts insert" on public.admin_accounts;
drop policy if exists "admin_accounts update" on public.admin_accounts;
drop policy if exists "admin_accounts delete" on public.admin_accounts;

-- Authorization and credential state is not a client-facing Data API surface.
-- Remove every historical policy, including policies whose names predate this
-- canonical schema, before installing the single own-profile read policy.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (
        array[
          'profiles',
          'fc_credentials',
          'admin_accounts',
          'manager_accounts'
        ]::text[]
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

revoke all privileges on table public.profiles from public, anon, authenticated;
revoke all privileges on table public.fc_credentials from public, anon, authenticated;
revoke all privileges on table public.admin_accounts from public, anon, authenticated;
revoke all privileges on table public.manager_accounts from public, anon, authenticated;

do $$
declare
  target_table text;
  column_list text;
begin
  foreach target_table in array array[
    'profiles',
    'fc_credentials',
    'admin_accounts',
    'manager_accounts'
  ]
  loop
    select string_agg(format('%I', column_name), ', ' order by ordinal_position)
      into column_list
    from information_schema.columns
    where table_schema = 'public'
      and information_schema.columns.table_name = target_table;

    if column_list is not null then
      execute format(
        'revoke all privileges (%s) on table public.%I from public, anon, authenticated',
        column_list,
        target_table
      );
    end if;
  end loop;
end;
$$;

grant select on table public.profiles to authenticated;

grant select, insert, update, delete
  on table public.profiles
  to service_role;
grant select, insert, update, delete
  on table public.fc_credentials
  to service_role;
grant select, insert, update, delete
  on table public.admin_accounts
  to service_role;
grant select, insert, update, delete
  on table public.manager_accounts
  to service_role;

create policy "profiles own row select"
  on public.profiles
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and id = (select auth.uid())
  );

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
  add column if not exists dawichok_url_sent_at timestamptz;

alter table public.fc_profiles
  add column if not exists dawichok_url_sent_by text;

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

comment on column public.fc_profiles.dawichok_url_sent_at is
  'Timestamp when an admin marked the Dawichok URL as sent to the FC.';

comment on column public.fc_profiles.dawichok_url_sent_by is
  'Admin phone or resident identifier that marked the Dawichok URL as sent.';

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

create or replace function public.update_board_post_atomic(
  p_post_id uuid,
  p_update_category boolean,
  p_category_id uuid,
  p_update_title boolean,
  p_title text,
  p_update_content boolean,
  p_content text,
  p_attachment_order uuid[]
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current_attachment_count integer;
  v_requested_attachment_count integer;
  v_distinct_attachment_count integer;
begin
  if not exists (select 1 from public.board_posts where id = p_post_id) then
    raise exception 'board post not found' using errcode = 'P0002';
  end if;

  if p_attachment_order is not null then
    select count(*)::integer
      into v_current_attachment_count
      from public.board_attachments
     where post_id = p_post_id;

    select count(*)::integer, count(distinct requested.attachment_id)::integer
      into v_requested_attachment_count, v_distinct_attachment_count
      from unnest(p_attachment_order) as requested(attachment_id);

    if v_requested_attachment_count <> v_distinct_attachment_count
       or v_requested_attachment_count <> v_current_attachment_count then
      raise exception 'attachment order does not match the post' using errcode = '22023';
    end if;

    if exists (
      select 1
        from unnest(p_attachment_order) as requested(attachment_id)
        left join public.board_attachments attachment
          on attachment.id = requested.attachment_id
         and attachment.post_id = p_post_id
       where attachment.id is null
    ) then
      raise exception 'attachment order contains a foreign attachment' using errcode = '22023';
    end if;

    update public.board_attachments attachment
       set sort_order = (requested.position - 1)::integer
      from unnest(p_attachment_order) with ordinality as requested(attachment_id, position)
     where attachment.id = requested.attachment_id
       and attachment.post_id = p_post_id;
  end if;

  update public.board_posts
     set category_id = case when p_update_category then p_category_id else category_id end,
         title = case when p_update_title then p_title else title end,
         content = case when p_update_content then p_content else content end,
         edited_at = case
           when p_update_category or p_update_title or p_update_content then now()
           else edited_at
         end,
         updated_at = now()
   where id = p_post_id;
end;
$$;

revoke all on function public.update_board_post_atomic(uuid, boolean, uuid, boolean, text, boolean, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.update_board_post_atomic(uuid, boolean, uuid, boolean, text, boolean, text, uuid[])
  to service_role;

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
insert into public.board_categories (name, slug, sort_order, is_active)
values
  ('공지', 'notice', 1, true),
  ('교육 일정', 'education', 2, true),
  ('일반', 'general', 3, true),
  ('상품추천', 'garam-pick', 4, true),
  ('시책', 'policy', 5, true)
on conflict (slug) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

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
  on conflict on constraint user_presence_pkey do update
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
      from public.user_presence as presence
     where presence.phone = normalized_phone;
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

create or replace function public._apply_referral_link_state_unchecked_20260724(
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
  inviter_is_manager_shadow boolean := false;
  normalized_inviter_phone text := null;
begin
  if p_inviter_fc_id is not null then
    perform 1
    from public.fc_profiles invitee_fc
    where invitee_fc.id = p_invitee_fc_id
    for update;

    select
      inviter_fc.is_manager_referral_shadow,
      regexp_replace(coalesce(inviter_fc.phone, ''), '[^0-9]', '', 'g')
    into
      inviter_is_manager_shadow,
      normalized_inviter_phone
    from public.fc_profiles inviter_fc
    where inviter_fc.id = p_inviter_fc_id
    for update;

    if inviter_is_manager_shadow is true then
      perform 1
      from public.manager_accounts manager_row
      where regexp_replace(coalesce(manager_row.phone, ''), '[^0-9]', '', 'g') = normalized_inviter_phone
        and manager_row.active = true
      for share;

      if not found then
        raise exception '추천인으로 지정할 수 없는 FC입니다.';
      end if;
    end if;
  end if;

  return public._apply_referral_link_state_unchecked_20260724(
    p_invitee_fc_id => p_invitee_fc_id,
    p_inviter_fc_id => p_inviter_fc_id,
    p_referral_code_id => p_referral_code_id,
    p_referral_code => p_referral_code,
    p_source => p_source,
    p_actor_phone => p_actor_phone,
    p_actor_role => p_actor_role,
    p_actor_staff_type => p_actor_staff_type,
    p_reason => p_reason
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

-- Canonicalize the 7th headquarters manager label from 김동훈 to 이동훈.
do $$
declare
  new_label constant text := '7본부 이동훈';
  legacy_labels constant text[] := array[
    '7본부 김동훈',
    '7본부 [본부장: 김동훈]',
    '7본부 [본부장: 이동훈]',
    '7팀(청주1/직할) : 김동훈 본부장님',
    '7팀(청주1/직할) : 이동훈 본부장님'
  ];
begin
  update public.affiliation_manager_mappings
  set affiliation = new_label,
      updated_at = now()
  where affiliation = any(legacy_labels)
    and affiliation is distinct from new_label;

  update public.manager_accounts ma
  set name = '이동훈',
      updated_at = now()
  where ma.name = '김동훈'
    and exists (
      select 1
      from public.affiliation_manager_mappings amm
      where regexp_replace(amm.manager_phone, '[^0-9]', '', 'g') = regexp_replace(ma.phone, '[^0-9]', '', 'g')
        and amm.affiliation = new_label
        and amm.active = true
    );

  update public.fc_profiles
  set affiliation = new_label,
      updated_at = now()
  where affiliation = any(legacy_labels)
    and affiliation is distinct from new_label;

  update public.fc_profiles fp
  set name = '이동훈',
      updated_at = now()
  where fp.is_manager_referral_shadow = true
    and fp.name = '김동훈'
    and exists (
      select 1
      from public.manager_accounts ma
      where regexp_replace(ma.phone, '[^0-9]', '', 'g') = regexp_replace(fp.phone, '[^0-9]', '', 'g')
        and ma.name = '이동훈'
        and ma.active = true
    );

  update public.fc_profiles invitee
  set recommender = '이동훈',
      updated_at = now()
  where invitee.recommender = '김동훈'
    and invitee.recommender_fc_id in (
      select id
      from public.fc_profiles
      where is_manager_referral_shadow = true
        and name = '이동훈'
        and affiliation = new_label
    );

  update public.referral_events re
  set inviter_name = '이동훈'
  where re.inviter_name = '김동훈'
    and re.inviter_fc_id in (
      select id
      from public.fc_profiles
      where is_manager_referral_shadow = true
        and name = '이동훈'
        and affiliation = new_label
    );

  update public.referral_attributions ra
  set inviter_name = '이동훈'
  where ra.inviter_name = '김동훈'
    and ra.inviter_fc_id in (
      select id
      from public.fc_profiles
      where is_manager_referral_shadow = true
        and name = '이동훈'
        and affiliation = new_label
    );

  update public.device_tokens dt
  set display_name = '이동훈',
      updated_at = now()
  where dt.display_name = '김동훈'
    and exists (
      select 1
      from public.manager_accounts ma
      where regexp_replace(ma.phone, '[^0-9]', '', 'g') = regexp_replace(dt.resident_id, '[^0-9]', '', 'g')
        and ma.name = '이동훈'
        and ma.active = true
    );
end $$;

revoke all on function public.touch_user_presence(text, text) from public, anon, authenticated;
revoke all on function public.stale_user_presence(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_user_presence(text[]) from public, anon, authenticated;
revoke all on function public.generate_referral_code_candidate() from public, anon, authenticated;
revoke all on function public.is_request_board_designer_affiliation(text) from public, anon, authenticated;
revoke all on function public.link_manager_profile_to_default_recommender(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_issue_referral_code(uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_disable_referral_code(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_backfill_referral_codes(integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_apply_recommender_override(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_invitee_referral_code(uuid) from public, anon, authenticated;
revoke all on function public.get_referral_subtree(uuid, int) from public, anon, authenticated;
revoke all on function public._apply_referral_link_state_unchecked_20260724(uuid, uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.apply_referral_link_state(uuid, uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.touch_user_presence(text, text) to service_role;
grant execute on function public.stale_user_presence(text, text, timestamptz) to service_role;
grant execute on function public.get_user_presence(text[]) to service_role;
grant execute on function public.generate_referral_code_candidate() to service_role;
grant execute on function public.get_invitee_referral_code(uuid) to service_role;
grant execute on function public.get_referral_subtree(uuid, int) to service_role;
grant execute on function public.is_request_board_designer_affiliation(text) to service_role;
grant execute on function public.link_manager_profile_to_default_recommender(uuid, text, text) to service_role;
grant execute on function public.admin_issue_referral_code(uuid, text, text, text, text, boolean) to service_role;
grant execute on function public.admin_disable_referral_code(uuid, text, text, text, text) to service_role;
grant execute on function public.admin_backfill_referral_codes(integer, text, text, text, text) to service_role;
grant execute on function public.admin_apply_recommender_override(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.apply_referral_link_state(uuid, uuid, uuid, text, text, text, text, text, text) to service_role;

create or replace function public.save_exam_round_atomic(
  p_round_id uuid,
  p_exam_date date,
  p_registration_deadline date,
  p_round_label text,
  p_exam_type text,
  p_notes text,
  p_locations text[]
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_round_id uuid;
  v_location_id uuid;
  v_location_name text;
  v_location_position bigint;
  v_locations text[];
  v_location_count integer;
  v_distinct_location_count integer;
  v_updated_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_registration_deadline is null then
    raise exception 'registration deadline required' using errcode = '22023';
  end if;
  if p_exam_date is not null and p_registration_deadline > p_exam_date then
    raise exception 'registration deadline cannot follow exam date' using errcode = '22023';
  end if;
  if p_round_label is null
     or btrim(p_round_label) = ''
     or char_length(btrim(p_round_label)) > 120 then
    raise exception 'invalid round label' using errcode = '22023';
  end if;
  if p_exam_type not in ('life', 'nonlife') then
    raise exception 'invalid exam type' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'invalid notes' using errcode = '22023';
  end if;

  v_location_count := coalesce(cardinality(p_locations), 0);
  if v_location_count < 1 or v_location_count > 50 then
    raise exception 'invalid location count' using errcode = '22023';
  end if;
  if exists (
    select 1
      from unnest(p_locations) as requested(location_name)
     where requested.location_name is null
        or btrim(requested.location_name) = ''
        or char_length(btrim(requested.location_name)) > 120
  ) then
    raise exception 'invalid location name' using errcode = '22023';
  end if;

  select array_agg(btrim(requested.location_name) order by requested.position),
         count(distinct btrim(requested.location_name))::integer
    into v_locations, v_distinct_location_count
    from unnest(p_locations) with ordinality as requested(location_name, position);

  if v_distinct_location_count <> v_location_count then
    raise exception 'duplicate location name' using errcode = '22023';
  end if;

  if p_round_id is null then
    insert into public.exam_rounds (
      exam_date,
      registration_deadline,
      round_label,
      exam_type,
      notes
    ) values (
      p_exam_date,
      p_registration_deadline,
      btrim(p_round_label),
      p_exam_type,
      p_notes
    )
    returning id into v_round_id;
  else
    update public.exam_rounds
       set exam_date = p_exam_date,
           registration_deadline = p_registration_deadline,
           round_label = btrim(p_round_label),
           exam_type = p_exam_type,
           notes = p_notes
     where id = p_round_id;

    get diagnostics v_updated_count = row_count;
    if v_updated_count <> 1 then
      raise exception 'exam round not found' using errcode = 'P0002';
    end if;
    v_round_id := p_round_id;
  end if;

  for v_location_name, v_location_position in
    select requested.location_name, requested.position
      from unnest(v_locations) with ordinality as requested(location_name, position)
  loop
    v_location_id := null;
    select location.id
      into v_location_id
      from public.exam_locations location
     where location.round_id = v_round_id
       and location.location_name = v_location_name
     order by location.created_at, location.id
     limit 1
     for update;

    if v_location_id is null then
      insert into public.exam_locations (round_id, location_name, sort_order)
      values (v_round_id, v_location_name, (v_location_position - 1)::integer);
    else
      update public.exam_locations
         set sort_order = (v_location_position - 1)::integer
       where id = v_location_id;
    end if;
  end loop;

  delete from public.exam_locations location
   where location.round_id = v_round_id
     and not (btrim(location.location_name) = any(v_locations))
     and not exists (
       select 1
         from public.exam_registrations registration
        where registration.location_id = location.id
     );

  return v_round_id;
end;
$$;

revoke all on function public.save_exam_round_atomic(uuid, date, date, text, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.save_exam_round_atomic(uuid, date, date, text, text, text, text[])
  to service_role;
-- ============================
-- 시험 응시료 입금 증빙
-- ============================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'exam-payment-proofs',
  'exam-payment-proofs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "exam payment proofs service role" on storage.objects;
create policy "exam payment proofs service role"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'exam-payment-proofs')
  with check (bucket_id = 'exam-payment-proofs');

create table if not exists public.exam_payment_proof_uploads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  fc_id uuid not null references public.fc_profiles (id) on delete cascade,
  storage_path text not null unique,
  original_file_name text not null,
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size bigint not null
    check (file_size > 0 and file_size <= 10485760),
  status text not null default 'pending'
    check (status in ('pending', 'attached', 'replaced', 'discarded')),
  registration_id uuid references public.exam_registrations (id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_payment_proof_uploads_status_shape_check check (
    (status = 'pending' and registration_id is null and consumed_at is null)
    or (status = 'attached' and registration_id is not null and consumed_at is not null)
    or status in ('replaced', 'discarded')
  ),
  constraint exam_payment_proof_uploads_fc_request_key unique (fc_id, request_id)
);

alter table public.exam_payment_proof_uploads enable row level security;
revoke all on table public.exam_payment_proof_uploads from public, anon, authenticated;
grant select, insert, update, delete on table public.exam_payment_proof_uploads to service_role;

create index if not exists idx_exam_payment_proof_uploads_pending_expiry
  on public.exam_payment_proof_uploads (expires_at)
  where status = 'pending';

create unique index if not exists idx_exam_payment_proof_uploads_current_registration
  on public.exam_payment_proof_uploads (registration_id)
  where status = 'attached';

drop trigger if exists trg_exam_payment_proof_uploads_updated_at
  on public.exam_payment_proof_uploads;
create trigger trg_exam_payment_proof_uploads_updated_at
before update on public.exam_payment_proof_uploads
for each row execute function public.set_updated_at();

alter table public.exam_registrations
  add column if not exists payment_proof_attached boolean not null default false;

alter table public.exam_registrations
  add column if not exists payment_proof_policy_version smallint not null default 0;

alter table public.exam_registrations
  drop constraint if exists exam_registrations_payment_proof_policy_check;

alter table public.exam_registrations
  add constraint exam_registrations_payment_proof_policy_check
  check (
    payment_proof_policy_version in (0, 1)
    and (payment_proof_policy_version = 0 or payment_proof_attached)
  );

create or replace function public.submit_exam_registration_with_payment_proof(
  p_fc_id uuid,
  p_resident_id text,
  p_round_id uuid,
  p_location_id uuid,
  p_is_third_exam boolean,
  p_fee_paid_date date,
  p_upload_id uuid default null
)
returns table (
  registration_id uuid,
  previous_proof_path text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_upload public.exam_payment_proof_uploads%rowtype;
  v_previous_proof_path text;
begin
  if p_fc_id is null or nullif(trim(p_resident_id), '') is null then
    raise exception using errcode = '22023', message = 'invalid_exam_actor';
  end if;

  select *
    into v_registration
    from public.exam_registrations
   where round_id = p_round_id
     and resident_id = p_resident_id
   for update;

  if v_registration.id is not null and coalesce(v_registration.is_confirmed, false) then
    raise exception using errcode = '55000', message = 'confirmed_exam_registration';
  end if;

  if p_upload_id is null then
    if v_registration.id is null or not coalesce(v_registration.payment_proof_attached, false) then
      raise exception using errcode = '23514', message = 'payment_proof_required';
    end if;
  else
    select *
      into v_upload
      from public.exam_payment_proof_uploads
     where id = p_upload_id
       and fc_id = p_fc_id
     for update;

    if v_upload.id is null then
      raise exception using errcode = '22023', message = 'payment_proof_not_found';
    end if;

    if v_upload.status = 'pending' and v_upload.expires_at <= now() then
      raise exception using errcode = '55000', message = 'payment_proof_expired';
    end if;

    if v_upload.status = 'attached' then
      if v_registration.id is null or v_upload.registration_id <> v_registration.id then
        raise exception using errcode = '55000', message = 'payment_proof_already_used';
      end if;
    elsif v_upload.status <> 'pending' then
      raise exception using errcode = '55000', message = 'payment_proof_not_available';
    end if;
  end if;

  if v_registration.id is null then
    insert into public.exam_registrations (
      resident_id,
      fc_id,
      round_id,
      location_id,
      status,
      is_confirmed,
      is_third_exam,
      fee_paid_date,
      payment_proof_attached,
      payment_proof_policy_version
    )
    values (
      p_resident_id,
      p_fc_id,
      p_round_id,
      p_location_id,
      'applied',
      false,
      p_is_third_exam,
      p_fee_paid_date,
      p_upload_id is not null,
      1
    )
    returning * into v_registration;
  else
    update public.exam_registrations
       set fc_id = p_fc_id,
           location_id = p_location_id,
           status = 'applied',
           is_confirmed = false,
           is_third_exam = p_is_third_exam,
           fee_paid_date = p_fee_paid_date,
           payment_proof_attached =
             payment_proof_attached or p_upload_id is not null,
           payment_proof_policy_version = 1
     where id = v_registration.id
    returning * into v_registration;
  end if;

  if p_upload_id is not null and v_upload.status = 'pending' then
    select proof.storage_path
      into v_previous_proof_path
      from public.exam_payment_proof_uploads as proof
     where proof.registration_id = v_registration.id
       and proof.status = 'attached'
     for update;

    update public.exam_payment_proof_uploads as proof
       set status = 'replaced'
     where proof.registration_id = v_registration.id
       and proof.status = 'attached';

    update public.exam_payment_proof_uploads
       set status = 'attached',
           registration_id = v_registration.id,
           consumed_at = now()
     where id = p_upload_id;
  end if;

  return query
  select v_registration.id, v_previous_proof_path;
end;
$$;

revoke all on function public.submit_exam_registration_with_payment_proof(
  uuid,
  text,
  uuid,
  uuid,
  boolean,
  date,
  uuid
) from public, anon, authenticated;

grant execute on function public.submit_exam_registration_with_payment_proof(
  uuid,
  text,
  uuid,
  uuid,
  boolean,
  date,
  uuid
) to service_role;

-- ============================
-- 시험 월별 묶음 신청 / 상태 결정
-- Paired migration:
-- 20260724131931_exam_bundle_monthly_slot_and_decisions.sql
-- ============================

alter table public.exam_registrations
  add column if not exists exam_month date,
  add column if not exists monthly_slot_policy_version smallint not null default 1,
  add column if not exists includes_primary_exam boolean not null default true,
  add column if not exists rejection_reason text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by_admin_id uuid
    references public.admin_accounts (id) on delete set null,
  add column if not exists rejected_by_staff_type text;

alter table public.exam_registrations
  alter column is_third_exam set default false;
update public.exam_registrations
   set is_third_exam = false
 where is_third_exam is null;
alter table public.exam_registrations
  alter column is_third_exam set not null;

update public.exam_registrations
   set is_confirmed = false
 where is_confirmed is null;
alter table public.exam_registrations
  alter column is_confirmed set default false;
alter table public.exam_registrations
  alter column is_confirmed set not null;

alter table public.exam_registrations
  drop constraint if exists exam_registrations_status_check;
alter table public.exam_registrations
  add constraint exam_registrations_status_check
  check (
    status in (
      'applied', 'confirmed', 'completed', 'no_show', 'rejected',
      'cancelled_by_fc', 'cancelled_by_admin'
    )
  );

alter table public.exam_registrations
  drop constraint if exists exam_registrations_confirmation_status_check;
alter table public.exam_registrations
  add constraint exam_registrations_confirmation_status_check
  check (
    is_confirmed = (
      status in ('confirmed', 'completed', 'no_show')
    )
  );

alter table public.exam_registrations
  drop constraint if exists exam_registrations_monthly_slot_policy_check;
alter table public.exam_registrations
  add constraint exam_registrations_monthly_slot_policy_check
  check (monthly_slot_policy_version in (0, 1));

alter table public.exam_registrations
  drop constraint if exists exam_registrations_active_month_shape_check;
alter table public.exam_registrations
  add constraint exam_registrations_active_month_shape_check
  check (
    status not in ('applied', 'confirmed', 'completed', 'no_show')
    or (
      exam_month is not null
      and exam_month = date_trunc('month', exam_month)::date
      and (
        fc_id is not null
        or resident_id like 'deleted-exam:%'
      )
    )
  );

alter table public.exam_registrations
  drop constraint if exists exam_registrations_subject_selection_check;
alter table public.exam_registrations
  add constraint exam_registrations_subject_selection_check
  check (includes_primary_exam or is_third_exam);

alter table public.exam_registrations
  drop constraint if exists exam_registrations_rejection_shape_check;
alter table public.exam_registrations
  add constraint exam_registrations_rejection_shape_check
  check (
    (
      status = 'rejected'
      and rejection_reason is not null
      and char_length(btrim(rejection_reason)) between 1 and 1000
      and rejected_at is not null
      and rejected_by_staff_type in ('admin', 'developer')
    )
    or (
      status <> 'rejected'
      and rejection_reason is null
      and rejected_at is null
      and rejected_by_admin_id is null
      and rejected_by_staff_type is null
    )
  );

alter table public.exam_registrations
  drop constraint if exists exam_registrations_payment_proof_policy_check;
alter table public.exam_registrations
  add constraint exam_registrations_payment_proof_policy_check
  check (
    payment_proof_policy_version in (0, 1)
    and (
      payment_proof_policy_version = 0
      or payment_proof_attached
      or status in ('cancelled_by_fc', 'cancelled_by_admin')
      or resident_id like 'deleted-exam:%'
    )
  );

drop index if exists public.idx_exam_registrations_round_resident;
drop index if exists public.idx_exam_registrations_active_fc_exam_month;
create unique index idx_exam_registrations_active_fc_exam_month
  on public.exam_registrations (fc_id, exam_month)
  where status in ('applied', 'confirmed', 'completed', 'no_show')
    and monthly_slot_policy_version = 1;
create index if not exists idx_exam_registrations_resident_history
  on public.exam_registrations (resident_id, created_at desc, id desc);

create table if not exists public.exam_registration_decision_events (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null
    references public.exam_registrations (id) on delete restrict,
  action text not null
    check (
      action in (
        'submitted', 'updated', 'confirmed', 'unconfirmed', 'rejected',
        'cancelled_by_fc', 'cancelled_by_admin', 'identity_detached'
      )
    ),
  from_status text,
  to_status text not null,
  reason text,
  actor_type text not null
    check (actor_type in ('fc', 'admin', 'developer', 'service')),
  actor_admin_id_snapshot uuid,
  actor_fc_id_snapshot uuid,
  created_at timestamptz not null default now(),
  constraint exam_registration_decision_events_reason_check
    check (
      (action = 'rejected' and char_length(btrim(coalesce(reason, ''))) between 1 and 1000)
      or (action <> 'rejected' and reason is null)
    )
);

alter table public.exam_registration_decision_events enable row level security;
revoke all on table public.exam_registration_decision_events
  from public, anon, authenticated, service_role;
revoke update, delete, truncate on table public.exam_registration_decision_events
  from service_role;
grant select, insert on table public.exam_registration_decision_events
  to service_role;

create or replace function public.reject_exam_decision_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'exam_decision_events_are_append_only';
end;
$$;

drop trigger if exists trg_reject_exam_decision_event_mutation
  on public.exam_registration_decision_events;
create trigger trg_reject_exam_decision_event_mutation
before update or delete or truncate on public.exam_registration_decision_events
for each statement execute function public.reject_exam_decision_event_mutation();

create or replace function public.prevent_exam_history_drift()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'exam_rounds' then
    if tg_op = 'DELETE' and exists (
      select 1 from public.exam_registrations where round_id = old.id
    ) then
      raise exception using errcode = '55000', message = 'exam_round_has_registrations';
    end if;
    if tg_op = 'UPDATE'
       and (new.exam_date is distinct from old.exam_date or new.exam_type is distinct from old.exam_type)
       and exists (
         select 1 from public.exam_registrations where round_id = old.id
       ) then
      raise exception using errcode = '55000', message = 'exam_round_history_locked';
    end if;
  elsif tg_table_name = 'exam_locations' then
    if tg_op = 'DELETE' and exists (
      select 1 from public.exam_registrations where location_id = old.id
    ) then
      raise exception using errcode = '55000', message = 'exam_location_has_registrations';
    end if;
    if tg_op = 'UPDATE'
       and new.round_id is distinct from old.round_id
       and exists (
         select 1 from public.exam_registrations where location_id = old.id
       ) then
      raise exception using errcode = '55000', message = 'exam_location_history_locked';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_prevent_exam_round_history_drift on public.exam_rounds;
create trigger trg_prevent_exam_round_history_drift
before update or delete on public.exam_rounds
for each row execute function public.prevent_exam_history_drift();

drop trigger if exists trg_prevent_exam_location_history_drift on public.exam_locations;
create trigger trg_prevent_exam_location_history_drift
before update or delete on public.exam_locations
for each row execute function public.prevent_exam_history_drift();

create unique index if not exists idx_exam_rounds_id_exam_type
  on public.exam_rounds (id, exam_type);
alter table public.exam_registrations
  drop constraint if exists exam_registrations_round_exam_type_fkey;
alter table public.exam_registrations
  add constraint exam_registrations_round_exam_type_fkey
  foreign key (round_id, exam_type)
  references public.exam_rounds (id, exam_type)
  on delete restrict;
alter table public.exam_registrations
  drop constraint if exists exam_registrations_location_id_fkey;
alter table public.exam_registrations
  drop constraint if exists exam_registrations_location_round_fkey;
alter table public.exam_registrations
  add constraint exam_registrations_location_round_fkey
  foreign key (location_id, round_id)
  references public.exam_locations (id, round_id)
  on delete restrict;

drop policy if exists "exam_registrations insert" on public.exam_registrations;
drop policy if exists "exam_registrations anon insert" on public.exam_registrations;
drop policy if exists "exam_registrations update" on public.exam_registrations;
drop policy if exists "exam_registrations anon update" on public.exam_registrations;
drop policy if exists "exam_registrations delete" on public.exam_registrations;
drop policy if exists "exam_registrations anon delete" on public.exam_registrations;
revoke insert, update, delete on table public.exam_registrations from anon, authenticated;

drop policy if exists "exam_rounds insert" on public.exam_rounds;
drop policy if exists "exam_rounds anon insert" on public.exam_rounds;
drop policy if exists "exam_rounds update" on public.exam_rounds;
drop policy if exists "exam_rounds delete" on public.exam_rounds;
revoke insert, update, delete on table public.exam_rounds from anon, authenticated;

drop policy if exists "exam_locations insert" on public.exam_locations;
drop policy if exists "exam_locations anon insert" on public.exam_locations;
drop policy if exists "exam_locations update" on public.exam_locations;
drop policy if exists "exam_locations delete" on public.exam_locations;
revoke insert, update, delete on table public.exam_locations from anon, authenticated;

create or replace function public.submit_exam_registration_with_payment_proof_v2(
  p_fc_id uuid,
  p_resident_id text,
  p_round_id uuid,
  p_location_id uuid,
  p_includes_primary_exam boolean,
  p_is_third_exam boolean,
  p_fee_paid_date date,
  p_upload_id uuid default null
)
returns table (registration_id uuid, previous_proof_path text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_round public.exam_rounds%rowtype;
  v_upload public.exam_payment_proof_uploads%rowtype;
  v_exam_month date;
  v_previous_proof_path text;
  v_action text;
begin
  if p_fc_id is null or nullif(btrim(p_resident_id), '') is null then
    raise exception using errcode = '22023', message = 'invalid_exam_actor';
  end if;
  if not coalesce(p_includes_primary_exam, false)
     and not coalesce(p_is_third_exam, false) then
    raise exception using errcode = '23514', message = 'exam_subject_required';
  end if;
  if p_fee_paid_date is null or p_fee_paid_date > current_date then
    raise exception using errcode = '22023', message = 'invalid_fee_paid_date';
  end if;

  select round_row.* into v_round
    from public.exam_rounds round_row
   where round_row.id = p_round_id
   for share;
  if v_round.id is null
     or v_round.exam_month is null
     or v_round.exam_type is null
     or v_round.exam_type not in ('life', 'nonlife') then
    raise exception using errcode = '22023', message = 'invalid_exam_round';
  end if;
  if v_round.registration_deadline < current_date then
    raise exception using errcode = '55000', message = 'exam_round_closed';
  end if;
  if not exists (
    select 1 from public.exam_locations
     where id = p_location_id and round_id = p_round_id
  ) then
    raise exception using errcode = '23503', message = 'invalid_exam_location';
  end if;

  v_exam_month := v_round.exam_month;
  perform pg_advisory_xact_lock(
    hashtextextended(p_fc_id::text || ':' || v_exam_month::text, 0)
  );

  select registration.* into v_registration
    from public.exam_registrations registration
   where registration.fc_id = p_fc_id
     and registration.exam_month = v_exam_month
     and registration.exam_type = v_round.exam_type
     and registration.status in ('applied', 'confirmed', 'completed', 'no_show')
   order by registration.created_at, registration.id
   limit 1
   for update;

  if v_registration.id is not null
     and (
       v_registration.round_id <> p_round_id
       or v_registration.status <> 'applied'
       or coalesce(v_registration.is_confirmed, false)
     ) then
    raise exception using errcode = '23505', message = 'active_exam_month_already_registered';
  end if;

  if p_upload_id is null then
    if v_registration.id is null
       or not coalesce(v_registration.payment_proof_attached, false) then
      raise exception using errcode = '23514', message = 'payment_proof_required';
    end if;
  else
    select upload.* into v_upload
      from public.exam_payment_proof_uploads upload
     where upload.id = p_upload_id and upload.fc_id = p_fc_id
     for update;
    if v_upload.id is null then
      raise exception using errcode = '22023', message = 'payment_proof_not_found';
    end if;
    if v_upload.status = 'pending' and v_upload.expires_at <= now() then
      raise exception using errcode = '55000', message = 'payment_proof_expired';
    end if;
    if v_upload.status = 'attached' then
      if v_registration.id is null or v_upload.registration_id <> v_registration.id then
        raise exception using errcode = '55000', message = 'payment_proof_already_used';
      end if;
    elsif v_upload.status <> 'pending' then
      raise exception using errcode = '55000', message = 'payment_proof_not_available';
    end if;
  end if;

  if v_registration.id is null then
    insert into public.exam_registrations (
      resident_id, fc_id, round_id, location_id, exam_month, exam_type, status,
      is_confirmed, includes_primary_exam, is_third_exam, fee_paid_date,
      payment_proof_attached, payment_proof_policy_version
    ) values (
      btrim(p_resident_id), p_fc_id, p_round_id, p_location_id, v_exam_month,
      v_round.exam_type,
      'applied', false, p_includes_primary_exam, p_is_third_exam,
      p_fee_paid_date, p_upload_id is not null, 1
    )
    returning * into v_registration;
    v_action := 'submitted';
  else
    update public.exam_registrations
       set resident_id = btrim(p_resident_id),
           location_id = p_location_id,
           includes_primary_exam = p_includes_primary_exam,
           is_third_exam = p_is_third_exam,
           fee_paid_date = p_fee_paid_date,
           payment_proof_attached = payment_proof_attached or p_upload_id is not null,
           payment_proof_policy_version = 1
     where id = v_registration.id
    returning * into v_registration;
    v_action := 'updated';
  end if;

  if p_upload_id is not null and v_upload.status = 'pending' then
    select proof.storage_path into v_previous_proof_path
      from public.exam_payment_proof_uploads proof
     where proof.registration_id = v_registration.id and proof.status = 'attached'
     for update;
    update public.exam_payment_proof_uploads proof
       set status = 'replaced'
     where proof.registration_id = v_registration.id and proof.status = 'attached';
    update public.exam_payment_proof_uploads proof
       set status = 'attached', registration_id = v_registration.id, consumed_at = now()
     where proof.id = p_upload_id;
  end if;

  insert into public.exam_registration_decision_events (
    registration_id, action, from_status, to_status, actor_type, actor_fc_id_snapshot
  ) values (
    v_registration.id, v_action,
    case when v_action = 'updated' then 'applied' else null end,
    'applied', 'fc', p_fc_id
  );

  return query select v_registration.id, v_previous_proof_path;
end;
$$;

revoke all on function public.submit_exam_registration_with_payment_proof_v2(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid
) from public, anon, authenticated;
grant execute on function public.submit_exam_registration_with_payment_proof_v2(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid
) to service_role;

create or replace function public.submit_exam_registration_with_payment_proof(
  p_fc_id uuid,
  p_resident_id text,
  p_round_id uuid,
  p_location_id uuid,
  p_is_third_exam boolean,
  p_fee_paid_date date,
  p_upload_id uuid default null
)
returns table (registration_id uuid, previous_proof_path text)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select * from public.submit_exam_registration_with_payment_proof_v2(
    p_fc_id, p_resident_id, p_round_id, p_location_id, true,
    coalesce(p_is_third_exam, false), p_fee_paid_date, p_upload_id
  );
$$;

revoke all on function public.submit_exam_registration_with_payment_proof(
  uuid, text, uuid, uuid, boolean, date, uuid
) from public, anon, authenticated;
grant execute on function public.submit_exam_registration_with_payment_proof(
  uuid, text, uuid, uuid, boolean, date, uuid
) to service_role;

-- Applied migration: 20261008060419_exam_self_cancellation_deadline.sql.
-- FC self-cancellation is allowed through the whole registration deadline day
-- in Asia/Seoul. Trusted callers cannot supply a clock to the mutation RPC.
create or replace function public.exam_self_cancellation_deadline_passed(
  p_registration_deadline date,
  p_checked_at timestamptz
)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case
    when p_registration_deadline is null or not isfinite(p_registration_deadline)
      or p_checked_at is null or not isfinite(p_checked_at) then true
    else (p_checked_at at time zone 'Asia/Seoul')::date > p_registration_deadline
  end;
$$;

revoke all on function public.exam_self_cancellation_deadline_passed(date, timestamptz)
  from public, anon, authenticated;
grant execute on function public.exam_self_cancellation_deadline_passed(date, timestamptz)
  to service_role;

drop function if exists public.transition_exam_registration(
  uuid, text, text, uuid, uuid, text
);

create or replace function public.transition_exam_registration(
  p_registration_id uuid,
  p_action text,
  p_actor_type text,
  p_actor_admin_id uuid default null,
  p_actor_fc_id uuid default null,
  p_reason text default null
)
returns table (
  registration_id uuid,
  status text,
  proof_path text,
  target_resident_id text,
  exam_type text,
  notification_id uuid,
  recipient_actor_id uuid
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_admin public.admin_accounts%rowtype;
  v_exam_type text;
  v_registration_deadline date;
  v_from_status text;
  v_to_status text;
  v_reason text;
  v_proof_path text;
  v_target_url text;
  v_title text;
  v_body text;
  v_notification_id uuid;
begin
  select registration.*
    into v_registration
    from public.exam_registrations registration
   where registration.id = p_registration_id
   for update;

  if v_registration.id is null then
    raise exception using errcode = 'P0002', message = 'exam_registration_not_found';
  end if;

  select round_row.exam_type, round_row.registration_deadline
    into v_exam_type, v_registration_deadline
    from public.exam_rounds round_row
   where round_row.id = v_registration.round_id
   for share;

  if v_registration.status in ('completed', 'no_show') then
    raise exception using errcode = '55000', message = 'terminal_exam_registration';
  end if;

  if p_action = 'cancel_by_fc' then
    if p_actor_type is distinct from 'fc'
       or p_actor_fc_id is null
       or p_actor_fc_id is distinct from v_registration.fc_id then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
  else
    if p_actor_type not in ('admin', 'developer') or p_actor_admin_id is null then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
    select admin_row.* into v_admin
      from public.admin_accounts admin_row
     where admin_row.id = p_actor_admin_id
       and admin_row.active = true
       and (
         (p_actor_type = 'developer' and admin_row.staff_type = 'developer')
         or (p_actor_type = 'admin' and coalesce(admin_row.staff_type, 'admin') = 'admin')
       )
     for share;
    if v_admin.id is null then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
  end if;

  v_from_status := v_registration.status;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  case p_action
    when 'confirm' then
      if v_from_status <> 'applied' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'confirmed';
    when 'unconfirm' then
      if v_from_status <> 'confirmed' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'applied';
    when 'reject' then
      if v_from_status not in ('applied', 'confirmed') then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      if v_reason is null or char_length(v_reason) > 1000 then
        raise exception using errcode = '22023', message = 'invalid_rejection_reason';
      end if;
      v_to_status := 'rejected';
    when 'cancel_by_fc' then
      if v_from_status <> 'applied' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      -- Check only after actor ownership and existing state guards, under the
      -- registration and round locks, before any proof/history mutation.
      if public.exam_self_cancellation_deadline_passed(v_registration_deadline, clock_timestamp()) then
        raise exception using
          errcode = 'P0001',
          message = 'exam_cancellation_deadline_passed';
      end if;
      v_to_status := 'cancelled_by_fc';
    when 'cancel_by_admin' then
      if v_from_status not in ('applied', 'confirmed') then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'cancelled_by_admin';
    else
      raise exception using errcode = '22023', message = 'invalid_exam_transition_action';
  end case;

  if v_to_status in ('cancelled_by_fc', 'cancelled_by_admin') then
    select proof.storage_path into v_proof_path
      from public.exam_payment_proof_uploads proof
     where proof.registration_id = v_registration.id and proof.status = 'attached'
     for update;
    update public.exam_payment_proof_uploads proof
       set status = 'discarded'
     where proof.registration_id = v_registration.id and proof.status = 'attached';
  end if;

  update public.exam_registrations registration
     set status = v_to_status,
         is_confirmed = v_to_status = 'confirmed',
         payment_proof_attached = case
           when v_to_status in ('cancelled_by_fc', 'cancelled_by_admin') then false
           else registration.payment_proof_attached
         end,
         rejection_reason = case when v_to_status = 'rejected' then v_reason else null end,
         rejected_at = case when v_to_status = 'rejected' then now() else null end,
         rejected_by_admin_id = case when v_to_status = 'rejected' then p_actor_admin_id else null end,
         rejected_by_staff_type = case when v_to_status = 'rejected' then p_actor_type else null end
   where registration.id = v_registration.id;

  insert into public.exam_registration_decision_events (
    registration_id, action, from_status, to_status, reason,
    actor_type, actor_admin_id_snapshot, actor_fc_id_snapshot
  ) values (
    v_registration.id,
    case p_action
      when 'confirm' then 'confirmed'
      when 'unconfirm' then 'unconfirmed'
      when 'reject' then 'rejected'
      when 'cancel_by_fc' then 'cancelled_by_fc'
      when 'cancel_by_admin' then 'cancelled_by_admin'
    end,
    v_from_status,
    v_to_status,
    case when p_action = 'reject' then v_reason else null end,
    p_actor_type,
    p_actor_admin_id,
    p_actor_fc_id
  );

  if p_action <> 'cancel_by_fc' then
    v_target_url := case when v_exam_type = 'nonlife' then '/exam-apply2' else '/exam-apply' end;
    v_title := case p_action
      when 'confirm' then '시험 접수가 승인되었습니다.'
      when 'unconfirm' then '시험 접수 승인이 취소되었습니다.'
      when 'reject' then '시험 접수가 반려되었습니다.'
      else '시험 접수가 취소되었습니다.'
    end;
    v_body := case
      when p_action = 'reject' then v_title || ' 사유: ' || v_reason
      else v_title
    end;
    insert into public.notifications (
      fc_id, resident_id, recipient_role, recipient_actor_id,
      title, body, category, target, target_url
    ) values (
      v_registration.fc_id, v_registration.resident_id, 'fc', v_registration.fc_id,
      v_title, v_body, 'exam_apply',
      jsonb_build_object(
        'version', 1,
        'kind', 'exam',
        'examType', v_exam_type,
        'examRegistrationId', v_registration.id
      ),
      v_target_url
    )
    returning id into v_notification_id;
  end if;

  return query
  select v_registration.id, v_to_status, v_proof_path,
         v_registration.resident_id, v_exam_type, v_notification_id,
         v_registration.fc_id;
end;
$$;

revoke all on function public.transition_exam_registration(
  uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.transition_exam_registration(
  uuid, text, text, uuid, uuid, text
) to service_role;

create or replace function public.detach_exam_registration_identity_for_account_deletion(
  p_fc_id uuid
)
returns table (proof_path text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_to_status text;
begin
  if p_fc_id is null then
    raise exception using errcode = '22023', message = 'fc_id_required';
  end if;

  return query
  update public.exam_payment_proof_uploads upload
     set status = 'discarded'
   where upload.fc_id = p_fc_id
     and upload.status in ('pending', 'attached')
  returning upload.storage_path;

  for v_registration in
    select registration.*
     from public.exam_registrations registration
     where registration.fc_id = p_fc_id
     order by registration.created_at, registration.id
     for update
  loop
    v_to_status := case
      when v_registration.status in ('applied', 'confirmed') then 'cancelled_by_fc'
      else v_registration.status
    end;

    if v_to_status <> v_registration.status then
      insert into public.exam_registration_decision_events (
        registration_id,
        action,
        from_status,
        to_status,
        reason,
        actor_type
      ) values (
        v_registration.id,
        'cancelled_by_fc',
        v_registration.status,
        v_to_status,
        null,
        'service'
      );
    end if;

    update public.exam_registrations registration
       set status = v_to_status,
           is_confirmed = v_to_status in ('confirmed', 'completed', 'no_show'),
           payment_proof_attached = false,
           fc_id = null,
           resident_id = 'deleted-exam:' || registration.id::text,
           rejection_reason = case
             when v_to_status = 'rejected' then registration.rejection_reason
             else null
           end,
           rejected_at = case
             when v_to_status = 'rejected' then registration.rejected_at
             else null
           end,
           rejected_by_admin_id = case
             when v_to_status = 'rejected' then registration.rejected_by_admin_id
             else null
           end,
           rejected_by_staff_type = case
             when v_to_status = 'rejected' then registration.rejected_by_staff_type
             else null
           end
     where registration.id = v_registration.id;

    insert into public.exam_registration_decision_events (
      registration_id,
      action,
      from_status,
      to_status,
      reason,
      actor_type
    ) values (
      v_registration.id,
      'identity_detached',
      v_to_status,
      v_to_status,
      null,
      'service'
    );
  end loop;
end;
$$;

revoke all on function public.detach_exam_registration_identity_for_account_deletion(
  uuid
) from public, anon, authenticated;
grant execute on function public.detach_exam_registration_identity_for_account_deletion(
  uuid
) to service_role;

create table if not exists public.account_deletion_cleanup_outbox (
  id uuid primary key default gen_random_uuid(),
  cleanup_payload jsonb not null
    check (jsonb_typeof(cleanup_payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'exhausted')),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 10),
  last_error_code text
    check (
      last_error_code is null
      or (
        char_length(last_error_code) between 1 and 64
        and last_error_code ~ '^[a-z0-9_]+$'
      )
    ),
  next_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_deletion_cleanup_outbox enable row level security;
revoke all on table public.account_deletion_cleanup_outbox
  from public, anon, authenticated, service_role;
grant select, insert on table public.account_deletion_cleanup_outbox
  to service_role;

create index if not exists idx_account_deletion_cleanup_outbox_pending
  on public.account_deletion_cleanup_outbox (next_attempt_at, created_at)
  where status = 'pending' and attempt_count < 10;

create or replace function public.record_account_deletion_cleanup_attempt_v1(
  p_outbox_id uuid,
  p_succeeded boolean,
  p_error_code text default null
)
returns table (
  status text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_error_code text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'cleanup_outbox_forbidden';
  end if;
  if p_outbox_id is null then
    raise exception using errcode = '22023', message = 'cleanup_outbox_id_required';
  end if;

  v_error_code := case
    when coalesce(p_succeeded, false) then null
    else nullif(
      left(
        regexp_replace(lower(btrim(coalesce(p_error_code, ''))), '[^a-z0-9_]', '_', 'g'),
        64
      ),
      ''
    )
  end;
  if not coalesce(p_succeeded, false) and v_error_code is null then
    v_error_code := 'post_commit_cleanup_failed';
  end if;

  return query
  update public.account_deletion_cleanup_outbox outbox
     set attempt_count = least(outbox.attempt_count + 1, 10),
         status = case
           when coalesce(p_succeeded, false) then 'completed'
           when outbox.attempt_count + 1 >= 10 then 'exhausted'
           else 'pending'
         end,
         last_error_code = v_error_code,
         next_attempt_at = case
           when coalesce(p_succeeded, false) then outbox.next_attempt_at
           else now() + (
             least(3600, 30 * power(2, least(outbox.attempt_count, 9)))::text
             || ' seconds'
           )::interval
         end,
         completed_at = case
           when coalesce(p_succeeded, false) then now()
           else null
         end,
         updated_at = now()
   where outbox.id = p_outbox_id
     and outbox.status in ('pending', 'exhausted')
  returning outbox.status, outbox.attempt_count;

  if not found then
    raise exception using errcode = 'P0002', message = 'cleanup_outbox_not_pending';
  end if;
end;
$$;

revoke all on function public.record_account_deletion_cleanup_attempt_v1(
  uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.record_account_deletion_cleanup_attempt_v1(
  uuid, boolean, text
) to service_role;

create or replace function public.list_account_deletion_cleanup_pending_v1(
  p_limit integer default 10
)
returns table (
  outbox_id uuid,
  cleanup_payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'cleanup_outbox_forbidden';
  end if;

  return query
  select
    outbox.id,
    outbox.cleanup_payload,
    outbox.attempt_count
  from public.account_deletion_cleanup_outbox outbox
  where outbox.status = 'pending'
    and outbox.attempt_count < 10
    and outbox.next_attempt_at <= now()
  order by outbox.next_attempt_at, outbox.created_at
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
end;
$$;

revoke all on function public.list_account_deletion_cleanup_pending_v1(
  integer
) from public, anon, authenticated;
grant execute on function public.list_account_deletion_cleanup_pending_v1(
  integer
) to service_role;

create or replace function public.delete_account_core_transaction_v1(
  p_target_role text,
  p_target_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_phone text;
  v_phone_digits text;
  v_fc_ids uuid[] := array[]::uuid[];
  v_fc_id uuid;
  v_proof_paths text[] := array[]::text[];
  v_new_proof_paths text[] := array[]::text[];
  v_document_paths text[] := array[]::text[];
  v_board_paths text[] := array[]::text[];
  v_chat_file_urls text[] := array[]::text[];
  v_auth_user_ids uuid[] := array[]::uuid[];
  v_post_ids uuid[] := array[]::uuid[];
  v_cleanup_outbox_id uuid;
  v_deleted_count integer := 0;
begin
  if p_target_id is null or p_target_role not in ('fc', 'admin', 'manager') then
    raise exception using errcode = '22023', message = 'invalid_account_delete_target';
  end if;

  if p_target_role = 'fc' then
    select profile.phone
      into v_phone
      from public.fc_profiles profile
     where profile.id = p_target_id
       and not profile.is_manager_referral_shadow
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;
    v_fc_ids := array[p_target_id];
  elsif p_target_role = 'admin' then
    select account.phone
      into v_phone
      from public.admin_accounts account
     where account.id = p_target_id
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;
  else
    select account.phone
      into v_phone
      from public.manager_accounts account
     where account.id = p_target_id
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;

    select coalesce(array_agg(profile.id order by profile.id), array[]::uuid[])
      into v_fc_ids
      from public.fc_profiles profile
     where profile.is_manager_referral_shadow
       and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g')
           = regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g');
  end if;

  v_phone_digits := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
  if v_phone_digits is null then
    raise exception using errcode = '23514', message = 'account_delete_phone_missing';
  end if;

  if cardinality(v_fc_ids) > 0 then
    perform 1
      from public.fc_profiles profile
     where profile.id = any(v_fc_ids)
     for update;

    if exists (
      select 1
        from public.exam_registrations registration
       where registration.resident_id not like 'deleted-exam:%'
         and (
           (
             registration.fc_id = any(v_fc_ids)
             and nullif(
               regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
               ''
             ) is distinct from v_phone_digits
           )
           or (
             nullif(
               regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
               ''
             ) = v_phone_digits
             and (
               registration.fc_id is null
               or not (registration.fc_id = any(v_fc_ids))
             )
           )
         )
    ) then
      raise exception using
        errcode = '23514',
        message = 'account_delete_exam_ownership_mismatch';
    end if;

    select coalesce(array_agg(document.storage_path), array[]::text[])
      into v_document_paths
      from public.fc_documents document
     where document.fc_id = any(v_fc_ids)
       and document.storage_path is not null
       and document.storage_path <> 'deleted';

    select coalesce(array_agg(profile.id), array[]::uuid[])
      into v_auth_user_ids
      from public.profiles profile
     where profile.fc_id = any(v_fc_ids);

    foreach v_fc_id in array v_fc_ids
    loop
      select coalesce(array_agg(detached.proof_path), array[]::text[])
        into v_new_proof_paths
        from public.detach_exam_registration_identity_for_account_deletion(v_fc_id) detached;
      v_proof_paths := v_proof_paths || v_new_proof_paths;
    end loop;
  end if;

  select coalesce(array_agg(post.id), array[]::uuid[])
    into v_post_ids
    from public.board_posts post
   where regexp_replace(coalesce(post.author_resident_id, ''), '[^0-9]', '', 'g')
         = v_phone_digits;

  select coalesce(array_agg(distinct attachment.storage_path), array[]::text[])
    into v_board_paths
    from public.board_attachments attachment
   where regexp_replace(coalesce(attachment.created_by_resident_id, ''), '[^0-9]', '', 'g')
         = v_phone_digits
      or attachment.post_id = any(v_post_ids);

  if to_regclass('public.messages') is not null then
    execute $dynamic$
      select coalesce(array_agg(file_url), array[]::text[])
        from public.messages
       where message_type in ('image', 'file')
         and regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g') = $1
    $dynamic$
    into v_chat_file_urls
    using v_phone_digits;
  end if;

  delete from public.board_comment_likes
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_post_reactions
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_post_views
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_comments
   where regexp_replace(coalesce(author_resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_attachments
   where regexp_replace(coalesce(created_by_resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_posts where id = any(v_post_ids);

  if to_regclass('public.messages') is not null then
    execute $dynamic$
      delete from public.messages
       where regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g') = $1
          or regexp_replace(coalesce(receiver_id, ''), '[^0-9]', '', 'g') = $1
    $dynamic$
    using v_phone_digits;
  end if;

  delete from public.notifications
   where (cardinality(v_fc_ids) > 0 and fc_id = any(v_fc_ids))
      or regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.device_tokens
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.web_push_subscriptions
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.user_presence
   where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.notices
   where regexp_replace(coalesce(created_by, ''), '[^0-9]', '', 'g') = v_phone_digits;

  delete from public.referral_events
   where regexp_replace(coalesce(inviter_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      or regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.referral_attributions
   where regexp_replace(coalesce(inviter_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      or regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

  if p_target_role = 'manager' then
    delete from public.affiliation_manager_mappings
     where regexp_replace(coalesce(manager_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  end if;

  if cardinality(v_fc_ids) > 0 then
    delete from public.profiles where fc_id = any(v_fc_ids);
    delete from public.fc_profiles where id = any(v_fc_ids);
  end if;

  if p_target_role = 'admin' then
    delete from public.admin_accounts where id = p_target_id;
  elsif p_target_role = 'manager' then
    delete from public.manager_accounts where id = p_target_id;
  end if;
  get diagnostics v_deleted_count = row_count;

  if p_target_role = 'fc' then
    v_deleted_count := case
      when exists (select 1 from public.fc_profiles where id = p_target_id) then 0
      else 1
    end;
  end if;

  if v_deleted_count <> 1 then
    raise exception using errcode = 'P0002', message = 'account_delete_target_not_deleted';
  end if;

  insert into public.account_deletion_cleanup_outbox (
    cleanup_payload
  ) values (
    jsonb_build_object(
      'proof_paths', to_jsonb(v_proof_paths),
      'document_paths', to_jsonb(v_document_paths),
      'board_attachment_paths', to_jsonb(v_board_paths),
      'chat_file_urls', to_jsonb(v_chat_file_urls),
      'auth_user_ids', to_jsonb(v_auth_user_ids)
    )
  )
  returning id into v_cleanup_outbox_id;

  return jsonb_build_object(
    'deleted', true,
    'cleanup_outbox_id', v_cleanup_outbox_id,
    'proof_paths', to_jsonb(v_proof_paths),
    'document_paths', to_jsonb(v_document_paths),
    'board_attachment_paths', to_jsonb(v_board_paths),
    'chat_file_urls', to_jsonb(v_chat_file_urls),
    'auth_user_ids', to_jsonb(v_auth_user_ids)
  );
end;
$$;

revoke all on function public.delete_account_core_transaction_v1(
  text, uuid
) from public, anon, authenticated;
grant execute on function public.delete_account_core_transaction_v1(
  text, uuid
) to service_role;

-- Canonicalize the legacy direct-message table before v2 attachment columns are
-- added. Existing rows and public legacy file URLs are preserved for read-only
-- compatibility; all new writes remain service mediated.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null,
  receiver_id text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  is_read boolean not null default false,
  message_type text not null default 'text',
  file_url text,
  file_name text,
  file_size bigint,
  conversation_id uuid references public.garamin_direct_conversations(id) on delete set null,
  sender_actor_id uuid,
  receiver_actor_id uuid
);

alter table public.messages
  add column if not exists file_url text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_id uuid;

create table if not exists public.messenger_attachment_delivery_batches (
  id uuid primary key default gen_random_uuid(),
  delivery_key uuid not null,
  payload_fingerprint text not null
    check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null,
  actor_role text not null
    check (actor_role in ('fc', 'admin', 'manager')),
  context_kind text not null
    check (context_kind in ('direct', 'group', 'direct_broadcast')),
  conversation_id uuid references public.garamin_direct_conversations(id) on delete set null,
  room_id uuid references public.group_chat_rooms(id) on delete restrict,
  conversation_ids uuid[],
  generation integer not null default 1 check (generation > 0),
  status text not null default 'pending'
    check (status in ('pending', 'committed', 'expired', 'revoked', 'deleted')),
  expires_at timestamptz not null,
  committed_message_ids uuid[] not null default array[]::uuid[],
  notification_ids uuid[] not null default array[]::uuid[],
  committed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_id, actor_role, delivery_key),
  check (
    (
      context_kind = 'direct'
      and (
        conversation_id is not null
        or status in ('pending', 'expired', 'revoked', 'deleted')
      )
      and room_id is null
      and conversation_ids is null
    )
    or (
      context_kind = 'group'
      and room_id is not null
      and conversation_id is null
      and conversation_ids is null
    )
    or (
      context_kind = 'direct_broadcast'
      and conversation_id is null
      and room_id is null
      and cardinality(conversation_ids) between 1 and 200
    )
  )
);

create table if not exists public.messenger_attachment_upload_intents (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.messenger_attachment_delivery_batches(id) on delete cascade,
  generation integer not null check (generation > 0),
  client_file_id uuid not null,
  sort_order smallint not null check (sort_order between 0 and 9),
  original_name text not null
    check (
      char_length(original_name) between 1 and 255
      and original_name !~ '[[:cntrl:]/\\]'
    ),
  declared_mime_type text not null,
  expected_size bigint not null check (expected_size between 1 and 20971520),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  bucket_id text not null default 'messenger-attachments-v2'
    check (bucket_id = 'messenger-attachments-v2'),
  object_path text,
  status text not null default 'pending'
    check (status in ('pending', 'validated', 'consumed', 'revoked', 'expired')),
  inspected_family text,
  inspected_mime_type text,
  inspected_size bigint,
  inspected_sha256 text,
  expires_at timestamptz not null,
  validated_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, generation, client_file_id),
  unique (batch_id, generation, sort_order),
  check (
    (
      status = 'validated'
      and inspected_family is not null
      and inspected_mime_type is not null
      and inspected_size is not null
      and inspected_sha256 is not null
      and inspected_size = expected_size
      and inspected_sha256 = expected_sha256
      and validated_at is not null
    )
    or status <> 'validated'
  )
);

create unique index if not exists uq_messenger_attachment_upload_intents_path
  on public.messenger_attachment_upload_intents (bucket_id, object_path)
  where object_path is not null;

create table if not exists public.messenger_attachment_objects (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.messenger_attachment_delivery_batches(id) on delete restrict,
  sort_order smallint not null check (sort_order between 0 and 9),
  original_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_family text not null,
  bucket_id text check (bucket_id is null or bucket_id = 'messenger-attachments-v2'),
  storage_path text,
  reference_count integer not null default 1 check (reference_count >= 0),
  status text not null default 'active'
    check (status in ('active', 'tombstoned', 'deleted')),
  created_at timestamptz not null default now(),
  tombstoned_at timestamptz,
  deleted_at timestamptz,
  unique (batch_id, sort_order)
);

create unique index if not exists uq_messenger_attachment_objects_path
  on public.messenger_attachment_objects (bucket_id, storage_path)
  where storage_path is not null;

create table if not exists public.messenger_message_attachments (
  batch_id uuid not null
    references public.messenger_attachment_delivery_batches(id) on delete restrict,
  attachment_id uuid not null
    references public.messenger_attachment_objects(id) on delete restrict,
  sort_order smallint not null check (sort_order between 0 and 9),
  created_at timestamptz not null default now(),
  primary key (batch_id, attachment_id),
  unique (batch_id, sort_order)
);

create table if not exists public.messenger_attachment_cleanup_outbox (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid,
  batch_id uuid,
  bucket_id text,
  storage_path text,
  reason_code text not null,
  sweep_phase text not null check (sweep_phase in ('immediate', 'post_token_expiry')),
  not_before timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 12 check (max_attempts between 1 and 100),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'exhausted')),
  locked_at timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('pending', 'processing', 'exhausted') and bucket_id is not null and storage_path is not null)
    or status = 'completed'
  )
);

create unique index if not exists uq_messenger_attachment_cleanup_path_phase
  on public.messenger_attachment_cleanup_outbox (bucket_id, storage_path, sweep_phase)
  where bucket_id is not null and storage_path is not null;

create index if not exists idx_messenger_attachment_cleanup_due
  on public.messenger_attachment_cleanup_outbox (status, not_before, created_at)
  where status in ('pending', 'processing');

create table if not exists public.messenger_attachment_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  original_name text not null,
  byte_size bigint not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  reason_code text not null,
  deleted_at timestamptz not null default now()
);

alter table public.messages
  add column if not exists attachment_batch_id uuid
    references public.messenger_attachment_delivery_batches(id) on delete restrict;

alter table public.group_chat_messages
  add column if not exists attachment_batch_id uuid
    references public.messenger_attachment_delivery_batches(id) on delete restrict;

-- The original table-level check allowed only text or a legacy public URL.
-- Replace that exact generated constraint so an attachment-only v2 message can
-- carry a private batch reference without a public URL.
alter table public.group_chat_messages
  drop constraint if exists group_chat_messages_check;
alter table public.group_chat_messages
  add constraint group_chat_messages_content_or_attachment_check check (
    char_length(trim(content)) > 0
    or (message_type in ('image', 'file') and file_url is not null)
    or attachment_batch_id is not null
  );

create index if not exists idx_messages_attachment_batch
  on public.messages (attachment_batch_id)
  where attachment_batch_id is not null;
create index if not exists idx_group_chat_messages_attachment_batch
  on public.group_chat_messages (attachment_batch_id)
  where attachment_batch_id is not null;
create index if not exists idx_messenger_attachment_batches_actor_pending
  on public.messenger_attachment_delivery_batches (actor_id, actor_role, expires_at)
  where status = 'pending';
create index if not exists idx_messenger_attachment_intents_batch_generation
  on public.messenger_attachment_upload_intents (batch_id, generation, sort_order);
create index if not exists idx_messenger_attachment_objects_batch
  on public.messenger_attachment_objects (batch_id, sort_order);

alter table public.messages enable row level security;
alter table public.messenger_attachment_delivery_batches enable row level security;
alter table public.messenger_attachment_upload_intents enable row level security;
alter table public.messenger_attachment_objects enable row level security;
alter table public.messenger_message_attachments enable row level security;
alter table public.messenger_attachment_cleanup_outbox enable row level security;
alter table public.messenger_attachment_deletion_audit enable row level security;

revoke all privileges on table public.messages
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_attachment_delivery_batches
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_attachment_upload_intents
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_attachment_objects
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_message_attachments
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_attachment_cleanup_outbox
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_attachment_deletion_audit
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.messages to service_role;
grant select, insert, update, delete
  on table public.messenger_attachment_delivery_batches to service_role;
grant select, insert, update, delete
  on table public.messenger_attachment_upload_intents to service_role;
grant select, insert, update, delete
  on table public.messenger_attachment_objects to service_role;
grant select, insert, update, delete
  on table public.messenger_message_attachments to service_role;
grant select, insert, update, delete
  on table public.messenger_attachment_cleanup_outbox to service_role;
grant select, insert, update, delete
  on table public.messenger_attachment_deletion_audit to service_role;

do $messages_policies$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'messages'
  loop
    execute format('drop policy if exists %I on public.messages', v_policy.policyname);
  end loop;
end;
$messages_policies$;
create policy "messages service role only"
  on public.messages
  for all to service_role using (true) with check (true);

drop policy if exists "messenger attachment batches service role"
  on public.messenger_attachment_delivery_batches;
create policy "messenger attachment batches service role"
  on public.messenger_attachment_delivery_batches
  for all to service_role using (true) with check (true);
drop policy if exists "messenger attachment intents service role"
  on public.messenger_attachment_upload_intents;
create policy "messenger attachment intents service role"
  on public.messenger_attachment_upload_intents
  for all to service_role using (true) with check (true);
drop policy if exists "messenger attachment objects service role"
  on public.messenger_attachment_objects;
create policy "messenger attachment objects service role"
  on public.messenger_attachment_objects
  for all to service_role using (true) with check (true);
drop policy if exists "messenger message attachments service role"
  on public.messenger_message_attachments;
create policy "messenger message attachments service role"
  on public.messenger_message_attachments
  for all to service_role using (true) with check (true);
drop policy if exists "messenger attachment cleanup service role"
  on public.messenger_attachment_cleanup_outbox;
create policy "messenger attachment cleanup service role"
  on public.messenger_attachment_cleanup_outbox
  for all to service_role using (true) with check (true);
drop policy if exists "messenger attachment audit service role"
  on public.messenger_attachment_deletion_audit;
create policy "messenger attachment audit service role"
  on public.messenger_attachment_deletion_audit
  for all to service_role using (true) with check (true);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'messenger-attachments-v2',
  'messenger-attachments-v2',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "messenger attachments v2 service read" on storage.objects;
create policy "messenger attachments v2 service read"
  on storage.objects for select to service_role
  using (bucket_id = 'messenger-attachments-v2');
drop policy if exists "messenger attachments v2 service insert" on storage.objects;
create policy "messenger attachments v2 service insert"
  on storage.objects for insert to service_role
  with check (bucket_id = 'messenger-attachments-v2');
drop policy if exists "messenger attachments v2 service update" on storage.objects;
create policy "messenger attachments v2 service update"
  on storage.objects for update to service_role
  using (bucket_id = 'messenger-attachments-v2')
  with check (bucket_id = 'messenger-attachments-v2');
drop policy if exists "messenger attachments v2 service delete" on storage.objects;
create policy "messenger attachments v2 service delete"
  on storage.objects for delete to service_role
  using (bucket_id = 'messenger-attachments-v2');

create or replace function public.reserve_messenger_attachment_upload_batch_v2(
  p_actor_id uuid,
  p_actor_role text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_context jsonb,
  p_files jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz := v_now + interval '2 hours';
  v_context_kind text;
  v_conversation_id uuid;
  v_room_id uuid;
  v_conversation_ids uuid[];
  v_actor_phone text;
  v_actor_valid boolean := false;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_file jsonb;
  v_file_count integer;
  v_file_bytes bigint := 0;
  v_order integer := 0;
  v_client_file_id uuid;
  v_name text;
  v_size bigint;
  v_mime text;
  v_sha256 text;
  v_extension text;
  v_expected_mime text;
  v_canonical_files jsonb := '[]'::jsonb;
  v_existing_files jsonb;
  v_active_files bigint;
  v_active_bytes bigint;
  v_recent_files bigint;
  v_recent_batches bigint;
  v_generation integer;
  v_intent_id uuid;
  v_lock_conversation_id uuid;
  v_context_canonical jsonb;
  v_result_intents jsonb;
begin
  if p_actor_id is null
     or p_delivery_key is null
     or p_actor_role not in ('fc', 'admin', 'manager')
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_context is null
     or jsonb_typeof(p_context) <> 'object'
     or p_files is null
     or jsonb_typeof(p_files) <> 'array' then
    raise exception 'invalid_attachment_intent_request';
  end if;

  -- Serialize quota accounting per immutable actor. Concurrent signed-intent
  -- creation cannot race past the active-byte/file or issuance-window limits.
  perform pg_advisory_xact_lock(
    hashtextextended(p_actor_role || ':' || p_actor_id::text, 0)
  );

  if p_actor_role = 'fc' then
    select profile.phone,
           profile.signup_completed = true
           and coalesce(profile.is_manager_referral_shadow, false) = false
           and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
           and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
      into v_actor_phone, v_actor_valid
      from public.fc_profiles profile
     where profile.id = p_actor_id;
  elsif p_actor_role = 'manager' then
    select account.phone, account.active = true
      into v_actor_phone, v_actor_valid
      from public.manager_accounts account
     where account.id = p_actor_id;
  else
    select account.phone,
           account.active = true
           and coalesce(account.staff_type, 'admin') in ('admin', 'developer')
      into v_actor_phone, v_actor_valid
      from public.admin_accounts account
     where account.id = p_actor_id;
  end if;
  if not coalesce(v_actor_valid, false) then
    raise exception 'attachment_actor_not_active';
  end if;

  v_context_kind := p_context->>'kind';
  if v_context_kind = 'direct' then
    begin
      v_conversation_id := (p_context->>'conversationId')::uuid;
    exception when others then
      raise exception 'invalid_attachment_context';
    end;
    perform pg_advisory_xact_lock(
      hashtextextended(
        'messenger-direct-context:' || v_conversation_id::text,
        0
      )
    );
    if not exists (
         select 1
           from public.garamin_direct_conversations conversation
           join public.fc_profiles profile
             on profile.id = conversation.fc_id
            and profile.signup_completed = true
            and coalesce(profile.is_manager_referral_shadow, false) = false
            and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
            and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
          where conversation.id = v_conversation_id
            and (
              p_actor_role in ('admin', 'manager')
              or (p_actor_role = 'fc' and conversation.fc_id = p_actor_id)
            )
       ) then
      raise exception 'attachment_context_forbidden';
    end if;
    v_context_canonical := jsonb_build_object(
      'kind', 'direct',
      'conversationId', v_conversation_id::text
    );
  elsif v_context_kind = 'group' then
    begin
      v_room_id := (p_context->>'roomId')::uuid;
    exception when others then
      raise exception 'invalid_attachment_context';
    end;
    if not exists (
      select 1 from public.group_chat_rooms room
       where room.id = v_room_id and room.is_active = true
    ) then
      raise exception 'attachment_context_not_found';
    end if;
    if p_actor_role = 'fc'
       and not exists (
         select 1
           from public.group_chat_member_send_permissions permission
          where permission.room_id = v_room_id
            and permission.actor_id = 'fc:' || regexp_replace(v_actor_phone, '[^0-9]', '', 'g')
            and permission.can_send_messages = true
       ) then
      raise exception 'attachment_context_forbidden';
    end if;
    v_context_canonical := jsonb_build_object(
      'kind', 'group',
      'roomId', v_room_id::text
    );
  elsif v_context_kind = 'direct_broadcast' then
    if p_actor_role <> 'admin'
       or jsonb_typeof(p_context->'conversationIds') <> 'array'
       or jsonb_array_length(p_context->'conversationIds') not between 1 and 200 then
      raise exception 'attachment_context_forbidden';
    end if;
    begin
      select array_agg(value::uuid order by value::uuid)
        into v_conversation_ids
        from (
          select distinct jsonb_array_elements_text(p_context->'conversationIds') as value
        ) requested;
    exception when others then
      raise exception 'invalid_attachment_context';
    end;
    for v_lock_conversation_id in
      select conversation_id
        from unnest(v_conversation_ids) requested(conversation_id)
       order by conversation_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(
          'messenger-direct-context:' || v_lock_conversation_id::text,
          0
        )
      );
    end loop;
    if cardinality(v_conversation_ids) <> jsonb_array_length(p_context->'conversationIds')
       or exists (
         select 1
           from unnest(v_conversation_ids) requested(conversation_id)
           left join public.garamin_direct_conversations conversation
             on conversation.id = requested.conversation_id
           left join public.fc_profiles profile
             on profile.id = conversation.fc_id
            and profile.signup_completed = true
            and coalesce(profile.is_manager_referral_shadow, false) = false
            and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
            and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
          where conversation.id is null or profile.id is null
       ) then
      raise exception 'attachment_context_not_found';
    end if;
    v_context_canonical := jsonb_build_object(
      'kind', 'direct_broadcast',
      'conversationIds', to_jsonb(v_conversation_ids)
    );
  else
    raise exception 'invalid_attachment_context';
  end if;

  v_file_count := jsonb_array_length(p_files);
  if v_file_count not between 1 and 10 then
    raise exception 'invalid_attachment_file_count';
  end if;

  for v_file in select value from jsonb_array_elements(p_files)
  loop
    begin
      v_client_file_id := (v_file->>'clientFileId')::uuid;
      v_size := (v_file->>'size')::bigint;
    exception when others then
      raise exception 'invalid_attachment_file_metadata';
    end;
    v_name := normalize(v_file->>'name', NFC);
    v_mime := lower(btrim(v_file->>'mimeType'));
    v_sha256 := lower(btrim(v_file->>'sha256'));
    v_extension := lower(substring(v_name from '(\.[^.]+)$'));
    v_expected_mime := case v_extension
      when '.jpg' then 'image/jpeg'
      when '.jpeg' then 'image/jpeg'
      when '.png' then 'image/png'
      when '.webp' then 'image/webp'
      when '.gif' then 'image/gif'
      when '.bmp' then 'image/bmp'
      when '.heic' then 'image/heic'
      when '.heif' then 'image/heif'
      when '.pdf' then 'application/pdf'
      when '.doc' then 'application/msword'
      when '.docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      when '.xls' then 'application/vnd.ms-excel'
      when '.xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      when '.ppt' then 'application/vnd.ms-powerpoint'
      when '.pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      when '.txt' then 'text/plain'
      else null
    end;
    if v_name is null
       or char_length(v_name) not between 1 and 255
       or v_name ~ '[[:cntrl:]/\\]'
       or v_size not between 1 and 20971520
       or v_sha256 !~ '^[0-9a-f]{64}$'
       or v_expected_mime is null
       or v_mime <> v_expected_mime then
      raise exception 'invalid_attachment_file_metadata';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(v_canonical_files) existing
       where existing->>'clientFileId' = v_client_file_id::text
    ) then
      raise exception 'invalid_attachment_duplicate_file';
    end if;
    v_file_bytes := v_file_bytes + v_size;
    v_canonical_files := v_canonical_files || jsonb_build_array(jsonb_build_object(
      'clientFileId', v_client_file_id::text,
      'name', v_name,
      'size', v_size,
      'mimeType', v_mime,
      'sha256', v_sha256,
      'order', v_order
    ));
    v_order := v_order + 1;
  end loop;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
     and batch.delivery_key = p_delivery_key
   for update;

  if v_batch.id is not null then
    if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
       or v_batch.context_kind <> v_context_kind
       or v_batch.conversation_id is distinct from v_conversation_id
       or v_batch.room_id is distinct from v_room_id
       or v_batch.conversation_ids is distinct from v_conversation_ids then
      raise exception 'attachment_idempotency_conflict';
    end if;
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'clientFileId', intent.client_file_id::text,
          'name', intent.original_name,
          'size', intent.expected_size,
          'mimeType', intent.declared_mime_type,
          'sha256', intent.expected_sha256,
          'order', intent.sort_order
        )
        order by intent.sort_order
      ),
      '[]'::jsonb
    )
      into v_existing_files
      from public.messenger_attachment_upload_intents intent
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation;
    if v_existing_files <> v_canonical_files then
      raise exception 'attachment_idempotency_conflict';
    end if;
    if v_batch.status = 'committed' then
      return jsonb_build_object(
        'state', 'committed',
        'batchId', v_batch.id,
        'deliveryKey', v_batch.delivery_key,
        'payloadFingerprint', v_batch.payload_fingerprint,
        'messageIds', to_jsonb(v_batch.committed_message_ids)
      );
    end if;
    if v_batch.status = 'pending' and v_batch.expires_at > v_now then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', intent.id,
            'clientFileId', intent.client_file_id,
            'order', intent.sort_order,
            'bucket', intent.bucket_id,
            'path', intent.object_path
          )
          order by intent.sort_order
        ),
        '[]'::jsonb
      )
        into v_result_intents
        from public.messenger_attachment_upload_intents intent
       where intent.batch_id = v_batch.id
         and intent.generation = v_batch.generation
         and intent.status in ('pending', 'validated');
      return jsonb_build_object(
        'state', 'pending',
        'batchId', v_batch.id,
        'deliveryKey', v_batch.delivery_key,
        'payloadFingerprint', v_batch.payload_fingerprint,
        'expiresAt', v_batch.expires_at,
        'intents', v_result_intents
      );
    end if;
    if v_batch.status in ('revoked', 'deleted') then
      raise exception 'attachment_idempotency_conflict';
    end if;

    insert into public.messenger_attachment_cleanup_outbox (
      batch_id, bucket_id, storage_path, reason_code, sweep_phase, not_before
    )
    select intent.batch_id,
           intent.bucket_id,
           intent.object_path,
           'expired_or_renewed_intent',
           phase.sweep_phase,
           case phase.sweep_phase
             when 'immediate' then v_now
             else greatest(intent.expires_at, v_now) + interval '5 minutes'
           end
      from public.messenger_attachment_upload_intents intent
      cross join (
        values ('immediate'::text), ('post_token_expiry'::text)
      ) phase(sweep_phase)
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
       and intent.object_path is not null
    on conflict (bucket_id, storage_path, sweep_phase)
      where bucket_id is not null and storage_path is not null
    do update set
      not_before = least(
        public.messenger_attachment_cleanup_outbox.not_before,
        excluded.not_before
      ),
      status = case
        when public.messenger_attachment_cleanup_outbox.status = 'completed'
          then 'pending'
        else public.messenger_attachment_cleanup_outbox.status
      end,
      completed_at = null,
      updated_at = v_now;

    update public.messenger_attachment_upload_intents
       set status = 'expired',
           object_path = null,
           updated_at = v_now
     where batch_id = v_batch.id
       and generation = v_batch.generation;
    v_generation := v_batch.generation + 1;
  else
    v_generation := 1;
  end if;

  select count(*), coalesce(sum(intent.expected_size), 0)
    into v_active_files, v_active_bytes
    from public.messenger_attachment_upload_intents intent
    join public.messenger_attachment_delivery_batches batch
      on batch.id = intent.batch_id
   where batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
     and batch.status = 'pending'
     and batch.expires_at > v_now
     and (v_batch.id is null or batch.id <> v_batch.id)
     and intent.status in ('pending', 'validated');
  if v_active_files + v_file_count > 50
     or v_active_bytes + v_file_bytes > 209715200 then
    raise exception 'attachment_active_quota_exceeded';
  end if;

  select count(*),
         count(distinct intent.batch_id::text || ':' || intent.generation::text)
    into v_recent_files, v_recent_batches
    from public.messenger_attachment_upload_intents intent
    join public.messenger_attachment_delivery_batches batch
      on batch.id = intent.batch_id
   where batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
     and intent.created_at >= v_now - interval '1 hour';
  if v_recent_files + v_file_count > 100
     or v_recent_batches + 1 > 20 then
    raise exception 'attachment_intent_rate_limited';
  end if;

  if v_batch.id is null then
    insert into public.messenger_attachment_delivery_batches (
      delivery_key,
      payload_fingerprint,
      actor_id,
      actor_role,
      context_kind,
      conversation_id,
      room_id,
      conversation_ids,
      generation,
      status,
      expires_at,
      created_at,
      updated_at
    )
    values (
      p_delivery_key,
      p_payload_fingerprint,
      p_actor_id,
      p_actor_role,
      v_context_kind,
      v_conversation_id,
      v_room_id,
      v_conversation_ids,
      v_generation,
      'pending',
      v_expires_at,
      v_now,
      v_now
    )
    returning * into v_batch;
  else
    update public.messenger_attachment_delivery_batches
       set generation = v_generation,
           status = 'pending',
           expires_at = v_expires_at,
           updated_at = v_now
     where id = v_batch.id
    returning * into v_batch;
  end if;

  for v_file in select value from jsonb_array_elements(v_canonical_files)
  loop
    v_intent_id := gen_random_uuid();
    insert into public.messenger_attachment_upload_intents (
      id,
      batch_id,
      generation,
      client_file_id,
      sort_order,
      original_name,
      declared_mime_type,
      expected_size,
      expected_sha256,
      bucket_id,
      object_path,
      status,
      expires_at,
      created_at,
      updated_at
    )
    values (
      v_intent_id,
      v_batch.id,
      v_generation,
      (v_file->>'clientFileId')::uuid,
      (v_file->>'order')::smallint,
      v_file->>'name',
      v_file->>'mimeType',
      (v_file->>'size')::bigint,
      v_file->>'sha256',
      'messenger-attachments-v2',
      'uploads/' || v_batch.id::text || '/' || v_generation::text || '/' || v_intent_id::text,
      'pending',
      v_expires_at,
      v_now,
      v_now
    );
  end loop;

  select jsonb_agg(
    jsonb_build_object(
      'id', intent.id,
      'clientFileId', intent.client_file_id,
      'order', intent.sort_order,
      'bucket', intent.bucket_id,
      'path', intent.object_path
    )
    order by intent.sort_order
  )
    into v_result_intents
    from public.messenger_attachment_upload_intents intent
   where intent.batch_id = v_batch.id
     and intent.generation = v_generation;

  return jsonb_build_object(
    'state', 'pending',
    'batchId', v_batch.id,
    'deliveryKey', v_batch.delivery_key,
    'payloadFingerprint', v_batch.payload_fingerprint,
    'expiresAt', v_batch.expires_at,
    'intents', coalesce(v_result_intents, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) to service_role;

-- Server-owned notification preferences. Mobile clients can only reach these
-- tables through signed Edge Functions which derive the immutable actor tuple.
create table if not exists public.app_push_preferences (
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('fc', 'manager', 'admin')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, actor_role)
);

create table if not exists public.app_push_category_preferences (
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('fc', 'manager', 'admin')),
  category text not null check (category in ('messages', 'request_activity', 'notices', 'operations')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, actor_role, category)
);

create table if not exists public.messenger_room_notification_preferences (
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('fc', 'manager', 'admin')),
  room_key text not null check (
    room_key ~ '^garamin:(direct-thread|group):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, actor_role, room_key)
);

create or replace function public.prevent_notification_preference_actor_tuple_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.actor_id is distinct from old.actor_id
     or new.actor_role is distinct from old.actor_role then
    raise exception 'notification_preference_actor_tuple_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_notification_preference_actor_tuple_change()
  from public, anon, authenticated;
grant execute on function public.prevent_notification_preference_actor_tuple_change()
  to service_role;

drop trigger if exists app_push_preferences_actor_tuple_immutable
  on public.app_push_preferences;
create trigger app_push_preferences_actor_tuple_immutable
  before update on public.app_push_preferences
  for each row execute function public.prevent_notification_preference_actor_tuple_change();

drop trigger if exists app_push_category_preferences_actor_tuple_immutable
  on public.app_push_category_preferences;
create trigger app_push_category_preferences_actor_tuple_immutable
  before update on public.app_push_category_preferences
  for each row execute function public.prevent_notification_preference_actor_tuple_change();

drop trigger if exists messenger_room_preferences_actor_tuple_immutable
  on public.messenger_room_notification_preferences;
create trigger messenger_room_preferences_actor_tuple_immutable
  before update on public.messenger_room_notification_preferences
  for each row execute function public.prevent_notification_preference_actor_tuple_change();

create index if not exists idx_app_push_category_preferences_actor
  on public.app_push_category_preferences (actor_id, actor_role);

create index if not exists idx_messenger_room_notification_preferences_actor
  on public.messenger_room_notification_preferences (actor_id, actor_role, muted);

alter table public.app_push_preferences enable row level security;
alter table public.app_push_category_preferences enable row level security;
alter table public.messenger_room_notification_preferences enable row level security;

revoke all on table public.app_push_preferences from public, anon, authenticated;
revoke all on table public.app_push_category_preferences from public, anon, authenticated;
revoke all on table public.messenger_room_notification_preferences from public, anon, authenticated;
grant all on table public.app_push_preferences to service_role;
grant all on table public.app_push_category_preferences to service_role;
grant all on table public.messenger_room_notification_preferences to service_role;

drop policy if exists "app_push_preferences service role" on public.app_push_preferences;
create policy "app_push_preferences service role"
  on public.app_push_preferences
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "app_push_category_preferences service role" on public.app_push_category_preferences;
create policy "app_push_category_preferences service role"
  on public.app_push_category_preferences
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "messenger_room_notification_preferences service role" on public.messenger_room_notification_preferences;
create policy "messenger_room_notification_preferences service role"
  on public.messenger_room_notification_preferences
  for all
  to service_role
  using (true)
  with check (true);

-- Messenger hub row actions (pin and non-destructive leave).
alter table public.messenger_room_notification_preferences
  add column if not exists pinned_at timestamptz,
  add column if not exists left_at timestamptz;

create index if not exists idx_messenger_room_preferences_pinned
  on public.messenger_room_notification_preferences (actor_id, actor_role, pinned_at desc)
  where pinned_at is not null;

-- Compatibility backfill: the canonical room preference table becomes the
-- single source of truth while retaining existing group-chat mute choices.
insert into public.messenger_room_notification_preferences (
  actor_id,
  actor_role,
  room_key,
  muted,
  updated_at
)
select resolved.actor_id,
       resolved.actor_role,
       'garamin:group:' || preferences.room_id::text,
       preferences.muted,
       preferences.updated_at
from public.group_chat_preferences preferences
join lateral (
  select fc.id as actor_id, 'fc'::text as actor_role
  from public.fc_profiles fc
  where preferences.actor_id = 'fc:' || regexp_replace(fc.phone, '[^0-9]', '', 'g')
  union all
  select manager.id, 'manager'::text
  from public.manager_accounts manager
  where preferences.actor_id = 'manager:' || regexp_replace(manager.phone, '[^0-9]', '', 'g')
  union all
  select admin.id, 'admin'::text
  from public.admin_accounts admin
  where preferences.actor_id = 'admin:' || regexp_replace(admin.phone, '[^0-9]', '', 'g')
) resolved on true
on conflict (actor_id, actor_role, room_key) do update
set muted = excluded.muted,
    updated_at = excluded.updated_at;

-- BEGIN 20260804081357_exam_round_month_for_tbd canonical parity block
-- Canonical month ownership for exam rounds, including date-TBD rounds.
-- The migration preserves history and aborts rather than guessing whenever
-- existing registrations do not determine one unambiguous month.

alter table public.exam_rounds
  add column if not exists exam_month date;

alter table public.exam_registrations
  add column if not exists exam_type text;

-- Registration type is a durable snapshot derived only from its referenced
-- round. Never infer it from labels, subjects, or caller input.
update public.exam_registrations registration
   set exam_type = round_row.exam_type
  from public.exam_rounds round_row
 where round_row.id = registration.round_id
   and registration.exam_type is null;

update public.exam_rounds
   set exam_month = date_trunc('month', exam_date)::date
 where exam_date is not null
   and exam_month is null;

-- A referenced TBD round inherits its month only when every registration
-- agrees on exactly one already-recorded month.
with registered_round_months as (
  select
    round_row.id as round_id,
    min(registration.exam_month) as resolved_exam_month,
    count(distinct registration.exam_month) as distinct_exam_month_count
  from public.exam_rounds round_row
  join public.exam_registrations registration
    on registration.round_id = round_row.id
  where round_row.exam_date is null
    and round_row.exam_month is null
    and registration.exam_month is not null
  group by round_row.id
)
update public.exam_rounds round_row
   set exam_month = resolved.resolved_exam_month
  from registered_round_months resolved
 where round_row.id = resolved.round_id
   and resolved.distinct_exam_month_count = 1;

-- Only unused legacy TBD rounds may fall back to their label. The expression
-- accepts a leading `YY년 M월`, `YYYY년 M월`, or `M월`. When the year is
-- omitted, choose the first matching month on or after the deadline month so
-- December -> January resolves across the year boundary deterministically.
with parsed_unused_tbd_rounds as (
  select
    round_row.id as round_id,
    round_row.registration_deadline,
    regexp_match(
      btrim(coalesce(round_row.round_label, '')),
      '^(?:([0-9]{2}|[0-9]{4})년[[:space:]]*)?([0-9]{1,2})월(?:[[:space:]]|$)'
    ) as date_parts
  from public.exam_rounds round_row
  where round_row.exam_date is null
    and round_row.exam_month is null
    and not exists (
      select 1
        from public.exam_registrations registration
       where registration.round_id = round_row.id
    )
),
resolved_unused_tbd_rounds as (
  select
    round_id,
    registration_deadline,
    case
      when date_parts[1] is null
        then extract(year from registration_deadline)::integer
      when char_length(date_parts[1]) = 2
        then 2000 + date_parts[1]::integer
      else date_parts[1]::integer
    end as base_year,
    date_parts[1] is null as year_was_omitted,
    date_parts[2]::integer as exam_month_number
  from parsed_unused_tbd_rounds
  where date_parts is not null
),
canonical_unused_tbd_rounds as (
  select
    round_id,
    case
      when year_was_omitted
       and exam_month_number < extract(month from registration_deadline)::integer
        then make_date(base_year + 1, exam_month_number, 1)
      else make_date(base_year, exam_month_number, 1)
    end as resolved_exam_month
  from resolved_unused_tbd_rounds
  where base_year between 2000 and 2100
    and exam_month_number between 1 and 12
)
update public.exam_rounds round_row
   set exam_month = resolved.resolved_exam_month
  from canonical_unused_tbd_rounds resolved
 where round_row.id = resolved.round_id;

do $exam_round_month_preflight$
begin
  if exists (
    select 1
      from public.exam_rounds round_row
     where round_row.exam_month is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_round_month_backfill_unresolved';
  end if;

  if exists (
    select 1
      from public.exam_registrations registration
      join public.exam_rounds round_row
        on round_row.id = registration.round_id
     where registration.status in ('applied', 'confirmed', 'completed', 'no_show')
       and registration.exam_month is distinct from round_row.exam_month
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_round_month_active_registration_drift';
  end if;

  if exists (
    select 1
      from public.exam_registrations registration
     where registration.exam_type is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_registration_type_backfill_unresolved';
  end if;

  if exists (
    select 1
      from public.exam_registrations registration
     where not exists (
       select 1
         from public.exam_rounds round_row
        where round_row.id = registration.round_id
          and round_row.exam_type = registration.exam_type
     )
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_registration_round_type_drift';
  end if;

  if exists (
    select 1
      from public.exam_registrations registration
     where registration.fc_id is not null
       and registration.status in ('applied', 'confirmed', 'completed', 'no_show')
       and registration.monthly_slot_policy_version = 1
     group by registration.fc_id, registration.exam_month, registration.exam_type
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'exam_registration_type_active_collision';
  end if;

end
$exam_round_month_preflight$;

alter table public.exam_rounds
  alter column exam_month set not null;

alter table public.exam_rounds
  drop constraint if exists exam_rounds_exam_month_start_check;
alter table public.exam_rounds
  add constraint exam_rounds_exam_month_start_check
  check (exam_month = date_trunc('month', exam_month)::date);

alter table public.exam_rounds
  drop constraint if exists exam_rounds_exam_date_month_check;
alter table public.exam_rounds
  add constraint exam_rounds_exam_date_month_check
  check (
    exam_date is null
    or exam_month = date_trunc('month', exam_date)::date
  );

alter table public.exam_registrations
  alter column exam_type set not null;

alter table public.exam_registrations
  drop constraint if exists exam_registrations_exam_type_check;
alter table public.exam_registrations
  add constraint exam_registrations_exam_type_check
  check (exam_type in ('life', 'nonlife'));

create unique index if not exists idx_exam_rounds_id_exam_type
  on public.exam_rounds (id, exam_type);

alter table public.exam_registrations
  drop constraint if exists exam_registrations_round_exam_type_fkey;
alter table public.exam_registrations
  add constraint exam_registrations_round_exam_type_fkey
  foreign key (round_id, exam_type)
  references public.exam_rounds (id, exam_type)
  on delete restrict;

drop index if exists public.idx_exam_registrations_active_fc_exam_month;
drop index if exists public.idx_exam_registrations_active_fc_exam_month_type;

create unique index idx_exam_registrations_active_fc_exam_month_type
  on public.exam_registrations (fc_id, exam_month, exam_type)
  where status in ('applied', 'confirmed', 'completed', 'no_show')
    and monthly_slot_policy_version = 1;

create or replace function public.save_exam_round_atomic_v2(
  p_round_id uuid,
  p_exam_date date,
  p_exam_month date,
  p_registration_deadline date,
  p_round_label text,
  p_exam_type text,
  p_notes text,
  p_locations text[]
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_round_id uuid;
  v_location_id uuid;
  v_location_name text;
  v_location_position bigint;
  v_locations text[];
  v_location_count integer;
  v_distinct_location_count integer;
  v_updated_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_registration_deadline is null then
    raise exception 'registration deadline required' using errcode = '22023';
  end if;
  if p_exam_month is null
     or p_exam_month <> date_trunc('month', p_exam_month)::date then
    raise exception 'invalid exam month' using errcode = '22023';
  end if;
  if p_exam_date is not null
     and p_exam_month <> date_trunc('month', p_exam_date)::date then
    raise exception 'exam date and month mismatch' using errcode = '22023';
  end if;
  if p_exam_date is not null and p_registration_deadline > p_exam_date then
    raise exception 'registration deadline cannot follow exam date' using errcode = '22023';
  end if;
  if p_round_label is null
     or btrim(p_round_label) = ''
     or char_length(btrim(p_round_label)) > 120 then
    raise exception 'invalid round label' using errcode = '22023';
  end if;
  if p_exam_type not in ('life', 'nonlife') then
    raise exception 'invalid exam type' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'invalid notes' using errcode = '22023';
  end if;

  v_location_count := coalesce(cardinality(p_locations), 0);
  if v_location_count < 1 or v_location_count > 50 then
    raise exception 'invalid location count' using errcode = '22023';
  end if;
  if exists (
    select 1
      from unnest(p_locations) as requested(location_name)
     where requested.location_name is null
        or btrim(requested.location_name) = ''
        or char_length(btrim(requested.location_name)) > 120
  ) then
    raise exception 'invalid location name' using errcode = '22023';
  end if;

  select array_agg(btrim(requested.location_name) order by requested.position),
         count(distinct btrim(requested.location_name))::integer
    into v_locations, v_distinct_location_count
    from unnest(p_locations) with ordinality as requested(location_name, position);

  if v_distinct_location_count <> v_location_count then
    raise exception 'duplicate location name' using errcode = '22023';
  end if;

  if p_round_id is null then
    insert into public.exam_rounds (
      exam_date,
      exam_month,
      registration_deadline,
      round_label,
      exam_type,
      notes
    ) values (
      p_exam_date,
      p_exam_month,
      p_registration_deadline,
      btrim(p_round_label),
      p_exam_type,
      p_notes
    )
    returning id into v_round_id;
  else
    update public.exam_rounds
       set exam_date = p_exam_date,
           exam_month = p_exam_month,
           registration_deadline = p_registration_deadline,
           round_label = btrim(p_round_label),
           exam_type = p_exam_type,
           notes = p_notes
     where id = p_round_id;

    get diagnostics v_updated_count = row_count;
    if v_updated_count <> 1 then
      raise exception 'exam round not found' using errcode = 'P0002';
    end if;
    v_round_id := p_round_id;
  end if;

  for v_location_name, v_location_position in
    select requested.location_name, requested.position
      from unnest(v_locations) with ordinality as requested(location_name, position)
  loop
    v_location_id := null;
    select location.id
      into v_location_id
      from public.exam_locations location
     where location.round_id = v_round_id
       and location.location_name = v_location_name
     order by location.created_at, location.id
     limit 1
     for update;

    if v_location_id is null then
      insert into public.exam_locations (round_id, location_name, sort_order)
      values (v_round_id, v_location_name, (v_location_position - 1)::integer);
    else
      update public.exam_locations
         set sort_order = (v_location_position - 1)::integer
       where id = v_location_id;
    end if;
  end loop;

  delete from public.exam_locations location
   where location.round_id = v_round_id
     and not (btrim(location.location_name) = any(v_locations))
     and not exists (
       select 1
         from public.exam_registrations registration
        where registration.location_id = location.id
     );

  return v_round_id;
end;
$$;

revoke all on function public.save_exam_round_atomic_v2(
  uuid, date, date, date, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.save_exam_round_atomic_v2(
  uuid, date, date, date, text, text, text, text[]
) to service_role;

create or replace function public.save_exam_round_atomic(
  p_round_id uuid,
  p_exam_date date,
  p_registration_deadline date,
  p_round_label text,
  p_exam_type text,
  p_notes text,
  p_locations text[]
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_month date;
  v_existing_exam_date date;
begin
  if p_round_id is not null then
    select round_row.exam_date,
           round_row.exam_month
      into v_existing_exam_date,
           v_exam_month
      from public.exam_rounds round_row
     where round_row.id = p_round_id;

    if not found then
      raise exception 'exam round not found' using errcode = 'P0002';
    end if;

    if v_existing_exam_date is null
       and p_exam_date is not null then
      raise exception using
        errcode = '22023',
        message = 'exam_month_required_for_tbd_round';
    end if;
  end if;

  if p_exam_date is not null then
    v_exam_month := date_trunc('month', p_exam_date)::date;
  end if;

  if v_exam_month is null then
    raise exception using
      errcode = '22023',
      message = 'exam_month_required_for_tbd_round';
  end if;

  return public.save_exam_round_atomic_v2(
    p_round_id,
    p_exam_date,
    v_exam_month,
    p_registration_deadline,
    p_round_label,
    p_exam_type,
    p_notes,
    p_locations
  );
end;
$$;

revoke all on function public.save_exam_round_atomic(
  uuid, date, date, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.save_exam_round_atomic(
  uuid, date, date, text, text, text, text[]
) to service_role;

create or replace function public.prevent_exam_history_drift()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'exam_rounds' then
    if tg_op = 'DELETE' and exists (
      select 1 from public.exam_registrations where round_id = old.id
    ) then
      raise exception using errcode = '55000', message = 'exam_round_has_registrations';
    end if;
    if tg_op = 'UPDATE'
       and exists (
         select 1 from public.exam_registrations where round_id = old.id
       )
       and (
         new.exam_type is distinct from old.exam_type
         or new.exam_month is distinct from old.exam_month
         or (
           new.exam_date is distinct from old.exam_date
           and not (
             old.exam_date is null
             and new.exam_date is not null
             and date_trunc('month', new.exam_date)::date = old.exam_month
           )
         )
       ) then
      raise exception using errcode = '55000', message = 'exam_round_history_locked';
    end if;
  elsif tg_table_name = 'exam_locations' then
    if tg_op = 'DELETE' and exists (
      select 1 from public.exam_registrations where location_id = old.id
    ) then
      raise exception using errcode = '55000', message = 'exam_location_has_registrations';
    end if;
    if tg_op = 'UPDATE'
       and new.round_id is distinct from old.round_id
       and exists (
         select 1 from public.exam_registrations where location_id = old.id
       ) then
      raise exception using errcode = '55000', message = 'exam_location_history_locked';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.prevent_exam_history_drift()
  from public, anon, authenticated;
grant execute on function public.prevent_exam_history_drift()
  to service_role;

create or replace function public.submit_exam_registration_with_payment_proof_v2(
  p_fc_id uuid,
  p_resident_id text,
  p_round_id uuid,
  p_location_id uuid,
  p_includes_primary_exam boolean,
  p_is_third_exam boolean,
  p_fee_paid_date date,
  p_upload_id uuid default null
)
returns table (registration_id uuid, previous_proof_path text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_round public.exam_rounds%rowtype;
  v_upload public.exam_payment_proof_uploads%rowtype;
  v_exam_month date;
  v_previous_proof_path text;
  v_action text;
begin
  if p_fc_id is null or nullif(btrim(p_resident_id), '') is null then
    raise exception using errcode = '22023', message = 'invalid_exam_actor';
  end if;
  if not coalesce(p_includes_primary_exam, false)
     and not coalesce(p_is_third_exam, false) then
    raise exception using errcode = '23514', message = 'exam_subject_required';
  end if;
  if p_fee_paid_date is null or p_fee_paid_date > current_date then
    raise exception using errcode = '22023', message = 'invalid_fee_paid_date';
  end if;

  select round_row.* into v_round
    from public.exam_rounds round_row
   where round_row.id = p_round_id
   for share;
  if v_round.id is null
     or v_round.exam_month is null
     or v_round.exam_type is null
     or v_round.exam_type not in ('life', 'nonlife') then
    raise exception using errcode = '22023', message = 'invalid_exam_round';
  end if;
  if v_round.registration_deadline < current_date then
    raise exception using errcode = '55000', message = 'exam_round_closed';
  end if;
  if not exists (
    select 1 from public.exam_locations
     where id = p_location_id and round_id = p_round_id
  ) then
    raise exception using errcode = '23503', message = 'invalid_exam_location';
  end if;

  v_exam_month := v_round.exam_month;
  perform pg_advisory_xact_lock(
    hashtextextended(p_fc_id::text || ':' || v_exam_month::text, 0)
  );

  select registration.* into v_registration
    from public.exam_registrations registration
   where registration.fc_id = p_fc_id
     and registration.exam_month = v_exam_month
     and registration.exam_type = v_round.exam_type
     and registration.status in ('applied', 'confirmed', 'completed', 'no_show')
   order by registration.created_at, registration.id
   limit 1
   for update;

  if v_registration.id is not null
     and (
       v_registration.round_id <> p_round_id
       or v_registration.status <> 'applied'
       or coalesce(v_registration.is_confirmed, false)
     ) then
    raise exception using errcode = '23505', message = 'active_exam_month_already_registered';
  end if;

  if p_upload_id is null then
    if v_registration.id is null
       or not coalesce(v_registration.payment_proof_attached, false) then
      raise exception using errcode = '23514', message = 'payment_proof_required';
    end if;
  else
    select upload.* into v_upload
      from public.exam_payment_proof_uploads upload
     where upload.id = p_upload_id and upload.fc_id = p_fc_id
     for update;
    if v_upload.id is null then
      raise exception using errcode = '22023', message = 'payment_proof_not_found';
    end if;
    if v_upload.status = 'pending' and v_upload.expires_at <= now() then
      raise exception using errcode = '55000', message = 'payment_proof_expired';
    end if;
    if v_upload.status = 'attached' then
      if v_registration.id is null or v_upload.registration_id <> v_registration.id then
        raise exception using errcode = '55000', message = 'payment_proof_already_used';
      end if;
    elsif v_upload.status <> 'pending' then
      raise exception using errcode = '55000', message = 'payment_proof_not_available';
    end if;
  end if;

  if v_registration.id is null then
    insert into public.exam_registrations (
      resident_id, fc_id, round_id, location_id, exam_month, exam_type, status,
      is_confirmed, includes_primary_exam, is_third_exam, fee_paid_date,
      payment_proof_attached, payment_proof_policy_version
    ) values (
      btrim(p_resident_id), p_fc_id, p_round_id, p_location_id, v_exam_month,
      v_round.exam_type,
      'applied', false, p_includes_primary_exam, p_is_third_exam,
      p_fee_paid_date, p_upload_id is not null, 1
    )
    returning * into v_registration;
    v_action := 'submitted';
  else
    update public.exam_registrations
       set resident_id = btrim(p_resident_id),
           location_id = p_location_id,
           includes_primary_exam = p_includes_primary_exam,
           is_third_exam = p_is_third_exam,
           fee_paid_date = p_fee_paid_date,
           payment_proof_attached = payment_proof_attached or p_upload_id is not null,
           payment_proof_policy_version = 1
     where id = v_registration.id
    returning * into v_registration;
    v_action := 'updated';
  end if;

  if p_upload_id is not null and v_upload.status = 'pending' then
    select proof.storage_path into v_previous_proof_path
      from public.exam_payment_proof_uploads proof
     where proof.registration_id = v_registration.id and proof.status = 'attached'
     for update;
    update public.exam_payment_proof_uploads proof
       set status = 'replaced'
     where proof.registration_id = v_registration.id and proof.status = 'attached';
    update public.exam_payment_proof_uploads proof
       set status = 'attached', registration_id = v_registration.id, consumed_at = now()
     where proof.id = p_upload_id;
  end if;

  insert into public.exam_registration_decision_events (
    registration_id, action, from_status, to_status, actor_type, actor_fc_id_snapshot
  ) values (
    v_registration.id, v_action,
    case when v_action = 'updated' then 'applied' else null end,
    'applied', 'fc', p_fc_id
  );

  return query select v_registration.id, v_previous_proof_path;
end;
$$;

revoke all on function public.submit_exam_registration_with_payment_proof_v2(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid
) from public, anon, authenticated;
grant execute on function public.submit_exam_registration_with_payment_proof_v2(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid
) to service_role;

create or replace function public.submit_exam_registration_with_payment_proof_v3(
  p_fc_id uuid,
  p_resident_id text,
  p_round_id uuid,
  p_location_id uuid,
  p_includes_primary_exam boolean,
  p_is_third_exam boolean,
  p_fee_paid_date date,
  p_upload_id uuid,
  p_actor_type text,
  p_actor_admin_id uuid,
  p_actor_manager_id uuid,
  p_actor_fc_id uuid
)
returns table (
  registration_id uuid,
  previous_proof_path text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_round public.exam_rounds%rowtype;
  v_upload public.exam_payment_proof_uploads%rowtype;
  v_exam_month date;
  v_previous_proof_path text;
  v_action text;
begin
  if p_fc_id is null or nullif(btrim(p_resident_id), '') is null then
    raise exception using errcode = '22023', message = 'invalid_exam_target';
  end if;
  if not exists (
    select 1
      from public.fc_profiles profile
     where profile.id = p_fc_id
       and profile.signup_completed = true
       and profile.is_manager_referral_shadow = false
       and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g')
         = regexp_replace(p_resident_id, '[^0-9]', '', 'g')
       and (
         p_actor_type = 'fc'
         or (
           coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
           and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
           and not exists (
             select 1
               from public.manager_accounts manager_target
              where manager_target.active = true
                and regexp_replace(coalesce(manager_target.phone, ''), '[^0-9]', '', 'g')
                  = regexp_replace(p_resident_id, '[^0-9]', '', 'g')
           )
           and not exists (
             select 1
               from public.admin_accounts staff_target
              where staff_target.active = true
                and regexp_replace(coalesce(staff_target.phone, ''), '[^0-9]', '', 'g')
                  = regexp_replace(p_resident_id, '[^0-9]', '', 'g')
           )
         )
       )
  ) then
    raise exception using errcode = '42501', message = 'invalid_exam_target';
  end if;
  if not coalesce(p_includes_primary_exam, false)
     and not coalesce(p_is_third_exam, false) then
    raise exception using errcode = '23514', message = 'exam_subject_required';
  end if;
  if p_fee_paid_date is not null and p_fee_paid_date > current_date then
    raise exception using errcode = '22023', message = 'invalid_fee_paid_date';
  end if;

  if p_actor_type = 'fc' then
    if p_actor_fc_id is distinct from p_fc_id
       or p_actor_admin_id is not null
       or p_actor_manager_id is not null then
      raise exception using errcode = '42501', message = 'invalid_exam_actor';
    end if;
  elsif p_actor_type = 'manager' then
    if p_actor_manager_id is null
       or p_actor_admin_id is not null
       or p_actor_fc_id is not null
       or not exists (
         select 1
           from public.manager_accounts manager
          where manager.id = p_actor_manager_id
            and manager.active = true
       ) then
      raise exception using errcode = '42501', message = 'invalid_exam_actor';
    end if;
  elsif p_actor_type in ('admin', 'developer') then
    if p_actor_admin_id is null
       or p_actor_manager_id is not null
       or p_actor_fc_id is not null
       or not exists (
         select 1
           from public.admin_accounts admin_row
          where admin_row.id = p_actor_admin_id
            and admin_row.active = true
            and (
              (p_actor_type = 'developer' and admin_row.staff_type = 'developer')
              or (
                p_actor_type = 'admin'
                and coalesce(admin_row.staff_type, 'admin') = 'admin'
              )
            )
       ) then
      raise exception using errcode = '42501', message = 'invalid_exam_actor';
    end if;
  else
    raise exception using errcode = '42501', message = 'invalid_exam_actor';
  end if;

  select round_row.*
    into v_round
    from public.exam_rounds round_row
   where round_row.id = p_round_id
   for share;

  if v_round.id is null
     or v_round.exam_month is null
     or v_round.exam_type is null
     or v_round.exam_type not in ('life', 'nonlife') then
    raise exception using errcode = '22023', message = 'invalid_exam_round';
  end if;
  if v_round.registration_deadline < current_date then
    raise exception using errcode = '55000', message = 'exam_round_closed';
  end if;
  if not exists (
    select 1
      from public.exam_locations location
     where location.id = p_location_id
       and location.round_id = p_round_id
  ) then
    raise exception using errcode = '23503', message = 'invalid_exam_location';
  end if;

  v_exam_month := v_round.exam_month;
  perform pg_advisory_xact_lock(
    hashtextextended(p_fc_id::text || ':' || v_exam_month::text, 0)
  );

  select registration.*
    into v_registration
    from public.exam_registrations registration
   where registration.fc_id = p_fc_id
     and registration.exam_month = v_exam_month
     and registration.exam_type = v_round.exam_type
     and registration.status in ('applied', 'confirmed', 'completed', 'no_show')
   order by registration.created_at, registration.id
   limit 1
   for update;

  if v_registration.id is not null
     and (
       v_registration.round_id <> p_round_id
       or v_registration.status <> 'applied'
       or coalesce(v_registration.is_confirmed, false)
     ) then
    raise exception using errcode = '23505', message = 'active_exam_month_already_registered';
  end if;

  if p_upload_id is null then
    if v_registration.id is null
       or not coalesce(v_registration.payment_proof_attached, false) then
      raise exception using errcode = '23514', message = 'payment_proof_required';
    end if;
  else
    select upload.*
      into v_upload
      from public.exam_payment_proof_uploads upload
     where upload.id = p_upload_id
       and upload.fc_id = p_fc_id
     for update;

    if v_upload.id is null then
      raise exception using errcode = '22023', message = 'payment_proof_not_found';
    end if;
    if v_upload.status = 'pending' and v_upload.expires_at <= now() then
      raise exception using errcode = '55000', message = 'payment_proof_expired';
    end if;
    if v_upload.status = 'attached' then
      if v_registration.id is null
         or v_upload.registration_id <> v_registration.id then
        raise exception using errcode = '55000', message = 'payment_proof_already_used';
      end if;
    elsif v_upload.status <> 'pending' then
      raise exception using errcode = '55000', message = 'payment_proof_not_available';
    end if;
  end if;

  if v_registration.id is null then
    insert into public.exam_registrations (
      resident_id,
      fc_id,
      round_id,
      location_id,
      exam_month,
      exam_type,
      status,
      is_confirmed,
      includes_primary_exam,
      is_third_exam,
      fee_paid_date,
      payment_proof_attached,
      payment_proof_policy_version
    ) values (
      btrim(p_resident_id),
      p_fc_id,
      p_round_id,
      p_location_id,
      v_exam_month,
      v_round.exam_type,
      'applied',
      false,
      p_includes_primary_exam,
      p_is_third_exam,
      p_fee_paid_date,
      p_upload_id is not null,
      1
    )
    returning * into v_registration;
    v_action := 'submitted';
  else
    update public.exam_registrations
       set resident_id = btrim(p_resident_id),
           location_id = p_location_id,
           includes_primary_exam = p_includes_primary_exam,
           is_third_exam = p_is_third_exam,
           fee_paid_date = coalesce(v_registration.fee_paid_date, p_fee_paid_date),
           payment_proof_attached =
             payment_proof_attached or p_upload_id is not null,
           payment_proof_policy_version = 1
     where id = v_registration.id
    returning * into v_registration;
    v_action := 'updated';
  end if;

  if p_upload_id is not null and v_upload.status = 'pending' then
    select proof.storage_path
      into v_previous_proof_path
      from public.exam_payment_proof_uploads proof
     where proof.registration_id = v_registration.id
       and proof.status = 'attached'
     for update;

    update public.exam_payment_proof_uploads proof
       set status = 'replaced'
     where proof.registration_id = v_registration.id
       and proof.status = 'attached';

    update public.exam_payment_proof_uploads proof
       set status = 'attached',
           registration_id = v_registration.id,
           consumed_at = now()
     where proof.id = p_upload_id;
  end if;

  insert into public.exam_registration_decision_events (
    registration_id,
    action,
    from_status,
    to_status,
    actor_type,
    actor_admin_id_snapshot,
    actor_manager_id_snapshot,
    actor_fc_id_snapshot,
    target_fc_id_snapshot
  ) values (
    v_registration.id,
    v_action,
    case when v_action = 'updated' then 'applied' else null end,
    'applied',
    p_actor_type,
    p_actor_admin_id,
    p_actor_manager_id,
    p_actor_fc_id,
    p_fc_id
  );

  return query
  select v_registration.id, v_previous_proof_path;
end;
$$;

revoke all on function public.submit_exam_registration_with_payment_proof_v3(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid, text, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.submit_exam_registration_with_payment_proof_v3(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid, text, uuid, uuid, uuid
) to service_role;
-- END 20260804081357_exam_round_month_for_tbd canonical parity block

create or replace function public.validate_messenger_attachment_intents_v2(
  p_actor_id uuid,
  p_actor_role text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_intents jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_expected_count integer;
  v_item jsonb;
  v_intent_id uuid;
  v_size bigint;
  v_mime text;
  v_sha256 text;
  v_family text;
  v_updated integer := 0;
begin
  if p_actor_id is null
     or p_delivery_key is null
     or p_actor_role not in ('fc', 'admin', 'manager')
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_intents is null
     or jsonb_typeof(p_intents) <> 'array'
     or jsonb_array_length(p_intents) not between 1 and 10 then
    raise exception 'invalid_attachment_validation_request';
  end if;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint then
    raise exception 'attachment_idempotency_conflict';
  end if;
  if v_batch.status = 'committed' then
    return jsonb_build_object(
      'state', 'committed',
      'batchId', v_batch.id,
      'messageIds', to_jsonb(v_batch.committed_message_ids)
    );
  end if;
  if v_batch.status <> 'pending' then
    raise exception 'attachment_intent_consumed';
  end if;
  if v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  select count(*)
    into v_expected_count
    from public.messenger_attachment_upload_intents intent
   where intent.batch_id = v_batch.id
     and intent.generation = v_batch.generation
     and intent.status in ('pending', 'validated');
  if v_expected_count <> jsonb_array_length(p_intents) then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  for v_item in select value from jsonb_array_elements(p_intents)
  loop
    begin
      v_intent_id := (v_item->>'id')::uuid;
      v_size := (v_item->>'size')::bigint;
    exception when others then
      raise exception 'invalid_attachment_validation_request';
    end;
    v_mime := lower(btrim(v_item->>'mimeType'));
    v_sha256 := lower(btrim(v_item->>'sha256'));
    v_family := lower(btrim(v_item->>'family'));
    update public.messenger_attachment_upload_intents intent
       set status = 'validated',
           inspected_family = v_family,
           inspected_mime_type = v_mime,
           inspected_size = v_size,
           inspected_sha256 = v_sha256,
           validated_at = coalesce(intent.validated_at, v_now),
           updated_at = v_now
     where intent.id = v_intent_id
       and intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
       and intent.status in ('pending', 'validated')
       and intent.expected_size = v_size
       and intent.declared_mime_type = v_mime
       and intent.expected_sha256 = v_sha256
       and intent.object_path is not null;
    if not found then
      raise exception 'attachment_intent_validation_mismatch';
    end if;
    v_updated := v_updated + 1;
  end loop;

  if v_updated <> v_expected_count
     or (
       select count(*)
         from public.messenger_attachment_upload_intents intent
        where intent.batch_id = v_batch.id
          and intent.generation = v_batch.generation
          and intent.status = 'validated'
     ) <> v_expected_count then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  return jsonb_build_object(
    'state', 'validated',
    'batchId', v_batch.id,
    'intentCount', v_updated
  );
end;
$$;

revoke all on function public.validate_messenger_attachment_intents_v2(
  uuid, text, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.validate_messenger_attachment_intents_v2(
  uuid, text, uuid, text, jsonb
) to service_role;

create or replace function public.revoke_messenger_attachment_upload_batch_v2(
  p_actor_id uuid,
  p_actor_role text,
  p_delivery_key uuid,
  p_reason_code text default 'upload_intent_revoked'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_scheduled integer := 0;
  v_retryable boolean := p_reason_code in (
    'signed_upload_response_invalid',
    'signed_upload_url_failed'
  );
begin
  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    return jsonb_build_object('revoked', false, 'scheduled', 0);
  end if;
  if v_batch.status = 'committed' then
    raise exception 'attachment_intent_consumed';
  end if;
  if v_batch.status in ('revoked', 'deleted') then
    return jsonb_build_object('revoked', false, 'scheduled', 0);
  end if;

  insert into public.messenger_attachment_cleanup_outbox (
    batch_id, bucket_id, storage_path, reason_code, sweep_phase, not_before
  )
  select intent.batch_id,
         intent.bucket_id,
         intent.object_path,
         left(coalesce(nullif(p_reason_code, ''), 'upload_intent_revoked'), 80),
         phase.sweep_phase,
         case phase.sweep_phase
           when 'immediate' then v_now
           else greatest(intent.expires_at, v_now) + interval '5 minutes'
         end
    from public.messenger_attachment_upload_intents intent
    cross join (
      values ('immediate'::text), ('post_token_expiry'::text)
    ) phase(sweep_phase)
   where intent.batch_id = v_batch.id
     and intent.generation = v_batch.generation
     and intent.object_path is not null
  on conflict (bucket_id, storage_path, sweep_phase)
    where bucket_id is not null and storage_path is not null
  do update set
    not_before = least(
      public.messenger_attachment_cleanup_outbox.not_before,
      excluded.not_before
    ),
    status = case
      when public.messenger_attachment_cleanup_outbox.status = 'completed'
        then 'pending'
      else public.messenger_attachment_cleanup_outbox.status
    end,
    completed_at = null,
    updated_at = v_now;
  get diagnostics v_scheduled = row_count;

  update public.messenger_attachment_upload_intents
     set status = case when v_retryable then 'expired' else 'revoked' end,
         object_path = null,
         updated_at = v_now
   where batch_id = v_batch.id
     and generation = v_batch.generation;
  update public.messenger_attachment_delivery_batches
     set status = case when v_retryable then 'expired' else 'revoked' end,
         updated_at = v_now
   where id = v_batch.id;

  return jsonb_build_object(
    'revoked', not v_retryable,
    'retryable', v_retryable,
    'scheduled', v_scheduled
  );
end;
$$;

revoke all on function public.revoke_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.revoke_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text
) to service_role;

create or replace function public.materialize_messenger_attachment_batch_v2(
  p_batch_id uuid,
  p_reference_count integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_expected_count integer;
  v_attachment_rows jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_batch_id is null or p_reference_count not between 1 and 200 then
    raise exception 'invalid_attachment_materialization';
  end if;
  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.id = p_batch_id
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.status = 'committed' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', attachment.id,
          'name', attachment.original_name,
          'size', attachment.byte_size,
          'mimeType', attachment.mime_type,
          'sha256', attachment.sha256
        )
        order by link.sort_order
      ),
      '[]'::jsonb
    )
      into v_attachment_rows
      from public.messenger_message_attachments link
      join public.messenger_attachment_objects attachment
        on attachment.id = link.attachment_id
     where link.batch_id = v_batch.id;
    return v_attachment_rows;
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  select count(*)
    into v_expected_count
    from public.messenger_attachment_upload_intents intent
   where intent.batch_id = v_batch.id
     and intent.generation = v_batch.generation
     and intent.status = 'validated'
     and intent.object_path is not null;
  if v_expected_count not between 1 and 10
     or v_expected_count <> (
       select count(*)
         from public.messenger_attachment_upload_intents intent
        where intent.batch_id = v_batch.id
          and intent.generation = v_batch.generation
     ) then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  insert into public.messenger_attachment_objects (
    id,
    batch_id,
    sort_order,
    original_name,
    mime_type,
    byte_size,
    sha256,
    content_family,
    bucket_id,
    storage_path,
    reference_count,
    status,
    created_at
  )
  select gen_random_uuid(),
         intent.batch_id,
         intent.sort_order,
         intent.original_name,
         intent.inspected_mime_type,
         intent.inspected_size,
         intent.inspected_sha256,
         intent.inspected_family,
         intent.bucket_id,
         intent.object_path,
         p_reference_count,
         'active',
         v_now
    from public.messenger_attachment_upload_intents intent
   where intent.batch_id = v_batch.id
     and intent.generation = v_batch.generation
     and intent.status = 'validated'
   order by intent.sort_order
  on conflict (batch_id, sort_order) do update
    set reference_count = excluded.reference_count;

  insert into public.messenger_message_attachments (
    batch_id,
    attachment_id,
    sort_order
  )
  select attachment.batch_id, attachment.id, attachment.sort_order
    from public.messenger_attachment_objects attachment
   where attachment.batch_id = v_batch.id
  on conflict (batch_id, attachment_id) do nothing;

  update public.messenger_attachment_upload_intents
     set status = 'consumed',
         consumed_at = v_now,
         object_path = null,
         updated_at = v_now
   where batch_id = v_batch.id
     and generation = v_batch.generation
     and status = 'validated';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', attachment.id,
        'name', attachment.original_name,
        'size', attachment.byte_size,
        'mimeType', attachment.mime_type,
        'sha256', attachment.sha256
      )
      order by link.sort_order
    ),
    '[]'::jsonb
  )
    into v_attachment_rows
    from public.messenger_message_attachments link
    join public.messenger_attachment_objects attachment
      on attachment.id = link.attachment_id
   where link.batch_id = v_batch.id;
  return v_attachment_rows;
end;
$$;

revoke all on function public.materialize_messenger_attachment_batch_v2(
  uuid, integer
) from public, anon, authenticated;
grant execute on function public.materialize_messenger_attachment_batch_v2(
  uuid, integer
) to service_role;

create or replace function public.commit_garamin_direct_message_with_attachments_v2(
  p_message_id uuid,
  p_conversation_id uuid,
  p_sender_id text,
  p_receiver_id text,
  p_sender_actor_id uuid,
  p_receiver_actor_id uuid,
  p_content text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_attachment_intent_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_fc_id uuid;
  v_fc_phone text;
  v_actor_role text;
  v_staff_phone text;
  v_staff_type text;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_existing_message public.messages%rowtype;
  v_attachments jsonb;
  v_notifications jsonb;
  v_notification_ids uuid[];
begin
  if p_message_id is null
     or p_conversation_id is null
     or p_sender_actor_id is null
     or p_delivery_key is null
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_attachment_intent_ids is null
     or cardinality(p_attachment_intent_ids) not between 1 and 10
     or length(coalesce(p_content, '')) > 4000 then
    raise exception 'invalid_direct_attachment_message';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'messenger-direct-context:' || p_conversation_id::text,
      0
    )
  );

  select conversation.fc_id, profile.phone
    into v_fc_id, v_fc_phone
    from public.garamin_direct_conversations conversation
    join public.fc_profiles profile
      on profile.id = conversation.fc_id
     and profile.signup_completed = true
     and coalesce(profile.is_manager_referral_shadow, false) = false
     and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
     and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
   where conversation.id = p_conversation_id;
  if v_fc_id is null or v_fc_phone is null then
    raise exception 'direct_conversation_not_found';
  end if;

  if p_sender_id = v_fc_phone and p_receiver_id = 'admin' then
    v_actor_role := 'fc';
    if p_sender_actor_id <> v_fc_id
       or p_receiver_actor_id is not null
       or not exists (
         select 1 from public.fc_profiles profile
          where profile.id = p_sender_actor_id
            and profile.signup_completed = true
            and coalesce(profile.is_manager_referral_shadow, false) = false
            and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
            and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
       )
       or not exists (
         select 1 from public.admin_accounts account
          where account.active = true
            and coalesce(account.staff_type, 'admin') in ('admin', 'developer')
       ) then
      raise exception 'direct_message_actor_mismatch';
    end if;
  elsif p_receiver_id = v_fc_phone then
    if p_receiver_actor_id is distinct from v_fc_id then
      raise exception 'direct_message_actor_mismatch';
    end if;
    select account.phone, coalesce(account.staff_type, 'admin')
      into v_staff_phone, v_staff_type
      from public.admin_accounts account
     where account.id = p_sender_actor_id
       and account.active = true
       and coalesce(account.staff_type, 'admin') in ('admin', 'developer');
    if found then
      v_actor_role := 'admin';
      if p_sender_id is distinct from (
        case
          when v_staff_type = 'developer'
            then regexp_replace(v_staff_phone, '[^0-9]', '', 'g')
          else 'admin'
        end
      ) then
        raise exception 'direct_message_actor_mismatch';
      end if;
    else
      v_staff_phone := null;
      select account.phone
        into v_staff_phone
        from public.manager_accounts account
       where account.id = p_sender_actor_id
         and account.active = true;
      if not found
         or p_sender_id is distinct from regexp_replace(v_staff_phone, '[^0-9]', '', 'g') then
        raise exception 'direct_message_actor_mismatch';
      end if;
      v_actor_role := 'manager';
    end if;
  else
    raise exception 'direct_message_identity_mismatch';
  end if;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_sender_actor_id
     and batch.actor_role = v_actor_role
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
     or v_batch.context_kind <> 'direct'
     or v_batch.conversation_id <> p_conversation_id then
    raise exception 'attachment_idempotency_conflict';
  end if;
  if (
    select array_agg(intent.id order by intent.sort_order)
      from public.messenger_attachment_upload_intents intent
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
  ) is distinct from p_attachment_intent_ids then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  if v_batch.status = 'committed' then
    select *
      into v_existing_message
      from public.messages message
     where message.id = p_message_id
       and message.attachment_batch_id = v_batch.id;
    if v_existing_message.id is null
       or v_existing_message.conversation_id <> p_conversation_id
       or v_existing_message.sender_actor_id <> p_sender_actor_id
       or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
       or v_existing_message.content is distinct from coalesce(p_content, '') then
      raise exception 'attachment_idempotency_conflict';
    end if;
    select coalesce(
      jsonb_agg(to_jsonb(notification) order by notification.id),
      '[]'::jsonb
    )
      into v_notifications
      from public.notifications notification
     where notification.id = any(v_batch.notification_ids);
    return jsonb_build_object(
      'message_id', p_message_id,
      'batch_id', v_batch.id,
      'replayed', true,
      'attachments', public.materialize_messenger_attachment_batch_v2(v_batch.id, 1),
      'notifications', v_notifications
    );
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  v_attachments := public.materialize_messenger_attachment_batch_v2(v_batch.id, 1);

  insert into public.messages (
    id,
    conversation_id,
    sender_id,
    receiver_id,
    sender_actor_id,
    receiver_actor_id,
    content,
    message_type,
    is_read,
    attachment_batch_id
  )
  values (
    p_message_id,
    p_conversation_id,
    p_sender_id,
    p_receiver_id,
    p_sender_actor_id,
    p_receiver_actor_id,
    coalesce(p_content, ''),
    'file',
    false,
    v_batch.id
  )
  on conflict (id) do nothing;
  select *
    into v_existing_message
    from public.messages message
   where message.id = p_message_id;
  if v_existing_message.id is null
     or v_existing_message.conversation_id <> p_conversation_id
     or v_existing_message.sender_actor_id <> p_sender_actor_id
     or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
     or v_existing_message.content is distinct from coalesce(p_content, '')
     or v_existing_message.attachment_batch_id <> v_batch.id then
    raise exception 'attachment_idempotency_conflict';
  end if;

  if p_receiver_id = 'admin' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      select '새 메시지',
             left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
             'message',
             v_fc_id,
             account.phone,
             account.id,
             'admin',
             jsonb_build_object(
               'version', 1,
               'kind', 'garamin_direct_chat',
               'conversationId', p_conversation_id
             ),
             '/chat',
             'direct_message:' || p_message_id::text || ':' || account.id::text
        from public.admin_accounts account
       where account.active = true
         and coalesce(account.staff_type, 'admin') in ('admin', 'developer')
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.id), '[]'::jsonb),
           coalesce(array_agg(inserted.id order by inserted.id), array[]::uuid[])
      into v_notifications, v_notification_ids
      from inserted;
  else
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      values (
        '새 메시지',
        left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
        'message',
        v_fc_id,
        v_fc_phone,
        v_fc_id,
        'fc',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':' || v_fc_id::text
      )
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb),
           coalesce(array_agg(inserted.id), array[]::uuid[])
      into v_notifications, v_notification_ids
      from inserted;
  end if;
  if cardinality(v_notification_ids) < 1 then
    raise exception 'direct_message_notification_not_persisted';
  end if;

  update public.messenger_attachment_delivery_batches
     set status = 'committed',
         committed_message_ids = array[p_message_id],
         notification_ids = v_notification_ids,
         committed_at = v_now,
         updated_at = v_now
   where id = v_batch.id;

  return jsonb_build_object(
    'message_id', p_message_id,
    'batch_id', v_batch.id,
    'replayed', false,
    'attachments', v_attachments,
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) to service_role;

create or replace function public.commit_group_chat_message_with_attachments_v2(
  p_message_id uuid,
  p_room_id uuid,
  p_sender_immutable_actor_id uuid,
  p_sender_actor_id text,
  p_sender_role text,
  p_sender_phone text,
  p_sender_name text,
  p_content text,
  p_reply_to_message_id uuid,
  p_reply_to_sender_name text,
  p_reply_to_content text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_attachment_intent_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_actor_valid boolean := false;
  v_actor_phone text;
  v_existing_message public.group_chat_messages%rowtype;
  v_attachments jsonb;
begin
  if p_message_id is null
     or p_room_id is null
     or p_sender_immutable_actor_id is null
     or p_sender_role not in ('fc', 'manager', 'admin')
     or p_delivery_key is null
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_attachment_intent_ids is null
     or cardinality(p_attachment_intent_ids) not between 1 and 10
     or length(coalesce(p_content, '')) > 4000 then
    raise exception 'invalid_group_attachment_message';
  end if;

  if p_sender_role = 'fc' then
    select profile.phone,
           profile.signup_completed = true
           and coalesce(profile.is_manager_referral_shadow, false) = false
           and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
           and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
      into v_actor_phone, v_actor_valid
      from public.fc_profiles profile
     where profile.id = p_sender_immutable_actor_id;
  elsif p_sender_role = 'manager' then
    select account.phone, account.active = true
      into v_actor_phone, v_actor_valid
      from public.manager_accounts account
     where account.id = p_sender_immutable_actor_id;
  else
    select account.phone,
           account.active = true
           and coalesce(account.staff_type, 'admin') in ('admin', 'developer')
      into v_actor_phone, v_actor_valid
      from public.admin_accounts account
     where account.id = p_sender_immutable_actor_id;
  end if;
  if not coalesce(v_actor_valid, false)
     or regexp_replace(v_actor_phone, '[^0-9]', '', 'g')
        <> regexp_replace(coalesce(p_sender_phone, ''), '[^0-9]', '', 'g')
     or p_sender_actor_id is distinct from (
       p_sender_role || ':' || regexp_replace(v_actor_phone, '[^0-9]', '', 'g')
     )
     or not exists (
       select 1 from public.group_chat_rooms room
        where room.id = p_room_id and room.is_active = true
     ) then
    raise exception 'attachment_context_forbidden';
  end if;
  if p_sender_role = 'fc'
     and not exists (
       select 1
         from public.group_chat_member_send_permissions permission
        where permission.room_id = p_room_id
          and permission.actor_id = p_sender_actor_id
          and permission.can_send_messages = true
     ) then
    raise exception 'attachment_context_forbidden';
  end if;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_sender_immutable_actor_id
     and batch.actor_role = p_sender_role
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
     or v_batch.context_kind <> 'group'
     or v_batch.room_id <> p_room_id then
    raise exception 'attachment_idempotency_conflict';
  end if;
  if (
    select array_agg(intent.id order by intent.sort_order)
      from public.messenger_attachment_upload_intents intent
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
  ) is distinct from p_attachment_intent_ids then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  if v_batch.status = 'committed' then
    select *
      into v_existing_message
      from public.group_chat_messages message
     where message.id = p_message_id
       and message.attachment_batch_id = v_batch.id;
    if v_existing_message.id is null
       or v_existing_message.room_id <> p_room_id
       or v_existing_message.sender_actor_id <> p_sender_actor_id
       or v_existing_message.content is distinct from coalesce(p_content, '') then
      raise exception 'attachment_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'message_id', p_message_id,
      'batch_id', v_batch.id,
      'replayed', true,
      'attachments', public.materialize_messenger_attachment_batch_v2(v_batch.id, 1)
    );
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  v_attachments := public.materialize_messenger_attachment_batch_v2(v_batch.id, 1);
  insert into public.group_chat_messages (
    id,
    room_id,
    sender_actor_id,
    sender_role,
    sender_phone,
    sender_name,
    content,
    message_type,
    file_url,
    file_name,
    file_size,
    reply_to_message_id,
    reply_to_sender_name,
    reply_to_content,
    attachment_batch_id
  )
  values (
    p_message_id,
    p_room_id,
    p_sender_actor_id,
    p_sender_role,
    p_sender_phone,
    nullif(p_sender_name, ''),
    coalesce(p_content, ''),
    'file',
    null,
    null,
    null,
    p_reply_to_message_id,
    nullif(p_reply_to_sender_name, ''),
    nullif(p_reply_to_content, ''),
    v_batch.id
  )
  on conflict (id) do nothing;

  select *
    into v_existing_message
    from public.group_chat_messages message
   where message.id = p_message_id;
  if v_existing_message.id is null
     or v_existing_message.room_id <> p_room_id
     or v_existing_message.sender_actor_id <> p_sender_actor_id
     or v_existing_message.content is distinct from coalesce(p_content, '')
     or v_existing_message.attachment_batch_id <> v_batch.id then
    raise exception 'attachment_idempotency_conflict';
  end if;

  update public.messenger_attachment_delivery_batches
     set status = 'committed',
         committed_message_ids = array[p_message_id],
         committed_at = v_now,
         updated_at = v_now
   where id = v_batch.id;

  return jsonb_build_object(
    'message_id', p_message_id,
    'batch_id', v_batch.id,
    'replayed', false,
    'attachments', v_attachments
  );
end;
$$;

revoke all on function public.commit_group_chat_message_with_attachments_v2(
  uuid, uuid, uuid, text, text, text, text, text,
  uuid, text, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_group_chat_message_with_attachments_v2(
  uuid, uuid, uuid, text, text, text, text, text,
  uuid, text, text, uuid, text, uuid[]
) to service_role;

create or replace function public.commit_garamin_direct_broadcast_with_attachments_v2(
  p_message_ids uuid[],
  p_conversation_ids uuid[],
  p_sender_actor_id uuid,
  p_content text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_attachment_intent_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer := cardinality(p_conversation_ids);
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_sorted_conversation_ids uuid[];
  v_sender_phone text;
  v_sender_staff_type text;
  v_sender_id text;
  v_lock_conversation_id uuid;
  v_attachments jsonb;
  v_notifications jsonb;
  v_notification_ids uuid[];
begin
  if p_sender_actor_id is null
     or p_message_ids is null
     or p_conversation_ids is null
     or p_delivery_key is null
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_attachment_intent_ids is null
     or v_count not between 1 and 200
     or cardinality(p_message_ids) <> v_count
     or cardinality(p_attachment_intent_ids) not between 1 and 10
     or length(coalesce(p_content, '')) > 4000
     or cardinality(array(select distinct value from unnest(p_conversation_ids) value)) <> v_count
     or cardinality(array(select distinct value from unnest(p_message_ids) value)) <> v_count
     or not exists (
       select 1 from public.admin_accounts account
        where account.id = p_sender_actor_id
          and account.active = true
          and coalesce(account.staff_type, 'admin') in ('admin', 'developer')
     ) then
    raise exception 'invalid_direct_broadcast_attachment_message';
  end if;

  select account.phone, coalesce(account.staff_type, 'admin')
    into v_sender_phone, v_sender_staff_type
    from public.admin_accounts account
   where account.id = p_sender_actor_id
     and account.active = true
     and coalesce(account.staff_type, 'admin') in ('admin', 'developer');
  if not found then
    raise exception 'invalid_direct_broadcast_attachment_message';
  end if;
  v_sender_id := case
    when v_sender_staff_type = 'developer'
      then regexp_replace(v_sender_phone, '[^0-9]', '', 'g')
    else 'admin'
  end;

  select array_agg(value order by value)
    into v_sorted_conversation_ids
    from unnest(p_conversation_ids) value;
  for v_lock_conversation_id in
    select conversation_id
      from unnest(v_sorted_conversation_ids) requested(conversation_id)
     order by conversation_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'messenger-direct-context:' || v_lock_conversation_id::text,
        0
      )
    );
  end loop;
  if exists (
    select 1
      from unnest(p_conversation_ids) requested(conversation_id)
      left join public.garamin_direct_conversations conversation
        on conversation.id = requested.conversation_id
      left join public.fc_profiles profile
        on profile.id = conversation.fc_id
       and profile.signup_completed = true
       and coalesce(profile.is_manager_referral_shadow, false) = false
       and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
       and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
     where conversation.id is null or profile.id is null
  ) then
    raise exception 'attachment_context_not_found';
  end if;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_sender_actor_id
     and batch.actor_role = 'admin'
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
     or v_batch.context_kind <> 'direct_broadcast'
     or v_batch.conversation_ids is distinct from v_sorted_conversation_ids then
    raise exception 'attachment_idempotency_conflict';
  end if;
  if (
    select array_agg(intent.id order by intent.sort_order)
      from public.messenger_attachment_upload_intents intent
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
  ) is distinct from p_attachment_intent_ids then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  if v_batch.status = 'committed' then
    if v_batch.committed_message_ids is distinct from p_message_ids
       or (
         select count(*)
           from unnest(p_message_ids, p_conversation_ids)
             as requested(message_id, conversation_id)
           join public.messages message
             on message.id = requested.message_id
            and message.conversation_id = requested.conversation_id
          where message.attachment_batch_id = v_batch.id
            and message.sender_actor_id = p_sender_actor_id
            and message.content is not distinct from coalesce(p_content, '')
       ) <> v_count then
      raise exception 'attachment_idempotency_conflict';
    end if;
    select coalesce(
      jsonb_agg(to_jsonb(notification) order by notification.id),
      '[]'::jsonb
    )
      into v_notifications
      from public.notifications notification
     where notification.id = any(v_batch.notification_ids);
    return jsonb_build_object(
      'message_ids', to_jsonb(p_message_ids),
      'batch_id', v_batch.id,
      'replayed', true,
      'attachments', public.materialize_messenger_attachment_batch_v2(v_batch.id, v_count),
      'notifications', v_notifications
    );
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  v_attachments := public.materialize_messenger_attachment_batch_v2(v_batch.id, v_count);

  insert into public.messages (
    id,
    conversation_id,
    sender_id,
    receiver_id,
    sender_actor_id,
    receiver_actor_id,
    content,
    message_type,
    is_read,
    attachment_batch_id
  )
  select requested.message_id,
         requested.conversation_id,
         v_sender_id,
         profile.phone,
         p_sender_actor_id,
         profile.id,
         coalesce(p_content, ''),
         'file',
         false,
         v_batch.id
    from unnest(p_message_ids, p_conversation_ids)
      as requested(message_id, conversation_id)
    join public.garamin_direct_conversations conversation
      on conversation.id = requested.conversation_id
    join public.fc_profiles profile
      on profile.id = conversation.fc_id
     and profile.signup_completed = true
     and coalesce(profile.is_manager_referral_shadow, false) = false
     and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
     and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
  on conflict (id) do nothing;

  if (
    select count(*)
      from unnest(p_message_ids, p_conversation_ids)
        as requested(message_id, conversation_id)
      join public.messages message
        on message.id = requested.message_id
       and message.conversation_id = requested.conversation_id
     where message.attachment_batch_id = v_batch.id
       and message.sender_actor_id = p_sender_actor_id
       and message.content is not distinct from coalesce(p_content, '')
  ) <> v_count then
    raise exception 'attachment_idempotency_conflict';
  end if;

  with inserted as (
    insert into public.notifications (
      title, body, category, fc_id, resident_id, recipient_actor_id,
      recipient_role, target, target_url, delivery_key
    )
    select '새 메시지',
           left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
           'message',
           profile.id,
           profile.phone,
           profile.id,
           'fc',
           jsonb_build_object(
             'version', 1,
             'kind', 'garamin_direct_chat',
             'conversationId', requested.conversation_id
           ),
           '/chat',
           'direct_message:' || requested.message_id::text || ':' || profile.id::text
      from unnest(p_message_ids, p_conversation_ids)
        as requested(message_id, conversation_id)
      join public.garamin_direct_conversations conversation
        on conversation.id = requested.conversation_id
      join public.fc_profiles profile
        on profile.id = conversation.fc_id
       and profile.signup_completed = true
       and coalesce(profile.is_manager_referral_shadow, false) = false
       and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
       and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
    on conflict (delivery_key) do update
      set delivery_key = excluded.delivery_key
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.id), '[]'::jsonb),
         coalesce(array_agg(inserted.id order by inserted.id), array[]::uuid[])
    into v_notifications, v_notification_ids
    from inserted;
  if cardinality(v_notification_ids) <> v_count then
    raise exception 'direct_message_notification_not_persisted';
  end if;

  update public.messenger_attachment_delivery_batches
     set status = 'committed',
         committed_message_ids = p_message_ids,
         notification_ids = v_notification_ids,
         committed_at = v_now,
         updated_at = v_now
   where id = v_batch.id;

  return jsonb_build_object(
    'message_ids', to_jsonb(p_message_ids),
    'batch_id', v_batch.id,
    'replayed', false,
    'attachments', v_attachments,
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) to service_role;

create or replace function public.delete_messenger_attachment_delivery_v2(
  p_message_kind text,
  p_message_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_group_actor_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch_id uuid;
  v_deleted_conversation_id uuid;
  v_scheduled integer := 0;
  v_remaining integer := 0;
begin
  if p_message_id is null
     or p_actor_id is null
     or p_actor_role not in ('fc', 'admin', 'manager')
     or p_message_kind not in ('direct', 'group') then
    raise exception 'invalid_attachment_delete_request';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_actor_role || ':' || p_actor_id::text, 0)
  );

  if p_message_kind = 'direct' then
    select message.attachment_batch_id, message.conversation_id
      into v_batch_id, v_deleted_conversation_id
      from public.messages message
     where message.id = p_message_id
       and message.deleted_at is null
       and message.sender_actor_id = p_actor_id
     for update;
  else
    select message.attachment_batch_id
      into v_batch_id
      from public.group_chat_messages message
     where message.id = p_message_id
       and message.deleted_at is null
       and message.sender_actor_id = p_group_actor_id
       and exists (
         select 1
           from public.messenger_attachment_delivery_batches batch
          where batch.id = message.attachment_batch_id
            and batch.actor_id = p_actor_id
            and batch.actor_role = p_actor_role
       )
     for update;
  end if;
  if v_batch_id is null then
    raise exception 'attachment_message_not_found';
  end if;

  perform 1
    from public.messenger_attachment_delivery_batches batch
   where batch.id = v_batch_id
     and batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
   for update;
  if not found then
    raise exception 'attachment_message_not_found';
  end if;

  if p_message_kind = 'direct' then
    update public.messages
       set deleted_at = coalesce(deleted_at, v_now),
           deleted_by_actor_id = coalesce(deleted_by_actor_id, p_actor_id),
           content = ''
     where id = p_message_id
       and attachment_batch_id = v_batch_id;
    select count(*)
      into v_remaining
      from public.messages message
     where message.attachment_batch_id = v_batch_id
       and message.deleted_at is null;
  else
    update public.group_chat_messages
       set deleted_at = coalesce(deleted_at, v_now),
           deleted_by_actor_id = coalesce(deleted_by_actor_id, p_group_actor_id),
           content = ''
     where id = p_message_id
       and attachment_batch_id = v_batch_id;
    delete from public.group_chat_notices notice
     where notice.message_id = p_message_id;
    select count(*)
      into v_remaining
      from public.group_chat_messages message
     where message.attachment_batch_id = v_batch_id
       and message.deleted_at is null;
  end if;

  if v_remaining > 0 then
    update public.messenger_attachment_delivery_batches
       set conversation_ids = array_remove(conversation_ids, v_deleted_conversation_id),
           updated_at = v_now
     where id = v_batch_id
       and context_kind = 'direct_broadcast'
       and v_deleted_conversation_id is not null;
    update public.messenger_attachment_objects
       set reference_count = v_remaining
     where batch_id = v_batch_id
       and status = 'active';
    return jsonb_build_object(
      'deleted', true,
      'batchId', v_batch_id,
      'scheduled', 0,
      'retainedForReferences', v_remaining
    );
  end if;

  insert into public.messenger_attachment_deletion_audit (
    original_name,
    byte_size,
    sha256,
    reason_code,
    deleted_at
  )
  select attachment.original_name,
         attachment.byte_size,
         attachment.sha256,
         'message_deleted',
         v_now
    from public.messenger_attachment_objects attachment
   where attachment.batch_id = v_batch_id;

  insert into public.messenger_attachment_cleanup_outbox (
    attachment_id,
    batch_id,
    bucket_id,
    storage_path,
    reason_code,
    sweep_phase,
    not_before
  )
  select attachment.id,
         attachment.batch_id,
         attachment.bucket_id,
         attachment.storage_path,
         'message_deleted',
         phase.sweep_phase,
         case phase.sweep_phase
           when 'immediate' then v_now
           else greatest(batch.expires_at, v_now) + interval '5 minutes'
         end
    from public.messenger_attachment_objects attachment
    join public.messenger_attachment_delivery_batches batch
      on batch.id = attachment.batch_id
    cross join (
      values ('immediate'::text), ('post_token_expiry'::text)
    ) phase(sweep_phase)
   where attachment.batch_id = v_batch_id
     and attachment.storage_path is not null
  on conflict (bucket_id, storage_path, sweep_phase)
    where bucket_id is not null and storage_path is not null
  do update set
    not_before = least(
      public.messenger_attachment_cleanup_outbox.not_before,
      excluded.not_before
    ),
    status = case
      when public.messenger_attachment_cleanup_outbox.status = 'completed'
        then 'pending'
      else public.messenger_attachment_cleanup_outbox.status
    end,
    completed_at = null,
    updated_at = v_now;
  get diagnostics v_scheduled = row_count;

  update public.messenger_attachment_objects
     set bucket_id = null,
         storage_path = null,
         reference_count = 0,
         status = 'tombstoned',
         tombstoned_at = coalesce(tombstoned_at, v_now)
   where batch_id = v_batch_id;
  update public.messenger_attachment_delivery_batches
     set status = 'deleted',
         deleted_at = coalesce(deleted_at, v_now),
         updated_at = v_now
   where id = v_batch_id;

  return jsonb_build_object(
    'deleted', true,
    'batchId', v_batch_id,
    'scheduled', v_scheduled
  );
end;
$$;

revoke all on function public.delete_messenger_attachment_delivery_v2(
  text, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.delete_messenger_attachment_delivery_v2(
  text, uuid, uuid, text, text
) to service_role;

create or replace function public.expire_messenger_attachment_intents_v2(
  p_limit integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch_id uuid;
  v_expired integer := 0;
  v_scheduled integer := 0;
  v_rows integer;
begin
  for v_batch_id in
    select batch.id
      from public.messenger_attachment_delivery_batches batch
     where batch.status = 'pending'
       and batch.expires_at <= v_now
     order by batch.expires_at, batch.id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    insert into public.messenger_attachment_cleanup_outbox (
      batch_id, bucket_id, storage_path, reason_code, sweep_phase, not_before
    )
    select intent.batch_id,
           intent.bucket_id,
           intent.object_path,
           'expired_intent',
           phase.sweep_phase,
           case phase.sweep_phase
             when 'immediate' then v_now
             else greatest(intent.expires_at, v_now) + interval '5 minutes'
           end
      from public.messenger_attachment_upload_intents intent
      cross join (
        values ('immediate'::text), ('post_token_expiry'::text)
      ) phase(sweep_phase)
     where intent.batch_id = v_batch_id
       and intent.object_path is not null
    on conflict (bucket_id, storage_path, sweep_phase)
      where bucket_id is not null and storage_path is not null
    do update set
      not_before = least(
        public.messenger_attachment_cleanup_outbox.not_before,
        excluded.not_before
      ),
      status = case
        when public.messenger_attachment_cleanup_outbox.status = 'completed'
          then 'pending'
        else public.messenger_attachment_cleanup_outbox.status
      end,
      completed_at = null,
      updated_at = v_now;
    get diagnostics v_rows = row_count;
    v_scheduled := v_scheduled + v_rows;

    update public.messenger_attachment_upload_intents
       set status = 'expired',
           object_path = null,
           updated_at = v_now
     where batch_id = v_batch_id
       and status in ('pending', 'validated');
    update public.messenger_attachment_delivery_batches
       set status = 'expired',
           updated_at = v_now
     where id = v_batch_id;
    v_expired := v_expired + 1;
  end loop;
  return jsonb_build_object('expired', v_expired, 'scheduled', v_scheduled);
end;
$$;

revoke all on function public.expire_messenger_attachment_intents_v2(integer)
  from public, anon, authenticated;
grant execute on function public.expire_messenger_attachment_intents_v2(integer)
  to service_role;

create or replace function public.claim_messenger_attachment_cleanup_v2(
  p_limit integer default 25,
  p_batch_id uuid default null
)
returns table (
  job_id uuid,
  bucket_id text,
  storage_path text,
  sweep_phase text,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select outbox.id
      from public.messenger_attachment_cleanup_outbox outbox
     where (
       outbox.status = 'pending'
       or (
         outbox.status = 'processing'
         and outbox.locked_at < clock_timestamp() - interval '5 minutes'
       )
     )
       and outbox.not_before <= clock_timestamp()
       and (p_batch_id is null or outbox.batch_id = p_batch_id)
     order by outbox.not_before, outbox.created_at, outbox.id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  ),
  claimed as (
    update public.messenger_attachment_cleanup_outbox outbox
       set status = 'processing',
           locked_at = clock_timestamp(),
           attempt_count = outbox.attempt_count + 1,
           updated_at = clock_timestamp()
      from candidates
     where outbox.id = candidates.id
    returning outbox.id,
              outbox.bucket_id,
              outbox.storage_path,
              outbox.sweep_phase,
              outbox.attempt_count
  )
  select claimed.id,
         claimed.bucket_id,
         claimed.storage_path,
         claimed.sweep_phase,
         claimed.attempt_count
    from claimed;
end;
$$;

revoke all on function public.claim_messenger_attachment_cleanup_v2(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_messenger_attachment_cleanup_v2(integer, uuid)
  to service_role;

create or replace function public.complete_messenger_attachment_cleanup_v2(
  p_job_id uuid,
  p_removed boolean,
  p_error_code text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_job public.messenger_attachment_cleanup_outbox%rowtype;
  v_next_status text;
begin
  select *
    into v_job
    from public.messenger_attachment_cleanup_outbox outbox
   where outbox.id = p_job_id
   for update;
  if v_job.id is null or v_job.status <> 'processing' then
    raise exception 'attachment_cleanup_job_not_claimed';
  end if;

  if p_removed then
    update public.messenger_attachment_cleanup_outbox
       set status = 'completed',
           bucket_id = null,
           storage_path = null,
           attachment_id = null,
           batch_id = null,
           locked_at = null,
           last_error_code = null,
           completed_at = v_now,
           updated_at = v_now
     where id = v_job.id;
    if v_job.attachment_id is not null
       and not exists (
         select 1
           from public.messenger_attachment_cleanup_outbox pending
          where pending.attachment_id = v_job.attachment_id
            and pending.id <> v_job.id
            and pending.status <> 'completed'
       ) then
      update public.messenger_attachment_objects
         set status = 'deleted',
             deleted_at = coalesce(deleted_at, v_now)
       where id = v_job.attachment_id
         and status = 'tombstoned';
    end if;
    return jsonb_build_object('status', 'completed');
  end if;

  v_next_status := case
    when v_job.attempt_count >= v_job.max_attempts then 'exhausted'
    else 'pending'
  end;
  update public.messenger_attachment_cleanup_outbox
     set status = v_next_status,
         not_before = case
           when v_next_status = 'pending'
             then v_now + make_interval(
               secs => least(3600, (power(2, least(attempt_count, 11))::integer * 5))
             )
           else not_before
         end,
         locked_at = null,
         last_error_code = left(coalesce(nullif(p_error_code, ''), 'storage_remove_failed'), 80),
         updated_at = v_now
   where id = v_job.id;
  return jsonb_build_object('status', v_next_status);
end;
$$;

revoke all on function public.complete_messenger_attachment_cleanup_v2(
  uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.complete_messenger_attachment_cleanup_v2(
  uuid, boolean, text
) to service_role;

create or replace function public.requeue_exhausted_messenger_attachment_cleanup_v2(
  p_limit integer default 25
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with candidates as (
    select outbox.id
      from public.messenger_attachment_cleanup_outbox outbox
     where outbox.status = 'exhausted'
     order by outbox.updated_at, outbox.id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.messenger_attachment_cleanup_outbox outbox
     set status = 'pending',
         attempt_count = 0,
         not_before = clock_timestamp(),
         locked_at = null,
         last_error_code = null,
         updated_at = clock_timestamp()
    from candidates
   where outbox.id = candidates.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.requeue_exhausted_messenger_attachment_cleanup_v2(integer)
  from public, anon, authenticated;
grant execute on function public.requeue_exhausted_messenger_attachment_cleanup_v2(integer)
  to service_role;

create or replace function public.queue_messenger_attachment_actor_cleanup_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_actor_role text;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_lock record;
  v_lock_conversation_id uuid;
  v_target_conversation_ids uuid[];
  v_broadcast_batch record;
  v_reconciled_conversation_ids uuid[];
  v_remaining integer;
begin
  v_actor_role := case tg_table_name
    when 'fc_profiles' then 'fc'
    when 'manager_accounts' then 'manager'
    when 'admin_accounts' then 'admin'
    else null
  end;
  if v_actor_role is null then
    raise exception 'invalid_attachment_actor_cleanup_trigger';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_actor_role || ':' || old.id::text, 0)
  );

  if v_actor_role = 'fc' then
    select array_agg(conversation.id order by conversation.id)
      into v_target_conversation_ids
      from public.garamin_direct_conversations conversation
     where conversation.fc_id = old.id;

    -- Lock every affected batch owner before taking batch row locks. This keeps
    -- reserve/commit/delete serialization in the same actor-lock order.
    for v_lock in
      select distinct affected.actor_role, affected.actor_id
        from (
          select batch.actor_role, batch.actor_id
            from public.messenger_attachment_delivery_batches batch
           where batch.context_kind = 'direct'
             and batch.conversation_id = any(v_target_conversation_ids)
             and batch.status not in ('deleted', 'revoked')
          union
          select batch.actor_role, batch.actor_id
            from public.messenger_attachment_delivery_batches batch
           where batch.context_kind = 'direct_broadcast'
             and batch.conversation_ids && v_target_conversation_ids
             and batch.status not in ('deleted', 'revoked')
        ) affected
       order by affected.actor_role, affected.actor_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(v_lock.actor_role || ':' || v_lock.actor_id::text, 0)
      );
    end loop;

    -- Reserve and commit take the same context locks after their actor lock.
    -- Once these are held no new pending/committed delivery can enter a
    -- conversation that is being cascaded away.
    for v_lock_conversation_id in
      select conversation_id
        from unnest(v_target_conversation_ids) requested(conversation_id)
       order by conversation_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(
          'messenger-direct-context:' || v_lock_conversation_id::text,
          0
        )
      );
    end loop;

    -- The legacy account-delete transaction may hard-delete recipient message
    -- rows before this profile trigger runs. Reconcile broadcast batches from
    -- their durable conversation context, then derive the surviving reference
    -- count from whichever undeleted messages remain.
    for v_broadcast_batch in
      select batch.id, batch.status
        from public.messenger_attachment_delivery_batches batch
       where batch.context_kind = 'direct_broadcast'
         and batch.conversation_ids && v_target_conversation_ids
         and batch.status not in ('deleted', 'revoked')
       order by batch.id
       for update
    loop
      update public.messages
         set deleted_at = coalesce(deleted_at, v_now),
             deleted_by_actor_id = coalesce(deleted_by_actor_id, old.id),
             content = ''
       where attachment_batch_id = v_broadcast_batch.id
         and conversation_id = any(v_target_conversation_ids)
         and deleted_at is null;

      if v_broadcast_batch.status = 'committed' then
        select array_agg(
                 distinct message.conversation_id
                 order by message.conversation_id
               ),
               count(*)
          into v_reconciled_conversation_ids, v_remaining
          from public.messages message
         where message.attachment_batch_id = v_broadcast_batch.id
           and message.conversation_id is not null
           and message.deleted_at is null;
        if v_remaining > 0 then
          update public.messenger_attachment_delivery_batches
             set conversation_ids = v_reconciled_conversation_ids,
                 updated_at = v_now
           where id = v_broadcast_batch.id;
          update public.messenger_attachment_objects
             set reference_count = v_remaining
           where batch_id = v_broadcast_batch.id
             and status = 'active';
        end if;
      end if;
    end loop;
  end if;

  for v_batch in
    select batch.*
      from public.messenger_attachment_delivery_batches batch
     where (
         (
           batch.actor_id = old.id
           and batch.actor_role = v_actor_role
         )
         or (
           v_actor_role = 'fc'
           and batch.context_kind = 'direct'
           and batch.conversation_id = any(v_target_conversation_ids)
         )
         or (
           v_actor_role = 'fc'
           and batch.context_kind = 'direct_broadcast'
           and batch.conversation_ids && v_target_conversation_ids
           and (
             batch.status in ('pending', 'expired')
             or (
               batch.status = 'committed'
               and not exists (
                 select 1
                   from public.messages message
                  where message.attachment_batch_id = batch.id
                    and message.deleted_at is null
               )
             )
           )
         )
       )
       and batch.status not in ('deleted', 'revoked')
     for update
  loop
    update public.messages
       set deleted_at = coalesce(deleted_at, v_now),
           deleted_by_actor_id = coalesce(deleted_by_actor_id, old.id),
           content = ''
     where attachment_batch_id = v_batch.id
       and deleted_at is null;
    update public.group_chat_messages
       set deleted_at = coalesce(deleted_at, v_now),
           content = ''
     where attachment_batch_id = v_batch.id
       and deleted_at is null;
    delete from public.group_chat_notices notice
     where notice.message_id in (
       select message.id
         from public.group_chat_messages message
        where message.attachment_batch_id = v_batch.id
     );

    insert into public.messenger_attachment_deletion_audit (
      original_name,
      byte_size,
      sha256,
      reason_code,
      deleted_at
    )
    select attachment.original_name,
           attachment.byte_size,
           attachment.sha256,
           'account_deleted',
           v_now
      from public.messenger_attachment_objects attachment
     where attachment.batch_id = v_batch.id
       and attachment.status = 'active';

    insert into public.messenger_attachment_cleanup_outbox (
      attachment_id,
      batch_id,
      bucket_id,
      storage_path,
      reason_code,
      sweep_phase,
      not_before
    )
    select candidate.attachment_id,
           v_batch.id,
           candidate.bucket_id,
           candidate.storage_path,
           'account_deleted',
           phase.sweep_phase,
           case phase.sweep_phase
             when 'immediate' then v_now
             else greatest(v_batch.expires_at, v_now) + interval '5 minutes'
           end
      from (
        select attachment.id as attachment_id,
               attachment.bucket_id,
               attachment.storage_path
          from public.messenger_attachment_objects attachment
         where attachment.batch_id = v_batch.id
           and attachment.storage_path is not null
        union all
        select null::uuid,
               intent.bucket_id,
               intent.object_path
          from public.messenger_attachment_upload_intents intent
         where intent.batch_id = v_batch.id
           and intent.object_path is not null
      ) candidate
      cross join (
        values ('immediate'::text), ('post_token_expiry'::text)
      ) phase(sweep_phase)
    on conflict (bucket_id, storage_path, sweep_phase)
      where bucket_id is not null and storage_path is not null
    do update set
      not_before = least(
        public.messenger_attachment_cleanup_outbox.not_before,
        excluded.not_before
      ),
      status = case
        when public.messenger_attachment_cleanup_outbox.status = 'completed'
          then 'pending'
        else public.messenger_attachment_cleanup_outbox.status
      end,
      completed_at = null,
      updated_at = v_now;

    update public.messenger_attachment_upload_intents
       set status = 'revoked',
           object_path = null,
           updated_at = v_now
     where batch_id = v_batch.id
       and status in ('pending', 'validated', 'expired');
    update public.messenger_attachment_objects
       set bucket_id = null,
           storage_path = null,
           reference_count = 0,
           status = 'tombstoned',
           tombstoned_at = coalesce(tombstoned_at, v_now)
     where batch_id = v_batch.id
       and status = 'active';
    update public.messenger_attachment_delivery_batches
       set status = 'deleted',
           deleted_at = coalesce(deleted_at, v_now),
           updated_at = v_now
     where id = v_batch.id;
  end loop;
  return old;
end;
$$;

revoke all on function public.queue_messenger_attachment_actor_cleanup_v2()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_queue_fc_messenger_attachment_cleanup
  on public.fc_profiles;
create trigger trg_queue_fc_messenger_attachment_cleanup
  before delete on public.fc_profiles
  for each row execute function public.queue_messenger_attachment_actor_cleanup_v2();

drop trigger if exists trg_queue_manager_messenger_attachment_cleanup
  on public.manager_accounts;
create trigger trg_queue_manager_messenger_attachment_cleanup
  before delete on public.manager_accounts
  for each row execute function public.queue_messenger_attachment_actor_cleanup_v2();

drop trigger if exists trg_queue_admin_messenger_attachment_cleanup
  on public.admin_accounts;
create trigger trg_queue_admin_messenger_attachment_cleanup
  before delete on public.admin_accounts
  for each row execute function public.queue_messenger_attachment_actor_cleanup_v2();

-- Staff-assisted exam applications.
-- Historical fee_paid_date values are retained, while new v3 submissions rely
-- on the mandatory payment proof and store no manually entered payment date.

alter table public.exam_registration_decision_events
  add column if not exists actor_manager_id_snapshot uuid;

alter table public.exam_registration_decision_events
  add column if not exists target_fc_id_snapshot uuid;

alter table public.exam_registration_decision_events
  drop constraint if exists exam_registration_decision_events_actor_type_check;

alter table public.exam_registration_decision_events
  add constraint exam_registration_decision_events_actor_type_check
  check (actor_type in ('fc', 'manager', 'admin', 'developer', 'service'));

create or replace function public.submit_exam_registration_with_payment_proof_v3(
  p_fc_id uuid,
  p_resident_id text,
  p_round_id uuid,
  p_location_id uuid,
  p_includes_primary_exam boolean,
  p_is_third_exam boolean,
  p_fee_paid_date date,
  p_upload_id uuid,
  p_actor_type text,
  p_actor_admin_id uuid,
  p_actor_manager_id uuid,
  p_actor_fc_id uuid
)
returns table (
  registration_id uuid,
  previous_proof_path text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_round public.exam_rounds%rowtype;
  v_upload public.exam_payment_proof_uploads%rowtype;
  v_exam_month date;
  v_previous_proof_path text;
  v_action text;
begin
  if p_fc_id is null or nullif(btrim(p_resident_id), '') is null then
    raise exception using errcode = '22023', message = 'invalid_exam_target';
  end if;
  if not exists (
    select 1
      from public.fc_profiles profile
     where profile.id = p_fc_id
       and profile.signup_completed = true
       and profile.is_manager_referral_shadow = false
       and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g')
         = regexp_replace(p_resident_id, '[^0-9]', '', 'g')
       and (
         p_actor_type = 'fc'
         or (
           coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
           and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
           and not exists (
             select 1
               from public.manager_accounts manager_target
              where manager_target.active = true
                and regexp_replace(coalesce(manager_target.phone, ''), '[^0-9]', '', 'g')
                  = regexp_replace(p_resident_id, '[^0-9]', '', 'g')
           )
           and not exists (
             select 1
               from public.admin_accounts staff_target
              where staff_target.active = true
                and regexp_replace(coalesce(staff_target.phone, ''), '[^0-9]', '', 'g')
                  = regexp_replace(p_resident_id, '[^0-9]', '', 'g')
           )
         )
       )
  ) then
    raise exception using errcode = '42501', message = 'invalid_exam_target';
  end if;
  if not coalesce(p_includes_primary_exam, false)
     and not coalesce(p_is_third_exam, false) then
    raise exception using errcode = '23514', message = 'exam_subject_required';
  end if;
  if p_fee_paid_date is not null and p_fee_paid_date > current_date then
    raise exception using errcode = '22023', message = 'invalid_fee_paid_date';
  end if;

  if p_actor_type = 'fc' then
    if p_actor_fc_id is distinct from p_fc_id
       or p_actor_admin_id is not null
       or p_actor_manager_id is not null then
      raise exception using errcode = '42501', message = 'invalid_exam_actor';
    end if;
  elsif p_actor_type = 'manager' then
    if p_actor_manager_id is null
       or p_actor_admin_id is not null
       or p_actor_fc_id is not null
       or not exists (
         select 1
           from public.manager_accounts manager
          where manager.id = p_actor_manager_id
            and manager.active = true
       ) then
      raise exception using errcode = '42501', message = 'invalid_exam_actor';
    end if;
  elsif p_actor_type in ('admin', 'developer') then
    if p_actor_admin_id is null
       or p_actor_manager_id is not null
       or p_actor_fc_id is not null
       or not exists (
         select 1
           from public.admin_accounts admin_row
          where admin_row.id = p_actor_admin_id
            and admin_row.active = true
            and (
              (p_actor_type = 'developer' and admin_row.staff_type = 'developer')
              or (
                p_actor_type = 'admin'
                and coalesce(admin_row.staff_type, 'admin') = 'admin'
              )
            )
       ) then
      raise exception using errcode = '42501', message = 'invalid_exam_actor';
    end if;
  else
    raise exception using errcode = '42501', message = 'invalid_exam_actor';
  end if;

  select round_row.*
    into v_round
    from public.exam_rounds round_row
   where round_row.id = p_round_id
   for share;

  if v_round.id is null
     or v_round.exam_month is null
     or v_round.exam_type is null
     or v_round.exam_type not in ('life', 'nonlife') then
    raise exception using errcode = '22023', message = 'invalid_exam_round';
  end if;
  if v_round.registration_deadline < current_date then
    raise exception using errcode = '55000', message = 'exam_round_closed';
  end if;
  if not exists (
    select 1
      from public.exam_locations location
     where location.id = p_location_id
       and location.round_id = p_round_id
  ) then
    raise exception using errcode = '23503', message = 'invalid_exam_location';
  end if;

  v_exam_month := v_round.exam_month;
  perform pg_advisory_xact_lock(
    hashtextextended(p_fc_id::text || ':' || v_exam_month::text, 0)
  );

  select registration.*
    into v_registration
    from public.exam_registrations registration
   where registration.fc_id = p_fc_id
     and registration.exam_month = v_exam_month
     and registration.exam_type = v_round.exam_type
     and registration.status in ('applied', 'confirmed', 'completed', 'no_show')
   order by registration.created_at, registration.id
   limit 1
   for update;

  if v_registration.id is not null
     and (
       v_registration.round_id <> p_round_id
       or v_registration.status <> 'applied'
       or coalesce(v_registration.is_confirmed, false)
     ) then
    raise exception using errcode = '23505', message = 'active_exam_month_already_registered';
  end if;

  if p_upload_id is null then
    if v_registration.id is null
       or not coalesce(v_registration.payment_proof_attached, false) then
      raise exception using errcode = '23514', message = 'payment_proof_required';
    end if;
  else
    select upload.*
      into v_upload
      from public.exam_payment_proof_uploads upload
     where upload.id = p_upload_id
       and upload.fc_id = p_fc_id
     for update;

    if v_upload.id is null then
      raise exception using errcode = '22023', message = 'payment_proof_not_found';
    end if;
    if v_upload.status = 'pending' and v_upload.expires_at <= now() then
      raise exception using errcode = '55000', message = 'payment_proof_expired';
    end if;
    if v_upload.status = 'attached' then
      if v_registration.id is null
         or v_upload.registration_id <> v_registration.id then
        raise exception using errcode = '55000', message = 'payment_proof_already_used';
      end if;
    elsif v_upload.status <> 'pending' then
      raise exception using errcode = '55000', message = 'payment_proof_not_available';
    end if;
  end if;

  if v_registration.id is null then
    insert into public.exam_registrations (
      resident_id,
      fc_id,
      round_id,
      location_id,
      exam_month,
      exam_type,
      status,
      is_confirmed,
      includes_primary_exam,
      is_third_exam,
      fee_paid_date,
      payment_proof_attached,
      payment_proof_policy_version
    ) values (
      btrim(p_resident_id),
      p_fc_id,
      p_round_id,
      p_location_id,
      v_exam_month,
      v_round.exam_type,
      'applied',
      false,
      p_includes_primary_exam,
      p_is_third_exam,
      p_fee_paid_date,
      p_upload_id is not null,
      1
    )
    returning * into v_registration;
    v_action := 'submitted';
  else
    update public.exam_registrations
       set resident_id = btrim(p_resident_id),
           location_id = p_location_id,
           includes_primary_exam = p_includes_primary_exam,
           is_third_exam = p_is_third_exam,
           fee_paid_date = coalesce(v_registration.fee_paid_date, p_fee_paid_date),
           payment_proof_attached =
             payment_proof_attached or p_upload_id is not null,
           payment_proof_policy_version = 1
     where id = v_registration.id
    returning * into v_registration;
    v_action := 'updated';
  end if;

  if p_upload_id is not null and v_upload.status = 'pending' then
    select proof.storage_path
      into v_previous_proof_path
      from public.exam_payment_proof_uploads proof
     where proof.registration_id = v_registration.id
       and proof.status = 'attached'
     for update;

    update public.exam_payment_proof_uploads proof
       set status = 'replaced'
     where proof.registration_id = v_registration.id
       and proof.status = 'attached';

    update public.exam_payment_proof_uploads proof
       set status = 'attached',
           registration_id = v_registration.id,
           consumed_at = now()
     where proof.id = p_upload_id;
  end if;

  insert into public.exam_registration_decision_events (
    registration_id,
    action,
    from_status,
    to_status,
    actor_type,
    actor_admin_id_snapshot,
    actor_manager_id_snapshot,
    actor_fc_id_snapshot,
    target_fc_id_snapshot
  ) values (
    v_registration.id,
    v_action,
    case when v_action = 'updated' then 'applied' else null end,
    'applied',
    p_actor_type,
    p_actor_admin_id,
    p_actor_manager_id,
    p_actor_fc_id,
    p_fc_id
  );

  return query
  select v_registration.id, v_previous_proof_path;
end;
$$;

revoke all on function public.submit_exam_registration_with_payment_proof_v3(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid, text, uuid, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.submit_exam_registration_with_payment_proof_v3(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid, text, uuid, uuid, uuid
) to service_role;

-- Canonical target-isolated GaramIn direct-message contract.
-- Keep this block byte-equivalent to migration 20260729032148.
-- Keep the legacy one-row-per-FC conversation as a compatibility envelope.
-- New clients address a target-specific thread while old clients continue to
-- address the legacy conversation and are routed to the shared admin thread.

create table if not exists public.garamin_direct_threads (
  id uuid primary key default gen_random_uuid(),
  legacy_conversation_id uuid not null
    references public.garamin_direct_conversations(id) on delete cascade,
  counterparty_role text not null
    check (counterparty_role in ('admin', 'manager', 'developer')),
  counterparty_actor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint garamin_direct_threads_counterparty_shape_check check (
    (counterparty_role = 'admin' and counterparty_actor_id is null)
    or
    (counterparty_role in ('manager', 'developer') and counterparty_actor_id is not null)
  ),
  constraint garamin_direct_threads_target_unique
    unique nulls not distinct (
      legacy_conversation_id,
      counterparty_role,
      counterparty_actor_id
    )
);

create index if not exists idx_garamin_direct_threads_counterparty
  on public.garamin_direct_threads (
    counterparty_role,
    counterparty_actor_id,
    legacy_conversation_id
  );

alter table public.garamin_direct_threads enable row level security;
revoke all privileges on table public.garamin_direct_threads
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.garamin_direct_threads
  to service_role;

drop policy if exists "garamin direct threads service role"
  on public.garamin_direct_threads;
create policy "garamin direct threads service role"
  on public.garamin_direct_threads
  for all
  to service_role
  using (true)
  with check (true);

alter table public.messages
  add column if not exists thread_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_thread_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_thread_id_fkey
      foreign key (thread_id)
      references public.garamin_direct_threads(id)
      on delete set null
      not valid;
  end if;
end
$$;

create index if not exists idx_messages_thread_created
  on public.messages (thread_id, created_at);
create index if not exists idx_messages_thread_unread
  on public.messages (thread_id, receiver_id, is_read, created_at);

insert into public.garamin_direct_threads (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
)
select conversation.id, 'admin', null
  from public.garamin_direct_conversations conversation
on conflict (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
) do nothing;

update public.messages message
   set thread_id = thread.id
  from public.garamin_direct_threads thread
 where message.thread_id is null
   and message.conversation_id = thread.legacy_conversation_id
   and thread.counterparty_role = 'admin'
   and thread.counterparty_actor_id is null;

-- Replies whose immutable sender actor identifies one exact developer or
-- manager are not ambiguous. Preserve those replies in that actor's personal
-- thread; FC messages addressed only to the old "admin" alias stay shared.
insert into public.garamin_direct_threads (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
)
select distinct
  message.conversation_id,
  'developer',
  message.sender_actor_id
from public.messages message
join public.garamin_direct_conversations conversation
  on conversation.id = message.conversation_id
join public.admin_accounts account
  on account.id = message.sender_actor_id
 and account.staff_type = 'developer'
where message.sender_actor_id is not null
  and message.receiver_actor_id = conversation.fc_id
on conflict (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
) do nothing;

insert into public.garamin_direct_threads (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
)
select distinct
  message.conversation_id,
  'manager',
  message.sender_actor_id
from public.messages message
join public.garamin_direct_conversations conversation
  on conversation.id = message.conversation_id
join public.manager_accounts account
  on account.id = message.sender_actor_id
where message.sender_actor_id is not null
  and message.receiver_actor_id = conversation.fc_id
on conflict (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
) do nothing;

update public.messages message
   set thread_id = thread.id
  from public.garamin_direct_threads thread
 where message.conversation_id = thread.legacy_conversation_id
   and message.sender_actor_id = thread.counterparty_actor_id
   and thread.counterparty_role in ('developer', 'manager');

create or replace function public.assign_legacy_garamin_direct_thread_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.thread_id is null and new.conversation_id is not null then
    select thread.id
      into new.thread_id
      from public.garamin_direct_threads thread
     where thread.legacy_conversation_id = new.conversation_id
       and thread.counterparty_role = 'admin'
       and thread.counterparty_actor_id is null;
  end if;
  return new;
end;
$$;

revoke all on function public.assign_legacy_garamin_direct_thread_v2()
  from public, anon, authenticated;

drop trigger if exists messages_assign_legacy_direct_thread_v2
  on public.messages;
create trigger messages_assign_legacy_direct_thread_v2
before insert or update of conversation_id, thread_id
on public.messages
for each row
execute function public.assign_legacy_garamin_direct_thread_v2();

create or replace function public.assert_garamin_direct_message_identity_v2(
  p_conversation_id uuid,
  p_sender_id text,
  p_receiver_id text,
  p_sender_actor_id uuid,
  p_receiver_actor_id uuid
)
returns table (
  resolved_thread_id uuid,
  resolved_legacy_conversation_id uuid,
  resolved_fc_id uuid,
  resolved_fc_phone text,
  resolved_counterparty_role text,
  resolved_counterparty_actor_id uuid,
  resolved_counterparty_phone text,
  resolved_sender_role text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_thread public.garamin_direct_threads%rowtype;
  v_fc_id uuid;
  v_fc_phone text;
  v_counterparty_phone text;
  v_staff_type text;
  v_requested_counterparty_role text;
  v_requested_counterparty_actor_id uuid;
begin
  if p_conversation_id is null
     or p_sender_actor_id is null then
    raise exception 'invalid_direct_message_payload';
  end if;

  select thread.*
    into v_thread
    from public.garamin_direct_threads thread
   where thread.id = p_conversation_id;

  if v_thread.id is null then
    if exists (
      select 1
        from public.admin_accounts account
       where account.id = p_sender_actor_id
         and account.active = true
         and account.staff_type = 'developer'
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_sender_id
    ) then
      v_requested_counterparty_role := 'developer';
      v_requested_counterparty_actor_id := p_sender_actor_id;
    elsif exists (
      select 1
        from public.manager_accounts account
       where account.id = p_sender_actor_id
         and account.active = true
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_sender_id
    ) then
      v_requested_counterparty_role := 'manager';
      v_requested_counterparty_actor_id := p_sender_actor_id;
    else
      v_requested_counterparty_role := 'admin';
      v_requested_counterparty_actor_id := null;
    end if;

    if not exists (
      select 1
        from public.garamin_direct_conversations conversation
       where conversation.id = p_conversation_id
    ) then
      raise exception 'direct_conversation_not_found';
    end if;

    insert into public.garamin_direct_threads (
      legacy_conversation_id,
      counterparty_role,
      counterparty_actor_id
    )
    values (
      p_conversation_id,
      v_requested_counterparty_role,
      v_requested_counterparty_actor_id
    )
    on conflict (
      legacy_conversation_id,
      counterparty_role,
      counterparty_actor_id
    ) do update
      set updated_at = now()
    returning * into v_thread;
  end if;
  if v_thread.id is null then
    raise exception 'direct_conversation_not_found';
  end if;

  select profile.id, regexp_replace(profile.phone, '[^0-9]', '', 'g')
    into v_fc_id, v_fc_phone
    from public.garamin_direct_conversations conversation
    join public.fc_profiles profile
      on profile.id = conversation.fc_id
     and profile.signup_completed = true
     and coalesce(profile.is_manager_referral_shadow, false) = false
     and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
     and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
   where conversation.id = v_thread.legacy_conversation_id;
  if v_fc_id is null or length(v_fc_phone) <> 11 then
    raise exception 'direct_conversation_not_found';
  end if;

  if v_thread.counterparty_role = 'admin' then
    if v_thread.counterparty_actor_id is not null then
      raise exception 'direct_message_identity_mismatch';
    end if;
    v_counterparty_phone := null;
  elsif v_thread.counterparty_role = 'developer' then
    select regexp_replace(account.phone, '[^0-9]', '', 'g'),
           coalesce(account.staff_type, 'admin')
      into v_counterparty_phone, v_staff_type
      from public.admin_accounts account
     where account.id = v_thread.counterparty_actor_id
       and account.active = true
       and account.staff_type = 'developer';
    if not found or length(v_counterparty_phone) <> 11 then
      raise exception 'direct_message_recipient_not_found';
    end if;
  elsif v_thread.counterparty_role = 'manager' then
    select regexp_replace(account.phone, '[^0-9]', '', 'g')
      into v_counterparty_phone
      from public.manager_accounts account
     where account.id = v_thread.counterparty_actor_id
       and account.active = true;
    if not found or length(v_counterparty_phone) <> 11 then
      raise exception 'direct_message_recipient_not_found';
    end if;
  else
    raise exception 'direct_message_identity_mismatch';
  end if;

  if p_sender_id = v_fc_phone and p_sender_actor_id = v_fc_id then
    if v_thread.counterparty_role = 'admin' then
      if p_receiver_id is distinct from 'admin'
         or p_receiver_actor_id is not null
         or not exists (
           select 1
             from public.admin_accounts account
            where account.active = true
              and coalesce(account.staff_type, 'admin') <> 'developer'
         ) then
        raise exception 'direct_message_actor_mismatch';
      end if;
    elsif p_receiver_id is distinct from v_counterparty_phone
       or p_receiver_actor_id is distinct from v_thread.counterparty_actor_id then
      raise exception 'direct_message_actor_mismatch';
    end if;
    resolved_sender_role := 'fc';
  elsif p_receiver_id = v_fc_phone
     and p_receiver_actor_id = v_fc_id then
    if v_thread.counterparty_role = 'admin' then
      if p_sender_id is distinct from 'admin'
         or not exists (
           select 1
             from public.admin_accounts account
            where account.id = p_sender_actor_id
              and account.active = true
              and coalesce(account.staff_type, 'admin') <> 'developer'
         ) then
        raise exception 'direct_message_actor_mismatch';
      end if;
      resolved_sender_role := 'admin';
    elsif v_thread.counterparty_role = 'developer' then
      if p_sender_actor_id is distinct from v_thread.counterparty_actor_id
         or p_sender_id is distinct from v_counterparty_phone then
        raise exception 'direct_message_actor_mismatch';
      end if;
      resolved_sender_role := 'admin';
    else
      if p_sender_actor_id is distinct from v_thread.counterparty_actor_id
         or p_sender_id is distinct from v_counterparty_phone then
        raise exception 'direct_message_actor_mismatch';
      end if;
      resolved_sender_role := 'manager';
    end if;
  else
    raise exception 'direct_message_identity_mismatch';
  end if;

  resolved_thread_id := v_thread.id;
  resolved_legacy_conversation_id := v_thread.legacy_conversation_id;
  resolved_fc_id := v_fc_id;
  resolved_fc_phone := v_fc_phone;
  resolved_counterparty_role := v_thread.counterparty_role;
  resolved_counterparty_actor_id := v_thread.counterparty_actor_id;
  resolved_counterparty_phone := v_counterparty_phone;
  return next;
end;
$$;

revoke all on function public.assert_garamin_direct_message_identity_v2(
  uuid, text, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.assert_garamin_direct_message_identity_v2(
  uuid, text, text, uuid, uuid
) to service_role;

create or replace function public.send_garamin_direct_message_with_notification(
  p_message_id uuid,
  p_conversation_id uuid,
  p_sender_id text,
  p_receiver_id text,
  p_sender_actor_id uuid,
  p_receiver_actor_id uuid,
  p_content text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_identity record;
  v_existing_message public.messages%rowtype;
  v_notification_rows jsonb;
begin
  if p_message_id is null
     or coalesce(length(btrim(p_content)), 0) = 0
     or length(p_content) > 4000 then
    raise exception 'invalid_direct_message_payload';
  end if;

  select *
    into v_identity
    from public.assert_garamin_direct_message_identity_v2(
      p_conversation_id,
      p_sender_id,
      p_receiver_id,
      p_sender_actor_id,
      p_receiver_actor_id
    );

  insert into public.messages (
    id,
    conversation_id,
    thread_id,
    sender_id,
    receiver_id,
    sender_actor_id,
    receiver_actor_id,
    content,
    message_type,
    is_read
  )
  values (
    p_message_id,
    v_identity.resolved_legacy_conversation_id,
    v_identity.resolved_thread_id,
    p_sender_id,
    p_receiver_id,
    p_sender_actor_id,
    p_receiver_actor_id,
    p_content,
    'text',
    false
  )
  on conflict (id) do nothing;

  select message.*
    into v_existing_message
    from public.messages message
   where message.id = p_message_id;
  if v_existing_message.id is null
     or v_existing_message.conversation_id
        is distinct from v_identity.resolved_legacy_conversation_id
     or v_existing_message.thread_id
        is distinct from v_identity.resolved_thread_id
     or v_existing_message.sender_id is distinct from p_sender_id
     or v_existing_message.receiver_id is distinct from p_receiver_id
     or v_existing_message.sender_actor_id is distinct from p_sender_actor_id
     or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
     or v_existing_message.content is distinct from p_content
     or v_existing_message.message_type is distinct from 'text' then
    raise exception 'direct_message_idempotency_conflict';
  end if;

  if v_identity.resolved_sender_role = 'fc'
     and v_identity.resolved_counterparty_role = 'admin' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      select
        '새 메시지',
        left(p_content, 160),
        'message',
        v_identity.resolved_fc_id,
        account.phone,
        account.id,
        'admin',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':' || account.id::text
      from public.admin_accounts account
      where account.active = true
        and coalesce(account.staff_type, 'admin') <> 'developer'
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning id, resident_id, recipient_actor_id, recipient_role, target
    )
    select coalesce(
      jsonb_agg(to_jsonb(inserted) order by inserted.recipient_actor_id),
      '[]'::jsonb
    )
      into v_notification_rows
      from inserted;
  elsif v_identity.resolved_sender_role = 'fc' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      values (
        '새 메시지',
        left(p_content, 160),
        'message',
        v_identity.resolved_fc_id,
        v_identity.resolved_counterparty_phone,
        v_identity.resolved_counterparty_actor_id,
        case
          when v_identity.resolved_counterparty_role = 'manager'
            then 'manager'
          else 'admin'
        end,
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':'
          || v_identity.resolved_counterparty_actor_id::text
      )
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning id, resident_id, recipient_actor_id, recipient_role, target
    )
    select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
      into v_notification_rows
      from inserted;
  else
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      values (
        '새 메시지',
        left(p_content, 160),
        'message',
        v_identity.resolved_fc_id,
        v_identity.resolved_fc_phone,
        v_identity.resolved_fc_id,
        'fc',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':'
          || v_identity.resolved_fc_id::text
      )
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning id, resident_id, recipient_actor_id, recipient_role, target
    )
    select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
      into v_notification_rows
      from inserted;
  end if;

  if jsonb_array_length(coalesce(v_notification_rows, '[]'::jsonb)) = 0 then
    raise exception 'direct_message_notification_not_persisted';
  end if;

  return jsonb_build_object(
    'message_id', p_message_id,
    'notifications', v_notification_rows
  );
end;
$$;

revoke all on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) to service_role;

create or replace function public.commit_garamin_direct_message_with_attachments_v2(
  p_message_id uuid,
  p_conversation_id uuid,
  p_sender_id text,
  p_receiver_id text,
  p_sender_actor_id uuid,
  p_receiver_actor_id uuid,
  p_content text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_attachment_intent_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_identity record;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_existing_message public.messages%rowtype;
  v_attachments jsonb;
  v_notifications jsonb;
  v_notification_ids uuid[];
begin
  if p_message_id is null
     or p_delivery_key is null
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_attachment_intent_ids is null
     or cardinality(p_attachment_intent_ids) not between 1 and 10
     or length(coalesce(p_content, '')) > 4000 then
    raise exception 'invalid_direct_attachment_message';
  end if;

  select *
    into v_identity
    from public.assert_garamin_direct_message_identity_v2(
      p_conversation_id,
      p_sender_id,
      p_receiver_id,
      p_sender_actor_id,
      p_receiver_actor_id
    );

  perform pg_advisory_xact_lock(
    hashtextextended(
      'messenger-direct-thread:' || v_identity.resolved_thread_id::text,
      0
    )
  );

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_sender_actor_id
     and batch.actor_role = v_identity.resolved_sender_role
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
     or v_batch.context_kind <> 'direct'
     or v_batch.conversation_id
        <> v_identity.resolved_legacy_conversation_id then
    raise exception 'attachment_idempotency_conflict';
  end if;
  if (
    select array_agg(intent.id order by intent.sort_order)
      from public.messenger_attachment_upload_intents intent
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
  ) is distinct from p_attachment_intent_ids then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  if v_batch.status = 'committed' then
    select *
      into v_existing_message
      from public.messages message
     where message.id = p_message_id
       and message.attachment_batch_id = v_batch.id;
    if v_existing_message.id is null
       or v_existing_message.conversation_id
          is distinct from v_identity.resolved_legacy_conversation_id
       or v_existing_message.thread_id
          is distinct from v_identity.resolved_thread_id
       or v_existing_message.sender_actor_id is distinct from p_sender_actor_id
       or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
       or v_existing_message.content is distinct from coalesce(p_content, '') then
      raise exception 'attachment_idempotency_conflict';
    end if;
    select coalesce(
      jsonb_agg(to_jsonb(notification) order by notification.id),
      '[]'::jsonb
    )
      into v_notifications
      from public.notifications notification
     where notification.id = any(v_batch.notification_ids);
    return jsonb_build_object(
      'message_id', p_message_id,
      'batch_id', v_batch.id,
      'replayed', true,
      'attachments',
        public.materialize_messenger_attachment_batch_v2(v_batch.id, 1),
      'notifications', v_notifications
    );
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  v_attachments :=
    public.materialize_messenger_attachment_batch_v2(v_batch.id, 1);

  insert into public.messages (
    id,
    conversation_id,
    thread_id,
    sender_id,
    receiver_id,
    sender_actor_id,
    receiver_actor_id,
    content,
    message_type,
    is_read,
    attachment_batch_id
  )
  values (
    p_message_id,
    v_identity.resolved_legacy_conversation_id,
    v_identity.resolved_thread_id,
    p_sender_id,
    p_receiver_id,
    p_sender_actor_id,
    p_receiver_actor_id,
    coalesce(p_content, ''),
    'file',
    false,
    v_batch.id
  )
  on conflict (id) do nothing;

  select *
    into v_existing_message
    from public.messages message
   where message.id = p_message_id;
  if v_existing_message.id is null
     or v_existing_message.conversation_id
        is distinct from v_identity.resolved_legacy_conversation_id
     or v_existing_message.thread_id
        is distinct from v_identity.resolved_thread_id
     or v_existing_message.sender_actor_id is distinct from p_sender_actor_id
     or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
     or v_existing_message.content is distinct from coalesce(p_content, '')
     or v_existing_message.attachment_batch_id <> v_batch.id then
    raise exception 'attachment_idempotency_conflict';
  end if;

  if v_identity.resolved_sender_role = 'fc'
     and v_identity.resolved_counterparty_role = 'admin' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      select
        '새 메시지',
        left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
        'message',
        v_identity.resolved_fc_id,
        account.phone,
        account.id,
        'admin',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':' || account.id::text
      from public.admin_accounts account
      where account.active = true
        and coalesce(account.staff_type, 'admin') <> 'developer'
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning *
    )
    select coalesce(
             jsonb_agg(to_jsonb(inserted) order by inserted.recipient_actor_id),
             '[]'::jsonb
           ),
           coalesce(
             array_agg(inserted.id order by inserted.recipient_actor_id),
             array[]::uuid[]
           )
      into v_notifications, v_notification_ids
      from inserted;
  elsif v_identity.resolved_sender_role = 'fc' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      values (
        '새 메시지',
        left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
        'message',
        v_identity.resolved_fc_id,
        v_identity.resolved_counterparty_phone,
        v_identity.resolved_counterparty_actor_id,
        case
          when v_identity.resolved_counterparty_role = 'manager'
            then 'manager'
          else 'admin'
        end,
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':'
          || v_identity.resolved_counterparty_actor_id::text
      )
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb),
           coalesce(array_agg(inserted.id), array[]::uuid[])
      into v_notifications, v_notification_ids
      from inserted;
  else
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      values (
        '새 메시지',
        left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
        'message',
        v_identity.resolved_fc_id,
        v_identity.resolved_fc_phone,
        v_identity.resolved_fc_id,
        'fc',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':'
          || v_identity.resolved_fc_id::text
      )
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb),
           coalesce(array_agg(inserted.id), array[]::uuid[])
      into v_notifications, v_notification_ids
      from inserted;
  end if;

  if cardinality(v_notification_ids) < 1 then
    raise exception 'direct_message_notification_not_persisted';
  end if;

  update public.messenger_attachment_delivery_batches
     set status = 'committed',
         committed_message_ids = array[p_message_id],
         notification_ids = v_notification_ids,
         committed_at = v_now,
         updated_at = v_now
   where id = v_batch.id;

  return jsonb_build_object(
    'message_id', p_message_id,
    'batch_id', v_batch.id,
    'replayed', false,
    'attachments', v_attachments,
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) to service_role;

create or replace function public.commit_garamin_direct_broadcast_with_attachments_v2(
  p_message_ids uuid[],
  p_conversation_ids uuid[],
  p_sender_actor_id uuid,
  p_content text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_attachment_intent_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer := cardinality(p_conversation_ids);
  v_index integer;
  v_requested_id uuid;
  v_thread public.garamin_direct_threads%rowtype;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_sorted_conversation_ids uuid[];
  v_sender_phone text;
  v_sender_staff_type text;
  v_sender_id text;
  v_thread_ids uuid[] := array[]::uuid[];
  v_legacy_ids uuid[] := array[]::uuid[];
  v_fc_ids uuid[] := array[]::uuid[];
  v_fc_phones text[] := array[]::text[];
  v_fc_id uuid;
  v_fc_phone text;
  v_lock_thread_id uuid;
  v_attachments jsonb;
  v_notifications jsonb;
  v_notification_ids uuid[];
begin
  if p_sender_actor_id is null
     or p_message_ids is null
     or p_conversation_ids is null
     or p_delivery_key is null
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_attachment_intent_ids is null
     or v_count not between 1 and 200
     or cardinality(p_message_ids) <> v_count
     or cardinality(p_attachment_intent_ids) not between 1 and 10
     or length(coalesce(p_content, '')) > 4000
     or cardinality(
       array(select distinct value from unnest(p_conversation_ids) value)
     ) <> v_count
     or cardinality(
       array(select distinct value from unnest(p_message_ids) value)
     ) <> v_count then
    raise exception 'invalid_direct_broadcast_attachment_message';
  end if;

  select regexp_replace(account.phone, '[^0-9]', '', 'g'),
         coalesce(account.staff_type, 'admin')
    into v_sender_phone, v_sender_staff_type
    from public.admin_accounts account
   where account.id = p_sender_actor_id
     and account.active = true
     and coalesce(account.staff_type, 'admin') in ('admin', 'developer');
  if not found or length(v_sender_phone) <> 11 then
    raise exception 'invalid_direct_broadcast_attachment_message';
  end if;
  v_sender_id := case
    when v_sender_staff_type = 'developer' then v_sender_phone
    else 'admin'
  end;

  for v_index in 1..v_count loop
    v_requested_id := p_conversation_ids[v_index];
    v_thread.id := null;

    select thread.*
      into v_thread
      from public.garamin_direct_threads thread
     where thread.id = v_requested_id;
    if v_thread.id is null then
      if not exists (
        select 1
          from public.garamin_direct_conversations conversation
         where conversation.id = v_requested_id
      ) then
        raise exception 'attachment_context_not_found';
      end if;
      insert into public.garamin_direct_threads (
        legacy_conversation_id,
        counterparty_role,
        counterparty_actor_id
      )
      values (
        v_requested_id,
        case
          when v_sender_staff_type = 'developer' then 'developer'
          else 'admin'
        end,
        case
          when v_sender_staff_type = 'developer' then p_sender_actor_id
          else null
        end
      )
      on conflict (
        legacy_conversation_id,
        counterparty_role,
        counterparty_actor_id
      ) do update
        set updated_at = now()
      returning * into v_thread;
    end if;
    if v_thread.id is null then
      raise exception 'attachment_context_not_found';
    end if;

    if v_sender_staff_type = 'developer' then
      if v_thread.counterparty_role <> 'developer'
         or v_thread.counterparty_actor_id is distinct from p_sender_actor_id then
        raise exception 'attachment_context_forbidden';
      end if;
    elsif v_thread.counterparty_role <> 'admin'
       or v_thread.counterparty_actor_id is not null then
      raise exception 'attachment_context_forbidden';
    end if;

    select profile.id, regexp_replace(profile.phone, '[^0-9]', '', 'g')
      into v_fc_id, v_fc_phone
      from public.garamin_direct_conversations conversation
      join public.fc_profiles profile
        on profile.id = conversation.fc_id
       and profile.signup_completed = true
       and coalesce(profile.is_manager_referral_shadow, false) = false
       and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
       and replace(coalesce(profile.affiliation, ''), ' ', '')
           not like '%설계매니저%'
     where conversation.id = v_thread.legacy_conversation_id;
    if v_fc_id is null or length(v_fc_phone) <> 11 then
      raise exception 'attachment_context_not_found';
    end if;

    v_thread_ids := array_append(v_thread_ids, v_thread.id);
    v_legacy_ids :=
      array_append(v_legacy_ids, v_thread.legacy_conversation_id);
    v_fc_ids := array_append(v_fc_ids, v_fc_id);
    v_fc_phones := array_append(v_fc_phones, v_fc_phone);
  end loop;

  if cardinality(
    array(select distinct value from unnest(v_thread_ids) value)
  ) <> v_count then
    raise exception 'invalid_direct_broadcast_attachment_message';
  end if;

  select array_agg(value order by value)
    into v_sorted_conversation_ids
    from unnest(v_legacy_ids) value;

  for v_lock_thread_id in
    select value from unnest(v_thread_ids) value order by value
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'messenger-direct-thread:' || v_lock_thread_id::text,
        0
      )
    );
  end loop;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_sender_actor_id
     and batch.actor_role = 'admin'
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
     or v_batch.context_kind <> 'direct_broadcast'
     or v_batch.conversation_ids is distinct from v_sorted_conversation_ids then
    raise exception 'attachment_idempotency_conflict';
  end if;
  if (
    select array_agg(intent.id order by intent.sort_order)
      from public.messenger_attachment_upload_intents intent
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
  ) is distinct from p_attachment_intent_ids then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  if v_batch.status = 'committed' then
    if v_batch.committed_message_ids is distinct from p_message_ids
       or (
         select count(*)
           from unnest(
             p_message_ids,
             v_thread_ids,
             v_legacy_ids
           ) as requested(message_id, thread_id, legacy_id)
           join public.messages message
             on message.id = requested.message_id
            and message.thread_id = requested.thread_id
            and message.conversation_id = requested.legacy_id
          where message.attachment_batch_id = v_batch.id
            and message.sender_actor_id = p_sender_actor_id
            and message.content is not distinct from coalesce(p_content, '')
       ) <> v_count then
      raise exception 'attachment_idempotency_conflict';
    end if;
    select coalesce(
      jsonb_agg(to_jsonb(notification) order by notification.id),
      '[]'::jsonb
    )
      into v_notifications
      from public.notifications notification
     where notification.id = any(v_batch.notification_ids);
    return jsonb_build_object(
      'message_ids', to_jsonb(p_message_ids),
      'batch_id', v_batch.id,
      'replayed', true,
      'attachments',
        public.materialize_messenger_attachment_batch_v2(v_batch.id, v_count),
      'notifications', v_notifications
    );
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  v_attachments :=
    public.materialize_messenger_attachment_batch_v2(v_batch.id, v_count);

  insert into public.messages (
    id,
    conversation_id,
    thread_id,
    sender_id,
    receiver_id,
    sender_actor_id,
    receiver_actor_id,
    content,
    message_type,
    is_read,
    attachment_batch_id
  )
  select
    requested.message_id,
    requested.legacy_id,
    requested.thread_id,
    v_sender_id,
    requested.fc_phone,
    p_sender_actor_id,
    requested.fc_id,
    coalesce(p_content, ''),
    'file',
    false,
    v_batch.id
  from unnest(
    p_message_ids,
    v_thread_ids,
    v_legacy_ids,
    v_fc_ids,
    v_fc_phones
  ) as requested(message_id, thread_id, legacy_id, fc_id, fc_phone)
  on conflict (id) do nothing;

  if (
    select count(*)
      from unnest(
        p_message_ids,
        v_thread_ids,
        v_legacy_ids
      ) as requested(message_id, thread_id, legacy_id)
      join public.messages message
        on message.id = requested.message_id
       and message.thread_id = requested.thread_id
       and message.conversation_id = requested.legacy_id
     where message.attachment_batch_id = v_batch.id
       and message.sender_actor_id = p_sender_actor_id
       and message.content is not distinct from coalesce(p_content, '')
  ) <> v_count then
    raise exception 'attachment_idempotency_conflict';
  end if;

  with inserted as (
    insert into public.notifications (
      title, body, category, fc_id, resident_id, recipient_actor_id,
      recipient_role, target, target_url, delivery_key
    )
    select
      '새 메시지',
      left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
      'message',
      requested.fc_id,
      requested.fc_phone,
      requested.fc_id,
      'fc',
      jsonb_build_object(
        'version', 1,
        'kind', 'garamin_direct_chat',
        'conversationId', requested.public_conversation_id
      ),
      '/chat',
      'direct_message:' || requested.message_id::text || ':'
        || requested.fc_id::text
    from unnest(
      p_message_ids,
      p_conversation_ids,
      v_fc_ids,
      v_fc_phones
    ) as requested(
      message_id,
      public_conversation_id,
      fc_id,
      fc_phone
    )
    on conflict (delivery_key) do update
      set delivery_key = excluded.delivery_key
    returning *
  )
  select coalesce(
           jsonb_agg(to_jsonb(inserted) order by inserted.id),
           '[]'::jsonb
         ),
         coalesce(
           array_agg(inserted.id order by inserted.id),
           array[]::uuid[]
         )
    into v_notifications, v_notification_ids
    from inserted;
  if cardinality(v_notification_ids) <> v_count then
    raise exception 'direct_message_notification_not_persisted';
  end if;

  update public.messenger_attachment_delivery_batches
     set status = 'committed',
         committed_message_ids = p_message_ids,
         notification_ids = v_notification_ids,
         committed_at = v_now,
         updated_at = v_now
   where id = v_batch.id;

  return jsonb_build_object(
    'message_ids', to_jsonb(p_message_ids),
    'batch_id', v_batch.id,
    'replayed', false,
    'attachments', v_attachments,
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) to service_role;

-- Preserve the proven quota/file validation implementation and put a
-- target-aware authorization adapter in front of it. The legacy function
-- stores the one-per-FC envelope in attachment batches; the linked message
-- remains bound to the exact target thread.
alter function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) rename to reserve_messenger_attachment_upload_batch_legacy_v2;

create or replace function public.reserve_messenger_attachment_upload_batch_v2(
  p_actor_id uuid,
  p_actor_role text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_context jsonb,
  p_files jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_kind text := p_context->>'kind';
  v_requested_id uuid;
  v_thread public.garamin_direct_threads%rowtype;
  v_legacy_id uuid;
  v_legacy_ids uuid[] := array[]::uuid[];
  v_requested_ids uuid[];
  v_actor_staff_type text;
  v_requested_counterparty_role text;
  v_requested_counterparty_actor_id uuid;
  v_context jsonb := p_context;
begin
  if v_kind not in ('direct', 'direct_broadcast') then
    return public.reserve_messenger_attachment_upload_batch_legacy_v2(
      p_actor_id,
      p_actor_role,
      p_delivery_key,
      p_payload_fingerprint,
      p_context,
      p_files
    );
  end if;

  if v_kind = 'direct' then
    begin
      v_requested_ids := array[(p_context->>'conversationId')::uuid];
    exception when others then
      raise exception 'invalid_attachment_context';
    end;
  else
    if jsonb_typeof(p_context->'conversationIds') <> 'array'
       or jsonb_array_length(p_context->'conversationIds')
          not between 1 and 200 then
      raise exception 'invalid_attachment_context';
    end if;
    begin
      select array_agg(value::uuid order by value::uuid)
        into v_requested_ids
        from (
          select distinct
            jsonb_array_elements_text(p_context->'conversationIds') as value
        ) requested;
    exception when others then
      raise exception 'invalid_attachment_context';
    end;
    if cardinality(v_requested_ids)
       <> jsonb_array_length(p_context->'conversationIds') then
      raise exception 'invalid_attachment_context';
    end if;
  end if;

  if p_actor_role = 'admin' then
    select coalesce(account.staff_type, 'admin')
      into v_actor_staff_type
      from public.admin_accounts account
     where account.id = p_actor_id
       and account.active = true
       and coalesce(account.staff_type, 'admin') in ('admin', 'developer');
    if not found then
      raise exception 'attachment_context_forbidden';
    end if;
  end if;

  foreach v_requested_id in array v_requested_ids loop
    v_thread.id := null;
    select thread.*
      into v_thread
      from public.garamin_direct_threads thread
     where thread.id = v_requested_id;
    if v_thread.id is null then
      if p_actor_role = 'manager' then
        v_requested_counterparty_role := 'manager';
        v_requested_counterparty_actor_id := p_actor_id;
      elsif p_actor_role = 'admin'
         and v_actor_staff_type = 'developer' then
        v_requested_counterparty_role := 'developer';
        v_requested_counterparty_actor_id := p_actor_id;
      else
        v_requested_counterparty_role := 'admin';
        v_requested_counterparty_actor_id := null;
      end if;
      if not exists (
        select 1
          from public.garamin_direct_conversations conversation
         where conversation.id = v_requested_id
      ) then
        raise exception 'attachment_context_not_found';
      end if;
      insert into public.garamin_direct_threads (
        legacy_conversation_id,
        counterparty_role,
        counterparty_actor_id
      )
      values (
        v_requested_id,
        v_requested_counterparty_role,
        v_requested_counterparty_actor_id
      )
      on conflict (
        legacy_conversation_id,
        counterparty_role,
        counterparty_actor_id
      ) do update
        set updated_at = now()
      returning * into v_thread;
    end if;
    if v_thread.id is null then
      raise exception 'attachment_context_not_found';
    end if;

    if p_actor_role = 'fc' then
      if v_kind <> 'direct'
         or not exists (
           select 1
             from public.garamin_direct_conversations conversation
            where conversation.id = v_thread.legacy_conversation_id
              and conversation.fc_id = p_actor_id
         ) then
        raise exception 'attachment_context_forbidden';
      end if;
    elsif p_actor_role = 'manager' then
      if v_kind <> 'direct'
         or v_thread.counterparty_role <> 'manager'
         or v_thread.counterparty_actor_id is distinct from p_actor_id then
        raise exception 'attachment_context_forbidden';
      end if;
    elsif p_actor_role = 'admin' then
      if v_actor_staff_type = 'developer' then
        if v_thread.counterparty_role <> 'developer'
           or v_thread.counterparty_actor_id is distinct from p_actor_id then
          raise exception 'attachment_context_forbidden';
        end if;
      elsif v_thread.counterparty_role <> 'admin'
         or v_thread.counterparty_actor_id is not null then
        raise exception 'attachment_context_forbidden';
      end if;
    else
      raise exception 'attachment_context_forbidden';
    end if;

    v_legacy_id := v_thread.legacy_conversation_id;
    v_legacy_ids := array_append(v_legacy_ids, v_legacy_id);
  end loop;

  if v_kind = 'direct' then
    v_context := jsonb_build_object(
      'kind', 'direct',
      'conversationId', v_legacy_ids[1]::text
    );
  else
    if cardinality(
      array(select distinct value from unnest(v_legacy_ids) value)
    ) <> cardinality(v_legacy_ids) then
      raise exception 'invalid_attachment_context';
    end if;
    v_context := jsonb_build_object(
      'kind', 'direct_broadcast',
      'conversationIds',
      to_jsonb(array(select value from unnest(v_legacy_ids) value order by value))
    );
  end if;

  return public.reserve_messenger_attachment_upload_batch_legacy_v2(
    p_actor_id,
    p_actor_role,
    p_delivery_key,
    p_payload_fingerprint,
    v_context,
    p_files
  );
end;
$$;

revoke all on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) to service_role;

create index if not exists idx_messages_live_content_trgm
  on public.messages using gin (content extensions.gin_trgm_ops)
  where deleted_at is null;

-- Keep direct-message persistence and room-mute enforcement in one database
-- transaction. The preference lookup is deliberately fail-closed for the
-- notification side only: an unreadable/missing preference relation suppresses
-- the notification row, while the already-validated message remains committed.
--
-- The notification INSERTs in the three canonical direct-message RPCs all pass
-- through the trigger below. A transaction-local suppression counter lets the
-- existing RPC integrity checks distinguish an intentionally muted recipient
-- from an unexpected failure to persist an unmuted notification.

create or replace function public.garamin_direct_room_notification_allowed_v1(
  p_recipient_actor_id uuid,
  p_recipient_role text,
  p_room_key text
)
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_recipient_actor_id is null
     or p_recipient_role not in ('fc', 'manager', 'admin')
     or p_room_key is null
     or p_room_key !~ '^garamin:direct-thread:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  return not exists (
    select 1
      from public.messenger_room_notification_preferences preference
     where preference.actor_id = p_recipient_actor_id
       and preference.actor_role = p_recipient_role
       and preference.room_key = p_room_key
       and preference.muted = true
  );
exception
  -- Preference availability must never reopen notifications. This containment
  -- also preserves the message transaction when the preference schema/read is
  -- temporarily unavailable. No error details are logged because they may
  -- contain identifiers.
  when others then
    return false;
end;
$$;

revoke all on function public.garamin_direct_room_notification_allowed_v1(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.garamin_direct_room_notification_allowed_v1(
  uuid, text, text
) to service_role;

create or replace function public.enforce_garamin_direct_room_mute_on_notification_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_message_id uuid;
  v_thread_id uuid;
  v_suppressed integer;
begin
  if new.category is distinct from 'message'
     or coalesce(new.target ->> 'kind', '') <> 'garamin_direct_chat' then
    return new;
  end if;

  -- Preserve the original idempotent replay result. A notification that was
  -- durably created by an earlier unmuted call is not a new notification and
  -- must remain eligible for the existing ON CONFLICT replay path.
  if exists (
    select 1
      from public.notifications notification
     where notification.delivery_key = new.delivery_key
  ) then
    return new;
  end if;

  begin
    if coalesce(new.delivery_key, '') !~
       '^direct_message:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'direct_notification_delivery_key_unresolved';
    end if;

    v_message_id := split_part(new.delivery_key, ':', 2)::uuid;
    select message.thread_id
      into v_thread_id
      from public.messages message
     where message.id = v_message_id;

    if v_thread_id is null then
      raise exception 'direct_notification_thread_unresolved';
    end if;

    if public.garamin_direct_room_notification_allowed_v1(
      new.recipient_actor_id,
      new.recipient_role,
      'garamin:direct-thread:' || v_thread_id::text
    ) then
      return new;
    end if;
  exception
    -- Any resolution or preference-read failure is notification-fail-closed.
    -- Returning null from a BEFORE INSERT trigger skips only this notification;
    -- the surrounding RPC transaction can still commit its message row.
    when others then
      null;
  end;

  begin
    v_suppressed := coalesce(
      nullif(
        current_setting(
          'app.garamin_direct_room_notifications_suppressed',
          true
        ),
        ''
      )::integer,
      0
    );
  exception
    when others then
      v_suppressed := 0;
  end;

  perform set_config(
    'app.garamin_direct_room_notifications_suppressed',
    (v_suppressed + 1)::text,
    true
  );
  return null;
end;
$$;

revoke all on function public.enforce_garamin_direct_room_mute_on_notification_v1()
  from public, anon, authenticated;
grant execute on function public.enforce_garamin_direct_room_mute_on_notification_v1()
  to service_role;

drop trigger if exists notifications_garamin_direct_room_mute_v1
  on public.notifications;
create trigger notifications_garamin_direct_room_mute_v1
  before insert on public.notifications
  for each row
  execute function public.enforce_garamin_direct_room_mute_on_notification_v1();

-- Patch only the three current service-role RPCs. Each replacement is guarded
-- so a drifted predecessor fails the migration rather than silently shipping a
-- function whose notification integrity check still rolls back muted messages.
do $migration$
declare
  v_definition text;
  v_original text;
  v_step text;
begin
  select pg_get_functiondef(
    'public.send_garamin_direct_message_with_notification(uuid,uuid,text,text,uuid,uuid,text)'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'  if v_identity.resolved_sender_role = \'fc\'\n     and v_identity.resolved_counterparty_role = \'admin\' then',
    E'  perform set_config(\'app.garamin_direct_room_notifications_suppressed\', \'0\', true);\n\n  if v_identity.resolved_sender_role = \'fc\'\n     and v_identity.resolved_counterparty_role = \'admin\' then'
  );
  if v_definition = v_original then
    raise exception 'direct_text_room_mute_reset_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'  if jsonb_array_length(coalesce(v_notification_rows, \'[]\'::jsonb)) = 0 then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;',
    E'  if jsonb_array_length(coalesce(v_notification_rows, \'[]\'::jsonb)) = 0\n     and coalesce(nullif(current_setting(\'app.garamin_direct_room_notifications_suppressed\', true), \'\')::integer, 0) = 0 then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;'
  );
  if v_definition = v_step then
    raise exception 'direct_text_room_mute_patch_source_drift';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.commit_garamin_direct_message_with_attachments_v2(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid[])'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'  if v_identity.resolved_sender_role = \'fc\'\n     and v_identity.resolved_counterparty_role = \'admin\' then',
    E'  perform set_config(\'app.garamin_direct_room_notifications_suppressed\', \'0\', true);\n\n  if v_identity.resolved_sender_role = \'fc\'\n     and v_identity.resolved_counterparty_role = \'admin\' then'
  );
  if v_definition = v_original then
    raise exception 'direct_attachment_room_mute_reset_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'  if cardinality(v_notification_ids) < 1 then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;',
    E'  if cardinality(v_notification_ids) < 1\n     and coalesce(nullif(current_setting(\'app.garamin_direct_room_notifications_suppressed\', true), \'\')::integer, 0) = 0 then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;'
  );
  if v_definition = v_step then
    raise exception 'direct_attachment_room_mute_patch_source_drift';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.commit_garamin_direct_broadcast_with_attachments_v2(uuid[],uuid[],uuid,text,uuid,text,uuid[])'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'  with inserted as (\n    insert into public.notifications (',
    E'  perform set_config(\'app.garamin_direct_room_notifications_suppressed\', \'0\', true);\n\n  with inserted as (\n    insert into public.notifications ('
  );
  if v_definition = v_original then
    raise exception 'direct_broadcast_room_mute_reset_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'  if cardinality(v_notification_ids) <> v_count then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;',
    E'  if cardinality(v_notification_ids)\n       + coalesce(nullif(current_setting(\'app.garamin_direct_room_notifications_suppressed\', true), \'\')::integer, 0)\n       <> v_count then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;'
  );
  if v_definition = v_step then
    raise exception 'direct_broadcast_room_mute_patch_source_drift';
  end if;
  execute v_definition;
end;
$migration$;

-- CREATE OR REPLACE keeps prior ACLs on existing functions, but repeat the
-- boundary explicitly so migration review does not depend on inherited state.
revoke all on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) to service_role;

revoke all on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) to service_role;

revoke all on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) to service_role;
-- Internal Messenger V2 list summaries are computed in Postgres so the Edge
-- function never downloads unbounded message history or attachment batches.
create index if not exists idx_messages_live_sender_receiver_created
  on public.messages (sender_id, receiver_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists idx_messages_live_unread_receiver_sender
  on public.messages (receiver_id, sender_id, created_at desc, id desc)
  where deleted_at is null and is_read = false;

create or replace function public.get_internal_messenger_summaries_v1(
  p_viewer_id text,
  p_target_ids text[]
)
returns table (
  target_id text,
  last_message text,
  last_time timestamptz,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with targets as (
    select distinct btrim(raw_target.target_id) as target_id
    from unnest(coalesce(p_target_ids, array[]::text[])) as raw_target(target_id)
    where btrim(raw_target.target_id) <> ''
  )
  select
    target.target_id,
    latest.last_message,
    latest.created_at as last_time,
    coalesce(unread.unread_count, 0)::bigint as unread_count
  from targets as target
  left join lateral (
    select
      coalesce(
        nullif(btrim(message.content), ''),
        nullif(btrim(message.file_name), ''),
        case
          when message.attachment_batch_id is not null then '첨부파일'
          else null
        end
      ) as last_message,
      message.created_at
    from (
      select outbound.*
      from public.messages as outbound
      where outbound.sender_id = p_viewer_id
        and outbound.receiver_id = target.target_id
        and outbound.deleted_at is null

      union all

      select inbound.*
      from public.messages as inbound
      where inbound.sender_id = target.target_id
        and inbound.receiver_id = p_viewer_id
        and inbound.deleted_at is null
    ) as message
    order by message.created_at desc, message.id desc
    limit 1
  ) as latest on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.messages as unread_message
    where unread_message.receiver_id = p_viewer_id
      and unread_message.sender_id = target.target_id
      and unread_message.is_read = false
      and unread_message.deleted_at is null
  ) as unread on true
  order by target.target_id;
$$;

revoke all on function public.get_internal_messenger_summaries_v1(text, text[])
  from public, anon, authenticated;
grant execute on function public.get_internal_messenger_summaries_v1(text, text[])
  to service_role;
create or replace function public.list_internal_chat_page_v1(
  p_viewer_id text,
  p_include_all_completed_fc boolean,
  p_limit integer,
  p_cursor_latest_at timestamptz default null,
  p_cursor_fc_id uuid default null
)
returns table (
  fc_id uuid,
  name text,
  phone text,
  affiliation text,
  last_message text,
  last_time timestamptz,
  unread_count bigint,
  total_unread bigint,
  latest_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with participants as (
    select
      profile.id as fc_id,
      coalesce(nullif(btrim(profile.name), ''), regexp_replace(profile.phone, '[^0-9]', '', 'g')) as name,
      regexp_replace(profile.phone, '[^0-9]', '', 'g') as phone,
      profile.affiliation
    from public.fc_profiles as profile
    where profile.signup_completed = true
      and char_length(regexp_replace(profile.phone, '[^0-9]', '', 'g')) = 11
      and position('설계매니저' in coalesce(profile.affiliation, '')) = 0
      and (
        p_include_all_completed_fc
        or regexp_replace(coalesce(profile.affiliation, ''), '[[:space:]]+', '', 'g')
          ~ '([0-9]+본부|[0-9]+팀|직할)'
      )
  ), summaries as (
    select
      participant.fc_id,
      participant.name,
      participant.phone,
      participant.affiliation,
      latest.last_message,
      latest.created_at as last_time,
      coalesce(unread.unread_count, 0)::bigint as unread_count,
      coalesce(latest.created_at, 'epoch'::timestamptz) as latest_at
    from participants as participant
    left join lateral (
      select
        coalesce(
          nullif(btrim(message.content), ''),
          nullif(btrim(message.file_name), ''),
          case when message.attachment_batch_id is not null then '첨부파일' else null end
        ) as last_message,
        message.created_at
      from (
        select outbound.*
        from public.messages as outbound
        where outbound.sender_id = p_viewer_id
          and outbound.receiver_id = participant.phone
          and outbound.deleted_at is null
        union all
        select inbound.*
        from public.messages as inbound
        where inbound.sender_id = participant.phone
          and inbound.receiver_id = p_viewer_id
          and inbound.deleted_at is null
      ) as message
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
    left join lateral (
      select pg_catalog.count(*)::bigint as unread_count
      from public.messages as unread_message
      where unread_message.receiver_id = p_viewer_id
        and unread_message.sender_id = participant.phone
        and unread_message.is_read = false
        and unread_message.deleted_at is null
    ) as unread on true
  ), authorized_page as (
    select
      summary.*,
      pg_catalog.sum(summary.unread_count) over ()::bigint as total_unread
    from summaries as summary
  )
  select
    page.fc_id,
    page.name,
    page.phone,
    page.affiliation,
    page.last_message,
    page.last_time,
    page.unread_count,
    page.total_unread,
    page.latest_at
  from authorized_page as page
  where p_cursor_latest_at is null
    or page.latest_at < p_cursor_latest_at
    or (
      page.latest_at = p_cursor_latest_at
      and page.fc_id < p_cursor_fc_id
    )
  order by page.latest_at desc, page.fc_id desc
  limit least(greatest(p_limit, 1), 10000);
$$;

revoke all on function public.list_internal_chat_page_v1(text, boolean, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_internal_chat_page_v1(text, boolean, integer, timestamptz, uuid)
  to service_role;
-- Migration 20260808131459: personal admin direct threads v1.
-- GaramIn direct-message targets now bind plain administrators to an exact
-- active actor. The nullable admin tuple remains only for legacy shared-room
-- compatibility; new callers use the non-null actor tuple.

alter table public.garamin_direct_threads
  drop constraint if exists garamin_direct_threads_counterparty_shape_check;

alter table public.garamin_direct_threads
  add constraint garamin_direct_threads_counterparty_shape_check check (
    counterparty_role = 'admin'
    or (
      counterparty_role in ('manager', 'developer')
      and counterparty_actor_id is not null
    )
  );

create or replace function public.assert_garamin_direct_message_identity_v2(
  p_conversation_id uuid,
  p_sender_id text,
  p_receiver_id text,
  p_sender_actor_id uuid,
  p_receiver_actor_id uuid
)
returns table (
  resolved_thread_id uuid,
  resolved_legacy_conversation_id uuid,
  resolved_fc_id uuid,
  resolved_fc_phone text,
  resolved_counterparty_role text,
  resolved_counterparty_actor_id uuid,
  resolved_counterparty_phone text,
  resolved_sender_role text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_thread public.garamin_direct_threads%rowtype;
  v_fc_id uuid;
  v_fc_phone text;
  v_counterparty_phone text;
  v_requested_counterparty_role text;
  v_requested_counterparty_actor_id uuid;
begin
  if p_conversation_id is null or p_sender_actor_id is null then
    raise exception 'invalid_direct_message_payload';
  end if;

  select thread.*
    into v_thread
    from public.garamin_direct_threads thread
   where thread.id = p_conversation_id;

  if v_thread.id is null then
    if exists (
      select 1
        from public.admin_accounts account
       where account.id = p_sender_actor_id
         and account.active = true
         and account.staff_type = 'developer'
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_sender_id
    ) then
      v_requested_counterparty_role := 'developer';
      v_requested_counterparty_actor_id := p_sender_actor_id;
    elsif exists (
      select 1
        from public.admin_accounts account
       where account.id = p_sender_actor_id
         and account.active = true
         and coalesce(account.staff_type, 'admin') <> 'developer'
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_sender_id
    ) then
      v_requested_counterparty_role := 'admin';
      v_requested_counterparty_actor_id := p_sender_actor_id;
    elsif exists (
      select 1
        from public.manager_accounts account
       where account.id = p_sender_actor_id
         and account.active = true
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_sender_id
    ) then
      v_requested_counterparty_role := 'manager';
      v_requested_counterparty_actor_id := p_sender_actor_id;
    elsif exists (
      select 1
        from public.admin_accounts account
       where account.id = p_receiver_actor_id
         and account.active = true
         and account.staff_type = 'developer'
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_receiver_id
    ) then
      v_requested_counterparty_role := 'developer';
      v_requested_counterparty_actor_id := p_receiver_actor_id;
    elsif exists (
      select 1
        from public.admin_accounts account
       where account.id = p_receiver_actor_id
         and account.active = true
         and coalesce(account.staff_type, 'admin') <> 'developer'
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_receiver_id
    ) then
      v_requested_counterparty_role := 'admin';
      v_requested_counterparty_actor_id := p_receiver_actor_id;
    elsif exists (
      select 1
        from public.manager_accounts account
       where account.id = p_receiver_actor_id
         and account.active = true
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_receiver_id
    ) then
      v_requested_counterparty_role := 'manager';
      v_requested_counterparty_actor_id := p_receiver_actor_id;
    else
      v_requested_counterparty_role := 'admin';
      v_requested_counterparty_actor_id := null;
    end if;

    if not exists (
      select 1
        from public.garamin_direct_conversations conversation
       where conversation.id = p_conversation_id
    ) then
      raise exception 'direct_conversation_not_found';
    end if;

    insert into public.garamin_direct_threads (
      legacy_conversation_id,
      counterparty_role,
      counterparty_actor_id
    )
    values (
      p_conversation_id,
      v_requested_counterparty_role,
      v_requested_counterparty_actor_id
    )
    on conflict (
      legacy_conversation_id,
      counterparty_role,
      counterparty_actor_id
    ) do update
      set updated_at = now()
    returning * into v_thread;
  end if;
  if v_thread.id is null then
    raise exception 'direct_conversation_not_found';
  end if;

  select profile.id, regexp_replace(profile.phone, '[^0-9]', '', 'g')
    into v_fc_id, v_fc_phone
    from public.garamin_direct_conversations conversation
    join public.fc_profiles profile
      on profile.id = conversation.fc_id
     and profile.signup_completed = true
     and coalesce(profile.is_manager_referral_shadow, false) = false
     and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
     and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
   where conversation.id = v_thread.legacy_conversation_id;
  if v_fc_id is null or length(v_fc_phone) <> 11 then
    raise exception 'direct_conversation_not_found';
  end if;

  if v_thread.counterparty_role = 'admin' then
    if v_thread.counterparty_actor_id is null then
      v_counterparty_phone := null;
    else
      select regexp_replace(account.phone, '[^0-9]', '', 'g')
        into v_counterparty_phone
        from public.admin_accounts account
       where account.id = v_thread.counterparty_actor_id
         and account.active = true
         and coalesce(account.staff_type, 'admin') <> 'developer';
      if not found or length(v_counterparty_phone) <> 11 then
        raise exception 'direct_message_recipient_not_found';
      end if;
    end if;
  elsif v_thread.counterparty_role = 'developer' then
    select regexp_replace(account.phone, '[^0-9]', '', 'g')
      into v_counterparty_phone
      from public.admin_accounts account
     where account.id = v_thread.counterparty_actor_id
       and account.active = true
       and account.staff_type = 'developer';
    if not found or length(v_counterparty_phone) <> 11 then
      raise exception 'direct_message_recipient_not_found';
    end if;
  elsif v_thread.counterparty_role = 'manager' then
    select regexp_replace(account.phone, '[^0-9]', '', 'g')
      into v_counterparty_phone
      from public.manager_accounts account
     where account.id = v_thread.counterparty_actor_id
       and account.active = true;
    if not found or length(v_counterparty_phone) <> 11 then
      raise exception 'direct_message_recipient_not_found';
    end if;
  else
    raise exception 'direct_message_identity_mismatch';
  end if;

  if p_sender_id = v_fc_phone and p_sender_actor_id = v_fc_id then
    if v_thread.counterparty_role = 'admin'
       and v_thread.counterparty_actor_id is null then
      if p_receiver_id is distinct from 'admin'
         or p_receiver_actor_id is not null
         or not exists (
           select 1
             from public.admin_accounts account
            where account.active = true
              and coalesce(account.staff_type, 'admin') <> 'developer'
         ) then
        raise exception 'direct_message_actor_mismatch';
      end if;
    elsif p_receiver_id is distinct from v_counterparty_phone
       or p_receiver_actor_id is distinct from v_thread.counterparty_actor_id then
      raise exception 'direct_message_actor_mismatch';
    end if;
    resolved_sender_role := 'fc';
  elsif p_receiver_id = v_fc_phone and p_receiver_actor_id = v_fc_id then
    if v_thread.counterparty_role = 'admin'
       and v_thread.counterparty_actor_id is null then
      if p_sender_id is distinct from 'admin'
         or not exists (
           select 1
             from public.admin_accounts account
            where account.id = p_sender_actor_id
              and account.active = true
              and coalesce(account.staff_type, 'admin') <> 'developer'
         ) then
        raise exception 'direct_message_actor_mismatch';
      end if;
      resolved_sender_role := 'admin';
    elsif v_thread.counterparty_role in ('admin', 'developer') then
      if p_sender_actor_id is distinct from v_thread.counterparty_actor_id
         or p_sender_id is distinct from v_counterparty_phone then
        raise exception 'direct_message_actor_mismatch';
      end if;
      resolved_sender_role := 'admin';
    else
      if p_sender_actor_id is distinct from v_thread.counterparty_actor_id
         or p_sender_id is distinct from v_counterparty_phone then
        raise exception 'direct_message_actor_mismatch';
      end if;
      resolved_sender_role := 'manager';
    end if;
  else
    raise exception 'direct_message_identity_mismatch';
  end if;

  resolved_thread_id := v_thread.id;
  resolved_legacy_conversation_id := v_thread.legacy_conversation_id;
  resolved_fc_id := v_fc_id;
  resolved_fc_phone := v_fc_phone;
  resolved_counterparty_role := v_thread.counterparty_role;
  resolved_counterparty_actor_id := v_thread.counterparty_actor_id;
  resolved_counterparty_phone := v_counterparty_phone;
  return next;
end;
$$;

revoke all on function public.assert_garamin_direct_message_identity_v2(
  uuid, text, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.assert_garamin_direct_message_identity_v2(
  uuid, text, text, uuid, uuid
) to service_role;

-- Preserve the current RPC implementations (including atomic room-mute
-- accounting) and narrow only the shared-admin branches. Personal admin
-- threads use the existing single-recipient branch.
do $migration$
declare
  v_definition text;
  v_original text;
  v_step text;
begin
  select pg_get_functiondef(
    'public.send_garamin_direct_message_with_notification(uuid,uuid,text,text,uuid,uuid,text)'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'and v_identity.resolved_counterparty_role = \'admin\' then',
    E'and v_identity.resolved_counterparty_role = \'admin\'\n     and v_identity.resolved_counterparty_actor_id is null then'
  );
  if v_definition = v_original then
    raise exception 'personal_admin_direct_text_source_drift';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.commit_garamin_direct_message_with_attachments_v2(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid[])'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'and v_identity.resolved_counterparty_role = \'admin\' then',
    E'and v_identity.resolved_counterparty_role = \'admin\'\n     and v_identity.resolved_counterparty_actor_id is null then'
  );
  if v_definition = v_original then
    raise exception 'personal_admin_direct_attachment_source_drift';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.commit_garamin_direct_broadcast_with_attachments_v2(uuid[],uuid[],uuid,text,uuid,text,uuid[])'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'  v_sender_id := case\n    when v_sender_staff_type = \'developer\' then v_sender_phone\n    else \'admin\'\n  end;',
    E'  v_sender_id := v_sender_phone;'
  );
  if v_definition = v_original then
    raise exception 'personal_admin_direct_broadcast_sender_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'        case\n          when v_sender_staff_type = \'developer\' then p_sender_actor_id\n          else null\n        end',
    E'        p_sender_actor_id'
  );
  if v_definition = v_step then
    raise exception 'personal_admin_direct_broadcast_actor_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'    elsif v_thread.counterparty_role <> \'admin\'\n       or v_thread.counterparty_actor_id is not null then',
    E'    elsif v_thread.counterparty_role <> \'admin\'\n       or v_thread.counterparty_actor_id is distinct from p_sender_actor_id then'
  );
  if v_definition = v_step then
    raise exception 'personal_admin_direct_broadcast_acl_source_drift';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.reserve_messenger_attachment_upload_batch_v2(uuid,text,uuid,text,jsonb,jsonb)'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'        v_requested_counterparty_role := \'admin\';\n        v_requested_counterparty_actor_id := null;',
    E'        v_requested_counterparty_role := \'admin\';\n        v_requested_counterparty_actor_id := p_actor_id;'
  );
  if v_definition = v_original then
    raise exception 'personal_admin_attachment_reservation_actor_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'      elsif v_thread.counterparty_role <> \'admin\'\n         or v_thread.counterparty_actor_id is not null then',
    E'      elsif v_thread.counterparty_role <> \'admin\'\n         or v_thread.counterparty_actor_id is distinct from p_actor_id then'
  );
  if v_definition = v_step then
    raise exception 'personal_admin_attachment_reservation_acl_source_drift';
  end if;
  execute v_definition;
end;
$migration$;

revoke all on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) to service_role;

revoke all on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) to service_role;

revoke all on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) to service_role;

revoke all on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) to service_role;
-- 20260808151912_atomic_messenger_room_preference_patch_v1.sql
create or replace function public.patch_messenger_room_preference_v1(
  p_actor_id uuid,
  p_actor_role text,
  p_room_key text,
  p_action text,
  p_value boolean default null,
  p_updated_at timestamptz default now()
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_actor_role not in ('fc', 'manager', 'admin') then
    raise exception 'invalid_actor_role';
  end if;
  if p_action not in ('set_room', 'set_room_pinned', 'leave_room') then
    raise exception 'invalid_room_preference_action';
  end if;
  if p_action in ('set_room', 'set_room_pinned') and p_value is null then
    raise exception 'missing_room_preference_value';
  end if;
  if p_room_key !~ '^garamin:(direct-thread|group):[0-9a-f-]{36}$' then
    raise exception 'invalid_room_key';
  end if;

  insert into public.messenger_room_notification_preferences as preference (
    actor_id, actor_role, room_key, muted, pinned_at, left_at, updated_at
  ) values (
    p_actor_id,
    p_actor_role,
    p_room_key,
    case when p_action = 'set_room' then p_value else false end,
    case when p_action = 'set_room_pinned' and p_value then p_updated_at else null end,
    case when p_action = 'leave_room' then p_updated_at else null end,
    p_updated_at
  )
  on conflict (actor_id, actor_role, room_key) do update
  set muted = case when p_action = 'set_room' then excluded.muted else preference.muted end,
      pinned_at = case
        when p_action = 'set_room_pinned' then excluded.pinned_at
        when p_action = 'leave_room' then null
        else preference.pinned_at
      end,
      left_at = case when p_action = 'leave_room' then excluded.left_at else preference.left_at end,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.patch_messenger_room_preference_v1(uuid, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.patch_messenger_room_preference_v1(uuid, text, text, text, boolean, timestamptz)
  to service_role;
-- 20260810070757_admin_assisted_signup_v1.sql
-- Administrator-assisted FC signup based on a documented written-consent check.
-- This is an alternate verification basis. It must never mark phone OTP as verified.

alter table public.fc_profiles
  add column if not exists signup_verification_method text;
alter table public.fc_profiles
  add column if not exists signup_verified_at timestamptz;
alter table public.fc_profiles
  add column if not exists signup_verified_by_admin_id uuid references public.admin_accounts (id) on delete set null;

alter table public.fc_profiles
  drop constraint if exists fc_profiles_signup_verification_method_check;
alter table public.fc_profiles
  add constraint fc_profiles_signup_verification_method_check
  check (
    signup_verification_method is null
    or signup_verification_method in ('phone_otp', 'admin_written_consent')
  );

update public.fc_profiles
set signup_verification_method = 'phone_otp',
    signup_verified_at = coalesce(phone_verified_at, updated_at, created_at)
where signup_completed = true
  and phone_verified = true
  and signup_verification_method is null;

alter table public.fc_credentials
  add column if not exists must_change_password boolean not null default false;
alter table public.fc_credentials
  add column if not exists temporary_password_issued_at timestamptz;

create table if not exists public.admin_assisted_signup_consents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  fc_id uuid not null unique references public.fc_profiles (id) on delete cascade,
  actor_admin_id uuid not null references public.admin_accounts (id) on delete restrict,
  actor_staff_type text not null check (actor_staff_type in ('admin', 'developer')),
  consent_obtained_on date not null,
  evidence_reference text not null check (
    char_length(evidence_reference) between 4 and 64
    and evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{3,63}$'
  ),
  attestation_version text not null default 'admin-written-consent-v1'
    check (attestation_version = 'admin-written-consent-v1'),
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_assisted_signup_consents_actor_created
  on public.admin_assisted_signup_consents (actor_admin_id, created_at desc);

create table if not exists public.fc_password_change_challenges (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null references public.fc_profiles (id) on delete cascade,
  nonce_hash text not null unique check (nonce_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists idx_fc_password_change_challenges_active
  on public.fc_password_change_challenges (fc_id, expires_at desc)
  where used_at is null;

alter table public.admin_assisted_signup_consents enable row level security;
alter table public.fc_password_change_challenges enable row level security;

revoke all privileges on table public.admin_assisted_signup_consents from public, anon, authenticated;
revoke all privileges on table public.fc_password_change_challenges from public, anon, authenticated;
grant select, insert on table public.admin_assisted_signup_consents to service_role;
grant select, insert, update, delete on table public.fc_password_change_challenges to service_role;

create or replace function public.admin_create_assisted_signup_v1(
  p_request_id uuid,
  p_actor_phone text,
  p_actor_staff_type text,
  p_name text,
  p_phone text,
  p_affiliation text,
  p_email text,
  p_carrier text,
  p_license_statuses text[],
  p_inviter_fc_id uuid,
  p_consent_obtained_on date,
  p_evidence_reference text,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_row public.admin_accounts%rowtype;
  target_profile public.fc_profiles%rowtype;
  existing_consent public.admin_assisted_signup_consents%rowtype;
  referral_result jsonb;
  normalized_actor_phone text := regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g');
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_affiliation text := trim(coalesce(p_affiliation, ''));
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_carrier text := trim(coalesce(p_carrier, ''));
  normalized_evidence_reference text := trim(coalesce(p_evidence_reference, ''));
  target_fc_id uuid;
  now_ts timestamptz := now();
begin
  if p_request_id is null then
    raise exception 'assisted_signup_invalid_request_id';
  end if;

  -- Serialize retries and concurrent attempts for the same target identity.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 1));

  if normalized_actor_phone !~ '^01[0-9]{9}$'
    or p_actor_staff_type not in ('admin', 'developer') then
    raise exception 'assisted_signup_forbidden';
  end if;

  select account.*
    into actor_row
  from public.admin_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_actor_phone
    and account.active = true
    and account.staff_type = p_actor_staff_type
  for update;

  if not found then
    raise exception 'assisted_signup_forbidden';
  end if;

  select consent.*
    into existing_consent
  from public.admin_assisted_signup_consents consent
  where consent.request_id = p_request_id
  for update;

  if found then
    if existing_consent.actor_admin_id <> actor_row.id then
      raise exception 'assisted_signup_request_conflict';
    end if;

    return jsonb_build_object(
      'ok', true,
      'fcId', existing_consent.fc_id,
      'verificationMethod', 'admin_written_consent',
      'requiresPasswordChange', true,
      'alreadyApplied', true
    );
  end if;

  if normalized_phone !~ '^01[0-9]{9}$'
    or char_length(normalized_name) not between 2 and 40
    or char_length(normalized_affiliation) not between 2 and 80
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or normalized_carrier not in ('SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰') then
    raise exception 'assisted_signup_invalid_profile';
  end if;

  if p_license_statuses is null
    or cardinality(p_license_statuses) = 0
    or exists (
      select 1
      from unnest(p_license_statuses) status_value
      where status_value not in ('third', 'life', 'nonlife', 'none')
    )
    or (
      'none' = any(p_license_statuses)
      and cardinality(p_license_statuses) > 1
    ) then
    raise exception 'assisted_signup_invalid_license_statuses';
  end if;

  if p_inviter_fc_id is null then
    raise exception 'assisted_signup_referral_required';
  end if;

  if p_consent_obtained_on is null
    or p_consent_obtained_on > current_date
    or p_consent_obtained_on < current_date - 90 then
    raise exception 'assisted_signup_invalid_consent_date';
  end if;

  if char_length(normalized_evidence_reference) not between 4 and 64
    or normalized_evidence_reference !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{3,63}$' then
    raise exception 'assisted_signup_invalid_evidence_reference';
  end if;

  if char_length(coalesce(p_password_hash, '')) <> 44
    or p_password_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_password_salt, '')) <> 24
    or p_password_salt !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'assisted_signup_invalid_credential';
  end if;

  if exists (
    select 1 from public.admin_accounts account
    where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  ) or exists (
    select 1 from public.manager_accounts account
    where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  ) then
    raise exception 'assisted_signup_already_exists';
  end if;

  select profile.*
    into target_profile
  from public.fc_profiles profile
  where regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for update;

  if found then
    if target_profile.signup_completed is true
      or target_profile.is_manager_referral_shadow is true
      or target_profile.phone_verified is true
      or exists (
        select 1
        from public.fc_credentials credential
        where credential.fc_id = target_profile.id
          and credential.password_set_at is not null
      ) then
      raise exception 'assisted_signup_already_exists';
    end if;

    update public.fc_profiles
    set name = normalized_name,
        phone = normalized_phone,
        affiliation = normalized_affiliation,
        email = normalized_email,
        carrier = normalized_carrier,
        license_statuses = p_license_statuses,
        status = 'draft',
        life_commission_completed = false,
        nonlife_commission_completed = false,
        signup_completed = true,
        phone_verified = false,
        phone_verified_at = null,
        phone_verification_hash = null,
        phone_verification_expires_at = null,
        phone_verification_sent_at = null,
        phone_verification_attempts = 0,
        phone_verification_locked_until = null,
        signup_verification_method = 'admin_written_consent',
        signup_verified_at = now_ts,
        signup_verified_by_admin_id = actor_row.id,
        identity_completed = false,
        resident_id_masked = null,
        resident_id_hash = null,
        address = '',
        address_detail = null,
        temp_id = null,
        allowance_date = null,
        allowance_prescreen_requested_at = null,
        allowance_reject_reason = null,
        docs_deadline_at = null,
        docs_deadline_last_notified_at = null,
        appointment_url = null,
        appointment_date = null,
        appointment_schedule_life = null,
        appointment_schedule_nonlife = null,
        appointment_date_life = null,
        appointment_date_nonlife = null,
        appointment_date_life_sub = null,
        appointment_date_nonlife_sub = null,
        appointment_reject_reason_life = null,
        appointment_reject_reason_nonlife = null,
        hanwha_commission_date_sub = null,
        hanwha_commission_date = null,
        hanwha_commission_reject_reason = null,
        hanwha_commission_pdf_path = null,
        hanwha_commission_pdf_name = null,
        dawichok_url_sent_at = null,
        dawichok_url_sent_by = null,
        recommender = null,
        recommender_fc_id = null,
        recommender_code_id = null,
        recommender_code = null,
        recommender_linked_at = null,
        recommender_link_source = null,
        updated_at = now_ts
    where id = target_profile.id
    returning id into target_fc_id;
  else
    insert into public.fc_profiles (
      name,
      phone,
      affiliation,
      email,
      carrier,
      license_statuses,
      status,
      signup_completed,
      phone_verified,
      signup_verification_method,
      signup_verified_at,
      signup_verified_by_admin_id,
      identity_completed,
      address,
      life_commission_completed,
      nonlife_commission_completed,
      created_at,
      updated_at
    ) values (
      normalized_name,
      normalized_phone,
      normalized_affiliation,
      normalized_email,
      normalized_carrier,
      p_license_statuses,
      'draft',
      true,
      false,
      'admin_written_consent',
      now_ts,
      actor_row.id,
      false,
      '',
      false,
      false,
      now_ts,
      now_ts
    ) returning id into target_fc_id;
  end if;

  referral_result := public.apply_referral_link_state(
    p_invitee_fc_id => target_fc_id,
    p_inviter_fc_id => p_inviter_fc_id,
    p_referral_code_id => null,
    p_referral_code => null,
    p_source => 'admin_override',
    p_actor_phone => normalized_actor_phone,
    p_actor_role => 'admin',
    p_actor_staff_type => p_actor_staff_type,
    p_reason => 'admin_assisted_signup'
  );

  if coalesce((referral_result ->> 'ok')::boolean, false) is not true then
    raise exception 'assisted_signup_referral_failed';
  end if;

  insert into public.fc_credentials (
    fc_id,
    password_hash,
    password_salt,
    password_set_at,
    failed_count,
    locked_until,
    reset_token_hash,
    reset_token_expires_at,
    reset_sent_at,
    must_change_password,
    temporary_password_issued_at,
    created_at,
    updated_at
  ) values (
    target_fc_id,
    p_password_hash,
    p_password_salt,
    now_ts,
    0,
    null,
    null,
    null,
    null,
    true,
    now_ts,
    now_ts,
    now_ts
  )
  on conflict (fc_id) do update
  set password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_set_at = excluded.password_set_at,
      failed_count = 0,
      locked_until = null,
      reset_token_hash = null,
      reset_token_expires_at = null,
      reset_sent_at = null,
      must_change_password = true,
      temporary_password_issued_at = now_ts,
      updated_at = now_ts;

  insert into public.admin_assisted_signup_consents (
    request_id,
    fc_id,
    actor_admin_id,
    actor_staff_type,
    consent_obtained_on,
    evidence_reference,
    attestation_version,
    created_at
  ) values (
    p_request_id,
    target_fc_id,
    actor_row.id,
    p_actor_staff_type,
    p_consent_obtained_on,
    normalized_evidence_reference,
    'admin-written-consent-v1',
    now_ts
  );

  return jsonb_build_object(
    'ok', true,
    'fcId', target_fc_id,
    'verificationMethod', 'admin_written_consent',
    'requiresPasswordChange', true,
    'alreadyApplied', false
  );
end;
$$;

create or replace function public.issue_admin_assisted_password_change_v1(
  p_fc_id uuid,
  p_nonce_hash text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  now_ts timestamptz := now();
begin
  if p_fc_id is null
    or coalesce(p_nonce_hash, '') !~ '^[a-f0-9]{64}$'
    or p_expires_at <= now_ts
    or p_expires_at > now_ts + interval '30 minutes' then
    raise exception 'assisted_password_change_invalid_challenge';
  end if;

  perform 1
  from public.fc_credentials credential
  join public.fc_profiles profile on profile.id = credential.fc_id
  where credential.fc_id = p_fc_id
    and credential.must_change_password = true
    and profile.signup_completed = true
    and profile.signup_verification_method = 'admin_written_consent'
  for update of credential;

  if not found then
    raise exception 'assisted_password_change_not_required';
  end if;

  update public.fc_password_change_challenges
  set used_at = now_ts
  where fc_id = p_fc_id
    and used_at is null;

  insert into public.fc_password_change_challenges (
    fc_id,
    nonce_hash,
    expires_at,
    created_at
  ) values (
    p_fc_id,
    p_nonce_hash,
    p_expires_at,
    now_ts
  );

  return jsonb_build_object('ok', true, 'expiresAt', p_expires_at);
end;
$$;

create or replace function public.complete_admin_assisted_password_change_v1(
  p_fc_id uuid,
  p_phone text,
  p_nonce_hash text,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  now_ts timestamptz := now();
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  challenge_row public.fc_password_change_challenges%rowtype;
  profile_row public.fc_profiles%rowtype;
begin
  if p_fc_id is null
    or normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_nonce_hash, '') !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_password_hash, '')) <> 44
    or p_password_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_password_salt, '')) <> 24
    or p_password_salt !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'assisted_password_change_invalid_request';
  end if;

  select challenge.*
    into challenge_row
  from public.fc_password_change_challenges challenge
  where challenge.fc_id = p_fc_id
    and challenge.nonce_hash = p_nonce_hash
    and challenge.used_at is null
    and challenge.expires_at > now_ts
  for update;

  if not found then
    raise exception 'assisted_password_change_invalid_challenge';
  end if;

  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.id = p_fc_id
    and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = normalized_phone
    and profile.signup_completed = true
    and profile.signup_verification_method = 'admin_written_consent'
  for update;

  if not found then
    raise exception 'assisted_password_change_invalid_challenge';
  end if;

  update public.fc_credentials
  set password_hash = p_password_hash,
      password_salt = p_password_salt,
      password_set_at = now_ts,
      failed_count = 0,
      locked_until = null,
      reset_token_hash = null,
      reset_token_expires_at = null,
      reset_sent_at = null,
      must_change_password = false,
      temporary_password_issued_at = null,
      updated_at = now_ts
  where fc_id = p_fc_id
    and must_change_password = true;

  if not found then
    raise exception 'assisted_password_change_not_required';
  end if;

  update public.fc_password_change_challenges
  set used_at = now_ts
  where fc_id = p_fc_id
    and used_at is null;

  return jsonb_build_object(
    'ok', true,
    'fcId', profile_row.id,
    'phone', normalized_phone,
    'name', profile_row.name,
    'affiliation', profile_row.affiliation
  );
end;
$$;

revoke all on function public.admin_create_assisted_signup_v1(
  uuid, text, text, text, text, text, text, text, text[], uuid, date, text, text, text
) from public, anon, authenticated;
revoke all on function public.issue_admin_assisted_password_change_v1(
  uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_admin_assisted_password_change_v1(
  uuid, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.admin_create_assisted_signup_v1(
  uuid, text, text, text, text, text, text, text, text[], uuid, date, text, text, text
) to service_role;
grant execute on function public.issue_admin_assisted_password_change_v1(
  uuid, text, timestamptz
) to service_role;
grant execute on function public.complete_admin_assisted_password_change_v1(
  uuid, text, text, text, text
) to service_role;

comment on column public.fc_profiles.signup_verification_method is
  'Signup verification basis. admin_written_consent is distinct from phone OTP and does not imply phone_verified.';
comment on table public.admin_assisted_signup_consents is
  'Append-only metadata for administrator-confirmed written consent; document contents are deliberately not stored.';

-- 20260907053913_referral_allowance_pilot
-- One explicitly configured manager pilot. No configuration or production data is seeded.
create table if not exists public.referral_allowance_pilot (
  id boolean primary key default true check (id),
  manager_account_id uuid not null references public.manager_accounts(id),
  beneficiary_fc_id uuid not null references public.fc_profiles(id),
  employee_code text not null check (employee_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  enabled boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referral_allowance_imports (
  id uuid primary key default gen_random_uuid(),
  manager_account_id uuid not null references public.manager_accounts(id),
  beneficiary_fc_id uuid not null references public.fc_profiles(id),
  employee_code text not null check (employee_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  performance_month text not null check (performance_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  payment_date date not null,
  genealogy_as_of date not null check (genealogy_as_of <= payment_date),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  policy_version text not null check (policy_version = 'recruitment-2026-09-07-snapshot-pilot-v1'),
  pilot_revision bigint not null check (pilot_revision > 0),
  revision bigint not null check (revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 8388608),
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  created_by uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  published_by uuid references public.admin_accounts(id),
  published_at timestamptz,
  superseded_at timestamptz,
  unique (beneficiary_fc_id, performance_month, source_sha256, policy_version, pilot_revision),
  unique (beneficiary_fc_id, performance_month, revision),
  check (to_char(payment_date, 'YYYY-MM') = to_char(to_date(performance_month || '-01', 'YYYY-MM-DD') + interval '2 months', 'YYYY-MM')),
  check ((status = 'draft' and published_by is null and published_at is null and superseded_at is null)
    or (status = 'published' and published_by is not null and published_at is not null and superseded_at is null)
    or (status = 'superseded' and published_by is not null and published_at is not null and superseded_at is not null))
);

create unique index if not exists referral_allowance_one_published_month
  on public.referral_allowance_imports (beneficiary_fc_id, performance_month) where status = 'published';
create index if not exists referral_allowance_published_lookup
  on public.referral_allowance_imports (manager_account_id, beneficiary_fc_id, pilot_revision, performance_month desc)
  where status = 'published';

alter table public.referral_allowance_pilot enable row level security;
alter table public.referral_allowance_imports enable row level security;
revoke all on public.referral_allowance_pilot, public.referral_allowance_imports from public, anon, authenticated;
grant select, insert, update on public.referral_allowance_pilot, public.referral_allowance_imports to service_role;

-- The custom signed app session is verified by trusted Edge code; clients have no table/RPC grants.
create or replace function public.referral_allowance_pair_is_valid(p_manager_account_id uuid, p_beneficiary_fc_id uuid)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.manager_accounts m join public.fc_profiles f
      on regexp_replace(f.phone, '[^0-9]', '', 'g') = regexp_replace(m.phone, '[^0-9]', '', 'g')
    where m.id = p_manager_account_id and m.active = true and f.id = p_beneficiary_fc_id
      and regexp_replace(m.phone, '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
      and (f.signup_completed = true or f.is_manager_referral_shadow = true)
      and position('설계매니저' in coalesce(f.affiliation, '')) = 0
      and not exists (select 1 from public.admin_accounts a
        where regexp_replace(a.phone, '[^0-9]', '', 'g') = regexp_replace(m.phone, '[^0-9]', '', 'g'))
      and (select count(*) from public.fc_profiles other
        where regexp_replace(other.phone, '[^0-9]', '', 'g') = regexp_replace(m.phone, '[^0-9]', '', 'g')) = 1
  );
$$;

create or replace function public.guard_referral_allowance_import_immutability()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if (to_jsonb(new) - array['status','published_by','published_at','superseded_at'])
    is distinct from (to_jsonb(old) - array['status','published_by','published_at','superseded_at']) then
    raise exception using errcode = '23514', message = 'allowance_import_immutable';
  end if;
  if old.status = 'draft' and new.status = 'published' and new.superseded_at is null then return new; end if;
  if old.status = 'published' and new.status = 'superseded'
    and new.published_by is not distinct from old.published_by
    and new.published_at is not distinct from old.published_at then return new; end if;
  raise exception using errcode = '23514', message = 'invalid_allowance_transition';
end;
$$;
drop trigger if exists referral_allowance_import_immutable on public.referral_allowance_imports;
create trigger referral_allowance_import_immutable before update on public.referral_allowance_imports
  for each row execute function public.guard_referral_allowance_import_immutability();

create or replace function public.configure_referral_allowance_pilot(
  p_actor_admin_id uuid, p_manager_account_id uuid, p_beneficiary_fc_id uuid,
  p_employee_code text, p_enabled boolean, p_expected_revision bigint
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_pilot public.referral_allowance_pilot%rowtype;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  if p_employee_code is null or p_employee_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    or p_enabled is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_allowance_request';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_pilot from public.referral_allowance_pilot where id = true for update;
  if coalesce(v_pilot.revision, 0) <> p_expected_revision then
    raise exception using errcode = '40001', message = 'allowance_revision_conflict';
  end if;
  -- Revocation of the current pair must remain possible after account deactivation.
  if not coalesce((p_enabled = false and v_pilot.manager_account_id = p_manager_account_id
    and v_pilot.beneficiary_fc_id = p_beneficiary_fc_id and v_pilot.employee_code = p_employee_code), false)
    and not public.referral_allowance_pair_is_valid(p_manager_account_id, p_beneficiary_fc_id) then
    raise exception using errcode = '22023', message = 'invalid_allowance_pilot_pair';
  end if;
  insert into public.referral_allowance_pilot
    (id, manager_account_id, beneficiary_fc_id, employee_code, enabled, revision, updated_by)
  values (true, p_manager_account_id, p_beneficiary_fc_id, p_employee_code, p_enabled, p_expected_revision + 1, p_actor_admin_id)
  on conflict (id) do update set manager_account_id = excluded.manager_account_id,
    beneficiary_fc_id = excluded.beneficiary_fc_id, employee_code = excluded.employee_code,
    enabled = excluded.enabled, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_pilot;
  return jsonb_build_object('ok', true, 'pilot', jsonb_build_object(
    'managerAccountId', v_pilot.manager_account_id, 'beneficiaryFcId', v_pilot.beneficiary_fc_id,
    'employeeCode', v_pilot.employee_code, 'enabled', v_pilot.enabled, 'revision', v_pilot.revision));
end;
$$;

create or replace function public.create_referral_allowance_draft(
  p_actor_admin_id uuid, p_expected_pilot_revision bigint, p_expected_manager_account_id uuid,
  p_expected_beneficiary_fc_id uuid, p_expected_employee_code text, p_performance_month text,
  p_payment_date date, p_genealogy_as_of date, p_source_sha256 text, p_policy_version text, p_snapshot jsonb
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_pilot public.referral_allowance_pilot%rowtype;
  v_import public.referral_allowance_imports%rowtype;
  v_count integer;
  v_revision bigint;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_pilot from public.referral_allowance_pilot where id = true for update;
  if v_pilot.id is null or v_pilot.enabled is not true
    or v_pilot.revision is distinct from p_expected_pilot_revision
    or v_pilot.manager_account_id is distinct from p_expected_manager_account_id
    or v_pilot.beneficiary_fc_id is distinct from p_expected_beneficiary_fc_id
    or v_pilot.employee_code is distinct from p_expected_employee_code then
    raise exception using errcode = '40001', message = 'allowance_pilot_changed';
  end if;
  if not public.referral_allowance_pair_is_valid(v_pilot.manager_account_id, v_pilot.beneficiary_fc_id) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  if p_performance_month is null or p_performance_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or p_payment_date is null or p_genealogy_as_of is null
    or p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$'
    or p_policy_version is distinct from 'recruitment-2026-09-07-snapshot-pilot-v1'
    or p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or octet_length(p_snapshot::text) > 8388608 then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if p_genealogy_as_of > p_payment_date
    or to_char(p_payment_date, 'YYYY-MM') is distinct from
      to_char(to_date(p_performance_month || '-01', 'YYYY-MM-DD') + interval '2 months', 'YYYY-MM') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if p_snapshot->'schemaVersion' is distinct from '1'::jsonb
    or p_snapshot->>'policyVersion' is distinct from p_policy_version
    or p_snapshot->>'performanceMonth' is distinct from p_performance_month
    or p_snapshot->>'paymentDate' is distinct from to_char(p_payment_date, 'YYYY-MM-DD')
    or p_snapshot->>'genealogyAsOf' is distinct from to_char(p_genealogy_as_of, 'YYYY-MM-DD')
    or p_snapshot->>'eligibilityBasis' is distinct from 'uploaded_snapshot'
    or jsonb_typeof(p_snapshot->'sourceSnapshotDates') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'usesLaterSnapshot') is distinct from 'boolean'
    or p_snapshot->>'status' is distinct from 'current_month_estimate'
    or p_snapshot->'previousCarryIncluded' is distinct from 'false'::jsonb
    or jsonb_typeof(p_snapshot->'nodes') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'beneficiary') is distinct from 'object'
    or jsonb_typeof(p_snapshot->'summary') is distinct from 'object'
    or p_snapshot#>'{validation,maximumDepth}' is distinct from '10'::jsonb
    or p_snapshot#>'{validation,conservationDifferenceKrw}' is distinct from '0'::jsonb then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  -- Keep the uploaded source dates distinct from the operator's reference date.
  -- Later source snapshots are explicitly allowed for this pilot and disclosed.
  if jsonb_array_length(p_snapshot->'sourceSnapshotDates') not between 1 and 64
    or exists (select 1 from jsonb_array_elements(p_snapshot->'sourceSnapshotDates') d
      where jsonb_typeof(d) is distinct from 'string'
        or (d #>> '{}') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  begin
    if exists (select 1 from jsonb_array_elements_text(p_snapshot->'sourceSnapshotDates') d
      where to_char(to_date(d, 'YYYY-MM-DD'), 'YYYY-MM-DD') is distinct from d) then
      raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
    end if;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end;
  if (select jsonb_agg(d order by d) from
      (select distinct d from jsonb_array_elements_text(p_snapshot->'sourceSnapshotDates') d) dates)
      is distinct from p_snapshot->'sourceSnapshotDates'
    or p_snapshot->'usesLaterSnapshot' is distinct from to_jsonb(exists (
      select 1 from jsonb_array_elements_text(p_snapshot->'sourceSnapshotDates') d
      where d > to_char(p_genealogy_as_of, 'YYYY-MM-DD'))) then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  v_count := jsonb_array_length(p_snapshot->'nodes');
  if v_count < 1 or v_count > 10000
    or p_snapshot#>>'{validation,visiblePeopleCount}' is distinct from v_count::text
    or (select count(*) from jsonb_array_elements(p_snapshot->'nodes') n where n->'isBeneficiary' = 'true'::jsonb) <> 1
    or not exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n
      where n->>'id' = p_snapshot#>>'{beneficiary,nodeId}' and n->'isBeneficiary' = 'true'::jsonb and n->>'depth' = '0') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  -- Only the public beneficiary statement shape may be persisted, never raw workbook columns.
  if exists (select 1 from jsonb_object_keys(p_snapshot) k where k not in
      ('schemaVersion','policyVersion','performanceMonth','paymentDate','genealogyAsOf','sourceSnapshotDates','usesLaterSnapshot','status',
       'previousCarryIncluded','eligibilityBasis','beneficiary','nodes','summary','validation'))
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n where jsonb_typeof(n) <> 'object') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n, jsonb_object_keys(n) k where k not in
      ('id','parentId','depth','name','affiliation','isBeneficiary','activeAtPerformance','eligibleAtBasisDate',
       'finalTargetPerformanceKrw','fpRoundedAmountKrw','contributionKrw'))
    or exists (select 1 from jsonb_object_keys(p_snapshot->'beneficiary') k where k not in ('nodeId','name','eligibleAtBasisDate'))
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n where
      coalesce(n->>'id', '') !~ '^node-[0-9]{1,5}$' or coalesce(n->>'depth', '') !~ '^(10|[0-9])$'
      or jsonb_typeof(n->'name') is distinct from 'string' or jsonb_typeof(n->'affiliation') is distinct from 'string'
      or jsonb_typeof(n->'isBeneficiary') is distinct from 'boolean'
      or jsonb_typeof(n->'activeAtPerformance') is distinct from 'boolean'
      or jsonb_typeof(n->'eligibleAtBasisDate') is distinct from 'boolean')
    or (select count(distinct n->>'id') from jsonb_array_elements(p_snapshot->'nodes') n) <> v_count then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n where
      jsonb_typeof(n->'finalTargetPerformanceKrw') is distinct from 'number'
      or coalesce(n->>'finalTargetPerformanceKrw', '') !~ '^-?[0-9]{1,14}(\.[0-9]{1,2})?$')
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n,
      unnest(array['fpRoundedAmountKrw','contributionKrw']) k
      where jsonb_typeof(n->k) is distinct from 'number' or coalesce(n->>k, '') !~ '^-?[0-9]{1,16}$')
    or exists (select 1 from unnest(array['currentMonthNetKrw','newPaymentKrw','carryForwardKrw','extinguishedKrw','excludedByEligibilityKrw']) k
      where jsonb_typeof(p_snapshot->'summary'->k) is distinct from 'number'
        or coalesce(p_snapshot->'summary'->>k, '') !~ '^-?[0-9]{1,16}$') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n
      where abs((n->>'finalTargetPerformanceKrw')::numeric) * 100 > 9007199254740991)
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n,
      unnest(array['fpRoundedAmountKrw','contributionKrw']) k where abs((n->>k)::numeric) > 9007199254740991)
    or exists (select 1 from unnest(array['currentMonthNetKrw','newPaymentKrw','carryForwardKrw','extinguishedKrw','excludedByEligibilityKrw']) k
      where abs((p_snapshot->'summary'->>k)::numeric) > 9007199254740991)
    or (select sum((n->>'contributionKrw')::numeric) from jsonb_array_elements(p_snapshot->'nodes') n)
      <> (p_snapshot#>>'{summary,currentMonthNetKrw}')::numeric
    or (p_snapshot#>>'{summary,currentMonthNetKrw}')::numeric <>
      (p_snapshot#>>'{summary,newPaymentKrw}')::numeric + (p_snapshot#>>'{summary,carryForwardKrw}')::numeric
      + (p_snapshot#>>'{summary,extinguishedKrw}')::numeric + (p_snapshot#>>'{summary,excludedByEligibilityKrw}')::numeric then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  select * into v_import from public.referral_allowance_imports
    where beneficiary_fc_id = v_pilot.beneficiary_fc_id and performance_month = p_performance_month
      and source_sha256 = p_source_sha256 and policy_version = p_policy_version and pilot_revision = v_pilot.revision;
  if v_import.id is not null then
    if v_import.snapshot is distinct from p_snapshot or v_import.payment_date is distinct from p_payment_date
      or v_import.genealogy_as_of is distinct from p_genealogy_as_of or v_import.employee_code is distinct from v_pilot.employee_code
      or v_import.manager_account_id is distinct from v_pilot.manager_account_id then
      raise exception using errcode = '40001', message = 'allowance_idempotency_conflict';
    end if;
  else
    select coalesce(max(revision), 0) + 1 into v_revision from public.referral_allowance_imports
      where beneficiary_fc_id = v_pilot.beneficiary_fc_id and performance_month = p_performance_month;
    insert into public.referral_allowance_imports
      (manager_account_id, beneficiary_fc_id, employee_code, performance_month, payment_date, genealogy_as_of,
        source_sha256, policy_version, pilot_revision, revision, snapshot, created_by)
    values (v_pilot.manager_account_id, v_pilot.beneficiary_fc_id, v_pilot.employee_code, p_performance_month,
      p_payment_date, p_genealogy_as_of, p_source_sha256, p_policy_version, v_pilot.revision, v_revision, p_snapshot, p_actor_admin_id)
    returning * into v_import;
  end if;
  return jsonb_build_object('ok', true, 'import', jsonb_build_object('id', v_import.id, 'status', v_import.status,
    'revision', v_import.revision, 'sourceSha256', v_import.source_sha256, 'policyVersion', v_import.policy_version,
    'performanceMonth', v_import.performance_month, 'pilotRevision', v_import.pilot_revision));
end;
$$;

create or replace function public.publish_referral_allowance_draft(
  p_actor_admin_id uuid, p_import_id uuid, p_expected_source_sha256 text,
  p_expected_revision bigint, p_expected_pilot_revision bigint
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_pilot public.referral_allowance_pilot%rowtype;
  v_import public.referral_allowance_imports%rowtype;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_pilot from public.referral_allowance_pilot where id = true for update;
  select * into v_import from public.referral_allowance_imports where id = p_import_id for update;
  if v_pilot.id is null or v_pilot.enabled is not true or v_import.id is null
    or v_pilot.revision is distinct from p_expected_pilot_revision
    or v_import.pilot_revision is distinct from v_pilot.revision
    or v_import.manager_account_id is distinct from v_pilot.manager_account_id
    or v_import.beneficiary_fc_id is distinct from v_pilot.beneficiary_fc_id
    or v_import.employee_code is distinct from v_pilot.employee_code
    or v_import.source_sha256 is distinct from p_expected_source_sha256
    or v_import.revision is distinct from p_expected_revision
    or v_import.status = 'superseded' then
    raise exception using errcode = '40001', message = 'allowance_revision_conflict';
  end if;
  if not public.referral_allowance_pair_is_valid(v_pilot.manager_account_id, v_pilot.beneficiary_fc_id) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  if v_import.status = 'draft' then
    update public.referral_allowance_imports set status = 'superseded', superseded_at = now()
      where beneficiary_fc_id = v_import.beneficiary_fc_id and performance_month = v_import.performance_month and status = 'published';
    update public.referral_allowance_imports set status = 'published', published_by = p_actor_admin_id, published_at = now()
      where id = v_import.id returning * into v_import;
  end if;
  return jsonb_build_object('ok', true, 'import', jsonb_build_object('id', v_import.id, 'status', v_import.status,
    'revision', v_import.revision, 'sourceSha256', v_import.source_sha256, 'policyVersion', v_import.policy_version,
    'performanceMonth', v_import.performance_month, 'pilotRevision', v_import.pilot_revision));
end;
$$;

create or replace function public.read_referral_allowance_pilot(
  p_manager_account_id uuid, p_beneficiary_fc_id uuid, p_action text, p_month text default null
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_pilot public.referral_allowance_pilot%rowtype;
  v_months jsonb;
  v_snapshot jsonb;
begin
  if p_action is null or p_action not in ('access', 'statement')
    or (p_month is not null and p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') then
    raise exception using errcode = '22023', message = 'invalid_allowance_request';
  end if;
  select * into v_pilot from public.referral_allowance_pilot where id = true for share;
  if v_pilot.id is null or v_pilot.enabled is not true
    or v_pilot.manager_account_id is distinct from p_manager_account_id
    or v_pilot.beneficiary_fc_id is distinct from p_beneficiary_fc_id
    or not public.referral_allowance_pair_is_valid(p_manager_account_id, p_beneficiary_fc_id) then
    if p_action = 'access' then return jsonb_build_object('ok', true, 'enabled', false); end if;
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  select coalesce(jsonb_agg(performance_month order by performance_month desc), '[]'::jsonb) into v_months from (
    select performance_month from public.referral_allowance_imports
    where manager_account_id = v_pilot.manager_account_id and beneficiary_fc_id = v_pilot.beneficiary_fc_id
      and employee_code = v_pilot.employee_code and pilot_revision = v_pilot.revision and status = 'published'
    order by performance_month desc limit 120
  ) months;
  if p_action = 'access' then return jsonb_build_object('ok', true, 'enabled', true, 'availableMonths', v_months); end if;
  select snapshot into v_snapshot from public.referral_allowance_imports
    where manager_account_id = v_pilot.manager_account_id and beneficiary_fc_id = v_pilot.beneficiary_fc_id
      and employee_code = v_pilot.employee_code and pilot_revision = v_pilot.revision and status = 'published'
      and performance_month = coalesce(p_month, v_months->>0);
  return jsonb_build_object('ok', true, 'enabled', true, 'availableMonths', v_months, 'statement', v_snapshot);
end;
$$;

revoke all on function public.referral_allowance_pair_is_valid(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guard_referral_allowance_import_immutability() from public, anon, authenticated;
revoke all on function public.configure_referral_allowance_pilot(uuid, uuid, uuid, text, boolean, bigint) from public, anon, authenticated;
revoke all on function public.create_referral_allowance_draft(uuid, bigint, uuid, uuid, text, text, date, date, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.publish_referral_allowance_draft(uuid, uuid, text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.read_referral_allowance_pilot(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.referral_allowance_pair_is_valid(uuid, uuid) to service_role;
grant execute on function public.guard_referral_allowance_import_immutability() to service_role;
grant execute on function public.configure_referral_allowance_pilot(uuid, uuid, uuid, text, boolean, bigint) to service_role;
grant execute on function public.create_referral_allowance_draft(uuid, bigint, uuid, uuid, text, text, date, date, text, text, jsonb) to service_role;
grant execute on function public.publish_referral_allowance_draft(uuid, uuid, text, bigint, bigint) to service_role;
grant execute on function public.read_referral_allowance_pilot(uuid, uuid, text, text) to service_role;

comment on table public.referral_allowance_pilot is 'One server-controlled manager pilot; no public or signed-in client access.';
comment on table public.referral_allowance_imports is 'Immutable beneficiary-only monthly calculation snapshots; original XLSX files and other beneficiaries are not stored.';

-- 20260907115710_referral_allowance_recipients
-- Expand the existing pilot without changing published snapshots or account roles.
create table public.referral_allowance_recipients (
  beneficiary_fc_id uuid primary key references public.fc_profiles(id),
  manager_account_id uuid unique references public.manager_accounts(id),
  employee_code text not null unique check (employee_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  enabled boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.referral_allowance_recipients enable row level security;
revoke all on public.referral_allowance_recipients from public, anon, authenticated;
grant select, insert, update on public.referral_allowance_recipients to service_role;
insert into public.referral_allowance_recipients
  (beneficiary_fc_id,manager_account_id,employee_code,enabled,revision,updated_by,created_at,updated_at)
select beneficiary_fc_id,manager_account_id,employee_code,enabled,revision,updated_by,created_at,updated_at
from public.referral_allowance_pilot;
alter table public.referral_allowance_imports alter column manager_account_id drop not null;

create or replace function public.referral_allowance_pair_is_valid(p_manager_account_id uuid, p_beneficiary_fc_id uuid)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.fc_profiles f where f.id = p_beneficiary_fc_id
      and regexp_replace(f.phone, '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
      and position('설계매니저' in coalesce(f.affiliation, '')) = 0
      and not exists (select 1 from public.admin_accounts a
        where regexp_replace(a.phone, '[^0-9]', '', 'g') = regexp_replace(f.phone, '[^0-9]', '', 'g'))
      and (select count(*) from public.fc_profiles other
        where regexp_replace(other.phone, '[^0-9]', '', 'g') = regexp_replace(f.phone, '[^0-9]', '', 'g')) = 1
      and ((p_manager_account_id is null and f.signup_completed = true
        and coalesce(f.is_manager_referral_shadow, false) = false
        and not exists (select 1 from public.manager_accounts m
          where regexp_replace(m.phone, '[^0-9]', '', 'g') = regexp_replace(f.phone, '[^0-9]', '', 'g')))
      or (p_manager_account_id is not null and (f.signup_completed = true or f.is_manager_referral_shadow = true)
        and exists (select 1 from public.manager_accounts m where m.id = p_manager_account_id and m.active = true
          and regexp_replace(m.phone, '[^0-9]', '', 'g') = regexp_replace(f.phone, '[^0-9]', '', 'g'))))
  );
$$;


create or replace function public.configure_referral_allowance_pilot(
  p_actor_admin_id uuid, p_manager_account_id uuid, p_beneficiary_fc_id uuid,
  p_employee_code text, p_enabled boolean, p_expected_revision bigint
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_pilot public.referral_allowance_recipients%rowtype;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  if p_employee_code is null or p_employee_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    or p_enabled is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_allowance_request';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_pilot from public.referral_allowance_recipients where beneficiary_fc_id = p_beneficiary_fc_id for update;
  if coalesce(v_pilot.revision, 0) <> p_expected_revision then
    raise exception using errcode = '40001', message = 'allowance_revision_conflict';
  end if;
  -- Revocation of the current pair must remain possible after account deactivation.
  if not coalesce((p_enabled = false and v_pilot.manager_account_id is not distinct from p_manager_account_id
    and v_pilot.beneficiary_fc_id = p_beneficiary_fc_id and v_pilot.employee_code = p_employee_code), false)
    and not public.referral_allowance_pair_is_valid(p_manager_account_id, p_beneficiary_fc_id) then
    raise exception using errcode = '22023', message = 'invalid_allowance_pilot_pair';
  end if;
  insert into public.referral_allowance_recipients
    (manager_account_id, beneficiary_fc_id, employee_code, enabled, revision, updated_by)
  values (p_manager_account_id, p_beneficiary_fc_id, p_employee_code, p_enabled, p_expected_revision + 1, p_actor_admin_id)
  on conflict (beneficiary_fc_id) do update set manager_account_id = excluded.manager_account_id,
    beneficiary_fc_id = excluded.beneficiary_fc_id, employee_code = excluded.employee_code,
    enabled = excluded.enabled, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_pilot;
  return jsonb_build_object('ok', true, 'pilot', jsonb_build_object(
    'managerAccountId', v_pilot.manager_account_id, 'beneficiaryFcId', v_pilot.beneficiary_fc_id,
    'employeeCode', v_pilot.employee_code, 'enabled', v_pilot.enabled, 'revision', v_pilot.revision));
end;
$$;

create or replace function public.create_referral_allowance_draft(
  p_actor_admin_id uuid, p_expected_pilot_revision bigint, p_expected_manager_account_id uuid,
  p_expected_beneficiary_fc_id uuid, p_expected_employee_code text, p_performance_month text,
  p_payment_date date, p_genealogy_as_of date, p_source_sha256 text, p_policy_version text, p_snapshot jsonb
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_pilot public.referral_allowance_recipients%rowtype;
  v_import public.referral_allowance_imports%rowtype;
  v_count integer;
  v_revision bigint;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_pilot from public.referral_allowance_recipients where beneficiary_fc_id = p_expected_beneficiary_fc_id for update;
  if v_pilot.beneficiary_fc_id is null or v_pilot.enabled is not true
    or v_pilot.revision is distinct from p_expected_pilot_revision
    or v_pilot.manager_account_id is distinct from p_expected_manager_account_id
    or v_pilot.beneficiary_fc_id is distinct from p_expected_beneficiary_fc_id
    or v_pilot.employee_code is distinct from p_expected_employee_code then
    raise exception using errcode = '40001', message = 'allowance_pilot_changed';
  end if;
  if not public.referral_allowance_pair_is_valid(v_pilot.manager_account_id, v_pilot.beneficiary_fc_id) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  if p_performance_month is null or p_performance_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or p_payment_date is null or p_genealogy_as_of is null
    or p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$'
    or p_policy_version is distinct from 'recruitment-2026-09-07-snapshot-pilot-v1'
    or p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or octet_length(p_snapshot::text) > 8388608 then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if p_genealogy_as_of > p_payment_date
    or to_char(p_payment_date, 'YYYY-MM') is distinct from
      to_char(to_date(p_performance_month || '-01', 'YYYY-MM-DD') + interval '2 months', 'YYYY-MM') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if p_snapshot->'schemaVersion' is distinct from '1'::jsonb
    or p_snapshot->>'policyVersion' is distinct from p_policy_version
    or p_snapshot->>'performanceMonth' is distinct from p_performance_month
    or p_snapshot->>'paymentDate' is distinct from to_char(p_payment_date, 'YYYY-MM-DD')
    or p_snapshot->>'genealogyAsOf' is distinct from to_char(p_genealogy_as_of, 'YYYY-MM-DD')
    or p_snapshot->>'eligibilityBasis' is distinct from 'uploaded_snapshot'
    or jsonb_typeof(p_snapshot->'sourceSnapshotDates') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'usesLaterSnapshot') is distinct from 'boolean'
    or p_snapshot->>'status' is distinct from 'current_month_estimate'
    or p_snapshot->'previousCarryIncluded' is distinct from 'false'::jsonb
    or jsonb_typeof(p_snapshot->'nodes') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'beneficiary') is distinct from 'object'
    or jsonb_typeof(p_snapshot->'summary') is distinct from 'object'
    or p_snapshot#>'{validation,maximumDepth}' is distinct from '10'::jsonb
    or p_snapshot#>'{validation,conservationDifferenceKrw}' is distinct from '0'::jsonb then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  -- Keep the uploaded source dates distinct from the operator's reference date.
  -- Later source snapshots are explicitly allowed for this pilot and disclosed.
  if jsonb_array_length(p_snapshot->'sourceSnapshotDates') not between 1 and 64
    or exists (select 1 from jsonb_array_elements(p_snapshot->'sourceSnapshotDates') d
      where jsonb_typeof(d) is distinct from 'string'
        or (d #>> '{}') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  begin
    if exists (select 1 from jsonb_array_elements_text(p_snapshot->'sourceSnapshotDates') d
      where to_char(to_date(d, 'YYYY-MM-DD'), 'YYYY-MM-DD') is distinct from d) then
      raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
    end if;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end;
  if (select jsonb_agg(d order by d) from
      (select distinct d from jsonb_array_elements_text(p_snapshot->'sourceSnapshotDates') d) dates)
      is distinct from p_snapshot->'sourceSnapshotDates'
    or p_snapshot->'usesLaterSnapshot' is distinct from to_jsonb(exists (
      select 1 from jsonb_array_elements_text(p_snapshot->'sourceSnapshotDates') d
      where d > to_char(p_genealogy_as_of, 'YYYY-MM-DD'))) then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  v_count := jsonb_array_length(p_snapshot->'nodes');
  if v_count < 1 or v_count > 10000
    or p_snapshot#>>'{validation,visiblePeopleCount}' is distinct from v_count::text
    or (select count(*) from jsonb_array_elements(p_snapshot->'nodes') n where n->'isBeneficiary' = 'true'::jsonb) <> 1
    or not exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n
      where n->>'id' = p_snapshot#>>'{beneficiary,nodeId}' and n->'isBeneficiary' = 'true'::jsonb and n->>'depth' = '0') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  -- Only the public beneficiary statement shape may be persisted, never raw workbook columns.
  if exists (select 1 from jsonb_object_keys(p_snapshot) k where k not in
      ('schemaVersion','policyVersion','performanceMonth','paymentDate','genealogyAsOf','sourceSnapshotDates','usesLaterSnapshot','status',
       'previousCarryIncluded','eligibilityBasis','beneficiary','nodes','summary','validation'))
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n where jsonb_typeof(n) <> 'object') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n, jsonb_object_keys(n) k where k not in
      ('id','parentId','depth','name','affiliation','isBeneficiary','activeAtPerformance','eligibleAtBasisDate',
       'finalTargetPerformanceKrw','fpRoundedAmountKrw','contributionKrw'))
    or exists (select 1 from jsonb_object_keys(p_snapshot->'beneficiary') k where k not in ('nodeId','name','eligibleAtBasisDate'))
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n where
      coalesce(n->>'id', '') !~ '^node-[0-9]{1,5}$' or coalesce(n->>'depth', '') !~ '^(10|[0-9])$'
      or jsonb_typeof(n->'name') is distinct from 'string' or jsonb_typeof(n->'affiliation') is distinct from 'string'
      or jsonb_typeof(n->'isBeneficiary') is distinct from 'boolean'
      or jsonb_typeof(n->'activeAtPerformance') is distinct from 'boolean'
      or jsonb_typeof(n->'eligibleAtBasisDate') is distinct from 'boolean')
    or (select count(distinct n->>'id') from jsonb_array_elements(p_snapshot->'nodes') n) <> v_count then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n where
      jsonb_typeof(n->'finalTargetPerformanceKrw') is distinct from 'number'
      or coalesce(n->>'finalTargetPerformanceKrw', '') !~ '^-?[0-9]{1,14}(\.[0-9]{1,2})?$')
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n,
      unnest(array['fpRoundedAmountKrw','contributionKrw']) k
      where jsonb_typeof(n->k) is distinct from 'number' or coalesce(n->>k, '') !~ '^-?[0-9]{1,16}$')
    or exists (select 1 from unnest(array['currentMonthNetKrw','newPaymentKrw','carryForwardKrw','extinguishedKrw','excludedByEligibilityKrw']) k
      where jsonb_typeof(p_snapshot->'summary'->k) is distinct from 'number'
        or coalesce(p_snapshot->'summary'->>k, '') !~ '^-?[0-9]{1,16}$') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n
      where abs((n->>'finalTargetPerformanceKrw')::numeric) * 100 > 9007199254740991)
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n,
      unnest(array['fpRoundedAmountKrw','contributionKrw']) k where abs((n->>k)::numeric) > 9007199254740991)
    or exists (select 1 from unnest(array['currentMonthNetKrw','newPaymentKrw','carryForwardKrw','extinguishedKrw','excludedByEligibilityKrw']) k
      where abs((p_snapshot->'summary'->>k)::numeric) > 9007199254740991)
    or (select sum((n->>'contributionKrw')::numeric) from jsonb_array_elements(p_snapshot->'nodes') n)
      <> (p_snapshot#>>'{summary,currentMonthNetKrw}')::numeric
    or (p_snapshot#>>'{summary,currentMonthNetKrw}')::numeric <>
      (p_snapshot#>>'{summary,newPaymentKrw}')::numeric + (p_snapshot#>>'{summary,carryForwardKrw}')::numeric
      + (p_snapshot#>>'{summary,extinguishedKrw}')::numeric + (p_snapshot#>>'{summary,excludedByEligibilityKrw}')::numeric then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  select * into v_import from public.referral_allowance_imports
    where beneficiary_fc_id = v_pilot.beneficiary_fc_id and performance_month = p_performance_month
      and source_sha256 = p_source_sha256 and policy_version = p_policy_version and pilot_revision = v_pilot.revision;
  if v_import.id is not null then
    if v_import.snapshot is distinct from p_snapshot or v_import.payment_date is distinct from p_payment_date
      or v_import.genealogy_as_of is distinct from p_genealogy_as_of or v_import.employee_code is distinct from v_pilot.employee_code
      or v_import.manager_account_id is distinct from v_pilot.manager_account_id then
      raise exception using errcode = '40001', message = 'allowance_idempotency_conflict';
    end if;
  else
    select coalesce(max(revision), 0) + 1 into v_revision from public.referral_allowance_imports
      where beneficiary_fc_id = v_pilot.beneficiary_fc_id and performance_month = p_performance_month;
    insert into public.referral_allowance_imports
      (manager_account_id, beneficiary_fc_id, employee_code, performance_month, payment_date, genealogy_as_of,
        source_sha256, policy_version, pilot_revision, revision, snapshot, created_by)
    values (v_pilot.manager_account_id, v_pilot.beneficiary_fc_id, v_pilot.employee_code, p_performance_month,
      p_payment_date, p_genealogy_as_of, p_source_sha256, p_policy_version, v_pilot.revision, v_revision, p_snapshot, p_actor_admin_id)
    returning * into v_import;
  end if;
  return jsonb_build_object('ok', true, 'import', jsonb_build_object('id', v_import.id, 'status', v_import.status,
    'revision', v_import.revision, 'sourceSha256', v_import.source_sha256, 'policyVersion', v_import.policy_version,
    'performanceMonth', v_import.performance_month, 'pilotRevision', v_import.pilot_revision));
end;
$$;

create or replace function public.publish_referral_allowance_draft(
  p_actor_admin_id uuid, p_import_id uuid, p_expected_source_sha256 text,
  p_expected_revision bigint, p_expected_pilot_revision bigint
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_pilot public.referral_allowance_recipients%rowtype;
  v_import public.referral_allowance_imports%rowtype;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_import from public.referral_allowance_imports where id = p_import_id for update;
  select * into v_pilot from public.referral_allowance_recipients where beneficiary_fc_id = v_import.beneficiary_fc_id for update;
  if v_pilot.beneficiary_fc_id is null or v_pilot.enabled is not true or v_import.id is null
    or v_pilot.revision is distinct from p_expected_pilot_revision
    or v_import.pilot_revision is distinct from v_pilot.revision
    or v_import.manager_account_id is distinct from v_pilot.manager_account_id
    or v_import.beneficiary_fc_id is distinct from v_pilot.beneficiary_fc_id
    or v_import.employee_code is distinct from v_pilot.employee_code
    or v_import.source_sha256 is distinct from p_expected_source_sha256
    or v_import.revision is distinct from p_expected_revision
    or v_import.status = 'superseded' then
    raise exception using errcode = '40001', message = 'allowance_revision_conflict';
  end if;
  if not public.referral_allowance_pair_is_valid(v_pilot.manager_account_id, v_pilot.beneficiary_fc_id) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  if v_import.status = 'draft' then
    update public.referral_allowance_imports set status = 'superseded', superseded_at = now()
      where beneficiary_fc_id = v_import.beneficiary_fc_id and performance_month = v_import.performance_month and status = 'published';
    update public.referral_allowance_imports set status = 'published', published_by = p_actor_admin_id, published_at = now()
      where id = v_import.id returning * into v_import;
  end if;
  return jsonb_build_object('ok', true, 'import', jsonb_build_object('id', v_import.id, 'status', v_import.status,
    'revision', v_import.revision, 'sourceSha256', v_import.source_sha256, 'policyVersion', v_import.policy_version,
    'performanceMonth', v_import.performance_month, 'pilotRevision', v_import.pilot_revision));
end;
$$;

create or replace function public.read_referral_allowance_pilot(
  p_manager_account_id uuid, p_beneficiary_fc_id uuid, p_action text, p_month text default null
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_pilot public.referral_allowance_recipients%rowtype;
  v_months jsonb;
  v_snapshot jsonb;
begin
  if p_action is null or p_action not in ('access', 'statement')
    or (p_month is not null and p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') then
    raise exception using errcode = '22023', message = 'invalid_allowance_request';
  end if;
  select * into v_pilot from public.referral_allowance_recipients where beneficiary_fc_id = p_beneficiary_fc_id for share;
  if v_pilot.beneficiary_fc_id is null or v_pilot.enabled is not true
    or v_pilot.manager_account_id is distinct from p_manager_account_id
    or v_pilot.beneficiary_fc_id is distinct from p_beneficiary_fc_id
    or not public.referral_allowance_pair_is_valid(p_manager_account_id, p_beneficiary_fc_id) then
    if p_action = 'access' then return jsonb_build_object('ok', true, 'enabled', false); end if;
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  select coalesce(jsonb_agg(performance_month order by performance_month desc), '[]'::jsonb) into v_months from (
    select performance_month from public.referral_allowance_imports
    where manager_account_id is not distinct from v_pilot.manager_account_id and beneficiary_fc_id = v_pilot.beneficiary_fc_id
      and employee_code = v_pilot.employee_code and pilot_revision = v_pilot.revision and status = 'published'
    order by performance_month desc limit 120
  ) months;
  if p_action = 'access' then return jsonb_build_object('ok', true, 'enabled', true, 'availableMonths', v_months); end if;
  select snapshot into v_snapshot from public.referral_allowance_imports
    where manager_account_id is not distinct from v_pilot.manager_account_id and beneficiary_fc_id = v_pilot.beneficiary_fc_id
      and employee_code = v_pilot.employee_code and pilot_revision = v_pilot.revision and status = 'published'
      and performance_month = coalesce(p_month, v_months->>0);
  return jsonb_build_object('ok', true, 'enabled', true, 'availableMonths', v_months, 'statement', v_snapshot);
end;
$$;

revoke all on function public.referral_allowance_pair_is_valid(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guard_referral_allowance_import_immutability() from public, anon, authenticated;
revoke all on function public.configure_referral_allowance_pilot(uuid, uuid, uuid, text, boolean, bigint) from public, anon, authenticated;
revoke all on function public.create_referral_allowance_draft(uuid, bigint, uuid, uuid, text, text, date, date, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.publish_referral_allowance_draft(uuid, uuid, text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.read_referral_allowance_pilot(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.referral_allowance_pair_is_valid(uuid, uuid) to service_role;
grant execute on function public.guard_referral_allowance_import_immutability() to service_role;
grant execute on function public.configure_referral_allowance_pilot(uuid, uuid, uuid, text, boolean, bigint) to service_role;
grant execute on function public.create_referral_allowance_draft(uuid, bigint, uuid, uuid, text, text, date, date, text, text, jsonb) to service_role;
grant execute on function public.publish_referral_allowance_draft(uuid, uuid, text, bigint, bigint) to service_role;
grant execute on function public.read_referral_allowance_pilot(uuid, uuid, text, text) to service_role;



comment on table public.referral_allowance_recipients is 'Server-managed per-person allowance access; no direct client grants. Existing pilot is preserved.';


-- Password reset challenge transaction (20261001071216).
-- Issue, count guesses, consume the challenge and update the password under
-- the same credential-row lock. No caller may read/check/write this state.
alter table public.admin_accounts
  add column if not exists reset_failed_count integer not null default 0
  check (reset_failed_count between 0 and 5);
alter table public.manager_accounts
  add column if not exists reset_failed_count integer not null default 0
  check (reset_failed_count between 0 and 5);
alter table public.fc_credentials
  add column if not exists reset_failed_count integer not null default 0
  check (reset_failed_count between 0 and 5);

create or replace function public.process_password_reset_challenge(
  p_action text,
  p_account_kind text,
  p_account_id uuid,
  p_phone text,
  p_token_hash text,
  p_password_hash text default null,
  p_password_salt text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  account_table text;
  account_key text;
  account_row jsonb;
  profile_row public.fc_profiles%rowtype;
  checked_at timestamptz;
  failed_attempts integer;
begin
  if coalesce(p_action, '') not in ('issue', 'consume')
    or p_account_id is null
    or coalesce(p_phone, '') !~ '^[0-9]{11}$'
    or coalesce(p_token_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
    or (p_action = 'consume' and (
      coalesce(p_password_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
      or coalesce(p_password_salt, '') !~ '^[A-Za-z0-9+/]{22}==$'
    )) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  case p_account_kind
    when 'admin' then account_table := 'admin_accounts'; account_key := 'id';
    when 'manager' then account_table := 'manager_accounts'; account_key := 'id';
    when 'fc' then account_table := 'fc_credentials'; account_key := 'fc_id';
    else return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end case;

  -- Match existing FC lifecycle lock order: profile, then credentials. This
  -- also prevents completion/phone changes while a challenge is processed.
  if p_account_kind = 'fc' then
    select * into profile_row from public.fc_profiles
    where id = p_account_id for update;
    if not found or profile_row.phone is distinct from p_phone
      or profile_row.signup_completed is distinct from true then
      return jsonb_build_object('ok', false, 'code', 'account_unavailable');
    end if;
  end if;

  execute format(
    'select to_jsonb(a) from public.%I a where %I = $1 for update',
    account_table, account_key
  ) into account_row using p_account_id;
  if account_row is null
    or account_row->>'password_set_at' is null
    or (p_account_kind <> 'fc' and (
      account_row->>'phone' is distinct from p_phone
      or account_row->>'active' = 'false'
    )) then
    return jsonb_build_object('ok', false, 'code', 'account_unavailable');
  end if;

  -- Evaluate expiry/cooldown after any lock wait, not at transaction start.
  checked_at := clock_timestamp();
  if p_action = 'issue' then
    if (account_row->>'reset_sent_at')::timestamptz > checked_at - interval '60 seconds' then
      return jsonb_build_object('ok', false, 'code', 'cooldown');
    end if;
    execute format(
      'update public.%I set reset_token_hash = $2,
       reset_token_expires_at = $3::timestamptz + interval ''15 minutes'',
       reset_sent_at = $3, reset_failed_count = 0, updated_at = $3
       where %I = $1', account_table, account_key
    ) using p_account_id, p_token_hash, checked_at;
    return jsonb_build_object('ok', true);
  end if;

  failed_attempts := (account_row->>'reset_failed_count')::integer;
  if failed_attempts >= 5 then
    return jsonb_build_object('ok', false, 'code', 'attempts_exhausted');
  end if;
  if account_row->>'reset_token_hash' is null
    or account_row->>'reset_token_expires_at' is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if (account_row->>'reset_token_expires_at')::timestamptz <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'expired_token');
  end if;
  if account_row->>'reset_token_hash' is distinct from p_token_hash then
    failed_attempts := failed_attempts + 1;
    execute format(
      'update public.%I set reset_failed_count = $2, updated_at = $3 where %I = $1',
      account_table, account_key
    ) using p_account_id, failed_attempts, checked_at;
    -- Return, do not raise: a raised exception would roll back the counter.
    return jsonb_build_object('ok', false, 'code',
      case when failed_attempts >= 5 then 'attempts_exhausted' else 'invalid_token' end);
  end if;

  execute format(
    'update public.%I set password_hash = $2, password_salt = $3,
     password_set_at = $4, failed_count = 0, locked_until = null,
     reset_token_hash = null, reset_token_expires_at = null,
     reset_failed_count = 0, updated_at = $4%s where %I = $1',
    account_table,
    case when p_account_kind = 'fc' then
      ', must_change_password = false, temporary_password_issued_at = null'
      else '' end,
    account_key
  ) using p_account_id, p_password_hash, p_password_salt, checked_at;
  -- Preserve reset_sent_at so success cannot bypass the issuance cooldown.
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.process_password_reset_challenge(text, text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.process_password_reset_challenge(text, text, uuid, text, text, text, text)
  to service_role;

-- Credential session generations (20261004133155 + 20261004143855)
-- Additive zero preserves every unchanged account's legacy signed sessions.
alter table public.fc_credentials
  add column if not exists session_version bigint not null default 0 check (session_version >= 0);
alter table public.admin_accounts
  add column if not exists session_version bigint not null default 0 check (session_version >= 0);
alter table public.manager_accounts
  add column if not exists session_version bigint not null default 0 check (session_version >= 0);

create or replace function public.advance_credential_session_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- All writers, including the existing reset/assisted/config paths, share
  -- this transaction boundary. Failed login counters do not revoke sessions.
  if old.password_hash is distinct from new.password_hash
    or old.password_salt is distinct from new.password_salt then
    new.session_version := old.session_version + 1;
  else
    new.session_version := old.session_version;
  end if;
  return new;
end;
$$;
revoke all on function public.advance_credential_session_version() from public, anon, authenticated;

-- The service verifies the token signature before this narrow identity lookup.
-- Null is an unavailable/inactive/mismatched account, never generation zero.
create or replace function public.get_auth_session_generation(
  p_phone text,
  p_role text,
  p_purpose text,
  p_account_kind text default null,
  p_account_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  phone_candidates text[];
  resolved_kind text;
  resolved_id uuid;
  resolved_version bigint;
  resolved_created_at timestamptz;
begin
  if length(normalized_phone) <> 11 or p_purpose is null or p_role is null
    or p_purpose not in ('app', 'bridge') then return null; end if;
  phone_candidates := array[normalized_phone, btrim(p_phone),
    substr(normalized_phone, 1, 3) || '-' || substr(normalized_phone, 4, 4) || '-' || substr(normalized_phone, 8, 4)];
  if p_purpose = 'app' and p_role not in ('fc', 'admin', 'manager') then return null; end if;
  if p_purpose = 'bridge' and p_role not in ('fc', 'designer', 'admin', 'manager') then return null; end if;
  if p_account_kind is not null and p_account_kind not in ('fc', 'admin', 'manager') then return null; end if;

  if p_role = 'admin' or (p_purpose = 'bridge' and p_role = 'fc') then
    select 'admin', account.id, account.session_version, account.created_at
      into resolved_kind, resolved_id, resolved_version, resolved_created_at
      from public.admin_accounts account
      where account.phone = any(phone_candidates)
        and account.active = true and account.password_set_at is not null
        and (p_role = 'admin' or account.staff_type = 'developer')
        and (p_account_kind is null or p_account_kind = 'admin')
        and (p_account_id is null or account.id = p_account_id);
  end if;
  if resolved_id is null and p_role = 'manager' then
    select 'manager', account.id, account.session_version, account.created_at
      into resolved_kind, resolved_id, resolved_version, resolved_created_at
      from public.manager_accounts account
      where account.phone = any(phone_candidates)
        and account.active = true and account.password_set_at is not null
        and (p_account_kind is null or p_account_kind = 'manager')
        and (p_account_id is null or account.id = p_account_id);
  end if;
  if resolved_id is null and (p_role = 'fc' or (p_purpose = 'bridge' and p_role = 'designer')) then
    select 'fc', profile.id, credential.session_version, profile.created_at
      into resolved_kind, resolved_id, resolved_version, resolved_created_at
      from public.fc_profiles profile
      join public.fc_credentials credential on credential.fc_id = profile.id
      where profile.phone = any(phone_candidates)
        and profile.signup_completed = true and credential.password_set_at is not null
        and coalesce(credential.must_change_password, false) = false
        and (p_account_kind is null or p_account_kind = 'fc')
        and (p_account_id is null or profile.id = p_account_id)
        and (p_purpose = 'app' or (
          (p_role = 'designer') = (position('설계매니저' in coalesce(profile.affiliation, '')) > 0)
        ));
  end if;
  if resolved_id is null then return null; end if;
  return jsonb_build_object('accountKind', resolved_kind, 'accountId', resolved_id,
    'sessionVersion', resolved_version, 'createdAt', resolved_created_at);
end;
$$;
revoke all on function public.get_auth_session_generation(text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_auth_session_generation(text, text, text, text, uuid) to service_role;

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

-- Atomic board comment requests and notification receipts.
-- Independent receipt: deleting a comment/post must not make its request reusable.
create table public.board_comment_requests (
  actor_role text not null check (actor_role in ('admin', 'manager', 'fc')),
  actor_id uuid not null, request_id uuid not null, payload_hash text not null,
  response jsonb, created_at timestamptz not null default now(),
  primary key (actor_role, actor_id, request_id)
);
alter table public.board_comment_requests enable row level security;
revoke all on public.board_comment_requests from public, anon, authenticated;
grant select, insert, update on public.board_comment_requests to service_role;
create policy "board_comment_requests service_role" on public.board_comment_requests
  for all to service_role using (true) with check (true);

create or replace function public.create_board_comment_idempotent(
  p_actor_role text, p_actor_phone text, p_actor_name text,
  p_request_id uuid, p_post_id uuid, p_parent_id uuid, p_content text
) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid;
  v_hash text;
  v_receipt public.board_comment_requests%rowtype;
  v_post public.board_posts%rowtype;
  v_parent public.board_comments%rowtype;
  v_root public.board_comments%rowtype;
  v_thread_id uuid;
  v_comment_id uuid;
  v_recipient record;
  v_recipient_id uuid;
  v_notification_id uuid;
  v_notification_ids jsonb := '[]'::jsonb;
  v_notification_stored boolean := true;
  v_response jsonb;
  v_content text := btrim(p_content);
begin
  if p_request_id is null or p_post_id is null or coalesce(v_content, '') = '' then
    raise exception using errcode = '22023', message = 'invalid_payload';
  end if;
  if p_actor_role = 'admin' then
    select id into v_actor_id from public.admin_accounts where phone = p_actor_phone and active;
  elsif p_actor_role = 'manager' then
    select id into v_actor_id from public.manager_accounts where phone = p_actor_phone and active;
  elsif p_actor_role = 'fc' then
    select id into v_actor_id from public.fc_profiles where phone = p_actor_phone and signup_completed;
  end if;
  if v_actor_id is null then raise exception using errcode = '42501', message = 'actor_not_found'; end if;

  v_hash := encode(sha256(convert_to(jsonb_build_array(p_post_id, p_parent_id, v_content)::text, 'UTF8')), 'hex');
  insert into public.board_comment_requests(actor_role, actor_id, request_id, payload_hash)
    values (p_actor_role, v_actor_id, p_request_id, v_hash)
    on conflict (actor_role, actor_id, request_id) do nothing;
  select * into strict v_receipt from public.board_comment_requests
    where actor_role = p_actor_role and actor_id = v_actor_id and request_id = p_request_id for update;
  if v_receipt.payload_hash <> v_hash then return jsonb_build_object('ok', false, 'code', 'request_id_conflict'); end if;
  if v_receipt.response is not null then return v_receipt.response; end if;

  select * into v_post from public.board_posts where id = p_post_id for key share;
  if not found then raise exception using errcode = '22023', message = 'post_not_found'; end if;
  if p_parent_id is not null then
    select * into v_parent from public.board_comments where id = p_parent_id for key share;
    if not found or v_parent.post_id <> p_post_id then raise exception using errcode = '22023', message = 'invalid_parent'; end if;
    if v_parent.parent_id is not null then
      select * into v_root from public.board_comments where id = v_parent.parent_id for key share;
      if not found or v_root.post_id <> p_post_id or v_root.parent_id is not null then
        raise exception using errcode = '22023', message = 'invalid_parent';
      end if;
      v_thread_id := v_root.id;
    else
      v_thread_id := v_parent.id;
    end if;
  end if;

  insert into public.board_comments(post_id, parent_id, content, author_role, author_resident_id, author_name)
    values (p_post_id, p_parent_id, v_content, p_actor_role, p_actor_phone, coalesce(p_actor_name, ''))
    returning id into v_comment_id;

  for v_recipient in
    select distinct recipients.phone, recipients.role from (
      select v_post.author_resident_id as phone, v_post.author_role as role
      union
      select c.author_resident_id, c.author_role from public.board_comments c
        where p_parent_id is not null and c.post_id = p_post_id
          and (c.id = v_thread_id or c.parent_id = v_thread_id or c.id = p_parent_id or c.parent_id = p_parent_id)
    ) recipients where recipients.phone <> p_actor_phone
  loop
    v_recipient_id := null;
    if v_recipient.role = 'admin' then
      select id into v_recipient_id from public.admin_accounts where phone = v_recipient.phone and active;
    elsif v_recipient.role = 'manager' then
      select id into v_recipient_id from public.manager_accounts where phone = v_recipient.phone and active;
    elsif v_recipient.role = 'fc' then
      select id into v_recipient_id from public.fc_profiles where phone = v_recipient.phone and signup_completed;
    end if;
    if v_recipient_id is null then v_notification_stored := false; continue; end if;
    insert into public.notifications(recipient_role, resident_id, recipient_actor_id, title, body,
      category, target, target_url, delivery_key)
    values (v_recipient.role, v_recipient.phone, v_recipient_id, 'New comment', coalesce(v_post.title, 'New comment'),
      case when p_parent_id is null then 'board_comment' else 'board_reply' end,
      jsonb_build_object('version', 1, 'kind', 'board_post', 'postId', p_post_id),
      '/board?postId=' || p_post_id::text,
      'board-comment:' || v_comment_id::text || ':' || v_recipient.role || ':' || v_recipient_id::text)
    returning id into v_notification_id;
    v_notification_ids := v_notification_ids || jsonb_build_array(v_notification_id);
  end loop;

  v_response := jsonb_build_object('ok', true, 'data', jsonb_build_object('id', v_comment_id),
    'notification', jsonb_build_object('notificationStored', v_notification_stored,
      'pushStatus', 'not_attempted', 'retryable', not v_notification_stored, 'notificationIds', v_notification_ids),
    'notificationWarning', case when v_notification_stored then null else 'notification_delivery_incomplete' end);
  update public.board_comment_requests set response = v_response
    where actor_role = p_actor_role and actor_id = v_actor_id and request_id = p_request_id;
  return v_response;
end;
$$;
revoke all on function public.create_board_comment_idempotent(text,text,text,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.create_board_comment_idempotent(text,text,text,uuid,uuid,uuid,text) to service_role;

-- Migration 20261009065353 applied to the FC operational DB on 2026-10-09; Edge activation is a separate gate.
-- Local preparation only. Apply and verify this migration before deploying its callers.
-- All authority parameters come from an Edge/server verified signed session.
create table if not exists public.fc_document_cleanup_queue (
  storage_path text primary key,
  fc_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.fc_document_cleanup_queue enable row level security;
revoke all on public.fc_document_cleanup_queue from public, anon, authenticated;
grant all on public.fc_document_cleanup_queue to service_role;

create or replace function public.assert_ux_mutation_actor_v1(p_phone text, p_role text, p_fc_id uuid default null)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if current_user <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if p_role = 'admin' and exists(select 1 from public.admin_accounts where regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g') and active=true) then return; end if;
  if p_role = 'fc' and p_fc_id is not null and exists(
    select 1 from public.fc_profiles where id=p_fc_id and regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g') and signup_completed=true
      and coalesce(is_manager_referral_shadow,false)=false
  ) then return; end if;
  raise exception 'actor not authorized' using errcode='42501';
end; $$;
revoke all on function public.assert_ux_mutation_actor_v1(text,text,uuid) from public,anon,authenticated;
grant execute on function public.assert_ux_mutation_actor_v1(text,text,uuid) to service_role;

create or replace function public.update_fc_document_requests_atomic_v1(
  p_actor_phone text,p_actor_role text,p_fc_id uuid,p_types text[],p_deadline date
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_deadline date;
begin
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role);
  if p_types is null or cardinality(p_types)>100 or exists(select 1 from unnest(p_types) t where t is null or btrim(t)='' or length(t)>150)
    then raise exception 'invalid document types' using errcode='22023'; end if;
  select docs_deadline_at into v_deadline from public.fc_profiles where id=p_fc_id for update;
  if not found then raise exception 'profile not found' using errcode='P0002'; end if;
  perform 1 from public.fc_documents where fc_id=p_fc_id for update;
  if cardinality(p_types)=0 then
    insert into public.fc_document_cleanup_queue(storage_path,fc_id)
      select storage_path,p_fc_id from public.fc_documents where fc_id=p_fc_id and coalesce(storage_path,'') not in ('','deleted')
      on conflict(storage_path) do nothing;
    delete from public.fc_documents where fc_id=p_fc_id;
    update public.fc_profiles set status='allowance-consented',docs_deadline_at=null,docs_deadline_last_notified_at=null where id=p_fc_id;
  else
    delete from public.fc_documents where fc_id=p_fc_id and not(doc_type=any(p_types)) and coalesce(storage_path,'') in ('','deleted');
    insert into public.fc_documents(fc_id,doc_type,status,file_name,storage_path)
      select p_fc_id,t,'pending','','' from (select distinct btrim(t) t from unnest(p_types) t) requested
      where not exists(select 1 from public.fc_documents d where d.fc_id=p_fc_id and d.doc_type=requested.t);
    update public.fc_profiles set status='docs-requested',docs_deadline_at=p_deadline,
      docs_deadline_last_notified_at=case when v_deadline is distinct from p_deadline then null else docs_deadline_last_notified_at end
      where id=p_fc_id;
  end if;
  return jsonb_build_object('updated',true,'cleanupPending',exists(select 1 from public.fc_document_cleanup_queue where fc_id=p_fc_id));
end; $$;
revoke all on function public.update_fc_document_requests_atomic_v1(text,text,uuid,text[],date) from public,anon,authenticated;
grant execute on function public.update_fc_document_requests_atomic_v1(text,text,uuid,text[],date) to service_role;

create or replace function public.remove_fc_document_atomic_v1(
  p_actor_phone text,p_actor_role text,p_fc_id uuid,p_doc_type text,p_expected_storage_path text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_path text; v_status text;
begin
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role,p_fc_id);
  perform 1 from public.fc_profiles where id=p_fc_id for update;
  if not found then raise exception 'profile not found' using errcode='P0002'; end if;
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role,p_fc_id);
  select storage_path,status into v_path,v_status from public.fc_documents where fc_id=p_fc_id and doc_type=p_doc_type for update;
  if not found then raise exception 'document not found' using errcode='P0002'; end if;
  if v_status='approved' then raise exception 'approved document protected' using errcode='42501'; end if;
  if coalesce(v_path,'') not in ('','deleted') then
    if p_expected_storage_path is not null and v_path<>p_expected_storage_path then raise exception 'document changed; reload required' using errcode='40001'; end if;
    insert into public.fc_document_cleanup_queue(storage_path,fc_id) values(v_path,p_fc_id) on conflict(storage_path) do nothing;
    insert into public.fc_document_cleanup_queue(storage_path,fc_id)
      select hanwha_commission_pdf_path,p_fc_id from public.fc_profiles where id=p_fc_id and coalesce(hanwha_commission_pdf_path,'') not in ('','deleted')
      on conflict(storage_path) do nothing;
    update public.fc_documents set storage_path='deleted',file_name='deleted.pdf',status='pending',reviewer_note=null where fc_id=p_fc_id and doc_type=p_doc_type;
    update public.fc_profiles set status='docs-pending',
      hanwha_commission_date_sub=null,hanwha_commission_date=null,hanwha_commission_reject_reason=null,
      hanwha_commission_pdf_path=null,hanwha_commission_pdf_name=null,appointment_url=null,appointment_date=null,
      appointment_schedule_life=null,appointment_schedule_nonlife=null,appointment_date_life=null,appointment_date_nonlife=null,
      appointment_date_life_sub=null,appointment_date_nonlife_sub=null,appointment_reject_reason_life=null,
      appointment_reject_reason_nonlife=null,life_commission_completed=false,nonlife_commission_completed=false where id=p_fc_id;
  end if;
  return jsonb_build_object('deleted',true,'cleanupPending',exists(select 1 from public.fc_document_cleanup_queue where fc_id=p_fc_id));
end; $$;
revoke all on function public.remove_fc_document_atomic_v1(text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.remove_fc_document_atomic_v1(text,text,uuid,text,text) to service_role;

create or replace function public.delete_exam_round_atomic_v1(p_actor_phone text,p_actor_role text,p_round_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role);
  -- FOR UPDATE conflicts with FK key-share, so a concurrent application cannot slip past the check.
  perform 1 from public.exam_rounds where id=p_round_id for update;
  if not found then return jsonb_build_object('deleted',true,'alreadyDeleted',true); end if;
  if exists(select 1 from public.exam_registrations where round_id=p_round_id) then
    raise exception 'registration-bearing round protected' using errcode='23503';
  end if;
  delete from public.exam_locations where round_id=p_round_id;
  delete from public.exam_rounds where id=p_round_id;
  return jsonb_build_object('deleted',true,'alreadyDeleted',false);
end; $$;
revoke all on function public.delete_exam_round_atomic_v1(text,text,uuid) from public,anon,authenticated;
grant execute on function public.delete_exam_round_atomic_v1(text,text,uuid) to service_role;

create table if not exists public.ux_creation_receipts (
  actor_role text not null, actor_phone text not null, request_id uuid not null,
  operation text not null, payload jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_role,actor_phone,request_id,operation)
);
alter table public.ux_creation_receipts enable row level security;
revoke all on public.ux_creation_receipts from public,anon,authenticated;
grant all on public.ux_creation_receipts to service_role;

create or replace function public.create_board_post_idempotent_v1(
  p_actor_phone text,p_actor_role text,p_actor_name text,p_request_id uuid,p_category_id uuid,p_title text,p_content text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_payload jsonb; v_receipt record; v_result jsonb;
begin
  if current_user<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if p_actor_role is null or p_actor_role not in ('admin','manager') then raise exception 'actor not authorized' using errcode='42501'; end if;
  if p_actor_role='admin' then perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role);
  elsif p_actor_role<>'manager' or not exists(select 1 from public.manager_accounts where regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_actor_phone,'[^0-9]','','g') and active=true) then
    raise exception 'actor not authorized' using errcode='42501'; end if;
  if p_request_id is null or btrim(coalesce(p_title,''))='' or btrim(coalesce(p_content,''))='' then raise exception 'invalid payload' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('categoryId',p_category_id,'title',p_title,'content',p_content);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_role||':'||p_actor_phone||':'||p_request_id::text||':board',0));
  select payload,result into v_receipt from public.ux_creation_receipts where actor_role=p_actor_role and actor_phone=p_actor_phone and request_id=p_request_id and operation='board';
  if found then
    if v_receipt.payload<>v_payload then raise exception 'request payload changed' using errcode='22023'; end if;
    return v_receipt.result;
  end if;
  if not exists(select 1 from public.board_categories where id=p_category_id and is_active=true) then raise exception 'invalid category' using errcode='22023'; end if;
  insert into public.board_posts(category_id,title,content,author_role,author_resident_id,author_name)
    values(p_category_id,p_title,p_content,p_actor_role,p_actor_phone,p_actor_name) returning jsonb_build_object('id',id,'updated_at',updated_at) into v_result;
  insert into public.ux_creation_receipts values(p_actor_role,p_actor_phone,p_request_id,'board',v_payload,v_result,now());
  return v_result;
end; $$;
revoke all on function public.create_board_post_idempotent_v1(text,text,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_board_post_idempotent_v1(text,text,text,uuid,uuid,text,text) to service_role;

alter table public.notices add column if not exists images jsonb not null default '[]'::jsonb;
alter table public.notices add column if not exists files jsonb not null default '[]'::jsonb;

create or replace function public.create_notice_idempotent_v1(p_actor_phone text,p_actor_role text,p_request_id uuid,p_notice jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_receipt record; v_result jsonb;
begin
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role);
  if p_request_id is null or btrim(coalesce(p_notice->>'title',''))='' or btrim(coalesce(p_notice->>'body',''))='' then raise exception 'invalid payload' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_role||':'||p_actor_phone||':'||p_request_id::text||':notice',0));
  select payload,result into v_receipt from public.ux_creation_receipts where actor_role=p_actor_role and actor_phone=p_actor_phone and request_id=p_request_id and operation='notice';
  if found then
    if v_receipt.payload<>p_notice then raise exception 'request payload changed' using errcode='22023'; end if;
    return v_receipt.result;
  end if;
  insert into public.notices(title,body,category,images,files)
    values(p_notice->>'title',p_notice->>'body',coalesce(nullif(p_notice->>'category',''),'공지사항'),coalesce(p_notice->'images','[]'::jsonb),coalesce(p_notice->'files','[]'::jsonb))
    returning jsonb_build_object('id',id) into v_result;
  insert into public.ux_creation_receipts values(p_actor_role,p_actor_phone,p_request_id,'notice',p_notice,v_result,now());
  return v_result;
end; $$;
revoke all on function public.create_notice_idempotent_v1(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_notice_idempotent_v1(text,text,uuid,jsonb) to service_role;

-- 20261013093016_ux_notice_idempotent_actor.sql
-- Preserve verified authorship when the admin UI uses the existing atomic
-- notice creation RPC. Existing receipts and the result shape remain intact.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.notices add column if not exists created_by text;

create or replace function public.create_notice_idempotent_v1(p_actor_phone text,p_actor_role text,p_request_id uuid,p_notice jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_receipt record; v_result jsonb;
begin
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role);
  if p_request_id is null or btrim(coalesce(p_notice->>'title',''))='' or btrim(coalesce(p_notice->>'body',''))='' then raise exception 'invalid payload' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_role||':'||p_actor_phone||':'||p_request_id::text||':notice',0));
  select payload,result into v_receipt from public.ux_creation_receipts where actor_role=p_actor_role and actor_phone=p_actor_phone and request_id=p_request_id and operation='notice';
  if found then
    if v_receipt.payload<>p_notice then raise exception 'request payload changed' using errcode='22023'; end if;
    return v_receipt.result;
  end if;
  insert into public.notices(title,body,category,images,files,created_by)
    values(p_notice->>'title',p_notice->>'body',coalesce(nullif(p_notice->>'category',''),'공지사항'),coalesce(p_notice->'images','[]'::jsonb),coalesce(p_notice->'files','[]'::jsonb),p_actor_phone)
    returning jsonb_build_object('id',id) into v_result;
  insert into public.ux_creation_receipts values(p_actor_role,p_actor_phone,p_request_id,'notice',p_notice,v_result,now());
  return v_result;
end; $$;
revoke all on function public.create_notice_idempotent_v1(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_notice_idempotent_v1(text,text,uuid,jsonb) to service_role;

-- Unified platform membership and partner settlement (20261011).
-- Custom signed sessions terminate at platform-service. No direct client access.
create table public.platform_members (
  id uuid primary key default gen_random_uuid(),
  phone text unique check (phone ~ '^[0-9]{11}$'),
  name text not null check (length(name) between 1 and 80),
  fc_id uuid unique references public.fc_profiles(id) on delete set null,
  referral_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  referrer_id uuid references public.platform_members(id) on delete restrict,
  active boolean not null default true,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (referrer_id is distinct from id)
);
create index platform_members_referrer on public.platform_members(referrer_id);
create or replace function public.guard_platform_referrer() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.referrer_id is not null and new.referrer_id is distinct from old.referrer_id then
    perform pg_advisory_xact_lock(741011);
    if exists(with recursive ancestors(id,path) as (
      select new.referrer_id,array[new.referrer_id]
      union all select m.referrer_id,a.path||m.referrer_id from platform_members m join ancestors a on m.id=a.id
      where m.referrer_id is not null and not m.referrer_id=any(a.path)
    ) select from ancestors where id=new.id) then raise exception 'referral_cycle'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_platform_referrer() from public,anon,authenticated;
create trigger platform_referrer_cycle before update of referrer_id on public.platform_members
for each row execute function public.guard_platform_referrer();
create table public.platform_member_credentials (
  member_id uuid primary key references public.platform_members(id) on delete cascade,
  password_hash text not null,
  password_salt text not null,
  session_version bigint not null default 0,
  failed_count integer not null default 0,
  locked_until timestamptz
);
create table public.platform_signup_challenges (
  phone text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  attempts integer not null default 0,
  locked_until timestamptz
);
create trigger platform_credential_generation before update on public.platform_member_credentials
for each row execute function public.advance_credential_session_version();
create table public.platform_partners (
  id uuid primary key default gen_random_uuid(),
  service_key text not null check (service_key in ('insurance','care','telecom','rental','car','hospital')),
  name text not null check (length(name) between 1 and 100),
  region text not null check (length(region) between 1 and 50),
  address text not null default '',
  website_url text not null default '',
  phone text not null default '',
  active boolean not null default false,
  consumer_rate numeric(7,6) not null default 0 check (consumer_rate between 0 and 1),
  referrer_rate numeric(7,6) not null default 0 check (referrer_rate between 0 and 1),
  referrer_basis text not null default 'after_consumer' check (referrer_basis in ('commission','after_consumer')),
  ad_period_start date,
  ad_period_end date,
  ad_placement text,
  ad_fee bigint check (ad_fee >= 0),
  updated_at timestamptz not null default now(),
  revision bigint not null default 0 check (revision>=0),
  last_request jsonb,
  check (referrer_basis='after_consumer' or consumer_rate + referrer_rate <= 1),
  check (service_key not in ('hospital','insurance') or (consumer_rate=0 and referrer_rate=0)),
  check (ad_period_end is null or ad_period_start <= ad_period_end),
  check (service_key <> 'hospital' or not active or
    (ad_period_start is not null and ad_period_end is not null and ad_placement is not null and length(trim(ad_placement))>0 and ad_fee is not null))
);
create table public.platform_service_applications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.platform_members(id),
  service_key text not null check (service_key in ('insurance','care','telecom','rental','car')),
  details jsonb not null check (jsonb_typeof(details)='object'),
  referrer_id_snapshot uuid references public.platform_members(id),
  idempotency_key uuid not null,
  status text not null default 'interest' check (status in ('interest','settled','cancelled')),
  created_at timestamptz not null default now(),
  unique(member_id,idempotency_key)
);
create index platform_applications_owner_created on public.platform_service_applications(member_id,created_at desc);
create table public.platform_partner_settlements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.platform_service_applications(id),
  partner_id uuid not null references public.platform_partners(id),
  commission_amount bigint not null check (commission_amount >= 0),
  consumer_rate_snapshot numeric(7,6) not null,
  referrer_rate_snapshot numeric(7,6) not null,
  referrer_basis_snapshot text not null,
  referrer_id_snapshot uuid references public.platform_members(id),
  transaction_reference text not null check (length(transaction_reference) between 1 and 120),
  evidence_reference text not null check (length(evidence_reference) between 1 and 200),
  settled_at timestamptz not null,
  due_at timestamptz not null,
  idempotency_key uuid not null unique,
  recorded_by uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  check (due_at=settled_at+interval '7 days')
);
create table public.platform_member_benefits (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.platform_partner_settlements(id),
  member_id uuid not null references public.platform_members(id),
  service_key text not null,
  kind text not null check (kind in ('consumer','direct_referrer')),
  amount bigint not null check (amount>=0),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  transfer_reference text,
  unique(settlement_id,kind),
  check ((status='pending' and paid_at is null and transfer_reference is null) or
    (status='paid' and paid_at is not null and transfer_reference is not null and length(trim(transfer_reference)) between 1 and 120))
);
create index platform_benefits_owner_due on public.platform_member_benefits(member_id,due_at);

-- Existing FC information is projected only after explicit common-service
-- consent. Reading/logging in never enrolls an insurance account.

create or replace function public.sync_platform_fc_member() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare mapped uuid;
begin
  if new.signup_completed=true and new.phone ~ '^[0-9]{11}$' then
    select id into mapped from platform_members where fc_id=new.id for update;
    if mapped is not null then
      update platform_members set phone=new.phone,name=coalesce(nullif(new.name,''),'회원') where id=mapped;
    else
      -- A consumer may later complete FC enrollment. Reuse that already
      -- consented identity; never manufacture a new common-service member.
      update platform_members set name=coalesce(nullif(new.name,''),'회원'),fc_id=new.id
      where phone=new.phone and active and terms_accepted_at is not null and fc_id is null;
    end if;
    -- Completed FC credentials become the only password authority. Revoking
    -- the consumer credential invalidates earlier member-only tokens.
    delete from platform_member_credentials where member_id=(select id from platform_members where fc_id=new.id);
  end if;
  return new;
end $$;
revoke all on function public.sync_platform_fc_member() from public,anon,authenticated;
create trigger platform_fc_projection after insert or update of phone,name,signup_completed,recommender_fc_id
on public.fc_profiles for each row execute function public.sync_platform_fc_member();

create or replace function public.erase_platform_fc_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from platform_member_credentials where member_id=(select id from platform_members where fc_id=old.id);
  update platform_service_applications set details='{"region":"삭제","requestType":"삭제"}'::jsonb,
    status=case when status='interest' then 'cancelled' else status end
    where member_id=(select id from platform_members where fc_id=old.id);
  update platform_members set phone=null,name='탈퇴 회원',active=false where fc_id=old.id;
  return old;
end $$;
revoke all on function public.erase_platform_fc_identity() from public,anon,authenticated;
create trigger platform_fc_delete_identity before delete on public.fc_profiles
for each row execute function public.erase_platform_fc_identity();

create or replace function public.issue_platform_signup_otp(p_phone text,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_signup_challenges; issued boolean;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$' or p_code_hash is null or length(p_code_hash)<>44 then raise exception 'invalid_input'; end if;
  if exists(select from platform_members where phone=p_phone) or
     exists(select from admin_accounts where phone=p_phone) or
     exists(select from manager_accounts where phone=p_phone) or
     exists(select from fc_profiles where phone=p_phone and signup_completed=true)
  then return jsonb_build_object('ok',false,'code','already_exists'); end if;
  insert into platform_signup_challenges(phone,code_hash,expires_at,sent_at)
  values(p_phone,p_code_hash,now()+interval '5 minutes',now()) on conflict do nothing returning true into issued;
  select * into c from platform_signup_challenges where phone=p_phone for update;
  if c.locked_until>now() then return jsonb_build_object('ok',false,'code','locked'); end if;
  if issued is distinct from true and c.sent_at>now()-interval '60 seconds' then return jsonb_build_object('ok',false,'code','cooldown'); end if;
  update platform_signup_challenges set code_hash=p_code_hash,expires_at=now()+interval '5 minutes',sent_at=now(),attempts=0
  where phone=p_phone;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.register_platform_member(p_phone text,p_code_hash text,p_name text,
  p_password_hash text,p_password_salt text,p_referral_code text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_signup_challenges; m platform_members; inviter uuid;
begin
  select * into c from platform_signup_challenges where phone=p_phone for update;
  if not found or c.expires_at<=now() then return jsonb_build_object('ok',false,'code','expired_code'); end if;
  if c.locked_until>now() then return jsonb_build_object('ok',false,'code','locked'); end if;
  if c.code_hash is distinct from p_code_hash then
    update platform_signup_challenges set attempts=attempts+1,
      locked_until=case when attempts>=4 then now()+interval '10 minutes' else null end where phone=p_phone;
    return jsonb_build_object('ok',false,'code','invalid_code');
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 or p_password_hash is null or p_password_salt is null
    or length(p_password_hash)<>44 or length(p_password_salt)<>24 then raise exception 'invalid_input'; end if;
  if exists(select from fc_profiles where phone=p_phone and signup_completed=true) or
    exists(select from admin_accounts where phone=p_phone) or exists(select from manager_accounts where phone=p_phone)
  then return jsonb_build_object('ok',false,'code','already_exists'); end if;
  if nullif(trim(p_referral_code),'') is not null then
    select id into inviter from platform_members where referral_code=upper(trim(p_referral_code)) and active;
    -- Older FC invitation codes resolve to the very same member projection.
    if inviter is null then
      select m2.id into inviter from referral_codes r join platform_members m2 on m2.fc_id=r.fc_id
      where r.code=upper(trim(p_referral_code)) and r.is_active=true and m2.active;
    end if;
    if inviter is null then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  end if;
  insert into platform_members(phone,name,referrer_id,terms_accepted_at)
  values(p_phone,trim(p_name),inviter,now()) returning * into m;
  insert into platform_member_credentials(member_id,password_hash,password_salt) values(m.id,p_password_hash,p_password_salt);
  delete from platform_signup_challenges where phone=p_phone;
  return jsonb_build_object('ok',true,'memberId',m.id,'displayName',m.name);
end $$;

create or replace function public.platform_login_attempt(p_member_id uuid,p_password_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_member_credentials;
begin
  select * into c from platform_member_credentials where member_id=p_member_id for update;
  if not found or not exists(select from platform_members where id=p_member_id and active) then return jsonb_build_object('ok',false,'code','invalid_password'); end if;
  if c.locked_until>now() then return jsonb_build_object('ok',false,'code','locked'); end if;
  if c.password_hash is distinct from p_password_hash then
    update platform_member_credentials set failed_count=failed_count+1,
      locked_until=case when failed_count>=4 then now()+interval '10 minutes' else null end where member_id=p_member_id;
    return jsonb_build_object('ok',false,'code','invalid_password');
  end if;
  update platform_member_credentials set failed_count=0,locked_until=null where member_id=p_member_id;
  return jsonb_build_object('ok',true,'sessionVersion',c.session_version);
end $$;

create or replace function public.create_platform_application(p_member_id uuid,p_service_key text,p_details jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a platform_service_applications; m platform_members;
begin
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then raise exception 'member_unavailable'; end if;
  if p_service_key is null or p_service_key not in ('insurance','care','telecom','rental','car') or jsonb_typeof(p_details) is distinct from 'object'
    or (p_details-'region'-'requestType')<>'{}'::jsonb
    or jsonb_typeof(p_details->'region') is distinct from 'string' or jsonb_typeof(p_details->'requestType') is distinct from 'string'
    or length(p_details->>'region') not between 1 and 50 or length(p_details->>'requestType') not between 1 and 100
  then raise exception 'invalid_details'; end if;
  insert into platform_service_applications(member_id,service_key,details,referrer_id_snapshot,idempotency_key)
  values(m.id,p_service_key,p_details,m.referrer_id,p_idempotency_key) on conflict(member_id,idempotency_key) do nothing;
  select * into a from platform_service_applications where member_id=m.id and idempotency_key=p_idempotency_key;
  if a.service_key<>p_service_key or a.details<>p_details then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('ok',true,'applicationId',a.id,'status',a.status);
end $$;

create or replace function public.save_platform_partner(p_admin_id uuid,p_partner jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare existing platform_partners; saved platform_partners; partner_id uuid;
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  if p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_partner) is distinct from 'object' then raise exception 'invalid_partner'; end if;
  partner_id:=nullif(p_partner->>'id','')::uuid;
  if partner_id is null then raise exception 'invalid_partner'; end if;
  perform pg_advisory_xact_lock(hashtextextended(partner_id::text,0));
  if partner_id is not null then
    select * into existing from platform_partners where id=partner_id for update;
    if found then
      if existing.last_request=p_partner and existing.revision in (p_expected_revision,p_expected_revision+1) then
        return jsonb_build_object('ok',true,'partnerId',existing.id,'revision',existing.revision);
      end if;
      if existing.revision<>p_expected_revision then raise exception 'revision_conflict'; end if;
    -- Reassigning an advertised partner to a different business category is
    -- an explicit new record; historical settlements keep their partner type.
      if existing.service_key is distinct from p_partner->>'serviceKey' then raise exception 'partner_service_conflict'; end if;
    elsif p_expected_revision<>0 then raise exception 'revision_conflict'; end if;
  end if;
  insert into platform_partners(id,service_key,name,region,address,website_url,phone,active,consumer_rate,referrer_rate,referrer_basis,
    ad_period_start,ad_period_end,ad_placement,ad_fee,revision,last_request)
  values(coalesce(partner_id,gen_random_uuid()),p_partner->>'serviceKey',trim(p_partner->>'name'),trim(p_partner->>'region'),
    coalesce(p_partner->>'address',''),coalesce(p_partner->>'websiteUrl',''),coalesce(p_partner->>'phone',''),
    (p_partner->>'active')::boolean,(p_partner->>'consumerRate')::numeric,(p_partner->>'referrerRate')::numeric,p_partner->>'referrerBasis',
    nullif(p_partner->>'adPeriodStart','')::date,nullif(p_partner->>'adPeriodEnd','')::date,p_partner->>'adPlacement',
    nullif(p_partner->>'adFee','')::bigint,case when existing.id is null then 0 else existing.revision+1 end,p_partner)
  on conflict(id) do update set name=excluded.name,region=excluded.region,address=excluded.address,
    website_url=excluded.website_url,phone=excluded.phone,active=excluded.active,consumer_rate=excluded.consumer_rate,
    referrer_rate=excluded.referrer_rate,referrer_basis=excluded.referrer_basis,ad_period_start=excluded.ad_period_start,
    ad_period_end=excluded.ad_period_end,ad_placement=excluded.ad_placement,ad_fee=excluded.ad_fee,
    revision=excluded.revision,last_request=excluded.last_request,updated_at=now() returning * into saved;
  return jsonb_build_object('ok',true,'partnerId',saved.id,'revision',saved.revision);
end $$;

create or replace function public.settle_platform_application(p_admin_id uuid,p_application_id uuid,p_partner_id uuid,
 p_commission_amount bigint,p_settled_at timestamptz,p_idempotency_key uuid,p_transaction_reference text,p_evidence_reference text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a platform_service_applications; p platform_partners; s platform_partner_settlements; buyer_amount bigint; referrer_amount bigint;
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  select * into a from platform_service_applications where id=p_application_id for update;
  if not found or a.status='cancelled' then raise exception 'application_unavailable'; end if;
  select * into s from platform_partner_settlements where application_id=a.id;
  if found then
    if s.idempotency_key is distinct from p_idempotency_key or s.partner_id is distinct from p_partner_id or s.commission_amount is distinct from p_commission_amount
      or s.settled_at is distinct from p_settled_at or s.transaction_reference is distinct from trim(p_transaction_reference)
      or s.evidence_reference is distinct from trim(p_evidence_reference)
    then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('ok',true,'settlementId',s.id,'dueAt',s.due_at);
  end if;
  select * into p from platform_partners where id=p_partner_id and active for share;
  if not found or p.service_key<>a.service_key or p.service_key in ('hospital','insurance') then raise exception 'partner_unavailable'; end if;
  if p_settled_at is null or p_settled_at>now() or p_commission_amount is null or p_commission_amount<0 then raise exception 'invalid_settlement'; end if;
  buyer_amount:=floor(p_commission_amount*p.consumer_rate);
  referrer_amount:=floor((case when p.referrer_basis='after_consumer' then p_commission_amount-buyer_amount else p_commission_amount end)*p.referrer_rate);
  insert into platform_partner_settlements(application_id,partner_id,commission_amount,consumer_rate_snapshot,referrer_rate_snapshot,referrer_basis_snapshot,
    referrer_id_snapshot,transaction_reference,evidence_reference,settled_at,due_at,idempotency_key,recorded_by)
  values(a.id,p.id,p_commission_amount,p.consumer_rate,p.referrer_rate,p.referrer_basis,a.referrer_id_snapshot,
    trim(p_transaction_reference),trim(p_evidence_reference),p_settled_at,p_settled_at+interval '7 days',p_idempotency_key,p_admin_id)
  returning * into s;
  insert into platform_member_benefits(settlement_id,member_id,service_key,kind,amount,due_at)
  values(s.id,a.member_id,a.service_key,'consumer',buyer_amount,s.due_at);
  if s.referrer_id_snapshot is not null then
    insert into platform_member_benefits(settlement_id,member_id,service_key,kind,amount,due_at)
    values(s.id,s.referrer_id_snapshot,a.service_key,'direct_referrer',referrer_amount,s.due_at);
  end if;
  update platform_service_applications set status='settled' where id=a.id;
  return jsonb_build_object('ok',true,'settlementId',s.id,'dueAt',s.due_at);
end $$;

create or replace function public.cancel_platform_application(p_member_id uuid,p_application_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a platform_service_applications;
begin
  select * into a from platform_service_applications where id=p_application_id and member_id=p_member_id for update;
  if not found then raise exception 'application_unavailable'; end if;
  if a.status='settled' then raise exception 'settled_cancellation_requires_reconciliation'; end if;
  update platform_service_applications set status='cancelled' where id=a.id;
  return jsonb_build_object('ok',true,'applicationId',a.id,'status','cancelled');
end $$;

create or replace function public.mark_platform_benefit_paid(p_admin_id uuid,p_benefit_id uuid,p_paid_at timestamptz,p_transfer_reference text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b platform_member_benefits;
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  if p_paid_at is null or p_paid_at>now() or nullif(trim(p_transfer_reference),'') is null then raise exception 'invalid_transfer'; end if;
  select * into b from platform_member_benefits where id=p_benefit_id for update;
  if not found then raise exception 'benefit_unavailable'; end if;
  if b.status='paid' and (b.paid_at is distinct from p_paid_at or b.transfer_reference is distinct from trim(p_transfer_reference))
  then raise exception 'idempotency_conflict'; end if;
  update platform_member_benefits set status='paid',paid_at=p_paid_at,transfer_reference=trim(p_transfer_reference) where id=b.id;
  return jsonb_build_object('ok',true,'benefitId',b.id,'status','paid');
end $$;

create or replace function public.delete_platform_member(p_member_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members;
begin
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then raise exception 'member_unavailable'; end if;
  if m.fc_id is not null then raise exception 'fc_deletion_requires_existing_workflow'; end if;
  delete from platform_member_credentials where member_id=m.id;
  delete from platform_signup_challenges where phone=m.phone;
  update platform_service_applications set details='{"region":"삭제","requestType":"삭제"}'::jsonb,
    status=case when status='interest' then 'cancelled' else status end where member_id=m.id;
  update platform_members set phone=null,name='탈퇴 회원',active=false where id=m.id;
  return jsonb_build_object('ok',true,'deleted',true);
end $$;

-- No storage is introduced; private additional information and financial rows
-- are accessible only through verified actor paths in the Edge handler.
do $$ declare t text; f record; begin
  foreach t in array array['platform_members','platform_member_credentials','platform_signup_challenges','platform_partners',
    'platform_service_applications','platform_partner_settlements','platform_member_benefits'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('issue_platform_signup_otp','register_platform_member','platform_login_attempt','create_platform_application',
      'settle_platform_application','cancel_platform_application','mark_platform_benefit_paid','save_platform_partner','delete_platform_member') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

-- Regional hospital directory and anonymous advertising measurements.
-- Hospital advertising is a regional directory, never a treatment/referral fee.
-- Existing contracts need explicit material/region confirmation before publication.
alter table public.platform_partners
  add column province_code text,
  add column district text not null default '',
  add column specialties text[] not null default '{}',
  add column description text not null default '',
  add column photo_url text not null default '',
  add column opening_hours text not null default '',
  add column verified_at date,
  add column material_approved boolean not null default false,
  add column review_required boolean,
  add column review_number text,
  add column review_expires_at date;
alter table public.platform_partners add constraint platform_hospital_material_bounds check (
  service_key <> 'hospital' or (
    (province_code is null or province_code in ('11','26','27','28','29','30','31','36','41','43','44','46','47','48','50','51','52'))
    and length(district)<=50 and cardinality(specialties)<=10 and array_to_string(specialties,'') !~ '[[:cntrl:]]'
    and length(array_to_string(specialties,''))<=300 and length(description)<=2000 and length(opening_hours)<=500
    and (photo_url='' or (length(photo_url)<=500 and photo_url ~ '^https://[^[:space:]]+$'))
    and length(coalesce(review_number,''))<=100));
create index platform_hospital_region on public.platform_partners(province_code,district,name)
  where service_key='hospital' and active;

-- Only the trusted Edge actor may write/read these rows. No patient, account,
-- raw IP, phone, or user-agent is stored. Session/source digests expire with data.
create table public.platform_hospital_events (
  event_id uuid primary key,
  partner_id uuid not null references public.platform_partners(id),
  revision bigint not null,
  placement text not null check (placement in ('regional_list','regional_featured')),
  partner_name text not null,
  event_type text not null check (event_type in ('impression','detail','phone','directions')),
  session_digest text not null check (session_digest ~ '^[0-9a-f]{64}$'),
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  event_date date not null,
  created_at timestamptz not null default now(),
  unique(partner_id,revision,placement,event_type,session_digest,event_date)
);
create index platform_hospital_events_report on public.platform_hospital_events(event_date,partner_id,revision);
create index platform_hospital_events_source on public.platform_hospital_events(source_digest,created_at);

create or replace function public.get_platform_hospitals(p_today date,p_filters jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb; page_size integer; page_offset integer;
begin
  page_size:=coalesce((p_filters->>'limit')::integer,20);
  page_offset:=coalesce((p_filters->>'offset')::integer,0);
  if p_today is null or page_size not between 1 and 50 or page_offset not between 0 and 10000 then raise exception 'invalid_input'; end if;
  with eligible as (
    select p.* from platform_partners p where service_key='hospital' and active and material_approved
      and province_code is not null and trim(district)<>'' and trim(address)<>'' and verified_at<=p_today
      and review_required is not null and (not review_required or (trim(coalesce(review_number,''))<>'' and review_expires_at>=p_today))
      and ad_period_start<=p_today and ad_period_end>=p_today and ad_placement in ('regional_list','regional_featured')
      and (coalesce(p_filters->>'provinceCode','')='' or province_code=p_filters->>'provinceCode')
      and (coalesce(p_filters->>'district','')='' or district=p_filters->>'district')
      and (coalesce(p_filters->>'specialty','')='' or p_filters->>'specialty'=any(specialties))
      and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(name||' '||address))>0)
      and (coalesce(p_filters->>'hospitalId','')='' or id::text=p_filters->>'hospitalId')
  ), cards as (
    select id,name,ad_placement, jsonb_build_object('id',id,'name',name,'region',region,'provinceCode',province_code,
      'district',district,'address',address,'phone',phone,'websiteUrl',website_url,'specialties',specialties,
      'description',description,'photoUrl',photo_url,'openingHours',opening_hours,'verifiedAt',verified_at,
      'adPlacement',ad_placement,'revision',revision) card from eligible
  ), listed as (select card from cards order by case when ad_placement='regional_featured' then 0 else 1 end,name,id limit page_size+1 offset page_offset)
  select jsonb_build_object('ok',true,
    'regions',coalesce((select jsonb_agg(jsonb_build_object('provinceCode',province_code,'districts',districts) order by province_code)
      from (select province_code,jsonb_agg(distinct district order by district) districts from eligible group by province_code) r),'[]'::jsonb),
    'specialties',coalesce((select jsonb_agg(s order by s) from (select distinct unnest(specialties) s from eligible) sp),'[]'::jsonb),
    'hospitals',coalesce((select jsonb_agg(card) from (select card from listed limit page_size) p),'[]'::jsonb),
    'featured',coalesce((select jsonb_agg(card) from (select card from cards where ad_placement='regional_featured'
      order by md5(id::text||':'||coalesce(p_filters->>'rotationBucket',floor(extract(epoch from now())/900)::text)),id limit 5) p),'[]'::jsonb),
    'hasMore',(select count(*)>page_size from listed),'nextOffset',case when (select count(*)>page_size from listed) then page_offset+page_size else null end) into result;
  return result;
end $$;

create or replace function public.record_platform_hospital_event(p_partner_id uuid,p_revision bigint,p_placement text,
  p_event_id uuid,p_event_type text,p_session_digest text,p_source_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare p platform_partners; accepted integer; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
  if p_event_id is null or p_event_type not in ('impression','detail','phone','directions')
    or p_session_digest is null or p_session_digest !~ '^[0-9a-f]{64}$' or p_source_digest is null or p_source_digest !~ '^[0-9a-f]{64}$'
    then raise exception 'invalid_input'; end if;
  select * into p from platform_partners where id=p_partner_id and service_key='hospital' and active and material_approved
    and review_required is not null and (not review_required or (trim(coalesce(review_number,''))<>'' and review_expires_at>=today))
    and province_code is not null and trim(district)<>'' and trim(address)<>'' and verified_at<=today
    and revision=p_revision and p_placement in ('regional_list','regional_featured')
    and (p_placement='regional_list' or ad_placement='regional_featured') and ad_placement in ('regional_list','regional_featured')
    and ad_period_start<=today and ad_period_end>=today for share;
  if not found then return jsonb_build_object('ok',true,'accepted',false); end if;
  if (p_event_type='phone' and p.phone='') or (p_event_type='directions' and p.address='') then raise exception 'invalid_input'; end if;
  -- A signed exposure receipt is validated in Edge; database adds atomic retry,
  -- per-session/day dedup and per-source/minute admission. Anonymous clients can
  -- still fabricate interactions; these are not billing/confirmed-patient metrics.
  perform pg_advisory_xact_lock(hashtextextended(p_source_digest,1));
  if (select count(*) from platform_hospital_events where source_digest=p_source_digest and created_at>now()-interval '1 minute')>=60
    then return jsonb_build_object('ok',true,'accepted',false); end if;
  insert into platform_hospital_events(event_id,partner_id,revision,placement,partner_name,event_type,session_digest,source_digest,event_date)
    values(p_event_id,p.id,p.revision,p_placement,p.name,p_event_type,p_session_digest,p_source_digest,today) on conflict do nothing;
  get diagnostics accepted=row_count;
  delete from platform_hospital_events where event_date<today-90;
  return jsonb_build_object('ok',true,'accepted',accepted=1);
end $$;

create or replace function public.get_platform_hospital_report(p_admin_id uuid,p_from date,p_to date,p_partner_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'invalid_input'; end if;
  if (select count(*) from (select distinct partner_id,revision,placement,partner_name,event_date from platform_hospital_events
    where event_date between p_from and p_to and event_date>=(now() at time zone 'Asia/Seoul')::date-90
      and (p_partner_id is null or partner_id=p_partner_id) limit 5001) bounded)>5000
    then raise exception 'report_range_too_large'; end if;
  with grouped as (
    select partner_id,revision,placement,partner_name,event_date,
      count(*) filter(where event_type='impression') impressions,count(*) filter(where event_type='detail') detail_views,
      count(*) filter(where event_type='phone') phone_clicks,count(*) filter(where event_type='directions') directions_clicks
    from platform_hospital_events where event_date between p_from and p_to and (p_partner_id is null or partner_id=p_partner_id)
      and event_date >= (now() at time zone 'Asia/Seoul')::date-90
    group by partner_id,revision,placement,partner_name,event_date
  ) select jsonb_build_object('ok',true,'from',p_from,'to',p_to,'measurement','anonymous_client_events',
    'rows',coalesce(jsonb_agg(jsonb_build_object('partnerId',partner_id,'name',partner_name,'revision',revision,'placement',placement,
      'date',event_date,'impressions',impressions,'detailViews',detail_views,'phoneClicks',phone_clicks,'directionsClicks',directions_clicks)
      order by event_date desc,partner_id,revision),'[]'::jsonb),
    'totals',jsonb_build_object('impressions',coalesce(sum(impressions),0),'detailViews',coalesce(sum(detail_views),0),
      'phoneClicks',coalesce(sum(phone_clicks),0),'directionsClicks',coalesce(sum(directions_clicks),0))) into result from grouped;
  return result;
end $$;

alter table public.platform_hospital_events enable row level security;
revoke all on public.platform_hospital_events from public,anon,authenticated;
grant select,insert,delete on public.platform_hospital_events to service_role;
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('get_platform_hospitals','record_platform_hospital_event','get_platform_hospital_report') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

-- Platform common consent and credential recovery (20261012).
-- Common-member consent and recovery use the existing trusted Edge/session
-- boundary. No anon/authenticated table or RPC access and no new storage.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.platform_members
  add column terms_version text,
  add column staff_account_kind text check (staff_account_kind in ('admin','manager')),
  add column staff_account_id uuid,
  add constraint platform_staff_identity_complete check (
    (staff_account_kind is null)=(staff_account_id is null) and (fc_id is null or staff_account_id is null)),
  add constraint platform_staff_identity_unique unique(staff_account_kind,staff_account_id);
alter table public.platform_signup_challenges
  add column consumed_member_id uuid references public.platform_members(id) on delete cascade;
alter table public.platform_member_credentials
  add column password_set_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column reset_token_hash text,
  add column reset_token_expires_at timestamptz,
  add column reset_sent_at timestamptz,
  add column reset_failed_count integer not null default 0 check (reset_failed_count between 0 and 5);

create or replace function public.enroll_platform_legacy_member(
  p_phone text,p_name text,p_fc_id uuid,p_terms_version text,p_account_kind text default null,p_account_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; inviter uuid;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$' or p_name is null or length(trim(p_name)) not between 1 and 80
    or p_terms_version is distinct from '2026-10-12' then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  if p_fc_id is not null then
    if (p_account_kind is not null and p_account_kind<>'fc') or (p_account_id is not null and p_account_id<>p_fc_id)
      then raise exception 'forbidden'; end if;
    perform from fc_profiles where id=p_fc_id and phone=p_phone and signup_completed for update;
    if not found then raise exception 'forbidden'; end if;
    select r.id into inviter from fc_profiles f join platform_members r on r.fc_id=f.recommender_fc_id
      where f.id=p_fc_id and r.active and r.terms_accepted_at is not null;
  elsif p_account_kind='admin' then
    perform from admin_accounts where id=p_account_id and phone=p_phone and active for update;
    if not found then raise exception 'forbidden'; end if;
  elsif p_account_kind='manager' then
    perform from manager_accounts where id=p_account_id and phone=p_phone and active for update;
    if not found then raise exception 'forbidden'; end if;
  else raise exception 'forbidden'; end if;
  insert into platform_members(phone,name,fc_id,referrer_id,terms_accepted_at,terms_version,staff_account_kind,staff_account_id)
    values(p_phone,trim(p_name),p_fc_id,inviter,clock_timestamp(),p_terms_version,
      case when p_fc_id is null then p_account_kind end,case when p_fc_id is null then p_account_id end)
    on conflict(phone) do nothing;
  select * into m from platform_members where phone=p_phone for update;
  if not m.active then raise exception 'forbidden'; end if;
  -- Explicit consent may follow a verified FC/staff role transition on the
  -- same phone. Keep the shared graph UUID, bind only the locked source above,
  -- and invalidate tokens backed by the previous canonical source.
  update platform_members set terms_accepted_at=case when terms_version=p_terms_version then terms_accepted_at else clock_timestamp() end,
    terms_version=p_terms_version,name=trim(p_name),fc_id=p_fc_id,
    staff_account_kind=case when p_fc_id is null then p_account_kind end,
    staff_account_id=case when p_fc_id is null then p_account_id end where id=m.id;
  delete from platform_member_credentials where member_id=m.id;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.enroll_platform_legacy_member(text,text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.enroll_platform_legacy_member(text,text,uuid,text,text,uuid) to service_role;

create or replace function public.sync_platform_fc_member() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare mapped uuid;
begin
  if new.signup_completed=true and new.phone ~ '^[0-9]{11}$' then
    select id into mapped from platform_members where fc_id=new.id for update;
    if mapped is not null then
      update platform_members set phone=new.phone,name=coalesce(nullif(new.name,''),'회원') where id=mapped;
    else
      update platform_members set name=coalesce(nullif(new.name,''),'회원'),fc_id=new.id
        where phone=new.phone and active and terms_accepted_at is not null and fc_id is null and staff_account_id is null;
    end if;
    delete from platform_member_credentials where member_id=(select id from platform_members where fc_id=new.id);
  end if;
  return new;
end $$;

-- A common-service withdrawal leaves the insurance/staff account intact.
-- Retain only the existing UUID/referral/settlement links; remove identifying
-- details, credentials, consent and every receipt bound to this identity.
create or replace function public.delete_platform_member(p_member_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members;
begin
  select * into m from platform_members where id=p_member_id for update;
  if not found then raise exception 'member_unavailable'; end if;
  delete from platform_member_credentials where member_id=m.id;
  delete from platform_signup_challenges where phone=m.phone or consumed_member_id=m.id;
  update platform_service_applications set details='{"region":"삭제","requestType":"삭제"}'::jsonb,
    status=case when status='interest' then 'cancelled' else status end where member_id=m.id;
  update platform_members set phone=null,name='탈퇴 회원',active=false,fc_id=null,
    staff_account_kind=null,staff_account_id=null,terms_accepted_at=null,terms_version=null where id=m.id;
  return jsonb_build_object('ok',true,'deleted',true);
end $$;

-- Reuse the same erase operation when the underlying insurance or staff
-- account is deleted. Exact source IDs prevent cross-role phone ambiguity.
create or replace function public.erase_platform_fc_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare mapped uuid;
begin
  select id into mapped from platform_members where
    (tg_table_name='fc_profiles' and fc_id=old.id) or
    (staff_account_kind=case tg_table_name when 'admin_accounts' then 'admin' when 'manager_accounts' then 'manager' end
      and staff_account_id=old.id) for update;
  if mapped is not null then perform delete_platform_member(mapped); end if;
  delete from platform_signup_challenges where phone=old.phone;
  return old;
end $$;
create trigger platform_admin_delete_identity before delete on public.admin_accounts
for each row execute function public.erase_platform_fc_identity();
create trigger platform_manager_delete_identity before delete on public.manager_accounts
for each row execute function public.erase_platform_fc_identity();

create or replace function public.sync_platform_staff_member() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update platform_members set phone=new.phone,name=coalesce(nullif(new.name,''),'회원')
    where staff_account_kind=case tg_table_name when 'admin_accounts' then 'admin' else 'manager' end
    and staff_account_id=new.id and active;
  return new;
end $$;
revoke all on function public.sync_platform_staff_member() from public,anon,authenticated;
create trigger platform_admin_projection after update of phone,name on public.admin_accounts
for each row execute function public.sync_platform_staff_member();
create trigger platform_manager_projection after update of phone,name on public.manager_accounts
for each row execute function public.sync_platform_staff_member();

create or replace function public.register_platform_member(p_phone text,p_code_hash text,p_name text,
  p_password_hash text,p_password_salt text,p_referral_code text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_signup_challenges; m platform_members; inviter uuid; checked_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  select * into c from platform_signup_challenges where phone=p_phone for update;
  checked_at:=clock_timestamp();
  if not found or c.expires_at<=checked_at then return jsonb_build_object('ok',false,'code','expired_code'); end if;
  if c.locked_until>checked_at then return jsonb_build_object('ok',false,'code','locked'); end if;
  if c.code_hash is distinct from p_code_hash then
    update platform_signup_challenges set attempts=attempts+1,
      locked_until=case when attempts>=4 then checked_at+interval '10 minutes' else null end where phone=p_phone;
    return jsonb_build_object('ok',false,'code','invalid_code');
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80
    or coalesce(p_password_hash,'') !~ '^[A-Za-z0-9+/]{43}=$'
    or coalesce(p_password_salt,'') !~ '^[A-Za-z0-9+/]{22}==$' then raise exception 'invalid_input'; end if;
  -- An uncertain successful signup may be retried during the original OTP
  -- window only with the same verified phone, code and current password.
  -- The already-consumed challenge never creates another account.
  if c.consumed_member_id is not null then
    select * into m from platform_members where id=c.consumed_member_id and phone=p_phone and active and fc_id is null;
    if m.id is null or not exists(select from platform_member_credentials
      where member_id=m.id and password_hash=p_password_hash and password_salt=p_password_salt)
    then return jsonb_build_object('ok',false,'code','already_exists'); end if;
    return jsonb_build_object('ok',true,'memberId',m.id,'displayName',m.name,
      'sessionVersion',(select session_version from platform_member_credentials where member_id=m.id));
  end if;
  if exists(select from platform_members where phone=p_phone) or exists(select from fc_profiles where phone=p_phone and signup_completed)
    or exists(select from admin_accounts where phone=p_phone) or exists(select from manager_accounts where phone=p_phone)
  then return jsonb_build_object('ok',false,'code','already_exists'); end if;
  if nullif(trim(p_referral_code),'') is not null then
    select id into inviter from platform_members where referral_code=upper(trim(p_referral_code)) and active and terms_accepted_at is not null;
    if inviter is null then
      select m2.id into inviter from referral_codes r join platform_members m2 on m2.fc_id=r.fc_id
      where r.code=upper(trim(p_referral_code)) and r.is_active and m2.active and m2.terms_accepted_at is not null;
    end if;
    if inviter is null then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  end if;
  insert into platform_members(phone,name,referrer_id,terms_accepted_at,terms_version)
    values(p_phone,trim(p_name),inviter,checked_at,'2026-10-12') returning * into m;
  insert into platform_member_credentials(member_id,password_hash,password_salt) values(m.id,p_password_hash,p_password_salt);
  update platform_signup_challenges set consumed_member_id=m.id where phone=p_phone;
  return jsonb_build_object('ok',true,'memberId',m.id,'displayName',m.name,'sessionVersion',0);
end $$;

-- Reuse the existing reset lock, counters, expiry and consumption protocol.
create or replace function public.process_password_reset_challenge(
  p_action text,
  p_account_kind text,
  p_account_id uuid,
  p_phone text,
  p_token_hash text,
  p_password_hash text default null,
  p_password_salt text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  account_table text;
  account_key text;
  account_row jsonb;
  profile_row public.fc_profiles%rowtype;
  member_row public.platform_members%rowtype;
  checked_at timestamptz;
  failed_attempts integer;
begin
  if coalesce(p_action, '') not in ('issue', 'consume')
    or p_account_id is null
    or coalesce(p_phone, '') !~ '^[0-9]{11}$'
    or coalesce(p_token_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
    or (p_action = 'consume' and (
      coalesce(p_password_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
      or coalesce(p_password_salt, '') !~ '^[A-Za-z0-9+/]{22}==$'
    )) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  case p_account_kind
    when 'admin' then account_table := 'admin_accounts'; account_key := 'id';
    when 'manager' then account_table := 'manager_accounts'; account_key := 'id';
    when 'fc' then account_table := 'fc_credentials'; account_key := 'fc_id';
    when 'member' then account_table := 'platform_member_credentials'; account_key := 'member_id';
    else return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end case;

  -- Match existing FC lifecycle lock order: profile, then credentials. This
  -- also prevents completion/phone changes while a challenge is processed.
  if p_account_kind = 'fc' then
    select * into profile_row from public.fc_profiles
    where id = p_account_id for update;
    if not found or profile_row.phone is distinct from p_phone
      or profile_row.signup_completed is distinct from true then
      return jsonb_build_object('ok', false, 'code', 'account_unavailable');
    end if;
  end if;

  if p_account_kind = 'member' then
    select * into member_row from public.platform_members where id=p_account_id for update;
    if not found or member_row.phone is distinct from p_phone or not member_row.active or member_row.fc_id is not null then
      return jsonb_build_object('ok',false,'code','account_unavailable');
    end if;
  end if;

  execute format(
    'select to_jsonb(a) from public.%I a where %I = $1 for update',
    account_table, account_key
  ) into account_row using p_account_id;
  if account_row is null
    or account_row->>'password_set_at' is null
    or (p_account_kind not in ('fc','member') and (
      account_row->>'phone' is distinct from p_phone
      or account_row->>'active' = 'false'
    )) then
    return jsonb_build_object('ok', false, 'code', 'account_unavailable');
  end if;

  -- Evaluate expiry/cooldown after any lock wait, not at transaction start.
  checked_at := clock_timestamp();
  if p_action = 'issue' then
    if (account_row->>'reset_sent_at')::timestamptz > checked_at - interval '60 seconds' then
      return jsonb_build_object('ok', false, 'code', 'cooldown');
    end if;
    execute format(
      'update public.%I set reset_token_hash = $2,
       reset_token_expires_at = $3::timestamptz + interval ''15 minutes'',
       reset_sent_at = $3, reset_failed_count = 0, updated_at = $3
       where %I = $1', account_table, account_key
    ) using p_account_id, p_token_hash, checked_at;
    return jsonb_build_object('ok', true);
  end if;

  failed_attempts := (account_row->>'reset_failed_count')::integer;
  if failed_attempts >= 5 then
    return jsonb_build_object('ok', false, 'code', 'attempts_exhausted');
  end if;
  if account_row->>'reset_token_hash' is null
    or account_row->>'reset_token_expires_at' is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if (account_row->>'reset_token_expires_at')::timestamptz <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'expired_token');
  end if;
  if account_row->>'reset_token_hash' is distinct from p_token_hash then
    failed_attempts := failed_attempts + 1;
    execute format(
      'update public.%I set reset_failed_count = $2, updated_at = $3 where %I = $1',
      account_table, account_key
    ) using p_account_id, failed_attempts, checked_at;
    -- Return, do not raise: a raised exception would roll back the counter.
    return jsonb_build_object('ok', false, 'code',
      case when failed_attempts >= 5 then 'attempts_exhausted' else 'invalid_token' end);
  end if;

  execute format(
    'update public.%I set password_hash = $2, password_salt = $3,
     password_set_at = $4, failed_count = 0, locked_until = null,
     reset_token_hash = null, reset_token_expires_at = null,
     reset_failed_count = 0, updated_at = $4%s where %I = $1',
    account_table,
    case when p_account_kind = 'fc' then
      ', must_change_password = false, temporary_password_issued_at = null'
      else '' end,
    account_key
  ) using p_account_id, p_password_hash, p_password_salt, checked_at;
  -- Preserve reset_sent_at so success cannot bypass the issuance cooldown.
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.process_password_reset_challenge(text, text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.process_password_reset_challenge(text, text, uuid, text, text, text, text)
  to service_role;

-- Delete signup phone/digest receipts once their 5-minute window ends. A
-- failed-guess lock survives until its own 10-minute expiry. Clear consumer
-- reset digests after the 15-minute window and completed cooldown state after
-- 60 seconds. The scheduled task adds at most five minutes of cleanup lag.
create or replace function public.cleanup_platform_auth_challenges()
returns void language sql security invoker set search_path=public,pg_temp as $$
  delete from platform_signup_challenges where expires_at<=now()
    and coalesce(locked_until,expires_at)<=now();
  update platform_member_credentials c set reset_token_hash=null,reset_token_expires_at=null,
    reset_sent_at=null,reset_failed_count=0
    from platform_members m where m.id=c.member_id and m.fc_id is null
    and (c.reset_token_expires_at<=now() or (c.reset_token_hash is null and c.reset_sent_at<=now()-interval '60 seconds'));
$$;
revoke all on function public.cleanup_platform_auth_challenges() from public,anon,authenticated;
grant execute on function public.cleanup_platform_auth_challenges() to service_role;




-- Hosted platform auth expiry schedule.
-- Hosted rollout requires this schedule. Fail the migration if the extension
-- cannot be enabled; never launch signup with silently skipped expiry cleanup.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('platform-auth-challenge-cleanup','*/5 * * * *',
  'select public.cleanup_platform_auth_challenges();');

-- 20261013094533_moduon_signup_sms_delivery_state.sql
-- Track provider acceptance without retaining phone numbers or message bodies.
-- The transient challenge owns the only link between a phone and an attempt.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.platform_sms_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('signup')),
  provider text not null default 'ncp_sens' check (provider = 'ncp_sens'),
  state text not null default 'pending'
    check (state in ('pending','accepted','unknown','rejected','delivered','undeliverable')),
  provider_request_id text,
  provider_status_code text,
  failure_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (provider_request_id is null or (
    length(provider_request_id) between 1 and 200
    and provider_request_id ~ '^[A-Za-z0-9._:-]+$'
  )),
  check (provider_status_code is null or (
    length(provider_status_code) between 1 and 40
    and provider_status_code ~ '^[A-Za-z0-9._:-]+$'
  )),
  check (failure_reason is null or failure_reason in (
    'missing_configuration','request_build_failed','provider_rejected','invalid_provider_response','network_error','timeout'
  )),
  check (
    (state='pending' and provider_request_id is null and provider_status_code is null
      and failure_reason is null and completed_at is null)
    or (state='accepted' and failure_reason is null and completed_at is not null and (
      (provider_status_code='202' and provider_request_id is not null)
      or (provider_status_code='simulated' and provider_request_id is null)
    ))
    or (state='rejected' and failure_reason in (
      'missing_configuration','request_build_failed','provider_rejected'
    ) and provider_request_id is null and completed_at is not null)
    or (state='unknown' and failure_reason in (
      'invalid_provider_response','network_error','timeout'
    ) and completed_at is null)
    or (state in ('delivered','undeliverable') and provider_request_id is not null and completed_at is not null)
  )
);
create unique index platform_sms_delivery_provider_request_unique
  on public.platform_sms_delivery_attempts(provider_request_id)
  where provider_request_id is not null;

alter table public.platform_signup_challenges
  add column delivery_id uuid references public.platform_sms_delivery_attempts(id) on delete set null;

create index platform_signup_challenges_delivery_idx
  on public.platform_signup_challenges(delivery_id)
  where delivery_id is not null;

create or replace function public.issue_platform_signup_otp(p_phone text,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  c platform_signup_challenges;
  checked_at timestamptz;
  issued_delivery_id uuid;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$'
    or coalesce(p_code_hash,'') !~ '^[A-Za-z0-9+/]{43}=$'
  then raise exception 'invalid_input'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  checked_at:=clock_timestamp();

  if exists(select from platform_members where phone=p_phone) or
     exists(select from admin_accounts where phone=p_phone) or
     exists(select from manager_accounts where phone=p_phone) or
     exists(select from fc_profiles where phone=p_phone and signup_completed=true)
  then return jsonb_build_object('ok',false,'code','already_exists'); end if;

  select * into c from platform_signup_challenges where phone=p_phone for update;
  if found and c.locked_until>checked_at then
    return jsonb_build_object('ok',false,'code','locked');
  end if;
  if found and c.sent_at>checked_at-interval '60 seconds' then
    return jsonb_build_object('ok',false,'code','cooldown');
  end if;

  insert into platform_sms_delivery_attempts(purpose)
    values('signup') returning id into issued_delivery_id;
  insert into platform_signup_challenges(
    phone,code_hash,expires_at,sent_at,attempts,locked_until,consumed_member_id,delivery_id
  ) values(
    p_phone,p_code_hash,checked_at+interval '5 minutes',checked_at,0,null,null,issued_delivery_id
  ) on conflict(phone) do update set
    code_hash=excluded.code_hash,
    expires_at=excluded.expires_at,
    sent_at=excluded.sent_at,
    attempts=0,
    locked_until=null,
    consumed_member_id=null,
    delivery_id=excluded.delivery_id;

  return jsonb_build_object('ok',true,'deliveryId',issued_delivery_id);
end $$;

create or replace function public.finalize_platform_signup_otp_delivery(
  p_phone text,
  p_delivery_id uuid,
  p_state text,
  p_provider_request_id text default null,
  p_provider_status_code text default null,
  p_failure_reason text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  c platform_signup_challenges;
  updated_attempt uuid;
  checked_at timestamptz;
begin
  if coalesce(p_phone,'') !~ '^[0-9]{11}$' or p_delivery_id is null
    or p_state not in ('accepted','unknown','rejected')
    or (p_provider_request_id is not null and (
      length(p_provider_request_id) not between 1 and 200
      or p_provider_request_id !~ '^[A-Za-z0-9._:-]+$'
    ))
    or (p_provider_status_code is not null and (
      length(p_provider_status_code) not between 1 and 40
      or p_provider_status_code !~ '^[A-Za-z0-9._:-]+$'
    ))
    or (p_failure_reason is not null and p_failure_reason not in (
      'missing_configuration','request_build_failed','provider_rejected','invalid_provider_response','network_error','timeout'
    ))
    or (p_state='accepted' and (
      p_failure_reason is not null or not (
        (p_provider_status_code='202' and p_provider_request_id is not null)
        or (p_provider_status_code='simulated' and p_provider_request_id is null)
      )
    ))
    or (p_state='rejected' and (
      coalesce(p_failure_reason,'') not in ('missing_configuration','request_build_failed','provider_rejected')
      or p_provider_request_id is not null
    ))
    or (p_state='unknown' and coalesce(p_failure_reason,'') not in (
      'invalid_provider_response','network_error','timeout'
    ))
  then raise exception 'invalid_input'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  checked_at:=clock_timestamp();

  select * into c from platform_signup_challenges where phone=p_phone for update;
  if found and c.delivery_id is not distinct from p_delivery_id
    and c.consumed_member_id is not null
  then
    return jsonb_build_object('ok',false,'code','already_consumed');
  end if;

  update platform_sms_delivery_attempts set
    state=p_state,
    provider_request_id=p_provider_request_id,
    provider_status_code=p_provider_status_code,
    failure_reason=p_failure_reason,
    updated_at=checked_at,
    completed_at=case when p_state in ('accepted','rejected') then checked_at else null end
  where id=p_delivery_id and purpose='signup' and state='pending'
  returning id into updated_attempt;

  if updated_attempt is null then
    return jsonb_build_object('ok',false,'code','delivery_already_finalized');
  end if;

  if not found or c.delivery_id is distinct from p_delivery_id then
    return jsonb_build_object('ok',false,'code','stale_delivery');
  end if;

  if p_state='rejected' then
    delete from platform_signup_challenges
      where phone=p_phone and delivery_id=p_delivery_id;
  end if;
  return jsonb_build_object('ok',true,'current',true);
end $$;

alter table public.platform_sms_delivery_attempts enable row level security;
create or replace function public.cancel_password_reset_challenge(
  p_account_kind text,
  p_account_id uuid,
  p_phone text,
  p_token_hash text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  account_table text;
  account_key text;
  account_row jsonb;
  profile_row public.fc_profiles%rowtype;
  member_row public.platform_members%rowtype;
  cancelled_id uuid;
  checked_at timestamptz;
begin
  if p_account_id is null or coalesce(p_phone,'') !~ '^[0-9]{11}$'
    or coalesce(p_token_hash,'') !~ '^[A-Za-z0-9+/]{43}=$'
  then return jsonb_build_object('ok',false,'code','invalid_request'); end if;

  case p_account_kind
    when 'admin' then account_table:='admin_accounts'; account_key:='id';
    when 'manager' then account_table:='manager_accounts'; account_key:='id';
    when 'fc' then account_table:='fc_credentials'; account_key:='fc_id';
    when 'member' then account_table:='platform_member_credentials'; account_key:='member_id';
    else return jsonb_build_object('ok',false,'code','invalid_request');
  end case;

  if p_account_kind='fc' then
    select * into profile_row from public.fc_profiles where id=p_account_id for update;
    if not found or profile_row.phone is distinct from p_phone
      or profile_row.signup_completed is distinct from true
    then return jsonb_build_object('ok',false,'code','account_unavailable'); end if;
  elsif p_account_kind='member' then
    select * into member_row from public.platform_members where id=p_account_id for update;
    if not found or member_row.phone is distinct from p_phone or not member_row.active or member_row.fc_id is not null
    then return jsonb_build_object('ok',false,'code','account_unavailable'); end if;
  end if;

  execute format(
    'select to_jsonb(a) from public.%I a where %I=$1 for update',
    account_table,account_key
  ) into account_row using p_account_id;
  if account_row is null
    or (p_account_kind not in ('fc','member') and (
      account_row->>'phone' is distinct from p_phone or account_row->>'active'='false'
    ))
  then return jsonb_build_object('ok',false,'code','account_unavailable'); end if;

  checked_at:=clock_timestamp();
  execute format(
    'update public.%I set reset_token_hash=null,reset_token_expires_at=null,
       reset_sent_at=null,reset_failed_count=0,updated_at=$3
     where %I=$1 and reset_token_hash=$2 returning %I',
    account_table,account_key,account_key
  ) into cancelled_id using p_account_id,p_token_hash,checked_at;

  if cancelled_id is null then
    return jsonb_build_object('ok',false,'code','stale_challenge');
  end if;
  return jsonb_build_object('ok',true,'cancelled',true);
end $$;


revoke all on public.platform_sms_delivery_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.platform_sms_delivery_attempts to service_role;
revoke all on function public.issue_platform_signup_otp(text,text) from public,anon,authenticated;
grant execute on function public.issue_platform_signup_otp(text,text) to service_role;
revoke all on function public.finalize_platform_signup_otp_delivery(text,uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.finalize_platform_signup_otp_delivery(text,uuid,text,text,text,text)
  to service_role;
revoke all on function public.cancel_password_reset_challenge(text,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.cancel_password_reset_challenge(text,uuid,text,text)
  to service_role;


create or replace function public.cleanup_platform_auth_challenges()
returns void language sql security invoker set search_path=public,pg_temp as $$
  delete from platform_signup_challenges where expires_at<=now()
    and coalesce(locked_until,expires_at)<=now();
  update platform_member_credentials c set reset_token_hash=null,reset_token_expires_at=null,
    reset_sent_at=null,reset_failed_count=0
    from platform_members m where m.id=c.member_id and m.fc_id is null
    and (c.reset_token_expires_at<=now() or (c.reset_token_hash is null and c.reset_sent_at<=now()-interval '60 seconds'));
  delete from platform_sms_delivery_attempts where created_at<now()-interval '31 days';
$$;
revoke all on function public.cleanup_platform_auth_challenges() from public,anon,authenticated;
grant execute on function public.cleanup_platform_auth_challenges() to service_role;

-- Migration: FC signup completion capability v1 (20261013094535).
-- Bind legacy FC signup completion to a short-lived OTP capability and commit
-- profile, referral and credential state in one database transaction.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.fc_signup_completion_challenges (
  fc_id uuid primary key references public.fc_profiles (id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  request_fingerprint text check (
    request_fingerprint is null or request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at),
  check (
    (consumed_at is null and request_fingerprint is null and result is null)
    or (consumed_at is not null and request_fingerprint is not null and result is not null)
  )
);

create index fc_signup_completion_challenges_expires_idx
  on public.fc_signup_completion_challenges (expires_at)
  where consumed_at is null;

alter table public.fc_signup_completion_challenges enable row level security;
revoke all privileges on table public.fc_signup_completion_challenges
  from public, anon, authenticated;
grant select, insert, update, delete on table public.fc_signup_completion_challenges
  to service_role;

create or replace function public.invalidate_fc_signup_completion_challenge_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.phone_verification_hash is not null
    and old.phone_verification_hash is distinct from new.phone_verification_hash then
    delete from public.fc_signup_completion_challenges challenge
    where challenge.fc_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.invalidate_fc_signup_completion_challenge_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists invalidate_fc_signup_completion_challenge_v1 on public.fc_profiles;
create trigger invalidate_fc_signup_completion_challenge_v1
after update of phone_verification_hash on public.fc_profiles
for each row execute function public.invalidate_fc_signup_completion_challenge_v1();

create or replace function public.verify_fc_signup_otp_v1(
  p_phone text,
  p_code_hash text,
  p_completion_token_hash text,
  p_test_bypass boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  profile_row public.fc_profiles%rowtype;
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  checked_at timestamptz;
  next_attempts integer;
  proof_expires_at timestamptz;
begin
  if normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_completion_token_hash, '') !~ '^[a-f0-9]{64}$'
    or (
      coalesce(p_test_bypass, false) is false
      and (p_code_hash is null or char_length(p_code_hash) not between 1 and 128)
    ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));

  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if profile_row.signup_completed is true
    or profile_row.is_manager_referral_shadow is true then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  checked_at := clock_timestamp();

  -- A test bypass changes only the comparison step. It never creates an OTP
  -- challenge and cannot skip expiry or lock enforcement.
  if profile_row.phone_verification_hash is null
    or profile_row.phone_verification_expires_at is null then
    return jsonb_build_object('ok', false, 'code', 'no_code');
  end if;

  if profile_row.phone_verification_expires_at <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'expired_code');
  end if;

  if profile_row.phone_verification_locked_until is not null
    and profile_row.phone_verification_locked_until > checked_at then
    return jsonb_build_object('ok', false, 'code', 'locked');
  end if;

  if coalesce(p_test_bypass, false) is false
    and profile_row.phone_verification_hash is distinct from p_code_hash then
    next_attempts := least(coalesce(profile_row.phone_verification_attempts, 0) + 1, 5);

    update public.fc_profiles
    set phone_verification_attempts = next_attempts,
        phone_verification_locked_until = case
          when next_attempts >= 5 then checked_at + interval '10 minutes'
          else phone_verification_locked_until
        end,
        updated_at = checked_at
    where id = profile_row.id;

    return jsonb_build_object(
      'ok', false,
      'code', case when next_attempts >= 5 then 'locked' else 'invalid_code' end
    );
  end if;

  proof_expires_at := checked_at + interval '15 minutes';

  update public.fc_profiles
  set phone_verified = true,
      phone_verified_at = checked_at,
      signup_verification_method = 'phone_otp',
      signup_verified_at = checked_at,
      signup_verified_by_admin_id = null,
      phone_verification_hash = null,
      phone_verification_expires_at = null,
      phone_verification_sent_at = null,
      phone_verification_attempts = 0,
      phone_verification_locked_until = null,
      updated_at = checked_at
  where id = profile_row.id;

  insert into public.fc_signup_completion_challenges (
    fc_id,
    token_hash,
    expires_at,
    consumed_at,
    request_fingerprint,
    result,
    created_at,
    updated_at
  ) values (
    profile_row.id,
    p_completion_token_hash,
    proof_expires_at,
    null,
    null,
    null,
    checked_at,
    checked_at
  )
  on conflict (fc_id) do update
  set token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      consumed_at = null,
      request_fingerprint = null,
      result = null,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'fcId', profile_row.id,
    'expiresAt', proof_expires_at
  );
end;
$$;

create or replace function public.complete_fc_otp_signup_v1(
  p_phone text,
  p_completion_token_hash text,
  p_request_fingerprint text,
  p_name text,
  p_affiliation text,
  p_email text,
  p_carrier text,
  p_license_statuses text[],
  p_referral_code text,
  p_referral_inviter_fc_id uuid,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  profile_row public.fc_profiles%rowtype;
  credential_row public.fc_credentials%rowtype;
  proof_row public.fc_signup_completion_challenges%rowtype;
  inviter_row public.fc_profiles%rowtype;
  referral_code_row public.referral_codes%rowtype;
  referral_result jsonb;
  stored_result jsonb;
  credential_session_version bigint;
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_affiliation text := trim(coalesce(p_affiliation, ''));
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_carrier text := trim(coalesce(p_carrier, ''));
  normalized_referral_code text := upper(trim(coalesce(p_referral_code, '')));
  normalized_license_statuses text[];
  checked_at timestamptz;
  next_status text;
  next_life_completed boolean;
  next_nonlife_completed boolean;
begin
  select coalesce(array_agg(distinct status_value order by status_value), array[]::text[])
    into normalized_license_statuses
  from unnest(coalesce(p_license_statuses, array[]::text[])) status_value;

  if normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_completion_token_hash, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
    or char_length(normalized_name) not between 2 and 40
    or char_length(normalized_affiliation) not between 2 and 80
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or normalized_carrier not in (
      'SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰'
    )
    or cardinality(normalized_license_statuses) = 0
    or exists (
      select 1
      from unnest(normalized_license_statuses) status_value
      where status_value is null
        or status_value not in ('third', 'life', 'nonlife', 'none')
    )
    or (
      'none' = any(normalized_license_statuses)
      and cardinality(normalized_license_statuses) > 1
    )
    or normalized_referral_code = ''
    or char_length(normalized_referral_code) > 64
    or p_referral_inviter_fc_id is null
    or coalesce(p_password_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
    or coalesce(p_password_salt, '') !~ '^[A-Za-z0-9+/]{22}==$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));

  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select challenge.*
    into proof_row
  from public.fc_signup_completion_challenges challenge
  where challenge.fc_id = profile_row.id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'proof_required');
  end if;

  checked_at := clock_timestamp();

  if proof_row.token_hash is distinct from p_completion_token_hash then
    return jsonb_build_object('ok', false, 'code', 'proof_invalid');
  end if;

  if proof_row.expires_at <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'proof_expired');
  end if;

  if proof_row.consumed_at is not null then
    if proof_row.request_fingerprint is not distinct from p_request_fingerprint
      and proof_row.result is not null then
      return jsonb_set(proof_row.result, '{alreadyApplied}', 'true'::jsonb, true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'request_conflict');
  end if;

  -- phone_verified without the matching, live proof above is never authority.
  if profile_row.phone_verified is distinct from true
    or profile_row.signup_verification_method is distinct from 'phone_otp'
    or profile_row.phone_verified_at is null
    or profile_row.signup_verified_at is null then
    return jsonb_build_object('ok', false, 'code', 'proof_required');
  end if;

  if profile_row.signup_completed is true
    or profile_row.is_manager_referral_shadow is true then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.admin_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.manager_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  select credential.*
    into credential_row
  from public.fc_credentials credential
  where credential.fc_id = profile_row.id
  for update;

  if found and credential_row.password_set_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  if p_referral_inviter_fc_id = profile_row.id then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  select inviter.*
    into inviter_row
  from public.fc_profiles inviter
  where inviter.id = p_referral_inviter_fc_id
  for update;

  if not found
    or (
      inviter_row.signup_completed is distinct from true
      and inviter_row.is_manager_referral_shadow is distinct from true
    ) then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  select referral_code.*
    into referral_code_row
  from public.referral_codes referral_code
  where referral_code.code = normalized_referral_code
    and referral_code.fc_id = p_referral_inviter_fc_id
    and referral_code.is_active is true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  -- Keep the current onboarding gate: license selections do not bypass the
  -- workflow. The database, rather than the client, derives all three fields.
  next_status := 'draft';
  next_life_completed := false;
  next_nonlife_completed := false;

  -- apply_referral_link_state is authoritative for inviter eligibility and
  -- graph invariants. Its writes run in a subtransaction so a failure cannot
  -- leave a partial referral mutation or consume the completion proof.
  begin
    referral_result := public.apply_referral_link_state(
      p_invitee_fc_id => profile_row.id,
      p_inviter_fc_id => p_referral_inviter_fc_id,
      p_referral_code_id => referral_code_row.id,
      p_referral_code => referral_code_row.code,
      p_source => 'signup',
      p_actor_phone => normalized_phone,
      p_actor_role => 'system',
      p_actor_staff_type => null,
      p_reason => 'complete_fc_otp_signup_v1'
    );

    if coalesce((referral_result ->> 'ok')::boolean, false) is not true then
      raise exception 'fc_signup_referral_failed';
    end if;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end;

  update public.fc_profiles
  set name = normalized_name,
      affiliation = normalized_affiliation,
      email = normalized_email,
      carrier = normalized_carrier,
      license_statuses = normalized_license_statuses,
      status = next_status,
      life_commission_completed = next_life_completed,
      nonlife_commission_completed = next_nonlife_completed,
      address = '',
      address_detail = null,
      resident_id_masked = null,
      resident_id_hash = null,
      identity_completed = false,
      temp_id = null,
      allowance_date = null,
      allowance_prescreen_requested_at = null,
      allowance_reject_reason = null,
      docs_deadline_at = null,
      docs_deadline_last_notified_at = null,
      appointment_url = null,
      appointment_date = null,
      appointment_schedule_life = null,
      appointment_schedule_nonlife = null,
      appointment_date_life = null,
      appointment_date_nonlife = null,
      appointment_date_life_sub = null,
      appointment_date_nonlife_sub = null,
      appointment_reject_reason_life = null,
      appointment_reject_reason_nonlife = null,
      hanwha_commission_date_sub = null,
      hanwha_commission_date = null,
      hanwha_commission_reject_reason = null,
      hanwha_commission_pdf_path = null,
      hanwha_commission_pdf_name = null,
      dawichok_url_sent_at = null,
      dawichok_url_sent_by = null,
      signup_completed = true,
      signup_verification_method = 'phone_otp',
      signup_verified_by_admin_id = null,
      updated_at = checked_at
  where id = profile_row.id;

  insert into public.fc_credentials (
    fc_id,
    password_hash,
    password_salt,
    password_set_at,
    failed_count,
    locked_until,
    reset_token_hash,
    reset_token_expires_at,
    reset_sent_at,
    reset_failed_count,
    must_change_password,
    temporary_password_issued_at,
    created_at,
    updated_at
  ) values (
    profile_row.id,
    p_password_hash,
    p_password_salt,
    checked_at,
    0,
    null,
    null,
    null,
    null,
    0,
    false,
    null,
    checked_at,
    checked_at
  )
  on conflict (fc_id) do update
  set password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_set_at = excluded.password_set_at,
      failed_count = 0,
      locked_until = null,
      reset_token_hash = null,
      reset_token_expires_at = null,
      reset_sent_at = null,
      reset_failed_count = 0,
      must_change_password = false,
      temporary_password_issued_at = null,
      updated_at = excluded.updated_at
  returning session_version into credential_session_version;

  stored_result := jsonb_build_object(
    'ok', true,
    'fcId', profile_row.id,
    'residentId', normalized_phone,
    'displayName', normalized_name,
    'affiliation', normalized_affiliation,
    'sessionVersion', credential_session_version,
    'alreadyApplied', false
  );

  update public.fc_signup_completion_challenges
  set consumed_at = checked_at,
      request_fingerprint = p_request_fingerprint,
      result = stored_result,
      updated_at = checked_at
  where fc_id = profile_row.id
    and token_hash = p_completion_token_hash
    and consumed_at is null;

  if not found then
    raise exception 'fc_signup_completion_proof_lost';
  end if;

  return stored_result;
end;
$$;

revoke all on function public.verify_fc_signup_otp_v1(text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.verify_fc_signup_otp_v1(text, text, text, boolean)
  to service_role;

revoke all on function public.complete_fc_otp_signup_v1(
  text, text, text, text, text, text, text, text[], text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.complete_fc_otp_signup_v1(
  text, text, text, text, text, text, text, text[], text, uuid, text, text
) to service_role;

comment on table public.fc_signup_completion_challenges is
  'Service-only, short-lived hashed capability for atomic FC OTP signup completion.';
comment on function public.verify_fc_signup_otp_v1(text, text, text, boolean) is
  'Verifies a live FC signup OTP challenge and issues a 15-minute hashed completion capability.';
comment on function public.complete_fc_otp_signup_v1(
  text, text, text, text, text, text, text, text[], text, uuid, text, text
) is
  'Atomically consumes an OTP capability and commits FC profile, referral and credential state.';

-- Migration: FC signup completion challenge expiry cleanup (20261013094537).
-- Purge expired FC signup completion capabilities, including consumed rows
-- whose result payload contains short-lived signup response data. The existing
-- platform-auth-challenge-cleanup cron job calls this stable function name.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

drop index if exists public.fc_signup_completion_challenges_expires_idx;
create index fc_signup_completion_challenges_expires_idx
  on public.fc_signup_completion_challenges (expires_at);

create or replace function public.cleanup_platform_auth_challenges()
returns void language sql security invoker set search_path=public,pg_temp as $$
  delete from platform_signup_challenges where expires_at<=now()
    and coalesce(locked_until,expires_at)<=now();
  update platform_member_credentials c set reset_token_hash=null,reset_token_expires_at=null,
    reset_sent_at=null,reset_failed_count=0
    from platform_members m where m.id=c.member_id and m.fc_id is null
    and (c.reset_token_expires_at<=now() or (c.reset_token_hash is null and c.reset_sent_at<=now()-interval '60 seconds'));
  delete from platform_sms_delivery_attempts where created_at<now()-interval '31 days';
  delete from fc_signup_completion_challenges where expires_at<=now();
$$;
revoke all on function public.cleanup_platform_auth_challenges() from public,anon,authenticated;
grant execute on function public.cleanup_platform_auth_challenges() to service_role;

-- Migration: extended SMS delivery tracking (20261013094539).
-- Reuse the privacy-safe SMS delivery ledger for FC signup and password
-- recovery. The ledger stores provider metadata only: never a phone number,
-- OTP, or message body.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.platform_sms_delivery_attempts
  drop constraint platform_sms_delivery_attempts_purpose_check;
alter table public.platform_sms_delivery_attempts
  add constraint platform_sms_delivery_attempts_purpose_check
  check (purpose in ('signup','fc_signup','password_reset'));

create or replace function public.begin_platform_sms_delivery_attempt(
  p_purpose text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  created_id uuid;
begin
  if p_purpose not in ('fc_signup','password_reset') then
    raise exception 'invalid_input';
  end if;

  insert into platform_sms_delivery_attempts(purpose)
    values(p_purpose)
    returning id into created_id;

  return jsonb_build_object('ok',true,'deliveryId',created_id);
end $$;

create or replace function public.finalize_platform_sms_delivery_attempt(
  p_delivery_id uuid,
  p_purpose text,
  p_state text,
  p_provider_request_id text default null,
  p_provider_status_code text default null,
  p_failure_reason text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  updated_attempt uuid;
  checked_at timestamptz;
begin
  if p_delivery_id is null
    or p_purpose not in ('fc_signup','password_reset')
    or p_state not in ('accepted','unknown','rejected')
    or (p_provider_request_id is not null and (
      length(p_provider_request_id) not between 1 and 200
      or p_provider_request_id !~ '^[A-Za-z0-9._:-]+$'
    ))
    or (p_provider_status_code is not null and (
      length(p_provider_status_code) not between 1 and 40
      or p_provider_status_code !~ '^[A-Za-z0-9._:-]+$'
    ))
    or (p_failure_reason is not null and p_failure_reason not in (
      'missing_configuration','request_build_failed','provider_rejected',
      'invalid_provider_response','network_error','timeout'
    ))
    or (p_state='accepted' and (
      p_failure_reason is not null or not (
        (p_provider_status_code='202' and p_provider_request_id is not null)
        or (p_provider_status_code='simulated' and p_provider_request_id is null)
      )
    ))
    or (p_state='rejected' and (
      coalesce(p_failure_reason,'') not in (
        'missing_configuration','request_build_failed','provider_rejected'
      )
      or p_provider_request_id is not null
    ))
    or (p_state='unknown' and coalesce(p_failure_reason,'') not in (
      'invalid_provider_response','network_error','timeout'
    ))
  then
    raise exception 'invalid_input';
  end if;

  checked_at:=clock_timestamp();
  update platform_sms_delivery_attempts set
    state=p_state,
    provider_request_id=p_provider_request_id,
    provider_status_code=p_provider_status_code,
    failure_reason=p_failure_reason,
    updated_at=checked_at,
    completed_at=case when p_state in ('accepted','rejected') then checked_at else null end
  where id=p_delivery_id
    and purpose=p_purpose
    and state='pending'
  returning id into updated_attempt;

  if updated_attempt is null then
    return jsonb_build_object('ok',false,'code','delivery_not_pending');
  end if;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.begin_platform_sms_delivery_attempt(text)
  from public,anon,authenticated;
grant execute on function public.begin_platform_sms_delivery_attempt(text)
  to service_role;
revoke all on function public.finalize_platform_sms_delivery_attempt(uuid,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.finalize_platform_sms_delivery_attempt(uuid,text,text,text,text,text)
  to service_role;

-- Migration: atomic FC signup OTP issuance (20261013094541).
-- Serialize FC signup OTP issuance with verification and completion. The
-- challenge, its privacy-safe delivery attempt, and partial-signup cleanup
-- are committed together before an SMS can be sent.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.fc_profiles
  add column if not exists phone_verification_delivery_id uuid
    references public.platform_sms_delivery_attempts(id) on delete set null;

create index if not exists fc_profiles_phone_verification_delivery_idx
  on public.fc_profiles(phone_verification_delivery_id)
  where phone_verification_delivery_id is not null;

create or replace function public.issue_fc_signup_otp_v1(
  p_phone text,
  p_code_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  profile_row public.fc_profiles%rowtype;
  credential_row public.fc_credentials%rowtype;
  profile_exists boolean := false;
  credential_exists boolean := false;
  should_reset boolean := false;
  checked_at timestamptz;
  delivery_id uuid;
  auth_profile_ids jsonb := '[]'::jsonb;
begin
  if normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_code_hash, '') !~ '^[A-Za-z0-9+/]{43}=$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- verify_fc_signup_otp_v1 and complete_fc_otp_signup_v1 use this exact
  -- namespace. Issuance must participate in the same per-phone lifecycle.
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));

  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;
  profile_exists := found;

  if profile_exists then
    select credential.*
      into credential_row
    from public.fc_credentials credential
    where credential.fc_id = profile_row.id
    for update;
    credential_exists := found;

    if profile_row.is_manager_referral_shadow is true
      or (
        profile_row.signup_completed is true
        and credential_exists
        and credential_row.password_set_at is not null
      ) then
      return jsonb_build_object('ok', false, 'code', 'already_exists');
    end if;
  end if;

  perform 1
  from public.admin_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.manager_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  -- Evaluate lock and cooldown after every lock wait, never from an Edge
  -- timestamp captured before the critical section.
  checked_at := clock_timestamp();

  if profile_exists
    and profile_row.phone_verification_locked_until is not null
    and profile_row.phone_verification_locked_until > checked_at then
    return jsonb_build_object('ok', false, 'code', 'locked');
  end if;

  if profile_exists
    and profile_row.phone_verification_sent_at is not null
    and profile_row.phone_verification_sent_at > checked_at - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'code', 'cooldown');
  end if;

  insert into public.platform_sms_delivery_attempts(purpose)
    values('fc_signup')
    returning id into delivery_id;

  if not profile_exists then
    insert into public.fc_profiles (
      phone,
      name,
      affiliation,
      recommender,
      recommender_fc_id,
      recommender_code_id,
      recommender_code,
      recommender_linked_at,
      recommender_link_source,
      email,
      address,
      status,
      identity_completed,
      signup_completed,
      phone_verified,
      phone_verified_at,
      phone_verification_hash,
      phone_verification_expires_at,
      phone_verification_sent_at,
      phone_verification_attempts,
      phone_verification_locked_until,
      phone_verification_delivery_id,
      signup_verification_method,
      signup_verified_at,
      signup_verified_by_admin_id,
      updated_at
    ) values (
      normalized_phone,
      '',
      '',
      '',
      null,
      null,
      null,
      null,
      null,
      '',
      '',
      'draft',
      false,
      false,
      false,
      null,
      p_code_hash,
      checked_at + interval '5 minutes',
      checked_at,
      0,
      null,
      delivery_id,
      null,
      null,
      null,
      checked_at
    )
    returning * into profile_row;
  else
    should_reset := profile_row.phone_verified is true
      or profile_row.signup_completed is true
      or profile_row.status is distinct from 'draft'
      or profile_row.identity_completed is true
      or credential_exists
      or exists (
        select 1 from public.profiles auth_profile
        where auth_profile.fc_id = profile_row.id
      );

    if should_reset then
      delete from public.fc_identity_secure secure
      where secure.fc_id = profile_row.id;

      delete from public.fc_credentials credential
      where credential.fc_id = profile_row.id;

      with deleted_auth_profile as (
        delete from public.profiles auth_profile
        where auth_profile.fc_id = profile_row.id
        returning auth_profile.id
      )
      select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
        into auth_profile_ids
      from deleted_auth_profile;

      update public.fc_profiles
      set phone_verification_hash = p_code_hash,
          phone_verification_expires_at = checked_at + interval '5 minutes',
          phone_verification_sent_at = checked_at,
          phone_verification_attempts = 0,
          phone_verification_locked_until = null,
          phone_verification_delivery_id = delivery_id,
          name = '',
          affiliation = '',
          recommender = '',
          recommender_fc_id = null,
          recommender_code_id = null,
          recommender_code = null,
          recommender_linked_at = null,
          recommender_link_source = null,
          email = '',
          address = '',
          address_detail = null,
          resident_id_masked = null,
          resident_id_hash = null,
          identity_completed = false,
          status = 'draft',
          life_commission_completed = false,
          nonlife_commission_completed = false,
          temp_id = null,
          allowance_date = null,
          allowance_prescreen_requested_at = null,
          allowance_reject_reason = null,
          appointment_url = null,
          appointment_date = null,
          appointment_schedule_life = null,
          appointment_schedule_nonlife = null,
          appointment_date_life = null,
          appointment_date_nonlife = null,
          appointment_date_life_sub = null,
          appointment_date_nonlife_sub = null,
          appointment_reject_reason_life = null,
          appointment_reject_reason_nonlife = null,
          docs_deadline_at = null,
          docs_deadline_last_notified_at = null,
          hanwha_commission_date_sub = null,
          hanwha_commission_date = null,
          hanwha_commission_reject_reason = null,
          hanwha_commission_pdf_path = null,
          hanwha_commission_pdf_name = null,
          dawichok_url_sent_at = null,
          dawichok_url_sent_by = null,
          signup_completed = false,
          phone_verified = false,
          phone_verified_at = null,
          signup_verification_method = null,
          signup_verified_at = null,
          signup_verified_by_admin_id = null,
          updated_at = checked_at
      where id = profile_row.id;
    else
      update public.fc_profiles
      set phone_verification_hash = p_code_hash,
          phone_verification_expires_at = checked_at + interval '5 minutes',
          phone_verification_sent_at = checked_at,
          phone_verification_attempts = 0,
          phone_verification_locked_until = null,
          phone_verification_delivery_id = delivery_id,
          updated_at = checked_at
      where id = profile_row.id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'deliveryId', delivery_id,
    'authProfileIds', auth_profile_ids,
    'resetApplied', should_reset
  );
end;
$$;

create or replace function public.finalize_fc_signup_otp_delivery_v1(
  p_phone text,
  p_delivery_id uuid,
  p_state text,
  p_provider_request_id text default null,
  p_provider_status_code text default null,
  p_failure_reason text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  profile_row public.fc_profiles%rowtype;
  profile_exists boolean := false;
  updated_attempt uuid;
  checked_at timestamptz;
begin
  if normalized_phone !~ '^01[0-9]{9}$'
    or p_delivery_id is null
    or p_state not in ('accepted','unknown','rejected')
    or (p_provider_request_id is not null and (
      length(p_provider_request_id) not between 1 and 200
      or p_provider_request_id !~ '^[A-Za-z0-9._:-]+$'
    ))
    or (p_provider_status_code is not null and (
      length(p_provider_status_code) not between 1 and 40
      or p_provider_status_code !~ '^[A-Za-z0-9._:-]+$'
    ))
    or (p_failure_reason is not null and p_failure_reason not in (
      'missing_configuration','request_build_failed','provider_rejected',
      'invalid_provider_response','network_error','timeout'
    ))
    or (p_state = 'accepted' and (
      p_failure_reason is not null or not (
        (p_provider_status_code = '202' and p_provider_request_id is not null)
        or (p_provider_status_code = 'simulated' and p_provider_request_id is null)
      )
    ))
    or (p_state = 'rejected' and (
      coalesce(p_failure_reason, '') not in (
        'missing_configuration','request_build_failed','provider_rejected'
      )
      or p_provider_request_id is not null
    ))
    or (p_state = 'unknown' and coalesce(p_failure_reason, '') not in (
      'invalid_provider_response','network_error','timeout'
    )) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));

  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;
  profile_exists := found;

  checked_at := clock_timestamp();
  update public.platform_sms_delivery_attempts
  set state = p_state,
      provider_request_id = p_provider_request_id,
      provider_status_code = p_provider_status_code,
      failure_reason = p_failure_reason,
      updated_at = checked_at,
      completed_at = case when p_state in ('accepted','rejected') then checked_at else null end
  where id = p_delivery_id
    and purpose = 'fc_signup'
    and state = 'pending'
  returning id into updated_attempt;

  if updated_attempt is null then
    return jsonb_build_object('ok', false, 'code', 'delivery_not_pending');
  end if;

  if not profile_exists
    or profile_row.phone_verification_delivery_id is distinct from p_delivery_id then
    return jsonb_build_object('ok', false, 'code', 'stale_delivery');
  end if;

  if p_state = 'rejected' then
    update public.fc_profiles
    set phone_verification_hash = null,
        phone_verification_expires_at = null,
        phone_verification_sent_at = null,
        phone_verification_attempts = 0,
        phone_verification_locked_until = null,
        phone_verification_delivery_id = null,
        updated_at = checked_at
    where id = profile_row.id
      and phone_verification_delivery_id = p_delivery_id;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'stale_delivery');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'current', true);
end;
$$;

revoke all on function public.issue_fc_signup_otp_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.issue_fc_signup_otp_v1(text, text)
  to service_role;

revoke all on function public.finalize_fc_signup_otp_delivery_v1(text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_fc_signup_otp_delivery_v1(text, uuid, text, text, text, text)
  to service_role;

comment on function public.issue_fc_signup_otp_v1(text, text) is
  'Atomically reserves one FC signup OTP and its privacy-safe SMS delivery attempt per phone cooldown.';
comment on function public.finalize_fc_signup_otp_delivery_v1(text, uuid, text, text, text, text) is
  'Finalizes one FC signup SMS attempt and compensates only the currently owned rejected challenge.';

-- 20261013094543_fc_password_sync_generation_results.sql
-- Return the credential generation from the same database transaction that
-- changes the password. A follow-up SELECT in an Edge function can race with a
-- second password change and pair the wrong generation with plaintext.

create or replace function public.complete_admin_assisted_password_change_v2(
  p_fc_id uuid,
  p_phone text,
  p_nonce_hash text,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  credential_session_version bigint;
begin
  result := public.complete_admin_assisted_password_change_v1(
    p_fc_id,
    p_phone,
    p_nonce_hash,
    p_password_hash,
    p_password_salt
  );

  if result is null or result ->> 'ok' is distinct from 'true' then
    raise exception 'assisted_password_change_generation_unavailable';
  end if;

  select credential.session_version
    into credential_session_version
  from public.fc_credentials credential
  where credential.fc_id = p_fc_id;

  if not found or credential_session_version is null then
    raise exception 'assisted_password_change_generation_unavailable';
  end if;

  return result || jsonb_build_object(
    'sessionVersion', credential_session_version
  );
end;
$$;

revoke all on function public.complete_admin_assisted_password_change_v2(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_admin_assisted_password_change_v2(
  uuid, text, text, text, text
) to service_role;

comment on function public.complete_admin_assisted_password_change_v2(
  uuid, text, text, text, text
) is
  'Completes an assisted FC password change and returns the resulting credential sessionVersion from the same transaction.';

create or replace function public.process_password_reset_challenge_v2(
  p_action text,
  p_account_kind text,
  p_account_id uuid,
  p_phone text,
  p_token_hash text,
  p_password_hash text default null,
  p_password_salt text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  credential_session_version bigint;
begin
  result := public.process_password_reset_challenge(
    p_action,
    p_account_kind,
    p_account_id,
    p_phone,
    p_token_hash,
    p_password_hash,
    p_password_salt
  );

  if p_action = 'consume'
    and p_account_kind = 'fc'
    and result ->> 'ok' = 'true' then
    select credential.session_version
      into credential_session_version
    from public.fc_credentials credential
    where credential.fc_id = p_account_id;

    if not found or credential_session_version is null then
      raise exception 'password_reset_generation_unavailable';
    end if;

    result := result || jsonb_build_object(
      'sessionVersion', credential_session_version
    );
  end if;

  return result;
end;
$$;

revoke all on function public.process_password_reset_challenge_v2(
  text, text, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.process_password_reset_challenge_v2(
  text, text, uuid, text, text, text, text
) to service_role;

comment on function public.process_password_reset_challenge_v2(
  text, text, uuid, text, text, text, text
) is
  'Processes a password-reset challenge and, for successful FC consumption, returns the resulting credential sessionVersion from the same transaction.';

-- 20261013090024_filter_account_delete_legacy_chat_paths.sql
-- Keep the account-deletion cleanup receipt limited to legacy direct-message
-- URLs. Private messenger v2 attachment paths are queued by
-- queue_messenger_attachment_actor_cleanup_v2 before the account row is deleted.
create or replace function public.delete_account_core_transaction_v1(
  p_target_role text,
  p_target_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_phone text;
  v_phone_digits text;
  v_fc_ids uuid[] := array[]::uuid[];
  v_fc_id uuid;
  v_proof_paths text[] := array[]::text[];
  v_new_proof_paths text[] := array[]::text[];
  v_document_paths text[] := array[]::text[];
  v_board_paths text[] := array[]::text[];
  v_auth_user_ids uuid[] := array[]::uuid[];
  v_post_ids uuid[] := array[]::uuid[];
  v_cleanup_outbox_id uuid;
  v_deleted_count integer := 0;
begin
  if p_target_id is null or p_target_role not in ('fc', 'admin', 'manager') then
    raise exception using errcode = '22023', message = 'invalid_account_delete_target';
  end if;

  if p_target_role = 'fc' then
    select profile.phone
      into v_phone
      from public.fc_profiles profile
     where profile.id = p_target_id
       and not profile.is_manager_referral_shadow
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;
    v_fc_ids := array[p_target_id];
  elsif p_target_role = 'admin' then
    select account.phone
      into v_phone
      from public.admin_accounts account
     where account.id = p_target_id
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;
  else
    select account.phone
      into v_phone
      from public.manager_accounts account
     where account.id = p_target_id
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;

    select coalesce(array_agg(profile.id order by profile.id), array[]::uuid[])
      into v_fc_ids
      from public.fc_profiles profile
     where profile.is_manager_referral_shadow
       and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g')
           = regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g');
  end if;

  v_phone_digits := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
  if v_phone_digits is null then
    raise exception using errcode = '23514', message = 'account_delete_phone_missing';
  end if;

  if cardinality(v_fc_ids) > 0 then
    perform 1
      from public.fc_profiles profile
     where profile.id = any(v_fc_ids)
     for update;

    if exists (
      select 1
        from public.exam_registrations registration
       where registration.resident_id not like 'deleted-exam:%'
         and (
           (
             registration.fc_id = any(v_fc_ids)
             and nullif(
               regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
               ''
             ) is distinct from v_phone_digits
           )
           or (
             nullif(
               regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
               ''
             ) = v_phone_digits
             and (
               registration.fc_id is null
               or not (registration.fc_id = any(v_fc_ids))
             )
           )
         )
    ) then
      raise exception using
        errcode = '23514',
        message = 'account_delete_exam_ownership_mismatch';
    end if;

    select coalesce(array_agg(document.storage_path), array[]::text[])
      into v_document_paths
      from public.fc_documents document
     where document.fc_id = any(v_fc_ids)
       and document.storage_path is not null
       and document.storage_path <> 'deleted';

    select coalesce(array_agg(profile.id), array[]::uuid[])
      into v_auth_user_ids
      from public.profiles profile
     where profile.fc_id = any(v_fc_ids);

    foreach v_fc_id in array v_fc_ids
    loop
      select coalesce(array_agg(detached.proof_path), array[]::text[])
        into v_new_proof_paths
        from public.detach_exam_registration_identity_for_account_deletion(v_fc_id) detached;
      v_proof_paths := v_proof_paths || v_new_proof_paths;
    end loop;
  end if;

  select coalesce(array_agg(post.id), array[]::uuid[])
    into v_post_ids
    from public.board_posts post
   where regexp_replace(coalesce(post.author_resident_id, ''), '[^0-9]', '', 'g')
         = v_phone_digits;

  select coalesce(array_agg(distinct attachment.storage_path), array[]::text[])
    into v_board_paths
    from public.board_attachments attachment
   where regexp_replace(coalesce(attachment.created_by_resident_id, ''), '[^0-9]', '', 'g')
         = v_phone_digits
      or attachment.post_id = any(v_post_ids);

  -- Legacy chat uploads used shared `chat/` and `group-chat/` prefixes without
  -- an owner identifier. A message row therefore cannot prove ownership of the
  -- referenced object. Keep these objects out of the service-role cleanup
  -- receipt instead of trusting a user-controlled legacy file_url.

  delete from public.board_comment_likes
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_post_reactions
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_post_views
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_comments
   where regexp_replace(coalesce(author_resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_attachments
   where regexp_replace(coalesce(created_by_resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_posts where id = any(v_post_ids);

  if to_regclass('public.messages') is not null then
    execute $dynamic$
      delete from public.messages
       where regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g') = $1
          or regexp_replace(coalesce(receiver_id, ''), '[^0-9]', '', 'g') = $1
    $dynamic$
    using v_phone_digits;
  end if;

  delete from public.notifications
   where (cardinality(v_fc_ids) > 0 and fc_id = any(v_fc_ids))
      or regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.device_tokens
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.web_push_subscriptions
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.user_presence
   where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.notices
   where regexp_replace(coalesce(created_by, ''), '[^0-9]', '', 'g') = v_phone_digits;

  delete from public.referral_events
   where regexp_replace(coalesce(inviter_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      or regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.referral_attributions
   where regexp_replace(coalesce(inviter_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      or regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

  if p_target_role = 'manager' then
    delete from public.affiliation_manager_mappings
     where regexp_replace(coalesce(manager_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  end if;

  if cardinality(v_fc_ids) > 0 then
    delete from public.profiles where fc_id = any(v_fc_ids);
    delete from public.fc_profiles where id = any(v_fc_ids);
  end if;

  if p_target_role = 'admin' then
    delete from public.admin_accounts where id = p_target_id;
  elsif p_target_role = 'manager' then
    delete from public.manager_accounts where id = p_target_id;
  end if;
  get diagnostics v_deleted_count = row_count;

  if p_target_role = 'fc' then
    v_deleted_count := case
      when exists (select 1 from public.fc_profiles where id = p_target_id) then 0
      else 1
    end;
  end if;

  if v_deleted_count <> 1 then
    raise exception using errcode = 'P0002', message = 'account_delete_target_not_deleted';
  end if;

  insert into public.account_deletion_cleanup_outbox (
    cleanup_payload
  ) values (
    jsonb_build_object(
      'proof_paths', to_jsonb(v_proof_paths),
      'document_paths', to_jsonb(v_document_paths),
      'board_attachment_paths', to_jsonb(v_board_paths),
      'chat_file_urls', '[]'::jsonb,
      'auth_user_ids', to_jsonb(v_auth_user_ids)
    )
  )
  returning id into v_cleanup_outbox_id;

  return jsonb_build_object(
    'deleted', true,
    'cleanup_outbox_id', v_cleanup_outbox_id,
    'proof_paths', to_jsonb(v_proof_paths),
    'document_paths', to_jsonb(v_document_paths),
    'board_attachment_paths', to_jsonb(v_board_paths),
    'chat_file_urls', '[]'::jsonb,
    'auth_user_ids', to_jsonb(v_auth_user_ids)
  );
end;
$$;

revoke all on function public.delete_account_core_transaction_v1(
  text, uuid
) from public, anon, authenticated;
grant execute on function public.delete_account_core_transaction_v1(
  text, uuid
) to service_role;

-- 20261013090025_atomic_onboarding_writes.sql
-- Keep the final multi-table onboarding writes inside one PostgreSQL transaction.
-- Edge Functions encrypt/hash identity material before calling these RPCs; neither
-- function accepts or returns a raw resident registration number or password.

create or replace function public.store_fc_identity_atomic_v1(
  p_fc_id uuid,
  p_expected_phone text,
  p_resident_number_encrypted text,
  p_resident_id_masked text,
  p_resident_id_hash text,
  p_address text,
  p_address_detail text,
  p_address_encrypted text,
  p_address_detail_encrypted text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_normalized_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_address text := btrim(coalesce(p_address, ''));
  v_address_detail text := nullif(btrim(coalesce(p_address_detail, '')), '');
  v_has_resident_input boolean := p_resident_number_encrypted is not null
    or p_resident_id_masked is not null
    or p_resident_id_hash is not null;
  v_secure_fc_id uuid;
begin
  if p_fc_id is null
    or v_normalized_phone !~ '^01[0-9]{9}$'
    or char_length(v_address) not between 1 and 500
    or char_length(coalesce(v_address_detail, '')) > 500
    or char_length(coalesce(p_address_encrypted, '')) not between 20 and 8192
    or (v_address_detail is null) <> (p_address_detail_encrypted is null)
    or (p_address_detail_encrypted is not null
      and char_length(p_address_detail_encrypted) not between 20 and 8192) then
    raise exception using errcode = '22023', message = 'identity_payload_invalid';
  end if;

  if v_has_resident_input and (
    p_resident_number_encrypted is null
    or p_resident_id_masked is null
    or p_resident_id_hash is null
    or char_length(p_resident_number_encrypted) not between 20 and 4096
    or p_resident_id_masked !~ '^[0-9]{6}-[*]{7}$'
    or char_length(p_resident_id_hash) <> 44
    or p_resident_id_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
  ) then
    raise exception using errcode = '22023', message = 'identity_payload_invalid';
  end if;

  select profile.*
    into v_profile
  from public.fc_profiles profile
  where profile.id = p_fc_id
    and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_normalized_phone
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'identity_profile_not_found';
  end if;

  if v_has_resident_input then
    insert into public.fc_identity_secure as secure (
      fc_id,
      resident_number_encrypted,
      address_encrypted,
      address_detail_encrypted
    ) values (
      p_fc_id,
      p_resident_number_encrypted,
      p_address_encrypted,
      p_address_detail_encrypted
    )
    on conflict (fc_id) do update
    set resident_number_encrypted = excluded.resident_number_encrypted,
        address_encrypted = excluded.address_encrypted,
        address_detail_encrypted = excluded.address_detail_encrypted
    returning secure.fc_id into v_secure_fc_id;

    update public.fc_profiles
    set resident_id_masked = p_resident_id_masked,
        resident_id_hash = p_resident_id_hash,
        address = v_address,
        address_detail = v_address_detail,
        identity_completed = true
    where id = p_fc_id;
  else
    if v_profile.resident_id_masked is null or v_profile.resident_id_hash is null then
      raise exception using errcode = '22023', message = 'resident_identity_required';
    end if;

    update public.fc_identity_secure
    set address_encrypted = p_address_encrypted,
        address_detail_encrypted = p_address_detail_encrypted
    where fc_id = p_fc_id
    returning fc_id into v_secure_fc_id;

    if v_secure_fc_id is null then
      raise exception using errcode = '22023', message = 'resident_identity_required';
    end if;

    update public.fc_profiles
    set address = v_address,
        address_detail = v_address_detail,
        identity_completed = true
    where id = p_fc_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'fcId', p_fc_id,
    'residentId', v_normalized_phone,
    'identityCompleted', true
  );
end;
$$;

revoke all on function public.store_fc_identity_atomic_v1(
  uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.store_fc_identity_atomic_v1(
  uuid, text, text, text, text, text, text, text, text
) to service_role;

comment on function public.store_fc_identity_atomic_v1(
  uuid, text, text, text, text, text, text, text, text
) is 'Atomically stores pre-encrypted FC identity material and its profile completion receipt. Execute is service_role only.';

create or replace function public.complete_fc_signup_atomic_v1(
  p_fc_id uuid,
  p_expected_phone text,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_normalized_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_existing_password_set_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_fc_id is null
    or v_normalized_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_password_hash, '')) <> 44
    or p_password_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_password_salt, '')) <> 24
    or p_password_salt !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception using errcode = '22023', message = 'signup_completion_payload_invalid';
  end if;

  select profile.*
    into v_profile
  from public.fc_profiles profile
  where profile.id = p_fc_id
    and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_normalized_phone
  for update;

  if not found
    or v_profile.phone_verified is distinct from true
    or coalesce(v_profile.is_manager_referral_shadow, false) then
    raise exception using errcode = '42501', message = 'signup_completion_forbidden';
  end if;

  select credential.password_set_at
    into v_existing_password_set_at
  from public.fc_credentials credential
  where credential.fc_id = p_fc_id
  for update;

  if found and v_existing_password_set_at is not null then
    raise exception using errcode = '55000', message = 'signup_password_already_set';
  end if;

  update public.fc_profiles
  set signup_completed = true,
      signup_verification_method = 'phone_otp',
      signup_verified_at = v_now,
      signup_verified_by_admin_id = null
  where id = p_fc_id;

  insert into public.fc_credentials as credential (
    fc_id,
    password_hash,
    password_salt,
    password_set_at,
    failed_count,
    locked_until,
    reset_token_hash,
    reset_token_expires_at,
    reset_sent_at,
    reset_failed_count,
    must_change_password,
    temporary_password_issued_at,
    updated_at
  ) values (
    p_fc_id,
    p_password_hash,
    p_password_salt,
    v_now,
    0,
    null,
    null,
    null,
    null,
    0,
    false,
    null,
    v_now
  )
  on conflict (fc_id) do update
  set password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_set_at = excluded.password_set_at,
      failed_count = 0,
      locked_until = null,
      reset_token_hash = null,
      reset_token_expires_at = null,
      reset_sent_at = null,
      reset_failed_count = 0,
      must_change_password = false,
      temporary_password_issued_at = null,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'fcId', p_fc_id,
    'residentId', v_normalized_phone,
    'displayName', coalesce(v_profile.name, ''),
    'signupCompleted', true,
    'passwordSetAt', v_now
  );
end;
$$;

revoke all on function public.complete_fc_signup_atomic_v1(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_fc_signup_atomic_v1(uuid, text, text, text)
  to service_role;

comment on function public.complete_fc_signup_atomic_v1(uuid, text, text, text)
  is 'Atomically completes a phone-verified FC profile and stores its derived password credential. Execute is service_role only.';

-- 20261013090028_atomic_signup_otp_challenges.sql
-- Own signup OTP issuance, guessing, verification, reset, and proof
-- consumption under the FC profile row lock. Only service-role Edge
-- functions may call these boundaries.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.fc_profiles
  add column if not exists phone_verification_challenge_id uuid;
alter table public.fc_profiles
  add column if not exists signup_verification_proof_hash text;
alter table public.fc_profiles
  add column if not exists signup_verification_proof_expires_at timestamptz;

create or replace function public.issue_signup_otp_challenge_v1(
  p_fc_id uuid,
  p_expected_phone text,
  p_challenge_id uuid,
  p_otp_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_now timestamptz;
  v_expires_at timestamptz;
begin
  if p_fc_id is null or p_challenge_id is null
    or v_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_otp_hash, '')) <> 44
    or p_otp_hash !~ '^[A-Za-z0-9+/]+={0,2}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select profile.* into v_profile
  from public.fc_profiles profile
  where profile.id = p_fc_id
    and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_phone
    and coalesce(profile.is_manager_referral_shadow, false) = false
  for update;

  if not found or coalesce(v_profile.is_manager_referral_shadow, false) then
    return jsonb_build_object('ok', false, 'code', 'profile_unavailable');
  end if;
  if v_profile.signup_completed is true and exists (
    select 1 from public.fc_credentials credential
    where credential.fc_id = v_profile.id
      and credential.password_set_at is not null
  ) then
    return jsonb_build_object('ok', false, 'code', 'account_exists');
  end if;

  v_now := clock_timestamp();
  if v_profile.phone_verification_locked_until > v_now then
    return jsonb_build_object(
      'ok', false,
      'code', 'locked',
      'lockedUntil', v_profile.phone_verification_locked_until
    );
  end if;
  if v_profile.phone_verification_sent_at > v_now - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'code', 'cooldown');
  end if;

  v_expires_at := v_now + interval '5 minutes';
  update public.fc_profiles
  set phone_verification_challenge_id = p_challenge_id,
      phone_verification_hash = p_otp_hash,
      phone_verification_expires_at = v_expires_at,
      phone_verification_sent_at = v_now,
      phone_verification_attempts = 0,
      phone_verification_locked_until = null,
      updated_at = v_now
  where id = p_fc_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'issued',
    'profileId', p_fc_id,
    'residentId', v_phone,
    'challengeId', p_challenge_id,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.process_signup_otp_challenge_v1(
  p_expected_phone text,
  p_challenge_id uuid,
  p_submitted_hash text,
  p_verification_proof_hash text,
  p_allow_test_bypass boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_now timestamptz;
  v_attempts integer;
  v_locked_until timestamptz;
  v_proof_expires_at timestamptz;
begin
  if p_challenge_id is null or v_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_submitted_hash, '')) <> 44
    or p_submitted_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_verification_proof_hash, '')) <> 44
    or p_verification_proof_hash !~ '^[A-Za-z0-9+/]+={0,2}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select profile.* into v_profile
  from public.fc_profiles profile
  where regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_phone
    and coalesce(profile.is_manager_referral_shadow, false) = false
  for update;

  if not found or coalesce(v_profile.is_manager_referral_shadow, false) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_profile.signup_completed is true and exists (
    select 1 from public.fc_credentials credential
    where credential.fc_id = v_profile.id
      and credential.password_set_at is not null
  ) then
    return jsonb_build_object('ok', false, 'code', 'account_exists');
  end if;

  v_now := clock_timestamp();
  if v_profile.phone_verification_locked_until > v_now then
    return jsonb_build_object(
      'ok', false,
      'code', 'locked',
      'lockedUntil', v_profile.phone_verification_locked_until
    );
  end if;
  if v_profile.phone_verification_challenge_id is distinct from p_challenge_id then
    return jsonb_build_object('ok', false, 'code', 'stale_challenge');
  end if;
  if v_profile.phone_verification_hash is null
    or v_profile.phone_verification_expires_at is null then
    return jsonb_build_object('ok', false, 'code', 'no_code');
  end if;
  if v_profile.phone_verification_expires_at <= v_now then
    return jsonb_build_object('ok', false, 'code', 'expired_code');
  end if;

  if not p_allow_test_bypass
    and v_profile.phone_verification_hash is distinct from p_submitted_hash then
    v_attempts := coalesce(v_profile.phone_verification_attempts, 0) + 1;
    if v_attempts >= 5 then
      v_locked_until := v_now + interval '10 minutes';
      update public.fc_profiles
      set phone_verification_attempts = 0,
          phone_verification_locked_until = v_locked_until,
          updated_at = v_now
      where id = v_profile.id;
      return jsonb_build_object(
        'ok', false,
        'code', 'locked',
        'lockedUntil', v_locked_until,
        'remaining', 0
      );
    end if;

    update public.fc_profiles
    set phone_verification_attempts = v_attempts,
        updated_at = v_now
    where id = v_profile.id;
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_code',
      'remaining', 5 - v_attempts
    );
  end if;

  -- Old DB-side onboarding artifacts are removed only after the caller has
  -- proved control of the phone, and all changes roll back together.
  delete from public.profiles where fc_id = v_profile.id;
  delete from public.fc_identity_secure where fc_id = v_profile.id;
  delete from public.fc_credentials where fc_id = v_profile.id;

  v_proof_expires_at := v_now + interval '10 minutes';
  update public.fc_profiles
  set name = '',
      affiliation = '',
      recommender = null,
      recommender_fc_id = null,
      recommender_code_id = null,
      recommender_code = null,
      recommender_linked_at = null,
      recommender_link_source = null,
      email = '',
      address = '',
      address_detail = null,
      resident_id_masked = null,
      resident_id_hash = null,
      identity_completed = false,
      status = 'draft',
      life_commission_completed = false,
      nonlife_commission_completed = false,
      temp_id = null,
      allowance_date = null,
      allowance_prescreen_requested_at = null,
      allowance_reject_reason = null,
      appointment_url = null,
      appointment_date = null,
      appointment_schedule_life = null,
      appointment_schedule_nonlife = null,
      appointment_date_life = null,
      appointment_date_nonlife = null,
      appointment_date_life_sub = null,
      appointment_date_nonlife_sub = null,
      appointment_reject_reason_life = null,
      appointment_reject_reason_nonlife = null,
      docs_deadline_at = null,
      docs_deadline_last_notified_at = null,
      hanwha_commission_date_sub = null,
      hanwha_commission_date = null,
      hanwha_commission_reject_reason = null,
      hanwha_commission_pdf_path = null,
      hanwha_commission_pdf_name = null,
      dawichok_url_sent_at = null,
      dawichok_url_sent_by = null,
      signup_completed = false,
      phone_verified = true,
      phone_verified_at = v_now,
      signup_verification_method = 'phone_otp',
      signup_verified_at = v_now,
      signup_verified_by_admin_id = null,
      phone_verification_challenge_id = null,
      phone_verification_hash = null,
      phone_verification_expires_at = null,
      phone_verification_sent_at = null,
      phone_verification_attempts = 0,
      phone_verification_locked_until = null,
      signup_verification_proof_hash = p_verification_proof_hash,
      signup_verification_proof_expires_at = v_proof_expires_at,
      updated_at = v_now
  where id = v_profile.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'verified',
    'verified', true,
    'profileId', v_profile.id,
    'residentId', v_phone,
    'challengeId', p_challenge_id,
    'verifiedAt', v_now,
    'proofExpiresAt', v_proof_expires_at
  );
end;
$$;

create or replace function public.validate_signup_verification_proof_v1(
  p_expected_phone text,
  p_verification_proof_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
begin
  if v_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_verification_proof_hash, '')) <> 44
    or p_verification_proof_hash !~ '^[A-Za-z0-9+/]+={0,2}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select profile.* into v_profile
  from public.fc_profiles profile
  where regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_phone
    and coalesce(profile.is_manager_referral_shadow, false) = false;

  if not found or v_profile.phone_verified is distinct from true
    or v_profile.signup_completed is true
    or coalesce(v_profile.is_manager_referral_shadow, false)
    or v_profile.signup_verification_proof_hash is distinct from p_verification_proof_hash
    or v_profile.signup_verification_proof_expires_at is null
    or v_profile.signup_verification_proof_expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'proof_invalid');
  end if;

  return jsonb_build_object(
    'ok', true,
    'profileId', v_profile.id,
    'residentId', v_phone
  );
end;
$$;

drop function if exists public.complete_fc_signup_atomic_v1(uuid, text, text, text);

create or replace function public.complete_fc_signup_atomic_v1(
  p_fc_id uuid,
  p_expected_phone text,
  p_password_hash text,
  p_password_salt text,
  p_verification_proof_hash text,
  p_name text,
  p_affiliation text,
  p_email text,
  p_carrier text,
  p_license_statuses text[],
  p_inviter_fc_id uuid,
  p_referral_code_id uuid,
  p_referral_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.fc_profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_existing_password_set_at timestamptz;
  v_now timestamptz;
  v_name text := btrim(coalesce(p_name, ''));
  v_affiliation text := btrim(coalesce(p_affiliation, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_carrier text := btrim(coalesce(p_carrier, ''));
  v_referral_result jsonb;
begin
  if p_fc_id is null or v_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_password_hash, '')) <> 44
    or p_password_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_password_salt, '')) <> 24
    or p_password_salt !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(coalesce(p_verification_proof_hash, '')) <> 44
    or p_verification_proof_hash !~ '^[A-Za-z0-9+/]+={0,2}$'
    or char_length(v_name) not between 1 and 100
    or char_length(v_affiliation) not between 1 and 100
    or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or v_carrier not in ('SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰')
    or p_license_statuses is null
    or cardinality(p_license_statuses) = 0
    or exists (
      select 1 from unnest(p_license_statuses) status_value
      where status_value not in ('third', 'life', 'nonlife', 'none')
    )
    or ('none' = any(p_license_statuses) and cardinality(p_license_statuses) > 1)
    or p_inviter_fc_id is null
    or p_referral_code_id is null
    or nullif(btrim(coalesce(p_referral_code, '')), '') is null then
    raise exception using errcode = '22023', message = 'signup_completion_payload_invalid';
  end if;

  select profile.* into v_profile
  from public.fc_profiles profile
  where profile.id = p_fc_id
    and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_phone
    and coalesce(profile.is_manager_referral_shadow, false) = false
  for update;

  v_now := clock_timestamp();
  if not found or v_profile.phone_verified is distinct from true
    or v_profile.signup_completed is true
    or coalesce(v_profile.is_manager_referral_shadow, false)
    or v_profile.signup_verification_proof_hash is distinct from p_verification_proof_hash
    or v_profile.signup_verification_proof_expires_at is null
    or v_profile.signup_verification_proof_expires_at <= v_now then
    raise exception using errcode = '42501', message = 'signup_completion_proof_invalid';
  end if;

  select credential.password_set_at into v_existing_password_set_at
  from public.fc_credentials credential
  where credential.fc_id = p_fc_id
  for update;
  if found and v_existing_password_set_at is not null then
    raise exception using errcode = '55000', message = 'signup_password_already_set';
  end if;

  update public.fc_profiles
  set name = v_name,
      affiliation = v_affiliation,
      email = v_email,
      carrier = v_carrier,
      license_statuses = p_license_statuses,
      status = 'draft',
      life_commission_completed = false,
      nonlife_commission_completed = false,
      address = '',
      address_detail = null,
      resident_id_masked = null,
      resident_id_hash = null,
      identity_completed = false,
      temp_id = null,
      allowance_date = null,
      allowance_prescreen_requested_at = null,
      allowance_reject_reason = null,
      appointment_url = null,
      appointment_date = null,
      appointment_schedule_life = null,
      appointment_schedule_nonlife = null,
      appointment_date_life = null,
      appointment_date_nonlife = null,
      appointment_date_life_sub = null,
      appointment_date_nonlife_sub = null,
      appointment_reject_reason_life = null,
      appointment_reject_reason_nonlife = null,
      docs_deadline_at = null,
      docs_deadline_last_notified_at = null,
      hanwha_commission_date_sub = null,
      hanwha_commission_date = null,
      hanwha_commission_reject_reason = null,
      hanwha_commission_pdf_path = null,
      hanwha_commission_pdf_name = null,
      dawichok_url_sent_at = null,
      dawichok_url_sent_by = null,
      recommender = null,
      recommender_fc_id = null,
      recommender_code_id = null,
      recommender_code = null,
      recommender_linked_at = null,
      recommender_link_source = null,
      signup_completed = true,
      signup_verification_method = 'phone_otp',
      signup_verified_at = v_now,
      signup_verified_by_admin_id = null,
      signup_verification_proof_hash = null,
      signup_verification_proof_expires_at = null,
      updated_at = v_now
  where id = p_fc_id;

  v_referral_result := public.apply_referral_link_state(
    p_invitee_fc_id => p_fc_id,
    p_inviter_fc_id => p_inviter_fc_id,
    p_referral_code_id => p_referral_code_id,
    p_referral_code => upper(btrim(p_referral_code)),
    p_source => 'signup',
    p_actor_phone => v_phone,
    p_actor_role => 'system',
    p_actor_staff_type => null,
    p_reason => 'set_password_signup'
  );
  if coalesce((v_referral_result ->> 'ok')::boolean, false) is not true
    or v_referral_result ->> 'inviteeFcId' is distinct from p_fc_id::text
    or v_referral_result ->> 'inviterFcId' is distinct from p_inviter_fc_id::text
    or v_referral_result ->> 'referralCodeId' is distinct from p_referral_code_id::text then
    raise exception using errcode = '55000', message = 'signup_referral_write_unverified';
  end if;

  insert into public.fc_credentials as credential (
    fc_id, password_hash, password_salt, password_set_at,
    failed_count, locked_until, reset_token_hash, reset_token_expires_at,
    reset_sent_at, reset_failed_count, must_change_password,
    temporary_password_issued_at, updated_at
  ) values (
    p_fc_id, p_password_hash, p_password_salt, v_now,
    0, null, null, null, null, 0, false, null, v_now
  )
  on conflict (fc_id) do update
  set password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_set_at = excluded.password_set_at,
      failed_count = 0,
      locked_until = null,
      reset_token_hash = null,
      reset_token_expires_at = null,
      reset_sent_at = null,
      reset_failed_count = 0,
      must_change_password = false,
      temporary_password_issued_at = null,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'fcId', p_fc_id,
    'residentId', v_phone,
    'displayName', v_name,
    'signupCompleted', true,
    'passwordSetAt', v_now,
    'inviterFcId', v_referral_result ->> 'inviterFcId',
    'referralCodeId', v_referral_result ->> 'referralCodeId',
    'referralCode', v_referral_result ->> 'referralCode'
  );
end;
$$;

revoke all on function public.issue_signup_otp_challenge_v1(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.issue_signup_otp_challenge_v1(uuid, text, uuid, text)
  to service_role;
revoke all on function public.process_signup_otp_challenge_v1(text, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.process_signup_otp_challenge_v1(text, uuid, text, text, boolean)
  to service_role;
revoke all on function public.validate_signup_verification_proof_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.validate_signup_verification_proof_v1(text, text)
  to service_role;
revoke all on function public.complete_fc_signup_atomic_v1(
  uuid, text, text, text, text, text, text, text, text, text[], uuid, uuid, text
)
  from public, anon, authenticated;
grant execute on function public.complete_fc_signup_atomic_v1(
  uuid, text, text, text, text, text, text, text, text, text[], uuid, uuid, text
)
  to service_role;

comment on function public.process_signup_otp_challenge_v1(text, uuid, text, text, boolean)
  is 'Atomically verifies a current signup OTP, resets only DB-local partial artifacts, and issues a bounded one-time proof. Service role only.';
comment on function public.complete_fc_signup_atomic_v1(
  uuid, text, text, text, text, text, text, text, text, text[], uuid, uuid, text
)
  is 'Atomically consumes a phone/profile-bound signup proof while storing the profile, referral, credentials, and completed signup. Service role only.';

-- 20261013090029_atomic_password_login_attempts.sql
-- Serialize password comparison and failure counters on the credential row.
-- The Edge function derives the candidate PBKDF2 hash; this function compares
-- it with the current hash after locking, then records the outcome atomically.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.process_password_login_attempt_v1(
  p_account_kind text,
  p_account_id uuid,
  p_expected_phone text,
  p_candidate_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_table text;
  v_key text;
  v_account jsonb;
  v_profile public.fc_profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g');
  v_now timestamptz;
  v_failed_count integer;
  v_locked_until timestamptz;
begin
  if p_account_id is null or v_phone !~ '^01[0-9]{9}$'
    or char_length(coalesce(p_candidate_hash, '')) <> 44
    or p_candidate_hash !~ '^[A-Za-z0-9+/]+={0,2}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  case p_account_kind
    when 'admin' then v_table := 'admin_accounts'; v_key := 'id';
    when 'manager' then v_table := 'manager_accounts'; v_key := 'id';
    when 'fc' then
      v_table := 'fc_credentials'; v_key := 'fc_id';
      select profile.* into v_profile
      from public.fc_profiles profile
      where profile.id = p_account_id
        and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = v_phone
        and coalesce(profile.is_manager_referral_shadow, false) = false
      for update;
      if not found or v_profile.signup_completed is distinct from true then
        return jsonb_build_object('ok', false, 'code', 'account_unavailable');
      end if;
    else
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end case;

  execute format(
    'select to_jsonb(account) from public.%I account where %I = $1 for update',
    v_table,
    v_key
  ) into v_account using p_account_id;

  if v_account is null
    or v_account->>'password_set_at' is null
    or (p_account_kind <> 'fc' and (
      regexp_replace(coalesce(v_account->>'phone', ''), '[^0-9]', '', 'g') is distinct from v_phone
      or (v_account->>'active')::boolean is distinct from true
    )) then
    return jsonb_build_object('ok', false, 'code', 'account_unavailable');
  end if;

  v_now := clock_timestamp();
  if (v_account->>'locked_until')::timestamptz > v_now then
    return jsonb_build_object(
      'ok', false,
      'code', 'locked',
      'lockedUntil', (v_account->>'locked_until')::timestamptz,
      'remaining', 0
    );
  end if;

  if v_account->>'password_hash' is distinct from p_candidate_hash then
    v_failed_count := coalesce((v_account->>'failed_count')::integer, 0) + 1;
    if v_failed_count >= 5 then
      v_locked_until := v_now + interval '10 minutes';
      execute format(
        'update public.%I set failed_count = 0, locked_until = $2 where %I = $1',
        v_table,
        v_key
      ) using p_account_id, v_locked_until;
      return jsonb_build_object(
        'ok', false,
        'code', 'locked',
        'lockedUntil', v_locked_until,
        'remaining', 0
      );
    end if;

    execute format(
      'update public.%I set failed_count = $2, locked_until = null where %I = $1',
      v_table,
      v_key
    ) using p_account_id, v_failed_count;
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_password',
      'remaining', 5 - v_failed_count
    );
  end if;

  execute format(
    'update public.%I set failed_count = 0, locked_until = null where %I = $1',
    v_table,
    v_key
  ) using p_account_id;
  return jsonb_build_object(
    'ok', true,
    'code', 'authenticated',
    'accountKind', p_account_kind,
    'accountId', p_account_id,
    'residentId', v_phone
  );
end;
$$;

revoke all on function public.process_password_login_attempt_v1(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.process_password_login_attempt_v1(text, uuid, text, text)
  to service_role;

comment on function public.process_password_login_attempt_v1(text, uuid, text, text)
  is 'Atomically compares a derived password hash and records login failure/lock state. Execute is service_role only.';

-- 20261013090030_enforce_fc_profile_status_contract.sql
-- Keep database writes aligned with the shared FC workflow status contract.
-- The production preflight for this release confirmed that all existing rows
-- already use one of these values, so validation does not rewrite profile data.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.fc_profiles
  drop constraint if exists fc_profiles_status_check;

alter table public.fc_profiles
  add constraint fc_profiles_status_check
  check (
    status in (
      'draft',
      'temp-id-issued',
      'allowance-pending',
      'allowance-consented',
      'docs-requested',
      'docs-pending',
      'docs-submitted',
      'docs-rejected',
      'docs-approved',
      'hanwha-commission-review',
      'hanwha-commission-rejected',
      'hanwha-commission-approved',
      'appointment-completed',
      'final-link-sent'
    )
  ) not valid;

alter table public.fc_profiles
  validate constraint fc_profiles_status_check;

-- Migration: retire legacy FC signup RPCs (20261013113212).
-- Current canonical Edge source closures use the FC completion-capability
-- lifecycle. Preserve applied history and data columns while retiring the
-- unused parallel proof protocol. RESTRICT preserves unexpected dependents.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select 1 from public.fc_profiles
    where phone_verification_challenge_id is not null
      or signup_verification_proof_hash is not null
  ) then
    raise exception 'legacy_fc_signup_state_not_empty';
  end if;
end;
$$;

drop function if exists public.issue_signup_otp_challenge_v1(uuid, text, uuid, text) restrict;
drop function if exists public.process_signup_otp_challenge_v1(text, uuid, text, text, boolean) restrict;
drop function if exists public.validate_signup_verification_proof_v1(text, text) restrict;
drop function if exists public.complete_fc_signup_atomic_v1(
  uuid, text, text, text, text, text, text, text, text, text[], uuid, uuid, text
) restrict;

-- Migration: unified common insurance enrollment (20261014043557).
-- One common login, with explicit insurance registration as a separate operation.
-- Import attestations are not fabricated user acceptance dates. Historical
-- anonymized withdrawals must be resolved before an automatic import is safe.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$ begin
  if exists(select from public.platform_members where not active and phone is null
    and fc_id is null and staff_account_id is null) then
    raise exception 'platform_withdrawal_provenance_required';
  end if;
end $$;

alter table public.platform_members
  add column terms_basis text check (terms_basis in ('user_acceptance','company_attested_import')),
  add column terms_recorded_at timestamptz,
  add column insurance_consent_version text,
  add column insurance_consent_source text check (insurance_consent_source in ('user_acceptance','company_attested_import')),
  add column insurance_consent_recorded_at timestamptz,
  add column insurance_enrollment_key uuid,
  add column insurance_enrollment_fingerprint text,
  add column insurance_enrollment_member_version bigint,
  add column insurance_enrollment_fc_version bigint,
  add column withdrawal_source_kind text check (withdrawal_source_kind in ('member','fc','admin','manager')),
  add column withdrawal_source_id uuid;

-- Existing genuine acceptance dates stay exactly as recorded.
update public.platform_members set terms_basis='user_acceptance',terms_recorded_at=terms_accepted_at
where terms_accepted_at is not null;

alter table public.fc_profiles drop constraint if exists fc_profiles_signup_verification_method_check;
alter table public.fc_profiles add constraint fc_profiles_signup_verification_method_check
  check (signup_verification_method is null or signup_verification_method in
    ('phone_otp','admin_written_consent','platform_member_session'));

-- Freeze the company-attested cohort at migration application. Source UUIDs,
-- rather than creation dates, prevent an old incomplete draft completed later
-- from acquiring the company's historical attestation.
create table public.platform_legacy_membership_cohort (
  account_kind text not null check (account_kind in ('fc','admin','manager')),
  account_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  created_member_id uuid references public.platform_members(id) on delete restrict,
  primary key(account_kind,account_id)
);
alter table public.platform_legacy_membership_cohort enable row level security;
revoke all on public.platform_legacy_membership_cohort from public,anon,authenticated;
grant select on public.platform_legacy_membership_cohort to service_role;

insert into platform_legacy_membership_cohort(account_kind,account_id)
  select 'admin',id from admin_accounts where active and phone ~ '^[0-9]{11}$' and length(trim(name)) between 1 and 80
  union all select 'manager',id from manager_accounts where active and phone ~ '^[0-9]{11}$' and length(trim(name)) between 1 and 80
  union all select 'fc',f.id from fc_profiles f where f.signup_completed and not coalesce(f.is_manager_referral_shadow,false)
    and f.phone ~ '^[0-9]{11}$' and length(trim(f.name)) between 1 and 80
    and not exists(select from admin_accounts a where regexp_replace(a.phone,'[^0-9]','','g')=f.phone)
    and not exists(select from manager_accounts a where regexp_replace(a.phone,'[^0-9]','','g')=f.phone);

-- Create every new source member before resolving any referral. This includes
-- completed FCs awaiting initial password recovery, without granting a session.
with sources as (
  select c.account_kind,c.account_id,c.recorded_at,f.phone,f.name from platform_legacy_membership_cohort c
    join fc_profiles f on c.account_kind='fc' and c.account_id=f.id
  union all select c.account_kind,c.account_id,c.recorded_at,a.phone,a.name from platform_legacy_membership_cohort c
    join admin_accounts a on c.account_kind='admin' and c.account_id=a.id
  union all select c.account_kind,c.account_id,c.recorded_at,a.phone,a.name from platform_legacy_membership_cohort c
    join manager_accounts a on c.account_kind='manager' and c.account_id=a.id
), inserted as (
  insert into platform_members(phone,name,fc_id,staff_account_kind,staff_account_id,terms_version,terms_basis,terms_recorded_at,
    insurance_consent_version,insurance_consent_source,insurance_consent_recorded_at)
  select phone,name,case when account_kind='fc' then account_id end,
    case when account_kind<>'fc' then account_kind end,case when account_kind<>'fc' then account_id end,
    '2026-10-12','company_attested_import',recorded_at,'insurance-additional-info-v1','company_attested_import',recorded_at
    from sources order by account_kind,account_id on conflict(phone) do nothing
  returning id,fc_id,staff_account_kind,staff_account_id
)
update platform_legacy_membership_cohort c set created_member_id=i.id from inserted i
  where (c.account_kind='fc' and c.account_id=i.fc_id)
    or (c.account_kind=i.staff_account_kind and c.account_id=i.staff_account_id);

-- Preserve actual acceptance dates and any genuine chosen common referrer,
-- including NULL, on preexisting rows. Record the imported purpose separately.
update platform_members m set terms_version='2026-10-12',
  terms_basis=case when m.terms_version='2026-10-12' and m.terms_accepted_at is not null then 'user_acceptance' else 'company_attested_import' end,
  terms_recorded_at=coalesce(m.terms_recorded_at,c.recorded_at),
  insurance_consent_version=coalesce(m.insurance_consent_version,'insurance-additional-info-v1'),
  insurance_consent_source=coalesce(m.insurance_consent_source,'company_attested_import'),
  insurance_consent_recorded_at=coalesce(m.insurance_consent_recorded_at,c.recorded_at)
from platform_legacy_membership_cohort c where m.active and
  ((c.account_kind='fc' and c.account_id=m.fc_id) or (c.account_kind=m.staff_account_kind and c.account_id=m.staff_account_id));

update platform_members m set referrer_id=inviter.id
from platform_legacy_membership_cohort c join fc_profiles f on c.account_kind='fc' and c.account_id=f.id
  join fc_profiles recruiter on recruiter.id=f.recommender_fc_id
  join platform_members inviter on inviter.active and
    ((not coalesce(recruiter.is_manager_referral_shadow,false) and inviter.fc_id=recruiter.id)
      or (recruiter.is_manager_referral_shadow and inviter.staff_account_kind='manager' and exists(
        select from manager_accounts manager where manager.active and manager.id=inviter.staff_account_id
          and regexp_replace(manager.phone,'[^0-9]','','g')=recruiter.phone)))
where m.id=c.created_member_id and m.referrer_id is null and inviter.id<>m.id;

create or replace function public.import_platform_legacy_member_v1(
  p_phone text,p_account_kind text,p_account_id uuid
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; source_name text; source_fc uuid; cohort platform_legacy_membership_cohort;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$' or p_account_id is null
    or p_account_kind is null or p_account_kind not in ('fc','admin','manager') then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  if exists(select from platform_members where not active and
    ((withdrawal_source_kind=p_account_kind and withdrawal_source_id=p_account_id)
      or (withdrawal_source_kind is null and phone is null and fc_id is null and staff_account_id is null))) then
    return jsonb_build_object('ok',false,'code','common_membership_withdrawn'); end if;
  select * into cohort from platform_legacy_membership_cohort where account_kind=p_account_kind and account_id=p_account_id;
  if not found then return jsonb_build_object('ok',false,'code','company_attestation_unavailable'); end if;
  if p_account_kind='fc' then
    select f.name,f.id into source_name,source_fc from fc_profiles f where f.id=p_account_id and f.phone=p_phone
      and f.signup_completed and not coalesce(f.is_manager_referral_shadow,false) for update;
    if source_fc is null or exists(select from admin_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone)
      or exists(select from manager_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone) then raise exception 'forbidden'; end if;
  elsif p_account_kind='admin' then
    select name into source_name from admin_accounts where id=p_account_id and phone=p_phone and active for update;
  else
    select name into source_name from manager_accounts where id=p_account_id and phone=p_phone and active for update;
  end if;
  if nullif(trim(source_name),'') is null then raise exception 'forbidden'; end if;
  select * into m from platform_members where phone=p_phone for update;
  if found then
    if not m.active or (m.fc_id is not null and m.fc_id is distinct from source_fc)
      or (m.staff_account_id is not null and (m.staff_account_kind is distinct from p_account_kind
        or m.staff_account_id is distinct from p_account_id)) then raise exception 'forbidden'; end if;
    update platform_members set name=source_name,fc_id=source_fc,
      staff_account_kind=case when source_fc is null then p_account_kind end,
      staff_account_id=case when source_fc is null then p_account_id end,
      terms_version='2026-10-12',terms_basis=case when terms_version='2026-10-12' and terms_accepted_at is not null
        then 'user_acceptance' else 'company_attested_import' end,
      terms_recorded_at=coalesce(terms_recorded_at,terms_accepted_at,cohort.recorded_at),
      insurance_consent_version=coalesce(insurance_consent_version,'insurance-additional-info-v1'),
      insurance_consent_source=coalesce(insurance_consent_source,'company_attested_import'),
      insurance_consent_recorded_at=coalesce(insurance_consent_recorded_at,cohort.recorded_at) where id=m.id;
  else
    -- A deleted or erased cohort source must never be silently recreated.
    return jsonb_build_object('ok',false,'code','common_membership_unavailable');
  end if;
  delete from platform_member_credentials where member_id=m.id;
  return jsonb_build_object('ok',true,'memberId',m.id);
end $$;
revoke all on function public.import_platform_legacy_member_v1(text,text,uuid) from public,anon,authenticated;
grant execute on function public.import_platform_legacy_member_v1(text,text,uuid) to service_role;

create or replace function public.delete_platform_member(p_member_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members;
begin
  select * into m from platform_members where id=p_member_id for update;
  if not found then raise exception 'member_unavailable'; end if;
  delete from platform_member_credentials where member_id=m.id;
  delete from platform_signup_challenges where phone=m.phone or consumed_member_id=m.id;
  update platform_service_applications set details='{"region":"삭제","requestType":"삭제"}'::jsonb,
    status=case when status='interest' then 'cancelled' else status end where member_id=m.id;
  -- Erase live source bindings and direct identifying fields. Restricted source
  -- tombstones/cohort associations remain solely as no-auto-import/audit evidence.
  update platform_members set phone=null,name='탈퇴 회원',active=false,fc_id=null,
    staff_account_kind=null,staff_account_id=null,terms_accepted_at=null,terms_version=null,
    terms_basis=null,terms_recorded_at=null,insurance_consent_version=null,
    insurance_consent_source=null,insurance_consent_recorded_at=null,
    insurance_enrollment_key=null,insurance_enrollment_fingerprint=null,
    insurance_enrollment_member_version=null,insurance_enrollment_fc_version=null,
    withdrawal_source_kind=coalesce(withdrawal_source_kind,case when m.fc_id is not null then 'fc'
      when m.staff_account_id is not null then m.staff_account_kind else 'member' end),
    withdrawal_source_id=coalesce(withdrawal_source_id,m.fc_id,m.staff_account_id,m.id)
    where id=m.id;
  return jsonb_build_object('ok',true,'deleted',true);
end $$;

-- Keep the old explicit-consent RPC for old app installations. Fresh verified
-- user acceptance may create a new UUID after withdrawal. It never reactivates
-- the old row or clears its withdrawal/settlement/referral evidence. Automatic
-- company import remains blocked by the original-source withdrawal tombstone.
create or replace function public.enroll_platform_legacy_member(
  p_phone text,p_name text,p_fc_id uuid,p_terms_version text,p_account_kind text default null,p_account_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; inviter uuid;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$' or p_name is null or length(trim(p_name)) not between 1 and 80
    or p_terms_version is distinct from '2026-10-12' then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  if p_fc_id is not null then
    if (p_account_kind is not null and p_account_kind<>'fc') or (p_account_id is not null and p_account_id<>p_fc_id)
      then raise exception 'forbidden'; end if;
    perform from fc_profiles where id=p_fc_id and phone=p_phone and signup_completed and not coalesce(is_manager_referral_shadow,false) for update;
    if not found then raise exception 'forbidden'; end if;
    select r.id into inviter from fc_profiles f join platform_members r on r.fc_id=f.recommender_fc_id
      where f.id=p_fc_id and r.active and r.terms_accepted_at is not null;
  elsif p_account_kind='admin' then
    perform from admin_accounts where id=p_account_id and phone=p_phone and active for update;
    if not found then raise exception 'forbidden'; end if;
  elsif p_account_kind='manager' then
    perform from manager_accounts where id=p_account_id and phone=p_phone and active for update;
    if not found then raise exception 'forbidden'; end if;
  else raise exception 'forbidden'; end if;
  insert into platform_members(phone,name,fc_id,referrer_id,terms_accepted_at,terms_version,staff_account_kind,staff_account_id)
    values(p_phone,trim(p_name),p_fc_id,inviter,clock_timestamp(),p_terms_version,
      case when p_fc_id is null then p_account_kind end,case when p_fc_id is null then p_account_id end)
    on conflict(phone) do nothing;
  select * into m from platform_members where phone=p_phone for update;
  if not m.active or (m.fc_id is not null and m.fc_id is distinct from p_fc_id)
    or (m.staff_account_id is not null and (m.staff_account_kind is distinct from p_account_kind
      or m.staff_account_id is distinct from p_account_id)) then raise exception 'forbidden'; end if;
  -- Explicit consent may follow a verified FC/staff role transition on the
  -- same phone. Keep the shared graph UUID, bind only the locked source above,
  -- and invalidate tokens backed by the previous canonical source.
  update platform_members set terms_accepted_at=coalesce(terms_accepted_at,clock_timestamp()),
    terms_version=p_terms_version,terms_basis='user_acceptance',terms_recorded_at=clock_timestamp(),name=trim(p_name),fc_id=p_fc_id,
    staff_account_kind=case when p_fc_id is null then p_account_kind end,
    staff_account_id=case when p_fc_id is null then p_account_id end where id=m.id;
  delete from platform_member_credentials where member_id=m.id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.validate_platform_insurance_referral_v1(p_phone text,p_code text)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare inviter fc_profiles; code_row referral_codes;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$' or length(trim(coalesce(p_code,''))) not between 1 and 64 then
    return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  select * into code_row from referral_codes where code=upper(trim(p_code)) and is_active;
  if not found then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  select * into inviter from fc_profiles where id=code_row.fc_id;
  if not found or inviter.phone=p_phone or position('설계매니저' in coalesce(inviter.affiliation,''))>0
    or not ((inviter.signup_completed and not coalesce(inviter.is_manager_referral_shadow,false))
      or (inviter.is_manager_referral_shadow and exists(
      select from manager_accounts a where a.active and regexp_replace(a.phone,'[^0-9]','','g')=inviter.phone))) then
    return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  return jsonb_build_object('ok',true,'inviterFcId',inviter.id,'inviterName',inviter.name,
    'inviterAffiliation',inviter.affiliation,'referralCode',code_row.code);
end $$;
revoke all on function public.validate_platform_insurance_referral_v1(text,text) from public,anon,authenticated;
grant execute on function public.validate_platform_insurance_referral_v1(text,text) to service_role;

create or replace function public.enroll_platform_insurance_v1(
  p_member_id uuid,p_phone text,p_member_session_version bigint,p_idempotency_key uuid,p_request_fingerprint text,
  p_consent_version text,p_affiliation text,p_email text,p_carrier text,p_license_statuses text[],
  p_referral_code text,p_referral_inviter_fc_id uuid
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; c platform_member_credentials; f fc_profiles; v bigint;
  referral jsonb; code_row referral_codes; checked_at timestamptz; normalized_statuses text[];
begin
  if p_member_id is null or p_phone is null or p_phone !~ '^[0-9]{11}$'
    or p_member_session_version is null or p_member_session_version<0 or p_idempotency_key is null
    or coalesce(p_request_fingerprint,'') !~ '^[a-f0-9]{64}$' then raise exception 'invalid_input'; end if;
  -- Shared phone locks serialize common signup, old FC signup and conversion.
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  perform pg_advisory_xact_lock(hashtextextended(p_phone,8102026));
  select * into m from platform_members where id=p_member_id and phone=p_phone for update;
  if not found or not m.active or m.staff_account_id is not null then raise exception 'forbidden'; end if;
  if m.fc_id is not null then
    select * into f from fc_profiles where id=m.fc_id and phone=p_phone for update;
    select session_version into v from fc_credentials where fc_id=m.fc_id and password_set_at is not null
      and not coalesce(must_change_password,false) for update;
    if f.id is null or not f.signup_completed or coalesce(f.is_manager_referral_shadow,false)
      or m.insurance_enrollment_key is distinct from p_idempotency_key
      or m.insurance_enrollment_fingerprint is distinct from p_request_fingerprint
      or m.insurance_enrollment_member_version is distinct from p_member_session_version
      or v is null or v is distinct from m.insurance_enrollment_fc_version then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('ok',true,'fcId',f.id,'sessionVersion',v,'alreadyApplied',true);
  end if;
  select * into c from platform_member_credentials where member_id=m.id for update;
  if not found or c.session_version is distinct from p_member_session_version then raise exception 'forbidden'; end if;
  if m.terms_version is distinct from '2026-10-12' or m.terms_accepted_at is null then raise exception 'consent_required'; end if;
  select array_agg(distinct trim(s)) into normalized_statuses from unnest(p_license_statuses) s;
  if p_consent_version is distinct from 'insurance-additional-info-v1'
    or length(trim(coalesce(p_affiliation,''))) not between 1 and 120
    or position('설계매니저' in coalesce(p_affiliation,''))>0
    or length(trim(coalesce(p_email,''))) not between 3 and 254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_carrier is null or p_carrier not in ('SKT','KT','LGU+','SKT 알뜰폰','KT 알뜰폰','LGU+ 알뜰폰')
    or coalesce(cardinality(normalized_statuses),0)=0
    or exists(select from unnest(normalized_statuses) s where s is null or s not in ('third','life','nonlife','none'))
    or ('none'=any(normalized_statuses) and cardinality(normalized_statuses)>1) then raise exception 'invalid_input'; end if;
  if exists(select from admin_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone)
    or exists(select from manager_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone) then raise exception 'forbidden'; end if;
  select * into f from fc_profiles where phone=p_phone for update;
  if found and (f.signup_completed or coalesce(f.is_manager_referral_shadow,false)
    or coalesce(f.status,'draft')<>'draft' or f.identity_completed or f.temp_id is not null
    or exists(select from fc_credentials where fc_id=f.id and password_set_at is not null)
    or exists(select from fc_identity_secure where fc_id=f.id)
    or exists(select from fc_documents where fc_id=f.id)) then raise exception 'forbidden'; end if;
  referral:=validate_platform_insurance_referral_v1(p_phone,p_referral_code);
  if coalesce((referral->>'ok')::boolean,false) is not true
    or (referral->>'inviterFcId')::uuid is distinct from p_referral_inviter_fc_id then raise exception 'invalid_referral'; end if;
  perform from fc_profiles where id=p_referral_inviter_fc_id for update;
  select * into code_row from referral_codes where code=upper(trim(p_referral_code))
    and fc_id=p_referral_inviter_fc_id and is_active for update;
  if not found then raise exception 'invalid_referral'; end if;
  checked_at:=clock_timestamp();
  if f.id is null then
    insert into fc_profiles(name,phone,affiliation,status,signup_completed)
      values(m.name,p_phone,trim(p_affiliation),'draft',false) returning * into f;
  end if;
  referral:=apply_referral_link_state(p_invitee_fc_id=>f.id,p_inviter_fc_id=>p_referral_inviter_fc_id,
    p_referral_code_id=>code_row.id,p_referral_code=>code_row.code,p_source=>'signup',
    p_actor_phone=>p_phone,p_actor_role=>'system',p_actor_staff_type=>null,p_reason=>'common_member_insurance_registration');
  if coalesce((referral->>'ok')::boolean,false) is not true then raise exception 'invalid_referral'; end if;
  insert into fc_credentials(fc_id,password_hash,password_salt,password_set_at,session_version,
    failed_count,locked_until,must_change_password,created_at,updated_at)
    values(f.id,c.password_hash,c.password_salt,c.password_set_at,c.session_version,
      c.failed_count,c.locked_until,false,checked_at,checked_at)
    on conflict(fc_id) do update set password_hash=excluded.password_hash,password_salt=excluded.password_salt,
      password_set_at=excluded.password_set_at,failed_count=excluded.failed_count,locked_until=excluded.locked_until,
      must_change_password=false,reset_token_hash=null,reset_token_expires_at=null,reset_sent_at=null,
      reset_failed_count=0,updated_at=excluded.updated_at returning session_version into v;
  update platform_members set fc_id=f.id,insurance_consent_version=p_consent_version,
    insurance_consent_source='user_acceptance',insurance_consent_recorded_at=checked_at,
    insurance_enrollment_key=p_idempotency_key,insurance_enrollment_fingerprint=p_request_fingerprint,
    insurance_enrollment_member_version=p_member_session_version,insurance_enrollment_fc_version=v where id=m.id;
  update fc_profiles set name=m.name,affiliation=trim(p_affiliation),email=lower(trim(p_email)),carrier=p_carrier,
    license_statuses=normalized_statuses,status='draft',life_commission_completed=false,nonlife_commission_completed=false,
    signup_completed=true,signup_verification_method='platform_member_session',signup_verified_at=checked_at,
    signup_verified_by_admin_id=null,phone_verification_hash=null,phone_verification_expires_at=null,updated_at=checked_at
    where id=f.id;
  -- Projection removes the common credential only after its compatible hash
  -- and salt have committed to the canonical FC account in this transaction.
  delete from platform_member_credentials where member_id=m.id;
  return jsonb_build_object('ok',true,'fcId',f.id,'sessionVersion',v,'alreadyApplied',false);
end $$;
revoke all on function public.enroll_platform_insurance_v1(uuid,text,bigint,uuid,text,text,text,text,text,text[],text,uuid)
  from public,anon,authenticated;
grant execute on function public.enroll_platform_insurance_v1(uuid,text,bigint,uuid,text,text,text,text,text,text[],text,uuid) to service_role;

create or replace function public.process_password_reset_challenge(
  p_action text,
  p_account_kind text,
  p_account_id uuid,
  p_phone text,
  p_token_hash text,
  p_password_hash text default null,
  p_password_salt text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  account_table text;
  account_key text;
  account_row jsonb;
  profile_row public.fc_profiles%rowtype;
  member_row public.platform_members%rowtype;
  checked_at timestamptz;
  failed_attempts integer;
begin
  if coalesce(p_action, '') not in ('issue', 'consume')
    or p_account_id is null
    or coalesce(p_phone, '') !~ '^[0-9]{11}$'
    or coalesce(p_token_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
    or (p_action = 'consume' and (
      coalesce(p_password_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
      or coalesce(p_password_salt, '') !~ '^[A-Za-z0-9+/]{22}==$'
    )) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  case p_account_kind
    when 'admin' then account_table := 'admin_accounts'; account_key := 'id';
    when 'manager' then account_table := 'manager_accounts'; account_key := 'id';
    when 'fc' then account_table := 'fc_credentials'; account_key := 'fc_id';
    when 'member' then account_table := 'platform_member_credentials'; account_key := 'member_id';
    else return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end case;

  -- Match existing FC lifecycle lock order: profile, then credentials. This
  -- also prevents completion/phone changes while a challenge is processed.
  if p_account_kind = 'fc' then
    select * into profile_row from public.fc_profiles
    where id = p_account_id for update;
    if not found or profile_row.phone is distinct from p_phone
      or profile_row.signup_completed is distinct from true
      or coalesce(profile_row.is_manager_referral_shadow,false) then
      return jsonb_build_object('ok', false, 'code', 'account_unavailable');
    end if;
  end if;

  if p_account_kind = 'member' then
    select * into member_row from public.platform_members where id=p_account_id for update;
    if not found or member_row.phone is distinct from p_phone or not member_row.active or member_row.fc_id is not null then
      return jsonb_build_object('ok',false,'code','account_unavailable');
    end if;
  end if;

  execute format(
    'select to_jsonb(a) from public.%I a where %I = $1 for update',
    account_table, account_key
  ) into account_row using p_account_id;
  -- A completed ordinary FC may set its missing initial password through
  -- the existing bounded reset proof. The placeholder itself cannot log in.
  if p_account_kind='fc' and (account_row is null or account_row->>'password_set_at' is null) then
    if position('설계매니저' in coalesce(profile_row.affiliation,''))>0
      or exists(select from public.admin_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone)
      or exists(select from public.manager_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone) then
      return jsonb_build_object('ok',false,'code','account_unavailable'); end if;
    if account_row is null and p_action='issue' then
      insert into public.fc_credentials(fc_id,password_hash,password_salt,password_set_at)
        values(p_account_id,'','',null) on conflict(fc_id) do nothing;
      select to_jsonb(c) into account_row from public.fc_credentials c where fc_id=p_account_id for update;
    end if;
  end if;
  if account_row is null
    or (p_account_kind<>'fc' and account_row->>'password_set_at' is null)
    or (p_account_kind not in ('fc','member') and (
      account_row->>'phone' is distinct from p_phone
      or account_row->>'active' = 'false'
    )) then
    return jsonb_build_object('ok', false, 'code', 'account_unavailable');
  end if;

  -- Evaluate expiry/cooldown after any lock wait, not at transaction start.
  checked_at := clock_timestamp();
  if p_action = 'issue' then
    if (account_row->>'reset_sent_at')::timestamptz > checked_at - interval '60 seconds' then
      return jsonb_build_object('ok', false, 'code', 'cooldown');
    end if;
    execute format(
      'update public.%I set reset_token_hash = $2,
       reset_token_expires_at = $3::timestamptz + interval ''15 minutes'',
       reset_sent_at = $3, reset_failed_count = 0, updated_at = $3
       where %I = $1', account_table, account_key
    ) using p_account_id, p_token_hash, checked_at;
    return jsonb_build_object('ok', true);
  end if;

  failed_attempts := (account_row->>'reset_failed_count')::integer;
  if failed_attempts >= 5 then
    return jsonb_build_object('ok', false, 'code', 'attempts_exhausted');
  end if;
  if account_row->>'reset_token_hash' is null
    or account_row->>'reset_token_expires_at' is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if (account_row->>'reset_token_expires_at')::timestamptz <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'expired_token');
  end if;
  if account_row->>'reset_token_hash' is distinct from p_token_hash then
    failed_attempts := failed_attempts + 1;
    execute format(
      'update public.%I set reset_failed_count = $2, updated_at = $3 where %I = $1',
      account_table, account_key
    ) using p_account_id, failed_attempts, checked_at;
    -- Return, do not raise: a raised exception would roll back the counter.
    return jsonb_build_object('ok', false, 'code',
      case when failed_attempts >= 5 then 'attempts_exhausted' else 'invalid_token' end);
  end if;

  execute format(
    'update public.%I set password_hash = $2, password_salt = $3,
     password_set_at = $4, failed_count = 0, locked_until = null,
     reset_token_hash = null, reset_token_expires_at = null,
     reset_failed_count = 0, updated_at = $4%s where %I = $1',
    account_table,
    case when p_account_kind = 'fc' then
      ', must_change_password = false, temporary_password_issued_at = null'
      else '' end,
    account_key
  ) using p_account_id, p_password_hash, p_password_salt, checked_at;
  -- Preserve reset_sent_at so success cannot bypass the issuance cooldown.
  return jsonb_build_object('ok', true);
end;
$$;

-- Common referral signup accepts attested imports without inventing a user
-- Old installations retain their OTP signup protocol for nonmembers. Once
-- common signup wins the shared phone lock, the old protocol cannot replace
-- that canonical credential or bypass explicit service registration.
create or replace function public.issue_fc_signup_otp_v1(
  p_phone text,
  p_code_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  profile_row public.fc_profiles%rowtype;
  credential_row public.fc_credentials%rowtype;
  profile_exists boolean := false;
  credential_exists boolean := false;
  should_reset boolean := false;
  checked_at timestamptz;
  delivery_id uuid;
  auth_profile_ids jsonb := '[]'::jsonb;
begin
  if normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_code_hash, '') !~ '^[A-Za-z0-9+/]{43}=$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- verify_fc_signup_otp_v1 and complete_fc_otp_signup_v1 use this exact
  -- namespace. Issuance must participate in the same per-phone lifecycle.
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));
  if exists(select from public.platform_members where phone=normalized_phone and active) then
    return jsonb_build_object('ok',false,'code','already_exists'); end if;


  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;
  profile_exists := found;

  if profile_exists then
    select credential.*
      into credential_row
    from public.fc_credentials credential
    where credential.fc_id = profile_row.id
    for update;
    credential_exists := found;

    if profile_row.is_manager_referral_shadow is true
      or (
        profile_row.signup_completed is true
        and credential_exists
        and credential_row.password_set_at is not null
      ) then
      return jsonb_build_object('ok', false, 'code', 'already_exists');
    end if;
  end if;

  perform 1
  from public.admin_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.manager_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  -- Evaluate lock and cooldown after every lock wait, never from an Edge
  -- timestamp captured before the critical section.
  checked_at := clock_timestamp();

  if profile_exists
    and profile_row.phone_verification_locked_until is not null
    and profile_row.phone_verification_locked_until > checked_at then
    return jsonb_build_object('ok', false, 'code', 'locked');
  end if;

  if profile_exists
    and profile_row.phone_verification_sent_at is not null
    and profile_row.phone_verification_sent_at > checked_at - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'code', 'cooldown');
  end if;

  insert into public.platform_sms_delivery_attempts(purpose)
    values('fc_signup')
    returning id into delivery_id;

  if not profile_exists then
    insert into public.fc_profiles (
      phone,
      name,
      affiliation,
      recommender,
      recommender_fc_id,
      recommender_code_id,
      recommender_code,
      recommender_linked_at,
      recommender_link_source,
      email,
      address,
      status,
      identity_completed,
      signup_completed,
      phone_verified,
      phone_verified_at,
      phone_verification_hash,
      phone_verification_expires_at,
      phone_verification_sent_at,
      phone_verification_attempts,
      phone_verification_locked_until,
      phone_verification_delivery_id,
      signup_verification_method,
      signup_verified_at,
      signup_verified_by_admin_id,
      updated_at
    ) values (
      normalized_phone,
      '',
      '',
      '',
      null,
      null,
      null,
      null,
      null,
      '',
      '',
      'draft',
      false,
      false,
      false,
      null,
      p_code_hash,
      checked_at + interval '5 minutes',
      checked_at,
      0,
      null,
      delivery_id,
      null,
      null,
      null,
      checked_at
    )
    returning * into profile_row;
  else
    should_reset := profile_row.phone_verified is true
      or profile_row.signup_completed is true
      or profile_row.status is distinct from 'draft'
      or profile_row.identity_completed is true
      or credential_exists
      or exists (
        select 1 from public.profiles auth_profile
        where auth_profile.fc_id = profile_row.id
      );

    if should_reset then
      delete from public.fc_identity_secure secure
      where secure.fc_id = profile_row.id;

      delete from public.fc_credentials credential
      where credential.fc_id = profile_row.id;

      with deleted_auth_profile as (
        delete from public.profiles auth_profile
        where auth_profile.fc_id = profile_row.id
        returning auth_profile.id
      )
      select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
        into auth_profile_ids
      from deleted_auth_profile;

      update public.fc_profiles
      set phone_verification_hash = p_code_hash,
          phone_verification_expires_at = checked_at + interval '5 minutes',
          phone_verification_sent_at = checked_at,
          phone_verification_attempts = 0,
          phone_verification_locked_until = null,
          phone_verification_delivery_id = delivery_id,
          name = '',
          affiliation = '',
          recommender = '',
          recommender_fc_id = null,
          recommender_code_id = null,
          recommender_code = null,
          recommender_linked_at = null,
          recommender_link_source = null,
          email = '',
          address = '',
          address_detail = null,
          resident_id_masked = null,
          resident_id_hash = null,
          identity_completed = false,
          status = 'draft',
          life_commission_completed = false,
          nonlife_commission_completed = false,
          temp_id = null,
          allowance_date = null,
          allowance_prescreen_requested_at = null,
          allowance_reject_reason = null,
          appointment_url = null,
          appointment_date = null,
          appointment_schedule_life = null,
          appointment_schedule_nonlife = null,
          appointment_date_life = null,
          appointment_date_nonlife = null,
          appointment_date_life_sub = null,
          appointment_date_nonlife_sub = null,
          appointment_reject_reason_life = null,
          appointment_reject_reason_nonlife = null,
          docs_deadline_at = null,
          docs_deadline_last_notified_at = null,
          hanwha_commission_date_sub = null,
          hanwha_commission_date = null,
          hanwha_commission_reject_reason = null,
          hanwha_commission_pdf_path = null,
          hanwha_commission_pdf_name = null,
          dawichok_url_sent_at = null,
          dawichok_url_sent_by = null,
          signup_completed = false,
          phone_verified = false,
          phone_verified_at = null,
          signup_verification_method = null,
          signup_verified_at = null,
          signup_verified_by_admin_id = null,
          updated_at = checked_at
      where id = profile_row.id;
    else
      update public.fc_profiles
      set phone_verification_hash = p_code_hash,
          phone_verification_expires_at = checked_at + interval '5 minutes',
          phone_verification_sent_at = checked_at,
          phone_verification_attempts = 0,
          phone_verification_locked_until = null,
          phone_verification_delivery_id = delivery_id,
          updated_at = checked_at
      where id = profile_row.id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'deliveryId', delivery_id,
    'authProfileIds', auth_profile_ids,
    'resetApplied', should_reset
  );
end;
$$;

create or replace function public.complete_fc_otp_signup_v1(
  p_phone text,
  p_completion_token_hash text,
  p_request_fingerprint text,
  p_name text,
  p_affiliation text,
  p_email text,
  p_carrier text,
  p_license_statuses text[],
  p_referral_code text,
  p_referral_inviter_fc_id uuid,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  profile_row public.fc_profiles%rowtype;
  credential_row public.fc_credentials%rowtype;
  proof_row public.fc_signup_completion_challenges%rowtype;
  inviter_row public.fc_profiles%rowtype;
  referral_code_row public.referral_codes%rowtype;
  referral_result jsonb;
  stored_result jsonb;
  credential_session_version bigint;
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_affiliation text := trim(coalesce(p_affiliation, ''));
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_carrier text := trim(coalesce(p_carrier, ''));
  normalized_referral_code text := upper(trim(coalesce(p_referral_code, '')));
  normalized_license_statuses text[];
  checked_at timestamptz;
  next_status text;
  next_life_completed boolean;
  next_nonlife_completed boolean;
begin
  select coalesce(array_agg(distinct status_value order by status_value), array[]::text[])
    into normalized_license_statuses
  from unnest(coalesce(p_license_statuses, array[]::text[])) status_value;

  if normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_completion_token_hash, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
    or char_length(normalized_name) not between 2 and 40
    or char_length(normalized_affiliation) not between 2 and 80
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or normalized_carrier not in (
      'SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰'
    )
    or cardinality(normalized_license_statuses) = 0
    or exists (
      select 1
      from unnest(normalized_license_statuses) status_value
      where status_value is null
        or status_value not in ('third', 'life', 'nonlife', 'none')
    )
    or (
      'none' = any(normalized_license_statuses)
      and cardinality(normalized_license_statuses) > 1
    )
    or normalized_referral_code = ''
    or char_length(normalized_referral_code) > 64
    or p_referral_inviter_fc_id is null
    or coalesce(p_password_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
    or coalesce(p_password_salt, '') !~ '^[A-Za-z0-9+/]{22}==$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));
  if exists(select from public.platform_members where phone=normalized_phone and active and fc_id is null and staff_account_id is null) then
    return jsonb_build_object('ok',false,'code','already_exists'); end if;


  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select challenge.*
    into proof_row
  from public.fc_signup_completion_challenges challenge
  where challenge.fc_id = profile_row.id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'proof_required');
  end if;

  checked_at := clock_timestamp();

  if proof_row.token_hash is distinct from p_completion_token_hash then
    return jsonb_build_object('ok', false, 'code', 'proof_invalid');
  end if;

  if proof_row.expires_at <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'proof_expired');
  end if;

  if proof_row.consumed_at is not null then
    if proof_row.request_fingerprint is not distinct from p_request_fingerprint
      and proof_row.result is not null then
      return jsonb_set(proof_row.result, '{alreadyApplied}', 'true'::jsonb, true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'request_conflict');
  end if;

  -- phone_verified without the matching, live proof above is never authority.
  if profile_row.phone_verified is distinct from true
    or profile_row.signup_verification_method is distinct from 'phone_otp'
    or profile_row.phone_verified_at is null
    or profile_row.signup_verified_at is null then
    return jsonb_build_object('ok', false, 'code', 'proof_required');
  end if;

  if profile_row.signup_completed is true
    or profile_row.is_manager_referral_shadow is true then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.admin_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.manager_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  select credential.*
    into credential_row
  from public.fc_credentials credential
  where credential.fc_id = profile_row.id
  for update;

  if found and credential_row.password_set_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  if p_referral_inviter_fc_id = profile_row.id then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  select inviter.*
    into inviter_row
  from public.fc_profiles inviter
  where inviter.id = p_referral_inviter_fc_id
  for update;

  if not found
    or (
      inviter_row.signup_completed is distinct from true
      and inviter_row.is_manager_referral_shadow is distinct from true
    ) then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  select referral_code.*
    into referral_code_row
  from public.referral_codes referral_code
  where referral_code.code = normalized_referral_code
    and referral_code.fc_id = p_referral_inviter_fc_id
    and referral_code.is_active is true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  -- Keep the current onboarding gate: license selections do not bypass the
  -- workflow. The database, rather than the client, derives all three fields.
  next_status := 'draft';
  next_life_completed := false;
  next_nonlife_completed := false;

  -- apply_referral_link_state is authoritative for inviter eligibility and
  -- graph invariants. Its writes run in a subtransaction so a failure cannot
  -- leave a partial referral mutation or consume the completion proof.
  begin
    referral_result := public.apply_referral_link_state(
      p_invitee_fc_id => profile_row.id,
      p_inviter_fc_id => p_referral_inviter_fc_id,
      p_referral_code_id => referral_code_row.id,
      p_referral_code => referral_code_row.code,
      p_source => 'signup',
      p_actor_phone => normalized_phone,
      p_actor_role => 'system',
      p_actor_staff_type => null,
      p_reason => 'complete_fc_otp_signup_v1'
    );

    if coalesce((referral_result ->> 'ok')::boolean, false) is not true then
      raise exception 'fc_signup_referral_failed';
    end if;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end;

  update public.fc_profiles
  set name = normalized_name,
      affiliation = normalized_affiliation,
      email = normalized_email,
      carrier = normalized_carrier,
      license_statuses = normalized_license_statuses,
      status = next_status,
      life_commission_completed = next_life_completed,
      nonlife_commission_completed = next_nonlife_completed,
      address = '',
      address_detail = null,
      resident_id_masked = null,
      resident_id_hash = null,
      identity_completed = false,
      temp_id = null,
      allowance_date = null,
      allowance_prescreen_requested_at = null,
      allowance_reject_reason = null,
      docs_deadline_at = null,
      docs_deadline_last_notified_at = null,
      appointment_url = null,
      appointment_date = null,
      appointment_schedule_life = null,
      appointment_schedule_nonlife = null,
      appointment_date_life = null,
      appointment_date_nonlife = null,
      appointment_date_life_sub = null,
      appointment_date_nonlife_sub = null,
      appointment_reject_reason_life = null,
      appointment_reject_reason_nonlife = null,
      hanwha_commission_date_sub = null,
      hanwha_commission_date = null,
      hanwha_commission_reject_reason = null,
      hanwha_commission_pdf_path = null,
      hanwha_commission_pdf_name = null,
      dawichok_url_sent_at = null,
      dawichok_url_sent_by = null,
      signup_completed = true,
      signup_verification_method = 'phone_otp',
      signup_verified_by_admin_id = null,
      updated_at = checked_at
  where id = profile_row.id;

  insert into public.fc_credentials (
    fc_id,
    password_hash,
    password_salt,
    password_set_at,
    failed_count,
    locked_until,
    reset_token_hash,
    reset_token_expires_at,
    reset_sent_at,
    reset_failed_count,
    must_change_password,
    temporary_password_issued_at,
    created_at,
    updated_at
  ) values (
    profile_row.id,
    p_password_hash,
    p_password_salt,
    checked_at,
    0,
    null,
    null,
    null,
    null,
    0,
    false,
    null,
    checked_at,
    checked_at
  )
  on conflict (fc_id) do update
  set password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_set_at = excluded.password_set_at,
      failed_count = 0,
      locked_until = null,
      reset_token_hash = null,
      reset_token_expires_at = null,
      reset_sent_at = null,
      reset_failed_count = 0,
      must_change_password = false,
      temporary_password_issued_at = null,
      updated_at = excluded.updated_at
  returning session_version into credential_session_version;

  stored_result := jsonb_build_object(
    'ok', true,
    'fcId', profile_row.id,
    'residentId', normalized_phone,
    'displayName', normalized_name,
    'affiliation', normalized_affiliation,
    'sessionVersion', credential_session_version,
    'alreadyApplied', false
  );

  update public.fc_signup_completion_challenges
  set consumed_at = checked_at,
      request_fingerprint = p_request_fingerprint,
      result = stored_result,
      updated_at = checked_at
  where fc_id = profile_row.id
    and token_hash = p_completion_token_hash
    and consumed_at is null;

  if not found then
    raise exception 'fc_signup_completion_proof_lost';
  end if;

  return stored_result;
end;
$$;


-- Common referral signup accepts attested imports without inventing a user
-- terms acceptance timestamp. All existing OTP and retry boundaries stay.
create or replace function public.register_platform_member(p_phone text,p_code_hash text,p_name text,
  p_password_hash text,p_password_salt text,p_referral_code text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_signup_challenges; m platform_members; inviter uuid; checked_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  perform pg_advisory_xact_lock(hashtextextended(p_phone,8102026));
  select * into c from platform_signup_challenges where phone=p_phone for update;
  checked_at:=clock_timestamp();
  if not found or c.expires_at<=checked_at then return jsonb_build_object('ok',false,'code','expired_code'); end if;
  if c.locked_until>checked_at then return jsonb_build_object('ok',false,'code','locked'); end if;
  if c.code_hash is distinct from p_code_hash then
    update platform_signup_challenges set attempts=attempts+1,
      locked_until=case when attempts>=4 then checked_at+interval '10 minutes' else null end where phone=p_phone;
    return jsonb_build_object('ok',false,'code','invalid_code');
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80
    or coalesce(p_password_hash,'') !~ '^[A-Za-z0-9+/]{43}=$'
    or coalesce(p_password_salt,'') !~ '^[A-Za-z0-9+/]{22}==$' then raise exception 'invalid_input'; end if;
  -- An uncertain successful signup may be retried during the original OTP
  -- window only with the same verified phone, code and current password.
  -- The already-consumed challenge never creates another account.
  if c.consumed_member_id is not null then
    select * into m from platform_members where id=c.consumed_member_id and phone=p_phone and active and fc_id is null;
    if m.id is null or not exists(select from platform_member_credentials
      where member_id=m.id and password_hash=p_password_hash and password_salt=p_password_salt)
    then return jsonb_build_object('ok',false,'code','already_exists'); end if;
    return jsonb_build_object('ok',true,'memberId',m.id,'displayName',m.name,
      'sessionVersion',(select session_version from platform_member_credentials where member_id=m.id));
  end if;
  if exists(select from platform_members where phone=p_phone) or exists(select from fc_profiles where phone=p_phone and signup_completed)
    or exists(select from admin_accounts where phone=p_phone) or exists(select from manager_accounts where phone=p_phone)
  then return jsonb_build_object('ok',false,'code','already_exists'); end if;
  if nullif(trim(p_referral_code),'') is not null then
    select id into inviter from platform_members where referral_code=upper(trim(p_referral_code)) and active and (terms_accepted_at is not null or terms_basis='company_attested_import');
    if inviter is null then
      select m2.id into inviter from referral_codes r join platform_members m2 on m2.fc_id=r.fc_id
      where r.code=upper(trim(p_referral_code)) and r.is_active and m2.active and (m2.terms_accepted_at is not null or m2.terms_basis='company_attested_import');
    end if;
    if inviter is null then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  end if;
  insert into platform_members(phone,name,referrer_id,terms_accepted_at,terms_version)
    values(p_phone,trim(p_name),inviter,checked_at,'2026-10-12') returning * into m;
  insert into platform_member_credentials(member_id,password_hash,password_salt) values(m.id,p_password_hash,p_password_salt);
  update platform_signup_challenges set consumed_member_id=m.id where phone=p_phone;
  return jsonb_build_object('ok',true,'memberId',m.id,'displayName',m.name,'sessionVersion',0);
end $$;

-- 20261014073458_platform_affiliate_account_withdrawal
-- Ordinary common/FC withdrawal. Company admin/manager accounts are exempt.
-- Two databases cannot share a transaction: revoke admission first, require an
-- exact affiliate receipt, then erase locally and confirm external cleanup.
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.fc_profiles add column account_closed_at timestamptz;

create table public.platform_account_withdrawals (
  operation_id uuid primary key,
  member_id uuid not null unique references public.platform_members(id) on delete restrict,
  session_digest text not null check(session_digest ~ '^[0-9a-f]{64}$'),
  source_fc_id uuid references public.fc_profiles(id) on delete restrict,
  preserved_company_role text check(preserved_company_role in ('admin','manager','designer','developer')),
  local_erased boolean not null default false,
  completed boolean not null default false,
  cleanup_receipt jsonb,
  cleanup_outbox_id uuid references public.account_deletion_cleanup_outbox(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check(attempt_count>=0),
  pending_reason text check(pending_reason in ('affiliate_identity_unbound','affiliate_unavailable','cleanup_pending'))
);
alter table public.platform_account_withdrawals enable row level security;
revoke all on public.platform_account_withdrawals from public,anon,authenticated;
grant select,insert,update on public.platform_account_withdrawals to service_role;
create index platform_withdrawals_due on public.platform_account_withdrawals(next_attempt_at,created_at)
  where not completed;

create table public.platform_withdrawal_messenger_cleanup (
  operation_id uuid references public.platform_account_withdrawals(operation_id) on delete restrict,
  cleanup_id uuid references public.messenger_attachment_cleanup_outbox(id) on delete restrict,
  primary key(operation_id,cleanup_id)
);
alter table public.platform_withdrawal_messenger_cleanup enable row level security;
revoke all on public.platform_withdrawal_messenger_cleanup from public,anon,authenticated;
grant select,insert on public.platform_withdrawal_messenger_cleanup to service_role;

create function public.erase_completed_account_cleanup_payload_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.status='completed' then
    new.cleanup_payload:='{}'::jsonb;
    update platform_account_withdrawals set cleanup_receipt=null where cleanup_outbox_id=new.id;
  end if;
  return new;
end $$;
revoke all on function public.erase_completed_account_cleanup_payload_v1() from public,anon,authenticated;
create trigger account_completed_cleanup_payload before update of status on public.account_deletion_cleanup_outbox
  for each row execute function public.erase_completed_account_cleanup_payload_v1();

create function public.guard_closed_fc_account_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare target uuid;
begin
  if tg_table_name='fc_profiles' then target:=old.id; else target:=new.fc_id; end if;
  if exists(select from fc_profiles where id=target and account_closed_at is not null)
    and current_setting('moduon.fc_closure_id',true) is distinct from target::text then
    raise exception 'account_closed';
  end if;
  return new;
end $$;
revoke all on function public.guard_closed_fc_account_v1() from public,anon,authenticated;
create trigger fc_closed_account_write_guard before update on public.fc_profiles
  for each row execute function public.guard_closed_fc_account_v1();
create trigger fc_closed_credentials_guard before insert or update on public.fc_credentials
  for each row execute function public.guard_closed_fc_account_v1();
create trigger fc_closed_completion_guard before insert or update on public.fc_signup_completion_challenges
  for each row execute function public.guard_closed_fc_account_v1();

create or replace function public.queue_messenger_attachment_actor_cleanup_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_actor_role text;
  v_operation_id uuid:=nullif(current_setting('moduon.withdrawal_operation_id',true),'')::uuid;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_lock record;
  v_lock_conversation_id uuid;
  v_target_conversation_ids uuid[];
  v_broadcast_batch record;
  v_reconciled_conversation_ids uuid[];
  v_remaining integer;
begin
  v_actor_role := case tg_table_name
    when 'fc_profiles' then 'fc'
    when 'manager_accounts' then 'manager'
    when 'admin_accounts' then 'admin'
    else null
  end;
  if v_actor_role is null then
    raise exception 'invalid_attachment_actor_cleanup_trigger';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_actor_role || ':' || old.id::text, 0)
  );

  if v_actor_role = 'fc' then
    select array_agg(conversation.id order by conversation.id)
      into v_target_conversation_ids
      from public.garamin_direct_conversations conversation
     where conversation.fc_id = old.id;

    -- Lock every affected batch owner before taking batch row locks. This keeps
    -- reserve/commit/delete serialization in the same actor-lock order.
    for v_lock in
      select distinct affected.actor_role, affected.actor_id
        from (
          select batch.actor_role, batch.actor_id
            from public.messenger_attachment_delivery_batches batch
           where batch.context_kind = 'direct'
             and batch.conversation_id = any(v_target_conversation_ids)
             and batch.status not in ('deleted', 'revoked')
          union
          select batch.actor_role, batch.actor_id
            from public.messenger_attachment_delivery_batches batch
           where batch.context_kind = 'direct_broadcast'
             and batch.conversation_ids && v_target_conversation_ids
             and batch.status not in ('deleted', 'revoked')
        ) affected
       order by affected.actor_role, affected.actor_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(v_lock.actor_role || ':' || v_lock.actor_id::text, 0)
      );
    end loop;

    -- Reserve and commit take the same context locks after their actor lock.
    -- Once these are held no new pending/committed delivery can enter a
    -- conversation that is being cascaded away.
    for v_lock_conversation_id in
      select conversation_id
        from unnest(v_target_conversation_ids) requested(conversation_id)
       order by conversation_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(
          'messenger-direct-context:' || v_lock_conversation_id::text,
          0
        )
      );
    end loop;

    -- The legacy account-delete transaction may hard-delete recipient message
    -- rows before this profile trigger runs. Reconcile broadcast batches from
    -- their durable conversation context, then derive the surviving reference
    -- count from whichever undeleted messages remain.
    for v_broadcast_batch in
      select batch.id, batch.status
        from public.messenger_attachment_delivery_batches batch
       where batch.context_kind = 'direct_broadcast'
         and batch.conversation_ids && v_target_conversation_ids
         and batch.status not in ('deleted', 'revoked')
       order by batch.id
       for update
    loop
      update public.messages
         set deleted_at = coalesce(deleted_at, v_now),
             deleted_by_actor_id = coalesce(deleted_by_actor_id, old.id),
             content = ''
       where attachment_batch_id = v_broadcast_batch.id
         and conversation_id = any(v_target_conversation_ids)
         and deleted_at is null;

      if v_broadcast_batch.status = 'committed' then
        select array_agg(
                 distinct message.conversation_id
                 order by message.conversation_id
               ),
               count(*)
          into v_reconciled_conversation_ids, v_remaining
          from public.messages message
         where message.attachment_batch_id = v_broadcast_batch.id
           and message.conversation_id is not null
           and message.deleted_at is null;
        if v_remaining > 0 then
          update public.messenger_attachment_delivery_batches
             set conversation_ids = v_reconciled_conversation_ids,
                 updated_at = v_now
           where id = v_broadcast_batch.id;
          update public.messenger_attachment_objects
             set reference_count = v_remaining
           where batch_id = v_broadcast_batch.id
             and status = 'active';
        end if;
      end if;
    end loop;
  end if;

  for v_batch in
    select batch.*
      from public.messenger_attachment_delivery_batches batch
     where (
         (
           batch.actor_id = old.id
           and batch.actor_role = v_actor_role
         )
         or (
           v_actor_role = 'fc'
           and batch.context_kind = 'direct'
           and batch.conversation_id = any(v_target_conversation_ids)
         )
         or (
           v_actor_role = 'fc'
           and batch.context_kind = 'direct_broadcast'
           and batch.conversation_ids && v_target_conversation_ids
           and (
             batch.status in ('pending', 'expired')
             or (
               batch.status = 'committed'
               and not exists (
                 select 1
                   from public.messages message
                  where message.attachment_batch_id = batch.id
                    and message.deleted_at is null
               )
             )
           )
         )
       )
       and batch.status not in ('deleted', 'revoked')
     for update
  loop
    update public.messages
       set deleted_at = coalesce(deleted_at, v_now),
           deleted_by_actor_id = coalesce(deleted_by_actor_id, old.id),
           content = ''
     where attachment_batch_id = v_batch.id
       and deleted_at is null;
    update public.group_chat_messages
       set deleted_at = coalesce(deleted_at, v_now),
           content = ''
     where attachment_batch_id = v_batch.id
       and deleted_at is null;
    delete from public.group_chat_notices notice
     where notice.message_id in (
       select message.id
         from public.group_chat_messages message
        where message.attachment_batch_id = v_batch.id
     );

    insert into public.messenger_attachment_deletion_audit (
      original_name,
      byte_size,
      sha256,
      reason_code,
      deleted_at
    )
    select case when v_operation_id is not null then '삭제' else attachment.original_name end,
           attachment.byte_size,
           attachment.sha256,
           'account_deleted',
           v_now
      from public.messenger_attachment_objects attachment
     where attachment.batch_id = v_batch.id
       and attachment.status = 'active';

    insert into public.messenger_attachment_cleanup_outbox (
      attachment_id,
      batch_id,
      bucket_id,
      storage_path,
      reason_code,
      sweep_phase,
      not_before
    )
    select candidate.attachment_id,
           v_batch.id,
           candidate.bucket_id,
           candidate.storage_path,
           'account_deleted',
           phase.sweep_phase,
           case phase.sweep_phase
             when 'immediate' then v_now
             else greatest(v_batch.expires_at, v_now) + interval '5 minutes'
           end
      from (
        select attachment.id as attachment_id,
               attachment.bucket_id,
               attachment.storage_path
          from public.messenger_attachment_objects attachment
         where attachment.batch_id = v_batch.id
           and attachment.storage_path is not null
        union all
        select null::uuid,
               intent.bucket_id,
               intent.object_path
          from public.messenger_attachment_upload_intents intent
         where intent.batch_id = v_batch.id
           and intent.object_path is not null
      ) candidate
      cross join (
        values ('immediate'::text), ('post_token_expiry'::text)
      ) phase(sweep_phase)
    on conflict (bucket_id, storage_path, sweep_phase)
      where bucket_id is not null and storage_path is not null
    do update set
      not_before = least(
        public.messenger_attachment_cleanup_outbox.not_before,
        excluded.not_before
      ),
      status = case
        when public.messenger_attachment_cleanup_outbox.status = 'completed'
          then 'pending'
        else public.messenger_attachment_cleanup_outbox.status
      end,
      completed_at = null,
      updated_at = v_now;

    update public.messenger_attachment_upload_intents
       set status = 'revoked',
           object_path = null,
           updated_at = v_now
     where batch_id = v_batch.id
       and status in ('pending', 'validated', 'expired');
    update public.messenger_attachment_objects
       set bucket_id = null,
           storage_path = null,
           reference_count = 0,
           status = 'tombstoned',
           tombstoned_at = coalesce(tombstoned_at, v_now)
     where batch_id = v_batch.id
       and status = 'active';
    update public.messenger_attachment_delivery_batches
       set status = 'deleted',
           deleted_at = coalesce(deleted_at, v_now),
           updated_at = v_now
     where id = v_batch.id;
    if v_operation_id is not null then
      if not exists(select from platform_account_withdrawals where operation_id=v_operation_id
        and source_fc_id=old.id) then raise exception 'forbidden'; end if;
      insert into platform_withdrawal_messenger_cleanup(operation_id,cleanup_id)
        select v_operation_id,id from messenger_attachment_cleanup_outbox where batch_id=v_batch.id
        on conflict do nothing;
      update messenger_attachment_deletion_audit audit set original_name='삭제'
        where exists(select from messenger_attachment_objects o where o.batch_id=v_batch.id
          and o.sha256=audit.sha256 and o.original_name=audit.original_name);
      update messenger_attachment_upload_intents set original_name='삭제',object_path=null,status='revoked'
        where batch_id=v_batch.id;
      update messenger_attachment_objects set original_name='삭제' where batch_id=v_batch.id;
    end if;
  end loop;
  if tg_op='UPDATE' then return new; end if;
  return old;
end;
$$;
create trigger trg_queue_fc_withdrawal_messenger_cleanup before update of account_closed_at on public.fc_profiles
  for each row when(old.account_closed_at is null and new.account_closed_at is not null)
  execute function public.queue_messenger_attachment_actor_cleanup_v2();

create or replace function public.delete_account_core_transaction_v1(
  p_target_role text,
  p_target_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_phone text;
  v_phone_digits text;
  v_fc_ids uuid[] := array[]::uuid[];
  v_fc_id uuid;
  v_proof_paths text[] := array[]::text[];
  v_new_proof_paths text[] := array[]::text[];
  v_document_paths text[] := array[]::text[];
  v_board_paths text[] := array[]::text[];
  v_auth_user_ids uuid[] := array[]::uuid[];
  v_post_ids uuid[] := array[]::uuid[];
  v_cleanup_outbox_id uuid;
  v_deleted_count integer := 0;
begin
  if p_target_id is null or p_target_role not in ('fc', 'admin', 'manager') then
    raise exception using errcode = '22023', message = 'invalid_account_delete_target';
  end if;

  if p_target_role = 'fc' then
    select profile.phone
      into v_phone
      from public.fc_profiles profile
     where profile.id = p_target_id
       and not profile.is_manager_referral_shadow
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;
    v_fc_ids := array[p_target_id];
  elsif p_target_role = 'admin' then
    select account.phone
      into v_phone
      from public.admin_accounts account
     where account.id = p_target_id
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;
  else
    select account.phone
      into v_phone
      from public.manager_accounts account
     where account.id = p_target_id
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;

    select coalesce(array_agg(profile.id order by profile.id), array[]::uuid[])
      into v_fc_ids
      from public.fc_profiles profile
     where profile.is_manager_referral_shadow
       and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g')
           = regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g');
  end if;

  v_phone_digits := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
  if v_phone_digits is null then
    raise exception using errcode = '23514', message = 'account_delete_phone_missing';
  end if;

  if cardinality(v_fc_ids) > 0 then
    perform 1
      from public.fc_profiles profile
     where profile.id = any(v_fc_ids)
     for update;

    if exists (
      select 1
        from public.exam_registrations registration
       where registration.resident_id not like 'deleted-exam:%'
         and (
           (
             registration.fc_id = any(v_fc_ids)
             and nullif(
               regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
               ''
             ) is distinct from v_phone_digits
           )
           or (
             nullif(
               regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
               ''
             ) = v_phone_digits
             and (
               registration.fc_id is null
               or not (registration.fc_id = any(v_fc_ids))
             )
           )
         )
    ) then
      raise exception using
        errcode = '23514',
        message = 'account_delete_exam_ownership_mismatch';
    end if;

    select coalesce(array_agg(document.storage_path), array[]::text[])
      into v_document_paths
      from public.fc_documents document
     where document.fc_id = any(v_fc_ids)
       and document.storage_path is not null
       and document.storage_path <> 'deleted';

    select coalesce(array_agg(profile.id), array[]::uuid[])
      into v_auth_user_ids
      from public.profiles profile
     where profile.fc_id = any(v_fc_ids);

    foreach v_fc_id in array v_fc_ids
    loop
      select coalesce(array_agg(detached.proof_path), array[]::text[])
        into v_new_proof_paths
        from public.detach_exam_registration_identity_for_account_deletion(v_fc_id) detached;
      v_proof_paths := v_proof_paths || v_new_proof_paths;
    end loop;
  end if;

  select coalesce(array_agg(post.id), array[]::uuid[])
    into v_post_ids
    from public.board_posts post
   where regexp_replace(coalesce(post.author_resident_id, ''), '[^0-9]', '', 'g')
         = v_phone_digits;

  select coalesce(array_agg(distinct attachment.storage_path), array[]::text[])
    into v_board_paths
    from public.board_attachments attachment
   where regexp_replace(coalesce(attachment.created_by_resident_id, ''), '[^0-9]', '', 'g')
         = v_phone_digits
      or attachment.post_id = any(v_post_ids);

  -- Legacy chat uploads used shared `chat/` and `group-chat/` prefixes without
  -- an owner identifier. A message row therefore cannot prove ownership of the
  -- referenced object. Keep these objects out of the service-role cleanup
  -- receipt instead of trusting a user-controlled legacy file_url.

  delete from public.board_comment_likes
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_post_reactions
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_post_views
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_comments
   where regexp_replace(coalesce(author_resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_attachments
   where regexp_replace(coalesce(created_by_resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_posts where id = any(v_post_ids);

  if to_regclass('public.messages') is not null then
    execute $dynamic$
      delete from public.messages
       where regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g') = $1
          or regexp_replace(coalesce(receiver_id, ''), '[^0-9]', '', 'g') = $1
    $dynamic$
    using v_phone_digits;
  end if;

  delete from public.notifications
   where (cardinality(v_fc_ids) > 0 and fc_id = any(v_fc_ids))
      or regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.device_tokens
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.web_push_subscriptions
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.user_presence
   where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.notices
   where regexp_replace(coalesce(created_by, ''), '[^0-9]', '', 'g') = v_phone_digits;

  delete from public.referral_events
   where regexp_replace(coalesce(inviter_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      or regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.referral_attributions
   where regexp_replace(coalesce(inviter_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      or regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

  if p_target_role = 'manager' then
    delete from public.affiliation_manager_mappings
     where regexp_replace(coalesce(manager_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  end if;

  if cardinality(v_fc_ids) > 0 then
    delete from public.profiles where fc_id = any(v_fc_ids);
    if p_target_role = 'fc'
      and current_setting('moduon.fc_closure_id',true) = p_target_id::text then
      -- Financial snapshots still reference this UUID. Erase account data,
      -- never cascade settled business history or fabricate another identity.
      -- This upload namespace proves ownership; legacy arbitrary URLs do not.
      select v_document_paths || coalesce(array_agg(hanwha_commission_pdf_path),array[]::text[])
        into v_document_paths from public.fc_profiles
        where id=p_target_id and hanwha_commission_pdf_path like 'hanwha-url-pdf/'||id::text||'/%'
          and position('/../' in hanwha_commission_pdf_path)=0;
      delete from public.fc_documents where fc_id=p_target_id;
      delete from public.fc_identity_secure where fc_id=p_target_id;
      delete from public.fc_credentials where fc_id=p_target_id;
      delete from public.fc_signup_completion_challenges where fc_id=p_target_id;
      delete from public.admin_assisted_signup_consents where fc_id=p_target_id;
      delete from public.referral_codes where fc_id=p_target_id;
      update public.fc_profiles set
        phone='deleted-fc:'||id::text,name='탈퇴 회원',affiliation='삭제',
        temp_id=null,resident_id_masked=null,resident_id_hash=null,
        email=null,address=null,address_detail=null,carrier=null,career_type=null,license_statuses=null,
        recommender=null,recommender_code=null,recommender_code_id=null,
        admin_memo=null,appointment_url=null,hanwha_commission_pdf_path=null,hanwha_commission_pdf_name=null,
        allowance_reject_reason=null,hanwha_commission_reject_reason=null,
        appointment_reject_reason_life=null,appointment_reject_reason_nonlife=null,
        dawichok_url_sent_by=null,phone_verified=false,phone_verified_at=null,
        phone_verification_hash=null,phone_verification_expires_at=null,
        phone_verification_sent_at=null,phone_verification_attempts=0,phone_verification_locked_until=null,
        signup_completed=false,identity_completed=false,signup_verification_method=null,
        signup_verified_at=null,signup_verified_by_admin_id=null,updated_at=clock_timestamp()
        where id=p_target_id;
      update public.fc_profiles set recommender=null,recommender_code=null,recommender_code_id=null
        where recommender_fc_id=p_target_id and account_closed_at is null;
    else
      delete from public.fc_profiles where id = any(v_fc_ids);
    end if;
  end if;

  if p_target_role = 'admin' then
    delete from public.admin_accounts where id = p_target_id;
  elsif p_target_role = 'manager' then
    delete from public.manager_accounts where id = p_target_id;
  end if;
  get diagnostics v_deleted_count = row_count;

  if p_target_role = 'fc' then
    v_deleted_count := case
      when current_setting('moduon.fc_closure_id',true)=p_target_id::text
        and exists(select from public.fc_profiles where id=p_target_id
          and phone='deleted-fc:'||id::text and not signup_completed and account_closed_at is not null)
        and not exists(select from public.fc_credentials where fc_id=p_target_id) then 1
      when exists (select 1 from public.fc_profiles where id = p_target_id) then 0
      else 1
    end;
  end if;

  if v_deleted_count <> 1 then
    raise exception using errcode = 'P0002', message = 'account_delete_target_not_deleted';
  end if;

  insert into public.account_deletion_cleanup_outbox (
    cleanup_payload
  ) values (
    jsonb_build_object(
      'proof_paths', to_jsonb(v_proof_paths),
      'document_paths', to_jsonb(v_document_paths),
      'board_attachment_paths', to_jsonb(v_board_paths),
      'chat_file_urls', '[]'::jsonb,
      'auth_user_ids', to_jsonb(v_auth_user_ids)
    )
  )
  returning id into v_cleanup_outbox_id;

  return jsonb_build_object(
    'deleted', true,
    'cleanup_outbox_id', v_cleanup_outbox_id,
    'proof_paths', to_jsonb(v_proof_paths),
    'document_paths', to_jsonb(v_document_paths),
    'board_attachment_paths', to_jsonb(v_board_paths),
    'chat_file_urls', '[]'::jsonb,
    'auth_user_ids', to_jsonb(v_auth_user_ids)
  );
end;
$$;

-- The old function remains available only to trusted deletion paths; its
-- staff authorization and normal hard-delete semantics are unchanged.

create function public.get_platform_withdrawal_v1(p_operation_id uuid,p_session_digest text)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
  select to_jsonb(w) from platform_account_withdrawals w
    where (p_operation_id is null or operation_id=p_operation_id) and session_digest=p_session_digest
    order by created_at desc,operation_id limit 1;
$$;

create function public.begin_platform_withdrawal_v1(
  p_member_id uuid,p_operation_id uuid,p_session_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; f fc_profiles; w platform_account_withdrawals; source_phone text; source_fc uuid;
  source_staff_id uuid; source_staff_kind text;
begin
  if p_operation_id is null or p_member_id is null or p_session_digest is null
    or p_session_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,741014));
  select * into w from platform_account_withdrawals where operation_id=p_operation_id;
  if found then
    if w.member_id<>p_member_id or w.session_digest<>p_session_digest then raise exception 'forbidden'; end if;
    return to_jsonb(w);
  end if;
  select * into m from platform_members where id=p_member_id;
  if not found or not m.active or m.phone is null then raise exception 'member_unavailable'; end if;
  source_phone:=m.phone;
  source_fc:=m.fc_id; source_staff_id:=m.staff_account_id; source_staff_kind:=m.staff_account_kind;
  -- Same phone-advisory domain as signup/enrollment, then source profile,
  -- common member, credentials. Never reverse the existing profile/member order.
  perform pg_advisory_xact_lock(hashtextextended(source_phone,741012));
  if m.fc_id is not null then
    select * into f from fc_profiles where id=m.fc_id for update;
    if not found or f.phone<>source_phone or f.signup_completed is distinct from true
      or f.is_manager_referral_shadow or f.account_closed_at is not null
      then raise exception 'forbidden'; end if;
  end if;
  select * into m from platform_members where id=p_member_id for update;
  if not m.active or m.phone is distinct from source_phone
    or m.fc_id is distinct from source_fc or m.staff_account_id is distinct from source_staff_id
    or m.staff_account_kind is distinct from source_staff_kind then raise exception 'forbidden'; end if;
  insert into platform_account_withdrawals(operation_id,member_id,session_digest,source_fc_id,preserved_company_role)
    values(p_operation_id,m.id,p_session_digest,m.fc_id,m.staff_account_kind) returning * into w;
  if f.id is not null then
    perform set_config('moduon.withdrawal_operation_id',w.operation_id::text,true);
    update fc_profiles set account_closed_at=clock_timestamp(),signup_completed=false where id=f.id;
    perform set_config('moduon.withdrawal_operation_id','',true);
    delete from fc_credentials where fc_id=f.id;
    delete from fc_signup_completion_challenges where fc_id=f.id;
  end if;
  delete from platform_member_credentials where member_id=m.id;
  delete from platform_signup_challenges where phone=m.phone or consumed_member_id=m.id;
  update platform_members set active=false where id=m.id;
  return to_jsonb(w);
end $$;

create function public.erase_platform_withdrawal_v1(
  p_operation_id uuid,p_session_digest text,p_affiliate_state text,p_preserved_company_role text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare w platform_account_withdrawals; receipt jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,741014));
  select * into w from platform_account_withdrawals
    where operation_id=p_operation_id and session_digest=p_session_digest;
  if not found then raise exception 'forbidden'; end if;
  if w.local_erased then return to_jsonb(w); end if;
  if w.source_fc_id is not null then
    if p_affiliate_state not in ('erased','company_account_preserved') or p_affiliate_state is null
      or (p_affiliate_state='company_account_preserved' and
        coalesce(p_preserved_company_role,'') not in ('admin','manager','designer','developer')) then raise exception 'affiliate_receipt_required'; end if;
    perform from fc_profiles where id=w.source_fc_id for update;
  elsif p_affiliate_state is distinct from 'not_applicable' then raise exception 'forbidden'; end if;
  perform from platform_members where id=w.member_id for update;
  if w.source_fc_id is not null then
    perform set_config('moduon.fc_closure_id',w.source_fc_id::text,true);
    receipt:=delete_account_core_transaction_v1('fc',w.source_fc_id);
    perform set_config('moduon.fc_closure_id','',true);
  end if;
  -- Reuse the existing erase-only function. It does not call the core delete
  -- transaction, so BEFORE DELETE projection triggers cannot recurse.
  perform delete_platform_member(w.member_id);
  update platform_account_withdrawals set local_erased=true,cleanup_receipt=receipt,
    cleanup_outbox_id=(receipt->>'cleanup_outbox_id')::uuid,
    preserved_company_role=coalesce(p_preserved_company_role,preserved_company_role)
    where operation_id=w.operation_id returning * into w;
  return to_jsonb(w);
end $$;

create function public.complete_platform_withdrawal_v1(p_operation_id uuid,p_session_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare w platform_account_withdrawals;
begin
  select * into w from platform_account_withdrawals
    where operation_id=p_operation_id and session_digest=p_session_digest for update;
  if not found or not w.local_erased then raise exception 'forbidden'; end if;
  if w.cleanup_outbox_id is not null and not exists(select from account_deletion_cleanup_outbox
    where id=w.cleanup_outbox_id and status='completed') then raise exception 'cleanup_pending'; end if;
  if exists(select from platform_withdrawal_messenger_cleanup link
    join messenger_attachment_cleanup_outbox q on q.id=link.cleanup_id
    where link.operation_id=w.operation_id and q.status<>'completed') then raise exception 'cleanup_pending'; end if;
  update platform_account_withdrawals set completed=true,cleanup_receipt=null,pending_reason=null,completed_at=coalesce(completed_at,clock_timestamp())
    where operation_id=w.operation_id returning * into w;
  return to_jsonb(w);
end $$;

revoke all on function public.get_platform_withdrawal_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.begin_platform_withdrawal_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.erase_platform_withdrawal_v1(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.complete_platform_withdrawal_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.get_platform_withdrawal_v1(uuid,text) to service_role;
grant execute on function public.begin_platform_withdrawal_v1(uuid,uuid,text) to service_role;
grant execute on function public.erase_platform_withdrawal_v1(uuid,text,text,text) to service_role;
grant execute on function public.complete_platform_withdrawal_v1(uuid,text) to service_role;

create function public.get_platform_withdrawal_cleanup_v1(p_operation_id uuid,p_session_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if not exists(select from platform_account_withdrawals where operation_id=p_operation_id
    and session_digest=p_session_digest) then raise exception 'forbidden'; end if;
  return jsonb_build_object('batch_ids',coalesce((select jsonb_agg(batch_id) from(
    select distinct q.batch_id from platform_withdrawal_messenger_cleanup link
      join messenger_attachment_cleanup_outbox q on q.id=link.cleanup_id
      where link.operation_id=p_operation_id and q.status<>'completed' and q.batch_id is not null
      order by q.batch_id limit 25) batches),'[]'::jsonb),
    'pending',exists(select from platform_withdrawal_messenger_cleanup link
      join messenger_attachment_cleanup_outbox q on q.id=link.cleanup_id
      where link.operation_id=p_operation_id and q.status<>'completed'));
end $$;
revoke all on function public.get_platform_withdrawal_cleanup_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.get_platform_withdrawal_cleanup_v1(uuid,text) to service_role;

create function public.record_platform_withdrawal_retry_v1(p_operation_id uuid,p_session_digest text,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if coalesce(p_reason,'') not in ('affiliate_identity_unbound','affiliate_unavailable','cleanup_pending')
    then raise exception 'invalid_input'; end if;
  update platform_account_withdrawals set pending_reason=p_reason,attempt_count=least(attempt_count+1,1000000),
    next_attempt_at=clock_timestamp()+make_interval(secs=>case when p_reason='affiliate_identity_unbound' then 300
      else least(3600,(30*power(2,least(attempt_count,7)))::integer) end)
    where operation_id=p_operation_id and session_digest=p_session_digest and not completed;
  if not found then
    if exists(select from platform_account_withdrawals where operation_id=p_operation_id
      and session_digest=p_session_digest and completed) then
      return jsonb_build_object('recorded',false,'completed',true);
    end if;
    raise exception 'forbidden';
  end if;
  return jsonb_build_object('recorded',true,'completed',false);
end $$;
create function public.list_due_platform_withdrawals_v1() returns jsonb
language sql security invoker set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) from(
    select * from platform_account_withdrawals where not completed and next_attempt_at<=clock_timestamp()
      order by next_attempt_at,created_at,operation_id limit 3) w;
$$;
revoke all on function public.record_platform_withdrawal_retry_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.list_due_platform_withdrawals_v1() from public,anon,authenticated;
grant execute on function public.record_platform_withdrawal_retry_v1(uuid,text,text) to service_role;
grant execute on function public.list_due_platform_withdrawals_v1() to service_role;

-- 20261014084133_detach_retired_fc_allowance_identity
-- Preserve reviewed allowance history when its live FC account is removed.
alter table public.referral_allowance_imports
  add column if not exists beneficiary_fc_id_snapshot uuid;
alter table public.referral_allowance_imports
  alter column beneficiary_fc_id drop not null;
alter table public.referral_allowance_imports
  drop constraint if exists referral_allowance_imports_beneficiary_fc_id_fkey;
alter table public.referral_allowance_imports
  add constraint referral_allowance_imports_beneficiary_fc_id_fkey
  foreign key (beneficiary_fc_id) references public.fc_profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referral_allowance_imports'::regclass
      and conname = 'referral_allowance_imports_beneficiary_identity'
  ) then
    alter table public.referral_allowance_imports
      add constraint referral_allowance_imports_beneficiary_identity check (
        (beneficiary_fc_id is not null and beneficiary_fc_id_snapshot is null)
        or (beneficiary_fc_id is null and beneficiary_fc_id_snapshot is not null)
      );
  end if;
end $$;

-- Keep the existing live-account constraints/RPC conflict targets unchanged.
-- The same source, revision and single-published-month rules also cover archives.
create unique index if not exists referral_allowance_archive_source_unique
  on public.referral_allowance_imports
    (beneficiary_fc_id_snapshot, performance_month, source_sha256, policy_version, pilot_revision)
  where beneficiary_fc_id is null;
create unique index if not exists referral_allowance_archive_revision_unique
  on public.referral_allowance_imports
    (beneficiary_fc_id_snapshot, performance_month, revision)
  where beneficiary_fc_id is null;
create unique index if not exists referral_allowance_archive_published_month_unique
  on public.referral_allowance_imports
    (beneficiary_fc_id_snapshot, performance_month)
  where beneficiary_fc_id is null and status = 'published';

create or replace function public.guard_referral_allowance_import_immutability()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only the nested FK action after deletion of the referenced FC may detach
  -- identity. Direct updates and forged nested updates with a live FC fail.
  if pg_trigger_depth() > 1
    and old.beneficiary_fc_id is not null
    and new.beneficiary_fc_id is null
    and old.beneficiary_fc_id_snapshot is null
    and new.beneficiary_fc_id_snapshot is null
    and not exists (
      select 1 from public.fc_profiles where id = old.beneficiary_fc_id
    ) then
    if (to_jsonb(new) - array['beneficiary_fc_id','beneficiary_fc_id_snapshot'])
      is distinct from
      (to_jsonb(old) - array['beneficiary_fc_id','beneficiary_fc_id_snapshot']) then
      raise exception using errcode = '23514', message = 'allowance_import_immutable';
    end if;
    new.beneficiary_fc_id_snapshot := old.beneficiary_fc_id;
    return new;
  end if;

  if old.beneficiary_fc_id_snapshot is not null then
    raise exception using errcode = '23514', message = 'archived_allowance_import_immutable';
  end if;
  if (to_jsonb(new) - array['status','published_by','published_at','superseded_at'])
    is distinct from
    (to_jsonb(old) - array['status','published_by','published_at','superseded_at']) then
    raise exception using errcode = '23514', message = 'allowance_import_immutable';
  end if;
  if old.status = 'draft' and new.status = 'published' and new.superseded_at is null then return new; end if;
  if old.status = 'published' and new.status = 'superseded'
    and new.published_by is not distinct from old.published_by
    and new.published_at is not distinct from old.published_at then return new; end if;
  raise exception using errcode = '23514', message = 'invalid_allowance_transition';
end;
$$;

-- 20261014120000_platform_staff_grant
-- Partner-service staff rights attach to an existing common member. The
-- operator grants them manually; the member keeps exactly one password, which
-- moves to the staff account as the single credential authority (the same
-- hand-off enroll_platform_insurance_v1 uses for FC registration).
set local lock_timeout='3s';
set local statement_timeout='30s';

-- A staff row must never shadow a common member's phone. Otherwise the common
-- password keeps winning at login and the staff session is unreachable.
create or replace function public.guard_platform_staff_phone() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text:=case tg_table_name when 'admin_accounts' then 'admin' else 'manager' end;
begin
  if exists(select from platform_members m where m.active
    and m.phone=regexp_replace(coalesce(new.phone,''),'[^0-9]','','g')
    and (m.staff_account_kind is distinct from kind or m.staff_account_id is distinct from new.id)) then
    raise exception 'platform_member_phone_requires_grant';
  end if;
  return new;
end $$;
revoke all on function public.guard_platform_staff_phone() from public,anon,authenticated;
drop trigger if exists platform_admin_phone_guard on public.admin_accounts;
create trigger platform_admin_phone_guard before insert on public.admin_accounts
for each row execute function public.guard_platform_staff_phone();
drop trigger if exists platform_admin_phone_change_guard on public.admin_accounts;
create trigger platform_admin_phone_change_guard before update of phone on public.admin_accounts
for each row when (old.phone is distinct from new.phone) execute function public.guard_platform_staff_phone();
drop trigger if exists platform_manager_phone_guard on public.manager_accounts;
create trigger platform_manager_phone_guard before insert on public.manager_accounts
for each row execute function public.guard_platform_staff_phone();
drop trigger if exists platform_manager_phone_change_guard on public.manager_accounts;
create trigger platform_manager_phone_change_guard before update of phone on public.manager_accounts
for each row when (old.phone is distinct from new.phone) execute function public.guard_platform_staff_phone();

-- p_existing_account_id binds a pre-existing unbound staff row on the same
-- phone instead of creating one; its old password is replaced by the common one.
create or replace function public.grant_platform_staff_account_v1(
  p_member_id uuid,p_account_kind text,p_staff_type text default 'admin',p_existing_account_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; c platform_member_credentials; account_id uuid; created boolean:=false; found_account boolean;
begin
  if p_member_id is null or p_account_kind is null or p_account_kind not in ('admin','manager')
    or (p_account_kind='admin' and coalesce(p_staff_type,'') not in ('admin','developer')) then raise exception 'invalid_input'; end if;
  select * into m from platform_members where id=p_member_id;
  if not found or not m.active or m.phone is null then return jsonb_build_object('ok',false,'code','member_unavailable'); end if;
  perform pg_advisory_xact_lock(hashtextextended(m.phone,741012));
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then return jsonb_build_object('ok',false,'code','member_unavailable'); end if;
  if m.staff_account_id is not null then
    if m.staff_account_kind=p_account_kind and (p_existing_account_id is null or p_existing_account_id=m.staff_account_id) then
      return jsonb_build_object('ok',true,'accountKind',m.staff_account_kind,'accountId',m.staff_account_id,'alreadyGranted',true); end if;
    return jsonb_build_object('ok',false,'code','staff_already_bound');
  end if;
  -- An FC becoming staff is a separate, undecided policy.
  if m.fc_id is not null or exists(select from fc_profiles where phone=m.phone and signup_completed)
    then return jsonb_build_object('ok',false,'code','fc_member_not_supported'); end if;
  if m.terms_accepted_at is null and m.terms_basis is distinct from 'company_attested_import'
    then return jsonb_build_object('ok',false,'code','consent_required'); end if;
  select * into c from platform_member_credentials where member_id=m.id for update;
  if not found then return jsonb_build_object('ok',false,'code','credential_unavailable'); end if;
  if exists(select from admin_accounts where regexp_replace(phone,'[^0-9]','','g')=m.phone
      and (p_account_kind<>'admin' or id is distinct from p_existing_account_id))
    or exists(select from manager_accounts where regexp_replace(phone,'[^0-9]','','g')=m.phone
      and (p_account_kind<>'manager' or id is distinct from p_existing_account_id))
  then return jsonb_build_object('ok',false,'code','staff_phone_conflict'); end if;
  account_id:=coalesce(p_existing_account_id,gen_random_uuid());
  -- Bind first so the phone guard admits exactly this staff row.
  update platform_members set staff_account_kind=p_account_kind,staff_account_id=account_id where id=m.id;
  if p_existing_account_id is not null then
    if p_account_kind='admin' then
      update admin_accounts set password_hash=c.password_hash,password_salt=c.password_salt,password_set_at=c.password_set_at,
        failed_count=0,locked_until=null,reset_token_hash=null,reset_token_expires_at=null,reset_failed_count=0,updated_at=clock_timestamp()
        where id=account_id and active and regexp_replace(phone,'[^0-9]','','g')=m.phone;
    else
      update manager_accounts set password_hash=c.password_hash,password_salt=c.password_salt,password_set_at=c.password_set_at,
        failed_count=0,locked_until=null,reset_token_hash=null,reset_token_expires_at=null,reset_failed_count=0,updated_at=clock_timestamp()
        where id=account_id and active and regexp_replace(phone,'[^0-9]','','g')=m.phone;
    end if;
    found_account:=found;
    if not found_account then raise exception 'staff_account_unavailable'; end if;
  elsif p_account_kind='admin' then
    insert into admin_accounts(id,name,phone,staff_type,password_hash,password_salt,password_set_at,active)
      values(account_id,m.name,m.phone,p_staff_type,c.password_hash,c.password_salt,c.password_set_at,true);
    created:=true;
  else
    insert into manager_accounts(id,name,phone,password_hash,password_salt,password_set_at,active)
      values(account_id,m.name,m.phone,c.password_hash,c.password_salt,c.password_set_at,true);
    created:=true;
  end if;
  -- Earlier member-only tokens stop verifying; the next login yields the staff session.
  delete from platform_member_credentials where member_id=m.id;
  return jsonb_build_object('ok',true,'accountKind',p_account_kind,'accountId',account_id,'created',created,'alreadyGranted',false);
end $$;
revoke all on function public.grant_platform_staff_account_v1(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.grant_platform_staff_account_v1(uuid,text,text,uuid) to service_role;

-- 20261014130000_platform_service_referrals
-- Referrers belong to each affiliate service, not to the common membership.
-- A member keeps one Moduon account but holds at most one referrer and one
-- shareable code per service. platform_members.referrer_id stays as history
-- only; new applications snapshot the referrer of their own service.
create table public.platform_service_referral_codes (
  member_id uuid not null references public.platform_members(id) on delete restrict,
  service_key text not null check (service_key in ('care','telecom','rental','car')),
  -- The S prefix never occurs in hexadecimal common codes, so a service code
  -- cannot be mistaken for a legacy common code.
  code text not null unique check (code ~ '^S[0-9A-F]{11}$'),
  created_at timestamptz not null default now(),
  primary key(member_id,service_key)
);
create table public.platform_service_referrals (
  member_id uuid not null references public.platform_members(id) on delete restrict,
  service_key text not null check (service_key in ('care','telecom','rental','car')),
  referrer_id uuid not null references public.platform_members(id) on delete restrict,
  referral_code text not null check (length(referral_code) between 8 and 12),
  source text not null check (source in ('invite_signup','invite_confirmed','manual')),
  created_at timestamptz not null default now(),
  primary key(member_id,service_key),
  check (referrer_id<>member_id)
);
create index platform_service_referrals_referrer on public.platform_service_referrals(service_key,referrer_id);

-- Care links shared before service codes existed carried the inviter's common
-- code. Only the care service honors that legacy form.
create or replace function public.resolve_platform_service_referrer_v1(p_service_key text,p_code text)
returns uuid language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare normalized text:=upper(trim(coalesce(p_code,''))); inviter uuid;
begin
  if p_service_key is null or p_service_key not in ('care','telecom','rental','car')
    or normalized !~ '^[A-Z0-9]{8,12}$' then return null; end if;
  select m.id into inviter from platform_service_referral_codes c join platform_members m on m.id=c.member_id
    where c.code=normalized and c.service_key=p_service_key and m.active
      and (m.terms_accepted_at is not null or m.terms_basis='company_attested_import');
  if inviter is null and p_service_key='care' then
    select id into inviter from platform_members where referral_code=normalized and active
      and (terms_accepted_at is not null or terms_basis='company_attested_import');
  end if;
  return inviter;
end $$;

create or replace function public.ensure_platform_service_referral_code_v1(p_member_id uuid,p_service_key text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; issued text;
begin
  if p_service_key is null or p_service_key not in ('care','telecom','rental','car') then raise exception 'invalid_input'; end if;
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then raise exception 'invalid_input'; end if;
  if m.terms_accepted_at is null and m.terms_basis is distinct from 'company_attested_import' then raise exception 'consent_required'; end if;
  select code into issued from platform_service_referral_codes where member_id=m.id and service_key=p_service_key;
  -- The member row lock serializes issuance, so a conflict can only be a code collision.
  while issued is null loop
    begin
      insert into platform_service_referral_codes(member_id,service_key,code)
        values(m.id,p_service_key,'S'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,11)))
        returning code into issued;
    exception when unique_violation then issued:=null;
    end;
  end loop;
  return jsonb_build_object('ok',true,'serviceKey',p_service_key,'code',issued);
end $$;

create or replace function public.get_platform_service_referral_v1(p_member_id uuid,p_service_key text)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare issued text; bound record;
begin
  if p_service_key is null or p_service_key not in ('care','telecom','rental','car') then raise exception 'invalid_input'; end if;
  select code into issued from platform_service_referral_codes where member_id=p_member_id and service_key=p_service_key;
  select r.source,r.created_at,m.name into bound
    from platform_service_referrals r join platform_members m on m.id=r.referrer_id
    where r.member_id=p_member_id and r.service_key=p_service_key;
  return jsonb_build_object('ok',true,'serviceKey',p_service_key,'code',issued,
    'referrer',case when bound.source is null then null
      else jsonb_build_object('name',bound.name,'source',bound.source,'createdAt',bound.created_at) end);
end $$;

create or replace function public.preview_platform_service_referral_v1(p_member_id uuid,p_service_key text,p_code text)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare inviter uuid;
begin
  inviter:=resolve_platform_service_referrer_v1(p_service_key,p_code);
  if inviter is null or inviter=p_member_id then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  return jsonb_build_object('ok',true,'serviceKey',p_service_key,
    'referrerName',(select name from platform_members where id=inviter));
end $$;

-- First binding wins. Members cannot replace a service referrer themselves;
-- repeating the same referrer is an idempotent success.
create or replace function public.bind_platform_service_referral_v1(p_member_id uuid,p_service_key text,p_code text,p_source text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; inviter uuid; existing platform_service_referrals;
begin
  if p_service_key is null or p_service_key not in ('care','telecom','rental','car')
    or p_source is null or p_source not in ('invite_signup','invite_confirmed','manual') then raise exception 'invalid_input'; end if;
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then raise exception 'invalid_input'; end if;
  if m.terms_accepted_at is null and m.terms_basis is distinct from 'company_attested_import' then raise exception 'consent_required'; end if;
  inviter:=resolve_platform_service_referrer_v1(p_service_key,p_code);
  if inviter is null or inviter=m.id then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_service_referral:'||p_service_key,741014));
  select * into existing from platform_service_referrals where member_id=m.id and service_key=p_service_key;
  if found then
    if existing.referrer_id=inviter then return jsonb_build_object('ok',true,'serviceKey',p_service_key,'alreadyBound',true); end if;
    return jsonb_build_object('ok',false,'code','referral_already_bound');
  end if;
  if exists(with recursive chain(id,path) as (
      select inviter,array[inviter]
      union all select r.referrer_id,c.path||r.referrer_id from platform_service_referrals r join chain c
        on r.member_id=c.id and r.service_key=p_service_key where not r.referrer_id=any(c.path)
    ) select from chain where id=m.id) then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  insert into platform_service_referrals(member_id,service_key,referrer_id,referral_code,source)
    values(m.id,p_service_key,inviter,upper(trim(p_code)),p_source);
  return jsonb_build_object('ok',true,'serviceKey',p_service_key,'alreadyBound',false);
end $$;

-- Signup through a service invitation creates the account and its service
-- referrer atomically. An unusable code rolls back the whole signup, after the
-- OTP was verified, so codes cannot be probed without a valid challenge.
create or replace function public.register_platform_member_v2(p_phone text,p_code_hash text,p_name text,
  p_password_hash text,p_password_salt text,p_service_key text,p_service_referral_code text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare registered jsonb; bound jsonb;
begin
  registered:=register_platform_member(p_phone,p_code_hash,p_name,p_password_hash,p_password_salt,null);
  if registered->>'ok' is distinct from 'true' then return registered; end if;
  bound:=bind_platform_service_referral_v1((registered->>'memberId')::uuid,p_service_key,p_service_referral_code,'invite_signup');
  if bound->>'ok' is distinct from 'true' then raise exception 'invalid_referral'; end if;
  return registered;
end $$;

create or replace function public.create_platform_application(p_member_id uuid,p_service_key text,p_details jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a platform_service_applications; m platform_members;
begin
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then raise exception 'member_unavailable'; end if;
  if p_service_key is null or p_service_key not in ('insurance','care','telecom','rental','car') or jsonb_typeof(p_details) is distinct from 'object'
    or (p_details-'region'-'requestType')<>'{}'::jsonb
    or jsonb_typeof(p_details->'region') is distinct from 'string' or jsonb_typeof(p_details->'requestType') is distinct from 'string'
    or length(p_details->>'region') not between 1 and 50 or length(p_details->>'requestType') not between 1 and 100
  then raise exception 'invalid_details'; end if;
  insert into platform_service_applications(member_id,service_key,details,referrer_id_snapshot,idempotency_key)
  values(m.id,p_service_key,p_details,(select referrer_id from platform_service_referrals
    where member_id=m.id and service_key=p_service_key),p_idempotency_key) on conflict(member_id,idempotency_key) do nothing;
  select * into a from platform_service_applications where member_id=m.id and idempotency_key=p_idempotency_key;
  if a.service_key<>p_service_key or a.details<>p_details then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('ok',true,'applicationId',a.id,'status',a.status);
end $$;

do $$ declare t text; f record; begin
  foreach t in array array['platform_service_referral_codes','platform_service_referrals'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('resolve_platform_service_referrer_v1','ensure_platform_service_referral_code_v1',
      'get_platform_service_referral_v1','preview_platform_service_referral_v1','bind_platform_service_referral_v1',
      'register_platform_member_v2','create_platform_application') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

-- 20261014140000_platform_withdrawal_drain_schedule
-- Finish admitted common withdrawals without waiting for the member to reopen
-- the app. The service-role key never enters source control: the operator
-- stores it once in Vault as 'platform_withdrawal_drain_service_key'. Until
-- then the job is a no-op. platform-service accepts the drain only with that
-- exact key in both apikey and Authorization headers and processes at most
-- three due jobs per call, each serialized by its own operation lock.
set local lock_timeout='3s';
set local statement_timeout='30s';
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.request_platform_withdrawal_drain_v1()
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets
    where name='platform_withdrawal_drain_service_key' limit 1;
  if coalesce(service_key,'')='' then return null; end if;
  -- Skip the call when nothing is due; the Edge drain re-checks under locks.
  if not exists(select from platform_account_withdrawals where not completed and next_attempt_at<=clock_timestamp()) then
    return null;
  end if;
  return net.http_post(
    url:='https://ubeginyxaotcamuqpmud.supabase.co/functions/v1/platform-service',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',service_key,'Authorization','Bearer '||service_key),
    body:=jsonb_build_object('action','withdrawal_cleanup_drain'),
    timeout_milliseconds:=60000);
end $$;
revoke all on function public.request_platform_withdrawal_drain_v1() from public,anon,authenticated,service_role;

select cron.unschedule(jobid) from cron.job where jobname='platform-withdrawal-cleanup-drain';
select cron.schedule('platform-withdrawal-cleanup-drain','*/5 * * * *',
  'select public.request_platform_withdrawal_drain_v1()');

-- 20261015030000_link_restored_fc_common_members
-- One-time repair after the 2026-10-14 FC roster restore. Restored completed
-- FC profiles kept their backup credentials while the owner had meanwhile
-- signed up to the common account on the same phone; the restore protected
-- common rows, so the two stayed unlinked and insurance enrollment refuses
-- the phone. Link each pair and keep the member's common password (user
-- decision 2026-10-15) as the single credential, matching enrollment.
set local lock_timeout='3s';
set local statement_timeout='60s';

do $$
declare
  pair record;
  c platform_member_credentials;
begin
  for pair in
    select m.id as member_id, m.phone, f.id as fc_id
    from platform_members m
    join fc_profiles f on f.phone=m.phone and f.signup_completed
      and not coalesce(f.is_manager_referral_shadow,false) and f.account_closed_at is null
    where m.active and m.fc_id is null and m.staff_account_id is null
      and not exists(select from platform_members linked where linked.fc_id=f.id)
    order by m.id
  loop
    -- Same per-phone lock order as signup, enrollment and withdrawal.
    perform pg_advisory_xact_lock(hashtextextended(pair.phone,741012));
    perform pg_advisory_xact_lock(hashtextextended(pair.phone,8102026));
    perform from fc_profiles where id=pair.fc_id for update;
    select * into c from platform_member_credentials where member_id=pair.member_id for update;
    if found then
      insert into fc_credentials(fc_id,password_hash,password_salt,password_set_at)
        values(pair.fc_id,c.password_hash,c.password_salt,c.password_set_at)
      on conflict(fc_id) do update set password_hash=excluded.password_hash,password_salt=excluded.password_salt,
        password_set_at=excluded.password_set_at,failed_count=0,locked_until=null,must_change_password=false,
        temporary_password_issued_at=null,reset_token_hash=null,reset_token_expires_at=null,reset_failed_count=0,
        updated_at=clock_timestamp();
    end if;
    update platform_members m set fc_id=pair.fc_id,
      insurance_consent_version=coalesce(m.insurance_consent_version,'insurance-additional-info-v1'),
      insurance_consent_source=coalesce(m.insurance_consent_source,'company_attested_import'),
      insurance_consent_recorded_at=coalesce(m.insurance_consent_recorded_at,cohort.recorded_at)
    from platform_legacy_membership_cohort cohort
    where m.id=pair.member_id and cohort.account_kind='fc' and cohort.account_id=pair.fc_id;
    -- Restored FCs outside the frozen company cohort link without inventing consent.
    update platform_members set fc_id=pair.fc_id where id=pair.member_id and fc_id is null;
    delete from platform_member_credentials where member_id=pair.member_id;
  end loop;
end $$;

-- 모두온 signup: confirm the SMS code on its own step before the password questions.
-- Same locks, expiry, lock-out and attempt counting as register_platform_member; the
-- challenge is not consumed, so the final signup still verifies the same code.
create or replace function public.check_platform_signup_otp(p_phone text,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_signup_challenges; checked_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  perform pg_advisory_xact_lock(hashtextextended(p_phone,8102026));
  select * into c from platform_signup_challenges where phone=p_phone for update;
  checked_at:=clock_timestamp();
  if not found or c.expires_at<=checked_at then return jsonb_build_object('ok',false,'code','expired_code'); end if;
  if c.locked_until>checked_at then return jsonb_build_object('ok',false,'code','locked'); end if;
  if c.code_hash is distinct from p_code_hash then
    update platform_signup_challenges set attempts=attempts+1,
      locked_until=case when attempts>=4 then checked_at+interval '10 minutes' else null end where phone=p_phone;
    return jsonb_build_object('ok',false,'code','invalid_code');
  end if;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.check_platform_signup_otp(text,text) from public,anon,authenticated;
grant execute on function public.check_platform_signup_otp(text,text) to service_role;

-- A member may leave one service. Leaving 가람in (insurance) erases only what
-- 가람in collected plus the FC/가람링크 account; the 모두온 account, its login,
-- other service applications and service referrers stay. Leaving 모두온 still
-- removes every service. Settled business history keeps its anonymized UUIDs.
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.platform_account_withdrawals
  add column scope text not null default 'all_affiliates' check (scope in ('all_affiliates','insurance'));
-- One 모두온 withdrawal per member; a member may leave 가람in again after re-registering.
alter table public.platform_account_withdrawals drop constraint platform_account_withdrawals_member_id_key;
create unique index platform_withdrawals_member_all on public.platform_account_withdrawals(member_id)
  where scope='all_affiliates';
create unique index platform_withdrawals_member_insurance_open on public.platform_account_withdrawals(member_id)
  where scope='insurance' and not completed;

-- Unlink 가람in from the common member. Enrollment moved the common password into
-- fc_credentials, so move a usable one back before the FC credential is removed.
create function public.detach_platform_member_insurance_v1(p_member_id uuid,p_fc_id uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  insert into platform_member_credentials(member_id,password_hash,password_salt,session_version,failed_count,
    locked_until,password_set_at,updated_at)
    select p_member_id,c.password_hash,c.password_salt,coalesce(c.session_version,0)+1,0,null,c.password_set_at,clock_timestamp()
      from fc_credentials c where c.fc_id=p_fc_id and c.password_set_at is not null
        and c.password_hash is not null and c.password_salt is not null and not coalesce(c.must_change_password,false)
    on conflict(member_id) do nothing;
  update platform_members set fc_id=null,insurance_consent_version=null,insurance_consent_source=null,
    insurance_consent_recorded_at=null,insurance_enrollment_key=null,insurance_enrollment_fingerprint=null,
    insurance_enrollment_member_version=null,insurance_enrollment_fc_version=null
    where id=p_member_id and fc_id=p_fc_id;
end $$;
revoke all on function public.detach_platform_member_insurance_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.detach_platform_member_insurance_v1(uuid,uuid) to service_role;

create function public.begin_platform_insurance_withdrawal_v1(
  p_member_id uuid,p_operation_id uuid,p_session_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; f fc_profiles; w platform_account_withdrawals; source_phone text; source_fc uuid;
begin
  if p_operation_id is null or p_member_id is null or p_session_digest is null
    or p_session_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,741014));
  select * into w from platform_account_withdrawals where operation_id=p_operation_id;
  if found then
    if w.member_id<>p_member_id or w.session_digest<>p_session_digest or w.scope<>'insurance' then raise exception 'forbidden'; end if;
    return to_jsonb(w);
  end if;
  select * into m from platform_members where id=p_member_id;
  if not found or not m.active or m.phone is null then raise exception 'member_unavailable'; end if;
  if m.fc_id is null or m.staff_account_id is not null then raise exception 'forbidden'; end if;
  source_phone:=m.phone; source_fc:=m.fc_id;
  -- Same lock order as insurance enrollment: phone domains, FC profile, member.
  perform pg_advisory_xact_lock(hashtextextended(source_phone,741012));
  perform pg_advisory_xact_lock(hashtextextended(source_phone,8102026));
  select * into f from fc_profiles where id=source_fc for update;
  if not found or f.phone<>source_phone or f.signup_completed is distinct from true
    or f.is_manager_referral_shadow or f.account_closed_at is not null then raise exception 'forbidden'; end if;
  select * into m from platform_members where id=p_member_id for update;
  if not m.active or m.phone is distinct from source_phone or m.fc_id is distinct from source_fc
    or m.staff_account_id is not null then raise exception 'forbidden'; end if;
  insert into platform_account_withdrawals(operation_id,member_id,session_digest,source_fc_id,scope)
    values(p_operation_id,m.id,p_session_digest,f.id,'insurance') returning * into w;
  perform set_config('moduon.withdrawal_operation_id',w.operation_id::text,true);
  update fc_profiles set account_closed_at=clock_timestamp(),signup_completed=false where id=f.id;
  perform set_config('moduon.withdrawal_operation_id','',true);
  perform detach_platform_member_insurance_v1(m.id,f.id);
  delete from fc_credentials where fc_id=f.id;
  delete from fc_signup_completion_challenges where fc_id=f.id;
  return to_jsonb(w);
end $$;
revoke all on function public.begin_platform_insurance_withdrawal_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_platform_insurance_withdrawal_v1(uuid,uuid,text) to service_role;

-- The erase step closes the FC account for both scopes; only a 모두온 withdrawal
-- erases the common member.
create or replace function public.erase_platform_withdrawal_v1(
  p_operation_id uuid,p_session_digest text,p_affiliate_state text,p_preserved_company_role text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare w platform_account_withdrawals; receipt jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,741014));
  select * into w from platform_account_withdrawals
    where operation_id=p_operation_id and session_digest=p_session_digest;
  if not found then raise exception 'forbidden'; end if;
  if w.local_erased then return to_jsonb(w); end if;
  if w.source_fc_id is not null then
    if p_affiliate_state not in ('erased','company_account_preserved') or p_affiliate_state is null
      or (p_affiliate_state='company_account_preserved' and
        coalesce(p_preserved_company_role,'') not in ('admin','manager','designer','developer')) then raise exception 'affiliate_receipt_required'; end if;
    perform from fc_profiles where id=w.source_fc_id for update;
  elsif p_affiliate_state is distinct from 'not_applicable' then raise exception 'forbidden'; end if;
  perform from platform_members where id=w.member_id for update;
  if w.source_fc_id is not null then
    perform set_config('moduon.fc_closure_id',w.source_fc_id::text,true);
    receipt:=delete_account_core_transaction_v1('fc',w.source_fc_id);
    perform set_config('moduon.fc_closure_id','',true);
  end if;
  -- Reuse the existing erase-only function. It does not call the core delete
  -- transaction, so BEFORE DELETE projection triggers cannot recurse.
  if w.scope='all_affiliates' then perform delete_platform_member(w.member_id); end if;
  update platform_account_withdrawals set local_erased=true,cleanup_receipt=receipt,
    cleanup_outbox_id=(receipt->>'cleanup_outbox_id')::uuid,
    preserved_company_role=coalesce(p_preserved_company_role,preserved_company_role)
    where operation_id=w.operation_id returning * into w;
  return to_jsonb(w);
end $$;

-- 모두온 withdrawal removes every service: applications without a settlement are
-- deleted; settled ones keep only their anonymized UUID for settlement checks.
create or replace function public.delete_platform_member(p_member_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members;
begin
  select * into m from platform_members where id=p_member_id for update;
  if not found then raise exception 'member_unavailable'; end if;
  delete from platform_member_credentials where member_id=m.id;
  delete from platform_signup_challenges where phone=m.phone or consumed_member_id=m.id;
  delete from platform_service_applications a where a.member_id=m.id
    and not exists(select from platform_partner_settlements s where s.application_id=a.id);
  update platform_service_applications set details='{"region":"삭제","requestType":"삭제"}'::jsonb,
    status=case when status='interest' then 'cancelled' else status end where member_id=m.id;
  -- Erase live source bindings and direct identifying fields. Restricted source
  -- tombstones/cohort associations remain solely as no-auto-import/audit evidence.
  update platform_members set phone=null,name='탈퇴 회원',active=false,fc_id=null,
    staff_account_kind=null,staff_account_id=null,terms_accepted_at=null,terms_version=null,
    terms_basis=null,terms_recorded_at=null,insurance_consent_version=null,
    insurance_consent_source=null,insurance_consent_recorded_at=null,
    insurance_enrollment_key=null,insurance_enrollment_fingerprint=null,
    insurance_enrollment_member_version=null,insurance_enrollment_fc_version=null,
    withdrawal_source_kind=coalesce(withdrawal_source_kind,case when m.fc_id is not null then 'fc'
      when m.staff_account_id is not null then m.staff_account_kind else 'member' end),
    withdrawal_source_id=coalesce(withdrawal_source_id,m.fc_id,m.staff_account_id,m.id)
    where id=m.id;
  return jsonb_build_object('ok',true,'deleted',true);
end $$;

-- Deleting only the insurance account (FC hard delete) detaches it from the
-- common member instead of withdrawing the whole 모두온 account. Company staff
-- account deletion keeps its existing full erase.
create or replace function public.erase_platform_fc_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare mapped uuid;
begin
  if tg_table_name='fc_profiles' then
    select id into mapped from platform_members where fc_id=old.id for update;
    if mapped is not null then perform detach_platform_member_insurance_v1(mapped,old.id); end if;
  else
    select id into mapped from platform_members where
      staff_account_kind=case tg_table_name when 'admin_accounts' then 'admin' when 'manager_accounts' then 'manager' end
      and staff_account_id=old.id for update;
    if mapped is not null then perform delete_platform_member(mapped); end if;
    delete from platform_signup_challenges where phone=old.phone;
  end if;
  return old;
end $$;
-- 20261016100000_messenger_unified_model
-- Messenger stage 1: unified data model.
-- People (actors), organizations, memberships, conversations, participants,
-- messages and events with one per-conversation sequence counter.
-- Legacy messenger tables stay the source of truth until stage 2. These tables
-- are filled by messenger_backfill_v1() and kept in step by dual-write
-- triggers (next migration). All access is service_role only.

create table if not exists public.messenger_actors (
  id uuid primary key default gen_random_uuid(),
  display_name text not null default '',
  phone text check (phone is null or phone ~ '^[0-9]{9,11}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Not unique: a reused phone number must not silently merge two people.
create index if not exists idx_messenger_actors_phone
  on public.messenger_actors (phone) where phone is not null;

create table if not exists public.messenger_actor_links (
  source_kind text not null check (
    source_kind in ('fc', 'admin', 'manager', 'platform_member', 'request_board_user')
  ),
  source_id text not null check (char_length(source_id) between 1 and 64),
  actor_id uuid not null references public.messenger_actors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source_kind, source_id)
);
create index if not exists idx_messenger_actor_links_actor
  on public.messenger_actor_links (actor_id);

create table if not exists public.messenger_orgs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('garam', 'moduon_ops', 'partner')),
  parent_id uuid references public.messenger_orgs(id) on delete restrict,
  partner_id uuid unique references public.platform_partners(id) on delete restrict,
  slug text unique check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'partner') = (partner_id is not null)),
  check (parent_id is null or parent_id <> id)
);

create table if not exists public.messenger_org_members (
  org_id uuid not null references public.messenger_orgs(id) on delete cascade,
  actor_id uuid not null references public.messenger_actors(id) on delete cascade,
  role text not null check (
    role in ('fc', 'manager', 'admin', 'developer', 'designer', 'agent', 'org_admin')
  ),
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  approved_by_actor_id uuid references public.messenger_actors(id) on delete set null,
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, actor_id, role),
  check (status <> 'approved' or approved_at is not null),
  check (status <> 'revoked' or revoked_at is not null)
);
create index if not exists idx_messenger_org_members_actor
  on public.messenger_org_members (actor_id) where status = 'approved';

-- Operators allowed to approve partner staff memberships (decision 2026-10-16:
-- start with the owner's own admin account; allowlist so it can grow later).
create table if not exists public.messenger_member_approvers (
  actor_id uuid primary key references public.messenger_actors(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group', 'org_room', 'shared')),
  owner_org_id uuid references public.messenger_orgs(id) on delete restrict,
  subject_actor_id uuid references public.messenger_actors(id) on delete restrict,
  direct_key text unique,
  title text,
  last_event_seq bigint not null default 0 check (last_event_seq >= 0),
  last_message_seq bigint,
  last_message_at timestamptz,
  pinned_notice_seq bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'direct') = (direct_key is not null)),
  check (kind <> 'direct' or (owner_org_id is null and subject_actor_id is null)),
  check (kind <> 'org_room' or (owner_org_id is not null and subject_actor_id is not null)),
  check (kind not in ('group', 'shared') or owner_org_id is not null)
);
-- One room per (organization, customer).
create unique index if not exists idx_messenger_conversations_org_room
  on public.messenger_conversations (owner_org_id, subject_actor_id)
  where kind = 'org_room';

create table if not exists public.messenger_conversation_orgs (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  org_id uuid not null references public.messenger_orgs(id) on delete cascade,
  last_read_seq bigint not null default 0 check (last_read_seq >= 0),
  created_at timestamptz not null default now(),
  primary key (conversation_id, org_id)
);
create index if not exists idx_messenger_conversation_orgs_org
  on public.messenger_conversation_orgs (org_id);

create table if not exists public.messenger_participants (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  actor_id uuid not null references public.messenger_actors(id) on delete cascade,
  -- 'agent' rows only hold an org agent's own read position and preferences;
  -- access to org rooms comes from approved org membership, never from this row.
  role text not null default 'member' check (role in ('member', 'owner', 'subject', 'agent')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  last_read_seq bigint not null default 0 check (last_read_seq >= 0),
  muted boolean not null default false,
  pinned_at timestamptz,
  can_send boolean not null default true,
  blocked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, actor_id)
);
create index if not exists idx_messenger_participants_actor
  on public.messenger_participants (actor_id) where left_at is null;

create table if not exists public.messenger_messages (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  seq bigint not null check (seq > 0),
  id uuid not null unique,
  sender_actor_id uuid references public.messenger_actors(id) on delete set null,
  sender_org_id uuid references public.messenger_orgs(id) on delete set null,
  kind text not null check (kind in ('text', 'image', 'file', 'system')),
  content text not null default '',
  reply_to_seq bigint,
  context jsonb,
  attachment_batch_id uuid,
  legacy_file_url text,
  legacy_file_name text,
  legacy_file_size bigint,
  client_message_id uuid,
  created_at timestamptz not null,
  deleted_at timestamptz,
  deleted_by_actor_id uuid references public.messenger_actors(id) on delete set null,
  primary key (conversation_id, seq),
  check (context is null or jsonb_typeof(context) = 'object')
);
create unique index if not exists idx_messenger_messages_client_id
  on public.messenger_messages (sender_actor_id, client_message_id)
  where client_message_id is not null;
create index if not exists idx_messenger_messages_conversation_created
  on public.messenger_messages (conversation_id, created_at);

create table if not exists public.messenger_events (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  event_seq bigint not null check (event_seq > 0),
  type text not null check (type in ('message', 'delete', 'reaction', 'read', 'notice', 'member')),
  message_seq bigint,
  actor_id uuid references public.messenger_actors(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (conversation_id, event_seq)
);

create table if not exists public.messenger_reactions (
  conversation_id uuid not null,
  message_seq bigint not null,
  actor_id uuid not null references public.messenger_actors(id) on delete cascade,
  reaction text not null check (char_length(reaction) between 1 and 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, message_seq, actor_id),
  foreign key (conversation_id, message_seq)
    references public.messenger_messages(conversation_id, seq) on delete cascade
);

-- Legacy room -> new conversation. Dual-write triggers only mirror rooms that
-- are mapped here, so a room is never half-filled before its backfill.
create table if not exists public.messenger_legacy_map (
  source_kind text not null check (
    source_kind in ('garamin_direct_thread', 'group_chat_room', 'request_board_pair', 'request_board_direct')
  ),
  source_key text not null,
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source_kind, source_key)
);
create index if not exists idx_messenger_legacy_map_conversation
  on public.messenger_legacy_map (conversation_id);

-- Rows the backfill or dual-write could not map, for operator review.
create table if not exists public.messenger_sync_issues (
  id bigint generated always as identity primary key,
  source text not null,
  source_key text,
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.messenger_reconcile_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  result jsonb not null
);

-- Hands out the next sequence number of a conversation. The row lock taken by
-- the update serializes writers of one conversation, so sequences have no gaps
-- or duplicates within a room.
create or replace function public.messenger_next_seq(p_conversation_id uuid)
returns bigint
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_seq bigint;
begin
  update public.messenger_conversations
     set last_event_seq = last_event_seq + 1,
         updated_at = now()
   where id = p_conversation_id
  returning last_event_seq into v_seq;
  if v_seq is null then
    raise exception 'messenger_conversation_not_found';
  end if;
  return v_seq;
end;
$$;

-- Appends one message (idempotent on message id) and its 'message' event.
create or replace function public.messenger_append_message(
  p_conversation_id uuid,
  p_id uuid,
  p_sender_actor_id uuid,
  p_sender_org_id uuid,
  p_kind text,
  p_content text,
  p_created_at timestamptz,
  p_context jsonb default null,
  p_attachment_batch_id uuid default null,
  p_legacy_file_url text default null,
  p_legacy_file_name text default null,
  p_legacy_file_size bigint default null,
  p_client_message_id uuid default null
) returns bigint
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_existing record;
  v_seq bigint;
begin
  select conversation_id, seq into v_existing
    from public.messenger_messages where id = p_id;
  if found then
    if v_existing.conversation_id <> p_conversation_id then
      raise exception 'messenger_message_conversation_conflict';
    end if;
    return v_existing.seq;
  end if;

  v_seq := public.messenger_next_seq(p_conversation_id);
  insert into public.messenger_messages (
    conversation_id, seq, id, sender_actor_id, sender_org_id, kind, content,
    context, attachment_batch_id, legacy_file_url, legacy_file_name,
    legacy_file_size, client_message_id, created_at
  ) values (
    p_conversation_id, v_seq, p_id, p_sender_actor_id, p_sender_org_id, p_kind,
    coalesce(p_content, ''), p_context, p_attachment_batch_id, p_legacy_file_url,
    p_legacy_file_name, p_legacy_file_size, p_client_message_id, p_created_at
  );
  insert into public.messenger_events (conversation_id, event_seq, type, message_seq, actor_id, created_at)
  values (p_conversation_id, v_seq, 'message', v_seq, p_sender_actor_id, p_created_at);
  update public.messenger_conversations
     set last_message_seq = v_seq,
         last_message_at = greatest(coalesce(last_message_at, p_created_at), p_created_at)
   where id = p_conversation_id;
  return v_seq;
end;
$$;

-- Records a non-message change as its own event so clients can sync with one
-- "events after N" cursor.
create or replace function public.messenger_record_event(
  p_conversation_id uuid,
  p_type text,
  p_message_seq bigint,
  p_actor_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns bigint
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_seq bigint;
begin
  v_seq := public.messenger_next_seq(p_conversation_id);
  insert into public.messenger_events (conversation_id, event_seq, type, message_seq, actor_id, payload)
  values (p_conversation_id, v_seq, p_type, p_message_seq, p_actor_id, coalesce(p_payload, '{}'::jsonb));
  return v_seq;
end;
$$;

-- Single place that decides who may read a conversation.
create or replace function public.messenger_can_access(p_actor_id uuid, p_conversation_id uuid)
returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.messenger_participants p
     where p.conversation_id = p_conversation_id
       and p.actor_id = p_actor_id
       and p.role <> 'agent'
       and p.left_at is null
  ) or exists (
    select 1
      from public.messenger_conversation_orgs co
      join public.messenger_org_members m
        on m.org_id = co.org_id and m.actor_id = p_actor_id and m.status = 'approved'
      join public.messenger_orgs o on o.id = co.org_id and o.active
     where co.conversation_id = p_conversation_id
  );
$$;

-- Who may open an org room (decisions 2026-10-16): a customer may always contact
-- an active partner; an approved agent may contact a customer first only when
-- that customer applied for the partner's service, and never after a block.
create or replace function public.messenger_can_start_org_room(
  p_initiator_actor_id uuid,
  p_org_id uuid,
  p_subject_actor_id uuid
) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_org public.messenger_orgs%rowtype;
  v_service_key text;
begin
  select * into v_org from public.messenger_orgs where id = p_org_id;
  if not found or not v_org.active then
    return false;
  end if;
  if exists (
    select 1
      from public.messenger_conversations c
      join public.messenger_participants p
        on p.conversation_id = c.id and p.actor_id = p_subject_actor_id
     where c.kind = 'org_room' and c.owner_org_id = p_org_id
       and c.subject_actor_id = p_subject_actor_id and p.blocked_at is not null
  ) then
    return false;
  end if;
  if p_initiator_actor_id = p_subject_actor_id then
    return true;
  end if;
  if not exists (
    select 1 from public.messenger_org_members
     where org_id = p_org_id and actor_id = p_initiator_actor_id and status = 'approved'
  ) then
    return false;
  end if;
  if v_org.kind <> 'partner' then
    return true;
  end if;
  select service_key into v_service_key from public.platform_partners where id = v_org.partner_id;
  return exists (
    select 1
      from public.messenger_actor_links l
      join public.platform_service_applications a
        on a.member_id::text = l.source_id and a.service_key = v_service_key
     where l.actor_id = p_subject_actor_id and l.source_kind = 'platform_member'
  );
end;
$$;

-- Approves or revokes a membership. Only allowlisted operators may decide.
create or replace function public.messenger_decide_org_member(
  p_approver_actor_id uuid,
  p_org_id uuid,
  p_actor_id uuid,
  p_role text,
  p_approve boolean
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_row public.messenger_org_members%rowtype;
begin
  if not exists (select 1 from public.messenger_member_approvers where actor_id = p_approver_actor_id) then
    raise exception 'messenger_approver_forbidden';
  end if;
  update public.messenger_org_members
     set status = case when p_approve then 'approved' else 'revoked' end,
         approved_by_actor_id = case when p_approve then p_approver_actor_id else approved_by_actor_id end,
         approved_at = case when p_approve then now() else approved_at end,
         revoked_at = case when p_approve then null else now() end,
         updated_at = now()
   where org_id = p_org_id and actor_id = p_actor_id and role = p_role
  returning * into v_row;
  if not found then
    raise exception 'messenger_membership_not_found';
  end if;
  return jsonb_build_object('orgId', v_row.org_id, 'actorId', v_row.actor_id, 'role', v_row.role, 'status', v_row.status);
end;
$$;

do $$
declare
  t text;
  f record;
begin
  foreach t in array array[
    'messenger_actors', 'messenger_actor_links', 'messenger_orgs', 'messenger_org_members',
    'messenger_member_approvers', 'messenger_conversations', 'messenger_conversation_orgs',
    'messenger_participants', 'messenger_messages', 'messenger_events', 'messenger_reactions',
    'messenger_legacy_map', 'messenger_sync_issues', 'messenger_reconcile_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'messenger_next_seq', 'messenger_append_message', 'messenger_record_event',
         'messenger_can_access', 'messenger_can_start_org_room', 'messenger_decide_org_member'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end;
$$;

-- 20261016100100_messenger_unified_backfill
-- Messenger stage 1: backfill, dual-write triggers, reconciliation and the
-- GaramLink (request board) import entry point.
-- Legacy tables remain the source of truth. Dual-write triggers never raise:
-- a mirroring failure is written to messenger_sync_issues and the legacy write
-- still succeeds. Unmapped rooms are filled by the next messenger_backfill_v1().

create or replace function public.messenger_normalize_phone(p_phone text)
returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
    when regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') ~ '^[0-9]{9,11}$'
      then regexp_replace(p_phone, '[^0-9]', '', 'g')
  end;
$$;

create or replace function public.messenger_actor_for(p_kind text, p_source_id text)
returns uuid
language sql stable set search_path = public, pg_temp as $$
  select actor_id from public.messenger_actor_links
   where source_kind = p_kind and source_id = p_source_id;
$$;

-- Account uuid (fc/admin/manager) -> actor, for legacy *_actor_id columns.
create or replace function public.messenger_actor_for_account(p_account_id uuid)
returns uuid
language sql stable set search_path = public, pg_temp as $$
  select actor_id from public.messenger_actor_links
   where source_id = p_account_id::text and source_kind in ('fc', 'manager', 'admin')
   order by case source_kind when 'fc' then 0 when 'manager' then 1 else 2 end
   limit 1;
$$;

-- Group chat actor key '{role}:{phone}' -> actor.
create or replace function public.messenger_actor_for_group_key(p_key text)
returns uuid
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_role text := split_part(coalesce(p_key, ''), ':', 1);
  v_phone text := public.messenger_normalize_phone(split_part(coalesce(p_key, ''), ':', 2));
  v_id uuid;
begin
  if v_phone is null then
    return null;
  end if;
  if v_role = 'fc' then
    select id into v_id from public.fc_profiles where phone = v_phone limit 1;
    return public.messenger_actor_for('fc', v_id::text);
  elsif v_role = 'manager' then
    select id into v_id from public.manager_accounts where phone = v_phone;
    return public.messenger_actor_for('manager', v_id::text);
  elsif v_role = 'admin' then
    select id into v_id from public.admin_accounts where phone = v_phone;
    return public.messenger_actor_for('admin', v_id::text);
  end if;
  return null;
end;
$$;

-- Finds or creates the person behind one source account. A new account joins an
-- existing person only when exactly one person already has that phone; two or
-- more candidates are recorded as an issue instead of guessing.
create or replace function public.messenger_ensure_actor(
  p_kind text,
  p_source_id text,
  p_name text,
  p_phone text
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_phone text := public.messenger_normalize_phone(p_phone);
  v_candidates uuid[];
begin
  if p_source_id is null then
    return null;
  end if;
  v_actor := public.messenger_actor_for(p_kind, p_source_id);
  if v_actor is not null then
    return v_actor;
  end if;
  if v_phone is not null then
    select array_agg(distinct id) into v_candidates
      from public.messenger_actors where phone = v_phone;
    if cardinality(v_candidates) = 1 then
      v_actor := v_candidates[1];
    elsif cardinality(v_candidates) > 1 then
      insert into public.messenger_sync_issues (source, source_key, reason, detail)
      values ('actor', p_kind || ':' || p_source_id, 'ambiguous_phone',
              jsonb_build_object('candidates', to_jsonb(v_candidates)));
    end if;
  end if;
  if v_actor is null then
    insert into public.messenger_actors (display_name, phone)
    values (coalesce(nullif(trim(p_name), ''), ''), v_phone)
    returning id into v_actor;
  end if;
  insert into public.messenger_actor_links (source_kind, source_id, actor_id)
  values (p_kind, p_source_id, v_actor)
  on conflict (source_kind, source_id) do nothing;
  return public.messenger_actor_for(p_kind, p_source_id);
end;
$$;

create or replace function public.messenger_org_by_slug(p_slug text)
returns uuid
language sql stable set search_path = public, pg_temp as $$
  select id from public.messenger_orgs where slug = p_slug;
$$;

-- Records an open issue once per (source, key, reason); re-runs add nothing.
create or replace function public.messenger_record_issue_once(
  p_source text,
  p_source_key text,
  p_reason text,
  p_detail jsonb default '{}'::jsonb
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.messenger_sync_issues (source, source_key, reason, detail)
  select p_source, p_source_key, p_reason, p_detail
   where not exists (
     select 1 from public.messenger_sync_issues
      where source = p_source and source_key is not distinct from p_source_key
        and reason = p_reason and resolved_at is null
   );
$$;

-- Ensures the conversation for one legacy 1:1 thread and maps it.
create or replace function public.messenger_ensure_direct_thread(p_thread_id uuid)
returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_thread record;
  v_fc uuid;
  v_staff uuid;
  v_garam uuid := public.messenger_org_by_slug('garam');
  v_conversation uuid;
  v_key text;
begin
  select conversation_id into v_conversation from public.messenger_legacy_map
   where source_kind = 'garamin_direct_thread' and source_key = p_thread_id::text;
  if found then
    return v_conversation;
  end if;
  select t.id, t.counterparty_role, t.counterparty_actor_id, c.fc_id into v_thread
    from public.garamin_direct_threads t
    join public.garamin_direct_conversations c on c.id = t.legacy_conversation_id
   where t.id = p_thread_id;
  if not found then
    return null;
  end if;
  v_fc := public.messenger_actor_for('fc', v_thread.fc_id::text);
  if v_fc is null then
    perform public.messenger_record_issue_once('garamin_direct_thread', p_thread_id::text, 'fc_actor_missing');
    return null;
  end if;

  if v_thread.counterparty_role = 'admin' then
    select id into v_conversation from public.messenger_conversations
     where kind = 'org_room' and owner_org_id = v_garam and subject_actor_id = v_fc;
    if v_conversation is null then
      insert into public.messenger_conversations (kind, owner_org_id, subject_actor_id)
      values ('org_room', v_garam, v_fc) returning id into v_conversation;
    end if;
    insert into public.messenger_conversation_orgs (conversation_id, org_id)
    values (v_conversation, v_garam) on conflict do nothing;
    insert into public.messenger_participants (conversation_id, actor_id, role)
    values (v_conversation, v_fc, 'subject') on conflict do nothing;
  else
    v_staff := public.messenger_actor_for(
      case v_thread.counterparty_role when 'manager' then 'manager' else 'admin' end,
      v_thread.counterparty_actor_id::text
    );
    if v_staff is null then
      -- Decision 2026-10-16: a thread whose staff account is gone and that has
      -- no messages is only recorded. Once it has messages it blocks again.
      if exists (select 1 from public.messages where thread_id = p_thread_id) then
        perform public.messenger_record_issue_once('garamin_direct_thread', p_thread_id::text, 'staff_actor_missing');
      else
        update public.messenger_sync_issues set resolved_at = now()
         where source = 'garamin_direct_thread' and source_key = p_thread_id::text
           and reason = 'staff_actor_missing' and resolved_at is null;
        perform public.messenger_record_issue_once('garamin_direct_thread', p_thread_id::text,
          'thread_counterparty_missing_empty');
      end if;
      return null;
    end if;
    v_key := least(v_fc::text, v_staff::text) || ':' || greatest(v_fc::text, v_staff::text);
    insert into public.messenger_conversations (kind, direct_key)
    values ('direct', v_key)
    on conflict (direct_key) do update set updated_at = public.messenger_conversations.updated_at
    returning id into v_conversation;
    insert into public.messenger_participants (conversation_id, actor_id)
    values (v_conversation, v_fc), (v_conversation, v_staff) on conflict do nothing;
  end if;

  insert into public.messenger_legacy_map (source_kind, source_key, conversation_id)
  values ('garamin_direct_thread', p_thread_id::text, v_conversation);
  return v_conversation;
end;
$$;

-- The one person with this phone, or null when none or several match.
create or replace function public.messenger_actor_by_phone(p_phone text)
returns uuid
language sql stable set search_path = public, pg_temp as $$
  select case when count(*) = 1 then (array_agg(id))[1] end
    from public.messenger_actors
   where phone = public.messenger_normalize_phone(p_phone);
$$;

-- Sender of one legacy 1:1 message: the account uuid when recorded, otherwise
-- the person with the sender phone ('admin' means the shared Garam inbox).
create or replace function public.messenger_direct_sender(
  p_sender_id text,
  p_sender_actor_id uuid,
  p_fc_actor uuid,
  p_fc_phone text
) returns uuid
language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    public.messenger_actor_for_account(p_sender_actor_id),
    case when public.messenger_normalize_phone(p_sender_id) = public.messenger_normalize_phone(p_fc_phone)
      then p_fc_actor end,
    case when p_sender_id <> 'admin' then public.messenger_actor_by_phone(p_sender_id) end
  );
$$;

-- Legacy 1:1 messages saved without a thread are placed into a conversation by
-- the phones on both sides (decision 2026-10-16). Deleted ones and ones whose
-- other side no longer exists are not moved; they are recorded as issues.
create table if not exists public.messenger_orphan_placements (
  message_id uuid primary key,
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  placed_at timestamptz not null default now()
);
create index if not exists idx_messenger_orphan_placements_conversation
  on public.messenger_orphan_placements (conversation_id);
alter table public.messenger_orphan_placements enable row level security;
revoke all on public.messenger_orphan_placements from public, anon, authenticated;
grant select, insert, update, delete on public.messenger_orphan_placements to service_role;

create or replace function public.messenger_record_orphan_issue(
  p_message_id uuid,
  p_reason text,
  p_detail jsonb default '{}'::jsonb
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.messenger_sync_issues (source, source_key, reason, detail)
  select 'messages', p_message_id::text, p_reason, p_detail
   where not exists (
     select 1 from public.messenger_sync_issues
      where source = 'messages' and source_key = p_message_id::text and reason = p_reason
   );
$$;

create or replace function public.messenger_place_orphan_messages()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  m record;
  v_sender uuid;
  v_receiver uuid;
  v_subject uuid;
  v_conversation uuid;
  v_garam uuid := public.messenger_org_by_slug('garam');
  v_placed integer := 0;
  v_skipped integer := 0;
begin
  for m in
    select l.* from public.messages l
     where l.thread_id is null
       and not exists (select 1 from public.messenger_orphan_placements p where p.message_id = l.id)
     order by l.created_at, l.id
  loop
    if m.deleted_at is not null then
      perform public.messenger_record_orphan_issue(m.id, 'orphan_deleted_skipped');
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_sender := case when m.sender_id = 'admin' then null
                     else coalesce(public.messenger_actor_for_account(m.sender_actor_id),
                                   public.messenger_actor_by_phone(m.sender_id)) end;
    v_receiver := case when m.receiver_id = 'admin' then null
                       else coalesce(public.messenger_actor_for_account(m.receiver_actor_id),
                                     public.messenger_actor_by_phone(m.receiver_id)) end;
    if (m.sender_id <> 'admin' and v_sender is null)
       or (m.receiver_id <> 'admin' and v_receiver is null)
       or (m.sender_id = 'admin' and m.receiver_id = 'admin') then
      perform public.messenger_record_orphan_issue(m.id, 'orphan_participant_missing',
        jsonb_build_object('senderFound', v_sender is not null or m.sender_id = 'admin',
                           'receiverFound', v_receiver is not null or m.receiver_id = 'admin'));
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if m.sender_id = 'admin' or m.receiver_id = 'admin' then
      v_subject := coalesce(v_sender, v_receiver);
      select id into v_conversation from public.messenger_conversations
       where kind = 'org_room' and owner_org_id = v_garam and subject_actor_id = v_subject;
      if v_conversation is null then
        insert into public.messenger_conversations (kind, owner_org_id, subject_actor_id)
        values ('org_room', v_garam, v_subject) returning id into v_conversation;
      end if;
      insert into public.messenger_conversation_orgs (conversation_id, org_id)
      values (v_conversation, v_garam) on conflict do nothing;
      insert into public.messenger_participants (conversation_id, actor_id, role)
      values (v_conversation, v_subject, 'subject') on conflict do nothing;
    elsif v_sender = v_receiver then
      perform public.messenger_record_orphan_issue(m.id, 'orphan_self_message');
      v_skipped := v_skipped + 1;
      continue;
    else
      insert into public.messenger_conversations (kind, direct_key)
      values ('direct', least(v_sender::text, v_receiver::text) || ':' || greatest(v_sender::text, v_receiver::text))
      on conflict (direct_key) do update set updated_at = public.messenger_conversations.updated_at
      returning id into v_conversation;
      insert into public.messenger_participants (conversation_id, actor_id)
      values (v_conversation, v_sender), (v_conversation, v_receiver) on conflict do nothing;
    end if;
    insert into public.messenger_orphan_placements (message_id, conversation_id)
    values (m.id, v_conversation);
    v_placed := v_placed + 1;
  end loop;
  return jsonb_build_object('placed', v_placed, 'skipped', v_skipped);
end;
$$;

-- Copies every not-yet-mirrored legacy 1:1 message of one conversation (its
-- mapped threads plus placed thread-less messages) in (created_at, id) order,
-- then derives read positions from is_read.
create or replace function public.messenger_fill_direct_conversation(p_conversation_id uuid)
returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_conv public.messenger_conversations%rowtype;
  v_inserted integer := 0;
  v_late integer := 0;
begin
  select * into v_conv from public.messenger_conversations where id = p_conversation_id for update;
  if not found then
    return 0;
  end if;

  select count(*) into v_late
    from public.messages m
   where (m.thread_id::text in (select source_key from public.messenger_legacy_map
                                 where source_kind = 'garamin_direct_thread' and conversation_id = p_conversation_id)
          or m.id in (select message_id from public.messenger_orphan_placements where conversation_id = p_conversation_id))
     and not exists (select 1 from public.messenger_messages x where x.id = m.id)
     and v_conv.last_message_at is not null and m.created_at < v_conv.last_message_at;
  if v_late > 0 then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('messenger_conversation', p_conversation_id::text, 'late_backfill_out_of_order',
            jsonb_build_object('count', v_late));
  end if;

  with src as (
    select m.*,
           coalesce(public.messenger_actor_for_account(m.sender_actor_id),
                    case when m.sender_id <> 'admin' then public.messenger_actor_by_phone(m.sender_id) end) as sender_actor,
           row_number() over (order by m.created_at, m.id) as rn
      from public.messages m
     where (m.thread_id::text in (select source_key from public.messenger_legacy_map
                                   where source_kind = 'garamin_direct_thread' and conversation_id = p_conversation_id)
            or m.id in (select message_id from public.messenger_orphan_placements where conversation_id = p_conversation_id))
       and not exists (select 1 from public.messenger_messages x where x.id = m.id)
  ), ins as (
    insert into public.messenger_messages (
      conversation_id, seq, id, sender_actor_id, sender_org_id, kind, content,
      attachment_batch_id, legacy_file_url, legacy_file_name, legacy_file_size,
      created_at, deleted_at, deleted_by_actor_id
    )
    select p_conversation_id, v_conv.last_event_seq + src.rn, src.id, src.sender_actor,
           case when v_conv.kind = 'org_room' and src.sender_actor is distinct from v_conv.subject_actor_id
             then v_conv.owner_org_id end,
           case when src.message_type in ('text', 'image', 'file') then src.message_type else 'text' end,
           coalesce(src.content, ''), src.attachment_batch_id, src.file_url, src.file_name, src.file_size,
           src.created_at, src.deleted_at, public.messenger_actor_for_account(src.deleted_by_actor_id)
      from src
    returning conversation_id, seq, sender_actor_id, created_at
  ), ev as (
    insert into public.messenger_events (conversation_id, event_seq, type, message_seq, actor_id, created_at)
    select conversation_id, seq, 'message', seq, sender_actor_id, created_at from ins
    returning event_seq
  )
  select count(*) into v_inserted from ev;

  if v_inserted > 0 then
    update public.messenger_conversations c
       set last_event_seq = c.last_event_seq + v_inserted,
           last_message_seq = c.last_event_seq + v_inserted,
           last_message_at = (select max(created_at) from public.messenger_messages where conversation_id = p_conversation_id),
           updated_at = now()
     where c.id = p_conversation_id;
  end if;

  -- Each person read up to the newest message from someone else that the
  -- legacy row marks read; in org rooms the owning org reads the subject's.
  update public.messenger_participants p
     set last_read_seq = greatest(p.last_read_seq, coalesce((
           select max(mm.seq) from public.messenger_messages mm
             join public.messages lm on lm.id = mm.id
            where mm.conversation_id = p_conversation_id and lm.is_read
              and mm.sender_actor_id is distinct from p.actor_id), 0)),
         updated_at = now()
   where p.conversation_id = p_conversation_id and p.role <> 'agent';
  if v_conv.kind = 'org_room' then
    update public.messenger_conversation_orgs co
       set last_read_seq = greatest(co.last_read_seq, coalesce((
             select max(mm.seq) from public.messenger_messages mm
               join public.messages lm on lm.id = mm.id
              where mm.conversation_id = p_conversation_id and lm.is_read
                and mm.sender_actor_id = v_conv.subject_actor_id), 0))
     where co.conversation_id = p_conversation_id and co.org_id = v_conv.owner_org_id;
  end if;
  return v_inserted;
end;
$$;

create or replace function public.messenger_fill_direct_thread(p_thread_id uuid)
returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_conversation uuid := public.messenger_ensure_direct_thread(p_thread_id);
begin
  if v_conversation is null then
    return 0;
  end if;
  return public.messenger_fill_direct_conversation(v_conversation);
end;
$$;

-- Ensures the conversation for one group chat room, its participants and map.
create or replace function public.messenger_ensure_group_room(p_room_id uuid)
returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_room public.group_chat_rooms%rowtype;
  v_garam uuid := public.messenger_org_by_slug('garam');
  v_conversation uuid;
begin
  select conversation_id into v_conversation from public.messenger_legacy_map
   where source_kind = 'group_chat_room' and source_key = p_room_id::text;
  if v_conversation is null then
    select * into v_room from public.group_chat_rooms where id = p_room_id;
    if not found then
      return null;
    end if;
    insert into public.messenger_conversations (kind, owner_org_id, title)
    values ('group', v_garam, v_room.title) returning id into v_conversation;
    insert into public.messenger_legacy_map (source_kind, source_key, conversation_id)
    values ('group_chat_room', p_room_id::text, v_conversation);
  end if;

  -- Same eligibility the group-chat function computes today: approved Garam
  -- members except design managers. FCs need an explicit send permission.
  insert into public.messenger_participants (conversation_id, actor_id, can_send)
  select v_conversation, m.actor_id, m.role <> 'fc'
    from public.messenger_org_members m
   where m.org_id = v_garam and m.status = 'approved'
     and m.role in ('fc', 'manager', 'admin', 'developer')
  on conflict (conversation_id, actor_id) do nothing;

  update public.messenger_participants p
     set can_send = s.can_send_messages, updated_at = now()
    from public.group_chat_member_send_permissions s
   where s.room_id = p_room_id and p.conversation_id = v_conversation
     and p.actor_id = public.messenger_actor_for_group_key(s.actor_id);
  return v_conversation;
end;
$$;

create or replace function public.messenger_fill_group_room(p_room_id uuid)
returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_conversation uuid := public.messenger_ensure_group_room(p_room_id);
  v_conv public.messenger_conversations%rowtype;
  v_inserted integer := 0;
  v_late integer := 0;
begin
  if v_conversation is null then
    return 0;
  end if;
  select * into v_conv from public.messenger_conversations where id = v_conversation for update;

  select count(*) into v_late
    from public.group_chat_messages g
   where g.room_id = p_room_id
     and not exists (select 1 from public.messenger_messages x where x.id = g.id)
     and v_conv.last_message_at is not null and g.created_at < v_conv.last_message_at;
  if v_late > 0 then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('group_chat_room', p_room_id::text, 'late_backfill_out_of_order',
            jsonb_build_object('count', v_late));
  end if;

  with src as (
    select g.*,
           coalesce(public.messenger_actor_for_group_key(g.sender_actor_id),
                    public.messenger_actor_for_group_key(g.sender_role || ':' || g.sender_phone)) as sender_actor,
           row_number() over (order by g.created_at, g.id) as rn
      from public.group_chat_messages g
     where g.room_id = p_room_id
       and not exists (select 1 from public.messenger_messages x where x.id = g.id)
  ), ins as (
    insert into public.messenger_messages (
      conversation_id, seq, id, sender_actor_id, kind, content, attachment_batch_id,
      legacy_file_url, legacy_file_name, legacy_file_size, created_at, deleted_at,
      deleted_by_actor_id
    )
    select v_conversation, v_conv.last_event_seq + src.rn, src.id, src.sender_actor,
           src.message_type, coalesce(src.content, ''), src.attachment_batch_id,
           src.file_url, src.file_name, src.file_size, src.created_at, src.deleted_at,
           public.messenger_actor_for_group_key(src.deleted_by_actor_id)
      from src
    returning conversation_id, seq, sender_actor_id, created_at
  ), ev as (
    insert into public.messenger_events (conversation_id, event_seq, type, message_seq, actor_id, created_at)
    select conversation_id, seq, 'message', seq, sender_actor_id, created_at from ins
    returning event_seq
  )
  select count(*) into v_inserted from ev;

  if v_inserted > 0 then
    update public.messenger_conversations c
       set last_event_seq = c.last_event_seq + v_inserted,
           last_message_seq = c.last_event_seq + v_inserted,
           last_message_at = (select max(created_at) from public.messenger_messages where conversation_id = v_conversation),
           updated_at = now()
     where c.id = v_conversation;
  end if;

  update public.messenger_messages mm
     set reply_to_seq = parent.seq
    from public.group_chat_messages g
    join public.messenger_messages parent on parent.id = g.reply_to_message_id
   where mm.id = g.id and g.room_id = p_room_id and mm.reply_to_seq is null;

  update public.messenger_participants p
     set last_read_seq = greatest(p.last_read_seq, mm.seq), updated_at = now()
    from public.group_chat_reads r
    join public.messenger_messages mm on mm.id = r.last_read_message_id
   where r.room_id = p_room_id and p.conversation_id = v_conversation
     and p.actor_id = public.messenger_actor_for_group_key(r.actor_id);

  insert into public.messenger_reactions (conversation_id, message_seq, actor_id, reaction, created_at, updated_at)
  select v_conversation, mm.seq, public.messenger_actor_for_group_key(r.actor_id), r.reaction, r.created_at, r.updated_at
    from public.group_chat_reactions r
    join public.messenger_messages mm on mm.id = r.message_id
   where r.room_id = p_room_id and public.messenger_actor_for_group_key(r.actor_id) is not null
  on conflict (conversation_id, message_seq, actor_id) do update
    set reaction = excluded.reaction, updated_at = excluded.updated_at;

  update public.messenger_conversations c
     set pinned_notice_seq = mm.seq
    from public.group_chat_notices n
    join public.messenger_messages mm on mm.id = n.message_id
   where n.room_id = p_room_id and c.id = v_conversation;
  return v_inserted;
end;
$$;

-- Applies existing per-room preferences (mute, pin, leave) to participants.
create or replace function public.messenger_apply_room_preferences()
returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  with prefs as (
    select map.conversation_id,
           public.messenger_actor_for(p.actor_role, p.actor_id::text) as actor_id,
           p.muted, p.pinned_at, p.left_at
      from public.messenger_room_notification_preferences p
      join public.messenger_legacy_map map
        on map.source_kind = case split_part(p.room_key, ':', 2)
             when 'direct-thread' then 'garamin_direct_thread'
             when 'group' then 'group_chat_room' end
       and map.source_key = split_part(p.room_key, ':', 3)
  ), upserted as (
    insert into public.messenger_participants (conversation_id, actor_id, role, muted, pinned_at, left_at)
    select conversation_id, actor_id, 'agent', muted, pinned_at, left_at
      from prefs where actor_id is not null
    on conflict (conversation_id, actor_id) do update
      set muted = excluded.muted, pinned_at = excluded.pinned_at,
          left_at = excluded.left_at, updated_at = now()
    returning 1
  )
  select count(*) into v_count from upserted;
  return v_count;
end;
$$;

-- Idempotent full backfill. Safe to re-run: existing links, rooms and messages
-- are kept, and only missing rows are added.
create or replace function public.messenger_backfill_v1()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  r record;
  v_garam uuid;
  v_direct integer := 0;
  v_group integer := 0;
  v_actor uuid;
  v_orphans jsonb;
begin
  -- 1. People.
  for r in select id, name, phone from public.fc_profiles loop
    perform public.messenger_ensure_actor('fc', r.id::text, r.name, r.phone);
  end loop;
  for r in select id, name, phone from public.admin_accounts loop
    perform public.messenger_ensure_actor('admin', r.id::text, r.name, r.phone);
  end loop;
  for r in select id, name, phone from public.manager_accounts loop
    perform public.messenger_ensure_actor('manager', r.id::text, r.name, r.phone);
  end loop;
  for r in select id, name, phone, fc_id, staff_account_kind, staff_account_id from public.platform_members loop
    v_actor := case
      when r.fc_id is not null then public.messenger_actor_for('fc', r.fc_id::text)
      when r.staff_account_id is not null then public.messenger_actor_for(r.staff_account_kind, r.staff_account_id::text)
    end;
    if v_actor is not null then
      insert into public.messenger_actor_links (source_kind, source_id, actor_id)
      values ('platform_member', r.id::text, v_actor) on conflict do nothing;
    else
      perform public.messenger_ensure_actor('platform_member', r.id::text, r.name, r.phone);
    end if;
  end loop;

  -- 2. Organizations.
  insert into public.messenger_orgs (kind, slug, name) values ('garam', 'garam', '가람')
  on conflict (slug) do nothing;
  insert into public.messenger_orgs (kind, slug, name) values ('moduon_ops', 'moduon-ops', '모두온 운영')
  on conflict (slug) do nothing;
  insert into public.messenger_orgs (kind, partner_id, name, active)
  select 'partner', p.id, p.name, p.active from public.platform_partners p
  on conflict (partner_id) do update set name = excluded.name, active = excluded.active, updated_at = now();
  v_garam := public.messenger_org_by_slug('garam');

  -- 3. Garam memberships (headquarters/team sub-orgs are added by operators).
  insert into public.messenger_org_members (org_id, actor_id, role, status, approved_at)
  select v_garam, public.messenger_actor_for('fc', f.id::text),
         case when f.affiliation like '%설계매니저%' then 'designer' else 'fc' end,
         'approved', now()
    from public.fc_profiles f
   where coalesce(f.signup_completed, false)
     and not coalesce(f.is_manager_referral_shadow, false)
     and f.account_closed_at is null
     and public.messenger_actor_for('fc', f.id::text) is not null
  on conflict do nothing;
  insert into public.messenger_org_members (org_id, actor_id, role, status, approved_at)
  select v_garam, public.messenger_actor_for('manager', m.id::text), 'manager', 'approved', now()
    from public.manager_accounts m where m.active
  on conflict do nothing;
  insert into public.messenger_org_members (org_id, actor_id, role, status, approved_at)
  select v_garam, public.messenger_actor_for('admin', a.id::text), a.staff_type, 'approved', now()
    from public.admin_accounts a where a.active
  on conflict do nothing;

  -- 4. 1:1 rooms: map every thread, place thread-less messages by phone, then
  -- fill each room once so thread and placed messages interleave by time.
  for r in select id from public.garamin_direct_threads order by created_at, id loop
    perform public.messenger_ensure_direct_thread(r.id);
  end loop;
  v_orphans := public.messenger_place_orphan_messages();
  for r in
    select conversation_id from public.messenger_legacy_map where source_kind = 'garamin_direct_thread'
    union
    select conversation_id from public.messenger_orphan_placements
  loop
    v_direct := v_direct + public.messenger_fill_direct_conversation(r.conversation_id);
  end loop;

  -- 5. Group rooms and their messages.
  for r in select id from public.group_chat_rooms order by created_at, id loop
    v_group := v_group + public.messenger_fill_group_room(r.id);
  end loop;

  return jsonb_build_object(
    'actors', (select count(*) from public.messenger_actors),
    'directMessagesAdded', v_direct,
    'orphans', v_orphans,
    'groupMessagesAdded', v_group,
    'preferencesApplied', public.messenger_apply_room_preferences(),
    'openIssues', (select count(*) from public.messenger_sync_issues where resolved_at is null)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Dual-write triggers. Mapped rooms only; failures become sync issues.
-- ---------------------------------------------------------------------------

create or replace function public.messenger_mirror_direct_message()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_conversation uuid;
  v_conv public.messenger_conversations%rowtype;
  v_fc uuid;
  v_fc_phone text;
  v_sender uuid;
  v_seq bigint;
begin
  if new.thread_id is null then
    return null;
  end if;
  select conversation_id into v_conversation from public.messenger_legacy_map
   where source_kind = 'garamin_direct_thread' and source_key = new.thread_id::text;
  if v_conversation is null then
    return null;
  end if;
  begin
    select * into v_conv from public.messenger_conversations where id = v_conversation;
    select public.messenger_actor_for('fc', c.fc_id::text), f.phone into v_fc, v_fc_phone
      from public.garamin_direct_threads t
      join public.garamin_direct_conversations c on c.id = t.legacy_conversation_id
      join public.fc_profiles f on f.id = c.fc_id
     where t.id = new.thread_id;
    v_sender := public.messenger_direct_sender(new.sender_id, new.sender_actor_id, v_fc, v_fc_phone);
    v_seq := public.messenger_append_message(
      v_conversation, new.id, v_sender,
      case when v_conv.kind = 'org_room' and v_sender is distinct from v_fc
        then public.messenger_org_by_slug('garam') end,
      case when new.message_type in ('text', 'image', 'file') then new.message_type else 'text' end,
      new.content, new.created_at, null, new.attachment_batch_id,
      new.file_url, new.file_name, new.file_size, null
    );
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('messages', new.id::text, 'mirror_insert_failed', jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create or replace function public.messenger_mirror_direct_update()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_message public.messenger_messages%rowtype;
  v_conv public.messenger_conversations%rowtype;
begin
  select * into v_message from public.messenger_messages where id = new.id;
  if not found then
    return null;
  end if;
  begin
    select * into v_conv from public.messenger_conversations where id = v_message.conversation_id;
    if new.deleted_at is not null and old.deleted_at is null then
      update public.messenger_messages
         set deleted_at = new.deleted_at,
             deleted_by_actor_id = public.messenger_actor_for_account(new.deleted_by_actor_id)
       where id = new.id;
      perform public.messenger_record_event(v_message.conversation_id, 'delete', v_message.seq,
        public.messenger_actor_for_account(new.deleted_by_actor_id));
    end if;
    -- Legacy read flags move read positions only; stage 2 emits read events.
    if new.is_read and not old.is_read then
      if v_conv.kind = 'org_room' and v_message.sender_actor_id = v_conv.subject_actor_id then
        update public.messenger_conversation_orgs
           set last_read_seq = greatest(last_read_seq, v_message.seq)
         where conversation_id = v_conv.id and org_id = v_conv.owner_org_id;
      else
        update public.messenger_participants
           set last_read_seq = greatest(last_read_seq, v_message.seq), updated_at = now()
         where conversation_id = v_conv.id and role <> 'agent'
           and actor_id is distinct from v_message.sender_actor_id;
      end if;
    end if;
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('messages', new.id::text, 'mirror_update_failed', jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create or replace function public.messenger_mirror_group_message()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_conversation uuid;
  v_seq bigint;
  v_parent bigint;
begin
  select conversation_id into v_conversation from public.messenger_legacy_map
   where source_kind = 'group_chat_room' and source_key = new.room_id::text;
  if v_conversation is null then
    return null;
  end if;
  begin
    if tg_op = 'INSERT' then
      v_seq := public.messenger_append_message(
        v_conversation, new.id,
        coalesce(public.messenger_actor_for_group_key(new.sender_actor_id),
                 public.messenger_actor_for_group_key(new.sender_role || ':' || new.sender_phone)),
        null, new.message_type, new.content, new.created_at, null, new.attachment_batch_id,
        new.file_url, new.file_name, new.file_size, null
      );
      if new.reply_to_message_id is not null then
        select seq into v_parent from public.messenger_messages where id = new.reply_to_message_id;
        update public.messenger_messages set reply_to_seq = v_parent
         where conversation_id = v_conversation and seq = v_seq;
      end if;
    elsif new.deleted_at is not null and old.deleted_at is null then
      update public.messenger_messages
         set deleted_at = new.deleted_at,
             deleted_by_actor_id = public.messenger_actor_for_group_key(new.deleted_by_actor_id)
       where id = new.id
      returning seq into v_seq;
      if v_seq is not null then
        perform public.messenger_record_event(v_conversation, 'delete', v_seq,
          public.messenger_actor_for_group_key(new.deleted_by_actor_id));
      end if;
    end if;
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('group_chat_messages', new.id::text, 'mirror_failed', jsonb_build_object('error', sqlerrm, 'op', tg_op));
  end;
  return null;
end;
$$;

create or replace function public.messenger_mirror_group_read()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    update public.messenger_participants p
       set last_read_seq = greatest(p.last_read_seq, mm.seq), updated_at = now()
      from public.messenger_legacy_map map, public.messenger_messages mm
     where map.source_kind = 'group_chat_room' and map.source_key = new.room_id::text
       and p.conversation_id = map.conversation_id
       and mm.id = new.last_read_message_id
       and p.actor_id = public.messenger_actor_for_group_key(new.actor_id);
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('group_chat_reads', new.room_id::text || ':' || new.actor_id, 'mirror_failed', jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create or replace function public.messenger_mirror_group_reaction()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.group_chat_reactions%rowtype := case when tg_op = 'DELETE' then old else new end;
  v_message public.messenger_messages%rowtype;
  v_actor uuid := public.messenger_actor_for_group_key(v_row.actor_id);
begin
  select * into v_message from public.messenger_messages where id = v_row.message_id;
  if not found or v_actor is null then
    return null;
  end if;
  begin
    if tg_op = 'DELETE' then
      delete from public.messenger_reactions
       where conversation_id = v_message.conversation_id and message_seq = v_message.seq and actor_id = v_actor;
    else
      insert into public.messenger_reactions (conversation_id, message_seq, actor_id, reaction)
      values (v_message.conversation_id, v_message.seq, v_actor, v_row.reaction)
      on conflict (conversation_id, message_seq, actor_id) do update
        set reaction = excluded.reaction, updated_at = now();
    end if;
    perform public.messenger_record_event(v_message.conversation_id, 'reaction', v_message.seq, v_actor,
      jsonb_build_object('reaction', case when tg_op = 'DELETE' then null else v_row.reaction end));
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('group_chat_reactions', v_row.message_id::text, 'mirror_failed', jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create or replace function public.messenger_mirror_group_notice()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_room uuid := case when tg_op = 'DELETE' then old.room_id else new.room_id end;
  v_conversation uuid;
  v_seq bigint;
begin
  select conversation_id into v_conversation from public.messenger_legacy_map
   where source_kind = 'group_chat_room' and source_key = v_room::text;
  if v_conversation is null then
    return null;
  end if;
  begin
    if tg_op <> 'DELETE' then
      select seq into v_seq from public.messenger_messages where id = new.message_id;
    end if;
    update public.messenger_conversations set pinned_notice_seq = v_seq, updated_at = now()
     where id = v_conversation;
    perform public.messenger_record_event(v_conversation, 'notice', v_seq, null);
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('group_chat_notices', v_room::text, 'mirror_failed', jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create or replace trigger trg_messenger_mirror_direct_insert
  after insert on public.messages
  for each row execute function public.messenger_mirror_direct_message();
create or replace trigger trg_messenger_mirror_direct_update
  after update of is_read, deleted_at on public.messages
  for each row execute function public.messenger_mirror_direct_update();
create or replace trigger trg_messenger_mirror_group_message
  after insert or update of deleted_at on public.group_chat_messages
  for each row execute function public.messenger_mirror_group_message();
create or replace trigger trg_messenger_mirror_group_read
  after insert or update on public.group_chat_reads
  for each row execute function public.messenger_mirror_group_read();
create or replace trigger trg_messenger_mirror_group_reaction
  after insert or update or delete on public.group_chat_reactions
  for each row execute function public.messenger_mirror_group_reaction();
create or replace trigger trg_messenger_mirror_group_notice
  after insert or update or delete on public.group_chat_notices
  for each row execute function public.messenger_mirror_group_notice();

-- ---------------------------------------------------------------------------
-- Reconciliation: legacy vs unified, per mapped room. Records one run row.
-- ---------------------------------------------------------------------------

create or replace function public.messenger_reconcile_v1()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_result jsonb;
  v_ok boolean;
begin
  with direct_rows as (
    select map.conversation_id, m.id, m.content, m.deleted_at
      from public.messenger_legacy_map map
      join public.messages m on m.thread_id::text = map.source_key
     where map.source_kind = 'garamin_direct_thread'
    union
    select p.conversation_id, m.id, m.content, m.deleted_at
      from public.messenger_orphan_placements p
      join public.messages m on m.id = p.message_id
  ), direct_legacy as (
    select conversation_id, count(*) as n,
           md5(string_agg(id::text || '|' || md5(coalesce(content, '')) || '|' || coalesce(deleted_at::text, ''), ',' order by id)) as fp
      from direct_rows
     group by conversation_id
  ), group_legacy as (
    select map.conversation_id, count(*) as n,
           md5(string_agg(g.id::text || '|' || md5(coalesce(g.content, '')) || '|' || coalesce(g.deleted_at::text, ''), ',' order by g.id)) as fp
      from public.messenger_legacy_map map
      join public.group_chat_messages g on g.room_id::text = map.source_key
     where map.source_kind = 'group_chat_room'
     group by map.conversation_id
  ), legacy as (
    select * from direct_legacy union all select * from group_legacy
  ), unified as (
    select mm.conversation_id, count(*) as n,
           md5(string_agg(mm.id::text || '|' || md5(mm.content) || '|' || coalesce(mm.deleted_at::text, ''), ',' order by mm.id)) as fp
      from public.messenger_messages mm
     where mm.conversation_id in (select conversation_id from legacy)
     group by mm.conversation_id
  ), diff as (
    select l.conversation_id, l.n as legacy_count, coalesce(u.n, 0) as unified_count
      from legacy l left join unified u on u.conversation_id = l.conversation_id
     where u.fp is distinct from l.fp
  )
  select jsonb_build_object(
    'mismatchedRooms', (select count(*) from diff),
    'mismatchSample', coalesce((select jsonb_agg(to_jsonb(d)) from (select * from diff limit 20) d), '[]'::jsonb),
    'unmappedDirectThreads', (select count(*) from public.garamin_direct_threads t
                               where not exists (select 1 from public.messenger_legacy_map map
                                                  where map.source_kind = 'garamin_direct_thread' and map.source_key = t.id::text)
                                 and not (
                                   exists (select 1 from public.messenger_sync_issues i
                                            where i.source = 'garamin_direct_thread' and i.source_key = t.id::text
                                              and i.reason = 'thread_counterparty_missing_empty')
                                   and not exists (select 1 from public.messages m where m.thread_id = t.id)
                                 )),
    'skippedEmptyThreads', (select count(*) from public.garamin_direct_threads t
                             where exists (select 1 from public.messenger_sync_issues i
                                            where i.source = 'garamin_direct_thread' and i.source_key = t.id::text
                                              and i.reason = 'thread_counterparty_missing_empty')
                               and not exists (select 1 from public.messages m where m.thread_id = t.id)),
    'unmappedGroupRooms', (select count(*) from public.group_chat_rooms r
                            where not exists (select 1 from public.messenger_legacy_map map
                                               where map.source_kind = 'group_chat_room' and map.source_key = r.id::text)),
    'unhandledOrphanMessages', (select count(*) from public.messages m
                                 where m.thread_id is null
                                   and not exists (select 1 from public.messenger_orphan_placements p where p.message_id = m.id)
                                   and not exists (select 1 from public.messenger_sync_issues i
                                                    where i.source = 'messages' and i.source_key = m.id::text
                                                      and i.reason in ('orphan_deleted_skipped', 'orphan_participant_missing'))),
    'skippedOrphanMessages', (select count(distinct source_key) from public.messenger_sync_issues
                               where source = 'messages' and reason in ('orphan_deleted_skipped', 'orphan_participant_missing')),
    'unlinkedAccounts', (select count(*) from (
        select 'fc' k, id::text s from public.fc_profiles
        union all select 'admin', id::text from public.admin_accounts
        union all select 'manager', id::text from public.manager_accounts) a
      where not exists (select 1 from public.messenger_actor_links l where l.source_kind = a.k and l.source_id = a.s)),
    'openIssues', (select count(*) from public.messenger_sync_issues
                    where resolved_at is null
                      and reason not in ('orphan_deleted_skipped', 'orphan_participant_missing',
                                         'thread_counterparty_missing_empty'))
  ) into v_result;

  v_ok := (v_result->>'mismatchedRooms')::int = 0
      and (v_result->>'unmappedDirectThreads')::int = 0
      and (v_result->>'unmappedGroupRooms')::int = 0
      and (v_result->>'unhandledOrphanMessages')::int = 0
      and (v_result->>'unlinkedAccounts')::int = 0;
  insert into public.messenger_reconcile_runs (ok, result) values (v_ok, v_result);
  return v_result || jsonb_build_object('ok', v_ok);
end;
$$;

-- ---------------------------------------------------------------------------
-- GaramLink import. The request board lives in another database, so its server
-- exports batches in this shape (oldest first; later batches only carry newer
-- rows):
-- {"users":[{"id":1,"phone":"010...","name":"..."}],
--  "messages":[{"source":"request"|"direct","id":7,"senderUserId":1,
--               "peerUserId":2,"requestId":3,"directConversationId":null,
--               "content":"...","createdAt":"...","isRead":true}]}
-- One room per pair of people (decision 2026-10-16); request messages carry
-- {"requestBoard":{"requestId":n}} in context. Attachments follow separately.
-- ---------------------------------------------------------------------------

create or replace function public.messenger_import_request_board_v1(p_payload jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  u jsonb;
  m jsonb;
  v_sender uuid;
  v_peer uuid;
  v_key text;
  v_conversation uuid;
  v_id uuid;
  v_users integer := 0;
  v_messages integer := 0;
  v_source_kind text;
  v_source_key text;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;
  for u in select * from jsonb_array_elements(coalesce(p_payload->'users', '[]'::jsonb)) loop
    perform public.messenger_ensure_actor('request_board_user', u->>'id', u->>'name', u->>'phone');
    v_users := v_users + 1;
  end loop;

  for m in
    select value from jsonb_array_elements(coalesce(p_payload->'messages', '[]'::jsonb))
     order by (value->>'createdAt')::timestamptz, value->>'source', (value->>'id')::bigint
  loop
    v_sender := public.messenger_actor_for('request_board_user', m->>'senderUserId');
    v_peer := public.messenger_actor_for('request_board_user', m->>'peerUserId');
    if v_sender is null or v_peer is null or v_sender = v_peer then
      insert into public.messenger_sync_issues (source, source_key, reason)
      values ('request_board', (m->>'source') || ':' || (m->>'id'), 'participant_missing');
      continue;
    end if;
    v_key := least(v_sender::text, v_peer::text) || ':' || greatest(v_sender::text, v_peer::text);
    insert into public.messenger_conversations (kind, direct_key)
    values ('direct', v_key)
    on conflict (direct_key) do update set updated_at = public.messenger_conversations.updated_at
    returning id into v_conversation;
    insert into public.messenger_participants (conversation_id, actor_id)
    values (v_conversation, v_sender), (v_conversation, v_peer) on conflict do nothing;

    if m->>'source' = 'direct' then
      v_source_kind := 'request_board_direct';
      v_source_key := m->>'directConversationId';
    else
      v_source_kind := 'request_board_pair';
      v_source_key := least((m->>'senderUserId')::bigint, (m->>'peerUserId')::bigint) || ':'
                   || greatest((m->>'senderUserId')::bigint, (m->>'peerUserId')::bigint);
    end if;
    if v_source_key is not null then
      insert into public.messenger_legacy_map (source_kind, source_key, conversation_id)
      values (v_source_kind, v_source_key, v_conversation) on conflict do nothing;
    end if;

    v_id := md5('request_board:' || (m->>'source') || ':' || (m->>'id'))::uuid;
    perform public.messenger_append_message(
      v_conversation, v_id, v_sender, null, 'text', m->>'content', (m->>'createdAt')::timestamptz,
      case when m->>'requestId' is not null
        then jsonb_build_object('requestBoard', jsonb_build_object('requestId', (m->>'requestId')::bigint)) end
    );
    if coalesce((m->>'isRead')::boolean, false) then
      update public.messenger_participants p
         set last_read_seq = greatest(p.last_read_seq, mm.seq), updated_at = now()
        from public.messenger_messages mm
       where mm.id = v_id and p.conversation_id = v_conversation and p.actor_id = v_peer;
    end if;
    v_messages := v_messages + 1;
  end loop;
  return jsonb_build_object('users', v_users, 'messages', v_messages);
end;
$$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'messenger_normalize_phone', 'messenger_actor_for', 'messenger_actor_for_account',
         'messenger_actor_for_group_key', 'messenger_ensure_actor', 'messenger_org_by_slug',
         'messenger_record_issue_once',
         'messenger_ensure_direct_thread', 'messenger_direct_sender', 'messenger_fill_direct_thread',
         'messenger_actor_by_phone', 'messenger_record_orphan_issue', 'messenger_place_orphan_messages',
         'messenger_fill_direct_conversation',
         'messenger_ensure_group_room', 'messenger_fill_group_room', 'messenger_apply_room_preferences',
         'messenger_backfill_v1', 'messenger_mirror_direct_message', 'messenger_mirror_direct_update',
         'messenger_mirror_group_message', 'messenger_mirror_group_read', 'messenger_mirror_group_reaction',
         'messenger_mirror_group_notice', 'messenger_reconcile_v1', 'messenger_import_request_board_v1'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end;
$$;

-- 20261016100200_messenger_unified_daily_sync
-- Messenger stage 1: run the backfill and the reconciliation every day.
-- The backfill maps rooms, members and thread-less messages that appeared
-- since the last run; the reconciliation then records one row in
-- messenger_reconcile_runs. The stage-1 gate is 7 consecutive ok runs.

create or replace function public.messenger_daily_sync_v1()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_started timestamptz := clock_timestamp();
  v_backfill jsonb;
  v_reconcile jsonb;
begin
  -- One run at a time; an overlapping start returns without doing anything.
  if not pg_try_advisory_xact_lock(hashtext('messenger_daily_sync_v1')) then
    return jsonb_build_object('skipped', 'already_running');
  end if;

  begin
    v_backfill := public.messenger_backfill_v1();
    v_reconcile := public.messenger_reconcile_v1();
  exception when others then
    -- The failed work is rolled back; the failure itself is kept as a run row
    -- so the daily check sees it.
    insert into public.messenger_reconcile_runs (ok, result)
    values (false, jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate, 'stage', 'daily_sync'));
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  -- Keep half a year of run history.
  delete from public.messenger_reconcile_runs where ran_at < now() - interval '180 days';

  return jsonb_build_object(
    'ok', coalesce((v_reconcile->>'ok')::boolean, false),
    'backfill', v_backfill,
    'reconcile', v_reconcile,
    'elapsedMs', round(extract(epoch from clock_timestamp() - v_started) * 1000)
  );
end;
$$;

-- How many of the most recent runs passed in a row (the stage-1 gate needs 7).
create or replace function public.messenger_reconcile_streak_v1()
returns integer
language sql stable security invoker set search_path = public, pg_temp as $$
  select count(*)::integer
    from public.messenger_reconcile_runs r
   where r.ok
     and r.ran_at > coalesce((select max(ran_at) from public.messenger_reconcile_runs where not ok), '-infinity');
$$;

revoke all on function public.messenger_daily_sync_v1() from public, anon, authenticated;
grant execute on function public.messenger_daily_sync_v1() to service_role;
revoke all on function public.messenger_reconcile_streak_v1() from public, anon, authenticated;
grant execute on function public.messenger_reconcile_streak_v1() to service_role;

-- schedule --
-- 18:30 UTC is 03:30 KST, the quietest hour for the messenger.
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'messenger-unified-daily-sync';
select cron.schedule('messenger-unified-daily-sync', '30 18 * * *',
  'select public.messenger_daily_sync_v1();');
