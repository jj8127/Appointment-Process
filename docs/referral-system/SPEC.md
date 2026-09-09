# 추천인 시스템 스펙

- 기준일: `2026-04-23`
- 상태: `추천인 current-state는 fc_profiles 단일 SSOT + apply_referral_link_state RPC로 정리됐고, referral_attributions는 archival-only historical data로 강등됐다. 앱 미설치 복원과 일부 runtime 재검증은 미완료`
- 범위: `가람in` 가입/초대 흐름

## 1. 목표

- A의 권유 또는 공유로 B가 가입했는지 신뢰 가능한 방식으로 남긴다.
- 플레이스토어 검색 설치처럼 초대링크만으로 끊기는 경로를 `추천코드 fallback`으로 보완한다.
- 장애가 나더라도 어떤 단계에서 추천 정보가 유실됐는지 추적 가능해야 한다.

## 2. 핵심 결정

### 2.1 기본 방식

- `자동 입력 pending code + 단일 검색/선택 fallback`을 기본 구조로 채택한다.
- 초대링크 유입 정보가 있으면 회원가입 화면의 추천인 검색 입력에 추천코드를 미리 채운다.
- 자동 입력은 기본값일 뿐이며, 가입 완료 전에는 사용자가 다른 이름/소속/추천코드로 다시 검색해 다른 후보를 선택할 수 있다.
- 현재 회원가입 화면은 `/referral`과 같은 `단일 추천인 검색 입력`만 사용한다. direct code input은 두지 않고, 이름/소속/추천코드(붙여넣은 8자리 코드 포함) 모두 검색 결과에서 1명을 선택해야 한다.
- 회원가입 검색은 unauthenticated trusted path `search-signup-referral`로 active code가 있는 후보만 찾고, 최종 저장은 선택된 후보의 추천코드 문자열로 수렴한다.
- `search-signup-referral`은 exact 8자리 추천코드 query를 broad fuzzy search로 흘리지 않고, 정규화한 코드 기준 exact active-code lookup으로 먼저 short-circuit한다.
- 검색 입력 문자열은 검색 query로만 취급하고, 실제 저장 후보는 선택된 결과의 추천코드만 사용한다. 선택된 코드만 `validate-referral-code` trusted path로 inviter 정보를 검증한다.
- `validate-referral-code`는 `inviterName`, `inviterPhoneMasked`, `inviterFcId`, `codeId`를 반환한다.
- 최종 가입 시 서버는 caller가 보낸 추천인 문자열을 신뢰하지 않고, 추천코드 row를 다시 조회해 구조화 inviter identity를 확정한다.

### 2.2 확정 시점

- 추천 관계의 1차 확정 시점은 `회원가입 완료`다.
- 가람in 온보딩 전체 완료와 추천 확정을 묶지 않는다.
- 가입 전 `pending attribution` 서버 row는 현재 구현하지 않았다. 앱은 로컬 pending code만 유지한다.
- `set-password`는 OTP trusted path가 이미 만든 `phone_verified=true` `fc_profiles` row만 최종 가입으로 승격한다. 미인증 번호나 fresh number direct call은 새 FC 프로필/credentials를 만들지 않고 거절한다.
- `set-password` Edge Function은 유효한 추천코드가 해석된 경우 새 secure RPC `apply_referral_link_state(...)`를 호출해 current-state와 감사 이벤트를 원자적으로 기록한다.
- `apply_referral_link_state(...)`는 `fc_profiles.recommender_fc_id`, `fc_profiles.recommender`, `fc_profiles.recommender_code_id`, `fc_profiles.recommender_code`, `fc_profiles.recommender_linked_at`, `fc_profiles.recommender_link_source`를 한 번에 갱신하고 `referral_events`에 `referral_linked/referral_changed/referral_cleared` 중 1건만 남긴다.
- `set-password`는 `fc_credentials.password_set_at`를 먼저 확인한 뒤에만 profile reset/update를 수행한다. 이미 가입이 끝난 FC에 대한 중복 호출이 추천인/온보딩 상태를 지우는 동작은 허용하지 않는다.
- `login-with-password`는 completed FC 또는 active manager referral shadow profile에 대해 로그인 성공 직후 active 추천코드를 idempotent하게 보장한다. 이미 active code가 있으면 그대로 유지하고, 없을 때만 `p_rotate=false` 기준으로 생성한다.
- 추천코드 provisioning 실패가 로그인 자체를 깨면 안 된다. 로그인은 계속 성공시키고, 이후 `get-my-referral-code` trusted path가 같은 보장 로직으로 legacy/transient no-code 상태를 catch-up한다.
- `referral_attributions`는 더 이상 live current-state write source가 아니다. 기존 historical row는 보존하지만, 신규 current-state는 `fc_profiles` + `referral_events`만으로 해석한다.
- 현재 `set-password`가 남기는 실패 이벤트는 `referral_rejected`까지만 유지한다. 성공 current-state는 attribution status가 아니라 `apply_referral_link_state(...)` 결과로 판단한다.

### 2.3 우선순위

- 자동 입력된 pending 추천코드는 회원가입 화면 검색 입력의 기본 query로만 사용한다.
- 자동 입력된 코드가 있더라도 사용자가 검색 결과에서 다른 후보를 다시 선택하면 `마지막으로 명시 선택한 추천코드`를 우선한다.
- 가입 완료 후에는 일반 사용자 경로로 추천인을 변경할 수 없고, 운영 수정이 필요하면 `admin override`로만 처리한다.
- FC 기본정보 화면의 `recommender` cache는 읽기 전용 표시값으로만 남기고, 일반 사용자 저장 payload에 자유입력 추천인 문자열을 다시 포함하지 않는다.

### 2.4 불변 규칙

- 한 추천인(`inviter`)은 여러 명의 가입자를 추천할 수 있다.
- 한 가입자(`invitee`)는 최종적으로 추천인 1명만 가진다.
- 자기 자신 추천 금지
- 이미 확정된 추천 관계의 무단 덮어쓰기 금지
- 추천 관계 변경은 관리자 감사 로그 없이는 허용하지 않음
- 추천코드만 저장하고 추천인 사용자 정보가 없는 고아 상태 금지
- 추천인 live current-state(`fc_profiles.recommender_*`, `referral_codes`, `referral_events`)는 direct client access를 허용하지 않고 trusted server path로만 다룬다.
- completed FC/active manager가 정상 로그인한 뒤에도 추천코드 생성을 위해 별도 운영 개입이나 추가 인증 단계를 요구하지 않는다.
- `public.get_invitee_referral_code(uuid)`의 intended repo contract는 migration `20260401000002_reassert_get_invitee_referral_code_service_role_only.sql` 이후 `service_role` execute only 다. 원격 DB가 모두 그 상태인지 확인하지 않았다면 rollout 미검증 상태로 기록하고, 예외 상태를 의도 계약처럼 문서화하지 않는다.
- FC 삭제/재가입 정리 후에도 추천 current-state snapshot과 이벤트 감사 흔적은 남아야 한다.
- 추천인 current-state SSOT는 `fc_profiles.recommender_fc_id`, `fc_profiles.recommender`, `fc_profiles.recommender_code_id`, `fc_profiles.recommender_code`, `fc_profiles.recommender_linked_at`, `fc_profiles.recommender_link_source`다.
- `referral_events`는 current-state 변경 이력 감사 SSOT다. `referral_attributions`는 archival-only historical data이며 현재 추천 관계 판단에 다시 끌어오지 않는다.
- `fc_profiles.recommender`는 trusted signup/admin path만 갱신할 수 있는 읽기 전용 cache다. 일반 FC 정보 수정 화면에서 자유입력으로 덮어쓰지 않는다.

## 3. 용어

- `inviter`: 추천한 사람(A)
- `invitee`: 추천받아 가입한 사람(B)
- `referral_code`: 추천인 식별 코드
- `invite_link`: 추천코드를 포함한 공유 URL
- `pending attribution`: 아직 가입 완료 전인 추천 추적 상태
- `confirmed referral`: 가입 완료 후 확정된 추천 관계
- `override`: 가입 완료 후 운영자가 예외적으로 추천 관계를 수정하는 행위
- `direct client access`: 앱/웹 클라이언트가 추천인 테이블을 직접 조회/쓰기하는 방식
- `trusted server path`: Edge Function 또는 service-role route가 추천인 테이블을 읽고 쓰는 경로

## 4. 사용자 흐름

### 4.1 자동 입력 추천코드

1. B가 초대링크 또는 유입 정보를 가진 상태로 회원가입 흐름에 진입한다.
2. 회원가입 화면의 추천인 검색 입력에 추천코드가 자동으로 채워지고, signup trusted search가 같은 코드를 검색한다.
3. 사용자는 자동 채워진 query 결과에서 추천인을 선택하거나, 다른 이름/소속/추천코드로 다시 검색해 다른 후보를 선택할 수 있다.
4. 현재 구현은 pending attribution row를 서버에 저장하지 않고 앱 로컬 pending code만 유지한다.
5. 가입 완료 시 `set-password` trusted path가 추천 관계를 1건 확정한다.

### 4.2 초대링크

1. A가 본인 링크를 공유한다.
2. B가 링크를 클릭한다.
3. 앱이 이미 설치된 경우 `hanwhafcpass://signup?code=<referral_code>`로 앱이 열린다.
4. `app/_layout.tsx`가 추천코드를 로컬 pending storage에 저장한다.
5. 회원가입 화면이 pending code를 1회 소비해 추천인 검색 입력 query로 자동 채우고 결과를 조회한다.
6. 가입 완료 시 `set-password`가 추천 관계를 확정한다.
7. 공유 메시지는 `EXPO_PUBLIC_INVITE_BASE_URL`가 있으면 HTTPS invite URL을 포함하고, iOS 설치 fallback은 `EXPO_PUBLIC_APP_STORE_URL`가 설정된 경우 direct App Store URL을 사용한다. 값이 없으면 `App Store에서 "가람in" 검색` 안내로 degrade한다.
8. 앱의 모든 추천코드 공유 진입점(`/referral`, `/settings`)은 `lib/referral-share.ts`의 동일한 공유 문구 builder를 사용해야 한다. 사용자에게 공유되는 문구에는 direct `hanwhafcpass://signup?...` 링크를 직접 노출하지 않고 HTTPS invite URL을 노출한다.

- 현재 앱 deep link 계약은 `hanwhafcpass://signup?code=<referral_code>`다.
- cold start에서는 pending code만 저장하고, warm start에서만 `/signup` 이동을 추가로 수행한다.
- 회원가입 화면의 pending code 적용은 single-flight로 처리한다. focus/reopen/referralNonce가 겹쳐도 같은 pending code search를 중복 예약하지 않는다.
- landing click 로그, store redirect persistence, install referrer/deferred deep link 복원은 포함되지 않는다.

### 4.3 앱 미설치/스토어 진입 경로의 현재 상태

1. 초대링크 클릭 후 앱이 바로 열리지 않는 경로는 아직 자동 복원 계약이 없다.
2. 앱 설치 후 첫 실행에서 추천 정보가 자동 복원된다고 가정하지 않는다.
3. 현재 운영 fallback은 회원가입 화면의 추천인 검색 입력에서 이름/소속/추천코드를 검색하고 결과에서 1명을 선택하는 방식이다.

### 4.4 링크 유실 fallback

1. B가 링크를 눌렀지만 스토어 검색/설치 후 추천 정보가 복원되지 않는다.
2. 회원가입 화면의 추천인 검색 입력에서 이름/소속/추천코드를 검색하고 결과에서 1명을 선택한다.
3. 가입 완료 시 수동 코드 기준으로 확정한다.

### 4.5 로그인 성공 시 active 추천코드 보장

1. completed FC 또는 active manager가 `login-with-password`로 로그인에 성공한다.
2. 본부장 경로는 필요 시 `ensure_manager_referral_shadow_profile(...)`로 referral shadow profile을 먼저 보장한다.
3. `ensure_manager_referral_shadow_profile(...)`은 본부장 fc profile을 만들거나 갱신한 뒤 `link_manager_profile_to_default_recommender(...)`로 김형수(`01094272550`)를 기본 추천인으로 연결한다.
4. 기본 추천인 연결은 `fc_profiles.recommender_*` current-state와 `referral_events` 감사 이력을 남겨야 하며, 김형수 본인과의 자기추천은 `self_link_blocked`로 차단한다.
5. 로그인 함수는 service-role helper로 `admin_issue_referral_code(..., p_rotate=false)`를 호출해 active code를 보장한다.
6. 이미 active code가 있으면 `noop_active_exists`로 끝나고 코드 값은 바뀌지 않는다.
7. provisioning이 일시 실패해도 로그인 응답은 유지하며, 이후 self-service current path가 같은 로직으로 catch-up한다.

### 4.6 FC/본부장 본인 추천코드 self-service 조회

1. 현재 앱 hook `useMyReferralCode()`는 `get-my-referral-code` Edge Function을 호출한다.
2. active self-service 조회는 `Authorization: Bearer <appSessionToken>` 기반으로 세션의 `role(fc|manager)`, `phone`, `fcId`만 사용해 대상 FC를 해석한다.
3. 본부장 세션은 앱 UI role이 `admin/readOnly`로 보이더라도 app session token source role이 `manager`이면 같은 self-service 경로로 active code / 현재 추천인 cache / invitee / 추천인 검색·저장을 수행할 수 있다.
4. `get-my-referral-code`는 eligible profile인데 active code가 비어 있으면 같은 trusted service-role issuance helper를 1회 실행한 뒤 다시 조회한다. rollout 이전 계정이나 login-time transient failure 때문에 로그인 뒤 no-code 상태가 남아도 사용자가 별도 발급 절차를 밟지 않게 하는 것이 현재 계약이다.
5. 추천인 페이지의 현재 추천인 표시는 direct client `fc_profiles` query가 아니라 같은 trusted self-service 응답(`get-my-referral-code`)에서 내려온 `recommender` cache를 사용한다.
6. legacy 로컬 세션에 `role='manager'`가 저장돼 있어도 앱 복원 단계에서 `admin + readOnly` UI state로 정규화돼 같은 self-service 동선을 유지해야 한다.
7. `get-fc-referral-code`는 legacy compatibility alias로 저장소에 남아 있어도 `2026-04-02` 기준 current app hook path는 아니다. 이 함수의 optional `phone` body는 세션 전화번호와 일치할 때만 허용된다.
8. 현재 모바일 기본 surface는 별도의 flat `내가 초대한 사람들` 목록을 렌더링하지 않고, `get-referral-tree` descendants 기반 tree만 사용한다.
9. `get-my-invitees`가 저장소에 남아 있더라도 현재 `app/referral.tsx` 기본 surface의 source는 아니다. 다만 별도 invitee list/count 지원 경로로 쓰는 경우에는 current structured contract를 따라야 한다.
10. `get-my-invitees`를 쓰는 보조 경로는 현재 canonical link인 `fc_profiles.recommender_fc_id = me` 기준으로 invitee를 구성해야 한다.
11. 보조 self-service 목록은 `recommender_linked_at` snapshot을 사용해 연결 시점을 보여주고, invitee 목록은 임의의 `50건` 정적 상한으로 잘라 보이지 않게 하면 안 된다.
12. 추천 관계 self-service의 현재 모바일 기본 surface는 `app/referral.tsx` 안의 `나를 추천한 사람` 카드 + `내가 추천한 사람들` 섹션이며, 데이터 경로는 `hooks/use-referral-tree.ts -> get-referral-tree -> get_referral_subtree(...)`다.
13. 이 화면은 상단에서 direct recommender 1명만 보여주고, 하단에서는 `내가 추천한 사람들(subtree drill-down)`만 caller 자기 서브트리 범위 안에서 보여준다. 루트까지의 전체 업라인 경로는 현재 모바일 UI에 노출하지 않는다.
14. 상단 카드의 direct recommender는 `fc_profiles.recommender_fc_id` 체인의 마지막 노드 기준이다. 따라서 실제 추천인이 active manager shadow profile로 저장된 경우에는 그 manager shadow 노드 1명만 카드에 보여야 한다.
15. `/referral`의 초기 tree read는 `depth: 2`를 유지해 첫 화면 렌더를 가볍게 가져가고, deeper branch는 descendant lazy expand로 이어간다.
16. descendant lazy expand는 같은 trusted path를 다시 호출하되, `fcId=self only`가 아니라 `caller subtree membership`이 확인된 descendant root만 허용해야 한다.
17. lazy expand로 읽어온 subtree의 `node_depth`는 subtree root 기준 상대 depth이므로, 화면 캐시에 합치기 전에 현재 `/referral` root 기준 absolute depth로 정규화해야 한다. tree row 들여쓰기/강조 스타일은 transport `node.depth`가 아니라 현재 렌더 depth 규칙을 따라야 한다.
18. 사용자가 어떤 branch를 펼치면, 이미 보이는 직속 자식 중 `하위가 더 있는데 아직 direct child가 캐시에 없는 노드`는 백그라운드로 1단계만 순차 prefetch할 수 있다. 이 prefetch는 spinner를 점유하거나 현재 expand를 block하면 안 된다.
19. 상단 direct recommender 카드는 `get-referral-tree`가 성공했는데 ancestor가 없으면 빈 상태를 그대로 보여야 한다. 이 경우 `get-my-referral-code`의 legacy/current recommender cache를 다시 fallback으로 보여 stale 추천인을 노출하면 안 된다.
20. `/referral`의 `추천 관계 그래프로 보기`는 외부 관리자 웹 URL을 열지 않고 앱 내부 `/referral-graph`로 이동하며 FC와 본부장 self-service 사용자에게 동일하게 노출한다.
21. `/referral-graph`는 signed app-session의 자기 FC를 root로 고정한 downline-only read surface다. request body의 `fcId`로 다른 root를 선택할 수 없고, plain admin/developer/designer는 허용하지 않는다.
22. 모바일 graph edge source는 canonical `fc_profiles.recommender_fc_id`뿐이다. 응답에는 전화번호·감사 이벤트를 포함하지 않고 `permissions.canMutate=false`, `scope='downline'`를 명시한다.
23. 모바일 graph는 deterministic radial layout, pan/pinch, fit/reset, 이름·소속·추천코드 검색, 등록 상태 filter, 선택 node 기준 1~3촌 focus, read-only 상세를 지원한다. node 색 우선순위는 현재 사용자 → 모든 위촉 완료 → 본등록 완료 → 사전등록이며 크기는 전체 하위 인원 수의 로그 스케일을 사용한다. 추천 관계 화면은 이름 영역을 포함한 하위 가지 가중치로 각도를 배분하고, 방사 방향의 빈 위치에 노드를 배치해 원과 표시 이름의 충돌을 막는다. 논리 좌표는 압축하지 않으며 SVG는 현재 화면 좌표만 물리 2048px 이내의 bitmap에 그린다. 축소 시 선택·현재 사용자·하위 인원이 많은 노드의 이름을 우선 배치하고 공간이 부족한 이름은 생략하며, 읽기 배율에서는 모든 이름과 선택 간격을 확보한다. 이동 중에는 culling 갱신과 독립적인 공통 pan 좌표를 유지한다. 확대·축소 중 이름·금액 레이어를 숨기지 않고 기존 배치를 연속 변환하며, 유효 제스처 종료 후 120ms 동안 새 동작이 없을 때 배치를 재계산한다. 확대된 라벨 전체 크기를 기준으로 viewport 표시 여부를 판단하고, 실패한 pinch 종료나 터치 시작 강조가 표시를 점멸시키지 않게 한다. Android 핀치는 raw touch count가 두 개 미만이면 마지막 focal update를 무시하며 시작 기준점과 현재 기준점을 분리해 손가락 해제 시 화면이 밀리지 않게 한다. 배율 badge는 이름 layer 위에 표시한다. 매출 흐름 화면의 기존 공용 배치 함수는 유지한다. 네이티브 view/접근성 tree 보호를 위해 유효 node 최대 300개까지만 breadth-first로 읽고, 한도 전에 직원·설계매니저 제외 규칙을 적용하며, 남은 관계가 있으면 `truncated=true`로 알린다. canonical 관계 경로의 manager referral shadow는 일반 descendant처럼 보존한다. desktop force physics와 node drag는 모바일 첫 delivery 범위가 아니다.
    성능 구현은 같은 배치를 유지하면서 관계선을 단일 SVG path와 공통 카메라 변환으로 그린다. 노드와 이름의 이동은 공통 부모 변환으로 처리하며, 이름 레이어는 제스처 중에도 연속 표시하고 배율이 안정된 뒤 배치만 갱신한다. 화면 밖 요소는 이름·터치 영역을 포함한 여유 영역 기준으로 렌더 대상에서 제외하지만 전체 조회 데이터와 화면을 가로지르는 선은 유지한다. 화면 읽기 기능이 켜졌거나 감지 중이면 모든 노드의 접근성 요소를 유지한다. 이름 충돌 검사의 공간 인덱스는 기존 표시 결과와 우선순위를 보존한다. 검색 입력은 즉시 표시하고 그래프 적용만 짧게 묶으며, 지우기·초기화·검색 제출은 즉시 적용한다.
24. `/referral`의 기존 추천 관계 graph CTA는 그대로 유지하고, 바로 아래에 별도
    `/referral-revenue-graph` 샘플 미리보기 CTA를 둘 수 있다. 이 화면의 조직·인물·
    매출은 모두 로컬 가상 데이터이며 실제 referral tree나 사용자 데이터와 결합하지
    않는다.
25. 증원수당 샘플 화면은 raw node의 `depth`를 신뢰하지 않고 `parentId` 체인으로
    나 기준 단계를 파생한다. 1~10단계의 샘플 구성원에 `rateBps=1000`을 단순
    적용하고, 11단계 이상은 관계에는 표시하되 합계와 예상 배분에서 제외한다.
    화면에는 `샘플 데이터`, `실제 조직·매출·정산 내역이 아님`을 명시한다.
    화면은 기존 증원수당 physics/WebView renderer와 트리·목록 mode를 사용하지 않고,
    `/referral-graph`와 같은 deterministic radial layout, 원형 node, 관계선, 한 손가락
    pan, 두 손가락 pinch, 화면 맞춤, 초기화, 선택 상세 UI를 사용한다. 실제 추천 관계
    화면의 data hook이나 component는 가져오지 않고 순수 layout helper만 공유한다.
    각 배분 대상 node의 예상액은 child에서 parent 방향으로 모든 조상 관계선을
    거슬러 나에게 이동한다. 한 관계선을 지나는 하위 예상액은 합산해 주황색 방향선과
    금액 label로 표시한다. 11단계 제외 관계는 회색 점선이며 금액 방향선을 그리지
    않는다. 단계 filter가 적용되면 선택 단계의 기여액만 합산하되 viewer까지의 조상
    context는 흐리게 보존한다. 선택 node의 전체 조상 경로는 정적으로 강조한다.
    viewer node는 현재 filter의 합계를, eligible node는 자기 예상 배분액을 표시한다.
    축소할수록 node와 이름·금액 label도 함께 작아져 서로 가리지 않으며, 확대 시에는
    최대 visual scale을 제한한다. fit 이동은 system reduced-motion 설정을 따른다.
    node 식별자는 원 안에 두고 개인 예상액은 node 아래 한 줄로 분리한다. edge 합계
    label은 node·개인 예상액·다른 edge label과 겹치지 않는 screen-space 후보만
    사용하며, 공간이 부족하면 선택 경로와 viewer 직결 합계를 우선한다. pan/pinch가
    끝난 뒤 viewport 안쪽 6dp에 완전히 들어오지 않는 금액 label과 caption은 생략한다.
    viewer 기준 기본 화면은 78%, 현재 단계 filter의 기여 node 묶음은 84%로 중심
    배치하고 `전체 보기`만 전체 관계를 fit한다. fit/reset toolbar는 graph viewport
    밖에 둔다.
26. 샘플 화면은 FC와 `admin + readOnly` 본부장에게만 노출하고 designer/plain
    admin/developer는 차단한다. 다만 로컬 상수 외 데이터를 읽지 않으므로
    app-session refresh, referral API, Supabase client, Edge Function 또는 금융
    query를 호출하지 않는다.
27. 샘플 화면의 `10%`와 `1~10단계`는 사용자 검토용 UI 가정이다. 실제 적용 단계,
    기준 매출, 반올림, 취소·환수, 확정·지급 트리거와 개인정보 공개 범위는 계속
    미확정이며 실제 연동 전에 이 문서를 다시 갱신해야 한다.
28. `app/referral.tsx`는 별도의 flat `초대 상태 목록`을 더 이상 기본 surface로 렌더링하지 않는다. 현재 모바일 self-service 하위 관계 노출은 `내가 추천한 사람들` tree 섹션 하나로 정리한다.
29. self-service로 추천인을 저장하면 같은 화면의 `get-my-referral-code`와 `get-referral-tree`를 함께 다시 불러와, 현재 추천인 표시와 direct recommender 카드가 재진입 없이 즉시 동기화돼야 한다.
30. `get-referral-tree`가 일시 실패해도 기존 추천인이 있는 사용자는 같은 `/referral` 화면 안에서 추천인 변경 UI를 계속 열 수 있어야 한다. tree 성공 렌더가 유일한 변경 CTA가 되면 안 된다.
31. `/referral`의 Android 기본 컨테이너는 `KeyboardAwareScrollView` 같은 third-party keyboard-aware wrapper에 의존하지 않는다. 검색 입력이 화면 상단에 있어도 안정적으로 보이도록 일반 `ScrollView` + 명시적 하단 패딩을 우선 사용하고, render-stability를 키보드 자동 스크롤보다 우선한다.
32. referral self-service는 앱 전체 로그인 세션과 별개 `appSessionToken`을 사용한다. 사용자가 앱 안에서 로그인된 상태여도 이 토큰이 없거나 만료되면 referral trusted path는 자동 복구 또는 재로그인 안내를 수행해야 한다.
33. 모바일 client는 referral read/write 전에 저장된 `appSessionToken`을 우선 사용하고, 없거나 만료면 저장된 `requestBoardBridgeToken`으로 `refresh-app-session`을 1회 호출해 새 referral `appSessionToken`을 무중단 재발급한다.
34. `requestBoardBridgeToken`까지 없거나 만료된 경우에는 `/referral`과 `/referral-graph`가 generic `인증이 필요합니다.` 대신 `세션이 만료되었습니다. 다시 로그인해주세요.`와 relogin CTA를 보여야 한다.
35. `refresh-app-session`은 FC와 본부장(manager source role)만 허용한다. plain admin/developer, linked request_board designer, inactive manager, signup 미완료 FC는 새 referral `appSessionToken`을 발급받을 수 없다.
36. `/referral-allowance`의 게시 자료 기반 시범 그래프는 수당을 기여자 node ID에 연결한다. 해당 노드 바로 옆의 카드에 이름·직접 수당·하위 계보 포함 총수당을 함께 표시하고 관계선 옆에는 금액을 두지 않는다. 카드 전체가 다른 이름·카드·노드와 겹치면 이름만 우선 배치하며 확대 후 공간이 생기면 금액도 표시한다. 양수·음수·0원과 그래프 생략 인원을 포함한 전체 계보 합계는 유지한다. 일반 추천 관계 그래프의 이름 전용 배치는 유지한다.

## 5. 식별자 규칙

### 5.1 추천코드

- 형식: `8자리` 영문 대문자+숫자
- 혼동 문자(`O`, `0`, `I`, `1`)는 제외
- 정책: `사용자당 1개 활성 코드`
- 실제 문자집합: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
- 코드 생성 충돌 시 최대 10회까지 재시도하고, 초과 시 발급을 중단한다.

### 5.2 초대링크

- 권장 형태:
  - `https://<landing-domain>/invite/<referral_code>`
  - 또는 `https://<landing-domain>/invite?code=<referral_code>`
- 현재 앱 런타임이 실제로 읽는 값은 deep link query `code`다.

## 6. 상태 모델

- `captured`
- `pending_signup`
- `confirmed`
- `rejected`
- `cancelled`
- `overridden`

현재 repo는 위 상태 집합을 모두 스키마 차원에서 허용하지만, live 가입 경로는 별도 server-side pending row 없이 `confirmed/rejected/overridden` 중심으로 사용한다.

## 7. 데이터 모델

### 7.1 추천코드 마스터

- 목적: 사용자와 코드의 현재 활성 관계 보관
- direct DB select/write는 운영/admin과 trusted server path에만 허용한다.

예시 필드:
- `fc_id`
- `code`
- `is_active`
- `created_at`
- `disabled_at`

### 7.2 추천 추적/확정

- 목적: 가입 완료 시 추천 관계를 구조화해 보관

예시 필드:
- `inviter_fc_id`
- `inviter_phone`
- `inviter_name`
- `invitee_fc_id`
- `invitee_phone`
- `referral_code_id`
- `referral_code`
- `source`
- `capture_source`
- `selection_source`
- `status`
- `captured_at`
- `confirmed_at`

- `inviter_fc_id`는 FK 참조용이고 삭제 후 이력 보존을 위해 nullable로 유지한다.
- inviter 식별의 감사 흔적은 `inviter_phone`, `inviter_name` snapshot으로 남긴다.

### 7.3 이벤트 로그

- 목적: 장애 추적과 관찰성

현재 repo가 허용하는 주요 event_type:
- `signup_completed`
- `referral_rejected`
- `code_generated`
- `code_rotated`
- `code_disabled`
- `admin_override_applied` (legacy historical rows only)
- `referral_linked`
- `referral_changed`
- `referral_cleared`

- `link_clicked`, `app_opened_from_link`, `pending_attribution_saved` 같은 단계형 이벤트는 현재 persisted runtime contract가 아니다.

### 7.4 관리자 감사 로그

- 추천인 current-state 변경 감사는 별도 테이블 없이 `referral_events.referral_linked/referral_changed/referral_cleared` + `metadata`로 기록한다.
- 구 `admin_override_applied` row는 historical row로 남을 수 있지만 신규 override/clear는 더 이상 이 event_type을 쓰지 않는다.
- 운영 감사 요구가 커지면 dedicated audit table을 후속 추가한다.

### 7.5 기존 `fc_profiles.recommender`와의 관계

- 추천인 current-state SSOT는 `fc_profiles.recommender_fc_id`와 그 snapshot 필드(`recommender_code_id`, `recommender_code`, `recommender_linked_at`, `recommender_link_source`)다.
- `fc_profiles.recommender_fc_id`는 관리자 화면, self-service tree, invitee 조회가 모두 쓰는 canonical link다.
- `fc_profiles.recommender`는 current-state와 함께 원자적으로 갱신되는 표시 cache이며, 자유입력 source가 아니다.
- `fc_profiles.recommender`는 trusted signup/admin/self-service path만 갱신할 수 있는 읽기 전용 cache다. 일반 FC 기본정보 수정 화면에서 자유입력으로 덮어쓰지 않는다.
- 관리자 수동 보정도 자유 입력 문자열이 아니라 `활성 추천코드 보유 FC` 검색/선택으로만 허용한다.
- 레거시 `recommender` 문자열만 있는 FC도 관리자 화면에서 clear 또는 구조화 override 대상으로 다루되, graph edge source로 다시 사용하지는 않는다.
- invitee 화면의 `가입 시 사용한 추천코드` 표시값을 계산하는 함수 `get_invitee_referral_code(uuid)`는 현재 profile snapshot만 사용한다.
  1. `fc_profiles.recommender_code` snapshot (`recommender_fc_id`가 있을 때만)
  2. 그 외에는 `null`
- repo source 기준 direct execute grant는 migration `20260401000002_reassert_get_invitee_referral_code_service_role_only.sql` 이후 `service_role` only 다.
- 웹 추천인 override/legacy link 경로는 DB migration `20260423000001_unify_referral_link_state.sql` 원격 적용 전 배포 금지다.

## 8. 예외 규칙

- `무효 코드`: 검증 실패, 추천 확정 금지
- `만료/비활성 코드`: 확정 금지, 수동 재입력 허용
- `자기추천`: 차단
- `이미 확정된 추천 관계`: 일반 사용자 재확정 금지, 관리자 override만 허용
- `가입 중 이탈`: 현재 구현의 복원은 server-side pending attribution이 아니라 local pending referral code 유지에 한정된다
- `링크 변조`: 코드 검증 실패로 처리하고 정상 가입은 막지 않되 추천 확정은 금지
- `추천인 삭제`: 기존 attribution/event는 삭제하지 않고 FK만 nullable 처리한 뒤 snapshot으로 복원 가능해야 한다

## 9. 운영/CS 규칙

- 운영자가 볼 수 있어야 하는 최소 항목:
  - 추천인 이름 cache 또는 구조화 링크 상태
  - invitee 화면의 `가입 시 사용한 추천코드` 표시값(없으면 `-`)
  - invitee와 inviter의 식별 정보
  - 코드 운영 이벤트 및 override 감사 metadata
- 현재 `/dashboard/referrals`는 `추천코드 운영 화면`이다.
  - FC별 현재 활성 코드
  - 비활성 코드 이력
  - 코드 lifecycle + `referral_linked/referral_changed/referral_cleared` 최근 이벤트 (legacy `admin_override_applied` 포함)
  - 레거시 추천인 검토 큐
- 레거시 추천인 검토 큐의 상태 분류 SSOT는 아래와 같다.
  - `자동 연결 가능`: `recommender` 정규화 문자열과 eligible profile 이름이 정확히 1명으로만 일치하고, 자기 자신이 아니며, 운영 제외 규칙을 위반하지 않는 경우
  - `동명이인 후보 다수`: 같은 이름 후보가 2명 이상인 경우
  - `후보 없음`: 같은 이름 후보가 없는 경우
  - `잘못된 자기추천`: invitee 이름과 `recommender`가 같아 자기 자신을 추천인으로 적은 경우
- `안전 자동 정리` batch는 `자동 연결 가능` 상태만 대상으로 삼는다.
  - exact-unique가 아닌 `동명이인 후보 다수`, `후보 없음`, `잘못된 자기추천`은 자동 정리 대상이 아니다.
  - graph 또는 일반 조회 진입만으로 DB를 묵시적으로 바꾸지 않고, 운영자가 명시적으로 batch를 실행할 때만 구조화 링크를 저장한다.
- `잘못된 자기추천`은 일반 `clear`와 동일하게 `reason`이 필수이고, 운영자가 제거 또는 재지정으로만 정리한다.
- `/dashboard/referrals`를 full `referral_attributions` 탐색기처럼 문서화하지 않는다.
- `/dashboard/referrals/graph`는 read-first graph explorer다.
  - visible edge 기본 소스는 `fc_profiles.recommender_fc_id`다.
  - edge 상태는 `linked` 단일값만 사용한다. `structured/confirmed/structured_confirmed` 구분은 더 이상 운영 UI에 노출하지 않는다.
  - 레거시 `recommender` free-text는 edge source가 아니다. 구조화 링크가 없으면 graph에서도 unresolved 상태로만 남긴다.
  - graph 안에서는 mutation CTA를 노출하지 않고, 운영 액션은 기존 `/dashboard/referrals` 리스트/상세 화면에 남긴다.
  - graph layout은 세션 한정이며 node drag, 빈 공간 pan, fit/reset, 기본 node name label 표시를 지원해야 한다. 이름 라벨은 숨기지 않고 zoom/selection 상태에 따라 투명도와 상세 코드 노출만 조절한다.
  - layout/physics는 Obsidian Graph View의 읽기 경험을 참고하되, 추천인 트리 특성에 맞춘 hybrid force-directed 배치다. 초기 seed는 deterministic component packing을 사용해 큰 connected component를 중앙에 가깝게 두고, hub direct child는 부모를 원형으로 둘러싸는 star/pinwheel seed를 받으며, isolated node는 과도하게 큰 외곽 원을 만들지 않는 제한된 golden-angle 분포를 사용한다.
  - `연결 없는 사람 숨기기` switch는 orphan toggle처럼 isolated node만 숨기며, 기본값은 전체 관계 파악을 위해 `false`다.
  - 사용자 설정은 `Center force`, `Repel force`, `Link force`, `Link distance` 4개만 노출한다. 저장 key는 `referral-graph-physics-settings-v16`이며 기본값은 center `0.5`, repel `10`, link force `1`, link distance `250`이다.
  - runtime force는 d3 `charge`/기존 `link`, `link-tension`, `collision`, `component-separation`, pointer drag, `max-link-stretch`, drag-locality를 사용한다. 현재 `branch-bend`, `sibling-angular`, `edge-crossing`, `node-separation`, cluster/component envelope·gravity·cohesion, global `center/x/y`, radial containment, isolated ring, drag spring은 명시적으로 비활성이다.
  - 링크 길이는 degree/child 여부에 따라 동적으로 계산한다. `sourceHasChildren=true`이고 `targetHasChildren=false`인 terminal leaf spoke는 deterministic `118..185px` band를 사용하며 240-node/24-child fixture에서는 `166..179px`에 머문다. child hub bridge는 기존 긴 branch 간격(같은 fixture `354px`)을 유지하며 leaf 단축 때문에 함께 줄어들면 안 된다. `link-tension`은 release 뒤 목표 길이를 복원하고 active drag의 `max-link-stretch`는 drag-start 길이의 1.2배를 지킨다.
  - node drag 중에는 사용자가 잡은 node 하나만 pointer 위치에 `fx/fy`로 고정한다. direct neighbor와 2-hop 이상 node는 고정하거나 같은 delta로 옮기지 않고, 평소와 같은 link·link-tension·charge·collision force가 A-B-C 순으로 전달돼 거리에 따라 유연하게 반응해야 한다.
  - active drag 중에도 연결 force를 유지한다. drag 시작 시 각 edge 길이의 `1.2x`를 최대 stretch로 적용해 긴 chain도 끊어지지 않게 하되 unrelated component는 screen pixel 기준으로 안정적이어야 한다.
  - release 시 dragged node의 `fx/fy`를 해제하고 simulation을 reheat해 기존 velocity와 spring momentum으로 부드럽게 안정화한다. live QA는 graph unit이 아니라 screen/client pixel 기준(pointer 거리, direct/indirect neighbor 이동, unrelated drift, release 후 거리)으로 판단한다.
  - `배치 초기화`는 runtime position을 지우고 현재 필터 기준 deterministic component/star/orphan seed layout으로 다시 시작한다.
  - manager는 graph page 진입과 조회는 가능하지만 계속 read-only다.
- `backfill_missing_codes`는 수동 실행형 idempotent batch로만 운영하고, 1회 호출당 최대 100명만 처리한다.
- 오늘 백필 대상은 `signup_completed=true`, `phone=11자리`, `affiliation`이 `설계매니저` 패턴이 아니고, `admin_accounts` 전화번호와 겹치지 않으며, 활성 추천코드가 없는 `fc_profiles`만이다.
- `manager_accounts`와 전화번호가 겹치는 completed `fc_profiles`도 본부장=FC 계약에 따라 추천코드 발급/backfill 대상에 포함한다.
- 조회 권한은 `admin`/`developer`/`manager` 모두 허용하되, mutate(`일괄 발급`, `재발급`, `비활성`, `legacy link`)는 `admin` role만 허용한다.
- `developer` subtype은 mutate 시 감사 metadata에 `actorStaffType=developer`로 남기고, `manager`는 UI read-only와 서버 `POST 403`을 동시에 만족해야 한다.
- 관리자 override/cancel/clear는 모두 `reason` 입력이 필수이며, `referral_events.referral_linked/referral_changed/referral_cleared.metadata`에 `actorPhone`, `actorRole`, `actorStaffType`, `beforeRecommenderName`, `beforeRecommenderFcId`, `beforeCode`, `afterRecommenderName`, `afterRecommenderFcId`, `afterCode`, `reason`, `source`가 남아야 한다.

## 10. 미확정 항목

1. 추천 보상 지급 여부와 지급 트리거
2. 추천코드 중복 재발급 허용 정책
3. 가입 완료 전 추천인 선택 UI를 검색 결과 선택형으로 유지할지, exact-code fast path를 일부 허용할지
4. 동일 휴대폰 재가입 시 추천 관계 재사용 정책
5. install referrer를 Android에서 어디까지 쓸지
6. iOS deferred deep link 복원 전략
7. 관리자 override 권한을 `admin` 전체에 줄지 일부 운영자에만 줄지
8. 원격 DB rollout이 늦어진 환경을 어떻게 감시할지

미확정 항목을 코드에서 임의로 결정하지 말고, 결정 후 이 문서를 먼저 갱신한다.

## 11. 2026-09-07 지정 본부장 증원수당 시범 계약

이 절은 한 계정에 한정된 실제 월별 자료의 조회 계약이다. 기존
`/referral-revenue-graph`와 가상 데이터·샘플 계산 계약은 그대로 유지한다.
일반 추천 보상 전체에 대한 지급 정책이나 실제 지급 승인을 확정하지 않는다.

- 실제 화면은 `/referral-allowance`다. `/referral`의 수당 CTA는 서버의
  `get-my-referral-allowance(action='access')`가 현재 본부장을 `enabled=true`로
  확인했을 때만 실제 화면으로 연결한다. 비대상 계정은 기존 샘플 진입을 유지하며,
  조회 오류를 실제 금액이나 샘플 금액의 성공 응답으로 대체하지 않는다.
- 서버의 singleton `referral_allowance_pilot`이 활성 본부장 계정 UUID,
  대응 FC UUID, 원본의 외부 사번과 설정 revision을 보관한다. 이름은 관리자 검색에만
  사용하고, 실제 대상의 이름·계정 ID를 코드·문서·테스트에 고정하지 않는다.
  관리자는 같은 사람임을 확인한 뒤 이 한 쌍만 연결한다. 설정 변경·중지·재활성화는
  revision을 증가시키며 이전 revision의 게시 자료를 다시 노출하지 않는다.
- 모바일 읽기는 현재 서명된 app-session의 `manager` 역할과 활성 계정,
  대응 FC identity, 현재 pilot 설정을 매 요청 검증한다. FC·일반 관리자·개발자·
  designer에게 조회 범위를 확대하지 않는다. body는 `action`과 선택적 `month`만
  받으며 actor·수령인·조회 대상 ID를 클라이언트가 지정하지 못한다.
- 수당 요청은 `requireCurrentToken: true`로 현재 메모리의 app-session만 사용한다.
  이 요청을 계기로 저장소에서 토큰을 복원하거나 자동 refresh·교체·삭제하지 않는다.
  토큰 부재·만료는 재로그인 또는 조회 실패로 처리하며 일반 추천 조회의 silent
  refresh 동작과 혼동하지 않는다. 계정·월·화면 전환 및 접근 회수 시 기존 명세를 숨긴다.
- 확정된 시범 정책은 `recruitment-2026-09-07-snapshot-pilot-v1`,
  `eligibilityBasis='uploaded_snapshot'`이다. 최초 자료는 업적월 `2026-06`,
  실제 지급일 `2026-08-01`, 운영자가 선택한 참고일 `2026-07-31`을 사용한다.
  지급월은 업적월 M+2이고 참고일은 지급일 이하여야 한다. 참고일은 당시 계보·인사의
  역사적 상태가 검증됐다는 뜻이 아니다.
- 사용자가 승인한 7~8월 계보와 인사 원본의 실제 기준일은 `sourceSnapshotDates`에
  정렬·중복 제거하여 보존한다. 원본 날짜를 7월 31일이나 업적월 말로 바꾸지 않는다.
  참고일 이후 원본이 하나라도 있으면 `usesLaterSnapshot=true`로 명세에 표시한다.
  인사 원본 날짜도 포함하며, 정규 양식은 실제 원본 날짜 목록을 명시해야 한다.
- `/dashboard/referrals/allowances`에서 관리자가 월별 XLSX를 업로드하고, 날짜·사번·
  계보·재적·금액을 검증한 draft를 검토한 뒤 명시적으로 게시한다. 업로드만으로
  앱에 노출하지 않는다. 원본 XLSX는 저장하지 않고 해당 수령인의 계산 snapshot과
  출처 hash·정책·검토/게시 metadata만 저장한다. 서버의 제한된 압축 해제·좌표 검사와
  검증된 엔트리 재압축을 거친 파일만 파서에 전달한다.
- 명세는 당월 신규 산정으로 한정하며 전월 이월금 합산·본부지원금·별도 시상을
  포함하지 않는다. 실제 지급 승인이 아니다. 월별 합계와 전체 기여 FP 목록이
  기본 화면이며, 관계 그래프는 사용자가 열었을 때만 표시한다. 그래프의 표시 한도로
  생략된 사람도 명세 합계와 전체 목록에는 포함한다.
- `20260907053913_referral_allowance_pilot.sql`과 `supabase/schema.sql`의
  service-only 테이블·RPC가 원자적 draft 생성/게시, 불변 snapshot, 현재 설정
  revision 격리, 동일 월 게시본 하나를 보장한다. `anon`/`authenticated`는
  RLS 및 grant 경계에서 테이블과 RPC를 직접 사용할 수 없다.
- 검증 근거는 공유 계산기·모바일 표시/진입·업로드·서명 권한 테스트와 격리된
  PGlite SQL 실행이다. PGlite의 단일 연결 실행은 전체 Supabase 또는 다중 연결
  동시성 검증을 대신하지 않는다. 사용자 승인에 따라 additive migration을 운영에
  적용했고, `get-my-referral-allowance` v1은 custom signed auth로 ACTIVE 상태다.
  지정 singleton을 활성화하고 2026년 6월 명세 한 건을 게시했다. 원격의 개인정보 없는
  집계 검증으로 명세/작업자 일치, 대상 enabled·비대상 disabled, RLS/grant의 직접
  클라이언트 접근 차단을 확인했다. 공개 모바일·웹 릴리스와 실제 기기 인수 검증은 HOLD다.
