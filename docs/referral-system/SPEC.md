# 추천인 시스템 스펙

- 기준일: `2026-04-17`
- 상태: `추천코드 운영/가입 확정/동명이인 안전화, login-time active code auto-issue/catch-up, self-service referral session silent refresh는 구현됨. 앱 미설치 복원과 일부 runtime 재검증은 미완료`
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
- 검색 입력 문자열은 검색 query로만 취급하고, 실제 저장 후보는 선택된 결과의 추천코드만 사용한다. 선택된 코드만 `validate-referral-code` trusted path로 inviter 정보를 검증한다.
- `validate-referral-code`는 `inviterName`, `inviterPhoneMasked`, `inviterFcId`, `codeId`를 반환한다.
- 최종 가입 시 서버는 caller가 보낸 추천인 문자열을 신뢰하지 않고, 추천코드 row를 다시 조회해 구조화 inviter identity를 확정한다.

### 2.2 확정 시점

- 추천 관계의 1차 확정 시점은 `회원가입 완료`다.
- 가람in 온보딩 전체 완료와 추천 확정을 묶지 않는다.
- 가입 전 `pending attribution` 서버 row는 현재 구현하지 않았다. 앱은 로컬 pending code만 유지한다.
- `set-password`는 OTP trusted path가 이미 만든 `phone_verified=true` `fc_profiles` row만 최종 가입으로 승격한다. 미인증 번호나 fresh number direct call은 새 FC 프로필/credentials를 만들지 않고 거절한다.
- `set-password` Edge Function이 `referralCode`를 받아 가입 완료 직후 best-effort로 confirmed attribution과 이벤트를 기록한다.
- `set-password`는 유효한 추천코드가 해석된 경우에만 `fc_profiles.recommender_fc_id`와 `fc_profiles.recommender`를 저장한다.
- `set-password`는 `fc_credentials.password_set_at`를 먼저 확인한 뒤에만 profile reset/update를 수행한다. 이미 가입이 끝난 FC에 대한 중복 호출이 추천인/온보딩 상태를 지우는 동작은 허용하지 않는다.
- `login-with-password`는 completed FC 또는 active manager referral shadow profile에 대해 로그인 성공 직후 active 추천코드를 idempotent하게 보장한다. 이미 active code가 있으면 그대로 유지하고, 없을 때만 `p_rotate=false` 기준으로 생성한다.
- 추천코드 provisioning 실패가 로그인 자체를 깨면 안 된다. 로그인은 계속 성공시키고, 이후 `get-my-referral-code` trusted path가 같은 보장 로직으로 legacy/transient no-code 상태를 catch-up한다.
- 현재 `set-password`가 남기는 attribution의 `source/capture_source/selection_source`는 deep link 여부와 무관하게 `manual_entry/manual_entry/manual_entry_only`로 정규화된다. 링크 provenance를 DB source에서 복원하는 계약은 아직 없다.

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
- 추천인 테이블(`referral_codes`, `referral_attributions`, `referral_events`)은 direct client access를 허용하지 않고 trusted server path로만 다룬다.
- completed FC/active manager가 정상 로그인한 뒤에도 추천코드 생성을 위해 별도 운영 개입이나 추가 인증 단계를 요구하지 않는다.
- `public.get_invitee_referral_code(uuid)`의 intended repo contract는 migration `20260401000002_reassert_get_invitee_referral_code_service_role_only.sql` 이후 `service_role` execute only 다. 원격 DB가 모두 그 상태인지 확인하지 않았다면 rollout 미검증 상태로 기록하고, 예외 상태를 의도 계약처럼 문서화하지 않는다.
- FC 삭제/재가입 정리 후에도 추천 attribution/event 감사 흔적은 남아야 한다.
- 구조화 추천인 식별자의 SSOT는 `referral_code`, `inviter_fc_id`, `fc_profiles.recommender_fc_id`다. `fc_profiles.recommender`는 표시 cache로만 유지한다.
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

- 현재 앱 deep link 계약은 `hanwhafcpass://signup?code=<referral_code>`다.
- cold start에서는 pending code만 저장하고, warm start에서만 `/signup` 이동을 추가로 수행한다.
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
3. 로그인 함수는 service-role helper로 `admin_issue_referral_code(..., p_rotate=false)`를 호출해 active code를 보장한다.
4. 이미 active code가 있으면 `noop_active_exists`로 끝나고 코드 값은 바뀌지 않는다.
5. provisioning이 일시 실패해도 로그인 응답은 유지하며, 이후 self-service current path가 같은 로직으로 catch-up한다.

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
10. `get-my-invitees`를 쓰는 보조 경로는 `referral_attributions.inviter_fc_id`만이 아니라 현재 구조화 링크 `fc_profiles.recommender_fc_id`도 함께 합쳐서 invitee를 구성해야 한다.
11. 구조화 링크만 있고 attribution이 없는 invitee는 보조 self-service 목록에서도 `confirmed`로 표시할 수 있고, invitee 목록은 임의의 `50건` 정적 상한으로 잘라 보이지 않게 하면 안 된다.
12. 추천 관계 self-service의 현재 모바일 기본 surface는 `app/referral.tsx` 안의 `나를 추천한 사람` 카드 + `내가 추천한 사람들` 섹션이며, 데이터 경로는 `hooks/use-referral-tree.ts -> get-referral-tree -> get_referral_subtree(...)`다.
13. 이 화면은 상단에서 direct recommender 1명만 보여주고, 하단에서는 `내가 추천한 사람들(subtree drill-down)`만 caller 자기 서브트리 범위 안에서 보여준다. 루트까지의 전체 업라인 경로는 현재 모바일 UI에 노출하지 않는다.
14. 상단 카드의 direct recommender는 `fc_profiles.recommender_fc_id` 체인의 마지막 노드 기준이다. 따라서 실제 추천인이 active manager shadow profile로 저장된 경우에는 그 manager shadow 노드 1명만 카드에 보여야 한다.
15. `/referral`의 초기 tree read는 `depth: 2`를 유지해 첫 화면 렌더를 가볍게 가져가고, deeper branch는 descendant lazy expand로 이어간다.
16. descendant lazy expand는 같은 trusted path를 다시 호출하되, `fcId=self only`가 아니라 `caller subtree membership`이 확인된 descendant root만 허용해야 한다.
17. lazy expand로 읽어온 subtree의 `node_depth`는 subtree root 기준 상대 depth이므로, 화면 캐시에 합치기 전에 현재 `/referral` root 기준 absolute depth로 정규화해야 한다. tree row 들여쓰기/강조 스타일은 transport `node.depth`가 아니라 현재 렌더 depth 규칙을 따라야 한다.
18. 사용자가 어떤 branch를 펼치면, 이미 보이는 직속 자식 중 `하위가 더 있는데 아직 direct child가 캐시에 없는 노드`는 백그라운드로 1단계만 순차 prefetch할 수 있다. 이 prefetch는 spinner를 점유하거나 현재 expand를 block하면 안 된다.
19. 상단 direct recommender 카드는 `get-referral-tree`가 성공했는데 ancestor가 없으면 빈 상태를 그대로 보여야 한다. 이 경우 `get-my-referral-code`의 legacy/current recommender cache를 다시 fallback으로 보여 stale 추천인을 노출하면 안 된다.
20. 본부장 전용 `PC 브라우저에서 그래프 뷰로 보기`는 보조 링크일 뿐이고, FC에게는 노출하지 않는다. 모바일 기본 surface는 그래프가 아니라 self-service tree/drill-down이다.
21. `app/referral.tsx`는 별도의 flat `초대 상태 목록`을 더 이상 기본 surface로 렌더링하지 않는다. 현재 모바일 self-service 하위 관계 노출은 `내가 추천한 사람들` tree 섹션 하나로 정리한다.
22. self-service로 추천인을 저장하면 같은 화면의 `get-my-referral-code`와 `get-referral-tree`를 함께 다시 불러와, 현재 추천인 표시와 direct recommender 카드가 재진입 없이 즉시 동기화돼야 한다.
23. `get-referral-tree`가 일시 실패해도 기존 추천인이 있는 사용자는 같은 `/referral` 화면 안에서 추천인 변경 UI를 계속 열 수 있어야 한다. tree 성공 렌더가 유일한 변경 CTA가 되면 안 된다.
24. `/referral`의 Android 기본 컨테이너는 `KeyboardAwareScrollView` 같은 third-party keyboard-aware wrapper에 의존하지 않는다. 검색 입력이 화면 상단에 있어도 안정적으로 보이도록 일반 `ScrollView` + 명시적 하단 패딩을 우선 사용하고, render-stability를 키보드 자동 스크롤보다 우선한다.
25. referral self-service는 앱 전체 로그인 세션과 별개 `appSessionToken`을 사용한다. 사용자가 앱 안에서 로그인된 상태여도 이 토큰이 없거나 만료되면 referral trusted path는 자동 복구 또는 재로그인 안내를 수행해야 한다.
26. 모바일 client는 referral read/write 전에 저장된 `appSessionToken`을 우선 사용하고, 없거나 만료면 저장된 `requestBoardBridgeToken`으로 `refresh-app-session`을 1회 호출해 새 referral `appSessionToken`을 무중단 재발급한다.
27. `requestBoardBridgeToken`까지 없거나 만료된 경우에는 `/referral`이 generic `인증이 필요합니다.` 대신 `세션이 만료되었습니다. 다시 로그인해주세요.`와 relogin CTA를 보여야 한다.
28. `refresh-app-session`은 FC와 본부장(manager source role)만 허용한다. plain admin/developer, linked request_board designer, inactive manager, signup 미완료 FC는 새 referral `appSessionToken`을 발급받을 수 없다.

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
- `referral_confirmed`
- `referral_rejected`
- `code_generated`
- `code_rotated`
- `code_disabled`
- `admin_override_applied`

- `link_clicked`, `app_opened_from_link`, `pending_attribution_saved` 같은 단계형 이벤트는 현재 persisted runtime contract가 아니다.

### 7.4 관리자 감사 로그

- 1차 스키마에서는 별도 감사 테이블을 두지 않고 `referral_events.admin_override_applied` + `metadata`로 기록한다.
- 운영 감사 요구가 커지면 dedicated audit table을 후속 추가한다.

### 7.5 기존 `fc_profiles.recommender`와의 관계

- 구조화 추천 관계의 SSOT는 `referral_codes`, `referral_attributions`, `referral_events`, `fc_profiles.recommender_fc_id`다.
- `fc_profiles.recommender_fc_id`는 관리자 화면과 invitee 조회 경로가 쓰는 구조화 링크다.
- `fc_profiles.recommender`는 과도기 호환용 표시 cache이며, 추천 관계 판단에는 사용하지 않는다.
- `fc_profiles.recommender`는 trusted signup/admin path만 갱신할 수 있는 읽기 전용 cache다. 일반 FC 기본정보 수정 화면에서 자유입력으로 덮어쓰지 않는다.
- 관리자 수동 보정도 자유 입력 문자열이 아니라 `활성 추천코드 보유 FC` 검색/선택으로만 허용한다.
- 레거시 `recommender` 문자열만 있는 FC도 관리자 화면에서 clear 또는 구조화 override 대상으로 다뤄야 한다.
- invitee 화면의 `가입 시 사용한 추천코드` 표시값을 계산하는 함수 `get_invitee_referral_code(uuid)`는 아래 우선순위만 사용한다.
  1. 최신 `confirmed referral_attributions`의 `referral_code_id`에 연결된 코드 row
  2. 최신 `confirmed referral_attributions.referral_code` snapshot
  3. 최신 `confirmed referral_attributions`의 `inviter_fc_id` 현재 활성 코드
  4. `fc_profiles.recommender_fc_id`의 현재 활성 `referral_codes` (confirmed attribution이 없을 때만 쓰는 degraded fallback)
- repo source 기준 direct execute grant는 migration `20260401000002_reassert_get_invitee_referral_code_service_role_only.sql` 이후 `service_role` only 다.
- 웹 추천인 override/legacy link 경로는 DB migration `20260331000005_admin_apply_recommender_override.sql` 원격 적용 전 배포 금지다.

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
  - 코드 lifecycle + `admin_override_applied` 최근 이벤트
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
  - `confirmed referral_attributions`는 edge를 하나 더 그리는 용도가 아니라 같은 관계의 `confirmed` 근거를 덧씌우는 용도다.
  - 레거시 `recommender` free-text는 edge source가 아니다. 구조화 링크가 없으면 graph에서도 unresolved 상태로만 남긴다.
  - graph 안에서는 mutation CTA를 노출하지 않고, 운영 액션은 기존 `/dashboard/referrals` 리스트/상세 화면에 남긴다.
  - graph layout은 세션 한정이며 node drag, 빈 공간 pan, fit/reset, 기본 node name label 표시를 지원해야 한다.
  - manager는 graph page 진입과 조회는 가능하지만 계속 read-only다.
- `backfill_missing_codes`는 수동 실행형 idempotent batch로만 운영하고, 1회 호출당 최대 100명만 처리한다.
- 오늘 백필 대상은 `signup_completed=true`, `phone=11자리`, `affiliation`이 `설계매니저` 패턴이 아니고, `admin_accounts` 전화번호와 겹치지 않으며, 활성 추천코드가 없는 `fc_profiles`만이다.
- `manager_accounts`와 전화번호가 겹치는 completed `fc_profiles`도 본부장=FC 계약에 따라 추천코드 발급/backfill 대상에 포함한다.
- 조회 권한은 `admin`/`developer`/`manager` 모두 허용하되, mutate(`일괄 발급`, `재발급`, `비활성`, `legacy link`)는 `admin` role만 허용한다.
- `developer` subtype은 mutate 시 감사 metadata에 `actorStaffType=developer`로 남기고, `manager`는 UI read-only와 서버 `POST 403`을 동시에 만족해야 한다.
- 관리자 override/cancel/clear는 모두 `reason` 입력이 필수이며, `referral_events.admin_override_applied.metadata`에 `actorPhone`, `actorRole`, `actorStaffType`, `beforeRecommenderName`, `beforeRecommenderFcId`, `afterRecommenderName`, `afterRecommenderFcId`, `reason`이 남아야 한다.

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
