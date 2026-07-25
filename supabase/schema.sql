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
create unique index if not exists idx_exam_registrations_active_fc_exam_month
  on public.exam_registrations (fc_id, exam_month)
  where status in ('applied', 'confirmed', 'completed', 'no_show');
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

alter table public.exam_registrations
  drop constraint if exists exam_registrations_round_id_fkey;
alter table public.exam_registrations
  add constraint exam_registrations_round_id_fkey
  foreign key (round_id) references public.exam_rounds (id) on delete restrict;
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
  if v_round.id is null or v_round.exam_date is null then
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

  v_exam_month := date_trunc('month', v_round.exam_date)::date;
  perform pg_advisory_xact_lock(
    hashtextextended(p_fc_id::text || ':' || v_exam_month::text, 0)
  );

  select registration.* into v_registration
    from public.exam_registrations registration
   where registration.fc_id = p_fc_id
     and registration.exam_month = v_exam_month
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
      resident_id, fc_id, round_id, location_id, exam_month, status,
      is_confirmed, includes_primary_exam, is_third_exam, fee_paid_date,
      payment_proof_attached, payment_proof_policy_version
    ) values (
      btrim(p_resident_id), p_fc_id, p_round_id, p_location_id, v_exam_month,
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
  v_from_status text;
  v_to_status text;
  v_reason text;
  v_proof_path text;
  v_target_url text;
  v_title text;
  v_body text;
  v_notification_id uuid;
begin
  select registration, round_row.exam_type
    into v_registration, v_exam_type
    from public.exam_registrations registration
    join public.exam_rounds round_row on round_row.id = registration.round_id
   where registration.id = p_registration_id
   for update of registration;

  if v_registration.id is null then
    raise exception using errcode = 'P0002', message = 'exam_registration_not_found';
  end if;
  if v_registration.status in ('completed', 'no_show') then
    raise exception using errcode = '55000', message = 'terminal_exam_registration';
  end if;

  if p_action = 'cancel_by_fc' then
    if p_actor_type <> 'fc'
       or p_actor_fc_id is null
       or p_actor_fc_id <> v_registration.fc_id then
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

  if v_round.id is null or v_round.exam_date is null then
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

  v_exam_month := date_trunc('month', v_round.exam_date)::date;
  perform pg_advisory_xact_lock(
    hashtextextended(p_fc_id::text || ':' || v_exam_month::text, 0)
  );

  select registration.*
    into v_registration
    from public.exam_registrations registration
   where registration.fc_id = p_fc_id
     and registration.exam_month = v_exam_month
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
