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
