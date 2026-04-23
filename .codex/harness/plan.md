# Plan

## Increment 13
- Goal: remove the invite-link signup lag/instability caused by exact-code fuzzy search and duplicate pending-referral apply runs.
- Outcome: complete.
- Notes:
  - Root cause was split across backend and app runtime: `search-signup-referral` sent exact 8-character codes through the broad fuzzy search path, and `app/signup.tsx` could queue a second `applyPendingReferralCode()` run while the first was still in flight.
  - Added tests first for exact-code query detection and single-flight pending apply reuse.
  - Implemented a new shared `supabase/functions/_shared/referral-search.ts` helper plus `lib/signup-referral.ts` single-flight helper.
  - Deployed `search-signup-referral` to `ubeginyxaotcamuqpmud` so the backend exact-code fast path is live immediately.
  - App-side single-flight mitigation is code-complete but still needs the next mobile deploy/OTA and user runtime QA.

## Increment 12
- Goal: let managers/read-only admins see all completed FCs in GaramIn internal messenger and admin web chat without touching GaramLink.
- Outcome: complete.
- Notes:
  - Mobile/internal chat scope now distinguishes writable admin vs. read-only admin visibility with a shared participant helper.
  - Read-only admin unread totals now use the same “all completed non-designer FC” filter as the visible chat list, so badge totals stay aligned.
  - Admin web chat now sources FC targets from `/api/admin/list` through a pure `admin-chat-targets` helper instead of reading `fc_profiles` directly in the client.
  - Admin web messenger hub unread badge now also reads `fc-notify internal_unread_count` first, so the hub count matches the same visible target scope for 본부장 sessions.
  - Added regression coverage for both the mobile helper contract and the web target-building contract.
  - Deployed `fc-notify` to `ubeginyxaotcamuqpmud` so the GaramIn change is live on the backend.

## Increment 11
- Goal: unify referral current-state into a single `fc_profiles` source of truth, route signup/self-service/admin mutations through one atomic RPC, and collapse admin graph/read models to the same linked-edge contract.
- Outcome: complete.
- Notes:
  - Added migration `20260423000001_unify_referral_link_state.sql` plus matching `supabase/schema.sql` updates for `fc_profiles.recommender_*` snapshot columns, `apply_referral_link_state(...)`, `get_invitee_referral_code(...)`, `get_referral_subtree(...)`, and one-time backfill.
  - Replaced direct `referral_attributions` current-state writes in `set-password` / `update-my-recommender` with the shared `supabase/functions/_shared/referral-link.ts` RPC wrapper.
  - Switched self-service invitee/tree/current recommender reads to `fc_profiles` snapshot data.
  - Simplified graph edge generation to a single `linked` model and updated recent-event surfaces to accept `referral_linked/referral_changed/referral_cleared`.
  - Updated referral SSOT docs/test assets plus `.claude/*` / `.codex/harness/*` to the single-state contract.
  - Verification passed for helper tests, targeted lint/build, JSON parse, governance check, and `git diff --check`.
  - Remote DB rollout is still pending: `supabase migration list` shows `20260423000001` local-only.

## Increment 10
- Goal: close the three Vercel deployment risks with concrete code guards and environment cleanup for admin web.
- Outcome: complete.
- Notes:
  - Split into three independent tracks: request-board preview URL safety, preview web-push runtime/env behavior, and resident-number decrypt/fallback observability.
  - Code fixes should remove silent production fallbacks and replace opaque preview failures with explicit disabled states.
  - Preview Vercel env now includes the four web-push variables needed for QA, and production now has explicit `NEXT_PUBLIC_REQUEST_BOARD_URL`.
  - Local deploy path is now confirmed: run `vercel deploy --yes --archive=tgz` from `E:\hanhwa\fc-onboarding-app`, not from `web/`.
  - Successful preview deployment: `https://admin-1v8o3d70h-jun-jeongs-projects.vercel.app` (`dpl_DEQhVascXkdkHAkRsNE9AD1Zns2r`).
  - `FC_IDENTITY_KEY` was not available from a safe local source in this session, so the resident-number fix focused on runtime observability rather than secret provisioning.

## Increment 9
- Goal: send internal messenger reminders to the remaining blocked missing-recommender rows and regenerate the operator list with send status.
- Outcome: complete.
- Notes:
  - Verified that `01058006018` is a `developer` account, so the internal messenger actor id must stay the phone number itself, not `admin`.
  - Sent `34` internal messages with two variants: `31 missing_candidate`, `3 self_referral`.
  - Generated `fc-missing-recommender-2026-04-22-outreach.*` with `outreach_required`, `blocked_reason`, and `message_status`.

## Increment 8
- Goal: classify and reconcile unresolved legacy recommender links with a policy-safe exact-unique batch.
- Outcome: complete.
- Notes:
  - Dry-run classification found `4 ready + 3 needs_code + 31 missing_candidate + 3 self_referral`.
  - Applied exact-unique reconciliation for 7 invitees after issuing 2 missing inviter codes.
  - Remaining 34 are intentionally blocked pending manual operator review.

## Increment 1
- Goal: move internal messenger list/unread aggregation to shared server helpers and typed mobile clients.
- Outcome: complete.

## Increment 2
- Goal: remove repeated client-side polling/N+1 paths from admin messenger, chat, messenger hub, home, notifications, and request-board refresh flow.
- Outcome: complete.

## Increment 3
- Goal: deploy `fc-notify` changes, capture Android QA evidence, and validate unread/read behavior in the emulator.
- Outcome: partially complete.
- Notes:
  - Internal admin messenger list/chat/read evidence was captured.
  - Provided developer/admin login path still shows session-sync instability and remains for manual follow-up.

## Increment 4
- Goal: restore missing back buttons on `메신저` and `가람지사 메신저` found during QA.
- Outcome: complete.

## Increment 5
- Goal: update harness/log/mistake docs and leave a clean remaining manual QA checklist for the user.
- Outcome: complete.

## Increment 6
- Goal: expand the new animated loading treatment from messenger-only screens to every remaining `ActivityIndicator` surface in `app/*` and `components/*`.
- Outcome: complete.

## Increment 7
- Goal: stabilize mobile login after backend auth success by removing font-backed pending spinner dependency, avoiding eager landing-route replacement, and damping repeated push-token registration attempts.
- Outcome: complete.
