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

## Current full local matrix

The sanitized receipt `quality-full-20260716-015916` ran at current HEAD `d24a004` with upload disabled and records FC 18/18 PASS:

- full Deno check: 46/46 tracked entrypoints, zero diagnostics;
- root and web TypeScript: PASS;
- root/web lint, Jest and coverage, Expo/web builds, Node and ops tests, Board smoke, Sentry dry-run: PASS;
- root and web package audits: zero vulnerabilities;
- product repository fingerprints before/after: unchanged.

The web Node suite records 228 PASS / 1 SKIP. `referral-graph-realdata` requires actual Supabase data and external credentials and was not run against shared or production data; its classification is `DESTRUCTIVE_OR_EXTERNAL_TEST_BLOCKER`.

## Current completion delta

The post-receipt documentation and paused-runner delta was verified separately from the frozen full receipt:

- `node --test scripts/ops/post-insurance-digest.test.mjs`: 15/15 PASS;
- all `scripts/ops/*.test.mjs`: 28/28 PASS;
- documentation governance: 4/4 PASS;
- repository governance: PASS;
- `git diff --check`: exit 0 with line-ending warnings only;
- read-only Windows Scheduled Task match count: 0;
- compact artifact sizes: AGENTS 10,968 bytes; every canonical harness file remains below 5 KiB and its applicable 24,576/65,536-byte limit.

The model-independence assertion reads the PowerShell launcher and fails if `-m` or `--model` is reintroduced. No task was created, enabled, invoked, or changed. This is a same-agent verification pass; the parent completion audit remains the independent review boundary.

## Current worktree facts

- `lib/__tests__/navigation-background-source.test.ts` is an unstaged local modification whose provenance is not established.
- Credential state is active tracked copy 0, current local untracked copy 6, and confirmed historical tracked exposure. External revoke/rotate and history/clone assessment remain unresolved; contents were not used to create this report.
- No current receipt proves authenticated browser flows, remote migration state, remote deployment, observation, or rollback.

## Known broader debt

Historical Deno and web TypeScript failures are superseded locally by the current full receipt, not erased from history. Authenticated integration, remote rollout, credential incident response, and the destructive/external real-data case remain blocked and are not silently converted to green.

## QA verdict

The committed local slices and current full matrix are evidence-backed for their stated scopes. The product verdict remains **릴리스 HOLD** because credential incident response and authenticated/remote rollout gates are unresolved.
