# Increment 35: Request Board Designer Notification Scope

Status: completed locally on 2026-06-05.

What changed:

- Request-board designer Expo push tokens now use `manager` scope instead of `fc` scope.
- `fc-notify` now reads token `role` and filters manager mobile tokens to request-board notifications or direct internal chat only.
- Request-board designer unread badge now uses live request_board unread only, avoiding fc-onboarding/board/exam count noise.
- Notification runbook and mistake ledger now document the manager-mobile scope contract.

Expected active behavior after this increment:

- 설계매니저 가람in에는 설계 요청 관련 알림과 본인에게 직접 온 채팅 알림만 도착해야 한다.
- 게시판, 공지, 시험, FC 온보딩 broadcast는 설계매니저 모바일 push/unread에 포함되지 않아야 한다.

Deferred:

- Runtime push verification on a physical device after function/app deployment.
- Cleanup of older Expo tokens already stored as `fc` until those devices log in and refresh token scope.

Evidence so far:

- `npm test -- --runTestsByPath supabase/functions/_shared/__tests__/notification-delivery-policy.test.ts lib/__tests__/push-registration.test.ts --runInBand` passed.
- `npm test -- --runTestsByPath lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand` passed.
- Combined focused tests passed.
- Targeted lint for touched mobile/helper files passed.
- `fc-notify` lint passed with `import/no-unresolved` disabled for Deno remote imports; only pre-existing `Array<T>` style warnings remain.
- `npx tsc --noEmit --pretty false` passed.
- `npm test -- --runInBand` passed.
- `git diff --check` passed with CRLF normalization warnings only.

---

# Increment 34: Orange CTA Black Rendering Guard

Status: completed locally on 2026-06-04.

What changed:

- Home next-step and messenger CTA cards now use explicit orange `View` backgrounds instead of orange `LinearGradient` wrappers.
- Legacy life/nonlife exam submit buttons and the referral-code card now use explicit background colors instead of orange gradients.
- Touched home text styles use `letterSpacing: 0`.

Expected active behavior after this increment:

- The reported home CTA cards should no longer render as black from the orange gradient path.
- Legacy exam submit buttons and the referral-code card should not inherit the same Android black-gradient failure mode.

Deferred:

- Android emulator screenshot smoke remains a follow-up runtime check.
- No exam/payment/referral behavior was changed.

Evidence:

- `npm run lint -- app/index.tsx app/exam-apply.tsx app/exam-apply2.tsx app/referral.tsx app/board.tsx app/admin-board-manage.tsx` passed.
- `cd web; npm run lint -- src/app/dashboard/board/page.tsx` passed.
- `cd web; SENTRY_AUTH_TOKEN='' npm run build` passed with existing dependency/data-age warnings only.
- `node scripts\ci\check-governance.mjs` passed.

---

# Increment 33: Board Garam Pick Category

Status: completed locally on 2026-06-04.

What changed:

- Added `가람 Pick` / `garam-pick` to `board_categories` schema seed and migration `supabase/migrations/20260604000002_add_garam_pick_board_category.sql`.
- Added a distinct pink badge theme for `가람 Pick` in mobile board, mobile admin board management, and admin web board.
- Updated board category docs.

Expected active behavior after this increment:

- Admin/manager board writers can select `가람 Pick` through the existing dynamic category list once the migration is applied.
- `가람 Pick` posts render with a distinct badge color instead of the gray default.

Deferred:

- Runtime deployment/database migration application is external to local edits.
- No changes were made to board permissions, comments, attachments, reactions, or notice preview behavior.

Evidence:

- `npm run lint -- app/index.tsx app/exam-apply.tsx app/exam-apply2.tsx app/referral.tsx app/board.tsx app/admin-board-manage.tsx` passed.
- `cd web; npm run lint -- src/app/dashboard/board/page.tsx` passed.
- `cd web; SENTRY_AUTH_TOKEN='' npm run build` passed with existing dependency/data-age warnings only.
- `node scripts\ci\check-governance.mjs` passed.

---

# Increment 32: Dawichok URL Sent Signal And Referral Graph Completion Legend

Status: completed locally on 2026-06-04.

What changed:

- Added `dawichok_url_sent_at` and `dawichok_url_sent_by` to schema/types with migration `supabase/migrations/20260604000001_add_dawichok_url_sent_signal.sql`.
- Added `markDawichokUrlSent` actions in mobile admin, web admin API/UI, and `supabase/functions/admin-action`.
- The action stores the sent timestamp/admin id and sends an existing-path notification titled `다위촉 URL 안내`.
- FC Dawichok page now shows `카카오톡으로 전송된 다위촉 URL을 진행해 주세요.` only after the sent signal exists; before that it shows neutral waiting guidance.
- Document-workflow downgrade/reset paths clear the Dawichok URL sent fields to prevent stale `발송됨` state.
- Referral graph nodes now carry `allCommissionsCompleted`, render completed nodes in green, and show `모든 위촉 완료` in the drawer.
- Graph completion summary counts visible nodes, and the legend now explains green completed nodes, orange referral-code nodes, yellow highlight/legacy-outline markers, and gray inactive/no-code nodes.

Expected active behavior after this increment:

- Secretary/admin users can mark that the Dawichok URL was sent without removing or changing the legacy PDF path.
- FCs see the Kakao URL instruction only after that signal is stored.
- Graph view shows all-commission-complete FCs by color only and provides an operator-friendly legend.

Deferred:

- Real KakaoTalk provider/template integration for this signal remains external.
- Mobile/runtime visual screenshots for the new Dawichok/admin surfaces remain a deployment smoke item.
- Toss virtual-account/proxy exam runtime and headquarters-scoped secretary filtering remain deferred.

Evidence:

- `node --test src\lib\referral-graph-layout.test.ts src\lib\referral-graph-simulation.test.ts` passed, 31 tests.
- `npm test -- --runInBand` passed, 31 suites / 199 tests.
- `npm run lint` passed.
- `cd web; npm run lint` passed.
- `cd web; SENTRY_AUTH_TOKEN='' npm run build` passed with existing dependency/data-age warnings only.
- `node scripts\ci\check-governance.mjs` passed.
- `git diff --check` passed with CRLF normalization warnings only.

---

# Increment 30: Mobile Exam Runtime Rollback

Status: completed locally on 2026-06-03.

What changed:

- `app/exam-apply.tsx` and `app/exam-apply2.tsx` were restored to the legacy HEAD mobile behavior, leaving no content diff in those files.
- The new deployable exam payment function entrypoints were removed from disk:
  - `supabase/functions/exam-application-submit/index.ts`
  - `supabase/functions/exam-payment-expire/index.ts`
  - `supabase/functions/exam-payment-issue/index.ts`
  - `supabase/functions/exam-payment-webhook/index.ts`
- Harness notes now mark the Toss/proxy runtime rollout as deferred for mobile exam application.

Expected active behavior after this increment:

- FCs use the legacy mobile exam flow for life/nonlife exam applications.
- The FC enters `응시료 납입일`.
- Mobile submit persists `fee_paid_date` through direct `exam_registrations` insert/update.
- Proxy applicant selection and per-examinee virtual-account cards are not active mobile UI.
- Newly added deployable Toss exam function entrypoints are absent.

Deferred:

- The Toss/per-examinee payment design remains future contract material only.

Evidence:

- Mobile runtime term search for `exam-application-submit`, payment joins, proxy submitter fields, virtual-account labels, and proxy UI labels returned no matches in `app/exam-apply.tsx` or `app/exam-apply2.tsx`.
- Manual `응시료 납입 일자`, `DateTimePicker`, `Clipboard`, and `fee_paid_date` insert/update paths are present in both screens.
- Function entrypoint `Test-Path` checks returned `False`.
- `npm run lint -- app/exam-apply.tsx app/exam-apply2.tsx` passed.
- `npm test -- --runTestsByPath lib/__tests__/exam-registration-payment-contract.test.ts --runInBand` passed, 1 suite / 3 tests.
- Scoped `git diff --check` passed with CRLF normalization warnings only.

---

# Handoff: Evidence-Based Cleanup / Refactor Program

## Increment 29: GaramIn Nine-Item Operations Upgrade v2

Status: completed locally on 2026-06-03.

What changed:

- Mobile FC home now has more prominent YouTube guide actions and a `임시사번` badge next to `내 진행 상황`.
- User-facing step 3 copy is `3단계 다위촉 URL`; internal `hanwha_*` names remain for compatibility.
- Admin Dawichok PDF upload UI/branches were removed from the active flow and replaced with `다위촉 서류 발송 알림`.
- Exam applications now go through trusted functions that create per-examinee registration/payment/order/account rows for Toss rotating virtual accounts.
- Webhook processing now only treats Toss `DEPOSIT_CALLBACK` with matching stored `toss_secret` and a `DONE` provider state as paid, with webhook event idempotency.
- Existing FC proxy application is available in both life/nonlife mobile exam screens, and same-round account selectors identify the examinee before opening the card.
- Admin exam applicants show payment state separately from `접수 확정`; legacy `fee_paid_date` is shown as `수동 납입일`.
- Admin scope schema and server-side scope checks were added for implemented admin FC/exam applicant routes.
- Kakao delivery adapter/logging was added behind notification allowlists while preserving existing inbox/push behavior.

Evidence and verification:

- Targeted Jest passed: 3 suites / 30 tests.
- Supabase payment helper/schema node tests passed: 5 total tests.
- Targeted Expo lint passed.
- Root `SENTRY_AUTH_TOKEN='' npm run build` passed with existing warnings.
- Web `npm run lint` passed.
- Web `SENTRY_AUTH_TOKEN='' npm run build` passed with existing dependency/data-age warnings.

Known risks / not yet verified:

- Toss sandbox account issue/deposit webhook/replay/expiration was not run because live PG credentials and callback setup are external.
- Kakao real send/dry-run was not run because provider credentials/templates are external.
- Mobile emulator/device screenshots were not run in this pass.
- Existing public service-role proxy debt remains in legacy notification/admin-action architecture; this increment avoided expanding payment writes through that pattern but did not harden every existing proxy route.

Next resume step:

- Apply the migration, deploy the four exam payment Edge Functions, configure Toss/Kakao secrets, then run a sandbox multi-examinee proxy application and replay one `DEPOSIT_CALLBACK`.

## Increment 28: Admin Dashboard Operator Copy And File Open Fix

Status: completed locally on 2026-06-03.

What changed:

- Admin dashboard FC detail allowance tab no longer shows the reported `trusted path` sentence.
- User-facing labels were changed from developer/implementation wording to operator-facing Korean: `현재 진행 단계`, `보증 보험 동의 관리`, `동의일`.
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

## Increment 20 Handoff

- 김형수 추천인 오류:
  - 원인은 운영 Supabase Edge Function 배포본이 현재 앱의 `x-app-session-token` 계약보다 오래된 상태였던 것으로 확인했다.
  - `refresh-app-session`, `login-with-password`, `sync-request-board-session`, `get-my-referral-code`, `get-referral-tree`, `search-fc-for-referral`, `update-my-recommender`, `get-my-invitees`를 project `ubeginyxaotcamuqpmud`에 재배포했다.
  - 김형수 app-session 직접 검증에서 `refresh-app-session`, `get-my-referral-code`, `get-referral-tree`가 모두 성공했다.
  - 변경 파일: `lib/referral-session-error.ts`, `lib/__tests__/referral-session-error.test.ts`, `hooks/use-referral-app-session.ts`, `hooks/use-my-invitees.ts`.
  - 보안 evaluator 지적 후 broad message-only auth heuristic은 제거했다. `code: "unauthorized"`처럼 명시 코드가 있을 때만 relogin-required로 본다.

- 색상 회귀:
  - `app.json`을 light-only로 고정하고, root `ThemeProvider`도 light theme으로 고정했다.
  - `app/login.tsx` container/gradient fallback에 흰 배경을 추가했다.
  - SM_S942N 최신 debug build에서 로그인 화면 검정 배경이 사라진 것을 확인했다.
  - 증거: `.codex/harness/evidence/kim-referral-auth/login-after-color-fix.png`.

- 실기기 상태:
  - 김형수 검증 전 현재 세션 DB를 `.codex/harness/evidence/kim-referral-auth/RKStorage.before-kim-session`에 백업했다.
  - 임시 김형수 session DB를 넣는 시도는 앱이 로그인 화면으로 되돌아와 exact referral UI 검증에는 쓰지 못했다.
  - 기존 세션 DB를 복원했고, 마지막 ADB UI tree는 앱 내부 `고객 선택` 화면이다.
  - dev build 특성상 재실행 시 Expo developer menu가 뜰 수 있으며 `Continue`를 눌러야 앱 화면으로 들어간다.

- Verified commands:
  - `npm test -- --runTestsByPath lib\__tests__\referral-session-error.test.ts --runInBand`
  - `npm run lint -- hooks/use-referral-app-session.ts hooks/use-my-invitees.ts lib/referral-session-error.ts app/referral.tsx`
  - `npm run lint -- app/_layout.tsx app/login.tsx`
  - `npx expo config --type public`
  - `npx expo run:android --device SM_S942N`

- Still needed before closing the `/goal` objective:
  - 김형수 실제 로그인 자격 증명 또는 사용자가 SM_S942N을 김형수 세션으로 전환한 상태에서 `/referral` 화면 UI를 직접 확인해야 한다.
  - 사용자가 요구한 “위촉과정/시험 전체 UI 테스트”는 아직 전부 끝났다고 말하면 안 된다. 지금까지는 김형수 추천인 auth와 로그인 색상 회귀에 대한 focused verification이다.

## Increment 21 Handoff

- Latest request implemented: FC users can use the admin web referral graph page only.
- Entry:
  - `/auth` now accepts FC password login through new server route `/api/auth/login`.
  - Successful FC login redirects to `/dashboard/referrals/graph`.
  - Server login mints signed/HttpOnly `fc_graph_session`; logout clears it through `/api/auth/logout`.
- Route containment:
  - `web/middleware.ts` redirects FC from `/`, `/auth`, and every protected dashboard route except `/dashboard/referrals/graph` to the graph page.
  - `web/src/app/dashboard/layout.tsx` renders only a single `추천인 그래프` nav item for FC and hides notification/settings.
- API/security:
  - `/api/admin/referrals/graph` now allows `admin|manager|fc`, but `getVerifiedServerSession` requires signed `fc_graph_session` for role `fc`.
  - `getReferralGraphData` resolves the FC root server-side from the logged-in phone and filters nodes/edges to self + descendants via `collectReferralDownlineScopeIds`.
  - FC graph nodes omit phone and admin-only annotations.
- UI:
  - FC graph mode hides the back-to-list button and uses downline-only explanatory copy.
  - `GraphNodeDrawer` does not call `/api/admin/referrals` in FC mode, hides phone/list link/history/events, and shows only graph node data.
- New tests:
  - `web/src/lib/admin-web-route-access.test.ts`
  - `web/src/lib/referral-graph-scope.test.ts`
  - `web/src/lib/fc-graph-session.test.ts`
- Verification passed:
  - `node --test web\src\lib\admin-web-route-access.test.ts web\src\lib\referral-graph-scope.test.ts web\src\lib\fc-graph-session.test.ts`
  - targeted web lint over all changed web files
  - `cd web; SENTRY_AUTH_TOKEN='' npm run build`
- Still needed:
  - Browser smoke with a real FC account to prove login lands on graph and graph API returns only that account's downline.
  - Direct forged-cookie smoke against a running web server, if time permits.
  - Full root/mobile UI verification remains open from the broader `/goal` request.

## Increment 22 Handoff Draft

- Implemented locally:
  - `link_manager_profile_to_default_recommender` migration/schema helper for 김형수(`01094272550`) default recommender.
  - `ensure_manager_referral_shadow_profile` now calls the helper for existing shadow, existing completed manager profile, and newly created shadow rows.
  - Migration includes active `manager_accounts` backfill.
  - Date field copy in touched code/docs now uses exact `보증보험 조회 동의일`.
  - Static Jest contract test added for the manager default recommender SQL contract.
  - Referral system docs/test cases updated with `RF-CODE-10`.
  - Graph legend/color work was delegated to subagent `Pasteur`; coordinator still needs to inspect and verify the changed web files.
- Deferred and recorded:
  - Toss/proxy exam runtime, Kakao provider integration, dedicated 다위촉 guide images, exhaustive SM_S942N onboarding/exam UI traversal.
- Pending before final/commit:
  - Review subagent graph diff.
  - Run root/web/request_board checks.
  - Commit and push only if checks pass without unresolved failures.

## Increment 23 Handoff

- Latest user correction:
  - 설계매니저가 설계 완료 후 `거절`/`승인`을 처리하는 것은 역할 계약상 잘못이다.
  - 설계매니저는 요청 수락/거절, 설계 진행, 설계 완료까지만 처리한다.
  - 완료 설계의 최종 승인/거절은 FC 검토 화면의 책임이다.
- Implemented:
  - `app/request-board-review.tsx`에서 완료 설계 decision buttons를 `canReviewAsFc = !isRequestBoardDesigner && needsReview`로 role-gated.
  - 설계매니저가 같은 상태를 볼 때는 `FC 검토 대기` status row만 렌더링.
  - `lib/__tests__/request-board-review-role.contract.test.ts`로 이 역할 계약을 static contract로 고정.
- Verification passed:
  - `npx jest lib\__tests__\request-board-review-role.contract.test.ts --runInBand`
  - `npx jest lib\__tests__\request-board-api-contract.test.ts lib\__tests__\request-board-mobile-products.test.ts lib\__tests__\request-board-review-role.contract.test.ts lib\__tests__\request-board-session.test.ts --runInBand`
  - `npx tsc --noEmit`
  - `npm run lint -- app\request-board-review.tsx lib\__tests__\request-board-review-role.contract.test.ts`
  - same two checks in worktree `C:\Users\jj812\.config\superpowers\worktrees\fc-onboarding-app\garamin-request-board-mobile-v1`
  - FC Android UI path on SM_S942N reached review detail and confirmed `거절`/`승인` are still visible for FC.
- Cleanup:
  - Temporary request_board requests `1069`, `1070` and users `498`, `499`, `503`, `504` deleted.
  - Android app storage restored to original FC session.
  - Local temporary session/token DB files removed.
- Still needed:
  - When direct phone testing resumes, run one 설계매니저 Android visual pass for the completed-design detail screen.
  - Expected result: `FC 검토 대기` visible, no `거절`/`승인` buttons on the 설계매니저 surface.

## Increment 24 Deployment Handoff

- Code commits already pushed:
  - `fc-onboarding-app` branch `codex/referral-rollout-closeout`, commit `24c8b13`.
  - `request_board` branch `codex/fix-requestform-mobile-actions`, commit `925d1c8`.
- Supabase linked project `ubeginyxaotcamuqpmud` updated:
  - migrations `20260603000002`, `20260604000001`, `20260604000002`, `20260604000003` are present in remote migration history.
  - deployed functions: `admin-action`, `fc-consent`, `fc-notify`, `fc-submit-appointment`, `fc-submit-hanwha-commission`, `request-signup-otp`, `set-password`.
  - `_shared/commission.ts` changes are bundled through the deployed dependent functions.
- Vercel production deployments:
  - admin web `admin_web`: `https://adminweb-red.vercel.app` and deployment URL `https://admin-7n810v0ch-jun-jeongs-projects.vercel.app`, status `Ready`.
  - GaramLink `request_board`: `https://requestboard-steel.vercel.app` and deployment URL `https://requestboard-bxahmgjjg-jun-jeongs-projects.vercel.app`, status `Ready`.
- Smoke:
  - `request_board` production root responded HTTP 200.
  - admin web production root responded HTTP 401, consistent with auth protection.
- Explicitly not done:
  - No Expo/EAS/native app build.
  - Direct SM_S942N traversal remains deferred by user instruction.

## Increment 25 Handoff

- Implemented:
  - Added `고객관리` to the mobile GaramLink FC action list.
  - Added `getRequestBoardCustomerManagementRoute()` and `resolveRequestBoardCreateInitialStep()` in `lib/request-board-create-flow.ts`.
  - Wired `app/request-board-create.tsx` to initialize from `entry` query params, so customer-management opens at `1. 고객`.
- Verification passed:
  - RED then GREEN focused Jest for `lib/__tests__/request-board-create-flow.test.ts`.
  - `npx tsc --noEmit`.
  - targeted Expo lint for the touched app/helper/test files.
  - targeted `git diff --check`.
- Not done:
  - No device/browser smoke.
  - No request_board server/API/admin web changes.
  - No new `MISTAKES.md` item because no repeated mistake/regression was found.
- Resume note:
  - Before commit, review the integrated diff because `app/request-board.tsx` and `app/request-board-create.tsx` already contain pre-existing dirty changes from adjacent work.

## Increment 26 Handoff

- Implemented:
  - `관리` button modal default tab now follows `calcStep(profile)` so `2단계 문서제출` opens `서류 관리`.
  - Admin web route access now requires raw presence of `fc_graph_session` for FC route sessions before allowing graph access. Stale FC cookies are cleared, including the graph session cookie.
  - Exam schedule list uses `sortExamRoundsByExamDateThenDeadline`.
  - Exam schedule notification now calls Supabase Edge Function `fc-notify` via `adminSupabase.functions.invoke` instead of local direct Expo push.
  - `exam-round-notification` helper/test pins the `fc-notify` broadcast payload and target URLs.
- Verification passed:
  - `node --test src/lib/admin-web-route-access.test.ts src/lib/exam-round-sort.test.ts src/lib/exam-round-notification.test.ts`.
  - `cd web; npm run lint`.
  - targeted `git diff --check`.
- Not done:
  - `cd web; SENTRY_AUTH_TOKEN='' npm run build` because a local Next dev server is active and `clean-next.mjs` refuses to delete `.next` while it is running.
  - Historical Vercel log sample collection because local Vercel CLI requires a deployment argument and only streams current logs; `vercel logs <deployment> --json` timed out without useful samples.
- Resume note:
  - If deployment is needed, either stop the local dev server and run the web build first, or let Vercel cloud build after reviewing the integrated diff.
  - After deploy, smoke `/dashboard/referrals/graph` with a valid FC web login and create/update one exam schedule to verify an `exam_round` inbox row plus push fanout.

## Increment 27 Handoff

- Implemented:
  - Bounded Kim Hyungsoo-style root fanout by making branch-bridge distance depend on the local child branch instead of using the root's full child count for every first-level edge.
  - Added production `forceCollide` and aligned simulation tests to the same collision/link-tension/component-cohesion constants.
  - Added label occupancy suppression so low-priority labels do not draw over already placed labels.
  - Added node-vs-label suppression so non-selected/non-search labels do not draw across other nodes.
  - Added `referral-graph-link-style` helper so high-fanout root direct spokes render as quieter background links, while branch-local links render above them.
  - Added `web/src/lib/referral-graph-realdata.test.ts`, gated by `RUN_REFERRAL_GRAPH_REALDATA_TEST=1`, to fetch current Supabase data and run the production-equivalent force stack.
  - The real-data test now uses the same dynamic collision radius as production, separately asserts Kim Hyungsoo direct spoke bounds, and tracks visual edge-overlap severity from production link alpha/width weights.
  - Bumped `ReferralGraphCanvas` layout version to `obsidian-pinwheel-v16` and graph page physics storage key to `referral-graph-physics-settings-v16`.
  - Added weighted root child placement and capped static layout-memory influence so the real graph does not drift back into long uniform root spokes after long stabilization.
  - Capped dense root leaf-spoke distances so Kim Hyungsoo-style direct leaves no longer settle as 400px-class uniform spokes.
  - Fixed the evaluator-found drag-session issue: static anchor memory ages out after `maxTicks`, but manual drag/drop targets keep working in the same force instance after later drags.
- Verification passed:
  - `node --test src/lib/referral-graph-physics.test.ts` (22 tests, including the same-session manual target regression).
  - `node --test src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts` (64 tests).
  - `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; node --test src/lib/referral-graph-realdata.test.ts`.
  - Actual graph metrics: 185 nodes, 102 edges, 11 crossings, visual overlap severity 6.16, 55.98px minimum center distance, 335.31px maximum edge, Kim Hyungsoo direct p90 334.45px.
  - Targeted web ESLint for graph page/canvas/layout/physics tests.
  - Targeted `git diff --check` before the final documentation refresh; rerun it before final commit.
- Not done:
  - No `web` build because the build script cleans `.next` and the user's local Next dev server is active.
  - No direct browser screenshot after the latest patch; ask the user to reload localhost and inspect the graph with the `v16` default settings.
- Resume note:
  - If the graph still appears too sparse around 김형수 after reload, inspect whether the UI is using the `퍼짐` preset or a custom draft physics setting. The storage key should now reset defaults, so a post-reload issue is likely a true layout constant issue, not stale localStorage.
  - If the user requires literal zero edge crossings, stop tuning force constants and plan a separate deterministic tree/radial-tree layout mode. Two force-tuning/layout-sector hypotheses were tested against real data and increased crossings.

## Increment 28 Handoff

- Implemented:
  - `search-fc-for-referral` now searches `fc_profiles.name` only and no longer fuzzy-searches affiliation or referral code.
  - `search-signup-referral` now follows the same name-only contract.
  - Both search functions look up active `manager_accounts.name` matches and backfill the manager referral shadow profile plus active referral code before returning results.
  - Referral search UI copy now says to search by 추천인 이름 only.
- Verification passed:
  - `npx jest supabase\functions\_shared\__tests__\referral-search.test.ts lib\__tests__\signup-referral.test.ts --runInBand`.
  - `npx eslint components\ReferralSearchField.tsx app\referral.tsx app\signup.tsx`.
  - `npx tsc --noEmit --pretty false`.
  - Supabase function deployments for `search-fc-for-referral` and `search-signup-referral`.
  - Live smoke against `search-signup-referral`: query `서선미` returned exactly one result, `서선미`, with an active referral code.
- Not done:
  - No authenticated FC referral search invocation because no app-session token was available in shell.
- Resume note:
  - In the app, reload and search `서선미` from the 추천인 search field. Expected: only `서선미` appears. Users under `1본부 서선미` must not appear unless their own `name` contains the query.

## Increment 29 Handoff

- Implemented:
  - Added `lib/exam-role.ts` to define the FC-equivalent exam role contract.
  - Home 시험 tab now keeps 본부장(read-only admin) on a `manager-management` surface: existing exam schedule/applicant-list links remain visible, and FC-style exam application links are added.
  - `/exam-apply` and `/exam-apply2` now allow 본부장 sessions and enable the same round/my-application queries as FC sessions.
  - Writable 총무 admin remains on exam management summary and management links.
- Verification passed:
  - RED then GREEN `npx jest lib\__tests__\exam-role.test.ts --runInBand`.
  - `npx eslint app\index.tsx app\exam-apply.tsx app\exam-apply2.tsx lib\exam-role.ts lib\__tests__\exam-role.test.ts`.
  - `npx tsc --noEmit --pretty false`.
  - Targeted `git diff --check`.
- Follow-up correction:
  - User caught that the first pass removed existing 본부장 exam management links.
  - Corrected expectation: 본부장 sees `생명보험/제3보험 시험`, `손해보험 시험`, `생명/제3 신청자`, `손해 신청자`, plus `생명/제3 시험 신청`, `손해 시험 신청`.
  - Re-ran `npx jest lib\__tests__\exam-role.test.ts --runInBand` and `npx eslint app\index.tsx lib\exam-role.ts lib\__tests__\exam-role.test.ts`.
- Not done:
  - No direct Android UI tap-through or live exam submission.
- Resume note:
  - In a 본부장 login session, open the bottom `시험` tab. Expected: existing exam schedule/applicant-list cards are still present, and the two exam application cards are additionally present.

## Increment 30 Handoff

- Implemented:
  - Removed stale root-spoke link-style branching; graph links now use one uniform, more visible style.
  - Reworked terminal-only hub placement from a full circle into a short non-circular side fan with staggered leaf lengths.
  - Added deterministic ID-based branch-bridge length jitter so child hubs with descendants do not form identical-length spokes.
  - Aligned layout and physics branch distance formulas so live force simulation does not pull branch hubs back into older compact/circular assumptions.
  - Increased Canvas/test collision radius to keep dense nodes apart, and strengthened sibling-angular/edge-crossing forces within the stable range found by real-data testing.
- Verification passed:
  - `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts` (69 tests).
  - `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; node --test src/lib/referral-graph-realdata.test.ts`.
  - Actual graph metrics: 185 nodes, 102 edges, 13 crossings, visual severity 7.67, 95.94px minimum node distance, 346.67px maximum edge, Kim Hyungsoo direct p90 302.71px.
- Not done:
  - No direct browser/phone visual QA after this latest layout patch.
  - No production web build in this increment.
- Resume note:
  - Ask the user to reload `/dashboard/referrals/graph`; the expected shape is branch/trunk-like, with terminal leaf spokes short and slightly varied, child hubs on longer branches, and uniformly visible straight edges.
  - If the user still wants fewer crossings than the current 13 real-data crossings, do not keep raising edge-crossing force constants blindly. A stronger setting was tested and made real data worse; the next step should be a deterministic tree/branch layout mode rather than more force tuning.
# Increment 35: Board Category Four-Type Alignment

Status: completed locally on 2026-06-05.

What changed:

- Board category seed and forward migration now target the four requested GaramIn board post types: `공지`, `교육일정`, `가람Pick`, `일반`.
- Existing `education`, `garam-pick`, `notice`, and `general` slugs are retained.
- Legacy `insurance-news` posts are reassigned to `가람Pick`; other legacy category posts are reassigned to `일반` before old categories are deactivated.
- Category-list returns active categories for every role, so inactive legacy categories do not show in admin writer/filter UI.
- Insurance digest automation now posts into `가람Pick`/`garam-pick` instead of recreating `보험소식`/`insurance-news`.
- Board badge color mapping was updated for mobile app, mobile admin board management, and admin web board.

Deferred:

- Runtime DB migration application/deployment remains external to local edits.
- Board permissions, comments, attachments, reactions, and graph files are unchanged.

Evidence:

- `node --test scripts/ops/post-insurance-digest.test.mjs` passed, 12 tests.
- `npm run lint -- app\board.tsx app\admin-board-manage.tsx scripts\ops\post-insurance-digest.mjs` passed.
- `cd web; npm run lint -- src\app\dashboard\board\page.tsx` passed.
- `npx tsc --noEmit --pretty false` passed.
- `node scripts\ci\check-governance.mjs` passed.
- Targeted `git diff --check` passed with line-ending warnings only.
- Deno Edge Function static check was not run because `deno` is not installed locally; Expo lint cannot resolve Deno URL imports.

---

## Increment 36 Handoff

- Implemented:
  - Runtime graph sibling-angular force now preserves anchor-relative open fans instead of reintroducing circular sibling spacing.
  - Crowded terminal leaf spokes are lengthened only when fanout needs spacing, and use stable ID-based length jitter.
  - Child hubs with descendants keep visibly longer branch bridges than terminal leaves, with bounded max edge lengths.
  - Simulation tests were updated from old compact/circular assumptions to the current branch/trunk acceptance: open fan, no overlap, bounded edge, stable drag/cooling.
- Verification passed:
  - `node --test src/lib/referral-graph-physics.test.ts src/lib/referral-graph-layout.test.ts src/lib/referral-graph-link-style.test.ts`.
  - `node --test src/lib/referral-graph-simulation.test.ts`.
  - `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; node --test src/lib/referral-graph-realdata.test.ts`.
  - `cd web; npm run lint`.
- Real-data metrics:
  - 186 nodes, 101 edges, 3 crossings, visual severity 1.769472.
  - Minimum node distance 95.96px.
  - Maximum edge 333.20px.
  - Kim Hyungsoo direct p90 326.31px.
- Not done:
  - `cd web; npm run build` did not run because the active Next dev server blocked `.next` cleanup.
  - No direct browser screenshot or phone manipulation in this increment.
- Resume note:
  - Reload `/dashboard/referrals/graph` in the active browser. Expected: terminal/no-child nodes no longer force a closed ring, child hubs branch farther outward than leaf-only nodes, and the actual graph should not show 400px-class abnormal spokes.

---

## Increment 37 Handoff

- Implemented:
  - Tightened incoming branch leaf fans so terminal leaves do not form local circular clusters.
  - Reordered branch leaf spoke radii so adjacent terminal leaves use visibly different lengths.
  - Added anchor-aware edge crossing correction; straight edges now separate toward the deterministic non-crossing seed layout.
  - Capped isolated-node shell placement to keep unrelated nodes outside connected branches without creating a huge outer ring.
  - Kept Canvas, synthetic simulation, and real-data force settings aligned.
- Verification passed:
  - `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts` (72 tests).
  - `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`.
  - `cd web; npm run lint`.
- Real-data metrics:
  - 186 nodes, 101 edges, 0 crossings, visual severity 0.
  - Minimum node distance 93.75px.
  - Maximum edge 345.02px.
  - Kim Hyungsoo direct max 270.68px, p90 269.46px.
- Not done:
  - No production web build.
  - No browser screenshot QA after this final patch.
- Resume note:
  - Reload `/dashboard/referrals/graph`. Expected: no straight-edge crossings on the current data set, no root circular pull, child-bearing hubs on longer branches, and terminal/no-child leaves as short staggered spokes.

---

## Increment 38 Handoff

- Implemented:
  - `applyReferralGraphDragSpring(... preventStretch)` now propagates only through edges that actually exceeded the allowed stretch distance and were corrected.
  - `ReferralGraphCanvas` drag handlers no longer mark the entire connected component as manually moved/suppressed after one node drag.
  - Drag-time immediate spring correction is less aggressive (`constraintStrength=0.42`, `stretchSlack=18`, `maxVelocity=42`) to avoid sudden whole-branch jumps.
  - Drag and drag-end handlers no longer call `d3ReheatSimulation()`, so grabbing a node does not restart the whole settled force simulation.
  - `isReferralGraphMeaningfulDrag()` ignores grab-only/tiny movement before storing manual drag targets.
  - Real-data QA now simulates a small 김형수 drag/release after initial settle.
- Verification passed:
  - `node --test src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts` (49 tests).
  - `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`.
  - `cd web; npm run lint`.
  - Targeted `git diff --check`.
- Real-data metrics:
  - Current data is 187 nodes / 102 edges.
  - Before drag: 1 low-severity crossing, max edge 345.37px, min node distance 76.68px.
  - After small drag: 1 low-severity crossing, max edge 345.87px, min node distance 77.40px.
- Remaining note:
  - The drag runaway/abnormal long-edge issue is fixed in tests. The updated data still has one small pre-existing crossing before drag; if absolute zero crossing is required again, treat that as a deterministic layout follow-up rather than raising force constants blindly.

---

## Increment 39 Handoff

- Implemented:
  - GaramLink 설계요청 신규 고객 등록 fields now use keyboard next/done navigation.
  - 생년월일 auto-formats to `YYYY-MM-DD`.
  - 연락처 auto-formats to `010-1234-1234`.
  - 주민번호 auto-formats to `900101-1234567`.
  - Input placeholders now show gray examples for each field.
- Verification passed:
  - `npm test -- --runTestsByPath lib/__tests__/request-board-customer-input.test.ts --runInBand`.
  - `npx eslint app/request-board-create.tsx lib/request-board-customer-input.ts lib/__tests__/request-board-customer-input.test.ts`.
  - `npx tsc --noEmit --pretty false`.
  - `git diff --check -- app/request-board-create.tsx lib/request-board-customer-input.ts lib/__tests__/request-board-customer-input.test.ts`.
- Not done:
  - No ADB/phone UI manipulation in this increment.

---

## Increment 41 Handoff

- Implemented:
  - Rechecked and finalized the referral graph layout/physics file set for commit.
  - Realdata regression helper now passes `sourceId`/`targetId` to `getReferralGraphLinkDistance`, matching production Canvas and preserving ID-based branch/leaf distance jitter.
  - No production edge-crossing force increase was needed; the production/test input drift was the cause of the failing realdata check.
- Verification passed:
  - `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts` (74 tests).
  - `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`.
  - Targeted graph ESLint.
  - `cd web; SENTRY_AUTH_TOKEN='' npm run build`.
- Real-data metrics:
  - Current data is 187 nodes / 103 edges.
  - Before drag: 0 crossings, visual severity 0, max edge 356.82px, min node distance 93.51px.
  - After small drag: 0 crossings, visual severity 0, max edge 347.38px, min node distance 94.16px.
- Not done:
  - No direct browser/phone visual QA in this closeout.

---

## Increment 40 Handoff

- Implemented:
  - Added visible `운전 구분` selection chips to GaramLink 설계요청 신규 고객 등록.
  - Exported `REQUEST_BOARD_DRIVING_STATUS_OPTIONS` from `lib/request-board-driving-status.ts` so registration and review share the same codes/labels.
  - Added keyboard-open scroll behavior to `app/request-board-create.tsx`: handled taps, drag dismissal, dynamic keyboard bottom padding, and non-scrollable TextInputs so the parent ScrollView can move.
- Verification passed:
  - `npm test -- --runTestsByPath lib/__tests__/request-board-driving-status.test.ts lib/__tests__/request-board-customer-input.test.ts --runInBand`.
  - `npx eslint app/request-board-create.tsx lib/request-board-driving-status.ts lib/__tests__/request-board-driving-status.test.ts lib/request-board-customer-input.ts lib/__tests__/request-board-customer-input.test.ts`.
  - `npx tsc --noEmit --pretty false`.
  - `git diff --check -- app/request-board-create.tsx lib/request-board-driving-status.ts lib/__tests__/request-board-driving-status.test.ts lib/request-board-customer-input.ts lib/__tests__/request-board-customer-input.test.ts`.
- Not done:
  - No ADB/phone UI manipulation in this increment.
# Increment 36: Referral Graph Descendant-Sized Nodes

Status: completed locally on 2026-06-07.

What changed:

- Admin referral graph node radius will use full-graph directed descendant count by default.
- The backend graph API remains unchanged; the web graph page computes counts from `allNodes/allEdges`.
- Drawer and legend copy will expose the size basis.

Evidence:

- RED/GREEN descendant helper and radius tests passed.
- Existing graph layout/simulation tests passed.
- Web lint and `SENTRY_AUTH_TOKEN='' npm run build` passed.
- Live graph API smoke returned 192 nodes / 108 edges.
- Browser screenshot captured at `.codex/harness/referral-graph-descendant-size.png`.
- Real-data graph regression passed with crossings 0 and crossingVisualSeverity 0.

Known notes:

- `npx tsc --noEmit` is not the repo's clean web typecheck signal today because existing test files import `.ts` extensions without `allowImportingTsExtensions`; `next build` TypeScript passed.

---
