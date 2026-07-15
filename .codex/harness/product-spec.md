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

## Product guarantees

- Server-side identity is derived from an authenticated session or a narrowly scoped automation identity, never trusted from request-body actor fields.
- Privileged Board and exam mutations preserve all-or-nothing behavior.
- Attachment operations verify actor and object ownership before mutation.
- Logs and diagnostic artifacts exclude personal data, authorization material, source response content, and secret values.
- Build verification must disable external artifact upload and must not deploy, push migrations, create remote accounts, or mutate shared data.
- Database/API compatibility rollout and authentication-enforcement rollout are separate ordered tracks with explicit stop and recovery criteria.

## Current acceptance state

- The three local commits above are present on the current branch.
- Focused security, type, smoke, governance, and documentation checks recorded in the central sanitized QA report passed for their frozen scopes.
- The unexplained local change in `lib/__tests__/navigation-background-source.test.ts` remains outside the completed commits and must stay unstaged until its provenance is established.
- A tracked editor configuration has a known secret-exposure incident. No value, prefix, digest, or raw copy is reproduced here.
- Authenticated browser evidence, remote migration state, caller-first rollout, remote smoke, rollback observation, and secret revocation/history cleanup remain unproven.

## Non-goals

- No push, pull request, production deployment, remote database change, account creation, or secret replacement is authorized by this snapshot.
- Existing unexplained worktree changes are not absorbed into a later commit merely to obtain a clean status.
- A local test result is never represented as proof of remote state.

## Release verdict

**릴리스 HOLD.** The local mitigations are meaningful, but the tracked-secret incident and the missing authenticated and remote rollout evidence are release blockers.
