doc_id: FC-BACKEND-ADMIN-OPS
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-07-23
source_of_truth: supabase/functions/admin-action/index.ts + web/src/app/api/admin/* + web/src/app/api/fc-delete/route.ts

# Backend Runbook: Admin Operations API

## 2026-07-06 Signed Admin Route Contract

- Admin web API authorization must go through the signed server-session helpers. Direct trust in `session_role` or `session_resident` cookies is not allowed for privileged reads or mutations.
- Shared admin route helpers should be used for new privileged routes: admin-only mutations use the admin gate, and admin/manager read-only routes use the read gate.
- Admin notification fanout should call the server-only push notification service instead of duplicating `device_tokens`, Expo, and web-push delivery logic inside route handlers.

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
- FC status/profile/docs/hanwha/appointment update
- exam round/applicant mutate
- referral admin mutate
- FC 삭제

## 운영 주의

- service-role caller와 UI role contract를 분리해 생각하지 않습니다.
- `/dashboard/profile/[id]`의 FC 상세 로드는 브라우저 anon Supabase query를 직접 쓰지 않고 `/api/admin/fc`의 read-only `getProfile` 액션으로만 가져옵니다. 관리자/본부장 세션 확인 후 service-role 조회를 수행하고, row가 없으면 route에서 명시적 `404`를 돌려 singular-query `406`을 브라우저에 노출하지 않습니다.
- resident-number full view는 trusted server path를 통해 앱/웹 사용자에게 제공할 수 있지만, 쓰기 권한은 계속 분리합니다.
- `/api/admin/resident-numbers`와 `/api/admin/fc`의 admin/manager session verification은 서로 다른 phone 포맷 규칙을 쓰면 안 됩니다. raw / digits / hyphenated 후보를 같은 규칙으로 허용해야 하며, 한 route만 digits-only로 남는 상태는 회귀입니다.
- 보증 보험 동의 단계의 `입력 완료 / 사전 심사 요청 완료 / 승인 완료` 조작은 `allowance_date`가 있어야 trusted path에서 저장할 수 있습니다. `미승인`은 반려 사유를 함께 저장합니다.
- 문서 무효화(반려/삭제/미완성)는 `hanwha_commission_*`, `appointment_*`, completion flag까지 같이 초기화해야 합니다.
- 다위촉 URL 승인 완료는 PDF path/name이 있어야만 저장되며, 승인일은 서버에서 자동 기록됩니다. 총무가 별도로 승인일을 입력하지는 않습니다.
- 단계 명칭은 `3단계 다위촉 URL`, `4단계 생명/손해 위촉`을 기준으로 API 라벨과 클라이언트 문구를 맞춥니다.
- FC 삭제는 storage/auth/notification/identity 정리까지 연쇄됩니다.

## 모바일 관리자 workflow 알림 대상 계약

- `admin-action.sendNotification`의 FC 수신자 키는 화면에 남아 있는 전화번호가 아니라 권한 검증된 `fcId`입니다. 클라이언트가 보내는 phone/role 필드는 권한 또는 수신자 결정에 사용하지 않습니다.
- trusted Edge Function은 알림 직전에 `fc_profiles.id=fcId`로 현재 phone을 조회하고, `010`으로 시작하는 11자리 번호만 canonical 대상에 사용합니다. 조회 실패, row 부재, 번호 형식 오류 시 다른 번호로 fallback하거나 inbox/push를 발송하지 않습니다.
- inbox 저장과 `fc-notify` push는 같은 `admin-action.sendNotification` 요청 안에서 처리합니다. `fc-notify` 호출은 service-role trusted boundary에서만 수행하며 10초로 제한합니다.
- primary workflow mutation은 알림 실패 때문에 되돌리지 않습니다. 알림 대상 조회, inbox 저장, downstream push 중 하나라도 확인되지 않으면 `notification_delivery_incomplete` 고정 warning을 반환하고 앱은 저장 성공과 알림 부분 실패를 구분해 표시합니다.
- 응답과 진단 로그에는 canonical phone, token, provider 원문, raw DB 오류를 포함하지 않습니다.
