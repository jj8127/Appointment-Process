# Plan

## Increment 1
- Goal: add the Codex insurance digest posting script with TDD coverage.
- Outcome: implemented.
- Files:
  - `scripts/ops/post-insurance-digest.mjs`
  - `scripts/ops/post-insurance-digest.test.mjs`
  - `package.json`

## Increment 2
- Goal: document the operational contract and keep harness/work logs current.
- Outcome: implemented.
- Files:
  - `docs/handbook/operations-runbook.md`
  - `docs/handbook/backend/notifications-inbox-push.md`
  - `.codex/harness/*`
  - `.claude/WORK_LOG.md`
  - `.claude/WORK_DETAIL.md`

## Increment 3
- Goal: create the Codex daily cron automation for the 08:30 KST pilot.
- Outcome: implemented as automation `daily-insurance-digest-to-garamin-board`.

## Increment 4
- Goal: recover the first failed automation run, publish the 2026-05-17 digest, and harden the prompt away from inline JSON shell payloads.
- Outcome: implemented.

## Increment 5
- Goal: harden live insurance digest presentation, home surfacing, route close behavior, and push delivery.
- Outcome: implemented.
- Files:
  - `app/index.tsx`
  - `app/board.tsx`
  - `components/LinkifiedSelectableText.tsx`
  - `lib/external-url.ts`
  - `lib/home-latest-notice.ts`
  - `lib/notice-route.ts`
  - `scripts/ops/post-insurance-digest.mjs`
  - `supabase/functions/fc-notify/index.ts`

## Current Direction
- Codex automation owns web search and summary drafting.
- Codex automation writes a JSON payload file and invokes the repo script with `--input-file`.
- The repo script owns validation, category resolution, duplicate prevention, and `board-create` posting.
- Visible digest content uses short source names, not raw URLs or AI/reference disclaimer copy.
- Existing board notification/push fanout remains the source of truth, with Expo push chunked at 100 payloads/request.
