# Handoff

## Complete
- Added referral-session recovery so `/referral` lookup/search/save/tree flows can reissue an expired referral `appSessionToken` from the stored request_board bridge token.
- Added `refresh-app-session`, detailed app-session / bridge-token auth codes, and a shared `useReferralAppSession` helper.
- Updated `/referral` to show an explicit relogin CTA when both the referral token and the bridge token are unavailable.
- Updated embedded GaramLink attachment uploads to retry one 401 via bridge login and surface server JSON error text.
- Updated referral SSOT/test assets, work logs, mistake ledger, AGENTS, and harness notes for the new split-session contract.

## Still to do
- Verify on a real FC account that `appSessionToken`-only expiry silently recovers on `/referral`.
- Verify on a real manager account that the same recovery works while admin-surface read-only rules remain intact.
- Verify that both tokens missing/expired show the relogin CTA and that embedded GaramLink HEIC/WEBP uploads succeed or fail with the new clearer error path.

## Important notes
- This batch does not unify the primary app login session and the referral secondary session; it only adds silent recovery and clearer hard-failure handling.
- `refresh-app-session` intentionally trusts only the stored request_board bridge token and only mints referral tokens for `fc` / `manager`.
- Embedded GaramLink image support also depends on the companion request_board `message-attachments` MIME/bucket rollout.
