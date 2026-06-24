# Mistakes

## 2026-06-24 - Sentry automation ran before its contract existed on main

- Mistake: The daily Sentry automation was pointed at `origin/main` and `npm run ops:sentry-triage`, but `origin/main` did not yet contain the script. The linked worktree also only checked its own `.env` files, so it could not read the primary checkout's local `SENTRY_READ_AUTH_TOKEN`.
- Fix: Add the triage script and package command to main-bound code, and make the script read `.env` / `.env.local` from both the linked worktree and the primary checkout resolved through `git rev-parse --git-common-dir`.
- Rule: Before scheduling a Codex worktree automation, verify the exact command exists on the branch the automation checks out, and verify required read-only secrets are provided by process/user environment or by a primary-checkout env file that the script explicitly loads.
