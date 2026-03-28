doc_id: FC-APP-AUTH-GATES
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-03-28
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

- `request-signup-otp`와 `set-password`는 인증 화면 로직이지만, 신규 FC 프로필 생성/재초기화 시 shared commission helper를 함께 통과합니다.
- 위촉 단계 필드(`hanwha_commission_*`, 보험 위촉 제출/승인 날짜)가 늘어날 때는 인증 흐름이 해당 필드를 잘못 덮어쓰지 않는지 같이 점검해야 합니다.

## 연관 문서

- [../shared/cross-repo-bridge-contract.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/cross-repo-bridge-contract.md)
- [../shared/security-and-secret-operations.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/security-and-secret-operations.md)
