doc_id: FC-ADMIN-EXAM-REFERRAL
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: operator, developer
last_verified: 2026-03-28
source_of_truth: web/src/app/dashboard/exam/* + web/src/app/admin/exams/* + web/src/app/dashboard/referrals/page.tsx + web/src/app/api/admin/referrals/route.ts

# Admin Web Playbook: Exam And Referral Ops

## 포함 화면

- `/dashboard/exam/schedule`
- `/dashboard/exam/applicants`
- `/admin/exams/*`
- `/dashboard/referrals`

## 시험 운영

- 라운드 생성/수정/삭제
- 신청자 조회/삭제
- legacy admin 시험 화면과 최신 dashboard 시험 화면이 공존
- `/dashboard/exam/applicants` 는 상단 소속 quick filter를 제공
- resident number/full view는 운영 역할(admin/manager/developer) 기준으로 읽을 수 있고, `manager`는 모든 쓰기 액션이 비활성

## 추천인 운영

- backfill
- rotate code
- disable code
- manager는 read-only

## 연관 문서

- [../data/referral-schema-and-admin-rpcs.md](E:/hanhwa/fc-onboarding-app/docs/handbook/data/referral-schema-and-admin-rpcs.md)
- [../backend/admin-operations-api.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/admin-operations-api.md)
