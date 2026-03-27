doc_id: SHARED-SECURITY-SECRET-OPS
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer, operator
last_verified: 2026-03-26
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

## break-glass 메모

- 비밀번호 reset 계열은 가람in이 canonical entrypoint입니다.
- request_board의 reset UI는 proxy일 뿐 독립 정책 원천이 아닙니다.
- PII export/조회는 resident-number API 또는 owning secure path만 사용합니다.
