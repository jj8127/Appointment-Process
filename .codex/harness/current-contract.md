# Current Contract: Increment 35 - Request Board Designer Notification Scope

Status: completed locally on 2026-06-05

## Goal

Stop GaramIn request-board designers from receiving non-request-board mobile notifications such as board, notice, exam, and FC-onboarding broadcast alerts.

## Scope

- Register request-board designer Expo push tokens with `device_tokens.role='manager'` instead of `fc`.
- Add a shared notification delivery policy that allows manager mobile tokens only for `request_board_*` categories and direct internal chat (`category='message'` with a concrete target id).
- Apply the policy in `fc-notify` token fanout.
- Make request-board designer unread counts use live request_board unread only.
- Update notification runbook and mistake ledger.

## Explicit Non-Scope

- Do not change FC/admin notification delivery.
- Do not change request_board API behavior or message creation.
- Do not change board, notice, or exam content creation flows.
- Do not touch referral graph work.

## Acceptance Criteria

- Request-board designer tokens are registered as `manager`.
- Manager mobile tokens are filtered out of board, notice, exam, and FC-onboarding broadcast push payloads.
- Manager mobile tokens still receive request-board lifecycle/message notifications and direct internal chat notifications.
- Request-board designer unread badge excludes fc-onboarding unread.
- Focused notification tests pass.

## Verification Plan

- `npm test -- --runTestsByPath supabase/functions/_shared/__tests__/notification-delivery-policy.test.ts lib/__tests__/push-registration.test.ts --runInBand`
- `npm test -- --runTestsByPath lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand`
- Targeted lint/type checks for touched notification/session files.
- `npm test -- --runInBand`
- `npx tsc --noEmit --pretty false`
- `git diff --check`

---

# Current Contract: Increment 34 - Orange CTA Black Rendering Guard

Status: completed locally on 2026-06-04

## Goal

Stop the repeatedly reported Android behavior where GaramIn orange CTA/card surfaces render as black.

## Scope

- Use plain `View` surfaces with explicit orange backgrounds for the large FC home next-step card and messenger CTA cards.
- Apply the same orange-surface guard to legacy life/nonlife exam submit buttons and the referral-code card.
- Keep the small non-CTA guide icon gradients where they are white/light decorative surfaces.
- Keep existing exam application, referral, board, and notification behavior unchanged.

## Explicit Non-Scope

- Do not change Toss/proxy exam runtime status or revive deferred payment work.
- Do not change board category data or referral graph logic.
- Do not perform broad style refactors beyond the repeated black-surface pattern.

## Acceptance Criteria

- Home `다음 단계` and `통합 메신저 열기` cards no longer depend on orange `LinearGradient`.
- Exam submit buttons and referral-code card no longer depend on orange `LinearGradient`.
- Targeted mobile lint passes for touched mobile surfaces.

## Verification Plan

- Passed: `npm run lint -- app/index.tsx app/exam-apply.tsx app/exam-apply2.tsx app/referral.tsx app/board.tsx app/admin-board-manage.tsx`.
- Passed: `cd web; npm run lint -- src/app/dashboard/board/page.tsx`.
- Passed: `cd web; SENTRY_AUTH_TOKEN='' npm run build`.
- Passed: `node scripts\ci\check-governance.mjs`.

---

# Current Contract: Increment 33 - Board Garam Pick Category

Status: completed locally on 2026-06-04

## Goal

Add `가람 Pick` as a selectable board post category across GaramIn app and admin surfaces.

## Scope

- Add schema seed and forward migration for `board_categories` row `name='가람 Pick'`, `slug='garam-pick'`.
- Let existing category-list/create/update board APIs continue to drive category selection dynamically.
- Add distinct badge theme for `가람 Pick` in mobile board, mobile admin board management, and admin web board.
- Update board requirements/runbook docs.

## Explicit Non-Scope

- Do not change board RLS, permissions, authorship, comments, reactions, attachments, or notifications.
- Do not change `공지`/legacy notice preview behavior.
- Do not add hard-coded category IDs in clients.

## Acceptance Criteria

- New installs and migrated DBs have an active `가람 Pick` category.
- Admin web board category select can show `가람 Pick` via existing category fetch.
- Mobile board/admin board badges for `가람 Pick` are visually distinct and not gray fallback.

## Verification Plan

- Passed: focused root/mobile lint for touched board/home/exam/referral app files.
- Passed: admin web board lint.
- Passed: admin web production build with `SENTRY_AUTH_TOKEN=''`.
- Passed: governance check.

---

# Current Contract: Increment 32 - Dawichok URL Sent Signal And Referral Graph Completion Legend

Status: completed locally on 2026-06-04

## Goal

Add an explicit secretary/admin signal that the Dawichok URL was sent, show FCs the Kakao-delivered URL instruction only after that signal exists, and make the admin referral graph easier to read by coloring all-commission-complete FCs and clarifying the legend.

## Scope

- Add `dawichok_url_sent_at` and `dawichok_url_sent_by` to the FC profile contract.
- Add mobile admin, web admin, and Edge Function actions for `markDawichokUrlSent`.
- Notify the FC through the existing in-app/push path with `다위촉 URL 안내`.
- Show `카카오톡으로 전송된 다위촉 URL을 진행해 주세요.` on the FC Dawichok page only when the sent signal exists.
- Clear Dawichok URL sent state on document-workflow downgrade/reset paths.
- Add referral graph `allCommissionsCompleted` node state from life/nonlife completion or appointment dates.
- Render all-commission-complete graph nodes in a distinct green color and show the same state in the drawer.
- Make the graph summary and legend describe visible completion count and actual color/ring semantics.

## Explicit Non-Scope

- Do not reactivate Toss Payments virtual-account runtime or proxy exam applications.
- Do not add headquarters-scoped secretary filtering.
- Do not remove or alter the Dawichok PDF upload legacy path in this increment.
- Do not add real Kakao template provider integration; this increment uses the existing notification path and stores the sent signal.
- Do not change referral graph physics or edge construction.

## Acceptance Criteria

- Secretary/admin users can mark that the Dawichok URL was sent from mobile admin and web admin surfaces.
- The sent timestamp is visible in FC detail/admin Dawichok contexts.
- FC Dawichok guidance uses the exact Kakao URL instruction only after `dawichok_url_sent_at` exists.
- Downgrading back to docs-pending clears stale Dawichok URL sent state.
- All-commission-complete graph nodes are visually distinguishable by color only.
- The graph legend explains green completed nodes, orange referral-code nodes, yellow highlight/legacy-outline markers, and gray inactive/no-code nodes in operator-friendly terms.
- Completion count reflects currently visible nodes after search/filter, not the full graph.

## Verification Plan

- Passed: focused node tests for referral graph layout and simulation.
- Passed: `npm test -- --runInBand`.
- Passed: `npm run lint`.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; SENTRY_AUTH_TOKEN='' npm run build`.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

---

# Current Contract: Increment 31 - GaramIn Operations UX And Workflow Fixes

Status: completed locally on 2026-06-03

## Goal

Implement the new nine-item GaramIn improvement set with parallel workers while keeping deferred Toss virtual-account/proxy exam application work and headquarters-scoped secretary access out of this increment.

## Scope

- Fix mobile admin life/nonlife exam round registration UX so `시험 추가` opens the lower create form and `수정` opens the lower edit form.
- Change signup user-facing `현재 위촉 상태` to multi-select `자격증 보유 현황`, add `license_statuses`, and keep existing commission-completion fields compatible.
- Rename user-facing `보증 보험 동의` copy to `보증 보험 동의` while keeping internal `allowance_*` schema/status names.
- Require and visually emphasize the FC guarantee-insurance consent date; prevent admin approval/prescreen transitions without a valid date.
- Allow secretary/admin document approval or rejection for requested document rows even when no file was uploaded, and auto-advance based on all requested docs being approved.
- Add stage-level YouTube placeholder controls beside the next-step action and keep existing guide video actions.
- Harden orange CTA/card surfaces against black fallback rendering.
- Show full resident registration numbers to manager/headquarters read-only sessions through trusted resident-number paths without masked fallback.

## Explicit Non-Scope

- Do not reactivate Toss Payments virtual-account runtime, proxy exam applications, or deleted/deferred exam payment functions.
- Do not add headquarters-scoped secretary filtering; all secretary/admin visibility remains broad unless already enforced elsewhere by existing code.
- Do not rename internal `allowance_*` or workflow status values.
- Do not weaken FC self-scope for resident-number reads.

## Acceptance Criteria

- Life and nonlife mobile exam schedule screens visibly scroll/focus to the form after `시험 추가` and row `수정`.
- Signup supports `제3 보험`, `생명 보험`, `손해 보험`, `없음` with exclusive `없음` behavior and persists normalized `license_statuses`.
- No user-facing mobile/web text in touched paths still uses the legacy allowance-consent wording; internal identifiers may remain.
- FC and admin paths reject guarantee-insurance approval/prescreen without a valid date.
- A requested no-file document can be manually approved/rejected by an admin, and an FC can advance when every requested doc is approved.
- Home next-step UI has a YouTube placeholder button and orange CTAs retain explicit non-black fallback backgrounds.
- Manager expanded FC details show full resident number or an explicit failure/missing state, never the masked value.
- Admin/web status changes cannot force `docs-approved` unless every requested doc row is approved.
- Admin/web guarantee-insurance date and approval paths require an issued `temp_id`, matching the FC path sequencing.

## Verification Plan

- Passed: focused tests for license selection, workflow/doc progression, and commission contracts.
- Passed: targeted mobile/web lint for touched files.
- Passed: `npm test -- --runInBand`.
- Passed: `npm run lint`.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; SENTRY_AUTH_TOKEN='' npm run build` with existing dependency/data-age warnings only.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

---

# Current Contract: Increment 30 - Mobile Exam Runtime Rollback

Status: completed locally on 2026-06-03

## Goal

Rollback the MOBILE EXAM / Toss runtime activation while preserving the per-examinee Toss design as deferred contract material.

## Scope

- Restore `app/exam-apply.tsx` and `app/exam-apply2.tsx` to the legacy FC flow where the FC enters `응시료 납입일`.
- Keep mobile writes on direct `exam_registrations` insert/update with `fee_paid_date`.
- Remove mobile runtime dependency on `exam-application-submit`.
- Remove mobile proxy applicant selector UI and per-examinee virtual-account cards.
- Remove newly added deployable exam payment Edge Function entrypoints so they are not active runtime.
- Leave pure payment contract/test material dormant as future/deferred design evidence.
- Update only exam/Toss-related harness notes; do not edit Dawichok PDF or admin-scope sections.

## Explicit Non-Scope

- Do not touch Dawichok PDF files, admin scope routes, schema/migrations, admin web routes, notification functions, or unrelated mobile screens.
- Do not revert unrelated dirty worktree changes from other workers.
- Do not delete deferred contract documentation.

## Acceptance Criteria

- Mobile life/nonlife exam apply screens show the manual `응시료 납입 일자` section and require a selected date.
- Successful submit writes `fee_paid_date: toYmd(feePaidDate)` to `exam_registrations` on both insert and update.
- Mobile life/nonlife screens contain no `exam-application-submit`, proxy applicant selector, payment join, or virtual-account UI references.
- The four newly added deployable function entrypoints are absent on disk: `exam-application-submit`, `exam-payment-issue`, `exam-payment-webhook`, and `exam-payment-expire`.
- Deferred `lib/exam-registration-payment-contract.ts` remains non-runtime: no app/web/function production code imports it.

## Verification Plan

- Search the two mobile screens for Toss/proxy runtime strings and confirm no matches.
- Search the two mobile screens for `fee_paid_date` and manual date UI.
- Confirm the four function index files no longer exist.
- Run targeted mobile lint for `app/exam-apply.tsx` and `app/exam-apply2.tsx`.
- Run the deferred payment contract test if left present.

---

# Current Contract: Increment 29 - GaramIn Nine-Item Operations Upgrade

Status: completed locally on 2026-06-03

## Goal

Implement the requested nine GaramIn improvements across mobile, admin web, Supabase schema, and Edge Functions while preserving existing FC workflow status names, manager read-only behavior, trusted admin write paths, and legacy exam-payment display.

## Scope

- Make FC home YouTube guidance more visible, show temporary employee number status beside `내 진행 상황`, and keep orange CTAs orange.
- Rename user-facing `3단계 한화 위촉 URL` copy to `3단계 다위촉 URL`.
- Replace the current step-3 admin PDF upload dependency with a secretary/admin `다위촉 서류 발송 알림` signal that unlocks the next appointment step.
- Add KakaoTalk delivery as a downstream channel for selected existing notification events.
- Add per-registration Toss Payments rotating virtual-account contracts for exam registrations.
- Allow one FC to apply for existing GaramIn FCs while preserving `exam_registrations.resident_id` as the examinee identifier.
- Add headquarters/admin scope schema and server-side enforcement hooks so scoped secretaries see only their headquarters data.

## Payment Contract

- Payment matching is always one registration to one rotating Toss virtual account.
- A multi-person proxy application may create an audit group, but money is never matched at group level.
- `DEPOSIT_CALLBACK` with a valid Toss secret is the only new source of truth for paid status.
- `fee_paid_date` remains legacy read-only display data for old rows and is not written by new mobile flows.
- Secretary/admin `접수 확정` remains a separate manual step from payment status.

## Explicit Non-Scope

- Do not rename internal `hanwha_*` route, status, or DB column names in this increment.
- Do not delete existing Hanwha/Dawichok PDF storage objects or columns.
- Do not store Toss or Kakao secrets in source.
- Do not make manager sessions writable.
- Do not introduce arbitrary external-person exam registration in v1; proxy application targets existing GaramIn FCs only.

## Acceptance Criteria

- FC home shows a larger visible video action and a temp-id/missing-temp-id badge without changing workflow progression.
- Step-3 user-facing copy says `다위촉 URL`; no user-facing `3단계 한화 위촉 URL` remains in app/web/docs touched by this work.
- Appointment gate can unlock after admin sends Dawichok documents without requiring PDF metadata.
- New exam applications create one payment/order/account row per examinee registration.
- A Toss webhook for one `orderId` updates exactly one registration payment.
- Admin exam applicant UI can show payment state separately from `접수 확정`, while legacy `fee_paid_date` rows still render.
- Scoped admin data access is enforced server-side in the implemented routes.
- Existing notification/inbox/push behavior continues even if Kakao delivery fails.

## Verification Plan

- Add focused unit/contract tests before production code where practical for workflow labels/gates, payment mapping/idempotency, legacy payment display, and scope filtering.
- Run targeted tests for changed helpers/functions.
- Run `npm test -- --runInBand`.
- Run `npm run lint`.
- Run `cd web; npm run lint`.
- Run `cd web; npm run build`.
- Run `node scripts/ci/check-governance.mjs`.
- Run `git diff --check`.

---

# Current Contract: Increment 28 - Admin Dashboard Operator Copy And File Open Fix

Status: completed on 2026-06-03

## Goal

Fix two secretary/admin web dashboard UX regressions without changing FC lifecycle semantics, schema, storage ownership, Edge Function contracts, auth/session, PII, request_board, mobile app behavior, or unrelated admin web surfaces.

## User Report

- The admin dashboard repeatedly shows developer-facing text such as `상태 흐름을 확인한 뒤, 아래 조작으로 trusted path 상태를 저장합니다.`
- In the secretary/admin page, when FCs upload files, the `열기` button does not work.

## Scope

- Remove or replace developer/internal wording from admin-facing dashboard copy.
- Keep operationally useful Korean labels and guidance for secretary/admin users.
- Fix uploaded file `열기` behavior for FC document files and Hanwha approval PDF from the dashboard modal.
- Preserve the existing `/api/admin/fc` `signDoc` server path and `fc-documents` storage bucket.
- Add focused regression coverage for copy wording and async file-open behavior where practical.
- Keep manager/read-only behavior intact.

## Explicit Non-Scope

- Do not change FC workflow status calculation, allowed transitions, DB schema/migrations, Supabase RLS, storage bucket names, Edge Function bodies, mobile app routes, request_board bridge behavior, notification fanout, dependencies, lockfiles, or env/secrets.
- Do not refactor the large dashboard page beyond the smallest support helpers needed for tests and the file-open fix.
- Do not revert pre-existing dirty changes from earlier increments.

## Delegation

- Subagent A owns admin-facing copy cleanup only.
- Subagent B owns uploaded-file open behavior only.
- Coordinator owns harness artifacts, integration review, tests, and final acceptance.

## Acceptance Criteria

- The reported `trusted path` sentence no longer appears in user-facing admin dashboard text.
- Admin-facing text avoids implementation terms such as `trusted path`, `schema`, `RLS`, `Edge Function`, and `contract` unless they are code comments/tests/docs.
- `열기` remains available for uploaded FC documents and Hanwha approval PDFs.
- Clicking `열기` is not blocked by browser popup rules caused by awaiting signed URL creation before opening a tab.
- Signed URL failures close any opened placeholder tab and show a user-friendly failure notification.
- Existing server-mediated signed URL generation remains the only way to open private `fc-documents` objects.
- Targeted tests, lint, governance, and diff whitespace checks pass.

## Verification Plan

- Search user-facing web dashboard copy for developer/internal implementation terms.
- Add or update focused unit tests for admin dashboard copy/open helpers.
- Run targeted web direct tests for new helpers.
- Run `cd web; npm run lint`.
- Run root relevant tests if shared files changed.
- Run `node scripts/ci/check-governance.mjs`.
- Run `git diff --check`.

## Files Touched

- `web/src/app/dashboard/page.tsx`
- `web/src/app/api/admin/fc/route.ts`
- `web/src/lib/admin-fc-doc-storage.ts`
- `web/src/lib/admin-fc-doc-storage.test.ts`
- `web/src/lib/admin-file-open.ts`
- `web/src/lib/admin-file-open.test.ts`
- `.codex/harness/current-contract.md`
- `.codex/harness/plan.md`
- `.codex/harness/product-spec.md`
- `.codex/harness/qa-report.md`
- `.codex/harness/handoff.md`
- `.claude/MISTAKES.md`
- `.claude/WORK_DETAIL.md`
- `.claude/WORK_LOG.md`

## Verification

- RED: `node --experimental-strip-types --test src/lib/admin-fc-doc-storage.test.ts` failed before implementation because `admin-fc-doc-storage.ts` did not exist.
- RED: `node --experimental-strip-types --test src/lib/admin-file-open.test.ts` failed before implementation because `admin-file-open.ts` did not exist.
- Passed: `node --experimental-strip-types --test src/lib/admin-fc-doc-storage.test.ts src/lib/admin-file-open.test.ts`, 9 tests.
- Passed: `Get-ChildItem web/src -Recurse -Include *.tsx,*.ts | Select-String -Pattern 'trusted path','상태 흐름','동의일\\(Actual\\)'`, no matches.
- Passed: `cd web; npm run lint -- src/app/dashboard/page.tsx src/app/api/admin/fc/route.ts src/lib/admin-fc-doc-storage.ts src/lib/admin-fc-doc-storage.test.ts src/lib/admin-file-open.ts src/lib/admin-file-open.test.ts`.
- Passed: `cd web; SENTRY_AUTH_TOKEN='' npm run build`.
  - Existing warnings only: `baseline-browser-mapping` age and `import-in-the-middle` version mismatch in transitive OpenTelemetry instrumentation.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.

---

# Current Contract: Increment 27 - Mobile Exam Round Registration/Delete Hotfix

Status: completed on 2026-06-03

## Goal

Stabilize Garam in mobile admin exam round registration and deletion for life/nonlife exam schedule screens without widening into schema, Supabase function, admin web, notification fanout, request_board, or unrelated mobile UI work.

## Evidence

- User report on 2026-06-03 KST: a secretary/admin cannot register a new exam, and tapping delete on an existing exam crashes.
- Live `admin-action` smoke with a temporary admin and temporary exam round passed for both `upsertExamRound` and `deleteExamRound`; created round/location rows were verified, then deleted and cleaned up.
- Sentry `hanhwa-lifelab` / `react-native` still shows unresolved `REACT-NATIVE-3` `TypeError: Object is not a function` on release `fc-onboarding-app@3.1.12`, dist `45`, last seen 2026-06-03 04:59:59 UTC. This matches the already-local AppAlert button crash fix from Increment 26 and indicates the fix still needs a fixed app release.
- `app/exam-register.tsx` and `app/exam-register2.tsx` built `locations` only from committed `draftLocations`, so a user who typed a region but did not tap `지역 추가` saved a round with no location payload.
- Mobile screens also allowed a new round save with zero existing/new locations, while web/admin parity expects at least one location.

## Scope

- Add a small pure helper for exam round location payload building and save validation.
- Include the currently typed pending location input in the `upsertExamRound` payload.
- Trim names, ignore blanks, default invalid sort orders to `0`, and dedupe first-seen location names before sending to `admin-action`.
- Require at least one existing or new location before saving a round.
- Apply the same mobile fix to both life and nonlife exam schedule registration screens.
- Keep trusted mobile admin writes routed through `admin-action`.
- Preserve manager/head-manager read-only behavior.
- Re-run the existing AppAlert contract test to confirm the local delete-crash guard remains present.

## Explicit Non-Scope

- Do not change Supabase schema, migrations, RLS, Edge Function action names/bodies, admin web exam schedule behavior, request_board bridge behavior, push/notification fanout, package/lockfile, or env/secrets.
- Do not resolve the Sentry issue until a fixed release is deployed and new events stop.
- Do not run production app release/build/deployment in this increment unless explicitly requested.

## Files Touched

- `app/exam-register.tsx`
- `app/exam-register2.tsx`
- `lib/exam-round-location-payload.ts`
- `lib/__tests__/exam-round-location-payload.test.ts`
- `.codex/harness/current-contract.md`
- `.codex/harness/plan.md`
- `.codex/harness/product-spec.md`
- `.codex/harness/qa-report.md`
- `.codex/harness/handoff.md`
- `.claude/MISTAKES.md`
- `.claude/WORK_DETAIL.md`
- `.claude/WORK_LOG.md`

## Acceptance Criteria

- Saving a new exam round after typing a region into the location field sends that pending location to `upsertExamRound` even if `지역 추가` was not tapped.
- A new exam round cannot be saved with zero locations.
- Updating an existing round with existing locations still works without forcing a duplicate new location.
- Location payload rows are trimmed, blank-filtered, first-seen deduped, and have finite numeric sort orders.
- Existing trusted `admin-action` create/update/delete paths remain unchanged.
- AppAlert delete confirmation action still passes only a button index through `runOnJS` and guards callable actions.
- Targeted tests, targeted lint, governance, and diff whitespace checks pass.

## Verification

- RED: `npm test -- --runTestsByPath lib/__tests__/exam-round-location-payload.test.ts --runInBand` failed before helper implementation with missing module.
- Passed: `npm test -- --runTestsByPath lib/__tests__/exam-round-location-payload.test.ts --runInBand`, 1 suite / 5 tests.
- Passed: `npm test -- --runTestsByPath components/__tests__/AppAlertProvider.contract.test.ts --runInBand`, 1 suite / 4 tests.
- Passed: `npm run lint -- app/exam-register.tsx app/exam-register2.tsx lib/exam-round-location-payload.ts lib/__tests__/exam-round-location-payload.test.ts`.
- Passed: `npm test -- --runInBand`, 30 suites / 193 tests.
- Passed: `npm run lint`.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

## Remaining Verification

- Deploy a fixed Android app release before concluding the delete crash is fixed in production.
- Device-level admin create/delete smoke remains useful after the next release candidate.

---

# Current Contract: Increment 26 - Sentry AppAlert runOnJS Crash

Status: completed on 2026-06-01

## Goal

Fix the current Sentry fatal mobile issue without widening into unrelated mobile UI, schema, env, package, notification, request_board bridge, or admin web behavior.

## Sentry Evidence

- Org/project: `hanhwa-lifelab` / `react-native`.
- Issue: `REACT-NATIVE-3`, issue id `122054204`.
- Title: `TypeError: Object is not a function`.
- Impact at investigation time: 38 events, 20 users, first seen 2026-05-23 05:46:08 UTC, last seen 2026-06-01 02:23:05 UTC.
- Release/dist in latest event: `fc-onboarding-app@3.1.12`, dist `45`, Android Hermes.
- Latest event had `js_no_source`; local Android Hermes source-map export mapped the failing minified frame near `components/AppAlertProvider.tsx` alert button callback handling.

## Root Cause

`AppAlertProvider` passed the full alert `button` object through Reanimated `runOnJS`. That object can contain an `onPress` function, and function-bearing objects are not a safe serialized payload across the worklet boundary. After returning to JS, the provider only checked truthiness before calling `button.onPress()`, so a transformed non-callable value could crash as `Object is not a function`.

## Scope

- Pass only a serializable button index through `runOnJS`.
- Resolve the button object on the JS side after the animation callback returns.
- Call alert actions only when `typeof onPress === 'function'`.
- Add focused contract coverage for the runOnJS payload and callable guard.
- Clarify the Sentry token split so future investigation uses `SENTRY_READ_AUTH_TOKEN` and upload/build work uses `SENTRY_AUTH_TOKEN`.

## Explicit Non-Scope

- Do not change app routes, screen flows, schema/migrations, Supabase functions, env/secrets, package/lockfile, request_board bridge behavior, push/notification fanout, admin web behavior, or broader alert visual design.
- Do not run `npx expo prebuild --clean` or modify generated native Android project files in this increment.
- Do not mark the Sentry issue resolved until a fixed release is deployed and new events stop.

## Files Touched

- `components/AppAlertProvider.tsx`
- `components/app-alert-utils.ts`
- `components/__tests__/AppAlertProvider.contract.test.ts`
- `E:\hanhwa\AGENTS.md`
- `.env.example`
- `README.md`
- `.codex/harness/current-contract.md`
- `.codex/harness/plan.md`
- `.codex/harness/product-spec.md`
- `.codex/harness/qa-report.md`
- `.codex/harness/handoff.md`
- `.claude/MISTAKES.md`

## Acceptance Criteria

- `runOnJS(onButtonPress)` receives a primitive button index, not the original button object.
- Button lookup happens in JS from the current alert queue item.
- Non-function `onPress` payloads are ignored instead of invoked.
- Existing default/cancel/destructive button rendering is preserved.
- Targeted AppAlertProvider contract test passes.
- Root Jest, lint, build, governance, and diff whitespace checks pass.
- Existing Sentry native prebuild/source-map warning is documented as follow-up observability debt.
- Sentry API investigation docs/env examples name `SENTRY_READ_AUTH_TOKEN` as the only read token and mark `SENTRY_AUTH_TOKEN` as upload/release/source-map only.

## Verification

- Passed: `npm test -- --runTestsByPath components/__tests__/AppAlertProvider.contract.test.ts --runInBand`, 1 suite / 4 tests.
- Passed: `npm run lint`.
- Passed: `npm test -- --runInBand`, 29 suites / 188 tests.
- Passed: `SENTRY_AUTH_TOKEN='' npm run build`; existing warnings only:
  - Sentry native configuration is missing from the prebuilt Android project.
  - Expo notifications web push-token listener limitation.
  - API route export skipped because `web.output` is not `server`.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

## Remaining Verification

- A new native Android build/release must be deployed before Sentry can confirm `REACT-NATIVE-3` is fixed in production.
- Sentry source-map/native configuration warning should be handled in a separate native-prebuild/config increment because it may touch generated Android files.
- Device-level alert button tap regression check remains useful after the next Android build.

---

# Current Contract: Increment 25 Coverage Generated Artifact Hygiene

Status: completed on 2026-05-31

## Goal

Keep the `fc-onboarding-app` workspace cleaner for long-running refactor work by treating Jest coverage output as generated local state, not source. This prevents future `npm run test:coverage` runs from polluting `git status` with untracked `coverage/` files.

## Evidence

- Current `git status --short --untracked-files=all -- coverage` reports many untracked files under `coverage/`.
- `git ls-files -- coverage` returns no tracked files.
- `package.json` defines `test:coverage=jest --coverage`, which writes Jest coverage output to `coverage/`.
- `coverage/` currently contains generated reports such as `lcov-report/`, `clover.xml`, `coverage-final.json`, and `lcov.info`.
- `git check-ignore -v coverage` currently reports no match, so the generated directory is not ignored.
- Previous harness notes record coverage output as generated local state and distinguish it from production source.

## Scope

- Add `coverage/` to the root `.gitignore`.
- Add `coverage` / `coverage/` to `.vercelignore` so local Vercel uploads do not include regenerated coverage output.
- Remove only the current untracked generated `coverage/` directory after verifying the resolved absolute path is inside `E:\hanhwa\fc-onboarding-app`.
- Update harness and work logs for this increment.

## Explicit Non-Scope

- Do not change production source, tests, package scripts, dependencies, lockfiles, env files, schema/migrations, Supabase functions, request_board files, route behavior, PII/auth/session behavior, notification fanout, generated `dist/`, admin web `.next`, or deployment build settings.
- Do not delete tracked files.
- Do not infer that coverage quality changed; this increment is only generated artifact hygiene.
- Do not run device, authenticated, live Supabase, Vercel remote, bridge/password-sync, or push checks.

## Files Likely Touched

- `.gitignore`
- `.vercelignore`
- `.codex/harness/current-contract.md`
- `.codex/harness/plan.md`
- `.codex/harness/product-spec.md`
- `.codex/harness/qa-report.md`
- `.codex/harness/handoff.md`
- `.claude/WORK_DETAIL.md`
- `.claude/WORK_LOG.md`
- `.claude/MISTAKES.md` only if a repeatable mistake, regression, contract drift, or missed verification appears

## Acceptance Criteria

- `coverage/` is explicitly ignored by `.gitignore`.
- Vercel local upload ignore rules also exclude coverage output.
- `git ls-files -- coverage` remains empty.
- Current `coverage/` generated directory is removed only after path verification.
- `Test-Path coverage` returns `False` after removal.
- `git status --short --untracked-files=all -- coverage` returns no untracked coverage files after cleanup.
- `git check-ignore -v --no-index -- coverage/foo` maps future coverage output to `.gitignore`.
- No production source, runtime config, package script, dependency, lockfile, env, schema, PII/auth/session, bridge, notification, or UI behavior changes.
- Harness/work docs record evidence and deferred checks.

## Required Checks

1. Pre-change evidence:
   - `git ls-files -- coverage`
   - `git status --short --untracked-files=all -- coverage`
   - `git check-ignore -v coverage`
   - resolved absolute path and file count/bytes for `coverage/`
2. Post-change checks:
   - `git check-ignore -v --no-index -- coverage/foo`
   - `Test-Path coverage`
   - `git status --short --untracked-files=all -- coverage`
   - `git status --ignored --short -- coverage`
   - `node scripts/ci/check-governance.mjs`
   - `git diff --check`
   - `git diff -- .gitignore .vercelignore .codex/harness/current-contract.md`

## Verification Results

- Pre-change evidence:
  - `git ls-files -- coverage` returned no tracked files.
  - `git status --short --untracked-files=all -- coverage` listed generated untracked coverage files.
  - `git check-ignore -v coverage` had no match before `.gitignore` was updated.
  - Resolved coverage path was `E:\hanhwa\fc-onboarding-app\coverage`, inside the repo, with 104 generated files and 3,966,709 bytes.
- Implementation:
  - Added `coverage/` to `.gitignore`.
  - Added `coverage` to `.vercelignore`.
  - Removed only verified untracked `E:\hanhwa\fc-onboarding-app\coverage`.
- Passed after implementation:
  - `git check-ignore -v --no-index -- coverage/foo` maps to `.gitignore:72:coverage/`.
  - `Test-Path coverage` returned `False`.
  - `git status --short --untracked-files=all -- coverage` returned no untracked coverage files.
  - `node scripts\ci\check-governance.mjs`.
  - `git diff --check` exited 0 with CRLF normalization warnings only.
  - `git diff -- .gitignore .vercelignore .codex/harness/current-contract.md` reviewed the scoped diff.

## Rollback Notes

- If the ignore rules are unwanted, remove only the new `coverage` entries from `.gitignore` and `.vercelignore`.
- Do not restore deleted `coverage/`; it is generated by `npm run test:coverage -- --runInBand` when needed.
- Do not revert unrelated accumulated dirty state.

## Tool / Skill Decisions

- Superpowers: used `using-superpowers`, `writing-plans`, and `verification-before-completion`; `dispatching-parallel-agents` considered but not used because this is one local generated-artifact hygiene increment.
- `hanhwa-session-grounding`: used for cross-repo orientation.
- `long-running-app-harness`: used; this contract is the increment boundary.
- Sequential Thinking: considered and attempted through MCP, but the tool failed with `Transport closed`; continue with explicit local contract discipline.
- context7: considered but not used; no framework/library/API documentation lookup is needed for ignore rules and generated artifact cleanup.
- Simplifier/simplify: considered but not used because `SIMPLIFIER_BASE_URL` and `SIMPLIFIER_TOKEN` are not safely configured.

## Increment 21 Contract - FC 관리자 웹 추천인 그래프 제한 접근

### Scope

- Allow FC users to log in to the admin web only for `/dashboard/referrals/graph`.
- Keep staff behavior unchanged for admin and manager sessions.
- Server-scope FC graph data to the viewer's own referral downline, matching the mobile referral page's "self + descendants" business boundary.
- Prevent direct graph API access through manually edited JS-readable cookies by requiring a signed, HttpOnly `fc_graph_session` minted by server-side password login.
- Hide staff-only graph affordances for FC mode: full nav, back-to-list link, node detail fetch, phone display, code history, event history, and list deep-link.

### Files Touched In This Increment

- `web/middleware.ts`
- `web/src/app/auth/page.tsx`
- `web/src/app/api/auth/login/route.ts`
- `web/src/app/api/auth/logout/route.ts`
- `web/src/app/api/admin/referrals/graph/route.ts`
- `web/src/app/dashboard/layout.tsx`
- `web/src/app/dashboard/referrals/graph/page.tsx`
- `web/src/components/referrals/GraphNodeDrawer.tsx`
- `web/src/lib/admin-referrals.ts`
- `web/src/lib/server-session.ts`
- `web/src/lib/admin-web-route-access.ts`
- `web/src/lib/fc-graph-session.ts`
- `web/src/lib/referral-graph-scope.ts`
- matching direct Node tests
- `.claude/MISTAKES.md`, `.codex/harness/*`

### Acceptance Criteria

- FC login succeeds through web auth and lands on `/dashboard/referrals/graph`.
- FC sessions are redirected to the graph page from `/`, `/auth`, and any other dashboard route.
- FC cannot call `/api/admin/referrals/graph` unless the signed `fc_graph_session` cookie is present and bound to the same phone.
- FC graph API returns only the viewer node and descendants reachable by `recommender_fc_id` edges; sibling/unrelated/upline nodes are excluded.
- FC graph UI has only graph navigation and does not fetch `/api/admin/referrals` on node click.
- Admin and manager graph/list behavior remains unchanged.

### Verification Results

- Passed: `node --test web\src\lib\admin-web-route-access.test.ts web\src\lib\referral-graph-scope.test.ts web\src\lib\fc-graph-session.test.ts` (7 tests).
- Passed: targeted web lint for the changed auth, middleware-adjacent helpers, graph API, graph page, drawer, layout, and server session files.
- Passed: `cd web; SENTRY_AUTH_TOKEN='' npm run build`.
- Build warnings were existing dependency/baseline warnings, not compile/type failures.

## Increment 22 Contract - Manager Default Recommender, Exact Consent Date Term, Graph Legend Colors

### Scope

- Set every active 본부장/manager fc profile to use 김형수(`01094272550`) as the default recommender.
- Keep referral current-state in `fc_profiles.recommender_*` and audit changes through `referral_events`; do not create self-referral for 김형수.
- Correct the exposed date field term from legacy allowance-date wording to exact `보증보험 조회 동의일`.
- Update admin referral graph legend/color semantics:
  - green: 생명/손해 위촉 모두 완료
  - yellow: current viewer highlight, or 본부장 highlight in 총무 view
  - orange: 본등록 완료
  - gray: 사전등록까지만 한 사람
  - legend swatches are plain circular nodes, not pills with text inside.
- Record deferred meeting items outside this scope.

### Exclusions / Deferred

- Toss virtual-account/proxy exam runtime remains deferred.
- Actual KakaoTalk provider/AlimTalk integration remains deferred.
- Dedicated 다위촉 guide image assets remain deferred unless already supplied.
- Full remote DB migration application is not claimed without deployment logs.

### Acceptance Criteria

- New migration and `schema.sql` define `link_manager_profile_to_default_recommender`.
- `ensure_manager_referral_shadow_profile` calls that helper on existing shadow, existing completed manager profile, and newly created shadow rows.
- Migration includes a backfill pass for active `manager_accounts`.
- User-facing date labels/errors in touched app/web/functions/docs say `보증보험 조회 동의일`.
- Referral docs and static tests pin the new 김형수 default-manager recommender contract.
- Graph UI matches the requested legend node shape and global color conditions.

### Required Checks

- `npm test -- --runInBand`
- `npm run lint`
- `cd web; npm run lint`
- `cd web; SENTRY_AUTH_TOKEN='' npm run build`
- `node scripts/ci/check-governance.mjs`
- `git diff --check`
- For `request_board`, run its repo build/checks before commit because this conversation also contains GaramLink changes.

## Increment 25 Contract - Mobile Customer Management Entry

### Scope

- Add a mobile FC `고객관리` action card in the GaramLink home action list.
- Navigate that card to `/request-board-create` with explicit query params for the customer-management entry.
- Resolve the query in `app/request-board-create.tsx` through a small helper so the screen starts at `1. 고객`.
- Preserve the existing create-flow permission gate and default `/request-board-create` behavior.

### Exclusions

- No request_board API/server changes.
- No admin web changes.
- No customer CRUD behavior changes beyond exposing the existing customer select/register screen.
- No edits to 설계매니저 action ownership.

### Acceptance Criteria

- FC users see `고객관리` in the action area with `실시간 메신저`, `의뢰 목록 · 검토`, and `설계코드 관리`.
- Tapping `고객관리` enters `request-board-create` at the `customer` step.
- Existing `새 설계 요청` route remains a customer-first create flow.
- Designer request-board sessions remain blocked from the FC create/customer-management screen.

### Required Checks

- RED then GREEN: `npx jest lib\__tests__\request-board-create-flow.test.ts --runInBand`
- `npx tsc --noEmit`
- `npm run lint -- app\request-board.tsx app\request-board-create.tsx lib\request-board-create-flow.ts lib\__tests__\request-board-create-flow.test.ts`

## Increment 26 Contract - Admin Web Errors, Modal Stage Targeting, Exam Schedule Notify/Sort

### Scope

- Reduce admin web graph API errors caused by stale FC route cookies without a signed `fc_graph_session`.
- Ensure the dashboard `관리` button opens the modal tab matching the row's current workflow step.
- Sort exam schedule list rows by exam date, with exam-date-missing rows sorted by registration deadline.
- Send exam schedule create/update notifications through the shared `fc-notify` mobile fanout contract.

### Exclusions

- No native app build.
- No direct phone UI smoke.
- No historical Vercel log guarantee from CLI 48.12.0, which only supports live deployment log streaming.
- No change to the broader FC graph downline authorization contract beyond stale-cookie route gating.

### Acceptance Criteria

- FC admin-web route access requires `fc_graph_session` whenever `role=fc` is present, including `/` and `/auth` entry points.
- Clearing a stale FC route state also clears the graph-session cookie.
- Dashboard modal default tab maps `calcStep(profile)` as `2 -> docs`, `3 -> hanwha`, `>=4 -> appointment`.
- Exam schedule rows use `sortExamRoundsByExamDateThenDeadline`.
- Exam schedule notification payload uses `type: notify`, `target_role: fc`, `target_id: null`, `category: exam_round`, and the correct mobile target URL.

### Required Checks

- `node --test src/lib/admin-web-route-access.test.ts src/lib/exam-round-sort.test.ts src/lib/exam-round-notification.test.ts`
- `cd web; npm run lint`
- targeted `git diff --check`
- `cd web; SENTRY_AUTH_TOKEN='' npm run build` when the local Next dev server can be stopped.

## Increment 27 Contract - Referral Graph Real-Data Layout Stability

### Scope

- Fix the admin referral graph layout where the Kim Hyungsoo root fanout rendered as long, uniform spokes.
- Reduce actual node/label crowding by restoring an explicit collision force in production graph physics.
- Keep drag/link behavior stable by using the same force constants in production and simulation tests.
- Add a real Supabase data regression test that exercises the current 185-node/102-edge admin graph instead of only synthetic fixtures.
- Bump both canvas layout memory and graph physics localStorage versions to `v16` so stale browser settings do not override the new spacing defaults.
- Draw high-fanout root spokes as quieter background links, then draw branch-local links above them to reduce visible edge overlap without destabilizing node physics.
- Keep static layout anchors aged out after the first stabilization window, but keep manual drag/drop targets alive for later same-session drag releases.

### Exclusions

- No data mutation.
- No graph authorization/session changes.
- No mobile native build.
- No forced shutdown of the active local Next dev server.

### Acceptance Criteria

- Actual Supabase graph test runs with `RUN_REFERRAL_GRAPH_REALDATA_TEST=1` and passes on current production data.
- Actual graph metrics stay bounded: node minimum center distance >= 26px, max edge <= 360px, disjoint edge crossings <= 24.
- Actual visual edge-overlap severity stays <= 7 using production link alpha/width style weights.
- Kim Hyungsoo direct spokes are pinned separately: sample >= 8, max <= 360px, p90 <= 345px.
- Same-session drag release remains covered: `layout-memory` must not globally shut off manual drag/drop targets after `maxTicks`.
- Synthetic layout/physics/simulation tests continue to pass.
- Reloading the graph page uses `referral-graph-physics-settings-v16` defaults instead of stale `v15` browser settings.

### Required Checks

- `node --test src/lib/referral-graph-layout.test.ts`
- `node --test src/lib/referral-graph-physics.test.ts`
- `node --test src/lib/referral-graph-simulation.test.ts`
- `RUN_REFERRAL_GRAPH_REALDATA_TEST=1 node --test src/lib/referral-graph-realdata.test.ts`
- targeted web ESLint and `git diff --check`

## Increment 29 Contract - Manager Exam Management Plus Apply

### Scope

- 본부장(`role=admin`, `readOnly=true`) 시험 홈에서 기존 시험 일정/신청자 명단 조회 동선을 유지한다.
- 본부장 시험 홈에 FC와 같은 생명/손해 시험 신청 링크를 추가한다.
- FC 시험 신청 route gate는 본부장 세션도 허용한다.
- 쓰기 가능한 총무 admin은 기존 시험 관리 surface를 유지한다.

### Acceptance Criteria

- `resolveExamHomeSurface({ role: 'admin', readOnly: true, adminHomeTab: 'exam' })` returns `manager-management`.
- 본부장 시험 홈 quick links include existing exam schedule/applicant-list cards and `/exam-apply`, `/exam-apply2`.
- `/exam-apply` and `/exam-apply2` remain accessible for FC and read-only manager sessions.
- Writable admin still sees the existing admin exam management surface.

### Required Checks

- `npx jest lib\__tests__\exam-role.test.ts --runInBand`
- `npx eslint app\index.tsx lib\exam-role.ts lib\__tests__\exam-role.test.ts`
- `npx tsc --noEmit --pretty false`
- `node scripts\ci\check-governance.mjs`
- targeted `git diff --check`

## Increment 30 Contract - Referral Graph Hand-Drawn Branch Layout

### Scope

- Make the referral graph match the user's sketch more closely: no root-centered circular distribution as the dominant pattern.
- Keep terminal/no-child edges short, but vary their lengths slightly so crowded leaf groups can stay readable.
- Give child hubs with their own descendants longer, ID-varied branch bridge edges than terminal leaves.
- Keep graph edges visually unified: same stroke layer/color/width for regular and selected edges, with stronger visibility than the previous faint style.
- Increase production collision/sibling-angular/edge-crossing forces enough to reduce node crowding and edge overlap on the current real Supabase graph.

### Exclusions

- No authorization/session changes.
- No data mutation.
- No graph route/API changes.
- No direct browser/phone visual QA in this increment.

### Acceptance Criteria

- Root/terminal-only hubs seed into a short side fan, not a full circular orbit.
- Dense terminal leaves keep minimum node spacing around 92px+ in simulation while allowing a small number of length-staggered near-parallel spokes.
- Child hub bridge distances are longer than terminal leaf spokes and have stable ID-based variation.
- All graph links return one uniform style contract and dead root-spoke style branches are removed.
- Actual Supabase graph passes with current data: crossings <= 24, visual severity <= 8, min node distance >= 26px, max edge <= 360px, Kim Hyungsoo direct max <= 360px and p90 <= 345px.

### Required Checks

- `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts`
- `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; node --test src/lib/referral-graph-realdata.test.ts`
- targeted web ESLint and `git diff --check`
# Current Contract: Increment 35 - Board Category Four-Type Alignment

Status: completed locally on 2026-06-05

## Goal

Change current GaramIn board post types to the four requested categories: `공지`, `교육 일정`, `일반`, `가람pick`.

## Scope

- Update board category schema seed and add a forward migration that activates only the four requested types.
- Preserve stable existing slugs where possible: `notice`, `education`, `garam-pick`, `general`.
- Move legacy `insurance-news` posts and other inactive/legacy category posts to `일반` before deactivating legacy categories.
- Make category-list return active categories for every role so inactive legacy categories do not reappear in admin writer/filter UI.
- Make category create/update and post create/update reject non-canonical board categories.
- Update mobile/web board badge theme matching for `교육 일정` and `가람pick`.
- Keep the insurance digest automation from recreating `보험소식`/`insurance-news`.
- Update related docs and work logs.

## Explicit Non-Scope

- Do not edit referral graph files.
- Do not change board permissions, comments, reactions, attachments, or author contracts.
- Do not add hard-coded category IDs in clients.

## Acceptance Criteria

- Category list after migration is active for exactly `공지`, `교육 일정`, `일반`, `가람pick`.
- Admin and manager category-list consumers do not receive inactive legacy categories.
- Existing `education` and `garam-pick` category IDs remain usable through renamed display names.
- Insurance digest posts target `general`, not `insurance-news` or `garam-pick`.
- Category create/update and post create/update use the shared canonical allowlist.
- Mobile and admin web board badges do not gray-fallback for the new names.

## Verification Plan

- Passed: `node --test scripts/ops/post-insurance-digest.test.mjs`.
- Passed: `npm run lint -- app\board.tsx app\admin-board-manage.tsx scripts\ops\post-insurance-digest.mjs`.
- Passed: `cd web; npm run lint -- src\app\dashboard\board\page.tsx`.
- Passed: `npx tsc --noEmit --pretty false`.
- Passed: `node scripts\ci\check-governance.mjs`.
- Passed: targeted `git diff --check`.
- Not run: Deno Edge Function static check; `deno` is not installed in this local environment, and Expo ESLint cannot resolve Deno URL imports.

---

# Increment 38 Contract: Referral Graph Small-Drag Stability

Date: 2026-06-05

## Objective

Fix the referral graph bug where a slight node drag can move unrelated connected nodes far away and leave abnormal long edges.

## Scope

- `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - Drag handlers must record only the dragged node as manual/suppressed.
  - Drag-time spring correction must be bounded and non-jumpy.
  - Drag/grab interactions must not call `d3ReheatSimulation()`.
- `web/src/lib/referral-graph-physics.ts`
  - Prevent-stretch propagation must continue only from edges that were actually corrected.
  - Tiny/grab-only drag gestures must be detectable with a tested helper.
- Tests
  - Add a unit regression for slight drag not propagating into unrelated deep stretched links.
  - Extend real-data QA with a small 김형수 drag/release check.

## Acceptance Criteria

- A slight drag does not create 400px-class abnormal long edges on current actual Supabase data.
- A slight drag does not worsen the current actual-data crossing count.
- Grabbing a node without meaningful movement does not leave manual drag state and does not reheat the graph.
- Existing graph simulation tests remain green.
- Web lint remains green.

## Verification

- Passed: `node --test src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts`.
- Passed: `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`.
- Passed: `cd web; npm run lint`.

## Rollback Notes

- Reverting this increment should only touch the drag handler/spring propagation changes and the new small-drag assertions.
- Do not restore component-wide drag suppression; that is the root cause of the reported runaway drag behavior.

---

# Current Contract: Increment 36 - Referral Graph Non-Circular Stable Branch Layout

Status: completed locally on 2026-06-05

## Goal

Stop the referral graph from curling back into circular root/leaf clusters and from producing abnormal long edges. The accepted shape is a branch/trunk layout: terminal leaves use short but slightly varied spokes, child hubs with descendants use longer branch bridges, and the force simulation remains stable after drag/cooling.

## Scope

- Keep all graph edges straight and visually uniform.
- Preserve open terminal sibling fans instead of closed circular rings.
- Lengthen crowded leaf spokes only when needed for spacing, with stable ID-based variation.
- Keep child hub bridges longer than terminal leaf spokes while bounding max link length.
- Align runtime Canvas force settings with layout/physics/simulation tests.
- Verify against the current real Supabase referral graph.

## Explicit Non-Scope

- No graph authorization/API/data-scope changes.
- No mobile app build.
- No phone UI manipulation in this increment.

## Acceptance Criteria

- Terminal-only sibling fan retains a large empty sector after simulation, not a full circle.
- Actual Supabase graph has minimum node distance around 96px, max edge <= 360px, and Kim Hyungsoo direct p90 <= 345px.
- Force simulation passes drag, reheating, dense fanout, nested branch, isolated-node, and cooled-stability regressions.
- Web ESLint passes.

## Verification Plan

- Passed: `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts`.
- Passed: `node --test src/lib/referral-graph-simulation.test.ts`.
- Passed: `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; node --test src/lib/referral-graph-realdata.test.ts`.
- Passed: `cd web; npm run lint`.
- Not run: `cd web; npm run build` because an active Next dev server blocked `.next` cleanup.

---

# Current Contract: Increment 37 - Referral Graph Zero-Crossing Branch Layout

Status: completed locally on 2026-06-05

## Goal

Make the current referral graph settle as a non-circular branch/trunk graph with no disjoint straight-edge crossings on the live Supabase data. Child-bearing hubs use longer bridge edges; terminal leaves stay as short, slightly varied spokes.

## Scope

- Keep graph edges straight and visually uniform.
- Remove circular root/leaf pull from terminal branch fans.
- Use staggered terminal leaf spoke lengths so crowded short leaves do not stack.
- Keep unrelated isolated nodes outside connected branch corridors without a runaway outer ring.
- Use anchor-aware crossing correction so physics resolves crossings toward the deterministic seed layout.
- Verify with the current real Supabase referral graph.

## Explicit Non-Scope

- No graph authorization/API/data-scope changes.
- No mobile app build.
- No phone UI manipulation in this increment.

## Acceptance Criteria

- Actual Supabase graph has `crossings=0` and `crossingVisualSeverity=0`.
- Actual Supabase graph has minimum node distance >= 90px and max edge <= 360px.
- Kim Hyungsoo direct spokes are not abnormal long spokes: direct max <= 360px and p90 <= 345px.
- Synthetic graph simulation, layout, physics, and link-style tests pass.
- Web ESLint passes.

## Verification Plan

- Passed: `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts`.
- Passed: `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`.
- Passed: `cd web; npm run lint`.
- Not run: `cd web; npm run build`.
# Current Contract: Increment 36 - Referral Graph Descendant-Sized Nodes

Status: completed locally on 2026-06-07

## Goal

Make admin referral graph node size reflect total downstream organization size by default.

## Scope

- Compute directed descendant counts from the full graph in the web admin graph page.
- Keep descendant counts independent from search/status/focus visibility filters.
- Use capped logarithmic descendant-aware radius in the canvas.
- Keep drawing, label collision, pointer hit area, and force collision on the same radius source.
- Show the selected node's total descendant count in the drawer and add concise legend copy.
- Add focused tests for descendant counting and radius behavior.

## Explicit Non-Scope

- Do not change `/api/admin/referrals/graph` response shape.
- Do not add a toggle or localStorage setting.
- Do not redesign graph layout/force systems beyond consuming the new radius.
- Do not change referral edge semantics.

## Acceptance Criteria

- Chain, branching, cycle, and missing-endpoint descendant helper tests pass.
- Radius tests show larger descendant counts produce larger capped radii, leaf nodes stay compact, and highlight boost remains.
- A visible node keeps the same size basis even when filters/search hide descendants.
- Drawer displays `하위 전체 N명` for selected nodes.
- Focused graph tests and lint pass, or any pre-existing failure is documented.

## Verification Plan

- `node --test web/src/lib/referral-graph-descendants.test.ts web/src/lib/referral-graph-highlight.test.ts`
- `node --test web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-simulation.test.ts`
- `cd web; npm run lint`
- `git diff --check`

---
# Current Contract: Increment 37 - Referral Graph Descendant Highlight Radius Correction

Status: completed locally on 2026-06-07

## Goal

Ensure descendant-sized referral graph nodes use node size only for total downstream organization size, so 김형수 remains the largest node when he has the largest descendant count.

## Scope

- Remove highlight radius boost when `descendantCount` is provided.
- Keep highlight visual treatment through existing color/stroke/shadow.
- Add regression coverage for dominant unhighlighted descendant node versus highlighted smaller branch.

## Verification Plan

- `node --test web/src/lib/referral-graph-highlight.test.ts web/src/lib/referral-graph-descendants.test.ts`
- `node --test web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-simulation.test.ts`
- `RUN_REFERRAL_GRAPH_REALDATA_TEST=1 node --test web/src/lib/referral-graph-realdata.test.ts`
- `cd web; npm run lint`
- `cd web; SENTRY_AUTH_TOKEN='' npm run build`

---
