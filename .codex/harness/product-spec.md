# Product spec

## Task summary
- Remove the extra manual provisioning gap for referral codes by making eligible completed FC and active manager logins auto-guarantee one active referral code.
- Keep login success resilient: referral-code provisioning must not block authentication, and `get-my-referral-code` must catch up legacy or transient no-code states before surfacing them.
- Update referral SSOT/test assets/work logs so the current source of truth says `eligible login success = active referral code ready`.

## User outcomes
- Logged-in eligible FC/manager users can share/invite immediately without waiting for admin backfill or a separate issuance step.
- Existing active codes remain stable across repeated logins; auto-issue is idempotent and non-rotating.
- If login-time provisioning transiently fails, the user still logs in and the current self-service lookup path repairs the missing code on first use.

## Implementation shape
- Add a shared referral-code helper for normalized phone handling, manager shadow profile ensure, and `admin_issue_referral_code(..., p_rotate=false)` wrapping.
- Wire `login-with-password` to best-effort auto-issue for completed FC and active manager logins.
- Change `get-my-referral-code` to run one catch-up issuance attempt when an eligible profile has no active code.
- Update referral SSOT/test assets/incident log/mistake ledger/harness docs with a new login auto-issue regression case.

## Key constraints
- No DB schema migration.
- Login success must not become coupled to referral-code provisioning success.
- Existing active codes must not rotate during login; the auto-issue path is `p_rotate=false` only.
- Plain admin/developer/designer remain outside referral code issuance eligibility.

## Verification targets
- `npx eslint --rule "import/no-unresolved: off" supabase/functions/_shared/referral-code.ts supabase/functions/login-with-password/index.ts supabase/functions/get-my-referral-code/index.ts`
- referral JSON parse check for `docs/referral-system/test-cases.json` and `docs/referral-system/TEST_RUN_RESULT.json`
- `node scripts/ci/check-governance.mjs`
- follow-up runtime QA: eligible no-code FC login, active manager login, existing-code noop login, login-time miss + self-service catch-up
