# Referral Graph Natural Physics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 추천인 그래프가 옵시디언 그래프 뷰처럼 자유롭게 움직이고, 노드끼리 자연스럽게 밀고 당기며, 드래그 후 떨림 없이 안정적으로 멈추도록 만든다.

**Architecture:** 추천인 그래프는 계층형 트리 보정이 아니라 하나의 자유 force-directed network로 다룬다. 초기 위치는 기존 추천 관계 레이아웃으로만 seed하고, 이후에는 link spring, charge, collision, weak center, component separation만 계속 작동하게 한다. 모든 변경은 수치 시뮬레이션 테스트와 실제 브라우저 픽셀/드래그 검증을 모두 통과해야 한다.

**Tech Stack:** Next.js 16, React 19, `react-force-graph-2d`, `d3-force`, Node `node:test`, local browser QA with test account `01058006018`.

---

## Current Diagnosis

- 현재 그래프 파일은 `web/src/components/referrals/ReferralGraphCanvas.tsx`다.
- 현재 순수 물리 튜닝은 `web/src/lib/referral-graph-physics.ts`의 `resolveReferralGraphFreePhysics()`와 `getReferralGraphFreeLinkStrength()`에 있다.
- 현재 새 자유 시뮬레이션 테스트는 `web/src/lib/referral-graph-free-simulation.test.ts`에 있다.
- 예전 계층형/핀휠 성격의 테스트는 `web/src/lib/referral-graph-simulation.test.ts`에 많이 남아 있다. 이 테스트들은 그래프가 보기 좋게 고정되는지는 보지만, 옵시디언식 자연 상호작용을 충분히 보장하지 않는다.
- 실제 QA 계정은 `01058006018`로 고정한다. 로컬 브라우저 검증은 이 계정으로 관리자/개발자 세션을 만들고 `/dashboard/referrals/graph`에서 수행한다.

## Non-Negotiable Behavior Contract

- 드래그 중에는 선택한 노드만 포인터에 직접 고정된다.
- 이웃, 자식, 손자 노드를 코드로 함께 끌고 가지 않는다.
- 연결된 노드는 spring force 때문에 따라오고, 연결되지 않은 노드는 charge/collision 때문에 반응한다.
- 드래그 중에도 charge, collision, link spring은 꺼지지 않는다.
- 드래그 종료 시 연결망이 순간적으로 튀거나 고정 좌표로 되돌아가면 실패다.
- 그래프 엔진이 멈춘 뒤 2초 간격 canvas diff가 사실상 0에 가까워야 한다.
- 노드 중심끼리 겹치면 실패다.
- 링크가 과도하게 늘어지거나 끊어진 것처럼 보이면 실패다.
- `개발자`, `본부장`, `FC` 권한 모두 그래프 페이지 접근 정책과 데이터 범위가 일관되어야 한다.

## File Structure

- Modify: `web/src/lib/referral-graph-physics.ts`
  - 자유 물리 파라미터, 링크 strength/distance, collision radius, stability metric helper를 담당한다.
- Modify: `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `react-force-graph-2d`에 실제 force를 설치하고 drag/render/debug lifecycle을 담당한다.
- Modify: `web/src/lib/referral-graph-free-simulation.test.ts`
  - 자유 물리 모델의 핵심 행동을 수치로 검증한다.
- Modify: `web/src/lib/referral-graph-physics.test.ts`
  - 튜닝 파라미터 범위와 degree-aware strength를 검증한다.
- Modify: `web/src/lib/referral-graph-interaction.test.ts`
  - Canvas가 예전 follower/descendant drag 패턴으로 회귀하지 않는지 source contract를 검증한다.
- Modify: `web/src/lib/referral-graph-simulation.test.ts`
  - 남겨둘 legacy layout 테스트와 제거/대체할 legacy physics 테스트를 분리한다.
- Modify: `web/src/app/dashboard/referrals/graph/page.tsx`
  - 물리 preset과 localStorage key를 새 모델 버전으로만 갱신한다.
- Create: [privacy-safe referral graph QA](../../../testing/PRIVACY_SAFE_QA_EVIDENCE_2026-07.md#referral-graph-visual-and-branch-qa)
  - `01058006018` 계정으로 실행한 실제 브라우저 검증 결과를 남긴다.
- Modify: `.claude/MISTAKES.md`
  - 같은 실수를 반복하지 않도록 “고정 레이아웃 테스트만 믿고 자연 상호작용을 검증하지 않은 문제”를 기록한다.

---

### Task 1: Freeze The Natural Physics Contract

**Files:**
- Modify: `web/src/lib/referral-graph-free-simulation.test.ts`
- Modify: `web/src/lib/referral-graph-physics.test.ts`

- [ ] **Step 1: Add metric helpers to `web/src/lib/referral-graph-free-simulation.test.ts`**

Add helpers near the existing `distance()` helper:

```ts
function kineticEnergy(nodes: SimNode[]) {
  return nodes.reduce((total, node) => {
    const vx = Number.isFinite(node.vx) ? node.vx ?? 0 : 0;
    const vy = Number.isFinite(node.vy) ? node.vy ?? 0 : 0;
    return total + (vx * vx) + (vy * vy);
  }, 0);
}

function maxNodeDrift(nodes: SimNode[], before: Map<string, { x: number; y: number }>) {
  return Math.max(...nodes.map((node) => {
    const start = before.get(node.id);
    assert.ok(start, `missing start for ${node.id}`);
    return Math.hypot(node.x - start.x, node.y - start.y);
  }));
}

function maxLinkDistance(links: SimLink[]) {
  return Math.max(...links.map((link) => {
    const source = typeof link.source === 'object' ? link.source : null;
    const target = typeof link.target === 'object' ? link.target : null;
    assert.ok(source && target, `link ${link.id} was not resolved by d3-force`);
    return distance(source, target);
  }));
}
```

- [ ] **Step 2: Add a failing stability test**

Add this test before the drag tests:

```ts
test('free referral graph cools into a visually stable state without perpetual drift', () => {
  const nodes = [
    makeNode('root'),
    makeNode('a'),
    makeNode('b'),
    makeNode('c'),
    makeNode('d'),
    makeNode('e'),
    makeNode('f'),
    makeNode('isolated-1'),
    makeNode('isolated-2'),
  ];
  const edges = [
    makeEdge('root', 'a'),
    makeEdge('root', 'b'),
    makeEdge('a', 'c'),
    makeEdge('a', 'd'),
    makeEdge('b', 'e'),
    makeEdge('e', 'f'),
  ];
  const { layout, maps, physics, simLinks, simNodes } = createRuntimeGraph(nodes, edges);
  const simulation = addFreeReferralForces(
    forceSimulation(simNodes),
    simLinks,
    layout,
    physics,
    maps,
  ).stop();

  for (let index = 0; index < 720; index += 1) {
    simulation.tick();
  }

  const before = new Map(simNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  simulation.alpha(0.002);
  for (let index = 0; index < 180; index += 1) {
    simulation.tick();
  }

  assert.ok(kineticEnergy(simNodes) <= 1.2, `cooled graph still has too much kinetic energy`);
  assert.ok(maxNodeDrift(simNodes, before) <= 3.5, `cooled graph kept drifting`);
  assert.ok(minimumPairDistance(simNodes) >= 56, `settled graph has overlapping nodes`);
  assert.ok(maxLinkDistance(simLinks) <= 430, `settled graph has an overstretched link`);
});
```

- [ ] **Step 3: Run the new test and confirm the current behavior**

Run:

```powershell
npx tsx --test web/src/lib/referral-graph-free-simulation.test.ts web/src/lib/referral-graph-physics.test.ts
```

Expected before implementation: either FAIL on one of the new stability thresholds, or PASS only if the current tuning already satisfies the contract. If it passes, keep the test because it becomes the regression guard.

---

### Task 2: Tune One Free Physics Profile

**Files:**
- Modify: `web/src/lib/referral-graph-physics.ts`
- Modify: `web/src/lib/referral-graph-physics.test.ts`

- [ ] **Step 1: Make `resolveReferralGraphFreePhysics()` the only active graph tuning target**

Keep `resolveReferralGraphPhysics()` only for old tests or older callers, but do not use it from `ReferralGraphCanvas.tsx`.

Use this target profile unless tests show one threshold needs a small adjustment:

```ts
return {
  alphaDecay: 0.016,
  velocityDecay: 0.46,
  centerStrength: Number((0.01 + (centerGravity * 0.028)).toFixed(3)),
  chargeStrength: -36 - (repulsion * 10.5),
  chargeDistanceMin: 22,
  chargeDistanceMax: Math.round(clamp(linkDistance * 2.15, 260, 700)),
  linkDistance: Math.round(clamp(linkDistance * 0.78, 110, 380)),
  linkStrength: Number(clamp(linkStrength * 0.54, 0.1, 0.62).toFixed(2)),
  collisionPadding: 34,
  collisionStrength: 0.88,
  collisionIterations: 2,
  componentSeparationGap: 64,
  componentSeparationStrength: 0.022,
  linkTensionStrength: 0.18,
  linkTensionThresholdMultiplier: 1.38,
  dragReheatAlpha: 0.2,
};
```

Reasoning:
- Lower `alphaDecay` than a fast layout gives the graph time to breathe after drag.
- Higher `velocityDecay` removes post-release wobble.
- Moderate charge avoids both collapse and exploding clusters.
- Collision padding must include visible node radius plus label breathing room.
- Link tension is a guardrail, not the primary layout engine.

- [ ] **Step 2: Add parameter range tests**

In `web/src/lib/referral-graph-physics.test.ts`, assert:

```ts
assert.equal(physics.velocityDecay >= 0.42, true);
assert.equal(physics.velocityDecay <= 0.52, true);
assert.equal(physics.alphaDecay >= 0.012, true);
assert.equal(physics.alphaDecay <= 0.02, true);
assert.equal(physics.collisionStrength >= 0.82, true);
assert.equal(physics.linkTensionStrength <= 0.22, true);
assert.equal(physics.dragReheatAlpha <= 0.24, true);
```

- [ ] **Step 3: Run the physics tests**

Run:

```powershell
npx tsx --test web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-free-simulation.test.ts
```

Expected: PASS.

---

### Task 3: Remove Mixed Legacy Forces From Runtime

**Files:**
- Modify: `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Modify: `web/src/lib/referral-graph-interaction.test.ts`

- [ ] **Step 1: Keep runtime forces to this exact set**

In the force installation effect, only keep:

```ts
charge
link
x
y
link-tension
collision
component-separation
```

Any of these force names must be nulled if they appear in runtime:

```ts
layout-memory
branch-bend
node-separation
cluster-envelope
visual-cluster-separation
cluster-gravity
component-envelope
component-cohesion
sibling-angular
edge-crossing
radial-containment
isolated-ring
drag-spring
center
cluster-repulsion
cluster-cohesion
cluster-collision
component-collision
component-gravity
component-gravitation
hub-fanout
sibling-separation
drop-tether
```

- [ ] **Step 2: Strengthen the source contract test**

In `web/src/lib/referral-graph-interaction.test.ts`, extend the runtime force test:

```ts
assert.match(source, /fg\.d3Force\('layout-memory', null\)/);
assert.match(source, /fg\.d3Force\('drag-spring', null\)/);
assert.match(source, /fg\.d3Force\('component-cohesion', null\)/);
assert.match(source, /fg\.d3Force\('edge-crossing', null\)/);
assert.doesNotMatch(source, /createReferralGraphLayoutMemoryForce\(/);
assert.doesNotMatch(source, /createReferralGraphDragSpringForce\(/);
```

- [ ] **Step 3: Run the source contract**

Run:

```powershell
npx tsx --test web/src/lib/referral-graph-interaction.test.ts
```

Expected: PASS.

---

### Task 4: Fix Drag Semantics To Match A Real Network

**Files:**
- Modify: `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Modify: `web/src/lib/referral-graph-free-simulation.test.ts`
- Modify: `web/src/lib/referral-graph-interaction.test.ts`

- [ ] **Step 1: Runtime drag behavior**

`handleNodeDrag` must:

```ts
nodeDragActiveRef.current = true;
draggedNodeIdRef.current = node.id;
viewportInteractionRef.current = true;
node.fx = node.x;
node.fy = node.y;
node.vx = 0;
node.vy = 0;
graphRef.current?.resumeAnimation?.();
graphRef.current?.d3ReheatSimulation();
```

`handleNodeDragEnd` must:

```ts
node.vx = 0;
node.vy = 0;
node.fx = undefined;
node.fy = undefined;
nodeDragActiveRef.current = false;
draggedNodeIdRef.current = null;
graphRef.current?.resumeAnimation?.();
graphRef.current?.d3ReheatSimulation();
```

Do not translate followers, descendants, connected components, or cached layout targets.

- [ ] **Step 2: Simulation test for interaction**

The existing test `free referral graph drag moves only the pointer node directly while neighbors react through live springs` must keep asserting:

```ts
assert.equal(branchA.fx, undefined);
assert.ok(displacement(branchA, branchAStart) > 90);
assert.ok(distance(root, branchA) <= 390);
```

Add an extra assertion:

```ts
assert.ok(displacement(leafC, leafCStart) < displacement(branchA, branchAStart));
```

This proves response decays through the network instead of moving every node as one rigid body.

- [ ] **Step 3: Run drag tests**

Run:

```powershell
npx tsx --test web/src/lib/referral-graph-free-simulation.test.ts web/src/lib/referral-graph-interaction.test.ts
```

Expected: PASS.

---

### Task 5: Make Engine Stop Actually Stop Visible Motion

**Files:**
- Modify: `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Modify: `web/src/lib/referral-graph-interaction.test.ts`

- [ ] **Step 1: Keep `autoPauseRedraw` on**

The `ForceGraph2D` props must include:

```tsx
autoPauseRedraw
onEngineStop={handleEngineStop}
```

- [ ] **Step 2: Clamp residual velocities only after active drag is over**

`handleEngineStop` must remain:

```ts
const handleEngineStop = useCallback(() => {
  if (nodeDragActiveRef.current) return;

  for (const node of runtimeNodeMapRef.current.values()) {
    node.vx = 0;
    node.vy = 0;
  }
}, []);
```

This prevents a cooled graph from visually drifting for minutes, while preserving motion during drag.

- [ ] **Step 3: Add source contract**

In `web/src/lib/referral-graph-interaction.test.ts`:

```ts
assert.match(source, /if \(nodeDragActiveRef\.current\) return;/);
assert.match(source, /node\.vx = 0;/);
assert.match(source, /node\.vy = 0;/);
assert.match(source, /autoPauseRedraw/);
assert.match(source, /onEngineStop=\{handleEngineStop\}/);
```

- [ ] **Step 4: Run interaction tests**

Run:

```powershell
npx tsx --test web/src/lib/referral-graph-interaction.test.ts
```

Expected: PASS.

---

### Task 6: Make Debug Evidence Available For Local QA

**Files:**
- Modify: `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Modify: `web/src/lib/referral-graph-interaction.test.ts`

- [ ] **Step 1: Expose debug only on local hosts or development**

The guard must be:

```ts
const shouldExposeDebug = (
  process.env.NODE_ENV !== 'production'
  || window.location.hostname === 'localhost'
  || window.location.hostname === '127.0.0.1'
);

if (!shouldExposeDebug) return;
```

- [ ] **Step 2: Include velocity and graph/client coordinates**

`window.__referralGraphDebug.getSnapshot()` must include:

```ts
draggedNodeId
nodeDragActive
nodes[].graphX
nodes[].graphY
nodes[].clientX
nodes[].clientY
nodes[].vx
nodes[].vy
nodes[].fx
nodes[].fy
```

- [ ] **Step 3: Add a metric getter**

Add:

```ts
getMetrics: () => {
  const nodes = [...runtimeNodeMapRef.current.values()];
  const maxVelocity = Math.max(0, ...nodes.map((node) => Math.hypot(node.vx ?? 0, node.vy ?? 0)));
  const totalKineticEnergy = nodes.reduce((total, node) => {
    const vx = node.vx ?? 0;
    const vy = node.vy ?? 0;
    return total + (vx * vx) + (vy * vy);
  }, 0);
  return {
    nodeCount: nodes.length,
    maxVelocity,
    totalKineticEnergy,
  };
}
```

- [ ] **Step 4: Add source contract**

Run:

```powershell
npx tsx --test web/src/lib/referral-graph-interaction.test.ts
```

Expected: PASS and source test confirms local debug exposure exists.

---

### Task 7: Update Graph Presets Without Making One Preset Hide Bugs

**Files:**
- Modify: `web/src/app/dashboard/referrals/graph/page.tsx`

- [ ] **Step 1: Keep presets inside the stable model**

Use these presets:

```ts
const PHYSICS_PRESETS = [
  { key: 'balanced', label: '균형', values: DEFAULT_REFERRAL_GRAPH_PHYSICS },
  { key: 'spread', label: '넓게', values: { centerGravity: 0.1, repulsion: 18, linkStrength: 0.42, linkDistance: 330 } },
  { key: 'tight', label: '좁게', values: { centerGravity: 0.36, repulsion: 8, linkStrength: 0.68, linkDistance: 150 } },
] as const;
```

- [ ] **Step 2: Bump localStorage key**

Use:

```ts
key: 'referral-graph-physics-settings-v18-natural'
```

This prevents old broken tuning from staying in the browser.

- [ ] **Step 3: Run targeted lint**

Run:

```powershell
npm --prefix web run lint -- src/app/dashboard/referrals/graph/page.tsx
```

Expected: PASS.

---

### Task 8: Validate Role And Data Consistency

**Files:**
- Modify: `web/src/lib/admin-web-route-access.test.ts`
- Modify: `web/src/lib/admin-web-referral-graph-nav.test.ts`
- No schema changes.

- [ ] **Step 1: Confirm graph nav is visible to developer and branch manager**

`web/src/lib/admin-web-referral-graph-nav.test.ts` must assert the staff nav contains:

```ts
{ label: '추천인 그래프', icon: IconGraph, href: '/dashboard/referrals/graph' }
```

- [ ] **Step 2: Confirm FC can only use graph route**

`web/src/lib/admin-web-route-access.test.ts` must keep asserting:

```ts
assert.equal(resolveAdminWebRouteAccess('/dashboard/referrals/graph', fcSession).allowed, true);
assert.equal(resolveAdminWebRouteAccess('/dashboard', fcSession).redirectTo, '/dashboard/referrals/graph');
```

- [ ] **Step 3: Run access tests**

Run:

```powershell
npx tsx --test web/src/lib/admin-web-route-access.test.ts web/src/lib/admin-web-referral-graph-nav.test.ts
```

Expected: PASS.

---

### Task 9: Browser QA With Account `01058006018`

**Files:**
- Create: [privacy-safe referral graph QA](../../../testing/PRIVACY_SAFE_QA_EVIDENCE_2026-07.md#referral-graph-visual-and-branch-qa)

- [ ] **Step 1: Build without mutating Sentry release state**

Run:

```powershell
$env:SENTRY_AUTH_TOKEN=''; npm --prefix web run build
```

Expected: build succeeds. Warnings unrelated to graph may be recorded, but no build failure is allowed.

- [ ] **Step 2: Start local production server**

Run:

```powershell
npm --prefix web run start -- -p 3100
```

Expected: app is available at `http://localhost:3100`.

- [ ] **Step 3: Log in or create local staff session with `01058006018`**

Use account:

```text
01058006018
```

Open:

```text
http://localhost:3100/dashboard/referrals/graph
```

Expected:
- Page shows 추천인 그래프.
- Canvas count is 1.
- Graph data loads without dashboard/auth redirect loop.

- [ ] **Step 4: Capture settled screenshots**

After graph appears:

1. Wait 12 seconds.
2. Capture canvas screenshot A.
3. Wait 2.5 seconds.
4. Capture canvas screenshot B.
5. Compare canvas pixels.

Pass threshold:

```text
nonzero pixel ratio <= 0.005
large pixel ratio <= 0.001
```

If the diff is higher, do not declare complete. Inspect `window.__referralGraphDebug.getMetrics()` and continue tuning.

- [ ] **Step 5: Drag an actual node**

Use `window.__referralGraphDebug.getSnapshot()` to find a visible high-degree node, then drag it by about 200px.

Expected:
- Dragged node follows the pointer.
- Direct neighbors move naturally after the drag.
- Non-neighbor nodes move only through collision/charge, not as a rigid block.
- On release, no snap-back.
- After 8-12 seconds, `maxVelocity` is close to 0.

- [ ] **Step 6: Record QA evidence**

Create [privacy-safe referral graph QA](../../../testing/PRIVACY_SAFE_QA_EVIDENCE_2026-07.md#referral-graph-visual-and-branch-qa) with:

```md
# Referral Graph Visual QA

- Date: 2026-06-27
- Account: 01058006018
- URL: http://localhost:3100/dashboard/referrals/graph
- Node count: record the number shown in the page summary, for example `259`
- Edge count: record the number shown in the page summary, for example `154`
- Settled diff nonzero ratio: record the measured ratio, for example `0.0032`
- Settled diff large ratio: record the measured ratio, for example `0.0004`
- Dragged node: record the node name/id selected from `window.__referralGraphDebug.getSnapshot()`
- Drag result: write `PASS` only if there is no snap-back, no rigid follower movement, and no long wobble
- Console errors: write the exact count and first error message, or `0`
- Result: write `PASS` or `FAIL`, then one sentence explaining why
```

Every field must contain a measured value. Use `N/A` only when a value genuinely does not apply.

---

### Task 10: Final Verification Gate

**Files:**
- Modify: `.claude/MISTAKES.md`
- Verify all changed graph files.

- [ ] **Step 1: Run the graph test suite**

Run:

```powershell
npx tsx --test web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-free-simulation.test.ts web/src/lib/referral-graph-simulation.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-display.test.ts web/src/lib/admin-web-route-access.test.ts web/src/lib/admin-web-referral-graph-nav.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run targeted lint**

Run:

```powershell
npm --prefix web run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/lib/referral-graph-physics.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-interaction.test.ts src/lib/referral-graph-free-simulation.test.ts src/app/dashboard/referrals/graph/page.tsx
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```powershell
$env:SENTRY_AUTH_TOKEN=''; npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 4: Update mistake ledger**

Add a dated note to `.claude/MISTAKES.md`:

```md
| 2026-06-27 | Admin Web Referral Graph Physics | Treated a fixed/tree-like graph layout as proof of natural interaction. | Always add free-force simulation tests and browser settled-pixel/drag QA before claiming graph physics is complete. |
```

- [ ] **Step 5: Completion rule**

The work is complete only when all of these are true:

```text
unit tests pass
lint passes
production build passes
browser graph loads with 01058006018
settled canvas diff is within threshold
manual drag has no snap-back, no rigid follower movement, and no long wobble
QA evidence is written to [privacy-safe referral graph QA](../../../testing/PRIVACY_SAFE_QA_EVIDENCE_2026-07.md#referral-graph-visual-and-branch-qa)
```

If any one item fails, return to Task 1 or Task 2 with the observed evidence.
