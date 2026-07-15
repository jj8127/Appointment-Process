# FC Onboarding App — Current QA Report

Updated: 2026-07-16 (Asia/Seoul)

This report summarizes frozen, sanitized evidence. It does not claim that historical local results prove current remote state. Detailed receipts remain in the workspace sprint harness and toolkit evidence index.

## Commit evidence

| Commit | Scope | Evaluation result |
| --- | --- | --- |
| `75b1a0af2c421647ab567421a39ea91b8f714f65` | Signed session and notification-ingress boundary | Local focused verification recorded; remote rollout blocked |
| `a12928b053f46614418d7f2345b8ab2ac59dc7ec` | Board actor/attachment checks, atomic Board/exam writes, privileged actions | Independent local evaluation PASS; remote migration and rollout blocked |
| `863594df2c1b712dde99746768c273f79b6e1f4a` | Operations and release documentation | Independent re-evaluation PASS |

## Independently reproduced security slice

For the frozen `a12928b` scope, the evaluator recorded:

- Changed Edge entrypoint type checks: `18/18`, zero diagnostics.
- Focused Board suites: `6/6` suites and `31/31` tests.
- Atomic exam-save suite: `1/1` suite and `3/3` tests.
- Board proxy and operations tests: `18/18` tests.
- Loopback handler smoke: Board create `6/6`; Board list `5/5`.
- Governance and diff checks: PASS.

These checks used local or fake boundaries and did not deploy or call a remote database.

## Independently reproduced documentation slice

For the frozen documentation scope, the superseding evaluation recorded:

- AGENTS byte-boundary tests: `4/4` PASS.
- Repository governance in normal and handbook/contract-sync modes: PASS.
- Changed Markdown link/path scan: `492` checked, zero missing.
- Changed Markdown UTF-8 scan: zero replacement characters.
- Added-line privacy scan: zero prohibited value patterns.
- Changed Edge evidence: `18/18`, zero diagnostics.

An earlier rollout-order documentation finding was corrected before `863594d`. The final documents separate authentication enforcement from database/API compatibility and keep RPC-dependent callers disabled until the matching additive migration is verified.

## Current worktree facts

- `lib/__tests__/navigation-background-source.test.ts` is an unstaged local modification whose provenance is not established.
- The protected tracked editor configuration remains an unresolved secret incident. Its contents were not used to create this report.
- No current receipt proves authenticated browser flows, remote migration state, remote deployment, observation, or rollback.

## Known broader debt

Historical aggregate runs include pre-existing Deno failures and blocked integration cases. Those results must be refreshed and classified against the current commits; they are not silently converted to green by the focused results above.

## QA verdict

The committed local slices are evidence-backed for their stated scopes. The product verdict remains **릴리스 HOLD** because the secret incident and authenticated/remote rollout gates are unresolved.
