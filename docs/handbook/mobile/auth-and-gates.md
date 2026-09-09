doc_id: FC-APP-AUTH-GATES
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-09-09
source_of_truth: app/login.tsx + app/signup*.tsx + app/first-password-change.tsx + app/reset-password.tsx + app/apply-gate.tsx + app/identity.tsx + hooks/use-login.ts + hooks/use-session.tsx + hooks/use-referral-allowance.ts + app/referral-allowance.tsx

# Mobile Playbook: Auth And Gates

## 2026-08-10 관리자 서면확인 가입 후 첫 로그인 계약

- `admin_written_consent` 가입은 SMS OTP 가입의 우회 플래그가 아니라 별도 검증 근거다. 해당 프로필은 `signup_completed=true`여도 `phone_verified=false`를 유지한다.
- 관리자가 발급한 임시 비밀번호로 로그인하면 `login-with-password`는 일반 앱 세션이나 Request Board bridge 세션을 발급하지 않는다. 대신 FC·전화번호·목적·nonce·짧은 만료시간에 묶인 `fc_assisted_password_change` 토큰만 반환한다.
- 모바일은 위 토큰을 메모리에만 보관하고 `/first-password-change`에서 임시 비밀번호와 다른 새 비밀번호를 설정한다. 앱 종료 후 토큰 복구나 일반 세션 저장소 재사용은 금지한다.
- DB의 one-time challenge와 `must_change_password`가 최종 권한 원천이다. 성공한 challenge 재사용, 만료 challenge, 다른 FC에 발급된 토큰은 모두 다시 로그인하도록 종료한다.
- 새 비밀번호 변경이 성공한 뒤에도 자동 로그인하지 않는다. 사용자는 새 비밀번호로 다시 로그인해야 정상 앱/bridge 세션을 받을 수 있다.

## 2026-08-10 Explicit Logout Contract

### 2026-09-09 Focused logout navigation and native transition

- `useAppLogout` owns login redirects for its six mobile screen callers. It starts local logout, then replaces with `/login?skipAuto=1` only after hydration and a cleared role, and only while focused. Retained background screens cannot issue competing redirects. Duplicate taps/effect runs are suppressed; later login resets the guard.
- Both home-lite header variants clear the actual SessionProvider session, replacing obsolete `session_*` key deletion. Successful account deletion exits through the same action; the deletion API is unchanged.
- Signed-out home uses a separately keyed transition root so the administrator tree is not reconciled into FC fallback content. Canonical release commit `99f34f4` records a prior Android Fabric existing-parent/addViewAt failure. This task reconciles that correction into main; historical native evidence is not a fresh acceptance pass.
- Regression: `lib/__tests__/app-logout-navigation.test.js`, `lib/__tests__/logout-source-contract.test.ts` and session integration tests. Corrected native-device acceptance and publication remain separate gates.

- 명시적 로그아웃은 FC·관리자·본부장·개발자·설계매니저 모두 로컬 세션 종료가 권한 원천이다. 원격 푸시 토큰 해제나 가람Link 정리가 늦거나 실패해도 로컬 `role`, 앱 세션 토큰, 저장 세션을 비우는 동작을 기다리게 하면 안 된다.
- 홈과 공통 로그아웃 액션은 `/login?skipAuto=1`로 이동해, 같은 이벤트 프레임에 남아 있는 이전 세션 snapshot이 로그인 화면에서 landing route로 되돌리는 경합을 막는다.
- 푸시 토큰 해제는 로그아웃 시작 시 캡처한 signed app-session token으로 bounded best-effort 실행한다. 실패는 fixed reason만 기록하며 토큰·actor·원문 오류를 로그에 남기지 않는다.
- 회귀 증거는 `lib/__tests__/session-logout.test.ts`, `lib/__tests__/logout-source-contract.test.ts`, `lib/__tests__/notifications.test.ts`가 소유한다.

## 2026-07-03 Login Contract Notes

- `app/login.tsx` is part of the shared login/session contract, not just a local screen.
- Password-save behavior must stay behind `lib/saved-login-credentials.ts` and the SecureStore-only guard.
- Login changes must keep `hooks/use-login.ts`, `hooks/use-session.tsx`, `lib/session-landing.ts`, and request-board bridge session restoration aligned.
- Contract evidence is `lib/__tests__/login-mobile-source.test.ts`, `hooks/__tests__/use-login.contract.test.ts`, `lib/__tests__/saved-login-credentials.test.ts`, and `lib/__tests__/feature-contract-matrix.test.ts`.

## 목적

- 전화번호 기반 로그인/회원가입/비밀번호 재설정
- 본인확인과 apply gate를 거쳐 제한 홈과 전체 홈을 분기

## 진입 경로

- `login`
- `signup`
- `signup-verify`
- `signup-password`
- `reset-password`
- `apply-gate`
- `identity`

## 표시 역할

- 로그인 전 사용자
- FC 신규 가입자
- 세션 복구 중 사용자

## 읽는 데이터

- OTP 상태
- phone/password 입력값
- app session token
- identity completion 여부
- temp-id/기본정보 게이트

## 쓰는 데이터

- OTP 발급/검증
- 비밀번호 설정/재설정
- app session token 저장
- secure identity 저장

## 상태/분기

- OTP 대기 -> 검증 성공 -> 비밀번호 설정
- 로그인 성공 -> `apply-gate`
- 본인확인 미완료 -> 제한 홈 또는 identity 화면
- request_board bridge 필요 시 후행 세션 복구

## 사용자 액션

- 전화번호 입력, OTP 요청, 재전송
- 비밀번호 설정/변경
- 본인확인 제출

## 성공 결과

- session 확보
- 적절한 홈 또는 다음 단계로 이동

## 실패/예외

- SMS/OTP 실패
- test-bypass 설정 오용
- bridge token은 발급됐지만 request_board session 복구 실패

## 구현 주의

- `request-signup-otp`와 `set-password`는 인증 화면 로직이지만, 가입 중 프로필 재초기화와 shared commission helper를 함께 통과합니다.
- 회원가입의 자격증 보유 현황은 `license_statuses text[]`에 코드값 `third`, `life`, `nonlife`, `none`으로 저장한다. `none`은 배타 선택이며, 다른 자격증을 고르면 자동 해제되어야 한다.
- `set-password`는 `license_statuses`를 검증/정규화해 저장하고, 기존 온보딩 분기 호환을 위해 생명/손해 legacy completion flag도 계속 계산한다.
- `app/signup.tsx`의 추천인 영역은 direct 8자리 코드 입력을 유지하되, 비로그인 trusted lookup `search-signup-referral`로 이름/소속/추천 코드 검색도 지원합니다. 다만 최종 signup payload는 새 구조를 만들지 않고 기존 `referralCode` + `referralInviterFcId`로 유지해야 합니다.
- 회원가입 검색 결과를 선택해도 최종 검증은 항상 `validate-referral-code`를 다시 거친 뒤 `set-password`로 넘어가야 합니다. 검색 결과를 inviter 문자열 자체로 저장하거나 `set-password`에 별도 검색 결과 객체를 넘기면 안 됩니다.
- `signup-verify` / `signup-password`의 CTA는 키보드가 열린 상태에서도 first tap에 동작해야 합니다. OTP/비밀번호 단계 버튼은 필요 시 `Keyboard.dismiss()`를 먼저 호출하고, 인증 코드 입력은 `onSubmitEditing`으로도 같은 submit 경로를 타야 합니다.
- `request-signup-otp`는 `phone_verified=true`만으로 기존 FC 계정으로 판단하지 않습니다. `signup_completed=true`와 `fc_credentials.password_set_at`가 함께 있는 login-capable account만 `already_exists` blocker이고, verified-but-incomplete row나 partial delete residue는 reset/cleanup 뒤 signup retry가 가능해야 합니다.
- `set-password`는 OTP path가 이미 만든 `phone_verified=true` profile만 최종 가입으로 승격해야 하며, 신규 profile 생성이나 미인증 번호 bypass를 허용하면 안 됩니다.
- `set-password`는 기존 `fc_credentials.password_set_at`를 먼저 확인한 뒤에만 profile reset을 수행해야 합니다. duplicate/direct call이 추천인/온보딩 상태를 지우는 회귀를 허용하지 않습니다.
- `set-password`에서 `referralCode`가 전달된 경우 추천인 해석과 `apply_referral_link_state` 성공이 `fc_credentials.password_set_at` 및 `signup_completed=true`보다 먼저 끝나야 합니다. 추천인 코드가 해석되지 않으면 `referral_invalid`로 본등록을 중단하고, 추천인을 입력한 계정이 추천인 없이 완료되는 상태를 만들면 안 됩니다.
- 추천인 검색/검증/본등록은 같은 추천인 허용 기준을 써야 합니다. `search-signup-referral`, `validate-referral-code`, `set-password`는 모두 `signup_completed=true` 또는 `is_manager_referral_shadow=true` 추천인을 허용하고, 설계매니저 소속 프로필은 계속 제외합니다.
- 전체 홈 unlock은 `identity_completed === true`만 신뢰합니다. `resident_id_masked`나 `address`는 표시/보조 필드이며, 잔존값만으로 `home-lite`를 건너뛰면 회귀입니다.
- `delete-account`는 `user_presence`까지 정리하고, 삭제 후 blocker row(`fc_profiles` / `admin_accounts` / `manager_accounts`)가 남아 있으면 성공으로 끝내지 않아야 합니다.
- legacy 로컬 세션에 과거 `role='manager'` payload가 남아 있어도 restore 단계에서 현재 앱 권한모델인 `admin + readOnly`로 정규화해야 합니다. 그렇지 않으면 본부장용 읽기 전용 화면과 referral self-service gate가 재로그인 전까지 어긋날 수 있습니다.
- referral self-service gate의 실제 모바일 surface는 `app/referral.tsx`다. FC 또는 `admin + readOnly` 본부장만 열고, plain admin/developer와 request_board designer는 같은 trusted path를 공유하지 않는다.
- referral self-service는 로그인 화면 상태와 별개 `appSessionToken`을 쓴다. `/referral` 진입 시 현재 token이 없거나 만료되면 `hooks/use-referral-app-session.ts -> refresh-app-session`이 저장된 bridge token으로 1회 silent refresh를 시도하고, bridge token까지 없거나 만료면 relogin CTA를 보여야 한다.
- `hooks/use-referral-app-session.ts`는 referral self-service app-session 오류 분류의 SSOT다. `isReferralReloginError`는 `ReferralAppSessionError`의 `needsRelogin`을 좁히는 type guard로 유지하고, relogin 대상 code 집합을 넓히거나 줄이면 `/referral` CTA 계약도 함께 검증해야 한다.
- referral function 실패 응답의 `code`는 문자열, `null`, 또는 누락 상태일 수 있다. 클라이언트는 error classification 때 `null`을 `undefined`로 정규화하되, 사용자 표시 message fallback은 기존 `message -> fallback` 순서를 유지한다.
- `/referral` 상단은 더 이상 루트까지의 추천인 업라인 chain을 모두 보여주지 않고, direct recommender 1명 카드만 노출한다. 사용자가 입력한 추천코드 기준 사람 한 명만 보이는 것이 현재 UI 계약이다.
- `app/referral.tsx`의 descendant lazy expand는 같은 `appSessionToken`으로 descendant `fcId`를 다시 조회하므로, 서버 인가도 `self only`가 아니라 `self subtree membership`을 검증해야 화면 contract와 맞는다. `app/referral-tree.tsx`는 legacy 진입을 `/referral`로 보내는 compatibility redirect만 유지한다.
- 추천인 그래프 CTA는 외부 관리자 웹을 열지 않고 앱 내부 `/referral-graph`로 이동한다. FC와 `admin + readOnly` 본부장만 진입할 수 있고, 실제 Edge token source role은 `fc` 또는 `manager`여야 한다.
- `/referral-graph`도 `useReferralAppSession`의 current token → bridge refresh → 1회 retry 계약을 공유하며, 양쪽 token 복구 실패 시 relogin CTA를 보여준다. plain admin/developer/designer는 graph data query를 시작하지 않는다.
- `/referral-revenue-graph`는 FC와 `admin + readOnly` 본부장만 볼 수 있는 로컬
  샘플 미리보기다. designer/plain admin/developer는 직접 route 진입도 차단하며,
  샘플 상수만 렌더하므로 app-session refresh, referral query, Supabase 또는
  네트워크 요청을 시작하지 않는다.
- 위촉 단계 필드(`hanwha_commission_*`, 보험 위촉 제출/승인 날짜)가 늘어날 때는 인증 흐름이 해당 필드를 잘못 덮어쓰지 않는지 같이 점검해야 합니다.
- 설계매니저/디자이너 세션에서 `hooks/use-session.tsx`가 등록하는 mobile push token은 FC 토큰처럼 취급하면 안 된다. request_board 설계요청과 본인 채팅 알림만 받도록 역할/토큰 scope를 유지한다.
- `hooks/use-session.tsx`는 mobile push 등록의 단일 owner입니다. transient 실패는 bounded retry하고, 성공·권한 거부·retry 소진 후 foreground 복귀 시 현재 signed session으로 다시 등록해 서버 token row 유실이나 권한 변경을 복구합니다. 지원하지 않는 platform/client/device 결과는 process 동안 terminal로 유지합니다.
- 신규 가입·로그인에서 받은 `appSessionToken`은 push 등록보다 먼저 secure storage에 저장하고, token replacement마다 registration revision을 증가시켜 동일 role/resident 세션도 trusted 등록을 다시 실행해야 합니다. restore가 legacy session JSON의 토큰을 발견하면 secure storage로 이관한 뒤 새 JSON에는 자격증명을 포함하지 않습니다.

## 2026-08-15 추천 관계 기반 증원수당 흐름 계약

- `/referral-revenue-graph`는 FC와 `admin + readOnly` 본부장에게만 보이는 로컬 샘플
  화면이다. 샘플 상수 외 데이터를 읽지 않으며 app-session refresh, 실제 referral
  query, Supabase, Edge Function, 네트워크 요청을 시작하지 않는다.
- 화면은 `/referral-graph`와 같은 deterministic radial node/edge, pan/pinch,
  fit/reset UI를 사용한다. 순수 layout helper만 공유하고 실제 graph component와
  data hook은 사용하지 않는다.
- 기존 증원수당 physics/WebView, node drag, orientation lock, graph/tree/list mode는
  현재 route에서 사용하지 않는다.
- 주황 방향선은 eligible node의 샘플 예상액이 child→parent→viewer로 합산되는 경로다.
  같은 관계선을 지나는 금액을 더해 edge label로 표시한다. 제외 관계는 회색
  점선/no-flow다. 이는 실제 송금·정산·지급 흐름이 아니다.
- node와 이름·금액 label은 graph scale을 함께 따라 zoom out 시 작아지고, zoom in
  시 visual max scale에서 멈춘다. fit animation은 system reduced-motion 설정을 따른다.
- node 식별자는 원 안에, 개인 예상액은 node 아래에 둔다. edge 합계는 node·개인
  예상액·다른 edge 합계와 겹치지 않는 후보 위치만 사용하고 선택 경로와 viewer 직결
  합계를 우선한다. pan/pinch 종료 후 viewport 안쪽 6dp에 완전히 들어오지 않는 금액
  label/caption은 생략한다. 기본 viewport는 viewer를 78%, 현재 filter 기여 node를
  84%로 중심 배치하며 `전체 보기`와 `초기화`는 graph 밖 toolbar에 둔다.
- 신규 package, 실제 referral API/DB, 정산 데이터는 이 샘플 경로에 추가하지 않는다.

## 2026-09-07 월별 증원수당 조회

- `/referral`은 FC 또는 읽기 전용 본부장 UI에서 서버 access를 확인하고 허용된 계정만 실제 `/referral-allowance`로 이동한다. 일반 관리자/개발자/설계매니저는 수령인 조회 대상이 아니다. 최종 권한은 signed FC/manager session과 현재 `referral_allowance_recipients`의 해당 FC 설정이다.
- 조회는 현재 appSessionToken을 요구한다. 이 hook은 토큰 저장소 복구·갱신을 수행하지 않으며 기존 추천인 session 복구 계약은 유지한다. action/month만 보내고 수령인 UUID를 body에서 받지 않는다. 계정/토큰/월/권한 변경 시 이전 명세를 숨기고 늦은 응답을 무시하며 query를 취소·제거한다. 명세를 로컬 영구 저장하지 않는다.
- 실제 데이터가 없는 달·오류·권한 회수는 가상 금액으로 대체하지 않는다. 기본 화면은 월별 합계와 가상화 목록이며, 관계 그래프는 요청할 때만 최대 300개 연결 노드를 렌더링한다. 생략 인원도 전체 금액과 목록에 포함한다.
- 선택 상세는 이름·매출 산정 기준·내 수당만 표시한다. 그래프에는 해당 노드 옆에 이름/직접 수당/하위 포함 총수당을 하나의 카드로 배치한다. 관계선에는 금액을 두지 않는다. 공간이 부족하면 이름을 우선 표시하며, 확대 후 더 많은 금액을 보여준다. 부호와 전체 명세 합계를 유지한다.
- 그래프 모달은 자체 gesture root, 그래프/상세 모달은 자체 safe-area provider를 갖는다. 이동·확대 중 라벨은 연속 변환하고 제스처 종료 후 배치만 갱신한다. 본인 명세 외 정보로 조회 범위를 넓히지 않는다.
- `uploaded_snapshot`의 최초 자료는 6월 실적·8월 1일 지급·7월 31일 참고다. 실제 7~8월 원본 날짜와 usesLaterSnapshot을 공개하고 과거의 확정 인사 이력으로 설명하지 않는다. 전월 이월금 합산·본부지원금·별도 시상·실제 지급 승인은 제외한다.
- 대상자별 설정 revision의 현재 published 명세만 제공한다. 개별 중지/재활성화는 다른 사람에게 영향을 주지 않는다. 관리자 source UI는 여러 FC/본부장을 선택해 각각 검토·업로드·게시할 수 있다.
- 승인된 backend 확장은 migration `20260907115710`과 Edge v2로 적용했다. 19명(기존 본부장 1명, 신규 FC 18명)의 6월 명세는 원본과 정확히 일치하며 24명은 사용자 지시로 보류했다. 단위/SQL/타입/린트 검증과 익명 401 검증을 마쳤다. 앱 변경은 현재 로컬 개발 빌드에 있으며 공개 OTA/스토어·웹 배포와 실제 기기 인수 검증은 별도다.

## 연관 문서

- [../shared/cross-repo-bridge-contract.md](../shared/cross-repo-bridge-contract.md)
- [../shared/security-and-secret-operations.md](../shared/security-and-secret-operations.md)

## 2026-06-16 auth UI regression guard

- Auth entry screens (`login`, `signup`, `signup-verify`, `signup-password`, `reset-password`) must not use a full-screen `expo-linear-gradient` layer for the root background. On Android, this class of native/transparent surface has previously fallen back to black behind transparent assets such as `assets/images/login.png`.
- These auth screens must keep a plain light root surface with `AUTH_SCREEN_BACKGROUND` and `styles.authBackground`, currently `COLORS.primaryPale`.
- Login must keep `KeyboardAwareWrapper` with `keyboardShouldPersistTaps="always"` and the primary login CTA must use the shared `Button` with `dismissKeyboardOnPress`. Do not replace it with a raw `Pressable` unless the same keyboard-open tap contract is explicitly re-tested.
- Android night splash background must stay light as well; a black night splash can make auth transitions look like another UI color regression.
- Regression coverage lives in `lib/__tests__/login-mobile-source.test.ts`, `lib/__tests__/signup-background-source.test.ts`, `components/__tests__/Button.contract.test.ts`, and one user-owned protected source-contract test whose identifier is withheld and which remains outside unrelated task edits and verification.
