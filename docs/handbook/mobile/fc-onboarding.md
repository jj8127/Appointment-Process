doc_id: FC-APP-ONBOARDING
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-03-31
source_of_truth: app/index.tsx + app/home-lite.tsx + app/fc/new.tsx + app/consent.tsx + app/docs-upload.tsx + app/hanwha-commission.tsx + app/appointment.tsx + app/exam-apply.tsx + app/exam-apply2.tsx + lib/fc-workflow.ts

# Mobile Playbook: FC Onboarding

## 목적

- FC가 가입 후 본등록, 수당동의, 서류, 위촉까지 스스로 진행하도록 안내

## 단계 정의

- `1단계 수당동의`
- `2단계 문서제출`
- `3단계 한화 위촉 URL`
- `4단계 생명/손해 위촉`
- `5단계 완료`

## 진입 경로

- `index`
- `home-lite`
- `fc/new`
- `consent`
- `docs-upload`
- `hanwha-commission`
- `appointment`

## 표시 역할

- `fc`

## 읽는 데이터

- `fc_profiles`
- 현재 `status`
- 요청 서류 목록/제출 상태
- 한화 위촉 URL 제출/승인/PDF 상태
- appointment 제출/완료 상태
- 커미션 완료 플래그
- 주민번호 full-view trusted read 결과

## 쓰는 데이터

- FC 기본정보 저장
- 수당 동의 저장
- 서류 업로드/재제출
- 한화 위촉 URL 완료일 제출
- 생명/손해 위촉 제출
- 시험 신청 저장 시 선택한 회차에 속한 응시 지역만 저장

## 상태/분기

- `home-lite`는 unlock 전 안내 역할
- temp-id 선행 없이 consent를 완료할 수 없음
- docs request가 있어야 `docs-upload`가 활성 역할을 가짐
- 수당동의 단계는 `allowance_prescreen_requested_at`으로 내부 진행 표시를 분리한다
  - `allowance_date` 없음 => `FC 수당 동의일 미입력`
  - `allowance_date` 있음 + `allowance_prescreen_requested_at` 없음 + `status=allowance-pending` => `FC 수당 동의 입력 완료`
  - `allowance_date` 있음 + `allowance_prescreen_requested_at` 있음 + `status=allowance-pending` => `사전 심사 요청 완료`
  - `status=allowance-consented` => `승인 완료`
  - `status=allowance-pending + allowance_reject_reason` => `미승인`
- FC가 수당 동의일을 다시 저장하면 `allowance_prescreen_requested_at`과 `allowance_reject_reason`이 초기화되고 `FC 수당 동의 입력 완료`로 돌아간다
- 총무는 `allowance_date` 유무와 관계없이 모바일/웹 관리자 화면에서 `입력 완료 / 사전 심사 요청 완료 / 승인 완료 / 미승인`을 진행할 수 있고, 본부장은 같은 화면을 read-only로 본다
- 파생 라벨은 `allowance_date` 유무를 우선 반영하므로, 날짜가 비어 있으면 관리자 조작 후에도 `FC 수당 동의일 미입력`이 먼저 표시될 수 있다
- 서류 승인 뒤에는 바로 4단계 `생명/손해 위촉`이 아니라 3단계 `hanwha-commission`(`한화 위촉 URL`)이 열린다
- 한화 위촉 URL 승인과 PDF 등록이 끝나야 4단계 `appointment`(`생명/손해 위촉`)가 열린다
- FC 본인 화면에서도 주민번호는 trusted server path로 full-view 조회되며, masked fallback을 새 계약으로 사용하지 않는다
- 시험 신청 화면은 기존 신청을 복원할 때도 `location_id`가 현재 회차의 지역 목록에 없으면 선택 상태를 복원하지 않고, 다시 지역을 고르게 한다

## FC 홈/다음 단계 동작

- `FC 수당 동의일 미입력`: `1단계 수당동의`, 다음 단계 `터치하여 바로 진행하세요`
- `FC 수당 동의 입력 완료`: `1단계 수당동의`, 다음 단계 `총무가 사전 심사를 준비 중입니다.`
- `사전 심사 요청 완료`: `1단계 수당동의`, 다음 단계 `사전 심사 결과를 기다리는 중입니다.`
- `승인 완료`: `2단계 문서제출`로 이동
- `미승인`: `1단계 수당동의`, 다음 단계 `반려 사유를 확인하고 다시 입력하세요`
- `docs-approved`: `3단계 한화 위촉 URL`
- `hanwha-commission-approved`: `4단계 생명/손해 위촉`

## 사용자 액션

- 프로필 저장
- 동의 제출
- 파일 업로드/교체
- 한화 위촉 URL 완료일 제출
- 한화 승인 PDF 열람
- 생명/손해 위촉 제출

## 성공 결과

- 상태가 다음 단계로 이동
- 관리자 검토 대기 또는 완료

## 실패/예외

- 기술 에러는 사용자용 한국어 알림으로 변환
- schema drift가 있으면 관리자 쪽 저장/조회와 어긋날 수 있음
- 시험 신청 저장 시 회차-지역 불일치가 감지되면 `선택한 응시 지역이 해당 시험 회차에 속하지 않습니다.` 메시지로 차단한다

## 연관 문서

- [../workflow-state-matrix.md](E:/hanhwa/fc-onboarding-app/docs/handbook/workflow-state-matrix.md)
- [../admin-web/dashboard-lifecycle.md](E:/hanhwa/fc-onboarding-app/docs/handbook/admin-web/dashboard-lifecycle.md)
