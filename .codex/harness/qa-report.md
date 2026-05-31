# QA Report: Increment 1 Harness / Inventory

## Increment 25 Verification: Coverage Generated Artifact Hygiene

Date: 2026-05-31

### Scope

- Added `coverage/` to root `.gitignore`.
- Added `coverage` to `.vercelignore`.
- Removed only the generated untracked `coverage/` directory after verifying its resolved path was inside `E:\hanhwa\fc-onboarding-app`.
- No production source, tests, package scripts, dependencies, lockfiles, env files, schema/migrations, Supabase functions, request_board files, route behavior, PII/auth/session behavior, notification fanout, `dist/`, admin web `.next`, or deployment build settings changed.

### Evidence

- `package.json` defines `test:coverage=jest --coverage`, which generates Jest coverage output.
- Before this increment, `coverage/` was untracked and not ignored:
  - `git ls-files -- coverage` returned no tracked files.
  - `git status --short --untracked-files=all -- coverage` listed generated files under `coverage/`.
  - `git check-ignore -v coverage` had no match.
- Resolved deletion target: `E:\hanhwa\fc-onboarding-app\coverage`.
- Deleted generated artifact size: 104 files, 3,966,709 bytes.

### Commands

- Passed: `git check-ignore -v --no-index -- coverage/foo`.
  - Mapped future coverage output to `.gitignore:72:coverage/`.
- Passed: `Test-Path coverage`.
  - Returned `False`.
- Passed: `git status --short --untracked-files=all -- coverage`.
  - Returned no untracked coverage files.
- Passed: `Select-String -Path .gitignore,.vercelignore -Pattern 'coverage'`.
  - Found `.gitignore:72:coverage/` and `.vercelignore:8:coverage`.
- Passed: `node scripts\ci\check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.

### Manual / External Checks Still Required

- None for this generated-artifact hygiene increment.
- Broader goal still has external checks from prior increments: device/simulator WebView checks, authenticated mobile/admin flows, live Supabase/request_board bridge/password-sync smoke, real push/badge/deep-link checks, and Supabase remote migration parity.

### QA Judgment

- Increment 25 acceptance criteria are met.
- The work improves local state hygiene for future optimization/refactor passes and does not alter runtime behavior.
- No new repeatable mistake, regression, contract drift, or missed verification requiring `.claude/MISTAKES.md` was found.

## 2026-05-31 Current User-Requested Local Verification Re-run

Latest same-session refresh: after the user asked to run every locally possible test, the safe local checks were rerun again on 2026-05-31. The rerun passed `npx tsc --noEmit`, `npm run lint`, `npm test -- --runInBand` (29 suites / 185 tests), `npm run test:coverage -- --runInBand` (29 suites / 185 tests), the direct Node characterization command for current `web/src/lib` tests plus `request-board-password-sync.test.ts` (107 tests), `npm run build`, `cd web; npm run lint`, `cd web; npm run build`, Expo static export smoke on port `4315` for `/`, `/login.html`, and `/reset-password.html`, local Next production no-redirect smoke on port `4314` for `/reset-password`, `/auth`, and `/dashboard`, `node scripts\ci\check-governance.mjs`, `git diff --check`, and port cleanup for `4314` / `4315`.

### Scope

- Re-ran all currently safe local automated, build, governance, coverage, direct Node characterization, and unauthenticated runtime smoke checks for `fc-onboarding-app`.
- No production source, schema, env, dependency, lockfile, route behavior, mobile UI, admin web UI, or deployment config was intentionally changed by this verification-only pass.
- At the time of that verification-only pass, coverage output existed as accumulated untracked local state; Increment 25 later ignored and removed it as generated local output.

### Commands

- Passed: `npx tsc --noEmit`.
- Passed: `npm run lint`.
- Passed: `npm test -- --runInBand`.
  - 29 suites / 185 tests.
- Passed: `npm run test:coverage -- --runInBand`.
  - 29 suites / 185 tests.
  - Coverage summary was emitted successfully; no collection errors.
- Passed: direct Node characterization command for current `web/src/lib` tests and `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`.
  - 107 tests passed.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON`.
- Note: an earlier overly broad ad hoc Node command also included `supabase/functions/_shared/__tests__/referral-search.test.ts` and failed under direct Node ESM with `ERR_MODULE_NOT_FOUND` for its extensionless import. That same `referral-search.test.ts` passed in the Jest run above; the contract-relevant direct Node command was rerun without that Jest-only file and passed.
- Passed: `npm run build`.
  - Existing warnings only: Sentry native prebuild config missing, Expo notifications web listener limitation, and API route export skipped because `web.output` is not `server`.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`.
  - Existing warnings only: stale `baseline-browser-mapping` data and OpenTelemetry `import-in-the-middle` version mismatch warnings.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.
- Passed: Expo static export smoke on port `4315` using Python `http.server` against `dist`.
  - `/`: 200.
  - `/login.html`: 200.
  - `/reset-password.html`: 200.
- Note: two earlier ad hoc Node static-server attempts failed before serving because the temporary harness argument mapping was wrong. Python `http.server` also returned 404 for extensionless `/login` and `/reset-password` because it does not provide Expo/Vercel rewrite behavior; the final artifact checks used the generated `.html` files and passed.
- Passed: local Next production no-redirect smoke on port `4314`.
  - `/reset-password`: 200.
  - `/auth`: 200.
  - `/dashboard`: 307.
- Passed: post-smoke port cleanup check.
  - Ports `4314` and `4315` were clear.

### Manual / External Checks Still Required

- Real device or simulator check for Daum postcode WebView open/search/select/close behavior.
- Authenticated mobile checks for appointment submission and Hanwha commission submission against an approved backend target.
- Authenticated browser QA for real admin/manager/FC/designer sessions.
- Live Supabase/request_board bridge/password-sync smoke with paired approved secrets.
- Real device/browser push, badge, and deep-link checks.
- Supabase remote migration parity checks.

### QA Judgment

- All locally safe automated/build/governance/coverage/direct Node/unauthenticated runtime checks available for the current `fc-onboarding-app` workspace passed in this run.
- Remaining verification requires device/simulator interaction, credentials, approved backend targets, authenticated sessions, live bridge secrets, push subscription state, or remote infrastructure state.

## Increment 24 Verification: Root TypeScript NoEmit Alignment

Date: 2026-05-31

### Scope

- Fixed only root TypeScript noEmit blockers in localized mobile/type helper surfaces.
- No route names, Supabase schema/migrations, Edge Function names, request body shapes, env/secrets, package versions, lockfiles, auth/session semantics, PII trusted path behavior, notification fanout, request_board bridge behavior, or production deployment settings were changed.
- Added owner documentation for the referral self-service app-session error classification contract required by governance.

### Commands

- RED confirmed: `npx tsc --noEmit`.
  - Failed before implementation with localized errors in `app/appointment.tsx`, `app/hanwha-commission.tsx`, `app/referral.tsx`, `components/DaumPostcode.tsx`, and `hooks/use-my-referral-code.ts`.
- Passed: `npx tsc --noEmit`.
- Passed: `npm run lint`.
- Passed: `npm test -- --runInBand`.
  - 29 suites / 185 tests.
- Passed: direct Node characterization command for the current `web/src/lib` tests and `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`.
  - 22 files / 107 tests.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON`.
- Passed: `npm run build`.
  - Existing warnings only: Sentry native prebuild config missing, Expo notifications web listener limitation, and API route export skipped because `web.output` is not `server`.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`.
  - Existing warnings only: stale `baseline-browser-mapping` data and OpenTelemetry `import-in-the-middle` version mismatch warnings.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.
- Passed: Expo static export smoke on port 19006.
  - `/`: 200.
  - Port 19006 was clear after stop.
- Passed: no-redirect local Next production smoke on port 3100.
  - `/reset-password`: 200.
  - `/dashboard`: 307, `Location: /auth`.
  - Port 3100 was clear after stop.

### Non-Blocking Command Correction

- An initial PowerShell `Invoke-WebRequest` Next smoke confirmed `/reset-password=200` but did not capture the `/dashboard` redirect as intended.
- The leftover `node` listener on port 3100 was stopped, port cleanup was verified, and the smoke was rerun with a redirect-disabled .NET HTTP client.

### Manual / External Checks Still Required

- Real device or simulator check for Daum postcode WebView open/search/close behavior.
- Authenticated mobile checks for appointment submission and Hanwha commission submission against an approved non-production or explicit live target.
- Authenticated browser QA for real admin/manager/FC/designer sessions.
- Live Supabase/request_board bridge/password-sync smoke with paired approved secrets.
- Real device/browser push, badge, deep-link checks, and Supabase remote migration parity.

### QA Judgment

- Increment 24 restored root `npx tsc --noEmit` as a passing safety gate without intentional runtime contract changes.
- Locally runnable automated/build/governance/static smoke checks passed after the type alignment.
- Remaining checks require device/browser auth, approved backend targets, or remote infrastructure state.

## 2026-05-31 Fresh Local Verification Sweep

### Scope

- Re-ran every locally safe automated, build, governance, and unauthenticated runtime smoke check available for `fc-onboarding-app`.
- No production source, schema, env, dependency, lockfile, route behavior, or UI behavior was changed by this verification pass.

### Commands

- Passed: `npx tsc --noEmit`.
- Passed: `npm test -- --runInBand`.
  - 29 suites / 185 tests.
- Passed: `npm run test:coverage -- --runInBand`.
  - 29 suites / 185 tests.
  - Generated `coverage/` was removed after verifying the resolved path was inside the repo.
- Passed: direct Node characterization command for `web/src/lib/*.test.ts`, `web/src/lib/*.test.node.ts`, and `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`.
  - 22 files; 107 passed / 0 failed.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON`.
- Passed: `npm run lint`.
- Passed: `npm run build`.
  - Existing warnings only: Sentry native prebuild config missing, Expo notifications web listener limitation, and API route export skipped because `web.output` is not `server`.
- Passed: Expo static export smoke using Python static server on port `19006`.
  - `/`: 200.
  - Port 19006 was clear after stop.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`.
  - Existing warnings only: stale `baseline-browser-mapping` data and OpenTelemetry `import-in-the-middle` version mismatch warnings.
- Passed: local Next production smoke on port `3100` without following redirects.
  - `/reset-password`: 200.
  - `/dashboard`: 307.
  - Port 3100 was clear after stop.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.

### Manual / External Checks Still Required

- Authenticated browser QA for admin/manager/FC/designer role-specific flows.
- Password reset SMS/function flow against an approved non-production or explicit live target.
- Live Supabase/request_board bridge/password-sync smoke with paired approved secrets.
- Real device/browser push, badge, and deep-link checks.
- Supabase remote migration parity checks.

## Increment 23 Verification: Admin Web Reset Password Public Route Guard

Date: 2026-05-31

### Scope

- Added a pure admin web public-path helper and direct Node characterization test.
- Updated `web/middleware.ts` to include `/reset-password` in the shared public-path contract.
- No login, dashboard, admin, manager read-only, cookie-first session restore, Supabase reset function body, env/secrets, schema/migrations, request_board bridge/password-sync behavior, package version, lockfile, mobile route, PII behavior, notification/push fanout, or dashboard data flow changed.

### Evidence

- `web/src/app/auth/page.tsx` sends users to `/reset-password`.
- `web/src/app/reset-password/page.tsx` is the password reset/request form.
- Pre-fix no-redirect production smoke observed `/reset-password=307`, while `/dashboard` is expected to redirect when unauthenticated.
- `web/middleware.ts` had a local public path list that omitted `/reset-password`.

### Commands

- RED confirmed: `node --experimental-strip-types --test web/src/lib/admin-web-public-paths.test.ts`.
  - Failed before implementation with `ERR_MODULE_NOT_FOUND` for `admin-web-public-paths.ts`.
- Passed: `node --experimental-strip-types --test web/src/lib/admin-web-public-paths.test.ts`.
  - 3 tests passed.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON`.
- Passed: `node --experimental-strip-types --test web/src/lib/admin-web-public-paths.test.ts web/src/lib/client-session-restore.test.node.ts web/src/lib/request-board-url.test.ts web/src/lib/web-push-config.test.ts`.
  - 13 tests passed.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON`.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`.
  - Existing warnings only: stale `baseline-browser-mapping` data and OpenTelemetry `import-in-the-middle` version mismatch warnings.
- Passed: local Next production smoke on port 3100 without following redirects.
  - `/reset-password`: 200.
  - `/auth`: 200.
  - `/dashboard`: 307, `Location: /auth`.
  - Port 3100 was clear after stop.

- Passed: `npm test -- --runInBand`.
  - 29 suites / 185 tests.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.

### QA Judgment

- The route contract drift is fixed at the helper/middleware level and verified by no-redirect production smoke.
- The previous redirect-following smoke gap is recorded in `.claude/MISTAKES.md`.
- Increment 23 acceptance criteria are met.

## 2026-05-31 User-Requested Full Local Verification Sweep

### Scope

- Re-ran every locally safe automated, build, governance, and unauthenticated runtime smoke check available for the current dirty workspace.
- No production source, schema, env, dependency, lockfile, route behavior, or UI behavior was changed by this verification pass.

### Commands

- Passed: `npm run lint`.
- Passed: `npm test -- --runInBand`.
  - 29 suites / 185 tests.
- Passed: intended full direct Node characterization command for `web/src/lib/*.test.ts`, `web/src/lib/*.test.node.ts`, and `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`.
  - 21 files; 104 passed / 0 failed.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON`.
- Passed: `npm run build`.
  - Existing warnings only: Sentry native prebuild config missing, Expo notifications web listener limitation, and API route export skipped because `web.output` is not `server`.
- Passed: Expo static export smoke using Python static server on port 19006.
  - `/`: 200.
  - `/login.html`: 200.
  - `/dashboard.html`: 200.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`.
  - Existing warnings only: stale `baseline-browser-mapping` data and OpenTelemetry `import-in-the-middle` version mismatch warnings.
- Passed: local Next production smoke on port 3100.
  - `/auth`: 200.
  - `/dashboard`: 200.
  - `/reset-password`: 200.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.
- Confirmed: ports 3100 and 19006 were clear after runtime checks.

### Non-Blocking Command Correction

- An exploratory over-broad direct Node command that also included `supabase/functions/_shared/__tests__/referral-search.test.ts` failed under `node --experimental-strip-types --test` with `ERR_MODULE_NOT_FOUND` for the extensionless `../referral-search` import.
- This is not treated as an app regression because `referral-search.test.ts` is covered by root Jest, and `npm test -- --runInBand` passed with that suite included.

### Manual / External Checks Still Required

- Authenticated browser QA for admin/manager/FC/designer-specific flows.
- Live Supabase/request_board bridge/password-sync smoke with paired non-production or explicitly approved production secrets.
- Real device/browser push, badge, and deep-link checks.
- Supabase remote migration parity checks.

## Increment 22 Empty Legacy Export Directory Cleanup

Date: 2026-05-31

### Scope

- Removed only the ignored, untracked, file-empty legacy local Expo web export directory trees `dist-web/` and `dist-web-new/`.
- No production source, docs command examples, package scripts, deployment config, dependencies, lockfiles, env files, Supabase schema/migrations, runtime route behavior, PII/auth behavior, request_board bridge behavior, notification fanout, or UI behavior was changed.
- Current generated outputs were left untouched: `dist/` for root Expo export and `web/.next` for admin web build.

### Evidence

- Pre-delete filesystem audit showed both directory trees were old and file-empty:
  - `dist-web/`: empty nested directory tree under `assets/`, last write 2025-12-15, 0 file bytes.
  - `dist-web-new/`: empty nested directory tree under `_expo/static/js/web/`, last write 2025-12-15, 0 file bytes.
- `git ls-files -- dist-web dist-web-new` returned no tracked files.
- `git status --short --untracked-files=all -- dist-web dist-web-new` returned no source/untracked output.
- `git check-ignore -v -- dist-web dist-web-new dist-web/foo dist-web-new/foo` mapped both targets to `.gitignore:9:dist-web/` and `.gitignore:10:dist-web-new/`.
- `.vercelignore` excludes `dist-web` and `dist-web-new`.
- Tracked references use `dist-web` as a generated local/test export target; no reference requires empty directories to exist in the workspace.

### Commands

- Passed: guarded removal command.
  - Verified resolved target path was exactly `E:\hanhwa\fc-onboarding-app\dist-web`.
  - Verified resolved target path was exactly `E:\hanhwa\fc-onboarding-app\dist-web-new`.
  - Verified both targets stayed under `E:\hanhwa\fc-onboarding-app`.
  - Verified no tracked files existed under either target.
  - Verified both targets contained zero files.
  - Removed only `dist-web/` and `dist-web-new/`.
- Passed: post-delete artifact checks.
  - `Test-Path dist-web=False`.
  - `Test-Path dist-web-new=False`.
  - `git status --short --untracked-files=all -- dist-web dist-web-new` returned no source/untracked output.
  - `git check-ignore -v --no-index -- dist-web/foo dist-web-new/foo` returned the existing ignore rules.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.

### QA Judgment

- Increment 22 is a local workspace cleanup with no tracked runtime/config/source behavior change.
- The empty legacy export directories were removed based on explicit ignored/untracked/file-empty/generated evidence, not on absence of references alone.
- No `.claude/MISTAKES.md` update was needed; the existing generated/local-only guardrails already cover this pattern and no new repeated regression or missed verification was found.

## 2026-05-31 Local Verification Sweep

### Scope

- Re-ran locally available automated checks and unauthenticated runtime smoke checks after today's accumulated cleanup/refactor work.
- No production source, schema, env, dependency, lockfile, route behavior, or UI behavior was changed by this verification pass.

### Commands

- Passed: `npm test -- --runInBand`.
  - 29 suites / 185 tests.
- Passed: `npm run lint`.
- Passed: `npm run build`.
  - Existing warnings only: Sentry native prebuild config missing, Expo notifications web listener limitation, and API route export skipped because `web.output` is not `server`.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`.
  - Existing warnings only: stale `baseline-browser-mapping` data and OpenTelemetry `import-in-the-middle` version mismatch warnings.
- Passed: direct Node characterization command for `web/src/lib/*.test.ts`, `web/src/lib/*.test.node.ts`, and `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`.
  - 104 passed / 0 failed.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON`.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.
- Passed: local Next production smoke on port 3100.
  - `/auth`: 200.
  - `/dashboard`, `/dashboard/profile`, `/dashboard/referrals`, `/dashboard/notifications`: 307 redirect to `/auth`.
  - Server was stopped after verification; port 3100 was clear.

### QA Judgment

- Locally runnable automated and unauthenticated runtime checks are passing.
- Manual/external checks still required: authenticated browser QA for role-specific flows, live Supabase/request_board bridge/password-sync smoke, real device/browser push and badge checks, and Supabase remote migration parity.

## Increment 21 Legacy Generated Artifact Cleanup

Date: 2026-05-30

### Scope

- Removed only the ignored, untracked legacy local Expo web export artifact directory `dist-web-new2/`.
- No production source, docs command examples, package scripts, deployment config, dependencies, lockfiles, env files, Supabase schema/migrations, runtime route behavior, PII/auth behavior, request_board bridge behavior, notification fanout, or UI behavior was changed.

### Evidence

- Pre-delete size/state audit showed `dist-web-new2/` existed, was about 3.91 MB, and had an old last-write timestamp from 2026-02-11.
- `git ls-files -- dist-web-new2` returned no tracked files.
- `git check-ignore -v -- dist-web-new2` mapped the directory to `.gitignore:11:dist-web-new2/`.
- `git grep` found `dist-web-new2` only in ignore/deploy docs, harness/work logs, and historical cleanup notes. `AGENTS.md` records the 2026-02-11 cleanup as removing `dist-web-new2/*` and says to watch for accidental artifact reintroduction.
- Current generated outputs are `dist/` for root Expo export and `web/.next` for admin web build; both were explicitly out of scope and left in place.

### Commands

- Passed: pre-delete guarded removal command.
  - Verified resolved target path was exactly `E:\hanhwa\fc-onboarding-app\dist-web-new2`.
  - Verified target path stayed under `E:\hanhwa\fc-onboarding-app`.
  - Verified no tracked files existed under the target.
  - Verified `.gitignore:11:dist-web-new2/` ignored the target.
  - Removed only `dist-web-new2/`.
- Passed: post-delete artifact checks.
  - `Test-Path dist-web-new2=False`.
  - `git ls-files -- dist-web-new2=<none>`.
  - `git status --short --untracked-files=all -- dist-web-new2=<none>`.
  - `git check-ignore -v --no-index -- dist-web-new2/foo` returned `.gitignore:11:dist-web-new2/`.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.

### QA Judgment

- Increment 21 is a local workspace cleanup with no tracked runtime/config/source behavior change.
- The stale artifact was removed based on explicit ignored/untracked/generated evidence, not on absence of references alone.
- No `.claude/MISTAKES.md` update was needed; the existing generated/local-only guardrails already cover this pattern and no new repeated regression or missed verification was found.

## User-Requested Local Verification Re-run

Date: 2026-05-30

### Scope

- Re-ran all locally available automated checks that do not require live credentials, production deploy access, physical devices, or authenticated browser operation.
- No production code, schema, env, dependency, lockfile, route behavior, or UI behavior was changed during this verification-only pass.

### Commands

- Passed: `npm test -- --runInBand`.
  - 29 suites / 185 tests.
- Passed: `npm run lint`.
- Passed: `npm run build`.
  - Existing warnings only: Sentry native prebuild config missing, Expo notifications web listener limitation, API route export skipped because `web.output` is not `server`.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`.
  - Existing warnings only: stale `baseline-browser-mapping` data and OpenTelemetry `import-in-the-middle` version mismatch warnings.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.
- Exploratory all-candidate direct Node command failed because it included `supabase/functions/_shared/__tests__/referral-search.test.ts`, which is a Jest-covered test with an extensionless import that is not directly runnable under Node ESM.
  - The same `referral-search.test.ts` passed under root Jest in this run.
- Passed: intended direct Node characterization command for `web/src/lib/*.test.ts`, `web/src/lib/*.test.node.ts`, and `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`.
  - 21 files; 104 passed / 0 failed.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON`.
- Passed: `npm run test:coverage -- --runInBand`.
  - 29 suites / 185 tests.
  - Generated `coverage/` was confirmed inside the repo and removed after the run.

### QA Judgment

- Locally runnable automated verification is passing.
- The only failed command was an exploratory wrong-runner invocation for a Jest-owned test file; the intended runner for that file passed.
- Manual/external checks still required: authenticated browser QA, live Supabase/request_board bridge/password-sync smoke, real device/browser push and badge checks, and Supabase remote migration parity.

## Increment 20 Verification Debt Alignment

Date: 2026-05-30

### Scope

- Fixed the concrete referral graph simulation failures found during the local verification sweep.
- Aligned root coverage collection so `npm run test:coverage -- --runInBand` no longer emits hidden JSX/Babel or TypeScript coverage collection errors while exiting 0.
- No PII/auth/schema/bridge/request_board contract, env, dependency, lockfile, Supabase migration, or route behavior was intentionally changed.

### Root Cause / Fix Evidence

- Graph simulation failures came from the current force balance pushing connected components too wide while singleton gravity/spacing allowed isolated and connected distributions to violate the documented v14 hybrid-force contract.
- `ReferralGraphCanvas.tsx` and the matching simulation test helper now use a narrower cross-component/component-separation envelope, stronger connected-cluster gravity, and much weaker singleton center pull.
- `jest.config.js` now uses the V8 coverage provider, preserving the Increment 19 root Jest/direct Node split while avoiding the previous Babel coverage collection errors.
- The generated `coverage/` directory from verification was confirmed inside the repo and removed after the run.

### Commands

- Passed: `node --experimental-strip-types --test .\web\src\lib\referral-graph-simulation.test.ts`
  - 20 passed / 0 failed.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON` for direct TypeScript ESM tests.
- Passed: adjacent graph direct Node command for layout/physics/edges/display/highlight/interaction tests.
  - 34 passed / 0 failed.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON`.
- Passed: full direct Node characterization command including all `web/src/lib/*.test.ts`, `*.test.node.ts`, and `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`.
  - 104 passed / 0 failed.
  - Existing warning: `MODULE_TYPELESS_PACKAGE_JSON`.
- Passed: `npm test -- --runInBand`.
  - 29 suites / 185 tests.
- Passed: `npm run test:coverage -- --runInBand`.
  - 29 suites / 185 tests.
  - No prior JSX/Babel or `hooks/use-my-referral-code.ts` coverage collection errors remained.
- Passed: `npm run lint`.
- Passed: `npm run build`.
  - Existing warnings only: Sentry native prebuild config missing, Expo notifications web listener limitation, API route export skipped because `web.output` is not `server`.
- Passed: `cd web; npm run lint`.
- Passed: `cd web; npm run build`.
  - Existing warnings only: stale `baseline-browser-mapping` data and OpenTelemetry `import-in-the-middle` version mismatch warnings.
- Passed: `node scripts/ci/check-governance.mjs`.
- Passed: `git diff --check`.
  - CRLF normalization warnings only.
- Passed: local web HTTP smoke with production `next start -p 3010`.
  - `/auth`: 200.
  - `/dashboard`: 307 to `/auth` when unauthenticated.
  - `/dashboard/referrals/graph`: 307 to `/auth` when unauthenticated.
  - Test server was stopped and port 3010 was cleared.

### QA Judgment

- Increment 20 automated acceptance criteria are met.
- `RF-ADMIN-08` is not marked PASS because authenticated browser visual QA for drag/pan/reset/label readability and live graph appearance still requires a human/browser session.
- Remaining manual/external checks: authenticated graph browser QA, live Supabase/request_board bridge/password-sync smoke, push/badge checks on real subscribed clients, and Supabase remote migration parity.

## Current Reconciliation Snapshot: 2026-05-30

### Scope

- Read-only/status reconciliation for `fc-onboarding-app`.
- No new production code, schema, env, dependency, asset, UI, or runtime route change was started in this goal.
- Increment 19 completion state was checked against harness and work logs.

### Increment 19 Consistency

- `current-contract.md`: `Current Contract: Increment 19 Root Jest Harness Alignment`, status `completed`, includes verification results.
- `qa-report.md`: contains Increment 19 recovery note and verification section.
- `handoff.md`: current status says Increment 19 completed and lists the same verification evidence.
- `plan.md`: records Increment 19 decision under test gaps.
- `product-spec.md`: latest completed increment is Increment 19.
- `.claude/WORK_DETAIL.md`: contains `20260530-root-jest-harness-alignment`.
- `.claude/WORK_LOG.md`: contains the 05-30 root Jest harness alignment row.

### Dirty State Map

| File | Purpose | Related increment | Prod behavior impact | Verification done | Remaining verification | User change? | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.claude/MISTAKES.md` | Mistake ledger guardrails for prior PII/test import/resource issues | prior increments | none direct | governance/diff hygiene in prior checks | none unless new mistake found | no | low |
| `.claude/WORK_DETAIL.md` | Detailed work evidence including Increment 19 | Increment 19 and prior | none | Increment 19 checks | none | no | low |
| `.claude/WORK_LOG.md` | Recent work index | Increment 19 and prior | none | governance | line-count/governance on next doc edit | no | low |
| `.codex/harness/current-contract.md` | Completed Increment 19 contract | Increment 19 | none | Increment 19 verification recorded | replace only under next fc contract | no | low |
| `.codex/harness/handoff.md` | Current handoff and next candidate notes | Increment 19 and prior | none | Increment 19 verification recorded | keep current if next fc increment selected | no | low |
| `.codex/harness/plan.md` | Long-running cleanup plan | all cleanup increments | none | governance/diff hygiene | keep updated per increment | no | low |
| `.codex/harness/product-spec.md` | Cleanup program product spec | all cleanup increments | none | governance/diff hygiene | keep updated per increment | no | low |
| `.codex/harness/qa-report.md` | QA evidence ledger | all cleanup increments | none | Increment 19 verification recorded | keep command results fresh | no | low |
| `CLAUDE.md`, `README.md`, `docs/deployment/DEPLOYMENT.md`, `docs/guides/COMMANDS.md`, `docs/guides/명령어 모음집.txt` | Deployment/command/stale docs cleanup | prior docs increments | none direct | governance in prior checks | doc consistency only | no | low |
| `docs/handbook/admin-web/dashboard-lifecycle.md`, `docs/handbook/admin-web/exam-and-referral-ops.md`, `docs/handbook/backend/notifications-inbox-push.md`, `docs/handbook/data/identity-and-pii.md`, `docs/handbook/path-owner-map.json`, `docs/handbook/shared/cross-repo-bridge-contract.md` | Handbook owner/contract updates for PII, notifications, bridge | prior high-risk characterization increments | none direct | governance in prior checks | re-run governance after handbook edits | no | medium |
| `jest.config.js` | Root Jest ignores direct Node `.test.ts` characterization files | Increment 19 | test harness only | root Jest/lint/build/web/governance passed | none unless test paths change | no | low |
| `lib/__tests__/referral-tree.test.ts` | Jest fixture contract fix | Increment 19 | test only | targeted Jest and root Jest passed | none | no | low |
| `lib/mobile-unread-notification-count.ts`, `lib/mobile-unread-notification-count-plan.ts`, `lib/__tests__/mobile-unread-notification-count-plan.test.ts` | Mobile unread planning/orchestration characterization | prior unread increments | behavior-preserving helper extraction | prior targeted tests and root verification in Increment 19 | runtime badge smoke deferred | no | medium |
| `lib/notification-checkpoint.ts`, `lib/__tests__/notification-checkpoint.test.ts` | Unread checkpoint key characterization | prior unread increments | behavior-preserving helper export | prior targeted tests and root verification in Increment 19 | runtime badge smoke deferred | no | medium |
| `supabase/functions/_shared/request-board-password-sync.ts`, `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` | Outbound request_board password-sync body/fetch characterization | Increments 17-18 | behavior-preserving helper export | direct Node tests and Increment 19 direct Node command passed | live bridge/password sync smoke deferred | no | high |
| `web/src/app/api/admin/exam-applicants/route.ts`, `web/src/app/api/admin/resident-numbers/route.ts`, `web/src/app/dashboard/profile/[id]/page.tsx`, `web/src/hooks/use-resident-number.ts`, `web/src/hooks/use-session.tsx`, `web/src/lib/server-resident-numbers.ts`, `web/src/lib/server-session.ts` | PII/session route/helper rewiring to characterized helpers | PII/session increments 4-16 | intended behavior-preserving | direct Node helper tests, lint/build, Increment 19 root/web checks | browser/runtime PII/auth smoke deferred | no | high |
| `web/src/lib/client-session-restore.*`, `web/src/lib/exam-applicant-resident-number-enrichment.*`, `web/src/lib/phone-candidates.*`, `web/src/lib/resident-number-display.*`, `web/src/lib/resident-number-edge-*`, `web/src/lib/resident-number-route-*`, `web/src/lib/resident-number-runtime.*` | Untracked direct Node helpers/tests for PII/session characterization | PII/session increments 4-16 | intended behavior-preserving | direct Node tests and web lint/build in prior increments; root Jest aligned in Increment 19 | browser/runtime smoke deferred | no | high |

### Risk Summary

- High: PII trusted-path helpers/routes, cookie-first session restore, request_board password-sync, notification/unread behavior.
- Medium: handbook owner docs and mobile unread helper extractions because they anchor future runtime refactors.
- Low: harness/work-log/doc-only files and Increment 19 Jest harness config/test fixture changes.

### File-Level Dirty State Index

| File | Classification | Risk |
| --- | --- | --- |
| `.claude/MISTAKES.md` | mistake ledger guardrail update from prior increments | low |
| `.claude/WORK_DETAIL.md` | work-detail evidence including Increment 19 | low |
| `.claude/WORK_LOG.md` | work-log index including Increment 19 | low |
| `.codex/harness/current-contract.md` | completed Increment 19 contract | low |
| `.codex/harness/handoff.md` | handoff/current status | low |
| `.codex/harness/plan.md` | long-running plan/current reconciliation | low |
| `.codex/harness/product-spec.md` | product spec/current reconciliation | low |
| `.codex/harness/qa-report.md` | QA/dirty-state evidence | low |
| `CLAUDE.md` | stale docs/deployment guidance cleanup | low |
| `README.md` | stale docs cleanup | low |
| `docs/deployment/DEPLOYMENT.md` | deployment docs cleanup | low |
| `docs/guides/COMMANDS.md` | command docs cleanup | low |
| `docs/guides/명령어 모음집.txt` | command docs cleanup | low |
| `docs/handbook/admin-web/dashboard-lifecycle.md` | admin web PII/session contract docs | medium |
| `docs/handbook/admin-web/exam-and-referral-ops.md` | admin exam/referral owner docs | medium |
| `docs/handbook/backend/notifications-inbox-push.md` | notification/unread contract docs | medium |
| `docs/handbook/data/identity-and-pii.md` | PII contract docs | medium |
| `docs/handbook/path-owner-map.json` | governance owner map | medium |
| `docs/handbook/shared/cross-repo-bridge-contract.md` | cross-repo bridge contract docs | medium |
| `jest.config.js` | Increment 19 root Jest direct-Node-test ignore | low |
| `lib/__tests__/referral-tree.test.ts` | Increment 19 test fixture contract fix | low |
| `lib/mobile-unread-notification-count.ts` | mobile unread orchestration helper wiring | medium |
| `lib/notification-checkpoint.ts` | unread checkpoint key helper export | medium |
| `supabase/functions/_shared/request-board-password-sync.ts` | password-sync body/fetch helper extraction | high |
| `web/src/app/api/admin/exam-applicants/route.ts` | PII enrichment helper wiring | high |
| `web/src/app/api/admin/resident-numbers/route.ts` | PII route handler/helper wiring | high |
| `web/src/app/dashboard/profile/[id]/page.tsx` | resident-number display helper reuse | high |
| `web/src/hooks/use-resident-number.ts` | resident-number display hook reuse | high |
| `web/src/hooks/use-session.tsx` | cookie-first client session helper reuse | high |
| `web/src/lib/server-resident-numbers.ts` | PII direct decrypt/edge fallback helper wiring | high |
| `web/src/lib/server-session.ts` | phone-candidate helper re-export | high |
| `lib/__tests__/mobile-unread-notification-count-plan.test.ts` | untracked mobile unread characterization test | medium |
| `lib/__tests__/notification-checkpoint.test.ts` | untracked checkpoint characterization test | medium |
| `lib/mobile-unread-notification-count-plan.ts` | untracked mobile unread planning helper | medium |
| `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` | untracked password-sync characterization test | high |
| `web/src/lib/client-session-restore.test.node.ts` | untracked session restore characterization test | high |
| `web/src/lib/client-session-restore.ts` | untracked session restore helper | high |
| `web/src/lib/exam-applicant-resident-number-enrichment.test.node.ts` | untracked PII enrichment characterization test | high |
| `web/src/lib/exam-applicant-resident-number-enrichment.ts` | untracked PII enrichment helper | high |
| `web/src/lib/phone-candidates.test.ts` | untracked phone candidate characterization test | high |
| `web/src/lib/phone-candidates.ts` | untracked phone candidate helper | high |
| `web/src/lib/resident-number-display.test.node.ts` | untracked resident-number display characterization test | high |
| `web/src/lib/resident-number-display.ts` | untracked resident-number display helper | high |
| `web/src/lib/resident-number-edge-executor.test.ts` | untracked edge fallback executor test | high |
| `web/src/lib/resident-number-edge-executor.ts` | untracked edge fallback executor helper | high |
| `web/src/lib/resident-number-edge-fallback.test.ts` | untracked edge fallback request test | high |
| `web/src/lib/resident-number-edge-fallback.ts` | untracked edge fallback request helper | high |
| `web/src/lib/resident-number-edge-response.test.ts` | untracked edge fallback response test | high |
| `web/src/lib/resident-number-edge-response.ts` | untracked edge fallback response helper | high |
| `web/src/lib/resident-number-route-handler.test.ts` | untracked resident-number route handler test | high |
| `web/src/lib/resident-number-route-handler.ts` | untracked resident-number route handler helper | high |
| `web/src/lib/resident-number-route-request.test.ts` | untracked resident-number route request test | high |
| `web/src/lib/resident-number-route-request.ts` | untracked resident-number route request helper | high |
| `web/src/lib/resident-number-runtime.test.ts` | untracked resident-number runtime mode test | high |
| `web/src/lib/resident-number-runtime.ts` | untracked resident-number runtime mode helper | high |

### CRLF / Tooling Notes

- `git diff --check` in Increment 19 passed with CRLF normalization warnings only; these are Git working-copy normalization warnings, not whitespace-error findings.
- A current `rg` search attempt failed to start from the WindowsApps Codex-bundled `rg.exe` path with access denied. Search fallback used PowerShell `Select-String`; no repo code was changed because of this local tool failure.

### Verification Performed For This Reconciliation

- `node scripts/ci/check-governance.mjs`
  - Result: passed.
- `git diff --check`
  - Result: exit 0 with CRLF normalization warnings only.
- `git status --short --branch`
  - Result: reviewed; accumulated dirty state remains and was not reverted.

Not run:

- `npm run lint`, `npm test`, `npm run build`, `cd web; npm run lint`, `cd web; npm run build`.
- Browser/runtime, live Supabase/request_board bridge, and device/emulator checks.

Reason: this reconciliation edited only harness documentation in this repo. Increment 19 already has fresh full verification recorded above.

## Increment 19 Recovery Note: Resource Execution Failure / Retry Pending

Date: 2026-05-30

- Active contract: `Current Contract: Increment 19 Root Jest Harness Alignment`.
- Recovery state: the previous root Jest retry was interrupted by Windows `os error 1450` / `시스템 리소스가 부족하기 때문에 요청한 서비스를 완성할 수 없습니다`.
- QA classification: resource execution failure, not a Jest assertion failure and not a product/runtime regression.
- Retry plan: verify the changed fixture with `npm test -- --runTestsByPath lib/__tests__/referral-tree.test.ts --runInBand`, verify direct Node characterization tests with `node --experimental-strip-types --test ...`, then retry root Jest using `npm test -- --runInBand` exactly once. If `os error 1450` recurs, stop repeated retries and record it as a local resource blocker.
- Scope guard: no Increment 20 work, production behavior change, schema/env/package/lockfile change, runtime route change, UI change, or unrelated dirty worktree revert is allowed during this recovery.

## Increment 19 Verification

### Scope

- Root Jest harness alignment only.
- `jest.config.js` excludes direct `node:test` TypeScript characterization files from root Jest collection:
  - `<rootDir>/web/src/lib/.*\\.test\\.ts$`
  - `<rootDir>/supabase/functions/_shared/__tests__/request-board-password-sync\\.test\\.ts$`
- `lib/__tests__/referral-tree.test.ts` fixture now uses `relationshipSource: 'linked'`, matching the current `DescendantNode` contract.
- No production source behavior, schema, env/secrets, package versions, lockfile, Supabase migration, UI, route contract, or Increment 20 work was changed in this recovery.

### Commands

- Read-only state:
  - `git status --short --branch` reviewed; branch `codex/referral-rollout-closeout...origin/codex/referral-rollout-closeout` with accumulated dirty state.
  - `git diff --stat` reviewed; broad accumulated diff from prior increments remains.
  - `git diff -- jest.config.js lib/__tests__/referral-tree.test.ts .codex/harness/current-contract.md` reviewed.
- Small Jest verification: `npm test -- --runTestsByPath lib/__tests__/referral-tree.test.ts --runInBand`
  - Passed: 1 suite, 3 tests.
- Direct Node characterization verification: `node --experimental-strip-types --test web/src/lib/resident-number-route-handler.test.ts web/src/lib/referral-graph-physics.test.ts supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`
  - Passed: 30 tests.
  - Existing Node warning: `MODULE_TYPELESS_PACKAGE_JSON` for direct `.ts` ESM test files.
- Root Jest retry: `npm test -- --runInBand`
  - Passed: 29 suites, 185 tests.
  - `os error 1450` did not recur.
- Root lint: `npm run lint`
  - Passed.
- Root build: `npm run build`
  - Passed.
  - Existing warnings: Sentry native prebuild config missing, Expo notifications web listener limitation, API route export skipped because `web.output` is not `server`.
- Web lint: `npm run lint` from `web/`
  - Passed.
- Web build: `npm run build` from `web/`
  - Passed.
  - Existing warnings: stale `baseline-browser-mapping` data and OpenTelemetry `import-in-the-middle` version mismatch warnings.
- Governance: `node scripts/ci/check-governance.mjs`
  - Passed.
- Diff hygiene: `git diff --check`
  - Passed with CRLF normalization warnings only.
- Final status: `git status --short --branch`
  - Reviewed; accumulated dirty state remains and was not reverted.

### QA Judgment

- Increment 19 acceptance criteria are met.
- Root Jest no longer fails on the checkpoint TS5097/direct-Node-test collection issue or the `referral-tree` fixture type drift.
- Direct Node characterization tests remain runnable through the explicit Node command path.
- The prior `os error 1450` is resolved for this pass as a local resource interruption that did not recur under `--runInBand`.
- Browser/runtime, live Supabase/request_board bridge, and device/emulator checks were not run because this increment changed only test harness discovery and a Jest fixture value.
- No `.claude/MISTAKES.md` update was added for this recovery; no new repeatable regression, contract drift, or missed verification was found.

## Verification Performed

### Workspace / Repo State

- `git -C E:\hanhwa\fc-onboarding-app status --short --branch`
  - Result at kickoff: branch `codex/referral-rollout-closeout...origin/codex/referral-rollout-closeout`, clean.
- `git -C E:\hanhwa\fc-onboarding-app remote -v`
  - Result: origin `https://github.com/jj8127/Appointment-Process.git`.

### Post-Edit Verification

- `git -C E:\hanhwa\fc-onboarding-app status --short --branch`
  - Result: only `.codex/harness/current-contract.md`, `.codex/harness/handoff.md`, `.codex/harness/plan.md`, `.codex/harness/product-spec.md`, and `.codex/harness/qa-report.md` are modified.
- `git -C E:\hanhwa\fc-onboarding-app diff --name-only -- .codex/harness`
  - Result: same five harness files only.
  - Note: git emitted LF-to-CRLF warnings for these markdown files.
- `rg -n "Evidence-Based Cleanup|Increment 1|unused|duplicate|stale docs|dead assets|obsolete deps|risky scripts/config|performance|oversized modules|contract/type drift|test gaps" ...`
  - Result: required increment title and all cleanup/refactor categories were found in the harness docs.
- A broader initial `rg` over the full `.codex/harness` directory also matched old evidence logs and browser profile artifacts under harness evidence directories. This was not used as cleanup proof; the final content verification was restricted to the five current harness markdown files.

### Grounding Documents Read

- `E:\hanhwa\AGENTS.md`
- `C:\Users\jj812\.codex\skills\hanhwa-session-grounding\SKILL.md`
- `C:\Users\jj812\.codex\skills\hanhwa-session-grounding\references\document-bundles.md`
- `E:\hanhwa\long-running-app-harness\SKILL.md`
- `AGENTS.md`
- `README.md`
- `.claude/PROJECT_GUIDE.md`
- `.claude/WORK_LOG.md`
- `.claude/MISTAKES.md`
- `package.json`
- `web/package.json`
- `.gitignore`
- `.github/workflows/governance-check.yml`
- `docs/handbook/INDEX.md`
- `docs/handbook/workflow-state-matrix.md`
- `docs/handbook/mobile/fc-onboarding.md`
- `docs/handbook/admin-web/dashboard-lifecycle.md`
- `docs/handbook/backend/admin-operations-api.md`
- `docs/handbook/data/data-model-canon.md`
- `docs/handbook/backend/notifications-inbox-push.md`
- selected `.claude/WORK_DETAIL.md` anchors for recent notification, manager visibility, and cleanup history.

### Inventory Evidence Collected

- Active repo classification:
  - target repo: `fc-onboarding-app`
  - adjacent target repo: `request_board`
  - read-only candidates: `_codex_fc_onboarding_push_20260324_02`, `_codex_request_board_push_20260324_01`, `_tmp_fc_push2`
  - support/artifact directories: `long-running-app-harness`, `.claude`, `.codex`, `.codex-tmp`, `test-results`
- CI/governance:
  - `.github/workflows/governance-check.yml` runs Node 20 governance checks.
  - `scripts/ci/check-governance.mjs` is the local governance command.
- Generated artifacts:
  - `.gitignore` ignores `dist/`, `dist-web*`, `.expo/`, `.vercel`, `.codex/`, `.codex-tmp/`, and local env/settings files.
  - `dist/` contains generated Expo web output and is not tracked by git.
- Large module evidence:
  - `app/dashboard.tsx` ~3954 lines.
  - `web/src/app/dashboard/page.tsx` ~3279 lines.
  - `app/index.tsx` ~2422 lines.
  - `app/admin-board-manage.tsx` ~2061 lines.
  - `app/request-board-messenger.tsx` ~2057 lines.
  - `app/board.tsx` ~2025 lines.
  - `supabase/functions/fc-notify/index.ts` ~1445 lines.
- Documentation drift hypothesis:
  - `README.md` and `AGENTS.md` appear to disagree on linked designer profile count (`54` vs `59`); not yet corrected because canonical source is not verified.

## Not Run In This Increment

These checks were intentionally not run before/while editing increment 1 because only harness documentation is changed:

- `npm run lint`
- `npm test`
- `npm run build`
- `cd web; npm run lint`
- `cd web; npm run build`
- `node scripts/ci/check-governance.mjs`
- browser/runtime smoke tests

They are required for any later increment that changes runtime source, dependency graph, schema, CI, deployment, or user-facing behavior.

## Current QA Judgment

- No runtime code/config/assets were edited in increment 1.
- Cleanup candidates are documented as hypotheses unless backed by strong evidence.
- High-risk areas remain untouched.
- No mistake-ledger update is required for this increment because no repeatable implementation mistake or regression was introduced.

## Increment 2 Verification

### Scope

- Corrected stale docs only:
  - `README.md`
  - `.claude/WORK_LOG.md`
  - `.claude/WORK_DETAIL.md`
  - `.codex/harness/*`
- No runtime source, dependency, env, schema, migration, build, or deployment files were intentionally edited.

### Evidence

- `README.md` declares `AGENTS.md` as source of truth.
- `AGENTS.md` records request_board-linked designer profiles as `59명`.
- `README.md` previously had `54명`; increment 2 aligns it to `59명`.
- This is a doc-source-of-truth sync only; no fresh live DB verification was performed or claimed.

### Commands

- `rg -n -C 3 "request_board-linked 설계매니저 프로필|현재 앱 DB 기준" README.md AGENTS.md`
  - Result: both `README.md` and `AGENTS.md` now show `59명`.
- `git -C E:\hanhwa\fc-onboarding-app diff --name-only`
  - Result: modified files are `.claude/WORK_DETAIL.md`, `.claude/WORK_LOG.md`, `.codex/harness/*`, and `README.md`.
  - Note: git emitted LF-to-CRLF warnings for modified markdown files.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.

### Not Run

- `npm run lint`
- `npm test`
- `npm run build`
- `cd web; npm run lint`
- `cd web; npm run build`

Reason: increment 2 touched documentation/harness only and did not change runtime code/config.

## Increment 3 Verification

### Scope

- Clarified generated Expo web output and deployment documentation only:
  - `docs/deployment/DEPLOYMENT.md`
  - `docs/guides/COMMANDS.md`
  - `docs/guides/명령어 모음집.txt`
  - `CLAUDE.md`
  - `.claude/WORK_LOG.md`
  - `.claude/WORK_DETAIL.md`
  - `.codex/harness/*`
- No runtime source, dependency, env, schema, migration, Vercel config, package script, or generated output was intentionally edited.
- `dist/` was not deleted.

### Evidence

- Root `package.json` build script remains `expo export --platform web`.
- `.gitignore` ignores `dist/`, `dist-web/`, `dist-web-new/`, `dist-web-new2/`, and `web-build/`.
- `.vercelignore` excludes `dist` and `dist-web*`.
- Root `vercel.json` builds admin web with `cd web && npm run build` and output `web/.next`.
- `web/vercel.json` targets Next.js `.next`.
- Context7 Expo docs confirmed `npx expo export --platform web` generates `dist` by default.

### Commands

- `git ls-files dist`
  - Result: no output; `dist/` is not tracked source.
- `git status --ignored --short -- dist`
  - Result: `!! dist/`; local `dist/` is ignored generated output.
- `rg -n --glob '!dist/**' --glob '!node_modules/**' "vercel deploy dist|dist/web|dist-web|expo export -p web|expo export --platform web" README.md AGENTS.md docs CLAUDE.md AI.md package.json vercel.json .vercelignore web\vercel.json`
  - Result: remaining matches are expected or intentionally documented:
    - `.vercelignore` ignores legacy generated output directories.
    - `package.json` keeps the source build script.
    - `CLAUDE.md`, `docs/guides/COMMANDS.md`, and `docs/guides/명령어 모음집.txt` keep `dist-web` only for Testsprite-specific local test bundles.
    - `docs/deployment/DEPLOYMENT.md` and `docs/guides/명령어 모음집.txt` keep `vercel deploy dist --prod` only for intentional freshly generated Expo static deployment.
    - `AGENTS.md` match is a historical cleanup work-log entry and was not edited.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- `git diff --name-only`
  - Result: modified files are documentation/log/harness files plus the previous increment's `README.md`; git emitted LF-to-CRLF warnings for markdown/text files.

### Not Run

- `npm run lint`
- `npm test`
- `npm run build`
- `cd web; npm run lint`
- `cd web; npm run build`

Reason: increment 3 touched documentation, logs, and harness only. It did not change runtime source, package scripts, deployment config, or dependencies.

### QA Judgment

- Admin web deployment docs now point to the current root Vercel config and `web/` Next.js output.
- Expo web static export docs now treat `dist/` as ignored generated output that must be freshly rebuilt before intentional static deployment.
- `dist/` deletion remains deferred because the evidence supports local generated-output cleanup, not tracked source cleanup.
- No mistake-ledger update is required for this increment because no regression, repeated implementation mistake, or missed verification was introduced.

## Increment 4 Verification

### Scope

- Extracted existing web phone candidate generation into:
  - `web/src/lib/phone-candidates.ts`
- Preserved existing route import compatibility through:
  - `web/src/lib/server-session.ts`
- Added characterization coverage:
  - `web/src/lib/phone-candidates.test.ts`
- Updated work logs and harness.
- No resident-number read behavior, authorization behavior, database query, encryption/decryption path, env/config, UI, schema, migration, dependency, or generated output was intentionally changed.

### Evidence

- `docs/handbook/shared/security-and-secret-operations.md` says admin/manager cookie `session_resident` must not be treated as digits-only; privileged server routes must verify raw / digits / hyphenated candidates.
- `docs/handbook/backend/admin-operations-api.md` says `/api/admin/resident-numbers` and `/api/admin/fc` must not drift on phone format rules.
- `web/src/app/api/admin/fc/route.ts` and `web/src/app/api/admin/exam-applicants/route.ts` still import `buildPhoneCandidates` from `@/lib/server-session`, which now re-exports the pure helper.

### Commands

- RED: `node --experimental-strip-types --test web/src/lib/phone-candidates.test.ts`
  - First sandbox run failed with `windows sandbox: spawn setup refresh`.
  - Escalated rerun failed as expected with `ERR_MODULE_NOT_FOUND` for `web/src/lib/phone-candidates.ts`.
- GREEN: `node --experimental-strip-types --test web/src/lib/phone-candidates.test.ts`
  - Result: 3 tests passed.
  - Note: Node emitted `[MODULE_TYPELESS_PACKAGE_JSON]` warning for `.ts` ESM parsing; this matches the repo's existing direct Node web-test pattern and was not a test failure.
- `rg -n "buildPhoneCandidates|phone-candidates" web/src/lib web/src/app/api/admin`
  - Result: existing admin route imports still point to `@/lib/server-session`; `server-session.ts` imports/re-exports `@/lib/phone-candidates`; new helper/test are present.
- `cd web; npm run lint -- src/lib/server-session.ts src/lib/phone-candidates.ts src/lib/phone-candidates.test.ts`
  - First sandbox run failed with `windows sandbox: spawn setup refresh`.
  - Escalated rerun passed with ESLint exit 0.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- `git status --short --branch`
  - Result: current branch is `codex/referral-rollout-closeout...origin/codex/referral-rollout-closeout`; modified files include prior increment docs plus increment 4 harness/log files and `web/src/lib/server-session.ts`; new untracked increment 4 files are `web/src/lib/phone-candidates.ts` and `web/src/lib/phone-candidates.test.ts`.

### Not Run

- `npm run lint`
- `npm test`
- `npm run build`
- `cd web; npm run build`
- browser/runtime smoke tests

Reason: increment 4 is a small pure-helper extraction plus characterization test. Broader lint/build/runtime checks remain required before any larger PII/session route refactor.

### QA Judgment

- The raw/digits/hyphenated matching contract now has executable characterization coverage.
- The existing `@/lib/server-session` export surface is preserved for current admin route imports.
- This is a behavior-preserving safety increment; it does not claim full resident-number trusted-path coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, or missed verification was introduced.

## Increment 5 Verification

### Scope

- Extracted resident-number direct decrypt mode parsing into:
  - `web/src/lib/resident-number-runtime.ts`
- Preserved existing runtime behavior in:
  - `web/src/lib/server-resident-numbers.ts`
- Added characterization coverage:
  - `web/src/lib/resident-number-runtime.test.ts`
- Updated work logs and harness.
- No direct decrypt implementation, edge fallback fetch, authorization behavior, UI, env name, schema, migration, dependency, deployment config, or generated output was intentionally changed.

### Evidence

- `docs/handbook/admin-web/dashboard-lifecycle.md` says direct decrypt degraded runtime should keep trusted full-view semantics via fallback/logging rather than changing to masked-view policy.
- `web/src/lib/server-resident-numbers.ts` already used `FC_IDENTITY_DIRECT_DECRYPT_MODE` to choose direct decrypt vs edge fallback.
- The new helper characterizes the existing mapping:
  - empty / `auto` / `enabled` => `auto`
  - `disabled` / `off` => `disabled`
  - `report` / `report-only` => `report-only`
  - invalid values => `auto` with invalid configured value metadata so warning behavior remains possible.

### Commands

- RED: `node --experimental-strip-types --test web/src/lib/resident-number-runtime.test.ts`
  - Result: failed as expected with `ERR_MODULE_NOT_FOUND` for `web/src/lib/resident-number-runtime.ts`.
- GREEN: `node --experimental-strip-types --test web/src/lib/resident-number-runtime.test.ts`
  - Result: 4 tests passed.
  - Note: Node emitted `[MODULE_TYPELESS_PACKAGE_JSON]` warning for `.ts` ESM parsing; this matches the repo's existing direct Node web-test pattern and was not a test failure.
- `cd web; npm run lint -- src/lib/server-resident-numbers.ts src/lib/resident-number-runtime.ts src/lib/resident-number-runtime.test.ts`
  - Result: ESLint exit 0.
- `rg -n "resolveResidentNumberDirectDecryptMode|DirectDecryptMode|FC_IDENTITY_DIRECT_DECRYPT_MODE|resident-number-runtime" web/src/lib web/src/app/api/admin`
  - Result: new helper/test and `server-resident-numbers.ts` integration found; no admin route imports were changed.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- `git status --short --branch`
  - Result: current branch is `codex/referral-rollout-closeout...origin/codex/referral-rollout-closeout`; modified files include prior increment docs plus increment 4/5 harness/log files and `web/src/lib/server-session.ts`, `web/src/lib/server-resident-numbers.ts`; new untracked helper/test files are `phone-candidates*` and `resident-number-runtime*`.

### Not Run

- `npm run lint`
- `npm test`
- `npm run build`
- `cd web; npm run build`
- browser/runtime smoke tests

Reason: increment 5 is a pure-helper extraction plus characterization test. Broader lint/build/runtime checks remain required before any route-level resident-number fallback refactor.

### QA Judgment

- Direct decrypt runtime mode parsing now has executable characterization coverage.
- Invalid mode handling continues to default to `auto` while preserving warning metadata.
- This is a behavior-preserving safety increment; it does not claim full `readResidentNumbersWithFallback` or UI full-view coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, or missed verification was introduced.

## Increment 6 Verification

### Scope

- Extracted resident-number edge fallback request building into:
  - `web/src/lib/resident-number-edge-fallback.ts`
- Preserved fetch execution and response parsing in:
  - `web/src/lib/server-resident-numbers.ts`
- Added characterization coverage:
  - `web/src/lib/resident-number-edge-fallback.test.ts`
- Updated work logs and harness.
- No direct decrypt implementation, edge fallback response handling, authorization behavior, UI, env name, schema, migration, dependency, deployment config, generated output, or URL normalization was intentionally changed.

### Evidence

- `server-resident-numbers.ts` previously embedded the edge fallback fetch request inline.
- `docs/handbook/admin-web/dashboard-lifecycle.md` says degraded direct decrypt runtime should preserve trusted full-view semantics through fallback/logging rather than masking.
- The new helper characterizes the existing fallback request shape:
  - URL: `${supabaseUrl}/functions/v1/admin-action`
  - method: `POST`
  - headers: `Content-Type`, `apikey`, `Authorization`
  - body: `adminPhone`, `action: getResidentNumbers`, `payload.fcIds`

### Commands

- RED: `node --experimental-strip-types --test web/src/lib/resident-number-edge-fallback.test.ts`
  - Result: failed as expected with `ERR_MODULE_NOT_FOUND` for `web/src/lib/resident-number-edge-fallback.ts`.
- GREEN: `node --experimental-strip-types --test web/src/lib/resident-number-edge-fallback.test.ts`
  - Result: 2 tests passed.
  - Note: Node emitted `[MODULE_TYPELESS_PACKAGE_JSON]` warning for `.ts` ESM parsing; this matches the repo's existing direct Node web-test pattern and was not a test failure.
- Regression: `node --experimental-strip-types --test web/src/lib/resident-number-runtime.test.ts`
  - Result: 4 tests passed.
  - Note: same Node module-type warning.
- `cd web; npm run lint -- src/lib/server-resident-numbers.ts src/lib/resident-number-edge-fallback.ts src/lib/resident-number-edge-fallback.test.ts`
  - Result: ESLint exit 0.
- Final combined helper regression: `node --experimental-strip-types --test web/src/lib/resident-number-edge-fallback.test.ts web/src/lib/resident-number-runtime.test.ts web/src/lib/phone-candidates.test.ts`
  - Result: 9 tests passed.
  - Note: Node emitted `[MODULE_TYPELESS_PACKAGE_JSON]` warnings for `.ts` ESM parsing; this matches the repo's existing direct Node web-test pattern and was not a test failure.
- Final targeted lint: `cd web; npm run lint -- src/lib/server-resident-numbers.ts src/lib/resident-number-edge-fallback.ts src/lib/resident-number-edge-fallback.test.ts src/lib/resident-number-runtime.ts src/lib/resident-number-runtime.test.ts src/lib/server-session.ts src/lib/phone-candidates.ts src/lib/phone-candidates.test.ts`
  - Result: ESLint exit 0.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- `git status --short --branch`
  - Result: current branch is `codex/referral-rollout-closeout...origin/codex/referral-rollout-closeout`; modified files include prior increment docs plus increment 4/5/6 harness/log files and `web/src/lib/server-session.ts`, `web/src/lib/server-resident-numbers.ts`; new untracked helper/test files are `phone-candidates*`, `resident-number-runtime*`, and `resident-number-edge-fallback*`.

### Not Run

- `npm run lint`
- `npm test`
- `npm run build`
- `cd web; npm run build`
- browser/runtime smoke tests

Reason: increment 6 is a pure-helper extraction plus characterization test. Broader lint/build/runtime checks remain required before any route-level resident-number fallback refactor.

### QA Judgment

- Resident-number edge fallback request shape now has executable characterization coverage.
- `server-resident-numbers.ts` now delegates request construction but still owns fetch execution and response/error handling.
- This is a behavior-preserving safety increment; it does not claim full `readResidentNumbersWithFallback` or UI full-view coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, or missed verification was introduced.

## Increment 7 Verification

### Scope

- Extracted resident-number edge fallback response parsing into:
  - `web/src/lib/resident-number-edge-response.ts`
- Preserved fetch execution and request construction in:
  - `web/src/lib/server-resident-numbers.ts`
- Added characterization coverage:
  - `web/src/lib/resident-number-edge-response.test.ts`
- Updated work logs and harness.
- No direct decrypt implementation, edge fallback request shape, authorization behavior, UI, env name, schema, migration, dependency, deployment config, generated output, or URL normalization was intentionally changed.

### Evidence

- `server-resident-numbers.ts` previously embedded fallback response validation and failure message extraction inline.
- The new helper characterizes the existing success/failure contract:
  - success requires HTTP ok, object body, `ok: true`, and object `residentNumbers`
  - malformed success bodies fail
  - HTTP non-ok fails even when body looks successful
  - failure message priority is `message`, then `error`, then default `Edge Function failed`

### Commands

- RED: `node --experimental-strip-types --test web/src/lib/resident-number-edge-response.test.ts`
  - Result: failed as expected with `ERR_MODULE_NOT_FOUND` for `web/src/lib/resident-number-edge-response.ts`.
- GREEN: `node --experimental-strip-types --test web/src/lib/resident-number-edge-response.test.ts`
  - Result: 4 tests passed.
  - Note: Node emitted `[MODULE_TYPELESS_PACKAGE_JSON]` warning for `.ts` ESM parsing; this matches the repo's existing direct Node web-test pattern and was not a test failure.
- Regression: `node --experimental-strip-types --test web/src/lib/resident-number-edge-fallback.test.ts web/src/lib/resident-number-runtime.test.ts web/src/lib/phone-candidates.test.ts`
  - Result: 9 tests passed.
  - Note: same Node module-type warning.
- `cd web; npm run lint -- src/lib/server-resident-numbers.ts src/lib/resident-number-edge-response.ts src/lib/resident-number-edge-response.test.ts src/lib/resident-number-edge-fallback.ts src/lib/resident-number-runtime.ts src/lib/phone-candidates.ts`
  - Result: ESLint exit 0.
- Final combined helper regression: `node --experimental-strip-types --test web/src/lib/resident-number-edge-response.test.ts web/src/lib/resident-number-edge-fallback.test.ts web/src/lib/resident-number-runtime.test.ts web/src/lib/phone-candidates.test.ts`
  - Result: 13 tests passed.
  - Note: Node emitted `[MODULE_TYPELESS_PACKAGE_JSON]` warnings for `.ts` ESM parsing; this matches the repo's existing direct Node web-test pattern and was not a test failure.
- Final targeted lint: `cd web; npm run lint -- src/lib/server-resident-numbers.ts src/lib/resident-number-edge-response.ts src/lib/resident-number-edge-response.test.ts src/lib/resident-number-edge-fallback.ts src/lib/resident-number-edge-fallback.test.ts src/lib/resident-number-runtime.ts src/lib/resident-number-runtime.test.ts src/lib/server-session.ts src/lib/phone-candidates.ts src/lib/phone-candidates.test.ts`
  - Result: ESLint exit 0.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- `git status --short --branch`
  - Result: current branch is `codex/referral-rollout-closeout...origin/codex/referral-rollout-closeout`; modified files include prior increment docs plus increment 4/5/6/7 harness/log files and `web/src/lib/server-session.ts`, `web/src/lib/server-resident-numbers.ts`; new untracked helper/test files are `phone-candidates*`, `resident-number-runtime*`, `resident-number-edge-fallback*`, and `resident-number-edge-response*`.

### Not Run

- `npm run lint`
- `npm test`
- `npm run build`
- `cd web; npm run build`
- browser/runtime smoke tests

Reason: increment 7 is a pure-helper extraction plus characterization test. Broader lint/build/runtime checks remain required before any route-level resident-number fallback refactor.

### QA Judgment

- Resident-number edge fallback response validation now has executable characterization coverage.
- `server-resident-numbers.ts` now delegates response parsing but still owns fetch execution, log fields, and final thrown error context.
- This is a behavior-preserving safety increment; it does not claim full `readResidentNumbersWithFallback` or UI full-view coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, or missed verification was introduced.

## Increment 8 Verification

### Scope

- Extracted resident-number edge fallback execution into:
  - `web/src/lib/resident-number-edge-executor.ts`
- Preserved caller behavior in:
  - `web/src/lib/server-resident-numbers.ts`
- Added characterization coverage:
  - `web/src/lib/resident-number-edge-executor.test.ts`
- Updated work logs and harness.
- Updated `.claude/MISTAKES.md` with the production-source `.ts` import build failure guardrail.
- No direct decrypt implementation, fallback request shape, fallback response validation, authorization behavior, UI, env name, schema, migration, dependency, deployment config, generated output, or route contract was intentionally changed.

### Evidence

- `server-resident-numbers.ts` previously embedded missing-env checks, fallback fetch execution, failed response logging, and thrown fallback error prefixes inline.
- The new helper characterizes the existing execution contract:
  - missing `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` logs unavailable context and throws the existing runtime misconfiguration message
  - successful fallback fetch returns parsed `residentNumbers`
  - failed fallback response logs `status` and `body` before throwing the existing fallback failure prefix
  - invalid JSON response body is treated as `null` and uses default `Edge Function failed`

### Commands

- RED: `node --experimental-strip-types --test web/src/lib/resident-number-edge-executor.test.ts`
  - Result: failed as expected with `ERR_MODULE_NOT_FOUND` for `web/src/lib/resident-number-edge-executor.ts`.
- GREEN: `node --experimental-strip-types --test web/src/lib/resident-number-edge-executor.test.ts`
  - Result: 4 tests passed.
  - Note: Node emitted `[MODULE_TYPELESS_PACKAGE_JSON]` warning for `.ts` ESM parsing; this matches the repo's existing direct Node web-test pattern and was not a test failure.
- Regression: `node --experimental-strip-types --test web/src/lib/resident-number-edge-response.test.ts web/src/lib/resident-number-edge-fallback.test.ts web/src/lib/resident-number-runtime.test.ts web/src/lib/phone-candidates.test.ts`
  - Result: 13 tests passed.
  - Note: same Node module-type warning.
- `cd web; npm run lint -- src/lib/server-resident-numbers.ts src/lib/resident-number-edge-executor.ts src/lib/resident-number-edge-executor.test.ts src/lib/resident-number-edge-response.ts src/lib/resident-number-edge-fallback.ts src/lib/resident-number-runtime.ts src/lib/phone-candidates.ts`
  - Result: ESLint exit 0.
- `cd web; npm run build`
  - Initial result: failed at TypeScript step because production source imported `./resident-number-edge-fallback.ts` and `./resident-number-edge-response.ts`.
  - Final result after dependency-injection correction: build passed.
  - Note: build emitted existing baseline-browser-mapping age warnings and Turbopack `import-in-the-middle` external-package warnings; these were warnings, not failures.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.

### Not Run

- `npm run lint`
- `npm test`
- `npm run build`
- browser/runtime smoke tests

Reason: increment 8 is a dependency-injected helper extraction plus characterization test. `web` build was run because the new production helper import path needed verification. Broader root lint/test/build and browser/runtime checks remain required before route-level resident-number/UI refactors.

### QA Judgment

- Resident-number edge fallback execution now has executable characterization coverage.
- `server-resident-numbers.ts` delegates fallback execution while preserving direct fallback descriptions, runtime details, log messages, and thrown error prefixes.
- This is a behavior-preserving safety increment; it does not claim full route-level resident-number or UI full-view coverage yet.
- Mistake ledger was updated because the initial production `.ts` import path was a repeatable build-compatibility mistake caught before completion.

## Increment 9 Verification

### Scope

- Extracted resident-number route request parsing into:
  - `web/src/lib/resident-number-route-request.ts`
- Preserved caller behavior in:
  - `web/src/app/api/admin/resident-numbers/route.ts`
- Added characterization coverage:
  - `web/src/lib/resident-number-route-request.test.ts`
- Updated work logs and harness.
- No authorization behavior, session verification, rate limiting, empty-list success response, resident-number read behavior, direct decrypt, edge fallback, env name, schema, migration, dependency, deployment config, generated output, or UI behavior was intentionally changed.

### Evidence

- `route.ts` previously embedded `fcIds` normalization inline.
- The new helper characterizes the existing request parsing contract:
  - non-array input returns `[]`
  - values use `String(value ?? '')`
  - whitespace is trimmed
  - blank values are filtered out
  - duplicates are removed while preserving first-seen order
- `route.ts` still returns `{ ok: true, residentNumbers: {} }` for an empty normalized list.

### Commands

- RED: `node --experimental-strip-types --test web/src/lib/resident-number-route-request.test.ts`
  - Result: failed as expected with `ERR_MODULE_NOT_FOUND` for `web/src/lib/resident-number-route-request.ts`.
  - Note: Node emitted `[MODULE_TYPELESS_PACKAGE_JSON]` warning for `.ts` ESM parsing; this matches the repo's existing direct Node web-test pattern and was not a test failure.
- GREEN: `node --experimental-strip-types --test web/src/lib/resident-number-route-request.test.ts`
  - Result: 1 test passed.
  - Note: same Node module-type warning.
- Regression: `node --experimental-strip-types --test web/src/lib/resident-number-edge-executor.test.ts web/src/lib/resident-number-edge-response.test.ts web/src/lib/resident-number-edge-fallback.test.ts web/src/lib/resident-number-runtime.test.ts web/src/lib/phone-candidates.test.ts`
  - Result: 17 tests passed.
  - Note: same Node module-type warning.
- `cd web; npm run lint -- src/app/api/admin/resident-numbers/route.ts src/lib/resident-number-route-request.ts src/lib/resident-number-route-request.test.ts`
  - Result: ESLint exit 0.
- `cd web; npm run build`
  - Result: build passed.
  - Note: build emitted existing baseline-browser-mapping age warnings and Turbopack `import-in-the-middle` external-package warnings; these were warnings, not failures.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- `git diff --check`
  - Result: exit 0; CRLF normalization warnings only.
- `git status --short --branch`
  - Result: worktree still contains this goal's accumulated fc-onboarding-app changes and untracked helper/test files.

### Not Run

- root `npm run lint`
- root `npm test`
- root `npm run build`
- browser/runtime smoke tests

Reason: increment 9 is a pure-helper extraction plus server route request parsing characterization. Web build was run because the route imports the new production helper. Broader root/mobile checks and browser/runtime checks remain required before UI or cross-surface resident-number refactors.

### QA Judgment

- `/api/admin/resident-numbers` request `fcIds` normalization now has executable characterization coverage.
- The route delegates only normalization and still owns session checks, rate limiting, invalid JSON response, empty-list response, and downstream resident-number read behavior.
- This is a behavior-preserving safety increment; it does not claim full route-level auth/rate-limit/runtime resident-number coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, or missed verification was introduced.

## Increment 10 Verification

### Scope

- Exported the existing mobile unread checkpoint key builder:
  - `lib/notification-checkpoint.ts`
- Added characterization coverage:
  - `lib/__tests__/notification-checkpoint.test.ts`
- Updated work logs and harness.
- No AsyncStorage checkpoint read/write behavior, checkpoint date initialization, mobile unread count fetching, request_board API call, Supabase function call, native badge behavior, UI, env/config, schema, migration, dependency, deployment config, or generated output was intentionally changed.

### Evidence

- `AGENTS.md` records the unread checkpoint key contract as `role + residentId + requestBoardRole`.
- `lib/mobile-unread-notification-count.ts` reads this checkpoint before calculating fc-onboarding unread counts and adding live request_board unread counts for bridge users.
- The new test characterizes the current key contract:
  - `null` role defaults to `guest`
  - blank/missing `residentId` defaults to `global`
  - `residentId` is trimmed
  - missing `requestBoardRole` defaults to `none`
  - FC and designer request_board bridge roles produce distinct keys

### Commands

- RED: `npx jest lib/__tests__/notification-checkpoint.test.ts --runInBand`
  - Initial sandbox run failed with `windows sandbox: spawn setup refresh`.
  - Escalated rerun failed as expected with TypeScript error `has no exported member named 'buildNotificationCheckpointKey'`.
- GREEN: `npx jest lib/__tests__/notification-checkpoint.test.ts --runInBand`
  - Result: 2 tests passed.
- Regression: `npx jest lib/__tests__/push-registration.test.ts lib/__tests__/request-board-session.test.ts --runInBand`
  - Result: 6 tests passed.
- `npm run lint -- lib/notification-checkpoint.ts lib/__tests__/notification-checkpoint.test.ts`
  - First pass found an `import/first` warning with a mocked AsyncStorage import, then a `no-require-imports` warning with a require workaround.
  - Final result after removing the unnecessary mock: ESLint exit 0 with no warnings.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- `git diff --check`
  - Result: exit 0; CRLF normalization warnings only.
- `git status --short --branch`
  - Result: worktree still contains this goal's accumulated fc-onboarding-app changes and untracked helper/test files.

### Not Run

- root `npm test`
- root `npm run build`
- web lint/build
- browser/device runtime smoke tests

Reason: increment 10 is a pure mobile helper export plus characterization test. Broader checks remain required before network/session/UI changes.

### QA Judgment

- Mobile unread checkpoint key construction now has executable characterization coverage.
- The bridge role segment remains part of the key, reducing future risk that FC/designer GaramLink unread checkpoints drift into a shared scope.
- This is a behavior-preserving safety increment; it does not claim full bridge unread/API/native badge coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, or missed verification was introduced.

## Increment 11 Verification

### Scope

- Extracted mobile bridge unread planning/body/total helpers into:
  - `lib/mobile-unread-notification-count-plan.ts`
- Preserved caller behavior in:
  - `lib/mobile-unread-notification-count.ts`
- Added characterization coverage:
  - `lib/__tests__/mobile-unread-notification-count-plan.test.ts`
- Updated work logs and harness.
- No AsyncStorage checkpoint behavior, Supabase invoke behavior, request_board API behavior, catch/log fallback, native badge behavior, UI, env/config, schema, migration, dependency, deployment config, or generated output was intentionally changed.

### Evidence

- `mobile-unread-notification-count.ts` previously embedded request_board access, `exclude_request_board_categories`, and final live request_board unread addition inline.
- The new helper characterizes the current bridge unread planning contract:
  - role-less sessions do not fetch and do not include live request_board unread, even if stale requestBoardRole is present
  - FC and bridged request_board FC/designer roles include live request_board unread
  - internal admin sessions without request_board role stay on fc-onboarding unread only
  - `fc-notify` body preserves `type`, `role`, `resident_id`, `since`, and `exclude_request_board_categories`
  - final total adds request_board unread only when live request_board unread is included

### Commands

- RED: `npx jest lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand`
  - Result: failed as expected with `Cannot find module '@/lib/mobile-unread-notification-count-plan'`.
- Additional RED: `npx jest lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand`
  - Result after first helper draft: failed because `role: null` with stale `requestBoardRole: 'fc'` returned `includeLiveRequestBoardUnread: true`; helper was corrected so unidentified sessions expose no live request_board plan.
- GREEN: `npx jest lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand`
  - Result: 6 tests passed.
- Regression: `npx jest lib/__tests__/notification-checkpoint.test.ts lib/__tests__/push-registration.test.ts lib/__tests__/request-board-session.test.ts --runInBand`
  - Result: 8 tests passed.
- `npm run lint -- lib/mobile-unread-notification-count.ts lib/mobile-unread-notification-count-plan.ts lib/__tests__/mobile-unread-notification-count-plan.test.ts`
  - Result: ESLint exit 0.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- `git diff --check`
  - Result: exit 0; CRLF normalization warnings only.
- `git status --short --branch`
  - Result: worktree still contains this goal's accumulated fc-onboarding-app changes and untracked helper/test files.

### Not Run

- root `npm test`
- root `npm run build`
- web lint/build
- browser/device runtime smoke tests

Reason: increment 11 is a pure mobile helper extraction plus characterization test. Broader checks remain required before network/session/UI changes.

### QA Judgment

- The mobile bridge unread inclusion/body/total contract now has executable characterization coverage.
- `fetchMobileUnreadNotificationCount` still owns the same checkpoint read, Supabase invoke, request_board unread call, and catch/log fallback behavior; only pure pieces were delegated.
- This is a behavior-preserving safety increment; it does not claim full bridge unread runtime/API/native badge coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, or missed verification was introduced.

## Increment 12 Verification

### Scope

- Extended mobile unread helper:
  - `lib/mobile-unread-notification-count-plan.ts`
- Preserved caller behavior in:
  - `lib/mobile-unread-notification-count.ts`
- Extended characterization coverage:
  - `lib/__tests__/mobile-unread-notification-count-plan.test.ts`
- Updated work logs and harness.
- No AsyncStorage checkpoint persistence, Supabase function target, request_board API behavior, catch/log fallback text, native badge behavior, UI, env/config, schema, migration, dependency, deployment config, or generated output was intentionally changed.

### Evidence

- `mobile-unread-notification-count.ts` previously coordinated checkpoint read, `fc-notify` invoke, optional live request_board unread fetch, and catch/log fallback inline.
- The new dependency-injected helper characterizes the current orchestration contract:
  - role-less sessions return `0` before dependency calls
  - checkpoint read uses `{ initializeIfMissing: false }`
  - `fc-notify` body preserves `type`, `role`, `resident_id`, checkpoint `since`, and `exclude_request_board_categories`
  - live request_board unread is fetched only when the bridge plan includes it
  - `fc-notify` and request_board unread failures log `[mobile-unread-count] fetch failed` and return `0`

### Commands

- RED: `npx jest lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand`
  - Result: failed as expected with TypeScript error `Module '"@/lib/mobile-unread-notification-count-plan"' has no exported member 'fetchMobileUnreadNotificationCountWithDeps'`.
- GREEN: `npx jest lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand`
  - Result: 11 tests passed.
- Regression: `npx jest lib/__tests__/notification-checkpoint.test.ts lib/__tests__/push-registration.test.ts lib/__tests__/request-board-session.test.ts --runInBand`
  - Result: 8 tests passed.
- `npm run lint -- lib/mobile-unread-notification-count.ts lib/mobile-unread-notification-count-plan.ts lib/__tests__/mobile-unread-notification-count-plan.test.ts`
  - Result: ESLint exit 0.
- `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- `git diff --check`
  - Result: exit 0; CRLF normalization warnings only.
- `git status --short --branch`
  - Result: worktree still contains this goal's accumulated fc-onboarding-app changes and untracked helper/test files.

### Not Run

- root `npm test`
- root `npm run build`
- web lint/build
- browser/device runtime smoke tests

Reason: increment 12 is a dependency-injected helper extraction around existing mobile unread orchestration. Broader checks remain required before network/session/UI changes.

### QA Judgment

- Mobile unread async orchestration now has executable characterization coverage without importing Supabase/request_board runtime clients into the test.
- `fetchMobileUnreadNotificationCount` still injects the same checkpoint reader, Supabase `fc-notify` invocation, request_board unread API call, and logger warning behavior.
- This is a behavior-preserving safety increment; it does not claim full live bridge unread/API/native badge coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, or missed verification was introduced.
## Increment 13 Verification

### Scope

- Added a dependency-injected resident-number route branch helper:
  - `web/src/lib/resident-number-route-handler.ts`
- Rewired the Next route through the helper:
  - `web/src/app/api/admin/resident-numbers/route.ts`
- Added direct Node characterization tests:
  - `web/src/lib/resident-number-route-handler.test.ts`
- Updated docs/handoff:
  - `.claude/WORK_LOG.md`
  - `.claude/WORK_DETAIL.md`
  - `.codex/harness/*`
- No resident-number read behavior, session verification internals, rate-limit implementation, direct decrypt, edge fallback, env/config, schema, migration, dependency, generated output, or UI behavior was intentionally changed.

### Evidence

- `web/src/app/api/admin/resident-numbers/route.ts` previously owned session rejection, rate-limit rejection, JSON parsing, empty-list success, downstream read success, and read-failure response inline.
- Increments 4-9 already characterized supporting phone candidate, runtime mode, edge fallback, and `fcIds` normalization helpers.
- The new helper is dependency-injected so it can characterize branch order without importing Next.js route modules, cookies, Supabase clients, or resident-number decrypt runtime.
- Route wiring preserves:
  - `getVerifiedServerSession({ allowedRoles: ['admin', 'manager'], requireActive: true })`
  - `checkRateLimit` key `resident-numbers:${residentDigits}`, limit `30`, window `60_000`
  - `SECURITY_HEADERS` response headers
  - `readResidentNumbersWithFallback({ fcIds, staffPhone: residentDigits, logPrefix: '[api/admin/resident-numbers]' })`

### Commands

- RED: `node --experimental-strip-types --test web/src/lib/resident-number-route-handler.test.ts`
  - Result before helper implementation: failed with `ERR_MODULE_NOT_FOUND` for `web/src/lib/resident-number-route-handler.ts`.
- GREEN: `node --experimental-strip-types --test web/src/lib/resident-number-route-handler.test.ts`
  - Result: passed 6 route-branch characterization tests.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- Regression: `node --experimental-strip-types --test web/src/lib/resident-number-route-request.test.ts web/src/lib/resident-number-edge-executor.test.ts web/src/lib/resident-number-edge-response.test.ts web/src/lib/resident-number-edge-fallback.test.ts web/src/lib/resident-number-runtime.test.ts web/src/lib/phone-candidates.test.ts`
  - Result: passed 18 resident-number helper tests.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- Targeted lint: `cd web; npm run lint -- src/app/api/admin/resident-numbers/route.ts src/lib/resident-number-route-handler.ts src/lib/resident-number-route-handler.test.ts src/lib/resident-number-route-request.ts`
  - Result: passed.
  - Note: the first sandboxed attempt failed before command execution with `windows sandbox: spawn setup refresh`; rerun outside sandbox was approved and passed.
- Web build: `cd web; npm run build`
  - Result: passed.
  - Notes: build emitted existing package/version warnings for `import-in-the-middle` via OpenTelemetry instrumentation and repeated `baseline-browser-mapping` freshness warnings.
- Governance: `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- Whitespace/status checks:
  - `git diff --check`: exit 0 with CRLF normalization warnings only.
  - `git status --short --branch`: reviewed; worktree still contains this goal's accumulated fc-onboarding-app changes and untracked helper/test files.
- Whitespace/status checks:
  - `git diff --check`: exit 0 with CRLF normalization warnings only.
  - `git status --short --branch`: reviewed; worktree still contains this goal's accumulated fc-onboarding-app changes and untracked helper/test files.

### Not Run

- root `npm test`
- root `npm run lint`
- root `npm run build`
- browser/runtime PII route smoke tests

Reason: increment 13 changes a web route orchestration helper and route wiring only. It does not change mobile code, UI, Supabase schema, direct decrypt implementation, edge fallback behavior, or browser-rendered flows.

### QA Judgment

- `/api/admin/resident-numbers` branch sequencing now has executable characterization coverage.
- The Next route still owns response header application and runtime dependency wiring, while the helper owns branch order.
- This is a behavior-preserving safety increment; it does not claim full UI full-view or live runtime PII smoke coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, or missed verification was introduced.

## Increment 14 Verification

### Scope

- Added pure exam-applicant resident-number enrichment helpers:
  - `web/src/lib/exam-applicant-resident-number-enrichment.ts`
- Rewired only the mapping/enrichment section of:
  - `web/src/app/api/admin/exam-applicants/route.ts`
- Added direct Node characterization coverage:
  - `web/src/lib/exam-applicant-resident-number-enrichment.test.node.ts`
- Updated work logs and harness.
- No authorization, staff verification, rate-limit, Supabase query shape/order/limit, resident-number read behavior, direct decrypt, edge fallback, env/config, schema, migration, dependency, generated output, or UI behavior was intentionally changed.

### Evidence

- `web/src/app/api/admin/exam-applicants/route.ts` previously owned row default mapping, profile phone alias matching, resident-number `fcIds` derivation, and response enrichment inline.
- The new helper characterizes the current contract:
  - missing exam location defaults to `미정`
  - missing round label defaults to `-`
  - missing third-exam flag defaults to `false`
  - profile matching uses the shared raw/digits/hyphenated `buildPhoneCandidates` behavior
  - resident-number read ids are de-duplicated profile ids
  - full resident-number values replace response `resident_id`
  - missing profile or null/missing resident-number values return the current `주민번호 조회 실패` literal
- Route wiring still calls `readResidentNumbersWithFallback({ fcIds, staffPhone, logPrefix: '[api/admin/exam-applicants]' })`.

### Commands

- RED: `node --experimental-strip-types --test web/src/lib/exam-applicant-resident-number-enrichment.test.ts`
  - Result before helper implementation: failed with `ERR_MODULE_NOT_FOUND` for `web/src/lib/exam-applicant-resident-number-enrichment.ts`.
  - Note: the test file was later renamed to `exam-applicant-resident-number-enrichment.test.node.ts` so it remains a direct Node test without being collected by root Jest or Next typecheck.
- GREEN: `node --experimental-strip-types --test web/src/lib/exam-applicant-resident-number-enrichment.test.node.ts`
  - Result: passed 2 enrichment characterization tests.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- Regression: `node --experimental-strip-types --test web/src/lib/phone-candidates.test.ts web/src/lib/resident-number-route-request.test.ts web/src/lib/resident-number-route-handler.test.ts web/src/lib/resident-number-edge-executor.test.ts web/src/lib/resident-number-edge-response.test.ts web/src/lib/resident-number-edge-fallback.test.ts web/src/lib/resident-number-runtime.test.ts`
  - Result: passed 24 phone/resident-number helper tests.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- Targeted lint: `cd web; npm run lint -- src/app/api/admin/exam-applicants/route.ts src/lib/exam-applicant-resident-number-enrichment.ts src/lib/exam-applicant-resident-number-enrichment.test.node.ts`
  - Result: passed.
- Web build: `cd web; npm run build`
  - Initial result after temporary `*.node-test.ts` filename: failed because Next typecheck included the direct Node test and rejected `.ts` imports.
  - Final result after renaming to `*.test.node.ts`: passed.
  - Notes: build emitted existing package/version warnings for `import-in-the-middle` via OpenTelemetry instrumentation and repeated `baseline-browser-mapping` freshness warnings.
- Root lint: `npm run lint`
  - Result: passed.
- Root test: `npm test`
  - Result: failed with 18 failed suites, 28 passed suites, 46 total suites, 182 passed tests.
  - Remaining failures are existing root Jest harness/type issues: web direct Node `.test.ts` files with `.ts` import paths (`TS5097`), `web/src/lib/referral-graph-simulation.test.ts` missing `d3-force` types/implicit anys, and `lib/__tests__/referral-tree.test.ts` `relationshipSource` type mismatch.
  - The new `exam-applicant-resident-number-enrichment.test.node.ts` file is not in the final root Jest failure list.
- Root build: `npm run build`
  - Result: passed; regenerated ignored Expo `dist/` output.
  - Notes: Sentry native configuration and expo-notifications web listener warnings were emitted; API routes were skipped because Expo web output is static.
- Governance: `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- Whitespace/status checks:
  - `git diff --check`: exit 0 with CRLF normalization warnings only.
  - `git status --short --branch`: reviewed; worktree still contains this goal's accumulated fc-onboarding-app changes and untracked helper/test files.

### QA Judgment

- Exam-applicant resident-number enrichment now has executable characterization coverage without importing Next.js route modules or Supabase clients into the test.
- The route still owns DB reads, auth/session checks, staff verification, rate limits, and resident-number fallback runtime dependency wiring.
- The temporary direct Node test filename issue was corrected before completion and does not remain in `web` build or root Jest failure output.
- This is a behavior-preserving safety increment; it does not claim browser/live Supabase PII route smoke coverage yet.
- No mistake-ledger update is required for this increment because the transient filename/typecheck issue was caught and fixed within the same increment before handoff, and no repeatable guardrail drift remains.

## Increment 15 Verification

### Scope

- Added pure resident-number display helper:
  - `web/src/lib/resident-number-display.ts`
- Added direct Node characterization coverage:
  - `web/src/lib/resident-number-display.test.node.ts`
- Rewired the existing hook:
  - `web/src/hooks/use-resident-number.ts`
- Removed duplicate local birth-date parsing from:
  - `web/src/app/dashboard/profile/[id]/page.tsx`
- Updated work logs and harness.
- No resident-number route/API behavior, Supabase query, direct decrypt, edge fallback, env/config, schema, migration, dependency, generated output, profile form submission, manager read-only, or visual layout behavior was intentionally changed.

### Evidence

- `web/src/hooks/use-resident-number.ts` previously owned a local birth-date formatter and already returned `birthDateDisplay`.
- `web/src/app/dashboard/page.tsx` already used the hook-provided `birthDateDisplay` for the dashboard modal.
- `web/src/app/dashboard/profile/[id]/page.tsx` duplicated resident-number-to-birth-date parsing locally from `residentNumberDisplay`.
- The shared helper now characterizes:
  - hyphenated full resident numbers
  - digit-only full resident numbers
  - short/blank/nullish values
  - loading/failure display text
  - non-digit separators before the first 6 digits

### Commands

- RED: `node --experimental-strip-types --test web/src/lib/resident-number-display.test.node.ts`
  - Result before helper implementation: failed with `ERR_MODULE_NOT_FOUND` for `web/src/lib/resident-number-display.ts`.
- GREEN: `node --experimental-strip-types --test web/src/lib/resident-number-display.test.node.ts`
  - Result: passed 3 birth-date display characterization tests.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- Regression: `node --experimental-strip-types --test web/src/lib/phone-candidates.test.ts web/src/lib/resident-number-route-request.test.ts web/src/lib/resident-number-route-handler.test.ts web/src/lib/resident-number-edge-executor.test.ts web/src/lib/resident-number-edge-response.test.ts web/src/lib/resident-number-edge-fallback.test.ts web/src/lib/resident-number-runtime.test.ts web/src/lib/exam-applicant-resident-number-enrichment.test.node.ts`
  - Result: passed 26 resident-number helper tests.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- Targeted lint: `npm run lint -- src/hooks/use-resident-number.ts src/lib/resident-number-display.ts src/lib/resident-number-display.test.node.ts src/app/dashboard/profile/[id]/page.tsx` from `web/`
  - Result: passed.
- Web build: `npm run build` from `web/`
  - Result: passed.
  - Notes: build emitted existing package/version warnings for `import-in-the-middle` via OpenTelemetry instrumentation and repeated `baseline-browser-mapping` freshness warnings.
- Root lint: `npm run lint`
  - Result: passed.
- Governance: `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- Whitespace/status checks:
  - `git diff --check`: exit 0 with CRLF normalization warnings only.
  - `git status --short --branch`: reviewed; worktree still contains this goal's accumulated fc-onboarding-app changes and untracked helper/test files.

### Not Run

- root `npm test`
- root `npm run build`
- browser/runtime PII smoke tests

Reason: increment 15 changes only a web client-side pure display helper, hook formatting delegation, and profile-page duplicate formatting removal. It does not change routes, Supabase access, direct decrypt, edge fallback, mobile app code, generated output, or rendered layout structure. Root `npm test` is already documented as failing from existing harness/type issues in increment 14; the new direct Node test is named `*.test.node.ts` to stay outside root Jest collection.

### QA Judgment

- Dashboard modal and profile page resident-number birth-date display now share the same hook/helper path.
- `residentNumberDisplay` loading/success/error text remains owned by `useResidentNumber` and was not changed.
- This is a behavior-preserving duplicate-implementation cleanup; it does not claim browser/live Supabase PII route smoke coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, contract drift, or missed verification was introduced.

## Increment 16 Verification

### Scope

- Added pure client session helper:
  - `web/src/lib/client-session-restore.ts`
- Added direct Node characterization coverage:
  - `web/src/lib/client-session-restore.test.node.ts`
- Rewired the existing admin web session hook:
  - `web/src/hooks/use-session.tsx`
- Updated work logs and harness.
- No cookie name/parsing/write behavior, localStorage key/read/write behavior, obfuscation/deobfuscation, hydration timing, login/logout redirect, server session validation, middleware, dashboard route authorization, manager write-protection UI, Supabase access, env/config, schema, dependency, generated output, or visual layout behavior was intentionally changed.

### Evidence

- `web/src/hooks/use-session.tsx` previously owned:
  - resident id mask formatting inline
  - cookie-first restore choice via `readSessionFromCookies() ?? readSessionFromStorage()`
  - manager read-only calculation via `state.role === 'manager'`
- The shared helper now characterizes:
  - cookie snapshot precedence over localStorage snapshot
  - localStorage fallback when cookie snapshot is absent
  - `null` when both snapshots are missing
  - resident mask grouping for blank, short, 7-digit, 11-digit, and hyphenated values
  - manager-only read-only role calculation
- Hook wiring preserves the previous short-circuit behavior by not reading localStorage when a cookie session is present.

### Commands

- RED: `node --experimental-strip-types --test web/src/lib/client-session-restore.test.node.ts`
  - Result before helper implementation: failed with `ERR_MODULE_NOT_FOUND` for `web/src/lib/client-session-restore.ts`.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- GREEN: `node --experimental-strip-types --test web/src/lib/client-session-restore.test.node.ts`
  - Result: passed 4 client session restore characterization tests.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- Regression: `node --experimental-strip-types --test web/src/lib/resident-number-display.test.node.ts web/src/lib/phone-candidates.test.ts web/src/lib/resident-number-route-request.test.ts web/src/lib/resident-number-route-handler.test.ts web/src/lib/resident-number-edge-executor.test.ts web/src/lib/resident-number-edge-response.test.ts web/src/lib/resident-number-edge-fallback.test.ts web/src/lib/resident-number-runtime.test.ts web/src/lib/exam-applicant-resident-number-enrichment.test.node.ts`
  - Result: passed 29 resident-number/session-adjacent helper tests.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- Targeted web lint: `npm run lint -- src/hooks/use-session.tsx src/lib/client-session-restore.ts src/lib/client-session-restore.test.node.ts` from `web/`
  - Result: passed.
- Web build: `npm run build` from `web/`
  - Result: passed.
  - Notes: build emitted existing package/version warnings for `import-in-the-middle` via OpenTelemetry instrumentation and repeated `baseline-browser-mapping` freshness warnings.
- Root lint: `npm run lint`
  - Result: passed.
- Governance: `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.

### Not Run

- root `npm test`
- root `npm run build`
- browser/runtime auth smoke tests

Reason: increment 16 changes only a web client-side pure session helper and hook delegation for existing restore/read-only/mask calculations. It does not change server routes, Supabase access, middleware, dashboard mutations, mobile app code, generated output, or rendered layout structure. Root `npm test` is already documented as failing from existing harness/type issues in prior increments; the new direct Node test is named `*.test.node.ts` to stay outside root Jest collection.

### QA Judgment

- Admin web client session restore now has executable characterization for cookie-first selection while preserving localStorage short-circuit behavior.
- Manager read-only role calculation and resident id mask formatting now have a pure contract anchor before broader admin dashboard/session cleanup.
- This is a behavior-preserving safety increment; it does not claim browser/runtime auth restore or full manager write-protection smoke coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, contract drift, or missed verification was introduced.

## Increment 17 Verification

### Scope

- Added direct Node characterization test:
  - `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`
- Exported existing request body builder:
  - `supabase/functions/_shared/request-board-password-sync.ts`
- Updated governance ownership metadata:
  - `docs/handbook/path-owner-map.json`
- Updated handbook owner docs required by governance for accumulated changed code domains:
  - `docs/handbook/shared/cross-repo-bridge-contract.md`
  - `docs/handbook/backend/notifications-inbox-push.md`
  - `docs/handbook/admin-web/exam-and-referral-ops.md`
  - `docs/handbook/data/identity-and-pii.md`
  - `docs/handbook/admin-web/dashboard-lifecycle.md`
- Updated work logs and harness.
- No deletion, env, dependency, asset, fetch execution, timeout, header, warning/log, response parsing, caller role decision, Supabase schema/query, app/web UI, or generated output behavior changes were made.

### Evidence

- Existing `request-board-password-sync.ts` body behavior:
  - includes `phone`, `password`, and `role`
  - includes truthy `name` and `companyName`
  - includes `affiliation` only for `fc` and `manager`
  - omits blank optional fields through truthiness checks
  - includes `initiatorRole` and `syncReason` only when provided
  - does not trim/normalize values inside the body builder
- Increment 17 exports that existing pure behavior as `buildRequestBoardPasswordSyncBody` and keeps `syncRequestBoardPassword` execution behavior unchanged.

### Commands

- RED: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`
  - Result before helper export: failed with missing export `buildRequestBoardPasswordSyncBody`.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- GREEN: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`
  - Result: passed 5 tests.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- Governance: `node scripts/ci/check-governance.mjs`
  - Result: passed.
  - Intermediate result: failed once after `docs/handbook/path-owner-map.json` changed, because handbook owner-doc enforcement then required owner docs for the accumulated changed code domains. The listed handbook owner docs were updated and governance was rerun.
- `git diff --check`
  - Result: passed with CRLF normalization warnings only.
- `git status --short --branch`
  - Result: reviewed; worktree still contains this goal's accumulated fc-onboarding-app changes and the new request-board password-sync body helper/test/path-owner-map changes.

### Not Run

- root `npm test`
- root `npm run build`
- root `npm run lint`
- web build/lint
- browser/runtime checks
- live `/api/auth/sync-password` smoke

Reason: increment 17 changes only a Supabase Edge Function shared pure request-body builder, its direct Node characterization test, owner-map governance metadata, and documentation. It does not change app/web source, Supabase DB access, fetch execution, env/secrets, response handling, UI, or generated output. Root `npm test` is already documented as failing from existing harness/type issues in prior increments.

### QA Judgment

- Outbound request_board password-sync body construction now has executable characterization coverage before broader bridge/password-sync cleanup.
- `syncRequestBoardPassword` still owns the actual fetch side effect, headers, abort timeout, response parsing, warning logs, and non-throwing failure behavior.
- This is a behavior-preserving safety increment; it does not claim full runtime cross-repo password sync, live secret alignment, or request_board API smoke coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, contract drift, or missed verification was introduced.

## Increment 18 Verification

### Scope

- Added dependency-injected sync helper:
  - `supabase/functions/_shared/request-board-password-sync.ts`
- Extended direct Node characterization coverage:
  - `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`
- Updated work logs and harness.
- No deletion, env, dependency, asset, request body shape, caller role decision, Supabase schema/query, app/web UI, generated output, or request_board inbound behavior changes were made.

### Evidence

- Existing `syncRequestBoardPassword` execution behavior:
  - returns early when `syncUrl` or `syncToken` is missing
  - schedules an `AbortController` timeout using the provided `timeoutMs`
  - sends `POST` with `Content-Type: application/json`, `x-request-bridge-token`, JSON body from `buildRequestBoardPasswordSyncBody`, and abort signal
  - logs non-2xx responses as `[<prefix>] request_board sync failed: <status> <first 200 response chars>`
  - logs successful HTTP responses whose JSON body is not `success: true` as `[<prefix>] request_board sync error: <first 200 JSON chars>`
  - logs thrown fetch errors as `[<prefix>] request_board sync error:` plus the error object
  - clears the timeout in `finally` and never throws to callers
- Increment 18 moves only dependency wiring to `syncRequestBoardPasswordWithDeps`; production `syncRequestBoardPassword` delegates with global dependencies.

### Commands

- RED: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`
  - Result before injected helper export: failed with missing export `syncRequestBoardPasswordWithDeps`.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- GREEN: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`
  - Result: passed 10 tests.
  - Note: Node emitted the existing MODULE_TYPELESS_PACKAGE_JSON warning for direct `.ts` ESM tests.
- Governance: `node scripts/ci/check-governance.mjs`
  - Result: `[governance-check] passed`.
- `git diff --check`
  - Result: passed with CRLF normalization warnings only.
- `git status --short --branch`
  - Result: reviewed; worktree still contains this goal's accumulated fc-onboarding-app changes and the new password-sync injected helper/test changes.

### Not Run

- root `npm test`
- root `npm run build`
- root `npm run lint`
- web build/lint
- browser/runtime checks
- live `/api/auth/sync-password` smoke

Reason: increment 18 changes only a Supabase Edge Function shared sync helper seam and its direct Node characterization test. It does not change app/web source, Supabase DB access, env/secrets, caller role decisions, response handling contract, UI, or generated output. Root `npm test` is already documented as failing from existing harness/type issues in prior increments.

### QA Judgment

- Outbound request_board password-sync fetch behavior now has executable characterization coverage before broader bridge/password-sync cleanup.
- `syncRequestBoardPassword` remains the production wrapper and still uses global fetch/timer/AbortController/console dependencies.
- This is a behavior-preserving safety increment; it does not claim full runtime cross-repo password sync, live secret alignment, or request_board API smoke coverage yet.
- No mistake-ledger update is required for this increment because no new regression, repeated mistake, contract drift, or missed verification was introduced.
