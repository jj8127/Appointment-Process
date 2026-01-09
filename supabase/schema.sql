-- Supabase 스키마/정책 정의
-- Supabase SQL Editor나 supabase CLI로 실행하세요.

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
  email text,
  address text,
  address_detail text,
  career_type text check (career_type in ('신입', '경력')),
  allowance_date date,
  appointment_url text,
  appointment_date date,
  docs_deadline_at date,
  docs_deadline_last_notified_at date,
  status text not null default 'draft',
  identity_completed boolean not null default false,
  phone_verified boolean not null default false,
  phone_verified_at timestamptz,
  phone_verification_hash text,
  phone_verification_expires_at timestamptz,
  phone_verification_sent_at timestamptz,
  phone_verification_attempts integer not null default 0,
  phone_verification_locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 주민번호 마스킹 기준 upsert를 위해 유니크 인덱스 추가
drop index if exists idx_fc_profiles_resident_id_masked;
create unique index if not exists idx_fc_profiles_resident_id_hash on public.fc_profiles (resident_id_hash);
create unique index if not exists idx_fc_profiles_phone on public.fc_profiles (phone);

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
  password_hash text not null,
  password_salt text not null,
  password_set_at timestamptz,
  failed_count integer not null default 0,
  locked_until timestamptz,
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
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now()
);

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
alter table public.profiles enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.notices enable row level security;
alter table public.exam_rounds enable row level security;
alter table public.exam_locations enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.is_manager() returns boolean
language sql stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'manager'
  );
$$;

create or replace function public.is_fc() returns boolean
language sql stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'fc'
  );
$$;

create or replace function public.current_fc_id() returns uuid
language sql stable
as $$
  select p.fc_id from public.profiles p where p.id = auth.uid();
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
    public.is_admin()
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
    public.is_admin()
    or public.is_manager()
    or public.is_fc()
  );

drop policy if exists "exam_rounds insert" on public.exam_rounds;
create policy "exam_rounds insert"
  on public.exam_rounds
  for insert
  with check (public.is_admin());

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
    public.is_admin()
    or public.is_manager()
    or public.is_fc()
  );

drop policy if exists "exam_locations insert" on public.exam_locations;
create policy "exam_locations insert"
  on public.exam_locations
  for insert
  with check (public.is_admin());

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
  add column if not exists appointment_reject_reason_life text;

alter table public.fc_profiles
  add column if not exists appointment_reject_reason_nonlife text;

alter table public.fc_profiles
  drop column if exists resident_number;

alter table public.fc_profiles
  add column if not exists resident_id_hash text;

alter table public.fc_profiles
  add column if not exists identity_completed boolean default false;

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
    public.is_admin()
    or public.is_manager()
    or (public.is_fc() and fc_id = public.current_fc_id())
  );

drop policy if exists "exam_registrations insert" on public.exam_registrations;
create policy "exam_registrations insert"
  on public.exam_registrations
  for insert
  with check (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "exam_registrations update" on public.exam_registrations;
create policy "exam_registrations update"
  on public.exam_registrations
  for update
  using (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()))
  with check (public.is_admin() or (public.is_fc() and fc_id = public.current_fc_id()));

drop policy if exists "exam_registrations delete" on public.exam_registrations;
create policy "exam_registrations delete"
  on public.exam_registrations
  for delete
  using (public.is_admin());

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
