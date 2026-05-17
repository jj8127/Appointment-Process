# Current Contract

## Increment
- Name: Codex insurance digest pilot posting, home surfacing, and notification hardening
- Goal: provide a safe repo-local posting bridge for daily Codex-generated insurance issue digests, surface the posts on GaramIn home, and keep board notification/push behavior stable.

## Exact Scope
- Create a Node ESM CLI under `scripts/ops/`.
- Add focused Node test coverage for parsing, dry-run, category handling, duplicate skip, and posting.
- Add an npm script alias.
- Document operational env and notification contract.
- Create one daily Codex cron automation for `E:\hanhwa\fc-onboarding-app`.
- Publish the 2026-05-17 digest manually from the same repo script after the automation runner failed to execute shell commands.
- Update automation instructions to use `--input-file` and to report shell-runner failures as blockers, not uploads.
- Include `보험소식` board posts in `latest_notice`, route home board notices to `/board-detail`, and avoid the `/board?postId=` modal close crash path.
- Remove long raw URLs and AI/reference disclaimer copy from visible digest content.
- Chunk Expo push fanout in `fc-notify` so FC audiences over 100 tokens are accepted.

## Acceptance Criteria
- [x] Script accepts JSON digest payload and dry-run mode.
- [x] Script resolves or creates `보험소식` / `insurance-news`.
- [x] Script skips duplicate same-day `보험 이슈 브리핑 YYYY.MM.DD` titles.
- [x] Script posts through `board-create`, not direct table insert.
- [x] Content includes short visible source names and keeps raw URLs out of the board body.
- [x] Content does not append AI/reference/disclaimer copy.
- [x] Script rejects digest payloads without at least one valid source URL.
- [x] Automation prompt requires very short, easy Korean and mandatory sources.
- [x] Daily Codex automation exists and targets the repo.
- [x] Automation prompt uses a payload file plus `--input-file` instead of inline JSON.
- [x] Script can run without explicit process env by loading existing repo env aliases.
- [x] Remote `보험소식` category exists.
- [x] 2026-05-17 digest was posted once, duplicate rerun skipped, and the live post was updated to remove raw URLs/disclaimer copy.
- [x] Home `latest_notice` returns the 2026-05-17 `보험소식` board post.
- [x] FC/admin notification rows exist for the live post.
- [x] FC Expo push fanout succeeds in chunks after deployment.
- [x] Verification commands pass or failures are documented.

## Checks
- `node --test scripts/ops/post-insurance-digest.test.mjs`
- `npm run ops:post-insurance-digest -- --input-json '{"content":"오늘의 핵심 요약\n- 테스트","sourceUrls":["https://example.com"]}' --dry-run`
- `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/2026-05-17.json --dry-run`
- `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/2026-05-17.json`
- `npm test -- --runTestsByPath lib/__tests__/external-url.test.ts lib/__tests__/notice-route.test.ts lib/__tests__/home-latest-notice.test.ts --runInBand`
- `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud`
- `supabase functions deploy board-create --project-ref ubeginyxaotcamuqpmud`
- `node scripts/ci/check-governance.mjs`

## Rollback / Containment
- Remove the Codex automation if automatic posting should stop.
- Revert script, tests, package alias, and docs. No schema rollback is needed.
