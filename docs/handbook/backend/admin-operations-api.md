doc_id: FC-BACKEND-ADMIN-OPS
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-10-24
source_of_truth: supabase/functions/admin-action/index.ts + web/src/app/api/admin/* + web/src/app/api/fc-delete/route.ts

# Backend Runbook: Admin Operations API

## 2026-10-24 서류 서명 URL·FC 업로드 제출 액션 (로컬, 운영 미배포)

앱 클라이언트는 anon이므로 `20261024120100_close_anon_document_reads` 뒤에는 `fc-documents`를 직접 목록·내려받기·서명할 수 없다. 앱 안의 서류 열기와 FC 제출은 아래 admin-action 액션을 쓴다. 모든 액션은 서명된 앱 세션에서 행위자를 정하고, 본문 FC ID는 받지 않는다.

| 액션 | 허용 | 입력 | 성공 응답 | 실패 |
|---|---|---|---|---|
| `signOwnDocument` | 서명된 FC 본인 | `storagePath` | `signedUrl`, `expiresInSeconds: 300` | 본인 `fc_documents.storage_path`나 본인 `hanwha_commission_pdf_path`가 아니면 404 `Document not found` |
| `signFcDocument` | 활성 관리자·본부장(조회 전용 포함) | `storagePath` | 같음 | 어떤 `fc_documents` 행이나 `hanwha_commission_pdf_path`도 가리키지 않으면 404 |
| `prepareOwnDocumentUpload` | 서명된 FC 본인 | `docType` | `upload: { path: "<fcId>/<uuid>.pdf", token, signedUrl }` | 요청 행 없음 404, 승인된 서류 409 |
| `submitOwnDocument` | 서명된 FC 본인 | `docType`, `storagePath`, `fileName` | `document`(제출 행), `profile: { id, status: "docs-pending" }` | 경로가 `<fcId>/<이름>`이 아니면 403, 객체 없음 409, 요청 행 없음 404, 승인된 서류 409 |

- 서명은 service role로 300초 URL을 만든다. 경로는 DB 행의 저장값과 정확히 같아야 하며, 묘비 값 `deleted`는 서명하지 않는다.
- `submitOwnDocument`는 service role로 Storage 객체를 확인한 뒤 앱이 쓰던 것과 같은 `fc_documents` upsert(`fc_id,doc_type`, `status='pending'`, `reviewer_note=null`)와 `fc_profiles.status='docs-pending'`을 쓰고 두 receipt를 확인한다. 같은 요청을 다시 보내면 같은 값을 다시 쓰므로 결과가 같다. 두 쓰기는 한 트랜잭션이 아니다. 두 번째가 실패하면 오류를 돌려주고, 재시도가 둘 다 다시 쓴다.
- 이전 앱은 anon으로 `fc_profiles`를 바꾸려 했고 RLS가 0행으로 끝내 업로드마다 오류가 뜨고 관리자 알림이 빠졌다. 이 상태 변경은 이제 서버가 한다.
- 관리자·본부장은 FC 전용 업로드 액션을 쓸 수 없다(403). 앱의 직원 업로드(서류 화면에서 다른 FC 대신 올리기)는 아직 anon 업로드와 `fc_documents` upsert를 쓰고 프로필 상태는 바꾸지 않는다. 4단계에서 anon 쓰기를 막기 전에 직원용 서버 경로가 필요하다.

## 2026-10-15 탈퇴 정리 운영 확인 축소

가람링크 직접 가입 일반 FC는 탈퇴 때 서명된 번호로 자동 연결·정리되므로 운영자 연결 확인이 필요 없다. 같은 번호 계정이 여러 개이거나 본부장·설계사·동기화된 계정이면 여전히 `affiliate_identity_unbound`로 보류되며, 운영자는 대상 계정을 확인한 뒤 `request_board_private.fc_account_bindings`에 해당 FC UUID 연결 1건을 넣어 재시도로 완료한다.

## 2026-10-11 공통 제휴 운영 API (로컬)

`platform-service`는 공통 가입/로그인·회원 관심 등록/조회/취소/탈퇴·공개 광고 병원 목록과 관리자 제휴/정산/지급 기록을 제공한다. 일반 회원 토큰 목적은 FC API에서 거부한다. 관리자 읽기/쓰기는 현재 DB의 활성 일반 관리자만 허용한다. `get_admin`의 최신 목록은 정산 증빙 입력·기록 관리용이며 은행 이체 API가 아니다. 정산·지급은 실제 거래/정산/이체 식별 번호와 완료 시각을 확인한다.

기존 비밀번호 해시와 가입 SMS 구현을 `_shared/password-hash.ts`, `_shared/signup-sms.ts`로 옮겨 종전 FC 함수와 새 공통 회원 함수가 재사용한다. 알고리즘과 SMS 전송 계약을 새로 만들지 않았다. 상세 요청·중복/실패/권한 경계는 [공통 서비스 계약](../mobile/platform-services.md)를 따른다. 신규 migration/Edge는 운영에 적용하지 않았다.

## 2026-10-10 요청 origin 처리

admin-action·fc-consent·fc-submit-appointment·fc-submit-hanwha-commission은 공통 serveWithConfiguredCors로 등록된 요청 origin을 정확히 반환한다. 기존 signed actor·본문 토큰·RPC 권한·mutation 처리와 응답 상태는 유지한다. localhost 추가는 별도 승인된 ALLOWED_ORIGINS 설정이 필요하다. 로컬 코드와 회귀 검증이며 운영 반영을 뜻하지 않는다. [공통 CORS 계약](./notifications-inbox-push.md#web-edge-cors-boundary-2026-10-10).

## 2026-10-07 FC 시험 본인 취소 마감 경계

- **2026-10-08 서버 반영·검증 및 모바일 빌드·스토어 심사 제출 완료, 새 앱 공개 대기.** 운영 migration `20261008060419_exam_self_cancellation_deadline.sql` 및 `exam-payment-proof` v15 `ACTIVE`, `verify_jwt = true`를 확인했고 배포 파일 9개가 소스와 모두 일치했다. 한국시간 15:05:15~15:07:45의 요청 3건은 HTTP 200 1건·401 2건·5xx 0건이며 신규 advisor 지적은 0건이다. 모바일 4.2.17의 Android 92·iOS 108은 원본 검증과 스토어 전달을 마쳤고 각각 `IN_REVIEW`·`WAITING_FOR_REVIEW`이며, 양 플랫폼 공개 버전은 아직 4.2.16이다. 새 앱 공개·실기기 확인은 대기 상태다. [마감 정책과 상태별 허용 표](../mobile/exam-flows.md#2026-10-07-마감-후-본인-취소-제한-정책) 및 [관리자 운영 절차·회차 변경 한계](../admin-web/exam-and-referral-ops.md#2026-10-07-마감-후-취소변경-운영-계약)를 함께 따른다.
- `exam-payment-proof:cancel`은 signed app session에서 FC 행위자를 확정하고 `transition_exam_registration(..., cancel_by_fc, ...)`를 호출한다. DB 전이에서 신청 소유권과 기존 상태 조건을 확인하며, 연결 회차의 `registration_deadline`을 `Asia/Seoul` 기준으로 검사한다. 마감일 당일은 포함하고 다음 날 00:00부터 거부하며, 회차·마감일 누락 또는 오류도 허용하지 않는다.
- 마감 거부는 신청 상태·입금 증빙·decision event를 바꾸기 전에 발생해야 한다. `supabase/functions/_shared/exam-cancellation-error.ts`는 RPC의 `P0001`/`exam_cancellation_deadline_passed` 오류만 HTTP 409 및 `마감된 시험입니다. 취소·변경은 관리자에게 문의해 주세요` 안내로 전달한다. 다른 DB 진단을 사용자에게 그대로 노출하거나 요청 body의 시각으로 판정하지 않는다. 클라이언트 버튼을 숨기는 것만으로 이 서버 계약을 대체하지 않는다.
- 마감 전 접수 완료 신청의 본인 취소 금지, signed actor와 신청 소유권 검증, service-role-only RPC 실행권, 관리자 `cancel_by_admin` 전이·이력 보존을 유지한다. `unconfirm` 후에도 마감일 제한을 재검사한다. 계정 삭제의 별도 신원 분리 경로를 `cancel_by_fc` 제한으로 차단하지 않는다.
- 배포 순서는 취소 전이의 additive migration 및 ACL/회귀 확인 → 해당 오류를 안내하는 Edge Function → 모바일 안내와 실행 전 재검사다. 구 앱도 서버 제한을 받지만 새 안내가 표시되는지는 설치된 앱·Edge 버전으로 구분한다. 로컬 검사만으로 운영 DB 적용이나 실제 앱 반영을 확정하지 않는다.

## 2026-10-04 Personal staff chat identity

- Admin, developer and manager chat display IDs use the sanitized signed account phone, matching the mobile and Edge actor contract. The former ordinary-admin display sentinel does not identify a personal canonical thread.
- `/api/admin/chat-list` verifies an active signed account, maps only that account's role/UUID to canonical threads, and reads attachment counts through committed delivery batches. Its actual runtime fixture enforces production columns and rejects foreign/shared thread mappings.

## 2026-10-04 Password-change session freshness (production)

- Production activation completed2026-10-04 as migration `20261004143855`, after compatible issuers/verifiers and both web surfaces. Local/live numbered histories match87 entries and all three credential-generation triggers are enabled. Existing signed admin reads and the user's actual FC-to-GaramLink bridge passed afterward. New native4.2.15 releases remain in store review, while current installed runtimes remain compatible.

- `admin-action` and the shared board actor gate validate the signed session's account UUID and credential generation before using its authority. Password hash or salt changes increment only that account's generation; old tokens cannot refresh into the current generation.
- Inactive, deleted or replaced accounts and stale generations require login. A database or network failure during freshness verification returns HTTP503 and must remain retryable instead of being treated as a successful empty result or a global logout.
- Rollout order is additive generation schema/RPC, all issuing and enforcing Edge/web/bridge paths, then the separate trigger-activation migration. Source-only validation does not establish production coverage.

## 2026-08-10 FC self-service basic-information boundary

- `admin-action:getOwnProfile`과 `updateOwnProfile`은 이름과 달리 관리자 권한을 공유하지 않는 서명된 FC 본인 전용 액션이다. 요청 body의 대상 ID는 받지 않고 앱 세션의 `fcId`를 사용하며, legacy 토큰에 `fcId`가 없을 때만 세션 전화번호가 정확히 한 프로필로 해석되는 경우에 한해 보정한다.
- 조회와 수정은 서버가 확정한 FC ID와 세션 전화번호 후보를 동시에 조건으로 사용한다. 세션 역할이 FC가 아니거나 대상이 모호·불일치하면 실패한다.
- 수정 payload는 `patch`만 받고 `name`, `affiliation`, `email`, `carrier` 외 필드를 거부한다. 전화번호, 추천인, 신원정보, 가입 완료, workflow/status 필드는 본인 기본정보 액션의 쓰기 권한이 아니다.
- FC 앱은 이 경로로 기존 값을 먼저 hydrate하고 변경 필드만 저장한다. 익명 Supabase 클라이언트의 직접 `fc_profiles` update/insert는 기본정보 수정 계약이 아니다.

## 2026-08-04 Exam round v2 writer and legacy mobile boundary

- `admin-action:upsertExamRound` validates exact YMD values, canonical month-start `exam_month`, and exact-date/month consistency before calling only `save_exam_round_atomic_v2`.
- New TBD requests must send an explicit month. A legacy caller that omits `exam_month` may derive it only from an exact date; if `roundId` identifies an existing `exam_date = null` round, the Edge Function rejects the request before RPC invocation so an old mobile fallback cannot finalize the round as today's date.
- The database migration and exact v2 signature/ACL must be verified before this Edge version is activated. Missing v2 capability is a rollout stop condition and must not be bypassed with split writes or the legacy RPC.
- The SQL writer stays `SECURITY INVOKER`, revoked from `PUBLIC`, `anon`, and `authenticated`, with `service_role` execution only. The signed administrator/developer caller gate remains separate from the database execution role.

## 2026-07-30 Resident-number list state contract

- `/api/admin/resident-numbers` resolves each requested FC as `value`,
  `missing`, or `unavailable`. An absent encrypted value is `missing`; a
  permission, runtime, or decrypt failure is `unavailable`.
- Administrator lists render `missing` as `미입력` and `unavailable` as
  `조회 불가`. They must not describe a missing value as a system failure or a
  failed read as user non-entry.
- Direct decrypt and the `admin-action` fallback use the same row contract.
  Masked or partial values are never accepted as successful full-value reads.

## 2026-07-29 Atomic deletion and privileged identity boundary

- `admin-action:deleteFc`, `/api/fc-delete`, and the public account-deletion
  Edge path converge on the transactional account-deletion RPC. Relational
  deletion commits atomically; Storage and Auth cleanup is recorded through
  the durable cleanup outbox and retried independently.
- The caller role and actor identity are derived from the signed current
  session and re-resolved against an active account. Request-body role,
  telephone, sender, or staff-type hints are never authorization evidence.
- `/api/admin/resident-numbers` remains a signed admin/manager trusted read.
  It normalizes raw, digits-only, and hyphenated account phones consistently
  before resolving the active caller, and never falls back to an anonymous
  privileged table read.
- Exam registration mutations use the atomic transition RPC. Reject and
  administrative cancellation preserve their audit state, and any linked
  notification is validated against its persisted typed recipient target
  before push delivery.

## 2026-07-24 서류 승인·반려 알림 응답 계약

- `/api/admin/fc`의 `updateDocStatus`는 승인과 반려 모두 FC 알림함에 한 건을 먼저 저장한다. 일부 서류 승인도 생략하지 않으며, 전체 승인일 때만 다음 단계 링크를 사용한다.
- 관리자 요청은 알림함 저장 결과까지만 기다리고 Expo·웹 푸시 전달은 Next.js `after()`에서 이어서 처리한다. 따라서 외부 푸시 지연이 서류 승인·반려 응답 시간을 막지 않는다.
- 응답 이후 전달이 실패해도 이미 저장된 알림함 레코드는 유지되며, 공급자 전달 경로는 알림함 레코드를 중복 삽입하지 않는다.

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
- `/api/admin/fc`가 임시사번 발급 후 알림을 보낼 때도 현재 FC profile phone을 숫자-only 값으로 정규화·검증한 뒤 그 canonical 값만 server push service에 넘깁니다. 형식이 포함된 원본 값을 검증 후 다시 전달하면 안 됩니다.
- inbox 저장과 `fc-notify` push는 같은 `admin-action.sendNotification` 요청 안에서 처리합니다. `fc-notify` 호출은 service-role trusted boundary에서만 수행하며 10초로 제한합니다.
- primary workflow mutation은 알림 실패 때문에 되돌리지 않습니다. 알림 대상 조회, inbox 저장, downstream push 중 하나라도 확인되지 않으면 `notification_delivery_incomplete` 같은 고정 진단 코드를 반환할 수 있지만, 앱은 이를 사용자 경고로 표시하지 않고 안전한 개발 로그로만 남깁니다.
- 응답과 진단 로그에는 canonical phone, token, provider 원문, raw DB 오류를 포함하지 않습니다.

## 2026-10-09 Prepared transactional document and exam operations

`updateDocReqs`, `deleteDocFile` and FC-only `removeOwnDocument` call service-only invoker RPCs that lock canonical rows, revalidate the current actor and preserve the existing workflow reset/protection rules. They validate committed receipts before success; physical file deletion drains at most20 queued objects after commit. `getDocumentCleanupStatus`/`retryDocumentCleanup` are signed admin actions; FC-only own variants derive the target from signed scope and call `assert_ux_mutation_actor_v1` before queue access. Only a valid nonnegative count confirms cleanup status. `deleteExamRound` uses one transactional RPC and protects any registration. Migration `20261009065353` was applied to the FC operational DB on2026-10-09; catalog/ACL and18 read-only rollback denial checks passed. Edge activation and real Storage cleanup remain separate acceptance gates.

## 2026-10-13 FC self-service actor boundary

- `fc-consent`, `fc-submit-appointment`, and `fc-submit-hanwha-commission` are signed FC self-service endpoints, not anonymous phone-based admin operations.
- Each endpoint resolves a current FC session, verifies the submitted selector against that actor, and scopes the mutation by both profile id and phone where the table contract supports both.
- Foreign selectors, inactive sessions, malformed dates, and future consent dates are rejected before mutation. Service-role access inside the function does not relax this actor check.

## 2026-10-16 Admin audit records (local)

- `POST /api/admin/fc` records committed changing actions (`updateProfile`, `updateStatus`, document, appointment, Dawichok and reminder actions) in `admin_audit_events` after a successful response. Reads, signed URLs and upload-URL issuance are not recorded. A failed history write is logged and does not undo the committed change. Document and appointment server actions record their decisions the same way.
- `POST /api/admin/resident-numbers` records the FCs whose numbers are returned and returns 503 without numbers when the record cannot be stored.
- `GET /api/admin/audit?month=YYYY-MM` (admin only) lists these records with admin exam-reception decisions for `/dashboard/audit`. Direct `admin-action` Edge calls are not covered. See `admin-audit-log.md`.
