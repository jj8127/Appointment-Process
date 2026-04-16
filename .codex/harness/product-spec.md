# Product spec

## Task summary
- Repair GaramIn referral self-service so a logged-in FC/manager can silently recover an expired referral `appSessionToken` from the stored request_board bridge token instead of being blocked on `/referral`.
- Keep referral self-service limited to FC/manager-equivalent users and fall back to an explicit relogin CTA only when both the referral token and the bridge token are unavailable.
- Align the embedded GaramLink attachment upload client with the request_board auth contract by retrying one 401 via bridge re-login and surfacing server JSON error messages.

## User outcomes
- Logged-in FC/manager users no longer hit a misleading "인증이 필요합니다" state on `/referral` just because the secondary referral token expired.
- Referral code lookup, inviter search/save, and referral tree reads can recover once automatically when only the referral token expired.
- GaramLink attachment uploads from `fc-onboarding-app` retry once after request_board auth expiry and show clearer MIME/auth failures when recovery is impossible.

## Implementation shape
- Add detailed app-session / bridge-token parsing and a new `refresh-app-session` Edge Function that reissues referral `appSessionToken` for `fc`/`manager` only.
- Introduce a shared client helper (`hooks/use-referral-app-session.ts`) and route referral reads/writes/tree fetches through it.
- Update referral screens/functions to distinguish `missing`, `expired`, and `invalid` auth states, then map hard failures to a relogin CTA.
- Keep `rbUploadAttachments()` aligned with `rbFetch()` by doing one bridge-login retry on 401 and preferring server JSON `error/message` text.
- Update referral SSOT/test assets, handbook notes, work logs, mistake ledger, and harness docs to lock the new split-session recovery contract.

## Key constraints
- No DB schema migration and no full session-model unification.
- `refresh-app-session` must not mint referral tokens for plain `admin` or `designer`.
- Referral writes remain trusted Edge Function paths; the client still must not write referral tables directly.
- Companion request_board MIME/bucket changes are part of the same rollout; the fc-onboarding client alone cannot fix unsupported upload types.

## Verification targets
- `npx eslint app/referral.tsx hooks/use-my-referral-code.ts hooks/use-referral-app-session.ts hooks/use-referral-tree.ts hooks/use-session.tsx lib/request-board-api.ts`
- referral JSON parse check for `docs/referral-system/test-cases.json` and `docs/referral-system/TEST_RUN_RESULT.json`
- `node scripts/ci/check-governance.mjs`
- companion checks: `cd E:\hanhwa\request_board && npm run build:server`, `cd E:\hanhwa\request_board && node scripts/ci/check-governance.mjs`
- follow-up runtime QA: appSession-only expiry recovery, both-token relogin CTA, HEIC/WEBP GaramLink attachment upload
