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

-- 10. 추천코드 백필 대상(운영 계정/설계매니저 제외) 후보 확인
-- select fp.id, fp.name, fp.phone, fp.affiliation
-- from public.fc_profiles fp
-- where fp.signup_completed = true
--   and coalesce(fp.phone, '') ~ '^[0-9]{11}$'
--   and coalesce(fp.affiliation, '') not like '%설계매니저%'
--   and not exists (select 1 from public.admin_accounts aa where aa.phone = fp.phone)
--   and not exists (select 1 from public.manager_accounts ma where ma.phone = fp.phone)
--   and not exists (
--     select 1
--     from public.referral_codes rc
--     where rc.fc_id = fp.id
--       and rc.is_active = true
--   )
-- order by fp.created_at asc;

-- 11. FC별 활성 추천코드 중복 탐지
-- select fc_id, count(*) as active_code_count
-- from public.referral_codes
-- where is_active = true
-- group by fc_id
-- having count(*) > 1;

-- 12. 최근 추천코드 운영 이벤트와 감사 metadata 확인
-- select event_type, inviter_fc_id, referral_code, metadata, created_at
-- from public.referral_events
-- where event_type in ('code_generated', 'code_rotated', 'code_disabled')
-- order by created_at desc
-- limit 50;

-- 13. manager/admin 전화번호와 겹치는 FC 추천코드 보유 여부 점검
-- select fp.id, fp.name, fp.phone, rc.code, rc.is_active
-- from public.fc_profiles fp
-- join public.referral_codes rc
--   on rc.fc_id = fp.id
-- where exists (select 1 from public.admin_accounts aa where aa.phone = fp.phone)
--    or exists (select 1 from public.manager_accounts ma where ma.phone = fp.phone)
-- order by rc.created_at desc;
