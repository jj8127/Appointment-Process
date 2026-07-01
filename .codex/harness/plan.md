# Increment 60: GaramIn Designer Picker Ordering

Status: completed locally on 2026-06-30.

Implementation order:

1. Completed: added a failing unit contract for life-first/nonlife-second designer ordering.
2. Completed: added `sortRequestBoardDesigners()` to the request-board designer selection helper.
3. Completed: applied the helper after designer search filtering in the create-flow bottom sheet.
4. Completed: added messenger directory formatting so `contact_region` appears as `회사 (본부)` when present.
5. Completed: added mobile UI source contracts for picker sorting and directory headquarters labels.
6. Completed: ran focused Jest tests.

Out of scope:

- No API/schema changes in GaramIn.
- No invented 흥국생명 headquarters mapping; that source belongs to request_board seed data.

---

# Increment 55: Admin Exam Legacy Apply Route Redirect

Status: completed and deployed on 2026-06-08

Implementation order:

1. Completed: checked production alias and canonical applicant route chunks.
2. Completed: found stale legacy `/exam/apply` table implementation.
3. Completed: added RED test for legacy route redirect.
4. Completed: replaced `/exam/apply` table with redirect to `/dashboard/exam/applicants`.
5. Completed: ran focused tests, targeted lint, and web production build.
6. Completed: deployed admin web production and verified live `/exam/apply` redirect.

Out of scope:

- New applicant columns.
- DB/schema/function changes.
- Mobile exam application changes.

---

# Increment 35: Request Board Designer Notification Scope

Status: completed locally on 2026-06-05

Implementation order:

1. Completed: identified that request-board designer mobile push can be polluted by FC/admin broadcast token scopes.
2. Completed: added manager mobile delivery policy tests for request_board, direct chat, board/notice/exam exclusions.
3. Completed: changed request-board designer push token scope from `fc` to `manager`.
4. Completed: applied manager-token filtering in `fc-notify`.
5. Completed: changed designer unread count to request_board live unread only.
6. Completed: ran focused tests, targeted lint, full TypeScript, full Jest, and diff whitespace checks.

Parallel owners:

- Coordinator: policy, mobile session registration, `fc-notify`, unread orchestration, docs, verification.

Out of scope:

- FC/admin notification delivery changes.
- request_board backend API changes.
- Referral graph work.

---

# Increment 34: Orange CTA Black Rendering Guard

Status: completed locally on 2026-06-04

Implementation order:

1. Completed: confirmed the reported black home cards were the large orange CTA/step surfaces.
2. Completed: replaced the home next-step and messenger CTA orange `LinearGradient` wrappers with plain `View` surfaces using explicit orange backgrounds.
3. Completed: removed the same orange `LinearGradient` risk from legacy life/nonlife exam submit buttons and referral-code card without changing data flow.
4. Completed: normalized touched home letter spacing to `0` to match current UI constraints.
5. Completed: ran focused mobile lint, web board lint/build, request_board client build, and governance checks.

Parallel owners:

- Coordinator: focused UI patch, verification, harness updates.
- Huygens subagent: prior cross-repo investigation for the GaramLink customer surface.

Out of scope:

- Exam application runtime changes.
- Toss/proxy exam work.
- Referral tree logic changes.

---

# Increment 33: Board Garam Pick Category

Status: completed locally on 2026-06-04

Implementation order:

1. Completed: add `가람 Pick` to `board_categories` schema seed and forward migration.
2. Completed: add a distinct badge color for mobile board, mobile admin board management, and admin web board.
3. Completed: update board category docs and harness notes.
4. Completed: run focused fc-onboarding lint/web build/governance checks.

Parallel owners:

- Coordinator: schema/migration/docs/harness, final verification.
- Huygens subagent: confirmed the GaramLink customer surface belongs to `request_board`, not `fc-onboarding-app`.

Out of scope:

- Board permission changes.
- Board notification fanout changes.
- Notice preview/legacy notice model changes.

---

# Increment 32: Dawichok URL Sent Signal And Referral Graph Completion Legend

Status: completed locally on 2026-06-04

Implementation order:

1. Completed: used existing graph and workflow explorer results to isolate the Dawichok URL signal and referral graph surfaces.
2. Completed: added `dawichok_url_sent_at/by` schema contract, migration, mobile admin action, web admin action, and FC Dawichok page guidance.
3. Completed: added reset handling so Dawichok URL sent state is cleared when document workflow is downgraded.
4. Completed: added graph-node completion state, green completed-node rendering, drawer badge, visible-count summary, and clearer legend copy.
5. Completed: incorporated evaluator findings for FC copy gating, reset drift, visible count, and yellow-marker legend semantics.
6. Completed: ran focused graph tests, full root tests, root/web lint, web build, governance, and diff checks.

Parallel owners:

- Coordinator: schema/API/mobile/web integration, harness notes, final verification.
- Explorer subagent Newton: referral graph data/rendering surface investigation.
- Evaluator subagent Cicero: Dawichok signal and referral graph consistency review.

Out of scope:

- Toss virtual-account/proxy exam runtime.
- Headquarters-scoped secretary filtering.
- Dawichok PDF upload removal.
- Real Kakao template/send integration for the URL signal beyond existing in-app/push notification path.

---

# Increment 31: GaramIn Operations UX And Workflow Fixes

Status: completed locally on 2026-06-03

Implementation order:

1. Completed: dispatched disjoint workers for exam registration, signup/consent, document review, home CTA/video, and manager resident-number display.
2. Completed: integrated worker patches and removed deferred Toss/Kakao/scope/dawichok-sent leftovers from active runtime.
3. Completed: replaced user-facing `보증 보험 동의` wording in touched app/web/docs paths with `보증 보험 동의`.
4. Completed: fixed evaluator blockers for document approval bypass, FC no-file approved document rendering, and admin consent temp-id sequencing.
5. Completed: ran focused and full verification, then updated QA/handoff/work logs with exact evidence.

Parallel owners:

- Coordinator: harness, schema/doc integration, cross-cutting copy audit, final verification.
- Mobile Exam worker: `app/exam-register.tsx`, `app/exam-register2.tsx`.
- Signup/Consent worker: `app/signup.tsx`, `app/consent.tsx`, signup persistence/types.
- Docs/Admin worker: admin document review surfaces and doc status sync.
- UI/YouTube worker: `app/index.tsx`, `app/home-lite.tsx`, orange fallback CTA fixes.
- Resident Number worker: manager full resident-number display path.
- Evaluators: visual UX review and workflow/security review.

Out of scope:

- Toss virtual-account/proxy exam runtime.
- Headquarters-scoped secretary filtering.
- Internal `allowance_*` status/column renames.

---

# Increment 30: Mobile Exam Runtime Rollback

Status: completed locally

Scope:

- Restore life/nonlife mobile exam application screens to the legacy manual `응시료 납입일` flow.
- Keep `fee_paid_date` as the active mobile runtime payment field.
- Remove active mobile calls to `exam-application-submit`.
- Remove active mobile proxy applicant selection and virtual-account cards.
- Remove deployable Toss exam function entrypoints while leaving deferred contract material available.
- Do not edit Dawichok PDF or admin-scope sections.

Verification:

- Passed: mobile screens have no removed Toss/proxy runtime term matches.
- Passed: manual date picker and `fee_paid_date` writes remain in both mobile screens.
- Passed: deleted function entrypoints are absent on disk.
- Passed: targeted mobile lint.
- Passed: deferred payment contract test.

---

# Plan: Evidence-Based Cleanup / Refactor Program

## Increment 29: GaramIn Nine-Item Operations Upgrade

Status: in progress

Implementation order:

1. Lock the additive DB contract for Dawichok sent signals, headquarters scopes, notification delivery audit, per-registration Toss payments, and proxy exam application metadata.
2. Add focused characterization tests for workflow label/gate behavior, per-registration payment mapping, and admin scope filtering.
3. Implement low-risk mobile home UX changes in parallel with schema/function work.
4. Implement Dawichok copy and gate changes while preserving internal `hanwha_*` compatibility.
5. Implement trusted exam application/payment functions before changing mobile exam writers.
6. Implement admin web display/API changes for payment state, Dawichok send action, and scoped visibility.
7. Implement Kakao delivery as a non-blocking downstream notification channel.
8. Run full verification, update QA/handoff artifacts, and record any new mistake-ledger guardrails.

Parallel owners:

- Coordinator: schema contract, harness, integration, final verification.
- Mobile home worker: plan items 1-3 only.
- Workflow worker: Dawichok label/gate behavior.
- Supabase worker: additive schema and Edge Functions.
- Admin web worker: secretary/admin UI/API surfaces.
- Security auditor: read-only review of auth/RLS/payment/Kakao risks.

---

## Operating Rules

- Work in small increments with a written contract before implementation.
- Prefer behavior preservation and regression prevention over cosmetic cleanup.
- Do not delete, move, or merge anything without evidence from search, routing/runtime entrypoints, scripts, CI, docs, env use, and verification.
- Do not mix behavior changes with refactors.
- Preserve existing user changes and dirty worktree state.
- Never use `git reset --hard`, `git checkout --`, large deletion batches, or speculative cleanup.
- Update this harness on every increment.
- Update `.claude/MISTAKES.md` in the same change set if a repeatable mistake, regression, contract drift, or missed verification is discovered.

## Current Sentry Snapshot: 2026-06-01

Status: active Sentry repair increment completed. Increment 26 fixes Sentry issue `REACT-NATIVE-3` by changing `AppAlertProvider` so Reanimated `runOnJS` receives only a serializable button index and JS resolves/calls the button action with a `typeof onPress === 'function'` guard. This is a narrow production crash fix, not a broad alert redesign or native Sentry source-map/prebuild repair.

## Current Mobile Exam Snapshot: 2026-06-03

Status: hotfix increment completed locally. User reported Garam in secretary/admin exam round registration failure and delete-button crash. Live `admin-action` smoke for temporary exam round create/delete passed, so the backend trusted write path is not the immediate blocker. Sentry still reports `REACT-NATIVE-3` on release `fc-onboarding-app@3.1.12`, matching the AppAlert delete confirmation crash fixed locally in Increment 26 but not yet proven deployed. Mobile registration screens had a separate payload drift: they saved only committed `draftLocations`, ignored the pending location input, and allowed zero-location new rounds.

## Current Admin Web Snapshot: 2026-06-03

Status: admin dashboard copy/open hotfix completed locally. User reported developer-facing copy in the secretary/admin FC detail modal and non-working uploaded-file `열기` buttons. The copy issue was the allowance tab showing implementation wording (`trusted path`, `상태 흐름`, `Actual`). The file-open issue had two parts: client code opened the window only after awaiting signed URL fetch, and server signing expected raw object keys even when stored values arrived as Supabase storage URLs or relative storage paths.

## Increment 28: Admin Dashboard Operator Copy And File Open Fix

Status: completed

Scope:

- Replace user-facing admin dashboard implementation wording with operator-facing Korean.
- Keep code comments/logs/internal identifiers out of scope unless they render to users.
- Keep private file access server-mediated through `/api/admin/fc` `signDoc`.
- Normalize FC document storage inputs before signed URL creation.
- Open the pending file tab synchronously on click, then navigate after the signed URL returns.

Verification:

- RED: `node --experimental-strip-types --test src/lib/admin-fc-doc-storage.test.ts` failed before helper implementation with missing module.
- RED: `node --experimental-strip-types --test src/lib/admin-file-open.test.ts` failed before helper implementation with missing module.
- GREEN: `node --experimental-strip-types --test src/lib/admin-fc-doc-storage.test.ts src/lib/admin-file-open.test.ts` passed, 9 tests.
- Search for exact user-facing bad terms `trusted path`, `상태 흐름`, `동의일(Actual)` returned no matches.
- Targeted web lint passed.
- `cd web; SENTRY_AUTH_TOKEN='' npm run build` passed with existing warnings only.
- `node scripts/ci/check-governance.mjs` passed.
- `git diff --check` passed with CRLF normalization warnings only.

Deferred:

- Deployed admin dashboard smoke against real uploaded FC docs and browser popup-block settings.

## Increment 27: Mobile Exam Round Registration/Delete Hotfix

Status: completed

Scope:

- Add a pure exam-round location payload helper with contract coverage.
- Include pending location input in save payload for both `app/exam-register.tsx` and `app/exam-register2.tsx`.
- Require at least one existing or new location before save.
- Preserve trusted `admin-action` create/update/delete paths and manager read-only behavior.
- Reconfirm the existing AppAlert runOnJS/callable guard contract for delete confirmation crash protection.

Verification:

- RED: `npm test -- --runTestsByPath lib/__tests__/exam-round-location-payload.test.ts --runInBand` failed before helper implementation with missing module.
- GREEN: `npm test -- --runTestsByPath lib/__tests__/exam-round-location-payload.test.ts --runInBand` passed, 1 suite / 5 tests.
- GREEN: `npm test -- --runTestsByPath components/__tests__/AppAlertProvider.contract.test.ts --runInBand` passed, 1 suite / 4 tests.
- `npm run lint -- app/exam-register.tsx app/exam-register2.tsx lib/exam-round-location-payload.ts lib/__tests__/exam-round-location-payload.test.ts`: passed after fixing one syntax regression caught by lint.
- `npm test -- --runInBand`: passed, 30 suites / 193 tests.
- `npm run lint`: passed.
- `node scripts/ci/check-governance.mjs`: passed.
- `git diff --check`: passed with CRLF normalization warnings only.

Deferred:

- Fixed Android release and device-level create/delete smoke are required before claiming production delete crash resolution.

## Increment 26: Sentry AppAlert runOnJS Crash

Status: completed

Scope:

- Queried Sentry org `hanhwa-lifelab` project `react-native` and identified unresolved fatal issue `REACT-NATIVE-3`.
- Mapped the minified Android Hermes frame using a local Expo Android source-map export because Sentry had `js_no_source` for release `fc-onboarding-app@3.1.12`.
- Changed `AppAlertProvider` to pass a button index through `runOnJS`, resolve the button on the JS side, and call `onPress` only when it is a function.
- Added `components/app-alert-utils.ts` and focused contract tests.
- Added token-role guardrails so future Sentry issue/event reads use `SENTRY_READ_AUTH_TOKEN`, not the upload-only `SENTRY_AUTH_TOKEN`.

Verification:

- RED: targeted AppAlertProvider contract failed before implementation because helper/contract did not exist.
- GREEN: `npm test -- --runTestsByPath components/__tests__/AppAlertProvider.contract.test.ts --runInBand` passed, 1 suite / 4 tests.
- `npm run lint`: passed.
- `npm test -- --runInBand`: passed, 29 suites / 188 tests.
- `SENTRY_AUTH_TOKEN='' npm run build`: passed with existing Expo/Sentry/web export warnings only.
- `node scripts/ci/check-governance.mjs`: passed.
- `git diff --check`: passed with CRLF normalization warnings only.

Deferred:

- Do not mark `REACT-NATIVE-3` resolved until the fixed Android release is deployed and Sentry events stop.
- The existing Sentry native prebuild/source-map warning remains a separate observability/config follow-up.

## Current Reconciliation Snapshot: 2026-05-31

Status: active. Increment 25 is completed after classifying Jest `coverage/` as generated local state, adding ignore rules, and removing the current untracked generated coverage directory. The increment did not change production source, tests, package scripts, dependencies, lockfiles, env, schema, routes, PII/auth/session behavior, notification fanout, or request_board bridge contracts.

## Increment 25: Coverage Generated Artifact Hygiene

Status: completed

Scope:

- Added `coverage/` to root `.gitignore`.
- Added `coverage` to `.vercelignore`.
- Removed only the current untracked generated `coverage/` directory after verifying the resolved absolute path.
- Kept production source, tests, scripts, dependencies, lockfiles, env, schema/migrations, Supabase functions, request_board files, route behavior, PII/auth/session behavior, notification fanout, `dist/`, admin web `.next`, and deployment build settings out of scope.

Verification:

- Pre-change: `git ls-files -- coverage` returned no tracked files.
- Pre-change: `git status --short --untracked-files=all -- coverage` listed generated untracked coverage output.
- Pre-change: `git check-ignore -v coverage` had no ignore match.
- Guarded deletion: verified `E:\hanhwa\fc-onboarding-app\coverage`, then removed 104 generated files / 3,966,709 bytes.
- Post-change: `git check-ignore -v --no-index -- coverage/foo` maps to `.gitignore:72:coverage/`.
- Post-change: `Test-Path coverage=False`.
- Post-change: `git status --short --untracked-files=all -- coverage` returned no untracked coverage output.
- `node scripts/ci/check-governance.mjs`: passed.
- `git diff --check`: passed with CRLF normalization warnings only.

## Increment 24: Root TypeScript NoEmit Alignment

Status: completed

Scope:

- Fix only root TypeScript noEmit blockers found in appointment submit, Hanwha commission submit/workflow inputs, referral app-session error classification, Daum postcode WebView typings, and nullable referral-code response typing.
- Update the mobile auth/gate owner doc required by governance.
- Preserve runtime contracts and avoid high-risk PII/auth/schema/push/bridge areas.

Verification:

- RED: `npx tsc --noEmit` failed before implementation with localized blockers.
- GREEN: `npx tsc --noEmit` passed.
- `npm run lint`: passed.
- `npm test -- --runInBand`: passed, 29 suites / 185 tests.
- Direct Node characterization command: passed, 22 files / 107 tests.
- `npm run build`: passed with existing warnings only.
- `cd web; npm run lint`: passed.
- `cd web; npm run build`: passed with existing warnings only.
- Expo static export smoke on port 19006: `/=200`; port clear after stop.
- No-redirect Next production smoke on port 3100: `/reset-password=200`, `/dashboard=307 location=/auth`; port clear after stop.
- `node scripts/ci/check-governance.mjs`: passed.
- `git diff --check`: passed with CRLF normalization warnings only.

Deferred checks:

- Real device/simulator WebView postcode behavior.
- Authenticated appointment/Hanwha commission submit flows against an approved backend target.
- Authenticated role-specific browser QA, live bridge/password-sync, push/badge/deep-link checks, and Supabase remote migration parity.

## Increment 23: Admin Web Reset Password Public Route Guard

## Increment 23: Admin Web Reset Password Public Route Guard

Status: completed

Scope:

- Add and characterize a pure admin web public-path helper.
- Include `/reset-password` in the public-path contract.
- Use the helper from `web/middleware.ts`.
- Record redirect-following smoke drift in `.claude/MISTAKES.md`.

Out of scope:

- Login/session restore semantics beyond public-path classification, dashboard/admin protection, manager read-only behavior, Supabase reset function bodies, env/secrets, schema/migrations, request_board bridge/password-sync, dependencies/lockfiles, mobile routes, PII, push fanout, and large dashboard modules.

Verification:

- RED: `node --experimental-strip-types --test web/src/lib/admin-web-public-paths.test.ts` failed before implementation with missing helper module.
- GREEN: new helper test passed, 3 tests.
- Adjacent direct Node web tests passed, 13 tests.
- `cd web; npm run lint`: passed.
- `cd web; npm run build`: passed with existing warnings.
- No-redirect production smoke on port 3100 passed: `/reset-password=200`, `/auth=200`, `/dashboard=307 location=/auth`.
- `npm test -- --runInBand`: passed, 29 suites / 185 tests.
- `node scripts/ci/check-governance.mjs`: passed.
- `git diff --check`: passed with CRLF normalization warnings only.

## Previous Reconciliation Snapshot: 2026-05-30

Status: completed for reconciliation; Increment 20 verification-debt closeout, Increment 21 legacy generated artifact cleanup, and Increment 22 empty legacy export directory cleanup are completed.

Findings:

- Increment 19 `Root Jest Harness Alignment` is consistently recorded as completed in `current-contract.md`, `qa-report.md`, `handoff.md`, `product-spec.md`, `plan.md`, `.claude/WORK_LOG.md`, and `.claude/WORK_DETAIL.md`.
- Increment 20 `Verification Debt Alignment` fixed the graph simulation failures and root coverage collection errors found during the full local test sweep.
- The previous Windows `os error 1450` is recorded as a local resource execution failure. It did not recur in the Increment 19 `--runInBand` verification.
- Current dirty state is broad and belongs to prior completed characterization / documentation increments across PII, session restore, mobile unread, request_board password-sync, docs, and harness files.
- Increment 21 removed only ignored/untracked `dist-web-new2/` after proving it was a stale generated artifact reintroduced after the 2026-02-11 cleanup.
- Increment 22 removed only ignored/untracked/file-empty `dist-web/` and `dist-web-new/` directory trees after proving they were old generated local export directories and not current build outputs.
- No next fc-onboarding runtime increment is selected yet. The next fc runtime increment must get a fresh `current-contract.md`.

Completed evidence to preserve:

- `npm test -- --runTestsByPath lib/__tests__/referral-tree.test.ts --runInBand`: passed, 1 suite / 3 tests.
- Direct Node characterization command covering resident-number route, referral graph physics, and request-board password-sync: passed, 30 tests.
- `npm test -- --runInBand`: passed, 29 suites / 185 tests.
- `npm run lint`: passed.
- `npm run build`: passed with existing Expo/Sentry/static-export warnings only.
- `cd web; npm run lint`: passed.
- `cd web; npm run build`: passed with existing `baseline-browser-mapping` and OpenTelemetry `import-in-the-middle` warnings only.
- `node scripts/ci/check-governance.mjs`: passed.
- `git diff --check`: passed with CRLF normalization warnings only.
- Increment 20 additional evidence:
  - `node --experimental-strip-types --test .\web\src\lib\referral-graph-simulation.test.ts`: passed, 20/20.
  - Adjacent graph direct Node command: passed, 34/34.
  - Full direct Node characterization command: passed, 104/104.
  - `npm run test:coverage -- --runInBand`: passed, 29 suites / 185 tests, with no prior coverage collection errors.
  - Local `web` production HTTP smoke: `/auth` 200; protected dashboard routes redirect to `/auth`; server stopped after check.
- Increment 21 evidence:
  - `dist-web-new2/` was ignored by `.gitignore:11:dist-web-new2/`, untracked by `git ls-files`, and referenced only as stale/generated local output.
  - Guarded deletion verified the exact absolute path before `Remove-Item -Recurse`.
  - Post-delete `Test-Path dist-web-new2=False`, `git status --short --untracked-files=all -- dist-web-new2=<none>`.
  - Future reintroduction remains ignored: `git check-ignore -v --no-index -- dist-web-new2/foo`.
  - `node scripts/ci/check-governance.mjs` and `git diff --check` passed.
- Increment 22 evidence:
  - `dist-web/` and `dist-web-new/` existed only as empty nested directories with 2025-12-15 timestamps and zero files.
  - Both were ignored by `.gitignore`, untracked by `git ls-files`, and excluded by `.vercelignore`.
  - Guarded deletion verified both exact absolute paths before `Remove-Item -Recurse`.
  - Post-delete `Test-Path dist-web=False`, `Test-Path dist-web-new=False`.
  - Future reintroduction remains ignored: `git check-ignore -v --no-index -- dist-web/foo dist-web-new/foo`.
  - `node scripts/ci/check-governance.mjs` and `git diff --check` passed.

Deferred checks:

- Browser/runtime PII/auth smoke.
- Live Supabase/request_board bridge or password-sync smoke.
- Device/emulator checks.
- Supabase remote migration parity checks.

Do not touch next without a separate contract:

- Resident-number full-view, encrypted/plain fallback, direct decrypt fallback, and log masking.
- Admin/manager authorization, manager read-only, and cookie-first web session restore.
- Supabase schema/migration remote-state assumptions.
- Notification/push fanout and bridge unread.
- Large modules such as `app/dashboard.tsx`, `web/src/app/dashboard/page.tsx`, and `supabase/functions/fc-notify/index.ts`.

## Increment 21: Legacy Generated Artifact Cleanup

Status: completed

Scope:

- Remove only ignored/untracked `dist-web-new2/`.
- Update harness and work logs.
- Do not touch current generated outputs (`dist/`, `web/.next`), package scripts, deployment config, dependencies, lockfiles, env, source, schema, routes, PII/auth, bridge, notification, or UI behavior.

Evidence:

- `dist-web-new2/` existed, was about 3.91 MB, and was ignored by `.gitignore:11:dist-web-new2/`.
- `git ls-files -- dist-web-new2` returned no tracked files.
- `AGENTS.md` and `.claude/WORK_DETAIL.md` classify `dist-web-new2/*` as removed stale generated output from the 2026-02-11 cleanup.

Verification:

- Guarded removal verified the exact resolved target path before deletion.
- `Test-Path dist-web-new2=False`.
- `git status --short --untracked-files=all -- dist-web-new2=<none>`.
- `git check-ignore -v --no-index -- dist-web-new2/foo` maps future files to `.gitignore:11:dist-web-new2/`.
- `node scripts/ci/check-governance.mjs` passed.
- `git diff --check` passed with CRLF normalization warnings only.

## Increment 22: Empty Legacy Export Directory Cleanup

Status: completed

Scope:

- Remove only ignored/untracked/file-empty `dist-web/` and `dist-web-new/`.
- Update harness and work logs.
- Do not touch current generated outputs (`dist/`, `web/.next`), package scripts, deployment config, dependencies, lockfiles, env, source, schema, routes, PII/auth, bridge, notification, or UI behavior.

Evidence:

- `dist-web/` and `dist-web-new/` contained no files, only empty nested generated directories.
- Both directories were old, with 2025-12-15 timestamps.
- `git ls-files -- dist-web dist-web-new` returned no tracked files.
- `git check-ignore -v -- dist-web dist-web-new dist-web/foo dist-web-new/foo` returned `.gitignore` rules for both.
- `.vercelignore` excludes `dist-web` and `dist-web-new`.

Verification:

- Guarded removal verified the exact resolved target paths before deletion.
- `Test-Path dist-web=False`.
- `Test-Path dist-web-new=False`.
- `git status --short --untracked-files=all -- dist-web dist-web-new` returned no source/untracked output.
- `git check-ignore -v --no-index -- dist-web/foo dist-web-new/foo` maps future files to existing ignore rules.
- `node scripts/ci/check-governance.mjs` passed.
- `git diff --check` passed with CRLF normalization warnings only.

## Increment 1: Harness / Inventory Only

Status: completed

Scope:

- `fc-onboarding-app/.codex/harness/product-spec.md`
- `fc-onboarding-app/.codex/harness/plan.md`
- `fc-onboarding-app/.codex/harness/current-contract.md`
- `fc-onboarding-app/.codex/harness/qa-report.md`
- `fc-onboarding-app/.codex/harness/handoff.md`

Acceptance:

- Record active project list and repo roles.
- Record major entrypoints, package scripts, CI/governance, deploy/operations files.
- Record current git state and known user changes.
- Record cleanup/refactor candidates by category with evidence, risk, impact, verification, and decision.
- Do not delete or modify runtime code/config/assets.

## Increment 2: Stale Documentation Drift

Status: completed

Scope:

- Align `README.md` request_board-linked designer profile count with `AGENTS.md` because README declares AGENTS as source of truth.
- Update `.claude/WORK_LOG.md` and `.claude/WORK_DETAIL.md` for the documentation cleanup.
- Update harness contract, QA, and handoff.

Evidence:

- `README.md` line near the Current Snapshot had `54명`.
- `AGENTS.md` has `59명` for the same request_board-linked designer profile count.
- `README.md` declares `AGENTS.md` as the source of truth.

Decision:

- Modify stale documentation only.
- Do not claim fresh live DB verification.
- Do not touch runtime code/config/dependencies/assets.

Verification:

- `rg -n -C 3 "request_board-linked 설계매니저 프로필|현재 앱 DB 기준" README.md AGENTS.md`
- `git diff --name-only`
- `node scripts/ci/check-governance.mjs`

## Increment 3: Generated Expo Web Output / Deployment Docs Drift

Status: completed

Scope:

- Clarify `dist/` as ignored, untracked Expo web export output generated by root `npm run build`.
- Align deployment docs so admin web Next.js Vercel deployment and Expo static export deployment are not mixed.
- Do not delete generated output in this increment.
- Update `.claude` work logs and harness notes.

Evidence:

- `package.json` root build script is `expo export --platform web`.
- `.gitignore` ignores `dist/`, `dist-web/`, `dist-web-new/`, `dist-web-new2/`, and `web-build/`.
- `.vercelignore` excludes `dist` and `dist-web*`.
- `git ls-files dist` returns no tracked files.
- `git status --ignored --short -- dist` reports `!! dist/`.
- root `vercel.json` builds the admin web from `web/` and outputs `web/.next`.
- `CLAUDE.md` and `docs/guides/명령어 모음집.txt` also carried stale or ambiguous static export / Vercel deployment wording.
- Context7 Expo docs confirm `expo export --platform web` generates a `dist` directory by default.

Decision:

- Modify deployment/operator docs only.
- Defer deleting `dist/`; it is local generated output, not tracked source cleanup.
- Do not change runtime code, config, dependencies, Vercel settings, or package scripts.

Verification:

- `git ls-files dist`
- `git status --ignored --short -- dist`
- `rg` for remaining deployment/static export references outside generated output
- `node scripts/ci/check-governance.mjs`

## Increment 4: PII Trusted-Path Phone Candidate Characterization

Status: completed

Scope:

- Extract the existing raw/digits/hyphenated phone candidate generation from `web/src/lib/server-session.ts` into a pure helper.
- Keep the existing `@/lib/server-session` export stable for current route imports.
- Add a focused characterization test for the phone candidate contract that resident-number/admin trusted routes rely on.
- Do not change authorization, resident-number read behavior, UI, schema, env, or deployment config.

Evidence:

- `docs/handbook/shared/security-and-secret-operations.md` explicitly warns that admin/manager `session_resident` must not be treated as digits-only; raw/digits/hyphenated candidates must be accepted.
- `docs/handbook/backend/admin-operations-api.md` requires `/api/admin/resident-numbers` and `/api/admin/fc` session verification to use the same phone format rules.
- `web/src/app/api/admin/fc/route.ts` and `web/src/app/api/admin/exam-applicants/route.ts` import `buildPhoneCandidates` from `web/src/lib/server-session.ts`.
- `.claude/MISTAKES.md` records prior resident-number route drift, making characterization mandatory before larger cleanup.

Decision:

- Add characterization and a pure helper extraction only.
- Do not broaden into direct decrypt/edge fallback changes in this increment.

Verification:

- RED/GREEN `node --experimental-strip-types --test web/src/lib/phone-candidates.test.ts`
- `rg -n "buildPhoneCandidates|phone-candidates" web/src/lib web/src/app/api/admin`
- `node scripts/ci/check-governance.mjs`

## Increment 5: Resident-Number Direct Decrypt Mode Characterization

Status: completed

Scope:

- Extract `FC_IDENTITY_DIRECT_DECRYPT_MODE` normalization from `web/src/lib/server-resident-numbers.ts` into a pure helper.
- Characterize existing mode mapping and invalid-value default behavior.
- Preserve current warning/fallback behavior in `server-resident-numbers.ts`.
- Do not change direct decrypt, edge fallback fetch, route authorization, UI, schema, env names, or generated output.

Evidence:

- `web/src/lib/server-resident-numbers.ts` currently owns direct decrypt mode parsing inline.
- `docs/handbook/admin-web/dashboard-lifecycle.md` requires degraded direct decrypt runtimes to keep the trusted full-view path via fallback rather than masking.
- Resident-number decrypt is listed as a privileged admin operation in `docs/handbook/backend/admin-operations-api.md`.

Decision:

- Add characterization around pure runtime mode parsing before attempting any broader resident-number fallback refactor.
- Avoid mock-heavy tests around Supabase/fetch in this increment.

Verification:

- RED/GREEN `node --experimental-strip-types --test web/src/lib/resident-number-runtime.test.ts`
- Targeted web lint for helper and `server-resident-numbers.ts`
- `node scripts/ci/check-governance.mjs`

## Increment 6: Resident-Number Edge Fallback Request Characterization

Status: completed

Scope:

- Extract construction of the resident-number edge fallback request from `web/src/lib/server-resident-numbers.ts` into a pure helper.
- Characterize the exact fallback URL, headers, method, and JSON body used for `admin-action:getResidentNumbers`.
- Preserve fetch execution, response parsing, direct decrypt, env names, authorization, UI, schema, and generated output.

Evidence:

- `server-resident-numbers.ts` currently builds the fallback fetch request inline.
- Docs require degraded direct decrypt runtimes to keep trusted full-view semantics through fallback/logging.
- Increment 5 characterized mode parsing; request-shape characterization is the next smallest seam before route-level fallback tests.

Decision:

- Add pure helper/test only.
- Do not normalize trailing slash behavior or change the request contract in this increment.

Verification:

- RED/GREEN `node --experimental-strip-types --test web/src/lib/resident-number-edge-fallback.test.ts`
- Regression `node --experimental-strip-types --test web/src/lib/resident-number-runtime.test.ts`
- Targeted web lint for helper and `server-resident-numbers.ts`
- `node scripts/ci/check-governance.mjs`

## Increment 7: Resident-Number Edge Fallback Response Characterization

Status: completed

Scope:

- Extract resident-number edge fallback response validation and failure message selection from `web/src/lib/server-resident-numbers.ts` into a pure helper.
- Characterize the current success contract and failure message priority.
- Preserve fetch execution, request shape, direct decrypt, env names, authorization, UI, schema, and generated output.

Evidence:

- `server-resident-numbers.ts` currently validates fallback response shape inline.
- Increment 6 characterized fallback request construction; response validation is the next smallest seam before route-level fallback tests.
- Docs require degraded direct decrypt runtimes to preserve trusted full-view semantics through fallback/logging.

Decision:

- Add pure helper/test only.
- Do not change thrown error prefix, log body/status fields, response parsing timing, or fallback request shape.

Verification:

- RED/GREEN `node --experimental-strip-types --test web/src/lib/resident-number-edge-response.test.ts`
- Regression helper tests for request/mode/phone candidates
- Targeted web lint for helper and `server-resident-numbers.ts`
- `node scripts/ci/check-governance.mjs`

## Increment 8: Resident-Number Edge Fallback Execution Characterization

Status: completed

Scope:

- Extract the edge fallback execution block from `web/src/lib/server-resident-numbers.ts` into a dependency-injected helper.
- Characterize missing-env, successful fetch, failed response, and invalid JSON/default-message behavior without importing Next/Supabase alias-bound modules.
- Preserve direct decrypt, request shape, response validation, env names, authorization, UI, schema, and generated output.

Evidence:

- `server-resident-numbers.ts` still owns fallback execution inline after helperizing mode/request/response pieces.
- Increments 5-7 characterized the pieces needed to safely isolate execution behavior.
- Docs require degraded direct decrypt runtimes to preserve trusted full-view semantics through fallback/logging.

Decision:

- Add dependency-injected helper/test only.
- Do not change request/response contracts or introduce env normalization.

Verification:

- RED/GREEN `node --experimental-strip-types --test web/src/lib/resident-number-edge-executor.test.ts`
- Regression helper tests for response/request/mode/phone candidates
- Targeted web lint for helper and `server-resident-numbers.ts`
- `web` build after production import-path correction
- `node scripts/ci/check-governance.mjs`

## Increment 9: Resident-Number Route fcIds Normalization Characterization

Status: completed

Scope:

- Extract `POST /api/admin/resident-numbers` request `fcIds` normalization into `web/src/lib/resident-number-route-request.ts`.
- Characterize the current route request parsing contract:
  - non-array input returns `[]`
  - values are coerced via `String(value ?? '')`
  - whitespace is trimmed
  - blank entries are removed
  - duplicates are removed while preserving first-seen order
- Preserve route authorization, rate limiting, empty-list success response, resident-number read behavior, direct decrypt, edge fallback, env, schema, generated output, and UI.

Evidence:

- `web/src/app/api/admin/resident-numbers/route.ts` normalized `body.fcIds` inline.
- Increments 4-8 characterized supporting PII trusted-path helpers, but route-level request parsing remained uncharacterized.
- `.claude/MISTAKES.md` records prior resident-number route drift across dashboard/profile/exam-applicant surfaces.

Decision:

- Add RED/GREEN characterization around pure request normalization before any broader route-level resident-number cleanup.
- Do not import Next.js route modules in the test.
- Do not change auth/session/rate-limit/downstream resident-number behavior.

Verification:

- RED: `node --experimental-strip-types --test web/src/lib/resident-number-route-request.test.ts` failed with missing helper module.
- GREEN: `node --experimental-strip-types --test web/src/lib/resident-number-route-request.test.ts`
- Regression helper tests: resident-number edge executor/response/fallback/runtime and phone candidates.
- Targeted web lint for route/helper/test.
- `cd web; npm run build`

## Increment 10: Mobile Unread Checkpoint Key Characterization

Status: completed

Scope:

- Export the existing `buildNotificationCheckpointKey` helper from `lib/notification-checkpoint.ts`.
- Add characterization coverage for the mobile unread checkpoint key:
  - `null` role defaults to `guest`
  - missing/blank `residentId` defaults to `global`
  - resident id is trimmed
  - missing `requestBoardRole` defaults to `none`
  - FC and designer request_board roles produce distinct checkpoint keys
- Preserve AsyncStorage checkpoint persistence, checkpoint date initialization, mobile unread count fetching, request_board API calls, Supabase calls, native badge behavior, UI, schema, dependencies, and generated output.

Evidence:

- `AGENTS.md` records unread checkpoint keys as `role + residentId + requestBoardRole`.
- `lib/mobile-unread-notification-count.ts` reads this checkpoint before excluding stored request_board inbox categories and adding live request_board unread counts.
- `lib/notification-checkpoint.ts` owned the key builder inline without direct test coverage.

Decision:

- Add a testable export and characterization only.
- Do not change bridge unread network/session behavior or checkpoint storage behavior.

Verification:

- RED: `npx jest lib/__tests__/notification-checkpoint.test.ts --runInBand` failed with missing export.
- GREEN: `npx jest lib/__tests__/notification-checkpoint.test.ts --runInBand`.
- Regression: `npx jest lib/__tests__/push-registration.test.ts lib/__tests__/request-board-session.test.ts --runInBand`.
- Targeted lint for checkpoint helper/test.
- `node scripts/ci/check-governance.mjs`.

## Increment 11: Mobile Bridge Unread Plan Characterization

Status: completed

Scope:

- Extract pure bridge unread planning/body/total helpers into `lib/mobile-unread-notification-count-plan.ts`.
- Characterize the current mobile unread bridge contract:
  - role-less sessions do not fetch and do not include live request_board unread, even if a stale requestBoardRole value is present
  - FC sessions and bridged `requestBoardRole='fc' | 'designer'` sessions include live request_board unread
  - internal admin sessions without request_board role stay on fc-onboarding unread only
  - `fc-notify` body keeps `type`, `role`, `resident_id`, `since`, and `exclude_request_board_categories`
  - total count is `Number(fcNotifyCount ?? 0)` plus request_board unread only when live request_board unread is included
- Preserve AsyncStorage checkpoint reads, Supabase invoke behavior, request_board API call behavior, catch/log fallback, native badge behavior, UI, schema, env, dependencies, and generated output.

Evidence:

- `lib/mobile-unread-notification-count.ts` owned bridge access, `exclude_request_board_categories`, and final count addition inline.
- Increment 10 characterized checkpoint key scope; this is the next smallest bridge unread seam.
- Handoff identifies bridge unread as a high-risk notification contract.

Decision:

- Add pure helper/test and wire only those pure pieces.
- Do not introduce mock-heavy async tests or change network/session behavior in this increment.

Verification:

- RED: `npx jest lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand` failed with missing helper module.
- Additional RED/GREEN: role-null with stale requestBoardRole initially exposed `includeLiveRequestBoardUnread: true`; test added and helper corrected.
- GREEN: `npx jest lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand`.
- Regression: `npx jest lib/__tests__/notification-checkpoint.test.ts lib/__tests__/push-registration.test.ts lib/__tests__/request-board-session.test.ts --runInBand`.
- Targeted lint for mobile unread helper/source/test.
- `node scripts/ci/check-governance.mjs`.

## Increment 12: Mobile Unread Async Orchestration Characterization

Status: completed

Scope:

- Extend `lib/mobile-unread-notification-count-plan.ts` with a dependency-injected helper for `fetchMobileUnreadNotificationCount` orchestration.
- Characterize:
  - role-less short-circuit before dependency calls
  - checkpoint read with `initializeIfMissing: false`
  - current `fc-notify` unread body with checkpoint `since`
  - live request_board unread fetch only when the bridge plan includes it
  - fallback logging/zero return for `fc-notify` and request_board unread failures
- Rewire `lib/mobile-unread-notification-count.ts` to inject current runtime dependencies into the helper.
- Preserve checkpoint storage, Supabase invocation target, request_board API call, catch/log fallback text, native badge behavior, UI, schema, env, dependencies, and generated output.

Evidence:

- Increment 10 fixed checkpoint key coverage and increment 11 fixed bridge plan/body/total coverage.
- `mobile-unread-notification-count.ts` still owned async orchestration inline, leaving call order/fallback behavior uncovered without runtime clients.
- The dependency-injected helper can characterize this behavior without changing network/session behavior.

Decision:

- Add tests first, confirm RED, then delegate only orchestration.
- Do not change `fc-notify`, request_board API, checkpoint persistence, native badge, UI, schema, env, dependencies, or generated output.

Verification:

- RED: `npx jest lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand` failed with missing `fetchMobileUnreadNotificationCountWithDeps` export.
- GREEN: `npx jest lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand`.
- Regression: `npx jest lib/__tests__/notification-checkpoint.test.ts lib/__tests__/push-registration.test.ts lib/__tests__/request-board-session.test.ts --runInBand`.
- Targeted lint for mobile unread helper/source/test.
- `node scripts/ci/check-governance.mjs`.
- `git diff --check`.

## Increment 13: Resident-Number Route Branch Characterization

Status: completed

Scope:

- Add `web/src/lib/resident-number-route-handler.ts` as a dependency-injected helper for `POST /api/admin/resident-numbers` branch orchestration.
- Rewire `web/src/app/api/admin/resident-numbers/route.ts` so the route still owns NextResponse/SECURITY_HEADERS wiring while the helper owns branch sequencing.
- Characterize:
  - session failure short-circuits before rate-limit/body/read work
  - rate-limit failure short-circuits before JSON parsing/read work
  - invalid JSON logs and returns the current 400 response
  - empty normalized `fcIds` returns current success shape without read work
  - successful read uses normalized `fcIds`, session digits as `staffPhone`, and the current log prefix
  - read failure logs and returns the current generic 500 response
- Preserve session verification internals, rate-limit implementation, resident-number read behavior, direct decrypt, edge fallback, env/config, schema, generated output, dependencies, and UI.

Evidence:

- Increments 4-9 characterized supporting trusted-path helpers and request `fcIds` normalization.
- The route still owned auth/rate-limit/body/read branch order inline.
- `.claude/MISTAKES.md` records prior resident-number surface drift and false completion around PII full-view trusted paths.

Decision:

- Add tests first, confirm RED, then extract only route branch orchestration.
- Avoid importing the Next route module into direct Node tests.
- Do not change PII read behavior or route authorization internals.

Verification:

- RED: `node --experimental-strip-types --test web/src/lib/resident-number-route-handler.test.ts` failed with missing helper module.
- GREEN: `node --experimental-strip-types --test web/src/lib/resident-number-route-handler.test.ts`.
- Regression: resident-number route request and edge fallback helper tests.
- Targeted web lint for the route/helper/test.
- `cd web; npm run build`.
- `node scripts/ci/check-governance.mjs`.
- `git diff --check`.

## Increment 14: Exam-Applicant Resident-Number Enrichment Characterization

Status: completed

Scope:

- Add `web/src/lib/exam-applicant-resident-number-enrichment.ts` as a pure helper for `GET /api/admin/exam-applicants` row defaults, phone-candidate profile matching, resident-number `fcIds` planning, and response enrichment.
- Rewire only the mapping/enrichment portion of `web/src/app/api/admin/exam-applicants/route.ts` through the helper.
- Characterize:
  - exam registration base field/default mapping
  - shared raw/digits/hyphenated phone candidate matching
  - de-duplicated profile ids passed to resident-number reads
  - full resident-number replacement by profile id
  - missing profile fallback fields
  - null/missing resident-number fallback literal
- Preserve read/write authorization, staff verification, rate-limit keys/limits/windows, Supabase query shape/order/limit, `readResidentNumbersWithFallback` options, direct decrypt, edge fallback, env/config, schema, generated output, dependencies, and UI.

Evidence:

- Increments 4-9 and 13 characterized adjacent PII trusted-path helper and route contracts.
- `exam-applicants` still had full-view enrichment inline, which made later cleanup risky.
- The enrichment contract can be tested without Supabase, cookies, Next runtime, direct decrypt, edge fallback fetches, or browser UI.

Decision:

- Add tests first, confirm RED, then extract pure mapping/enrichment only.
- Use `*.test.node.ts` for the new direct Node test so it is not collected by root Jest or Next typecheck while still preserving direct Node `.ts` imports.
- Do not change PII read behavior or route authorization internals.

Verification:

- RED: direct Node test failed with missing enrichment helper.
- GREEN: direct Node enrichment test passed.
- Regression: phone candidates and resident-number helper tests passed.
- Targeted web lint passed.
- `cd web; npm run build` passed after correcting the direct Node test filename from `*.node-test.ts` to `*.test.node.ts`.
- `npm run lint` passed.
- `npm test` was run and still failed on existing root Jest harness/type issues; the new enrichment test is not in the final failure list.
- `npm run build` passed.
- `node scripts/ci/check-governance.mjs` passed.
- `git diff --check` passed with CRLF warnings only.

## Increment 15: Resident-Number Birth-Date Display Characterization

Status: completed

Scope:

- Add `web/src/lib/resident-number-display.ts` as a pure helper for resident-number birth-date display formatting.
- Rewire `web/src/hooks/use-resident-number.ts` to use the helper for `birthDateDisplay`.
- Rewire `web/src/app/dashboard/profile/[id]/page.tsx` to use `useResidentNumber().birthDateDisplay` instead of a local duplicate `getBirthDate`.
- Preserve resident-number fetch, trusted full-view policy, route/API behavior, direct decrypt, edge fallback, session/auth, manager read-only, form submit behavior, visual layout, env/config, schema, dependencies, deployment files, generated output, and assets.

Evidence:

- `web/src/hooks/use-resident-number.ts` had a local birth-date formatter and returned `birthDateDisplay`.
- `web/src/app/dashboard/page.tsx` already consumed the hook-provided `birthDateDisplay`.
- `web/src/app/dashboard/profile/[id]/page.tsx` duplicated the same resident-number-to-birth-date parsing locally.
- Admin web handbook requires `/dashboard` modal and `/dashboard/profile/[id]` resident-number full-view surfaces to share the trusted web contract.

Decision:

- Add tests first, confirm RED, then extract only display formatting.
- Use a direct Node `*.test.node.ts` test file to avoid reintroducing root Jest/Next collection issues from direct `.ts` imports.
- Defer browser/runtime PII smoke because the route/API and layout are unchanged.

Verification:

- RED: `node --experimental-strip-types --test web/src/lib/resident-number-display.test.node.ts` failed with missing helper module.
- GREEN: `node --experimental-strip-types --test web/src/lib/resident-number-display.test.node.ts`.
- Regression: resident-number helper tests passed.
- Targeted web lint passed.
- `cd web; npm run build` passed.
- `npm run lint` passed.
- `node scripts/ci/check-governance.mjs` passed.
- `git diff --check` passed with CRLF warnings only.

## Increment 16: Client Session Restore Contract Characterization

Status: completed

Scope:

- Add `web/src/lib/client-session-restore.ts` as a pure helper for admin web client session restore choice, resident id mask formatting, and read-only role calculation.
- Rewire `web/src/hooks/use-session.tsx` to use the helper for:
  - cookie-first restore choice
  - resident mask formatting
  - manager read-only calculation
- Preserve cookie names/parsing/writes, localStorage key/read/write, obfuscation/deobfuscation, hydration timing, login/logout redirects, server session validation, middleware behavior, dashboard route authorization, manager write-protection UI, Supabase access, env/config, schema, dependencies, generated output, and UI layout.

Evidence:

- `web/src/hooks/use-session.tsx` still had inline `computeMask`, inline `readSessionFromCookies() ?? readSessionFromStorage()` restore choice, and inline `state.role === 'manager'` read-only calculation.
- `AGENTS.md`, `web/AGENTS.md`, and handoff list cookie-first web session restore and manager read-only behavior as high-risk contracts to preserve.
- The selected boundary can be tested without React rendering, Next router, cookies, localStorage, Supabase, browser runtime, or dashboard APIs.

Decision:

- Add tests first, confirm RED, then extract only pure restore/mask/read-only calculations.
- Preserve the existing short-circuit behavior by reading localStorage only when no cookie session was restored.
- Defer browser/runtime auth smoke and broader dashboard manager-read-only UI verification.

Verification:

- RED: `node --experimental-strip-types --test web/src/lib/client-session-restore.test.node.ts` failed with missing helper module.
- GREEN: `node --experimental-strip-types --test web/src/lib/client-session-restore.test.node.ts` passed.
- Regression: resident-number/session-adjacent helper tests passed.
- Targeted web lint passed.
- `cd web; npm run build` passed.
- `npm run lint` passed.
- `node scripts/ci/check-governance.mjs` passed.

## Increment 17: Request Board Password Sync Body Contract Characterization

Status: completed

Scope:

- Export the current request body builder from `supabase/functions/_shared/request-board-password-sync.ts`.
- Add direct Node characterization coverage under `supabase/functions/_shared/__tests__/request-board-password-sync.test.ts`.
- Keep `syncRequestBoardPassword` fetch execution, headers, timeout, warnings, response parsing, missing-url/token skip behavior, env/secrets, and caller role decisions unchanged.
- Add the new shared test path to `docs/handbook/path-owner-map.json`.
- Update the required handbook owner docs if changing `path-owner-map.json` triggers owner-doc enforcement for this worktree's accumulated code changes.

Evidence:

- Cross-repo bridge/password-sync drift is a high-risk area in AGENTS/handoff and the shared bridge contract.
- The request body builder was already centralized but private, leaving no direct characterization for outbound role/name/company/affiliation metadata shape.
- `request_board` now has inbound password-sync role/update characterization; this increment adds the matching fc-onboarding outbound body contract.

Decision:

- Add RED/GREEN test around the pure body helper only.
- Preserve current truthiness behavior and no-trim behavior.
- Defer caller role resolution, password hashing, env/secret checks, fetch behavior, and live sync smoke.

Verification:

- RED: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` failed with missing export `buildRequestBoardPasswordSyncBody`.
- GREEN: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` passed 5 tests.
- `node scripts/ci/check-governance.mjs` passed.
  - Note: governance failed once after `path-owner-map.json` changed; required handbook owner docs were updated and the command passed on rerun.
- `git diff --check` passed with CRLF normalization warnings only.

## Increment 18: Request Board Password Sync Fetch Contract Characterization

Status: completed

Scope:

- Export a dependency-injected request_board password-sync execution helper from `supabase/functions/_shared/request-board-password-sync.ts`.
- Keep `syncRequestBoardPassword` as the production wrapper using global `fetch`, `AbortController`, timers, and `console.warn`.
- Preserve body shape, header names, timeout behavior, warning text, response parsing, skip behavior, env/secrets, caller role decisions, and request_board inbound behavior.

Evidence:

- After increment 17, request body shape was characterized, but fetch execution, timeout cleanup, warnings, response parsing, and non-throwing failures were still inline and hard to test without live URL/token.
- The cross-repo password-sync path is high-risk and should have executable behavior anchors before broader bridge/password-sync cleanup.
- The selected seam can be tested with injected fetch/timer/warn dependencies without network, Supabase, Deno serve, browser runtime, or production secrets.

Decision:

- Add tests first, confirm RED, then extract only dependency wiring around the existing execution behavior.
- Preserve current behavior exactly: missing URL/token skips, POST headers/body, abort timeout scheduling, clear timeout in `finally`, non-2xx warning, `success !== true` warning, fetch error warning, and no throw.
- Defer live sync smoke, caller role planning, env/secret checks, and request_board inbound API behavior.

Verification:

- RED: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` failed with missing export `syncRequestBoardPasswordWithDeps`.
- GREEN: `node --experimental-strip-types --test supabase/functions/_shared/__tests__/request-board-password-sync.test.ts` passed 10 tests.
- `node scripts/ci/check-governance.mjs` passed.
- `git diff --check` passed with CRLF normalization warnings only.
- `git status --short --branch` reviewed.

## Cleanup / Refactor Inventory

### unused

- Candidate: ignored local Expo web output under `dist/`.
  - Evidence: `.gitignore` ignores `dist/`; `rg --files` found many generated files under `dist/`; `git ls-files dist` showed no tracked source; root `npm run build` generates Expo web export output; Context7 Expo docs confirm the default output directory is `dist`.
  - Risk: low for source repo, medium for local workspace if a developer relies on local output.
  - Impact: disk/workspace noise only unless referenced by an intentional static deployment outside git.
  - Verification: `git ls-files dist`; `git status --ignored --short -- dist`; deployment docs/config search; source build command review.
  - Decision: audited in increment 3; delete deferred because it is generated operational output, not tracked source cleanup.

- Candidate: potentially unused legacy scripts/assets.
  - Evidence: not yet proven; only broad inventory has been run.
  - Risk: unknown.
  - Impact: unknown.
  - Verification: search package scripts, CI, docs, runtime imports, deployment notes, env use.
  - Decision: defer.

### duplicate

- Candidate: mobile/web duplication around dashboard/session/identity/bridge logic.
  - Evidence: large surfaces exist in `app/dashboard.tsx`, `web/src/app/dashboard/page.tsx`, and request board bridge files; handbook emphasizes shared contracts.
  - Risk: high because auth, read-only manager state, and bridge behavior are user-facing.
  - Impact: admin/mobile login/session and dashboard behavior.
  - Verification: route-level characterization, auth/session tests, manual smoke for manager/admin flows.
  - Decision: defer; future refactor only with contract tests.

- Candidate: web trusted-route phone identifier candidate logic embedded in session helper and consumed by resident-number/admin routes.
  - Evidence: `buildPhoneCandidates` is a shared route contract used by `/api/admin/fc` and `/api/admin/exam-applicants`; docs require raw/digits/hyphenated matching.
  - Risk: high if changed accidentally because admin/manager resident-number full-view can fail across routes.
  - Impact: web trusted PII read, exam applicant list enrichment, admin session verification.
  - Verification: characterization test plus route import search.
  - Decision: increment 4 extracts to pure helper with stable re-export and characterization coverage.

### stale docs

- Candidate: linked designer profile count drift.
  - Evidence: `README.md` observed `54명`; `AGENTS.md` observed `59명`.
  - Risk: low for runtime, medium for operator trust.
  - Impact: onboarding/admin documentation.
  - Verification: README source-of-truth statement points to `AGENTS.md`; governance check.
  - Decision: corrected in increment 2; no live DB verification claimed.

- Candidate: admin web deployment and Expo static export command drift.
  - Evidence: deployment docs, `CLAUDE.md`, and `docs/guides/명령어 모음집.txt` mixed root/admin web Vercel config with Expo generated `dist/` deployment and stale `dist/web` wording.
  - Risk: medium; operators could deploy the wrong project or infer production state from stale local artifacts.
  - Impact: deployment/operator guidance only.
  - Verification: Vercel config/package script review, generated output git status checks, docs search, governance.
  - Decision: corrected in increment 3; no production deployment verification claimed.

### dead assets

- Candidate: generated web assets under ignored build output.
  - Evidence: generated files under ignored `dist/`; not tracked; root build can regenerate Expo static output.
  - Risk: low for git, unknown for local workflows.
  - Impact: local disk only unless a manual static deploy intentionally uses a fresh export.
  - Verification: package scripts, Vercel config, docs, git ignored/tracked state.
  - Decision: defer deletion after increment 3; docs now say to rebuild fresh and not commit/deploy stale checkout output.

### obsolete deps

- Candidate: separate root/web dependency versions for React and Supabase.
  - Evidence: root package uses React `19.1.0` and Supabase `^2.84.0`; web package uses React `19.2.0` and Supabase `^2.86.2`.
  - Risk: high; packages may target different platform/toolchain constraints.
  - Impact: Expo/mobile, Next.js admin web, lockfiles/builds.
  - Verification: inspect lockfiles, import surfaces, Expo/Next compatibility docs, run root and web builds/tests.
  - Decision: defer; no dependency changes without context7 and full validation.

### risky scripts/config

- Candidate: Supabase schema/migration remote drift.
  - Evidence: `.claude/MISTAKES.md` records prior false completion and remote migration drift issues.
  - Risk: high.
  - Impact: PII/full-view, admin dashboard, request board bridge, notification behavior.
  - Verification: local migration list, remote migration state, application logs/CLI output.
  - Decision: defer; never infer remote state from local files only.

- Candidate: cross-repo bridge secret drift.
  - Evidence: product docs define matching secret pairs between fc-onboarding-app and request_board.
  - Risk: high.
  - Impact: auth bridge and password sync.
  - Verification: env documentation, deployment envs if available, bridge smoke tests.
  - Decision: defer; do not print or modify secrets.

- Candidate: request_board password-sync outbound body drift.
  - Evidence: shared helper built request_board sync body privately while multiple auth/password flows call it.
  - Risk: high if role/name/company/affiliation metadata drifts from request_board inbound contract.
  - Impact: login, password reset, direct request_board account sync, manager/developer/designer mirrors.
  - Verification: direct Node request-body characterization plus governance owner-map check.
  - Decision: increment 17 exported and characterized the current body builder while preserving fetch/env/secret behavior.

- Candidate: request_board password-sync outbound fetch behavior drift.
  - Evidence: after increment 17, `syncRequestBoardPassword` still owned skip conditions, fetch init, timeout cleanup, warning/logging, response parsing, and non-throwing failures inline.
  - Risk: high if future cleanup changes token header names, timeout behavior, or non-throwing failure semantics in the cross-repo password-sync path.
  - Impact: login, password reset, direct request_board account sync, manager/developer/designer mirrors.
  - Verification: direct Node dependency-injected fetch behavior characterization plus governance check.
  - Decision: increment 18 exported `syncRequestBoardPasswordWithDeps` and characterized current skip/fetch/timeout/warning/error behavior while preserving env/secrets/caller role decisions and request_board inbound behavior.

### performance

- Candidate: oversized dashboards and notification function.
  - Evidence: large modules: `app/dashboard.tsx` (~3954), `web/src/app/dashboard/page.tsx` (~3279), `supabase/functions/fc-notify/index.ts` (~1445).
  - Risk: medium to high; extraction can change state lifecycles or side effects.
  - Impact: mobile dashboard, admin dashboard, notification delivery.
  - Verification: build/lint/tests, route smoke, performance baseline if optimizing.
  - Decision: defer; start with non-behavioral characterization.

### oversized modules

- Candidate: `app/dashboard.tsx`.
  - Evidence: ~3954 lines.
  - Risk: high.
  - Impact: core mobile dashboard.
  - Verification: identify stable subcomponents/hooks, add characterization before extraction.
  - Decision: defer.

- Candidate: `web/src/app/dashboard/page.tsx`.
  - Evidence: ~3279 lines.
  - Risk: high.
  - Impact: admin dashboard lifecycle.
  - Verification: web build/lint plus browser smoke for core dashboard states.
  - Decision: defer.

### contract/type drift

- Candidate: trusted PII/full-view and encrypted/plain fallback boundaries.
  - Evidence: AGENTS/handbook/mistake logs call out resident-number masking and trusted path as high risk.
  - Risk: critical.
  - Impact: privacy, admin operations, logs.
  - Verification: targeted tests and log inspection before any refactor.
  - Decision: defer; no change without explicit contract.

- Candidate: resident-number direct decrypt mode and edge fallback runtime contract.
  - Evidence: `server-resident-numbers.ts` uses `FC_IDENTITY_DIRECT_DECRYPT_MODE` to choose direct decrypt vs edge fallback; docs require degraded direct decrypt runtime to preserve trusted full-view semantics via fallback.
  - Risk: high if mode parsing drifts because production can silently skip direct decrypt or lose fallback visibility.
  - Impact: `/api/admin/resident-numbers`, exam applicant full-view enrichment, admin dashboard/profile trusted PII display.
  - Verification: pure mode parser characterization, then later fallback behavior tests.
  - Decision: increment 5 extracts mode parser with characterization coverage; full fallback fetch tests deferred.

- Candidate: resident-number edge fallback request contract embedded inline.
  - Evidence: `server-resident-numbers.ts` embeds admin-action fallback URL, headers, method, and JSON body inline.
  - Risk: high if refactor changes service-role auth headers, action name, or payload shape.
  - Impact: degraded resident-number runtime fallback for admin dashboard/profile and exam applicant full-view.
  - Verification: pure request-shape characterization; later controlled fetch behavior test.
  - Decision: increment 6 extracts request builder with characterization coverage; no request shape changes.

- Candidate: resident-number edge fallback response validation embedded inline.
  - Evidence: `server-resident-numbers.ts` embeds success shape validation and message/error/default failure message selection after fallback fetch.
  - Risk: high if refactor accepts malformed `residentNumbers` or hides server-provided error messages.
  - Impact: degraded resident-number runtime fallback diagnostics and trusted full-view failure behavior.
  - Verification: pure response validation/message characterization; later controlled fetch behavior test.
  - Decision: increment 7 extracts response parser with characterization coverage; no response behavior changes.

- Candidate: resident-number edge fallback execution embedded inline.
  - Evidence: after increments 5-7, `server-resident-numbers.ts` still coordinates missing-env checks, fallback fetch execution, response logging, and thrown error prefix inline.
  - Risk: high if refactor changes missing-env diagnostics, service-role fallback execution, or failure message propagation.
  - Impact: degraded resident-number runtime fallback for admin dashboard/profile and exam applicant full-view.
  - Verification: dependency-injected executor characterization, then later route-level smoke/test.
  - Decision: increment 8 extracted fallback execution to a dependency-injected helper with characterization coverage; no direct decrypt or route behavior changes.

- Candidate: resident-number route request `fcIds` normalization embedded inline.
  - Evidence: `/api/admin/resident-numbers` normalized `body.fcIds` inline before calling the shared resident-number fallback path.
  - Risk: high if future route cleanup changes dedupe/filter behavior or weakens empty-list handling in a PII endpoint.
  - Impact: admin/manager trusted resident-number full-view route request parsing.
  - Verification: direct Node characterization test, helper regression tests, targeted lint, web build.
  - Decision: increment 9 extracted normalization to `resident-number-route-request.ts`; no auth/session/rate-limit/read behavior changed.

- Candidate: resident-number route branch sequencing embedded inline.
  - Evidence: after increment 9, `/api/admin/resident-numbers` still owned session rejection, rate-limit rejection, JSON parsing failure, empty-list success, downstream read success, and generic read failure branches inline.
  - Risk: high if future PII route cleanup reorders checks, parses body before auth/rate limit, or changes failure shapes.
  - Impact: admin/manager trusted resident-number full-view route behavior and operational diagnostics.
  - Verification: direct Node dependency-injected route handler characterization, route request/helper regressions, targeted web lint, web build.
  - Decision: increment 13 extracted branch orchestration to `resident-number-route-handler.ts`; session verification internals, rate-limit implementation, PII read behavior, direct decrypt, edge fallback, and UI remained unchanged.

- Candidate: exam-applicant resident-number enrichment embedded inline.
  - Evidence: `/api/admin/exam-applicants` owned exam row defaults, profile phone alias matching, resident-number read id derivation, and response enrichment inline after adjacent resident-number helper/route contracts had been characterized.
  - Risk: high if future cleanup changes profile matching, `fcIds` de-dupe, full-view replacement, or the current trusted-path failure literal.
  - Impact: admin/manager exam applicant list resident-number full-view behavior.
  - Verification: direct Node pure-helper characterization, phone/resident-number helper regressions, targeted web lint, web build, root lint/build, governance.
  - Decision: increment 14 extracted pure mapping/enrichment helpers; auth/session, staff verification, rate limits, Supabase queries, direct decrypt, edge fallback, and UI remained unchanged.

- Candidate: admin dashboard/profile resident-number birth-date display duplication.
  - Evidence: `/dashboard` modal used `useResidentNumber().birthDateDisplay`, while `/dashboard/profile/[id]` duplicated `getBirthDate` parsing from `residentNumberDisplay`.
  - Risk: medium-high because duplicate PII display helpers can drift between admin full-view surfaces.
  - Impact: admin/manager profile full-view display, birth-date helper output, future dashboard/profile cleanup.
  - Verification: direct Node pure-helper characterization, resident-number helper regressions, targeted web lint, web build, root lint, governance.
  - Decision: increment 15 extracted `formatResidentNumberBirthDateDisplay` and rewired the profile page through the hook-provided display value; resident-number fetch, routes, direct decrypt, edge fallback, auth/session, and UI layout remained unchanged.

- Candidate: mobile unread checkpoint key drift for request_board bridge users.
  - Evidence: `AGENTS.md` documents `role + residentId + requestBoardRole` checkpoint keys; `mobile-unread-notification-count.ts` depends on that scope before combining fc-onboarding and live request_board unread counts; `notification-checkpoint.ts` key generation was untested.
  - Risk: medium-high if FC/designer/admin bridge roles share checkpoint state or miss unread counts.
  - Impact: mobile home/request-board/notification unread counts and native badge synchronization.
  - Verification: Jest characterization for default scope and request_board role isolation, plus request-board session/push registration regression tests.
  - Decision: increment 10 exported the existing key builder and added characterization coverage; no storage/network/UI behavior changed.

- Candidate: mobile bridge unread planning/count drift.
  - Evidence: `mobile-unread-notification-count.ts` embedded the request_board access predicate, `exclude_request_board_categories` request flag, and final live request_board unread addition inline.
  - Risk: medium-high if admin/FC/designer bridge paths drift, stored request_board categories are double-counted, or live request_board unread is skipped.
  - Impact: mobile home/request-board/notification unread counts and native badge synchronization.
  - Verification: Jest characterization for bridge plan/body/total helpers plus checkpoint/session/push regression tests.
  - Decision: increment 11 extracted pure planning/body/total helpers; no AsyncStorage/network/UI behavior changed.

- Candidate: mobile unread async orchestration drift.
  - Evidence: after increment 11, `mobile-unread-notification-count.ts` still coordinated checkpoint read, `fc-notify` invoke, optional live request_board unread fetch, and catch/log fallback inline.
  - Risk: medium-high if later cleanup changes call order, skips request_board unread, initializes checkpoints while polling, or hides failures differently.
  - Impact: mobile home/request-board/notification unread counts and native badge synchronization.
  - Verification: dependency-injected Jest characterization plus checkpoint/session/push regression tests.
  - Decision: increment 12 extracted orchestration into a dependency-injected helper; runtime dependencies and behavior remain unchanged.

- Candidate: manager/head-manager read-only and cookie-first session restore.
  - Evidence: docs call these out as preserved behavior.
  - Risk: high.
  - Impact: authorization and data modification safety.
  - Verification: role-based smoke tests and session restore tests.
  - Decision: partially addressed in increment 16 for pure client session restore choice, mask formatting, and read-only role calculation; broader browser/runtime auth smoke and dashboard manager write-protection verification remain deferred.

### test gaps

- Candidate: root Jest harness collected direct `node:test` TypeScript characterization files.
  - Evidence: checkpoint root `npm test` failed with TS5097 on direct Node `.ts` tests and a real `referral-tree` fixture type drift.
  - Risk: medium-high; root verification becomes noisy and can hide real Jest failures behind incompatible test runner collection.
  - Impact: root Jest signal quality, future cleanup/refactor confidence, direct Node characterization test ownership.
  - Verification: targeted referral-tree Jest by path, explicit direct Node command, root Jest `--runInBand`, root/web lint/build, governance, diff hygiene.
  - Decision: increment 19 completed. `jest.config.js` now ignores only direct Node test paths intended for `node --experimental-strip-types --test`, and the `referral-tree` fixture uses the current `relationshipSource: 'linked'` contract.

- Candidate: missing characterization around large dashboard/bridge/notification modules.
  - Evidence: high-risk modules and prior mistake logs identify false completion and notification drift.
  - Risk: high.
  - Impact: future refactor safety.
  - Verification: add characterization tests before extraction increments.
  - Decision: prioritize before touching high-risk modules.

## Recommended Increment Order

1. Finish inventory-only harness for both repos.
2. Low-risk documentation drift check: verify designer/profile counts and update docs if canonical evidence exists.
3. Generated/untracked artifact audit: confirm ignored outputs and document local cleanup guidance without source deletion.
4. Characterization tests for PII/session/authorization/bridge/notification contracts.
5. Small extraction from one oversized module after characterization, no behavior change.
6. Dependency/config review only after builds/tests and framework docs are checked.

## Verification Standard For Future Increments

- Root: `npm run lint`, `npm test`, `npm run build`, `node scripts/ci/check-governance.mjs`
- Web: `cd web; npm run lint; npm run build`
- Runtime/browser/API checks as appropriate for touched surfaces.
- Any skipped verification must be recorded in `qa-report.md`.

## Increment 22 Plan

1. Implement 김형수 default recommender for all active 본부장 profiles:
   - Add Supabase migration.
   - Sync `schema.sql`.
   - Add static regression coverage and referral-system docs.
2. Normalize exact date wording:
   - Replace exposed legacy date wording with `보증보험 조회 동의일`.
   - Preserve internal `allowance_*` identifiers.
3. Integrate graph legend/color change:
   - Use circular legend swatches.
   - Apply global node color conditions for completed, current viewer/manager highlight, registered, pre-registration-only.
4. Record deferred items:
   - Toss/proxy exam, KakaoTalk provider, dedicated 다위촉 guide images.
5. Verify:
   - Root Jest/lint/governance.
   - Web lint/build.
   - request_board checks because GaramLink files are also dirty from this conversation.
6. Commit and push only if verification has no unresolved failures.

## Increment 25 Plan

1. Characterize the customer-management route/query contract in `lib/request-board-create-flow.ts`.
2. Wire `app/request-board-create.tsx` to read the entry query and initialize on the resolved first step.
3. Add a `고객관리` card to the FC action list in `app/request-board.tsx`, next to 의뢰 목록/설계코드 관리.
4. Verify with the focused Jest test, TypeScript, and targeted Expo lint for the touched mobile files.
# Increment 36: Referral Graph Descendant-Sized Nodes

Status: completed locally on 2026-06-07

Implementation order:

1. Completed: added a pure descendant-count helper and RED tests for chain, branching, cycles, and missing endpoints.
2. Completed: extended node radius tests so descendant count, cap, and highlight behavior are explicit.
3. Completed: passed full-graph descendant counts from the graph page into the canvas and drawer.
4. Completed: updated canvas radius/collision/hitbox usage to use descendant-aware sizing by default.
5. Completed: added drawer and legend copy for "하위 전체" count and ran focused graph verification.

Out of scope:

- Referral graph API response changes.
- A UI toggle for old/new sizing.
- Broad graph physics redesign.

---

# Increment 43: Designer Request Detail Accept/Reject

Status: in progress on 2026-06-07

Implementation order:

1. Add RED tests for designer pending-action availability and request detail UI contract.
2. Add a small helper for designer detail action visibility.
3. Wire `app/request-board-review.tsx` to existing `rbAcceptRequest`/`rbRejectRequest`.
4. Re-run focused tests, lint, TypeScript, governance, and diff hygiene.
5. Update QA/handoff docs with exact evidence.

Out of scope:

- Backend endpoint changes.
- Broad request detail redesign.
- Commit/push unless requested.

---

# Increment 44: Designer Reject Reason and FC Review Bucket Fix

Status: completed locally on 2026-06-07

Implementation order:

1. Add RED tests proving blank designer rejection reasons are invalid and rejected assignments are not FC review pending.
2. Add shared rejection reason normalization.
3. Replace detail and home quick-card hardcoded designer rejection reasons with reason-entry modals.
4. Narrow `review_pending` list bucketing to exact completed assignments awaiting FC decision.
5. Update mistake ledger and harness/work logs.
6. Verify focused tests, API contract, targeted lint, TypeScript, governance, and diff hygiene.

Out of scope:

- Backend endpoint/status changes.
- New FC status category UI.
- Commit/push unless requested.

---

# Increment 45: Reject Reason Modal Keyboard Avoidance

Status: completed locally on 2026-06-07

Implementation order:

1. Add RED static UI contract tests that require keyboard avoiding containers for reject reason modals.
2. Wrap request-board detail and home reject reason modals with `KeyboardAvoidingView`.
3. Preserve bottom-sheet layout by using a flex-end keyboard avoiding container and absolute overlay.
4. Re-run focused tests, targeted lint, TypeScript, governance, and diff hygiene.
5. Update mistake ledger and harness/work logs.

Out of scope:

- API/status changes.
- Broad modal redesign.
- Commit/push unless requested.

---

# Increment 46: List Rejection Reason Summary

Status: completed locally on 2026-06-07

Implementation order:

1. Add RED helper tests for extracting designer rejection summaries and preserving long reason text.
2. Add RED request-list UI contract for visible reason summary and two-line display cap.
3. Implement `getDesignerRejectionSummary()`.
4. Render compact rejection reason box in `app/request-board-requests.tsx`.
5. Verify focused tests, request-board regression suite, targeted lint, TypeScript, governance, and diff hygiene.

Out of scope:

- Backend changes.
- New filters/statuses.
- Broad card redesign.
- Commit/push unless requested.

---

# Increment 47: List Rejection Reason Hydration

Status: completed locally on 2026-06-07

Implementation order:

1. Confirm why the visible list still lacks reason: list response type does not include `rejection_reason`.
2. Add RED tests for missing-reason hydration detection and detail merge.
3. Fetch request detail only for rejected list items missing a reason.
4. Merge detail `rejection_reason` into the list item before rendering.
5. Re-run request-board regression tests, targeted lint, TypeScript, governance, and diff hygiene.

Out of scope:

- Backend changes.
- Broad list fetch redesign.
- Commit/push unless requested.

---

# Increment 48: Request Board Session Error Copy

Status: completed locally on 2026-06-08

Implementation order:

1. Add RED tests for request_board session/bridge error copy normalization.
2. Implement `lib/request-board-session-error.ts`.
3. Apply the helper to request-board create, FC code management, request list, detail/review, home stats/actions, and messenger auth/upload error surfaces.
4. Update mistake ledger and work logs.
5. Verify focused tests, targeted lint, TypeScript, and governance.

Out of scope:

- Re-login button or navigation action.
- Backend session/token/secret changes.
- Commit/push unless requested.

---
# Increment 49: Admin Board Category Filter Parity

Status: completed locally on 2026-06-08

Implementation order:

1. Completed: confirmed FC bottom nav routes to `/board`, while admin/manager bottom nav routes to `/admin-board-manage`.
2. Completed: added a RED board list query contract test for category/sort/search query key and params.
3. Completed: added `lib/board-list-query.ts` for shared list query keys, fetch params, and sort labels.
4. Completed: rewired `app/board.tsx` to use the shared helper without changing visible FC behavior.
5. Completed: added category chips, sort menu, submitted-search input, and clear action to `app/admin-board-manage.tsx`.
6. Completed: updated handbook, work logs, mistake ledger, and harness notes.

Out of scope:

- Board write permission changes.
- Manager write access changes.
- Category seed/migration changes.
- Board comments, reactions, attachments, notifications, and admin web board changes.
- Commit/push unless requested.

---

# Increment 50: Referral Share Copy Parity

Status: completed locally on 2026-06-08

Implementation order:

1. Completed: traced referral share copy paths and confirmed `/referral` uses `lib/referral-share.ts` while `/settings` still hardcoded the old direct deep-link copy.
2. Completed: added a RED source-level regression test to `lib/__tests__/referral-share.test.ts`.
3. Completed: rewired `app/settings.tsx` to use `buildReferralShareText()` with the same invite/app-store env handling as `/referral`.
4. Completed: updated referral SPEC, test checklist, test case/result assets, incident log, work logs, mistake ledger, and harness notes.

Out of scope:

- Referral attribution or recommender persistence changes.
- Deep-link parsing or invite landing page routing changes.
- Store install restoration/deferred deep link changes.
- Backend referral table/function changes.
- Commit/push unless requested.

---
# Increment 51: Admin Dashboard Signup Date And Table Alignment

Status: completed and deployed on 2026-06-08

Implementation order:

1. Completed: confirmed `/dashboard` uses `/api/admin/list` and `FCProfile.created_at` already exists while signup completion is best represented by `fc_credentials.password_set_at`.
2. Completed: added a focused table-display contract test before implementation.
3. Completed: added `dashboard-table-display` helper for signup-date normalization, date formatting, and 8-column table count.
4. Completed: joined `fc_credentials(password_set_at)` in `/api/admin/list` and returned `signup_completed_at` without leaking credential rows.
5. Completed: added the `가입일` column and centered compact table cells/headers, including the `관리` header and row buttons.
6. Completed: ran focused test/lint/build and deployed `admin_web` to Vercel production.

Out of scope:

- No schema migration.
- No FC signup flow or password write change.
- No mobile UI change.
- No admin mutation or manager permission change.

---
# Increment 52: Admin Exam Applicant Workbook Columns

Status: completed and deployed to production on 2026-06-08

Implementation order:

1. Completed: locked the confirmed workbook-style data column order in a shared display helper.
2. Completed: added RED/GREEN tests for column order, display values, and `신규신청/재신청` calculation.
3. Completed: changed `/api/admin/exam-applicants` to compute `application_type` from same-applicant/same-subject history.
4. Completed: changed `/dashboard/exam/applicants` table, filters, and CSV download to use the shared column contract.
5. Completed: preserved screen-only `접수 상태` and delete `관리` controls at the far right, with manager read-only disabled states unchanged.
6. Completed: ran focused tests, web lint, web production build, and Vercel production deployment.

Out of scope:

- Exam registration write behavior.
- Resident-number trusted retrieval path.
- Manager read-only authorization changes.
- Supabase schema or migration changes.
- Mobile exam application screens.

---

# Increment 53: Round-Specific Exam Applicant Column Parity

Status: completed and deployed to production on 2026-06-08

Implementation order:

1. Completed: investigated the "order unchanged" report and confirmed the previous deployment changed `/dashboard/exam/applicants`, but `/admin/exams/[id]` still used the legacy per-round table.
2. Completed: added a RED source-level regression test requiring the per-round page to use `EXAM_APPLICANT_EXPORT_COLUMNS`, `getExamApplicantCellValue()`, and `roundId`.
3. Completed: extended `/api/admin/exam-applicants` with `roundId` filtering while preserving whole-history `신규신청/재신청` calculation.
4. Completed: rewired `/admin/exams/[id]` to use the shared API and shared column contract, with server PATCH for reception status changes.
5. Completed: ran focused tests, web lint, local production build, and Vercel production deployment.

Out of scope:

- No schema migration.
- No mobile exam screen change.
- No new write capability for managers.
- No changes to exam registration submission behavior.
- No authenticated browser screenshot in this pass.

---

# Increment 54: Board Product Recommendation And Policy Categories

Status: completed, DB/functions applied, and admin web deployed on 2026-06-08

Implementation order:

1. Completed: confirmed board categories are controlled by schema seed, migrations, `_shared/board-categories.ts`, category list/write Edge Functions, app/web badge helpers, and home latest label formatting.
2. Completed: updated board category contract tests first and observed RED for missing migration plus missing `상품추천` label support.
3. Completed: changed `garam-pick` display name from `가람pick` to `상품추천` while preserving the slug.
4. Completed: added `시책` / `policy` / sort order `5` to schema, migration, and canonical Edge Function list.
5. Completed: updated mobile/web badge color logic and home latest label formatting.
6. Completed: ran focused tests, app/web lint, root typecheck, and web production build.
7. Completed: applied Supabase DB migrations, deployed impacted Edge Functions, and deployed admin web production.

Out of scope:

- No board permission changes.
- No board notification fanout changes.
- No automatic insurance digest category change; it remains `일반/general`.
- No mobile binary/OTA deployment in this pass.

---
# Increment 60: Request Board FC Code Focus Refresh

Status: implemented locally on 2026-06-09

Implementation order:

1. Completed: changed GaramIn admin account id from `00019820519` to `01019820519` and verified old id rejection/new id login.
2. Completed: confirmed request_board production DB/API has `01012341234` -> active `테스트 회사 / 430`.
3. Completed: confirmed test designer company is also `테스트 회사`, so validation should pass.
4. Completed: added focus refresh for designers and FC codes in `request-board-create`.
5. Completed: added source-level regression coverage.
6. In progress: finish harness/docs/governance verification and close subagent.

Out of scope:

- request_board API/schema changes.
- EAS build.
- Committing unrelated pre-existing referral graph/mobile changes.

---
## 2026-06-16 | Automation Increment Plan

1. Add a focused Sentry daily triage helper with unit tests for read-token-only behavior, organization issue/event API URL construction, candidate selection, and draft PR metadata.
2. Update `package.json` with `ops:sentry-triage`.
3. Update operations runbook and harness notes with weekly insurance digest timing, actor preflight, daily Sentry repair scope, PR rules, and blocked secret behavior.
4. Create Codex cron automations:
   - `weekly-insurance-digest-to-garamin-board`, local cwd `D:\hanhwa\fc-onboarding-app`, weekly Monday 11:00 KST.
   - `daily-sentry-repair-pr`, worktree cwd `D:\hanhwa\fc-onboarding-app`, daily 11:00 KST.
5. Verify focused node tests, dry-runs, git diff hygiene, and document any live-environment blockers.

---
## 2026-06-16 | Auth Login UI Regression Guard Plan

1. Completed: used parallel subagents for visual/background regression candidates and login keyboard/touch regression candidates.
2. Completed: replaced auth full-screen native gradient backgrounds with explicit light `AUTH_SCREEN_BACKGROUND` surfaces.
3. Completed: changed login CTA from raw `Pressable` to shared `Button` with `dismissKeyboardOnPress`.
4. Completed: added/updated source regression tests for auth background, login keyboard tap contract, navigation background, and shared Button keyboard dismissal.
5. Completed: updated mobile auth handbook, mistake ledger, and harness notes.
6. Completed: ran focused tests, mobile app test suite, lint, typecheck, build, governance, and diff whitespace checks.

Out of scope:

- Auth API/session behavior.
- Native build/EAS update/production deploy.
- Manual Android device screenshot smoke in this local pass.

---
## 2026-06-16 | Board Push Deep Link Normalization Plan

1. Completed: traced board-create notification row and push fanout target URL.
2. Completed: found native push response handler bypassing `lib/notification-route.ts` and pushing raw URL.
3. Completed: added RED test for board push URLs shaped as legacy `/board?postId=...` and admin web `/dashboard/board?postId=...`.
4. Completed: added `resolvePushNotificationRoute()` and dashboard-board URL normalization.
5. Completed: rewired `app/_layout.tsx` push response handling, including last notification response for cold-start taps.
6. Completed: updated notification runbook, mistake ledger, work log, and harness notes.
7. Completed: ran focused notification tests, targeted lint, typecheck, and governance.

Out of scope:

- Supabase schema or Edge Function fanout changes.
- Production deploy/EAS Update.
- Physical-device push tap smoke.

---
## 2026-06-18 | GaramIn Request Board Designer-Side Audit Follow-Up

1. Completed: audited designer home/list/detail/messenger/session boundaries with a parallel workflow guardian subagent.
2. Completed: extracted request-board home stats into `lib/request-board-home-stats.ts` and aligned `rejected` with the completed list bucket.
3. Completed: prevented request_board `needsRelogin` from clearing the whole GaramIn app session.
4. Completed: normalized request-board messenger wording to `설계매니저 목록`.
5. Completed: found during in-app browser UI smoke that the separate-contractor toggle still did not open reliably on web click paths.
6. Completed: added a web `role=button` path and longer duplicate-event guard for the separate-contractor toggle.
7. Completed: added RED/GREEN tests for home stats, session auto-reauth, messenger wording, and the toggle event guard.
8. In progress: run integrated focused tests, type/lint/build/UI smoke, then commit/push.

Out of scope:

- Native EAS build or store submission.
- Changing request_board database schema.
# Active Investigation Plan: Role-Based E2E Audit 2026-06-19

Status: in progress

Execution order:

1. Completed: inspect dirty worktree, mistake ledgers, available env files, Android SDK/AVD state, and QA scripts without printing secrets.
2. In progress: refresh harness artifacts and initialize integrated/referral run-result files for a new 2026-06-19 run.
3. Pending: prepare four Android AVD roles (`Hanhwa_FC`, `Hanhwa_Manager`, `Hanhwa_Admin`, `Hanhwa_Designer`) and reuse or build a development-client APK.
4. Pending: start `expo start --dev-client`, admin web Next dev server, and request_board server/client dev servers, recording actual URLs/ports.
5. Pending: run automated checks first, then role-oriented UI/runtime checks where the environment permits.
6. Pending: mark all integrated and referral cases with PASS/FAIL/BLOCKED/SKIPPED, run integrated-result validation, and record defects/optimization candidates.

Parallel role tracks:

- FC: signup/onboarding, appointment state, request creation, approve/reject decision, board, chat, referral code/link.
- Headquarters manager: read-only boundary, own board content, request_board `fc` bridge behavior, design codes, referral participation.
- Secretary/admin: Android operations plus `admin_web` dashboard/docs/appointment/exam/board/notifications/messenger/settings/referrals.
- Design manager: request_board login, accept/reject/complete/attach, FC decision confirmation, chat/PWA/mobile two-tab behavior.

Out of scope for this investigation:

- Production deployment, store release, OTA update, or schema mutation.
- Fixing defects discovered during QA, unless the user requests a follow-up fix pass.
- Raw PII/secret capture in logs or artifacts.

---

# Active Investigation Result: Role-Based E2E Audit 2026-06-19

Status: runtime execution complete for current credentials; follow-up fix/data pass required.

Completed execution order:

1. Completed: inspected dirty worktree, mistake ledgers, available env files, Android SDK/AVD state, and QA scripts without printing secrets.
2. Completed: refreshed harness artifacts and initialized integrated/referral run-result files.
3. Completed: prepared and launched four Android AVD roles (`Hanhwa_FC`, `Hanhwa_Manager`, `Hanhwa_Admin`, `Hanhwa_Designer`).
4. Completed with workaround: EAS local Android build is unsupported on Windows, so an x86_64 debug APK was built with Gradle and installed on all four AVDs.
5. Completed: started Expo, admin_web, request_board server, and request_board client dev servers; runtime ports were 8081, 3000, 3001, and 5173.
6. Completed: ran automated checks for app, admin_web, and request_board.
7. Completed: ran role-oriented UI/API runtime checks for FC, manager, design manager, and admin_web boundary behavior.
8. Completed: marked all integrated and referral cases with PASS/FAIL/BLOCKED/SKIPPED and ran integrated-result validation.
9. Completed: recorded defects and optimization candidates in QA/handoff artifacts.

Current result summary:

- Integrated result: PASS 17, FAIL 3, BLOCKED 28, SKIPPED 4; `npm run qa:validate:integrated` returned OK.
- Referral result: PASS 9, FAIL 3, BLOCKED 29, SKIPPED 1; no NOT_RUN rows remain.
- Newly reduced blockers: RB-02 address-copy/guide UI, RB-08 FC/manager design-code lifecycle, and RF-ADMIN-08 graph drag/reset/canvas evidence.
- Primary blockers: supplied developer/admin candidate password for masked account `***6018` fails login, and destructive flows require disposable isolated accounts.
- Primary confirmed failures: admin_web manager referral list GET 500 from oversized referral query/header overflow, sensitive runtime payload classes appearing in logs/UI evidence paths, and insufficient token/PII redaction for safe E2E evidence capture.

Next execution order:

1. Get the correct developer/admin password for masked account `***6018`, or explicit permission to reset/create a disposable developer admin actor.
2. Create disposable FC/manager/designer records for signup, referral mutation, board mutation, and delete cases.
3. Fix or ticket the confirmed defects before allowing screenshot/HAR/body-dump evidence.
4. Re-run only the BLOCKED/SKIPPED cases, then revalidate integrated/referral result files.

---

# Increment Plan: GaramIn Customer Management Edit/Delete 2026-06-20

Status: implemented locally.

Execution order:

1. Completed: added focused RED contract tests for mobile customer-management actions and API delete compatibility.
2. Completed: added the mobile `rbDeleteCustomer()` wrapper for the existing GaramLink `DELETE /api/customers/:id` contract.
3. Completed: reused the mobile customer form for edit mode, preserving existing customer profile fields and `id` in the save payload.
4. Completed: separated customer-management card actions (`요청 작성`, `수정`, `삭제`) from the normal request-selection flow.
5. Completed: merged saved customer rows and removed deleted rows locally without a full customer-list refetch.
6. Completed: ran focused Jest, targeted ESLint, and TypeScript verification.

Out of scope:

- No new backend API or schema migration.
- No request_board server/client behavior change.
- No destructive runtime QA against real saved customers.

---

# Increment: Customer Management Action Density And Local API 2026-06-20

Status: implemented locally.

Changes:

- Reworked GaramIn customer-management cards from a right-side vertical action stack to a compact bottom action row.
- Kept `요청 작성` as the primary action and changed `수정`/`삭제` into compact icon+label secondary actions.
- Corrected GaramIn local request_board API derivation from port `3000` to request_board server port `3001`.
- Restarted Expo web on `http://localhost:8082` with local request_board API `http://localhost:3001`.

Verification:

- RED/GREEN: `npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts`.
- Passed: `npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts lib/__tests__/request-board-api-contract.test.ts` (37/37).
- Passed: `npx eslint app/request-board-create.tsx lib/request-board-api.ts lib/request-board-url.ts lib/__tests__/request-board-mobile-ui-contract.test.ts lib/__tests__/request-board-api-contract.test.ts`.
- Passed: `npx tsc --noEmit`.

Runtime note:

- Browser automation could not attach because the local browser tool failed with a Windows permission error, so user-side refresh/visual confirmation remains the final visual check.
---

# Increment Plan: Request Board FC Identity and Contractor Detail Split 2026-06-20

Status: completed locally.

Execution order:

1. Completed: confirmed request list/detail API already exposes FC code snapshots and added mobile list typing for nested `fc` requester identity.
2. Completed: changed home quick-request cards to show requesting FC name, design code value, and phone without the company-name/code combined label.
3. Completed: changed request-list cards to show the same FC contact summary and kept decision status in the lower metadata row.
4. Completed: changed request detail to show requesting FC summary and request metadata labels `요청 FC`, `전화번호`, and `설계 코드`.
5. Completed: moved request-detail `계약자 정보` into a separate section/card after `건강 정보` and before `설계 진행`.
6. Completed: deleted the exact unreferenced `?????` company-name test data from Supabase and verified zero active question-mark-only names remain.
7. Completed: updated contract tests and reran Jest, ESLint, and TypeScript.

Follow-up:

- User may refresh the in-app browser if it still shows the stale compile overlay from before the JSX fix.

---

# Increment Plan: Admin Web Group Chat 2026-06-26

Status: completed locally.

Execution order:

1. Completed: added source-contract tests for admin navigation, messenger hub, notification routing, API proxy, upload, and group-chat page parity.
2. Completed: added web group-chat API helpers and a dashboard group-chat client page reusing the existing mobile group-chat contract.
3. Completed: wired dashboard navigation, messenger hub, and notification bell routes to `/dashboard/group-chat`.
4. Completed: added `POST /api/group-chat` and `POST /api/group-chat/upload` with same-origin, rate-limit, and admin/manager session checks.
5. Completed: incorporated security subagent findings by adding signed HttpOnly staff sessions, strict action schemas, upload size/type limits, own-bucket attachment URL validation, and short web app-session tokens.
6. Completed: added Edge Function attachment URL validation so image/file sends must use the `chat-uploads/group-chat/` prefix.
7. Completed: ran focused Jest, web helper tests, ESLint, and `web` production build.

Follow-up:

- Existing admin/manager users may need to log in again so the new signed `staff_session` cookie is issued.

---

# Increment Plan: Admin Web Direct Chat List Loading 2026-06-26

Status: completed locally.

Execution order:

1. Completed: identified root cause as a sequential per-FC Supabase `messages` query chain in `/dashboard/chat`.
2. Completed: added RED tests for one-pass conversation summary derivation and for source-level rejection of per-FC list queries.
3. Completed: implemented `buildAdminChatConversationSummaries()`.
4. Completed: changed the chat page to fetch message rows once and compute summaries locally.
5. Completed: kept previous list data during refetch and allowed deep-linked targets to open before the full list finishes.
6. Completed: verified with focused tests, ESLint, production build, and local server HTTP check.

---

# Increment Plan: Admin Web Secret Redaction 2026-06-26

Status: completed and deployed.

Execution order:

1. Completed: identified the visible secret as a contaminated `board_posts.author_name` value from the insurance digest automation actor name.
2. Completed: cleaned the DB row and verified no matching sensitive rows remain in `notifications`, `notices`, or `board_posts`.
3. Completed: fixed local `.env.local` so `BOARD_AUTOMATION_ACTOR_NAME` no longer contains the Sentry read-token assignment.
4. Completed: added RED/GREEN tests for web redaction and digest actor-name rejection.
5. Completed: added redaction to admin web notification, board, notice, and `fc-notify` proxy display paths.
6. Completed: added redaction to Supabase `fc-notify`, `board-create`, `board-list`, and `board-detail` functions.
7. Completed: deployed the changed Supabase Functions to project `ubeginyxaotcamuqpmud`.

Follow-up:

- Treat the exposed Sentry read token as compromised and rotate it in Sentry plus any local/deployment secrets that contain it.
