# Handoff

## Complete
- Added `scripts/ops/post-insurance-digest.mjs` as a repo-local bridge for Codex-generated daily insurance digest posts.
- Added Node tests for CLI parsing, dry-run, category lookup/create, duplicate skip, and posting.
- Added `npm run ops:post-insurance-digest`.
- Documented the automation operation in handbook runbooks.
- Added repo `.env` / `.env.local` fallback so the Codex automation can use existing Supabase and admin phone aliases without separate process env injection.
- Created the remote `보험소식` / `insurance-news` board category.
- Tightened the script and automation prompt so posts must be very short/easy and include at least one valid source URL.
- Diagnosed the first automation run failure as a Codex Desktop background runner shell error (`CreateProcessAsUserW failed: 1312`), not a board script failure.
- Posted the 2026-05-17 digest manually through the same repo script.
- Updated the Codex automation prompt to write a JSON payload file and call the script with `--input-file`.
- Removed visible raw URLs and AI/reference disclaimer copy from the live 2026-05-17 post.
- Added short source-label handling and optional `sourceLabels` support to the posting script.
- Included `insurance-news` board posts in home `latest_notice` and labeled them as `보험소식` on the home card.
- Routed home board notices to `/board-detail` and changed `/board?postId=` modal closing to clear params instead of replacing the route.
- Shortened clickable URL display and opened links via the external browser path.
- Deployed `fc-notify` with Expo push chunking and redeployed `board-create`.

## Verified
- `node --test scripts/ops/post-insurance-digest.test.mjs`
- `npm run ops:post-insurance-digest -- --input-json '{"content":"오늘의 핵심 요약\n- 테스트","sourceUrls":["https://example.com"]}' --dry-run`
- `node scripts/ci/check-governance.mjs`
- Remote `board-categories-list` smoke returned `ok: true`.
- Remote category confirmation returned `hasInsuranceNews: true`.
- Codex automation `daily-insurance-digest-to-garamin-board` was created, viewed, and updated with the short/easy/source-required rule.
- `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/2026-05-17.json --dry-run`
- `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/2026-05-17.json`
  - Posted `postId: c9abace0-2d5f-4d78-88f8-be750c102048`.
- Second run of the same command returned duplicate `status: skipped`.
- `npm test -- --runTestsByPath lib/__tests__/external-url.test.ts lib/__tests__/notice-route.test.ts lib/__tests__/home-latest-notice.test.ts --runInBand`
- Remote `board-detail` confirmed the live post has no raw `http(s)` URL and no AI/reference disclaimer.
- Remote `fc-notify latest_notice` returned the live `보험소식` board post.
- Remote FC/admin `inbox_list` each returned the live `board_post` notification row.
- FC push retry after chunking returned two successful Expo chunks for 195 FC tokens.

## Remaining
- Optional later hardening: add a durable DB-side run log if the pilot graduates from Codex automation to service-owned cron.
- Next scheduled automatic post still needs observation because the first background runner could not execute shell commands.

## Resume Steps
1. Run `node --test scripts/ops/post-insurance-digest.test.mjs`.
2. Run the targeted Jest command from `current-contract.md`.
3. Run the npm input-file dry-run command from `current-contract.md`.
4. Run `node scripts/ci/check-governance.mjs`.
5. Inspect the Codex automation for daily 08:30 execution and confirm the next background run can execute shell commands.
