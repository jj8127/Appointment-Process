# Current contract

## Increment
- Name: Invite-link signup exact-code fast path and single-flight stabilization
- Goal: remove the slow and unstable signup referral prefill path triggered by invite links with exact 8-character referral codes.

## Exact scope
- App signup flow
  - `app/signup.tsx`
  - `lib/signup-referral.ts`
  - `lib/__tests__/signup-referral.test.ts`
- Signup search backend
  - `supabase/functions/search-signup-referral/index.ts`
  - `supabase/functions/_shared/referral-search.ts`
  - `supabase/functions/_shared/__tests__/referral-search.test.ts`
- Referral docs / logs / harness
  - `docs/referral-system/SPEC.md`
  - `docs/referral-system/ARCHITECTURE.md`
  - `docs/referral-system/TEST_CHECKLIST.md`
  - `docs/referral-system/INCIDENTS.md`
  - `docs/referral-system/test-cases.json`
  - `docs/referral-system/TEST_RUN_RESULT.json`
  - `.claude/MISTAKES.md`
  - `.claude/WORK_LOG.md`
  - `.claude/WORK_DETAIL.md`
  - `.codex/harness/plan.md`
  - `.codex/harness/current-contract.md`
  - `.codex/harness/qa-report.md`
  - `.codex/harness/handoff.md`

## Acceptance criteria
- [x] exact 8-character signup referral queries are detected and handled by a dedicated fast path before fuzzy name/affiliation search
- [x] signup pending referral apply joins an in-flight run instead of queueing recursive reruns
- [x] failing tests were added first for the exact-code helper and single-flight helper
- [x] `search-signup-referral` is redeployed to the linked Supabase project after the backend change
- [ ] invite-link runtime QA on device confirms no duplicate spinner/search and no crash on cold/warm start

## Checks run
- `npm test -- --runInBand lib/__tests__/signup-referral.test.ts`
- `npm test -- --runInBand supabase/functions/_shared/__tests__/referral-search.test.ts`
- `npx eslint app/signup.tsx lib/signup-referral.ts lib/__tests__/signup-referral.test.ts`
- `npx eslint --rule "import/no-unresolved: off" supabase/functions/search-signup-referral/index.ts supabase/functions/_shared/referral-search.ts supabase/functions/_shared/__tests__/referral-search.test.ts`
- `git diff --check -- app/signup.tsx lib/signup-referral.ts lib/__tests__/signup-referral.test.ts supabase/functions/search-signup-referral/index.ts supabase/functions/_shared/referral-search.ts supabase/functions/_shared/__tests__/referral-search.test.ts`
- `supabase functions deploy search-signup-referral --project-ref ubeginyxaotcamuqpmud`
- live invoke: `search-signup-referral(query=TUZD8M3A)` => `200 OK`, exact inviter result

## Rollback / containment
- Backend fast path is already live. If runtime QA finds a regression, prefer containing it in `search-signup-referral` or reverting that single function deployment rather than reopening the old direct-input signup contract.
- App-side single-flight is not live until the next mobile deploy/OTA. Do not claim the crash is resolved in production until that rollout and user QA are complete.
