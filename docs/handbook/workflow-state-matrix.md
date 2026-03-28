doc_id: FC-HANDBOOK-WORKFLOW-MATRIX
owner_repo: fc-onboarding-app
owner_area: handbook
audience: developer, operator
last_verified: 2026-03-28
source_of_truth: types/fc.ts + lib/fc-workflow.ts + web/src/lib/shared.ts + web/src/app/api/admin/fc/route.ts

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
| `docs-approved` | 요청 서류 승인 완료, 한화 위촉 대기 | admin | 서류 승인 | 예 |
| `hanwha-commission-review` | FC 한화 위촉 완료일 제출 후 검토 중 | FC, admin | `fc-submit-hanwha-commission`, `updateStatus` | 예 |
| `hanwha-commission-rejected` | 한화 위촉 반려, 재제출 필요 | admin | `updateStatus` reject | 예 |
| `hanwha-commission-approved` | 한화 위촉 승인 완료, PDF 등록 완료 | admin | `updateStatus` approve | 예 |
| `appointment-completed` | 보험 위촉 URL 단계 진행 중/legacy 위촉 이력 보유 | FC, admin | `updateAppointmentAction` | 예 |
| `final-link-sent` | 최종 완료 | admin, derived | 위촉 완료 + 커미션 조건 충족 | 예 |

## 상태 전이 메모

- `temp_id` 입력은 `draft -> temp-id-issued`를 유발할 수 있습니다.
- 수당일만 저장하면 `allowance-pending`, 동의 승인 시 `allowance-consented`입니다.
- 요청 서류가 모두 승인되면 `docs-approved`로 전환되고 다음 단계는 `한화 위촉`입니다.
- 서류 반려/삭제/미완성 상태가 되면 `docs-pending`으로 내려가며 `hanwha_commission_*`, `appointment_*`, 커미션 완료 플래그를 함께 초기화합니다.
- FC가 한화 위촉 완료일을 제출하면 `hanwha-commission-review`입니다.
- 총무 승인 시 PDF가 필수이며, 승인 완료 후에만 보험 위촉 URL 단계가 의미를 갖습니다.
- 한화 반려는 `hanwha-commission-rejected`로 되돌리고 PDF 메타데이터를 비웁니다.
- `appointment-completed`와 `final-link-sent`는 legacy 보험 이력도 포함할 수 있지만, 신규 온보딩은 한화 승인 + PDF 이후에만 보험 위촉 단계로 진행합니다.

## GaramLink 요약

- request 상태와 assignment 상태는 request_board가 소유합니다.
- 상세는 [request_board workflow matrix](E:/hanhwa/request_board/docs/handbook/workflow-state-matrix.md)를 봅니다.
