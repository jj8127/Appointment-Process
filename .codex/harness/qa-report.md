# QA report

## Summary
- Status: partial pass with user-run manual follow-up pending
- Scope: internal messenger optimization pass 1, unread aggregation, polling reduction, messenger header back-button recovery, branded loading rollout, mobile login post-success stabilization, Android emulator runtime baseline repair, legacy recommender exact-unique reconciliation, and missing-recommender outreach message batch

## Passed checks
- `npm test -- --runInBand lib/__tests__/back-navigation.test.ts`
- `npm test -- --runInBand lib/__tests__/internal-chat.test.ts lib/__tests__/signup-referral.test.ts`
- `npx eslint app/_layout.tsx app/admin-messenger.tsx app/chat.tsx app/messenger.tsx app/index.tsx app/notifications.tsx app/request-board.tsx lib/back-navigation.ts lib/internal-chat-api.ts lib/system-notification-badge.ts lib/__tests__/back-navigation.test.ts`
- `npm test -- --runInBand lib/__tests__/messenger-loading.test.ts lib/__tests__/branded-loading-spinner.test.ts`
- `npm test -- --runInBand lib/__tests__/session-landing.test.ts lib/__tests__/push-registration.test.ts hooks/__tests__/use-login.contract.test.ts lib/__tests__/branded-loading-spinner.test.ts components/__tests__/BrandedLoadingSpinner.contract.test.ts`
- `npx eslint app/admin-messenger.tsx app/appointment.tsx app/board-detail.tsx app/chat.tsx app/dashboard.tsx app/docs-upload.tsx app/exam-apply.tsx app/exam-apply2.tsx app/exam-manage.tsx app/exam-manage2.tsx app/hanwha-commission.tsx app/index.tsx app/login.tsx app/notice-detail.tsx app/notifications.tsx app/referral.tsx app/request-board-fc-codes.tsx app/request-board-messenger.tsx app/request-board-requests.tsx app/request-board-review.tsx app/request-board.tsx components/Button.tsx components/BrandedLoadingSpinner.tsx components/BrandedLoadingState.tsx components/MessengerLoadingState.tsx components/ReferralSearchField.tsx components/ReferralTreeNode.tsx lib/branded-loading-spinner.ts lib/messenger-loading.ts lib/__tests__/messenger-loading.test.ts lib/__tests__/branded-loading-spinner.test.ts`
- `npx eslint app/login.tsx hooks/use-login.ts hooks/use-session.tsx lib/session-landing.ts lib/push-registration.ts lib/__tests__/session-landing.test.ts lib/__tests__/push-registration.test.ts hooks/__tests__/use-login.contract.test.ts components/BrandedLoadingSpinner.tsx lib/branded-loading-spinner.ts components/__tests__/BrandedLoadingSpinner.contract.test.ts lib/__tests__/branded-loading-spinner.test.ts`
- `npx eslint --rule "import/no-unresolved: off" supabase/functions/fc-notify/index.ts`
- `node scripts/ci/check-governance.mjs`
- `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud`
- `npm run report:legacy-recommenders -- --date=2026-04-22`
- `npm run report:legacy-recommenders -- --date=2026-04-22 --apply`
- `npm run report:missing-recommender -- --date=2026-04-22-after-link`
- `npm run ops:send-missing-recommender-messages -- --date=2026-04-22`
- `npm run ops:send-missing-recommender-messages -- --date=2026-04-22 --apply`
- `npm run report:missing-recommender-outreach -- --date=2026-04-22`

## Android evidence captured
- Artifact root: `E:\hanhwa\fc-onboarding-app\.codex\harness\evidence\android-optimization-pass1`
- FC flow evidence:
  - `home.png`, `home.xml`
  - `fc-home-scrolled.png`, `fc-home-scrolled.xml`
  - `messenger-hub.png`, `messenger-hub.xml`
- Admin/internal messenger evidence:
  - `admin-session-injected-after-wait.png`, `admin-session-injected-after-wait.xml`
  - `admin-messenger-deeplink.png`, `admin-messenger-deeplink.xml`
  - `admin-chat-open-2.png`, `admin-chat-open-2.xml`
  - `admin-messenger-after-read.png`, `admin-messenger-after-read.xml`
  - `notifications-admin.png`, `notifications-admin.xml`
- Login/session troubleshooting evidence:
  - `admin-login-result.png`, `admin-login-result.xml`
  - `admin-post-submit-after-hosts.png`, `admin-post-submit-after-hosts.xml`
  - `admin-after-wait.png`, `admin-after-wait.xml`
  - `login-repro.png`, `login-repro.xml`
  - `login-repro-after-metro.png`, `login-repro-after-metro.xml`
  - `post-dns-relaunch-app.png`, `post-dns-relaunch-app.xml`
  - matching `*-logcat.txt` files in the same directory

## Findings
- Internal messenger admin list now loads and renders unread totals through server aggregation.
- Opening an internal chat clears unread state and the admin list total drops on return.
- Native badge writes are now guarded against duplicate writes when the count does not change.
- QA surfaced a navigation regression: `메신저` and `가람지사 메신저` lacked visible back buttons. This was fixed with a shared fallback helper and must be re-checked manually.
- All remaining `ActivityIndicator` loading surfaces under `app/*` and `components/*` were replaced with the shared spinner system.
- The first loading rollout was visually overdone for exam/login flows. It has been simplified again to the same rotating arrow icon used on the login button.
- Direct `login-with-password` invocation with the provided FC/admin credentials returns `ok: true` for both accounts, so the auth backend path is currently healthy.
- The login spinner no longer depends on `Feather.ttf`; the loading arrow is now SVG-based and guarded by a source-contract test.
- Post-login landing navigation is now session-driven from `LoginScreen`, and push token registration is delayed/deduplicated so it no longer piles onto the same frame as login success.
- Android emulator login/notice/request fetch failures were traced to broken DNS resolution in the emulator, not a broken auth backend. Relaunching the AVD with `-dns-server 8.8.8.8,1.1.1.1` restored `google.com`, Supabase, and Vercel host resolution.
- `AppAlertProvider`, `Toast`, and `ErrorBoundary` no longer depend on `Feather` font icons for status glyphs, so runtime failure UI does not add another asset-fetch failure on top of a real network error.
- `use-login` now logs invoke failures, rejected login responses, and thrown exceptions so the next runtime repro will expose the actual failure class in JS logs.
- Legacy recommender reconciliation classified 41 unresolved free-text recommender rows into `7 safe-to-link`, `31 missing_candidate`, and `3 self_referral`.
- Two inviters without active code (`한태균`, `이민우`) received active codes first, then 7 invitees were linked through `admin_apply_recommender_override`.
- Spreadsheet-safe missing-recommender report decreased from `71` rows to `64` rows after the reconciliation batch.
- Sender `01058006018` was verified as a `developer` account, so the outreach batch used the phone-number actor id, matching app messenger behavior.
- Internal messenger outreach inserted `34` message rows for the blocked list (`31 missing_candidate`, `3 self_referral`) with no failures.
- The latest operator CSV now includes `outreach_required`, `blocked_reason`, `message_status`, and `message_sent_at`.

## Known observation
- The provided device log showing repeated `expo-notifications` push-token warnings pointed to a wider emulator network baseline issue, not the auth backend itself. After the DNS override, host resolution recovered, but fresh manual login verification is still required.
- The original `fc-missing-recommender-2026-04-22.csv` was locked by an open spreadsheet window, so the refreshed post-link report was written to `fc-missing-recommender-2026-04-22-after-link.*` instead of overwriting the open file.
- The outreach CSV is the newest operator-facing file and supersedes the older post-link CSV when checking who already received an internal reminder.

## Remaining manual QA
- Use the FC credentials provided in-thread:
  - verify a fresh login now leaves the login screen and lands on the expected FC surface (`/home-lite` or `/request-board`)
  - verify home unread badge after fresh login
  - verify messenger hub unread badges after optimization
  - verify notifications unread count decreases after entering the notification center
  - verify branded loading states look acceptable on `홈`, `알림`, `메신저`, `추천인`, `서류 업로드`
- Use the admin/developer credentials provided in-thread:
  - verify a clean app login path without injected session state
  - verify `메신저` shows a visible working back button
  - verify `가람지사 메신저` shows a visible working back button
  - verify internal unread and request-board unread both look correct in the messenger hub
  - verify branded loading states look acceptable on `가람지사 메신저`, `가람Link 메신저`, `설계요청`, `시험 신청/관리`
- Validate refresh behavior:
  - confirm internal unread still feels realtime enough without 5-second polling
  - confirm request_board unread feels acceptable with the new 30-second interval plus focus/app-active refresh
- Optional performance follow-up:
  - `adb shell dumpsys gfxinfo com.jj8127.Garam_in`
- Dev QA environment note:
  - if the emulator shows `Loading from <LAN-IP>:8082...` or host resolution starts failing again, relaunch the AVD with `-dns-server 8.8.8.8,1.1.1.1` before treating fetch failures as app regressions
