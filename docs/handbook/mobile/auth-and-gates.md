doc_id: FC-APP-AUTH-GATES
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-06-16
source_of_truth: app/login.tsx + app/signup*.tsx + app/reset-password.tsx + app/apply-gate.tsx + app/identity.tsx + hooks/use-session.tsx

# Mobile Playbook: Auth And Gates

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
- 전체 홈 unlock은 `identity_completed === true`만 신뢰합니다. `resident_id_masked`나 `address`는 표시/보조 필드이며, 잔존값만으로 `home-lite`를 건너뛰면 회귀입니다.
- `delete-account`는 `user_presence`까지 정리하고, 삭제 후 blocker row(`fc_profiles` / `admin_accounts` / `manager_accounts`)가 남아 있으면 성공으로 끝내지 않아야 합니다.
- legacy 로컬 세션에 과거 `role='manager'` payload가 남아 있어도 restore 단계에서 현재 앱 권한모델인 `admin + readOnly`로 정규화해야 합니다. 그렇지 않으면 본부장용 읽기 전용 화면과 referral self-service gate가 재로그인 전까지 어긋날 수 있습니다.
- referral self-service gate의 실제 모바일 surface는 `app/referral.tsx`다. FC 또는 `admin + readOnly` 본부장만 열고, plain admin/developer와 request_board designer는 같은 trusted path를 공유하지 않는다.
- referral self-service는 로그인 화면 상태와 별개 `appSessionToken`을 쓴다. `/referral` 진입 시 현재 token이 없거나 만료되면 `hooks/use-referral-app-session.ts -> refresh-app-session`이 저장된 bridge token으로 1회 silent refresh를 시도하고, bridge token까지 없거나 만료면 relogin CTA를 보여야 한다.
- `hooks/use-referral-app-session.ts`는 referral self-service app-session 오류 분류의 SSOT다. `isReferralReloginError`는 `ReferralAppSessionError`의 `needsRelogin`을 좁히는 type guard로 유지하고, relogin 대상 code 집합을 넓히거나 줄이면 `/referral` CTA 계약도 함께 검증해야 한다.
- referral function 실패 응답의 `code`는 문자열, `null`, 또는 누락 상태일 수 있다. 클라이언트는 error classification 때 `null`을 `undefined`로 정규화하되, 사용자 표시 message fallback은 기존 `message -> fallback` 순서를 유지한다.
- `/referral` 상단은 더 이상 루트까지의 추천인 업라인 chain을 모두 보여주지 않고, direct recommender 1명 카드만 노출한다. 사용자가 입력한 추천코드 기준 사람 한 명만 보이는 것이 현재 UI 계약이다.
- `app/referral.tsx`의 descendant lazy expand는 같은 `appSessionToken`으로 descendant `fcId`를 다시 조회하므로, 서버 인가도 `self only`가 아니라 `self subtree membership`을 검증해야 화면 contract와 맞는다. `app/referral-tree.tsx`는 legacy 진입을 `/referral`로 보내는 compatibility redirect만 유지한다.
- 추천인 그래프 웹 shortcut은 모바일 self-service의 보조 링크이며, `EXPO_PUBLIC_ADMIN_WEB_URL`이 있을 때 FC와 본부장 모두 `/dashboard/referrals/graph`로 이동할 수 있어야 한다.
- 위촉 단계 필드(`hanwha_commission_*`, 보험 위촉 제출/승인 날짜)가 늘어날 때는 인증 흐름이 해당 필드를 잘못 덮어쓰지 않는지 같이 점검해야 합니다.
- 설계매니저/디자이너 세션에서 `hooks/use-session.tsx`가 등록하는 mobile push token은 FC 토큰처럼 취급하면 안 된다. request_board 설계요청과 본인 채팅 알림만 받도록 역할/토큰 scope를 유지한다.

## 연관 문서

- [../shared/cross-repo-bridge-contract.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/cross-repo-bridge-contract.md)
- [../shared/security-and-secret-operations.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/security-and-secret-operations.md)

## 2026-06-16 auth UI regression guard

- Auth entry screens (`login`, `signup`, `signup-verify`, `signup-password`, `reset-password`) must not use a full-screen `expo-linear-gradient` layer for the root background. On Android, this class of native/transparent surface has previously fallen back to black behind transparent assets such as `assets/images/login.png`.
- These auth screens must keep a plain light root surface with `AUTH_SCREEN_BACKGROUND` and `styles.authBackground`, currently `COLORS.primaryPale`.
- Login must keep `KeyboardAwareWrapper` with `keyboardShouldPersistTaps="always"` and the primary login CTA must use the shared `Button` with `dismissKeyboardOnPress`. Do not replace it with a raw `Pressable` unless the same keyboard-open tap contract is explicitly re-tested.
- Android night splash background must stay light as well; a black night splash can make auth transitions look like another UI color regression.
- Regression coverage lives in `lib/__tests__/login-mobile-source.test.ts`, `lib/__tests__/signup-background-source.test.ts`, `lib/__tests__/navigation-background-source.test.ts`, and `components/__tests__/Button.contract.test.ts`.
