doc_id: FC-ADMIN-DASHBOARD-LIFECYCLE
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: operator, developer
last_verified: 2026-03-26
source_of_truth: web/src/app/dashboard/page.tsx + web/src/app/api/admin/fc/route.ts

# Admin Web Playbook: Dashboard Lifecycle

## 목적

- FC lifecycle 운영의 메인 콘솔

## 진입 경로

- `/dashboard`
- `/dashboard/profile/[id]`

## 표시 역할

- `admin`
- `manager` read-only

## 읽는 데이터

- FC 리스트/검색
- step bucket
- profile basic info
- doc/appointment status
- commission flags

## 쓰는 데이터

- `updateProfile`
- `updateStatus`
- `updateAllowanceDate`
- `updateDocsRequest`
- `signDoc`
- `sendReminder`
- appointment confirm/reject

## 상태/분기

- `manager`는 같은 화면을 보더라도 write action이 비활성
- temp-id, allowance, docs, appointment, commission flag가 서로 상태 합성에 영향
- FC 삭제는 별도 파괴적 작업

## 사용자 액션

- 상태 변경
- 메모/기본정보 수정
- 요청 서류 설정
- 서류 승인/반려
- 위촉 일정/확정/반려
- resident number 조회

## 실패/예외

- schema drift 시 탭별 저장 실패 가능
- readOnly enforcement 누락은 즉시 회귀 취급

## 연관 문서

- [../workflow-state-matrix.md](E:/hanhwa/fc-onboarding-app/docs/handbook/workflow-state-matrix.md)
- [../backend/admin-operations-api.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/admin-operations-api.md)
