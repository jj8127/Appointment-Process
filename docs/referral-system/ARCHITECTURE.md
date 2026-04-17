# 추천인 시스템 아키텍처

- 기준일: `2026-04-17`
- 상태: `추천코드 운영/가입 확정/동명이인 안전화, login-time active code auto-issue/catch-up, referral self-service appSession silent refresh는 구현됨. 앱 미설치 복원과 일부 runtime rollout 재검증은 후속`

## 1. 소유권

### 1.1 fc-onboarding-app가 소유하는 것

- 추천코드 마스터
- 앱 deep link 처리
- 가입 완료 시 추천 관계 확정
- 추천 관계/이벤트 로그
- 관리자 조회/보정

### 1.2 request_board가 소유하지 않는 것

- 추천 관계의 원본 저장
- 추천코드 생성/검증
- 초대링크 확정 로직

`request_board`는 필요 시 읽기 전용 소비자일 수 있지만, 원본 상태는 `fc-onboarding-app`에서만 관리한다.

## 2. 추천 방식별 흐름

### 2.1 자동 입력 추천코드

```text
회원가입 화면
  -> 추천코드 자동 입력
  -> 가입 전 사용자 직접 입력 또는 검색 선택 가능
  -> search-signup-referral (이름/소속/추천 코드 검색)
  -> validate-referral-code 검증
  -> referralCode + inviterFcId hint를 signup payload에 저장
  -> set-password
  -> recommender_fc_id/recommender cache 저장
  -> confirmed referral 확정(best effort)
```

- 현재 attribution row에는 deep link/auto-prefill provenance가 별도 source로 남지 않고 `manual_entry/manual_entry/manual_entry_only` 값으로 정규화된다.

### 2.2 초대링크, 앱 이미 설치됨

```text
초대링크 클릭
  -> 앱 deep link 진입 (`hanwhafcpass://signup?code=...`)
  -> app/_layout.tsx가 pending code 저장
  -> 회원가입 화면에 추천코드 자동 입력
  -> set-password
  -> confirmed referral 확정(best effort)
```

### 2.3 초대링크, 앱 미설치

```text
초대링크 클릭
  -> 현재 repo에는 landing click 저장 / store redirect persistence / install referrer 복원 없음
  -> 앱 설치 후 첫 실행 자동 복원은 live 계약이 아님
  -> 운영 fallback은 회원가입 화면 직접 코드 입력 또는 검색 선택
```

### 2.4 링크 복원 실패

```text
스토어 검색/설치 또는 링크 유실
  -> 자동 추천 정보 없음
  -> 사용자가 추천코드 수동 입력
  -> 가입 완료
  -> confirmed referral 확정
```

### 2.5 로그인 성공 뒤 active 추천코드 보장

```text
completed FC 또는 active manager 로그인 성공
  -> login-with-password
  -> manager면 ensure_manager_referral_shadow_profile
  -> ensureActiveReferralCode(p_rotate=false)
  -> active code 있으면 noop_active_exists
  -> 없으면 code_generated
  -> 로그인 응답은 계속 success
  -> 이후 get-my-referral-code는 no-code 상태를 1회 catch-up 후 응답
```

## 3. 컴포넌트 분리

### 3.1 App Layer

- 로그인 경로: `hooks/use-login.ts -> login-with-password`
- 딥링크 수신기: `app/_layout.tsx`
- pending code 로컬 저장: `lib/referral-deeplink.ts`
- 회원가입 화면 추천코드 자동 입력 + 가입 전 직접 입력/검색 선택 UI: `app/signup.tsx`
- Android IME 회귀 방지용 uncontrolled 추천코드 입력
- 회원가입 추천인 공개 검색 UI 공용 컴포넌트: `components/ReferralSearchField.tsx`
- 가입 완료 시 `referralCode` + `referralInviterFcId` payload 전송: `signup -> signup-verify -> signup-password`
- FC/본부장 self-service 추천코드 조회: `hooks/use-my-referral-code.ts -> get-my-referral-code`
- FC/본부장 self-service 초대 목록 조회: `hooks/use-my-invitees.ts -> get-my-invitees`
- FC/본부장 self-service 추천 관계 tree embed: `app/referral.tsx -> hooks/use-referral-tree.ts -> get-referral-tree`
- FC/본부장 self-service 추천인 검색/변경: `app/referral.tsx -> search-fc-for-referral / update-my-recommender`
- FC/본부장 self-service referral session guard: `hooks/use-referral-app-session.ts -> refresh-app-session`
- `/referral` tree는 첫 화면에서 `depth: 2`까지만 읽고, 사용자가 branch를 펼칠 때 descendant subtree를 추가 요청한다. lazy expand로 내려온 subtree-relative `node_depth`는 hook cache merge 전에 현재 화면 root 기준 absolute depth로 다시 써서 렌더한다.
- branch expand 직후에는 이미 보이는 직속 자식 중 하위가 더 있는 node만 background 1단계 prefetch를 순차 수행해, 다음 expand에서 같은 node를 즉시 열 수 있게 돕는다. prefetch는 현재 탭된 node의 spinner/expand를 block하지 않는다.
- `/referral`의 primary scroll container는 Android `dispatchGetDisplayList/null child` 계열 crash를 줄이기 위해 `KeyboardAwareScrollView`가 아니라 일반 `ScrollView`를 사용한다. 검색 입력은 화면 상단 배치 + 하단 keyboard padding으로 충분히 보이도록 유지한다.
- `/referral`은 화면 로그인 세션과 referral self-service `appSessionToken`이 분리돼 있어도, 현재 token 부재/만료 시 저장된 `requestBoardBridgeToken`으로 `refresh-app-session`을 1회 시도하고 실패 시에만 relogin CTA를 보여준다.
- 본부장 전용 desktop graph shortcut: `app/referral.tsx -> Linking.openURL(EXPO_PUBLIC_ADMIN_WEB_URL + '/dashboard/referrals/graph')`
- `/referral-tree` route는 legacy 진입 호환용으로 `/referral` redirect만 유지한다.

### 3.2 Backend / Edge Function Layer

- 최종 선택 코드 검증 API: `validate-referral-code`
- `validate-referral-code` 응답: `inviterName`, `inviterPhoneMasked`, `inviterFcId`, `codeId`
- 회원가입 비로그인 추천인 검색 API: `search-signup-referral`
- `search-signup-referral`은 app session 없이 이름/소속/추천 코드 검색을 허용하지만, 응답은 active referral code가 있는 후보의 `name`, `affiliation`, `code`만 반환한다.
- `login-with-password`는 completed FC login 성공 시 active code를 idempotent하게 보장하고, manager login 성공 시 `ensure_manager_referral_shadow_profile` 뒤 같은 보장 로직을 적용한다.
- FC/본부장 자기 코드/현재 추천인 cache 조회의 현재 앱 경로: `get-my-referral-code`
- `get-my-referral-code`는 eligible profile인데 active code가 없으면 `admin_issue_referral_code(..., p_rotate=false)` helper를 1회 실행해 catch-up한 뒤 응답한다. current contract에서 self-service no-code는 forbidden/not_found/runtime failure가 아닌 이상 오래 남아 있으면 안 된다.
- FC/본부장 자기 invitee 조회의 현재 앱 경로: `get-my-invitees`
- FC/본부장 자기 추천 관계 트리 조회의 현재 앱 경로: `get-referral-tree`
- FC/본부장 추천인 검색/저장의 현재 앱 경로: `search-fc-for-referral`, `update-my-recommender`
- FC/본부장 referral self-service 세션 재발급 경로: `refresh-app-session`
- `get-referral-tree`는 service-role RPC `get_referral_subtree(root_fc_id uuid, max_depth int)`를 호출해 ancestor chain + descendant subtree를 한 번에 읽는다.
- ancestor chain은 `fc_profiles.recommender_fc_id`를 그대로 따르며, recommender가 active manager shadow profile로 저장된 경우에도 그 shadow recommender를 포함한다.
- descendant lazy expand도 같은 trusted path를 사용하며, Edge Function 인가는 `self subtree membership`을 확인한 descendant `fcId`만 허용해야 한다.
- RPC/Edge Function이 내려주는 descendant `node_depth`는 조회한 subtree root 기준 상대값이다. 현재 모바일 self-service contract에서는 `hooks/use-referral-tree.ts`가 이 값을 현재 화면 root 기준 absolute depth로 정규화한 뒤만 cache/render에 사용한다.
- `get-fc-referral-code`는 legacy compatibility alias로 남아 있지만 current app hook path는 아니고, optional `phone` body는 세션 전화번호와 일치할 때만 허용된다.
- referral self-service functions(`get-my-referral-code`, `get-referral-tree`, `search-fc-for-referral`, `update-my-recommender`, legacy `get-fc-referral-code`, `get-my-invitees`)는 generic `unauthorized` 대신 `missing_app_session`, `expired_app_session`, `invalid_app_session`, `forbidden`를 구분해 반환한다.
- `refresh-app-session`은 request_board bridge token을 다시 검증한 뒤 completed FC 또는 active manager만 새 referral `appSessionToken`을 발급한다. phone이 `admin_accounts`에 있거나 designer/inactive/incomplete account면 발급을 거절한다.
- 가입 완료 확정 API: `set-password` 내부 `captureReferralAttribution`
- 관리자 모바일 invitee 코드 조회: `admin-action:getInviteeReferralCode`
- 관리자 웹 invitee 코드 조회: `/api/admin/fc -> getReferralCode -> service-role rpc(get_invitee_referral_code)`
- 관리자 추천코드 운영 API: `GET/POST /api/admin/referrals`
  - `GET`: 요약/목록/상세 조회 + 레거시 추천인 검토 큐
  - `POST`: 수동 backfill, 코드 재발급, 코드 비활성, 레거시 추천인 수동 링크
  - 모든 쓰기는 service-role 서버 경로만 사용
- 관리자 추천 관계 그래프 API: `GET /api/admin/referrals/graph`
  - eligible FC node + code 상태를 읽는다
  - visible edge는 `fc_profiles.recommender_fc_id`를 기본으로 만들고, `confirmed referral_attributions`는 같은 pair edge의 `relationshipState`를 강화하는 용도로만 merge한다
  - graph route는 read-only이며 mutate path를 열지 않는다
- 관리자 override API: `admin_apply_recommender_override(...)`
  - migration `20260331000005_admin_apply_recommender_override.sql`가 원격 적용되기 전에는 웹 배포 금지

### 3.3 Data Layer

- `referral_codes`
- `referral_attributions`
- `referral_events`
- `fc_profiles.recommender_fc_id`
- `fc_profiles.recommender`

## 4. 접근 모델

- 현재 가람in 앱 세션은 Supabase Auth uid 중심이 아니라 전화번호 기반 커스텀 세션으로 동작한다.
- 따라서 추천인 테이블은 direct client RLS read/write를 열지 않는다.
- 앱/웹은 추천인 정보를 직접 `select/insert/update`하지 않고, Edge Function 또는 service-role route를 통해서만 읽고 쓴다.
- 관리자 웹 추천인 수정도 자유 텍스트가 아니라 서버 검색/선택형 trusted path로만 허용한다.
- `public.get_invitee_referral_code(uuid)`의 intended repo contract는 migration `20260401000002_reassert_get_invitee_referral_code_service_role_only.sql` 이후 `service_role` execute only 다.
- 다만 이 리뷰는 원격 DB rollout 상태를 다시 검증하지 않았다. remote drift가 있다면 그것은 배포 상태 문제이지 architecture SSOT가 아니다.
- FC/본부장 self-service 조회는 `get-my-referral-code` Edge Function을 통해 app session token을 검증한 뒤 active code와 현재 추천인 cache를 함께 읽는다.
- FC/본부장 self-service tree 조회는 `get-referral-tree` Edge Function을 통해 app session token을 검증한 뒤 caller 자기 서브트리 범위의 ancestor/descendant 정보만 읽는다.
- stored `requestBoardBridgeToken`은 request_board JWT 재발급뿐 아니라 referral self-service `appSessionToken` silent refresh의 유일한 복구 자격증명이다.
- bridge token까지 없거나 만료된 상태에서는 `/referral`이 self-heal loop를 반복하지 않고 relogin CTA를 노출해야 한다.
- current app self-service tree는 같은 trusted subtree read를 반복 호출하더라도 화면 cache가 absolute depth를 유지해야 한다. UI 들여쓰기/강조 스타일은 current render depth 기준으로 계산하고, subtree transport depth를 style source처럼 재사용하면 안 된다.
- descendant traversal에서는 manager shadow child를 계속 제외하지만, ancestor path에 실제 recommender로 저장된 manager shadow는 예외적으로 보여준다.
- 본부장 세션은 앱 UI role이 `admin/readOnly`여도 app session token source role이 `manager`면 같은 self-service trusted path를 사용한다.
- legacy 로컬 세션의 `role='manager'` payload도 앱 복원 시 `admin + readOnly` UI state로 정규화해 홈/설정/referral self-service gate와 일치시킨다.

## 5. 상태 보존 전략

현재 구현은 앱 로컬 pending 저장 + 가입 완료 시 직접 확정의 2단계 구조다.

1. 앱 로컬 pending state
   - deep link 직후 UI 복원용
2. 가입 완료 시 server-side confirm
   - `set-password`가 confirmed attribution/event를 기록

서버 pending attribution은 아직 별도 API로 구현되지 않았고, install-referrer/deferred deep link와 함께 후속 단계로 남아 있다.

## 6. confirm 쓰기 경로

- 현재는 `pending attribution` 전용 서버 API 없이 앱 로컬 pending code만 유지한다.
- 회원가입 완료 시점 확정은 `set-password` Edge Function이 담당한다.
- 회원가입 검색 선택은 `search-signup-referral`이 candidate를 찾더라도 최종 저장 payload를 새 구조로 바꾸지 않고, 선택된 active code를 다시 `referralCode`에 채운 뒤 `validate-referral-code`와 `set-password` 기존 경로를 그대로 사용한다.
- `set-password`는 OTP path가 미리 만든 `phone_verified=true` profile만 최종 가입으로 승격하며, fresh-number direct call에서는 새 profile/credentials를 만들지 않는다.
- `set-password`는 `fc_credentials.password_set_at`를 먼저 확인한 뒤에만 profile reset/update를 수행해, 중복 호출이 기존 추천인/온보딩 상태를 지우지 않게 한다.
- `set-password`는 최종 추천코드 row를 다시 확인하고 `referral_attributions` + `fc_profiles.recommender_fc_id` + `fc_profiles.recommender`를 함께 동기화한다.
- caller가 보낸 임의 `recommender` 문자열은 신뢰하지 않는다.
- 클라이언트는 최종 `referralCode`와 검증 시점 `referralInviterFcId hint`만 전달하고, 실제 attribution/event 쓰기는 서버가 수행한다.
- 관리자 UI의 `가입 시 사용한 추천코드` 표시값은 현재 `get_invitee_referral_code(uuid)` lookup order로 계산하며, 순서는 아래와 같다.
  1. 최신 `confirmed referral_attributions.referral_code_id`에 연결된 코드 row
  2. 최신 `confirmed referral_attributions.referral_code` snapshot
  3. 최신 `confirmed referral_attributions.inviter_fc_id`의 현재 활성 코드
  4. `fc_profiles.recommender_fc_id`의 현재 활성 코드

## 7. 삭제 후 이력 보존

- `referral_attributions`는 inviter FK가 삭제돼도 row를 남긴다.
- inviter 식별은 `inviter_phone`, `inviter_name` snapshot으로 복원한다.
- `referral_events`도 `referral_code`, `inviter_phone`, `inviter_name` snapshot을 함께 저장해 FK 유실 후에도 당시 맥락을 보존한다.
- 계정 삭제/재가입 정리 함수는 추천 attribution/event를 hard delete하지 않는다.

## 8. 관찰성 이벤트

현재 repo 기준 persisted event 범위:

- `signup_completed`
- `referral_confirmed`
- `referral_rejected`
- `code_generated`
- `code_rotated`
- `code_disabled`
- `admin_override_applied`

현재 runtime contract가 아닌 항목:

- `link_clicked`
- `link_landing_opened`
- `app_opened_from_link`
- `code_auto_prefilled`
- `code_edited_before_signup`
- `pending_attribution_saved`
- `code_entered`
- `code_validated`

또한 `/dashboard/referrals` 최근 이벤트 패널은 full event stream이 아니라 `code_generated`, `code_rotated`, `code_disabled`, `admin_override_applied`만 보여준다.

`/dashboard/referrals/graph`는 별도 read-heavy surface다.
- node는 eligible FC + code status + legacy unresolved flag를 그린다.
- edge는 `recommender_fc_id` 기반 structured link를 우선으로 하고, `confirmed` 근거가 있으면 same pair edge의 상태만 `structured_confirmed`로 올린다.
- free-text `recommender`는 graph edge가 아니라 review queue/legacy badge로만 사용한다.
- layout state는 세션 로컬이며 node drag, 빈 캔버스 pan, fit/reset, 기본 node label 표시를 지원한다.

## 9. 장애 추적 최소 로그 기준

- “링크를 눌렀는데 추천이 안 붙었다”를 완전 재현하려면 `click -> app open -> pending save -> signup confirm` 전체가 필요하다.
- 현재 repo는 그중 `pending save` 이전 단계 로그를 persisted event로 남기지 않으므로, 문서와 테스트는 그 공백을 명시해야 한다.
- 운영 화면이나 SQL로 복원 가능한 범위와 불가능한 범위를 구분해 적는다.

## 10. 구현 순서 권장안

### Phase 1. 추천코드 운영 기반

- 기존 FC 코드 마스터 backfill
- 관리자/개발자 재발급/비활성
- 본부장 조회 전용 화면
- 코드 운영 이벤트

### Phase 2. 추천코드 MVP

- 추천코드 생성/검증
- trusted code validation API
- 회원가입 자동 입력 코드 UI
- 가입 전 수정 fallback
- `set-password` confirmed 저장
- 추천 관계 관리자 보정

### Phase 3. 초대링크

- 공유 링크 생성
- 앱 딥링크 수신
- 로컬 pending code 저장
- warm/cold start에서 앱 설치 상태 direct scheme prefill
- 랜딩 로깅/스토어 설치 후 복원/서버 pending attribution은 후속

### Phase 4. 설치 후 복원

- Android install referrer 또는 deferred deep link 전략 적용
- 복원 실패 fallback 정리

### Phase 5. 운영 도구

- 검색/필터/보정
- 감사 로그
- 레거시 추천인 검토 큐
- 장애 리포트/대시보드

## 11. request_board 연동 원칙

- V1에서는 `request_board`가 추천 관계를 생성하지 않는다.
- `request_board`에서 추천인 정보를 보여줘야 한다면 읽기 전용 계약만 추가한다.
- 추천인 관계를 `request_board` DB에 중복 저장하지 않는다.

## 12. 기존 자유입력 추천인 필드와의 공존

- 회원가입 화면은 자유입력 추천인 이름 문자열을 저장하지 않는다. 검색 UI가 있어도 최종 payload는 active `referralCode` 기준으로만 유지한다.
- `fc_profiles.recommender`는 레거시 호환용 표시 cache다.
- FC 기본정보 화면(`app/fc/new.tsx`)도 이 cache를 읽기 전용으로만 보여주고 저장 payload에는 다시 싣지 않는다.
- 관리자 수동 수정도 자유입력이 아니라 `활성 추천코드 보유 FC` 검색/선택 UI만 허용한다.
- 동명이인 보정 전략:
  - confirmed attribution이 있는 invitee는 자동 backfill
  - 활성 코드 보유 FC 중 이름 유일 매칭이면 자동 backfill
  - 나머지는 `/dashboard/referrals` 레거시 검토 큐에서 수동 선택
