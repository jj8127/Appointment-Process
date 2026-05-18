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
      assert.ok(distance >= 60 && distance <= 105, `child ${id} should sit on hub orbit, got ${distance}`);
      return Math.atan2(position.y - hubPosition.y, position.x - hubPosition.x);
    })
    .sort((left, right) => left - right);

  const gaps = childAngles.map((angle, index) => {
    const next = childAngles[(index + 1) % childAngles.length] + (index === childAngles.length - 1 ? Math.PI * 2 : 0);
    return next - angle;
  });
  assert.ok(Math.min(...gaps) > 0.45, `hub children should not collapse into one side, gaps=${gaps.join(',')}`);
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
    assert.ok(satelliteDistance <= 155, `satellite hub ${satelliteId} should not create an abnormal long edge, got ${satelliteDistance}`);
  }
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
  assert.ok(branchDistance >= 65, `child with descendants should become a branch hub, got ${branchDistance}`);
  assert.ok(branchDistance <= 105, `child with descendants should not create an abnormal long edge, got ${branchDistance}`);
  assert.ok(grandchildBranchDistance <= 160, `grandchild should orbit branch child, got ${grandchildBranchDistance}`);
  assert.ok(grandchildBranchDistance < grandchildRootDistance, 'grandchild should be closer to its branch parent than to root');
});

test('buildReferralGraphLayout keeps multi-level hub bridges near their parent hubs', () => {
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

  assert.ok(rootToHubA >= 65 && rootToHubA <= 105, `root->hub-a bridge length should be compact, got ${rootToHubA}`);
  assert.ok(hubAToHubB >= 145 && hubAToHubB <= 175, `hub-a->hub-b bridge length should be compact, got ${hubAToHubB}`);
  assert.ok(turnAngle >= 0.55, `nested hubs should bend instead of forming a straight chain, got ${turnAngle}`);
  assert.ok(hubAToHubB < rootToHubB, 'nested hub should stay closer to its direct parent than to the component root');
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
