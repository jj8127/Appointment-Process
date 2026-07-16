# FC Onboarding App — Current Execution Plan

Updated: 2026-07-16 (Asia/Seoul)

This plan replaces the append-only increment ledger with the current execution order. Prior detail remains in Git history and the workspace sprint harness.

## Completed local slices

1. `75b1a0af2c421647ab567421a39ea91b8f714f65` — signed session and notification-ingress boundary.
2. `a12928b053f46614418d7f2345b8ab2ac59dc7ec` — actor-bound Board/attachment operations and atomic Board/exam writes.
3. `863594df2c1b712dde99746768c273f79b6e1f4a` — onboarding, operations, deployment, governance, and rollback documentation.
4. `1c76cfb` through `d24a004` — all 46 Edge entrypoints, root/web TypeScript, builds, tests, and dependency audits closed; `quality-full-20260716-015916` records FC 18/18 PASS.

Each slice was path-selectively committed. None proves remote deployment or database state.

## Active worktree containment

1. Preserve `lib/__tests__/navigation-background-source.test.ts` as an unstaged, unexplained change.
2. Do not read, print, stage, or rewrite the six current untracked credential copies during ordinary product work; handle them only under an authorized bounded cleanup contract.
3. Keep new work separated by explicit path and hunk selection; never use broad staging.
4. Store only sanitized receipts and structural manifests in durable evidence.

## Remaining release work

### P0 — Secret incident response

- Revoke and replace the exposed material through an authorized external workflow.
- Assess repository history and clones without copying the value into reports.
- Preserve the verified active tracked copy count of 0 and remove the six current untracked copies only under approved local cleanup boundaries.
- Record a sanitized incident receipt and independent review.

### P0 — Remote security rollout

- Establish disposable, authorized environments and identities.
- Prove signed caller adoption before enforcing the corresponding Edge boundary.
- Apply and verify additive database migrations before activating dependent RPC callers.
- Run authenticated role, ownership, atomicity, notification, and rollback smoke checks.
- Stop on auth bypass, partial write, privacy leak, migration mismatch, or role-contract failure.

### P1 — External/destructive test evidence

- Keep `referral-graph-realdata` skipped unless an approved disposable environment and external credentials are supplied.
- Classify the current 228 PASS / 1 SKIP web Node result as `DESTRUCTIVE_OR_EXTERNAL_TEST_BLOCKER`; do not run it against shared or production data to manufacture a green external result.

### P1 — Insurance digest recovery

- Keep the automation PAUSED. The 2026-07-16 read-only task scan found zero matching Windows Scheduled Tasks.
- Recover the paired token and complete approved manual local/staging E2E before any scheduler activation.
- Keep the fallback model-independent by using the installed Codex default model.

### P1 — Worktree reconciliation

- Determine provenance for the navigation test change.
- Commit it only under a new explicit contract with independent verification, or leave it documented and unstaged.

## Completion criteria

- Locally actionable gates pass or have an evidence-backed classification and owner.
- No unexplained work is included in a commit.
- Secret incident response and authenticated/remote rollout have independent evidence.
- A release decision is made from current receipts rather than historical aggregate counts.

## Current decision

Locally actionable implementation, quality, documentation, and model-independence slices are complete. External credential, authenticated E2E, rollout, and destructive/external test work is not complete; the repository remains **릴리스 HOLD**.
