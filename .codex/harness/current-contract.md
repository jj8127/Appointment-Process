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
