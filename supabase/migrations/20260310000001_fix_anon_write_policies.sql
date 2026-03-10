-- 보안 수정: anon이 관리자/시스템 전용 테이블에 쓰기 가능한 정책 제거
-- 배경: 커스텀 인증(phone+password)으로 Supabase Auth 세션 없음 →
--       is_admin()/is_fc()/is_manager()가 모두 false 반환 →
--       RLS가 anon 정책에 의존하는 구조
--
-- 이 migration에서 제거하는 정책:
--   ✅ fc_documents anon INSERT:
--       실제 쓰기 경로는 admin-action edge function (service role)만 사용.
--       anon direct INSERT를 허용할 필요가 없음 → 가짜 문서 레코드 주입 차단
--
-- Phase 2 migration (별도):
--   exam_locations/exam_rounds anon INSERT는
--   admin/exams/new/page.tsx의 server action 이전 완료 후 제거 예정

-- =========================================================
-- fc_documents: anon INSERT 제거
-- 문서 레코드 생성은 admin-action edge function (service role)만 허용
-- =========================================================
drop policy if exists "fc_documents anon insert" on public.fc_documents;
