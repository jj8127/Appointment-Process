# Handoff

## Complete
- Updated the referral graph docs and harness from stale v7 four-force-only wording to the current v14 hybrid force contract.
- Current implementation preserves the four public graph sliders while using helper forces for referral tree readability:
  - dynamic link distance / link tension
  - branch bend
  - sibling angular separation
  - node and cluster separation
  - cluster/component envelopes
  - weak cluster gravity
  - drag rope constraint
- Documented that fixed-radius `radial-containment`, forced `isolated-ring`, drop tether, and release velocity injection are not allowed.
- Documented that drag holds only the pointer target with `fx/fy`, while connected nodes are constrained by rope behavior so edges do not stretch without bound.

## Verified
- Latest pass:
  - `node scripts/ci/check-governance.mjs`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - `cd web && npm run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/app/dashboard/referrals/graph/page.tsx src/lib/referral-graph-physics.ts src/lib/referral-graph-layout.ts src/lib/referral-graph-simulation.test.ts src/types/referral-graph.ts src/types/d3-force.d.ts`
  - `cd web && npm run build`

## Known Failing / Not Complete
- Latest simulation run still failed 3 cases:
  - cluster/orphan separation on pinwheel mixed graphs
  - isolated nodes staying outside the connected core
  - admin-sized mixed graph compactness with modest isolated shell
- Do not tell the user all graph checklist items are complete until `web/src/lib/referral-graph-simulation.test.ts` passes or the criteria are consciously revised and reverified.

## Suggested Next Step
- If continuing graph quality work, first make the three failing simulation assertions pass, then verify the live page at `http://localhost:3000/dashboard/referrals/graph` with:
  - no oversized outer circle
  - cluster separation
  - no long edge stretch while dragging
  - no vibration while holding a dragged node
  - no center snap-back while dragging a cluster outward

## Important Notes
- This is a graph UX/physics correction only; there is no API, DB, schema, or rollout migration.
- Existing unrelated dirty worktree changes and generated browser temp files should not be included in the graph commit.
