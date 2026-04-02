doc_id: FC-APP-AUTH-GATES
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-04-02
source_of_truth: app/login.tsx + app/signup*.tsx + app/reset-password.tsx + app/apply-gate.tsx + app/identity.tsx

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
- `request-signup-otp`는 `phone_verified=true`만으로 기존 FC 계정으로 판단하지 않습니다. `signup_completed=true`와 `fc_credentials.password_set_at`가 함께 있는 login-capable account만 `already_exists` blocker이고, verified-but-incomplete row나 partial delete residue는 reset/cleanup 뒤 signup retry가 가능해야 합니다.
- `set-password`는 OTP path가 이미 만든 `phone_verified=true` profile만 최종 가입으로 승격해야 하며, 신규 profile 생성이나 미인증 번호 bypass를 허용하면 안 됩니다.
- `set-password`는 기존 `fc_credentials.password_set_at`를 먼저 확인한 뒤에만 profile reset을 수행해야 합니다. duplicate/direct call이 추천인/온보딩 상태를 지우는 회귀를 허용하지 않습니다.
- `delete-account`는 `user_presence`까지 정리하고, 삭제 후 blocker row(`fc_profiles` / `admin_accounts` / `manager_accounts`)가 남아 있으면 성공으로 끝내지 않아야 합니다.
- 위촉 단계 필드(`hanwha_commission_*`, 보험 위촉 제출/승인 날짜)가 늘어날 때는 인증 흐름이 해당 필드를 잘못 덮어쓰지 않는지 같이 점검해야 합니다.

## 연관 문서

- [../shared/cross-repo-bridge-contract.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/cross-repo-bridge-contract.md)
- [../shared/security-and-secret-operations.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/security-and-secret-operations.md)
