# FC Onboarding App — Current Product Snapshot

Updated: 2026-07-16 (Asia/Seoul)

This file is the current, privacy-safe product snapshot. Historical increments remain recoverable from Git and from the sanitized evidence index under the workspace sprint harness; they are not repeated here.

## Product purpose

The repository contains the FC mobile app, admin web app, shared TypeScript contracts, Supabase functions and migrations, and local operational tooling. The product must keep role boundaries, user-visible request and exam flows, atomic writes, privacy-safe diagnostics, and reversible rollout procedures aligned across those surfaces.

## Current delivered outcomes

| Outcome | Local commit | Current interpretation |
| --- | --- | --- |
| Signed application sessions and authenticated notification ingress | `75b1a0af2c421647ab567421a39ea91b8f714f65` | Locally implemented and focused-test verified; remote rollout not proven |
| Actor-bound Board actions, attachment checks, atomic Board updates, atomic exam saves, and privileged-action input boundaries | `a12928b053f46614418d7f2345b8ab2ac59dc7ec` | Locally implemented and independently evaluated; remote migrations and caller rollout not proven |
| Onboarding, operations, deployment, governance, and rollback documentation | `863594df2c1b712dde99746768c273f79b6e1f4a` | Local documentation increment committed after independent re-evaluation |
| Repository-wide TypeScript, Deno, build, test, and dependency closure | `1c76cfb` through `d24a004` | Current full receipt passes FC 18/18; remote state is still not proven |

## Product guarantees

- Server-side identity is derived from an authenticated session or a narrowly scoped automation identity, never trusted from request-body actor fields.
- Privileged Board and exam mutations preserve all-or-nothing behavior.
- Attachment operations verify actor and object ownership before mutation.
- Logs and diagnostic artifacts exclude personal data, authorization material, source response content, and secret values.
- Build verification must disable external artifact upload and must not deploy, push migrations, create remote accounts, or mutate shared data.
- Database/API compatibility rollout and authentication-enforcement rollout are separate ordered tracks with explicit stop and recovery criteria.

## Current acceptance state

- The listed local commits and closure range are present on the current branch.
- `quality-full-20260716-015916` passes FC 18/18, including all 46 tracked Edge entrypoints, root and web TypeScript, lint, Jest and coverage, Expo/web builds, Node/ops/Board smoke, Sentry dry-run, and both package audits.
- The web Node result is 228 PASS / 1 SKIP. The skipped `referral-graph-realdata` case requires actual Supabase data and external credentials, so it is classified `DESTRUCTIVE_OR_EXTERNAL_TEST_BLOCKER`, not a local product failure or remote E2E pass.
- One unexplained user-owned protected test remains outside the completed commits and all task edits, staging, and verification until its provenance is established; its identifier is withheld.
- Credential state is active tracked copy 0, current local untracked copy 6, and confirmed historical tracked exposure. Authorized local cleanup plus external rotation and history/clone assessment remain open; no value, prefix, digest, or raw copy is reproduced here.
- Authenticated browser evidence, remote migration state, caller-first rollout, remote smoke, rollback observation, and secret revocation/history cleanup remain unproven.

## Non-goals

- No push, pull request, production deployment, remote database change, account creation, or secret replacement is authorized by this snapshot.
- Existing unexplained worktree changes are not absorbed into a later commit merely to obtain a clean status.
- A local test result is never represented as proof of remote state.

## Release verdict

**릴리스 HOLD.** The local matrix is green, but credential incident response plus authenticated and remote rollout evidence remain release blockers.
