# QA Report

## Summary
- Status: passed with scheduler risk noted
- Scope: Codex automatic insurance issue briefing pilot, home surfacing, link/close crash hardening, and notification push recovery.

## TDD Evidence
- RED:
  - `node --test scripts/ops/post-insurance-digest.test.mjs`
  - Failed with `ERR_MODULE_NOT_FOUND` before `scripts/ops/post-insurance-digest.mjs` existed.
  - After dry-run exposed an omitted-title bug, a focused test failed with `TypeError: now is not a function`.
- GREEN:
  - `node --test scripts/ops/post-insurance-digest.test.mjs`
  - 10 tests passed.

## Passed Checks
- `node --test scripts/ops/post-insurance-digest.test.mjs`
  - 10 tests passed.
- `npm test -- --runTestsByPath lib/__tests__/external-url.test.ts lib/__tests__/notice-route.test.ts lib/__tests__/home-latest-notice.test.ts --runInBand`
  - 3 suites passed, 11 tests passed.
- `npm run ops:post-insurance-digest -- --input-json '{"content":"오늘의 핵심 요약\n- 테스트","sourceUrls":["https://example.com"]}' --dry-run`
  - Returned `status: dry-run` and a KST default title.
- `node scripts/ci/check-governance.mjs`
  - Passed.
- Remote read smoke:
  - `board-categories-list` returned HTTP 200 with `ok: true`.
- Remote setup:
  - Created `보험소식` category with slug `insurance-news`.
  - Follow-up `board-categories-list` confirmed `hasInsuranceNews: true`.
- Codex automation `daily-insurance-digest-to-garamin-board`
  - Created, viewed, and updated to require very short/easy Korean plus mandatory sources.
- First run failure diagnosis:
  - Automation session `rollout-2026-05-17T22-43-16-019e362d-4175-7912-a3ec-2867f57f2499.jsonl` showed `CreateProcessAsUserW failed: 1312` even for `pwd`.
  - The run generated a digest but did not upload it.
- Live posting smoke:
  - `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/2026-05-17.json --dry-run`
    - Returned `status: dry-run`.
  - `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/2026-05-17.json`
    - Returned `status: posted`, `postId: c9abace0-2d5f-4d78-88f8-be750c102048`.
  - Re-running the same command returned `status: skipped` with the same `existingPostId`.
- Automation prompt update:
  - Now requires `.codex-tmp/insurance-digest/YYYY-MM-DD.json` plus `--input-file`.
  - Now explicitly says shell-runner failure is a blocker and must not be reported as an uploaded post.
  - Now forbids raw URLs in visible content and forbids AI/reference/disclaimer copy.
- Live post cleanup and surfacing:
  - Remote `board-update` removed raw URL lines and the AI/reference disclaimer from `postId: c9abace0-2d5f-4d78-88f8-be750c102048`.
  - Remote `fc-notify latest_notice` returns `board_notice:c9abace0-2d5f-4d78-88f8-be750c102048` with category `보험소식`.
  - Remote FC/admin `inbox_list` each includes one `board_post` notification row targeting `/board-detail?postId=c9abace0-2d5f-4d78-88f8-be750c102048`.
  - Initial FC push exposed Expo's 100-message request limit; after chunking and deploying `fc-notify`, retry returned two successful 200 chunks for 195 FC tokens without inserting duplicate notification rows.
- Deployment:
  - `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud`
  - `supabase functions deploy board-create --project-ref ubeginyxaotcamuqpmud`
- 2026-05-18 recovery:
  - 08:30 KST Codex app cron had no new session or payload file, so the scheduled post did not happen.
  - Manual `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/2026-05-18.json` posted `postId: bbb63250-c3ee-409b-80bf-139927d675a1`.
  - Remote `board-detail` confirmed no raw URL in visible content.
  - Remote `fc-notify latest_notice` returned `board_notice:bbb63250-c3ee-409b-80bf-139927d675a1`.
  - Manual `fc-notify notify` repaired FC/admin notification rows and push fanout after direct `board-create` notification rows were missing.
  - Direct debug insert identified remote constraint drift: `23514 notifications_recipient_role_check` rejected `manager`.
  - `supabase db push --linked --yes` applied `20260518000001_allow_manager_notifications.sql`.
  - Direct FC/admin/manager debug notification insert succeeded after migration and the debug rows were deleted.
  - `scripts/ops/run-insurance-digest-codex.ps1 -DryRun` passed.
  - Windows Task Scheduler task `GaramIn Insurance Digest Codex Fallback` was registered for 08:35 KST.

## Known Risks
- Live posting depends on repo `.env` / `.env.local` staying available or equivalent process env being supplied.
- Codex search quality depends on automation prompt discipline; low-quality or duplicated web results must be filtered before posting.
- Codex app scheduled posting still depends on the Codex Desktop background runner starting at the expected local time and being able to execute local shell commands. The Windows Task Scheduler / Codex CLI fallback reduces but does not eliminate this operational risk.
