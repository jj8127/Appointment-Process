# FC Onboarding App — Current Handoff

Updated: 2026-07-16 (Asia/Seoul)

## Outcome

The completed security and operations work is preserved in path-selective local commits, and the current HEAD is `d24a004e40751c07fbc060f11fb1790e837e461d`:

- `75b1a0af2c421647ab567421a39ea91b8f714f65` — signed application sessions and authenticated notification ingress.
- `a12928b053f46614418d7f2345b8ab2ac59dc7ec` — actor-bound Board/attachment operations and atomic Board/exam writes.
- `863594df2c1b712dde99746768c273f79b6e1f4a` — onboarding, operations, deployment, governance, and rollback documentation.
- `1c76cfb` through `d24a004` — full Deno/web TypeScript and dependency gate closure.

The release is not approved.

## Current repository state to preserve

- Branch and commit history must remain unchanged unless a new contract explicitly authorizes a local commit.
- `lib/__tests__/navigation-background-source.test.ts` is modified and unstaged; its origin is unresolved.
- Credential state is active tracked copy 0, current local untracked copy 6, and confirmed historical tracked exposure. Do not inspect or reproduce those copies during ordinary handoff work.
- Do not use stash, reset, checkout, clean, broad staging, push, pull request, deployment, remote database mutation, or secret replacement as a convenience step.

## Evidence available

- The security slice at `a12928b` has an independent local PASS covering changed entrypoint type checks, focused Board/exam tests, local handler smoke, governance, and diff checks.
- The documentation slice at `863594d` has an independent superseding PASS covering governance, byte limits, link/path integrity, UTF-8, and privacy patterns.
- `quality-full-20260716-015916` records FC 18/18 PASS, Deno 46/46, root/web TypeScript PASS, zero root/web audit vulnerabilities, and unchanged product fingerprints.
- The web Node result is 228 PASS / 1 SKIP; the actual-data case is classified `DESTRUCTIVE_OR_EXTERNAL_TEST_BLOCKER`.
- The subsequent docs/paused-runner delta passes ops 28/28, documentation governance 4/4, repository governance, and `git diff --check`; read-only Scheduled Task matching remains 0.
- The central sanitized sprint QA and toolkit receipt index carry the detailed command evidence. Historical append-only notes are recoverable from Git and are intentionally omitted here.

## Required next actions

1. Resolve the active secret incident through an authorized external process: revoke, replace, assess history/clones, and record sanitized proof.
2. Remove the six current local untracked copies only under an approved bounded cleanup contract, then verify a sanitized zero-result.
3. Establish a disposable authenticated environment and verify role, ownership, atomicity, notification, and rollback behavior.
4. Apply and verify additive migrations before enabling dependent callers; separately prove signed caller adoption before Edge enforcement.
5. Keep insurance automation PAUSED until its token and approved manual E2E are restored; the current read-only scan found zero matching scheduled tasks.
6. Run the real-data graph case only with approved external credentials and disposable/non-shared boundaries.
7. Determine the provenance and intended disposition of the navigation test change.

## Stop conditions

Stop rollout on auth bypass, personal-data exposure, partial write, ownership failure, migration mismatch, privacy-unsafe diagnostics, or an unresolved active secret. Use feature-off, a held safe artifact, or additive forward correction; do not restore insecure fallback behavior.

## Final verdict

**릴리스 HOLD** until credential incident response, authenticated testing, remote rollout, observation, and rollback evidence are complete.
