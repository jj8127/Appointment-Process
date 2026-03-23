-- 추천인 검증 SQL
-- 기준일: 2026-03-23

-- 1. 특정 invitee phone의 추천 관계 확인
-- select *
-- from public.referral_attributions
-- where invitee_phone = :invitee_phone
-- order by created_at desc;

-- 2. 특정 invitee fc_id의 추천 관계 확인
-- select *
-- from public.referral_attributions
-- where invitee_fc_id = :invitee_fc_id
-- order by created_at desc;

-- 3. 특정 referral code의 이벤트 타임라인 확인
-- select event_type, referral_code, source, metadata, created_at
-- from public.referral_events
-- where referral_code_id = :referral_code_id
--    or referral_code = :referral_code
-- order by created_at asc;

-- 4. invitee 기준 confirmed 중복 탐지 (phone)
-- select invitee_phone, count(*) as confirmed_count
-- from public.referral_attributions
-- where status = 'confirmed'
-- group by invitee_phone
-- having count(*) > 1;

-- 5. invitee 기준 confirmed 중복 탐지 (fc_id)
-- select invitee_fc_id, count(*) as confirmed_count
-- from public.referral_attributions
-- where status = 'confirmed'
--   and invitee_fc_id is not null
-- group by invitee_fc_id
-- having count(*) > 1;

-- 6. inviter / invitee orphan row 탐지
-- select ra.*
-- from public.referral_attributions ra
-- left join public.fc_profiles inviter on inviter.id = ra.inviter_fc_id
-- left join public.fc_profiles invitee on invitee.id = ra.invitee_fc_id
-- where (ra.inviter_fc_id is not null and inviter.id is null)
--    or (ra.inviter_fc_id is null and coalesce(ra.inviter_phone, '') = '')
--    or (ra.invitee_fc_id is not null and invitee.id is null);

-- 7. 장기 pending attribution 탐지
-- select *
-- from public.referral_attributions
-- where status in ('captured', 'pending_signup')
--   and created_at < now() - interval '1 day'
-- order by created_at asc;

-- 8. admin override 이벤트 확인
-- select *
-- from public.referral_events
-- where event_type = 'admin_override_applied'
-- order by created_at desc;

-- 9. inviter 계정 삭제 후 snapshot 보존 확인
-- select id, inviter_fc_id, inviter_phone, inviter_name, referral_code, status
-- from public.referral_attributions
-- where inviter_fc_id is null
--   and coalesce(inviter_phone, '') <> ''
-- order by updated_at desc;
