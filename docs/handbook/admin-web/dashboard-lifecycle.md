doc_id: FC-ADMIN-DASHBOARD-LIFECYCLE
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: operator, developer
last_verified: 2026-03-30
source_of_truth: web/src/app/dashboard/page.tsx + web/src/app/api/admin/fc/route.ts + web/src/lib/shared.ts

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
- doc/hanwha/appointment status
- commission flags

## 쓰는 데이터

- `updateProfile`
- `updateStatus`
- `updateAllowanceDate`
- `updateDocsRequest`
- `createHanwhaPdfUploadUrl`
- `deleteHanwhaPdf`
- `signDoc`
- `sendReminder`
- hanwha approve/reject
- appointment confirm/reject

## 상태/분기

- `manager`는 같은 화면을 보더라도 write action이 비활성
- FC 상세 모달은 `수당 동의 / 서류 관리 / 한화 위촉 / 생명/손해 위촉` 4탭 구조
- temp-id, allowance, docs, hanwha, appointment, commission flag가 서로 상태 합성에 영향
- 수당동의 탭은 `동의일(Actual)` 저장과 `입력 완료 / 사전 심사 요청 완료 / 승인 완료 / 미승인` 조작을 함께 처리하며, 총무는 `allowance_date` 유무와 관계없이 상태를 바꿀 수 있습니다.
- 한화 위촉 탭은 `완료일(FC 제출)` 확인, 승인 PDF 업로드/삭제, `미승인 / 승인 완료` 조작을 담당하며 별도 `관리자 승인일` 입력 UI는 없습니다.
- 생명/손해 위촉 탭은 `생명 위촉 완료`, `손해 위촉 완료` 플래그를 독립 토글로 저장할 수 있고, 둘 다 꺼진 상태는 별도 버튼 없이 미완료로 본다.
- 3단계 라벨은 `한화 위촉 URL`, 4단계 라벨은 `생명/손해 위촉`으로 통일합니다.
- FC 삭제는 별도 파괴적 작업

## 사용자 액션

- 상태 변경
- 메모/기본정보 수정
- 요청 서류 설정
- 서류 승인/반려
- 한화 PDF 업로드/삭제
- 한화 승인/반려
- 생명/손해 완료 플래그 저장
- 위촉 일정/확정/반려
- resident number 조회

## 실패/예외

- schema drift 시 탭별 저장 실패 가능
- readOnly enforcement 누락은 즉시 회귀 취급

## 연관 문서

- [../workflow-state-matrix.md](E:/hanhwa/fc-onboarding-app/docs/handbook/workflow-state-matrix.md)
- [../backend/admin-operations-api.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/admin-operations-api.md)
