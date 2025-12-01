-- Supabase 스키마/정책 정의
-- Supabase SQL Editor나 supabase CLI로 실행하세요.

create extension if not exists "uuid-ossp";

create table if not exists public.fc_profiles (
  id uuid primary key default gen_random_uuid(),
  temp_id text unique,
  name text not null,
  affiliation text not null,
  resident_id_masked text,
  phone text not null,
  recommender text,
  email text,
  address text,
  address_detail text,
  career_type text check (career_type in ('신입', '경력')),
  allowance_date date,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 주민번호 마스킹 기준 upsert를 위해 유니크 인덱스 추가
create unique index if not exists idx_fc_profiles_resident_id_masked on public.fc_profiles (resident_id_masked);
create unique index if not exists idx_fc_profiles_phone on public.fc_profiles (phone);

-- 알림용 디바이스 토큰 저장 테이블
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null,
  display_name text,
  role text check (role in ('admin','fc')) not null,
  expo_push_token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  unique (expo_push_token)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid references public.fc_profiles (id) on delete set null,
  resident_id text,
  recipient_role text check (recipient_role in ('admin','fc')),
  title text not null,
  body text not null,
  category text,
  created_at timestamptz not null default now()
);

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

drop trigger if exists trg_fc_profiles_updated_at on public.fc_profiles;
create trigger trg_fc_profiles_updated_at
before update on public.fc_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_fc_documents_updated_at on public.fc_documents;
create trigger trg_fc_documents_updated_at
before update on public.fc_documents
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
alter table public.notifications enable row level security;
alter table public.notices enable row level security;
alter table public.exam_rounds enable row level security;
alter table public.exam_locations enable row level security;

-- RLS: 인증/비인증(anon) 모두 허용하는 공개 정책 (필요 시 auth.uid() 기반으로 강화)
drop policy if exists "fc_profiles select" on public.fc_profiles;
create policy "fc_profiles select"
  on public.fc_profiles
  for select
  using (auth.role() in ('authenticated','anon'));

drop policy if exists "fc_profiles insert" on public.fc_profiles;
create policy "fc_profiles insert"
  on public.fc_profiles
  for insert
  with check (auth.role() in ('authenticated','anon'));

drop policy if exists "fc_profiles update" on public.fc_profiles;
create policy "fc_profiles update"
  on public.fc_profiles
  for update
  using (auth.role() in ('authenticated','anon'))
  with check (auth.role() in ('authenticated','anon'));

drop policy if exists "fc_documents select" on public.fc_documents;
create policy "fc_documents select"
  on public.fc_documents
  for select
  using (auth.role() in ('authenticated','anon'));

drop policy if exists "fc_documents insert" on public.fc_documents;
create policy "fc_documents insert"
  on public.fc_documents
  for insert
  with check (auth.role() in ('authenticated','anon'));

drop policy if exists "fc_documents update" on public.fc_documents;
create policy "fc_documents update"
  on public.fc_documents
  for update
  using (auth.role() in ('authenticated','anon'))
  with check (auth.role() in ('authenticated','anon'));

drop policy if exists "notifications select" on public.notifications;
create policy "notifications select"
  on public.notifications
  for select
  using (auth.role() in ('authenticated','anon'));

drop policy if exists "notifications insert" on public.notifications;
create policy "notifications insert"
  on public.notifications
  for insert
  with check (auth.role() in ('authenticated','anon'));

drop policy if exists "notices select" on public.notices;
create policy "notices select"
  on public.notices
  for select
  using (auth.role() in ('authenticated','anon'));

drop policy if exists "notices insert" on public.notices;
create policy "notices insert"
  on public.notices
  for insert
  with check (auth.role() in ('authenticated','anon'));

drop policy if exists "exam_rounds select" on public.exam_rounds;
create policy "exam_rounds select"
  on public.exam_rounds
  for select
  using (auth.role() in ('authenticated','anon'));

drop policy if exists "exam_rounds insert" on public.exam_rounds;
create policy "exam_rounds insert"
  on public.exam_rounds
  for insert
  with check (auth.role() in ('authenticated','anon'));

drop policy if exists "exam_rounds update" on public.exam_rounds;
create policy "exam_rounds update"
  on public.exam_rounds
  for update
  using (auth.role() in ('authenticated','anon'))
  with check (auth.role() in ('authenticated','anon'));

drop policy if exists "exam_rounds delete" on public.exam_rounds;
create policy "exam_rounds delete"
  on public.exam_rounds
  for delete
  using (auth.role() in ('authenticated','anon'));

drop policy if exists "exam_locations select" on public.exam_locations;
create policy "exam_locations select"
  on public.exam_locations
  for select
  using (auth.role() in ('authenticated','anon'));

drop policy if exists "exam_locations insert" on public.exam_locations;
create policy "exam_locations insert"
  on public.exam_locations
  for insert
  with check (auth.role() in ('authenticated','anon'));

drop policy if exists "exam_locations update" on public.exam_locations;
create policy "exam_locations update"
  on public.exam_locations
  for update
  using (auth.role() in ('authenticated','anon'))
  with check (auth.role() in ('authenticated','anon'));

drop policy if exists "exam_locations delete" on public.exam_locations;
create policy "exam_locations delete"
  on public.exam_locations
  for delete
  using (auth.role() in ('authenticated','anon'));

-- 스토리지 버킷
insert into storage.buckets (id, name, public) values ('fc-documents', 'fc-documents', false)
on conflict (id) do nothing;

-- 스토리지 RLS
drop policy if exists "fc-documents read" on storage.objects;
create policy "fc-documents read"
  on storage.objects for select
  using (bucket_id = 'fc-documents' and auth.role() in ('authenticated','anon'));

drop policy if exists "fc-documents write" on storage.objects;
create policy "fc-documents write"
  on storage.objects for insert
  with check (bucket_id = 'fc-documents' and auth.role() in ('authenticated','anon'));

drop policy if exists "fc-documents update" on storage.objects;
create policy "fc-documents update"
  on storage.objects for update
  using (bucket_id = 'fc-documents' and auth.role() in ('authenticated','anon'));

drop policy if exists "fc-documents delete" on storage.objects;
create policy "fc-documents delete"
  on storage.objects for delete
  using (bucket_id = 'fc-documents' and auth.role() in ('authenticated','anon'));
-- delete policy for fc_profiles

drop policy if exists "fc_profiles delete" on public.fc_profiles;
create policy "fc_profiles delete"
  on public.fc_profiles
  for delete
  using (auth.role() in ('authenticated','anon'));
