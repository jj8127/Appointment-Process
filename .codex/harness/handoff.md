# Handoff: Evidence-Based Cleanup / Refactor Program

## Increment 28: Admin Dashboard Operator Copy And File Open Fix

Status: completed locally on 2026-06-03.

What changed:

- Admin dashboard FC detail allowance tab no longer shows the reported `trusted path` sentence.
- User-facing labels were changed from developer/implementation wording to operator-facing Korean: `현재 진행 단계`, `수당동의 관리`, `동의일`.
- `web/src/app/dashboard/page.tsx` now opens a pending tab synchronously when `열기` is clicked, then navigates it after the admin API returns the signed URL.
- `web/src/app/api/admin/fc/route.ts` now normalizes FC document storage inputs before calling `createSignedUrl`.
- Added focused tests for FC document path normalization and pending-tab open behavior.

What did not change:

- No schema/migration, Supabase bucket, RLS, Edge Function body, session/auth, manager read-only rule, request_board bridge, mobile route, env/secrets, dependency, or lockfile change.
- Private `fc-documents` file access still goes through `/api/admin/fc` `signDoc`.

Evidence and verification:

- RED storage/open tests failed before helpers existed.
- GREEN direct Node tests passed, 9 tests.
- Exact source search for `trusted path`, `상태 흐름`, and `동의일(Actual)` returned no matches.
- Targeted web lint passed.
- `SENTRY_AUTH_TOKEN='' npm run build` in `web/` passed with existing transitive dependency/data-age warnings only.

Next resume step:

- Run deployed admin dashboard smoke for `열기` against real uploaded FC files and Hanwha PDFs.
- If popup blockers are enabled, confirm the user sees the explicit popup-block notification.

## Increment 27: Mobile Exam Round Registration/Delete Hotfix

Status: completed locally on 2026-06-03.

What changed:

- Added `lib/exam-round-location-payload.ts` and focused tests for mobile exam location save payloads.
- `app/exam-register.tsx` and `app/exam-register2.tsx` now include the currently typed pending location when saving a round.
- New saves now require at least one existing or new location; updates with existing locations still work without forcing a duplicate location.
- Location rows are trimmed, blank-filtered, first-seen deduped, and assigned finite numeric sort orders before being sent to `admin-action`.

What did not change:

- No Supabase schema/migration, Edge Function action body, RLS, admin web, env/secrets, dependency/lockfile, request_board, push/notification fanout, or unrelated mobile UI behavior was changed.
- The existing `admin-action` trusted create/update/delete route remains the write path.
- Sentry issue `REACT-NATIVE-3` was not resolved; production still needs a fixed app release.

Evidence and verification:

- Live temporary `admin-action` smoke passed for `upsertExamRound` and `deleteExamRound`, including row verification and cleanup.
- Sentry still shows `REACT-NATIVE-3` on `fc-onboarding-app@3.1.12`, matching the already-local AppAlert delete confirmation crash fix.
- RED `npm test -- --runTestsByPath lib/__tests__/exam-round-location-payload.test.ts --runInBand` failed before implementation due missing helper.
- GREEN location helper test passed, 1 suite / 5 tests.
- GREEN AppAlertProvider contract test passed, 1 suite / 4 tests.
- Combined targeted tests passed, 2 suites / 9 tests.
- Targeted lint passed for the two screens and new helper/test.
- Full `npm test -- --runInBand` passed, 30 suites / 193 tests.
- Full `npm run lint` passed.
- `node scripts/ci/check-governance.mjs` passed.
- `git diff --check` passed with CRLF normalization warnings only.

Next resume step:

- Prepare/deploy a fixed Android release before telling operations the delete crash is resolved in production.
- After release, run a device admin smoke for create/update/delete and check Sentry for new `REACT-NATIVE-3` events.

## Increment 26: Sentry AppAlert runOnJS Crash

Status: completed on 2026-06-01.

What changed:

- Fixed Sentry issue `REACT-NATIVE-3` by changing `AppAlertProvider` to pass only a serializable button index through Reanimated `runOnJS`.
- Added `components/app-alert-utils.ts` for JS-side alert button lookup and callable `onPress` guarding.
- Extended `components/__tests__/AppAlertProvider.contract.test.ts` so this crash pattern cannot return unnoticed.
- Clarified Sentry token roles in workspace/repo docs: `SENTRY_READ_AUTH_TOKEN` is for Sentry API reads, while `SENTRY_AUTH_TOKEN` is upload/release/source-map only.

What did not change:

- No app route, schema/migration, Supabase function, env/secrets, dependency, lockfile, request_board bridge, push/notification fanout, admin web, or broader alert visual behavior was changed.
- Existing `app.json` version dirty state was pre-existing/user-owned and was preserved.
- Sentry issue state was not manually resolved.
- Local secret files were not edited or printed.

Verification:

- RED targeted AppAlertProvider contract failed before implementation.
- GREEN `npm test -- --runTestsByPath components/__tests__/AppAlertProvider.contract.test.ts --runInBand`: passed, 1 suite / 4 tests.
- `npm run lint`: passed.
- `npm test -- --runInBand`: passed, 29 suites / 188 tests.
- `SENTRY_AUTH_TOKEN='' npm run build`: passed with existing Expo/Sentry/web export warnings only.
- `node scripts/ci/check-governance.mjs`: passed.
- `git diff --check`: passed with CRLF normalization warnings only.

Next resume step:

- After deployment, check Sentry `REACT-NATIVE-3` for new events on the fixed release.
- Separate follow-up: address the Sentry native prebuild/source-map warning. The current export still reports that native Sentry config is missing from the prebuilt Android project.

Skill/tool state:

- `hanhwa-session-grounding`: used.
- `long-running-app-harness`: used.
- Superpowers: `systematic-debugging`, `test-driven-development`, and `verification-before-completion` used.
- context7: used for Sentry and React Native/Sentry Expo documentation checks.
- Sequential Thinking: used for issue triage and fix ordering.
- Simplifier/simplify: considered, not used because safe env is absent.

## Increment 25: Coverage Generated Artifact Hygiene

Status: completed on 2026-05-31.

What changed:

- Added `coverage/` to `.gitignore`.
- Added `coverage` to `.vercelignore`.
- Removed only the current untracked generated `coverage/` directory after verifying the resolved target path.
- No production source, tests, package scripts, dependencies, lockfiles, env files, schema/migrations, Supabase functions, request_board files, route behavior, PII/auth/session behavior, notification fanout, generated `dist/`, admin web `.next`, or deployment build settings changed.

Evidence and verification:

- Pre-change `git ls-files -- coverage` returned no tracked files.
- Pre-change `git status --short --untracked-files=all -- coverage` listed generated untracked coverage output.
- Pre-change `git check-ignore -v coverage` had no match.
- Deletion guard verified `E:\hanhwa\fc-onboarding-app\coverage` was the exact repo-local target.
- Removed 104 generated files / 3,966,709 bytes.
- Passed: `git check-ignore -v --no-index -- coverage/foo` maps future coverage files to `.gitignore:72:coverage/`.
- Passed: `Test-Path coverage=False`.
- Passed: `git status --short --untracked-files=all -- coverage` returned no untracked coverage output.
- Passed: `node scripts\ci\check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

Deferred/manual:

- None for this generated-artifact hygiene increment.
- Broader goal still needs device/simulator WebView checks, authenticated mobile/admin flows, live Supabase/request_board bridge/password-sync smoke, real push/badge/deep-link checks, and Supabase remote migration parity.

Next safe candidate:

- Continue with another tracked/generated/local state audit or a characterization-only contract for one high-risk runtime boundary. Do not touch PII/auth/schema/push/bridge or large dashboards without a separate contract.

## 2026-05-31 Current User-Requested Local Verification Re-run

Status: completed.

Latest same-session refresh:

- Passed again after the user asked to run every locally possible test: `npx tsc --noEmit`, `npm run lint`, `npm test -- --runInBand`, `npm run test:coverage -- --runInBand`, direct Node characterization for current `web/src/lib` tests plus `request-board-password-sync.test.ts` (107 tests), `npm run build`, `cd web; npm run lint`, `cd web; npm run build`, Expo static export smoke on port `4315`, local Next production no-redirect smoke on port `4314`, `node scripts\ci\check-governance.mjs`, and `git diff --check`.
- Confirmed latest smoke ports `4314` and `4315` were clear afterward.

Automated/runtime checks run:

- Passed: `npx tsc --noEmit`.
- Passed: `npm run lint`.
- Passed: `npm test -- --runInBand`, 29 suites / 185 tests.
- Passed: `npm run test:coverage -- --runInBand`, 29 suites / 185 tests; at that point accumulated untracked `coverage/` output remained, and Increment 25 later ignored/removed it as generated local output.
- Passed: direct Node characterization set, 107 tests, with existing `MODULE_TYPELESS_PACKAGE_JSON` warnings.
- Note: an earlier overly broad ad hoc direct Node command included `supabase/functions/_shared/__tests__/referral-search.test.ts` and failed under direct Node ESM because that Jest-covered file imports `../referral-search` extensionlessly. The same file passed in `npm test -- --runInBand`; the contract-relevant direct Node command was rerun without that Jest-only file and passed.
- Passed: `npm run build`; existing Expo/Sentry/web export warnings only.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`; existing baseline-browser-mapping and OpenTelemetry `import-in-the-middle` warnings only.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.
- Passed: Expo static export smoke on port 4315 for `/`, `/login.html`, and `/reset-password.html`.
  - Note: two earlier ad hoc Node static-server attempts failed before serving because the temporary harness argument mapping was wrong. Python `http.server` returned 404 for extensionless `/login` and `/reset-password` because it does not provide Expo/Vercel rewrite behavior; generated `.html` route artifacts passed.
- Passed: local Next production no-redirect smoke on port 4314:
  - `/reset-password`: 200.
  - `/auth`: 200.
  - `/dashboard`: 307.
- Confirmed: ports `4314` and `4315` were clear after smoke checks.

Manual/external checks still required:

- Real device/simulator Daum postcode WebView interaction.
- Authenticated appointment and Hanwha commission submit flows against an approved backend target.
- Authenticated browser QA for role-specific sessions.
- Live Supabase/request_board bridge/password-sync smoke with paired approved secrets.
- Real device/browser push, badge, and deep-link checks.
- Supabase remote migration parity checks.

## Increment 24: Root TypeScript NoEmit Alignment

Status: completed on 2026-05-31.

What changed:

- Restored root `npx tsc --noEmit` to a clean local safety gate.
- Typed already-read Edge Function `message` fields in appointment/Hanwha commission submit flows.
- Aligned Hanwha commission helper inputs with existing `FcStatus` and stored date string contracts.
- Added missing Hanwha commission display helper/styles referenced by the existing UI.
- Kept referral app-session relogin classification behavior while making `isReferralReloginError` a type guard and normalizing nullable response `code` values for classification.
- Updated Daum postcode WebView event typings to match the installed `react-native-webview` type surface and removed a prop rejected by those installed types.
- Updated the mobile auth/gate handbook owner doc for the referral self-service app-session error classification contract.

Verification:

- RED confirmed: `npx tsc --noEmit` failed before implementation with localized blockers.
- Passed: `npx tsc --noEmit`.
- Passed: `npm run lint`.
- Passed: `npm test -- --runInBand`, 29 suites / 185 tests.
- Passed: direct Node characterization set, 22 files / 107 tests, with existing `MODULE_TYPELESS_PACKAGE_JSON` warnings.
- Passed: `npm run build`; existing Expo/Sentry/static-export warnings only.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`; existing baseline-browser-mapping and OpenTelemetry warnings only.
- Passed: Expo static export smoke on port 19006 for `/`; server stopped and port cleared afterward.
- Passed: no-redirect local Next production smoke on port 3100:
  - `/reset-password`: 200.
  - `/dashboard`: 307, `Location: /auth`.
  - Server stopped and port cleared afterward.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

Manual/external checks still required:

- Real device/simulator Daum postcode WebView interaction.
- Authenticated appointment and Hanwha commission submit flows against an approved backend target.
- Authenticated browser QA for role-specific sessions, live bridge/password-sync, push/badge/deep-link checks, and Supabase remote migration parity.

## 2026-05-31 Fresh Local Verification Sweep

Status: completed.

Automated/runtime checks run:

- Passed: `npx tsc --noEmit`.
- Passed: `npm test -- --runInBand`, 29 suites / 185 tests.
- Passed: `npm run test:coverage -- --runInBand`, 29 suites / 185 tests; generated `coverage/` was removed after path verification.
- Passed: direct Node characterization set, 22 files / 107 tests, with existing `MODULE_TYPELESS_PACKAGE_JSON` warnings.
- Passed: `npm run lint`.
- Passed: `npm run build`; existing Expo/Sentry/web export warnings only.
- Passed: Expo static export smoke on port 19006 for `/`; server stopped and port cleared afterward.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`; existing baseline-browser-mapping and OpenTelemetry `import-in-the-middle` warnings only.
- Passed: local Next production no-redirect smoke on port 3100:
  - `/reset-password`: 200.
  - `/dashboard`: 307.
  - Server stopped and port cleared afterward.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

Manual/external checks still required:

- Authenticated browser QA for real admin/manager/FC/designer sessions.
- Password reset SMS/function flow against an approved non-production or explicit live target.
- Live Supabase/request_board bridge/password-sync smoke, real device/browser push/badge/deep-link checks, and Supabase remote migration parity.

## Increment 23: Admin Web Reset Password Public Route Guard

Status: completed on 2026-05-31.

What changed:

- Added `web/src/lib/admin-web-public-paths.ts`.
- Added `web/src/lib/admin-web-public-paths.test.ts`.
- `web/middleware.ts` now uses the shared helper and treats `/reset-password` as public.
- Recorded the redirect-following smoke gap in `.claude/MISTAKES.md`.

Verification:

- RED confirmed: `node --experimental-strip-types --test web/src/lib/admin-web-public-paths.test.ts` failed before implementation because the helper module was missing.
- Passed: new direct Node public-path test, 3 tests.
- Passed: adjacent direct Node web tests, 13 tests.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`; existing baseline-browser-mapping and OpenTelemetry warnings only.
- Passed: no-redirect local Next production smoke on port 3100:
  - `/reset-password`: 200.
  - `/auth`: 200.
  - `/dashboard`: 307 to `/auth`.
- Passed: `npm test -- --runInBand`, 29 suites / 185 tests.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

Manual/external checks still required after local completion:

- Authenticated browser QA for real admin/manager sessions.
- Password reset SMS/function flow against an approved non-production or explicit live target.
- Live Supabase/request_board bridge/password-sync smoke, real device/browser push/badge/deep-link checks, and Supabase remote migration parity.

## 2026-05-31 User-Requested Full Local Verification Sweep

Status: completed.

Automated/runtime checks run:

- Passed: `npm run lint`.
- Passed: `npm test -- --runInBand`, 29 suites / 185 tests.
- Passed: intended full direct Node characterization set, 21 files / 104 tests.
- Passed: `npm run build`; existing Expo/Sentry/web export warnings only.
- Passed: Expo static export smoke on port 19006 for `/`, `/login.html`, and `/dashboard.html`; server stopped and port cleared afterward.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`; existing baseline-browser-mapping and OpenTelemetry `import-in-the-middle` warnings only.
- Passed: local Next production smoke on port 3100 for `/auth`, `/dashboard`, and `/reset-password`; server stopped and port cleared afterward.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

Notes:

- A broader exploratory direct Node command that included `supabase/functions/_shared/__tests__/referral-search.test.ts` failed under Node strip-types because that Jest-oriented test imports `../referral-search` without an extension. Root Jest covers that suite and passed.
- Manual/external checks still required: authenticated browser QA, live Supabase/request_board bridge/password-sync smoke, real device/browser push/badge/deep-link checks, and Supabase remote migration parity.

## Increment 22: Empty Legacy Export Directory Cleanup

Status: completed on 2026-05-31.

What changed:

- Removed only ignored, untracked, file-empty local generated directory trees:
  - `dist-web/`
  - `dist-web-new/`
- Left current generated outputs and local tooling state untouched: `dist/`, `web/.next`, `.vercel`, `web/.vercel`, `.codex-tmp`, and `supabase/.temp`.
- No production source, package scripts, deploy config, dependency, lockfile, env, schema, runtime route, PII/auth, bridge, notification, or UI behavior changed.

Evidence and verification:

- Pre-delete evidence: `dist-web/` and `dist-web-new/` existed only as empty nested directories with old 2025-12-15 timestamps.
- `git ls-files -- dist-web dist-web-new` returned no tracked files.
- `git status --short --untracked-files=all -- dist-web dist-web-new` returned no source/untracked output.
- `git check-ignore -v -- dist-web dist-web-new dist-web/foo dist-web-new/foo` mapped both to existing `.gitignore` rules.
- Deletion guard verified the resolved absolute targets were exactly `E:\hanhwa\fc-onboarding-app\dist-web` and `E:\hanhwa\fc-onboarding-app\dist-web-new` before recursive removal.
- Post-delete checks:
  - `Test-Path dist-web=False`.
  - `Test-Path dist-web-new=False`.
  - `git status --short --untracked-files=all -- dist-web dist-web-new` returned no source/untracked output.
  - `git check-ignore -v --no-index -- dist-web/foo dist-web-new/foo` still maps to existing ignore rules.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

Next safest candidates:

- Continue generated/local artifact audits only when each target has tracked/ignored/generated evidence and is not the current build output.
- Do not delete `dist/` because root `npm run build` currently regenerates it, and do not delete `web/.next` because `cd web; npm run build` currently regenerates it.
- Runtime cleanup should remain deferred until a fresh narrow `current-contract.md`, especially for PII/auth/schema/bridge/push or large dashboard modules.

## 2026-05-31 Local Verification Sweep

Status: completed.

Automated/runtime checks run:

- Passed: `npm test -- --runInBand`, 29 suites / 185 tests.
- Passed: `npm run lint`.
- Passed: `npm run build`; existing Expo/Sentry/web export warnings only.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`; existing baseline-browser-mapping and OpenTelemetry `import-in-the-middle` warnings only.
- Passed: direct Node characterization set, 104/104, with existing `MODULE_TYPELESS_PACKAGE_JSON` warnings.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.
- Passed: local Next production smoke on port 3100: `/auth` 200; protected dashboard routes redirected 307 to `/auth`; server stopped and port cleared afterward.

Manual/external checks still required:

- Authenticated browser QA for admin/manager/FC/designer-specific flows.
- Live Supabase/request_board bridge/password-sync smoke with paired non-production or approved production secrets.
- Real device/browser push, badge, and deep-link checks.
- Supabase remote migration parity checks.

## Increment 21: Legacy Generated Artifact Cleanup

Status: completed on 2026-05-30.

What changed:

- Removed only the ignored, untracked local generated artifact directory `dist-web-new2/`.
- Left current build outputs and local tooling state untouched: `dist/`, `web/.next`, `.vercel`, `web/.vercel`, `.codex-tmp`, and `supabase/.temp`.
- No production source, package scripts, deploy config, dependency, lockfile, env, schema, runtime route, PII/auth, bridge, notification, or UI behavior changed.

Evidence and verification:

- Pre-delete evidence: `dist-web-new2/` existed, was about 3.91 MB, was ignored by `.gitignore:11:dist-web-new2/`, and had no tracked files under `git ls-files -- dist-web-new2`.
- Reference evidence: tracked references identify `dist-web-new2` as generated/stale historical cleanup output, including `AGENTS.md` and `.claude/WORK_DETAIL.md`.
- Deletion guard verified the resolved absolute target was exactly `E:\hanhwa\fc-onboarding-app\dist-web-new2` before recursive removal.
- Post-delete checks:
  - `Test-Path dist-web-new2=False`.
  - `git ls-files -- dist-web-new2=<none>`.
  - `git status --short --untracked-files=all -- dist-web-new2=<none>`.
  - `git check-ignore -v --no-index -- dist-web-new2/foo` still maps to `.gitignore:11:dist-web-new2/`.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

Next safest candidates:

- Audit other ignored/generated local directories only if each target has the same tracked/ignored/generated evidence. Do not delete `dist/` because root `npm run build` currently regenerates it.
- Prefer the next runtime increment only after writing a fresh `current-contract.md`, especially for PII/auth/schema/bridge/push or large dashboard modules.

## User-Requested Local Verification Re-run

Status: completed on 2026-05-30.

Automated checks run:

- Passed: `npm test -- --runInBand`, 29 suites / 185 tests.
- Passed: `npm run lint`.
- Passed: `npm run build`; existing Expo/Sentry/web export warnings only.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`; existing baseline-browser-mapping and OpenTelemetry `import-in-the-middle` warnings only.
- Passed: intended direct Node characterization set, 104/104, with existing `MODULE_TYPELESS_PACKAGE_JSON` warnings.
- Passed: `npm run test:coverage -- --runInBand`, 29 suites / 185 tests; generated `coverage/` was removed after verification.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.

Notes:

- An exploratory all-candidate direct Node command failed only because it included `supabase/functions/_shared/__tests__/referral-search.test.ts`, which is a Jest-covered test with an extensionless import. That same file passed under root Jest in this run.
- No production code, schema, env, dependency, lockfile, route behavior, or UI behavior was changed during this verification-only pass.

Manual/external checks still required:

- Authenticated browser QA.
- Live Supabase/request_board bridge/password-sync smoke with paired secrets.
- Real device/browser push and badge checks.
- Supabase remote migration parity checks.

## Increment 20: Verification Debt Alignment

Status: completed on 2026-05-30.

What changed:

- Referral graph runtime/test force parameters were rebalanced to satisfy the v14 hybrid-force simulation contract: compact connected clusters, isolated nodes outside dense cores, bounded reheated graphs, and stable drag/link behavior.
- Root Jest coverage now uses the V8 coverage provider so `npm run test:coverage -- --runInBand` is a clean verification signal instead of exiting 0 while emitting Babel/TS coverage collection errors.
- No PII/auth/schema/bridge/request_board contract, env, dependency, lockfile, Supabase migration, or route behavior was intentionally changed.

Verification:

- Passed: graph simulation direct Node test, 20/20.
- Passed: adjacent graph direct Node tests, 34/34.
- Passed: full direct Node characterization set, 104/104.
- Passed: root Jest, 29 suites / 185 tests.
- Passed: root coverage, 29 suites / 185 tests.
- Passed: `npm run lint`.
- Passed: `npm run build`.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.
- Passed: local production HTTP smoke on port 3010: `/auth` 200, protected dashboard routes redirect to `/auth`; server stopped after the check.

Manual/external checks still required:

- Authenticated browser QA for `/dashboard/referrals/graph`: node drag, empty-space pan, reset, label readability, cluster readability, and isolated-node visual placement.
- Live Supabase/request_board bridge/password-sync smoke with paired secrets.
- Real device/browser push and badge checks.
- Supabase remote migration parity checks.

## Current Reconciliation: 2026-05-30

This repo was reconciled for the current goal and then Increment 20 closed the concrete verification debt found during the local test sweep. Increment 20 is now the latest completed fc-onboarding increment and is recorded above. Do not start Increment 21 or a broader fc runtime refactor without a fresh `current-contract.md`.

Current dirty state is broad but attributable to prior characterization/documentation work: PII trusted-path helpers/routes, cookie-first session restore helper, mobile unread/checkpoint helpers, request_board password-sync shared helper, handbook/docs, Jest harness alignment, and harness/work logs. Browser/runtime PII/auth smoke, live Supabase/request_board bridge checks, device/emulator checks, and remote migration parity remain deferred.

For the current cross-repo goal, the selected next narrow increment is in `request_board`, not this repo: Increment 22 bridge-login new-user payload plan closeout. Do not start fc-onboarding Increment 20 without a fresh `current-contract.md`.

Verification for this reconciliation:

- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.
- Reviewed: `git status --short --branch`.

## Current Status

Increment 19 completed `Root Jest Harness Alignment`. Root Jest now ignores only the direct `node:test` TypeScript characterization files that are intended to run through explicit `node --experimental-strip-types --test ...` commands, and `lib/__tests__/referral-tree.test.ts` now matches the current `DescendantNode.relationshipSource` contract. The previous Windows `os error 1450` was recorded as a resource execution failure; it did not recur under the resource-conscious `npm test -- --runInBand` retry. No production behavior, schema, env/secrets, package versions, lockfile, route contract, UI, or Increment 20 work was changed in this recovery.

Increment 18 completed request_board password-sync outbound fetch behavior characterization for the Supabase shared helper. `supabase/functions/_shared/request-board-password-sync.ts` now exports `buildRequestBoardPasswordSyncBody` and `syncRequestBoardPasswordWithDeps`, with direct Node coverage for body shape, missing URL/token skip, fetch init, timeout cleanup, non-2xx warning, unsuccessful JSON warning, and thrown fetch error warning before any broader bridge/password-sync cleanup. Env/secrets, caller role decisions, request_board inbound behavior, schemas, UI, and generated files were not intentionally changed.

## Key Repo Facts

- Repo: `E:\hanhwa\fc-onboarding-app`
- Role: Expo mobile FC onboarding + Next.js admin dashboard + Supabase functions/data.
- Branch observed at kickoff: `codex/referral-rollout-closeout`
- Git state at kickoff: clean.
- Main validation commands for later runtime increments:
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `cd web; npm run lint`
  - `cd web; npm run build`
  - `node scripts/ci/check-governance.mjs`

## Highest-Risk Areas

- Resident-number full-view, encrypted/plain fallback, log masking, trusted path.
- Admin/head-manager permissions and manager read-only behavior.
- Cookie-first web session restoration.
- Cross-repo bridge/password-sync secret drift with `request_board`.
- Supabase schema/migration remote-state assumptions.
- Notification fanout: board-create, board-update, `fc-notify`, bridge unread.
- Oversized modules:
  - `app/dashboard.tsx`
  - `web/src/app/dashboard/page.tsx`
  - `supabase/functions/fc-notify/index.ts`

## Recommended Next Increment

Recommended next step after increment 19: add the next characterization around one remaining high-risk contract before touching large modules or shared flows.

Candidates:

- focused dashboard manager write-protection characterization if it can be isolated from browser runtime,
- next cross-repo password-sync contract only if it targets caller role-option planning or live smoke with safe non-secret setup,
- browser/runtime smoke for cookie-first session restore and manager read-only if a dev server check is explicitly in scope,
- another small UI-facing PII display contract only if it can be isolated without route/API changes.

Why this next:

- The low-risk stale-doc and generated-output documentation increments have been handled.
- PII/session/bridge checkpoint/planning/orchestration helper characterizations are now in place, exam-applicant enrichment has coverage, dashboard/profile birth-date display has a shared helper, client session restore/read-only/mask calculations have a helper, password-sync outbound body/fetch behavior is characterized, and root Jest is aligned with the direct Node test harness; runtime manager write-protection and live cross-repo bridge behavior still need coverage before larger cleanup.
- This avoids touching high-risk contracts on search evidence alone.

## Increment 19 Verification

- Initial recovery classification: prior `npm test` retry stopped on Windows `os error 1450`; recorded as resource execution failure / retry pending, not assertion failure.
- Confirmed contract/diff:
  - `git status --short --branch`
  - `git diff --stat`
  - `git diff -- jest.config.js lib/__tests__/referral-tree.test.ts .codex/harness/current-contract.md`
- Passed: `npm test -- --runTestsByPath lib/__tests__/referral-tree.test.ts --runInBand` (1 suite, 3 tests).
- Passed: `node --experimental-strip-types --test web/src/lib/resident-number-route-handler.test.ts web/src/lib/referral-graph-physics.test.ts supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` (30 tests; existing `MODULE_TYPELESS_PACKAGE_JSON` warnings only).
- Passed: `npm test -- --runInBand` (29 suites, 185 tests). `os error 1450` did not recur.
- Passed: `npm run lint`.
- Passed: `npm run build` (Expo export; existing Sentry/Expo notifications/API-route export warnings only).
- Passed: `npm run lint` from `web/`.
- Passed: `npm run build` from `web/` (existing `baseline-browser-mapping` and OpenTelemetry `import-in-the-middle` warnings only).
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.
- Reviewed: `git status --short --branch`; accumulated dirty state remains and was not reverted.

Resume command if this needs to be rechecked:

```bash
npm test -- --runInBand
```

## Increment 15 Verification

- RED confirmed: `node --experimental-strip-types --test web/src/lib/resident-number-display.test.node.ts` failed before implementation with missing `resident-number-display.ts`.
- Passed: `node --experimental-strip-types --test web/src/lib/resident-number-display.test.node.ts` (3 tests).
- Passed: phone candidate and resident-number helper regression command (26 tests).
- Passed: targeted web lint for hook/display helper/profile page/direct Node test.
- Passed: `cd web; npm run build`.
- Passed: `npm run lint`.
- Deferred: `npm test` and root `npm run build` because increment 15 changed only web client display helper/hook/profile duplicate formatting, and root `npm test` is already documented as failing from existing harness/type issues in increment 14.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.
- Reviewed: `git status --short --branch` still contains this goal's accumulated fc-onboarding-app changes and untracked helper/test files.

## Increment 16 Verification

- RED confirmed: `node --experimental-strip-types --test web/src/lib/client-session-restore.test.node.ts` failed before implementation with missing `web/src/lib/client-session-restore.ts`.
- Passed: `node --experimental-strip-types --test web/src/lib/client-session-restore.test.node.ts` (4 tests).
- Passed: resident-number/session-adjacent helper regression command (29 tests).
- Passed: targeted web lint for session hook/helper/direct Node test.
- Passed: `cd web; npm run build`.
- Passed: `npm run lint`.
- Deferred: `npm test` and root `npm run build` because increment 16 changed only a web client-side pure session helper and hook delegation, and root `npm test` is already documented as failing from existing harness/type issues in prior increments.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.
- Reviewed: `git status --short --branch` still contains this goal's accumulated fc-onboarding-app changes and untracked helper/test files.

## Increment 17 Verification

- RED confirmed: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` failed before implementation with missing export `buildRequestBoardPasswordSyncBody`.
- Passed: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` (5 tests).
- Passed: `node scripts/ci/check-governance.mjs`.
- Note: governance failed once after path-owner-map changed because owner-doc enforcement applied to accumulated changed code domains; the required handbook owner docs were updated and governance passed on rerun.
- Passed: `git diff --check` with CRLF normalization warnings only.
- Reviewed: `git status --short --branch` still contains this goal's accumulated fc-onboarding-app changes and the new password-sync helper/test/path-owner-map changes.

## Increment 18 Verification

- RED confirmed: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` failed before implementation with missing export `syncRequestBoardPasswordWithDeps`.
- Passed: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` (10 tests).
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check` with CRLF normalization warnings only.
- Reviewed: `git status --short --branch` still contains this goal's accumulated fc-onboarding-app changes and the new password-sync injected helper/test changes.

## Required Guardrails For Later Work

- Add or identify characterization tests before extracting large dashboard/admin/notification modules.
- Treat generated/ignored output as local workspace cleanup only unless tracked or referenced by deployment.
- Do not change package versions without context7 checks and full root/web validation.
- Do not infer Supabase remote state from local migrations or schema files.
- Do not print, normalize, or edit secrets while auditing bridge config.
- Treat `dist/` as ignored Expo generated output. Rebuild it fresh for intentional static deploys; do not use stale local output as production evidence.
- Keep `web/src/lib/server-session.ts` re-exporting `buildPhoneCandidates` unless all route imports are intentionally migrated in a separate contract.
- Keep `FC_IDENTITY_DIRECT_DECRYPT_MODE` invalid values defaulting to `auto` with warning metadata; do not silently convert invalid mode to disabled/report-only.
- Keep resident-number edge fallback request shape stable: `admin-action`, service-role `apikey` + `Authorization`, and `payload.fcIds`.
- Keep resident-number edge fallback response success strict: HTTP ok, body `ok: true`, and object `residentNumbers`; preserve failure message priority `message` -> `error` -> default.
- Keep resident-number edge fallback execution diagnostics stable: missing-env unavailable logs, failed response `status`/`body`, and thrown fallback failure prefixes.
- Keep `/api/admin/resident-numbers` request `fcIds` normalization stable: array-only, `String(value ?? '')`, trim, blank filtering, and first-seen dedupe.
- Keep `/api/admin/resident-numbers` branch sequencing stable: session check before rate limit/body work, rate limit before JSON parsing, empty-list success before read, and generic 500 on read failure.
- Keep `/api/admin/exam-applicants` resident-number enrichment stable: exam row defaults, shared phone candidate matching, profile-id `fcIds` de-dupe, full resident-number replacement, and `주민번호 조회 실패` fallback literal.
- Keep admin dashboard/profile resident-number birth-date display on `formatResidentNumberBirthDateDisplay` via `useResidentNumber`; do not reintroduce separate local parsers in `/dashboard` or `/dashboard/profile/[id]`.
- Keep admin web client session restore cookie-first: if a valid cookie session exists, do not read/restore the localStorage snapshot first. Keep manager as the only client read-only role and keep resident id mask grouping in `formatSessionResidentMask`.
- Keep request_board password-sync outbound body construction anchored on `buildRequestBoardPasswordSyncBody`; do not change role/name/company/affiliation metadata shape without updating both this characterization and request_board inbound contract tests.
- Keep request_board password-sync outbound fetch behavior anchored on `syncRequestBoardPasswordWithDeps`; do not change missing URL/token skip, header names, timeout cleanup, warning text, JSON success handling, or non-throwing errors without updating characterization and request_board inbound expectations.
- Keep mobile unread checkpoint keys scoped by `role`, trimmed `residentId` (or `global`), and `requestBoardRole` (or `none`) so request_board FC/designer bridge users do not share checkpoint state accidentally.
- Keep mobile bridge unread planning stable: role-less sessions do not fetch or include live request_board unread; FC and requestBoardRole FC/designer sessions include live request_board unread; `exclude_request_board_categories` tracks that same inclusion flag.
- Keep mobile unread orchestration stable: checkpoint reads use `initializeIfMissing: false`, `fc-notify` gets the current body shape, live request_board unread is fetched only when included, and failures log `[mobile-unread-count] fetch failed` before returning `0`.
- Keep `.ts` extension imports out of production source; use them only in direct Node test files or inject dependencies when production helpers need testable seams.

## Skill / Tool State

- `hanhwa-session-grounding`: used.
- `long-running-app-harness`: used.
- Superpowers:
  - `using-superpowers`: used.
  - `dispatching-parallel-agents`: considered; not used because increment 18 is a tightly scoped helper/test edit.
  - `writing-plans`: used.
  - `test-driven-development`: used for RED/GREEN helper characterization.
  - `executing-plans`: considered and partially followed through current-contract execution; not separately invoked as a subagent workflow.
  - `verification-before-completion`: used before reporting this increment.
  - `systematic-debugging`: used in increment 14 after root/web build test-file collection failures; not needed in increment 16.
- Sequential Thinking: used for scope/risk/increment decomposition.
- context7: considered for increment 18; not used because no framework/library API decision was needed.
- Simplifier/simplify: considered; not used because no available Simplifier tool/env was present.
