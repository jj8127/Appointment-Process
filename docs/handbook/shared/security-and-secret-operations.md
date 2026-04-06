doc_id: SHARED-SECURITY-SECRET-OPS
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer, operator
last_verified: 2026-04-06
source_of_truth: env contracts + reset-password functions + admin service-role callers

# Security And Secret Operations

## 반드시 문서화되는 항목

- root/web/request_board env secret inventory
- bridge/password-sync shared secret pairing
- service-role caller 목록
- resident number / SSN / phone identity 처리 규칙
- SMS reset bypass/test-code 운영 규칙
- push/VAPID/admin push secret 범위

## 운영 실수 주의

- `SMS_BYPASS_ENABLED` 또는 test code를 production처럼 사용하지 않습니다.
- service-role 키가 있는 로컬 스크립트를 운영 DB에 바로 실행하지 않습니다.
- bridge secret은 양 저장소를 같은 변경 세트로 회전합니다.
- web localStorage/cookie를 “강한 서버 세션”으로 오해하지 않습니다.
- admin/manager cookie `session_resident`는 digits-only 원문으로 단정하지 않습니다. privileged server route는 raw / digits / hyphenated 후보를 함께 검증해야 하며, 포맷 차이 때문에 PII read가 막히면 security-hardening이 아니라 regression입니다.

## break-glass 메모

- 비밀번호 reset 계열은 가람in이 canonical entrypoint입니다.
- request_board의 reset UI는 proxy일 뿐 독립 정책 원천이 아닙니다.
- PII export/조회는 resident-number API 또는 owning secure path만 사용합니다.

## 2026-03-28 운영 메모

- `request-signup-otp`와 `set-password`는 로그인/가입 시 shared commission initializer를 거치므로, 위촉 단계 필드(`hanwha_commission_*`, 보험 위촉 제출/승인 필드) 초기화 규칙과 같이 검토해야 합니다.
- `set-password`는 OTP로 검증된 기존 profile만 승격하고, duplicate/direct call에서는 `password_set_at`를 먼저 확인한 뒤에만 reset/update를 수행해야 합니다. fresh-number bypass나 기존 추천인/온보딩 상태 wipe는 security regression으로 취급합니다.
- 모바일/웹 push fanout은 `device_tokens.role='admin'`만 전제하면 안 됩니다. 총무 기기가 `manager` role로 등록될 수 있으므로, FC 제출 알림은 `admin`과 `manager` 토큰을 모두 포함해야 합니다.
