doc_id: FC-BACKEND-ADMIN-OPS
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-03-30
source_of_truth: supabase/functions/admin-action/index.ts + web/src/app/api/admin/* + web/src/app/api/fc-delete/route.ts

# Backend Runbook: Admin Operations API

## 주요 privileged surface

- `admin-action`
- `/api/admin/fc`
- `/api/admin/list`
- `/api/admin/resident-numbers`
- `/api/admin/exam-applicants`
- `/api/admin/referrals`
- `/api/fc-delete`

## 담당 작업

- resident-number decrypt
- FC status/profile/docs/hanwha/appointment update
- exam round/applicant mutate
- referral admin mutate
- FC 삭제

## 운영 주의

- service-role caller와 UI role contract를 분리해 생각하지 않습니다.
- resident-number full view는 trusted server path를 통해 앱/웹 사용자에게 제공할 수 있지만, 쓰기 권한은 계속 분리합니다.
- 수당동의 단계의 `입력 완료 / 사전 심사 요청 완료 / 승인 완료 / 미승인` 조작은 `allowance_date` 유무와 관계없이 trusted path에서 저장할 수 있습니다.
- 문서 무효화(반려/삭제/미완성)는 `hanwha_commission_*`, `appointment_*`, completion flag까지 같이 초기화해야 합니다.
- 한화 위촉 URL 승인 완료는 PDF path/name이 있어야만 저장되며, 승인일은 서버에서 자동 기록됩니다. 총무가 별도로 승인일을 입력하지는 않습니다.
- 단계 명칭은 `3단계 한화 위촉 URL`, `4단계 생명/손해 위촉`을 기준으로 API 라벨과 클라이언트 문구를 맞춥니다.
- FC 삭제는 storage/auth/notification/identity 정리까지 연쇄됩니다.
