import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReferralGraphLayout } from './referral-graph-layout.ts';
import type { GraphEdge, GraphNode } from '../types/referral-graph.ts';

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    name: id,
    phone: '',
    affiliation: '',
    activeCode: null,
    referralCount: 0,
    inboundCount: 0,
    nodeStatus: 'has_active_code',
    isIsolated: true,
    signupCompleted: true,
    allCommissionsCompleted: false,
    hasLegacyUnresolved: false,
    highlightType: null,
    ...overrides,
  };
}

function makeEdge(source: string, target: string): GraphEdge {
  return {
    id: `${source}__${target}`,
    source,
    target,
    referralCode: null,
  };
}

function angleBetween(from: { x: number; y: number }, to: { x: number; y: number }) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function angleDelta(left: number, right: number) {
  const delta = Math.abs(left - right) % (Math.PI * 2);
  return delta > Math.PI ? (Math.PI * 2) - delta : delta;
}

function segmentCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return ((bx - ax) * (cy - ay)) - ((by - ay) * (cx - ax));
}

function pointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const epsilon = 1e-6;
  return (
    px >= Math.min(ax, bx) - epsilon
    && px <= Math.max(ax, bx) + epsilon
    && py >= Math.min(ay, by) - epsilon
    && py <= Math.max(ay, by) + epsilon
    && Math.abs(segmentCross(ax, ay, bx, by, px, py)) <= epsilon
  );
}

function disjointSegmentsIntersect(
  left: GraphEdge,
  right: GraphEdge,
  positions: Map<string, { x: number; y: number }>,
) {
  if (
    left.source === right.source
    || left.source === right.target
    || left.target === right.source
    || left.target === right.target
  ) {
    return false;
  }

  const leftSource = positions.get(left.source);
  const leftTarget = positions.get(left.target);
  const rightSource = positions.get(right.source);
  const rightTarget = positions.get(right.target);
  assert.ok(leftSource && leftTarget && rightSource && rightTarget, 'missing edge endpoint position');

  const ax = leftSource.x;
  const ay = leftSource.y;
  const bx = leftTarget.x;
  const by = leftTarget.y;
  const cx = rightSource.x;
  const cy = rightSource.y;
  const dx = rightTarget.x;
  const dy = rightTarget.y;
  const epsilon = 1e-6;
  const abC = segmentCross(ax, ay, bx, by, cx, cy);
  const abD = segmentCross(ax, ay, bx, by, dx, dy);
  const cdA = segmentCross(cx, cy, dx, dy, ax, ay);
  const cdB = segmentCross(cx, cy, dx, dy, bx, by);

  if (Math.abs(abC) <= epsilon && pointOnSegment(cx, cy, ax, ay, bx, by)) return true;
  if (Math.abs(abD) <= epsilon && pointOnSegment(dx, dy, ax, ay, bx, by)) return true;
  if (Math.abs(cdA) <= epsilon && pointOnSegment(ax, ay, cx, cy, dx, dy)) return true;
  if (Math.abs(cdB) <= epsilon && pointOnSegment(bx, by, cx, cy, dx, dy)) return true;

  return (
    ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
  );
}

function countDisjointEdgeCrossings(edges: GraphEdge[], positions: Map<string, { x: number; y: number }>) {
  let crossings = 0;
  for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
      if (disjointSegmentsIntersect(edges[leftIndex], edges[rightIndex], positions)) {
        crossings += 1;
      }
    }
  }
  return crossings;
}

test('buildReferralGraphLayout places isolated nodes on an outer orbit', () => {
  const isolatedNodes = Array.from({ length: 32 }, (_, index) => makeNode(`isolated-${index}`));
  const connectedNodes = [
    makeNode('hub'),
    makeNode('leaf-a'),
    makeNode('leaf-b'),
  ];
  const edges = [
    makeEdge('hub', 'leaf-a'),
    makeEdge('hub', 'leaf-b'),
  ];
  const layout = buildReferralGraphLayout([...connectedNodes, ...isolatedNodes], edges);

  const connectedRadius = Math.max(
    ...connectedNodes.map((node) => {
      const position = layout.nodeAnchorPositions.get(node.id);
      assert.ok(position, `missing position for ${node.id}`);
      return Math.hypot(position.x, position.y);
    }),
  );

  for (const node of isolatedNodes) {
    const position = layout.nodeAnchorPositions.get(node.id);
    assert.ok(position, `missing position for ${node.id}`);
    assert.ok(
      Math.hypot(position.x, position.y) > connectedRadius + 180,
      `isolated node should start outside connected clusters, got ${JSON.stringify(position)}`,
    );
  }
});

test('buildReferralGraphLayout gives root hub branches non-crossing initial wedges', () => {
  const childHubIds = Array.from({ length: 8 }, (_, index) => `branch-${index}`);
  const rootLeafIds = Array.from({ length: 10 }, (_, index) => `root-leaf-${index}`);
  const branchLeafIds = childHubIds.flatMap((hubId) => (
    Array.from({ length: 4 }, (_, index) => `${hubId}-leaf-${index}`)
  ));
  const nodes = [
    makeNode('root'),
    ...childHubIds.map((id) => makeNode(id)),
    ...rootLeafIds.map((id) => makeNode(id)),
    ...branchLeafIds.map((id) => makeNode(id)),
  ];
  const edges = [
    ...childHubIds.map((id) => makeEdge('root', id)),
    ...rootLeafIds.map((id) => makeEdge('root', id)),
    ...childHubIds.flatMap((hubId) => (
      Array.from({ length: 4 }, (_, index) => makeEdge(hubId, `${hubId}-leaf-${index}`))
    )),
  ];

  const layout = buildReferralGraphLayout(nodes, edges);

  assert.equal(
    countDisjointEdgeCrossings(edges, layout.nodeAnchorPositions),
    0,
    'root branch seed layout should not cross direct root spokes with branch-local edges',
  );
});

test('buildReferralGraphLayout exposes component metadata for non-overlap checks', () => {
  const nodes = [
    makeNode('root'),
    makeNode('child-a'),
    makeNode('child-b'),
    makeNode('orphan'),
  ];
  const edges = [
    makeEdge('root', 'child-a'),
    makeEdge('root', 'child-b'),
  ];
  const layout = buildReferralGraphLayout(nodes, edges);

  assert.equal(layout.componentAnchors.size, 1);
  assert.equal(layout.componentRadii.size, 1);
  assert.equal(layout.componentSizes.get(0), 3);
  assert.equal(layout.nodeComponentIndex.get('root'), 0);
  assert.ok(layout.nodeOrderInComponent.has('root'));
  assert.ok(layout.nodeOrderInComponent.has('child-a'));
  assert.ok(layout.nodeOrderInComponent.has('child-b'));
});

test('buildReferralGraphLayout assigns visual cluster metadata by parent hub ownership', () => {
  const nodes = [
    makeNode('root'),
    makeNode('hub-a'),
    makeNode('hub-b'),
    makeNode('hub-a-leaf'),
    makeNode('hub-b-leaf'),
  ];
  const edges = [
    makeEdge('root', 'hub-a'),
    makeEdge('root', 'hub-b'),
    makeEdge('hub-a', 'hub-a-leaf'),
    makeEdge('hub-b', 'hub-b-leaf'),
  ];
  const layout = buildReferralGraphLayout(nodes, edges);
  const hubACluster = layout.nodeClusterIndex.get('hub-a');
  const hubBCluster = layout.nodeClusterIndex.get('hub-b');

  assert.notEqual(hubACluster, undefined);
  assert.notEqual(hubBCluster, undefined);
  assert.equal(layout.nodeClusterIndex.get('hub-a-leaf'), hubACluster);
  assert.equal(layout.nodeClusterIndex.get('hub-b-leaf'), hubBCluster);
  assert.notEqual(hubACluster, hubBCluster);
  assert.ok(layout.clusterRadii.get(hubACluster as number), 'missing hub-a cluster radius');
  assert.ok(layout.clusterRadii.get(hubBCluster as number), 'missing hub-b cluster radius');
});

test('buildReferralGraphLayout fans hub children around their parent', () => {
  const childIds = Array.from({ length: 8 }, (_, index) => `leaf-${index}`);
  const nodes = [
    makeNode('hub'),
    ...childIds.map((id) => makeNode(id)),
  ];
  const edges = childIds.map((id) => makeEdge('hub', id));
  const layout = buildReferralGraphLayout(nodes, edges);
  const hubPosition = layout.nodeAnchorPositions.get('hub');
  assert.ok(hubPosition, 'missing hub position');

  const childAngles = childIds
    .map((id) => {
      const position = layout.nodeAnchorPositions.get(id);
      assert.ok(position, `missing child position for ${id}`);
      const distance = Math.hypot(position.x - hubPosition.x, position.y - hubPosition.y);
      assert.ok(distance >= 150 && distance <= 250, `child ${id} should sit on a readable hub orbit, got ${distance}`);
      return Math.atan2(position.y - hubPosition.y, position.x - hubPosition.x);
    })
    .sort((left, right) => left - right);

  const gaps = childAngles.map((angle, index) => {
    const next = childAngles[(index + 1) % childAngles.length] + (index === childAngles.length - 1 ? Math.PI * 2 : 0);
    return next - angle;
  });
  assert.ok(Math.min(...gaps) > 0.45, `hub children should not collapse into one side, gaps=${gaps.join(',')}`);
});

test('buildReferralGraphLayout gives crowded hubs a wider initial child orbit', () => {
  const childIds = Array.from({ length: 18 }, (_, index) => `leaf-${index}`);
  const nodes = [
    makeNode('hub'),
    ...childIds.map((id) => makeNode(id)),
  ];
  const edges = childIds.map((id) => makeEdge('hub', id));
  const layout = buildReferralGraphLayout(nodes, edges);
  const hubPosition = layout.nodeAnchorPositions.get('hub');
  assert.ok(hubPosition, 'missing hub position');

  const childDistances = childIds.map((id) => {
    const position = layout.nodeAnchorPositions.get(id);
    assert.ok(position, `missing child position for ${id}`);
    return Math.hypot(position.x - hubPosition.x, position.y - hubPosition.y);
  });

  assert.ok(
    Math.min(...childDistances) >= 180,
    `crowded hub children need a wider orbit, distances=${childDistances.join(',')}`,
  );
  assert.ok(
    Math.max(...childDistances) <= 480,
    `crowded hub orbit should stay bounded, distances=${childDistances.join(',')}`,
  );
  assert.ok(
    Math.max(...childDistances) - Math.min(...childDistances) >= 40,
    `crowded hub children should use staggered edge lengths, distances=${childDistances.join(',')}`,
  );
});

test('buildReferralGraphLayout lengthens the child orbit when minimum spacing cannot fit', () => {
  const childIds = Array.from({ length: 28 }, (_, index) => `leaf-${index}`);
  const nodes = [
    makeNode('hub'),
    ...childIds.map((id) => makeNode(id)),
  ];
  const edges = childIds.map((id) => makeEdge('hub', id));
  const layout = buildReferralGraphLayout(nodes, edges);
  const hubPosition = layout.nodeAnchorPositions.get('hub');
  assert.ok(hubPosition, 'missing hub position');

  const childDistances = childIds.map((id) => {
    const position = layout.nodeAnchorPositions.get(id);
    assert.ok(position, `missing child position for ${id}`);
    return Math.hypot(position.x - hubPosition.x, position.y - hubPosition.y);
  });

  assert.ok(
    Math.min(...childDistances) >= 330,
    `very crowded hub should lengthen edge/orbit radius to preserve node spacing, distances=${childDistances.join(',')}`,
  );
});

test('buildReferralGraphLayout keeps the dominant hub central and satellite hubs separated', () => {
  const satelliteIds = ['satellite-a', 'satellite-b', 'satellite-c'];
  const rootLeafIds = Array.from({ length: 6 }, (_, index) => `root-leaf-${index}`);
  const satelliteLeafIds = satelliteIds.flatMap((hubId) => (
    Array.from({ length: 3 }, (_, index) => `${hubId}-leaf-${index}`)
  ));
  const nodes = [
    makeNode('root'),
    ...satelliteIds.map((id) => makeNode(id)),
    ...rootLeafIds.map((id) => makeNode(id)),
    ...satelliteLeafIds.map((id) => makeNode(id)),
  ];
  const edges = [
    ...satelliteIds.map((id) => makeEdge('root', id)),
    ...rootLeafIds.map((id) => makeEdge('root', id)),
    ...satelliteIds.flatMap((hubId) => (
      Array.from({ length: 3 }, (_, index) => makeEdge(hubId, `${hubId}-leaf-${index}`))
    )),
  ];

  const layout = buildReferralGraphLayout(nodes, edges);
  const rootPosition = layout.nodeAnchorPositions.get('root');
  assert.ok(rootPosition, 'missing dominant hub position');
  assert.ok(Math.hypot(rootPosition.x, rootPosition.y) < 1, `dominant hub should seed near center, got ${JSON.stringify(rootPosition)}`);

  for (const satelliteId of satelliteIds) {
    const satellitePosition = layout.nodeAnchorPositions.get(satelliteId);
    assert.ok(satellitePosition, `missing satellite hub position for ${satelliteId}`);
    const satelliteDistance = Math.hypot(satellitePosition.x - rootPosition.x, satellitePosition.y - rootPosition.y);
    assert.ok(
      satelliteDistance >= 105,
      `satellite hub ${satelliteId} should start away from dominant hub`,
    );
    assert.ok(satelliteDistance <= 280, `satellite hub ${satelliteId} should not create an abnormal long edge, got ${satelliteDistance}`);
  }
});

test('buildReferralGraphLayout gives first-level child hubs varied compact branch lengths', () => {
  const childHubIds = Array.from({ length: 12 }, (_, index) => `child-hub-${index}`);
  const nodes = [
    makeNode('root'),
    ...childHubIds.map((id) => makeNode(id)),
    ...childHubIds.flatMap((hubId) => [
      makeNode(`${hubId}-leaf-a`),
      makeNode(`${hubId}-leaf-b`),
    ]),
  ];
  const edges = [
    ...childHubIds.map((id) => makeEdge('root', id)),
    ...childHubIds.flatMap((hubId) => [
      makeEdge(hubId, `${hubId}-leaf-a`),
      makeEdge(hubId, `${hubId}-leaf-b`),
    ]),
  ];

  const layout = buildReferralGraphLayout(nodes, edges);
  const root = layout.nodeAnchorPositions.get('root');
  assert.ok(root, 'missing root position');

  const childHubDistances = childHubIds.map((hubId) => {
    const position = layout.nodeAnchorPositions.get(hubId);
    assert.ok(position, `missing child hub position for ${hubId}`);
    return Math.hypot(position.x - root.x, position.y - root.y);
  });

  assert.ok(
    Math.max(...childHubDistances) - Math.min(...childHubDistances) >= 28,
    `first-level child hubs should not sit on one identical radial ring: ${childHubDistances.join(',')}`,
  );
  assert.ok(
    Math.max(...childHubDistances) <= 360,
    `first-level child hubs should stay visually connected to the root, got ${childHubDistances.join(',')}`,
  );
});

test('buildReferralGraphLayout treats a child with descendants as its own radial branch', () => {
  const nodes = [
    makeNode('root'),
    makeNode('direct-leaf-a'),
    makeNode('direct-leaf-b'),
    makeNode('branch-child'),
    makeNode('grandchild'),
  ];
  const edges = [
    makeEdge('root', 'direct-leaf-a'),
    makeEdge('root', 'direct-leaf-b'),
    makeEdge('root', 'branch-child'),
    makeEdge('branch-child', 'grandchild'),
  ];

  const layout = buildReferralGraphLayout(nodes, edges);
  const root = layout.nodeAnchorPositions.get('root');
  const directLeaf = layout.nodeAnchorPositions.get('direct-leaf-a');
  const branchChild = layout.nodeAnchorPositions.get('branch-child');
  const grandchild = layout.nodeAnchorPositions.get('grandchild');
  assert.ok(root, 'missing root position');
  assert.ok(directLeaf, 'missing direct leaf position');
  assert.ok(branchChild, 'missing branch child position');
  assert.ok(grandchild, 'missing grandchild position');

  const directLeafDistance = Math.hypot(directLeaf.x - root.x, directLeaf.y - root.y);
  const branchDistance = Math.hypot(branchChild.x - root.x, branchChild.y - root.y);
  const grandchildBranchDistance = Math.hypot(grandchild.x - branchChild.x, grandchild.y - branchChild.y);
  const grandchildRootDistance = Math.hypot(grandchild.x - root.x, grandchild.y - root.y);

  assert.ok(directLeafDistance <= 160, `direct leaf should remain on root leaf orbit, got ${directLeafDistance}`);
  assert.ok(branchDistance >= 250, `child with descendants should become a visible branch hub, got ${branchDistance}`);
  assert.ok(branchDistance <= 340, `child with descendants should remain connected to root, got ${branchDistance}`);
  assert.ok(grandchildBranchDistance <= 160, `grandchild should orbit branch child, got ${grandchildBranchDistance}`);
  assert.ok(grandchildBranchDistance < grandchildRootDistance, 'grandchild should be closer to its branch parent than to root');
});

test('buildReferralGraphLayout keeps multi-level hub bridges near parents while extending outward', () => {
  const nodes = [
    makeNode('root'),
    makeNode('hub-a'),
    makeNode('hub-b'),
    ...Array.from({ length: 4 }, (_, index) => makeNode(`hub-a-leaf-${index}`)),
    ...Array.from({ length: 4 }, (_, index) => makeNode(`hub-b-leaf-${index}`)),
  ];
  const edges = [
    makeEdge('root', 'hub-a'),
    makeEdge('hub-a', 'hub-b'),
    ...Array.from({ length: 4 }, (_, index) => makeEdge('hub-a', `hub-a-leaf-${index}`)),
    ...Array.from({ length: 4 }, (_, index) => makeEdge('hub-b', `hub-b-leaf-${index}`)),
  ];

  const layout = buildReferralGraphLayout(nodes, edges);
  const root = layout.nodeAnchorPositions.get('root');
  const hubA = layout.nodeAnchorPositions.get('hub-a');
  const hubB = layout.nodeAnchorPositions.get('hub-b');
  assert.ok(root, 'missing root position');
  assert.ok(hubA, 'missing hub-a position');
  assert.ok(hubB, 'missing hub-b position');

  const rootToHubA = Math.hypot(hubA.x - root.x, hubA.y - root.y);
  const hubAToHubB = Math.hypot(hubB.x - hubA.x, hubB.y - hubA.y);
  const rootToHubB = Math.hypot(hubB.x - root.x, hubB.y - root.y);
  const turnAngle = angleDelta(angleBetween(root, hubA), angleBetween(hubA, hubB));

  assert.ok(rootToHubA >= 250 && rootToHubA <= 340, `root->hub-a bridge length should reserve branch space, got ${rootToHubA}`);
  assert.ok(hubAToHubB >= 185 && hubAToHubB <= 235, `hub-a->hub-b bridge length should reserve branch space, got ${hubAToHubB}`);
  assert.ok(turnAngle <= 0.55, `nested hubs should stay in the outward branch lane instead of circling, got ${turnAngle}`);
  assert.ok(rootToHubB > rootToHubA + 110, `nested hub should extend farther from root than its parent: ${rootToHubA} -> ${rootToHubB}`);
  assert.ok(hubAToHubB < rootToHubB, 'nested hub should stay closer to its direct parent than to the component root');
});

test('buildReferralGraphLayout expands deep branch hubs outward by layer instead of wrapping them around the parent', () => {
  const nodes = [
    makeNode('root'),
    makeNode('hub-a'),
    makeNode('hub-b'),
    makeNode('hub-c'),
    ...Array.from({ length: 3 }, (_, index) => makeNode(`hub-a-leaf-${index}`)),
    ...Array.from({ length: 3 }, (_, index) => makeNode(`hub-b-leaf-${index}`)),
    ...Array.from({ length: 3 }, (_, index) => makeNode(`hub-c-leaf-${index}`)),
  ];
  const edges = [
    makeEdge('root', 'hub-a'),
    makeEdge('hub-a', 'hub-b'),
    makeEdge('hub-b', 'hub-c'),
    ...Array.from({ length: 3 }, (_, index) => makeEdge('hub-a', `hub-a-leaf-${index}`)),
    ...Array.from({ length: 3 }, (_, index) => makeEdge('hub-b', `hub-b-leaf-${index}`)),
    ...Array.from({ length: 3 }, (_, index) => makeEdge('hub-c', `hub-c-leaf-${index}`)),
  ];

  const layout = buildReferralGraphLayout(nodes, edges);
  const root = layout.nodeAnchorPositions.get('root');
  const hubA = layout.nodeAnchorPositions.get('hub-a');
  const hubB = layout.nodeAnchorPositions.get('hub-b');
  const hubC = layout.nodeAnchorPositions.get('hub-c');
  assert.ok(root, 'missing root position');
  assert.ok(hubA, 'missing hub-a position');
  assert.ok(hubB, 'missing hub-b position');
  assert.ok(hubC, 'missing hub-c position');

  const rootToHubA = Math.hypot(hubA.x - root.x, hubA.y - root.y);
  const rootToHubB = Math.hypot(hubB.x - root.x, hubB.y - root.y);
  const rootToHubC = Math.hypot(hubC.x - root.x, hubC.y - root.y);
  const firstTurn = angleDelta(angleBetween(root, hubA), angleBetween(hubA, hubB));
  const secondTurn = angleDelta(angleBetween(hubA, hubB), angleBetween(hubB, hubC));

  assert.ok(rootToHubB > rootToHubA + 110, `second layer should extend outward: ${rootToHubA} -> ${rootToHubB}`);
  assert.ok(rootToHubC > rootToHubB + 110, `third layer should extend outward: ${rootToHubB} -> ${rootToHubC}`);
  assert.ok(firstTurn <= 0.55, `second layer should stay in the branch forward cone instead of circling, got ${firstTurn}`);
  assert.ok(secondTurn <= 0.55, `third layer should stay in the branch forward cone instead of circling, got ${secondTurn}`);
});

test('buildReferralGraphLayout keeps branch leaves as short side fans while hubs form the long branch', () => {
  const nodes = [
    makeNode('root'),
    makeNode('hub-a'),
    makeNode('hub-b'),
    ...Array.from({ length: 5 }, (_, index) => makeNode(`hub-a-leaf-${index}`)),
    makeNode('hub-b-leaf'),
  ];
  const edges = [
    makeEdge('root', 'hub-a'),
    makeEdge('hub-a', 'hub-b'),
    ...Array.from({ length: 5 }, (_, index) => makeEdge('hub-a', `hub-a-leaf-${index}`)),
    makeEdge('hub-b', 'hub-b-leaf'),
  ];

  const layout = buildReferralGraphLayout(nodes, edges);
  const hubA = layout.nodeAnchorPositions.get('hub-a');
  const hubB = layout.nodeAnchorPositions.get('hub-b');
  assert.ok(hubA, 'missing hub-a position');
  assert.ok(hubB, 'missing hub-b position');

  const branchLength = Math.hypot(hubB.x - hubA.x, hubB.y - hubA.y);
  const leafDistances = Array.from({ length: 5 }, (_, index) => {
    const leaf = layout.nodeAnchorPositions.get(`hub-a-leaf-${index}`);
    assert.ok(leaf, `missing leaf ${index}`);
    return Math.hypot(leaf.x - hubA.x, leaf.y - hubA.y);
  });

  assert.ok(branchLength >= 185, `child hub should form the long branch, got ${branchLength}`);
  assert.ok(Math.max(...leafDistances) <= branchLength * 0.72, `branch leaves should stay as short local fans: branch=${branchLength}, leaves=${leafDistances.join(',')}`);
});

test('buildReferralGraphLayout keeps the directed source root central even when child hubs have more leaves', () => {
  const nodes: GraphNode[] = [makeNode('root')];
  const edges: GraphEdge[] = [];

  for (let hubIndex = 0; hubIndex < 4; hubIndex += 1) {
    const hubId = `child-hub-${hubIndex}`;
    nodes.push(makeNode(hubId));
    edges.push(makeEdge('root', hubId));
    for (let leafIndex = 0; leafIndex < 10; leafIndex += 1) {
      const leafId = `${hubId}-leaf-${leafIndex}`;
      nodes.push(makeNode(leafId));
      edges.push(makeEdge(hubId, leafId));
    }
  }

  const layout = buildReferralGraphLayout(nodes, edges);
  const root = layout.nodeAnchorPositions.get('root');
  assert.ok(root, 'missing root position');
  assert.ok(Math.hypot(root.x, root.y) < 1, `directed source root should stay central, got ${JSON.stringify(root)}`);
});

test('buildReferralGraphLayout separates large connected pinwheel components', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const prefix of ['left', 'right']) {
    nodes.push(makeNode(`${prefix}-root`));
    for (let hubIndex = 0; hubIndex < 5; hubIndex += 1) {
      const hubId = `${prefix}-hub-${hubIndex}`;
      nodes.push(makeNode(hubId));
      edges.push(makeEdge(`${prefix}-root`, hubId));
      for (let leafIndex = 0; leafIndex < 8; leafIndex += 1) {
        const leafId = `${hubId}-leaf-${leafIndex}`;
        nodes.push(makeNode(leafId));
        edges.push(makeEdge(hubId, leafId));
      }
    }
  }

  const layout = buildReferralGraphLayout(nodes, edges);
  const leftRoot = layout.nodeAnchorPositions.get('left-root');
  const rightRoot = layout.nodeAnchorPositions.get('right-root');
  assert.ok(leftRoot, 'missing left root position');
  assert.ok(rightRoot, 'missing right root position');
  assert.ok(
    Math.hypot(leftRoot.x - rightRoot.x, leftRoot.y - rightRoot.y) > 560,
    `large pinwheel components should not start overlapped, got ${JSON.stringify({ leftRoot, rightRoot })}`,
  );
});

test('buildReferralGraphLayout exposes non-overlapping component envelopes', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const prefix of ['alpha', 'beta', 'gamma']) {
    nodes.push(makeNode(`${prefix}-root`));
    for (let hubIndex = 0; hubIndex < 4; hubIndex += 1) {
      const hubId = `${prefix}-hub-${hubIndex}`;
      nodes.push(makeNode(hubId));
      edges.push(makeEdge(`${prefix}-root`, hubId));
      for (let leafIndex = 0; leafIndex < 6; leafIndex += 1) {
        const leafId = `${hubId}-leaf-${leafIndex}`;
        nodes.push(makeNode(leafId));
        edges.push(makeEdge(hubId, leafId));
      }
    }
  }

  const layout = buildReferralGraphLayout(nodes, edges);
  const envelopes = [...layout.componentAnchors.entries()].map(([componentId, center]) => ({
    componentId,
    center,
    radius: layout.componentRadii.get(componentId) ?? 0,
  }));

  assert.equal(envelopes.length, 3);
  for (let left = 0; left < envelopes.length; left += 1) {
    for (let right = left + 1; right < envelopes.length; right += 1) {
      const leftEnvelope = envelopes[left];
      const rightEnvelope = envelopes[right];
      const distance = Math.hypot(
        leftEnvelope.center.x - rightEnvelope.center.x,
        leftEnvelope.center.y - rightEnvelope.center.y,
      );
      assert.ok(
        distance >= leftEnvelope.radius + rightEnvelope.radius + 32,
        `components should not overlap: ${JSON.stringify({ leftEnvelope, rightEnvelope, distance })}`,
      );
    }
  }
});

test('buildReferralGraphLayout gives stable random-like seeds for the same graph data', () => {
  const nodes = [
    makeNode('root'),
    makeNode('child-a'),
    makeNode('child-b'),
    makeNode('pair-a'),
    makeNode('pair-b'),
    makeNode('orphan'),
  ];
  const edges = [
    makeEdge('root', 'child-a'),
    makeEdge('root', 'child-b'),
    makeEdge('pair-a', 'pair-b'),
  ];

  const first = buildReferralGraphLayout(nodes, edges);
  const second = buildReferralGraphLayout([...nodes].reverse(), [...edges].reverse());

  for (const node of nodes) {
    assert.deepEqual(
      second.nodeAnchorPositions.get(node.id),
      first.nodeAnchorPositions.get(node.id),
      `seed drifted for ${node.id}`,
    );
  }
});
