doc_id: FC-DATA-MODEL-CANON
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-04-04
source_of_truth: supabase/schema.sql + supabase/migrations/*

# Data Handbook: Data Model Canon

## canonical 원칙

- `fc-onboarding-app`는 `supabase/schema.sql`과 matching migration을 함께 canonical snapshot으로 봅니다.
- schema 변경은 `schema.sql`과 `supabase/migrations/*.sql`를 반드시 동시 갱신합니다.
- request_board는 별도 canonical runtime contract를 사용하므로 혼동하지 않습니다.

## 핵심 테이블군

- `fc_profiles`
- `fc_identity_secure`
- `fc_credentials`
- `admin_accounts`
- `manager_accounts`
- docs/board/notification/presence/referral 관련 테이블

## 온보딩 상태 핵심 컬럼

- `fc_profiles.status`
- `fc_profiles.temp_id`
- `fc_profiles.allowance_date`
- `fc_profiles.allowance_prescreen_requested_at`
- `fc_profiles.allowance_reject_reason`
- `fc_profiles.hanwha_commission_date_sub`
- `fc_profiles.hanwha_commission_date`
- `fc_profiles.hanwha_commission_reject_reason`
- `fc_profiles.hanwha_commission_pdf_path`
- `fc_profiles.hanwha_commission_pdf_name`
- `fc_profiles.appointment_schedule_life`
- `fc_profiles.appointment_schedule_nonlife`
- `fc_profiles.appointment_date_life_sub`
- `fc_profiles.appointment_date_nonlife_sub`
- `fc_profiles.appointment_date_life`
- `fc_profiles.appointment_date_nonlife`
- `fc_profiles.life_commission_completed`
- `fc_profiles.nonlife_commission_completed`

## 2026-03-30 수당동의 보조 필드 메모

- `allowance_prescreen_requested_at`은 수당동의 단계 내부에서 `FC 수당 동의 입력 완료`와 `사전 심사 요청 완료`를 구분하는 전용 보조 필드입니다.
- top-level status는 그대로 `allowance-pending / allowance-consented`를 유지하고, 앱/웹 라벨 helper가 `allowance_date`, `allowance_prescreen_requested_at`, `allowance_reject_reason` 조합으로 파생 표시를 계산합니다.
- `20260330000001_add_allowance_prescreen_requested_at.sql`은 위 컬럼을 추가합니다.
- `20260330000002_relax_allowance_flow_requires_date.sql`은 수당동의 제약식을 다시 적용하면서, `allowance_date`가 비어 있는 행의 `allowance_prescreen_requested_at`, `allowance_reject_reason`, 잘못된 `allowance-consented` 상태를 정리합니다.
- 결과적으로 총무는 trusted 경로에서 `allowance_date` 유무와 관계없이 수당동의 단계를 조작할 수 있지만, 파생 라벨은 여전히 `allowance_date` 존재 여부를 우선 반영합니다.

## 2026-03-31 시험 신청 회차-지역 무결성 메모

- `exam_registrations.round_id`와 `exam_registrations.location_id`는 각각만 FK로 보지 않고, 같은 row에서 동일 회차를 가리켜야 합니다.
- `20260331000001_enforce_exam_registration_location_round_match.sql`은 `exam_locations (id, round_id)` 복합 unique 제약과 `exam_registrations (location_id, round_id) -> exam_locations (id, round_id)` 복합 FK를 추가합니다.
- 이 migration은 기존 오염 row `fc0421cd-6016-4732-b28f-324246085bc4`를 `4월 4차 생명보험 / 춘천`으로 재매핑한 뒤 제약을 추가합니다.
- 결과적으로 시험 신청은 선택한 회차에 속한 응시 지역만 저장 가능하며, 다른 회차의 `location_id`를 섞어 저장할 수 없습니다.

## 2026-03-31 추천인 코드 조회 RPC 메모

- `referral_attributions`는 관리자 전용 RLS 테이블이므로, 모바일 anon 클라이언트는 직접 조회하지 않습니다.
- `20260331000002_get_invitee_referral_code_fn.sql`은 `public.get_invitee_referral_code(uuid)` `SECURITY DEFINER` 함수를 추가합니다.
- `20260331000003_fix_get_invitee_referral_code_lookup.sql`은 위 함수를 이름 문자열이 아니라 `recommender_fc_id`와 structured attribution만 사용하도록 수정합니다.
- `20260401000002_reassert_get_invitee_referral_code_service_role_only.sql`은 execute grant를 `service_role` only로 다시 고정합니다.
- `20260402000002_fix_invitee_referral_code_history_priority.sql`은 lookup order를 historical-first로 바꿔, confirmed attribution이 있으면 `referral_code_id -> referral_code snapshot -> inviter active code` 순으로 먼저 읽고 `recommender_fc_id` 현재 활성 코드는 마지막 degraded fallback으로만 사용하게 합니다.
- `20260410000001_add_referral_subtree_rpc.sql`은 `public.get_referral_subtree(root_fc_id uuid, max_depth int)`를 추가해 root row + ancestor chain + descendant subtree + descendant counts를 `service_role` only trusted read로 반환합니다.

## 2026-04-04 추천인 self-service / manager eligibility 메모

- `20260404000001_allow_manager_referral_codes.sql` 이후 completed manager-linked FC도 referral code issuance/backfill 대상 canonical set에 포함됩니다.
- `referral_attributions.source`는 `auto_prefill | manual_entry | admin_override`, `selection_source`는 `auto_prefill_kept | auto_prefill_edited | manual_entry_only | admin_override`만 허용합니다.
- self-service recommender update도 위 enum 계약을 그대로 따라야 하며, schema와 다른 provenance 문자열을 새로 추가하지 않습니다.
- `referral_events` canonical 컬럼명은 `invitee_fc_id`, `metadata`입니다. self-service audit write도 이 계약을 따릅니다.
- mobile referral tree self-service는 direct table/RPC 호출을 열지 않고 `get-referral-tree` Edge Function만 사용합니다. descendant lazy expand는 caller 자기 서브트리 membership이 확인된 `fcId`만 허용해야 합니다.
