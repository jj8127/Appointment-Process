import assert from 'node:assert/strict';
import test from 'node:test';
import { forceLink, forceManyBody, forceSimulation } from 'd3-force';

import { DEFAULT_REFERRAL_GRAPH_PHYSICS } from '../types/referral-graph.ts';
import type { GraphEdge, GraphNode } from '../types/referral-graph.ts';
import { buildReferralGraphLayout } from './referral-graph-layout.ts';
import {
  applyReferralGraphDragSpring,
  createReferralGraphBranchBendForce,
  createReferralGraphClusterGravityForce,
  createReferralGraphClusterSeparationForce,
  createReferralGraphComponentEnvelopeForce,
  createReferralGraphLayoutMemoryForce,
  createReferralGraphLinkTensionForce,
  createReferralGraphNodeSeparationForce,
  getReferralGraphLinkDistance,
  createReferralGraphSiblingAngularForce,
  resolveReferralGraphPhysics,
} from './referral-graph-physics.ts';

type SimNode = GraphNode & { x: number; y: number; vx?: number; vy?: number };
type SimLink = GraphEdge & { source: string | SimNode; target: string | SimNode };

function makeNode(id: string, isIsolated = false): GraphNode {
  return {
    id,
    name: id,
    phone: '',
    affiliation: '',
    activeCode: null,
    referralCount: 0,
    inboundCount: 0,
    nodeStatus: 'has_active_code',
    isIsolated,
    hasLegacyUnresolved: false,
    highlightType: null,
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

function getEndpointId(value: string | SimNode) {
  return typeof value === 'object' ? value.id : value;
}

function addPinwheelComponent(
  nodes: GraphNode[],
  edges: GraphEdge[],
  prefix: string,
  hubCount: number,
  leavesPerHub: number,
) {
  const rootId = `${prefix}-root`;
  nodes.push(makeNode(rootId));

  for (let hubIndex = 0; hubIndex < hubCount; hubIndex += 1) {
    const hubId = `${prefix}-hub-${hubIndex}`;
    nodes.push(makeNode(hubId));
    edges.push(makeEdge(rootId, hubId));

    for (let leafIndex = 0; leafIndex < leavesPerHub; leafIndex += 1) {
      const leafId = `${hubId}-leaf-${leafIndex}`;
      nodes.push(makeNode(leafId));
      edges.push(makeEdge(hubId, leafId));
    }
  }
}

function buildDegreeMaps(nodes: GraphNode[], edges: GraphEdge[]) {
  const degreeByNodeId = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const childCountByNodeId = new Map<string, number>(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    degreeByNodeId.set(edge.source, (degreeByNodeId.get(edge.source) ?? 0) + 1);
    degreeByNodeId.set(edge.target, (degreeByNodeId.get(edge.target) ?? 0) + 1);
    childCountByNodeId.set(edge.source, (childCountByNodeId.get(edge.source) ?? 0) + 1);
  }

  return { childCountByNodeId, degreeByNodeId };
}

function addReferralForces(
  simulation: ReturnType<typeof forceSimulation<SimNode>>,
  simLinks: SimLink[],
  layout: ReturnType<typeof buildReferralGraphLayout>,
  physics: ReturnType<typeof resolveReferralGraphPhysics>,
  maps: ReturnType<typeof buildDegreeMaps>,
  options: {
    activeDraggedNodeIdRef?: { current: string | null };
    suppressedNodeIdsRef?: { current: Set<string> };
  } = {},
) {
  const { childCountByNodeId, degreeByNodeId } = maps;
  const gravityNodeClusterIndex = new Map(layout.nodeComponentIndex);
  let nextGravityIndex = layout.componentRadii.size;
  for (const nodeId of layout.nodeClusterIndex.keys()) {
    if (gravityNodeClusterIndex.has(nodeId)) {
      continue;
    }
    gravityNodeClusterIndex.set(nodeId, nextGravityIndex);
    nextGravityIndex += 1;
  }

  simulation
    .force(
      'charge',
      forceManyBody<SimNode>()
        .strength(physics.chargeStrength)
        .distanceMin(physics.chargeDistanceMin)
        .distanceMax(physics.chargeDistanceMax),
    )
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.id)
        .distance((link) => {
          const source = getEndpointId(link.source);
          const target = getEndpointId(link.target);
          return getReferralGraphLinkDistance(
            degreeByNodeId.get(source) ?? 1,
            degreeByNodeId.get(target) ?? 1,
            physics.linkDistance,
            {
              sourceHasChildren: (childCountByNodeId.get(source) ?? 0) > 0,
              targetHasChildren: (childCountByNodeId.get(target) ?? 0) > 0,
            },
          );
        })
        .strength((link) => {
          const source = getEndpointId(link.source);
          const target = getEndpointId(link.target);
          const baseStrength = physics.linkStrength / Math.max(
            1,
            Math.min(degreeByNodeId.get(source) ?? 1, degreeByNodeId.get(target) ?? 1),
          );
          const activeDraggedNodeId = options.activeDraggedNodeIdRef?.current;
          if (!activeDraggedNodeId) {
            return baseStrength;
          }

          return source === activeDraggedNodeId || target === activeDraggedNodeId
            ? baseStrength
            : baseStrength * 0.03;
        })
        .iterations(4),
    )
    .force('node-separation', createReferralGraphNodeSeparationForce<SimNode>({
      activeDraggedNodeIdRef: options.activeDraggedNodeIdRef,
      crossClusterDistance: 126,
      crossComponentDistance: 146,
      maxVelocity: 18,
      minDistance: 50,
      nodeClusterIndex: layout.nodeClusterIndex,
      nodeComponentIndex: layout.nodeComponentIndex,
      strength: 0.24,
    }))
    .force('cluster-envelope', createReferralGraphComponentEnvelopeForce<SimNode>({
      activeDraggedNodeIdRef: options.activeDraggedNodeIdRef,
      componentRadii: layout.clusterRadii,
      maxVelocity: 14,
      nodeComponentIndex: layout.nodeClusterIndex,
      strength: 0.1,
    }))
    .force('visual-cluster-separation', createReferralGraphClusterSeparationForce<SimNode>({
      activeDraggedNodeIdRef: options.activeDraggedNodeIdRef,
      clusterRadii: layout.clusterRadii,
      gap: 52,
      maxVelocity: 10,
      nodeClusterIndex: layout.nodeClusterIndex,
      singletonGapFactor: 0.35,
      softening: 92,
      strength: 0.04,
    }))
    .force('component-separation', createReferralGraphClusterSeparationForce<SimNode>({
      activeDraggedNodeIdRef: options.activeDraggedNodeIdRef,
      clusterRadii: layout.componentRadii,
      gap: 92,
      maxVelocity: 16,
      nodeClusterIndex: layout.nodeComponentIndex,
      softening: 92,
      strength: 0.07,
    }))
    .force('cluster-gravity', createReferralGraphClusterGravityForce<SimNode>({
      activeDraggedNodeIdRef: options.activeDraggedNodeIdRef,
      deadZoneRadius: 340,
      gravityScale: 120,
      maxVelocity: 4.5,
      minAlpha: 0.002,
      nodeClusterIndex: gravityNodeClusterIndex,
      singletonDeadZoneRadius: 520,
      singletonStrengthFactor: 0.6,
      softening: 210,
      strength: 0.01,
    }))
    .force('component-envelope', createReferralGraphComponentEnvelopeForce<SimNode>({
      activeDraggedNodeIdRef: options.activeDraggedNodeIdRef,
      componentRadii: layout.componentRadii,
      maxVelocity: 16,
      nodeComponentIndex: layout.nodeComponentIndex,
      strength: 0.14,
    }))
    .force('branch-bend', createReferralGraphBranchBendForce<SimNode>({
      childCountByNodeId,
      degreeByNodeId,
      links: simLinks,
      maxVelocity: 16,
      strength: 0.28,
    }))
    .force('sibling-angular', createReferralGraphSiblingAngularForce<SimNode>({
      links: simLinks,
      maxVelocity: 14,
      strength: 0.34,
    }))
    .force('link-tension', createReferralGraphLinkTensionForce<SimNode>(
      simLinks,
      {
        activeDraggedNodeIdRef: options.activeDraggedNodeIdRef,
        baseLinkDistance: physics.linkDistance,
        childCountByNodeId,
        degreeByNodeId,
        maxVelocity: 32,
        strength: 0.64,
        thresholdMultiplier: 1,
      },
    ))
    .alphaDecay(physics.alphaDecay)
    .velocityDecay(physics.velocityDecay);

  return simulation;
}

function getClusterCenters(nodes: SimNode[], nodeClusterIndex: Map<string, number>) {
  const sums = new Map<number, { x: number; y: number; count: number }>();
  for (const node of nodes) {
    const clusterIndex = nodeClusterIndex.get(node.id);
    if (clusterIndex == null) continue;
    const sum = sums.get(clusterIndex) ?? { x: 0, y: 0, count: 0 };
    sum.x += node.x;
    sum.y += node.y;
    sum.count += 1;
    sums.set(clusterIndex, sum);
  }

  return new Map([...sums.entries()].map(([clusterIndex, sum]) => [
    clusterIndex,
    { x: sum.x / sum.count, y: sum.y / sum.count, count: sum.count },
  ]));
}

function angularGaps(parent: SimNode, children: SimNode[]) {
  const angles = children
    .map((child) => Math.atan2(child.y - parent.y, child.x - parent.x))
    .sort((left, right) => left - right);

  return angles.map((angle, index) => {
    const next = angles[(index + 1) % angles.length] + (index === angles.length - 1 ? Math.PI * 2 : 0);
    return next - angle;
  });
}

test('referral graph simulation keeps pinwheel clusters separated without global center collapse', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  addPinwheelComponent(nodes, edges, 'alpha', 6, 8);
  addPinwheelComponent(nodes, edges, 'beta', 4, 7);
  addPinwheelComponent(nodes, edges, 'gamma', 3, 5);
  for (let index = 0; index < 90; index += 1) {
    nodes.push(makeNode(`orphan-${index}`, true));
  }

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));

  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 420; index += 1) {
    simulation.tick();
  }

  const roots = ['alpha-root', 'beta-root', 'gamma-root'].map((id) => {
    const node = byId.get(id);
    assert.ok(node, `missing root ${id}`);
    return node;
  });
  const rootDistances: number[] = [];
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      rootDistances.push(Math.hypot(roots[left].x - roots[right].x, roots[left].y - roots[right].y));
    }
  }

  const edgeLengths = simLinks.map((link) => {
    const source = link.source as SimNode;
    const target = link.target as SimNode;
    return Math.hypot(source.x - target.x, source.y - target.y);
  });
  const orphanRadii = simNodes
    .filter((node) => node.isIsolated)
    .map((node) => Math.hypot(node.x, node.y))
    .sort((left, right) => left - right);
  const connectedRadii = simNodes
    .filter((node) => !node.isIsolated)
    .map((node) => Math.hypot(node.x, node.y))
    .sort((left, right) => left - right);

  assert.ok(Math.min(...rootDistances) >= 430, `cluster roots collapsed: ${rootDistances.join(',')}`);
  assert.ok(Math.max(...edgeLengths) <= 260, `edge stretched too far: ${Math.max(...edgeLengths)}`);
  assert.ok(
    orphanRadii[Math.floor(orphanRadii.length * 0.5)] > connectedRadii[Math.floor(connectedRadii.length * 0.75)],
    'most isolated nodes should remain outside the dense connected core without requiring an oversized ring',
  );
  assert.ok(
    orphanRadii[Math.floor(orphanRadii.length * 0.5)] <= 650,
    `isolated nodes should not form an oversized outer circle: p50=${orphanRadii[Math.floor(orphanRadii.length * 0.5)]}`,
  );
});

test('visual hub clusters remain closer to their own members than neighboring cluster members', () => {
  const nodes: GraphNode[] = [makeNode('root')];
  const edges: GraphEdge[] = [];
  for (let hubIndex = 0; hubIndex < 4; hubIndex += 1) {
    const hubId = `branch-hub-${hubIndex}`;
    nodes.push(makeNode(hubId));
    edges.push(makeEdge('root', hubId));
    for (let leafIndex = 0; leafIndex < 6; leafIndex += 1) {
      const leafId = `${hubId}-leaf-${leafIndex}`;
      nodes.push(makeNode(leafId));
      edges.push(makeEdge(hubId, leafId));
    }
  }

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 360; index += 1) {
    simulation.tick();
  }

  const centers = getClusterCenters(simNodes, layout.nodeClusterIndex);
  for (let hubIndex = 0; hubIndex < 4; hubIndex += 1) {
    const hubId = `branch-hub-${hubIndex}`;
    const ownCluster = layout.nodeClusterIndex.get(hubId);
    assert.notEqual(ownCluster, undefined, `missing cluster for ${hubId}`);
    const ownCenter = centers.get(ownCluster as number);
    assert.ok(ownCenter, `missing center for ${hubId}`);

    const ownLeafDistances = Array.from({ length: 6 }, (_, leafIndex) => {
      const leaf = byId.get(`${hubId}-leaf-${leafIndex}`);
      assert.ok(leaf, `missing leaf ${hubId}-${leafIndex}`);
      return Math.hypot(leaf.x - ownCenter.x, leaf.y - ownCenter.y);
    });
    const ownMax = Math.max(...ownLeafDistances);
    const nearestOtherLeaf = Math.min(
      ...simNodes
        .filter((node) => node.id.includes('-leaf-') && layout.nodeClusterIndex.get(node.id) !== ownCluster)
        .map((node) => Math.hypot(node.x - ownCenter.x, node.y - ownCenter.y)),
    );

    assert.ok(
      nearestOtherLeaf > ownMax + 28,
      `${hubId} cluster is visually ambiguous: nearest other=${nearestOtherLeaf}, own max=${ownMax}`,
    );
  }
});

test('drag spring moves incident neighbors without rigid component translation', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  addPinwheelComponent(nodes, edges, 'dragged', 5, 7);

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));

  const draggedRoot = byId.get('dragged-root');
  const directHub = byId.get('dragged-hub-0');
  const nestedLeaf = byId.get('dragged-hub-0-leaf-0');
  assert.ok(draggedRoot, 'missing dragged root');
  assert.ok(directHub, 'missing direct hub');
  assert.ok(nestedLeaf, 'missing nested leaf');
  const rootAnchor = layout.nodeAnchorPositions.get(draggedRoot.id);
  assert.ok(rootAnchor, 'missing dragged root anchor');
  const hubStart = { x: directHub.x, y: directHub.y };
  const leafStart = { x: nestedLeaf.x, y: nestedLeaf.y };
  draggedRoot.x = rootAnchor.x + 320;
  draggedRoot.y = rootAnchor.y + 180;
  draggedRoot.fx = draggedRoot.x;
  draggedRoot.fy = draggedRoot.y;

  const simulation = addReferralForces(
    forceSimulation(simNodes),
    simLinks,
    layout,
    physics,
    maps,
    { activeDraggedNodeIdRef: { current: draggedRoot.id } },
  )
    .stop();

  for (let index = 0; index < 80; index += 1) {
    applyReferralGraphDragSpring(draggedRoot, byId, simLinks, {
      baseLinkDistance: physics.linkDistance,
      childCountByNodeId: maps.childCountByNodeId,
      degreeByNodeId: maps.degreeByNodeId,
      maxVelocity: 46,
      strength: 0.48,
    });
    simulation.tick();
  }

  const hubDisplacement = Math.hypot(directHub.x - hubStart.x, directHub.y - hubStart.y);
  const leafDisplacement = Math.hypot(nestedLeaf.x - leafStart.x, nestedLeaf.y - leafStart.y);
  const displacementDelta = Math.hypot(
    (directHub.x - hubStart.x) - (nestedLeaf.x - leafStart.x),
    (directHub.y - hubStart.y) - (nestedLeaf.y - leafStart.y),
  );
  const incidentLengths = simLinks
    .filter((link) => getEndpointId(link.source) === draggedRoot.id || getEndpointId(link.target) === draggedRoot.id)
    .map((link) => {
      const source = link.source as SimNode;
      const target = link.target as SimNode;
      return Math.hypot(source.x - target.x, source.y - target.y);
    });

  assert.ok(hubDisplacement > 150, `direct neighbor should visibly follow the dragged root, got ${hubDisplacement}`);
  assert.ok(leafDisplacement > 80, `nested leaf should still react to the dragged component, got ${leafDisplacement}`);
  assert.ok(
    displacementDelta > 24,
    `hub and nested leaf should not share the same drag displacement vector: delta=${displacementDelta}, hub=${hubDisplacement}, leaf=${leafDisplacement}`,
  );
  assert.ok(Math.max(...incidentLengths) <= 270, `drag stretched incident links: ${incidentLengths.join(',')}`);
});

test('dragged components are not pulled back inward while the pointer is still dragging outward', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  addPinwheelComponent(nodes, edges, 'outward', 3, 4);

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const draggedRoot = byId.get('outward-root');
  const directHub = byId.get('outward-hub-0');
  assert.ok(draggedRoot && directHub, 'missing drag nodes');

  draggedRoot.x = 980;
  draggedRoot.y = 120;
  draggedRoot.fx = draggedRoot.x;
  draggedRoot.fy = draggedRoot.y;

  const simulation = addReferralForces(
    forceSimulation(simNodes),
    simLinks,
    layout,
    physics,
    maps,
    { activeDraggedNodeIdRef: { current: draggedRoot.id } },
  )
    .stop();

  for (let index = 0; index < 100; index += 1) {
    applyReferralGraphDragSpring(draggedRoot, byId, simLinks, {
      baseLinkDistance: physics.linkDistance,
      childCountByNodeId: maps.childCountByNodeId,
      degreeByNodeId: maps.degreeByNodeId,
      maxVelocity: 46,
      strength: 0.48,
    });
    simulation.tick();
  }

  const incidentLengths = simLinks
    .filter((link) => getEndpointId(link.source) === draggedRoot.id || getEndpointId(link.target) === draggedRoot.id)
    .map((link) => {
      const source = link.source as SimNode;
      const target = link.target as SimNode;
      return Math.hypot(source.x - target.x, source.y - target.y);
    });
  const hubRadius = Math.hypot(directHub.x, directHub.y);

  assert.ok(hubRadius > 690, `direct neighbor was pulled inward during outward drag: radius=${hubRadius}`);
  assert.ok(Math.max(...incidentLengths) <= 285, `outward drag stretched incident links: ${incidentLengths.join(',')}`);
});

test('link tension removes abnormal long edges after drag release', () => {
  const nodes = [
    makeNode('parent'),
    makeNode('child'),
    makeNode('sibling-a'),
    makeNode('sibling-b'),
    makeNode('sibling-c'),
  ];
  const edges = [
    makeEdge('parent', 'child'),
    makeEdge('parent', 'sibling-a'),
    makeEdge('parent', 'sibling-b'),
    makeEdge('parent', 'sibling-c'),
  ];
  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const child = byId.get('child');
  assert.ok(child, 'missing child');
  child.x -= 900;
  child.y -= 120;
  child.vx = 0;
  child.vy = 0;

  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 140; index += 1) {
    simulation.tick();
  }

  const parent = byId.get('parent');
  assert.ok(parent, 'missing parent');
  const releasedLength = Math.hypot(child.x - parent.x, child.y - parent.y);
  assert.ok(releasedLength <= 180, `released drag left an abnormal long edge: ${releasedLength}`);
});

test('released dragged nodes do not get pulled back to their initial layout anchor', () => {
  const nodes = [
    makeNode('parent'),
    makeNode('child'),
    makeNode('sibling-a'),
    makeNode('sibling-b'),
    makeNode('sibling-c'),
  ];
  const edges = [
    makeEdge('parent', 'child'),
    makeEdge('parent', 'sibling-a'),
    makeEdge('parent', 'sibling-b'),
    makeEdge('parent', 'sibling-c'),
  ];
  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const child = byId.get('child');
  assert.ok(child, 'missing child');
  const childAnchor = layout.nodeAnchorPositions.get('child');
  assert.ok(childAnchor, 'missing child anchor');
  const releasePosition = { x: childAnchor.x - 360, y: childAnchor.y - 80 };
  child.x = releasePosition.x;
  child.y = releasePosition.y;
  child.vx = 0;
  child.vy = 0;

  const manualNodeTargetsRef = {
    current: new Map<string, { x: number; y: number }>([
      ['child', releasePosition],
    ]),
  };
  const simulation = addReferralForces(
    forceSimulation(simNodes),
    simLinks,
    layout,
    physics,
    maps,
  )
    .force('layout-memory', createReferralGraphLayoutMemoryForce(
      layout.nodeAnchorPositions,
      physics.layoutMemoryStrength,
      {
        manualNodeTargetsRef,
        suppressedNodeIdsRef: { current: new Set(['parent', 'sibling-a', 'sibling-b', 'sibling-c']) },
      },
    ))
    .stop();

  for (let index = 0; index < 180; index += 1) {
    simulation.tick();
  }

  const distanceFromAnchor = Math.hypot(child.x - childAnchor.x, child.y - childAnchor.y);
  const distanceFromRelease = Math.hypot(child.x - releasePosition.x, child.y - releasePosition.y);

  assert.ok(distanceFromAnchor > 140, `released node snapped back to its initial anchor: ${distanceFromAnchor}`);
  assert.ok(distanceFromRelease < 260, `released node drifted too far from the user's drop area: ${distanceFromRelease}`);
});

test('dragging one node in a nested component does not leave deep incident links behind', () => {
  const nodes = [
    makeNode('root'),
    makeNode('hub-a'),
    makeNode('hub-b'),
    makeNode('leaf-a'),
    makeNode('leaf-b'),
    makeNode('leaf-c'),
    makeNode('leaf-d'),
  ];
  const edges = [
    makeEdge('root', 'hub-a'),
    makeEdge('hub-a', 'hub-b'),
    makeEdge('hub-a', 'leaf-a'),
    makeEdge('hub-a', 'leaf-b'),
    makeEdge('hub-b', 'leaf-c'),
    makeEdge('hub-b', 'leaf-d'),
  ];
  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const draggedRoot = byId.get('root');
  const deepHub = byId.get('hub-b');
  assert.ok(draggedRoot, 'missing root');
  assert.ok(deepHub, 'missing deep hub');
  const deepHubStart = { x: deepHub.x, y: deepHub.y };

  draggedRoot.x -= 620;
  draggedRoot.y += 180;
  draggedRoot.fx = draggedRoot.x;
  draggedRoot.fy = draggedRoot.y;

  const activeDraggedNodeIdRef = { current: draggedRoot.id };
  const simulation = addReferralForces(
    forceSimulation(simNodes),
    simLinks,
    layout,
    physics,
    maps,
    { activeDraggedNodeIdRef },
  )
    .stop();

  for (let index = 0; index < 120; index += 1) {
    applyReferralGraphDragSpring(draggedRoot, byId, simLinks, {
      baseLinkDistance: physics.linkDistance,
      childCountByNodeId: maps.childCountByNodeId,
      degreeByNodeId: maps.degreeByNodeId,
      maxVelocity: 48,
      strength: 0.48,
    });
    simulation.tick();
  }

  const edgeLengths = simLinks.map((link) => {
    const source = link.source as SimNode;
    const target = link.target as SimNode;
    return Math.hypot(source.x - target.x, source.y - target.y);
  });
  const deepHubDisplacement = Math.hypot(deepHub.x - deepHubStart.x, deepHub.y - deepHubStart.y);

  assert.ok(Math.max(...edgeLengths) <= 285, `nested drag left long edges: ${edgeLengths.join(',')}`);
  assert.ok(deepHubDisplacement > 100, `deep branch did not follow the dragged component, got ${deepHubDisplacement}`);
});

test('dragging a parent keeps nested child-link physics active instead of leaving grandchildren behind', () => {
  const nodes = [
    makeNode('root'),
    makeNode('branch-a'),
    makeNode('branch-b'),
    makeNode('leaf-a'),
    makeNode('leaf-b'),
    makeNode('leaf-c'),
    makeNode('leaf-d'),
  ];
  const edges = [
    makeEdge('root', 'branch-a'),
    makeEdge('branch-a', 'branch-b'),
    makeEdge('branch-a', 'leaf-a'),
    makeEdge('branch-a', 'leaf-b'),
    makeEdge('branch-b', 'leaf-c'),
    makeEdge('branch-b', 'leaf-d'),
  ];
  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const draggedRoot = byId.get('root');
  const branchA = byId.get('branch-a');
  const branchB = byId.get('branch-b');
  const leafD = byId.get('leaf-d');
  assert.ok(draggedRoot && branchA && branchB && leafD, 'missing nested drag nodes');
  const branchBStart = { x: branchB.x, y: branchB.y };
  const leafDStart = { x: leafD.x, y: leafD.y };

  draggedRoot.x += 650;
  draggedRoot.y -= 190;
  draggedRoot.fx = draggedRoot.x;
  draggedRoot.fy = draggedRoot.y;

  const activeDraggedNodeIdRef = { current: draggedRoot.id };
  const simulation = addReferralForces(
    forceSimulation(simNodes),
    simLinks,
    layout,
    physics,
    maps,
    { activeDraggedNodeIdRef },
  )
    .stop();

  for (let index = 0; index < 120; index += 1) {
    applyReferralGraphDragSpring(draggedRoot, byId, simLinks, {
      baseLinkDistance: physics.linkDistance,
      childCountByNodeId: maps.childCountByNodeId,
      degreeByNodeId: maps.degreeByNodeId,
      maxVelocity: 48,
      strength: 0.48,
    });
    simulation.tick();
  }

  const branchBDisplacement = Math.hypot(branchB.x - branchBStart.x, branchB.y - branchBStart.y);
  const leafDDisplacement = Math.hypot(leafD.x - leafDStart.x, leafD.y - leafDStart.y);
  const branchEdgeLength = Math.hypot(branchA.x - branchB.x, branchA.y - branchB.y);
  const leafEdgeLength = Math.hypot(branchB.x - leafD.x, branchB.y - leafD.y);

  assert.ok(branchBDisplacement > 130, `nested child hub barely followed active drag: ${branchBDisplacement}`);
  assert.ok(leafDDisplacement > 80, `grandchild barely followed active drag: ${leafDDisplacement}`);
  assert.ok(branchEdgeLength <= 180, `child-hub link stretched while dragging: ${branchEdgeLength}`);
  assert.ok(leafEdgeLength <= 120, `grandchild spoke stretched while dragging: ${leafEdgeLength}`);
});

test('realistic nested referral component stays readable instead of becoming a long chain', () => {
  const nodes = [
    'kim-root',
    'park-young',
    'moon-hub',
    'liang',
    'kim-sieun',
    'lee-jung',
    'jin',
    'kim-in-hub',
    'kim-injung',
    'kim-inyoung',
    'kim-youngjae',
    'kim-taesik',
    'ra-eunsuk',
    'nam-yangsun',
    'park-yeon',
  ].map((id) => makeNode(id));
  const edges = [
    makeEdge('kim-root', 'park-young'),
    makeEdge('kim-root', 'moon-hub'),
    makeEdge('park-young', 'park-yeon'),
    makeEdge('moon-hub', 'liang'),
    makeEdge('moon-hub', 'kim-sieun'),
    makeEdge('moon-hub', 'lee-jung'),
    makeEdge('moon-hub', 'jin'),
    makeEdge('moon-hub', 'kim-in-hub'),
    makeEdge('kim-in-hub', 'kim-injung'),
    makeEdge('kim-in-hub', 'kim-inyoung'),
    makeEdge('kim-in-hub', 'kim-youngjae'),
    makeEdge('kim-in-hub', 'kim-taesik'),
    makeEdge('kim-in-hub', 'ra-eunsuk'),
    makeEdge('kim-in-hub', 'nam-yangsun'),
  ];
  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 420; index += 1) {
    simulation.tick();
  }

  const edgeLengths = simLinks.map((link) => {
    const source = link.source as SimNode;
    const target = link.target as SimNode;
    return Math.hypot(source.x - target.x, source.y - target.y);
  });
  const xs = simNodes.map((node) => node.x);
  const ys = simNodes.map((node) => node.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const moon = byId.get('moon-hub');
  const kimIn = byId.get('kim-in-hub');
  assert.ok(moon, 'missing moon hub');
  assert.ok(kimIn, 'missing kim-in hub');
  const moonChildren = ['liang', 'kim-sieun', 'lee-jung', 'jin', 'kim-in-hub'].map((id) => byId.get(id) as SimNode);
  const kimInChildren = ['kim-injung', 'kim-inyoung', 'kim-youngjae', 'kim-taesik', 'ra-eunsuk', 'nam-yangsun']
    .map((id) => byId.get(id) as SimNode);

  assert.ok(Math.max(...edgeLengths) <= 275, `realistic component has abnormal long edge: ${edgeLengths.join(',')}`);
  assert.ok(Math.max(width / height, height / width) <= 2.4, `component degenerated into a long chain: ${width}x${height}`);
  assert.ok(Math.min(...angularGaps(moon, moonChildren)) > 0.34, 'moon hub children collapsed into the same visual side');
  assert.ok(Math.min(...angularGaps(kimIn, kimInChildren)) > 0.34, 'nested hub children collapsed into the same visual side');
});

test('reheated graph remains bounded instead of letting clusters drift outward forever', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  addPinwheelComponent(nodes, edges, 'alpha', 5, 7);
  addPinwheelComponent(nodes, edges, 'beta', 5, 7);
  addPinwheelComponent(nodes, edges, 'gamma', 4, 6);
  addPinwheelComponent(nodes, edges, 'delta', 4, 6);
  for (let index = 0; index < 70; index += 1) {
    nodes.push(makeNode(`orphan-${index}`, true));
  }

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let cycle = 0; cycle < 4; cycle += 1) {
    simulation.alpha(0.8);
    for (let index = 0; index < 320; index += 1) {
      simulation.tick();
    }
  }

  const connectedRadii = simNodes
    .filter((node) => !node.isIsolated)
    .map((node) => Math.hypot(node.x, node.y));
  const sortedConnectedRadii = [...connectedRadii].sort((left, right) => left - right);
  const p95Radius = sortedConnectedRadii[Math.floor(sortedConnectedRadii.length * 0.95)];

  assert.ok(p95Radius <= 1250, `connected clusters drifted too far from the graph center: p95=${p95Radius}`);
});

test('long referral chains contract into readable connected clusters instead of stretched columns', () => {
  const nodes: GraphNode[] = [makeNode('root')];
  const edges: GraphEdge[] = [];
  let previousHub = 'root';

  for (let hubIndex = 0; hubIndex < 9; hubIndex += 1) {
    const hubId = `chain-hub-${hubIndex}`;
    nodes.push(makeNode(hubId));
    edges.push(makeEdge(previousHub, hubId));
    previousHub = hubId;

    for (let leafIndex = 0; leafIndex < 3; leafIndex += 1) {
      const leafId = `${hubId}-leaf-${leafIndex}`;
      nodes.push(makeNode(leafId));
      edges.push(makeEdge(hubId, leafId));
    }
  }

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 640; index += 1) {
    simulation.tick();
  }

  const xs = simNodes.map((node) => node.x);
  const ys = simNodes.map((node) => node.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const root = simNodes.find((node) => node.id === 'root');
  assert.ok(root, 'missing root');
  const hubDistancesFromRoot = simNodes
    .filter((node) => node.id.startsWith('chain-hub-'))
    .map((node) => Math.hypot(node.x - root.x, node.y - root.y));

  assert.ok(Math.max(width / height, height / width) <= 2.2, `component stretched into a column: ${width}x${height}`);
  assert.ok(Math.max(...hubDistancesFromRoot) <= 760, `deep hubs drifted too far from their component root: ${hubDistancesFromRoot.join(',')}`);
});

test('simple path components do not settle as unreadable straight columns', () => {
  const nodes = Array.from({ length: 6 }, (_, index) => makeNode(`path-${index}`));
  const edges = Array.from({ length: 5 }, (_, index) => makeEdge(`path-${index}`, `path-${index + 1}`));

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 520; index += 1) {
    simulation.tick();
  }

  const xs = simNodes.map((node) => node.x);
  const ys = simNodes.map((node) => node.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  assert.ok(Math.max(width / height, height / width) <= 3, `path component became a long column: ${width}x${height}`);
  assert.ok(Math.max(width, height) <= 420, `path component spread too far from its own group: ${width}x${height}`);
});

test('isolated nodes stay outside connected referral clusters instead of mixing through the center', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  addPinwheelComponent(nodes, edges, 'core', 4, 5);
  for (let componentIndex = 0; componentIndex < 8; componentIndex += 1) {
    const parent = `small-${componentIndex}-parent`;
    nodes.push(makeNode(parent));
    for (let childIndex = 0; childIndex < 2; childIndex += 1) {
      const child = `small-${componentIndex}-child-${childIndex}`;
      nodes.push(makeNode(child));
      edges.push(makeEdge(parent, child));
    }
  }
  for (let index = 0; index < 85; index += 1) {
    nodes.push(makeNode(`isolated-${index}`, true));
  }

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 640; index += 1) {
    simulation.tick();
  }

  const connectedRadii = simNodes
    .filter((node) => !node.isIsolated)
    .map((node) => Math.hypot(node.x, node.y))
    .sort((left, right) => left - right);
  const isolatedRadii = simNodes
    .filter((node) => node.isIsolated)
    .map((node) => Math.hypot(node.x, node.y))
    .sort((left, right) => left - right);
  const connectedP95 = connectedRadii[Math.floor(connectedRadii.length * 0.95)];
  const isolatedP10 = isolatedRadii[Math.floor(isolatedRadii.length * 0.1)];
  const isolatedP50 = isolatedRadii[Math.floor(isolatedRadii.length * 0.5)];

  assert.ok(connectedP95 <= 640, `connected clusters drifted too wide: p95=${connectedP95}`);
  assert.ok(
    isolatedP10 >= connectedP95 + 20,
    `isolated nodes mixed into connected clusters: isolated p10=${isolatedP10}, connected p95=${connectedP95}`,
  );
  assert.ok(
    isolatedP50 <= 650,
    `isolated nodes formed an oversized outer circle: isolated p50=${isolatedP50}, connected p95=${connectedP95}`,
  );
});

test('three node referral chains keep a visible bend instead of collapsing into a straight line', () => {
  const nodes = [makeNode('root'), makeNode('middle'), makeNode('leaf')];
  const edges = [makeEdge('root', 'middle'), makeEdge('middle', 'leaf')];
  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 520; index += 1) {
    simulation.tick();
  }

  const root = byId.get('root');
  const middle = byId.get('middle');
  const leaf = byId.get('leaf');
  assert.ok(root && middle && leaf, 'missing path nodes');

  const rootVector = { x: root.x - middle.x, y: root.y - middle.y };
  const leafVector = { x: leaf.x - middle.x, y: leaf.y - middle.y };
  const cross = Math.abs((rootVector.x * leafVector.y) - (rootVector.y * leafVector.x));
  const rootDistance = Math.hypot(rootVector.x, rootVector.y);
  const leafDistance = Math.hypot(leafVector.x, leafVector.y);
  const normalizedArea = cross / Math.max(1, rootDistance * leafDistance);

  assert.ok(
    normalizedArea >= 0.35,
    `three-node path collapsed into a nearly straight line: normalized area=${normalizedArea}`,
  );
});

test('shallow branching referral chains do not render as a thin vertical strand', () => {
  const nodes = [
    makeNode('root'),
    makeNode('branch-leaf'),
    makeNode('chain-a'),
    makeNode('chain-b'),
    makeNode('chain-leaf'),
  ];
  const edges = [
    makeEdge('root', 'branch-leaf'),
    makeEdge('root', 'chain-a'),
    makeEdge('chain-a', 'chain-b'),
    makeEdge('chain-b', 'chain-leaf'),
  ];
  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 620; index += 1) {
    simulation.tick();
  }

  const xs = simNodes.map((node) => node.x);
  const ys = simNodes.map((node) => node.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  assert.ok(Math.max(width / height, height / width) <= 2.6, `branching chain became a strand: ${width}x${height}`);
  assert.ok(Math.min(width, height) >= 92, `branching chain is too narrow to read as a cluster: ${width}x${height}`);
});

test('unlucky real-data branching ids still bend into a readable cluster', () => {
  const nodes = [
    makeNode('3cebffbe-17da-4e96-9724-598c7396db49'),
    makeNode('c4a2e8d2-e841-4663-a551-9a84e4e627c1'),
    makeNode('ad670ed2-5457-447a-8f41-84fd3937f299'),
    makeNode('93367b33-9372-4fe4-8ae4-0eb8865c44c6'),
    makeNode('f4943c9b-32dd-48d3-8f16-07b5e33f5751'),
  ];
  const edges = [
    makeEdge('3cebffbe-17da-4e96-9724-598c7396db49', 'c4a2e8d2-e841-4663-a551-9a84e4e627c1'),
    makeEdge('c4a2e8d2-e841-4663-a551-9a84e4e627c1', 'ad670ed2-5457-447a-8f41-84fd3937f299'),
    makeEdge('ad670ed2-5457-447a-8f41-84fd3937f299', '93367b33-9372-4fe4-8ae4-0eb8865c44c6'),
    makeEdge('3cebffbe-17da-4e96-9724-598c7396db49', 'f4943c9b-32dd-48d3-8f16-07b5e33f5751'),
  ];
  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 620; index += 1) {
    simulation.tick();
  }

  const xs = simNodes.map((node) => node.x);
  const ys = simNodes.map((node) => node.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  assert.ok(Math.max(width / height, height / width) <= 2.7, `real ids became a strand: ${width}x${height}`);
  assert.ok(Math.min(width, height) >= 90, `real ids are too narrow to read as a cluster: ${width}x${height}`);
});

test('admin-sized mixed graph keeps connected clusters compact and isolated shell modest', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  addPinwheelComponent(nodes, edges, 'main', 6, 6);
  for (let componentIndex = 0; componentIndex < 18; componentIndex += 1) {
    const parent = `pair-${componentIndex}-parent`;
    nodes.push(makeNode(parent));
    const childCount = componentIndex % 3 === 0 ? 3 : 2;
    for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
      const child = `pair-${componentIndex}-child-${childIndex}`;
      nodes.push(makeNode(child));
      edges.push(makeEdge(parent, child));
    }
  }
  for (let index = 0; index < 70; index += 1) {
    nodes.push(makeNode(`outer-${index}`, true));
  }

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 720; index += 1) {
    simulation.tick();
  }

  const connectedRadii = simNodes
    .filter((node) => !node.isIsolated)
    .map((node) => Math.hypot(node.x, node.y))
    .sort((left, right) => left - right);
  const isolatedRadii = simNodes
    .filter((node) => node.isIsolated)
    .map((node) => Math.hypot(node.x, node.y))
    .sort((left, right) => left - right);
  const connectedP95 = connectedRadii[Math.floor(connectedRadii.length * 0.95)];
  const isolatedP50 = isolatedRadii[Math.floor(isolatedRadii.length * 0.5)];

  assert.ok(connectedP95 <= 680, `connected clusters formed an oversized spread: p95=${connectedP95}`);
  assert.ok(isolatedP50 <= 610, `isolated nodes formed an unnatural large outer circle: p50=${isolatedP50}`);
});

test('child hubs use shorter dynamic bridge lengths so nested clusters do not stretch', () => {
  const nodes = [
    makeNode('root'),
    makeNode('hub-a'),
    makeNode('hub-b'),
    makeNode('hub-c'),
    ...Array.from({ length: 5 }, (_, index) => makeNode(`a-leaf-${index}`)),
    ...Array.from({ length: 4 }, (_, index) => makeNode(`b-leaf-${index}`)),
    ...Array.from({ length: 3 }, (_, index) => makeNode(`c-leaf-${index}`)),
  ];
  const edges = [
    makeEdge('root', 'hub-a'),
    makeEdge('hub-a', 'hub-b'),
    makeEdge('hub-b', 'hub-c'),
    ...Array.from({ length: 5 }, (_, index) => makeEdge('hub-a', `a-leaf-${index}`)),
    ...Array.from({ length: 4 }, (_, index) => makeEdge('hub-b', `b-leaf-${index}`)),
    ...Array.from({ length: 3 }, (_, index) => makeEdge('hub-c', `c-leaf-${index}`)),
  ];

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 640; index += 1) {
    simulation.tick();
  }

  const bridgeLengths = simLinks
    .filter((link) => {
      const source = getEndpointId(link.source);
      const target = getEndpointId(link.target);
      return ['hub-a', 'hub-b', 'hub-c'].includes(source) && ['hub-a', 'hub-b', 'hub-c'].includes(target);
    })
    .map((link) => {
      const source = link.source as SimNode;
      const target = link.target as SimNode;
      return Math.hypot(source.x - target.x, source.y - target.y);
    });

  assert.ok(Math.max(...bridgeLengths) <= 180, `child-hub bridge stayed too long: ${bridgeLengths.join(',')}`);
});

test('cooled simulation becomes visually stable instead of drifting forever', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  addPinwheelComponent(nodes, edges, 'stable', 5, 5);
  for (let componentIndex = 0; componentIndex < 10; componentIndex += 1) {
    const parent = `stable-small-${componentIndex}`;
    nodes.push(makeNode(parent));
    for (let childIndex = 0; childIndex < 2; childIndex += 1) {
      const child = `${parent}-child-${childIndex}`;
      nodes.push(makeNode(child));
      edges.push(makeEdge(parent, child));
    }
  }
  for (let index = 0; index < 45; index += 1) {
    nodes.push(makeNode(`stable-outer-${index}`, true));
  }

  const physics = resolveReferralGraphPhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps)
    .stop();

  for (let index = 0; index < 720; index += 1) {
    simulation.tick();
  }

  const before = new Map(simNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  simulation.alpha(0.002);
  for (let index = 0; index < 160; index += 1) {
    simulation.tick();
  }

  const maxDrift = Math.max(...simNodes.map((node) => {
    const start = before.get(node.id);
    assert.ok(start, `missing start for ${node.id}`);
    return Math.hypot(node.x - start.x, node.y - start.y);
  }));

  assert.ok(maxDrift <= 3.5, `cooled graph kept moving after settling: max drift=${maxDrift}`);
});

test('default link distances stay readable after compacting cluster layout', () => {
  const baseDistance = DEFAULT_REFERRAL_GRAPH_PHYSICS.linkDistance;

  assert.ok(
    getReferralGraphLinkDistance(1, 8, baseDistance) >= 86,
    'leaf spokes should not become so short that labels collide',
  );
  assert.ok(
    getReferralGraphLinkDistance(4, 5, baseDistance, {
      sourceHasChildren: true,
      targetHasChildren: true,
    }) >= 145,
    'child-hub bridges should remain readable',
  );
});
