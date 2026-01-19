---
name: rls-policy
description: Supabase RLS(Row Level Security) 정책 작성 가이드. 보안 정책, 권한 제어 관련 질문 시 사용.
allowed-tools: Read, Write, Edit, Grep
---

# Supabase RLS 정책 가이드

이 프로젝트의 Row Level Security 정책 패턴을 따릅니다.

## RLS 기본 개념

- **RLS**: 행 단위 접근 제어
- **정책(Policy)**: 특정 조건에서 SELECT/INSERT/UPDATE/DELETE 허용
- **서비스 역할**: RLS 우회 (Edge Function에서 사용)

## 프로젝트 RLS 패턴

### 1. 기본 RLS 활성화

```sql
-- 테이블에 RLS 활성화
alter table public.table_name enable row level security;
```

### 2. 서비스 역할 정책 (Edge Function용)

```sql
-- 서비스 역할은 모든 작업 허용
drop policy if exists "table_name service_role" on public.table_name;
create policy "table_name service_role"
  on public.table_name
  for all
  to service_role
  using (true)
  with check (true);
```

### 3. 인증된 사용자 정책

```sql
-- 인증된 사용자 읽기 허용
create policy "table_name authenticated read"
  on public.table_name
  for select
  to authenticated
  using (true);

-- 자신의 데이터만 수정 허용
create policy "table_name owner update"
  on public.table_name
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

## 스토리지 버킷 정책

### fc-documents 버킷

```sql
-- 버킷 생성
insert into storage.buckets (id, name, public)
values ('fc-documents', 'fc-documents', false);

-- 인증된 사용자 업로드 허용
create policy "fc-documents authenticated upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'fc-documents');

-- 인증된 사용자 읽기 허용
create policy "fc-documents authenticated read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'fc-documents');
```

### board-attachments 버킷

```sql
insert into storage.buckets (id, name, public)
values ('board-attachments', 'board-attachments', false);

-- 서비스 역할만 접근 (Edge Function 통해서만)
create policy "board-attachments service_role"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'board-attachments')
  with check (bucket_id = 'board-attachments');
```

## 주요 테이블 정책

### fc_profiles

```sql
-- 서비스 역할 전체 접근
create policy "fc_profiles service_role"
  on public.fc_profiles for all to service_role
  using (true) with check (true);

-- 일반 사용자 접근 차단 (Edge Function 통해서만 접근)
```

### fc_identity_secure

```sql
-- 민감 정보: 서비스 역할만 접근
create policy "fc_identity_secure service_role"
  on public.fc_identity_secure for all to service_role
  using (true) with check (true);
```

### board_posts

```sql
-- 서비스 역할 전체 접근
create policy "board_posts service_role"
  on public.board_posts for all to service_role
  using (true) with check (true);
```

## 정책 작성 규칙

### 1. 명명 규칙
```
{테이블명} {역할} {동작}
예: "fc_profiles service_role", "board_posts authenticated read"
```

### 2. 기존 정책 삭제 후 재생성
```sql
drop policy if exists "policy_name" on public.table_name;
create policy "policy_name" ...
```

### 3. 조건부 접근

```sql
-- 특정 상태의 데이터만 접근
using (status = 'published')

-- 소유자 또는 관리자
using (
  auth.uid() = owner_id
  or exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
)
```

## 디버깅

```sql
-- 현재 사용자 확인
select auth.uid(), auth.role();

-- 정책 목록 확인
select * from pg_policies where tablename = 'table_name';
```

## 주의사항

1. **서비스 역할 키 보안**: 절대 클라이언트에 노출 금지
2. **RLS 미적용 테이블**: `enable row level security` 누락 시 모든 사용자 접근 가능
3. **정책 충돌**: 여러 정책이 OR 조건으로 결합됨
4. **성능**: 복잡한 조건은 인덱스 활용 고려

## 참고 파일

- `supabase/schema.sql`: 전체 스키마 및 RLS 정책 정의
