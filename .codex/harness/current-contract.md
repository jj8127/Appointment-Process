# FC Onboarding App — Current Contract

Contract date: 2026-07-16 (Asia/Seoul)

## Objective

Preserve the completed local security and operations slices while closing only evidence-backed, locally actionable work. Do not convert unresolved external state or unexplained worktree content into a claimed pass.

## Frozen completed baseline

- `75b1a0af2c421647ab567421a39ea91b8f714f65` — signed sessions and authenticated notification ingress.
- `a12928b053f46614418d7f2345b8ab2ac59dc7ec` — actor binding, attachment ownership checks, atomic Board/exam writes, and privileged-action boundaries.
- `863594df2c1b712dde99746768c273f79b6e1f4a` — onboarding, operations, deployment, governance, and rollback documentation.

## In scope

- Reproduce local quality gates with external upload disabled.
- Separate new regressions from documented pre-existing debt.
- Preserve a privacy-safe receipt for each command, exit state, duration, and classification.
- Keep the unexplained navigation test change outside staged work.
- Maintain a release HOLD until every external blocker has authoritative evidence.

## Out of scope

- Push, pull request, deployment, remote migration, remote function update, shared-data mutation, account creation, or secret replacement.
- History rewrite or destructive cleanup without a separately approved incident procedure.
- Reading or reproducing protected secret material in a report.
- Treating a local build, mock smoke, or source check as remote verification.

## Acceptance criteria

- The completed baseline commits remain reachable and their documented local checks remain reproducible.
- Changed security entrypoints have zero new type or focused-test regression.
- Governance and documentation controls remain green.
- No durable artifact contains personal data, authorization material, secret values, or source response content.
- Worktree and index scope are explicitly reported before any future commit.
- External blockers are stated as blocked, not passed.

## Release gates still open

- Secret revocation, replacement, history assessment, and clone assessment.
- Authenticated browser role coverage in a disposable environment.
- Verified additive migrations and ordered caller/Edge rollout.
- Remote smoke, observation window, and rollback evidence.
- Proven disposition of `lib/__tests__/navigation-background-source.test.ts`.

## Decision rule

Any verified auth bypass, data-loss path, privacy leak, atomicity failure, migration mismatch, or unresolved active secret keeps the result at **릴리스 HOLD**.
