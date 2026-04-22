# Handoff

## Complete
- Added shared server-side internal chat aggregation and unread counting in `fc-notify`.
- Refactored internal messenger surfaces to use those aggregates instead of repeated client-side queries.
- Removed the 2.5-second internal chat polling path and reduced internal unread refresh churn across home/messenger screens.
- Deduplicated native badge writes.
- Restored missing back buttons on `메신저` and `가람지사 메신저` with a shared fallback helper.
- Rolled the branded animated loading system out across every remaining `ActivityIndicator` surface in `app/*` and `components/*`.
- Simplified that loading system again after QA: the card/pulse/dot treatment was too aggressive, and all loaders now use the same rotating arrow icon style as the login button.
- Replaced that rotating-arrow loader implementation with an SVG-based asset-free spinner so login pending no longer depends on `Feather.ttf` loading.
- Replaced the remaining status icons in `AppAlertProvider`, `Toast`, and `ErrorBoundary` with a shared SVG `StatusGlyph`, so error UI also no longer depends on icon-font asset fetches.
- Removed the eager post-login landing `router.replace(...)` from `useLogin`; landing is now resolved by session-aware login screen state instead.
- Delayed and deduplicated push-token registration attempts so login success is not immediately followed by repeated registration retries in the same session.
- Deployed the updated `fc-notify` function to project `ubeginyxaotcamuqpmud`.
- Captured Android emulator evidence for FC flow and admin internal-messenger flow under `.codex/harness/evidence/android-optimization-pass1/`.
- Added spreadsheet-safe reporting for FCs still missing structured recommender links.
- Added a reusable legacy recommender reconciliation script and applied the policy-safe exact-unique batch on 2026-04-22.
- Issued active referral codes for `한태균`, `이민우` and linked 7 invitees through `admin_apply_recommender_override`.
- Captured reconciliation evidence under `.codex/harness/reports/legacy-recommender-reconcile-2026-04-22.{md,json}` and refreshed the missing report to `.codex/harness/reports/fc-missing-recommender-2026-04-22-after-link.*`.
- Added a reusable internal messenger outreach script for the blocked list and sent `34` reminder messages from the `01058006018` developer account actor.
- Generated the latest operator file at `.codex/harness/reports/fc-missing-recommender-2026-04-22-outreach.*` with send status columns.

## Still to do
- User-run manual QA with the provided FC/admin credentials:
  - fresh login path validation
  - unread badge parity on home, messenger hub, admin messenger, notifications
  - back-button visibility/behavior on `메신저` and `가람지사 메신저`
  - request_board unread cadence feel-check
  - branded loading visual sanity-check on home/messenger/request-board/exam/referral/docs/login surfaces
- Phase 2 optimization work:
  - request_board conversation list API still scans message history server-side and remains the next major bottleneck
- Legacy recommender follow-up:
  - 31 rows remain `missing_candidate`
  - 3 rows remain `self_referral`
  - all 34 rows have now received an internal reminder message from `01058006018`
  - these 34 rows still require manual operator review or additional source-of-truth data before any further mutation

## Important notes
- Admin internal-messenger Android validation used a QA-only plain-admin session injection path because the provided developer/admin account currently appears to be cleared by request_board session sync. Credentials are intentionally not stored in repo docs.
- Direct backend smoke for both provided credentials now confirms `login-with-password` and request_board `bridge-login` are healthy, so remaining login issues are client-side if they still reproduce.
- The latest Android repro showed the main client-side blocker was emulator DNS resolution, not the auth backend. Relaunching `codex-api34` with `-dns-server 8.8.8.8,1.1.1.1` restored `google.com`, Supabase, and Vercel host resolution.
- `request_board` conversation-list redesign was explicitly left out of this pass.
- `npx tsc --noEmit --pretty false` still fails on unrelated pre-existing files outside this change set:
  - `app/appointment.tsx`
  - `app/hanwha-commission.tsx`
  - `app/referral.tsx`
  - `components/DaumPostcode.tsx`
  - `hooks/use-my-referral-code.ts`
- Existing unrelated local changes, including referral work and `app.json`, were left in place.
- The spreadsheet-safe report uses `=\"010...\"` style text coercion so Excel/Sheets do not render phones as scientific notation.
- If the original CSV is open in Excel or another spreadsheet app, regenerating the same filename may fail with `EBUSY`; write a new suffix file instead.
- Outreach message results live in `.codex/harness/reports/missing-recommender-message-send-2026-04-22.{md,json}` and are deduped by same-day sender/receiver/content.
- Loading copy/motion now lives in `components/BrandedLoadingState.tsx`, `components/BrandedLoadingSpinner.tsx`, `lib/messenger-loading.ts`, and `lib/branded-loading-spinner.ts`; future visual tweaks should touch those four together.
- Login landing logic now also depends on `lib/session-landing.ts`, and push-registration throttling lives in `lib/push-registration.ts`; future login regressions should inspect those helpers together with `app/login.tsx`, `hooks/use-login.ts`, and `hooks/use-session.tsx`.
- Android dev QA should now start with two baseline checks before blaming app code:
  - Metro endpoint that the dev client is trying to load
  - emulator DNS resolution for `google.com`, Supabase, and request_board hosts
