# QA Report

## Summary
- Status: partial
- Scope: admin referral graph v14 hybrid force layout and documentation closeout.

## Passed Checks
- `node scripts/ci/check-governance.mjs`
  - Passed.
- `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - 14 tests passed.
  - Covers current link distance, separation, bounded cluster gravity, and drag rope helper behavior.
- `cd web && npm run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/app/dashboard/referrals/graph/page.tsx src/lib/referral-graph-physics.ts src/lib/referral-graph-layout.ts src/lib/referral-graph-simulation.test.ts src/types/referral-graph.ts src/types/d3-force.d.ts`
  - Passed.
- `cd web && npm run build`
  - Passed after stopping the running local Next dev server that blocked `scripts/clean-next.mjs`.

## Known Failing Check
- `node --experimental-strip-types --test web/src/lib/referral-graph-simulation.test.ts`
  - 17 pass, 3 fail in the latest run.
  - Failing cases:
    - `referral graph simulation keeps pinwheel clusters separated without global center collapse`
    - `isolated nodes stay outside connected referral clusters instead of mixing through the center`
    - `admin-sized mixed graph keeps connected clusters compact and isolated shell modest`

## Current Product Risks
- Cluster/orphan distribution simulation is not fully green. Do not report this checklist as complete until those failures pass or the assertions are deliberately updated with a verified new acceptance target.
- Live browser visuals still need final operator-style verification on `http://localhost:3000/dashboard/referrals/graph` after any additional physics tuning.
- The current implementation intentionally avoids fixed-radius `radial-containment`; boundedness relies on weak `cluster-gravity` plus cluster/node separation and must not reintroduce a hard circular cage.

## Notes
- This QA report replaces the stale v7 "pass" report. It is intentionally conservative because the user explicitly flagged prior false completion reporting.
