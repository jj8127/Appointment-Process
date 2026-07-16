# FC Onboarding App — Current Contract

Contract date: 2026-07-16 (Asia/Seoul)

## Objective

Preserve the completed local security and operations slices, keep current quality claims aligned to the full receipt, and remove the insurance fallback model pin without activating automation. Do not convert unresolved external state or unexplained worktree content into a claimed pass.

## Frozen completed baseline

- `75b1a0af2c421647ab567421a39ea91b8f714f65` — signed sessions and authenticated notification ingress.
- `a12928b053f46614418d7f2345b8ab2ac59dc7ec` — actor binding, attachment ownership checks, atomic Board/exam writes, and privileged-action boundaries.
- `863594df2c1b712dde99746768c273f79b6e1f4a` — onboarding, operations, deployment, governance, and rollback documentation.
- Current HEAD `d24a004e40751c07fbc060f11fb1790e837e461d`; `quality-full-20260716-015916` records FC 18/18 PASS and unchanged product fingerprints.

## In scope

- Align control docs and handoff with FC 18/18, Deno 46/46, and root/web TypeScript PASS.
- Remove the explicit Codex model option from `scripts/ops/run-insurance-digest-codex.ps1` and guard the default-model contract with a deterministic ops test.
- Record the read-only scheduled-task result while keeping insurance automation PAUSED.
- Classify the single real-data skip as `DESTRUCTIVE_OR_EXTERNAL_TEST_BLOCKER`.
- Keep the unexplained user-owned protected test change outside staged work and verification.
- Maintain a release HOLD until every external blocker has authoritative evidence.

## Out of scope

- Push, pull request, deployment, remote migration, remote function update, shared-data mutation, account creation, or secret replacement.
- History rewrite or destructive cleanup without a separately approved incident procedure.
- Reading or reproducing protected secret material in a report.
- Treating a local build, mock smoke, or source check as remote verification.
- Creating, modifying, enabling, or invoking a Windows Scheduled Task.

## Acceptance criteria

- The current full receipt remains attributable and is not narrowed: FC 18/18, Deno 46/46, root/web TypeScript PASS.
- The insurance fallback has no `-m` or `--model` array option and its regression test passes.
- A read-only task scan reports zero matching insurance fallback tasks; no scheduler state is mutated.
- Governance, documentation, and all ops tests remain green.
- No durable artifact contains personal data, authorization material, secret values, or source response content.
- Worktree and index scope are explicitly reported before any future commit.
- External blockers are stated as blocked, not passed.

## Release gates still open

- Secret revocation, replacement, history assessment, and clone assessment.
- Approved cleanup and bounded zero-result for six current local untracked credential copies; active tracked copy count is already 0.
- Authenticated browser role coverage in a disposable environment.
- Verified additive migrations and ordered caller/Edge rollout.
- Remote smoke, observation window, and rollback evidence.
- Approved real-data graph execution in a disposable/external environment, if that evidence is required for release.
- Proven disposition of one user-owned protected test that remains excluded from all task edits, staging, and verification.

## Decision rule

Any verified auth bypass, data-loss path, privacy leak, atomicity failure, migration mismatch, or unresolved active secret keeps the result at **릴리스 HOLD**.
