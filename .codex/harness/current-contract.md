# Current Contract

## Increment
- Name: Admin referral graph v14 hybrid force documentation and closeout
- Goal: align docs, harness, and work logs with the current hybrid graph physics implementation, then commit and push the branch with honest verification status.

## Exact Scope
- Web graph canvas and helper contract
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/lib/referral-graph-layout.ts`
  - `web/src/lib/referral-graph-layout.test.ts`
  - `web/src/lib/referral-graph-simulation.test.ts`
- Web graph page settings
  - `web/src/app/dashboard/referrals/graph/page.tsx`
  - `web/src/types/referral-graph.ts`
  - `web/src/types/d3-force.d.ts`
- Referral/admin docs and harness
  - `docs/referral-system/SPEC.md`
  - `docs/referral-system/TEST_CHECKLIST.md`
  - `docs/referral-system/INCIDENTS.md`
  - `docs/handbook/admin-web/dashboard-lifecycle.md`
  - `docs/handbook/admin-web/exam-and-referral-ops.md`
  - `docs/handbook/data/referral-schema-and-admin-rpcs.md`
  - `.codex/harness/*`
  - `.claude/MISTAKES.md`
  - `.claude/WORK_LOG.md`
  - `.claude/WORK_DETAIL.md`

## Acceptance Criteria
- [x] docs no longer claim the graph is v7 four-force-only.
- [x] docs describe v14 storage key and current helper forces.
- [x] docs explicitly ban fixed-radius `radial-containment`, forced `isolated-ring`, drop tether, and release velocity injection.
- [x] docs record weak cluster gravity as a soft boundedness force, not a fixed circle containment force.
- [x] docs record drag rope constraint as the edge stretch control while dragging.
- [ ] all simulation-level cluster/orphan distribution checks pass.
- [x] passing and failing verification are separated in QA notes.

## Checks To Run Before Push
- `node scripts/ci/check-governance.mjs`
- `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
- `node --experimental-strip-types --test web/src/lib/referral-graph-simulation.test.ts`
- `cd web && npm run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/app/dashboard/referrals/graph/page.tsx src/lib/referral-graph-physics.ts src/lib/referral-graph-layout.ts src/lib/referral-graph-simulation.test.ts src/types/referral-graph.ts src/types/d3-force.d.ts`

## Rollback / Containment
- API, DB, and response shapes are unchanged.
- Revert containment is limited to graph helper modules, graph canvas force/drag wiring, graph page physics settings, and matching docs.
- Existing unrelated dirty worktree changes must stay untouched.
