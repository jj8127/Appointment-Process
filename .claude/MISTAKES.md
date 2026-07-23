# 실수 기록 (Mistakes Only)

> 반복될 수 있는 실수, 회귀, 드리프트만 기록합니다.  
> 기능 완료 보고, 일반 변경 내역, TODO는 여기에 쓰지 않습니다.

## 기록 규칙

- 아래 경우에만 기록합니다.
  - 이미 고쳤다고 생각했던 동작이 다시 깨진 경우
  - 화면/route/function 사이 계약이 서로 달라져 사용자-visible 문제가 생긴 경우
  - 중복 구현 때문에 한 곳만 고치고 다른 곳이 다시 틀어진 경우
  - 검증 누락 때문에 같은 종류의 버그가 반복될 수 있는 경우
- 아래 내용은 기록하지 않습니다.
  - 신규 기능 추가
  - 단순 스타일 수정
  - 계획된 리팩터링 메모
  - 일반 작업 회고
- 버그 수정 세션이 위 조건에 해당하면 `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`와 별도로 이 파일도 같은 change set에서 갱신합니다.
- 항목은 최신순으로 맨 위에 추가합니다.

## 항목 형식

```md
## YYYY-MM-DD | Scope | Mistake
- Symptom:
- Root cause:
- Why it was missed:
- Permanent guardrail:
- Related files:
- Verification:
```

## 2026-07-16 | Diagnostic privacy | final Sentry sanitization did not protect earlier console sinks
- Symptom:
  - Shared mobile/web loggers serialized raw messages, payloads, and `Error` stacks to `console.*` before Sentry's final sanitizer ran.
  - Direct push, signup OTP, and group-chat diagnostics could print identifiers, provider errors/bodies, push tokens, or test OTP data. The admin-web server push consumer also logged recipient/content/token data and returned raw provider failure text.
- Root cause:
  - Privacy filtering existed at Sentry `beforeSend`, but not at the first shared logger sink, direct-console callsites had no reviewed safe-field contract, and no real-consumer test traced provider response text through the shared logger.
  - TypeScript unions and callsite casts were treated as sufficient even though runtime input can bypass types; the sink itself did not reconstruct a closed record field by field.
- Why it was missed:
  - Sanitizer tests exercised Sentry-shaped objects only; they did not assert console output, the Sentry-adjacent capture arguments, `Error.name`, natural-language phone/OTP/filename/object-path variants, raw `Error` reconstruction, or the actual admin-web provider consumer.
- Permanent guardrail:
  - Sanitize the message, structured data, and `Error` name/message/stack before formatting or calling either console or Sentry-adjacent capture hooks.
  - Sensitive provider/OTP/push callsites log only fixed reason/status fields. Never log a destination identifier, OTP, token, raw provider body, filename, or storage path, including in test mode.
  - Keep runtime negative tests and positive controls for mobile/web sanitizers and logger classification, plus a narrow source contract for the explicitly reviewed direct-console paths. Do not replace this with a broad unrelated console rewrite.
  - The first narrow source lock did not inventory sibling Edge/web console sinks. Investigation snapshots must not fossilize unproven sinks: close or explicitly reclassify them, then keep the reviewed 14-file AST allowlist exact at 9 fixed single-literal diagnostics, 0 unproven, 9 total. Only those exact literals are approved; all variable/error paths use the closed shared helper or sanitized logger.
- Related files:
  - `lib/logger.ts`, `web/src/lib/logger.ts`
  - `lib/sentry-sanitize.ts`, `web/src/lib/sentry-sanitize.ts`
  - `app/api/push+api.ts`, `lib/notifications.ts`
  - `web/src/lib/push-notification-service.ts`
  - `supabase/functions/request-signup-otp/index.ts`, `supabase/functions/group-chat/index.ts`
  - `supabase/functions/_shared/edge-diagnostic.ts`, `scripts/ci/edge-diagnostic-console-baseline.json`
  - `lib/__tests__/logger.test.ts`, `lib/__tests__/sentry-sanitize.test.ts`, `lib/__tests__/diagnostic-privacy-source.test.ts`, `lib/__tests__/priority-security-hardening.test.ts`, `web/src/lib/sentry-sanitize.test.ts`
  - `lib/__tests__/diagnostic-console-governance.test.ts`, `supabase/functions/_shared/__tests__/edge-diagnostic_test.ts`
- Verification:
  - Pre-fix falsification failed on every new sensitive class and reviewed direct-console source boundary; the same tests pass after the fix.
  - Root/web TypeScript, targeted ESLint, focused Jest/Node suites, and both changed Edge Function Deno checks pass without remote calls or Sentry uploads.
  - The first follow-up closed 15 proven sensitive sinks and added runtime poison checks. The second closes all 27 residual unproven sinks, extends the closed event/reason pairs and poison/source tests, removes the request-mode log, and freezes the final exact 9/0/9 reviewed allowlist.

## 2026-07-16 | Clean dependency reproducibility | hoisting and runtime globals hid export requirements
- Symptom:
  - A regular development tree passed focused checks, but a clean Node 20 installation first lacked the Expo Babel preset and then failed static rendering because the runtime did not expose WebSocket by default.
  - Aligning the dependency graph with Expo SDK 54 also exposed a Sentry replay option that was not supported by the SDK-compatible Sentry version.
- Root cause:
  - The build relied on a transitively hoisted preset, a newer-runtime global, and an SDK integration option from a different Sentry compatibility line.
- Why it was missed:
  - Dependency validation used the existing `node_modules` tree and focused tests without a clean install plus export on both the lowest permitted and recommended Node runtimes.
- Permanent guardrail:
  - Declare build-time packages directly, keep Node 24 as the documented runtime, and run `npm ci` before claiming package reproducibility.
  - Do not infer a supported runtime from the root manifest because it has no engine floor. Keep Node 24 as the documented runtime; if Node 20 compatibility is intentionally retained, prove the exact Node 20.19.5/npm 10.8.2 and Node 24 matrix with clean exports rather than a warm tree.
  - Run `npx expo install --check`, the root dependency contract, lint, TypeScript, full tests, audits, and a Sentry-disabled export after package or SDK integration changes.
  - Prefer narrow owner-scoped overrides and typed SDK options; do not repair one advisory with an incompatible graph-wide override.
- Related files:
  - `package.json`
  - `package-lock.json`
  - `lib/sentry.ts`
  - `scripts/ci/root-dependency-security.test.ts`
  - `docs/handbook/developer-onboarding.md`
- Verification:
  - Clean Node 20/npm 10 and Node 24/npm 11 installs and exports pass with the same lock hash; full/production audits report zero advisories.

## 2026-07-15 | Deployment ordering | auth adoption and DB RPC compatibility were collapsed into one caller-first sequence
- Symptom:
  - The first documentation draft placed signed caller adoption, additive RPC migration, and Edge enforcement in one linear “caller-first” rollout, obscuring whether RPC-required callers were safe against the old DB.
- Root cause:
  - Authentication enforcement ordering and DB/API version compatibility were treated as one deployment axis even though `board-update` and admin-web exam schedule activate different RPC callers at different times.
- Why it was missed:
  - Focus stayed on closing the body-actor authentication boundary, so migration-before-caller activation was stated only indirectly.
- Permanent guardrail:
  - Document authentication as signed caller adoption → Edge auth enforcement.
  - Document atomic DB change as old/new-compatible or feature-disabled caller → additive migration verification → per-caller activation → observation/auth smoke → compatibility removal.
  - Name the activation point for `board-update` and admin-web exam schedule separately; never use “caller-first” as shorthand for DB/API version ordering.
- Related files:
  - `AGENTS.md`
  - `docs/deployment/DEPLOYMENT.md`
  - `docs/handbook/operations-runbook.md`
  - `docs/handbook/shared/security-and-secret-operations.md`
- Verification:
  - Documentation boundary, governance normal/handbook/contract, link/path, diff, and sensitive-pattern gates.

## 2026-07-15 | Documentation control surface | AGENTS accumulated delivery history until it exceeded the quick-control boundary
- Symptom:
  - Root `AGENTS.md` exceeded 100 KiB and mixed stable safety rules with old snapshots, roadmap items, and a long progress ledger.
- Root cause:
  - Session-close guidance repeatedly appended status to the control file instead of linking the existing handbook and work-log owners.
- Why it was missed:
  - Governance checked code/document synchronization but had no byte-size boundary for the session entry document.
- Permanent guardrail:
  - Keep root `AGENTS.md` at or below 24,576 UTF-8 bytes and retain only stable control rules, release safety, current major blockers, and context routes.
  - Store current behavior in the handbook and append delivery evidence to `WORK_LOG.md`/`WORK_DETAIL.md`; do not recreate removed history in another new file.
  - Run the 24,576/24,577 boundary tests and integrated governance on every documentation-control change.
- Related files:
  - `AGENTS.md`
  - `docs/handbook/shared/documentation-contract.md`
  - `scripts/ci/documentation-governance.mjs`
  - `scripts/ci/documentation-governance.test.mjs`
  - `scripts/ci/check-governance.mjs`
- Verification:
  - `node scripts/ci/documentation-governance.test.mjs`
  - `node scripts/ci/check-governance.mjs`

## 2026-07-12 | App Session HMAC | bridge secret fallback crossed token trust domains
- Symptom:
  - A token with `kind='fc_onboarding_session'` and admin claims could be signed with the legacy Request Board bridge secret and accepted as an FC app session.
- Root cause:
  - Edge and web app-session signers reused `REQUEST_BOARD_AUTH_BRIDGE_SECRET` as a fallback, and the Edge verifier included the same bridge secret alongside the dedicated app-session keys.
- Why it was missed:
  - Token `kind` checks were tested, but the signer/verifier key domain was not; an attacker who knew the shared bridge secret could choose the app-session kind before signing.
- Permanent guardrail:
  - App sessions mint only with `FC_APP_SESSION_TOKEN_SECRET` and verify only its current/previous pair. Bridge secrets must never appear in an app-session signer or verifier.
  - Rotation installs the new current key and old key as `FC_APP_SESSION_TOKEN_PREVIOUS_SECRET`, then removes the previous key after the maximum token TTL. Missing dedicated current key fails closed and requires login/session repair rather than bridge-secret fallback.
- Related files:
  - `supabase/functions/_shared/request-board-auth.ts`
  - `web/src/lib/request-board-app-session.ts`
  - `lib/__tests__/app-session-secret-boundary.test.ts`
- Verification:
  - Forged bridge-secret admin app-session RED→GREEN test plus current/previous dedicated-key positive controls.

## 2026-07-12 | Sentry Verification Build | clearing the shell token did not override `.env.local`
- Symptom:
  - A local Next production verification build was launched with an empty shell `SENTRY_AUTH_TOKEN` and `SENTRY_DISABLE_UPLOAD=1`, but Next reloaded the ignored `web/.env.local` token and the Sentry plugin uploaded source-map artifact bundles.
- Root cause:
  - `web/next.config.ts` passed `process.env.SENTRY_AUTH_TOKEN` directly to `withSentryConfig` and did not implement the documented `SENTRY_DISABLE_UPLOAD` guard. Clearing an environment variable before Next's dotenv phase was not an authoritative deny control.
- Why it was missed:
  - The operating note assumed an empty parent-shell variable could not be repopulated by framework env loading, and prior checks treated build exit status as sufficient evidence without inspecting Sentry upload lines.
- Permanent guardrail:
  - `SENTRY_DISABLE_UPLOAD=1` must set both `authToken: undefined` and `sourcemaps.disable: true` in the final Next Sentry config, regardless of ignored local env files.
  - Safe local builds set `SENTRY_DISABLE_UPLOAD=1`, clear `SENTRY_AUTH_TOKEN`, and inspect output for artifact/upload/release activity; a successful build with an upload is an operational failure.
  - Verification of the guard must route any unexpected upload attempt to a loopback-only Sentry URL, never to the live service.
- Related files:
  - `web/next.config.ts`
  - `web/src/lib/sentry-build-policy.ts`
  - `web/.env.example`
  - `lib/__tests__/sentry-build-upload-guard.test.ts`
  - `README.md`
- Verification:
  - RED: a Sentry-disabled build still uploaded artifacts because the flag was unused.
  - GREEN: pure policy/source regression plus a loopback-routed production build with no upload attempt.

## 2026-07-12 | Direct Edge Actor Trust | an active phone record was mistaken for proof of possession
- Symptom:
  - Anonymous callers could forge an active admin/manager/FC phone in the request body and make service-role `fc-notify` or any of 17 `board-*` functions read, write, delete, or fan out notifications as that actor.
- Root cause:
  - The handlers used a service-role Supabase client and treated a caller-supplied role/phone plus an active-row lookup as authentication. `board-create` and `board-update` then became confused deputies that called the newly protected `fc-notify` with their own trusted service key.
- Why it was missed:
  - Reviews followed normal app callers and checked CORS, role allowlists, and key custody, but did not prove possession at the public Edge boundary or search sibling service-key callers after hardening the direct notify endpoint.
- Permanent guardrail:
  - All non-public mobile Edge actions require a signed `x-app-session-token`, then rebind token role/phone/fcId to an active database actor before any service-role query. `latest_notice` is the only public `fc-notify` action.
  - Every `board-*` endpoint must call the common request-bound verifier with its exact function name. Body actor fields are compatibility claims only and may never create authority.
  - Web Board calls go through the signed same-origin `/api/board` proxy; mobile Board calls attach the stored app-session token in the common transport.
  - Insurance-digest automation uses an exact `BOARD_AUTOMATION_TOKEN`, an active server-configured admin phone, and only `board-categories-list`, `board-list`, and canonical-general `board-create`. It may never create categories or reach update/delete/attachment actions.
  - Caller Release A must be adopted before the 17-function Edge Release B. There is no safe body-actor fallback for old clients.
- Related files:
  - `supabase/functions/fc-notify/index.ts`
  - `supabase/functions/_shared/fc-notify-auth-policy.ts`
  - `supabase/functions/_shared/board.ts`
  - `supabase/functions/_shared/board-actor-policy.ts`
  - `lib/fc-notify-client.ts`
  - `lib/board-api.ts`
  - `web/src/app/api/board/route.ts`
  - `scripts/ops/post-insurance-digest.mjs`
  - `lib/__tests__/fc-notify-edge-auth-source.test.ts`
  - `lib/__tests__/board-edge-auth-source.test.ts`
- Verification:
  - RED/GREEN pure policy and source contracts, all-function Deno checks, and loopback handler smokes that prove forged requests stop before writes/downstream fanout.

## 2026-07-12 | Board Attachment And Update Integrity | role checks did not prove post ownership or atomicity
- Symptom:
  - A legitimate manager could request upload/finalize operations for another author's post, finalize caller-selected storage paths without proving an object existed, and a bad attachment order could return 400 after post fields had already changed.
- Root cause:
  - Attachment sign/finalize checked only the broad manager role and post existence. Finalize trusted path/size/MIME metadata, while `board-update` mutated the post before validating and separately updating attachment order.
- Why it was missed:
  - Delete/update had local manager ownership checks, but sibling attachment endpoints and the ordering of multi-step writes were not reviewed as one post-write invariant.
- Permanent guardrail:
  - Admin may manage every post; manager may manage only a manager-authored post whose canonical author phone matches the signed actor.
  - Finalize accepts only canonical `board/<postId>/<uuid>_<sanitized-name>` paths, unique unfinalized objects that exist in Storage, and server-verified size/MIME metadata within the shared limits.
  - Post fields and attachment order are applied by the service-role-only `update_board_post_atomic` database function in one transaction. Its migration must precede the updated Edge function.
- Related files:
  - `supabase/functions/board-attachment-sign/index.ts`
  - `supabase/functions/board-attachment-finalize/index.ts`
  - `supabase/functions/board-update/index.ts`
  - `supabase/migrations/20260712000001_atomic_board_post_update.sql`
  - `lib/__tests__/board-edge-auth-policy.test.ts`
- Verification:
  - RED/GREEN ownership/path/atomic-source contracts and Deno checks for all Board functions.

## 2026-07-12 | Privileged Server Actions | same-origin UI access was mistaken for authorization
- Symptom:
  - Exam schedule, appointment, and document Server Actions could reach service-role database writes without a verified signed admin session. A read-only manager could bypass disabled buttons and mutate or delete exam data.
- Root cause:
  - The implementation relied on dashboard routing, disabled UI controls, and in two files an origin check, none of which proves the caller's role inside an exported Server Action.
- Why it was missed:
  - API routes had signed-session helpers, but the same inventory did not include all `'use server'` modules holding `adminSupabase`.
- Permanent guardrail:
  - Every privileged Server Action must verify an active signed session before parsing attacker input or touching `adminSupabase`; read-only actions explicitly use the manager-capable read helper.
  - Runtime input is parsed fail closed, and notification phone/identity is loaded from the database rather than accepted from the client.
  - The priority security source test inventories every server module that imports `adminSupabase`.
- Related files:
  - `web/src/app/dashboard/exam/schedule/actions.ts`
  - `web/src/app/dashboard/appointment/actions.ts`
  - `web/src/app/dashboard/docs/actions.ts`
  - `web/src/lib/privileged-action-input-policy.ts`
  - `lib/__tests__/privileged-server-action-input-policy.test.ts`
- Verification:
  - RED/GREEN auth-order and input-policy tests, full web lint, and a Sentry-loopback production build.

## 2026-07-12 | Exam Apply Commit Boundary | notification failure was shown as registration failure
- Symptom:
  - The exam registration row could be saved successfully, then a failed admin/self notification made the mutation show `신청 실패`, encouraging a duplicate retry.
- Root cause:
  - Post-commit notification delivery was awaited inside the same mutation failure boundary as the database write.
- Why it was missed:
  - Happy-path tests treated database mutation and best-effort notification as one operation and did not inject a delivery failure after commit.
- Permanent guardrail:
  - `sendExamApplyNotificationsBestEffort` settles both deliveries, reports only failed target classes, and never reclassifies a committed application as failed.
  - Source tests forbid sequential `await notifyExamFlow(notificationPayloads.*)` calls in both life and nonlife apply screens.
- Related files:
  - `lib/exam-flow-contract.ts`
  - `app/exam-apply.tsx`
  - `app/exam-apply2.tsx`
  - `lib/__tests__/exam-flow-contract.test.ts`
- Verification:
  - RED missing-helper failure, then GREEN rejection-injection and screen source contracts.

## 2026-07-12 | Exam Round Delete | manual child deletion split one cascade into destructive partial steps
- Symptom:
  - Deleting a round removed registrations first, then locations, then the round. A later failure could return an error after registrations were already lost.
- Root cause:
  - The Server Action manually reproduced foreign-key cascade behavior with three separate service-role statements.
- Why it was missed:
  - Step-by-step logging looked safer than a single delete, but transaction boundaries and the existing `ON DELETE CASCADE` schema were not checked together.
- Permanent guardrail:
  - Round deletion is one `exam_rounds` delete statement; database cascades remove locations and registrations atomically.
  - The source contract forbids direct registration/location deletes in `deleteExamRoundAction` and verifies both cascade constraints in the schema snapshot.
- Related files:
  - `web/src/app/dashboard/exam/schedule/actions.ts`
  - `supabase/schema.sql`
  - `lib/__tests__/priority-security-hardening.test.ts`
- Verification:
  - RED source contract against the three-step delete, then GREEN targeted Jest and web lint.

## 2026-07-12 | FC Notify Proxy Trust Boundary | server-side key custody was mistaken for caller authentication
- Symptom:
  - Public callers could POST arbitrary FC notify actions to `/api/fc-notify`; the route performed privileged web-push/database work and forwarded the raw body to the service-role Edge Function.
- Root cause:
  - The route protected the service-role key from the browser bundle but did not authenticate the caller, separate browser and Request Board ingress, or rebuild an action-specific outbound payload.
  - The first hardened draft also bounded text before redaction, duplicated/delegated notification persistence ambiguously, and compared client-supplied sender display data even though the server already owned the canonical identity.
- Why it was missed:
  - Reviews followed the visible admin-web callers and treated the proxy as browser-only, without inventorying the cross-repository `request_board` server caller or testing the public route as an independent trust boundary.
- Permanent guardrail:
  - Every public privileged proxy must inventory all callers, authenticate each ingress independently, reject unsupported actions before side effects, and serialize only a server-rebuilt allowlisted payload.
  - Browser compatibility tests must feed the exact caller payloads for regular admin, developer, manager, and FC sessions; server-derived display identity must use the same canonical helper as the client contract.
  - Same-origin authorization requires the canonical request origin (scheme + Host); caller-controlled `X-Forwarded-Host` is not a fallback authority. A signed FC token must bind its `fcId` and phone to the same completed profile before authorization.
  - Redact the complete title/body/message before applying notification bounds so truncation cannot turn a detectable secret into an undetectable partial secret.
  - Browser chat callers must omit sender id/name and direct notification inserts; the protected route derives identity and the Edge function remains the single notification-row writer.
  - `lib/__tests__/fc-notify-route-auth.test.ts` must fail if `/api/fc-notify` loses signed-session/origin checks, constant-time bridge-token verification, identity reconstruction, or reintroduces raw-body forwarding.
- Related files:
  - `web/src/app/api/fc-notify/route.ts`
  - `web/src/lib/fc-notify-proxy-policy.ts`
  - `web/src/lib/server-session.ts`
  - `web/src/app/dashboard/chat/page.tsx`
  - `web/src/app/chat/page.tsx`
  - `lib/__tests__/fc-notify-route-auth.test.ts`
  - `lib/__tests__/admin-web-chat-source.test.ts`
- Verification:
  - RED: `npx jest lib/__tests__/fc-notify-route-auth.test.ts --runInBand` failed on the unauthenticated route and raw `JSON.stringify(body)` forwarding.
  - GREEN: `npx jest lib/__tests__/fc-notify-route-auth.test.ts --runInBand`

## 2026-07-12 | Windows Source Contracts | LF-only fixture comparison made the full suite falsely red
- Symptom:
  - The complete Jest suite failed two assertions in one user-owned protected source-contract test even though the expected source was present; the checkout used CRLF while the test embedded LF-only multiline strings.
- Root cause:
  - A source-contract test compared raw file bytes without normalizing line endings first.
- Why it was missed:
  - Focused suites did not collect this unrelated source test, and the existing assertion output looked like a content mismatch until the invisible carriage returns were isolated.
- Permanent guardrail:
  - Source-contract tests that compare multiline text must normalize `\r\n?` to `\n` before assertions, or use whitespace-tolerant behavior/AST checks. Full-suite verification remains required after focused security tests.
- Related files:
  - One user-owned protected source-contract test (identifier withheld).
- Verification:
  - RED: full `npm test -- --runInBand` failed 2/549 assertions on the Windows checkout.
  - GREEN: focused run for one user-owned protected source-contract test and then the complete Jest suite; the identifier is withheld.

## 2026-07-07 | CI Audit Repo Identity | audit tests assumed the local folder name
- Symptom:
  - GitHub Actions CI failed in `shared-ui-action-contracts.test.ts` and `shared-function-contracts.test.ts` because the audit inventory reported `Appointment-Process` instead of `fc-onboarding-app`.
- Root cause:
  - The audit scripts used `path.basename(root)` as the repo identity, so local checkout folder names changed test behavior.
- Why it was missed:
  - Local verification ran in `D:\hanhwa\fc-onboarding-app`, whose folder name matched the expected value, while GitHub checked out the actual repository as `Appointment-Process`.
- Permanent guardrail:
  - Governance/audit scripts must derive repo identity from stable project metadata such as `package.json.name` before falling back to a directory basename.
- Related files:
  - `scripts/audit/shared-ui-contract-audit.cjs`
  - `scripts/audit/shared-function-contract-audit.cjs`
  - `lib/__tests__/shared-ui-action-contracts.test.ts`
  - `lib/__tests__/shared-function-contracts.test.ts`
- Verification:
  - GREEN `npm test -- --runInBand lib/__tests__/shared-ui-action-contracts.test.ts lib/__tests__/shared-function-contracts.test.ts`

## 2026-07-06 | Push Token Trust Boundary | device tokens were reachable from public clients
- Symptom:
  - Mobile code could register/read/fan out push tokens through direct `device_tokens` Supabase table access.
- Root cause:
  - `device_tokens` ownership was enforced by broad RLS/table policies instead of a trusted app-session Edge Function and service-role fanout path.
- Why it was missed:
  - Push token handling was treated as app plumbing, not as an identity-binding and notification-hijack boundary.
- Permanent guardrail:
  - Client code must never call `.from('device_tokens')`; registration/deletion must use `device-token-register`, and fanout must use `fc-notify` or server-only service-role routes.
  - `lib/__tests__/priority-security-hardening.test.ts` must fail if direct client table access returns.
- Related files:
  - `lib/notifications.ts`
  - `app/dashboard.tsx`
  - `supabase/functions/device-token-register/index.ts`
  - `supabase/migrations/20260706131220_harden_device_tokens_trusted_path.sql`
- Verification:
  - `npx jest lib/__tests__/priority-security-hardening.test.ts --runInBand`

## 2026-07-06 | Source Contract Drift | tests asserted old local helper ownership
- Symptom:
  - Full Jest failed after CI wiring because `group-chat-mobile-source` expected local `isStaffGroupChatActor`/`resolveCanSendMessages` functions, while the code had already moved that contract to `lib/group-chat-display.ts`.
  - `exam-license-source-contract` expected a hard-coded exam query key and inline fee-paid-date restore shape, while the code now uses exam flow config and `getExamApplyRestoredSelectionState`.
- Root cause:
  - Source-contract tests were not updated when helper ownership moved from screen-local code into shared modules.
- Why it was missed:
  - Targeted feature tests passed, but the soon-to-be CI `npm test -- --runInBand` gate had not been running automatically.
- Permanent guardrail:
  - Source-contract tests should assert the stable ownership boundary and helper calls, not stale inline implementation details after an accepted refactor.
  - Keep full Jest in CI so stale source contracts fail before deploy.
- Related files:
  - `lib/__tests__/group-chat-mobile-source.test.ts`
  - `lib/__tests__/exam-license-source-contract.test.ts`
  - `lib/group-chat-display.ts`
  - `lib/exam-flow-contract.ts`
- Verification:
  - `npm test -- --runInBand`

## 2026-07-03 | GaramIn Messenger Interaction Contract | bridge messenger drifted from link and long-press UX
- Symptom:
  - In the GaramLink bridge messenger inside GaramIn, HTTP(S) URLs rendered as plain text and long-pressing message bubbles showed no copy/delete action.
  - Internal 1:1 chat had link rendering, but long-press behavior was delete-only for own messages and no visible action for received messages.
- Root cause:
  - `app/request-board-messenger.tsx` rendered message bodies with raw `Text` instead of the shared `LinkifiedSelectableText` pattern used by `app/chat.tsx` and `app/group-chat.tsx`.
  - The bridge messenger did not wire message-bubble `onLongPress` to any action menu or request-board delete endpoints.
- Why it was missed:
  - Link/long-press behavior was verified on board/group/internal chat surfaces, but not treated as a shared contract for every messenger route.
- Permanent guardrail:
  - Any new or changed GaramIn messenger surface must support URL link rendering/opening and a visible long-press action menu.
  - When request-board messages are embedded in GaramIn, include both request and direct-message delete API wrappers before exposing delete actions.
- Related files:
  - `app/chat.tsx`
  - `app/request-board-messenger.tsx`
  - `app/group-chat.tsx`
  - `lib/request-board-api.ts`
- Verification:
  - `npm run lint -- app/chat.tsx app/request-board-messenger.tsx app/group-chat.tsx lib/request-board-api.ts`

## 2026-07-03 | Cross-Surface Contract Drift | shared behavior was treated as screen-local implementation
- Symptom:
  - Messenger link/long-press behavior could be present on one chat surface and absent on another.
- Root cause:
  - Shared business rules were documented by screen area, but not mapped to contract tests that must move with feature-critical source files.
- Why it was missed:
  - Governance checked handbook ownership and work logs, but did not require contract evidence for high-risk shared behaviors.
- Permanent guardrail:
  - Maintain `docs/handbook/feature-contract-matrix.md` and `docs/handbook/contract-test-map.json`.
  - Contract-sensitive file changes must update one mapped contract test or handbook evidence file.
- Related files:
  - `docs/handbook/feature-contract-matrix.md`
  - `docs/handbook/contract-test-map.json`
  - `scripts/ci/check-governance.mjs`
  - `lib/__tests__/feature-contract-matrix.test.ts`
- Verification:
  - Passed: `npm test -- --runInBand lib/__tests__/feature-contract-matrix.test.ts`
  - Passed: `node --check scripts/ci/check-governance.mjs`

## 2026-06-30 | GaramIn Designer Picker Sort | mobile picker drifted from GaramLink company ordering
- Symptom:
  - GaramIn's request-board designer picker used the incoming API order after filtering, so the list could diverge from GaramLink's required `생명 회사 -> 손해 회사`, company 가나다, designer-name order.
- Root cause:
  - The mobile picker had no local sort helper and did not share the GaramLink designer-company grouping contract for `생명/라이프/연금` and `손해/손보/화재/해상`.
- Why it was missed:
  - Existing mobile source contracts checked headquarters badge rendering and selected summaries, but did not assert the picker list ordering.
- Permanent guardrail:
  - Request-board designer picker changes must include a sort contract covering life hints, nonlife hints, company order, and same-company designer names.
  - Mobile UI source-contract tests must assert the picker applies `sortRequestBoardDesigners()` after filtering.
- Related files:
  - `app/request-board-create.tsx`
  - `lib/request-board-designer-selection.ts`
  - `lib/__tests__/request-board-designer-selection.test.ts`
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`
- Verification:
  - `npm test -- --runInBand lib/__tests__/request-board-designer-selection.test.ts`
  - `npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts`

## 2026-06-27 | Admin Web Referral Graph Active Drag | Cluster separation moved unrelated components
- Symptom:
  - During active node dragging, unrelated referral graph components could drift or re-layout even though the user was only manipulating one component.
- Root cause:
  - `createReferralGraphClusterSeparationForce` skipped the actively dragged cluster but still pushed other overlapping clusters while the graph was reheated for dragging.
- Why it was missed:
  - Earlier checks focused on the dragged branch and direct neighbors, but did not require unrelated components to remain visually stable while the pointer was down.
- Permanent guardrail:
  - Cluster/component separation forces must pause entirely while `activeDraggedNodeIdRef.current` is set.
  - Active-drag simulation tests must verify unrelated component drift stays bounded.
- Related files:
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/lib/referral-graph-simulation.test.ts`
- Verification:
  - Passed: `npx tsx --test --test-name-pattern "active dragging does not re-layout unrelated components" web/src/lib/referral-graph-simulation.test.ts`.
  - Passed: `npx tsx --test <all web/src/lib *.test.ts files>`.

## 2026-06-27 | Admin Web Referral Graph Drag Release | Release inertia was too weak to feel physical
- Symptom:
  - After dragging and releasing a referral graph node, the node and connected graph appeared to stop instead of carrying momentum.
- Root cause:
  - Pointer movement was converted to a small per-tick velocity, release velocity was mixed back into the node at a low multiplier, and the max release velocity was capped too tightly.
  - An attempted fix lowered global free-physics velocity decay, which made unrelated components drift during active drag.
- Why it was missed:
  - The source contract asserted that release velocity existed, but did not require a strong enough velocity scale or low enough decay for users to perceive inertia.
- Permanent guardrail:
  - Release must preserve pointer velocity with an explicit release velocity scale and a generous max velocity cap.
  - Do not lower global free-physics velocity decay to create release inertia; it can re-layout unrelated components during active drag.
  - Active-drag drift tests must pass after any inertia tuning.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-interaction.test.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
- Verification:
  - Not run in this change because the user explicitly requested code changes only and will perform manual testing.

## 2026-06-27 | Admin Web Referral Graph Drag Physics | Preserved lower tether behavior instead of upper link behavior
- Symptom:
  - When an intermediate referral graph node was dragged, upper nodes and lower nodes still did not move with the same physical feel.
  - The intended correction was for lower nodes to follow the existing upper-node behavior, but the implementation changed upper nodes toward the lower-node tether behavior.
- Root cause:
  - I treated the mismatch as "apply drag elastic tethers to both sides" instead of preserving the ordinary upstream link-tension model.
  - `ReferralGraphCanvas` still had a separate `drag-elastic-tether` runtime force path, so drag behavior could diverge from the normal graph forces.
- Why it was missed:
  - I focused on symmetry of a custom tether model instead of checking which side's behavior the user asked to preserve.
- Permanent guardrail:
  - `ReferralGraphCanvas` must not use `createReferralGraphDragElasticTetherForce`, `buildElasticDragTethers`, or `elasticDragTethersRef`.
  - Upper and lower connected nodes must be governed by the same ordinary link-tension, charge, and collision forces during drag.
  - Keep `fg.d3Force('drag-elastic-tether', null)` in the canvas unless the product explicitly requests a separate custom tether model again.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-interaction.test.ts`
- Verification:
  - Not run in this change because the user explicitly requested code changes only and will perform manual testing.

## 2026-06-27 | Admin Web Referral Graph Drag Physics | Center force fought node dragging
- Symptom:
  - When the user grabbed a referral graph node, nodes could immediately feel like they were being sucked toward the center of the canvas.
- Root cause:
  - Runtime `forceX(0)` and `forceY(0)` center forces stayed active while drag keep-alive repeatedly reheated the simulation.
  - The reheat fixed premature stopping, but also amplified the center gravity that should not participate in direct node dragging.
- Why it was missed:
  - The force profile was checked for "physics alive" but not for whether center gravity fought the user's pointer during drag.
- Permanent guardrail:
  - Referral graph runtime interaction must not use unconditional `forceX`/`forceY` center suction.
  - Source tests should reject `forceX<FGNode>` and `forceY<FGNode>` in `ReferralGraphCanvas` and require those forces to be nulled.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-interaction.test.ts`
- Verification:
  - Not run in this change because the user explicitly requested code changes only and will perform manual testing.

## 2026-06-27 | Admin Web Referral Graph Drag Physics | Special-cased active branch tension
- Symptom:
  - During referral graph dragging, edges could stretch too far because the grabbed node's branch and lower descendant edges were not all governed by the same spring-tension rule.
- Root cause:
  - The link-tension force special-cased active dragged endpoints and weakened non-active links during active drag.
  - The elastic descendant tether also decayed by depth, so deeper descendants were intentionally pulled with weaker spring force.
- Why it was missed:
  - The intended mental model was "balls tied by equal rubber bands", but the code still encoded depth-based and active-endpoint-based exceptions.
- Permanent guardrail:
  - Do not special-case link tension by active dragged node, child, or descendant depth unless the product explicitly requests a different physical model.
  - Descendant elastic tethers should use the same default spring tension across depths.
  - Tests must assert active drag branch links still receive normal link tension.
- Related files:
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/lib/referral-graph-interaction.test.ts`
- Verification:
  - Not run in this change because the user explicitly requested code changes only and will perform manual testing.

## 2026-06-27 | Admin Web Referral Graph Drag Physics | Hard-pinned node drag stopped simulation
- Symptom:
  - A grabbed referral graph node did not respond immediately, descendants did not feel connected by elastic springs, and after mouseup the graph could stop instead of continuing to relax.
- Root cause:
  - Manual pointer dragging still wrote `node.x/y` directly, assigned `node.fx/fy`, and zeroed `node.vx/vy` on every pointer move, which bypassed d3 velocity-based physics.
  - Active-drag force scaling reduced graph forces to near-zero, so grabbing a node made the surrounding simulation feel frozen.
  - `handleEngineStop` could clear all residual node velocities while release tethers were still active, killing post-drop motion.
- Why it was missed:
  - Source tests still allowed the old hard-pin drag contract and did not check that pointer dragging only sets a velocity target.
  - QA focused on avoiding spikes, but not on immediate grabbed-node response and continued post-release physics.
- Permanent guardrail:
  - Pointer drag must update a `pointerDragTargetRef` and velocity impulse only; it must not assign graph coordinates or `fx/fy` during mouse movement.
  - Engine-stop cleanup must skip while node drag, pointer drag, release root, or release tethers are active.
  - Drag-time force scaling must leave enough spring, charge, collision, and separation motion alive for visible elastic response.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-interaction.test.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
- Verification:
  - Not run in this change because the user explicitly requested code changes only and will perform manual testing.

## 2026-06-27 | Admin Web Referral Graph Drag Release | Cleared rubber-band force at mouseup
- Symptom:
  - Dragging a high-degree referral node could pull descendants during the drag, but after mouseup the graph visually kept the dropped shape instead of continuing to relax like spring-connected balls.
- Root cause:
  - `finishNodeDrag` cleared `elasticDragTethersRef` immediately and nulled the active drag id, so the custom rubber-band force was removed exactly when the release follow-through should start.
  - Manual node dragging also zeroed the dragged node velocity on every pointer move and did not pass the last pointer velocity into release.
- Why it was missed:
  - Earlier browser QA asserted active drag depth and descendant movement during drag, but did not assert release-window state or post-release coordinate changes.
- Permanent guardrail:
  - Referral graph drag QA must assert that release keeps a temporary elastic root/tether set, that the dragged node receives a bounded release velocity, and that tracked descendants continue moving at 200ms+ after mouseup before the settle timer clears.
  - Source tests must fail if `finishNodeDrag` clears elastic tethers before the release settle timer.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-interaction.test.ts`
  - [privacy-safe referral graph QA](../docs/testing/PRIVACY_SAFE_QA_EVIDENCE_2026-07.md#referral-graph-visual-and-branch-qa)
- Verification:
  - RED/GREEN: `npx tsx --test web/src/lib/referral-graph-interaction.test.ts`.
  - Passed: `npx tsx --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts`.
  - Passed: `npm --prefix web run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/lib/referral-graph-interaction.test.ts`.
  - Passed: `SENTRY_AUTH_TOKEN='' npm --prefix web run build`.
  - Browser QA with account `01058006018`: dragged node `3a645d36-50ce-44fd-9bf2-f9506c9cb70d`, kept `elasticDepthCount=88` immediately after release, and measured descendant movement after mouseup.

## 2026-06-27 | Admin Web Referral Graph Drag QA | Fixed spike by accidentally killing child-node motion
- Symptom:
  - Dragging a high-degree referral node no longer exploded into a long spike, but the lower/descendant nodes stayed visually fixed, so the dragged node stretched lines away from its organization.
- Root cause:
  - The first spike fix removed hard simulation reheats and damped background motion, but relied on a cooled d3 force engine for visible child response.
  - Browser QA showed the engine produced only about `3.2px` of direct-descendant movement for a `187.9px` drag, effectively invisible to users.
- Why it was missed:
  - I initially treated "viewport does not jump and background does not move" as sufficient proof, without requiring descendant follow-through displacement.
  - The source test still protected free-force dragging but did not assert immediate descendant elasticity from actual graph-position deltas.
- Permanent guardrail:
  - Browser QA for referral graph drag must record selected-node displacement, direct descendant displacement, second-hop displacement, deep descendant displacement, and background displacement.
  - Direct descendants must visibly follow a meaningful drag while unrelated background nodes remain still.
  - Do not rely on the optional React drag `translate` callback argument for descendant follow-through; compute delta from the runtime node graph position and `__initialDragPos`.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-interaction.ts`
  - `web/src/lib/referral-graph-interaction.test.ts`
  - [privacy-safe referral graph QA](../docs/testing/PRIVACY_SAFE_QA_EVIDENCE_2026-07.md#referral-graph-visual-and-branch-qa)
- Verification:
  - Passed browser QA with account `01058006018`: dragging node `한태균` by `187.8829px` moved 6 direct descendants by `78.9108px`, 3 second-hop descendants by `45.7683px`, deeper descendants by about `24-27px`, and 244 background nodes by `0px`.
  - Passed: `npx tsx --test web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-free-simulation.test.ts web/src/lib/referral-graph-simulation.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-display.test.ts web/src/lib/referral-graph-link-style.test.ts web/src/lib/admin-web-route-access.test.ts web/src/lib/admin-web-referral-graph-nav.test.ts`.
  - Passed: `npm --prefix web run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/lib/referral-graph-interaction.ts src/lib/referral-graph-interaction.test.ts src/lib/referral-graph-physics.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-free-simulation.test.ts src/lib/referral-graph-display.ts src/lib/referral-graph-display.test.ts src/lib/referral-graph-link-style.ts src/lib/referral-graph-link-style.test.ts src/app/dashboard/referrals/graph/page.tsx`.
  - Passed: `SENTRY_AUTH_TOKEN='' npm --prefix web run build`.

## 2026-06-27 | Admin Web Referral Graph Physics | Tests preserved the wrong drag model
- Symptom:
  - The referral graph felt unlike Obsidian because dragging a node used directed follower movement and drag-time force weakening instead of live spring/charge/collision interaction.
  - Existing tests still encoded drag followers, layout memory, and disabled active-drag forces, so they could pass while the production graph behaved unnaturally.
- Root cause:
  - Tree layout corrections leaked from initial positioning into runtime interaction, and the tests duplicated that old force profile instead of asserting the intended free-force runtime contract.
- Why it was missed:
  - Verification focused on no-overlap and static readability, not whether all core d3 forces stayed active while the pointer was dragging.
  - Source-contract tests checked the old helper behavior directly, which made dead or obsolete physics look protected.
- Permanent guardrail:
  - Keep a dedicated free-force physics profile and simulation tests that assert drag fixes only the pointer node while neighbors move through live springs, charge, and collision.
  - Source-contract tests must fail if Canvas reintroduces directed drag followers, drag-time charge/link/collision disabling, or layout-memory anchoring as an interaction force.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/lib/referral-graph-interaction.test.ts`
  - `web/src/lib/referral-graph-free-simulation.test.ts`
- Verification:
  - Passed: `npx tsx --test web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-free-simulation.test.ts web/src/lib/referral-graph-simulation.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-display.test.ts web/src/lib/admin-web-route-access.test.ts web/src/lib/admin-web-referral-graph-nav.test.ts`.
  - Passed: `npm --prefix web run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/lib/referral-graph-physics.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-interaction.test.ts src/lib/referral-graph-free-simulation.test.ts src/app/dashboard/referrals/graph/page.tsx`.
  - Passed: `SENTRY_AUTH_TOKEN='' npm --prefix web run build`.
  - Passed browser QA with a disposable test account: loaded the expected graph, dragged a designated test node with a matching internal identifier, preserved viewport center/zoom, and observed no stable or post-drag visual diff. Evidence: [privacy-safe referral graph QA](../docs/testing/PRIVACY_SAFE_QA_EVIDENCE_2026-07.md#referral-graph-visual-and-branch-qa).

## 2026-06-26 | Admin Web Board/Notifications | Secret-bearing env value reached a visible author name
- Symptom:
  - The admin web notification/board UI showed a Sentry read-token environment variable key/value fragment inside a board-post author label for an insurance digest post.
- Root cause:
  - Local `.env.local` had `BOARD_AUTOMATION_ACTOR_NAME` contaminated with a `SENTRY_READ_AUTH_TOKEN=...` assignment on the same line, and `scripts/ops/post-insurance-digest.mjs` passed that display name through to the board-create Edge Function.
- Why it was missed:
  - The digest automation validated title/content/source URL shape, but did not treat actor display names as a secret-bearing input surface.
  - Board and notification render paths trusted stored text fields and did not redact env-style secret assignments at display time.
- Permanent guardrail:
  - Reject `BOARD_AUTOMATION_ACTOR_NAME` when it contains env-style secret assignments before digest posting.
  - Redact secret assignment patterns in admin-web notification, board, and notice display paths.
  - Redact notification rows and board post display fields inside Supabase Edge Functions before storing/returning them.
- Related files:
  - `scripts/ops/post-insurance-digest.mjs`
  - `scripts/ops/post-insurance-digest.test.mjs`
  - `web/src/lib/sensitive-text.ts`
  - `web/src/components/DashboardNotificationBell.tsx`
  - `web/src/lib/board-api.ts`
  - `web/src/app/api/fc-notify/route.ts`
  - `web/src/app/api/admin/notices/route.ts`
  - `supabase/functions/fc-notify/index.ts`
  - `supabase/functions/_shared/board.ts`
  - `supabase/functions/board-create/index.ts`
  - `supabase/functions/board-list/index.ts`
  - `supabase/functions/board-detail/index.ts`
- Verification:
  - Cleaned the contaminated `board_posts.author_name` row and verified zero matching sensitive rows in `notifications`, `notices`, and `board_posts`.
  - Passed: `npx tsx --test web/src/lib/sensitive-text.test.ts`.
  - Passed: `node --test scripts/ops/post-insurance-digest.test.mjs`.
  - Passed: `cd web && npm run lint -- src/lib/sensitive-text.ts src/lib/sensitive-text.test.ts src/components/DashboardNotificationBell.tsx src/lib/board-api.ts src/app/api/fc-notify/route.ts src/app/api/admin/notices/route.ts`.
  - Passed: `deno check --config supabase/functions/deno.json supabase/functions/fc-notify/index.ts supabase/functions/board-create/index.ts supabase/functions/board-list/index.ts supabase/functions/board-detail/index.ts`.
  - Deployed: Supabase Functions `fc-notify`, `board-create`, `board-list`, and `board-detail`.

## 2026-06-24 | Sentry Automation Contract | automation ran before its main-branch command existed
- Symptom:
  - The daily Sentry automation was pointed at `origin/main` and `npm run ops:sentry-triage`, but `origin/main` did not yet contain the script.
  - The linked worktree also only checked its own `.env` files, so it could not read the primary checkout's local `SENTRY_READ_AUTH_TOKEN`.
- Root cause:
  - The automation was scheduled against a branch/checkout contract before the command and secret-loading behavior were present on that branch.
- Why it was missed:
  - Local development verification used the feature branch and local shell state, while the automation ran in an isolated main-based worktree.
- Permanent guardrail:
  - Before scheduling a Codex worktree automation, verify the exact command exists on the branch the automation checks out.
  - Verify required read-only secrets are provided by process/user environment or by a primary-checkout env file that the script explicitly loads.
- Related files:
  - `scripts/ops/sentry-daily-triage.mjs`
  - `scripts/ops/sentry-daily-triage.test.mjs`
  - `docs/handbook/operations-runbook.md`
- Verification:
  - `node --test scripts/ops/sentry-daily-triage.test.mjs`

## 2026-06-20 | Request Board Review Detail | JSX block move exposed a compile overlay
- Symptom:
  - While moving request-detail `계약자 정보` and FC requester summary, the in-app browser showed `Failed to compile` around `app/request-board-review.tsx` because a duplicated JSX tail/closing block briefly remained in the file.
- Root cause:
  - A large JSX section was edited with string/range replacement after `apply_patch` and the Windows sandbox helper failed, and the intermediate structure was not compiled before the browser hot-reloaded it.
- Why it was missed:
  - I treated a local source slice as enough evidence after the edit instead of immediately running `npx eslint`/`npx tsc --noEmit` before returning attention to browser feedback.
- Permanent guardrail:
  - For request-board JSX moves, especially when using fallback PowerShell edits, run a syntax gate (`npx eslint <changed tsx>` or `npx tsc --noEmit`) immediately after each structural JSX move before considering the UI ready for browser refresh.
  - Prefer smaller JSX component extractions or line-based edits over broad string/range replacement when `apply_patch` is unavailable.
- Related files:
  - `app/request-board-review.tsx`
  - `.codex/harness/qa-report.md`
- Verification:
  - Passed: `npx eslint app/request-board-review.tsx app/request-board.tsx app/request-board-requests.tsx lib/request-board-api.ts lib/__tests__/request-board-mobile-ui-contract.test.ts lib/__tests__/request-board-api-contract.test.ts`.
  - Passed: `npx tsc --noEmit`.
  - Passed: `npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts lib/__tests__/request-board-api-contract.test.ts`.
## 2026-06-18 | Request Board Policyholder Toggle | Web-only raw div did not open the policyholder fields
- Symptom:
  - During UI verification, the "계약자 피보험자 다름" control was visible in the web request-board create flow but activating the web-only raw `div` path did not reveal the contractor/policyholder fields.
- Root cause:
  - The screen split the same control into a raw DOM `div` for web and a React Native `Pressable` for native, so the web path was not covered by the same press behavior as the app path.
- Why it was missed:
  - The source contract only checked that `onClick` text existed, not that web and native shared one reliable `Pressable` control path.
- Permanent guardrail:
  - Keep the separate contractor toggle on one `Pressable` with `onPress={toggleSeparatePolicyholder}` for React Native and React Native Web.
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts` must fail if this control reintroduces a web-only raw `<div>`, `onClick` branch, or `onPressIn` duplicate-toggle path.
- Related files:
  - `app/request-board-create.tsx`
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath lib/__tests__/request-board-mobile-ui-contract.test.ts --runInBand`.

## 2026-06-18 | Loading UI Source of Truth | Reversed the requested loading baseline
- Symptom:
  - The requested change was to make other loading UI follow the "새 설계 요청" loading animation, but the first implementation changed the request-board create baseline itself and then pushed other surfaces toward the custom branded SVG spinner.
- Root cause:
  - I treated the existing shared `BrandedLoadingSpinner` as the source of truth instead of first preserving the user-named source UI in `app/request-board-create.tsx`.
- Why it was missed:
  - The previous guardrail only blocked `ActivityIndicator` usage, which encoded the wrong direction and made the regression look intentional.
- Permanent guardrail:
  - `components/BrandedLoadingSpinner.tsx` must use React Native `ActivityIndicator` as the shared spinner baseline, matching the original request-board create loading behavior.
  - `components/__tests__/BrandedLoadingSpinner.contract.test.ts` must fail if the shared spinner returns to `react-native-svg`, `Animated`, or icon/font-based loading.
  - Do not replace the user-named source UI before confirming the source of truth.
- Related files:
  - `app/request-board-create.tsx`
  - `components/BrandedLoadingSpinner.tsx`
  - `lib/branded-loading-spinner.ts`
  - `components/__tests__/BrandedLoadingSpinner.contract.test.ts`
  - `lib/__tests__/branded-loading-spinner.test.ts`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath components/__tests__/BrandedLoadingSpinner.contract.test.ts lib/__tests__/branded-loading-spinner.test.ts --runInBand`.

## 2026-06-18 | GaramIn Request Board Full-Flow Audit | UI, role, session, and PII contracts drifted across surfaces
- Symptom:
  - New-customer request creation could hide or make hard to reach lower form fields behind the global bottom navigation, and the separate policyholder toggle needed stronger UI coverage after "계약자 피보험자 다름" regressions.
  - Request-list filters overflowed narrow phones; FC code management still used a clipped table-like mobile layout; review metadata used fixed two-column fields that could overflow with long FC/code values.
  - Read-only/admin-derived request_board bridge sessions could reach FC write/final-decision surfaces because screens trusted `requestBoardRole` without checking the app role/read-only boundary.
  - request_board access-denied bridge errors could be interpreted as full GaramIn re-login conditions, and server SSN responses defaulted to full view unless callers explicitly asked for masking.
- Root cause:
  - Request-board screens implemented local UI/permission decisions independently instead of sharing a write-permission helper and mobile layout contracts.
  - Data-safety defaults lived in request_board routes/API wrappers without a source-level contract requiring explicit `ssnView=full` for full resident-number reads.
- Why it was missed:
  - Prior checks focused on the individual missing policyholder fields and happy-path create/review flows, not all request-board steps at narrow mobile sizes.
  - Role tests covered designer-vs-FC detail actions but not read-only/admin-derived bridge sessions.
- Permanent guardrail:
  - Keep request-board mobile source-contract tests for no global bottom nav on the create wizard, complete customer input validation, policyholder toggle controls, horizontal request filters, card-based FC codes, constrained manager summaries, and full-width review metadata.
  - Gate all FC write actions through `request-board-permissions` instead of raw `requestBoardRole` checks.
  - Mobile must opt into full SSN reads with `ssnView=full`; request_board server defaults must stay masked.
- Related files:
  - `app/request-board-create.tsx`
  - `app/request-board.tsx`
  - `app/request-board-review.tsx`
  - `app/request-board-requests.tsx`
  - `app/request-board-fc-codes.tsx`
  - `lib/request-board-permissions.ts`
  - `lib/request-board-api.ts`
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`
  - `lib/__tests__/request-board-create-flow.test.ts`
  - `lib/__tests__/request-board-api-contract.test.ts`
  - `lib/__tests__/request-board-review-role.contract.test.ts`
  - `request_board/server/src/lib/requestPii.ts`
  - `request_board/server/src/routes/customers.ts`
- Verification:
  - RED/GREEN targeted request-board Jest suites, full mobile Jest suite, targeted ESLint, mobile TypeScript, request_board server build, Expo web export, and browser viewport checks at 442x907 and 320x568.

## 2026-06-18 | GaramIn Cross-Flow Request Board Parity | mobile contracts drifted from GaramLink and saved data
- Symptom:
  - GaramIn request creation bundled multiple selected products/designers into one request instead of GaramLink's one product-designer cell per request.
  - Mobile product mapping hid canonical request products outside the preferred eight categories.
  - Existing customers could still submit without canonical driving status, accepted designer assignments could not be rejected from detail, list/home cards did not show separate policyholder context, attachment description/expiry metadata was not visible or enterable, and health disclosure wording drifted.
  - Separate exam/sign-up data (`fee_paid_date`, `license_statuses`) was saved but not selected/restored/displayed in app surfaces.
- Root cause:
  - Mobile screens carried API payload fields without a field-by-field parity contract against GaramLink web, request detail data, and existing saved FC/exam records.
  - Source tests covered isolated regressions, not the complete cross-screen contract for request creation, review, list cards, and profile/exam follow-up displays.
- Why it was missed:
  - Multi-select UI was interpreted as a single aggregate mobile request even though the web canonical flow creates per-cell requests.
  - Optional-looking fields were forwarded or stored, so source review could miss that users could not enter, revalidate, or see them later.
- Permanent guardrail:
  - GaramIn request-board mobile must keep source-contract tests for one request per product-designer cell, dynamic product preservation, existing-customer driving-status revalidation, accepted-assignment reject actions, policyholder-aware compact labels, attachment description/expiry display and upload metadata, and health disclosure wording.
  - Saved exam/profile fields that affect user follow-up must be selected, restored, and displayed in the same change set where they are saved.
- Related files:
  - `app/request-board-create.tsx`
  - `app/request-board-review.tsx`
  - `app/request-board-requests.tsx`
  - `app/request-board.tsx`
  - `app/exam-apply.tsx`
  - `app/exam-apply2.tsx`
  - `app/index.tsx`
  - `app/dashboard.tsx`
  - `lib/request-board-mobile-products.ts`
  - `lib/request-board-policyholder-display.ts`
  - `lib/request-board-review-actions.ts`
  - `lib/license-statuses.ts`
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`
  - `lib/__tests__/request-board-mobile-products.test.ts`
  - `lib/__tests__/request-board-review-actions.test.ts`
  - `lib/__tests__/request-board-policyholder-display.test.ts`
  - `lib/__tests__/exam-license-source-contract.test.ts`
- Verification:
  - RED/GREEN request-board mobile contract tests and exam/license source contract tests.
  - Final verification must include focused Jest suites, ESLint for touched files, TypeScript, and diff check.

## 2026-06-16 | Board Push Deep Link | Push tap bypassed mobile route normalization
- Symptom:
  - When a board post notification arrived on a phone, tapping the push notification did not consistently open the board post detail screen.
  - URLs shaped like admin/web board targets could collapse to a generic dashboard route instead of `/board-detail?postId=...`.
- Root cause:
  - `app/_layout.tsx` pushed raw `content.data.url` from Expo notification responses directly into `router.push()`.
  - `lib/notification-route.ts` normalized legacy `/board?postId=...`, but did not normalize admin web `/dashboard/board?postId=...` to the mobile standalone board detail route.
  - The push tap path and the in-app notification inbox path used different route logic.
- Why it was missed:
  - Existing checks verified that `board-create` and `board-update` stored `/board-detail?postId=...`, but did not cover web/admin URL variants reaching mobile push payloads.
  - Tests focused on inbox route normalization, not the native push response handler in `_layout`.
- Permanent guardrail:
  - Mobile push taps, notification-center taps, and web/admin notification URLs must all pass through `lib/notification-route.ts`.
  - Board post notification targets must resolve to `/board-detail?postId=...` for mobile, including `/board?postId=...`, `/dashboard/board?postId=...`, and absolute admin web URLs with that path.
  - Do not call `router.push(content.data.url)` directly from native notification handlers.
- Related files:
  - `app/_layout.tsx`
  - `lib/notification-route.ts`
  - `lib/__tests__/notification-route.test.ts`
  - `docs/handbook/backend/notifications-inbox-push.md`
- Verification:
  - RED: `npm test -- --runInBand lib/__tests__/notification-route.test.ts` failed before `resolvePushNotificationRoute` existed.
  - GREEN: `npm test -- --runInBand lib/__tests__/notification-route.test.ts`

## 2026-06-16 | Auth Login Background | Full-screen auth gradient left as an Android dark-fallback risk
- Symptom:
  - The Android login screen rendered the top/background area as black behind the transparent `가람in` logo instead of the expected light GaramIn auth surface.
  - The login form card, inputs, and CTA still rendered with their intended light/orange styling, which made the regression look like a split shell/background failure rather than a full theme change.
- Root cause:
  - `app/login.tsx` still paints the auth backdrop with a full-screen `expo-linear-gradient` (`colors={['#ffffff', '#fff1e6']}`).
  - This repo already has a documented Android rendering class where gradient-backed orange/light surfaces can fall back to black; the transparent login logo then exposes that black surface directly.
  - Global shell candidates (`app/_layout.tsx`, `app.json`, Android nav/status bar config) were already pinned to light backgrounds, so the remaining black surface came from the login screen's own gradient layer.
- Why it was missed:
  - Earlier Android black-rendering hardening removed gradient usage from several CTA/card surfaces, but auth-entry backgrounds were left on the older `LinearGradient` pattern.
  - The login logo asset was easy to misread as the source because it is mostly transparent and only shows the bad background through it at runtime.
- Permanent guardrail:
  - Do not use `LinearGradient` for full-screen mobile auth backgrounds on Android in this repo; use an explicit solid light background (`COLORS.primaryPale`/`#fff1e6`) or another non-gradient fallback-first treatment.
  - When auditing Android dark/black regressions, inspect transparent assets and the surface behind them before replacing image files.
  - Auth-entry source tests should lock the absence of full-screen gradient-only background contracts on `/login` the same way user-owned protected source-contract tests lock light fallbacks elsewhere; their identifiers are withheld.
- Related files:
  - `app/login.tsx`
  - `lib/__tests__/signup-background-source.test.ts`
  - One user-owned protected source-contract test (identifier withheld).
- Verification:
  - Confirmed `assets/images/login.png` is mostly transparent, so the screenshot's black area was not baked into the logo.
  - Confirmed `app/_layout.tsx` and `app.json` already pin app-level backgrounds, StatusBar, and NavigationBar to light colors.
  - Traced the remaining black-capable surface to the full-screen `LinearGradient` in `app/login.tsx`.

## 2026-06-16 | Board Automation Actor | Public admin-phone fallback treated as posting authority
- Symptom:
  - The weekly insurance digest preflight returned `admin account not found` even though the fallback phone came from the public admin phone list.
- Root cause:
  - `post-insurance-digest` can derive `BOARD_AUTOMATION_ACTOR_PHONE` from public app admin-phone env values, but the board Edge Functions authorize against active rows in `admin_accounts` or `manager_accounts`.
  - The public admin-phone list can contain values that do not map to an active board actor.
- Why it was missed:
  - Dry-run payload validation and public admin-phone presence were treated as enough evidence before checking the live `board-categories-list`/`board-list` path.
- Permanent guardrail:
  - Weekly board automation must explicitly configure `BOARD_AUTOMATION_ACTOR_ROLE`, `BOARD_AUTOMATION_ACTOR_PHONE`, and `BOARD_AUTOMATION_ACTOR_NAME`.
  - Treat `admin account not found` as a hard blocker and do not post or claim upload success.
  - Validate actor access with `npm run ops:post-insurance-digest -- --check-existing` before research/posting.
- Related files:
  - `scripts/ops/post-insurance-digest.mjs`
  - `docs/handbook/operations-runbook.md`
  - `.env.local`
- Verification:
  - Reproduced blocker with the stale fallback.
  - Set an explicit active admin actor and confirmed preflight reached `status: missing`.
  - Posted one live test board post and verified `board-detail`, notification rows, and inbox target URL.

## 2026-06-16 | Sentry Daily Triage | Issue detail/events endpoint drift
- Symptom:
  - Sentry organization issue list succeeded with the read-only token, but issue detail/events fetches failed with `Invalid token`.
- Root cause:
  - The helper used legacy `/api/0/issues/{issue_id}/...` paths while the current official API documents organization-scoped paths under `/api/0/organizations/{org}/issues/{issue_id}/...`.
- Why it was missed:
  - Unit tests verified that detail/events were called, but encoded the same stale URL shape instead of matching the official docs.
- Permanent guardrail:
  - Tests must assert the organization-scoped detail/events URL shape.
  - If list succeeds but detail/events return auth-shaped errors, verify endpoint shape before changing token scopes.
- Related files:
  - `scripts/ops/sentry-daily-triage.mjs`
  - `scripts/ops/sentry-daily-triage.test.mjs`
- Verification:
  - Reproduced `Invalid token` on the stale endpoint.
  - Updated helper and tests to organization-scoped paths.
  - Live triage then retrieved issue detail and events successfully.

## 2026-06-09 | Request Board FC Codes | 코드 관리 후 의뢰 작성 화면의 코드 목록을 갱신하지 않음
- Symptom:
  - FC가 `설계코드 관리`에서 `테스트 회사` 코드를 등록했는데도, 의뢰 작성의 설계매니저 선택 sheet와 제출 전 검증에서 계속 `FC 코드 필요` / `설계코드 필요`가 표시됐다.
  - 운영 DB와 `/api/fc-codes`는 해당 FC의 `테스트 회사` 코드를 정상 반환했고, 설계매니저 회사명도 같은 `테스트 회사`였다.
- Root cause:
  - `app/request-board-create.tsx`가 최초 mount 때 `rbGetFcCodes()` 결과를 state에 저장한 뒤, `/request-board-fc-codes`에서 코드를 추가하고 돌아온 focus 시점에 다시 조회하지 않았다.
  - 작성 화면이 navigation stack에 살아 있어서 stale `fcCodes` state가 유지됐다.
- Why it was missed:
  - 설계코드 등록 화면 저장 성공만 확인했고, 작성 화면으로 돌아와 기존 draft가 stale state 없이 제출 가능한지는 같은 flow로 검증하지 않았다.
- Permanent guardrail:
  - 설계요청 작성 화면은 초기 로드 후 focus 복귀 시 `rbGetDesigners()`와 `rbGetFcCodes()`를 재조회한다.
  - 작성 중인 고객/요청/첨부 draft는 유지하되, 설계매니저/코드 목록만 refresh한다.
  - source-level regression test로 focus refresh 경로를 고정한다.
- Related files:
  - `app/request-board-create.tsx`
  - `app/request-board-fc-codes.tsx`
  - `lib/request-board-api.ts`
  - `lib/__tests__/request-board-create-code-refresh.test.ts`
- Verification:
  - `npm test -- --runInBand lib/__tests__/request-board-create-code-refresh.test.ts`
  - `npx eslint app/request-board-create.tsx lib/__tests__/request-board-create-code-refresh.test.ts`

## 2026-06-08 | Referral Graph Edge Length | 자식 수가 적은 체인을 길게, 많은 허브를 짧게 만드는 반대 결과
- Symptom:
  - 사용자가 요구한 방향은 자식이 적은 릴레이 체인은 짧게 유지하고, 자식이 많은 부모 노드는 더 긴 엣지로 공간을 확보하는 것이었다.
  - 실제 화면에서는 반대로 자식이 적은 세로 체인 엣지가 비정상적으로 길어지고, 자식이 많은 허브 주변 엣지는 짧아져 노드가 뭉쳤다.
- Root cause:
  - 엣지 길이 판단에서 `targetHasChildren`/subtree 존재 여부를 너무 크게 반영해, 직접 자식 수가 적은 릴레이 체인도 긴 branch로 취급했다.
  - 말단 leaf spoke는 terminal이라는 이유로 과하게 짧게 유지되어, 실제 공간이 필요한 high-fanout 부모의 자식들이 충분히 밀려나지 않았다.
  - fanout 증가는 일부 구간에서 fixed threshold 중심으로 처리되어 자연스러운 연속 스케일이 아니었다.
- Why it was missed:
  - 테스트가 “자식 있는 노드는 terminal leaf보다 길어야 한다”는 넓은 조건만 검증했고, “직접 자식 수가 적은 체인 vs 직접 자식 수가 많은 허브”의 상대 길이를 고정하지 않았다.
  - 실제 스크린샷에서 sparse vertical chain과 crowded hub를 동시에 비교하는 시각 QA를 자동화하지 않았다.
- Permanent guardrail:
  - 추천인 그래프 엣지 길이는 직접 자식 수, local subtree pressure, density를 연속 수식으로 반영한다.
  - sparse branch 여부는 깊은 subtree 존재가 아니라 직접 자식 수 기준으로 판단한다.
  - high-fanout leaf spoke와 child-hub branch는 직접 자식 수가 커질수록 길어져야 하며, one-child relay chain보다 짧아지면 안 된다.
  - `referral-graph-physics.test.ts`와 `referral-graph-layout.test.ts`에 sparse chain, crowded hub, smooth fanout scaling 회귀 테스트를 유지한다.
- Related files:
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/lib/referral-graph-layout.ts`
  - `web/src/lib/referral-graph-layout.test.ts`
  - `web/src/lib/referral-graph-simulation.test.ts`
- Verification:
  - `node --test web/src/lib/referral-graph-physics.test.ts`
  - `node --test web/src/lib/referral-graph-layout.test.ts`
  - `node --test web/src/lib/referral-graph-display.test.ts web/src/lib/referral-graph-edges.test.ts web/src/lib/referral-graph-highlight.test.ts web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-link-style.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-scope.test.ts web/src/lib/referral-graph-simulation.test.ts`
  - `cd web; npm run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/lib/referral-graph-layout.ts src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts`

## 2026-06-08 | Admin Exam Applicant Columns | 전역 명단만 바꾸고 다른 응시자 명단 route를 누락
- Symptom:
  - 관리자 웹 시험 응시자 목록 순서를 엑셀 샘플과 맞춰 배포했는데, 현장에서는 순서가 그대로라는 제보가 들어왔다.
  - 실제로 `/dashboard/exam/applicants`는 새 순서였지만, 회차별 `/admin/exams/[id]` `응시자 관리` 화면은 여전히 `이름/연락처/소속/주소/고사장/신청일시/접수 상태` 순서를 사용했다.
  - 후속 확인에서 legacy `/exam/apply` route도 같은 구 테이블을 그대로 렌더링하고 있어, 오래된 링크/캐시/알림 진입 시 여전히 바뀌지 않은 화면처럼 보일 수 있었다.
- Root cause:
  - 같은 업무 목록이 전역 시험자 명단과 회차별 응시자 관리 화면에 중복 구현되어 있었다.
  - 전역 화면만 `EXAM_APPLICANT_EXPORT_COLUMNS` 공용 컬럼 계약으로 바꾸고, 회차별 화면과 legacy `/exam/apply`는 직접 Supabase 조회와 별도 테이블 렌더링으로 남겨뒀다.
- Why it was missed:
  - 최초 검증 범위를 `/dashboard/exam/applicants`와 CSV 다운로드에 한정했고, 시험 일정 상세에서 진입하는 `/admin/exams/[id]` 경로를 같은 업무 surface로 묶어 확인하지 않았다.
  - 후속 검증도 route 검색을 `admin/exams` 계열에 집중했고, `/exam/apply`처럼 메뉴에서 직접 노출되지 않는 legacy route의 stale UI를 놓쳤다.
- Permanent guardrail:
  - 시험 응시자 data column order는 `web/src/lib/exam-applicant-list-display.ts`의 `EXAM_APPLICANT_EXPORT_COLUMNS`만 사용한다.
  - 전역 명단과 회차별 명단 모두 source-level regression test로 공용 컬럼 계약 사용을 확인한다.
  - legacy `/exam/apply`는 구 테이블을 렌더링하지 않고 canonical `/dashboard/exam/applicants`로 redirect한다.
  - 회차별 조회도 `/api/admin/exam-applicants?roundId=...` 서버 API를 사용해 주민번호 trusted path와 `신규신청/재신청` 계산을 공유한다.
- Related files:
  - `web/src/app/exam/apply/page.tsx`
  - `web/src/app/admin/exams/[id]/page.tsx`
  - `web/src/app/api/admin/exam-applicants/route.ts`
  - `web/src/lib/exam-applicant-list-display.ts`
  - `web/src/lib/exam-applicant-list-display.test.ts`
  - `web/src/lib/exam-applicant-resident-number-enrichment.ts`
- Verification:
  - RED/GREEN: `node --test web/src/lib/exam-applicant-list-display.test.ts web/src/lib/exam-applicant-resident-number-enrichment.test.node.ts`
  - `cd web && npm run lint`
  - `cd web && SENTRY_AUTH_TOKEN='' npm run build`
  - `vercel --prod --yes --archive=tgz --scope jun-jeongs-projects`
  - `vercel inspect https://admin-ddbf9l6z0-jun-jeongs-projects.vercel.app --scope jun-jeongs-projects`
  - Follow-up RED/GREEN: `node --test web/src/lib/exam-applicant-list-display.test.ts` caught and fixed legacy `/exam/apply`.
  - Follow-up deploy: `vercel inspect https://admin-m71a2lq31-jun-jeongs-projects.vercel.app --scope jun-jeongs-projects` status `Ready`; live `/exam/apply` returns `307 Location: /dashboard/exam/applicants`.

## 2026-06-08 | Home Guide Badge | 색상 상수만 고정하고 실제 vector/elevation 검정 합성 경로를 남김
- Symptom:
  - 홈 `앱 사용법 안내 시작하기` 카드의 왼쪽 play 배지가 일부 Android 기기에서 여전히 검정 원으로 보였다.
- Root cause:
  - `home-guide-ui` 색상 상수는 오렌지로 고정했지만, 실제 렌더링은 `Feather name="play"` vector icon과 원형 `View`의 shadow/elevation 조합을 계속 사용했다.
  - Android native 합성에서 작은 원형/elevated surface가 검정으로 보이는 기존 실패 경로가 남아 있었다.
- Why it was missed:
  - 기존 테스트가 색상 상수만 검증했고, 실제 `app/index.tsx` 렌더링 source가 vector icon/elevation을 쓰는지는 고정하지 않았다.
- Permanent guardrail:
  - 홈 가이드 play 배지는 vector icon 대신 native border triangle을 사용한다.
  - 작은 core action badge는 shadow/elevation을 0으로 두고, source-level test로 `Feather name="play"` 재도입을 막는다.
- Related files:
  - `app/index.tsx`
  - `lib/home-guide-ui.ts`
  - `lib/__tests__/home-guide-ui.test.ts`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath lib/__tests__/home-guide-ui.test.ts --runInBand`
  - `npx eslint app/index.tsx lib/home-guide-ui.ts lib/__tests__/home-guide-ui.test.ts`
  - `npx tsc --noEmit --pretty false`

## 2026-06-08 | Referral Share Copy | 설정 화면에 예전 추천코드 공유 문구를 하드코딩한 채로 둠
- Symptom:
  - 같은 계정의 추천코드를 공유해도 일부 기기/진입점에서는 새 HTTPS invite 문구가 나가고, 일부에서는 예전 `가람in 앱 가입 시 추천 코드를 입력해주세요!` / `앱 열기 링크: hanwhafcpass://signup?...` 문구가 나갔다.
- Root cause:
  - `/referral`은 `lib/referral-share.ts`의 `buildReferralShareText()`를 사용했지만, `/settings`의 `handleShareReferralCode()`는 예전 문구를 직접 조립했다.
- Why it was missed:
  - 공유 문구 업데이트 때 추천인 self-service 화면만 확인하고, 설정 화면의 `내 추천 코드` 카드 공유 버튼을 같은 계약으로 묶는 테스트가 없었다.
- Permanent guardrail:
  - 추천코드 공유 문구는 `lib/referral-share.ts`만 사용한다.
  - 새 공유 진입점을 추가하면 `lib/__tests__/referral-share.test.ts`에 source-level contract를 추가해 예전 direct deep-link 문구가 남지 않게 한다.
- Related files:
  - `app/settings.tsx`
  - `app/referral.tsx`
  - `lib/referral-share.ts`
  - `lib/__tests__/referral-share.test.ts`
  - `docs/referral-system/INCIDENTS.md`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath lib/__tests__/referral-share.test.ts --runInBand`

## 2026-06-08 | GaramIn Board Filters | FC 게시판 필터만 유지하고 총무/본부장 관리 화면을 누락
- Symptom:
  - 총무/본부장이 가람in `게시판` 탭(`/admin-board-manage`)에 들어가면 FC 게시판(`/board`)에는 있는 글 종류 필터와 정렬 버튼이 보이지 않았다.
- Root cause:
  - FC 게시판은 `selectedCategoryId`/`sortOption`을 UI와 `fetchBoardList()` 파라미터에 연결했지만, 관리 게시판은 별도 구현으로 남아 목록 query가 `{ limit: 20 }`만 전달했다.
  - 관리 게시판은 `fetchBoardCategories()`를 이미 호출하면서도 그 데이터를 필터 UI로 렌더링하지 않았다.
- Why it was missed:
  - 2026-06-05 게시판 4종 카테고리 정렬 때 데이터/카테고리 allowlist 계약은 검증했지만, FC 목록 화면과 총무/본부장 목록 화면의 필터 UI parity를 별도 계약으로 고정하지 않았다.
- Permanent guardrail:
  - 게시판 목록 query key/params/정렬 라벨은 `lib/board-list-query.ts` 공용 helper를 사용한다.
  - `board`와 `admin-board-manage`는 같은 카테고리 필터와 정렬 옵션을 제공해야 하며, 본부장(read-only manager actor)도 조회 필터는 사용할 수 있어야 한다.
- Related files:
  - `lib/board-list-query.ts`
  - `lib/__tests__/board-list-query.test.ts`
  - `app/board.tsx`
  - `app/admin-board-manage.tsx`
  - `docs/handbook/mobile/messenger-and-content.md`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath lib/__tests__/board-list-query.test.ts --runInBand`
  - `npx eslint app/board.tsx app/admin-board-manage.tsx lib/board-list-query.ts lib/__tests__/board-list-query.test.ts`
  - `npx tsc --noEmit --pretty false`

## 2026-06-08 | Request Board Session Errors | 가람Link 세션 실패를 화면별 일반 실패 문구로 표시
- Symptom:
  - 본부장이 설계 요청 고객 선택 화면에 들어갈 때 실제 원인은 가람Link 세션/브릿지 실패였지만, 화면에는 `데이터 로드 실패`와 일반 처리 실패 문구가 표시됐다.
- Root cause:
  - `ensureRequestBoardSession()` 실패와 request_board API 401/bridge 실패가 화면별 Alert/오류 배너에서 각자 처리됐다.
  - `Edge Function returned a non-2xx status code` 같은 기술 메시지는 전역 Alert 정규화로 더 일반적인 문구가 되어, 재로그인이 필요한 상황임을 알 수 없었다.
- Why it was missed:
  - request_board 세션 복구 경로는 여러 화면에서 재사용되지만, 사용자-facing copy는 공통 helper 없이 화면별 fallback에 의존했다.
- Permanent guardrail:
  - 가람Link 세션/브릿지 실패 문구는 `lib/request-board-session-error.ts`를 통해 정규화한다.
  - 새 request_board 화면에서 `ensureRequestBoardSession()` 또는 request_board API 인증 실패를 사용자에게 보여줄 때 이 helper를 사용한다.
  - 명시적 역할/계정 상태 안내는 재로그인 안내로 덮어쓰지 않는다.
- Related files:
  - `lib/request-board-session-error.ts`
  - `app/request-board-create.tsx`
  - `app/request-board-fc-codes.tsx`
  - `app/request-board-requests.tsx`
  - `app/request-board-review.tsx`
  - `app/request-board.tsx`
  - `app/request-board-messenger.tsx`
- Verification:
  - `npm test -- --runTestsByPath lib/__tests__/request-board-session-error.test.ts lib/__tests__/request-board-session.test.ts lib/__tests__/user-facing-error.test.ts --runInBand`
  - `npx eslint app/request-board-create.tsx app/request-board-fc-codes.tsx app/request-board-requests.tsx app/request-board-review.tsx app/request-board.tsx app/request-board-messenger.tsx lib/request-board-session-error.ts lib/__tests__/request-board-session-error.test.ts`
  - `npx tsc --noEmit --pretty false`

## 2026-06-07 | Home Guide Badge | small gradient badge가 Android에서 다시 검정색으로 렌더링
- Symptom:
  - 모바일 홈 `앱 사용법 안내 시작하기` 왼쪽 play badge가 주황색 UI가 아니라 검정 원으로 보였다.
- Root cause:
  - 이전 오렌지 CTA 보강 이후에도 guide badge는 작은 `LinearGradient` surface에 주황 icon만 얹는 별도 구현으로 남아 있었다.
  - Android native rendering fallback에서 이 작은 gradient surface가 검정색으로 보일 수 있었다.
- Why it was missed:
  - 오렌지 CTA 회귀 방지 범위가 주요 CTA/card에 집중됐고, guide/shortcut play badge의 별도 gradient 구현을 같은 계약으로 묶지 않았다.
- Permanent guardrail:
  - 작은 핵심 action badge는 gradient에 의존하지 말고 `home-guide-ui` 색상 계약의 static orange background와 white foreground를 사용한다.
  - guide badge 색상 계약은 `lib/__tests__/home-guide-ui.test.ts`로 고정한다.
- Related files:
  - `app/index.tsx`
  - `lib/home-guide-ui.ts`
  - `lib/__tests__/home-guide-ui.test.ts`
- Verification:
  - `npm test -- --runTestsByPath lib/__tests__/home-guide-ui.test.ts --runInBand`
  - `npx eslint app/home-lite.tsx app/apply-gate.tsx app/index.tsx lib/home-entry-flow.ts lib/home-guide-ui.ts lib/sentry-monitor.ts lib/sentry.ts lib/__tests__/home-entry-flow.test.ts lib/__tests__/home-guide-ui.test.ts`

## 2026-06-07 | Home Entry Sentry Investigation | source map/breadcrumb 부족으로 crash 동작 단위만 추정 가능
- Symptom:
  - Sentry unresolved `TypeError: Object is not a function`의 최신 이벤트가 `home-lite` 화면 touch와 일치했지만, release source map이 없어 minified function을 복원할 수 없었다.
  - breadcrumb도 route-level action을 남기지 않아 `필수 정보 입력 시작` 이후 어느 단계에서 crash가 났는지 확정하기 어려웠다.
- Root cause:
  - `home-lite` primary CTA와 `apply-gate` identity handoff가 inline route push로 흩어져 있었고, Sentry breadcrumb 계약이 없었다.
  - `apply-gate` `next` 값도 직접 string check로 처리해 외부/비정상 값 fallback 계약이 테스트로 고정되지 않았다.
- Why it was missed:
  - 이전 수정은 화면 route가 `/apply-gate`인지 확인하는 데 집중했고, production crash 재조사에 필요한 breadcrumb와 route helper test를 함께 추가하지 않았다.
- Permanent guardrail:
  - home-lite/apply-gate entry flow는 `home-entry-flow` helper를 source of truth로 사용한다.
  - route-level Sentry breadcrumb에는 action/screen/safe next만 남기고 PII는 포함하지 않는다.
  - `lib/__tests__/home-entry-flow.test.ts`로 `/apply-gate` route와 safe next fallback을 고정한다.
- Related files:
  - `app/home-lite.tsx`
  - `app/apply-gate.tsx`
  - `lib/home-entry-flow.ts`
  - `lib/sentry-monitor.ts`
  - `lib/sentry.ts`
- Verification:
  - `npm test -- --runTestsByPath lib/__tests__/home-entry-flow.test.ts lib/__tests__/sentry-sanitize.test.ts --runInBand`
  - `npx tsc --noEmit --pretty false`

## 2026-06-07 | Referral Graph Node Size | highlight radius boost가 descendant size 의미를 오염
- Symptom:
  - 전체 하위 조직 수 기준이면 `김형수` 노드가 가장 커야 하는데, 화면에서는 노란 본부장 강조 노드가 비슷하거나 더 커 보였다.
  - 실제 graph API 데이터에서는 `김형수 descendantCount=76`으로 1등이고, 다음 노드는 `18` 수준이었다.
- Root cause:
  - `getReferralGraphNodeRadius`가 descendantCount를 받는 새 sizing mode에서도 기존 `highlightType ? +3.4px` 반경 보너스를 계속 적용했다.
  - 본부장 강조는 색/테두리 의미인데, 크기 의미까지 바꿔 "노드 크기 = 하위 조직 규모" 계약을 깨뜨렸다.
- Why it was missed:
  - 새 테스트가 descendant count 증가/캡만 검증했고, highlighted smaller branch와 unhighlighted dominant root의 상대 크기 순서를 고정하지 않았다.
  - 브라우저 캡쳐에서 김형수 실제 데이터 순위와 canvas radius 순위를 함께 비교하지 않았다.
- Permanent guardrail:
  - descendantCount가 제공되는 graph size mode에서는 반경이 descendant count로만 결정되어야 한다. Highlight/manager/viewer 의미는 fill/stroke/shadow/label로 표현하고 radius boost를 더하지 않는다.
  - 추천인 그래프 크기 변경 시 실제 데이터 상위 descendant 노드와 highlighted smaller branch의 radius ordering 테스트를 추가한다.
- Related files:
  - `web/src/lib/referral-graph-highlight.ts`
  - `web/src/lib/referral-graph-highlight.test.ts`
- Verification:
  - `node --test web/src/lib/referral-graph-highlight.test.ts web/src/lib/referral-graph-descendants.test.ts`
  - `node --test web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-simulation.test.ts`
  - `RUN_REFERRAL_GRAPH_REALDATA_TEST=1 node --test web/src/lib/referral-graph-realdata.test.ts`
  - `cd web; npm run lint`
  - `cd web; SENTRY_AUTH_TOKEN='' npm run build`

## 2026-06-05 | Referral Graph Realdata Test | production force 입력과 realdata helper 입력 drift
- Symptom:
  - 실제 Supabase 그래프 테스트가 같은 production force stack을 검증한다고 기록되어 있었지만, `forceLink.distance`에서 `sourceId`/`targetId`를 넘기지 않아 ID 기반 edge length jitter가 빠졌다.
  - 그 결과 실제 브라우저 Canvas와 realdata regression test의 교차/edge length 수치가 달라질 수 있었다.
- Root cause:
  - production Canvas에 `sourceId`/`targetId` 옵션을 추가한 뒤 realdata test helper를 같은 시점에 동기화하지 않았다.
- Why it was missed:
  - synthetic simulation helper는 이미 동기화되어 있었고, realdata helper도 같은 file family라 같은 계약을 쓴다고 가정했다.
- Permanent guardrail:
  - graph force 옵션을 추가할 때 Canvas, synthetic simulation helper, realdata helper 세 곳을 동시에 비교한다.
  - realdata test는 production-equivalent라는 표현을 쓰려면 `sourceId`/`targetId`, child/subtree counts, collision radius, force constants를 모두 맞춘다.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-realdata.test.ts`
  - `web/src/lib/referral-graph-simulation.test.ts`
- Verification:
  - `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts`
  - `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`

## 2026-06-05 | GaramIn Board Categories | 보험소식 legacy 카테고리를 잘못 가람pick으로 재배치
- Symptom:
  - 사용자는 게시판 글 종류를 `공지`, `교육 일정`, `일반`, `가람pick` 4종으로 제한하고 기존 `보험소식` 글은 `일반`으로 옮기길 원했지만, 기존 4종 정리 migration은 `insurance-news` 글을 `garam-pick`으로 옮기도록 되어 있었다.
- Root cause:
  - 홈 최신 카드에 `가람pick`을 띄워야 한다는 요구와 자동 보험소식 브리핑을 `일반`으로 올려야 한다는 요구를 분리하지 않고, `insurance-news` legacy 정리를 `garam-pick` 노출 요구와 섞었다.
  - category list UI는 4종만 보여도 category create/update/post write 함수는 임의 category를 다시 만들 수 있었다.
- Why it was missed:
  - seed/migration/function/script를 한 계약으로 검증하는 테스트가 없었고, 기존 게시글 재배치 대상과 새 자동 게시 대상의 차이를 명시하지 않았다.
- Permanent guardrail:
  - 게시판 카테고리는 shared canonical list(`공지`, `교육 일정`, `일반`, `상품추천`, `시책`)를 source of truth로 두고, 목록/생성/수정/게시글 작성 경계가 모두 같은 allowlist를 사용한다.
  - 자동 보험소식 브리핑은 `일반/general`에만 게시하고, 홈 최신 카드의 `상품추천` 노출 요구와 섞지 않는다.
  - `lib/__tests__/board-category-contract.test.ts`로 schema, migration, Edge Function, 자동 게시 스크립트의 카테고리 계약을 함께 고정한다.
- Related files:
  - `supabase/functions/_shared/board-categories.ts`
  - `supabase/migrations/20260605000001_set_board_categories_to_four_types.sql`
  - `supabase/schema.sql`
  - `supabase/functions/board-categories-list/index.ts`
  - `supabase/functions/board-category-create/index.ts`
  - `supabase/functions/board-category-update/index.ts`
  - `supabase/functions/board-create/index.ts`
  - `supabase/functions/board-update/index.ts`
  - `scripts/ops/post-insurance-digest.mjs`
  - `lib/__tests__/board-category-contract.test.ts`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath lib/__tests__/board-category-contract.test.ts lib/__tests__/home-latest-notice.test.ts --runInBand`
  - GREEN: `node --test scripts/ops/post-insurance-digest.test.mjs`

## 2026-06-05 | GaramIn Exam Apply | 필수값 누락 이유를 disabled 버튼으로 숨김
- Symptom:
  - FC가 응시료 납입 일자, 시험 일정, 응시 지역, 응시 과목 중 하나를 선택하지 않으면 `시험 신청하기` 버튼이 회색으로 비활성화되어 어떤 항목이 빠졌는지 알 수 없었다.
- Root cause:
  - submit `Pressable`의 `disabled` 조건에 필수 선택값 누락을 포함해, 상세 validation/Alert 경로가 실행되지 않았다.
- Why it was missed:
  - 저장 mutation 내부에는 일부 방어 검증이 있었지만, 모바일 UI에서 버튼 비활성화 상태가 먼저 클릭을 차단하는지 검증하지 않았다.
- Permanent guardrail:
  - 필수 입력 누락은 버튼을 침묵시키지 말고 클릭 가능한 상태에서 누락 항목 목록을 Alert로 안내한다.
  - 제출 버튼의 `disabled`는 중복 제출 방지 같은 실제 실행 불가 상태에만 제한한다.
  - 필수값 메시지 순서는 화면에 보이는 순서 기준 helper/test로 고정한다.
- Related files:
  - `app/exam-apply.tsx`
  - `app/exam-apply2.tsx`
  - `lib/exam-application-validation.ts`
  - `lib/__tests__/exam-application-validation.test.ts`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath lib/__tests__/exam-application-validation.test.ts --runInBand`

## 2026-06-05 | Manager Mobile Notifications | 설계매니저 토큰을 FC/admin broadcast 범위와 섞음
- Symptom:
  - 설계매니저 가람in에 설계 요청과 직접 채팅 외에도 게시판, 공지, 시험 등 불필요한 알림이 많이 도착했다.
- Root cause:
  - request-board 디자이너 세션이 Expo token을 `fc` scope로 등록할 수 있어 FC 전체 broadcast를 같이 받았다.
  - `fc-notify`의 `admin` 대상 broadcast는 `device_tokens.role in ('admin','manager')`를 그대로 포함했고, category 기반으로 manager 모바일 수신 범위를 줄이지 않았다.
  - 모바일 unread 계산도 request-board designer 세션에서 fc-onboarding unread를 live request_board unread와 합산할 수 있었다.
- Why it was missed:
  - 알림 fanout 검증을 FC/admin 중심으로만 보았고, 설계매니저 모바일은 request_board 전용 역할이라는 product scope를 별도 계약 테스트로 고정하지 않았다.
- Permanent guardrail:
  - 설계매니저 모바일 token은 `manager` scope로 저장한다.
  - manager token fanout은 `request_board_*` category 또는 구체적인 `target_id`가 있는 직접 채팅만 허용한다.
  - request-board designer unread는 fc-onboarding unread를 더하지 않고 live request_board unread만 사용한다.
- Related files:
  - `lib/push-registration.ts`
  - `hooks/use-session.tsx`
  - `lib/notifications.ts`
  - `lib/mobile-unread-notification-count-plan.ts`
  - `supabase/functions/fc-notify/index.ts`
  - `supabase/functions/_shared/notification-delivery-policy.ts`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath supabase/functions/_shared/__tests__/notification-delivery-policy.test.ts lib/__tests__/push-registration.test.ts --runInBand`
  - RED/GREEN: `npm test -- --runTestsByPath lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand`

## 2026-06-03 | GaramIn Payment / Subagent Integration | 계획 계약과 실제 live path가 어긋남
- Symptom:
  - 가상계좌 v2 계획은 응시자별 토스 회전식 계좌, stored idempotency, `DEPOSIT_CALLBACK` source of truth, 요청 내부 중복 응시자 차단을 요구했지만 초기 통합 diff에는 발급 idempotency 저장 컬럼이 없고 webhook이 event type과 무관하게 상태를 반영했으며, 중복 차단은 순수 helper/test에만 있고 live submit flow에는 없었다.
  - 모바일 시험 신청 드롭다운도 같은 회차에 여러 응시자가 있을 때 응시자/본인·대리/입금상태를 구분하지 못했다.
- Root cause:
  - 병렬 subagent가 schema, service, mobile UI를 독립적으로 구현했고 coordinator가 초반에는 각 slice의 개별 통과 결과를 계약 전체의 통과로 취급했다.
  - 결제 source-of-truth 조건과 다중 응시자 UX 조건이 live function/UI 경로에서 끝까지 검증되지 않았다.
- Why it was missed:
  - 순수 contract test가 있었지만 실제 `submitExamApplications`/`handleExamPaymentWebhook` 경로가 그 helper를 사용하는지까지 보지 않았다.
  - selector label처럼 "카드 상세에는 정보가 있음"과 "선택 전에도 구분 가능함"을 별도 UX acceptance로 분리하지 않았다.
- Permanent guardrail:
  - PG/webhook 변경은 schema column, service payload, webhook gate, idempotent side effect, live submit preflight를 한 체크리스트로 검증한다.
  - 병렬 subagent 결과는 최종 evaluator에게 current diff 기준으로 재검토시키고, 실패 findings를 해결하기 전 완료로 말하지 않는다.
  - 다중 row/account UI는 카드 상세뿐 아니라 선택 목록 자체에서 대상자를 식별할 수 있어야 한다.
- Related files:
  - `supabase/functions/_shared/exam-payment-service.ts`
  - `supabase/functions/_shared/exam-payment.ts`
  - `supabase/migrations/20260603000001_garamin_ops_upgrade.sql`
  - `supabase/schema.sql`
  - `app/exam-apply.tsx`
  - `app/exam-apply2.tsx`
- Verification:
  - `node --experimental-strip-types --test supabase\functions\_shared\__tests__\exam-payment.test.ts`
  - `node --test supabase\functions\__tests__\exam-payment-schema.contract.test.ts`
  - `npm run lint -- app\exam-apply.tsx app\exam-apply2.tsx app\index.tsx app\home-lite.tsx app\appointment.tsx app\hanwha-commission.tsx app\dashboard.tsx app\docs-upload.tsx app\_layout.tsx lib\fc-workflow.ts`
  - `cd web; npm run lint`
  - `cd web; SENTRY_AUTH_TOKEN='' npm run build`

## 2026-06-03 | Admin Web File Open | 팝업 차단 시 signed URL 발급 전 중단함
- Symptom:
  - 관리자 웹 배포 후 총무가 FC 업로드 파일 `열기`를 눌렀을 때 `브라우저 팝업이 차단되어 파일을 열 수 없습니다` 알림이 떴고 파일이 열리지 않았다.
- Root cause:
  - `handleOpenDoc`가 `window.open` 결과가 `null`이면 즉시 실패 알림을 띄우고 return했다.
  - 이 때문에 브라우저/환경이 새 창을 막는 경우에도 `/api/admin/fc` `signDoc`를 호출하지 않아 같은 탭 fallback으로 파일을 열 기회가 없었다.
- Why it was missed:
  - 이전 테스트는 pending popup이 열리는 정상 경로와 실패 시 close만 고정했고, popup 자체가 차단된 뒤 signed URL을 현재 탭으로 여는 fallback 계약을 포함하지 않았다.
- Permanent guardrail:
  - async signed URL 파일 열기는 popup이 열리면 popup을 이동시키고, popup이 차단되면 signed URL 발급 후 현재 탭을 이동시킨다.
  - `web/src/lib/admin-file-open.test.ts`에 popup-block fallback 계약을 유지한다.
- Related files:
  - `web/src/app/dashboard/page.tsx`
  - `web/src/lib/admin-file-open.ts`
  - `web/src/lib/admin-file-open.test.ts`
- Verification:
  - RED: `node --experimental-strip-types --test src/lib/admin-file-open.test.ts`
  - GREEN: `node --experimental-strip-types --test src/lib/admin-file-open.test.ts src/lib/admin-fc-doc-storage.test.ts`
  - `cd web; npm run lint -- src/lib/admin-file-open.ts src/lib/admin-file-open.test.ts src/app/dashboard/page.tsx src/app/api/admin/fc/route.ts src/lib/admin-fc-doc-storage.ts src/lib/admin-fc-doc-storage.test.ts`
  - `cd web; SENTRY_AUTH_TOKEN='' npm run build`

## 2026-06-03 | Admin Web Parallel Fix | 서브에이전트 변경이 같은 파일의 문구 수정분을 되돌림
- Symptom:
  - 문구 정리 담당 서브에이전트가 `trusted path` 사용자 노출 문구를 고쳤다고 보고했지만, 파일 열기 담당 변경 이후 `web/src/app/dashboard/page.tsx`에 같은 문장이 다시 남아 있었다.
- Root cause:
  - 두 서브에이전트가 같은 대시보드 파일을 독립적으로 수정했고, 후속 파일 열기 patch가 선행 copy cleanup diff를 되돌렸다.
- Why it was missed:
  - 병렬 위임 결과를 그대로 신뢰하면 각 에이전트의 개별 diff만 맞고 통합 diff에서는 한쪽 변경이 사라지는 상태를 놓칠 수 있다.
- Permanent guardrail:
  - 병렬/서브에이전트 작업이 같은 파일을 건드리면 coordinator가 최종 통합 diff와 exact regression search를 다시 수행한다.
  - 사용자-visible 문구 이슈는 최종 source search가 비어야 완료로 본다.
- Related files:
  - `web/src/app/dashboard/page.tsx`
  - `.codex/harness/qa-report.md`
- Verification:
  - `Get-ChildItem web/src -Recurse -Include *.tsx,*.ts | Select-String -Pattern 'trusted path','상태 흐름','동의일\\(Actual\\)'`

## 2026-06-03 | Admin Web File Open | noopener placeholder 창으로 signed URL 이동 대상 참조를 잃음
- Symptom:
  - 업로드 파일 `열기` 복구 patch가 async fetch 전 빈 창을 열도록 바꿨지만, `window.open('', '_blank', 'noopener,noreferrer')`를 사용하면 브라우저가 새 창 참조를 `null`로 반환할 수 있어 팝업 차단으로 오진하거나 이동 대상이 사라질 수 있었다.
- Root cause:
  - 팝업 차단 회피를 위해 사용자 클릭 시점에 창을 열어야 하는 요구와 `noopener` feature가 창 참조를 끊는 브라우저 동작을 함께 고려하지 않았다.
- Why it was missed:
  - 단순히 "async 전에 window.open"만 확인했고, returned window reference가 유지되는지에 대한 계약 테스트가 없었다.
- Permanent guardrail:
  - signed URL처럼 async 준비가 필요한 파일 열기는 클릭 시점에 pending tab을 열고, 참조를 받은 뒤 `opener`를 수동으로 끊고, async 성공 시 그 창을 이동시킨다.
  - 해당 계약은 `web/src/lib/admin-file-open.test.ts`로 고정한다.
- Related files:
  - `web/src/lib/admin-file-open.ts`
  - `web/src/lib/admin-file-open.test.ts`
  - `web/src/app/dashboard/page.tsx`
- Verification:
  - RED: `node --experimental-strip-types --test src/lib/admin-file-open.test.ts`
  - GREEN: `node --experimental-strip-types --test src/lib/admin-file-open.test.ts`

## 2026-06-03 | Mobile Exam Registration | 입력 중인 시험 지역을 저장 payload에서 누락함
- Symptom:
  - 총무가 가람in 모바일 시험 일정 화면에서 신규 시험을 등록하려 할 때 등록이 안 된 것처럼 보였다.
  - 화면에서 지역명을 입력해도 `지역 추가`를 따로 누르지 않으면 저장 payload에 지역이 포함되지 않았고, 신규 시험을 지역 0개로 저장할 수 있었다.
- Root cause:
  - `app/exam-register.tsx`와 `app/exam-register2.tsx`가 `locations` payload를 committed `draftLocations`에서만 만들었다.
  - 입력칸의 pending `locationInput`은 저장 시점에 합쳐지지 않았고, 모바일에는 웹/관리자 경로와 같은 최소 1개 지역 validation이 없었다.
- Why it was missed:
  - 모바일 화면의 "입력 후 바로 저장" 흐름을 별도 계약 테스트로 고정하지 않았다.
  - 기존 검증은 `admin-action` create/delete 가능 여부나 이미 추가된 draft location 중심이라, typed-but-not-added 지역 누락을 잡지 못했다.
- Permanent guardrail:
  - 시험 일정 저장 payload는 committed draft locations와 pending location input을 함께 normalize해서 만든다.
  - 신규 시험 저장은 최소 1개 기존/신규 지역을 요구한다.
  - 생명/손해 시험 등록 화면은 같은 helper/contract test를 공유해 payload drift를 막는다.
- Related files:
  - `app/exam-register.tsx`
  - `app/exam-register2.tsx`
  - `lib/exam-round-location-payload.ts`
  - `lib/__tests__/exam-round-location-payload.test.ts`
- Verification:
  - RED: `npm test -- --runTestsByPath lib/__tests__/exam-round-location-payload.test.ts --runInBand` failed before helper implementation.
  - GREEN: `npm test -- --runTestsByPath lib/__tests__/exam-round-location-payload.test.ts --runInBand`
  - `npm run lint -- app/exam-register.tsx app/exam-register2.tsx lib/exam-round-location-payload.ts lib/__tests__/exam-round-location-payload.test.ts`
  - `npm test -- --runInBand`
  - `npm run lint`
  - `node scripts/ci/check-governance.mjs`

## 2026-06-01 | Sentry Token Operations | 조회용 토큰 대신 upload token을 먼저 사용함
- Symptom:
  - Sentry issue/project 조회를 시작할 때 `SENTRY_AUTH_TOKEN`을 먼저 사용해 org/project read API 권한 부족으로 실패했다.
  - 다른 AI 세션도 같은 변수명 혼동을 반복할 수 있다.
- Root cause:
  - `SENTRY_AUTH_TOKEN`은 release/source-map upload 목적이고, Sentry API 조회에는 `SENTRY_READ_AUTH_TOKEN`이 필요하지만 workspace 지침과 env example에 역할 구분이 충분히 고정되어 있지 않았다.
- Why it was missed:
  - Sentry SDK/build plugin 관례상 `SENTRY_AUTH_TOKEN` 이름이 눈에 먼저 띄었고, read-only investigation token을 우선해야 한다는 guardrail이 문서화되어 있지 않았다.
- Permanent guardrail:
  - Sentry API 조회는 `SENTRY_READ_AUTH_TOKEN`만 사용한다.
  - `SENTRY_AUTH_TOKEN`은 upload/release/source-map 용도로만 취급하고 read fallback으로 쓰지 않는다.
  - local verification build는 필요 시 `SENTRY_AUTH_TOKEN=''`로 upload를 끈다.
- Related files:
  - `E:\hanhwa\AGENTS.md`
  - `.env.example`
  - `README.md`
- Verification:
  - `node scripts/ci/check-governance.mjs`
  - `git diff --check`

## 2026-06-01 | Mobile Alert Actions | runOnJS에 함수 포함 버튼 객체를 넘겨 Alert 버튼 탭 crash
- Symptom:
  - Sentry `REACT-NATIVE-3`에서 Android Hermes fatal `TypeError: Object is not a function`이 38 events / 20 users로 보고됐다.
  - 최신 이벤트는 release `fc-onboarding-app@3.1.12`, dist `45`였고, alert modal 내부 touch 직후에 발생했다.
- Root cause:
  - `AppAlertProvider`가 Reanimated `runOnJS(onButtonPress)`로 `onPress` 함수를 포함할 수 있는 alert button 객체 전체를 넘겼다.
  - JS 복귀 후에는 `button.onPress` truthiness만 보고 호출해, worklet 경계를 지나며 non-callable로 변한 값도 함수처럼 호출할 수 있었다.
- Why it was missed:
  - 기존 AppAlertProvider 계약 테스트는 아이콘 asset 회귀만 확인했고, runOnJS payload serializability와 callable guard는 고정하지 않았다.
  - Sentry 이벤트에 `js_no_source`가 떠 실제 source frame 확인이 늦어졌다.
- Permanent guardrail:
  - Reanimated `runOnJS`에는 primitive id/index 같은 serializable payload만 넘기고, 함수/객체 해석은 JS side에서 다시 한다.
  - alert action 호출은 항상 `typeof onPress === 'function'`으로 가드한다.
  - AppAlertProvider 계약 테스트에 runOnJS index payload와 callable guard를 유지한다.
- Related files:
  - `components/AppAlertProvider.tsx`
  - `components/app-alert-utils.ts`
  - `components/__tests__/AppAlertProvider.contract.test.ts`
- Verification:
  - `npm test -- --runTestsByPath components/__tests__/AppAlertProvider.contract.test.ts --runInBand`
  - `npm run lint`
  - `npm test -- --runInBand`
  - `SENTRY_AUTH_TOKEN='' npm run build`

## 2026-05-31 | Admin Web Route Smoke | redirect-following smoke로 public route 보호 회귀를 놓침
- Symptom:
  - harness에는 `/reset-password` production smoke가 200으로 기록돼 있었지만, redirect를 따르지 않는 현재 smoke에서는 `/reset-password`가 307로 `/auth`에 redirect됐다.
  - 비밀번호 변경 화면은 `/auth`에서 진입하는 public flow인데 middleware public path에 포함되지 않아 비로그인 사용자가 직접 열 수 없었다.
- Root cause:
  - `web/middleware.ts`의 public route list가 `/auth`, `/invite`, favicon/manifest만 포함하고 `/reset-password`를 빠뜨렸다.
  - 이전 HTTP smoke가 redirect follow 여부를 명확히 고정하지 않아 최종 `/auth` 200을 `/reset-password` 200처럼 기록할 수 있었다.
- Why it was missed:
  - route accessibility smoke에서 redirect status와 `Location` header를 따로 확인하지 않았다.
  - password reset이 auth page에서 출발하지만 비로그인 public route여야 한다는 계약을 middleware-level characterization으로 고정하지 않았다.
- Permanent guardrail:
  - protected/public route smoke는 redirect를 따르지 않고 status + `Location`을 함께 기록한다.
  - admin web public paths는 shared helper와 direct Node characterization test로 관리한다.
  - password reset, invite, auth처럼 비로그인 entrypoint인 route는 middleware public-path 테스트에 포함한다.
- Related files:
  - `web/middleware.ts`
  - `web/src/lib/admin-web-public-paths.ts`
  - `web/src/lib/admin-web-public-paths.test.ts`
  - `.codex/harness/current-contract.md`
- Verification:
  - RED: `node --experimental-strip-types --test web/src/lib/admin-web-public-paths.test.ts` failed before helper implementation with `ERR_MODULE_NOT_FOUND`.
  - GREEN: the same test passed after helper implementation.
  - No-redirect production smoke after fix: `/reset-password=200`, `/auth=200`, `/dashboard=307 location=/auth`.

## 2026-05-30 | Coverage Verification | exit 0만 보고 coverage 수집 오류를 놓칠 수 있음
- Symptom:
  - `npm run test:coverage -- --runInBand`가 exit 0으로 끝났지만, 출력에는 TSX JSX/Babel coverage collection error와 `hooks/use-my-referral-code.ts` 타입 collection error가 함께 있었다.
  - exit code만 보면 coverage가 정상이라고 오판할 수 있었다.
- Root cause:
  - root Jest는 Expo/Babel test transform으로 통과하지만 coverage collection은 별도 instrumentation 경로를 타며, 기존 provider가 일부 TSX/TS source를 깨끗하게 수집하지 못했다.
- Why it was missed:
  - 검증 명령 성공 여부를 exit code 중심으로만 보려는 습관이 있었고, coverage output의 collection errors를 별도 실패 신호로 취급하지 않았다.
- Permanent guardrail:
  - coverage 명령은 exit code뿐 아니라 output의 `Failed to collect coverage`, parser/type error, skipped instrumentation warning까지 읽고 기록한다.
  - `npm run test:coverage -- --runInBand`는 V8 coverage provider 유지 여부까지 함께 확인한다.
- Related files:
  - `jest.config.js`
  - `.codex/harness/current-contract.md`
  - `.codex/harness/qa-report.md`
  - `.claude/MISTAKES.md`
- Verification:
  - Before fix: `npm run test:coverage -- --runInBand` exited 0 but emitted coverage collection errors.
  - After fix: `coverageProvider: 'v8'` added to `jest.config.js`.
  - After fix: `npm run test:coverage -- --runInBand` passed 29 suites / 185 tests with no prior coverage collection errors.

## 2026-05-30 | Next.js Web Build | Production source에 `.ts` 확장자 상대 import를 사용함
- Symptom:
  - `web` build가 TypeScript 단계에서 `An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled` 오류로 실패했다.
  - 실패 지점은 새 production helper `web/src/lib/resident-number-edge-executor.ts`의 `./resident-number-edge-fallback.ts` / `./resident-number-edge-response.ts` import였다.
- Root cause:
  - Node `--experimental-strip-types` 기반 characterization test는 test 파일에서 `.ts` 확장자 import가 필요하지만, 같은 패턴을 production source에 적용하면 Next.js/TypeScript build 규칙과 충돌한다.
- Why it was missed:
  - 대상 lint와 direct Node tests만 먼저 통과했고, production source import 경로가 TypeScript build에서 별도로 검증된다는 차이를 build 실행 전까지 확인하지 못했다.
- Permanent guardrail:
  - `.ts` 확장자 import는 direct Node test 파일에만 사용한다.
  - Production source는 extensionless/alias import를 유지하거나, Node test compatibility가 필요하면 production helper가 의존성을 주입받도록 분리한다.
  - 새 production helper가 다른 TS helper를 import할 때는 targeted lint만으로 마감하지 말고 가능한 범위에서 `web` build 또는 typecheck를 함께 실행한다.
- Related files:
  - `web/src/lib/resident-number-edge-executor.ts`
  - `web/src/lib/resident-number-edge-executor.test.ts`
  - `web/src/lib/server-resident-numbers.ts`
  - `.claude/MISTAKES.md`
- Verification:
  - Before fix: `cd web; npm run build` failed at `resident-number-edge-executor.ts` `.ts` import path.
  - After fix: executor receives request/response helpers as dependencies; `server-resident-numbers.ts` injects existing helpers through production-safe imports.
  - After fix: `cd web; npm run build` passed.

## 2026-05-26 | Insurance Digest Automation | WindowsApps PowerShell 버전 경로를 예약 작업에 고정함
- Symptom:
  - 2026-05-22 이후 `보험소식 브리핑` 자동화 산출물과 게시글이 생성되지 않았다.
  - Windows Task Scheduler는 2026-05-26 11:05 KST에 실행을 시도했지만 `LastTaskResult=2147942402`로 실패했다.
- Root cause:
  - 예약 작업 action이 `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe`처럼 특정 PowerShell Store package 버전 경로를 직접 가리켰다.
  - 로컬 PowerShell이 7.6.2로 업데이트되면서 7.6.1 경로가 사라졌고, Task Scheduler가 스크립트 시작 전 `file not found`로 종료했다.
- Why it was missed:
  - 2026-05-19에 `pwsh.exe` 사용만 가드레일로 남기고, WindowsApps의 versioned package path가 업데이트 때 사라진다는 점을 별도 acceptance로 고정하지 않았다.
  - 예약 작업 등록 뒤 다음 날 실제 `LastRunTime`, `LastTaskResult`, `.codex-tmp/insurance-digest/YYYY-MM-DD.*`, DB 게시글까지 묶어서 확인하지 않았다.
- Permanent guardrail:
  - Task Scheduler action에는 WindowsApps versioned package path를 저장하지 않는다. 사용자별 alias(`%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`)나 별도 안정 wrapper 경로만 사용한다.
  - PowerShell/Codex/Windows 업데이트 후에는 `Test-Path`로 action executable을 확인하고, `-DryRun`과 수동 trigger를 같이 실행한다.
  - 자동화 성공 보고 전에는 Task Scheduler 결과, 당일 artifact 생성, 당일 board post 존재를 모두 확인한다.
- Related files:
  - `scripts/ops/run-insurance-digest-codex.ps1`
  - `.codex-tmp/insurance-digest/*`
  - Windows Task Scheduler `GaramIn Insurance Digest Codex Fallback`
  - `.claude/MISTAKES.md`
- Verification:
  - Before fix: `LastTaskResult=2147942402`, old `pwsh.exe` path `Test-Path=False`
  - Updated action: `C:\Users\jj812\AppData\Local\Microsoft\WindowsApps\pwsh.exe`
  - `run-insurance-digest-codex.ps1 -DryRun` succeeded through the new executable and resolved `codex.cmd`

## 2026-05-22 | Board Create Notifications | 로컬 최신 board-create를 배포하지 않아 자동 게시 push fanout이 빠짐
- Symptom:
  - 2026-05-22 보험소식 브리핑은 자동 게시됐고 알림센터 row도 생성됐지만 앱 push 알림이 오지 않았다.
- Root cause:
  - 원격 `board-create` Edge Function 배포본이 로컬 최신 코드와 달랐다.
  - 라이브 DB에 생성된 notification title이 로컬 코드의 `새 게시글`이 아니라 이전 배포본의 `New board post`로 저장되어, 원격 함수가 `fc-notify` push fanout 연결 전 코드였음이 확인됐다.
- Why it was missed:
  - 로컬 코드와 테스트만 보고 `board-create` fanout이 운영에 적용됐다고 판단했고, 실제 원격 함수 배포본의 행위까지 smoke하지 않았다.
- Permanent guardrail:
  - board notification/fanout 수정 후에는 반드시 해당 Edge Function을 배포하고, 라이브 게시글 1건 기준으로 `notifications.target_url`, notification title, FC/admin push fanout 결과를 함께 확인한다.
  - 이미 게시된 보험 브리핑의 push 재발송은 `fc-notify`에 `skip_notification_insert: true`를 넣어 알림센터 row 중복 없이 수행한다.
- Related files:
  - `supabase/functions/board-create/index.ts`
  - `supabase/functions/fc-notify/index.ts`
  - `.claude/MISTAKES.md`
- Verification:
  - live DB: `보험소식 브리핑 2026.05.22` post `163d9aae-395f-4ba4-af3c-7d6d9535ec16`와 FC/admin/manager notification rows 확인
  - `supabase functions deploy board-create --project-ref ubeginyxaotcamuqpmud`
  - manual `fc-notify` push retry with `skip_notification_insert: true`: FC 195 tokens ok, admin/manager 69 tokens ok, admin web push 3 sent / 0 failed

## 2026-05-21 | Board Update Notifications | 게시글 생성과 수정의 알림 계약을 따로 관리함
- Symptom:
  - 게시판 글을 수정해도 FC/admin 알림센터 row와 push fanout이 발생하지 않았다.
- Root cause:
  - `board-create`에는 notification row insert와 `fc-notify` fanout이 있었지만, `board-update`는 게시글 수정만 하고 알림 경로가 없었다.
- Why it was missed:
  - 게시글 알림 검증이 신규 작성 경로 중심이었고, 수정 경로가 같은 독자 알림 계약을 가져야 한다는 contract test가 없었다.
- Permanent guardrail:
  - board write function을 추가하거나 바꿀 때는 inbox row persistence, `fc-notify` push fanout, `/board-detail?postId=...` target URL을 함께 검증한다.
  - `board-update` fanout 존재를 고정하는 contract test를 유지한다.
- Related files:
  - `supabase/functions/board-update/index.ts`
  - `supabase/functions/__tests__/board-update-notification.contract.test.ts`
  - `docs/handbook/backend/notifications-inbox-push.md`
  - `docs/handbook/backend/board-api-and-notice-model.md`
- Verification:
  - `npm test -- --runTestsByPath supabase/functions/__tests__/board-update-notification.contract.test.ts --runInBand`
  - `supabase functions deploy board-update --project-ref ubeginyxaotcamuqpmud`

## 2026-05-19 | Insurance Digest Automation | Windows fallback를 실제 Task Scheduler 환경과 Codex CLI 버전에 맞춰 검증하지 않음
- Symptom:
  - PC가 켜져 있었는데도 2026-05-19 11:05 KST Windows fallback이 `LastTaskResult=1`로 실패했고 보험 브리핑이 자동 게시되지 않았다.
  - 수동 재실행 중에도 기존 작업은 `powershell.exe`가 UTF-8 한글 prompt를 깨뜨리고, Codex CLI 실행이 오래 `Running`으로 남을 수 있었다.
- Root cause:
  - `run-insurance-digest-codex.ps1`가 현재 Codex CLI `0.101.0`에 없는 `--search` 플래그를 계속 넘겼다.
  - Task Scheduler action이 Windows PowerShell 5.x(`powershell.exe`)라 UTF-8 BOM 없는 `.ps1`의 한글 prompt를 ANSI로 읽었다.
  - 이미 같은 날짜 게시글이 있어도 중복 확인을 Codex prompt에 맡겨 불필요하게 Codex CLI를 띄웠다.
- Why it was missed:
  - `-DryRun`만 확인하고 실제 Task Scheduler action의 실행 파일, encoding, unsupported CLI flag를 함께 smoke하지 않았다.
  - Codex app cron과 Windows fallback을 같은 성공 기준으로 검증하지 않고, "예약 등록됨"을 "게시 경로 검증됨"으로 과대 해석했다.
- Permanent guardrail:
  - Windows 예약 작업은 `pwsh.exe`로 실행하고, script 상단에서 UTF-8 output encoding을 명시한다.
  - Codex CLI 플래그는 `codex exec --help` 기준으로 smoke하고, unsupported flag가 있으면 fallback 등록 전 제거한다.
  - 같은 날짜 글 존재 여부는 AI 실행 전 Node precheck(`--check-existing`)로 먼저 확인해, 이미 게시된 날에는 Codex를 띄우지 않는다.
- Related files:
  - `scripts/ops/run-insurance-digest-codex.ps1`
  - `scripts/ops/post-insurance-digest.mjs`
  - `scripts/ops/post-insurance-digest.test.mjs`
  - `.claude/MISTAKES.md`
- Verification:
  - `codex exec --help`
  - `node --test scripts/ops/post-insurance-digest.test.mjs`
  - `npm run ops:post-insurance-digest -- --check-existing`
  - Windows Task Scheduler manual run returned `LastTaskResult=0` with `precheck-2026-05-19.json`

## 2026-05-18 | Insurance Digest Automation | Codex cron 실행 여부와 remote migration drift를 별도로 감시하지 않음
- Symptom:
  - 2026-05-18 08:30 KST 보험 브리핑 자동 게시가 다시 실행되지 않아 오늘 게시글이 없었다.
  - 수동 게시 후에도 `board-create`가 넣어야 하는 알림 row가 비어 있었고, FC/admin 알림은 별도 `fc-notify` 수동 호출로 보강해야 했다.
- Root cause:
  - Codex app cron은 오늘 08:30 KST 이후 새 session/payload 흔적이 없어 스케줄 자체가 기대 시간에 시작되지 않았다.
  - 원격 DB의 `notifications_recipient_role_check`가 아직 `manager`를 허용하지 않아, `board-create`의 FC/admin/manager 3건 batch insert가 `manager` row에서 전부 rollback됐다.
- Why it was missed:
  - 자동화 생성/수정 뒤 다음날 "스케줄이 실제로 시작됐는가"를 별도 heartbeat나 OS-level fallback으로 감시하지 않았다.
  - `schema.sql`에는 `manager` 허용이 반영돼 있었지만 대응 migration이 없어 원격 제약과 local schema가 drift난 것을 live board post smoke 전까지 잡지 못했다.
- Permanent guardrail:
  - 보험 브리핑은 11:30 KST 기준으로 게시글, `latest_notice`, FC/admin `inbox_list`를 함께 확인한다.
  - Codex app cron만 믿지 않고 Windows Task Scheduler / Codex CLI fallback을 11:05 KST에 둔다.
  - notification role/check constraint 변경은 반드시 migration으로 남기고 remote debug insert로 검증한다.
- Related files:
  - `scripts/ops/run-insurance-digest-codex.ps1`
  - `supabase/migrations/20260518000001_allow_manager_notifications.sql`
  - `docs/handbook/operations-runbook.md`
  - `.codex/harness/qa-report.md`
- Verification:
  - 2026-05-18 manual post `bbb63250-c3ee-409b-80bf-139927d675a1`
  - remote `latest_notice` and FC/admin `inbox_list`
  - `supabase db push --linked --yes`
  - post-migration direct FC/admin/manager debug insert and cleanup
  - Windows scheduled task registration/reschedule and `scripts/ops/run-insurance-digest-codex.ps1 -DryRun`

## 2026-05-17 | Insurance Digest Board/Home/Push | live smoke에서 UI/notification 계약까지 확인하지 않음
- Symptom:
  - 2026-05-17 보험 브리핑 게시글 본문에 긴 raw URL과 AI 참고용/비자문 문구가 보여 사용자 요구와 맞지 않았다.
  - 게시글 링크 터치와 홈 최신 공지에서 게시판 상세로 들어간 뒤 X 닫기 crash가 보고됐다.
  - 첫 live post는 FC/admin 알림 row와 홈 최신 공지 노출이 확인되지 않았고, FC push는 Expo 100개 payload 제한에 걸렸다.
- Root cause:
  - 게시 성공/중복 skip만 확인하고, 실제 앱 상세 화면의 link rendering, home route, notification row, Expo push response를 같은 smoke 범위로 묶지 않았다.
  - `latest_notice`는 `notice` board category만 포함했고 `insurance-news`를 포함하지 않았다.
  - `board_notice:` route가 `/board?postId=` modal path로 들어가며 modal close의 `router.replace('/board')`가 `beforeRemove` listener와 충돌할 수 있었다.
  - `fc-notify`는 Expo push payload를 100개 단위로 나누지 않았다.
- Why it was missed:
  - 자동 게시 파일럿의 검증 기준이 backend posting script 중심이었고, 모바일 홈/상세 UI와 push transport 제한까지 포함하지 않았다.
  - 원문 URL을 `sourceUrls` 검증용 데이터와 visible board content로 동시에 취급했다.
- Permanent guardrail:
  - 보험 브리핑 live smoke는 `board-detail` content, `latest_notice`, FC/admin `inbox_list`, Expo push result를 모두 확인한다.
  - visible board content에는 raw URL과 AI 참고용/비자문 disclaimer를 넣지 않는다. 원문 URL은 `sourceUrls` payload에만 둔다.
  - board notice home routes는 standalone `/board-detail` path를 우선 사용한다.
  - push fanout 코드는 Expo 100 payload/request 제한을 지켜 chunk 전송한다.
- Related files:
  - `scripts/ops/post-insurance-digest.mjs`
  - `supabase/functions/fc-notify/index.ts`
  - `app/index.tsx`
  - `app/board.tsx`
  - `lib/notice-route.ts`
  - `components/LinkifiedSelectableText.tsx`
- Verification:
  - `node --test scripts/ops/post-insurance-digest.test.mjs`
  - `npm test -- --runTestsByPath lib/__tests__/external-url.test.ts lib/__tests__/notice-route.test.ts lib/__tests__/home-latest-notice.test.ts --runInBand`
  - remote `board-detail`, `latest_notice`, `inbox_list`, and chunked FC push retry checks

## 2026-05-17 | Codex Insurance Digest Automation | runner 실패를 게시 성공과 혼동할 수 있는 자동화 계약
- Symptom:
  - 첫 보험 브리핑 자동화가 digest와 출처를 만들었지만 게시 스크립트를 실행하지 못해 게시판에는 글이 없었다.
  - 자동화 결과만 보면 요약문이 생성되어 게시 완료처럼 오해할 수 있었다.
- Root cause:
  - Codex Desktop background runner에서 `CreateProcessAsUserW failed: 1312`가 발생해 `pwd`와 게시 스크립트 실행이 모두 실패했다.
  - 기존 prompt는 inline JSON 명령만 강조했고, shell 실행 실패를 업로드 실패로 명시 보고하라는 guardrail이 약했다.
- Why it was missed:
  - 자동화 생성 직후 production smoke posting을 하지 않았고, 첫 background run의 shell 실행 가능성을 별도로 확인하지 않았다.
  - 게시판 조회 결과와 자동화 세션 로그를 대조하기 전까지 "요약 생성"과 "게시 완료"가 분리되어 있었다.
- Permanent guardrail:
  - Codex 게시 자동화는 대형 JSON을 shell inline 인자로 넘기지 말고 `.codex-tmp/` payload 파일 + `--input-file`을 사용한다.
  - 자동화가 shell runner failure를 만나면 반드시 blocker로 보고하고, 게시 성공으로 표현하지 않는다.
  - 첫 실행 또는 prompt 변경 뒤에는 게시판 중복-skip 확인까지 포함해 smoke 검증한다.
- Related files:
  - `scripts/ops/post-insurance-digest.mjs`
  - `.codex/harness/qa-report.md`
  - `.codex/harness/handoff.md`
  - `docs/handbook/operations-runbook.md`
- Verification:
  - `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/2026-05-17.json`
  - 동일 명령 재실행 시 `status: skipped`

## 2026-04-26 | Admin Referral Graph | 체크리스트 미완료 상태를 완료처럼 보고함
- Symptom:
  - 사용자가 추천인 그래프의 모든 체크리스트를 완벽히 검수했는지 확인했을 때, 실제로는 cluster/orphan 분포 simulation이 실패하고 있었는데 완료처럼 응답했다.
  - harness와 referral incident 문서도 v7 four-force reset 기준의 pass 상태로 남아, 현재 v14 hybrid force 구현과 남은 실패를 반영하지 못했다.
- Root cause:
  - nonblank canvas, 일부 helper unit test, targeted lint 통과를 전체 graph UX acceptance 통과로 확대 해석했다.
  - 브라우저 피드백과 simulation failure를 문서/QA 상태에 즉시 반영하지 않아, "완료"와 "부분 통과"가 섞였다.
- Why it was missed:
  - 체크리스트를 단일 source of truth로 유지하지 않고, 수동 시각 확인과 개별 테스트 결과를 따로 기억했다.
  - `web/src/lib/referral-graph-simulation.test.ts` 실패를 남긴 상태에서 docs/harness의 완료 문구를 먼저 닫았다.
- Permanent guardrail:
  - graph 작업은 `qa-report.md`에 pass/fail을 분리 기록하고, 하나라도 실패하면 최종 답변에서 "완료"라고 쓰지 않는다.
  - `web/src/lib/referral-graph-simulation.test.ts`가 실패하면 cluster separation, isolated shell, drag edge stretch 체크리스트는 미완료로 둔다.
  - 문서화/커밋 전에는 `docs`, `.codex/harness`, `.claude`가 현재 구현의 storage key/force list/test status와 맞는지 검색으로 확인한다.
- Related files:
  - `web/src/lib/referral-graph-simulation.test.ts`
  - `.codex/harness/qa-report.md`
  - `.codex/harness/handoff.md`
  - `.claude/MISTAKES.md`
- Verification:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-simulation.test.ts`

## 2026-04-25 | Admin Referral Graph | Obsidian 동등성 요구에 custom force를 계속 쌓아 기본 물리를 흐림
- Symptom:
  - 사용자가 Obsidian Graph View처럼 안정적이고 예측 가능한 force-directed graph를 요구했지만, 이전 구현은 component collision, hub fanout, degree-aware link, branch-aware bridge, drop tether를 계속 추가해 drag/release와 final layout이 사용자 기대와 다르게 흔들렸다.
  - 최종적으로 `node not found` browser runtime 오류까지 확인됐다. 원인은 새 `forceLink(graphData.links)`를 직접 만들며 `react-force-graph` 내부 노드 배열과 링크 endpoint가 어긋난 것이었다.
- Root cause:
  - Obsidian 동등성 요청을 "비슷한 모양을 만드는 보정 force"로 해석했고, 실제 Obsidian식 public contract인 `Center force`, `Repel force`, `Link force`, `Link distance` 네 설정 중심으로 되돌리는 결정을 늦게 했다.
  - 기존 internal link force를 설정해야 하는 자리에서 새 d3 link force를 주입해 library 내부 simulation lifecycle과 충돌했다.
- Why it was missed:
  - 개별 증상(parent ring, group gap, branch child)을 각각 조건 추가로 해결하려 했고, "최소 force law로 설명되는가"를 pass/fail 기준에 두지 않았다.
  - nonblank canvas/browser smoke는 custom force 누적의 UX 불안정과 internal link mismatch를 충분히 잡지 못했다.
- Permanent guardrail:
  - Obsidian 동등성만 명시된 referral graph 작업에서는 runtime force를 기본적으로 `charge/link/x/y` 네 개로 제한한다.
  - 사용자가 cluster 구분, parent-child pinwheel, drag edge stretch 제한처럼 별도 shape guarantee를 우선하면 v14처럼 hybrid helper force를 사용할 수 있지만, current contract/docs/test checklist에 force 목록과 금지 항목을 먼저 반영한다.
  - `react-force-graph-2d`에서는 기존 internal `link` force를 가져와 설정만 바꾸고, 새 `forceLink(graphData.links)`를 임의로 주입하지 않는다.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-layout.ts`
  - `web/src/app/dashboard/referrals/graph/page.tsx`
  - `.claude/MISTAKES.md`
- Verification:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-edges.test.ts web/src/lib/referral-graph-display.test.ts web/src/lib/referral-graph-highlight.test.ts`
  - `cd web && npm run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/app/dashboard/referrals/graph/page.tsx src/lib/referral-graph-physics.ts src/lib/referral-graph-layout.ts src/types/referral-graph.ts src/types/d3-force.d.ts`
  - `cd web && npm run build`
  - Browser QA screenshot: `.codex/harness/referral-graph-obsidian-v7-browser-qa.png`

## 2026-04-25 | Admin Referral Graph | directed hierarchy를 무시한 degree-only edge length로 branch child ring 공간을 놓침
- Symptom:
  - 자식을 가진 자식 노드가 leaf sibling과 같은 edge length로 묶여, 중간 부모 주변의 하위 노드 ring이 부모/형제 edge와 섞이며 깨져 보였다.
  - 실제 브라우저 synthetic nested tree에서 최초 자동 fit도 너무 이른 시점에 잡혀, 안정화 후 graph가 캔버스 하단으로 밀리는 문제가 함께 드러났다.
- Root cause:
  - `getReferralGraphLinkForceConfig(...)`가 `sourceDegree/targetDegree`만 보고 link target distance를 계산해, target node가 다시 children을 가진 branch인지 구분하지 못했다.
  - 초기 seed도 같은 child ring radius를 leaf child와 branch child에 적용해 branch subtree가 펼쳐질 bridge 공간을 예약하지 않았다.
  - 최초 fit은 seed 기준으로 한 번만 잡혀, link/charge/fanout 안정화 뒤 넓어진 bounds를 다시 반영하지 못했다.
- Why it was missed:
  - parent-child ring 테스트가 "부모 주변 자식"까지만 다뤘고, `parent -> branch child -> grandchildren` 형태의 nested branch simulation/browser QA가 없었다.
  - 브라우저 QA를 nonblank 중심으로만 보면 화면 하단으로 밀린 bounds나 branch/leaf edge length 차이를 놓칠 수 있다.
- Permanent guardrail:
  - 추천인 그래프 link distance는 directed hierarchy metadata(`sourceOutDegree`, `targetOutDegree`, in-degree)를 함께 받아야 한다.
  - direct child가 다시 children을 가진 branch node이면 leaf sibling보다 긴 bridge target distance를 가져야 하며, layout seed도 같은 법칙으로 공간을 예약해야 한다.
  - 브라우저 QA는 synthetic nested branch graph를 띄우고, 수동 `화면 맞춤` 없이 node pixel bounds가 캔버스 안에 들어오는지 확인한다.
- Related files:
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/lib/referral-graph-layout.ts`
  - `web/src/lib/referral-graph-layout.test.ts`
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `.claude/MISTAKES.md`
- Verification:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-layout.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-edges.test.ts`
  - Browser QA screenshot: `.codex/harness/referral-graph-nested-branch-auto-fit-qa.png`

## 2026-04-25 | Admin Referral Graph | parent-child 원형을 별도 absolute ring force로 보정해 Obsidian식 core force 계약을 흐림
- Symptom:
  - 상위 노드 주변에 하위 노드가 원형처럼 보이길 원했지만, 실제 화면에서는 여전히 일부 하위 노드가 부모에게 너무 붙거나 선형으로 보였다.
  - 이전 수정은 `parent-ring` 보정 force를 추가했지만, 사용자가 기대한 Obsidian식 link/repel/center 중심 물리와 다르게 별도 목표점 force가 runtime 모양을 따로 지배할 수 있었다.
- Root cause:
  - 부모-자식 spoke의 d3 link target distance 자체가 약 96px 수준으로 짧아 이름 label이 있는 관리자 화면에서 원형 구조로 읽히기 어려웠다.
  - 핵심 link spring을 label-readable 거리로 고치기보다 parent-ring force를 덧붙여 증상을 보정하려 했다.
- Why it was missed:
  - "하위 노드가 원형으로 보인다"는 요구를 link force 계약으로 환원하지 않고, 별도 모양 유지 force로 처리했다.
  - 테스트도 parent-ring force 존재를 통과 조건으로 삼아 Obsidian식 core force 모델과 멀어지는 것을 잡지 못했다.
- Permanent guardrail:
  - Graph View식 물리는 먼저 `center/repel/link/linkDistance/alpha` core force로 설명 가능한지 확인한다.
  - 부모-자식 star 반경은 d3 link force의 target distance가 책임져야 하며, angular separation은 edge 겹침을 줄이는 보조 additive force로만 둔다.
  - 별도 absolute node target force를 추가할 때는 기존 link spring을 우회하거나 이기지 않는지 테스트에 "absolute ring/tether 없이 core forces만으로 유지" 케이스를 넣는다.
- Related files:
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `.claude/MISTAKES.md`
- Verification:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-edges.test.ts`

## 2026-04-25 | Admin Referral Graph | parent-child 원형 요구를 seed 테스트만으로 닫아 runtime force에서 풀리는 문제를 놓침
- Symptom:
  - 사용자는 하위 노드가 상위 노드를 원형으로 둘러싸길 원했지만, 실제 브라우저에서는 몇 초 안정화 후 하위 노드가 한쪽으로 늘어진 일반 force layout처럼 보였다.
  - 첨부 화면에서 `문주화`, `김인경` 주변 하위 노드가 상위 노드 주변 원형 ring이 아니라 선형/편향 cluster로 멈췄다.
- Root cause:
  - `referral-graph-layout`에서 초기 seed만 parent-centered ring으로 만들었고, 런타임 d3 force에는 그 ring을 유지하는 parent-child force가 없었다.
  - 기존 hub fanout도 undirected adjacency를 써서 상위 노드가 하위 hub의 neighbor로 같이 밀리는 역방향 왜곡을 만들 수 있었다.
- Why it was missed:
  - 회귀 테스트가 layout helper의 초기 좌표만 검증했고, d3 force 안정화 후의 실제 화면 계약을 검증하지 않았다.
  - synthetic browser QA도 canvas nonblank 위주였고, parent-child ring 유지 자체를 force-level acceptance로 고정하지 않았다.
- Permanent guardrail:
  - graph layout UX 요구는 seed 좌표 테스트만으로 닫지 않는다. 안정화 후에도 유지돼야 하는 모양이면 d3 custom force 테스트를 함께 추가한다.
  - 추천인 그래프의 fanout/ring force는 directed `source -> target` edge를 기본으로 삼고, 특별한 이유 없이 undirected adjacency를 쓰지 않는다.
  - 브라우저 QA에서 보이는 구조 요구는 pixel nonblank 외에 force helper 계약 또는 geometry assertion으로 보강한다.
- Related files:
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `.claude/MISTAKES.md`
- Verification:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-edges.test.ts`

## 2026-04-23 | Codex App / Visible Browser Demo | 이미 열린 IAB 탭을 이 Windows 세션에서 직접 조작할 수 있다고 사용자 기대를 충분히 일찍 정리하지 않음
- Symptom:
  - 사용자는 Codex 앱 안의 현재 IAB 화면이 내가 직접 움직이는 것처럼 보이길 원했지만, 나는 별도 자동화 세션과 IAB 직접 제어를 여러 번 구분 설명해야 했다.
  - 결과적으로 테스트는 됐어도, "같은 화면을 내가 직접 움직인다"는 기대와 실제 가능한 경로 사이에 마찰이 생겼다.
- Root cause:
  - 현재 Windows Codex 세션에는 이미 열린 IAB pane을 agent가 직접 클릭하는 툴 훅이 없는데, 이 제약과 대체 경로를 초기에 더 선명하게 못 박지 않았다.
  - visible demo 요구를 받았을 때, 먼저 "IAB 직접 제어 불가 / 별도 headed browser 가능"을 즉시 실행 계획으로 고정하지 않았다.
- Why it was missed:
  - `localhost:3200`을 실제로 조작 가능한지 확인하는 쪽에 집중하면서, 사용자 관점의 "같은 화면에서 보여야 한다"는 기대를 도구 경계 기준으로 먼저 명확히 정리하지 못했다.
- Permanent guardrail:
  - Windows Codex 세션에서 사용자가 "내가 보는 화면을 네가 직접 움직여라"라고 요청하면, 먼저 현재 IAB direct-control 훅 유무를 분명히 말한다.
  - direct IAB control이 없으면 바로 `headed Playwright visible window against the same localhost URL`를 대안으로 제시하고, 그 차이를 한 문장으로 고정한다.
  - visible demo를 재현할 때는 `slowMo`와 명시적 대기 시간을 넣어 사용자가 실제 클릭 흐름을 눈으로 볼 수 있게 한다.
- Related files:
  - `.codex/harness/qa-report.md`
  - `.codex/harness/handoff.md`
  - `.claude/MISTAKES.md`
- Verification:
  - `http://localhost:3200/login` headed Playwright visible run
  - `회원가입` 클릭 후 `/signup`
  - `비밀번호 변경하기` 클릭 후 `/reset-password`

## 2026-04-23 | Codex App / Windows Run Wiring | `bash`가 곧 Git Bash일 것이라고 가정하고, 포트 점유 확인도 IPv4 localhost만 봐서 local preview wiring을 두 번 틀림
- Symptom:
  - Codex run action을 `bash ./script/build_and_run.sh`로 묶었더니 이 Windows 세션에서는 `bash`가 Git Bash가 아니라 WSL shim을 가리켜 바로 실패했다.
  - 그 다음엔 Expo web startup을 자동 포트 선택으로 고쳤다고 생각했지만, 8081을 `::`에 잡고 있는 기존 `node` listener를 IPv4 `127.0.0.1` probe가 놓쳐서 non-interactive port prompt에 다시 걸렸다.
- Root cause:
  - Windows에서 `bash` resolution을 실제 경로로 검증하지 않고 일반 Unix-like 전제를 그대로 적용했다.
  - free-port detection을 `127.0.0.1` bind로만 검사해 system-wide/IPv6 listener 충돌을 잡지 못했다.
- Why it was missed:
  - run-action wiring을 문서 reference 그대로 적용하면 될 것이라 보고, 이 머신의 shell resolution과 현재 listen socket 상태를 먼저 점검하지 않았다.
- Permanent guardrail:
  - Windows에서 Codex run action을 만들 때는 `Get-Command bash` 결과를 먼저 확인하고, WSL shim이면 Git Bash 절대경로를 action command에 쓴다.
  - Expo/Metro free-port detection은 IPv4 localhost만 보지 말고 system-wide bind 기준으로 검사한다.
  - screenshot-style Codex demo를 재현하려면 native emulator보다 `Run Web + Browser pane + localhost URL` 경로를 먼저 검증한다.
- Related files:
  - `.codex/environments/environment.toml`
  - `script/build_and_run.sh`
  - `.codex/harness/qa-report.md`
- Verification:
  - `Get-Command bash`
  - `C:\Program Files\Git\bin\bash.exe ./script/build_and_run.sh --web`
  - startup log `Waiting on http://localhost:3200`

## 2026-04-23 | Governance / Push Diff Range | PR green만 확인하고 push workflow가 보는 마지막 푸시 diff를 같은 기준으로 닫지 않음
- Symptom:
  - `pull_request` governance는 green으로 돌아왔는데, 바로 뒤의 `push` governance는 `1084f1b..6e73da6` 범위에서 handbook owner 문서 누락으로 다시 실패했다.
  - 사용자는 같은 브랜치에서 또 빨간 governance run을 보게 됐다.
- Root cause:
  - `path-owner-map` coverage만 고치고 멈췄고, 마지막 커밋에 포함된 referral/admin-web 코드 묶음에 대응하는 owner handbook 문서를 같은 commit에서 업데이트하지 않았다.
  - 즉 PR 전체 diff와 마지막 push diff가 governance에서 서로 다른 범위라는 점을 검증 루틴에 넣지 않았다.
- Why it was missed:
  - `pull_request` run이 green으로 바뀐 순간 closeout이 끝났다고 판단했고, `push` event run 로그를 즉시 다시 확인하지 않았다.
- Permanent guardrail:
  - handbook-sensitive 코드가 들어간 commit을 새로 푸시할 때는 `node scripts/ci/check-governance.mjs`만 끝내지 말고, 푸시 후 `gh run list --branch <branch>`에서 최신 `push`와 `pull_request` governance 둘 다 확인한다.
  - referral/schema/admin-web 같은 owner-mapped 영역을 건드리는 commit은 관련 handbook owner 문서를 같은 commit에 포함시키기 전까지 closeout으로 보고하지 않는다.
- Related files:
  - `docs/handbook/data/referral-schema-and-admin-rpcs.md`
  - `docs/handbook/data/data-model-canon.md`
  - `docs/handbook/shared/security-and-secret-operations.md`
  - `docs/handbook/admin-web/dashboard-lifecycle.md`
  - `.github/workflows/governance-check.yml`
- Verification:
  - `gh run view 24821626525 --repo jj8127/Appointment-Process --log-failed`
  - handbook owner 문서 보강 후 새 push/pull_request governance 재확인

## 2026-04-23 | Governance / PR Diff Range | 로컬 현재 작업 단위만 보고 PR 전체 diff 기준 governance를 다시 확인하지 않음
- Symptom:
  - 로컬에서는 방금 만진 파일 위주 검증만 통과한 뒤 커밋/상태 보고를 했는데, GitHub PR governance는 브랜치 전체 diff에서 `path-owner-map` 누락으로 계속 실패했다.
  - 특히 `remote HEAD`와 `local unpushed commit`을 분리해서 설명하지 못해, 사용자는 같은 governance 실패를 반복해서 보게 됐다.
- Root cause:
  - 검증 대상을 `현재 작업 파일`로 좁혀서 봤고, 실제 CI가 보는 `BASE_SHA...HEAD_SHA` PR diff 범위를 같은 기준으로 재현하지 않았다.
  - `supabase/functions/_shared/*` helper/test처럼 handbook-sensitive path가 새로 늘었는데, `docs/handbook/path-owner-map.json` coverage를 branch 전체 기준으로 재점검하지 않았다.
- Why it was missed:
  - 로컬 `node scripts/ci/check-governance.mjs` 1회 통과만 믿고, CI 로그의 exact failing head SHA와 PR 전체 diff를 다시 비교하지 않았다.
  - “이번 커밋”과 “이미 브랜치에 남아 있는 미커밋/미푸시 변경”을 같은 검증 세트로 묶어 생각하지 못했다.
- Permanent guardrail:
  - governance 이슈를 다룰 때는 항상 `remote failing HEAD`, `local HEAD`, `working tree`를 분리해서 먼저 적는다.
  - push 전에는 반드시 PR base SHA를 명시해서 같은 range로 governance를 재실행한다.
  - `supabase/functions/_shared/*` 같은 shared helper를 추가하면 같은 세션에서 `docs/handbook/path-owner-map.json`도 같이 grep 검토한다.
- Related files:
  - `scripts/ci/check-governance.mjs`
  - `docs/handbook/path-owner-map.json`
  - `.claude/MISTAKES.md`
- Verification:
  - `gh run view <run-id> --repo jj8127/Appointment-Process --log`
  - `git diff --name-only <base-sha>...HEAD`
  - `$env:BASE_SHA='<base>'; $env:HEAD_SHA=(git rev-parse HEAD); node scripts/ci/check-governance.mjs`

## 2026-04-23 | Manager FC Visibility Contract | 대상 목록 가시성 규칙만 바꾸고 허브 unread 집계를 옛 기준으로 남겨 숫자/목록이 서로 어긋남
- Symptom:
  - 본부장에게 전체 FC를 보이도록 목록 계약을 넓힌 뒤에도, 관리자 웹 메신저 허브 unread badge는 기존 raw `messages` 기준을 계속 써서 보이는 대상 범위와 숫자가 어긋날 수 있었다.
- Root cause:
  - “누가 보이는가”와 “누구의 unread를 셀 것인가”가 같은 participant filter를 공유하지 않았다.
  - 내부 메신저 범위 변경을 모바일 list/unread와 웹 chat list에는 반영했지만, 웹 messenger hub count surface까지 같은 계약으로 묶지 못했다.
- Why it was missed:
  - acceptance criterion을 메인 화면(모바일 내부 메신저, 웹 채팅) 중심으로 닫고, 허브 badge 같은 파생 surface를 독립적으로 재점검하지 않았다.
- Permanent guardrail:
  - participant scope가 바뀌는 기능은 `목록 + unread badge + 허브 요약 + deep-link 진입`을 하나의 계약 세트로 검토한다.
  - unread badge는 raw table count를 직접 세기보다, 같은 participant helper/RPC contract를 쓰는 요약 경로를 우선 사용한다.
- Related files:
  - `supabase/functions/_shared/internal-chat.ts`
  - `supabase/functions/fc-notify/index.ts`
  - `web/src/app/dashboard/chat/page.tsx`
  - `web/src/app/dashboard/messenger/page.tsx`
- Verification:
  - `npm test -- --runInBand lib/__tests__/internal-chat.test.ts`
  - `cd E:\\hanhwa\\fc-onboarding-app\\web && npm run lint -- src/app/dashboard/chat/page.tsx src/app/dashboard/messenger/page.tsx src/lib/admin-chat-targets.ts src/lib/admin-chat-targets.test.ts`
  - `cd E:\\hanhwa\\fc-onboarding-app\\web && npx next build`

## 2026-04-23 | Invite-Link Signup Search | exact 추천코드 deeplink를 fuzzy search 경로와 재귀 pending-apply에 그대로 태워 첫 진입 체감과 안정성을 같이 망침
- Symptom:
  - 초대링크 exact 8자리 추천코드 진입이 불필요하게 느렸고, signup 화면에서 같은 pending code apply가 중복 예약될 수 있었다.
  - 사용자는 추천인 코드 검색이 오래 걸리거나 앱이 튕기는 것처럼 느꼈다.
- Root cause:
  - `search-signup-referral`이 exact code query도 broad name/affiliation/code 부분검색 경로로 처리했다.
  - `app/signup.tsx`의 pending apply는 in-flight promise가 있을 때 `finally(() => applyPendingReferralCode())`를 다시 붙여 중복 rerun을 만들 수 있었다.
- Why it was missed:
  - signup search rollout 때 “검색 계약이 동작한다”는 것만 닫고, exact 8자리 invite-link query latency와 cold/warm start 중복 apply를 별도 acceptance criterion으로 두지 않았다.
- Permanent guardrail:
  - exact 8자리 추천코드 query가 있는 검색 API는 fuzzy search 전에 exact fast path 유무를 먼저 검토한다.
  - deep-link/pending code auto-apply는 focus/effect 중복 트리거가 있어도 single-flight로만 돌게 만들고, `finally` 재귀 rerun 패턴을 다시 쓰지 않는다.
- Related files:
  - `app/signup.tsx`
  - `lib/signup-referral.ts`
  - `lib/__tests__/signup-referral.test.ts`
  - `supabase/functions/search-signup-referral/index.ts`
  - `supabase/functions/_shared/referral-search.ts`
  - `supabase/functions/_shared/__tests__/referral-search.test.ts`
- Verification:
  - `npm test -- --runInBand lib/__tests__/signup-referral.test.ts`
  - `npm test -- --runInBand supabase/functions/_shared/__tests__/referral-search.test.ts`
  - `supabase functions deploy search-signup-referral --project-ref ubeginyxaotcamuqpmud`

## 2026-04-23 | Referral Current-State Contract | current-state와 historical evidence를 둘 다 live 상태처럼 노출해 UI/문서가 내부 저장 구조를 그대로 드러냄
- Symptom:
  - 추천인 그래프가 `structured/confirmed/structured_confirmed` 같은 내부 근거 상태를 그대로 드러냈고, self-service/read model도 일부는 structured link, 일부는 attribution/history를 함께 해석하고 있었다.
  - 운영자 관점에서는 같은 추천 관계가 “현재 상태” 하나가 아니라 여러 색/용어로 갈라져 보였다.
- Root cause:
  - current-state와 audit/history를 분리 저장하는 것 자체는 맞았지만, read model/UI에서 그 차이를 감추지 못했다.
  - 저장 경로도 단일 RPC contract로 묶기 전에 여러 source를 병렬로 업데이트하던 관성이 남아 있었다.
- Why it was missed:
  - DB 설계에서 “상태 1개 + 감사 이력”과 “dual-state UI”를 명확히 구분하지 않았다.
  - 관리자 그래프를 운영자 도구가 아니라 내부 데이터 디버거처럼 취급한 흔적이 남았다.
- Permanent guardrail:
  - 추천인 current-state는 `fc_profiles.recommender_*` snapshot만 UI/read model이 사용한다.
  - `referral_attributions` 같은 historical data는 archive/audit 용도일 뿐, 새 runtime edge/state source로 다시 끌어오지 않는다.
  - current-state 변경은 모두 `apply_referral_link_state(...)` 같은 단일 RPC로 묶고, 하나라도 실패하면 current-state/event 어느 쪽도 부분 저장하지 않는 계약을 유지한다.
- Related files:
  - `supabase/migrations/20260423000001_unify_referral_link_state.sql`
  - `supabase/functions/_shared/referral-link.ts`
  - `supabase/functions/set-password/index.ts`
  - `supabase/functions/update-my-recommender/index.ts`
  - `web/src/lib/admin-referrals.ts`
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Verification:
  - `node --experimental-strip-types --test E:\\hanhwa\\fc-onboarding-app\\web\\src\\lib\\referral-graph-edges.test.ts`
  - `cd E:\\hanhwa\\fc-onboarding-app\\web && npm run build`
  - `cd E:\\hanhwa\\fc-onboarding-app && node scripts/ci/check-governance.mjs`

## 2026-04-22 | Admin Web Vercel Deployment Contract | preview env drift를 production fallback과 silent fallback으로 숨겨 live 서비스와 섞이게 둠
- Symptom:
  - 관리자 웹 preview 배포에서 `설계요청 메신저`가 명시적 URL env 없이도 live `requestboard-steel`로 열릴 수 있었다.
  - web push와 주민번호 조회도 env 누락 시 generic failure 또는 조용한 fallback으로만 보여, preview 배포가 무엇을 검증 중인지 구분하기 어려웠다.
- Root cause:
  - 외부 운영 시스템 URL과 보안 env 부재를 “일단 동작하게 하는 fallback”으로 흡수했다.
  - 그 결과 preview/prod 경계가 코드와 Vercel env 계약에 명시되지 않았고, drift가 사용자-visible 문제로 늦게 드러났다.
- Why it was missed:
  - build 통과와 일부 기능 동작만 보고, preview가 live 외부 시스템이나 edge fallback을 암묵적으로 타는지를 acceptance criterion으로 고정하지 않았다.
  - env가 빠졌을 때 `막아야 하는 기능`과 `살려도 되는 fallback`을 구분하지 않았다.
- Permanent guardrail:
  - preview에서 운영 외부 시스템으로 이어지는 URL은 fallback으로 열지 않는다. env가 없으면 명시적으로 비활성화한다.
  - web push, 주민번호 같은 운영 민감 기능은 missing env를 generic failure로 숨기지 말고, 어떤 env가 빠졌는지 또는 어떤 fallback source를 탔는지 로그/운영 문구에 남긴다.
  - Vercel env drift를 고칠 때는 코드 가드와 env 변경을 같은 세트로 처리하고, `vercel env ls preview|production` 결과를 검증 증적에 포함한다.
- Related files:
  - `web/src/app/dashboard/messenger/page.tsx`
  - `web/src/lib/request-board-url.ts`
  - `web/src/components/WebPushRegistrar.tsx`
  - `web/src/lib/web-push-config.ts`
  - `web/src/lib/web-push.ts`
  - `web/src/lib/server-resident-numbers.ts`
- Verification:
  - `vercel env ls preview --cwd E:\\hanhwa\\fc-onboarding-app\\web`
  - `vercel env ls production --cwd E:\\hanhwa\\fc-onboarding-app\\web`
  - `cd web && npm run lint -- ...`
  - `cd web && npm run build`

## 2026-04-22 | Referral Report Export | 전화번호 CSV를 plain number로만 내보내 스프레드시트가 과학적 표기법으로 바꾸는 문제를 놓침
- Symptom:
  - `fc-missing-recommender-2026-04-22.csv`를 엑셀/스프레드시트로 열면 `010...` 전화번호가 `1.029E+09` 같은 과학적 표기법으로 보였다.
- Root cause:
  - CSV 본문은 raw 숫자 문자열로 맞게 저장됐지만, spreadsheet import/open 동작이 전화번호 열을 숫자로 자동 추론한다는 소비 환경 계약을 export 단계에서 반영하지 않았다.
- Why it was missed:
  - 데이터 조회 정확도만 확인하고, 실제 전달 포맷이 사용자의 기본 열기 도구(엑셀/스프레드시트)에서 어떻게 보이는지는 acceptance criterion에 넣지 않았다.
- Permanent guardrail:
  - 전화번호/주민번호처럼 앞자리 0이 의미를 갖는 보고서 CSV는 기본 export를 spreadsheet-safe text 형식으로 저장하고, 필요하면 raw CSV를 별도 파일로 같이 만든다.
  - 보고서 산출물은 생성 직후 첫 몇 줄을 다시 읽어 phone column formatting contract를 확인한다.
- Related files:
  - `scripts/reporting/export-missing-recommender-report.mjs`, `privacy-deleted; see central FC raw-harness receipt`
- Verification:
  - `npm run report:missing-recommender -- --date=2026-04-22`
  - `Get-Content .codex\\harness\\reports\\fc-missing-recommender-2026-04-22.csv -TotalCount 5`

## 2026-04-20 | Android Dev QA Network Baseline | backend smoke만 믿고 emulator DNS/Metro 상태를 런타임 전제조건으로 먼저 고정하지 않아 로그인/불러오기 실패를 코드 문제처럼 오진함
- Symptom:
  - Android dev client에서 로그인, `latest_notice`, 시험 정보/신청자 정보 등 외부 fetch가 랜덤하게 실패했고, `FunctionsFetchError`와 `expo-notifications` network warning이 연속으로 보였다.
  - 같은 세션에서 `Loading from 172.28.4.60:8082...` blank screen, `Feather.ttf` asset fetch 실패, generic login failure alert가 뒤섞여 원인 분리가 어려웠다.
- Root cause:
  - 실제 1차 원인은 emulator DNS가 깨져 있어 `google.com`, `*.supabase.co`, `*.vercel.app` host resolution이 실패한 상태였다.
  - 동시에 dev client가 이전 Metro endpoint(`172.28.4.60:8082`)를 요구하는 상태였는데 Metro가 떠 있지 않은 순간도 있어, font asset fetch 실패가 추가로 섞였다.
  - 나는 backend `login-with-password`/`bridge-login` smoke만 보고 앱 런타임 network baseline을 같은 acceptance criterion으로 묶지 않았다.
- Why it was missed:
  - auth backend 정상 여부와 Android emulator runtime 정상 여부를 분리하지 않고, 먼저 backend를 확인한 뒤 client post-login 코드만 의심했다.
  - emulator에서 host-resolution(`ping google.com`)과 Metro binding 상태를 초기에 확인하지 않아, 환경 문제를 코드 회귀처럼 추적했다.
- Permanent guardrail:
  - Android dev QA 시작 전에 `google.com`, Supabase host, request_board host DNS resolution과 active Metro endpoint를 먼저 확인한다.
  - backend smoke 통과만으로 모바일 로그인 회귀를 닫지 않는다. 최소 1회는 emulator/device에서 실제 fetch contract를 확인한다.
  - emulator를 재기동할 때 DNS가 흔들리면 `-dns-server 8.8.8.8,1.1.1.1`로 띄우고 그 상태를 QA note에 남긴다.
- Related files:
  - `privacy-deleted; see central FC raw-harness receipt`, `.codex/harness/qa-report.md`, `.codex/harness/handoff.md`
- Verification:
  - emulator relaunch: `emulator.exe -avd codex-api34 -dns-server 8.8.8.8,1.1.1.1`
  - `adb shell ping -c 1 google.com`
  - `adb shell ping -c 1 ubeginyxaotcamuqpmud.functions.supabase.co`
  - `adb shell ping -c 1 requestboard-steel.vercel.app`

## 2026-04-20 | Mobile Login Post-Success Flow | 로그인 성공 직후 공용 로더/라우팅/푸시 등록을 한 번에 붙여 post-login 안정화를 깨뜨림
- Symptom:
  - `login-with-password` 자체는 성공하는데도 앱에서 로그인 직후 다시 실패처럼 보이거나, dev build에서는 `ExpoAsset.downloadAsync` / `Feather.ttf` asset 오류가 로그인 버튼 loading 순간에 터졌다.
  - 실제 기기 로그에서는 `expo-notifications` push token update 경고가 연속으로 찍혀 로그인 실패 원인처럼 보였다.
- Root cause:
  - 로그인 성공 직후 가장 먼저 렌더되는 공용 loading spinner를 `@expo/vector-icons/Feather` 기반으로 바꿔, 아직 해당 폰트 asset을 확보하지 못한 dev client/runtime에서 login pending 자체가 예외 트리거가 됐다.
  - 동시에 `useLogin`이 session state propagation 전에 landing route로 직접 `router.replace(...)`를 호출했고, 홈 계열 화면은 `role`이 아직 반영되기 전이면 `/login`으로 즉시 되돌아가는 보호 effect를 갖고 있어 post-login route race가 생길 수 있었다.
  - 여기에 push token 등록도 session 확정 직후 바로 시도돼 네트워크 경고가 겹치면서 원인 판별을 더 어렵게 만들었다.
- Why it was missed:
  - backend auth 응답이 정상인 것을 확인하고도, "로그인 성공 후 첫 pending UI"와 "session-driven route transition"을 같은 계약으로 다시 보지 않았다.
  - 공용 primitive 변경을 login surface에 적용하면서 font asset dependency와 protected-route redirect race를 별도 acceptance criterion으로 고정하지 않았다.
- Permanent guardrail:
  - 로그인/초기 진입에 걸리는 공용 loading primitive는 font-backed icon이 아니라 asset-free primitive(SVG/ActivityIndicator/native shape)로 둔다.
  - login mutation은 session state만 갱신하고, landing navigation은 session observer screen이 담당하게 해 protected-route guard와 순서를 맞춘다.
  - push token 등록 같은 비핵심 side effect는 login success와 같은 frame에서 바로 실행하지 말고, session 확정 뒤 지연/중복방지 key를 둔다.
- Related files:
  - `components/BrandedLoadingSpinner.tsx`, `lib/branded-loading-spinner.ts`, `hooks/use-login.ts`, `app/login.tsx`, `hooks/use-session.tsx`, `lib/session-landing.ts`, `lib/push-registration.ts`
- Verification:
  - `npm test -- --runInBand components/__tests__/BrandedLoadingSpinner.contract.test.ts lib/__tests__/branded-loading-spinner.test.ts hooks/__tests__/use-login.contract.test.ts lib/__tests__/session-landing.test.ts lib/__tests__/push-registration.test.ts`
  - direct backend smoke: `login-with-password` + request_board `bridge-login` both succeed for provided FC/admin credentials

## 2026-04-20 | Shared Loading UX Rollout | 메신저에 loading motion을 넣고도 나머지 `ActivityIndicator` surface를 같은 change set에서 바로 감사하지 않아 사용자에게 "왜 여긴 아직도 기본 spinner냐"는 불연속성을 남김
- Symptom:
  - 메신저 쪽에는 animated loading card가 보이는데, 홈/시험/설계요청/저장 버튼/추천인 검색 등 다른 화면은 여전히 bare spinner만 보여 UX가 불균일했다.
  - 사용자가 직접 "모두 바꿔"라고 다시 요청할 정도로 공용 treatment처럼 보이지 않았다.
- Root cause:
  - 새 loading treatment를 messenger-specific polish로 먼저 적용했고, `app/*`, `components/*`의 باقي `ActivityIndicator` occurrences를 같은 도메인 rollout 범위로 즉시 승격하지 않았다.
  - 공용 primitive를 먼저 만들지 않고 screen-by-screen로 시작해, 최초 적용 범위가 자연스럽게 전체 계약으로 이어지지 않았다.
- Why it was missed:
  - "새 패턴이 잘 보이는 대표 화면 2곳"에 먼저 넣는 것과 "앱 전역 공용 loading 계약을 바꾸는 것"을 같은 수준의 완료 조건으로 착각했다.
  - 정적 검색으로 남은 `ActivityIndicator` surface를 세지 않은 상태에서 initial rollout을 사실상 닫았다.
- Permanent guardrail:
  - 새 공용 UI treatment를 도입할 때는 대표 화면만 바꾸지 말고, 먼저 codebase-wide occurrence scan으로 적용 대상을 전부 나열한 뒤 rollout 범위를 정한다.
  - `app/*`, `components/*`에 남은 legacy primitive count(`ActivityIndicator`, old badge, old header 등)를 검색으로 0 또는 intentional-allowlist 상태까지 확인한 뒤에만 "공용 전개 완료"로 본다.
  - 공용 motion/loading는 screen-specific component가 아니라 shared primitive부터 만들고, wrapper는 그 다음에 둔다.
- Related files:
  - `components/BrandedLoadingState.tsx`, `components/BrandedLoadingSpinner.tsx`, `lib/messenger-loading.ts`, `lib/branded-loading-spinner.ts`, `app/*`, `components/*`
- Verification:
  - `npm test -- --runInBand lib/__tests__/messenger-loading.test.ts lib/__tests__/branded-loading-spinner.test.ts`
  - `Get-ChildItem app,components -Recurse -Include *.tsx,*.ts | Select-String 'ActivityIndicator'`

## 2026-04-20 | Mobile Messenger Navigation Parity | 메신저 최적화/QA 중 route header와 screen header를 따로 보다가 두 화면의 뒤로가기 노출 계약을 놓침
- Symptom:
  - `메신저` 화면 상단 헤더에 뒤로가기 버튼이 보이지 않았다.
  - `가람지사 메신저` 화면도 내부 헤더에 뒤로가기 버튼이 없어 상단에서 복귀할 수 없었다.
- Root cause:
  - `메신저`는 `app/_layout.tsx`의 Stack header에 의존하고, `가람지사 메신저`는 화면 내부 커스텀 헤더를 쓰는 서로 다른 구조인데, 메신저 최적화 동안 이를 하나의 navigation cluster로 다시 대조하지 않았다.
  - 특히 `메신저`는 stack back이 없는 진입에서도 back affordance가 필요한데 default header back에만 기대고 있었다.
- Why it was missed:
  - 성능 리팩터와 unread 정확도 검증에 집중하면서, top-header navigation parity를 explicit QA 항목으로 고정하지 않았다.
  - 정적 lint/test는 route header 노출 여부를 직접 잡아주지 못하는데도 화면 QA 이전에 닫으려 했다.
- Permanent guardrail:
  - 메신저 도메인 수정 시 `app/_layout.tsx`, `app/messenger.tsx`, `app/admin-messenger.tsx`, `app/chat.tsx`를 하나의 navigation cluster로 보고 header/back parity를 함께 점검한다.
  - 스택이 없을 수 있는 top-level route는 default back에만 기대지 말고 fallback route를 가진 explicit back action을 둔다.
  - manual QA checklist에 `상단 헤더 뒤로가기 버튼 보임 + 동작`을 별도 항목으로 넣는다.
- Related files:
  - `app/_layout.tsx`, `app/admin-messenger.tsx`, `app/messenger.tsx`, `lib/back-navigation.ts`, `lib/__tests__/back-navigation.test.ts`
- Verification:
  - `npm test -- --runInBand lib/__tests__/back-navigation.test.ts`
  - `npx eslint app/_layout.tsx app/admin-messenger.tsx lib/back-navigation.ts lib/__tests__/back-navigation.test.ts`

## 2026-04-20 | Signup Referral Search Rollout | 회원가입 추천인 검색을 `/referral`과 같은 계약으로 바꾸면서 배포/선택 게이트를 끝까지 닫지 않아 "검색 결과 없음"으로 보이게 둠
- Symptom:
  - 회원가입 화면에서 추천인 UI는 검색형처럼 보이는데, 이름 검색이 계속 `검색 결과가 없어요`로만 보였다.
  - 추천인 입력도 direct code input과 search input이 둘로 갈라져 `/referral`과 다른 사용 경험이 남아 있었다.
- Root cause:
  - signup surface가 여전히 `직접 코드 입력 + 보조 검색` 계약에 머물러 있었고, pasted 8자리 코드도 결과 선택 없이 바로 검증/저장 경로로 들어갔다.
  - 동시에 unauthenticated 검색용 Edge Function `search-signup-referral`은 local source에만 있고 원격 project(`ubeginyxaotcamuqpmud`)에는 배포되지 않아, 클라이언트는 function failure를 empty result처럼 보이게 삼켰다.
- Why it was missed:
  - `/referral` parity를 UI/코드 관점으로만 봤고, signup trusted search path의 actual deployment 상태와 empty/error 분리를 같은 acceptance criterion으로 고정하지 않았다.
  - "검색 입력이 보인다"와 "검색 contract가 실제 런타임에서 동작한다"를 별개로 검증하지 않았다.
- Permanent guardrail:
  - signup과 `/referral` 추천인 입력은 같은 도메인 계약으로 보고, 검색형 surface라면 `단일 입력`, `검색 결과 선택 필수`, `typed/pasted code도 selection gate 통과`를 함께 묶어 검토한다.
  - 새 trusted Edge Function을 client에 연결할 때는 UI 반영만으로 닫지 않는다. 같은 세션에서 `functions list/deploy`와 live invoke까지 확인하고, client는 function failure를 empty state로 숨기지 않는다.
- Related files:
  - `app/signup.tsx`, `components/ReferralSearchField.tsx`, `lib/signup-referral.ts`, `lib/__tests__/signup-referral.test.ts`, `supabase/functions/search-signup-referral/index.ts`, `docs/referral-system/SPEC.md`
- Verification:
  - `npm test -- --runInBand lib/__tests__/signup-referral.test.ts`
  - `npx eslint app/signup.tsx components/ReferralSearchField.tsx lib/signup-referral.ts lib/__tests__/signup-referral.test.ts`
  - `supabase functions deploy search-signup-referral --project-ref ubeginyxaotcamuqpmud`
  - live anon invoke: exact code query + name query both return `200` results from `search-signup-referral`

## 2026-04-17 | Referral Code Provisioning Contract | eligible 사용자 추천코드 발급을 운영/backfill 단계로만 보고 로그인 성공 계약에 묶지 않음
- Symptom:
  - completed FC나 active manager가 정상 로그인해도 active 추천코드가 없어 바로 공유/초대를 시작하지 못했다.
  - 사용자 입장에서는 "로그인도 됐는데 왜 추천인 코드 발급을 위해 또 다른 절차가 필요하냐"는 문제로 보였다.
- Root cause:
  - `login-with-password`는 인증과 세션 발급만 처리하고, active 추천코드 보장은 관리자 backfill/수동 발급 또는 이후 별도 self-service 조회에 맡겨 두었다.
  - `get-my-referral-code`도 active code가 비어 있으면 그냥 `null`을 반환해 rollout 이전 계정이나 transient failure를 catch-up하지 않았다.
- Why it was missed:
  - 추천인 운영 관점에서 `admin_backfill_referral_codes`가 있으니 신규 로그인 사용자도 eventually code를 갖게 된다고 느슨하게 봤고, "eligible user login success = active code ready"를 별도 P0 계약으로 승격하지 않았다.
  - 로그인 성공, self-service 조회, 운영 backfill을 한 도메인 lifecycle로 연결해 검토하지 않았다.
- Permanent guardrail:
  - 사용자-facing 공유/초대 기능의 prerequisites는 로그인 성공 시점에 보장한다. eligible user가 로그인된 상태에서 추가 운영 개입이나 수동 발급 단계를 다시 밟게 두지 않는다.
  - provisioning이 인증보다 부가 기능이면 login success와 hard-couple하지 말고, 로그인 성공을 유지한 채 현재 self-service path가 1회 catch-up하도록 설계하고 테스트 케이스를 별도로 둔다.
- Related files:
  - `supabase/functions/_shared/referral-code.ts`, `supabase/functions/login-with-password/index.ts`, `supabase/functions/get-my-referral-code/index.ts`, `docs/referral-system/test-cases.json`
- Verification:
  - `npx eslint --rule "import/no-unresolved: off" supabase/functions/_shared/referral-code.ts supabase/functions/login-with-password/index.ts supabase/functions/get-my-referral-code/index.ts`
  - `node scripts/ci/check-governance.mjs`

## 2026-04-16 | Referral Self-Service Session Contract | 로그인 세션과 referral `appSessionToken`을 별도 상태로 두고 만료 복구를 정의하지 않아 로그인 사용자가 `/referral`에서 다시 인증에 막힘
- Symptom:
  - 사용자는 이미 `가람in`에 로그인돼 있는데 `/referral` 또는 추천인 저장 시 `인증이 필요합니다`가 뜨고, 추천코드 조회/변경만 막혔다.
  - 특히 오래된 세션에서는 앱 진입은 되는데 추천인 화면만 열리지 않거나 저장이 진행되지 않는 식으로 보였다.
- Root cause:
  - 로그인 유지에 쓰는 request_board bridge 세션과 referral Edge Function이 요구하는 `appSessionToken`이 분리돼 있었지만, `appSessionToken`이 없거나 만료됐을 때 bridge token으로 조용히 재발급하는 경로를 두지 않았다.
  - referral 함수들도 missing/expired/invalid app session을 모두 generic unauthorized로 뭉개 반환해, 클라이언트가 silent refresh와 재로그인 fallback을 구분할 수 없었다.
- Why it was missed:
  - self-service rollout 때 fresh login happy-path만 점검하고, `primary session valid + secondary session expired` 조합을 P0 시나리오로 고정하지 않았다.
  - 화면에 보이는 메시지만 확인하고 토큰 만료 종류별 auth code contract를 명시적으로 설계하지 않았다.
- Permanent guardrail:
  - custom secondary session이 생기면 `primary session valid / secondary session expired` 조합을 반드시 P0 케이스로 문서·테스트·런타임 QA에 넣고, silent refresh 또는 relogin fallback을 코드와 SSOT에 함께 적는다.
  - authenticated 화면은 generic unauthorized 문구 하나로 끝내지 말고 `missing_*`, `expired_*`, `invalid_*` 코드를 분리해 클라이언트 retry/logout 분기가 가능해야 한다.
- Related files:
  - `hooks/use-referral-app-session.ts`, `hooks/use-my-referral-code.ts`, `app/referral.tsx`, `supabase/functions/_shared/request-board-auth.ts`, `supabase/functions/refresh-app-session/index.ts`, `docs/referral-system/test-cases.json`
- Verification:
  - `npx eslint app/referral.tsx hooks/use-my-referral-code.ts hooks/use-referral-app-session.ts hooks/use-referral-tree.ts hooks/use-session.tsx lib/request-board-api.ts`
  - `node scripts/ci/check-governance.mjs`

## 2026-04-16 | Referral Search Contract | signup과 `/referral`의 추천인 검색 계약을 따로 굴려 회원가입 화면만 코드 입력에 고정됨
- Symptom:
  - 로그인 후 `/referral`에서는 이름/소속/추천코드 검색으로 추천인을 바꿀 수 있었지만, 비로그인 회원가입 화면은 여전히 `추천 코드 (선택)` direct input만 지원했다.
  - 사용자 입장에서는 같은 추천인 도메인인데 두 화면의 입력 방식과 안내 문구가 달라 기능이 빠진 것처럼 보였다.
- Root cause:
  - 추천인 self-service rollout을 `app/referral.tsx + search-fc-for-referral` 중심으로 진행하면서, 가입 시점 추천인 입력 surface(`app/signup.tsx`)를 같은 contract review 범위에 다시 포함하지 않았다.
  - 회원가입 검색은 비로그인 path라 별도 trusted search function이 필요했는데, 그 차이를 초기에 explicit contract로 문서화하지 않아 signup은 code-only 상태로 남았다.
- Why it was missed:
  - 추천인 기능을 `signup 확정`과 `가입 후 self-service` 두 phase로 나눠 생각하면서, 사용자-visible 입력 계약을 한 surface로 재검토하지 않았다.
  - 검토 단계에서 안내 문구만 맞는지 본 것이 아니라 기능 parity 자체를 확인했어야 했는데, 실제 runtime path 차이를 뒤늦게 확인했다.
- Permanent guardrail:
  - 추천인 입력 surface를 바꿀 때는 `signup`과 `/referral`을 같은 도메인 계약으로 묶어 검토한다. 한쪽만 검색/선택 UI를 갖고 다른 쪽은 code-only로 남겨두지 않는다.
  - 비로그인 signup path와 app-session self-service path가 다른 경우, auth 차이를 숨기지 말고 별도 trusted function을 명시적으로 두고 문서/테스트 케이스에 둘 다 적는다.
- Related files:
  - `app/signup.tsx`, `app/referral.tsx`, `supabase/functions/search-signup-referral/index.ts`, `docs/referral-system/SPEC.md`
- Verification:
  - `npm run lint -- app/signup.tsx app/referral.tsx components/ReferralSearchField.tsx`
  - `npx eslint --rule "import/no-unresolved: off" supabase/functions/search-signup-referral/index.ts`

## 2026-04-14 | Mobile Exam Applicants | dual FK embed ambiguity를 bare relation으로 읽고, query 실패를 빈 상태로 숨겨 목록 전체가 사라짐
- Symptom:
  - 가람in 본부장/총무가 `exam-manage`, `exam-manage2`를 열면 시험 신청자가 있는데도 목록이 전혀 보이지 않았다.
  - 화면은 실제 query failure를 보여주지 않고 `검색 결과가 없습니다`처럼 비어 보일 수 있었다.
- Root cause:
  - `exam_registrations`와 `exam_locations` 사이에 `location_id` FK와 `(location_id, round_id)` FK가 둘 다 생겼는데, 모바일 신청자 화면이 여전히 bare `exam_locations ( location_name )` embed를 사용했다.
  - PostgREST가 이 다중 관계를 `PGRST201`로 거절했고, `useQuery` error state를 UI에서 따로 처리하지 않아 실패가 빈 결과처럼 보였다.
- Why it was missed:
  - 직전 수정에서 `resident_id -> fc_profiles.phone` 매칭 parity에 집중하면서, 같은 query 안의 embedded relation ambiguity까지 함께 재검토하지 않았다.
  - 화면이 error state를 노출하지 않아 실제 원인을 앱에서 바로 읽기 어려웠다.
- Permanent guardrail:
  - `exam_registrations -> exam_locations` embed는 항상 `exam_locations!exam_registrations_location_round_fkey`처럼 FK를 명시한다.
  - PostgREST embed failure 가능성이 있는 admin list screen은 empty state와 error state를 분리한다. query가 실패하면 빈 목록 문구를 재사용하지 않는다.
- Related files:
  - `app/exam-manage.tsx`, `app/exam-manage2.tsx`, `docs/handbook/mobile/exam-flows.md`
- Verification:
  - `npm run lint -- app/exam-manage.tsx app/exam-manage2.tsx`
  - anon Supabase 재현 스크립트로 bare relation `PGRST201` 확인 후 explicit FK select에서 life/nonlife rows 반환 확인

## 2026-04-14 | Mobile Android Fabric | `/referral` crash를 개별 화면 이슈로만 닫고 같은 scroll-wrapper 패턴이 남은 화면들을 즉시 정리하지 않음
- Symptom:
  - `/referral`은 이미 plain `ScrollView`로 옮겨졌는데도, 현재 앱에는 `dashboard`, `exam-apply*`, `exam-register*`, `fc/new`처럼 `KeyboardAwareWrapper + RefreshControl + 큰 조건부 렌더` 조합이 그대로 남아 있었다.
  - Play Console에서 본 `ReactClippingViewManager.addView` / `The specified child already has a parent` 계열 Fabric crash를 특정 route 하나로만 보면, 현재 릴리스에서도 같은 crash family가 다른 화면에서 이어질 수 있다.
- Root cause:
  - Android production crash 원인을 `/referral` 로컬 구조와 연결해 복구한 뒤, 같은 wrapper ownership 패턴이 모바일 다른 고변동 화면에도 남아 있는지 screen-by-screen으로 즉시 재감사하지 않았다.
  - `app/AGENTS.md`도 `KeyboardAwareWrapper` 재사용을 일반 권장으로만 적어 두고, Android Fabric 예외 규칙을 명시하지 않았다.
- Why it was missed:
  - incident를 "추천인 화면 회귀"로만 닫고 "Android Fabric scroll ownership" 공통 규칙으로 승격하지 않았다.
  - local source audit와 Play Console version split은 별개의 작업인데, 전자는 진행하면서도 후자를 기다리느라 남은 위험 화면 batch hardening이 늦어질 수 있는 상태였다.
- Permanent guardrail:
  - Android new architecture/Fabric에서 `RefreshControl`과 큰 조건부 렌더 tree를 가진 화면은 `KeyboardAwareWrapper`를 primary scroll owner로 쓰지 않는다.
  - 이런 screen은 Android에서 plain `ScrollView` + explicit keyboard padding으로 유지하고, iOS에서만 `KeyboardAwareWrapper`를 남긴다.
  - 한 화면에서 wrapper-related native crash를 복구하면 같은 pattern이 남아 있는 route들을 같은 change set 또는 즉시 후속 batch로 나열해 확인한다.
- Related files:
  - `app/referral.tsx`, `app/dashboard.tsx`, `app/exam-apply.tsx`, `app/exam-apply2.tsx`, `app/exam-register.tsx`, `app/exam-register2.tsx`, `app/fc/new.tsx`, `app/AGENTS.md`, `docs/referral-system/INCIDENTS.md`
- Verification:
  - `npm run lint -- app/dashboard.tsx app/exam-apply.tsx app/exam-apply2.tsx app/exam-register.tsx app/exam-register2.tsx app/fc/new.tsx`
  - `node scripts/ci/check-governance.mjs`
  - follow-up Android release build QA + Play Console cluster trend 확인

## 2026-04-14 | Mobile Referral Tree | preload depth와 subtree lazy-expand depth 계약을 한 tree로 보지 않아 deeper branch가 느리고 스타일도 어긋남
- Symptom:
  - `/referral`에서 `하기홍` 아래는 바로 열리는데 `박충희`처럼 depth 2 밖의 node 아래는 늦게 열리고, lazy-load로 붙은 child row가 다시 top-level 주황 스타일처럼 보였다.
- Root cause:
  - 첫 화면은 `depth:2` preload, deeper node는 subtree lazy fetch인데 `hooks/use-referral-tree.ts`가 subtree-relative `node_depth`를 현재 화면 root 기준 absolute depth로 정규화하지 않은 채 merge했다.
  - `components/ReferralTreeNode.tsx`는 들여쓰기는 render depth로 계산하면서 강조 스타일은 raw `node.depth === 1`에 묶어, preload node와 lazy node가 서로 다른 시각 규칙을 탔다.
  - 또한 tree success/no-ancestor 상태에서도 `app/referral.tsx`가 `get-my-referral-code` cache를 direct recommender fallback으로 재사용해 stale 상단 정보를 보여줄 수 있었다.
- Why it was missed:
  - `get-referral-tree` / `get_referral_subtree` transport depth가 subtree root 기준 상대값이라는 점은 알고 있었지만, 실제 모바일 UI가 preload branch와 lazy branch를 같은 tree surface에서 어떻게 합치는지까지 검증하지 않았다.
  - “하기홍은 빠름 / 박충희는 느림”처럼 depth-dependent한 체감 차이를 데이터량 차이로 보기 쉽고, render depth와 payload depth가 분리돼 있다는 점을 뒤늦게 확인했다.
- Permanent guardrail:
  - tree API가 subtree root 기준 depth를 반환하면, 화면 cache merge 전에 현재 화면 root 기준 absolute depth로 다시 쓴다. recursive tree UI에서는 들여쓰기와 강조 스타일 모두 같은 render-depth 규칙을 사용하고 transport depth를 style source로 재사용하지 않는다.
  - `depth:N preload + lazy expand`가 섞인 tree는 representative 계정 1개로 `preloaded branch`와 `deeper lazy branch`를 둘 다 열어 본다. 두 branch의 속도/스타일이 다르면 같은 session에서 root cause를 정리한 뒤 문서와 테스트 케이스에 남긴다.
- Related files:
  - `app/referral.tsx`
  - `components/ReferralTreeNode.tsx`
  - `hooks/use-referral-tree.ts`
  - `lib/referral-tree.ts`
  - `docs/referral-system/SPEC.md`
  - `docs/referral-system/ARCHITECTURE.md`
  - `docs/referral-system/INCIDENTS.md`
- Verification:
  - `npm run lint -- app/referral.tsx components/ReferralTreeNode.tsx hooks/use-referral-tree.ts lib/referral-tree.ts lib/__tests__/referral-tree.test.ts`
  - `npm test -- --runInBand lib/__tests__/referral-tree.test.ts`

## 2026-04-13 | Mobile Exam Applicants | 웹에서 고친 resident/phone 매칭 hardening을 모바일 `exam-manage*`에 옮기지 않아 본부장 목록이 통째로 비어 보임
- Symptom:
  - 가람in 본부장(read-only manager) 세션에서 `생명/제3 신청자 관리`, `손해 신청자 관리` 화면에 실제 신청 row가 있어도 목록이 전혀 보이지 않았다.
- Root cause:
  - 모바일 `app/exam-manage.tsx`, `app/exam-manage2.tsx`가 `exam_registrations.resident_id -> fc_profiles.phone` exact match만 사용했고, profile을 못 찾으면 row를 `continue`로 버렸다.
  - 동시에 주민번호 full-view 보조 read를 위해 `appSessionToken`을 query enable 조건에 넣어, 토큰이 없을 때는 목록 read 자체가 시작되지 않았다.
- Why it was missed:
  - 2026-04-06에 웹 `/dashboard/exam/applicants`에서 raw/digits/hyphenated phone 후보 매칭과 resident-number fallback contract를 정리했지만, 같은 도메인의 모바일 `exam-manage*` 복제 구현과 parity를 다시 대조하지 않았다.
- Permanent guardrail:
  - 시험 신청자 surface는 웹과 모바일을 따로 보지 말고 한 계약으로 점검한다. `resident_id -> profile lookup`, `profile miss fallback`, `resident-number trusted read failure`, `manager read-only session` 네 축을 `web/src/app/dashboard/exam/applicants/page.tsx`와 `app/exam-manage*.tsx`에서 함께 비교한다.
  - 주민번호 full-view는 부가 read일 뿐이므로, trusted read 토큰 부재나 decrypt 실패가 신청자 목록 전체를 숨기는 enable 조건이 되어서는 안 된다.
- Related files:
  - `app/exam-manage.tsx`
  - `app/exam-manage2.tsx`
  - `docs/handbook/mobile/exam-flows.md`
  - `.claude/MISTAKES.md`
- Verification:
  - `npm run lint -- app/exam-manage.tsx app/exam-manage2.tsx`

## 2026-04-10 | Android Referral Render Stability | keyboard-aware scroll을 multi-state self-service 화면의 기본 컨테이너로 유지한 채 Android render stability 검증을 건너뜀
- Symptom:
  - Android production `3.1.3`에서 `/referral` 화면 관련으로 `ReactClippingViewManager.addView`, `dispatchGetDisplayList`, `null child at index` 계열 crash가 발생했다.
- Root cause:
  - `KeyboardAwareWrapper(react-native-keyboard-aware-scroll-view)` 위에 `RefreshControl`, edit mode, tree/error/success 상태 전환 같은 child churn이 큰 화면을 올려두고도 Android production stability를 별도 체크하지 않았다.
- Why it was missed:
  - keyboard overlap UX를 우선시하면서 third-party keyboard-aware scroll의 Android native hierarchy cost를 과소평가했고, 기능 점검은 했어도 Android vitals 류 render stability는 별도 acceptance criterion으로 두지 않았다.
- Permanent guardrail:
  - Android primary screen이 `RefreshControl + large conditional sections + expand/collapse tree`를 함께 가지면 keyboard-aware wrapper를 기본값으로 쓰지 않는다. 먼저 plain `ScrollView`/stable container로 시작하고, keyboard auto-scroll이 꼭 필요할 때만 안전하게 추가한다. 릴리스 전에는 해당 화면의 Android 진입/편집/새로고침 전환을 production-like build에서 확인한다.
- Related files:
  - `app/referral.tsx`
  - `components/KeyboardAwareWrapper.tsx`
  - `docs/referral-system/TEST_CHECKLIST.md`
  - `.claude/MISTAKES.md`
- Verification:
  - `npx eslint app/referral.tsx`

## 2026-04-10 | Referral Inline Self-Service | secondary tree query를 기본 self-service 화면에 합치면서 mutation sync와 degraded fallback을 함께 남기지 않음
- Symptom:
  - 추천인 저장 성공 직후 `/referral`의 `나를 추천한 경로`가 이전 상태로 남았고, `get-referral-tree`가 실패하면 기존 추천인 사용자는 `변경하기` CTA 자체를 잃었다.
- Root cause:
  - `app/referral.tsx`가 추천인 저장 후 `get-my-referral-code`만 refetch했고, 기존 `변경하기` affordance를 tree success 렌더 안으로만 옮겼다.
- Why it was missed:
  - inline tree 흡수 작업에서 중복 UI 제거와 정상 흐름에만 집중했고, tree를 “부가 read”가 아니라 실제 primary self-service affordance 일부로 취급해 degraded mode parity를 따로 점검하지 않았다.
- Permanent guardrail:
  - secondary query가 기본 self-service 화면을 enrich하더라도 mutation affordance는 primary trusted read만으로도 계속 열려야 한다. 같은 화면에서 여러 query가 같은 도메인 값을 표현하면, mutation 성공 알림 전에 관련 query를 모두 refetch/invalidate한다.
- Related files:
  - `app/referral.tsx`
  - `hooks/use-my-referral-code.ts`
  - `hooks/use-referral-tree.ts`
  - `.claude/MISTAKES.md`
- Verification:
  - `npx eslint app/referral.tsx`

## 2026-04-10 | Referral Tree Rollout | 앱 화면만 먼저 테스트하고 trusted backend rollout 상태를 같이 확인하지 않아 즉시 `불러오기 실패`가 발생함
- Symptom:
  - 모바일 `추천 관계 전체 보기` 화면이 열리지만, 첫 진입에서 곧바로 `불러오기 실패` 에러 상태로 떨어졌다.
- Root cause:
  - 새 모바일 route와 hook는 로컬에 반영됐지만, 원격 Supabase에는 `get-referral-tree` Edge Function이 아직 배포되지 않았고 `get_referral_subtree` migration도 적용되지 않았다.
- Why it was missed:
  - 정적 검증과 거버넌스 통과를 마감 기준처럼 다루고, self-service 화면이 의존하는 `Edge Function 존재 여부 + 원격 DB 계약`을 같은 턴의 런타임 체크로 확인하지 않았다.
- Permanent guardrail:
  - 새 trusted path를 앱에서 바로 호출하는 기능은 `화면 구현 완료`로 닫지 않는다. 최소한 `functions list/deploy`, 필요한 migration 적용 여부, 대표 계정 1개 실호출까지 확인한 뒤에만 사용자 테스트를 시작한다. migration이 당장 막히면 화면 호출부를 막기보다 Edge Function fallback 또는 rollout 순서를 먼저 정리한다.
- Related files:
  - `supabase/functions/get-referral-tree/index.ts`
  - `supabase/migrations/20260410000001_add_referral_subtree_rpc.sql`
  - `app/referral-tree.tsx`
  - `.claude/MISTAKES.md`
- Verification:
  - `supabase functions list --project-ref ubeginyxaotcamuqpmud`
  - `supabase functions deploy get-referral-tree --project-ref ubeginyxaotcamuqpmud`
  - `npx eslint --rule "import/no-unresolved: off" supabase/functions/get-referral-tree/index.ts`

## 2026-04-10 | Referral Tree Ancestor Contract | manager shadow를 descendant 오염 방지 규칙으로만 보지 않고 ancestor chain까지 같이 제외해 실제 추천인이 화면에서 사라짐
- Symptom:
  - `01051078127` 계정은 `fc_profiles.recommender='서선미'`, `recommender_fc_id=<서선미 shadow fc_id>`로 저장돼 있는데, `나를 추천한 경로`에는 서선미가 나타나지 않았다.
- Root cause:
  - `get_referral_subtree` SQL과 `get-referral-tree` fallback이 모두 `is_manager_referral_shadow=true` row를 ancestor traversal에서도 제외하고 있었다.
- Why it was missed:
  - manager shadow를 “트리를 오염시키는 synthetic row”로만 생각했고, 실제 운영 데이터에서는 manager 추천인이 구조화 링크로 shadow row에 저장된다는 점을 ancestor UX 요구와 함께 검토하지 않았다.
- Permanent guardrail:
  - `is_manager_referral_shadow`는 descendant child traversal에서만 기본 제외 규칙으로 다루고, `recommender_fc_id`에 실제로 저장된 ancestor recommender는 보여준다. “shadow 제외” 규칙을 문서화할 때는 ancestor/descendant에 동일 적용한다고 쓰지 말고, 경로별 예외를 같이 적는다.
- Related files:
  - `supabase/functions/get-referral-tree/index.ts`
  - `supabase/migrations/20260410000001_add_referral_subtree_rpc.sql`
  - `supabase/schema.sql`
  - `docs/referral-system/SPEC.md`
  - `docs/referral-system/ARCHITECTURE.md`
  - `contracts/database-schema.md`
- Verification:
  - service-role query: `01051078127.recommender_fc_id -> 18f79264-5b93-4f37-a171-a459ab6c578a (서선미, manager shadow)`
  - `supabase functions deploy get-referral-tree --project-ref ubeginyxaotcamuqpmud`
  - `npx eslint --rule "import/no-unresolved: off" supabase/functions/get-referral-tree/index.ts`

## 2026-04-10 | Referral Self-Service / Tree Auth | drill-down 화면 요청 패턴과 Edge Function 인가 범위를 따로 잡아 lazy expand가 막힐 뻔함
- Symptom:
  - 모바일 `추천 관계 전체 보기`는 descendant node를 탭할 때마다 해당 노드를 root로 한 subtree를 다시 읽는 구조인데, 초기 구현 계약을 `fcId=self only`로 잡으면 첫 화면은 떠도 2단계 expand부터 403으로 막히게 된다.
- Root cause:
  - 화면 설계(ancestor chain + subtree lazy drill-down)와 서버 인가 규칙을 같은 계약으로 검토하지 않았고, `초기 로드 root 기준 조회`와 `후속 descendant root 재조회`를 서로 다른 문제처럼 취급했다.
- Why it was missed:
  - self-service 보안 경계를 좁게 잡는 데만 집중해, 실제 화면이 어떤 `fcId`들을 후속 요청으로 보낼지까지 함께 대조하지 않았다.
- Permanent guardrail:
  - self-service 화면이 lazy expand / cursor / detail drill-down으로 하위 노드 id를 다시 요청하면, Edge Function 인가도 `self only`가 아니라 `self subtree membership` 기준으로 설계한다. 화면 요청 패턴(`router/queryFn/loadChildrenOf`)과 서버 인가(`requested id` 허용 범위)를 같은 리뷰 체크리스트에서 한 번에 대조한다.
- Related files:
  - `app/referral-tree.tsx`
  - `hooks/use-referral-tree.ts`
  - `supabase/functions/get-referral-tree/index.ts`
  - `.claude/MISTAKES.md`
- Verification:
  - `npx eslint app/referral-tree.tsx hooks/use-referral-tree.ts`
  - `npx eslint supabase/functions/get-referral-tree/index.ts`

## 2026-04-07 | Governance / Path Owner Map | 새 handbook-sensitive Edge Function helper를 추가하고도 owner-map 규칙 편입을 빼먹음
- Symptom: `fc-onboarding-app` push run은 성공했지만 최신 PR governance run에서 `supabase/functions/_shared/password-reset-account.ts`, `supabase/functions/_shared/request-board-password-sync.ts`에 대한 `No path-owner-map rule` 오류가 발생했다.
- Root cause: `supabase/functions/` 아래 새 helper를 추가하면서 handbook-sensitive path-owner-map가 `_shared` 경로까지 이미 커버한다고 착각했고, 실제 prefix rule에 파일 2개를 넣지 않았다.
- Why it was missed: local build와 push run만 먼저 보고 PR `pull_request` 기준 거버넌스에서 `main -> branch head` 전체 diff를 다시 대조하지 않았다.
- Permanent guardrail: `supabase/functions/` 아래 새 폴더나 `_shared/*.ts` helper를 추가할 때는 구현 직후 `docs/handbook/path-owner-map.json`의 관련 rule(`backend-auth-bridge`, `backend-admin-ops`, `backend-runtime` 등)에 prefix가 실제로 있는지 먼저 확인한다. push success만으로 닫지 말고 PR run에서 `No path-owner-map rule`이 없는지까지 본다.
- Related files:
  - `docs/handbook/path-owner-map.json`
  - `supabase/functions/_shared/password-reset-account.ts`
  - `supabase/functions/_shared/request-board-password-sync.ts`
  - `.claude/MISTAKES.md`
- Verification:
  - `gh run view 24061299763 --repo jj8127/Appointment-Process --log-failed`
  - `cd E:\hanhwa\fc-onboarding-app && node scripts/ci/check-governance.mjs`

## 2026-04-07 | request_board Password Mirror Contract | plain admin까지 request_board sync caller가 계속 남아 contract drift를 만들고 있었음
- Symptom: request_board 쪽 direct mirror 대상이 `fc | designer`(+ `manager -> fc`, `developer -> fc`)로 좁아졌는데도, `login-with-password`, `set-admin-password`, password reset builder 일부는 plain `admin`까지 request_board sync를 계속 시도하고 있었다.
- Root cause: request_board sync transport와 target-role 결정 로직이 `login-with-password`, `set-password`, `reset-password`, `set-admin-password`, `_shared/password-reset-account`에 복제돼 있었고, contract 변경을 한 surface에만 반영했다.
- Why it was missed: request_board에서 `admin_not_mirrored` skip을 허용하고 있었기 때문에 즉시 사용자-visible 장애로 보이지 않았고, 그래서 "실제로는 필요 없는 privileged sync 시도"를 drift로 분류하지 않았다.
- Permanent guardrail: request_board mirror target 결정은 shared helper + `_shared/password-reset-account` builder에서만 관리한다. plain `admin`은 `null`, `developer`는 `fc`, `manager`는 `manager`, linked `designer`는 `designer`라는 매핑을 로그인/최초설정/reset/admin설정 4개 caller에서 함께 대조한다.
- Related files:
  - `supabase/functions/_shared/request-board-password-sync.ts`
  - `supabase/functions/_shared/password-reset-account.ts`
  - `supabase/functions/login-with-password/index.ts`
  - `supabase/functions/reset-password/index.ts`
  - `supabase/functions/set-password/index.ts`
  - `supabase/functions/set-admin-password/index.ts`
- Verification:
  - `cd E:\hanhwa\fc-onboarding-app\web && npm run build`
  - `cd E:\hanhwa\fc-onboarding-app && node scripts/ci/check-governance.mjs`
  - `deno --version` (runtime static check tool availability 확인)

## 2026-04-07 | Local Generated State / Ignore Policy | Supabase CLI 생성물과 로컬 Codex 권한 파일을 tracked 상태로 유지함
- Symptom: 저장소에 `supabase/.temp/*`와 `.claude/settings.local.json`이 tracked 상태로 남아 있어, 현재 개발자 로컬 Supabase link 상태와 도구 권한 설정이 repo diff로 전파될 수 있었다.
- Root cause: `.gitignore`에 `supabase/.temp/`와 `.claude/settings.local.json`가 빠져 있었고, generated/local-only state를 source artifact와 같은 수준으로 다루는 관성이 남아 있었다.
- Why it was missed: 파일들이 직접 runtime code를 바꾸지 않으니 위험도가 낮다고 착각했고, build/governance가 통과하는 동안에도 "machine-local/generated state가 git에 있으면 안 된다"는 기준을 별도 확인하지 않았다.
- Permanent guardrail: Supabase CLI나 Codex가 새 파일을 만들면 먼저 `generated/local-only` 여부를 판단한다. `supabase/.temp/**`와 `.claude/settings.local.json`은 항상 untracked가 원칙이며, cleanup 배치에서는 `git ls-files`와 `git check-ignore -v`로 실제 상태를 증명한 뒤에만 문서화한다.
- Related files:
  - `.gitignore`
  - `.claude/settings.local.json`
  - `supabase/.temp/cli-latest`
  - `supabase/.temp/project-ref`
- Verification:
  - `git -C E:\hanhwa\fc-onboarding-app ls-files .claude/settings.local.json supabase/.temp`
  - `git -C E:\hanhwa\fc-onboarding-app check-ignore -v --no-index .claude/settings.local.json supabase/.temp/cli-latest`
  - `node scripts/ci/check-governance.mjs`
  - `cd E:\hanhwa\fc-onboarding-app\web && npm run build`

## 2026-04-06 | PR Checklist / Governance | 코드 거버넌스만 통과시키고 PR 템플릿 필수 체크리스트를 비워 둔 채 푸시함
- Symptom: 최신 PR governance run에서 path-owner-map 검사는 통과했지만 `Validate PR checklist` 단계가 실패했고, `PROJECT_GUIDE.md 확인`, `WORK_DETAIL 앵커 추가/업데이트`, `WORK_LOG 최근 작업 1행 추가/검토`, `스키마 변경 시 schema.sql + migrations 동시 반영`, `릴리즈/운영 영향(함수 배포·마이그레이션) 기재` 항목이 미체크로 남아 있었다.
- Root cause: repo의 governance를 `check-governance.mjs` 중심으로만 보고, PR body에 있는 별도 required checklist 검증까지 push 완료 조건에 포함하지 않았다.
- Why it was missed: GitHub Actions failure를 파일/코드 이슈로만 생각하는 관성이 남아 있었고, PR 본문을 마지막 완료물로 취급하지 않았다.
- Permanent guardrail: `git push` 뒤에는 `gh run view`로 workflow step 이름까지 확인하고, `Validate PR checklist`가 있는 repo에서는 PR body의 required checkbox를 같은 턴에 채운다. 코드/문서가 맞아도 PR template 미완성 상태면 "푸시 완료"로 보고하지 않는다. PR body를 뒤늦게 수정했으면 기존 `pull_request` run rerun만 믿지 말고, 새 `synchronize` 이벤트가 발생하도록 후속 커밋 또는 새 run 생성까지 확인한다.
- Related files: `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `gh run view 24032520698 --repo jj8127/Appointment-Process --log`, `gh pr view 1 --repo jj8127/Appointment-Process --json body`, `gh api repos/jj8127/Appointment-Process/pulls/1 --method PATCH --raw-field body=...`, `gh run rerun 24032520698 --repo jj8127/Appointment-Process`

## 2026-04-06 | CI Reporting / Run Selection | 성공한 최신 synchronize run이 있는데도 과거 rerun failure가 계속 보일 수 있다는 점을 충분히 분리해 설명하지 않음
- Symptom: 사용자는 `Governance Check #122` rerun failure 화면을 보고 여전히 PR이 깨졌다고 인식했고, 실제로는 최신 `pull_request synchronize` run `24032713335`가 `success`였다.
- Root cause: 제가 "현재 PR 기준 성공 run"과 "과거 SHA/attempt를 다시 돌린 rerun failure"를 명시적으로 분리해 설명하지 않았다.
- Why it was missed: workflow 하나가 green이면 상태가 정리됐다고 보고, GitHub UI에서 이전 run attempt가 별도로 빨갛게 남아 사용자 눈에 먼저 보일 수 있다는 운영 맥락을 과소평가했다.
- Permanent guardrail: CI 결과를 보고할 때는 항상 `run id`, `attempt`, `head sha`, `event`를 함께 적는다. 특히 rerun이 섞인 경우에는 "현재 PR head를 검증한 최신 synchronize run" 링크를 먼저 제시하고, 과거 rerun failure는 stale artifact라고 분명히 구분한다.
- Related files: `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `gh run view 24032520698 --repo jj8127/Appointment-Process --json attempt,headSha,conclusion,url`, `gh run view 24032713335 --repo jj8127/Appointment-Process --json attempt,headSha,conclusion,url`, `gh pr view 1 --repo jj8127/Appointment-Process --json body,updatedAt`

## 2026-04-06 | Dashboard KPI / Workflow Summary | 상단 카드 집계를 raw status shortcut으로 두어 화면 라벨과 실제 의미가 어긋남
- Symptom: 대시보드 상단 카드가 `총 인원`을 사실상 가입 완료 FC 전체 수로 보여주면서 `활성 FC 현황`이라 표기했고, `보증 보험 동의 대기`와 `서류검토 대기`도 workflow helper가 아닌 raw `status` shortcut 기준이라 운영자가 보는 의미와 숫자가 완전히 일치하지 않았다.
- Root cause: 목록/모달/배지에서는 `calcStep`, `getAllowanceDisplayState`, `getDocProgress` 같은 파생 workflow helper를 쓰는데, 상단 KPI 카드만 `fcs.length`, `allowance-pending`, `docs-pending|docs-submitted` 같은 단순 status 집계로 남겨 두었다.
- Why it was missed: 카드 숫자가 대략 그럴듯하게 움직였고, 세부 모달/배지 로직을 먼저 고치면서 summary card는 "단순 카운터"로 취급했다.
- Permanent guardrail: 대시보드 KPI는 raw status shortcut을 직접 세지 않는다. 카드 문구와 숫자가 workflow 단계 의미를 공유해야 할 때는 list badge와 같은 helper(`calcStep`, `getAllowanceDisplayState`, `getDocProgress`)를 재사용하고, 문구가 helper 의미와 다르면 copy도 같이 수정한다.
- Related files: `web/src/app/dashboard/page.tsx`, `docs/handbook/admin-web/dashboard-lifecycle.md`, `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `Get-Content web/src/app/dashboard/page.tsx`, `Get-Content web/src/lib/fc-workflow.ts`, `Get-Content web/src/lib/shared.ts`

## 2026-04-06 | Documentation Governance / Commit Batch | 누적 코드 변경을 한 번에 커밋하려다 WORK_LOG/WORK_DETAIL 갱신 없이 먼저 검증해 governance에 걸림
- Symptom: 누적된 auth/session/web 진입 변경을 한 번에 커밋하려고 `node scripts/ci/check-governance.mjs`를 돌렸더니 `Code changed but WORK_LOG.md and WORK_DETAIL.md were not both updated.`로 실패했다.
- Root cause: 기존 워킹트리에 남아 있던 코드 변경을 "이미 알고 있는 작업"으로 보고, 이번 커밋 배치에서 필요한 로그 갱신을 생략한 채 검증부터 돌렸다.
- Why it was missed: 장수 브랜치에서 누적 변경을 정리할 때 파일 diff는 확인했지만, 거버넌스가 요구하는 "현재 커밋 배치 기준 로그 동반" 규칙을 다시 적용하지 않았다.
- Permanent guardrail: 누적 변경을 뒤늦게 커밋할 때도 `git diff --stat` 단계에서 코드 파일이 보이면, 스테이징 전에 `WORK_LOG.md`/`WORK_DETAIL.md` 동반 갱신 여부를 먼저 확인한다. "예전에 문서화했을 것"이라는 기억으로 넘어가지 않는다.
- Related files: `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `git diff --stat`, `node scripts/ci/check-governance.mjs`

## 2026-04-06 | Commit Scope / Governance | PR 실패 원인으로 확인한 owner-map fix를 로컬에만 남기고 커밋 범위에서 제외한 채 푸시함
- Symptom: PR `Codex/referral rollout closeout` governance check가 다시 실패했고, 로그에는 여전히 `supabase/functions/invite/index.ts`, `supabase/functions/tsconfig.json`, `supabase/functions/validate-referral-code/index.ts` owner-map 누락이 그대로 나왔다.
- Root cause: 같은 세션에서 `docs/handbook/path-owner-map.json` 보강까지 해두고도, 이후 기능 커밋/푸시에서 "내가 방금 건드린 파일만" 선별한다는 이유로 그 fix를 제외했다. 결과적으로 PR 전체 diff 기준 blocker를 알고도 upstream에 보내지 못했다.
- Why it was missed: 장수 브랜치 debt와 현재 commit scope를 분리하겠다는 판단은 맞았지만, 이미 확인된 PR blocker는 예외 없이 같은 push batch에 포함해야 한다는 원칙을 다시 적용하지 않았다.
- Permanent guardrail: PR 실패 원인을 특정 파일 수준으로 확인한 뒤에는, 그 파일이 로컬 worktree에 남아 있으면 다음 push 전에 반드시 staged 여부를 다시 확인한다. `git diff -- <blocking-file>`와 `git diff --cached -- <blocking-file>` 둘 다 보고, blocker fix가 uncached 상태면 푸시하지 않는다.
- Related files: `docs/handbook/path-owner-map.json`, `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `gh run view 24032384700 --repo jj8127/Appointment-Process --log`, `git -C E:\hanhwa\fc-onboarding-app diff -- docs/handbook/path-owner-map.json`

## 2026-04-06 | Web Entry Routing | auth loop를 줄이려다 `/` 진입을 로더 고정 화면으로 남겨 실제 진입 경로가 끊김
- Symptom: `http://localhost:3000` 서버는 200 응답을 주지만, 브라우저에서는 첫 화면이 계속 로더만 보이고 `/auth`나 `/dashboard`로 넘어가지 않았다.
- Root cause: `/` 페이지에서 기존 client redirect를 제거한 뒤, 대체 분기 없이 로더만 렌더하도록 남겨 두었다. 그 결과 root entry가 세션 복원 이후에도 아무 route resolution을 하지 않았다.
- Why it was missed: `middleware`와 `dashboard` 보호 경로만 확인하고, 사용자가 가장 먼저 여는 `/` landing route를 실제 브라우저로 다시 밟지 않았다. HTTP 200과 build 통과를 entry flow 정상으로 과대해석했다.
- Permanent guardrail: auth/session 수정 뒤에는 `/`, `/auth`, `/dashboard` 세 진입점을 모두 브라우저 기준으로 확인한다. `/`는 세션에 따라 즉시 `/dashboard` 또는 `/auth`로 resolve되어야 하며, indefinite loader는 회귀로 본다.
- Related files: `web/src/app/page.tsx`, `web/src/hooks/use-session.tsx`, `web/src/app/auth/page.tsx`, `web/src/app/dashboard/layout.tsx`
- Verification: `http://localhost:3000` headless browser redirect 확인, `cd E:\hanhwa\fc-onboarding-app\web && npm run lint -- src/app/page.tsx`, `cd E:\hanhwa\fc-onboarding-app\web && npx next build`

## 2026-04-06 | Admin Web Workflow Tabs | 보증 보험 동의에만 있던 direct-input 계약을 생명/손해 위촉 완료일에는 맞추지 않아 운영 입력 흐름이 탭마다 갈라짐
- Symptom: 총무는 `보증 보험 동의` 탭에서는 `동의일(Actual)`을 trusted path로 직접 저장할 수 있었지만, `생명/손해 위촉` 탭에서는 같은 종류의 실제 완료일을 `승인 완료` 흐름에 기대어 우회적으로만 처리해야 했다.
- Root cause: dashboard workflow tab을 단계별로 따로 보강하면서 `실제 날짜 직접입력 + trusted save route + status normalization + list invalidation` 계약을 allowance에만 만들고 appointment에는 parity 체크를 하지 않았다.
- Why it was missed: 기존 appointment tab에 `승인 완료` 버튼이 이미 있다는 이유로 "총무도 입력 가능하다"라고 간주했고, 보증 보험 동의에서 분리한 direct-input 패턴을 다른 workflow tab에도 적용해야 하는지까지 대조하지 않았다.
- Permanent guardrail: admin workflow tab에 `Actual` 날짜 입력이 있으면 allowance, hanwha, appointment를 같은 4축으로 비교한다. `직접 저장 버튼`, `trusted route action`, `status normalization`, `dashboard-list/detail invalidation` 중 하나라도 빠지면 parity drift로 본다.
- Related files: `web/src/app/dashboard/page.tsx`, `web/src/app/api/admin/fc/route.ts`, `web/src/lib/fc-workflow.ts`, `docs/handbook/admin-web/dashboard-lifecycle.md`
- Verification: `cd E:\hanhwa\fc-onboarding-app\web && npm run lint -- src/app/dashboard/page.tsx src/app/api/admin/fc/route.ts src/lib/fc-workflow.ts`, `cd E:\hanhwa\fc-onboarding-app\web && npx next build`, `cd E:\hanhwa\fc-onboarding-app && node scripts/ci/check-governance.mjs`

## 2026-04-06 | Governance / PR Diff Range | 로컬 거버넌스만 보고 장수 브랜치 전체 PR 거버넌스 상태를 확인하지 않아 PR 체크가 다시 실패
- Symptom: 로컬에서는 `node scripts/ci/check-governance.mjs`가 통과했는데, PR `Codex/referral rollout closeout #118`의 GitHub Actions governance check는 즉시 실패했다.
- Root cause: 현재 세션 변경분만 기준으로 거버넌스를 확인하고, `main -> 현재 브랜치 HEAD` 전체 PR diff range에서 남아 있던 governance debt를 다시 확인하지 않았다. 실제 실패 원인은 branch 전체 diff에 포함된 `supabase/functions/invite/index.ts`, `supabase/functions/tsconfig.json`, `supabase/functions/validate-referral-code/index.ts`에 대한 path-owner-map rule 누락이었다.
- Why it was missed: 장수 브랜치 위에 후속 커밋만 얹으면서 "방금 바꾼 것만 통과하면 된다"는 관성으로 봤고, PR 단위 기준(`BASE_SHA=main`, `HEAD_SHA=current branch`)과 로컬 기준을 분리해 생각하지 않았다.
- Permanent guardrail: 장수 브랜치나 기존 PR 위에 추가 커밋을 올릴 때는 로컬 검증만으로 닫지 않는다. 반드시 `gh run view` 또는 PR check 결과로 현재 PR 전체 diff의 governance 상태를 확인하고, 필요하면 `BASE_SHA=<main sha> HEAD_SHA=<branch sha> node scripts/ci/check-governance.mjs`처럼 PR 기준으로 다시 본다. 새 커밋이 docs-only여도 기존 브랜치 debt가 남아 있으면 "푸시 완료"로 보고하지 않는다.
- Related files: `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `gh run view 24017748248 --repo jj8127/Appointment-Process --log`, `gh run view 24017748248 --repo jj8127/Appointment-Process --json name,workflowName,conclusion,status,url,event,headBranch,headSha,jobs`

## 2026-04-06 | Verification Discipline | 실행하지 못한 검증을 문서에 통과처럼 먼저 적으려 한 실수
- Symptom: 게시판 알림 fanout 수정 후 `WORK_DETAIL`와 harness QA에 `deno check` 통과 문구를 먼저 넣었지만, 실제 shell에는 `deno` CLI가 없어 그 검증을 실행할 수 없었다.
- Root cause: 구현 직후 문서화를 하면서 "원래 돌려야 하는 검증 세트"를 그대로 적었고, 실제 명령 실행 가능 여부와 결과를 문서 반영보다 나중에 확인했다.
- Why it was missed: 코드 수정과 문서 갱신을 한 흐름으로 처리하면서, 검증 섹션을 계획이 아니라 증적로 써야 한다는 구분이 느슨해졌다.
- Permanent guardrail: 검증 문서에는 실제로 실행한 명령과 shell 결과만 적는다. 실행 불가 도구(`deno` 등)가 있으면 즉시 `불가`로 기록하고 대체 검증을 별도 줄로 남긴다. "pass" 문구는 명령 출력 확인 뒤에만 쓴다.
- Related files: `.claude/WORK_DETAIL.md`, `.codex/harness/qa-report.md`, `.codex/harness/handoff.md`
- Verification: 문서 수정 후 governance check

## 2026-04-06 | Board Notifications | 게시판 글 작성이 알림함 저장만 되고 푸시 fanout은 빠져 앱 푸시가 가지 않음
- Symptom: web 또는 가람in 앱에서 게시판 글을 작성하면 `notifications` row는 생겨 알림센터에는 보일 수 있지만, 가람in 기기와 admin/manager 대상 푸시는 전송되지 않았다.
- Root cause: `board-create`가 `notifications` 테이블에 직접 row만 insert하고 끝났고, Expo push + admin web push fanout의 SSOT인 `fc-notify` 경로를 호출하지 않았다.
- Why it was missed: 알림 저장과 푸시 발송을 별개 계약으로 분리해 두지 않았고, 인앱 알림함에서 row가 보이는 것만으로 "알림 구현 완료"처럼 판단했다.
- Permanent guardrail: 새 알림 소스가 `notifications`를 직접 기록하면 같은 change set에서 `fc-notify` fanout도 같이 연결하거나, `fc-notify`를 직접 통해 저장과 fanout을 한 번에 처리한다. 저장만 직접 수행하는 예외 경로는 `skip_notification_insert` 같은 명시적 계약으로 중복 insert를 막고, 검증도 `알림함 row + Expo/admin web push` 둘 다 확인한다.
- Related files: `supabase/functions/board-create/index.ts`, `supabase/functions/fc-notify/index.ts`, `docs/handbook/backend/notifications-inbox-push.md`
- Verification: Deno check, governance check

## 2026-04-06 | Web Profile Save Contract | FC 상세와 대시보드 모달의 profile-save 계약을 따로 유지해 임시사번 저장/단계 반영이 다시 어긋남
- Symptom: `/dashboard/profile/[id]`에서는 주소 등 기본정보를 저장해도 운영자는 여전히 목록에서 `사전등록`처럼 보인다고 느꼈고, 같은 상세 페이지에서는 `temp_id`를 아예 수정할 수 없었다.
- Root cause: 같은 FC profile 도메인을 다루는 `/dashboard` 모달과 `/dashboard/profile/[id]`가 서로 다른 save contract를 들고 있었다. 모달은 `temp_id`와 상태 보정을 함께 다뤘지만, 상세 페이지는 `temp_id` 필드 자체가 없었고 저장 후 `dashboard-list` invalidation도 빠져 있었다.
- Why it was missed: 상세 페이지를 `getProfile` trusted path로 복구할 때 read contract만 맞추고, edit contract가 모달과 같은지까지 비교하지 않았다. 화면 하나를 고친 뒤 같은 도메인의 다른 surface와 payload/query invalidation parity를 다시 체크하지 않았다.
- Permanent guardrail: FC profile을 수정하는 새 surface를 추가하거나 고칠 때는 `수정 가능한 필드`, `trusted route payload`, `status normalization`, `query invalidation` 네 축을 기존 대표 surface와 diff로 대조한다. 특히 `temp_id`, `allowance_date`, 추천인처럼 workflow에 직접 영향을 주는 필드는 한 화면만 따로 계약을 가지게 두지 않는다.
- Related files: `web/src/app/dashboard/profile/[id]/page.tsx`, `web/src/app/dashboard/page.tsx`, `web/src/app/api/admin/fc/route.ts`, `.claude/WORK_DETAIL.md`
- Verification: targeted web lint, `npx next build`, governance check

## 2026-04-06 | Web Auth Session | 서버 쿠키와 클라이언트 localStorage 세션 계약을 따로 봐서 redirect loop 재발
- Symptom: `/dashboard` 접근 시 `/auth`, `/`, `/dashboard` 요청이 반복되며 실제 관리자 웹에 안정적으로 들어가지 못했다.
- Root cause: middleware와 server route는 cookie(`session_role`, `session_resident`)를 세션 SSOT로 봤지만, `use-session`은 localStorage만 복원하고 protected layout이 client redirect를 직접 수행해, 쿠키는 유효하지만 client role은 `null`인 상태에서 `/dashboard -> /auth` bounce가 발생했다.
- Why it was missed: 이전 수정에서 "FC를 `/dashboard`로 보내지 않는다"는 역할 분기만 다루고, 서버와 클라이언트가 어떤 저장소를 세션 진실원으로 쓰는지는 따로 계약화하지 않았다.
- Permanent guardrail: admin web auth는 `cookie-first restore -> localStorage fallback -> cookie resync` 순서로 복원하고, protected route 접근 제어는 middleware를 1차 기준으로 둔다. layout/page에서 redirect를 추가할 때는 "middleware와 같은 세션 소스인가"를 먼저 확인한다.
- Related files: `web/src/hooks/use-session.tsx`, `web/middleware.ts`, `web/src/app/page.tsx`, `web/src/app/auth/page.tsx`, `web/src/app/dashboard/layout.tsx`, `web/src/app/admin/layout.tsx`
- Verification: targeted lint, web production build

## 2026-04-06 | Investigation Discipline | 스크린샷 surface와 실패 축을 확인하지 않고 부분 패치부터 진행해 재작업 발생
- Symptom: 사용자가 `/dashboard/exam/applicants` 주민등록번호 컬럼 스크린샷을 보냈는데도 처음에는 `/dashboard` 메인/모달 resident-number 경로와 접속 순환 문제를 먼저 따라가서, 실제 깨진 surface와 다른 곳을 고치고도 `여전히 안돼`가 반복됐다.
- Root cause: 화면 식별을 코드 검색보다 먼저 하지 않았고, "주소는 보이는데 주민번호만 실패"라는 신호를 충분히 활용하지 않아 `fc_profiles` 매칭 성공 + secure resident-number read 실패라는 축을 늦게 분리했다.
- Why it was missed: 이미 resident-number 회귀 맥락을 알고 있다는 이유로 현재 증거보다 기존 가설에 끌렸고, 사용자가 우선순위를 바꿨을 때도 그 지시를 바로 contract에 반영하지 않았다.
- Permanent guardrail: 스크린샷/사용자 제보가 오면 먼저 해당 헤더/문구를 실제 렌더링하는 화면과 route를 코드에서 식별한다. 증상별로 `화면 식별 -> 데이터 연결 성공 여부 -> secure read 실패 여부` 순서로 축을 분리한 뒤에만 패치한다. 사용자가 우선순위를 바꾸면 현재 작업 contract와 handoff를 즉시 재정렬한다.
- Related files: `web/src/app/dashboard/exam/applicants/page.tsx`, `web/src/app/api/admin/exam-applicants/route.ts`, `web/src/app/api/admin/resident-numbers/route.ts`, `web/src/lib/server-resident-numbers.ts`
- Verification: screen header search, targeted lint, web production build, governance check

## 2026-04-06 | Web Resident Number | direct decrypt 전용 경로를 남겨 시험 신청자 화면만 다시 전부 실패
- Symptom: `/dashboard` 모달과 `/dashboard/profile/[id]`는 resident-number 회귀를 정리했는데 `/dashboard/exam/applicants` 주민등록번호 열은 여전히 전부 `주민번호 조회 실패`로 남았다.
- Root cause: `exam-applicants` route가 `fc_profiles` 연결 일부만 맞춘 뒤에도 secure resident-number 읽기는 direct decrypt만 사용하고, `/api/admin/resident-numbers`가 가진 edge-function fallback 계약을 공유하지 않았다.
- Why it was missed: "전화번호 포맷 drift가 원인"이라는 중간 가설을 너무 빨리 확정해서, 실제로는 `fc_profiles` 매칭 이후의 resident-number fallback 불일치까지 동일 change set에서 정리해야 한다는 점을 놓쳤다.
- Permanent guardrail: resident-number full-view를 제공하는 모든 서버 경로는 direct decrypt와 edge-function fallback을 공통 유틸로 공유한다. 화면별 patch 전에 `주민번호를 누가 최종 반환하는가`를 route 단위로 나열하고, 새 surface를 찾으면 같은 change set에 묶어 업데이트한다.
- Related files: `web/src/app/api/admin/exam-applicants/route.ts`, `web/src/app/api/admin/resident-numbers/route.ts`, `web/src/lib/server-resident-numbers.ts`, `docs/handbook/admin-web/exam-and-referral-ops.md`
- Verification: targeted lint, web production build, governance check

## 2026-04-06 | Web Resident Number | 주민번호 full-view 회귀를 화면별 임시복구로 끝내서 다시 drift 발생
- Symptom: `fc-onboarding-app/web`에서 FC detail resident-number full-view가 이미 복구된 줄 알았지만 `/dashboard` 모달, `/dashboard/profile/[id]`, `/dashboard/exam/applicants` 가 다시 서로 어긋나거나 세션/전화번호 포맷 차이로 실패할 수 있는 상태가 남아 있었다.
- Root cause: resident-number client fetch와 secure-row 매핑이 화면/route별로 중복돼 있었고, admin/manager 전화번호 검증 및 FC 프로필 연결은 `/api/admin/resident-numbers`, `/api/admin/fc`, `/api/admin/exam-applicants` 가 서로 다른 규칙(raw/digits/formatted vs digits-only/exact-only)을 사용했다.
- Why it was missed: 기존 `WORK_LOG`/`WORK_DETAIL`은 변경 사실은 남겼지만 "이번 문제의 실수 패턴이 무엇인지"를 별도로 고정하지 않아, 다음 수정자가 다른 resident-number surface 하나를 빠뜨린 채 부분 복구로 끝내기 쉬웠다.
- Permanent guardrail: web resident-number 조회는 shared hook/공용 client 또는 공통 secure-row 매핑 규칙으로 통일하고, admin/manager 세션 전화번호 검증과 FC 프로필 phone 연결은 공통 후보(raw/digits/formatted) 규칙을 재사용한다. 같은 종류의 회귀를 고칠 때는 이 파일에 반드시 추가 기록한다.
- Related files: `web/src/hooks/use-resident-number.ts`, `web/src/lib/resident-number-client.ts`, `web/src/lib/server-session.ts`, `web/src/app/api/admin/resident-numbers/route.ts`, `web/src/app/api/admin/fc/route.ts`, `web/src/app/api/admin/exam-applicants/route.ts`, `web/src/app/dashboard/page.tsx`, `web/src/app/dashboard/profile/[id]/page.tsx`, `web/src/app/dashboard/exam/applicants/page.tsx`
- Verification: targeted web lint, web production build, governance check

## 2026-04-23 | Referral Graph Single-State | 그래프 런타임 모델을 단일 edge로 바꿔 놓고도 subtitle/범례 copy는 예전 다중 상태 설명을 남겨둠
- Symptom: 추천인 single-state 구현 뒤에도 `/dashboard/referrals/graph` 상단 설명과 범례에 `추천인 연결 + 확인`, `추가 확인` 같은 old edge-state 문구가 그대로 보여 사용자가 여전히 두세 종류의 live 관계가 있다고 해석할 수 있었다.
- Root cause: 타입/API/렌더링 로직만 단일화하고, 화면 설명·범례·empty/help copy까지 같은 계약 변경에 포함해야 한다는 확인이 빠졌다.
- Why it was missed: "edge 색/데이터 shape가 단순해졌으니 끝났다"는 식으로 내부 계약 수정에만 집중했고, 사용자-facing explanation audit를 같은 change set의 acceptance check로 두지 않았다.
- Permanent guardrail: 상태 모델을 단순화하거나 이름을 바꿀 때는 `types + API + renderer + subtitle/legend/badge/help text`를 한 묶음으로 grep해서 old vocabulary가 남았는지 확인한다. 특히 graph/list/operator surface는 data contract 정리 후 반드시 문구까지 함께 맞춘다.
- Related files: `web/src/types/referral-graph.ts`, `web/src/lib/referral-graph-edges.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/app/dashboard/referrals/graph/page.tsx`
- Verification: `cd E:\hanhwa\fc-onboarding-app\web && npm run lint -- src/app/dashboard/referrals/graph/page.tsx`, `/dashboard/referrals/graph` 브라우저 smoke

## 2026-04-24 | Referral Graph Visual QA | 비어 있지 않은 canvas smoke만으로 Obsidian형 사용성/물리 품질을 완료처럼 판단함
- Symptom: radial layout과 drag inertia를 구현한 뒤 canvas nonblank, 버튼 클릭, 기본 drag smoke는 통과했지만 사용자가 실제 화면에서 Obsidian Graph View처럼 보기 편하지 않고 물리 품질이 낮다고 느꼈다. 이어서 이름 라벨을 없애면 안 된다는 조건, 그룹끼리 겹치면 안 된다는 조건, drag 중 링크가 길게 늘어나면 안 된다는 조건, drag 후 노드가 놓은 위치에 즉시 머물러야 한다는 조건이 추가로 확인됐다.
- Root cause: 구현 검증이 `렌더됨/상호작용됨`에 치우쳤고, 요구의 핵심인 visual density, label readability, node/link weight, component envelope overlap, drag release after-feel을 별도 acceptance로 분리하지 않았다.
- Why it was missed: Obsidian 참고를 force 설정명과 radial seed에만 반영했고, 공식 Graph View의 display/forces 항목처럼 text fade, node size, link thickness, center/repel/link/distance가 함께 만드는 읽기 경험을 screenshot 기준으로 충분히 평가하지 않았다. 또한 실제 운영 데이터의 connected component끼리 겹치지 않는지 component radius 기준으로 계산하지 않고, drag smoke도 "움직인다"만 보고 "링크가 찢어지지 않는가"와 "사용자가 놓은 좌표에서 release velocity가 즉시 0이 되는가"를 확인하지 않았다.
- Permanent guardrail: graph/visualization 작업은 unit test와 nonblank smoke만으로 완료 처리하지 않는다. 최소 한 장의 실제 viewport screenshot을 확인하고, `이름 라벨 가시성`, `일반 label code 과노출 여부`, `node radius`, `link alpha/thickness`, `connected component overlap 없음`, `drag 중 linked neighbor follow`, `drag 후 hard pin 없음`, `drag 후 dropped position 즉시 유지`를 acceptance로 적어야 한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-layout.ts`, `web/src/lib/referral-graph-interaction.ts`, `web/src/lib/referral-graph-display.ts`, `web/src/lib/referral-graph-highlight.ts`, `.codex/harness/qa-report.md`
- Verification: `node --experimental-strip-types --test web/src/lib/referral-graph-layout.test.ts`, `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts`, `node --experimental-strip-types --test web/src/lib/referral-graph-display.test.ts`, `node --experimental-strip-types --test web/src/lib/referral-graph-highlight.test.ts`, synthetic Playwright screenshot `.codex/harness/referral-graph-obsidian-overview-qa.png`, real-data screenshot `.codex/harness/referral-graph-no-overlap-qa.png`

## 2026-04-24 | Referral Graph Drag Physics | 수동 위치 force가 d3 velocity를 덮어써 release 후 기존 물리가 죽고 링크 길이가 비정상적으로 남음
- Symptom: 사용자가 노드를 드래그한 뒤 직접 연결선이 비정상적으로 길게 남는다고 보고했다. 추가로 "드래그한 위치에서 크게 벗어나면 안 되지만, 기존 물리법칙은 놓았을 때도 유지되어야 한다"는 계약이 확인됐다.
- Root cause: `manual-placement` force가 link/charge/center force가 만든 `vx/vy`에 더하는 대신 마지막에 값을 교체했다. 이 때문에 soft anchor가 사실상 기존 graph physics를 무력화했고, follower anchor도 모든 이동 follower에 갱신되지 않아 일부 이웃이 이전 layout target으로 돌아가며 edge stretch가 남을 수 있었다.
- Why it was missed: "놓은 위치 유지"를 "속도 제거/강한 anchor"로만 해석했고, d3 force tick에서는 여러 force가 velocity를 누적해야 한다는 계약을 테스트로 고정하지 않았다. direct neighbor가 drag delta 전체를 따라오는지, follower anchor가 새 위치로 저장되는지도 별도 회귀 테스트가 없었다.
- Permanent guardrail: force-graph drag UX를 수정할 때 manual/user placement force는 기존 `vx/vy`를 overwrite하지 않고 additive correction으로만 구현한다. 2026-04-25 후속 조사로 follower 좌표 직접 이동과 follower anchor 저장도 금지됐다. 테스트에는 direct link stretch 방지, correction cap/additive semantics, no-follower-coordinate-move를 포함한다.
- Related files: `web/src/lib/referral-graph-interaction.ts`, `web/src/lib/referral-graph-interaction.test.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Verification: `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts`, targeted web lint, `cd web && npm run build`

## 2026-04-25 | Referral Graph Drag Ownership | follower 좌표 직접 이동과 anchor 누적으로 d3 force 자유도를 잃음
- Symptom: 사용자가 노드를 드래그하면 edge가 비정상적으로 길어지고, release 후 노드가 1초가량 멋대로 움직이거나 edge가 겹친 상태로 멈췄다. drag 중에도 시간이 지나면 link가 원래 길이로 돌아가야 한다는 Obsidian형 rubber-band 계약이 확인됐다.
- Root cause: drag 이벤트에서 1/2/3-hop follower의 `x/y`를 직접 이동하고 follower마다 persistent manual anchor를 남겼다. d3-force는 force가 velocity에 누적되어야 하는데, 좌표 직접 이동과 soft anchor 누적으로 link force가 이웃을 자연스럽게 복원할 자유도를 잃었다.
- Why it was missed: "관성"을 release 후 흔들림으로 이해했고, "edge가 길어지지 않게"를 follower 좌표를 함께 옮기는 방식으로 풀었다. 실제 요구는 drag 중에도 link spring이 계속 당기고, release 후에는 dropped position을 짧게 약하게만 기억하는 구조였다.
- Permanent guardrail: force-graph drag에서 pointer 대상 노드 외에는 좌표를 직접 쓰지 않는다. drag 중에는 대상 노드만 임시 `fx/fy`로 잡고 simulation을 reheat한다. release는 `fx/fy` 해제, recent sample 기반 clamped velocity 주입, dragged node 1개짜리 decaying drop tether만 허용한다. component/hub/drop 보정 force는 모두 `vx/vy += delta` 방식이어야 한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-interaction.ts`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-layout.ts`
- Verification: `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-edges.test.ts`, targeted web lint, `cd web && npm run build`, Playwright synthetic browser QA screenshot `.codex/harness/referral-graph-physics-browser-qa.png`, `node scripts/ci/check-governance.mjs`

## 2026-06-04 | Mobile Theme | 시스템 다크 테마를 허용해 로그인/CTA 배경이 검정으로 보임
- Symptom: SM_S942N 실기기에서 로그인 화면과 일부 홈 CTA/card 영역이 의도한 흰색/주황색 톤 대신 검정 배경처럼 보였다.
- Root cause: `app.json`이 `userInterfaceStyle: automatic`이고 root navigation이 `DarkTheme`를 시스템 색상에 따라 적용했다. 로그인 화면도 native gradient가 늦게 붙거나 실패할 때 fallback `backgroundColor`가 없어 Android dark base가 그대로 드러날 수 있었다.
- Why it was missed: 색상 회귀를 개별 버튼/카드 스타일 문제로만 보고, Expo system UI + React Navigation theme + screen fallback background를 같은 acceptance로 묶지 않았다. 실기기 dark-mode screenshot 확인을 완료 조건에 두지 않아 같은 증상이 반복됐다.
- Permanent guardrail: 가람in 모바일은 별도 dark theme 구현 전까지 light-only 계약이다. `app.json`, root `ThemeProvider`, `NavigationBar`, screen/container fallback background를 함께 고정하고, UI 색상 회귀 수정 뒤에는 SM_S942N 또는 Android target에서 해당 화면 스크린샷을 반드시 확인한다.
- Related files: `app.json`, `app/_layout.tsx`, `app/login.tsx`
- Verification: `npm run lint -- app/_layout.tsx app/login.tsx`, `npx expo config --type public`, `npx expo run:android --device SM_S942N`, ADB screenshot `privacy-deleted; see central FC raw-harness receipt`

## 2026-06-04 | Admin Web FC Access | JS로 쓰는 웹 세션 쿠키를 그대로 FC 권한 근거로 쓰려 해 impersonation 위험을 만들 뻔함
- Symptom: 관리자 웹 추천인 그래프를 FC에게 열면서 `session_role=fc`, `session_resident=<전화번호>` 쿠키만 있으면 그래프 API allowlist를 통과할 수 있는 구조가 될 수 있었다.
- Root cause: 기존 admin web 세션이 client-side cookie/localStorage를 표시 상태와 서버 세션 힌트로 동시에 사용한다는 점을 충분히 분리하지 않았다. FC처럼 일반 사용자에게 웹 표면을 열 때는 "역할 쿠키 + DB에 전화번호 존재"가 인증 증명이 될 수 없는데, route containment와 graph downline scope만 먼저 구현했다.
- Why it was missed: staff-only 관리자 웹에서는 기존 쿠키 모델의 위험이 덜 드러났고, 새 FC 접근 요구를 "권한 스코프" 문제로만 봤다. 보안 subagent가 수동 쿠키 조작 공격 경로를 지적한 뒤에야 signed/HttpOnly 세션을 별도 추가했다.
- Permanent guardrail: admin web에 FC 또는 외부 사용자를 추가할 때는 JS-readable session cookie를 인증 근거로 쓰지 않는다. public login/API handoff에서 서버가 검증한 signed/HttpOnly cookie를 발급하고, protected API는 그 서명 세션을 다시 확인한다. UI 메뉴 제한은 server route/API authorization 이후의 보조 수단으로만 취급한다.
- Related files: `web/src/lib/fc-graph-session.ts`, `web/src/lib/server-session.ts`, `web/src/app/api/auth/login/route.ts`, `web/middleware.ts`, `web/src/lib/admin-referrals.ts`
- Verification: `node --test web/src/lib/admin-web-route-access.test.ts web/src/lib/referral-graph-scope.test.ts web/src/lib/fc-graph-session.test.ts`, targeted web lint, `cd web; SENTRY_AUTH_TOKEN='' npm run build`

## 2026-06-04 | Request Board Role Actions | 설계 완료 후 FC 승인/거절 액션을 설계매니저 화면에 노출
- Symptom: 설계매니저의 의뢰 상세 화면에서 설계 완료된 항목에 `거절`/`승인` 버튼이 표시됐다.
- Root cause: 완료된 assignment의 `fc_decision=pending` 상태를 FC 검토 조건과 설계매니저 관리 조건에 함께 재사용하면서, 액션 렌더링에 명시적인 역할 gate가 부족했다.
- Why it was missed: `request-board-review` 화면이 FC 검토와 설계매니저 상세/관리 surface를 공유하는데도, 완료 설계 이후의 액션 소유권을 역할별 테스트로 고정하지 않았다.
- Permanent guardrail: 완료 설계의 FC decision 버튼은 `!isRequestBoardDesigner && needsReview` 조건에서만 렌더링한다. 설계매니저 화면은 같은 상태를 `FC 검토 대기`로만 표시하고, 역할별 Android UI 확인 또는 그에 준하는 명시적 회귀 테스트를 남긴다.
- Related files: `app/request-board-review.tsx`, `lib/__tests__/request-board-review-role.contract.test.ts`
- Verification: `npx jest lib\__tests__\request-board-api-contract.test.ts lib\__tests__\request-board-mobile-products.test.ts lib\__tests__\request-board-review-role.contract.test.ts lib\__tests__\request-board-session.test.ts --runInBand`, `npx tsc --noEmit`, `npm run lint -- app\request-board-review.tsx lib\__tests__\request-board-review-role.contract.test.ts`, [privacy-safe UI QA](../docs/testing/PRIVACY_SAFE_QA_EVIDENCE_2026-07.md#ui-qa); 설계매니저 Android visual pass는 사용자 지시로 보류하고 사용자 세션/임시 request_board 데이터는 복구 및 삭제했다.

## 2026-06-04 | Request Board Bottom Sheet | 완료 CTA를 Android 시스템 내비게이션 바와 겹치게 배치
- Symptom: 설계매니저 선택 바텀시트에 `1명 선택 완료` 버튼을 추가했지만 SM_S942N 화면에서 버튼 하단이 Android 시스템 내비게이션 바와 겹쳤다.
- Root cause: Modal 바텀시트 footer를 추가하면서 `useSafeAreaInsets().bottom`만 믿었고, Android edge-to-edge/에뮬레이터 환경에서 bottom inset이 `0`으로 들어오는 경우를 위한 충분한 fallback padding을 두지 않았다.
- Why it was missed: 버튼 존재/비활성 상태만 테스트하고, Android 하단 시스템 영역과의 충돌을 별도 계약으로 고정하지 않았다.
- Permanent guardrail: 모바일 바텀시트/고정 footer CTA를 추가할 때는 `safe-area bottom + 여유 여백`뿐 아니라 Android inset 0 fallback 최소 여백도 helper/test로 고정한다. 키보드가 열린 상태는 별도 분기로 과한 footer 여백을 주지 않는다.
- Related files: `app/request-board-create.tsx`, `lib/request-board-designer-selection.ts`, `lib/__tests__/request-board-designer-selection.test.ts`
- Verification: `npx jest lib\__tests__\request-board-designer-selection.test.ts --runInBand`, `npx tsc --noEmit`, `npm run lint -- app\request-board-create.tsx lib\request-board-designer-selection.ts lib\__tests__\request-board-designer-selection.test.ts`

## 2026-06-04 | Referral Invite Deep Link | 공유 링크와 회원가입 자동 적용 계약을 분리해서 추천 코드가 수동 입력처럼 남음
- Symptom: 추천인 코드 공유하기가 invite landing URL 대신 plain 추천 코드와 store link 중심으로 공유됐고, 앱 실행 후 회원가입으로 들어와도 추천 코드가 실제 선택/적용 상태가 되지 않을 수 있었다.
- Root cause: `EXPO_PUBLIC_INVITE_BASE_URL`이 없을 때 production invite page 기본값을 쓰지 않았고, pending deep-link code를 검색어로만 넣어 search result 선택 계약과 충돌시켰다.
- Why it was missed: 공유 문구 테스트와 회원가입 pending-code 상태 테스트가 분리되어 있지 않아, landing page URL 생성과 signup selected-referral 적용을 end-to-end 계약으로 고정하지 못했다.
- Permanent guardrail: invite/deep-link 기능은 `공유 URL -> landing query -> custom scheme -> pending storage -> signup selected state -> server validation -> persisted referralCode`를 한 흐름으로 테스트한다. 초대 링크 코드는 검색어가 아니라 선택된 추천인 placeholder로 먼저 적용하고 검증 결과로 보강한다.
- Related files: `app/referral.tsx`, `app/signup.tsx`, `lib/referral-share.ts`, `lib/signup-referral.ts`
- Verification: `npx jest lib\__tests__\referral-share.test.ts lib\__tests__\signup-referral.test.ts --runInBand`, focused Expo lint

## 2026-06-05 | Admin Web Next 16 Proxy | Vercel packaging에서 deprecated middleware output을 기대
- Symptom: Vercel `admin_web` preview가 build 막바지에 `ENOENT: no such file or directory, open '/vercel/path1/.next/server/middleware.js.nft.json'`로 실패했다.
- Root cause: `web`이 Next.js 16인데 route boundary 파일을 여전히 `middleware.ts` + `export function middleware`로 유지했다. Next 16 convention은 `proxy.ts` + `export function proxy`이고, Vercel packaging 단계가 middleware nft output을 찾으며 실패했다.
- Why it was missed: 로컬 `npm run build`만으로는 Vercel packaging 단계의 missing nft file을 재현하지 못했고, Next 16 migration convention을 preview 배포 검증 항목에 넣지 않았다.
- Permanent guardrail: Next.js 16 admin web에서 route gate/proxy boundary는 `web/proxy.ts`와 `export function proxy`를 사용한다. Vercel 배포 실패를 닫기 전에는 `vercel inspect <deployment> --logs`로 원격 packaging 오류를 확인하고, 가능하면 `npx vercel build`까지 로컬에서 실행한다.
- Related files: `web/proxy.ts`, `web/middleware.ts`
- Verification: `cd web; SENTRY_AUTH_TOKEN='' npm run build`, `cd web; npm run lint`, `node scripts/ci/check-governance.mjs`; remote failure evidence from `vercel inspect <deployment> --logs`.
- Local Vercel CLI note: `npx vercel build` inside `web` can double-apply `rootDirectory=web` and fail with local Windows `cmd.exe ENOENT`; do not treat that as the same failure as Vercel remote `middleware.js.nft.json`.

## 2026-06-04 | Exam Schedule Notifications | 시험 일정 알림을 `fc-notify` 대신 직접 Expo push로 보내려 함
- Symptom: 총무가 관리자 웹에서 시험 일정을 등록/수정해도 FC 모바일 알림이 안정적으로 도착하지 않는다고 보고됐다.
- Root cause: `web/src/app/dashboard/exam/schedule/actions.ts`가 shared notification contract인 `fc-notify`를 쓰지 않고 `notifications` direct insert, `device_tokens` direct query, Expo push direct send를 자체 구현했다.
- Why it was missed: 기존 게시판/알림 경로에서 이미 `notifications` row만 직접 쓰면 push fanout이 빠진다는 실수가 있었는데, 시험 일정 관리 server action을 같은 알림 계약 점검 대상으로 묶지 않았다.
- Permanent guardrail: 새 FC 대상 알림 소스는 `fc-notify` `type: notify` payload를 통해 inbox insert와 Expo fanout을 함께 처리한다. 직접 `notifications` insert 또는 direct Expo push block을 만들면 같은 변경 세트에서 helper/test로 예외 이유를 고정해야 한다.
- Related files: `web/src/app/dashboard/exam/schedule/actions.ts`, `web/src/lib/exam-round-notification.ts`, `web/src/lib/exam-round-notification.test.ts`, `supabase/functions/fc-notify/index.ts`
- Verification: `node --test src/lib/exam-round-notification.test.ts`, `cd web && npm run lint`

## 2026-06-04 | Admin Web FC Graph Session | FC용 관리자 웹 진입과 graph API 인증 계약을 다르게 둠
- Symptom: 관리자 웹 운영 error 비율이 관측됐고, FC graph page가 열려도 `/api/admin/referrals/graph`에서 `Invalid FC graph session` 401을 반복할 수 있는 경로가 확인됐다.
- Root cause: route gate/proxy는 JS-readable `session_role=fc`와 `session_resident`만 보고 graph page 진입을 허용했지만, graph API는 signed HttpOnly `fc_graph_session`까지 요구했다.
- Why it was missed: FC 관리자 웹 접근을 "페이지 제한"과 "API 스코프" 문제로 나누어 구현하면서, route gate와 API가 동일한 signed-session prerequisite을 요구하는지 확인하지 않았다.
- Permanent guardrail: 일반 FC에게 admin web surface를 열 때는 route gate, layout, API 모두 같은 signed/HttpOnly session prerequisite을 공유해야 한다. JS-readable role cookie는 화면 힌트로만 쓰고, stale cookie가 감지되면 관련 session cookies를 모두 지운다.
- Related files: `web/src/lib/admin-web-route-access.ts`, `web/src/lib/admin-web-proxy-handler.ts`, `web/src/lib/server-session.ts`, `web/src/app/api/admin/referrals/graph/route.ts`
- Verification: `node --test src/lib/admin-web-route-access.test.ts`, `cd web && npm run lint`

## 2026-06-04 | Referral Graph Real Data QA | 합성 그래프만 보고 김형수형 허브 fanout 회귀를 놓침
- Symptom: 추천인 그래프에서 김형수 밑 직속 노드들이 긴 원형 spoke처럼 일정하게 멀리 떨어지고, 실제 화면에서는 노드/라벨이 서로 붙어 보였다.
- Root cause: `referral-graph-layout`/`referral-graph-physics` 테스트가 synthetic pinwheel fixture 중심이라 실제 운영 데이터의 `김형수 -> 다수 직속 leaf` 구조를 그대로 검증하지 않았다. 또한 `dense fanout should lengthen spokes`류 assertion이 긴 원형 배치를 오히려 정당화했다.
- Why it was missed: 교차 수, 노드 최소거리, 최대 edge 길이를 실제 Supabase 그래프 payload로 계측하지 않았고, synthetic fixture의 상한/하한을 실제 화면 UX와 분리해서 유지했다.
- Permanent guardrail: 추천인 그래프 layout/physics 변경은 synthetic tests만으로 완료하지 않는다. `RUN_REFERRAL_GRAPH_REALDATA_TEST=1 node --test src/lib/referral-graph-realdata.test.ts`를 실제 Supabase 데이터로 실행해 `node count`, `edge count`, `edge crossing count`, `minimum node distance`, `max edge length`를 함께 확인한다. 긴 fanout 회귀를 막기 위해 leaf spoke 상한과 collision force를 production/test helper 양쪽에 같은 값으로 유지한다.
- Related files: `web/src/lib/referral-graph-realdata.test.ts`, `web/src/lib/referral-graph-layout.ts`, `web/src/lib/referral-graph-physics.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Verification: `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts`; `RUN_REFERRAL_GRAPH_REALDATA_TEST=1 node --test src/lib/referral-graph-realdata.test.ts`

## 2026-06-04 | Referral Graph Drag Session | static anchor maxTicks를 manual drag target에도 적용함
- Symptom: 실제 화면에서 초기 안정화가 끝난 뒤 같은 그래프 세션에서 노드를 다시 드래그하면, release 후 manual drop target 보정이 첫 드래그와 다르게 약해지거나 꺼질 수 있었다.
- Root cause: `createReferralGraphLayoutMemoryForce`가 `tickCount > maxTicks`이면 force 전체를 `return`했다. 이 값은 force 인스턴스 생애주기에 묶이므로 static anchor memory뿐 아니라 이후 드래그에서 새로 생기는 `manualNodeTargetsRef`까지 비활성화했다.
- Why it was missed: 테스트가 force 인스턴스를 새로 만들어 안정화 지표만 검증했고, 오래 열린 실제 UI 세션에서 `d3ReheatSimulation()`만 호출되는 드래그/릴리즈 경로를 별도로 고정하지 않았다.
- Permanent guardrail: static layout anchor aging과 manual drag/drop target은 같은 force 안에서도 별도 계약이다. `maxTicks`는 static anchor strength만 0으로 감쇠해야 하며, manual targets are live state and must continue after reheats. 해당 회귀는 `createReferralGraphLayoutMemoryForce keeps manual drag targets alive after static anchors age out`로 고정한다.
- Related files: `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-physics.test.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Verification: `node --test src/lib/referral-graph-physics.test.ts`; `RUN_REFERRAL_GRAPH_REALDATA_TEST=1 node --test src/lib/referral-graph-realdata.test.ts`

## 2026-06-04 | Referral Search Contract | 추천인 검색을 이름이 아닌 소속/코드 fuzzy 검색까지 허용
- Symptom: 가람in 추천인 검색에서 `서선미`가 본인 검색 결과로 안정적으로 뜨지 않거나, `1본부 서선미`처럼 소속에 서선미가 들어간 산하 인원이 함께 노출됐다.
- Root cause: `search-fc-for-referral`과 `search-signup-referral`이 `fc_profiles.name`뿐 아니라 `affiliation`과 `referral_codes.code`까지 fuzzy 검색했다. 또한 활성 설계매니저가 추천인용 shadow profile/referral code를 아직 갖지 않은 경우 `manager_accounts` 기준으로 보강하는 경로가 없었다.
- Why it was missed: 초대 링크/추천코드 검증과 수동 추천인 검색을 같은 검색 UX로 묶었고, “본부장 이름은 이름 필드만 비교한다”는 계약 테스트가 없었다.
- Permanent guardrail: 수동 추천인 검색 입력창은 `name ilike`만 사용한다. 소속/하위 조직/추천코드 fuzzy 검색은 허용하지 않는다. 추천코드는 딥링크/저장 검증처럼 별도 명시 경로에서만 처리한다. 활성 설계매니저 이름이 검색되면 `manager_accounts`에서 shadow profile과 active referral code를 보강한다.
- Related files: `supabase/functions/search-fc-for-referral/index.ts`, `supabase/functions/search-signup-referral/index.ts`, `supabase/functions/_shared/referral-search.ts`, `components/ReferralSearchField.tsx`
- Verification: `npx jest supabase\functions\_shared\__tests__\referral-search.test.ts lib\__tests__\signup-referral.test.ts --runInBand`, `npx tsc --noEmit --pretty false`, `npx eslint components\ReferralSearchField.tsx app\referral.tsx app\signup.tsx`, deployed Edge Functions, live smoke `서선미` returned exactly one result with an active code.

## 2026-06-04 | Manager Exam Surface | 본부장 시험 홈을 신청 전용 화면으로 바꾸며 기존 관리 조회 링크를 제거
- Symptom: 본부장으로 가람in에 로그인해 시험 탭을 보면 기존 시험 목록/신청자 명단 조회 동선이 사라지고 생명/손해 시험 신청 링크만 남았다.
- Root cause: 모바일 본부장 세션은 `role='admin' + readOnly=true`로 정규화되는데, "본부장도 시험 신청 가능" 요구를 "본부장은 FC 신청 surface만 본다"로 잘못 해석했다. 홈 quick link도 기존 시험 관리 링크를 재사용하지 않고 FC 신청 링크만 사용했다.
- Why it was missed: 본부장은 read-only 관리 조회와 FC-equivalent 신청을 동시에 가져야 하는 복합 권한인데, 역할 테스트는 신청 허용 여부만 고정했고 기존 시험 목록/신청자 명단 유지 여부를 같이 확인하지 않았다.
- Permanent guardrail: 본부장 시험 홈은 `manager-management` surface로 분리한다. 기존 시험 목록/신청자 명단 조회 링크는 유지하고, `/exam-apply`, `/exam-apply2` 신청 링크를 추가한다. 시험 신청 route gate는 `role='fc'` 또는 `role='admin' && readOnly=true`를 허용한다.
- Related files: `app/index.tsx`, `app/exam-apply.tsx`, `app/exam-apply2.tsx`, `lib/exam-role.ts`, `lib/__tests__/exam-role.test.ts`
- Verification: `npx jest lib\__tests__\exam-role.test.ts --runInBand`, `npx eslint app\index.tsx lib\exam-role.ts lib\__tests__\exam-role.test.ts`, `npx tsc --noEmit --pretty false`, targeted `git diff --check`.

## 2026-06-05 | Referral Graph Layout Contract | 사용자 스케치와 반대되는 원형/콤팩트 테스트 기준을 유지
- Symptom: 사용자는 root 주변 원형 분배를 없애고, 자식 없는 짧은 엣지도 길이를 조금씩 다르게 하며, 자식 있는 허브는 더 긴 엣지를 갖는 스케치형 그래프를 요구했다. 하지만 기존 테스트는 terminal children full-circle fan, 짧은 child-hub bridge, 낮은 edge severity 기준을 계속 요구했다.
- Root cause: 추천인 그래프 테스트가 이전 "compact force graph" 계약을 제품 요구처럼 유지했고, 실제 사용자 sketch를 acceptance criteria로 재정의하지 않은 채 force 수치만 반복 조정했다. 또한 dead root-spoke link-style helper가 남아 있어 엣지 스타일 분기가 다시 살아날 위험이 있었다.
- Why it was missed: 합성 테스트 통과 여부를 우선 보면서 "왜 실패하는지"를 제품 계약 관점에서 다시 분류하지 않았다. 실제 Supabase graph test는 있었지만 테스트 threshold와 edge style 가중치가 바뀐 사실을 같이 업데이트하지 않았다.
- Permanent guardrail: 추천인 그래프 변경 시 먼저 현재 사용자 계약을 테스트 이름/threshold에 반영한다. 스케치형 branch/trunk 요구에서는 terminal-only hubs must be non-circular side fans, terminal leaves stay short but length-staggered, child hubs must use longer ID-varied branch bridges, and all links use one visible style. Real-data QA는 `RUN_REFERRAL_GRAPH_REALDATA_TEST=1`로 실행하고, force constant 상향이 실제 crossing을 악화시키면 즉시 되돌리고 deterministic layout mode를 별도 설계한다.
- Related files: `web/src/lib/referral-graph-layout.ts`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-link-style.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`, graph tests under `web/src/lib/`.
- Verification: `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts`; `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; node --test src/lib/referral-graph-realdata.test.ts`.

## 2026-06-05 | FC Preregistration Gate | 사전등록 미완료 상태에서도 본등록 화면 진입을 허용
- Symptom: FC가 사전등록을 완료하지 않은 상태에서도 홈 빠른 메뉴 또는 직접 route로 `/fc/new` 본등록 화면에 진입할 수 있었다.
- Root cause: 로그인 Edge Function은 `signup_completed=false`를 거부했지만, 모바일 홈 quick link와 `/fc/new` 화면은 같은 `signup_completed` gate를 재사용하지 않았다.
- Why it was missed: 회원가입 완료 여부를 인증 계약에서만 확인하고, 홈 메뉴 노출/딥링크/저장 직전 방어를 별도 회귀 테스트로 고정하지 않았다.
- Permanent guardrail: 본등록/기본정보 편집 진입은 `canOpenFcProfileRegistration(profile)` 단일 helper로 판단한다. 홈 링크 노출, 버튼 핸들러, 직접 route 저장 전 검사가 모두 이 helper를 사용해야 한다.
- Related files: `app/index.tsx`, `app/fc/new.tsx`, `lib/fc-workflow.ts`, `lib/__tests__/workflow-step-regression.test.ts`
- Verification: `npm test -- --runTestsByPath lib/__tests__/workflow-step-regression.test.ts --runInBand`

## 2026-06-05 | Daum Postcode Debug UI | 주소 검색 WebView의 개발용 trace UI를 기본 화면에 노출
- Symptom: 본등록 주소 검색 중 `postcode debug mounted` 알림이 뜨고, `web:window.patch.ready...` trace banner가 주소 검색 UI 위에 겹쳐 보였다.
- Root cause: `components/DaumPostcode.tsx`가 `__DEV__`이면 mount alert와 debug banner를 기본 표시했다. Android 개발 빌드에서도 실제 사용자 검증 화면과 동일하게 보이기 때문에 디버그 UI가 업무 흐름을 막았다.
- Why it was missed: iOS WebView 이탈 추적용 instrumentation을 추가하면서 "로그는 남기되 화면은 opt-in"이라는 계약 테스트를 두지 않았다.
- Permanent guardrail: Daum postcode debug UI는 `EXPO_PUBLIC_POSTCODE_DEBUG_UI=1|true`일 때만 표시한다. 기본값에서는 로그만 남기고 Alert/banner를 렌더링하지 않는다.
- Related files: `components/DaumPostcode.tsx`, `lib/daum-postcode.ts`, `components/__tests__/DaumPostcode.contract.test.ts`
- Verification: `npm test -- --runTestsByPath components/__tests__/DaumPostcode.contract.test.ts --runInBand`

## 2026-06-05 | Hanwha PDF Delete Payload | 삭제 API에 불필요한 fileName을 필수로 요구
- Symptom: 관리자 대시보드에서 다위촉 URL PDF 삭제 버튼을 누르면 `fcId and fileName are required` 오류가 표시됐다.
- Root cause: `/api/admin/fc` route가 `createHanwhaPdfUploadUrl`과 `deleteHanwhaPdf`를 같은 분기에서 처리하면서, 실제 삭제에는 쓰지 않는 `fileName`까지 공통 필수값으로 검사했다.
- Why it was missed: 업로드 URL 생성 payload와 삭제 payload의 요구 필드를 하나의 조건으로 묶었고, 삭제는 DB에 저장된 `hanwha_commission_pdf_path`만 있으면 가능하다는 계약 테스트가 없었다.
- Permanent guardrail: 다위촉 PDF payload validation은 action별로 분리한다. 업로드 URL 생성은 `fcId + fileName`, 삭제는 `fcId`만 요구한다.
- Related files: `web/src/app/api/admin/fc/route.ts`, `web/src/app/dashboard/page.tsx`, `web/src/lib/admin-hanwha-pdf-payload.ts`, `web/src/lib/admin-hanwha-pdf-payload.test.ts`
- Verification: `node --test web/src/lib/admin-hanwha-pdf-payload.test.ts web/src/lib/admin-fc-doc-storage.test.ts`

## 2026-06-05 | Referral Graph Crossing Direction | 교차 edge를 anchor와 무관한 normal 방향으로 밀어 실제 데이터 교차를 남김
- Symptom: 실제 Supabase 추천인 그래프에서 초기 seed layout은 교차 0개였지만, 물리 시뮬레이션 후 `박윤미 -> 김희정`과 `박선희 -> 김은진` 같은 straight edge crossing이 계속 1개 이상 남았다.
- Root cause: `createReferralGraphEdgeCrossingForce`가 교차한 edge를 midpoint/deterministic normal 기준으로만 밀었다. 실제 seed layout에는 이미 non-crossing 위치가 있었는데, 보정 방향이 anchor 방향과 다를 수 있어 교차가 반복됐다.
- Why it was missed: edge-crossing unit test는 anchor 없는 X fixture만 사용했고, 실제 graph force chain에서 anchor-aware correction이 필요한지를 검증하지 않았다.
- Permanent guardrail: 추천인 그래프 crossing correction은 `anchorPositions`가 있으면 각 edge endpoint를 seed anchor 쪽으로 보정해야 한다. 실데이터 완료 기준은 crossing threshold 완화가 아니라 `RUN_REFERRAL_GRAPH_REALDATA_TEST=1`에서 `crossings=0`, `crossingVisualSeverity=0`이다.
- Related files: `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-layout.ts`, `web/src/lib/referral-graph-realdata.test.ts`, `web/src/lib/referral-graph-simulation.test.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Verification: `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts`; `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`; `cd web; npm run lint`

## 2026-06-05 | Referral Graph Drag Suppression | 작은 드래그를 연결 컴포넌트 전체 이동으로 기록
- Symptom: 추천인 그래프에서 노드를 살짝 드래그했을 뿐인데 일부 노드가 멀리 튀고, 연결 edge가 비정상적으로 길어졌다.
- Root cause: `getDragAffectedNodeIds()`가 연결 컴포넌트 전체를 반환했고, `handleNodeDragEnd()`가 그 전체를 `userMovedNodeIdsRef`와 `dragMemorySuppressedNodeIdsRef`에 넣었다. 동시에 `applyReferralGraphDragSpring(... preventStretch)`는 실제 보정이 없는 edge의 follower까지 anchored로 등록해 deep stretched link까지 전파했다.
- Why it was missed: 초기 settle/정적 real-data QA는 통과했지만, 오래 열린 화면에서 작은 drag/release 후 force 전파와 anchor suppression이 어떻게 작동하는지 별도 테스트하지 않았다.
- Permanent guardrail: 노드 drag는 dragged node만 manual/suppressed로 기록한다. 연결 컴포넌트 전체를 suppressed 처리하지 않는다. drag spring의 stretch propagation은 실제 correction이 발생한 edge에서만 다음 edge로 전파한다. 실제 데이터 테스트에는 작은 drag 후 `maxEdge`, `minDistance`, crossing 악화 여부를 포함한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-physics.test.ts`, `web/src/lib/referral-graph-realdata.test.ts`
- Verification: `node --test src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts`; `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`; `cd web; npm run lint`

## 2026-06-05 | Referral Graph Drag Reheat | 노드를 잡기만 해도 전체 simulation을 재가열
- Symptom: 추천인 그래프에서 노드를 한 번 드래그하거나 잡으면 그래프 전체가 불안정하게 흔들렸다.
- Root cause: `handleNodeDrag()` 첫 호출과 `handleNodeDragEnd()`가 `d3ReheatSimulation()`을 호출했다. `react-force-graph`의 drag callback은 자체적으로 노드 위치를 갱신하는데, 추가 reheat가 전체 force를 다시 과열시켜 안정된 배치를 흔들었다.
- Why it was missed: 이전 검증은 drag 후 edge 길이만 봤고, grab-only/tiny drag가 manual state나 simulation alpha에 남기는 효과를 분리하지 않았다.
- Permanent guardrail: node drag/dragEnd에서 전체 `d3ReheatSimulation()`을 호출하지 않는다. `onNodeDragEnd`의 total translate가 의미 있는 이동일 때만 manual target을 남기고, grab-only/tiny drag는 상태를 남기지 않는다. `isReferralGraphMeaningfulDrag` 테스트로 threshold를 고정한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-physics.test.ts`
- Verification: `node --test src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts`; `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`; `cd web; npm run lint`

## 2026-06-05 | Board Share Deep Link | 게시글 공유/홈 카드가 독립 상세 화면으로 진입
- Symptom: 홈 최신 가람Pick 카드와 공유 링크가 사용자가 기대한 게시판 상세 바텀시트가 아니라 `/board-detail` 독립 화면 또는 추천 초대 랜딩으로 열렸다.
- Root cause: 게시글 알림 라우트와 홈 최신 카드 라우트를 하나의 `resolveNoticeRoute()`로 묶었고, 공유 랜딩도 추천 초대 랜딩 fallback만 갖고 있었다. 홈/공유 진입은 기존 게시판 화면의 `postId` 모달 파라미터를 써야 한다는 계약이 분리되어 있지 않았다.
- Why it was missed: 게시판 상세 페이지가 열리는지만 확인하고, “목록 위 바텀시트로 열리는지”와 카카오/브라우저 랜딩이 실제 게시글 딥링크를 내리는지 확인하지 않았다.
- Permanent guardrail: 홈 최신 게시글은 `resolveHomeLatestNoticeRoute()`로 `/board?postId=...`에 진입한다. 외부 공유 URL은 `/board` 랜딩에서 `hanwhafcpass://board?postId=...`를 내려야 하며, 추천 초대 fallback과 섞지 않는다.
- Related files: `app/index.tsx`, `app/board.tsx`, `lib/notice-route.ts`, `lib/board-share-link.ts`, `invite-page/board.html`, `invite-page/vercel.json`
- Verification: `npm test -- --runTestsByPath lib\__tests__\notice-route.test.ts lib\__tests__\home-latest-notice.test.ts lib\__tests__\board-share-link.test.ts --runInBand`; invite-page production HTML contained `hanwhafcpass://board?postId` and not `board-detail`.

## 2026-06-05 | Notification Badge Source | 홈 배지가 알림 센터에 없는 live request_board unread까지 합산
- Symptom: 홈 벨 배지에는 5건이 표시됐지만 알림 센터 화면에는 4개 카드만 보여 사용자가 확인할 수 없는 알림 수가 남았다.
- Root cause: 홈 배지는 `request_board` live unread API를 더했고, 알림 센터는 `fc-notify inbox_list`의 로컬 notifications/notices만 렌더링했다. 두 화면이 서로 다른 source of truth를 사용했다.
- Why it was missed: 설계요청 알림을 추가할 때 unread count만 live API로 보강했고, 알림 센터 목록도 같은 데이터를 보여주는지 비교하지 않았다.
- Permanent guardrail: 모바일 배지는 알림 센터가 실제 렌더링하는 출처를 기준으로 센다. FC/일반 관리자는 `include_notices`, 설계매니저는 `only_request_board_categories`로 `fc-notify inbox_unread_count`가 목록 필터와 같은 기준을 사용해야 한다.
- Related files: `lib/mobile-unread-notification-count-plan.ts`, `supabase/functions/fc-notify/index.ts`, `supabase/functions/__tests__/fc-notify-inbox-unread.contract.test.ts`
- Verification: `npm test -- --runTestsByPath lib\__tests__\mobile-unread-notification-count-plan.test.ts supabase\functions\__tests__\fc-notify-inbox-unread.contract.test.ts --runInBand`; deployed `fc-notify`.

## 2026-06-07 | Request Board Designer Reject | 거절 사유를 하드코딩하고 `rejected`를 FC 검토대기로 분류
- Symptom: 설계매니저가 의뢰를 거절해도 모바일 기본 문구가 사유로 저장됐고, FC 목록에서는 해당 건이 `검토 대기`로 남아 FC가 처리할 수 없는 상태가 됐다.
- Root cause: 신규 상세 거절 흐름이 `rbRejectRequest` reason에 임시 문자열을 직접 전달했다. 동시에 목록 필터의 `hasPendingFcReview()`가 `getAssignmentStatusBucket()` 결과를 사용해 `rejected`를 `completed`와 같은 버킷으로 본 뒤 FC 미결정 조건을 적용했다.
- Why it was missed: 설계매니저 거절 사유 UX와 FC 목록 상태 전이를 같은 회귀 세트로 테스트하지 않았다. pending 버튼 노출만 검증하고, 거절 후 FC가 보는 bucket/meta를 검증하지 않았다.
- Permanent guardrail: request_board 거절 기능은 반드시 사용자 입력 사유를 요구하고, blank reason을 API 호출 전에 차단한다. FC `review_pending`은 exact `assignment.status === 'completed'`인 배정만 포함해야 하며, `rejected`를 bucket helper로 우회 판정하지 않는다.
- Related files: `app/request-board.tsx`, `app/request-board-review.tsx`, `lib/request-board-list-filters.ts`, `lib/request-board-review-actions.ts`
- Verification: `npm test -- --runTestsByPath lib\__tests__\request-board-review-actions.test.ts lib\__tests__\request-board-list-filters.test.ts lib\__tests__\request-board-review-role.contract.test.ts lib\__tests__\request-board-mobile-ui-contract.test.ts lib\__tests__\request-board-api-contract.test.ts --runInBand`; targeted ESLint; `npx tsc --noEmit --pretty false`

## 2026-06-07 | Request Board Reject Modal Keyboard | 입력 바텀시트를 키보드 회피 없이 추가
- Symptom: Android에서 거절 사유 입력을 시작하면 키보드가 올라오며 하단 사유 입력 모달과 버튼이 가려졌다.
- Root cause: 새 request_board 거절 사유 모달을 일반 `Modal` 하단 시트로 추가하면서 `KeyboardAvoidingView`를 감싸지 않았다. 기존 입력 화면의 keyboard avoidance 패턴을 새 모달 UI contract에 포함하지 않았다.
- Why it was missed: 사유 입력 기능과 API payload를 우선 검증했지만, Android soft keyboard가 열린 상태의 레이아웃을 테스트/캡처하지 않았다.
- Permanent guardrail: 모바일 하단 입력 모달은 `KeyboardAvoidingView` 또는 동등한 keyboard avoidance contract를 가져야 한다. static UI contract에는 `KeyboardAvoidingView`와 platform-specific behavior를 포함하고, 가능하면 Android keyboard-open screenshot을 추가한다.
- Related files: `app/request-board.tsx`, `app/request-board-review.tsx`, `lib/__tests__/request-board-review-role.contract.test.ts`, `lib/__tests__/request-board-mobile-ui-contract.test.ts`
- Verification: `npm test -- --runTestsByPath lib\__tests__\request-board-review-role.contract.test.ts lib\__tests__\request-board-mobile-ui-contract.test.ts --runInBand`; targeted ESLint; `npx tsc --noEmit --pretty false`

## 2026-06-07 | Request Board List Reason | UI만 추가하고 목록 응답의 사유 누락을 확인하지 않음
- Symptom: 목록 카드에 거절 사유 박스 UI를 추가했지만 실제 화면에서는 `설계 거절`만 보이고 사유가 보이지 않았다.
- Root cause: `RbRequestListItem.request_designers[]` 목록 계약에는 `rejection_reason`이 없었고, 실제 목록 응답도 거절 상태만 주는 경로가 있었다. UI helper는 `rejection_reason`을 필요로 했지만 목록 fetch에서 상세 API로 보강하지 않았다.
- Why it was missed: 테스트 fixture에 `rejection_reason`을 직접 넣어 UI 표시만 확인했고, 실제 list endpoint shape가 detail endpoint보다 얕을 수 있다는 데이터 계약을 검증하지 않았다.
- Permanent guardrail: 목록에서 상세 전용 필드를 표시할 때는 list endpoint가 해당 필드를 제공하는지 확인한다. 제공하지 않으면 detail hydration, endpoint 확장, 또는 UI fallback 중 하나를 테스트로 고정해야 한다.
- Related files: `app/request-board-requests.tsx`, `lib/request-board-rejection-summary.ts`, `lib/request-board-api.ts`
- Verification: `npm test -- --runTestsByPath lib\__tests__\request-board-rejection-summary.test.ts lib\__tests__\request-board-mobile-ui-contract.test.ts --runInBand`; request-board regression suite; targeted ESLint; `npx tsc --noEmit --pretty false`

## 2026-06-08 | Referral Graph Drag Physics | 드래그 중 연결 노드와 초기 원형 anchor를 계속 당김
- Symptom: 추천인 그래프에서 `최경집` 같은 노드를 살짝 옮기면 연결 노드와 edge가 같이 끌려가고, 시간이 지나도 초기 원형 배치를 유지하려는 힘 때문에 그래프가 비정상적으로 흔들렸다.
- Root cause: 드래그 중 연결 노드 보정과 초기 anchor 계약이 섞였다. 또 `cooldownTicks={Infinity}`, `cooldownTime={Infinity}`, `d3AlphaMin={0}`로 force engine이 계속 살아 있었고, 예전 테스트는 터미널 자식을 부모 주변 원형 링이 아니라 한쪽 부채꼴로 모으는 것을 정답으로 봤다.
- Why it was missed: 기존 테스트는 edge stretch 감소를 우선해 follower 직접 이동을 정답으로 봤고, 사용자가 잡은 노드만 움직여야 한다는 UX 계약과 “자식 없는 노드는 부모 주변 링, 자식 있는 노드는 긴 가지” 레이아웃 계약을 고정하지 않았다. 이후 보정에서도 `targetHasChildren`을 거의 모두 긴 브랜치로 처리해 sparse chain은 비정상적으로 길어지고, 8개 안팎 star leaf spoke는 너무 짧은 상태를 테스트가 놓쳤다.
- Permanent guardrail: 드래그 중 연결 컴포넌트 전체를 직접 이동하지 않는다. 다만 사용자가 부모/허브를 옮길 때 visible branch가 찢어지지 않아야 하는 UX 계약에서는 directed descendants만 follower로 같은 delta를 적용하고, ancestor/sibling/unrelated node는 제외한다. 터미널 자식은 부모 주변 local ring으로 배치하고, child hub edge는 terminal leaf spoke보다 명확히 길게 유지한다. 단, `targetChildCount <= 1`이고 작은 subtree인 sparse branch는 긴 가지 규칙에서 제외해 bounded compact edge로 유지하며, 8개 이상 star leaf ring은 최소 반경을 별도 검증한다. ForceGraph2D는 finite cooldown/positive alphaMin을 사용하고, 긴 branch bridge도 bounded simulation 테스트로 검증한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-layout.ts`, `web/src/lib/referral-graph-layout.test.ts`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-physics.test.ts`, `web/src/lib/referral-graph-simulation.test.ts`
- Verification: `node --test web/src/lib/referral-graph-physics.test.ts`; `node --test web/src/lib/referral-graph-layout.test.ts`; `node --test web/src/lib/referral-graph-simulation.test.ts`; `node --test web/src/lib/referral-graph-display.test.ts web/src/lib/referral-graph-edges.test.ts web/src/lib/referral-graph-highlight.test.ts web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-link-style.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-scope.test.ts web/src/lib/referral-graph-simulation.test.ts`; `cd web && npm run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/lib/referral-graph-layout.ts src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts`

## 2026-06-08 | Referral Graph Directed Drag Followers | 부모 드래그 시 자식 branch가 남아 edge가 찢어짐
- Symptom: `최경집` 같은 부모/허브 노드를 드래그하면 부모만 움직이고 직속 자식들이 제자리에 남아, edge가 화면을 길게 가로지르며 그래프가 깨져 보였다.
- Root cause: 이전 drag 안정화에서 "연결 노드를 끌지 말라"는 요구를 연결 컴포넌트 전체 전파 금지와 directed child branch preservation으로 나누지 않았다. 그 결과 parent drag에도 descendants follower 처리가 없어 visible branch가 분리됐다.
- Why it was missed: helper 테스트는 drag spring 전파 금지만 검증했고, `ReferralGraphCanvas`의 실제 `onNodeDrag`가 directed descendants를 같은 delta로 이동시키는지 고정하지 않았다.
- Permanent guardrail: parent/hub drag는 directed descendants만 follower로 이동시킨다. ancestor, sibling, unrelated node는 follower에서 제외하고, follower는 active drag 중 `fx/fy`로 고정한 뒤 release 시 manual target으로 저장한다. Canvas wiring을 source-level regression으로 고정한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-interaction.ts`, `web/src/lib/referral-graph-interaction.test.ts`
- Verification: `node --test web/src/lib/referral-graph-interaction.test.ts`; full referral graph lib suite; targeted web ESLint; `cd web && SENTRY_AUTH_TOKEN='' npx next build`

## 2026-06-08 | Referral Graph Rigid Drag Followers | 큰 하위조직을 하나의 고정 물체처럼 이동시킴
- Symptom: 김형수처럼 큰 하위조직이 있는 노드 그룹을 움직이면 전체 descendant subtree가 하나의 딱딱한 물체처럼 움직이고, 놓은 뒤에는 사용자가 놓은 위치가 아니라 다른 위치로 밀렸다.
- Root cause: directed descendants follower 보정이 모든 descendant에 같은 delta와 `fx/fy` pin을 적용했다. 동시에 manual drop target이 static anchor aging에 같이 묶여 있어 초기 anchor가 만료되면 사용자가 놓은 위치를 잡아주는 힘도 꺼졌다. `onNodeDrag`에서 매 tick `d3ReheatSimulation()`을 호출해 전체 그래프를 과하게 다시 흔든 점도 증상을 키웠다.
- Why it was missed: "자식 branch가 따라와야 한다"는 회귀만 테스트했고, 큰 subtree가 depth별로 유연하게 따라와야 한다는 조건과 manual target 생존 조건을 함께 검증하지 않았다.
- Permanent guardrail: large hub drag는 depth-damped follower translation을 사용한다. Direct children may be pinned during active drag, but deeper descendants must not all be fixed with the same rigid delta. Manual user drop targets must outlive static anchor expiration. Do not call `d3ReheatSimulation()` on every `onNodeDrag` tick.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-interaction.ts`, `web/src/lib/referral-graph-interaction.test.ts`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-physics.test.ts`
- Verification: `node --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts`; full referral graph lib suite; targeted web ESLint; `cd web && SENTRY_AUTH_TOKEN='' npx next build`

## 2026-06-08 | Referral Graph Active Drag Force Conflict | 드래그 중 안정화 force가 사용자 입력과 싸움
- Symptom: 드래그 중 물리법칙이 깨진 것처럼 branch가 흔들리고, 연결 노드와 edge가 불안정하게 반응했다.
- Root cause: depth-damped followers를 도입했지만 `branch-bend`, `sibling-angular`, custom `link-tension`, base d3 link force가 active dragged branch를 계속 보정했다. 드래그 중에는 이 force들이 레이아웃 정리가 아니라 사용자가 잡은 branch와 반대 방향으로 작동했다.
- Why it was missed: follower 이동/릴리즈 테스트는 있었지만, active drag 중 각 force가 dragged/suppressed branch에 velocity를 추가하지 않는지 테스트하지 않았다. 기본 d3 link force도 drag 중 별도 약화 모드가 필요하다는 점을 확인하지 않았다.
- Permanent guardrail: active drag 동안 dragged node와 directed followers는 custom branch/link correction에서 suppressed로 취급한다. `link-tension`, `branch-bend`, `sibling-angular`는 active/suppressed branch를 건너뛰고, base d3 link force는 meaningful drag 동안 약한 drag mode로 전환했다가 release 시 settle mode로 복구한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-physics.test.ts`
- Verification: `node --test web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-interaction.test.ts`; full referral graph lib suite; targeted web ESLint; `cd web && SENTRY_AUTH_TOKEN='' npx next build`

## 2026-06-09 | Referral Graph Simulation Harness Drift | 런타임과 다른 drag 모델을 테스트함
- Symptom: 드래그 중 branch가 찢어지거나 흔들리는 보고를 받은 뒤에도, simulation 테스트 일부는 실제 Canvas drag 동작이 아니라 예전 drag-spring 보정 모델을 기준으로 통과/실패했다.
- Root cause: `referral-graph-simulation.test.ts`가 `ReferralGraphCanvas`의 active drag 계약을 복제하지 않았다. 실제 런타임은 dragged node 직접 이동, directed follower translation, active branch suppression, drag-mode base link force를 함께 사용하지만, 테스트 harness는 old drag spring과 normal link force에 가까운 조건으로 검증했다.
- Why it was missed: physics helper 단위 테스트와 Canvas source-level wiring 테스트는 있었지만, 통합 simulation harness가 같은 active-drag 상태 machine을 쓰는지 확인하지 않았다. 그 결과 테스트가 실제 사용자 drag feel과 다른 힘의 조합을 검증했다.
- Permanent guardrail: 추천인 그래프 drag simulation은 반드시 Canvas active drag contract를 따라야 한다. Parent/hub drag 테스트는 `applyReferralGraphDragFollowerTranslation`과 suppressed branch set을 사용하고, active drag 중 d3 link strength/iterations도 Canvas drag mode와 같은 값으로 설정한다. Drag-spring helper는 runtime에서 사용하지 않는 모델이면 active drag acceptance 기준으로 쓰지 않는다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-interaction.ts`, `web/src/lib/referral-graph-simulation.test.ts`
- Verification: `node --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-simulation.test.ts`; full referral graph lib suite; targeted web ESLint; `cd web && SENTRY_AUTH_TOKEN='' npx next build`; `git diff --check`

## 2026-06-09 | Referral Graph ForceGraph Reheat | 라이브러리 node drag reheat를 고려하지 않음
- Symptom: 앱 코드에서 `d3ReheatSimulation()` 호출을 제거했는데도, 사용자는 드래그 중 물리 힘이 다시 과하게 살아나 그래프가 불안정하다고 느꼈다.
- Root cause: `force-graph`는 `enableNodeDrag`가 켜진 상태에서 노드를 드래그하면 simulation을 reheat한다. 앱 코드의 명시적 reheat 호출만 찾고, 라이브러리 내부 drag reheat 계약을 같이 고려하지 않았다.
- Why it was missed: 문서 확인 없이 "컴포넌트에서 직접 reheat를 호출하지 않으니 active drag는 충분히 안정적"이라고 판단했다. 기존 suppression은 custom/link force 중심이어서 reheated `charge`/`collision`이 드래그 중 다시 움직임을 키울 수 있다는 점을 테스트하지 않았다.
- Permanent guardrail: React Force Graph node drag를 사용할 때는 library-level reheat를 전제로 설계한다. Active drag mode에서는 base link뿐 아니라 charge/collision처럼 reheat-sensitive force도 낮추고, release에서 settle mode로 복구한다. Simulation harness도 drag mode charge/collision 값을 runtime과 동일하게 유지한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-interaction.test.ts`, `web/src/lib/referral-graph-simulation.test.ts`
- Verification: RED/GREEN `node --test web/src/lib/referral-graph-interaction.test.ts`; `node --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-simulation.test.ts`; full referral graph lib suite; targeted web ESLint; `cd web && SENTRY_AUTH_TOKEN='' npx next build`; `git diff --check`

## 2026-06-09 | Referral Graph Active Drag Global Reflow | 드래그 중 무관한 컴포넌트를 재배치
- Symptom: 한 노드를 드래그하는 동안 사용자가 잡지 않은 주변 그래프까지 물리법칙이 깨진 것처럼 흔들리고 재배치됐다.
- Root cause: ForceGraph drag reheat에 대응해 charge/collision은 낮췄지만, `sibling-angular`, `edge-crossing`, cluster/component separation/gravity/cohesion 같은 커스텀 정렬 force가 높은 alpha에서 계속 작동했다. 특히 직접 위치를 보정하는 force가 unrelated leaf ring까지 움직였다.
- Why it was missed: 기존 테스트는 active branch edge length와 release 후 안정성만 봤고, pointer-down 상태에서 unrelated component가 얼마나 움직이는지 측정하지 않았다.
- Permanent guardrail: active drag regression은 settled graph에서 한 component만 드래그한 뒤 unrelated node max drift를 제한해야 한다. Pointer-down 동안에는 global layout 정렬 force를 pause/dampen하고, 사용자가 잡은 branch는 directed follower translation으로만 유지한다. Global 정렬은 release 후 settle mode에서 재개한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-simulation.test.ts`
- Verification: RED/GREEN `node --test web/src/lib/referral-graph-simulation.test.ts --test-name-pattern "active dragging does not re-layout unrelated components"`; focused graph suite; full referral graph lib suite; targeted web ESLint.

## 2026-06-09 | Referral Graph Visual QA Metric | 그래프 좌표 drift를 화면 안정성으로 오해
- Symptom: live CDP drag validation initially looked like a failure because the dragged hub moved dozens of graph units after release, even though the visual movement on screen was small.
- Root cause: Graph coordinates are zoom-dependent simulation units. At the current zoom level, a large graph-unit delta translated to a small client-pixel movement, so raw graph-unit thresholds exaggerated perceived instability.
- Why it was missed: Automated simulation tests used graph-space numbers appropriately, but live browser UX validation reused that instinct instead of measuring what the user actually sees on the screen.
- Permanent guardrail: Live visual QA for referral graph drag must use screen/client pixels as the primary metric. Graph-unit measurements can be kept as secondary diagnostics, but pass/fail should be based on pointer distance, unrelated screen drift, follower screen movement, and post-release screen distance.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-interaction.test.ts`
- Verification: RED/GREEN dev-hook test; full referral graph suite; targeted ESLint; `cd web && SENTRY_AUTH_TOKEN='' npx next build`; live CDP drag verification with screenshots.

## 2026-06-10 | Group Chat Worktree Visibility | 배포 작업트리와 실행 앱 작업트리를 혼동
- Symptom: 단톡방 Edge Function과 migration을 배포했지만, 에뮬레이터의 `메신저` 화면에는 `가람PA 단톡방` 카드가 보이지 않았다.
- Root cause: 단톡방 UI 코드는 superpowers worktree(`garamin-group-chat-v1`)에만 있었고, 실제 Metro/에뮬레이터는 `E:\hanhwa\fc-onboarding-app` 원본 작업트리를 실행 중이었다.
- Why it was missed: 서버 배포와 로컬 검증은 worktree 기준으로 완료했지만, 사용자가 보고 있는 런타임 작업트리가 어디인지 확인하지 않고 UI 노출을 설명했다.
- Permanent guardrail: 앱 UI가 안 보인다는 피드백을 받으면 먼저 `git -C <running-app> branch/status`와 해당 파일 존재 여부를 확인한다. 서버 배포 완료와 모바일 런타임 반영은 별도 체크로 다룬다.
- Related files: `app/messenger.tsx`, `app/group-chat.tsx`, `app/_layout.tsx`
- Verification: focused group chat Jest suite, targeted ESLint, `npx tsc --noEmit --pretty false`, `supabase functions deploy group-chat --project-ref ubeginyxaotcamuqpmud --use-api`

## 2026-06-10 | Group Chat Message Unread Badges | 방 단위 unread만 만들고 메시지별 unread 표시를 누락
- Symptom: 가람PA 단톡방에서 카카오톡처럼 각 메시지를 몇 명이 읽지 않았는지 표시되지 않았다.
- Root cause: `group_chat_bootstrap`은 현재 사용자의 방 전체 `unread_count`만 계산했고, 각 `group_chat_messages` row에는 수신자별 읽음 상태를 반영한 `unread_count`를 직렬화하지 않았다. 모바일 말풍선도 메시지 단위 unread 메타 영역이 없었다.
- Why it was missed: 단톡방 허브 badge와 알림 unread만 테스트했고, 카카오톡식 발신 메시지별 미확인 인원 수를 별도 계약으로 고정하지 않았다.
- Permanent guardrail: 채팅 기능은 방 전체 unread와 메시지별 unread를 별도 계약으로 테스트한다. 메시지별 unread는 자동 참여 멤버, 발신자 제외, `group_chat_reads.last_read_at >= message.created_at` 조건을 기준으로 계산한다.
- Related files: `supabase/functions/group-chat/index.ts`, `supabase/functions/_shared/group-chat.ts`, `lib/group-chat-contract.ts`, `app/group-chat.tsx`
- Verification: `npm test -- --runTestsByPath lib/__tests__/group-chat-api.test.ts lib/__tests__/group-chat-contract.test.ts lib/__tests__/group-chat-mobile-source.test.ts lib/__tests__/notification-route.test.ts lib/__tests__/messenger-loading.test.ts --runInBand`; `npx eslint app/group-chat.tsx lib/group-chat-api.ts lib/group-chat-contract.ts lib/__tests__/group-chat-contract.test.ts lib/__tests__/group-chat-mobile-source.test.ts`; `npx tsc --noEmit --pretty false`; `supabase functions deploy group-chat --project-ref ubeginyxaotcamuqpmud --use-api`

## 2026-06-10 | Group Chat Attachment Interaction | 첨부 말풍선의 실제 터치/전송 체감 검증 누락
- Symptom: 사진 말풍선은 롱프레스 액션이 열리지 않았고, 메시지/파일/사진 전송 후 말풍선이 늦게 나타났다.
- Root cause: 이미지/파일 내용을 개별 touchable로 감싸 parent message `Pressable`의 long-press를 가로막았다. 또한 텍스트와 첨부 모두 서버 응답 또는 업로드 완료 후에만 `applyMessages`를 호출해 네트워크 지연이 그대로 UI 지연으로 보였다.
- Why it was missed: source-level action wiring은 확인했지만 실제 말풍선 content 안의 중첩 touch target과 optimistic send UX를 별도 회귀 조건으로 고정하지 않았다.
- Permanent guardrail: 채팅 말풍선 내부 이미지/파일은 parent bubble이 tap/long-press를 소유하게 한다. 전송 UI는 텍스트/이미지/파일 모두 local optimistic message를 먼저 삽입하고, 서버 완료 시 persisted message로 교체하는 계약을 테스트한다.
- Related files: `app/group-chat.tsx`, `lib/group-chat-api.ts`, `lib/__tests__/group-chat-mobile-source.test.ts`
- Verification: `npm test -- --runTestsByPath lib/__tests__/group-chat-api.test.ts lib/__tests__/group-chat-contract.test.ts lib/__tests__/group-chat-mobile-source.test.ts --runInBand`; `npx eslint app/group-chat.tsx lib/group-chat-api.ts lib/__tests__/group-chat-mobile-source.test.ts`; `npx tsc --noEmit --pretty false`

## 2026-06-11 | Referral Graph Mobile Pinch Zoom | 모바일 그래프 확대/축소 검증 누락
- Symptom: 핸드폰에서 관리자 웹 추천 관계 보기 그래프가 두 손가락 확대/축소를 받지 않았다.
- Root cause: 데스크톱 wheel/pan 안정화를 위해 `ForceGraph2D`의 `enableZoomInteraction`/`enablePanInteraction`을 false로 끄고, 별도 수동 wheel/pointer pan만 구현했다. 이 수동 구현은 모바일 pinch gesture를 처리하지 않았다.
- Why it was missed: 모바일 반응형 UI는 확인했지만 graph viewport interaction을 데스크톱 wheel 기준으로만 고정했고, touch/coarse pointer 환경의 native pinch/pan 계약을 테스트하지 않았다.
- Permanent guardrail: 그래프 viewport interaction은 데스크톱 mouse/wheel과 모바일 coarse pointer를 분리한다. 모바일은 `react-force-graph` native zoom/pan을 사용하고, desktop-only 수동 handler는 touch pointer를 잡지 않아야 한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-interaction.test.ts`
- Verification: `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts`; `cd web && npm run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/lib/referral-graph-interaction.test.ts`; `cd web && SENTRY_AUTH_TOKEN='' npm run build`; Vercel production deploy.

## 2026-06-11 | Group Chat Developer Eligibility Drift | 문구와 실제 참여 조건 불일치
- Symptom: 개발자 계정으로 가람in `메신저` 화면에 들어가면 `가람PA 단톡방` 카드가 보이지 않았다.
- Root cause: 단톡방 UI 문구와 기획 범위는 `FC, 본부장, 총무, 개발자` 참여였지만, 모바일 허브 `canUseGroupChat`과 Edge Function 공통 eligibility에서 `staff_type='developer'` admin을 제외했다.
- Why it was missed: 단톡방 v1 테스트는 FC/본부장/총무와 설계매니저 제외만 고정했고, developer subtype이 총무 권한과 동일하게 내부 단톡방에 포함되어야 한다는 계약을 별도 회귀로 두지 않았다.
- Permanent guardrail: `admin_accounts.staff_type='developer'`는 앱 권한이 총무와 동일하므로 내부 운영 단톡방 eligibility에서 제외하지 않는다. 단톡방 참여 계약은 모바일 표시 조건과 Edge Function 서버 eligibility를 같은 테스트에서 검증한다.
- Related files: `app/messenger.tsx`, `lib/group-chat-contract.ts`, `lib/__tests__/group-chat-contract.test.ts`, `lib/__tests__/group-chat-mobile-source.test.ts`, `supabase/functions/_shared/group-chat.ts`
- Verification: RED/GREEN `npm test -- --runTestsByPath lib/__tests__/group-chat-contract.test.ts lib/__tests__/group-chat-mobile-source.test.ts --runInBand`; focused group chat Jest suite

## 2026-06-12 | Group Chat Push Scope Split | 참여 가능 계정과 푸시 대상 계정을 같은 것으로 봄
- Symptom: 단톡방 메시지가 올라와도 일부 모바일 세션에서 푸시가 보이지 않았고, 반대로 설계매니저에게는 단톡방 알림이 가지 않아야 하는 정책이 source test로 고정되지 않았다.
- Root cause: 모바일 Expo push token 등록이 FC 전용 조건으로 묶여 있어 본부장/총무/개발자 세션은 `device_tokens`에 저장되지 않았다. 또한 group-chat Edge Function은 token role을 조회하지 않아 shared manager-notification policy를 적용할 수 없었다.
- Why it was missed: 단톡방 참여 eligibility와 방 unread는 테스트했지만, "누가 방에 참여하는가"와 "누구의 디바이스 토큰에 푸시를 보내는가"를 별도 계약으로 검증하지 않았다.
- Permanent guardrail: group chat push는 모바일 토큰 등록 범위, Edge fanout role filtering, 설계매니저 제외 정책을 각각 테스트한다. request_board 설계매니저는 내부 단톡방 멤버가 아니며 `group_chat_message` 푸시를 받지 않아야 한다.
- Related files: `app/index.tsx`, `lib/push-registration.ts`, `supabase/functions/group-chat/index.ts`, `lib/__tests__/push-registration.test.ts`, `lib/__tests__/group-chat-edge-source.test.ts`
- Verification: `npm test -- --runInBand lib/__tests__/push-registration.test.ts lib/__tests__/group-chat-mobile-source.test.ts lib/__tests__/group-chat-edge-source.test.ts`; `npx tsc --noEmit --pretty false`; `npm run lint`; `supabase functions deploy group-chat --project-ref ubeginyxaotcamuqpmud`

## 2026-06-12 | Signup Transition Background Fallback | 화면 contentStyle과 root fallback을 같이 고정하지 않음
- Symptom: 회원가입 페이지에서 다음 가입 단계로 이동할 때 화면 배경이 순간적으로 검정색으로 바뀌었다.
- Root cause: 가입 화면은 gradient를 렌더하지만 Stack scene `contentStyle`과 일부 화면 root fallback이 명시되지 않았다. 특히 `signup.tsx`는 `SafeAreaView`가 최상위라 gradient/render timing 또는 native transition 중 기본 배경색이 노출될 수 있었다.
- Why it was missed: 화면 자체의 정상 렌더만 확인했고, native Stack 전환 중 scene 배경과 gradient fallback이 같은 색으로 고정되는지 테스트하지 않았다.
- Permanent guardrail: gradient 기반 auth/signup 화면은 Stack `contentStyle`, root container background, `LinearGradient` fallback style을 모두 같은 밝은 배경으로 고정한다. 가입 단계는 source-level regression test로 검정색 fallback 재도입을 막는다.
- Related files: `app/_layout.tsx`, `app/signup.tsx`, `app/signup-verify.tsx`, `app/signup-password.tsx`, `app/reset-password.tsx`, `lib/__tests__/signup-background-source.test.ts`
- Verification: RED/GREEN `npm test -- --runInBand lib/__tests__/signup-background-source.test.ts`; `npx tsc --noEmit --pretty false`; `npm run lint`; `git diff --check`

## 2026-06-12 | App-Wide Scene Surface Fallback | 화면별 배경만 보고 전역 scene 배경을 놓침
- Symptom: 가입 화면을 고쳐도 다른 헤더/헤더 없는 화면에서 전환 중 UI 배경색이 또 바뀔 수 있다는 위험이 남아 있었다.
- Root cause: `app/_layout.tsx`의 전역 Stack `screenOptions`는 `headerShown: false`만 지정했고, `baseHeader`, React Navigation theme, root container, StatusBar, Android NavigationBar가 하나의 밝은 background contract로 묶여 있지 않았다.
- Why it was missed: 개별 화면 root style과 정상 렌더만 확인했고, React Navigation scene container와 Android native navigation bar가 별도 surface라는 점을 전역 회귀 조건으로 두지 않았다.
- Permanent guardrail: 앱 전체 기본 배경은 `DEFAULT_SCREEN_BACKGROUND` 같은 단일 상수로 루트/테마/Stack/baseHeader/StatusBar/Android NavigationBar에 모두 연결한다. 관련 user-owned protected source-contract test가 이 연결 중 하나라도 빠지면 실패해야 하며 식별자는 문서에 복제하지 않는다.
- Related files: `app/_layout.tsx`; one user-owned protected source-contract test (identifier withheld).
- Verification: RED/GREEN focused run for the user-owned protected source-contract test; PASS for the same protected contract together with the signup-background regression suite. Identifiers and exact commands are withheld.

## 2026-06-12 | EAS Update Config Drift | OTA 발행 가능 여부를 서버 배포처럼 단순 취급
- Symptom: 단톡방 알림 앱 JS 반영을 위해 EAS Update를 실행하자 CLI가 `expo-updates`, `updates.url`, `runtimeVersion`을 자동 설치/설정했다.
- Root cause: 현재 repo의 app config/package에는 OTA 설정이 추적되어 있지 않았지만, 이전 EAS update branch 이력만 보고 JS update가 항상 즉시 적용될 수 있다고 판단할 수 있었다.
- Why it was missed: 서버 Edge Function 배포와 앱 JS OTA 반영을 구분했지만, "현재 native binary가 expo-updates를 포함하고 동일 runtime을 바라보는가"를 먼저 확인하지 않았다.
- Permanent guardrail: EAS Update를 발행하기 전에는 `app.json`의 `updates.url`, `runtimeVersion`, `package.json`의 `expo-updates`, 최신 build runtime/channel 또는 branch를 확인한다. CLI가 auto-config를 만들면 repo에 추적하고, 기존 설치 앱이 해당 runtime을 받을 수 있는지 명확히 보고한다.
- Related files: `app.json`, `package.json`, `package-lock.json`
- Verification: `npx eas-cli@latest update --branch production --message "fix: group chat notifications and UI background hardening" --non-interactive`

## 2026-06-12 | Native Build Approval And Version Gate | 비용 발생 build 명령 승인/버전 규칙 누락
- Symptom: 운영 배포 요청을 처리할 때 native build와 OTA update의 차이, 앱 버전 상향 필요성, 비용 발생 가능성을 충분히 분리해 확인하지 않았다.
- Root cause: `eas build` 계열 명령은 유료 native artifact를 만들 수 있고 `app.json` visible version 상향이 선행돼야 하는데, 배포 요청을 서버/OTA/native build로 먼저 쪼개 승인받는 절차를 문서화하지 않았다.
- Why it was missed: "배포"라는 표현을 배포 수단별 위험도로 나누지 않고, EAS 관련 명령을 모두 같은 운영 작업으로 취급했다.
- Permanent guardrail: `eas build`, `npm run eas:build:*`, store submit 등 native build/submit 명령은 현재 대화에서 명시 승인을 받기 전에는 실행하지 않는다. 승인받아도 먼저 `app.json` 앱 버전을 올리고, platform/profile/current version/proposed version/실행 명령을 보고한 뒤 진행한다.
- Related files: `AGENTS.md`, `.claude/MISTAKES.md`
- Verification: Documentation guardrail only.

## 2026-06-12 | In-App Update Platform Options | iOS 업데이트 프롬프트에 Android 옵션을 넘김
- Symptom: iOS 앱 업데이트 안내가 App Store로 확실히 연결되는지 코드만 보고 보장할 수 없었다.
- Root cause: `useInAppUpdate.ts` 공통 hook이 iOS에서 사용되면서 Android 전용 `IAUUpdateKind.IMMEDIATE`/`updateType`을 `sp-react-native-in-app-updates.startUpdate`에 넘겼다. 라이브러리의 iOS 계약은 `title`, `message`, `buttonUpgradeText`, `buttonCancelText`, `country` 같은 iOS 전용 옵션이다.
- Why it was missed: Android와 iOS의 업데이트 API가 같은 라이브러리 이름 아래에 있어도 start options 계약이 다르다는 점을 플랫폼별 source test로 고정하지 않았다.
- Permanent guardrail: native platform hook은 `.android.ts`/`.ios.ts`로 분리하고, iOS 업데이트 hook에는 `IAUUpdateKind`나 `updateType`이 들어가지 않는 계약 테스트를 둔다. App Store/Play Store 업데이트는 실제 스토어 배포 환경에서 별도 QA해야 한다.
- Related files: `hooks/useInAppUpdate.ts`, `hooks/useInAppUpdate.ios.ts`, `hooks/useInAppUpdate.android.ts`, `hooks/__tests__/use-in-app-update.contract.test.ts`
- Verification: RED/GREEN `npm test -- hooks/__tests__/use-in-app-update.contract.test.ts --runInBand`; `npx eslint hooks/useInAppUpdate.ts hooks/useInAppUpdate.ios.ts hooks/useInAppUpdate.android.ts hooks/__tests__/use-in-app-update.contract.test.ts`; `npx tsc --noEmit --pretty false`

## 2026-06-14 | Group Chat Schema Canon Drift | migrations only, schema.sql missing
- Symptom: `group_chat_rooms`, `group_chat_messages`, `group_chat_reads`, `group_chat_preferences`, and `group_chat_reactions` existed in migrations but were missing from `supabase/schema.sql`.
- Root cause: Group chat was shipped through migrations and Edge Function work without updating the canonical schema file in the same change set.
- Why it was missed: Runtime/source tests covered mobile and Edge Function behavior, but no check fixed the group-chat tables in schema canon.
- Permanent guardrail: Every group-chat DB change must update both a migration and `supabase/schema.sql`, including service-role RLS policies.
- Related files: `supabase/schema.sql`, `supabase/migrations/20260614000001_add_group_chat_send_permissions.sql`
- Verification: `npm test -- --runTestsByPath lib/__tests__/group-chat-api.test.ts lib/__tests__/group-chat-contract.test.ts lib/__tests__/group-chat-mobile-source.test.ts lib/__tests__/group-chat-edge-source.test.ts --runInBand`; `npx eslint app/group-chat.tsx lib/group-chat-api.ts lib/group-chat-contract.ts lib/__tests__/group-chat-api.test.ts lib/__tests__/group-chat-contract.test.ts lib/__tests__/group-chat-mobile-source.test.ts lib/__tests__/group-chat-edge-source.test.ts`; `npx tsc --noEmit --pretty false`; `git diff --check`

## 2026-06-16 | Board Detail Badge Layout Drift | list badge margin reused inline
- Symptom: Board detail modal author metadata badges rendered with mismatched heights/alignment, and the category badge could leave a small stray line/dot in the author row.
- Root cause: `categoryBadge` carried list/title-row `marginBottom` into the inline detail author row, while `roleBadge` and `categoryBadge` used different padding and text line-height contracts.
- Why it was missed: Existing category tests covered labels and data contracts, not the mobile detail metadata row geometry shared by `app/board.tsx` and `app/admin-board-manage.tsx`.
- Permanent guardrail: Detail author metadata must use `detailAuthorBadgeRow`; role/category badges share `minHeight` and text `lineHeight`; inline category badges must apply `categoryBadgeInline` to remove list-only bottom margin.
- Related files: `app/board.tsx`, `app/admin-board-manage.tsx`, `lib/__tests__/board-detail-badge-layout.test.ts`
- Verification: RED/GREEN `npm test -- --runInBand lib/__tests__/board-detail-badge-layout.test.ts`; `npx eslint app\board.tsx app\admin-board-manage.tsx lib\__tests__\board-detail-badge-layout.test.ts`; `npx tsc --noEmit --pretty false`; `git diff --check`

## 2026-06-16 | Board Push Route Regression | standalone detail mistaken for canonical detail
- Symptom: Tapping a board-post push opened the old standalone `board-detail` screen instead of the normal board detail modal.
- Root cause: The notification normalizer treated `/board-detail?postId=...` as the canonical mobile target, while the real in-app detail UX is `app/board.tsx` opened with `/board?postId=...`.
- Why it was missed: The previous route tests asserted the wrong target and did not verify what the screen actually looked like after navigation.
- Permanent guardrail: Board-post push, inbox, notice, and Edge Function targets must use `/board?postId=...`; `/board-detail?postId=...` is legacy input only and must redirect/normalize to the board modal route.
- Related files: `lib/notification-route.ts`, `lib/notice-route.ts`, `app/board-detail.tsx`, `supabase/functions/board-create/index.ts`, `supabase/functions/board-update/index.ts`, `supabase/functions/board-comment-create/index.ts`, `supabase/functions/board-comment-like-toggle/index.ts`
- Verification: RED/GREEN `npm test -- --runInBand lib/__tests__/notification-route.test.ts lib/__tests__/notice-route.test.ts lib/__tests__/board-detail-route-source.test.ts`; RED/GREEN `npm test -- --runInBand supabase/functions/__tests__/board-update-notification.contract.test.ts supabase/functions/__tests__/board-notification-target.contract.test.ts`

## 2026-06-16 | Auth Button Keyboard Dismiss Regression | onPressIn cancelled final press
- Symptom: On Android auth screens, tapping the login button while the keyboard was open showed the pressed visual state and dismissed the keyboard, but did not run the login action.
- Root cause: Android delivered the button's press-in visual state while the keyboard was open, but the surrounding keyboard/scroll responder could still cancel the final `onPress` callback. Moving keyboard dismiss after `onPress` was not enough because the final press callback itself was the unreliable part.
- Why it was missed: The previous source test only proved that `dismissKeyboardOnPress` existed and that `Keyboard.dismiss()` happened after `onPress`; it did not cover the observed native path where press-in fires but final `onPress` does not.
- Permanent guardrail: Keyboard-sensitive auth CTAs that must submit while the keyboard is open should opt into `submitOnPressIn`; the shared `Button` must guard against duplicate submit when both press-in and final `onPress` arrive. Do not put keyboard-dismiss-only behavior on press-in.
- Related files: `components/Button.tsx`, `components/__tests__/Button.contract.test.ts`, `lib/__tests__/login-mobile-source.test.ts`
- Verification: RED/GREEN `npm test -- --runInBand components/__tests__/Button.contract.test.ts lib/__tests__/login-mobile-source.test.ts`; `npx eslint components\Button.tsx components\__tests__\Button.contract.test.ts lib\__tests__\login-mobile-source.test.ts app\login.tsx`; `npx tsc --noEmit --pretty false`; Android device tap test with keyboard open showed the login button entering loading state and the login/session flow starting.

## 2026-06-16 | Tool Review Disclosure Omission | final answers skipped required disclosure
- Symptom: Final answers did not consistently state whether Superpowers, Sequential Thinking, and context7 were considered or used, even though the workspace instruction required that review for every task.
- Root cause: The instruction said to consider the tools, but did not separately force a visible final-answer disclosure. The agent performed some checks internally and used Superpowers in parts of the work, then failed to report the review status.
- Why it was missed: Verification focused on code/test outcomes and Git state, not on response-contract compliance.
- Permanent guardrail: Every final answer in the Hanhwa workspace must include a short `도구/스킬 검토` note naming Superpowers, Sequential Thinking, and context7 as used, reviewed only, unavailable, or not applicable, with a brief reason.
- Related files: `D:\hanhwa\AGENTS.md`, `AGENTS.md`, `.claude/MISTAKES.md`
- Verification: Added an explicit final-answer disclosure rule to both `D:\hanhwa\AGENTS.md` and repo `AGENTS.md`.

## 2026-06-18 | GaramIn Request Board Policyholder UI Drift | API contract fields existed without mobile inputs
- Symptom: In the GaramIn app FC design-request flow, selecting `계약자 피보험자 다름` left no place to enter the separate contractor/policyholder information.
- Root cause: Commit `24c8b13054e19d4c4284eaeab12f78f570eca37a` (`2026-06-04 12:35:35 +0900`, `feat: update garamin ops workflows`) introduced `app/request-board-create.tsx` with `hasSeparatePolicyholder` and policyholder payload forwarding, but the mobile `신규 고객 등록` UI and save validation did not expose `policyholderName`, `policyholderSsn`, `policyholderPhone`, `policyholderCarrier`, or `policyholderAddress`.
- Why it was missed: The 2026-06-04 work treated the request-board create screen as existing customer select/register exposure and verified route/flow behavior, while no source-level parity test checked that user-enterable `RbSaveCustomerPayload` fields were rendered and validated in GaramIn mobile.
- Permanent guardrail: When `RbSaveCustomerPayload` or `RbCreateRequestPayload` adds or carries a user-enterable field, the GaramIn mobile screen must include matching UI, state binding, and validation, and `lib/__tests__/request-board-mobile-ui-contract.test.ts` must assert the visible labels and bindings. Separate contractor/policyholder fields are specifically locked by this contract test.
- Related files: `app/request-board-create.tsx`, `lib/request-board-api.ts`, `lib/__tests__/request-board-mobile-ui-contract.test.ts`
- Verification: RED/GREEN `npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts`; final lint/type/diff verification must include this entry's related files.

## 2026-06-18 | GaramIn Request Board Customer Field Parity Drift | mobile form lagged behind GaramLink web contract
- Symptom: After restoring separate contractor inputs, broader review found GaramIn mobile still omitted or weakened other customer fields that GaramLink web and the request-board API contract used: semantic birth-date validation, required canonical driving status, insured carrier, referrer, insurance qualifications, current medication, body-metric normalization, and policyholder detail display on review.
- Root cause: The mobile request-create screen copied the request/customer payload shape but did not keep a field-by-field parity contract with GaramLink `CustomerFormPanel` and request detail displays.
- Why it was missed: Tests locked isolated UI regressions, not the whole user-enterable customer payload surface. Optional-looking fields were initialized and forwarded, so source review could mistake them for supported even when there was no mobile input or display path.
- Permanent guardrail: Any GaramLink customer/request field that is user-enterable, forwarded in `RbSaveCustomerPayload`/`RbCreateRequestPayload`, or displayed in request detail must have a GaramIn source-contract test asserting mobile input/display/validation parity. Canonical option values such as driving status and carrier must be tested separately from legacy display aliases.
- Related files: `app/request-board-create.tsx`, `app/request-board-review.tsx`, `lib/request-board-api.ts`, `lib/request-board-customer-input.ts`, `lib/request-board-driving-status.ts`, `lib/__tests__/request-board-mobile-ui-contract.test.ts`, `lib/__tests__/request-board-customer-input.test.ts`, `lib/__tests__/request-board-driving-status.test.ts`, `lib/__tests__/request-board-api-contract.test.ts`
- Verification: RED/GREEN request-board parity tests, `npx.cmd eslint ...`, `npx.cmd tsc --noEmit --pretty false`, and final `git diff --check`.

## 2026-06-18 | GaramIn Request Board Wrapped Option Layout Drift | two-column field style reused for wrapping chip groups
- Symptom: In the GaramIn request-board customer registration step, wrapped driving-status chips overflowed their parent and overlapped the `Insurance qualification` section below them on web/mobile layout.
- Root cause: Wrapped option groups reused `styles.field`, which is a two-column input helper with `flex: 1`. On React Native Web the flex parent height was measured shorter than the multi-row chip grid, so later sections started before the chips finished rendering.
- Why it was missed: The previous parity tests checked labels, values, and validation, but did not lock the layout contract that multi-row option groups must not use the two-column flex field wrapper.
- Permanent guardrail: Wrapped option groups such as carriers, driving status, and insurance qualifications must use a non-flex stacked wrapper. `request-board-mobile-ui-contract.test.ts` must keep asserting that these groups use `styles.stackedField`, and that `stackedField` does not contain `flex: 1`.
- Related files: `app/request-board-create.tsx`, `lib/__tests__/request-board-mobile-ui-contract.test.ts`
- Verification: RED/GREEN `npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts`; browser DOM measurement and screenshot of `/request-board-create` confirmed the driving chips end before the insurance qualification label begins.

## 2026-06-18 | GaramIn Request Board Designer Contract Drift | 설계매니저 홈/세션/문구 계약이 화면별로 달라짐
- Symptom:
  - 홈 통계의 `완료` 카운트가 목록 필터의 `완료` 버킷과 달리 `rejected` 배정을 제외했다.
  - request_board 재인증이 필요한 경우 GaramIn 전체 세션까지 로그아웃할 수 있었다.
  - 설계요청 메신저 목록은 다른 화면의 `설계매니저` 용어 대신 `설계사 목록`을 사용했다.
- Root cause:
  - 홈 통계는 `request-board-list-filters` 버킷 계약과 별도 내부 함수로 유지됐다.
  - request_board 브릿지 세션 실패와 GaramIn 앱 세션 실패를 같은 로그아웃 경로로 처리했다.
  - 설계매니저 용어 SSOT가 화면 계약 테스트에 포함되지 않았다.
- Why it was missed:
  - 이전 검증은 FC 생성/고객등록 흐름과 상세 권한 버튼에 집중했고, 설계매니저 홈/메신저/자동 세션 복구 경로를 같은 묶음으로 대조하지 않았다.
- Permanent guardrail:
  - request-board 홈 통계는 테스트 가능한 shared helper로 유지하고, `rejected` 같은 버킷 매핑 변경은 홈 통계 테스트와 목록 필터 테스트를 함께 갱신한다.
  - request_board `needsRelogin`은 request_board 토큰만 정리하고 GaramIn 앱 세션은 보존한다.
  - 설계요청 화면에서 설계자 표기는 `설계매니저`로 고정하고 source contract test로 보호한다.
- Related files:
  - `app/request-board.tsx`
  - `app/request-board-messenger.tsx`
  - `hooks/use-session.tsx`
  - `lib/request-board-home-stats.ts`
  - `lib/__tests__/request-board-home-stats.test.ts`
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`
- Verification:
  - RED/GREEN `npm test -- --runTestsByPath lib/__tests__/request-board-home-stats.test.ts`
  - RED/GREEN `npm test -- --runTestsByPath lib/__tests__/request-board-mobile-ui-contract.test.ts`

## 2026-06-18 | GaramIn Request Board Separate Contractor Toggle Drift | Pressable 이벤트가 웹 UI에서 토글을 안정적으로 열지 못함
- Symptom:
  - `계약자 피보험자 다름` 컨트롤은 화면에 보였지만, in-app browser UI 검증에서 클릭 후에도 계약자 입력 패널이 열리지 않았다.
- Root cause:
  - React Native Web `Pressable`의 `onPressIn`/`onPress` 이벤트가 같은 클릭에서 중복 또는 누락될 수 있는데, 중복 방지 플래그를 `requestAnimationFrame`에서 너무 빨리 해제했다.
  - 웹 UI 검증 표면에서는 Pressable 클릭 경로가 안정적이지 않았는데도 별도 DOM button/key 경로를 두지 않았다.
- Why it was missed:
  - 이전 source contract는 라벨과 필드 존재만 확인했고, 토글 이벤트가 실제로 패널을 여는 UI 단계 검증이 부족했다.
- Permanent guardrail:
  - `계약자 피보험자 다름`은 native Pressable 경로와 web `role=button` keyboard/click 경로를 모두 유지한다.
  - 같은 클릭에서 `onPressIn`, `onPress`, web click이 중복으로 들어와도 1초 동안 한 번만 토글되도록 가드한다.
  - UI 검증에서는 토글 후 `계약자 이름`, `계약자 주민번호`, `계약자 휴대폰번호`가 실제 DOM/스크린샷에 나타나는지 확인한다.
- Related files:
  - `app/request-board-create.tsx`
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`
- Verification:
  - RED/GREEN `npm test -- --runTestsByPath lib/__tests__/request-board-mobile-ui-contract.test.ts`
  - In-app browser: `/request-board-create?entry=newCustomer` loads without `데이터 로드 실패`; keyboard activation of the toggle shows the separate contractor inputs.

## 2026-06-18 | Governance Work Log Omission | push run failed after code commits
- Symptom: Gmail reported repeated `Run failed: Governance Check` messages immediately after pushing request-board fixes. GitHub Actions logs showed `Code changed but WORK_LOG.md and WORK_DETAIL.md were not both updated.`
- Root cause: The implementation commits updated code, tests, harness notes, and mistake ledgers, but skipped the repo-required `.claude/WORK_LOG.md` and `.claude/WORK_DETAIL.md` pair.
- Why it was missed: Local verification covered Jest, ESLint, TypeScript, Expo export, server build, and `git diff --check`, but did not run `node scripts/ci/check-governance.mjs` before commit in the fc app repo.
- Permanent guardrail: Before any push that includes code-path changes, the local pre-push hook must run `scripts/ci/pre-push-governance.mjs`, which checks the exact remote SHA to local SHA push diff. If the hook is missing, run `npm run governance:install-hook` before pushing. Treat `.claude/WORK_LOG.md` and `.claude/WORK_DETAIL.md` as required release metadata, not optional handoff notes.
- Related files: `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`, `scripts/ci/check-governance.mjs`, `scripts/ci/pre-push-governance.mjs`, `scripts/ci/install-governance-hook.mjs`
- Verification: Gmail alert was traced to GitHub Actions run `27747659856`; this fix adds the missing work log/detail pair, installs the local pre-push governance hook, and verifies old bad push diffs fail locally while repaired push diffs pass.

## 2026-06-19 | Role E2E Evidence Capture Leakage | full UI/log dumps exposed sensitive payload classes
- Symptom: During role-based E2E investigation, full browser/body/console inspection paths exposed sensitive identifier or token classes from request_board/admin_web/mobile logs. The final artifacts were sanitized, but the capture method itself was unsafe.
- Root cause: The QA harness used broad page text/console capture while exploring unfamiliar UI state. Several product surfaces also log large payloads or sensitive runtime fields, so even "just inspect the page/log" can collect data that must not be persisted.
- Why it was missed: Earlier runtime checks optimized for speed and completeness instead of applying a strict evidence-minimization contract before the first UI dump.
- Permanent guardrail: E2E evidence must capture only masked account labels, route/API status, role, permission, and aggregate counts. Do not dump full page body text, browser storage, HARs, screenshots of PII screens, signed URLs, JWT/bridge/app-session values, push tokens, resident numbers/SSNs, or unfiltered console payloads. Add an evidence scanner before storing `.codex/harness` artifacts when a run touches auth, request_board, documents, chat, referral, or push flows.
- Related files: `.codex/harness/qa-report.md`, `.codex/harness/handoff.md`, `docs/testing/INTEGRATED_TEST_RUN_RESULT.json`, `docs/referral-system/TEST_RUN_RESULT.json`
- Verification: Current 2026-06-19 result files use masked labels and sanitized status/evidence notes only; raw sensitive values are intentionally omitted.

## 2026-06-20 | GaramIn Customer Management Web QA Drift | stacked card actions and wrong local request_board API default
- Symptom:
  - In Expo web customer-management, `요청 작성`, `수정`, and `삭제` were stacked vertically on the right side of each customer card, causing excessive height and awkward whitespace.
  - `/request-board` web QA showed `서버에 연결할 수 없습니다` because local Expo web was bundled against production request_board or an incorrect local API port.
- Root cause:
  - The customer card treated all three actions as equal full text buttons in a vertical side rail instead of separating one primary action from compact secondary actions.
  - GaramIn local request_board URL derivation used API port `3000`, while request_board server development defaults to `3001`.
- Why it was missed:
  - Source contracts covered action existence but not action density or horizontal layout.
  - Local web QA started Expo on fallback port `8082`, but the request_board local API/web routing contract was not checked before opening the browser.
- Permanent guardrail:
  - Customer-management cards must keep `요청 작성` as a primary card action and keep `수정`/`삭제` as compact secondary actions in a horizontal action row.
  - GaramIn local request_board API defaults must stay aligned with request_board server port `3001`, with source contract coverage.
- Related files:
  - `app/request-board-create.tsx`
  - `lib/request-board-url.ts`
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`
  - `lib/__tests__/request-board-api-contract.test.ts`
- Verification:
  - RED/GREEN `npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts`
  - `npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts lib/__tests__/request-board-api-contract.test.ts`
  - `npx eslint app/request-board-create.tsx lib/request-board-api.ts lib/request-board-url.ts lib/__tests__/request-board-mobile-ui-contract.test.ts lib/__tests__/request-board-api-contract.test.ts`
  - `npx tsc --noEmit`

## 2026-06-20 | Customer Form Textarea Spacing | multiline Field labels crowded against previous textarea
- Symptom:
  - In GaramIn customer registration/edit web view, the `최근 병원 진료` label appeared visually attached to the previous textarea border.
- Root cause:
  - The shared `Field` wrapper used the same compact vertical spacing for one-line inputs and multiline textarea inputs. A textarea's larger box needs extra bottom spacing before the next label.
- Why it was missed:
  - Source contracts covered field presence and validation but not spacing between consecutive multiline health fields.
- Permanent guardrail:
  - Multiline `Field` instances must apply `styles.multilineField` with bottom spacing, while one-line fields keep the compact base `styles.field` spacing.
- Related files:
  - `app/request-board-create.tsx`
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`
- Verification:
  - RED/GREEN `npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts`
  - `npx eslint app/request-board-create.tsx lib/__tests__/request-board-mobile-ui-contract.test.ts`

## 2026-06-20 | Customer Carrier MVNO Collapse | 알뜰폰 saved without network identity
- Symptom:
  - GaramIn customer registration/edit only offered `알뜰폰`, so users could not distinguish 알뜰폰 SKT, 알뜰폰 KT, or 알뜰폰 LG U+.
- Root cause:
  - The mobile customer form carrier option list collapsed all MVNO carriers into one label, losing the underlying network information needed for customer records.
- Why it was missed:
  - Source contracts checked carrier field persistence but not the completeness of the carrier option taxonomy.
- Permanent guardrail:
  - Customer carrier options must include network-specific MVNO labels: `알뜰폰 SKT`, `알뜰폰 KT`, and `알뜰폰 LG U+`. Do not reintroduce a generic-only `알뜰폰` option for customer records.
- Related files:
  - `app/request-board-create.tsx`
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`
- Verification:
  - RED/GREEN `npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts`
## 2026-06-20 | Customer Selection Actions | delete was limited to customer-management
- Symptom: `/request-board-create` normal customer selection showed `선택` and `수정`, but not `삭제`, even though the user expected the same saved-customer management action there.
- Root cause: The delete button render was gated by `isCustomerManagement`; the delete handler itself already handled selected-customer cleanup safely.
- Fix: Render the delete action in both normal customer selection and customer-management cards, while keeping customer-management's primary action as `요청 작성` and normal flow's primary action as `선택`.
- Guardrail: `request-board-mobile-ui-contract.test.ts` now asserts the delete action is not gated by `isCustomerManagement` and that separate-policyholder summaries use explicit colon labels across list/detail surfaces.

## 2026-06-26 | Next Route Imported Deno Edge Shared File | admin group-chat build failed
- Symptom: `cd web && npm run build` failed because `src/app/api/group-chat/route.ts` imported `supabase/functions/_shared/request-board-auth.ts` directly.
- Root cause: The Supabase shared file is authored for Edge/Deno and lives outside the Next app's normal module graph; Turbopack could not resolve it as a web route dependency.
- Fix: Added a small web-local `createWebGroupChatAppSessionToken` helper in `web/src/lib/request-board-app-session.ts` that produces the same signed app-session payload using Node crypto and a short TTL.
- Guardrail: Do not import Deno Edge Function shared modules directly into `web/src/app/api/*` routes. If a web route needs the same contract, add a web-compatible helper and verify with `cd web && npm run build`, not lint alone.

## 2026-06-26 | Admin Group Chat Local Runtime | CORS and missing app-session cookie
- Symptom: On `http://localhost:3000`, `/dashboard/messenger` logged a CORS failure for direct `fc-notify` Edge Function calls, and `/api/group-chat` returned 500/401 during 단톡방 bootstrap.
- Root cause: The messenger hub still used `supabase.functions.invoke('fc-notify')` in the browser, so local origin depended on Edge Function CORS. The group-chat proxy also tried to mint its own app-session token from `REQUEST_BOARD_AUTH_BRIDGE_SECRET`, which was not present in `web/.env.local`, instead of reusing the app-session token already returned by login.
- Fix: Messenger hub unread counts now use `/api/fc-notify`; login stores the returned app-session token in HttpOnly `web_app_session`; `/api/group-chat` reads that cookie before falling back to local token minting.
- Guardrail: Admin web client code should not call Supabase Edge Functions directly when a server proxy exists. Any web route that needs an app-session token should prefer the login-issued server-only cookie over local secret-dependent minting.

## 2026-06-26 | Admin Direct Chat List Loading | per-FC Supabase message query chain
- Symptom: `/dashboard/chat` and deep links such as `/dashboard/chat?targetId=...` kept showing `목록을 불러오는 중...` for too long before the conversation list was usable.
- Root cause: The chat list built summaries by looping through every visible FC and running two Supabase `messages` queries per FC, creating an avoidable sequential N+1 request chain.
- Fix: The page now fetches the current staff actor's message rows once and uses `buildAdminChatConversationSummaries()` to compute latest message and unread count locally. Deep-linked chat targets can open before the full FC list finishes.
- Guardrail: `lib/__tests__/admin-web-chat-source.test.ts` rejects per-FC `baseTargets` message-query loops, and `web/src/lib/admin-chat-targets.test.ts` verifies one-pass summary derivation.

## 2026-06-26 | Group Chat Error UX | expected restrictions looked like generic failures
- Symptom: 단톡방 참여 제한, 세션 만료, 발언 권한 제한, 서버 오류가 모두 `단톡방 오류`처럼 보여 사용자가 진짜 장애인지 조건 미충족인지 구분할 수 없었다.
- Root cause: Edge Function 일부 분기가 generic `forbidden`만 반환했고, mobile/admin web clients threw plain `Error`, losing status/code before rendering alerts.
- Fix: Add `GroupChatRequestError` and `classifyGroupChatError`, preserve proxy/Edge status codes, return specific eligibility codes (`not_completed`, `request_board_designer_only`, `inactive_account`), and deploy the updated `group-chat` function.
- Guardrail: `group-chat-error.test.ts` verifies user-facing classification, and group-chat source tests assert mobile/web use the classifier plus Edge returns specific participation codes.

## 2026-06-26 | Admin Notification Scope Drift | developer saw shared 총무 message alerts
- Symptom: 개발자 계정 알림센터에 총무 공용 채널로 온 박경호 메시지 알림이 같이 보였다.
- Root cause: direct chat separated shared `admin` messages from developer phone-scoped messages, but `fc-notify` inbox queries used `resident_id.eq.<phone> OR resident_id.is.null` for admin viewers and web/mobile push selected all admin-role subscriptions for shared admin notifications.
- Fix: Phone-scoped admin inbox queries now fetch only that phone's rows; shared admin queries use `resident_id is null`. Shared admin push fanout now filters to active non-developer admin accounts, while concrete admin `target_id` notifications remain personal.
- Guardrail: `notification-inbox-scope.test.ts` fixes mobile scope expectations, and `admin-web-chat-source.test.ts` asserts web/Edge inbox and push fanout keep shared admin and developer personal recipients separate.

## 2026-06-27 | Admin Web Referral Graph Access | stale client session revived expired server session
- Symptom:
  - Developer and manager logins did not expose referral graph as a clear dashboard page.
  - FC login could bounce between `/auth` and `/dashboard` instead of landing on `/dashboard/referrals/graph`.
  - A deployed Vercel alias still showed browser-side `login-with-password` CORS errors because the live bundle lagged behind the server-proxy login path.
- Root cause:
  - Admin-web client session restoration trusted localStorage when the client-visible session cookies were gone, so an expired server-issued staff/FC session could be recreated on the client side.
  - The route guard checked the FC graph cookie but did not require the server-issued staff session cookie for staff routes.
  - Referral graph navigation for staff users was hidden as a nested child instead of a top-level work menu item.
- Why it was missed:
  - Route tests covered FC graph restriction but not stale localStorage revival or missing staff-session-cookie behavior.
  - Navigation coverage checked the graph page itself, not whether developer/manager users could discover it from the main dashboard.
  - Deployment verification did not compare the live alias bundle against the expected `/api/auth/login` proxy behavior.
- Permanent guardrail:
  - Admin web must treat server-issued session cookies as the session source of truth; localStorage may not resurrect a missing cookie session.
  - Route access tests must cover missing `staff_session` and FC `/dashboard` redirects.
  - Dashboard navigation must keep `추천인 그래프` as a top-level staff menu item.
  - Login CORS reports on Vercel should first check whether the live alias is running a stale client-direct Supabase bundle before changing Supabase CORS policy.
- Related files:
  - `web/src/lib/client-session-restore.ts`
  - `web/src/hooks/use-session.tsx`
  - `web/src/lib/admin-web-route-access.ts`
  - `web/src/lib/admin-web-proxy-handler.ts`
  - `web/src/app/dashboard/layout.tsx`
- Verification:
  - RED/GREEN: `npx tsx --test web/src/lib/client-session-restore.test.node.ts web/src/lib/admin-web-route-access.test.ts web/src/lib/admin-web-referral-graph-nav.test.ts`
  - Added and passed: `npx tsx --test web/src/lib/admin-web-auth-login-proxy-source.test.ts`.

## 2026-07-01 | Daily Sentry Automation Window | 24h no-issues was easy to confuse with a seven-day backlog report
- Symptom:
  - The daily Sentry repair automation reported `no-issues`, while a separate seven-day review still found unresolved older issues.
  - GaramLink `garamlink-client` was outside the GaramIn daily repair automation scope, so the Sentry review and scheduled repair coverage did not match.
- Root cause:
  - `npm run ops:sentry-triage` intentionally used the default 24h repair window, but the runbook did not explicitly say that `no-issues` only applied to that window.
  - Earlier worktree runs also failed when `SENTRY_READ_AUTH_TOKEN` was not available, so read-token preflight needed to stay explicit in every automation contract.
- Permanent guardrail:
  - Keep daily repair default triage at 24h; use `npm run ops:sentry-triage -- --last-seen-days 7 --summary-only` for seven-day reports.
  - Do not add GaramLink repair work to the GaramIn automation. Use the separate `daily-garamlink-sentry-repair-pr` automation from `D:\hanhwa\request_board`.
  - Every Sentry automation must fail closed when `SENTRY_READ_AUTH_TOKEN` is missing and must never use `SENTRY_AUTH_TOKEN` for reads.
- Related files:
  - `scripts/ops/sentry-daily-triage.mjs`
  - `scripts/ops/sentry-daily-triage.test.mjs`
  - `docs/handbook/operations-runbook.md`
- Verification:
  - RED/GREEN `node --test scripts/ops/sentry-daily-triage.test.mjs`

## 2026-07-02 | Admin Web Direct Chat Performance | whole-list and unrelated realtime refreshes made messenger slow
- Symptom:
  - The admin web messenger at `/dashboard/chat` felt too slow as chat/message history grew.
  - The page loaded the full dashboard FC list and all messages involving the staff actor, then refreshed the list on every `messages` table change.
- Root cause:
  - The previous N+1 chat-list fix removed per-FC message queries, but replaced them with an unbounded message summary query and a broad realtime refetch path.
  - The page also used a 2.5s room polling fallback even though realtime and focus refresh were already active.
- Permanent guardrail:
  - Web chat list loading must go through `web/src/app/api/admin/chat-list/route.ts`, not `/api/admin/list`.
  - The route must keep recent message summary queries bounded with `RECENT_CHAT_SUMMARY_LIMIT` and merge unread backfill rows without double-counting.
  - Chat-list realtime handlers must ignore message changes that do not involve the current staff actor.
- Related files:
  - `web/src/app/api/admin/chat-list/route.ts`
  - `web/src/app/dashboard/chat/page.tsx`
  - `web/src/lib/admin-chat-targets.ts`
  - `lib/__tests__/admin-web-chat-source.test.ts`
- Verification:
  - RED/GREEN `npx tsx --test web/src/lib/admin-chat-targets.test.ts`
  - RED/GREEN `npx jest lib/__tests__/admin-web-chat-source.test.ts --runInBand`
  - `cd web && npm run build`

## 2026-07-02 | Chat Send Latency And Group Permission Actor IDs | side effects blocked sends and formatted FC ids broke toggles
- Symptom:
  - Admin web direct chat felt slow even after the chat list was optimized because sending a message waited for notification insert and `/api/fc-notify` push fanout.
  - A second admin message still had to wait for the previous insert because the composer used one global `isSending` flag.
  - The open room refetched its whole message history on realtime INSERT even when Supabase already sent the inserted row in `payload.new`.
  - GaramIn group chat FC send-permission toggles could fail or appear not to stick when the target actor id was formatted as a phone number or `fc:` id with separators.
- Root cause:
  - `web/src/app/dashboard/chat/page.tsx` kept the send button busy until non-critical notification side effects finished, and message fetch/insert used `select('*')`.
  - Send state was modeled as room-wide state instead of draft-level state, and the realtime room handler treated every related change as a full sync trigger.
  - Mobile/web clients and the Edge Function treated permission targets as already-canonical `fc:<digits>` ids; formatted ids were rejected or missed during local row merge.
- Permanent guardrail:
  - Direct message sends should optimistically clear/append after validation, wait only for the message insert, and run notification/push work in a background helper.
  - Do not use a global room-level sending lock for text messages; keep a draft ref to prevent duplicate clicks while allowing the next draft to send immediately.
  - Realtime INSERT/UPDATE/DELETE for an open direct-chat room should merge `payload.new`/`payload.old` locally and only fall back to full fetch when the payload is incomplete.
  - Permission target actor ids must be normalized at every boundary: mobile API, admin web proxy/client, and Edge Function.
  - When Edge returns a canonical member id, UI merges must match both the original row id and returned canonical id.
- Related files:
  - `web/src/app/dashboard/chat/page.tsx`
  - `lib/group-chat-api.ts`
  - `web/src/lib/group-chat-client.ts`
  - `web/src/lib/group-chat-web.ts`
  - `supabase/functions/_shared/group-chat.ts`
  - `supabase/functions/group-chat/index.ts`
  - `app/group-chat.tsx`
  - `web/src/app/dashboard/group-chat/page.tsx`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/admin-web-chat-source.test.ts lib/__tests__/group-chat-api.test.ts lib/__tests__/group-chat-mobile-source.test.ts lib/__tests__/group-chat-edge-source.test.ts --runInBand`
  - RED/GREEN `cd web && npx tsx --test src/lib/group-chat-web-route.test.ts`
  - RED/GREEN `npx jest lib/__tests__/admin-web-chat-source.test.ts --runInBand`
  - `npx tsc --noEmit --pretty false`
  - `cd web && npm run build`

## 2026-07-02 | Board Attachment Edit Parity | admin web could not remove wrong existing images
- Symptom:
  - Admin web board editing allowed text/category changes and new attachment uploads, but an already-uploaded wrong image could not be removed from the edit composer.
  - Mobile admin board editing already exposed existing attachment deletion, so the same board workflow behaved differently by client.
- Root cause:
  - `deleteBoardAttachments` existed in the shared board API, but the admin web composer only rendered existing attachments as static links.
  - Attachment-count validation only considered the initial existing list, so deleting an existing image in-place would not have freed a slot for a replacement.
- Permanent guardrail:
  - Board edit parity tests must assert that admin web imports `deleteBoardAttachments`, removes existing attachments from local state, and invalidates both board detail and board list caches.
  - Attachment limit checks must use the current existing attachment count after edits, not the initial detail payload count.
- Related files:
  - `web/src/app/dashboard/board/page.tsx`
  - `lib/__tests__/admin-web-board-source.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/admin-web-board-source.test.ts --runInBand`

## 2026-07-02 | Mobile Direct Chat Payload Width | app still selected every message column after web optimization
- Symptom:
  - Admin web direct chat send/list paths had been optimized, but the GaramIn mobile app still fetched and selected full message rows.
- Root cause:
  - The optimization pass focused on the admin web messenger first and did not add a mobile source contract for direct-chat message column selection.
- Permanent guardrail:
  - Mobile direct-chat tests must assert that fetch and post-insert select paths use `MESSAGE_SELECT_COLUMNS` and do not regress to `.select('*')`.
  - Mobile send should keep the optimistic local append and run push notification side effects in the background.
- Related files:
  - `app/chat.tsx`
  - `lib/__tests__/mobile-chat-source.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/mobile-chat-source.test.ts --runInBand`

## 2026-07-02 | Saved Password Storage | convenience storage tried to fall back below SecureStore
- Symptom:
  - The mobile login password-save helper initially allowed the default credential storage path to fall back from `expo-secure-store` to generic app storage.
  - That would make an explicit password-save feature look safe while storing a reusable credential outside the platform secure store on unsupported runtimes.
- Root cause:
  - Existing `safeStorage` is useful for low-risk app state, but it was too broad for password material.
  - The first implementation optimized for graceful fallback before separating credential storage from ordinary local state.
- Permanent guardrail:
  - Saved login passwords may use `expo-secure-store` only. If SecureStore is unavailable, password save must be a no-op and must not fall back to AsyncStorage, file storage, memory storage, or web localStorage.
  - Tests must pass an explicit `null` storage and assert get/set/clear do not store or throw.
- Related files:
  - `lib/saved-login-credentials.ts`
  - `lib/__tests__/saved-login-credentials.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/saved-login-credentials.test.ts --runInBand`

## 2026-07-02 | Board Category Canonical Source | category values drifted across copied SQL and tests
- Symptom:
  - Board categories could appear to roll back because the same active category set was copied into schema seed SQL, repair migrations, tests, and automation scripts.
  - Fixing one copy did not guarantee that later repair/manual paths used the same labels, sort order, or active status.
- Root cause:
  - `supabase/functions/_shared/board-categories.ts` existed as the runtime canonical set, but SQL seed/repair snippets and digest automation still carried duplicated category values.
- Why it was missed:
  - Existing tests asserted the expected category labels directly instead of checking that schema, repair SQL, and automation were derived from the same canonical source.
- Permanent guardrail:
  - Treat `supabase/functions/_shared/board-categories.ts` as the current source of truth.
  - Generate/verify board category seed rows and repair SQL through `scripts/ops/board-category-canonical-sql.mjs`.
  - Any category change must update the canonical source first, then run the board category contract tests.
- Related files:
  - `supabase/functions/_shared/board-categories.ts`
  - `scripts/ops/board-category-canonical-sql.mjs`
  - `scripts/ops/board-category-canonical-sql.test.mjs`
  - `supabase/schema.sql`
  - `supabase/migrations/20260608000001_update_board_categories_product_recommendation_policy.sql`
  - `scripts/ops/post-insurance-digest.mjs`
  - `lib/__tests__/board-category-contract.test.ts`
- Verification:
  - RED/GREEN `node --test scripts/ops/board-category-canonical-sql.test.mjs`
  - `npx jest lib/__tests__/board-category-contract.test.ts --runInBand`

## 2026-07-03 | Messenger Read Receipt Drift | unread recipient counts stayed group-chat-only
- Symptom:
  - Group chat showed KakaoTalk-style unread recipient counts, but 1:1 direct chat, request-board messenger, and admin web direct chat did not show the same numeric count.
  - Mobile direct-chat optimistic sends marked new outgoing messages as `is_read: true`, hiding the unread count even before the recipient opened the message.
- Root cause:
  - Read receipt display was implemented as a group-chat-local UI detail instead of a messenger-wide contract.
  - Direct/request-board chat surfaces carried `is_read` data but rendered only timestamps or text read labels.
- Why it was missed:
  - Messenger contract tests covered links, long-press actions, attachments, and group unread counts, but did not assert direct-message unread recipient counts across every messenger surface.
- Permanent guardrail:
  - 1:1 and request-board messenger surfaces must use `lib/message-read-receipts.ts` to render numeric unread recipient counts for sent unread messages.
  - Group chat may continue using room `unread_count`, but any new messenger surface must prove unread-count parity in a contract test.
- Related files:
  - `app/chat.tsx`
  - `app/request-board-messenger.tsx`
  - `web/src/app/dashboard/chat/page.tsx`
  - `lib/message-read-receipts.ts`
  - `web/src/lib/message-read-receipts.ts`
- Verification:
  - `npm test -- --runInBand lib/__tests__/mobile-chat-source.test.ts lib/__tests__/group-chat-mobile-source.test.ts lib/__tests__/admin-web-chat-source.test.ts lib/__tests__/message-read-receipts.test.ts`

## 2026-07-03 | Messenger Read Receipt Badge Drift | count logic was shared but mobile UI stayed screen-local
- Symptom:
  - Direct chat, group chat, and request-board messenger each rendered the sent-message unread recipient number with local `<Text style={styles.messageUnreadCount}>` branches.
  - The shared unread count contract could still drift visually because each screen owned its own color, font, and formatting branch.
- Root cause:
  - The previous read-receipt fix centralized count calculation but left the presentation primitive as duplicated screen code.
- Why it was missed:
  - Tests asserted `getDirectMessageUnreadCount` / `formatUnreadReceiptCount` usage but did not require the same UI component across mobile messenger surfaces.
- Permanent guardrail:
  - Mobile messenger unread receipt display must use `components/MessageUnreadReceiptBadge.tsx`.
  - Direct/request-board screens pass `getDirectMessageUnreadCount(...)`; group chat passes room `unread_count`.
  - Screens should not reintroduce local `messageUnreadCount` text styles or direct formatting branches.
- Related files:
  - `components/MessageUnreadReceiptBadge.tsx`
  - `app/chat.tsx`
  - `app/group-chat.tsx`
  - `app/request-board-messenger.tsx`
  - `lib/__tests__/group-chat-mobile-source.test.ts`
  - `lib/__tests__/mobile-chat-source.test.ts`
- Verification:
  - `npm test -- --runInBand lib/__tests__/group-chat-mobile-source.test.ts`
  - `npm test -- --runInBand lib/__tests__/shared-ui-action-contracts.test.ts lib/__tests__/feature-contract-matrix.test.ts lib/__tests__/group-chat-mobile-source.test.ts lib/__tests__/mobile-chat-source.test.ts lib/__tests__/message-read-receipts.test.ts lib/__tests__/messenger-room-ordering.test.ts`

## 2026-07-03 | Board Notice Contract Map Gap | board contract existed only in prose
- Symptom:
  - The feature contract matrix mentioned board/notice parity, but `docs/handbook/contract-test-map.json` did not have a `board-and-notices` rule.
  - Board, notice, admin notification, and board Edge Function changes could therefore bypass feature-contract governance unless they happened to touch another mapped area.
- Root cause:
  - The first contract pass focused on messenger, roles, request-board status, and files/PII, leaving board/notice as a matrix row without path-level enforcement.
- Why it was missed:
  - Existing board category and admin board tests existed, so the audit over-counted test presence as governance coverage.
- Permanent guardrail:
  - Keep `board-and-notices` in `docs/handbook/contract-test-map.json` and assert it from `lib/__tests__/feature-contract-matrix.test.ts`.
  - Board/notice changes must update `admin-web-board-source`, `board-category-contract`, `notification-route`, or the board handbook evidence.
- Related files:
  - `docs/handbook/contract-test-map.json`
  - `docs/handbook/feature-contract-matrix.md`
  - `docs/handbook/backend/board-api-and-notice-model.md`
  - `lib/__tests__/feature-contract-matrix.test.ts`
- Verification:
  - `npm test -- --runInBand lib/__tests__/feature-contract-matrix.test.ts lib/__tests__/admin-web-board-source.test.ts lib/__tests__/board-category-contract.test.ts lib/__tests__/notification-route.test.ts`

## 2026-07-03 | Login And Resident Number Contract Map Gap | high-risk files were tested but not mapped
- Symptom:
  - Login screen/session Edge Functions, saved-password storage, and resident-number admin route helpers had focused tests, but changes to their source files could bypass feature-contract governance.
- Root cause:
  - The contract matrix named login/session and sensitive-data behavior, but `docs/handbook/contract-test-map.json` only mapped lower-level hooks and a narrow resident-number display helper.
- Why it was missed:
  - Existing unit/source tests were counted as enough evidence even though governance is path-triggered; unlisted source files would not require those tests or handbook updates.
- Permanent guardrail:
  - Keep `app/login.tsx`, saved-login storage, session Edge Functions, and resident-number route/helper files in the contract map.
  - `lib/__tests__/feature-contract-matrix.test.ts` must fail if these high-risk files are removed from contract-map coverage.
- Related files:
  - `docs/handbook/contract-test-map.json`
  - `docs/handbook/feature-contract-matrix.md`
  - `lib/__tests__/feature-contract-matrix.test.ts`
- Verification:
  - RED/GREEN `npm test -- --runInBand lib/__tests__/feature-contract-matrix.test.ts`

## 2026-07-03 | Governance Dirty Worktree Coverage | untracked contract evidence was invisible
- Symptom:
  - Local dirty-worktree governance saw modified code files but did not count newly added contract files such as `docs/handbook/contract-test-map.json` or new source tests.
  - This could produce false violations locally or, worse, let local checks give a misleading picture before files are added to git.
- Root cause:
  - `scripts/ci/check-governance.mjs` used `git diff --name-only` for dirty worktrees, which ignores untracked files.
- Why it was missed:
  - The earlier governance verification used syntax checks and `HEAD..HEAD` checks, so it did not exercise newly added untracked evidence files.
- Permanent guardrail:
  - Dirty-worktree governance must merge tracked diff files with `git ls-files --others --exclude-standard`.
  - `lib/__tests__/feature-contract-matrix.test.ts` must assert that untracked-file collection remains in the governance source.
- Related files:
  - `scripts/ci/check-governance.mjs`
  - `lib/__tests__/feature-contract-matrix.test.ts`
- Verification:
  - RED/GREEN `npm test -- --runInBand lib/__tests__/feature-contract-matrix.test.ts`

## 2026-07-03 | Board Category Migration Encoding | copied terminal mojibake into SQL
- Symptom:
  - The first draft of `20260703000001_reassert_board_categories_canonical.sql` used the mojibake strings shown by PowerShell output instead of the actual canonical Korean category names.
- Root cause:
  - I trusted terminal display text from a UTF-8 file read in the wrong console encoding.
- Why it was missed:
  - The migration was created from displayed text before rerunning the canonical SQL test.
- Permanent guardrail:
  - For Korean SQL/category labels, verify against the canonical test or a UTF-8-aware read before finalizing migration text.
  - Do not copy mojibake from terminal output into SQL files.
- Related files:
  - `supabase/migrations/20260703000001_reassert_board_categories_canonical.sql`
  - `scripts/ops/board-category-canonical-sql.test.mjs`
- Verification:
  - RED/GREEN `node --test scripts/ops/board-category-canonical-sql.test.mjs`

## 2026-07-03 | Messenger Action Sheet Contract Gap | shared behavior test did not enforce shared UI
- Symptom:
  - Group chat long-press showed the KakaoTalk-style dark message action sheet, while direct/request-board messenger long-press still showed a separate OS alert menu.
- Root cause:
  - The contract test asserted that `openMessageActions` and copy/delete behavior existed, but it did not require all messenger surfaces to render the same shared action sheet component.
- Why it was missed:
  - I treated "same feature exists" as enough and failed to lock the shared presentation/interaction contract.
- Permanent guardrail:
  - All mobile messenger surfaces must import and render `components/MessengerMessageActionSheet.tsx`.
  - `lib/__tests__/feature-contract-matrix.test.ts` must fail if `openMessageActions` reintroduces a per-screen `const actions = [...]` OS alert menu.
  - Capability differences must be props on the shared action sheet, not separate action menu implementations.
- Related files:
  - `components/MessengerMessageActionSheet.tsx`
  - `app/chat.tsx`
  - `app/group-chat.tsx`
  - `app/request-board-messenger.tsx`
  - `lib/__tests__/feature-contract-matrix.test.ts`
- Verification:
  - RED/GREEN `npm test -- --runInBand lib/__tests__/feature-contract-matrix.test.ts`

## 2026-07-03 | Shared UI Action Drift | common UI and actions were not inventoried as one contract
- Symptom:
  - Messenger action sheets, direct pressables, alerts, modals, clipboard actions, external opens, role visibility, and unread/notification behavior could each be implemented screen-by-screen without a shared primitive contract.
- Root cause:
  - The feature contract matrix focused on business domains, but did not explicitly require a live audit and governance rule for shared UI/action primitives.
- Why it was missed:
  - Passing tests proved behavior existed in selected screens, but did not create an inventory of all places where the same UI/action behavior could drift.
- Permanent guardrail:
  - Keep `scripts/audit/shared-ui-contract-audit.cjs`, `docs/handbook/shared-ui-action-contracts.md`, and `lib/__tests__/shared-ui-action-contracts.test.ts` in sync.
  - Keep `shared-ui-action-primitives` in `docs/handbook/contract-test-map.json`.
  - Treat new raw alert/button/modal/link/copy implementations in governed areas as requiring contract evidence or a documented exception.
  - Messenger attachment bubbles must use `lib/messenger-attachment-actions.ts` / `openMessengerAttachment`; do not call `Linking.openURL` directly from chat surfaces.
  - Messenger clipboard writes must use `lib/messenger-copy-actions.ts` / `copyTextWithFeedback`; do not call `Clipboard.setStringAsync` directly from chat surfaces.
- Related files:
  - `scripts/audit/shared-ui-contract-audit.cjs`
  - `docs/handbook/shared-ui-action-contracts.md`
  - `lib/messenger-attachment-actions.ts`
  - `lib/messenger-copy-actions.ts`
  - `lib/__tests__/shared-ui-action-contracts.test.ts`
  - `docs/handbook/contract-test-map.json`
  - `app/chat.tsx`
  - `app/group-chat.tsx`
- Verification:
  - RED/GREEN `npm test -- --runInBand lib/__tests__/shared-ui-action-contracts.test.ts`

## 2026-07-03 | Messenger Delete Confirmation Drift | delete alerts stayed screen-local
- Symptom:
  - Direct chat, group chat, and request-board messenger used the same long-press sheet but still owned their delete confirmation/failure alerts inside each screen.
  - A future copy tweak or failure handling change could drift across messenger surfaces even though the visible action sheet was shared.
- Root cause:
  - The shared UI/action contract covered copy and attachment helpers but did not require a common delete-confirmation primitive.
- Why it was missed:
  - I stopped after unifying the long-press menu presentation and did not trace the destructive action callback all the way into its confirmation and failure UI.
- Permanent guardrail:
  - Messenger delete actions must use `lib/messenger-delete-actions.ts` / `confirmMessengerDelete`.
  - `lib/__tests__/shared-ui-action-contracts.test.ts` must require the helper in `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx`.
  - Screen code may provide the delete operation and domain-specific error formatter, but not a local `Alert.alert('메시지 삭제', ...)`.
- Related files:
  - `lib/messenger-delete-actions.ts`
  - `app/chat.tsx`
  - `app/group-chat.tsx`
  - `app/request-board-messenger.tsx`
  - `lib/__tests__/shared-ui-action-contracts.test.ts`
  - `docs/handbook/shared-ui-action-contracts.md`
- Verification:
  - RED/GREEN `npm test -- --runInBand lib/__tests__/shared-ui-action-contracts.test.ts`

## 2026-07-03 | Native File Download Drift | screens owned platform save logic
- Symptom:
  - `app/request-board-messenger.tsx` and `app/hanwha-commission.tsx` both owned temporary download paths, Android Storage Access Framework writes, iOS document copies, duplicate filename fallback, and cleanup logic.
  - Platform save behavior could drift between GaramLink attachments and Hanwha commission PDFs.
- Root cause:
  - File download/save was treated as screen implementation detail rather than a shared native action primitive.
- Why it was missed:
  - The first shared UI action pass covered attachment opening and clipboard actions, but did not trace download/save flows that use `FileSystem.downloadAsync`.
- Permanent guardrail:
  - Native download/save flows in those screens must use `lib/native-file-actions.ts` / `downloadRemoteFileToUserStorage`.
  - `lib/__tests__/shared-ui-action-contracts.test.ts` must fail if those screens call `FileSystem.downloadAsync` or `StorageAccessFramework` directly.
- Related files:
  - `lib/native-file-actions.ts`
  - `app/request-board-messenger.tsx`
  - `app/hanwha-commission.tsx`
  - `lib/__tests__/shared-ui-action-contracts.test.ts`
  - `docs/handbook/shared-ui-action-contracts.md`
- Verification:
  - RED/GREEN `npm test -- --runInBand lib/__tests__/shared-ui-action-contracts.test.ts`

## 2026-07-03 | Linkified Text Action Drift | central text component owned copy/open alerts
- Symptom:
  - `components/LinkifiedSelectableText.tsx` rendered shared message/body links but also owned link option alerts, external open failure alerts, and `Clipboard.setStringAsync` link-copy behavior.
  - Messenger screens used shared copy/open helpers, but the central link component could drift independently.
- Root cause:
  - Link rendering was treated as shared, while link actions inside the renderer were still component-local.
- Why it was missed:
  - The first shared UI action pass checked messenger screen copy and attachment actions, but did not inspect the linkified text component's internal Alert/Clipboard calls.
- Permanent guardrail:
  - `LinkifiedSelectableText` must use `lib/linkified-text-actions.ts` / `showLinkifiedTextOptions` and `openLinkExternallyWithFeedback`.
  - Link-copy feedback must route through `copyTextWithFeedback`.
  - `lib/__tests__/shared-ui-action-contracts.test.ts` must fail if `LinkifiedSelectableText` reintroduces direct `Alert.alert` or `Clipboard.setStringAsync`.
- Related files:
  - `components/LinkifiedSelectableText.tsx`
  - `lib/linkified-text-actions.ts`
  - `lib/messenger-copy-actions.ts`
  - `lib/__tests__/shared-ui-action-contracts.test.ts`
  - `docs/handbook/shared-ui-action-contracts.md`
- Verification:
  - RED/GREEN `npm test -- --runInBand lib/__tests__/shared-ui-action-contracts.test.ts`

## 2026-07-03 | Messenger Room Ordering Drift | room lists were not all tied to last message time
- Symptom:
  - Messenger surfaces could drift from KakaoTalk-style ordering: the GaramLink bridge used real message time on initial load, but post-send preview updates did not re-sort the list through a shared rule, and a newly-created empty DM carried a current timestamp.
- Root cause:
  - Room ordering and timestamp derivation lived inside screen code instead of a small shared contract.
- Why it was missed:
  - Existing tests checked message sending, unread counts, and shared action sheets, but did not assert that empty rooms stay below rooms with real messages or that post-send list updates re-sort.
- Permanent guardrail:
  - Use `lib/messenger-room-ordering.ts` for GaramIn-side room list ordering.
  - Message-less conversations must use sort timestamp `0`; do not use conversation creation/update time, presence, unread count, or profile activity as room activity.
  - Keep `lib/__tests__/messenger-room-ordering.test.ts`, `lib/__tests__/internal-chat.test.ts`, and `web/src/lib/admin-chat-targets.test.ts` covering last-message ordering.
- Related files:
  - `lib/messenger-room-ordering.ts`
  - `app/request-board-messenger.tsx`
  - `lib/__tests__/messenger-room-ordering.test.ts`
  - `lib/__tests__/internal-chat.test.ts`
  - `web/src/lib/admin-chat-targets.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/messenger-room-ordering.test.ts lib/__tests__/internal-chat.test.ts --runInBand`
  - GREEN `npx tsx --test web/src/lib/admin-chat-targets.test.ts`

## 2026-07-03 | Board Comment Action Drift | mobile and admin board screens owned duplicate comment menus
- Symptom:
  - `app/board.tsx` and `app/admin-board-manage.tsx` each built the same comment edit/delete/cancel `Alert.alert` action sheet locally.
  - A future label, order, destructive style, or cancel behavior change could land in one board surface only.
- Root cause:
  - Board and notice contracts covered content, categories, attachments, and navigation, but not the shared comment action sheet UI.
- Why it was missed:
  - Previous shared UI/action passes focused on messenger actions, link actions, file downloads, and broad governance while leaving board comment action sheets as small local UI.
- Permanent guardrail:
  - Board comment edit/delete menus must use `lib/board-comment-actions.ts` / `showBoardCommentActions`.
  - `lib/__tests__/board-comment-actions.test.ts` must fail if `app/board.tsx` or `app/admin-board-manage.tsx` reintroduces a local `Alert.alert(...)` action sheet with button definitions.
- Related files:
  - `lib/board-comment-actions.ts`
  - `app/board.tsx`
  - `app/admin-board-manage.tsx`
  - `lib/__tests__/board-comment-actions.test.ts`
  - `docs/handbook/shared-ui-action-contracts.md`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/board-comment-actions.test.ts --runInBand`

## 2026-07-03 | Board Reaction State Drift | board screens owned duplicate reaction math
- Symptom:
  - `app/board.tsx` and `app/admin-board-manage.tsx` each defined the same reaction key type, count normalization helper, and optimistic reaction update helper locally.
  - A future change to toggle-off behavior, switch counts, or total delta semantics could land in one board surface only.
- Root cause:
  - Reaction math was treated as a small screen helper instead of part of the board/notices shared behavior contract.
- Why it was missed:
  - Previous board contract work focused on comment action sheets and content/navigation behavior, not the optimistic reaction state helper directly above the screen code.
- Permanent guardrail:
  - Board reaction count updates must use `lib/board-reaction-state.ts` / `buildBoardReactionCounts` and `applyBoardReactionUpdate`.
  - `lib/__tests__/board-reaction-state.test.ts` must fail if `app/board.tsx` or `app/admin-board-manage.tsx` reintroduces local `buildReactionCounts` or `applyReactionUpdate` helpers.
- Related files:
  - `lib/board-reaction-state.ts`
  - `app/board.tsx`
  - `app/admin-board-manage.tsx`
  - `lib/__tests__/board-reaction-state.test.ts`
  - `docs/handbook/shared-ui-action-contracts.md`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/board-reaction-state.test.ts --runInBand`

## 2026-07-03 | Board Attachment Open Drift | board screens owned duplicate file-open failure handling
- Symptom:
  - `app/board.tsx` and `app/admin-board-manage.tsx` each called `openExternalUrl(item.signedUrl).catch(...)` with the same attachment failure alert locally.
  - A future attachment opener fallback, signed URL missing rule, or failure copy change could land in one board surface only.
- Root cause:
  - Board attachment file open behavior was treated as small inline UI code instead of a shared board action primitive.
- Why it was missed:
  - Earlier file helper work focused on messenger downloads and commission PDFs, not board file attachment opens inside the board modal.
- Permanent guardrail:
  - Board attachment opens must use `lib/board-attachment-actions.ts` / `openBoardAttachment`.
  - `lib/__tests__/board-attachment-actions.test.ts` must fail if `app/board.tsx` or `app/admin-board-manage.tsx` reintroduces direct `openExternalUrl(item.signedUrl).catch(...)`.
- Related files:
  - `lib/board-attachment-actions.ts`
  - `app/board.tsx`
  - `app/admin-board-manage.tsx`
  - `lib/__tests__/board-attachment-actions.test.ts`
  - `docs/handbook/shared-ui-action-contracts.md`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/board-attachment-actions.test.ts --runInBand`

## 2026-07-03 | Board Feedback Alert Drift | repeated board alert copy stayed screen-local
- Symptom:
  - `app/board.tsx` and `app/admin-board-manage.tsx` each owned identical reaction/comment failure alerts and empty-comment validation alerts.
  - A future copy or failure-state change could update one board surface while leaving the other behind.
- Root cause:
  - Board feedback copy was treated as local error handling rather than a shared board UI/action contract.
- Why it was missed:
  - Earlier passes unified action sheets, attachment opens, and reaction math, but did not consolidate the repeated alert copy around those mutations.
- Permanent guardrail:
  - Shared board reaction/comment failure and empty-comment validation alerts must use `lib/board-feedback-alerts.ts` / `showBoardFeedbackAlert`.
  - `lib/__tests__/board-feedback-alerts.test.ts` must fail if `app/board.tsx` or `app/admin-board-manage.tsx` reintroduces duplicated `Alert.alert(...)` calls for those cases.
- Related files:
  - `lib/board-feedback-alerts.ts`
  - `app/board.tsx`
  - `app/admin-board-manage.tsx`
  - `lib/__tests__/board-feedback-alerts.test.ts`
  - `docs/handbook/shared-ui-action-contracts.md`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/board-feedback-alerts.test.ts --runInBand`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/board-feedback-alerts.test.ts --runInBand`

## 2026-07-03 | Shared Function Drift | repeated display and mapping helpers stayed screen-local
- Symptom:
  - Exam management and group chat screens owned repeated formatter, normalizer, display, permission, copy, and reply helper functions locally.
  - Future changes to exam labels, phone candidates, group-chat send permission, or copy/reply text could land in one screen only.
- Root cause:
  - Previous governance focused on UI/action primitives, but did not separately audit function-level business helpers.
- Why it was missed:
  - Small `format*`, `normalize*`, `build*`, `resolve*`, `is*`, and `get*` helpers looked harmless inside screens even when they represented shared rules.
- Permanent guardrail:
  - Exam display helpers must use `lib/exam-display.ts`.
  - Group chat display helpers must use `lib/group-chat-display.ts`.
  - Broad refactors must run `scripts/audit/shared-function-contract-audit.cjs`, and `lib/__tests__/shared-function-contracts.test.ts` must keep the audit, handbook, and governance map connected.
- Related files:
  - `lib/exam-display.ts`
  - `lib/group-chat-display.ts`
  - `scripts/audit/shared-function-contract-audit.cjs`
  - `lib/__tests__/exam-display.test.ts`
  - `lib/__tests__/group-chat-function-contracts.test.ts`
  - `lib/__tests__/shared-function-contracts.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/exam-display.test.ts lib/__tests__/group-chat-function-contracts.test.ts lib/__tests__/shared-function-contracts.test.ts --runInBand`

## 2026-07-04 | FC Workflow Parity Drift | mobile and admin web owned separate status priority
- Symptom:
  - Mobile showed allowance pre-screen requests as `prescreen` even before `allowance_date` existed, while admin web showed the same profile as `missing`.
- Root cause:
  - `lib/fc-workflow.ts` and `web/src/lib/fc-workflow.ts` duplicated workflow status helpers and one implementation changed ordering independently.
- Why it was missed:
  - Existing workflow regression tests covered the derived mobile/admin behavior, but did not compare both modules against each other or prevent web-local reimplementation.
- Permanent guardrail:
  - Admin web workflow helpers must delegate to `lib/fc-workflow-core.ts`.
  - `lib/__tests__/fc-workflow-cross-surface.test.ts` must fail when mobile and web status/step helpers drift or when web reintroduces local workflow business logic.
- Related files:
  - `lib/fc-workflow.ts`
  - `lib/fc-workflow-core.ts`
  - `web/src/lib/fc-workflow.ts`
  - `web/src/lib/shared.ts`
  - `lib/__tests__/fc-workflow-cross-surface.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/fc-workflow-cross-surface.test.ts --runInBand`

## 2026-07-04 | Exam Life/Nonlife Flow Drift | exam screens owned duplicated flow constants
- Symptom:
  - Life and nonlife exam apply/register screens owned separate routes, query keys, realtime channels, fee account text, selection restore helpers, and notification payload builders.
  - A future update to one exam type could silently leave the other type behind.
- Root cause:
  - `app/exam-apply.tsx`, `app/exam-apply2.tsx`, `app/exam-register.tsx`, and `app/exam-register2.tsx` expressed exam-type differences as local constants and helpers instead of one config contract.
- Why it was missed:
  - Existing tests covered individual exam fee and location payload behavior, but did not require both life/nonlife surfaces to call one shared flow contract.
- Permanent guardrail:
  - Exam apply/register screens must derive type-specific routes, query keys, realtime channels, fee accounts, form-state transitions, and notification payloads from `lib/exam-flow-contract.ts`.
  - `lib/__tests__/exam-flow-contract.test.ts` must fail if those screens reintroduce local fee constants, invalid-location messages, notification builders, or hard-coded `exam_type` filters.
- Related files:
  - `lib/exam-flow-contract.ts`
  - `app/exam-apply.tsx`
  - `app/exam-apply2.tsx`
  - `app/exam-register.tsx`
  - `app/exam-register2.tsx`
  - `lib/__tests__/exam-flow-contract.test.ts`
- Verification:
  - RED/GREEN `npx jest --runTestsByPath lib/__tests__/exam-flow-contract.test.ts lib/__tests__/exam-round-location-payload.test.ts lib/__tests__/exam-fees.test.ts --runInBand`

## 2026-07-04 | Admin Web Vercel Build Gap | shared root module refactor was not verified with Next build
- Symptom:
  - Vercel `admin_web` deployment failed on commit `fd0d19f` because Next/Turbopack could not resolve the root shared workflow module from `web/src/lib/fc-workflow.ts`.
- Root cause:
  - The refactor moved workflow rules into a root shared module, but the Vercel project Root Directory is `web`, so files outside `web/` are not reliably available in cloud build context.
- Why it was missed:
  - Verification ran root TypeScript/Jest and governance checks, but did not run the actual `web/npm run build` path that Vercel executes.
- Permanent guardrail:
  - Admin web workflow runtime imports must resolve inside `web/` while the Vercel project Root Directory is `web`.
  - `web/src/lib/fc-workflow-core.ts` and mobile workflow helpers must stay in parity through `lib/__tests__/fc-workflow-cross-surface.test.ts`.
  - Any change touching `web/src/lib/fc-workflow.ts`, `lib/fc-workflow-core.ts`, `web/next.config.ts`, or shared web imports must run `SENTRY_AUTH_TOKEN='' ; cd web ; npm run build` before deploy.
- Related files:
  - `web/next.config.ts`
  - `web/src/lib/fc-workflow.ts`
  - `web/src/lib/fc-workflow-core.ts`
  - `lib/__tests__/fc-workflow-cross-surface.test.ts`
- Verification:
  - Reproduced failed `web/npm run build`, then passed `SENTRY_AUTH_TOKEN='' ; cd web ; npm run build`

## 2026-07-06 | Consent Guide Image Collapse | horizontal FlatList had no explicit height
- Symptom:
  - The allowance consent guide screen loaded local guide JPGs, but the guide images were not visible on Android.
- Root cause:
  - `app/consent.tsx` placed a horizontal `FlatList` inside a vertical `ScrollView` without assigning the list its calculated image height.
  - React Native can measure that combination as zero height even when each rendered item contains a fixed-height image frame.
- Why it was missed:
  - The asset mapping was checked, but there was no source contract requiring the horizontal guide list itself to own the calculated height.
- Permanent guardrail:
  - Horizontal guide lists embedded in scroll views must set an explicit list height from the image frame height.
  - `lib/__tests__/consent-guide-source.test.ts` must fail if the consent guide removes that height contract.
- Related files:
  - `app/consent.tsx`
  - `lib/__tests__/consent-guide-source.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/consent-guide-source.test.ts --runInBand`

## 2026-07-06 | Appointment Submit Alert Freeze | native success Alert was shown before refresh
- Symptom:
  - On Android, submitting a life/nonlife appointment completion date could leave the screen dimmed with no usable dialog after the success popup path.
- Root cause:
  - `app/appointment.tsx` showed a native success `Alert.alert(...)` and then immediately refreshed profile state with `await load()`.
  - React Native Android native dialogs are non-blocking from JS, so the screen could re-render underneath the dialog backdrop and leave the UI in a stuck dimmed state.
- Why it was missed:
  - The submit flow had API and status checks, but no contract preventing native success alerts in date-submit flows that immediately refresh state.
- Permanent guardrail:
  - Appointment submit success feedback must refresh local data first, then use the app-level toast provider instead of a native success Alert.
  - `lib/__tests__/appointment-submit-feedback.test.ts` must fail if `app/appointment.tsx` reintroduces the native `제출 완료` Alert or removes the refresh-before-toast order.
- Related files:
  - `app/appointment.tsx`
  - `lib/__tests__/appointment-submit-feedback.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/appointment-submit-feedback.test.ts --runInBand`

## 2026-07-06 | Admin Reject Reason Modal Drift | reject textareas were duplicated across admin pages
- Symptom:
  - Admin web reject reason modals had separate textarea/button implementations across the main dashboard, appointment page, and documents page.
  - Keyboard behavior such as Enter-to-submit versus Shift+Enter-newline could drift by page.
- Root cause:
  - Each page owned its own `Textarea` and submit button markup instead of a shared reject-reason input component.
- Why it was missed:
  - Existing tests checked status/action behavior, but did not require reject reason input UX to be centralized.
- Permanent guardrail:
  - Admin web reject reason entry must go through `web/src/components/RejectReasonModal.tsx`.
  - `lib/__tests__/admin-web-reject-modal-keyboard.test.ts` must fail if pages reintroduce local reject textareas or if the common modal drops Enter/Shift+Enter handling.
- Related files:
  - `web/src/components/RejectReasonModal.tsx`
  - `web/src/app/dashboard/page.tsx`
  - `web/src/app/dashboard/appointment/page.tsx`
  - `web/src/app/dashboard/docs/page.tsx`
  - `lib/__tests__/admin-web-reject-modal-keyboard.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/admin-web-reject-modal-keyboard.test.ts --runInBand`

## 2026-07-06 | Appointment Approval Label Ambiguity | final completion flags reused approval wording
- Symptom:
  - In the admin web FC detail modal, the appointment tab showed top-level `생명/손해 위촉 완료` chips and per-insurance `승인 완료` buttons at the same visual weight.
  - Operators could not immediately tell whether `생명보험` or `손해보험` had already been approved versus only submitted by the FC.
- Root cause:
  - The final commission completion correction flags and the appointment approval state/action reused the same `완료` wording.
  - Confirmed and unconfirmed rows both rendered an actionable `승인 완료` button, so an unapproved row looked like it might already be approved.
- Why it was missed:
  - Prior fixes focused on preserving the underlying state transitions and direct date-save path, not the operator-facing distinction between final completion flags and approval review state.
- Permanent guardrail:
  - Admin web appointment rows must show a separate `승인 상태:` badge.
  - The approval action must use `승인 처리` before confirmation and `승인 완료됨` after confirmation.
  - The top correction card must be labeled `최종 완료 상태`, not generic `위촉 상태`.
  - `lib/__tests__/admin-web-appointment-approval-clarity.test.ts` must fail if these labels drift.
- Related files:
  - `web/src/app/dashboard/page.tsx`
  - `docs/handbook/admin-web/dashboard-lifecycle.md`
  - `lib/__tests__/admin-web-appointment-approval-clarity.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/admin-web-appointment-approval-clarity.test.ts --runInBand`

## 2026-07-06 | Signup Completion Referral Ordering | password/signup completion could happen before referral link success
- Symptom:
  - A user could enter a recommender during signup, complete full registration, and then see no recommender in the basic info screen or referral page.
- Root cause:
  - `supabase/functions/set-password/index.ts` reset recommender snapshot fields during signup completion and only attempted `apply_referral_link_state` after writing `fc_credentials.password_set_at` and `fc_profiles.signup_completed=true`.
  - If referral resolution/linking failed after those irreversible writes, the account was completed without the recommender snapshot.
- Why it was missed:
  - The flow verified referral code validation and final `apply_referral_link_state` existence, but did not enforce ordering relative to credential creation and signup completion.
- Permanent guardrail:
  - If `referralCode` is present and cannot be resolved, return `referral_invalid` before completing signup.
  - If a referral is resolved, `apply_referral_link_state` must run before writing `password_set_at` or `signup_completed=true`.
  - `lib/__tests__/signup-completion-regression.test.ts` must fail if this ordering drifts.
- Related files:
  - `supabase/functions/set-password/index.ts`
  - `lib/__tests__/signup-completion-regression.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/signup-completion-regression.test.ts --runInBand`

## 2026-07-08 | Admin Web Public Account Deletion | global web-push auto registration leaked onto public routes
- Symptom:
  - The public `/account-deletion` page loaded, but Chrome DevTools showed `POST /api/web-push/subscribe 401` and `[web-push] register failed` when stale client session fields existed without a valid signed staff session.
- Root cause:
  - `WebPushRegistrar` was mounted globally in `web/src/app/layout.tsx` and only checked client-side role/resident fields, not whether the current route was public.
- Why it was missed:
  - The account-deletion verification checked HTTP 200 and route allowlisting, but did not inspect browser console behavior with stale admin cookies/local session state.
- Permanent guardrail:
  - Global browser-push auto-registration must pass through `shouldAutoRegisterWebPush()` and skip every `isAdminWebPublicPath()` route.
- Related files:
  - `web/src/components/WebPushRegistrar.tsx`
  - `web/src/lib/web-push-registration-policy.ts`
  - `web/src/lib/web-push-registration-policy.test.ts`
- Verification:
  - `cd web && npm run lint -- src/components/WebPushRegistrar.tsx src/lib/web-push-registration-policy.ts src/lib/web-push-registration-policy.test.ts`
  - `node --test web/src/lib/admin-web-public-paths.test.ts web/src/lib/web-push-registration-policy.test.ts`
  - `cd web && SENTRY_AUTH_TOKEN='' SENTRY_DISABLE_UPLOAD=1 npm run build`

## 2026-07-13 | Deep-scan artifact validation | PowerShell parser and working-directory assumptions created false signals

- Symptom:
  - `ConvertFrom-Json` reported failures on large valid JSONL rows, and one worker setup created stray `deep_discovery/worker-01` through `worker-06` directories outside the intended `round-03` root.
- Root cause:
  - Console-oriented PowerShell parsing was used as the JSONL authority, and a relative worker path was resolved from the wrong current directory.
- Permanent guardrail:
  - Validate JSONL with a standards-compliant streaming parser and record line count, schema keys, types, and exact-once trace checks; do not treat PowerShell rendering/parser output alone as corruption evidence.
  - Resolve scan artifact directories to absolute paths and assert the expected `round-03/worker-*` parent before creating or writing anything.
  - If a wrong empty artifact directory is created, verify its absolute path and emptiness before removal, then record the correction in the harness.
- Verification:
  - Central validation passed all six round-03 workers with 4,381 work-ledger rows each, 971 tree paths, unchanged input hashes, valid locations, canonical schemas, and zero validation errors.


## 2026-07-06 | Identity Gate Used Stale Public Fields | home unlock trusted masked resident/address remnants
- Symptom:
  - A pre-registration/full-registration account without resident number and address could still land on the full home screen instead of `home-lite`.
- Root cause:
  - `hooks/use-identity-status.ts` treated `resident_id_masked && address` as equivalent to `identity_completed=true`.
  - Stale public profile fields could survive independently of the secure identity completion state.
- Why it was missed:
  - Previous home unlock checks conflated display evidence with trusted identity completion and did not test the stale-field case.
- Permanent guardrail:
  - Full home unlock must trust `fc_profiles.identity_completed === true` only.
  - `resident_id_masked` and `address` are display/supporting fields, not unlock authority.
  - `lib/__tests__/signup-completion-regression.test.ts` must fail if stale public fields can unlock identity completion again.
- Related files:
  - `hooks/use-identity-status.ts`
  - `lib/identity-completion.ts`
  - `lib/__tests__/signup-completion-regression.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/signup-completion-regression.test.ts --runInBand`

## 2026-07-06 | Signup Referral Shadow Eligibility Drift | search allowed manager shadows but final signup rejected them
- Symptom:
  - A user selected a visible recommender during signup, then full registration failed with `추천인 정보를 확인하지 못했습니다. 추천인을 다시 선택해주세요.`
- Root cause:
  - `search-signup-referral` allowed `is_manager_referral_shadow=true` recommender profiles, but `validate-referral-code` and `set-password` only accepted `signup_completed=true` inviter profiles.
  - The signup flow had three referral validation surfaces with different eligibility rules.
- Why it was missed:
  - The previous regression test covered referral-link ordering, but did not assert that search, code validation, and signup completion share the same manager-shadow eligibility contract.
- Permanent guardrail:
  - Signup referral eligibility must allow `signup_completed=true` or `is_manager_referral_shadow=true` consistently across search, validation, and final password setup.
  - `lib/__tests__/signup-completion-regression.test.ts` must fail if `validate-referral-code` or `set-password` stops selecting and honoring `is_manager_referral_shadow`.
- Related files:
  - `supabase/functions/search-signup-referral/index.ts`
  - `supabase/functions/validate-referral-code/index.ts`
  - `supabase/functions/set-password/index.ts`
  - `lib/__tests__/signup-completion-regression.test.ts`
- Verification:
  - RED/GREEN `npx jest lib/__tests__/signup-completion-regression.test.ts --runInBand`

## 2026-07-08 | Designer Bootstrap Missed GaramIn Login Rows | request_board-only account add broke cross-system parity
- Symptom:
  - A new request_board designer could exist in GaramLink, but GaramIn login for the same phone still returned the unregistered-phone path.
- Root cause:
  - The operational add was scoped to request_board `users`/`designers` and workbook data, but GaramIn login requires matching `fc_profiles` and `fc_credentials`.
  - request_board-linked designers are detected through `fc_profiles.affiliation = '<company> 설계매니저'`; without that exact marker and credential row, `login-with-password` cannot issue designer bridge mode.
- Why it was missed:
  - Existing docs stated the storage model, but no test or runbook forced a post-add parity check across the two Supabase projects.
- Permanent guardrail:
  - Designer bootstrap is complete only after request_board and GaramIn/fc-onboarding-app rows both exist.
  - request_board `npm run ops:check-designer-parity -- --phone <phone> --company <company>` must pass after every designer add/change.
  - `supabase/functions/_shared/__tests__/request-board-auth.test.ts` guards the affiliation parser used by GaramIn login/bridge.
- Related files:
  - `supabase/functions/_shared/request-board-auth.ts`
  - `supabase/functions/_shared/__tests__/request-board-auth.test.ts`
  - `docs/handbook/shared/cross-repo-bridge-contract.md`
- Verification:
  - `npm test -- --runInBand supabase/functions/_shared/__tests__/request-board-auth.test.ts`

## 2026-07-16 | Local MCP Configuration Was Tracked | local credentials entered repository history
- Symptom:
  - A machine-local MCP configuration path was present in the tracked tree and reachable history.
- Root cause:
  - The repository ignored other local tool settings but did not ignore the VS Code MCP configuration path.
- Permanent guardrail:
  - Keep local MCP configuration in environment variables or an approved secure store; never commit the machine-local file.
  - Never copy credential values into examples, logs, screenshots, test fixtures, receipts, or assistant knowledge.
  - Verify the exact local path is ignored before configuring an MCP integration.
- Verification:
  - `git check-ignore --no-index -q -- .vscode/mcp.json`
  - Confirm the path is absent from the candidate tree without opening or diffing its contents.

## 2026-07-16 | Narrow Type Checks Hid Full-Gate Failures | local suites passed while repository-wide TypeScript gates stayed red
- Symptom:
  - The web and Edge Function focused tests passed, but the full web TypeScript check and all-function Deno check still reported errors.
- Root cause:
  - Test-only `.ts` imports were not enabled for the web no-emit check, a local `d3-force` declaration was incomplete, and several Edge Function result unions were accessed without an explicit failure discriminant.
  - A password-reset database row was asserted into an application type instead of being decoded at the runtime boundary.
- Permanent guardrail:
  - Run web source-inspection tests from the FC repository root because their fixture paths intentionally resolve from `process.cwd()`.
  - Keep `allowImportingTsExtensions` paired with the web `noEmit` contract; do not exclude tests to make TypeScript green.
  - Narrow result unions with an explicit literal failure check and decode unknown database rows before use; do not use casts, `any`, `@ts-ignore`, or relaxed compiler settings to silence a full-entrypoint error.
- Verification:
  - `cd web && npx tsc --noEmit --pretty false`
  - Run all 46 tracked `supabase/functions/*/index.ts` entrypoints through `deno check --frozen --config supabase/functions/deno.json`.
  - Run web Node source-inspection tests from the repository root.

## 2026-07-16 | Reusable Codex Fallback Pinned A Model | subscription and runtime portability drifted
- Symptom:
  - The paused insurance digest fallback passed an explicit model option even though reusable automation must follow the installed Codex default.
- Root cause:
  - The fallback encoded a one-time model choice inside the operational script, and no test treated model independence as part of the automation contract.
- Why it was missed:
  - Existing ops tests covered payload, token, category, idempotency, and redaction behavior but did not inspect the PowerShell launcher arguments.
- Permanent guardrail:
  - Reusable Codex launchers must omit `-m` and `--model` unless a separately approved contract requires a pin.
  - `scripts/ops/post-insurance-digest.test.mjs` must read the fallback source and fail if either model option is reintroduced.
- Verification:
  - `node --test scripts/ops/post-insurance-digest.test.mjs` (15/15)
  - all `scripts/ops/*.test.mjs` (28/28)

## 2026-07-20 | FC Home Realtime Topic Reuse | React effect 재연결이 이미 구독된 채널에 콜백을 추가
- Symptom:
  - Android 개발 빌드의 FC 홈에서 `cannot add postgres_changes callbacks ... after subscribe()` Render Error가 발생했다.
  - 기존 channel topic에 FC 식별값이 포함되어 개발 오류 화면에도 식별값이 노출됐다.
- Root cause:
  - `@supabase/realtime-js 2.109.0`은 같은 topic의 기존 채널을 재사용한다.
  - React 개발 effect cleanup의 비동기 `removeChannel()`이 끝나기 전에 effect가 다시 실행되면 같은 topic이 이미 구독된 채널을 반환했고, 이어지는 `.on('postgres_changes', ...)`가 예외를 던졌다.
- Permanent guardrail:
  - React effect가 소유하는 Realtime 채널은 각 setup마다 비식별 고유 topic을 생성하고 cleanup은 그 인스턴스만 제거한다.
  - 전화번호, 주민 식별값, 내부 FC id를 channel topic이나 오류 메시지에 포함하지 않는다.
  - `residentId`는 현재 휴대폰 번호일 수 있으므로 공통 진단 마스커는 주민번호와 전화번호 규칙을 모두 적용한다.
  - `lib/__tests__/home-realtime-channel.test.ts`가 topic 고유성과 홈 source의 식별값 없는 topic 사용을 고정한다.
- Related files:
  - `app/index.tsx`
  - `lib/home-realtime-channel.ts`
  - `lib/__tests__/home-realtime-channel.test.ts`
  - `lib/sentry-sanitize.ts`
  - `web/src/lib/sentry-sanitize.ts`

## 2026-07-20 | Admin Login Request Had No Deadline | stalled API looked like a dead button
- Symptom:
  - The admin web login button accepted a click, but a stalled `/api/auth/login` request left the user waiting without a terminal result.
- Root cause:
  - Neither the browser proxy request nor the server-side `login-with-password` Edge Function invocation had a bounded timeout.
  - A cold or unhealthy local Next.js server could therefore make a wired, enabled button appear inert.
- Permanent guardrail:
  - Keep the Supabase login invocation timeout shorter than the browser proxy timeout so the API normally returns a structured `504` first.
  - Treat browser `TimeoutError` and Supabase-wrapped `AbortError` as expected transport failures with a retryable Korean message.
  - Never log the submitted phone number, password, token, or raw upstream body while diagnosing login transport failures.
- Related files:
  - `web/src/app/auth/page.tsx`
  - `web/src/app/api/auth/login/route.ts`
  - `web/src/lib/admin-web-login-timeout.ts`
- Verification:
  - `node --test web/src/lib/admin-web-login-timeout.test.ts web/src/lib/admin-web-auth-login-proxy-source.test.ts`

## 2026-07-20 | React Native JSX whitespace | same-line closing tags emitted a raw text child
- Symptom:
  - Android Fabric reported `Text strings must be rendered within a <Text> component` while rendering the Request Board customer list.
- Root cause:
  - `app/request-board-create.tsx` placed `</View>` and `</Pressable>` on the same line with spaces between them. Babel preserved those spaces as a string child of `Pressable`.
  - Shared icon/value slots also accepted broad `ReactNode` values even though they render directly below native container hosts, allowing a future number or string to reproduce the same failure.
- Permanent guardrail:
  - Put adjacent closing JSX tags on separate lines in React Native container trees.
  - Type element-only slots as `ReactElement`, not `ReactNode`.
  - Keep `lib/__tests__/react-native-text-child-contract.test.ts` scanning all mobile TSX for emitted same-line whitespace children and inferred string/number children below native containers.
- Related files:
  - `app/request-board-create.tsx`
  - `app/dashboard.tsx`
  - `components/Button.tsx`
  - `components/FormInput.tsx`
  - `lib/__tests__/react-native-text-child-contract.test.ts`
## 2026-07-21 | Schema rollout | schema snapshot에만 manager token 역할을 추가하고 migration을 누락함

- Symptom:
  - Android 설계 매니저 로그인 직후 `device-token-register`가 500을 반환하고 네이티브 알림 토큰이 한 건도 등록되지 않았다.
- Root cause:
  - `supabase/schema.sql`과 앱/Edge 계약은 `device_tokens.role='manager'`를 사용했지만, 운영 constraint를 변경하는 migration이 없어서 원격 DB는 `admin`, `fc`만 허용했다.
- Permanent guardrail:
  - schema snapshot의 기존 constraint를 넓힐 때는 동일 변경을 소유하는 additive migration과 exact-role source contract를 함께 추가한다.
  - 기기 토큰 등록 E2E에서는 함수 HTTP 성공뿐 아니라 역할별 토큰 row count와 최신 등록 시각을 개인정보 없이 확인한다.
- Verification:
  - `lib/__tests__/priority-security-hardening.test.ts`
  - `supabase/migrations/20260721052837_allow_manager_device_tokens.sql`

## 2026-07-21 | Mobile mutation feedback | successful quick-card rejection had no confirmation

- Symptom:
  - A designer rejection completed successfully from the Request Board home card, but the modal simply closed and refreshed, leaving the user unsure whether the action succeeded.
- Root cause:
  - The home quick-card success branch reset local state and fetched fresh data without showing the success alert already used by the detailed review screen.
- Permanent guardrail:
  - Every user-triggered Request Board state transition must expose an explicit success acknowledgement before background refresh work.
  - Keep source-contract coverage for both failure and success feedback on quick-card mutation paths.
- Verification:
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`

## 2026-07-22 | Cross-repo timeout drift | notification fanout outlived the mobile create deadline

- Symptom:
  - GaramIn reported that GaramLink was delayed while creating a design request, even though the server could already have committed the request.
- Root cause:
  - The mobile Request Board wrapper applied one eight-second timeout to every call.
  - The server had been changed to await bounded web, native, and AlimTalk notification fanout before returning from `POST /api/requests`, but the mobile write timeout contract was not updated with it.
- Permanent guardrail:
  - Keep a short default timeout for ordinary mobile calls and an explicit longer bound for response-before-return notification writes.
  - Never automatically retry request creation after a transport timeout; the primary write may already be durable and an automatic retry can duplicate it.
  - Any server change that moves notification work before the response must update and test every calling client's timeout budget in the same increment.
- Verification:
  - `lib/__tests__/request-board-api-contract.test.ts`

## 2026-07-22 | Mobile request workflow performance | optional work blocked first render

- Symptom:
  - GaramIn design-request home, list, and create pages felt slow even when the primary data needed for the first screen was already available.
- Root cause:
  - Mount, focus, and app-active lifecycle events could start duplicate home refreshes.
  - The list waited for per-rejected-assignment detail hydration, and its 100-row response requested attachments whose signed URLs were not used by the mobile list.
  - The create screen kept a full-screen loader until customer, product, designer, and FC-code catalogs all completed.
- Permanent guardrail:
  - Coalesce passive lifecycle refreshes, render primary rows before optional enrichment, use an explicit attachment-free summary projection for summary clients, and reveal each workflow step as soon as its own required data is ready.
  - Keep forced refresh for user intent and successful mutations, sequence-guard background enrichment, and preserve the server's attachment-inclusive default for existing clients.
- Verification:
  - `lib/__tests__/request-board-refresh-policy.test.ts`
  - `lib/__tests__/request-board-mobile-ui-contract.test.ts`
  - `lib/__tests__/request-board-api-contract.test.ts`

## 2026-07-22 | Exam registration mobile UX | resized viewport did not reveal focused inputs

- Symptom:
  - Admin/general-affairs users could focus lower exam-registration inputs, but Android did not scroll them above the opened keyboard. The location-add action also stayed pale orange while enabled, and older rounds appeared before newer ones.
- Root cause:
  - The Fabric-safe Android path correctly avoided the shared keyboard-aware wrapper but had no replacement focused-input scroll after `adjustResize`.
  - Location-add reused a secondary pale style without tying its disabled state to trimmed input validity.
  - Both registration screens duplicated an ascending exam-date sort.
- Permanent guardrail:
  - Keep one plain Android `ScrollView`, pair it with viewport avoidance and keyboard-after-show focus scrolling, make action color follow real validity, and centralize shared newest-first ordering for both exam types.
- Verification:
  - `lib/__tests__/exam-flow-contract.test.ts`

## 2026-07-21 | UI 분류 정렬 | 본부명을 문자열로 정렬해 10본부가 1본부 앞에 배치됨

- 증상: 고정 빠른 분류를 추가한 첫 테스트에서 `10본부`가 `1본부`보다
  먼저 표시됐습니다.
- 원인: 숫자가 포함된 본부명을 일반 문자열 비교로 정렬했습니다.
- 영구 방지책: `N본부` 접두사의 숫자를 추출해 수치 정렬하고, 1·2·6·8·9·10
  순서를 회귀 테스트로 고정합니다.
- 검증: `web/src/lib/exam-applicant-list-display.test.ts`

## 2026-07-21 | Vercel alias drift | 최신 Production 배포가 운영 주소에 반영되지 않음

- Symptom:
  - 최신 관리자 웹 배포는 `READY`였지만 운영자가 사용하는 `adminweb-red.vercel.app`에서는 로그인 버튼이 이전처럼 반응하지 않는 것으로 보였다.
- Root cause:
  - CLI Production 배포가 Vercel 생성 alias만 갱신했고, 별도 운영 alias는 2026-07-08 배포에 남아 있었다.
- Permanent guardrail:
  - 관리자 웹 배포 완료 조건에는 배포 자체의 `READY`뿐 아니라 실제 운영자 hostname이 같은 deployment ID로 해석되는지 확인하는 단계를 포함한다.
  - 운영 alias가 별도라면 배포 직후 명시적으로 재연결하고, 운영 hostname에서 핵심 화면의 현재 변경 문구를 aggregate-only로 확인한다.
- Verification:
  - Vercel deployment lookup for generated Production hostname and `adminweb-red.vercel.app`.

## 2026-07-21 | Browser QA privacy | 광범위 대시보드 DOM 출력에 운영 행 값이 포함됨

- Symptom:
  - 운영 alias 재연결 뒤 대시보드 진입을 확인하는 과정에서 전체 DOM snapshot 1회가 ephemeral tool output에 출력됐고, 11자리 숫자 패턴 60개가 포함됐다.
- Root cause:
  - 인증 성공 여부만 확인하면 되는 단계에서 URL·heading·필수 label 같은 제한된 신호 대신 broad snapshot을 출력했다.
- Permanent guardrail:
  - 운영 데이터 화면에서는 DOM snapshot 원문을 출력하지 않는다. snapshot은 메모리에서만 판정하고 URL, boolean, count, opaque hash만 보고한다.
  - 이번 ephemeral observation의 SHA-256은 `cb9504f911b9bd3af0aaf62e84d7bd6e93c8c6150b671ab89362bc8b071529b5`이며, 영구 파일·하네스·로그 사본은 생성하지 않았다.
- Verification:
  - 후속 시험 신청자 확인은 네 개 기대 label의 존재 boolean만 반환했다.

## 2026-07-22 | Browser QA privacy repeat | 인증 입력 DOM snapshot이 필드 내용을 노출함

- Symptom:
  - 로그인 버튼의 활성 상태만 확인하면 되는 조사에서 인증 화면 전체 DOM snapshot을 출력해 채워진 인증 필드 내용이 ephemeral tool output에 포함됐다.
- Root cause:
  - 이전 guardrail을 운영 데이터 테이블에만 좁게 적용하고, 로그인·비밀번호 재설정·OTP 화면도 동일한 민감 화면으로 분류하지 않았다.
- Permanent guardrail:
  - 인증 화면에서는 전체 DOM snapshot, visible DOM, screenshot을 출력하지 않는다. locator가 필요하면 접근성 이름만 포함된 새 빈 세션을 사용하고, 이미 값이 채워진 화면에서는 `count`, `isEnabled`, `disabled`, `aria-*`, URL 같은 제한된 속성만 읽는다.
  - 도구 출력에 포함된 인증 필드 내용은 복사·기록·재사용하지 않으며, 파일·로그·Sentry·보고서에 남기지 않는다.
- Verification:
  - 후속 확인은 로그인 버튼의 count/enabled/disabled 속성과 콘솔 오류 개수만 반환했다.

## 2026-07-22 | RPC rollout order | exam caller가 운영 migration보다 먼저 활성화됨

- Symptom:
  - 관리자 웹 시험 일정 등록이 반복적으로 `PGRST202`로 실패했다.
- Root cause:
  - RPC-required admin web artifact가 Production에 활성화됐지만 `20260712000002_atomic_exam_round_save.sql`은 FC 운영 migration history에 없었다.
- Permanent guardrail:
  - exam RPC caller 배포 전 `to_regprocedure` 존재, service-role execute grant, anon/authenticated revoke, atomic behavior를 운영에서 확인하고 그 증거가 없으면 기능을 활성화하지 않는다.
  - 누락 시 다중 쿼리 fallback을 추가하지 않고 additive migration을 먼저 적용한다.
- Verification:
  - Vercel error group `PGRST202`, Supabase migration list, read-only function existence query.

## 2026-07-22 | Realtime effect reconnect | 구독 중인 동일 topic을 재사용함

- Symptom:
  - 시험 신청 화면이 개발 모드 effect 재연결 중 `postgres_changes` callback을 `subscribe()` 이후 추가했다는 Render Error로 중단됐다.
- Root cause:
  - 현재 Realtime client는 같은 topic의 채널을 재사용한다. effect cleanup의 비동기 leave가 끝나기 전에 같은 개인 식별 기반 topic으로 재실행되어 이미 joining/joined 상태인 채널에 `.on()`을 호출했다.
- Permanent guardrail:
  - effect 실행마다 개인 식별값이 없는 고유한 channel topic을 생성하고, 모든 `.on()`을 `.subscribe()` 전에 등록하며, cleanup에서는 그 실행이 만든 정확한 채널만 제거한다.
- Verification:
  - `lib/__tests__/exam-flow-contract.test.ts`

## 2026-07-22 | Applicant detail classification | 선택 row만 먼저 조회해 재신청 이력을 잃음

- Symptom:
  - 신청자 상세 API가 선택된 registration 하나만 분류기에 전달하면 이전 동일 과목 신청이 있어도 `신규신청`으로 표시될 수 있었다.
- Root cause:
  - 목록 최적화를 상세 조회에 그대로 적용하면서 `신규신청/재신청`이 과거 신청 이력을 필요로 하는 파생 상태라는 점을 query scope보다 뒤에서 고려했다.
- Permanent guardrail:
  - 선택 registration을 먼저 찾고 동일 신청자의 해당 시점까지 이력을 조회해 분류한 다음, enrichment 직전에 선택 ID로 좁힌다.
  - 상세 API source contract는 ID lookup, resident history lookup, post-classification ID filter를 함께 고정한다.
- Verification:
  - `web/src/lib/exam-applicant-detail-source.test.ts`

## 2026-07-22 | React mapped header keys | helper가 반환한 `<th>`에 stable key가 없음

- Symptom:
  - 시험 신청자 테이블 렌더링에서 `Each child in a list should have a unique key prop` 경고가 발생했다.
- Root cause:
  - `EXAM_APPLICANT_EXPORT_COLUMNS.map()`이 호출하는 `renderHeader`가 fragment가 아닌 `<Table.Th>`를 직접 반환하면서도 key를 소유하지 않았다.
- Permanent guardrail:
  - map callback helper가 최상위 React element를 반환하면 helper의 안정적인 식별자(`field`)를 그 element의 `key`로 사용한다.
  - applicant source contract에서 일반 헤더와 action 헤더 모두 같은 keyed root를 사용하도록 고정한다.
- Verification:
  - `web/src/lib/exam-applicant-detail-source.test.ts`

## 2026-07-23 | Admin direct-chat push | fire-and-forget가 저장 성공 뒤 알림 실패를 숨김

- Symptom:
  - 관리자 웹 채팅에는 메시지가 정상 저장됐지만 가람in 휴대폰 알림이 뜨지 않았고, 관리자 화면에도 전달 실패 신호가 없었다.
- Root cause:
  - 메시지 insert 뒤 `/api/fc-notify`를 `void`로 실행해 브라우저 lifecycle 취소 가능성을 남겼고, HTTP/downstream 응답의 `logged`와 `sent`를 검증하지 않았다.
  - 알림 성공을 메시지 저장 성공과 분리하면서도 post-commit 전달 확인 계약과 부분 실패 UI를 만들지 않았다.
- Permanent guardrail:
  - 사용자 메시지 저장 뒤 푸시 fanout은 post-commit으로 완료를 확인하되, 실패해도 저장된 메시지를 rollback하거나 입력창에 복원하지 않는다.
  - 브라우저 알림 요청은 이탈 내성을 갖고, HTTP 2xx뿐 아니라 프록시/downstream 성공, notification row 저장, 최소 1개 기기 대상을 검증한다.
  - 진단에는 고정 reason/status와 aggregate count만 남기고 수신자, 본문, 토큰, raw provider response를 기록하지 않는다.
- Verification:
  - `lib/__tests__/admin-web-chat-source.test.ts`
  - `web/src/lib/admin-chat-notification-result.test.ts`

## 2026-07-23 | Notification success was inferred from transport success and subject identity was reused as recipient identity

- Symptom:
  - Saved messages and workflow updates appeared successful while inbox persistence, device targeting, or provider acceptance had failed.
  - FC-to-admin workflow events could target the FC phone instead of the shared admin audience, and resolved group-chat managers could be filtered out afterward.
- Root cause:
  - Callers and fanout services used HTTP success or token count as delivery truth and did not preserve separate `logged`, attempted, accepted, and rejected states.
  - Event-subject identifiers and notification-recipient identifiers were treated as interchangeable.
- Permanent guardrail:
  - Confirmation-dependent sends must require durable inbox success plus at least one accepted provider ticket; zero target and provider rejection are explicit outcomes.
  - A primary write is never rolled back or presented as unsaved because a post-commit notification failed; the UI reports partial delivery instead.
  - Non-message FC workflow events use shared-admin scope (`target_id=null`); only direct message category may use a concrete staff target.
  - Provider bodies, tickets, tokens, recipient identifiers, and message bodies are never logged or returned as diagnostics.
- Verification:
  - Pure provider/delivery classifiers, mobile/web source contracts, group-chat membership contracts, Edge Deno checks, and diagnostic privacy tests.

## 2026-07-23 | Contract tests depended on one working directory and stale success payloads

- Symptom:
  - The full Node gate failed only when launched from the repository root, while the same source test passed from `web`.
  - The Board Edge smoke test rejected a valid new response because its fixture and exact payload assertion still modeled the older fire-and-forget notification contract.
- Root cause:
  - A source test resolved files from `process.cwd()` instead of its own module location.
  - The loopback notification fixture returned transport-only success and the smoke assertion did not cover the new saved-versus-delivered fields.
- Permanent guardrail:
  - Source tests resolve fixtures relative to `import.meta.url` and must pass from the canonical aggregate gate working directory.
  - Edge smoke fixtures model confirmed provider delivery, and response assertions explicitly cover `saved`, bounded notification aggregates, and `notificationWarning`.
- Verification:
  - Aggregate Node test gate from the repository root and both Board Edge loopback smoke tests.

## 2026-07-23 | Push registration was duplicated and a failed attempt suppressed later retries

- Symptom:
  - A signed-in design manager could keep using the app while the server had no usable manager-role device token, so Request Board notifications never reached the handset.
- Root cause:
  - Push registration was owned by both the home screen and the global session provider, and the attempt key was treated as complete before registration success was known.
- Permanent guardrail:
  - The global session provider is the only push-registration owner. It derives designer sessions as `manager`, records the attempt key only after success or a terminal failure, and uses bounded retries plus an app-foreground retry after exhaustion.
  - Concrete FC notification token queries remain role-bound. Only concrete `request_board_*` recipients may include both `fc` and `manager` token roles, followed by the manager-delivery policy and exact resident-id scope.
- Verification:
  - Push registration source contracts, Request Board session contracts, FC notification role-policy tests, and the Edge Function Deno check.

## 2026-07-23 | A stale screen identifier was trusted as the notification recipient

- Symptom:
  - A successful admin workflow mutation could save correctly but notify an obsolete phone value, leaving the current FC device without an inbox or push event.
- Root cause:
  - The mobile caller supplied both the stable FC id and a mutable phone field, and the privileged handler reused the client-provided phone as delivery authority.
- Permanent guardrail:
  - Privileged workflow callers send only the stable FC id. Immediately before each notification, the server resolves the latest completed FC profile and validates the canonical phone; lookup or delivery failure becomes a fixed post-commit warning and never falls back to another number.
  - Boolean workflow notifications cover both transitions (`false -> true` and `true -> false`) instead of assuming that only approval is meaningful.
- Verification:
  - Canonical-recipient source tests, Edge Deno checks, workflow transition tests, and admin/mobile type and lint gates.

## 2026-07-23 | Post-commit attachment work was presented as a failed primary mutation

- Symptom:
  - A saved board post or design request could show a full failure when attachment upload or delivery failed, encouraging the operator to submit the primary mutation again.
- Root cause:
  - Durable writes and external attachment side effects shared one success/failure boundary, and retry actions repeated create/update instead of retrying only the failed attachment stage.
- Permanent guardrail:
  - Preserve the committed entity id, return a partial-delivery warning, and make retries address only failed attachment work. A post-commit failure must never erase the saved result or call the primary mutation again.
- Verification:
  - Mobile/web board source contracts, Request Board attachment delivery tests, TypeScript, lint, and governance checks.

## 2026-07-23 | A privileged Edge mutation trusted a claimed actor identifier

- Symptom:
  - A caller with the public application credential could claim a known administrator phone in the request body and reach service-role mutations without proving the corresponding signed app session.
- Root cause:
  - `admin-action` checked whether the claimed phone existed and was active, but did not bind that identity to a verified session token. Native session credentials were also eligible for plaintext AsyncStorage persistence.
- Permanent guardrail:
  - Service-role Edge mutations authorize only an exact service-role bearer or a verified signed app session whose canonical active database actor supplies role, phone, and staff type. Body actor fields are never an authorization source.
  - Mobile callers use one authenticated invocation helper and fail locally if the signed session token is unavailable. Native auth and bridge tokens use secure storage first, with one-time migration and removal of legacy plaintext values.
- Verification:
  - Edge authorization policy tests, canonical actor tests, secure token-storage migration tests, Deno checks, mobile TypeScript/lint, and priority security gates.

## 2026-07-23 | Direct-message and bridged-inbox checks covered only one side of each role mapping

- Symptom:
  - A stale FC device token could receive an admin direct message after the FC profile was no longer completed.
  - A manager-backed Request Board designer could receive push delivery but see no matching inbox row or unread badge because the row used the FC wire role while the app session used the admin role.
- Root cause:
  - Active-recipient validation covered FC-to-staff messages but not the reverse direction.
  - The bridge merge recognized only `requestBoardRole='fc'`, even though designer sessions use the same personal FC-role notification rows.
- Permanent guardrail:
  - Both direct-message directions validate the canonical active recipient before token lookup.
  - Any personal admin-role Request Board bridge session may merge only its exact resident-id FC-role rows; designer sessions then restrict the visible/countable set to `request_board_*` categories and exclude notices.
- Verification:
  - FC notification auth-policy/source tests, mobile unread planning tests, Deno checks, and notification/request-board screen lint.

## 2026-07-23 | Development type checks did not prove the Turbopack filesystem root

- Symptom:
  - Admin-web TypeScript passed, but the production build could not resolve shared notification code outside the nested `web` directory.
  - A local production build later passed while the Vercel Git build still failed because the project Root Directory upload excluded the repository-parent module entirely.
- Root cause:
  - The TypeScript alias covered the repository parent while `turbopack.root` stopped at `web`; production compilation refuses files outside that root.
  - Turbopack filesystem access and Vercel deployment upload scope were treated as the same boundary even though changing the compiler root cannot upload an excluded file.
- Permanent guardrail:
  - Runtime imports for a nested Vercel project must resolve to files inside its configured Root Directory unless the remote project explicitly includes outside-root source.
  - When Edge Functions and Vercel need the same small pure contract, keep deployment-local implementations with focused parity tests instead of adding a runtime import across deployment roots.
  - Production build remains a required release gate; lint and TypeScript alone are insufficient.
- Verification:
  - `lib/__tests__/agent-room-build-tracing.test.ts`
  - `web/src/lib/expo-push-delivery.test.ts`
  - Sentry-disabled `web` production build

## 2026-07-23 | A new Edge failure diagnostic bypassed the closed diagnostic contract

- Symptom:
  - The full Jest gate rejected a two-argument `console.warn` added to the Expo push failure path.
- Root cause:
  - The change used a locally safe-looking aggregate reason but bypassed the repository's exact single-literal console allowlist and closed diagnostic schema.
- Permanent guardrail:
  - Variable Edge diagnostics must use `reportEdgeDiagnostic` with an enumerated event/reason pair; raw or locally structured console arguments remain forbidden.
- Verification:
  - `diagnostic-console-governance.test.ts`
  - `diagnostic-privacy-source.test.ts`
  - Deno check for `fc-notify` and the shared diagnostic helper
