doc_id: FC-DATA-REFERRAL
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-04-13
source_of_truth: supabase/schema.sql + supabase/migrations/20260323000001_add_referral_schema.sql + supabase/migrations/20260325000001_add_referral_code_admin_foundation.sql + supabase/migrations/20260404000001_allow_manager_referral_codes.sql

# Data Handbook: Referral Schema And Admin RPCs

## 핵심 테이블

- `referral_codes`
- `referral_attributions`
- `referral_events`

## self-service trusted reads / writes

- FC/본부장 self-service current read path는 `hooks/use-my-referral-code.ts -> get-my-referral-code`다.
- FC/본부장 self-service referral tree path는 `hooks/use-referral-tree.ts -> get-referral-tree -> get_referral_subtree(...)`다.
- referral tree의 현재 모바일 기본 surface는 `app/referral.tsx` 내부 섹션이며, `app/referral-tree.tsx`는 legacy 진입을 `/referral`로 보내는 compatibility route만 유지한다.
- 현재 모바일 상단 surface는 ancestor chain 전체가 아니라 `get-referral-tree.ancestors`의 마지막 노드만 direct recommender 카드로 렌더링한다.
- 본부장은 앱 UI role이 `admin + readOnly`여도 trusted app session source role이 `manager`면 같은 self-service 대상이다.
- `get-my-referral-code`는 active code뿐 아니라 현재 추천인 표시 cache(`fc_profiles.recommender`)도 같은 trusted 응답으로 반환한다.
- `app/referral.tsx`는 current recommender를 direct client `fc_profiles` query로 읽지 않고 위 self-service 응답을 사용한다.
- `get-referral-tree`는 ancestor chain + descendant subtree를 service-role RPC로 읽고, descendant lazy expand도 같은 trusted path를 다시 사용한다.
- backend는 ancestor chain 전체를 계속 반환하더라도, 모바일 UI는 현재 마지막 ancestor 1명만 표시하는 것이 intended contract다.
- tree lazy expand 인가는 `requested fcId === self` 또는 `self subtree membership` 기준이어야 하며, FC/본부장이 자기 서브트리 밖 `fcId`를 임의 조회하게 열어두면 안 된다.
- `update-my-recommender`는 `referral_attributions`를 `manual_entry` / `manual_entry_only` 계약으로 갱신하고, `referral_events`에는 `invitee_fc_id` + `metadata` 기준 `referral_confirmed` audit row를 남겨야 한다.

## 운영 함수

- backfill
- issue
- rotate
- disable

## 2026-04-04 manager eligibility / review hardening 메모

- `20260404000001_allow_manager_referral_codes.sql` 이후 completed manager-linked FC도 referral code issuance/backfill 대상에 포함된다.
- 추천인 graph/read model은 여전히 read-only이며 manager admin mutate path를 넓히지 않는다.
- compatibility alias `get-fc-referral-code`는 current app hook path가 아니고, optional `phone` body도 인증된 세션 전화번호와 일치할 때만 허용한다.

## 문서 주의

- 1차 schema migration만 보면 불완전합니다.
- admin foundation migration까지 반영된 현재 계약을 기준으로 읽습니다.
