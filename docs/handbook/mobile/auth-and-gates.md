doc_id: FC-APP-AUTH-GATES
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-04-10
source_of_truth: app/login.tsx + app/signup*.tsx + app/reset-password.tsx + app/apply-gate.tsx + app/identity.tsx + hooks/use-session.tsx

# Mobile Playbook: Auth And Gates

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
- `signup-verify` / `signup-password`의 CTA는 키보드가 열린 상태에서도 first tap에 동작해야 합니다. OTP/비밀번호 단계 버튼은 필요 시 `Keyboard.dismiss()`를 먼저 호출하고, 인증 코드 입력은 `onSubmitEditing`으로도 같은 submit 경로를 타야 합니다.
- `request-signup-otp`는 `phone_verified=true`만으로 기존 FC 계정으로 판단하지 않습니다. `signup_completed=true`와 `fc_credentials.password_set_at`가 함께 있는 login-capable account만 `already_exists` blocker이고, verified-but-incomplete row나 partial delete residue는 reset/cleanup 뒤 signup retry가 가능해야 합니다.
- `set-password`는 OTP path가 이미 만든 `phone_verified=true` profile만 최종 가입으로 승격해야 하며, 신규 profile 생성이나 미인증 번호 bypass를 허용하면 안 됩니다.
- `set-password`는 기존 `fc_credentials.password_set_at`를 먼저 확인한 뒤에만 profile reset을 수행해야 합니다. duplicate/direct call이 추천인/온보딩 상태를 지우는 회귀를 허용하지 않습니다.
- `delete-account`는 `user_presence`까지 정리하고, 삭제 후 blocker row(`fc_profiles` / `admin_accounts` / `manager_accounts`)가 남아 있으면 성공으로 끝내지 않아야 합니다.
- legacy 로컬 세션에 과거 `role='manager'` payload가 남아 있어도 restore 단계에서 현재 앱 권한모델인 `admin + readOnly`로 정규화해야 합니다. 그렇지 않으면 본부장용 읽기 전용 화면과 referral self-service gate가 재로그인 전까지 어긋날 수 있습니다.
- referral self-service gate의 실제 모바일 surface는 `app/referral.tsx`다. FC 또는 `admin + readOnly` 본부장만 열고, plain admin/developer와 request_board designer는 같은 trusted path를 공유하지 않는다.
- `/referral` 상단은 더 이상 루트까지의 추천인 업라인 chain을 모두 보여주지 않고, direct recommender 1명 카드만 노출한다. 사용자가 입력한 추천코드 기준 사람 한 명만 보이는 것이 현재 UI 계약이다.
- `app/referral.tsx`의 descendant lazy expand는 같은 `appSessionToken`으로 descendant `fcId`를 다시 조회하므로, 서버 인가도 `self only`가 아니라 `self subtree membership`을 검증해야 화면 contract와 맞는다. `app/referral-tree.tsx`는 legacy 진입을 `/referral`로 보내는 compatibility redirect만 유지한다.
- 본부장 전용 desktop graph shortcut은 모바일 self-service의 보조 링크일 뿐이며, FC에게는 노출하지 않는다.
- 위촉 단계 필드(`hanwha_commission_*`, 보험 위촉 제출/승인 날짜)가 늘어날 때는 인증 흐름이 해당 필드를 잘못 덮어쓰지 않는지 같이 점검해야 합니다.

## 연관 문서

- [../shared/cross-repo-bridge-contract.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/cross-repo-bridge-contract.md)
- [../shared/security-and-secret-operations.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/security-and-secret-operations.md)
