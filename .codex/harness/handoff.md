# Handoff

## Complete
- Investigated the invite-link signup slowdown/crash report with a root-cause-first pass.
- Confirmed two concrete contributors:
  - exact 8-character signup referral queries were still taking the broad fuzzy search backend path
  - `app/signup.tsx` could queue redundant pending referral apply reruns while the first run was still in flight
- Added tests first:
  - `lib/__tests__/signup-referral.test.ts`
  - `supabase/functions/_shared/__tests__/referral-search.test.ts`
- Implemented:
  - `lib/signup-referral.ts` single-flight helper
  - `app/signup.tsx` pending apply reuse
  - `supabase/functions/_shared/referral-search.ts` exact-code query helper
  - `supabase/functions/search-signup-referral/index.ts` exact-code fast path
- Deployed `search-signup-referral` to Supabase project `ubeginyxaotcamuqpmud`.
- Updated referral SSOT/test/incident/mistake/work/harness docs for the new regression case `RF-LINK-05` and incident `INC-020`.

## Still to do
- Mobile deploy/OTA that carries the `app/signup.tsx` single-flight change.
- On-device invite-link QA:
  - cold start exact-code invite link
  - warm start exact-code invite link
  - confirm no duplicate spinner/search restart
  - confirm no crash

## Important notes
- Backend exact-code fast path is already live.
- App-side mitigation is not live until the next mobile rollout.
- Current evidence is strong for the performance-path fix and the duplicated async-path mitigation, but not yet a full reproduced-and-cleared mobile crash proof.
- If the user asks for rollout next, the likely order is:
  1. decide OTA vs. build/release path for GaramIn
  2. ship the `signup.tsx` JS change
  3. run `RF-LINK-05` on device and record the result in `TEST_RUN_RESULT.json`
