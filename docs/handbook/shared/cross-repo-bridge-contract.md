doc_id: SHARED-BRIDGE-CONTRACT
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer, operator
last_verified: 2026-10-16
source_of_truth: supabase/functions/_shared/request-board-auth.ts + supabase/functions/_shared/request-board-password-sync.ts + supabase/functions/sync-request-board-session/index.ts + supabase/functions/refresh-app-session/index.ts + request_board/server/src/routes/auth.ts + request_board/supabase/migrations/20261013030000_add_password_sync_v2_idempotency.sql + lib/request-board-api.ts + supabase/functions/messenger-garamlink-sync/index.ts + request_board/server/src/routes/messengerExport.ts

# Cross-Repo Bridge Contract

## 2026-10-16 Messenger export pull (unified messenger stage 1)

fc-onboarding-app's `messenger-garamlink-sync` Edge function pulls GaramLink chats from `GET /api/messenger-export` on request_board.
- The call sends `Authorization: Bearer <token>`.
- Secrets that must match:
  - fc-onboarding `REQUEST_BOARD_MESSENGER_EXPORT_TOKEN` and request_board `FC_ONBOARDING_MESSENGER_EXPORT_TOKEN`.
  - fc-onboarding also needs `REQUEST_BOARD_MESSENGER_EXPORT_URL`.
  - If either side is unset, the pull stops: GaramLink returns 503, and the Edge returns `not_configured`.
- The export is read-only. It merges request chats and direct chats in `(createdAt, source, id)` order and pages by that cursor.
- It leaves out deleted messages and messages younger than 60 seconds.
- Each batch has the shape `messenger_import_request_board_v1` expects. Request messages carry `requestId`. A sender outside the request pair gets `peerUserId: null` and is recorded as `participant_missing`.

## 2026-10-15 Withdrawal retirement assertion phone

`request_board_account_retirement` may carry an optional `phone` (11 digits, `^01[0-9]{9}$`) signed by the FC Edge from the withdrawing FC profile. GaramLink rejects a malformed value and treats a missing value as before. With a phone and no `fc_account_bindings` row, `request_board_retire_fc_account(text,uuid,text)` binds and retires only a single active plain FC (`role`/`source_role` fc, not a designer, no binding or v2 generation) on that phone, returns `no_account` when the phone has no GaramLink user, and otherwise stays `unbound` for operator review. The route answers `no_account` as `status: no_affiliate_account` with `accountErased: false`; the FC Edge accepts it as complete only for an assertion that carried the phone.

## 2026-10-13 generation-idempotent password sync v2

- 가람in의 FC credential이 기준입니다. `set-password`, `complete-assisted-password`, `reset-password`, 정상 FC `login-with-password`는 `fc:<fc_profiles.id>`와 비밀번호 hash/salt 변경 때 단조 증가하는 `fc_credentials.session_version`을 v2 세대로 보냅니다.
- `/api/auth/sync-password-v2`는 전화번호·role·upstream account·credential generation·operation UUID가 모두 같은 짧은 HMAC assertion에 묶여야 합니다. v1 assertion은 v2 route에서 사용할 수 없고 v2 assertion도 v1 route에서 사용할 수 없습니다.
- Request Board는 user/designer/generation ledger 변경을 한 RPC transaction에서 수행합니다. 같은 세대의 반복 요청은 `alreadyApplied`이며 비밀번호 hash나 token을 다시 바꾸지 않습니다. 더 낮은 세대는 `SYNC_GENERATION_STALE`로 거절합니다.
- v2로 관리되기 시작한 principal은 v1 route나 bridge bootstrap으로 password/company ownership을 바꿀 수 없습니다. `SYNC_V2_REQUIRED`를 우회하려고 trigger를 끄거나 v1 write를 직접 실행하지 않습니다.
- 가람in은 Request Board sync 실패 때문에 이미 완료된 canonical 비밀번호 변경을 되돌리지 않습니다. 다음 정상 FC 로그인에서 사용자가 방금 증명한 비밀번호와 같은 credential generation을 다시 보냅니다. 비밀번호와 동등한 재시도 payload를 DB·queue·로그에 저장하지 않습니다.
- `REQUEST_BOARD_PASSWORD_SYNC_V2_REQUIRED=true`를 채택한 환경은 v1 fallback으로 되돌리지 않습니다. rollback은 Request Board v2 receiver를 정상화하거나 새 additive forward correction을 배포하는 방식으로 합니다.

### v2 복구 판정

| 결과 | 의미 | 복구 |
| --- | --- | --- |
| 2xx `alreadyApplied=true` | 이전 요청은 이미 적용됐고 응답만 유실됐을 수 있음 | 성공으로 종료 |
| 409 `SYNC_GENERATION_STALE` | Request Board에 더 최신 세대가 있음 | 이전 비밀번호를 재전송하지 않고 다음 정상 로그인에서 현재 세대를 확인 |
| 409 `SYNC_PRINCIPAL_CONFLICT` | 같은 전화번호/계정이 다른 upstream principal에 결합됨 | 자동 병합 금지, 두 저장소 owner가 수동 identity mapping 검토 |
| 409 `SYNC_OPERATION_CONFLICT` | operation UUID가 다른 세대에 사용됨 | 보안·idempotency 이상으로 HOLD, 원인 확인 후 새 정상 로그인으로만 재시도 |
| 401/409 `SYNC_V2_REQUIRED` | assertion/secret/route가 어긋났거나 v1 sender가 v2-managed row를 변경하려 함 | paired secret·v2 URL·배포 commit을 복구하고 다음 로그인으로 재시도 |
| 5xx/timeout/network | 적용 여부 불명확 또는 receiver 장애 | 즉시 v1 fallback 금지, receiver 상태 확인 후 다음 정상 FC 로그인으로 같은 세대 재시도 |

진단에는 phone, password/hash, assertion, operation UUID, upstream account ID, raw 응답 body를 남기지 않습니다.

## 2026-10-02 Bridge freshness (prepared)

- GaramLink verifies the signed bridge role locally, then calls GaramIn `verify-request-board-session` before DB/JWT creation. That Edge function validates the canonical credential generation and returns only ok/role; missing configuration or service failure stays HTTP503 and must not erase a newer client session.
- GaramIn app-to-bridge and bridge-to-app conversion preserve the verified generation. A stale bridge must never mint a new current app token or a new GaramLink JWT.
- GaramLink JWTs already issued before a password change are a separate authorization boundary. Checking a bridge only during exchange does not instantly revoke those existing JWTs; do not claim it does.
- The new verifier and its required function URL/gateway credentials must be ready before deploying the GaramLink caller. Additive generation schema precedes issuers; trigger activation comes last.


## 2026-10-10 Mobile bridge read recovery

- Request Board `403 + SESSION_INVALID` denotes an invalid or expired signed JWT and follows the existing one-time bridge recovery. Ordinary403 authorization failures retain their code and never trigger a new identity or permission change.
- A failed recovery caused by a timeout, network error or service503 preserves stored auth and exposes a retryable read failure. A genuine invalid app session remains a relogin boundary. HTTP response status/body classification must survive the SDK FunctionsHttpError wrapper.
- Auth persistence is owned by the session that started the operation. Old refresh, bridge login and auth-check responses cannot overwrite a newer login or restore auth after logout. Late failures cannot delete a newer session. The same boundary applies to direct-upload/attachment request recovery; this does not add mutation retries.
- Initial bridge exchange also preserves ordinary403 permission failures without refreshing the app session. Structured403/503 errors take precedence over message-based session wording. Auth checks capture the current app/auth owner before reading stored tokens, including replacements that reuse the same Request Board JWT.
- `sync-request-board-session` keeps role-specific account queries and restrictions explicit, then shares token issuance and response handling. The verified session generation, manager source role, developer FC mapping and linked-designer affiliation mapping are preserved.
- Regression evidence: `lib/__tests__/request-board-strict-reads.test.ts`, request-board API contract tests, and local mock scenarios. This repair is separate from the browser Edge origin mismatch and does not claim a remote authenticated smoke test.

## 2026-07-03 API And Messenger Contract Notes

- `lib/request-board-api.ts` must remain the GaramIn bridge boundary for GaramLink requests, messages, direct messages, attachments, and delete actions.
- Bridge API changes must keep request-board session retry/error classification, trusted `ssnView=full` reads, and messenger interaction parity aligned with request_board server routes.
- Contract evidence is tracked through `lib/__tests__/request-board-api-contract.test.ts`, `lib/__tests__/request-board-session.test.ts`, `lib/__tests__/feature-contract-matrix.test.ts`, and the request_board feature-contract tests.

### Response-bound notification timeout budget

- The mobile bridge keeps an eight-second default for ordinary calls.
- A server route that waits for notification fanout before responding must declare a caller-specific timeout budget. `POST /api/requests` uses 30 seconds because it settles bounded new-request channels before returning.
- Create writes are not automatically retried after timeout because the server may already have committed the primary record.

### Mobile request-list summary contract

- GaramIn request lists use `ssnView=masked&includeAttachments=false`; list rows still include designer decision metadata such as `rejection_reason` but omit request attachments and their signed-URL work.
- The request_board server keeps `includeAttachments=true` as the compatibility default so existing GaramLink web screens retain their previous response shape.
- Request detail remains the explicit full-detail path. Optional detail enrichment must not block the mobile list's first render.

## 2026-07-08 Designer Account Parity

- A request_board-linked designer account is a cross-system identity, not a request_board-only row.
- Completion requires all of these to be true:
  - request_board has `users.role='designer'` for the phone.
  - request_board has an active `designers` row for the same user and company.
  - GaramIn/fc-onboarding-app has `fc_profiles.phone=<digits>`, `signup_completed=true`, `phone_verified=true`, and `affiliation='<company> 설계매니저'`.
  - GaramIn/fc-onboarding-app has `fc_credentials.password_set_at` for that `fc_profiles.id`.
- Never consider a designer bootstrap complete until request_board `npm run ops:check-designer-parity -- --phone <phone> --company <company>` passes against the production request_board and GaramIn Supabase projects.
- The affiliation marker `설계매니저` is part of the login/bridge contract. `login-with-password` derives request_board `designer` mode from that marker, and `supabase/functions/_shared/__tests__/request-board-auth.test.ts` guards the parser.

## 핵심 흐름

1. `login-with-password`가 app session token과 `requestBoardBridgeToken`을 발급합니다.
2. 가람in 클라이언트는 필요 시 `bridge-login`으로 request_board JWT/session을 교환합니다. 가람Link 브라우저는 현재 직접 로그인 경로를 사용합니다.
3. request_board auth가 사라지면 `sync-request-board-session`으로 재발급/복구를 시도합니다.
4. referral self-service `appSessionToken`이 없거나 만료되면 가람in 클라이언트는 같은 stored `requestBoardBridgeToken`으로 `refresh-app-session`을 1회 호출해 referral 전용 세션을 복구합니다.
5. 비밀번호 변경은 가람in이 canonical entrypoint이고 request_board bcrypt sync는 후행 동작입니다.
6. 가람in에서 request_board 데이터를 임베드 조회할 때는 `ssnView=full` trusted path를 사용해 GaramLink와 같은 full 주민번호 표시 계약을 유지합니다.

## role mapping

| app identity | Request Board signed/source role | persisted/runtime contract |
| --- | --- | --- |
| `fc` | `fc` | writable runtime `fc`; password-sync establishes `direct/fc` |
| `manager` | `manager` | persisted/runtime `fc`, `sourceRole=manager`, `authSource=bridge`, read-only |
| `developer` | Request Board bridge/password-sync role `fc`; GaramIn app-session identity remains `admin/developer` | writable runtime `fc`; not a manager session |
| linked designer | `designer` | writable runtime `designer` |
| plain `admin` | `admin` | direct Request Board actor 대상 아님 |

- signed source role, request_board 표시/runtime role, direct-login eligibility를 같은 의미로 사용하지 않는다. 특히 manager는 runtime `fc`여도 source role이 `manager`이고 직접 로그인할 수 없다.
- bridge role이 `fc`로 보여도 phone이 `admin_accounts`에 속한 developer/plain admin은 `refresh-app-session` 대상이 아니다. referral self-service 세션 발급은 completed FC 또는 active manager만 허용한다.

## 운영 실패 패턴

- 한쪽 secret만 회전해서 bridge-login 실패
- phone normalization 차이로 password sync 누락
- affiliation 누락으로 FC/designer label 비정상
- request_board JWT 만료 후 재발급 루프
- unread/badge는 한쪽만 줄고 다른 쪽은 남는 현상

## 먼저 볼 항목

- `REQUEST_BOARD_AUTH_BRIDGE_SECRET` / `FC_ONBOARDING_AUTH_BRIDGE_SECRET`
- `REQUEST_BOARD_PASSWORD_SYNC_TOKEN` / `FC_ONBOARDING_PASSWORD_SYNC_TOKEN`
- 양쪽 `REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET`
- `requestBoardRole`
- `users.affiliation` / app affiliation source

## 2026-05-30 characterization 메모

- `supabase/functions/_shared/request-board-password-sync.ts`의 outbound body builder는 `buildRequestBoardPasswordSyncBody`로 직접 characterization한다.
- body builder는 `phone`, `password`, `role`을 항상 보내고, truthy `name`/`companyName`/`initiatorRole`/`syncReason`만 추가한다.
- `affiliation`은 `fc`와 `manager` role에서만 포함한다. linked designer mirror는 `companyName`을 보내고 `affiliation`은 request_board direct designer payload에서 제외한다.
- 이 helper는 값 trim/normalization을 하지 않는다. caller가 정한 phone/password/name/company/affiliation 값을 그대로 request_board sync body로 전달하는 것이 현재 계약이다.
- 관리자 웹 session restore는 signed cookie를 사용한다. 과거 localStorage snapshot은 복원하지 않고 정리한다.

## 2026-06-03 관리자 세션 헬퍼 메모

- `web/src/lib/server-session.ts`는 admin-only mutation 경로와 manager 포함 read-only 경로를 분리하기 위해 `getVerifiedAdminSession()`과 `getVerifiedReadOnlyAdminSession()` wrapper를 제공한다.
- 본부장/manager read-only 경로는 주민번호 full-view 같은 trusted read를 허용할 수 있지만, 쓰기 API는 계속 admin-only helper를 사용해야 한다.

## 관련 문서

- [security-and-secret-operations.md](./security-and-secret-operations.md)
- [request_board operations runbook](../../../../request_board/docs/handbook/operations-runbook.md)
