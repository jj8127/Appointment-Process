# Plan

## Increment 21
- Goal: document and close out the current v14 hybrid referral graph force contract before commit/push.
- Outcome: in progress for this closeout.
- Notes:
  - Replace stale v7 "Obsidian four-force only" docs with the current hybrid contract.
  - Record passing targeted physics checks separately from failing simulation checks.
  - Update `.claude` logs and mistake ledger so future agents do not report incomplete graph checklist items as complete.

## Increment 20
- Goal: reset admin referral graph physics to an Obsidian-equivalent four-force model.
- Outcome: superseded.
- Notes:
  - The v7 four-force reset removed unstable stacked custom forces, but live referral tree readability still needed cluster separation, dynamic branch distances, and drag edge constraints.

## Current Runtime Direction
- Public controls remain the four familiar graph sliders: `Center force`, `Repel force`, `Link force`, `Link distance`.
- Runtime implementation is hybrid:
  - d3 charge and internal link force
  - link tension and branch bend for readable edge length
  - sibling angular separation for parent-child pinwheels
  - node/cluster/component separation for cluster distinction
  - weak cluster gravity for bounded but draggable layout
  - drag rope constraint to prevent long edge stretch
- Removed/forbidden:
  - fixed-radius `radial-containment`
  - forced `isolated-ring`
  - drop tether
  - release velocity injection

## Earlier Work
- Historical increments remain in `.claude/WORK_DETAIL.md` and `.claude/WORK_LOG.md`.
