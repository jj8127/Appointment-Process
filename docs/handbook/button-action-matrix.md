doc_id: FC-HANDBOOK-ACTION-MATRIX
owner_repo: fc-onboarding-app
owner_area: handbook
audience: developer, operator
last_verified: 2026-03-30
source_of_truth: app/* + web/src/app/* + supabase/functions/*

# 핵심 액션 매트릭스

| action_id | label | surface | visible_to | enabled_when | does | writes/mutates | success_feedback | error_feedback | related_flow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `FC-AUTH.LOGIN` | 로그인 | `login` | `fc`, `admin`, `manager`, linked `designer` | 전화번호/비밀번호 유효 | 앱 세션 + 브리지 토큰 발급 | auth/session | 홈 또는 브리지 진입 | 사용자용 에러 알림 | Auth |
| `FC-AUTH.RESET_PASSWORD` | 비밀번호 변경하기 | `reset-password` | 모든 로그인 대상 | 인증번호 검증 통과 | 비밀번호 재설정 + request_board sync 시도 | credentials | 완료 알림 | SMS/토큰/동기화 실패 안내 | Auth |
| `FC-ONBOARDING.SAVE_PROFILE` | 저장 | `fc/new` | `fc` | 필수값 유효 | 기본정보/소속/커미션 저장 | `fc_profiles` | 저장 완료 | 입력 확인/서버 오류 | Onboarding |
| `FC-ONBOARDING.CONSENT_SUBMIT` | 수당 동의일 저장 | `consent` | `fc` | temp-id 선행 + 날짜 유효 | 수당동의일 저장 후 수당동의 단계를 다시 시작 | `allowance_date`, `status=allowance-pending`, `allowance_prescreen_requested_at=null`, `allowance_reject_reason=null` | `FC 수당 동의 입력 완료` | 게이트 오류 | Onboarding |
| `FC-DOCS.UPLOAD` | 서류 업로드 | `docs-upload` | `fc` | 요청 서류 존재 | 파일 업로드/재제출 | storage + doc rows | 제출 상태 반영 | 업로드 실패 | Docs |
| `FC-HANWHA.SUBMIT` | 한화 위촉 URL 완료일 제출 | `hanwha-commission` | `fc` | 서류 승인 완료 | 한화 위촉 URL 완료일 제출 | `fc_profiles.hanwha_commission_*` | 검토 대기 | 제출 실패 | Onboarding |
| `FC-APPOINTMENT.SUBMIT` | 생명/손해 위촉 제출 | `appointment` | `fc` | 한화 위촉 URL 승인 + PDF 완료 | 생명/손해 위촉 일정/완료 제출 | appointment fields | 제출 완료 | 서버 오류 | Appointment |
| `FC-ADMIN.ALLOWANCE_STAGE` | 입력 완료 / 사전 심사 요청 완료 / 승인 완료 / 미승인 | web `dashboard` allowance tab + mobile `dashboard` | `admin` | readOnly 아님 | 수당동의 파생 상태와 반려 사유를 관리 | `status`, `allowance_date`, `allowance_prescreen_requested_at`, `allowance_reject_reason` | 상태 라벨/목록/홈 단계 갱신 | 권한/계약 오류 | Admin lifecycle |
| `FC-ADMIN.UPDATE_STATUS` | 상태 변경 | web `dashboard` | `admin` | readOnly 아님 | FC 상태 전이 | `fc_profiles.status` | 토스트/리스트 갱신 | 권한/계약 오류 | Admin lifecycle |
| `FC-ADMIN.UPDATE_DOC_STATUS` | 승인/반려 | web `dashboard` docs tab | `admin` | 서류 row 존재 | 문서 상태 갱신 | doc row + profile status | 토스트/상태 갱신 | 권한/서버 오류 | Docs |
| `FC-ADMIN.UPDATE_HANWHA` | 한화 승인/반려/PDF 관리 | web `dashboard` hanwha tab | `admin` | 한화 제출 row 존재 | FC 제출 완료일 확인, PDF 업로드/삭제, 승인/반려 | `hanwha_commission_*` + notifications | 토스트/상태 갱신 | PDF/계약 오류 | Admin lifecycle |
| `FC-ADMIN.UPDATE_COMMISSION_FLAGS` | 생명/손해 위촉 완료 저장 | web `dashboard` appointment tab | `admin` | readOnly 아님 | `생명 위촉 완료`, `손해 위촉 완료` 플래그를 독립적으로 저장 | `life_commission_completed`, `nonlife_commission_completed`, 필요 시 `status` | 토스트/목록 갱신 | 권한/계약 오류 | Appointment |
| `FC-ADMIN.CONFIRM_APPOINTMENT` | 위촉 확정 | web `dashboard` appointment tab | `admin` | 제출 정보 유효 | 위촉 완료/최종 완료 계산 | appointment fields + status | 완료 토스트 | 서버 오류 | Appointment |
| `FC-BRIDGE.OPEN_REQUEST_BOARD` | 설계요청 열기 | `request-board` | `fc`, `manager`, `developer`, linked `designer` | 브리지 세션 복구 가능 | GaramLink 임베드/연결 | request_board JWT/session | 화면 진입 | 재로그인/브리지 오류 | Bridge |
