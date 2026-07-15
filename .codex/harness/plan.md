# FC Onboarding App — Current Execution Plan

Updated: 2026-07-16 (Asia/Seoul)

This plan replaces the append-only increment ledger with the current execution order. Prior detail remains in Git history and the workspace sprint harness.

## Completed local slices

1. `75b1a0af2c421647ab567421a39ea91b8f714f65` — signed session and notification-ingress boundary.
2. `a12928b053f46614418d7f2345b8ab2ac59dc7ec` — actor-bound Board/attachment operations and atomic Board/exam writes.
3. `863594df2c1b712dde99746768c273f79b6e1f4a` — onboarding, operations, deployment, governance, and rollback documentation.

Each slice was path-selectively committed. None proves remote deployment or database state.

## Active worktree containment

1. Preserve `lib/__tests__/navigation-background-source.test.ts` as an unstaged, unexplained change.
2. Do not read, print, stage, or rewrite the protected tracked editor configuration during ordinary product work.
3. Keep new work separated by explicit path and hunk selection; never use broad staging.
4. Store only sanitized receipts and structural manifests in durable evidence.

## Remaining release work

### P0 — Secret incident response

- Revoke and replace the exposed material through an authorized external workflow.
- Assess repository history and clones without copying the value into reports.
- Verify the active configuration no longer contains usable material.
- Record a sanitized incident receipt and independent review.

### P0 — Remote security rollout

- Establish disposable, authorized environments and identities.
- Prove signed caller adoption before enforcing the corresponding Edge boundary.
- Apply and verify additive database migrations before activating dependent RPC callers.
- Run authenticated role, ownership, atomicity, notification, and rollback smoke checks.
- Stop on auth bypass, partial write, privacy leak, migration mismatch, or role-contract failure.

### P1 — Full local quality matrix

- Re-run repository diff checks, governance, lint, TypeScript, Jest, coverage, web export/build, Node and operations tests, Board handler smoke, full Deno checks, and package audits.
- Classify every nonzero result as product defect, test debt, environment block, external authorization block, or destructive-test block.
- Distinguish pre-existing Deno debt from any changed-entrypoint regression; do not narrow the published check set to obtain green output.

### P1 — Worktree reconciliation

- Determine provenance for the navigation test change.
- Commit it only under a new explicit contract with independent verification, or leave it documented and unstaged.

## Completion criteria

- Locally actionable gates pass or have an evidence-backed classification and owner.
- No unexplained work is included in a commit.
- Secret incident response and authenticated/remote rollout have independent evidence.
- A release decision is made from current receipts rather than historical aggregate counts.

## Current decision

Local implementation and documentation slices are complete. Release work is not complete; the repository remains **릴리스 HOLD**.
