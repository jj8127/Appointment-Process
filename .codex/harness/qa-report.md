# QA report

## Summary
- Status: pass with runtime follow-up
- Scope: login-time referral code auto-issue and self-service catch-up

## Passed checks
- `npx eslint --rule "import/no-unresolved: off" supabase/functions/_shared/referral-code.ts supabase/functions/login-with-password/index.ts supabase/functions/get-my-referral-code/index.ts`
- referral JSON parse check for `docs/referral-system/test-cases.json` and `docs/referral-system/TEST_RUN_RESULT.json`
- `node scripts/ci/check-governance.mjs`

## Findings
- No static finding blocked the scoped change set.
- Eligible login now owns active-code provisioning instead of leaving it as a separate manual/backfill step.
- Existing active codes remain stable because the login path only uses `admin_issue_referral_code(..., p_rotate=false)`.
- `get-my-referral-code` now provides one catch-up attempt for rollout-era or transient no-code states.
- `deno` is not installed in this environment, so Deno-native checks/invokes were not run locally.

## Remaining verification
- Production-like login for a completed FC with no active referral code.
- Production-like login for an active manager with no referral shadow/code yet.
- Repeat login for an already-coded eligible user to confirm noop/no-rotate behavior with live evidence.
- Optional simulation of login-time provisioning failure followed by `get-my-referral-code` catch-up.
