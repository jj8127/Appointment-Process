import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REFERRAL_GRAPH_PHYSICS } from '../types/referral-graph.ts';
import {
  applyReferralGraphDragSpring,
  applyReferralGraphLayoutMemory,
  createReferralGraphComponentCohesionForce,
  createReferralGraphEdgeCrossingForce,
  createReferralGraphClusterGravityForce,
  createReferralGraphClusterSeparationForce,
  createReferralGraphLayoutMemoryForce,
  createReferralGraphNodeSeparationForce,
  createReferralGraphSiblingAngularForce,
  getReferralGraphLinkDistance,
  getReferralGraphMinimumNodeDistance,
  isReferralGraphMeaningfulDrag,
  resolveReferralGraphPhysics,
} from './referral-graph-physics.ts';

test('resolveReferralGraphPhysics maps defaults to Obsidian-style d3 force settings', () => {
  assert.deepEqual(resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS), {
    alphaDecay: 0.012,
    velocityDecay: 0.4,
    centerStrength: 0,
    chargeStrength: -30,
    chargeDistanceMin: 12,
    chargeDistanceMax: 250,
    linkDistance: 250,
    linkStrength: 1,
    layoutMemoryStrength: 0.1,
  });
});

test('resolveReferralGraphPhysics clamps the four public Obsidian slider ranges', () => {
  assert.deepEqual(resolveReferralGraphPhysics({
    centerGravity: -1,
    repulsion: -5,
    linkStrength: -0.25,
    linkDistance: 10,
  }), {
    alphaDecay: 0.012,
    velocityDecay: 0.4,
    centerStrength: 0,
    chargeStrength: -0,
    chargeDistanceMin: 12,
    chargeDistanceMax: 180,
    linkDistance: 30,
    linkStrength: 0,
    layoutMemoryStrength: 0.04,
  });

  assert.deepEqual(resolveReferralGraphPhysics({
    centerGravity: 2,
    repulsion: 40,
    linkStrength: 3,
    linkDistance: 999,
  }), {
    alphaDecay: 0.012,
    velocityDecay: 0.4,
    centerStrength: 0,
    chargeStrength: -60,
    chargeDistanceMin: 12,
    chargeDistanceMax: 420,
    linkDistance: 500,
    linkStrength: 1,
    layoutMemoryStrength: 0.16,
  });
});

test('applyReferralGraphLayoutMemory only adds velocity toward the target', () => {
  const node = { id: 'node-a', x: 10, y: -20, vx: 1, vy: -2 };

  applyReferralGraphLayoutMemory(node, { x: 110, y: 30 }, 0.02);

  assert.equal(node.x, 10);
  assert.equal(node.y, -20);
  assert.equal(node.vx, 3);
  assert.equal(node.vy, -1);
});

test('applyReferralGraphLayoutMemory skips fixed or unpositioned nodes', () => {
  const fixed = { id: 'fixed', x: 10, y: 20, vx: 0, vy: 0, fx: 10 };
  const missing = { id: 'missing', vx: 0, vy: 0 };

  applyReferralGraphLayoutMemory(fixed, { x: 100, y: 100 }, 0.05);
  applyReferralGraphLayoutMemory(missing, { x: 100, y: 100 }, 0.05);

  assert.deepEqual(fixed, { id: 'fixed', x: 10, y: 20, vx: 0, vy: 0, fx: 10 });
  assert.deepEqual(missing, { id: 'missing', vx: 0, vy: 0 });
});

test('createReferralGraphLayoutMemoryForce keeps manual drag targets alive after static anchors age out', () => {
  const anchor = { id: 'anchor', x: 0, y: 0, vx: 0, vy: 0 };
  const manual = { id: 'manual', x: 0, y: 0, vx: 0, vy: 0 };
  const manualTargetsRef = { current: new Map([['manual', { x: 100, y: 0 }]]) };
  const force = createReferralGraphLayoutMemoryForce(
    new Map([['anchor', { x: 100, y: 0 }]]),
    0.1,
    { manualNodeTargetsRef: manualTargetsRef, maxTicks: 2 },
  );

  force.initialize([anchor, manual]);
  force(1);
  force(1);

  anchor.vx = 0;
  anchor.vy = 0;
  manual.vx = 0;
  manual.vy = 0;

  force(1);

  assert.equal(anchor.vx, 0);
  assert.equal(anchor.vy, 0);
  assert.ok(manual.vx > 0, `manual drag target should still pull after maxTicks, got ${manual.vx}`);
  assert.equal(manual.vy, 0);
});

test('getReferralGraphLinkDistance gives short leaf spokes and long hub bridges', () => {
  const baseDistance = 250;

  assert.ok(getReferralGraphLinkDistance(1, 12, baseDistance) <= 135);
  assert.ok(getReferralGraphLinkDistance(2, 8, baseDistance) <= 135);
  assert.equal(getReferralGraphLinkDistance(7, 10, baseDistance), 205);
  assert.ok(getReferralGraphLinkDistance(3, 2, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: true,
  }) >= 220);
  assert.ok(getReferralGraphLinkDistance(6, 3, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: true,
  }) >= 220);
  assert.ok(getReferralGraphLinkDistance(6, 6, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: true,
  }) >= 220);
  assert.ok(getReferralGraphLinkDistance(2, 2, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: true,
  }) >= 220);
  assert.ok(getReferralGraphLinkDistance(2, 1, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: false,
  }) <= 135);
});

test('getReferralGraphLinkDistance keeps sparse leaves short and lengthens crowded leaf fans only as needed', () => {
  const baseDistance = 250;

  const sparseSpoke = getReferralGraphLinkDistance(8, 1, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: false,
    sourceChildCount: 3,
    graphNodeCount: 40,
  });
  const crowdedSpoke = getReferralGraphLinkDistance(18, 1, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: false,
    sourceChildCount: 18,
    graphNodeCount: 180,
  });

  assert.ok(sparseSpoke <= 150, `sparse terminal leaf spoke should remain short, got ${sparseSpoke}`);
  assert.ok(crowdedSpoke >= 250, `crowded terminal leaf spoke should reserve fan space, got ${crowdedSpoke}`);
  assert.ok(crowdedSpoke <= 285, `crowded terminal leaf spoke should stay below branch bridge lengths, got ${crowdedSpoke}`);
});

test('getReferralGraphLinkDistance staggers terminal leaf lengths by link id within a short range', () => {
  const baseDistance = 250;
  const distances = Array.from({ length: 12 }, (_, index) => getReferralGraphLinkDistance(12, 1, baseDistance, {
    sourceHasChildren: true,
    sourceChildCount: 12,
    sourceId: 'hub',
    targetHasChildren: false,
    targetId: `leaf-${index}`,
    graphNodeCount: 185,
  }));
  const repeated = getReferralGraphLinkDistance(12, 1, baseDistance, {
    sourceHasChildren: true,
    sourceChildCount: 12,
    sourceId: 'hub',
    targetHasChildren: false,
    targetId: 'leaf-0',
    graphNodeCount: 185,
  });

  assert.equal(distances[0], repeated, 'terminal leaf jitter must be stable for the same link id');
  assert.ok(Math.max(...distances) <= 285, `terminal leaf jitter should stay bounded, got ${distances.join(',')}`);
  assert.ok(Math.min(...distances) >= 220, `crowded terminal leaf jitter should reserve space outside the hub, got ${distances.join(',')}`);
  assert.ok(Math.max(...distances) - Math.min(...distances) >= 18, `terminal leaves should have slightly varied lengths, got ${distances.join(',')}`);
});

test('getReferralGraphMinimumNodeDistance grows enough for admin-sized graphs', () => {
  assert.equal(getReferralGraphMinimumNodeDistance(40), 112);
  assert.ok(getReferralGraphMinimumNodeDistance(180) >= 124);
});

test('getReferralGraphLinkDistance grows child-hub bridges when minimum node spacing needs it', () => {
  const baseDistance = 250;

  const moderateFanout = getReferralGraphLinkDistance(12, 3, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: true,
    sourceChildCount: 12,
    targetChildCount: 3,
    graphNodeCount: 80,
  });
  const denseFanout = getReferralGraphLinkDistance(28, 10, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: true,
    sourceChildCount: 28,
    targetChildCount: 10,
    graphNodeCount: 180,
  });

  assert.ok(denseFanout > moderateFanout, `dense child-hub bridge should expand beyond moderate bridge: ${denseFanout} <= ${moderateFanout}`);
  assert.ok(denseFanout >= 340, `dense child-hub bridge should reserve node spacing, got ${denseFanout}`);
  assert.ok(denseFanout <= 360, `dense child-hub bridge should stay bounded, got ${denseFanout}`);
});

test('getReferralGraphLinkDistance gives subtree hubs more bridge space than leaf spokes', () => {
  const baseDistance = 250;

  const leafSpoke = getReferralGraphLinkDistance(12, 1, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: false,
    sourceChildCount: 12,
    targetSubtreeSize: 1,
    graphNodeCount: 120,
  });
  const hubBridge = getReferralGraphLinkDistance(12, 6, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: true,
    sourceChildCount: 12,
    targetChildCount: 6,
    targetSubtreeSize: 22,
    graphNodeCount: 120,
  });

  assert.ok(hubBridge > leafSpoke, `subtree hub bridge should be longer than leaf spoke: ${hubBridge} <= ${leafSpoke}`);
  assert.ok(hubBridge >= 205, `subtree hub bridge should reserve branch space, got ${hubBridge}`);
});

test('getReferralGraphLinkDistance keeps crowded terminal leaf edges shorter than child-hub edges', () => {
  const baseDistance = 250;
  const terminalLeaf = getReferralGraphLinkDistance(12, 1, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: false,
    sourceChildCount: 12,
    targetChildCount: 0,
    sourceSubtreeSize: 34,
    targetSubtreeSize: 1,
    graphNodeCount: 185,
  });
  const childHub = getReferralGraphLinkDistance(12, 2, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: true,
    sourceChildCount: 12,
    targetChildCount: 1,
    sourceSubtreeSize: 34,
    targetSubtreeSize: 4,
    graphNodeCount: 185,
  });

  assert.ok(terminalLeaf <= 285, `terminal leaf should stay bounded, got ${terminalLeaf}`);
  assert.ok(childHub >= 220, `child hub should have enough bridge space, got ${childHub}`);
  assert.ok(childHub >= terminalLeaf + 35, `child hub edge should be visibly longer: hub=${childHub}, leaf=${terminalLeaf}`);
});

test('getReferralGraphLinkDistance lengthens crowded branch bridges only when local fanout needs it', () => {
  const baseDistance = 250;

  const sparseBridge = getReferralGraphLinkDistance(3, 3, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: true,
    sourceChildCount: 2,
    targetChildCount: 2,
    graphNodeCount: 40,
  });
  const crowdedBridge = getReferralGraphLinkDistance(16, 8, baseDistance, {
    sourceHasChildren: true,
    targetHasChildren: true,
    sourceChildCount: 16,
    targetChildCount: 8,
    sourceSubtreeSize: 48,
    targetSubtreeSize: 18,
    graphNodeCount: 180,
  });

  assert.ok(sparseBridge >= 220, `sparse branch bridge should still be longer than terminal leaves, got ${sparseBridge}`);
  assert.ok(crowdedBridge >= 320, `crowded branch bridge should reserve space, got ${crowdedBridge}`);
});

test('drag spring can prevent stretched edges along the dragged chain', () => {
  const baseDistance = 250;
  const nodes = new Map([
    ['root', { id: 'root', x: 500, y: 0, vx: 0, vy: 0, fx: 500, fy: 0 }],
    ['middle', { id: 'middle', x: 0, y: 0, vx: 0, vy: 0 }],
    ['leaf', { id: 'leaf', x: -160, y: 0, vx: 0, vy: 0 }],
  ]);
  const links = [
    { source: 'root', target: 'middle' },
    { source: 'middle', target: 'leaf' },
  ];
  const degreeByNodeId = new Map([
    ['root', 1],
    ['middle', 2],
    ['leaf', 1],
  ]);
  const childCountByNodeId = new Map([
    ['root', 1],
    ['middle', 1],
  ]);

  applyReferralGraphDragSpring(nodes.get('root')!, nodes, links, {
    baseLinkDistance: baseDistance,
    childCountByNodeId,
    degreeByNodeId,
    preventStretch: true,
  });

  const root = nodes.get('root')!;
  const middle = nodes.get('middle')!;
  const leaf = nodes.get('leaf')!;
  const rootToMiddle = Math.hypot(root.x - middle.x, root.y - middle.y);
  const middleToLeaf = Math.hypot(middle.x - leaf.x, middle.y - leaf.y);
  const rootTargetDistance = getReferralGraphLinkDistance(1, 2, baseDistance, {
    sourceHasChildren: true,
    sourceId: 'root',
    targetHasChildren: true,
    targetId: 'middle',
    sourceChildCount: 1,
    targetChildCount: 1,
  });
  const leafTargetDistance = getReferralGraphLinkDistance(2, 1, baseDistance, {
    sourceHasChildren: true,
    sourceChildCount: 1,
    sourceId: 'middle',
    targetHasChildren: false,
    targetChildCount: 0,
    targetId: 'leaf',
  });

  assert.ok(rootToMiddle <= rootTargetDistance + 0.001, `root edge stretched to ${rootToMiddle}`);
  assert.ok(middleToLeaf <= leafTargetDistance + 0.001, `leaf edge stretched to ${middleToLeaf}`);
});

test('drag spring does not propagate slight drags into unrelated deep stretched links', () => {
  const baseDistance = 250;
  const nodes = new Map([
    ['root', { id: 'root', x: 20, y: 0, vx: 0, vy: 0, fx: 20, fy: 0 }],
    ['middle', { id: 'middle', x: 200, y: 0, vx: 0, vy: 0 }],
    ['leaf', { id: 'leaf', x: 620, y: 0, vx: 0, vy: 0 }],
  ]);
  const links = [
    { source: 'root', target: 'middle' },
    { source: 'middle', target: 'leaf' },
  ];
  const degreeByNodeId = new Map([
    ['root', 1],
    ['middle', 2],
    ['leaf', 1],
  ]);
  const childCountByNodeId = new Map([
    ['root', 1],
    ['middle', 1],
    ['leaf', 0],
  ]);

  applyReferralGraphDragSpring(nodes.get('root')!, nodes, links, {
    baseLinkDistance: baseDistance,
    childCountByNodeId,
    constraintStrength: 1,
    degreeByNodeId,
    preventStretch: true,
    stretchSlack: 0,
  });

  const middle = nodes.get('middle')!;
  const leaf = nodes.get('leaf')!;

  assert.equal(middle.x, 200);
  assert.equal(leaf.x, 620);
});

test('isReferralGraphMeaningfulDrag ignores grab-only and tiny drag gestures', () => {
  assert.equal(isReferralGraphMeaningfulDrag(undefined), false);
  assert.equal(isReferralGraphMeaningfulDrag({ x: 0, y: 0 }), false);
  assert.equal(isReferralGraphMeaningfulDrag({ x: 2, y: 3 }), false);
  assert.equal(isReferralGraphMeaningfulDrag({ x: 7, y: 4 }), true);
  assert.equal(isReferralGraphMeaningfulDrag({ x: -9, y: 0 }), true);
});

test('createReferralGraphClusterSeparationForce pushes overlapping visual clusters apart', () => {
  const nodes = [
    { id: 'a-root', x: 0, y: 0, vx: 0, vy: 0 },
    { id: 'a-leaf', x: 24, y: 0, vx: 0, vy: 0 },
    { id: 'b-root', x: 34, y: 0, vx: 0, vy: 0 },
    { id: 'b-leaf', x: 58, y: 0, vx: 0, vy: 0 },
  ];
  const force = createReferralGraphClusterSeparationForce({
    clusterRadii: new Map([
      [0, 70],
      [1, 70],
    ]),
    gap: 50,
    nodeClusterIndex: new Map([
      ['a-root', 0],
      ['a-leaf', 0],
      ['b-root', 1],
      ['b-leaf', 1],
    ]),
    strength: 0.08,
  });

  force.initialize(nodes);
  force(1);

  assert.ok(nodes[0].vx < 0, `left cluster should move left, got ${nodes[0].vx}`);
  assert.ok(nodes[2].vx > 0, `right cluster should move right, got ${nodes[2].vx}`);
  assert.equal(nodes[0].y, 0);
  assert.equal(nodes[2].y, 0);
});

test('createReferralGraphClusterSeparationForce does not push the actively dragged cluster', () => {
  const nodes = [
    { id: 'dragged-root', x: 0, y: 0, vx: 0, vy: 0 },
    { id: 'dragged-leaf', x: 20, y: 0, vx: 0, vy: 0 },
    { id: 'other-root', x: 44, y: 0, vx: 0, vy: 0 },
    { id: 'other-leaf', x: 64, y: 0, vx: 0, vy: 0 },
  ];
  const force = createReferralGraphClusterSeparationForce({
    activeDraggedNodeIdRef: { current: 'dragged-root' },
    clusterRadii: new Map([
      [0, 70],
      [1, 70],
    ]),
    gap: 40,
    nodeClusterIndex: new Map([
      ['dragged-root', 0],
      ['dragged-leaf', 0],
      ['other-root', 1],
      ['other-leaf', 1],
    ]),
    strength: 0.08,
  });

  force.initialize(nodes);
  force(1);

  assert.equal(nodes[0].vx, 0);
  assert.equal(nodes[1].vx, 0);
  assert.ok(nodes[2].vx > 0, `other cluster should be pushed away, got ${nodes[2].vx}`);
  assert.ok(nodes[3].vx > 0, `other cluster should be pushed away, got ${nodes[3].vx}`);
});

test('createReferralGraphClusterGravityForce keeps a weak center pull after alpha cools', () => {
  const nodes = [
    { id: 'far-a', x: 700, y: 0, vx: 0, vy: 0 },
    { id: 'far-b', x: 730, y: 0, vx: 0, vy: 0 },
  ];
  const force = createReferralGraphClusterGravityForce({
    deadZoneRadius: 420,
    gravityScale: 120,
    maxVelocity: 4.5,
    minAlpha: 0.08,
    nodeClusterIndex: new Map([
      ['far-a', 0],
      ['far-b', 0],
    ]),
    softening: 210,
    strength: 0.0225,
  });

  force.initialize(nodes);
  force(0.00001);

  assert.ok(nodes[0].vx < 0, `cooled gravity should still pull far cluster inward, got ${nodes[0].vx}`);
  assert.ok(nodes[1].vx < 0, `cooled gravity should still pull every member inward, got ${nodes[1].vx}`);
});

test('createReferralGraphClusterGravityForce does not jitter clusters inside the center dead zone', () => {
  const nodes = [
    { id: 'near-a', x: 210, y: 0, vx: 0, vy: 0 },
    { id: 'near-b', x: 250, y: 0, vx: 0, vy: 0 },
  ];
  const force = createReferralGraphClusterGravityForce({
    deadZoneRadius: 420,
    gravityScale: 120,
    minAlpha: 0.08,
    nodeClusterIndex: new Map([
      ['near-a', 0],
      ['near-b', 0],
    ]),
    strength: 0.0225,
  });

  force.initialize(nodes);
  force(0.00001);

  assert.equal(nodes[0].vx, 0);
  assert.equal(nodes[0].vy, 0);
  assert.equal(nodes[1].vx, 0);
  assert.equal(nodes[1].vy, 0);
});

test('createReferralGraphClusterGravityForce skips the actively dragged component', () => {
  const nodes = [
    { id: 'dragged', x: 700, y: 0, vx: 0, vy: 0 },
    { id: 'dragged-child', x: 730, y: 0, vx: 0, vy: 0 },
    { id: 'other', x: -700, y: 0, vx: 0, vy: 0 },
  ];
  const force = createReferralGraphClusterGravityForce({
    activeDraggedNodeIdRef: { current: 'dragged' },
    deadZoneRadius: 420,
    gravityScale: 120,
    minAlpha: 0.08,
    nodeClusterIndex: new Map([
      ['dragged', 0],
      ['dragged-child', 0],
      ['other', 1],
    ]),
    strength: 0.0225,
  });

  force.initialize(nodes);
  force(0.00001);

  assert.equal(nodes[0].vx, 0);
  assert.equal(nodes[1].vx, 0);
  assert.ok(nodes[2].vx > 0, `non-dragged component should still be pulled inward, got ${nodes[2].vx}`);
});

test('createReferralGraphComponentCohesionForce pulls spread component members toward their own center', () => {
  const nodes = [
    { id: 'left-a', x: -220, y: 0, vx: 0, vy: 0 },
    { id: 'left-b', x: 20, y: 0, vx: 0, vy: 0 },
    { id: 'right-a', x: 900, y: 0, vx: 0, vy: 0 },
  ];
  const force = createReferralGraphComponentCohesionForce({
    componentRadii: new Map([[0, 96], [1, 96]]),
    maxVelocity: 16,
    nodeComponentIndex: new Map([
      ['left-a', 0],
      ['left-b', 0],
      ['right-a', 1],
    ]),
    strength: 0.22,
  });

  force.initialize(nodes);
  force(1);

  assert.ok(nodes[0].vx > 0, `outer component member should move toward component center, got ${nodes[0].vx}`);
  assert.ok(nodes[1].vx < 0, `opposite component member should move toward component center, got ${nodes[1].vx}`);
  assert.equal(nodes[2].vx, 0);
});

test('createReferralGraphEdgeCrossingForce separates crossing edge segments', () => {
  const leftUpper = { id: 'left-upper', x: -80, y: -80, vx: 0, vy: 0 };
  const rightLower = { id: 'right-lower', x: 80, y: 80, vx: 0, vy: 0 };
  const leftLower = { id: 'left-lower', x: -80, y: 80, vx: 0, vy: 0 };
  const rightUpper = { id: 'right-upper', x: 80, y: -80, vx: 0, vy: 0 };
  const force = createReferralGraphEdgeCrossingForce({
    links: [
      { source: 'left-upper', target: 'right-lower' },
      { source: 'left-lower', target: 'right-upper' },
    ],
    maxVelocity: 14,
    minDistance: 24,
    strength: 0.4,
  });

  force.initialize([leftUpper, rightLower, leftLower, rightUpper]);
  force(1);

  assert.ok(leftUpper.vx !== 0 || leftUpper.vy !== 0, 'first crossing edge should receive separating velocity');
  assert.ok(leftLower.vx !== 0 || leftLower.vy !== 0, 'second crossing edge should receive separating velocity');
  assert.ok(Math.sign(leftUpper.vy) !== Math.sign(leftLower.vy), `crossing edges should move in opposing vertical directions: ${leftUpper.vy}, ${leftLower.vy}`);
});

test('createReferralGraphNodeSeparationForce repels nearby nodes from different visual clusters', () => {
  const nodes = [
    { id: 'cluster-a', x: 0, y: 0, vx: 0, vy: 0 },
    { id: 'cluster-b', x: 24, y: 0, vx: 0, vy: 0 },
    { id: 'cluster-a-far', x: 180, y: 0, vx: 0, vy: 0 },
  ];
  const force = createReferralGraphNodeSeparationForce({
    crossClusterDistance: 96,
    maxVelocity: 16,
    minDistance: 28,
    nodeClusterIndex: new Map([
      ['cluster-a', 0],
      ['cluster-a-far', 0],
      ['cluster-b', 1],
    ]),
    strength: 0.22,
  });

  force.initialize(nodes);
  force(1);

  assert.ok(nodes[0].vx < 0, `left cluster node should be pushed away, got ${nodes[0].vx}`);
  assert.ok(nodes[1].vx > 0, `right cluster node should be pushed away, got ${nodes[1].vx}`);
  assert.equal(nodes[2].vx, 0);
});

test('createReferralGraphNodeSeparationForce makes drag repulsion one-way', () => {
  const nodes = [
    { id: 'dragged-neighbor', x: 0, y: 0, vx: 0, vy: 0 },
    { id: 'other-node', x: 30, y: 0, vx: 0, vy: 0 },
  ];
  const force = createReferralGraphNodeSeparationForce({
    activeDraggedNodeIdRef: { current: 'dragged-root' },
    crossComponentDistance: 120,
    maxVelocity: 16,
    minDistance: 28,
    nodeClusterIndex: new Map([
      ['dragged-root', 0],
      ['dragged-neighbor', 0],
      ['other-node', 1],
    ]),
    nodeComponentIndex: new Map([
      ['dragged-root', 0],
      ['dragged-neighbor', 0],
      ['other-node', 1],
    ]),
    strength: 0.22,
  });

  force.initialize(nodes);
  force(1);

  assert.equal(nodes[0].vx, 0);
  assert.ok(nodes[1].vx > 0, `other node should be pushed away, got ${nodes[1].vx}`);
});

test('createReferralGraphSiblingAngularForce pushes children apart around the same parent', () => {
  const parent = { id: 'parent', x: 0, y: 0, vx: 0, vy: 0 };
  const upper = { id: 'upper', x: 80, y: 2, vx: 0, vy: 0 };
  const lower = { id: 'lower', x: 80, y: -2, vx: 0, vy: 0 };
  const force = createReferralGraphSiblingAngularForce({
    links: [
      { source: 'parent', target: 'upper' },
      { source: 'parent', target: 'lower' },
    ],
    strength: 0.28,
    maxVelocity: 14,
  });

  force.initialize([parent, upper, lower]);
  force(1);

  assert.ok(upper.vy > 0, `upper child should rotate away upward, got ${upper.vy}`);
  assert.ok(lower.vy < 0, `lower child should rotate away downward, got ${lower.vy}`);
});
