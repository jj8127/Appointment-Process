-- Fix: 커스텀 인증(phone+password)으로 인해 Supabase Auth 세션이 없어
-- auth.uid()가 null → is_admin()/is_fc()/is_manager()가 모두 false 반환
-- 모바일 앱의 시험 일정 조회 및 신청이 RLS에 의해 차단되는 문제 수정

-- ============================
-- 1. exam_rounds SELECT (시험 일정 조회)
-- ============================
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

-- ============================
-- 2. exam_locations SELECT (시험 장소 조회)
-- ============================
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

-- ============================
-- 3. exam_registrations (시험 신청 CRUD)
-- ============================
-- SELECT: FC가 본인 신청 내역 조회
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

-- INSERT: FC가 시험 신청
drop policy if exists "exam_registrations anon insert" on public.exam_registrations;
create policy "exam_registrations anon insert"
  on public.exam_registrations
  for insert
  with check (auth.role() = 'anon');

-- UPDATE: FC가 신청 내역 수정
drop policy if exists "exam_registrations anon update" on public.exam_registrations;
create policy "exam_registrations anon update"
  on public.exam_registrations
  for update
  using (auth.role() = 'anon');

-- DELETE: FC가 신청 취소
drop policy if exists "exam_registrations anon delete" on public.exam_registrations;
create policy "exam_registrations anon delete"
  on public.exam_registrations
  for delete
  using (auth.role() = 'anon');

-- ============================
-- 4. fc_profiles SELECT (FC 프로필 조회 - 수당 동의 상태 확인용)
-- ============================
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
