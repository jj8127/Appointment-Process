doc_id: FC-HANDBOOK-WORKFLOW-MATRIX
owner_repo: fc-onboarding-app
owner_area: handbook
audience: developer, operator
last_verified: 2026-03-30
source_of_truth: types/fc.ts + lib/fc-workflow.ts + web/src/lib/shared.ts + web/src/app/api/admin/fc/route.ts

# 상태/전이 매트릭스

## FC 온보딩 상태

| status | 의미 | 주 변경 주체 | 대표 진입 액션 | 하향 복귀 가능성 |
| --- | --- | --- | --- | --- |
| `draft` | 기본 가입/부분 완료 시작점 | FC, admin | 회원가입, 커미션 override | 예 |
| `temp-id-issued` | 가등록/임시 ID 발급 완료 | admin | `updateProfile` | 예 |
| `allowance-pending` | 수당동의 단계 진행 중. `allowance_date`, `allowance_prescreen_requested_at`, `allowance_reject_reason` 조합으로 `FC 수당 동의일 미입력 / FC 수당 동의 입력 완료 / 사전 심사 요청 완료 / 미승인`을 파생 표시 | FC, admin | `updateAllowanceDate`, 수당동의 단계 토글 | 예 |
| `allowance-consented` | 수당동의 승인 완료 | admin | 수당동의 승인 완료 | 예 |
| `docs-requested` | 서류 요청 목록 확정 | admin | `updateDocsRequest` | 예 |
| `docs-pending` | 서류 일부 제출/반려 후 재대기 | FC, admin | 업로드/반려 | 예 |
| `docs-submitted` | 요청 서류 제출 완료 | FC | 서류 업로드 | 예 |
| `docs-rejected` | 서류 반려 상태 | admin | 서류 반려 | 예 |
| `docs-approved` | 요청 서류 승인 완료, 3단계 `한화 위촉 URL` 대기 | admin | 서류 승인 | 예 |
| `hanwha-commission-review` | FC 한화 위촉 URL 완료일 제출 후 검토 중 | FC, admin | `fc-submit-hanwha-commission`, `updateStatus` | 예 |
| `hanwha-commission-rejected` | 한화 위촉 URL 반려, 재제출 필요 | admin | `updateStatus` reject | 예 |
| `hanwha-commission-approved` | 한화 위촉 URL 승인 완료, PDF 등록 완료 | admin | `updateStatus` approve | 예 |
| `appointment-completed` | 4단계 `생명/손해 위촉` 진행 중/legacy 위촉 이력 보유 | FC, admin | `updateAppointmentAction` | 예 |
| `final-link-sent` | 최종 완료 | admin, derived | 위촉 완료 + 커미션 조건 충족 | 예 |

## 상태 전이 메모

- `temp_id` 입력은 `draft -> temp-id-issued`를 유발할 수 있습니다.
- `fc_profiles.allowance_prescreen_requested_at`은 수당동의 단계 내부 진행 상태를 구분하는 전용 보조 필드입니다.
- 수당동의 파생 표시 규칙은 아래와 같습니다.
  - `allowance_date` 없음 => `FC 수당 동의일 미입력`
  - `allowance_date` 있음 + `allowance_prescreen_requested_at` 없음 + `status=allowance-pending` => `FC 수당 동의 입력 완료`
  - `allowance_date` 있음 + `allowance_prescreen_requested_at` 있음 + `status=allowance-pending` => `사전 심사 요청 완료`
  - `status=allowance-consented` => `승인 완료`
  - `status=allowance-pending` + `allowance_reject_reason` 있음 => `미승인`
- FC가 수당 동의일을 저장하거나 다시 수정하면 `allowance_prescreen_requested_at`과 `allowance_reject_reason`은 함께 null로 초기화되고, 표시 상태는 `FC 수당 동의 입력 완료`로 되돌아갑니다.
- 총무는 `allowance_date` 유무와 관계없이 수당동의 단계에서 `입력 완료 / 사전 심사 요청 완료 / 승인 완료 / 미승인`을 조작할 수 있고, 본부장은 read-only를 유지합니다. 이때 `status`, `allowance_prescreen_requested_at`, `allowance_reject_reason`이 함께 갱신됩니다.
- 단, 파생 표시 라벨은 항상 `allowance_date`를 우선 보므로 날짜가 비어 있으면 관리자 조작 후에도 `FC 수당 동의일 미입력`이 우선 표시될 수 있습니다.
- 요청 서류가 모두 승인되면 `docs-approved`로 전환되고 다음 단계는 3단계 `한화 위촉 URL`입니다.
- 서류 반려/삭제/미완성 상태가 되면 `docs-pending`으로 내려가며 `hanwha_commission_*`, `appointment_*`, 커미션 완료 플래그를 함께 초기화합니다.
- FC가 한화 위촉 URL 완료일을 제출하면 `hanwha-commission-review`입니다.
- 총무 승인 시 PDF가 필수이며, 한화 위촉 URL 승인 완료 후에만 4단계 `생명/손해 위촉` 단계가 의미를 갖습니다.
- 한화 반려는 `hanwha-commission-rejected`로 되돌리고 PDF 메타데이터를 비웁니다.
- `appointment-completed`와 `final-link-sent`는 legacy 보험 이력도 포함할 수 있지만, 신규 온보딩은 한화 위촉 URL 승인 + PDF 이후에만 `생명/손해 위촉` 단계로 진행합니다.

## GaramLink 요약

- request 상태와 assignment 상태는 request_board가 소유합니다.
- 상세는 [request_board workflow matrix](E:/hanhwa/request_board/docs/handbook/workflow-state-matrix.md)를 봅니다.
