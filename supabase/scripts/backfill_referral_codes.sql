-- 기존 FC 추천 코드 백필 스크립트
-- 가입 완료된(signup_completed = true) FC 중 활성 추천 코드가 없는 사용자에게 코드를 일괄 발급합니다.
--
-- 사용 방법:
--   1. Supabase Dashboard > SQL Editor 에서 아래 쿼리를 실행합니다.
--   2. 한 번에 최대 100건씩 처리합니다. 결과의 remaining > 0 이면 반복 실행이 필요합니다.
--   3. 어드민 웹 /dashboard/referrals 의 "일괄 발급" 버튼으로도 동일하게 수행됩니다.
--
-- 결과 필드:
--   ok        - 성공 여부
--   processed - 이번 실행에서 처리를 시도한 건수
--   created   - 새로 발급된 코드 수
--   skipped   - 건너뛴 수 (이미 코드 있음 또는 오류)
--   remaining - 아직 코드가 없는 잔여 대상 건수 (0 이 될 때까지 반복 실행)
--   limit     - 이번 실행 batch 크기

SELECT admin_backfill_referral_codes(
  100,              -- p_limit: 최대 100건
  null,             -- p_actor_phone: SQL 직접 실행 시 null
  'admin',          -- p_actor_role
  null,             -- p_actor_staff_type
  'initial_backfill_2026'  -- p_reason
);
