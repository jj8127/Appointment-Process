doc_id: FC-HANDBOOK-WORKFLOW-MATRIX
owner_repo: fc-onboarding-app
owner_area: handbook
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: types/fc.ts + web/src/lib/shared.ts + web/src/app/api/admin/fc/route.ts

# 상태/전이 매트릭스

## FC 온보딩 상태

| status | 의미 | 주 변경 주체 | 대표 진입 액션 | 하향 복귀 가능성 |
| --- | --- | --- | --- | --- |
| `draft` | 기본 가입/부분 완료 시작점 | FC, admin | 회원가입, 커미션 override | 예 |
| `temp-id-issued` | 가등록/임시 ID 발급 완료 | admin | `updateProfile` | 예 |
| `allowance-pending` | 수당일/수당 승인 대기 | admin | `updateAllowanceDate` | 예 |
| `allowance-consented` | 수당 동의 완료 | FC, admin | 동의 완료/상태 수정 | 예 |
| `docs-requested` | 서류 요청 목록 확정 | admin | `updateDocsRequest` | 예 |
| `docs-pending` | 서류 일부 제출/반려 후 재대기 | FC, admin | 업로드/반려 | 예 |
| `docs-submitted` | 요청 서류 제출 완료 | FC | 서류 업로드 | 예 |
| `docs-rejected` | 서류 반려 상태 | admin | 서류 반려 | 예 |
| `docs-approved` | 요청 서류 승인 완료 | admin | 서류 승인 | 예 |
| `appointment-completed` | 위촉 처리 완료 | admin | `updateAppointmentAction` confirm | 예 |
| `final-link-sent` | 최종 완료 | admin, derived | 위촉 완료 + 커미션 조건 충족 | 예 |

## 상태 전이 메모

- `temp_id` 입력은 `draft -> temp-id-issued`를 유발할 수 있습니다.
- 수당일만 저장하면 `allowance-pending`, 동의 승인 시 `allowance-consented`입니다.
- 요청 서류를 모두 제거하면 다시 `allowance-consented`로 내려갑니다.
- 서류 반려는 `docs-pending`으로 되돌립니다.
- 위촉 reject는 `docs-approved`로 복귀합니다.
- 커미션 완료 플래그 조정은 `final-link-sent`를 강제 또는 해제할 수 있습니다.

## GaramLink 요약

- request 상태와 assignment 상태는 request_board가 소유합니다.
- 상세는 [request_board workflow matrix](E:/hanhwa/request_board/docs/handbook/workflow-state-matrix.md)를 봅니다.
