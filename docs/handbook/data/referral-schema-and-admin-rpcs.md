doc_id: FC-DATA-REFERRAL
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-09-07
source_of_truth: supabase/schema.sql + supabase/migrations/20260323000001_add_referral_schema.sql + supabase/migrations/20260325000001_add_referral_code_admin_foundation.sql + supabase/migrations/20260404000001_allow_manager_referral_codes.sql + supabase/migrations/20260810070757_admin_assisted_signup_v1.sql + supabase/migrations/20260907053913_referral_allowance_pilot.sql + supabase/migrations/20260907115710_referral_allowance_recipients.sql

# Data Handbook: Referral Schema And Admin RPCs

## 핵심 테이블

- `referral_codes`
- `referral_attributions`
- `referral_events`

## self-service trusted reads / writes

- FC/본부장 self-service current read path는 `hooks/use-my-referral-code.ts -> get-my-referral-code`다.
- FC/본부장 self-service referral tree path는 `hooks/use-referral-tree.ts -> get-referral-tree -> get_referral_subtree(...)`다.
- FC/본부장 native referral graph path는 `app/referral-graph.tsx -> hooks/use-referral-graph.ts -> get-referral-tree(mode='graph')`다.
- `/referral-revenue-graph`는 `data/referral-revenue-demo.ts`의 가상 parent chain만
  사용하는 로컬 샘플이며 이 문서의 referral schema, RPC, Edge Function 또는
  실제 사용자 관계를 읽지 않는다. 표시된 1~10단계 10%는 UI 시뮬레이션이지
  운영 정산 계약이 아니다.
- 이 샘플은 추천 관계 graph의 순수 radial layout/fit helper로 같은 원형 node·관계선·
  pan/pinch·fit/reset UI를 만들지만, 실제 graph data hook이나 component는 사용하지
  않는다. 기존 physics/WebView와 선택형 graph/tree/list mode도 현재 route에서
  사용하지 않는다.
- 각 대상 node의 샘플 예상액은 child→parent 방향으로 viewer까지 전달되고, 같은
  관계선을 지나는 금액은 합산 label로 보인다. 제외 관계는 회색 점선/no-flow다.
  node와 label은 zoom out 시 함께 작아진다. 이는 시각화 계약일 뿐 referral read
  model이나 운영 정산 계약을 변경하지 않는다.
- FC/본부장 self-service referral session guard는 `hooks/use-referral-app-session.ts -> refresh-app-session`이다.
- referral tree의 현재 모바일 기본 surface는 `app/referral.tsx` 내부 섹션이며, `app/referral-tree.tsx`는 legacy 진입을 `/referral`로 보내는 compatibility route만 유지한다.
- 현재 모바일 상단 surface는 ancestor chain 전체가 아니라 `get-referral-tree.ancestors`의 마지막 노드만 direct recommender 카드로 렌더링한다.
- 본부장은 앱 UI role이 `admin + readOnly`여도 trusted app session source role이 `manager`면 같은 self-service 대상이다.
- `get-my-referral-code`는 active code뿐 아니라 현재 추천인 표시 cache(`fc_profiles.recommender`)도 같은 trusted 응답으로 반환한다.
- `app/referral.tsx`는 current recommender를 direct client `fc_profiles` query로 읽지 않고 위 self-service 응답을 사용한다.
- `get-referral-tree`는 ancestor chain + descendant subtree를 service-role RPC로 읽고, descendant lazy expand도 같은 trusted path를 다시 사용한다.
- additive graph mode는 signed FC/manager session의 자기 profile id를 root로 고정하고 canonical `recommender_fc_id` downline만 읽는다. body `fcId`는 graph scope를 넓힐 수 없으며 응답에는 phone/audit/mutation 필드를 포함하지 않는다. Graph eligibility는 breadth-first traversal 중 300-node 한도 전에 적용하고 manager referral shadow 관계는 보존한다. 대량 id/child/code 조회는 chunk/fixed-page 처리하며 남은 유효 slot+1에서 탐색을 멈추고, 초과 관계를 `truncated`로 알린다.
- self-service functions(`get-my-referral-code`, `get-referral-tree`, `search-fc-for-referral`, `update-my-recommender`, legacy `get-fc-referral-code`, `get-my-invitees`)는 missing/expired/invalid app session을 구분해 반환하고, 클라이언트는 bridge token으로 1회 silent refresh 후 재시도한다.
- `refresh-app-session`은 request_board bridge token을 다시 검증한 뒤 completed FC와 active manager만 새 referral `appSessionToken`을 발급한다. plain admin/developer phone, linked designer, signup 미완료 FC는 `forbidden`이다.
- backend는 ancestor chain 전체를 계속 반환하더라도, 모바일 UI는 현재 마지막 ancestor 1명만 표시하는 것이 intended contract다.
- tree lazy expand 인가는 `requested fcId === self` 또는 `self subtree membership` 기준이어야 하며, FC/본부장이 자기 서브트리 밖 `fcId`를 임의 조회하게 열어두면 안 된다.
- `update-my-recommender`는 `referral_attributions`를 `manual_entry` / `manual_entry_only` 계약으로 갱신하고, `referral_events`에는 `invitee_fc_id` + `metadata` 기준 `referral_confirmed` audit row를 남겨야 한다.

## signup trusted reads / writes

- 비로그인 회원가입 추천인 검색 current path는 `app/signup.tsx -> search-signup-referral`이다.
- `search-signup-referral`은 app session 없이 호출되지만, 응답은 `name`, `affiliation`, `code`만 반환하고 전화번호/주민정보 같은 PII를 노출하지 않는다.
- signup search 결과는 active referral code가 있는 후보만 반환해야 한다. 회원가입 화면이 결과를 선택해도 최종 payload는 기존 `referralCode` + `referralInviterFcId`만 유지하고, `validate-referral-code`를 다시 통과한 뒤 `set-password`가 확정한다.
- 관리자 서면확인 가입은 `admin_create_assisted_signup_v1`에서 선택된 active 추천인 FC를 다시 검증하고 `apply_referral_link_state(..., source='admin_override', reason='admin_assisted_signup')`를 호출한다. 관리자 화면의 표시 문자열을 직접 `fc_profiles.recommender`에 쓰지 않는다.
- RPC의 프로필·추천 링크·임시 자격증명·서면확인 원장은 단일 트랜잭션이다. referral 적용 실패 시 가입 완료 상태나 임시 비밀번호만 남으면 회귀다.

## 운영 함수

- backfill
- issue
- rotate
- disable

## 2026-04-04 manager eligibility / review hardening 메모

- `20260404000001_allow_manager_referral_codes.sql` 이후 completed manager-linked FC도 referral code issuance/backfill 대상에 포함된다.
- 추천인 graph/read model은 여전히 read-only이며 manager admin mutate path를 넓히지 않는다.
- compatibility alias `get-fc-referral-code`는 current app hook path가 아니고, optional `phone` body도 인증된 세션 전화번호와 일치할 때만 허용한다.

## 2026-04-23 추천인 current-state 단일화 메모

- `20260423000001_unify_referral_link_state.sql` 이후 invitee-facing 추천인 current state의 canonical snapshot은 `fc_profiles.recommender_fc_id`, `recommender_code_id`, `recommender_code`, `recommender_linked_at`, `recommender_link_source`다.
- `recommender_link_source`는 `signup | self_service | admin_override | legacy_migration`만 허용한다. signup/self-service/admin 경로가 새 provenance 문자열을 임의로 만들면 schema drift로 본다.
- `supabase/functions/_shared/referral-link.ts`의 `applyReferralLinkState(...)`가 signup(`set-password`), self-service(`update-my-recommender`), admin referral mutate path가 공유하는 단일 write helper다. invitee current-state를 바꾸는 경로가 이 helper/RPC를 우회해 `fc_profiles`를 직접 따로 갱신하면 회귀로 본다.
- `get-my-referral-code`, `get-my-invitees`, `get-referral-tree`, 관리자 `/api/admin/referrals`, 추천인 그래프 edge normalizer는 모두 위 `fc_profiles` snapshot을 current read SSOT로 사용하고, `referral_attributions`는 운영 이력/legacy 보조 데이터로만 취급한다.
- `public.get_invitee_referral_code(uuid)`는 invitee-facing 현재 스냅샷 `fc_profiles.recommender_code`를 trusted helper로 반환한다.
- 모바일 `ReferralTreeNode`와 관리자 그래프의 사용자용 문구/강조 색상은 바뀔 수 있어도, visible edge는 계속 `recommender_fc_id` 기반 구조화 링크를 기준으로 읽는다.

## 2026-04-26 관리자 graph layout/physics 메모

- 관리자 `/dashboard/referrals/graph` layout/physics 변경은 API/DB/schema 변경이 아니다.
- `GraphApiResponse`는 추천 edge/read-only 계약을 유지하되, `GraphNode.allCommissionsCompleted`를 함께 내려준다. 이 값은 `life_commission_completed || appointment_date_life`와 `nonlife_commission_completed || appointment_date_nonlife`가 모두 true인 경우다.
- graph helper는 response를 받은 뒤 client-side component/star/orphan seed와 cluster metadata만 계산한다.
- layout helper는 connected component를 크기순으로 중앙에 가깝게 두고, hub direct child를 부모 주변 star/pinwheel seed로 배치하며, isolated node는 제한된 golden-angle seed로만 분산한다. 이 정보는 API 계약이 아니라 client layout metadata다.
- runtime은 d3 `charge`와 기존 internal `link` force에 보조 force를 얹는다. 현재 보조 force는 link tension, branch bend, sibling angular separation, node separation, visual cluster separation, component separation, cluster/component envelope, weak cluster gravity, drag rope constraint다.
- 고정 반경 `radial-containment`, 강제 `isolated-ring`, drop tether, release velocity injection은 현 계약에서 금지한다. 중심 보정은 cluster 단위 약한 gravity로만 유지하고, 노드 수가 늘어날 때 특정 원 안에 강제로 가두면 회귀로 본다.
- drag 중에는 pointer 대상 노드만 `fx/fy`로 고정하고, 연결 노드는 rope constraint가 incident edge stretch를 제한한다. release 때는 `fx/fy`를 해제하고 simulation을 reheat한다.

## 문서 주의

- 1차 schema migration만 보면 불완전합니다.
- admin foundation migration까지 반영된 현재 계약을 기준으로 읽습니다.

## 2026-09-07 월별 증원수당 대상자 계약

- 실제 명세 조회는 `hooks/use-referral-allowance.ts -> get-my-referral-allowance -> read_referral_allowance_pilot`이다. 가상 데모와 현재 DB 추천 계보를 월별 수당 snapshot의 대체 자료로 사용하지 않는다.
- `20260907115710_referral_allowance_recipients.sql`은 초기 단일 설정을 대상자별 `referral_allowance_recipients`로 옮기며 기존 게시 명세/revision은 보존한다. 수령인 FC UUID와 외부 사번은 각각 유일하고 manager UUID는 본부장만 갖는다. FC는 가입 완료·manager/admin identity 없음, 본부장은 같은 정규화 전화번호에 대응하는 활성 manager와 completed/shadow FC가 필요하다. 설계매니저는 제외한다.
- 테이블 RLS와 public/anon/authenticated 권한 회수를 유지한다. 기존 이름의 configure/create-draft/publish/read RPC는 service-only SECURITY INVOKER이며, 현재는 각 수령인 행을 잠그고 검증한다. 클라이언트는 수령인이나 actor를 선택할 수 없다.
- 관리자 API는 서명된 활성 admin과 같은 Origin을 요구한다. GET의 beneficiaryFcId는 관리자용 대상자 선택이며 해당 수령인의 이력/명세로 제한한다. 업로드는 대상 ID와 예상 설정 revision을 함께 보내고 원본 사번을 서버에서 구한다. 게시 시 draft ID·출처 hash·draft revision·설정 revision을 다시 검증한다.
- 설정·생성·게시의 잠금과 불변 snapshot, 수령인/월별 단일 게시본 및 동일 출처 업로드의 멱등성을 유지한다. 한 대상자의 중지·변경은 다른 대상에게 영향을 주지 않는다. 새 설정 revision에서는 이전 게시본을 열지 않는다.
- 정책 `recruitment-2026-09-07-snapshot-pilot-v1`은 업로드 원본의 재적/직급·10단계·부호 있는 수당을 사용한다. 첫 자료는 6월 실적, 8월 1일 지급, 7월 31일 참고이며 실제 7~8월 원본 날짜와 이후 원본 사용 여부를 별도로 표시한다. 원본 XLSX/전화번호/사번을 공개 snapshot에 저장하지 않는다. ZIP/좌표/용량, 캐시 대상업적의 원천 열 계산, 날짜/노드/금액 보존 제약을 유지한다.
- Edge는 signed FC/manager의 정확한 profile과 수령인 행을 매번 확인한다. body에는 action/month만 허용한다. 응답은 그 사람의 게시된 월 목록과 선택 명세뿐이며 익명 요청은 401/no-store다.
- 사용자 승인으로 migration `20260907115710`, Edge v2 ACTIVE, 19명(18명 신규)의 6월 게시가 완료됐다. 각 명세와 작업자/원본 결과가 일치하고 기존 시범 revision은 1이다. 보류 24명은 별도 사용자 명단으로 정리했다. 공개 모바일/웹 배포와 실기기 검증은 별도다.
- 계보 4개·200개 관계를 DB와 대조해 null 연결 25건만 기존 audited RPC로 추가했다. non-null 변경 0건, 기존 불일치 21건 유지, 관리자 상위자 후보 2건과 신원 미확정 122건 보류다. 역할 규칙을 우회하거나 계정을 만들지 않았다.
