doc_id: FC-BACKEND-ADMIN-OPS
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-03-26
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
- FC status/profile/docs/appointment update
- exam round/applicant mutate
- referral admin mutate
- FC 삭제

## 운영 주의

- service-role caller와 UI role contract를 분리해 생각하지 않습니다.
- read-only manager는 route 차원에서도 막혀야 합니다.
- FC 삭제는 storage/auth/notification/identity 정리까지 연쇄됩니다.
