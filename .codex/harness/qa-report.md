# QA report

## Summary
- Status: pass with runtime follow-up
- Scope: referral self-service session recovery and GaramLink upload auth retry

## Passed checks
- `npx eslint app/referral.tsx hooks/use-my-referral-code.ts hooks/use-referral-app-session.ts hooks/use-referral-tree.ts hooks/use-session.tsx lib/request-board-api.ts`
- referral JSON parse check for `docs/referral-system/test-cases.json` and `docs/referral-system/TEST_RUN_RESULT.json`
- `node scripts/ci/check-governance.mjs`
- `cd E:\hanhwa\request_board && npm run build:server`
- `cd E:\hanhwa\request_board && node scripts/ci/check-governance.mjs`

## Findings
- No static or build-time finding blocked the scoped change set.
- Referral self-service now has an explicit recovery contract for `appSessionToken` expiry instead of treating every failure as a generic unauthorized state.
- Embedded GaramLink attachment uploads now share the same one-retry bridge re-auth behavior as `rbFetch()` and can surface clearer server-side MIME/auth errors.
- `deno` is not installed in this environment, so Deno-native checks/invokes were not run locally.

## Remaining verification
- On-device FC/manager check for `appSessionToken`-only expiry recovery on `/referral`.
- On-device check that both tokens missing/expired produce the relogin CTA instead of a stuck spinner.
- Real HEIC/HEIF/WEBP upload verification through the embedded GaramLink messenger flow.
