doc_id: FC-HANDBOOK-OPS-RUNBOOK
owner_repo: fc-onboarding-app
owner_area: handbook
audience: operator
last_verified: 2026-03-26
source_of_truth: web/src/app/api/* + supabase/functions/* + data/*

# 운영 런북

## 자주 찾는 작업

- 로그인/세션/브리지 장애: [shared/cross-repo-bridge-contract.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/cross-repo-bridge-contract.md)
- 비밀번호/SMS/테스트 코드: [shared/security-and-secret-operations.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/security-and-secret-operations.md)
- FC 상태 복구: [admin-web/dashboard-lifecycle.md](E:/hanhwa/fc-onboarding-app/docs/handbook/admin-web/dashboard-lifecycle.md)
- resident number 조회: [backend/admin-operations-api.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/admin-operations-api.md)
- 알림/푸시/배지: [backend/notifications-inbox-push.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/notifications-inbox-push.md)
- referral 운영: [data/referral-schema-and-admin-rpcs.md](E:/hanhwa/fc-onboarding-app/docs/handbook/data/referral-schema-and-admin-rpcs.md)

## 필수 점검 순서

1. 역할/권한 계약이 맞는지 확인합니다.
2. 해당 상태 전이가 어느 저장소 소유인지 확인합니다.
3. 관련 migration/secret/bucket 선행 조건을 확인합니다.
4. 사용자 노출 동작과 운영 작업을 함께 검증합니다.

## 교차 저장소 smoke path

`로그인 또는 비밀번호 재설정 -> GaramLink bridge-login -> FC 요청 생성 -> designer accept/complete -> unread/notification sync`
