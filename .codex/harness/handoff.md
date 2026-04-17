# Handoff

## Complete
- Added a shared referral-code helper that wraps manager shadow profile ensure and idempotent `admin_issue_referral_code(..., p_rotate=false)` issuance.
- Updated `login-with-password` so completed FC and active manager logins best-effort guarantee one active referral code without rotating existing codes.
- Updated `get-my-referral-code` to catch up eligible rollout/transient no-code states once before returning a missing code.
- Updated referral SSOT/test assets/incident log/mistake ledger/root entry docs for the new `eligible login success = active referral code ready` contract.

## Still to do
- Verify with a real completed FC account that logging in with no active code creates one immediately.
- Verify with a real active manager account that shadow profile ensure + active code guarantee both happen on login.
- Verify with a real already-coded eligible account that repeated logins do not rotate or replace the active code.

## Important notes
- Login remains resilient by design: provisioning warnings are logged, but authentication success is preserved.
- `get-my-referral-code` is now the catch-up safety net for rollout-era or transient misses; if this helper path is reverted, login and self-service must be reverted together.
- No DB migration was added in this batch.
