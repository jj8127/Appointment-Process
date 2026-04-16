# Current contract

## Increment
- Name: Referral self-service session recovery and GaramLink upload auth retry
- Goal: silently recover expired referral app sessions from the stored bridge token, show relogin CTA only on hard auth failure, and retry embedded GaramLink attachment uploads once after request_board 401.

## Exact scope
- Mobile UI / hooks
  - `app/referral.tsx`
  - `hooks/use-session.tsx`
  - `hooks/use-referral-app-session.ts`
  - `hooks/use-my-referral-code.ts`
  - `hooks/use-referral-tree.ts`
  - `lib/request-board-api.ts`
- Referral Edge Functions
  - `supabase/functions/_shared/request-board-auth.ts`
  - `supabase/functions/refresh-app-session/`
  - `supabase/functions/get-my-referral-code/index.ts`
  - `supabase/functions/get-fc-referral-code/index.ts`
  - `supabase/functions/get-my-invitees/index.ts`
  - `supabase/functions/get-referral-tree/index.ts`
  - `supabase/functions/search-fc-for-referral/index.ts`
  - `supabase/functions/update-my-recommender/index.ts`
- Referral docs / governance / harness
  - `docs/referral-system/*`
  - `docs/handbook/mobile/auth-and-gates.md`
  - `docs/handbook/mobile/request-board-bridge.md`
  - `docs/handbook/data/referral-schema-and-admin-rpcs.md`
  - `docs/handbook/shared/cross-repo-bridge-contract.md`
  - `docs/handbook/path-owner-map.json`
  - `.claude/MISTAKES.md`
  - `.claude/WORK_LOG.md`
  - `.claude/WORK_DETAIL.md`
  - `.codex/harness/*`
  - `AGENTS.md`

## Acceptance criteria
- [x] Referral lookups, inviter search/save, and tree reads share one helper that does `current token -> refresh-app-session -> one retry`.
- [x] `refresh-app-session` exists and only issues referral tokens for `fc` / `manager`; plain `admin` / `designer` are rejected.
- [x] Referral Edge Functions return explicit `missing_app_session`, `expired_app_session`, `invalid_app_session`-style failures instead of a single generic unauthorized state.
- [x] `/referral` surfaces a relogin CTA when the bridge token is missing/expired instead of trapping the user in a generic auth error or endless spinner.
- [x] `rbUploadAttachments()` retries one 401 via bridge login and surfaces server JSON `error/message` text.
- [x] Referral SSOT/tests/logs/harness are updated to document the split-session recovery contract.
- [x] Targeted lint/JSON/governance checks pass, plus companion request_board build/governance checks.

## Checks run
- `npx eslint app/referral.tsx hooks/use-my-referral-code.ts hooks/use-referral-app-session.ts hooks/use-referral-tree.ts hooks/use-session.tsx lib/request-board-api.ts`
- referral JSON parse check via `node -`
- `node scripts/ci/check-governance.mjs`
- `cd E:\hanhwa\request_board && npm run build:server`
- `cd E:\hanhwa\request_board && node scripts/ci/check-governance.mjs`

## Rollback / containment
- Keep the current dual-session model; do not widen this batch into a full login/session unification.
- If the refresh path must be rolled back, revert the client helper and `refresh-app-session` together so `/referral` does not depend on a missing token-refresh contract.
- Embedded GaramLink upload retry depends on the existing bridge-login path; do not introduce a second attachment-auth mechanism.
