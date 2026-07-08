doc_id: FC-APP-ONBOARDING
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-06-08
source_of_truth: app/index.tsx + app/home-lite.tsx + app/fc/new.tsx + app/consent.tsx + app/docs-upload.tsx + app/hanwha-commission.tsx + app/appointment.tsx + app/exam-apply.tsx + app/exam-apply2.tsx + lib/fc-workflow.ts + lib/home-latest-notice.ts + lib/notice-route.ts

# Mobile Playbook: FC Onboarding

## 2026-07-05 Home Latest Admin Message

- Home latest admin-message lookup is an optional display enrichment. A Supabase read failure should log as `warn` and return `null`, not surface as a user-blocking error or inflate runtime error telemetry.

## 2026-07-06 Push Registration Contract

- Mobile push registration must reuse an Expo token that was already fetched by the caller instead of fetching a second token in the same login/home effect.
- `device_tokens` is no longer a mobile client table contract. Mobile code must call the trusted device-token Edge Function for register/delete and must not use direct Supabase `.from('device_tokens')` access.

## 목적

- FC가 가입 후 본등록, 보증 보험 동의, 서류, 위촉까지 스스로 진행하도록 안내

## 단계 정의

- `1단계 보증 보험 동의`
- `2단계 문서제출`
- `3단계 다위촉 URL`
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
- 다위촉 URL 제출/승인/PDF 상태
- appointment 제출/완료 상태
- 커미션 완료 플래그
- 주민번호 full-view trusted read 결과

## 쓰는 데이터

- FC 기본정보 저장
- 보증 보험 동의 저장
- 서류 업로드/재제출
- 다위촉 URL 완료일 제출
- 생명/손해 위촉 제출
- 시험 신청 저장 시 선택한 회차에 속한 응시 지역만 저장

## 상태/분기

- `home-lite`는 unlock 전 안내 역할
- 본등록 후 정식 홈(`/`) 진입은 `fc_profiles.identity_completed === true`일 때만 허용한다. `resident_id_masked`나 `address` 같은 public profile 잔존값만으로는 홈 진입을 unlock하지 않는다.
- `set-password`는 추천인 코드가 전달된 가입에서 추천인 코드를 다시 검증하고 `apply_referral_link_state`를 비밀번호 저장과 `signup_completed=true`보다 먼저 완료해야 한다. 추천인 코드가 해석되지 않으면 본등록을 완료시키지 않고 사용자가 추천인을 다시 선택하게 한다.
- 기존 운영 데이터에서 추천인 스냅샷이 비어 있는 가입자는 `referral_events(event_type='signup_completed')`의 최신 resolved 이벤트를 기준으로 backfill할 수 있다. 임의 문자열 `recommender` 입력값은 신뢰하지 않는다.
- temp-id 선행 없이 consent를 완료할 수 없음
- docs request가 있어야 `docs-upload`가 활성 역할을 가짐
- 보증 보험 동의 단계는 `allowance_prescreen_requested_at`으로 내부 진행 표시를 분리한다
  - `allowance_date` 없음 => `FC 보증보험 조회 동의일 미입력`
  - `allowance_date` 있음 + `allowance_prescreen_requested_at` 없음 + `status=allowance-pending` => `FC 보증 보험 동의 입력 완료`
  - `allowance_date` 있음 + `allowance_prescreen_requested_at` 있음 + `status=allowance-pending` => `사전 심사 요청 완료`
  - `status=allowance-consented` => `승인 완료`
  - `status=allowance-pending + allowance_reject_reason` => `미승인`
- FC가 보증보험 조회 동의일을 다시 저장하면 `allowance_prescreen_requested_at`과 `allowance_reject_reason`이 초기화되고 `FC 보증 보험 동의 입력 완료`로 돌아간다
- 총무는 `allowance_date`가 있어야 모바일/웹 관리자 화면에서 `입력 완료 / 사전 심사 요청 완료 / 승인 완료`를 진행할 수 있고, 본부장은 같은 화면을 read-only로 본다
- 파생 라벨은 `allowance_date` 유무를 우선 반영하므로, 날짜가 비어 있으면 입력 완료/사전 심사/승인 조작은 저장되지 않고 `FC 보증보험 조회 동의일 미입력`이 유지된다
- 서류 승인 뒤에는 바로 4단계 `생명/손해 위촉`이 아니라 3단계 `hanwha-commission`(`다위촉 URL`)이 열린다
- 총무가 다위촉 탭에 PDF를 첨부하면 FC는 `hanwha-commission` 화면에서 그 파일을 바로 열람/다운로드할 수 있다. 단, 다음 단계(`appointment`) 잠금 해제는 여전히 `다위촉 승인 + PDF 등록`이 모두 끝난 뒤에만 이뤄진다.
- 다위촉 URL 승인과 PDF 등록이 끝나야 4단계 `appointment`(`생명/손해 위촉`)가 열린다
- `appointment` 화면에서 FC가 생명/손해 위촉 완료일을 제출하면 성공 피드백은 네이티브 Alert가 아니라 앱 toast로 표시한다. 제출 성공 직후 화면 상태를 다시 읽기 때문에 Android native dialog와 리렌더를 겹치게 만들면 안 된다.
- FC 본인 화면에서도 주민번호는 trusted server path로 full-view 조회되며, masked fallback을 새 계약으로 사용하지 않는다
- 시험 신청 화면은 기존 신청을 복원할 때도 `location_id`가 현재 회차의 지역 목록에 없으면 선택 상태를 복원하지 않고, 다시 지역을 고르게 한다
- Android new architecture/Fabric에서 `fc/new`, `exam-apply`, `exam-apply2`처럼 `RefreshControl`과 큰 조건부 렌더 tree를 함께 가진 화면은 `KeyboardAwareWrapper`를 primary scroll owner로 쓰지 않는다. Android는 plain `ScrollView` + explicit bottom padding을 쓰고, iOS에서만 기존 keyboard-aware wrapper를 유지한다.
- 홈 가이드 CTA의 재생 표시는 icon font glyph 대신 `guidePlayTriangle` 스타일 삼각형으로 그린다. Android emulator/device에서 Feather glyph baseline drift가 생기면 이 스타일 계약을 유지한다.

## FC 홈/다음 단계 동작

- 홈 최신 공지 카드는 `fc-notify latest_notice` 응답을 사용한다. 게시판 `가람pick`(`garam-pick`) 글도 최신 공지 후보에 포함된다.
- `board_notice:<postId>` id는 `/board?postId=<postId>`로 이동해 게시판 상세 모달을 연다. 홈 진입 후 게시판 모달 route param을 닫는 경로로 보내지 않는다.
- `FC 보증보험 조회 동의일 미입력`: `1단계 보증 보험 동의`, 다음 단계 `터치하여 바로 진행하세요`
- `FC 보증 보험 동의 입력 완료`: `1단계 보증 보험 동의`, 다음 단계 `총무가 사전 심사를 준비 중입니다.`
- `사전 심사 요청 완료`: `1단계 보증 보험 동의`, 다음 단계 `사전 심사 결과를 기다리는 중입니다.`
- `승인 완료`: `2단계 문서제출`로 이동
- `미승인`: `1단계 보증 보험 동의`, 다음 단계 `반려 사유를 확인하고 다시 입력하세요`
- `docs-approved`: `3단계 다위촉 URL`
- `hanwha-commission-approved`: `4단계 생명/손해 위촉`

## 사용자 액션

- 프로필 저장
- 동의 제출
- 파일 업로드/교체
- 다위촉 URL 완료일 제출
- 다위촉 첨부/승인 PDF 열람
- 생명/손해 위촉 제출

## 성공 결과

- 상태가 다음 단계로 이동
- 관리자 검토 대기 또는 완료

## 실패/예외

- 기술 에러는 사용자용 한국어 알림으로 변환
- schema drift가 있으면 관리자 쪽 저장/조회와 어긋날 수 있음
- 시험 신청 저장 시 회차-지역 불일치가 감지되면 `선택한 응시 지역이 해당 시험 회차에 속하지 않습니다.` 메시지로 차단한다

## 연관 문서

- [../workflow-state-matrix.md](../workflow-state-matrix.md)
- [../admin-web/dashboard-lifecycle.md](../admin-web/dashboard-lifecycle.md)

## 2026-07-04 Shared FC Workflow Core

- FC onboarding next-step labels and workflow display state must stay aligned with `lib/fc-workflow-core.ts`.
- Admin web wrappers and mobile screens should expose surface-specific presentation only; workflow priority and allowance state rules belong in the shared core.
