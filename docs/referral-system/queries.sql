-- 추천인 검증 SQL 초안
-- 기준일: 2026-03-19
-- 아직 실제 테이블명이 확정되지 않았으므로, 첫 스키마 머지 후 컬럼명/테이블명을 즉시 맞춘다.

-- 권장 가정 테이블:
--   referral_codes
--   referral_attributions
--   referral_events
--   referral_admin_actions

-- 1. 특정 invitee의 추천 관계 확인
-- select *
-- from referral_attributions
-- where invitee_user_id = :invitee_user_id
-- order by created_at desc;

-- 2. 특정 referral_code의 이벤트 타임라인 확인
-- select event_type, subject_user_id, metadata, created_at
-- from referral_events
-- where referral_code = :referral_code
-- order by created_at asc;

-- 3. invitee 기준 confirmed 중복 탐지
-- select invitee_user_id, count(*) as confirmed_count
-- from referral_attributions
-- where status = 'confirmed'
-- group by invitee_user_id
-- having count(*) > 1;

-- 4. inviter/invitee 고아 row 탐지
-- select ra.*
-- from referral_attributions ra
-- left join users inviter on inviter.id = ra.inviter_user_id
-- left join users invitee on invitee.id = ra.invitee_user_id
-- where inviter.id is null
--    or (ra.invitee_user_id is not null and invitee.id is null);

-- 5. override 감사 로그 확인
-- select actor_user_id, target_user_id, before_value, after_value, reason, created_at
-- from referral_admin_actions
-- order by created_at desc;

-- 6. pending attribution 누락/장기 잔류 탐지
-- select *
-- from referral_attributions
-- where status in ('captured', 'pending_signup')
--   and created_at < now() - interval '1 day'
-- order by created_at asc;
