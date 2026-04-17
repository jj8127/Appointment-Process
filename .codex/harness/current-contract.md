# Current contract

## Increment
- Name: Login-time referral code auto-issue and self-service catch-up
- Goal: make eligible completed FC and active manager logins guarantee one active referral code without introducing a separate manual issuance step.

## Exact scope
- Shared referral-code helper
  - `supabase/functions/_shared/referral-code.ts`
- Auth / referral Edge Functions
  - `supabase/functions/login-with-password/index.ts`
  - `supabase/functions/get-my-referral-code/index.ts`
- Referral docs / governance / harness
  - `docs/referral-system/*`
  - `docs/README.md`
  - `.claude/MISTAKES.md`
  - `.claude/WORK_LOG.md`
  - `.claude/WORK_DETAIL.md`
  - `.codex/harness/*`
  - `AGENTS.md`

## Acceptance criteria
- [x] completed FC login success best-effort ensures one active referral code with `p_rotate=false`.
- [x] active manager login ensures/refetches the manager referral shadow profile, then applies the same idempotent active-code guarantee.
- [x] existing active codes are preserved across repeated logins; login auto-issue never rotates them.
- [x] referral provisioning failures do not hard-fail login responses.
- [x] `get-my-referral-code` catches up eligible no-code states once before surfacing a missing code.
- [x] Referral SSOT/tests/logs/harness include the new login auto-issue contract and regression case `RF-CODE-09`.

## Checks run
- `npx eslint --rule "import/no-unresolved: off" supabase/functions/_shared/referral-code.ts supabase/functions/login-with-password/index.ts supabase/functions/get-my-referral-code/index.ts`
- referral JSON parse check via `node -`
- `node scripts/ci/check-governance.mjs`

## Rollback / containment
- Keep auto-issue best-effort only; do not tie login success to referral provisioning success.
- If this batch must be rolled back, revert `login-with-password` and `get-my-referral-code` helper usage together so login and self-service do not disagree on the code-guarantee contract.
