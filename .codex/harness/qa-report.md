# QA report

## Summary
- Status: partial-pass
- Scope: invite-link signup referral prefill slowdown / instability caused by exact-code fuzzy search and duplicate pending apply runs

## Passed checks
- `npm test -- --runInBand lib/__tests__/signup-referral.test.ts`
- `npm test -- --runInBand supabase/functions/_shared/__tests__/referral-search.test.ts`
- `npx eslint app/signup.tsx lib/signup-referral.ts lib/__tests__/signup-referral.test.ts`
- `npx eslint --rule "import/no-unresolved: off" supabase/functions/search-signup-referral/index.ts supabase/functions/_shared/referral-search.ts supabase/functions/_shared/__tests__/referral-search.test.ts`
- `git diff --check -- app/signup.tsx lib/signup-referral.ts lib/__tests__/signup-referral.test.ts supabase/functions/search-signup-referral/index.ts supabase/functions/_shared/referral-search.ts supabase/functions/_shared/__tests__/referral-search.test.ts`
- `supabase functions deploy search-signup-referral --project-ref ubeginyxaotcamuqpmud`
- live invoke: `search-signup-referral(query=TUZD8M3A)` => `200 OK`, exact inviter result returned

## Findings
- `search-signup-referral` no longer routes exact 8-character referral code queries through the broad fuzzy search path.
- `app/signup.tsx` now reuses a single in-flight pending referral apply promise instead of recursively scheduling another run after settle.
- The backend exact-code fast path is live on project `ubeginyxaotcamuqpmud`.
- The app-side stability mitigation is code-complete but not yet runtime-verified on a deployed mobile build.

## Gaps / caveats
- No on-device invite-link QA was run in this increment.
- The live shell benchmark after deployment still showed edge/network latency in the ~0.64-0.73s range for the exact-code invoke, so the backend fast path removes wasted DB work but does not by itself prove a dramatic end-user speedup.
- The original crash report did not include a JS message or on-device reproduction in this session, so the app-side single-flight change is a reasoned mitigation tied to the duplicated async path, not a fully reproduced crash proof.

## Recommended manual QA
- Open a valid invite link with an exact 8-character code on a device where GaramIn is already installed.
- Confirm the signup referral spinner/search runs once and does not visibly restart on the same entry.
- Confirm the app no longer crashes on cold start and warm start invite-link entry.
- Complete the existing `RF-LINK-05` runtime evidence set after the next mobile deploy/OTA.
