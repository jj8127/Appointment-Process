import assert from 'node:assert/strict';
import test from 'node:test';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';

import { DEFAULT_REFERRAL_GRAPH_PHYSICS } from '../types/referral-graph.ts';
import type { GraphEdge, GraphNode } from '../types/referral-graph.ts';
import { buildReferralGraphLayout } from './referral-graph-layout.ts';
import {
  createReferralGraphClusterSeparationForce,
  createReferralGraphDragLocalityForce,
  createReferralGraphLinkTensionForce,
  getReferralGraphFreeLinkStrength,
  getReferralGraphLinkDistance,
  resolveReferralGraphFreePhysics,
} from './referral-graph-physics.ts';
import { buildReferralGraphAdjacency, getReferralGraphLocalDragDepths } from './referral-graph-interaction.ts';

type SimNode = GraphNode & {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
};
type SimLink = GraphEdge & { source: string | SimNode; target: string | SimNode };

function makeNode(id: string): GraphNode {
  return {
    id,
    name: id,
    phone: '',
    affiliation: '',
    activeCode: null,
    referralCount: 0,
    inboundCount: 0,
    nodeStatus: 'has_active_code',
    isIsolated: false,
    signupCompleted: true,
    allCommissionsCompleted: false,
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

function createRuntimeGraph(nodes: GraphNode[], edges: GraphEdge[]) {
  const physics = resolveReferralGraphFreePhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(nodes, edges);
  const simNodes = nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges.map<SimLink>((edge) => ({ ...edge }));

  return { byId, layout, maps, physics, simLinks, simNodes };
}

function addFreeReferralForces(
  simulation: ReturnType<typeof forceSimulation<SimNode>>,
  simLinks: SimLink[],
  layout: ReturnType<typeof buildReferralGraphLayout>,
  physics: ReturnType<typeof resolveReferralGraphFreePhysics>,
  maps: ReturnType<typeof buildDegreeMaps>,
  activeDraggedNodeIdRef: { current: string | null } = { current: null },
  activeNodeDepthsRef: { current: Map<string, number> } = { current: new Map() },
) {
  const { childCountByNodeId, degreeByNodeId } = maps;

  return simulation
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
              graphNodeCount: layout.nodeAnchorPositions.size,
              sourceChildCount: childCountByNodeId.get(source) ?? 0,
              sourceHasChildren: (childCountByNodeId.get(source) ?? 0) > 0,
              sourceId: source,
              sourceSubtreeSize: layout.directedSubtreeSizes.get(source) ?? 1,
              targetChildCount: childCountByNodeId.get(target) ?? 0,
              targetHasChildren: (childCountByNodeId.get(target) ?? 0) > 0,
              targetId: target,
              targetSubtreeSize: layout.directedSubtreeSizes.get(target) ?? 1,
            },
          );
        })
        .strength((link) => {
          const source = getEndpointId(link.source);
          const target = getEndpointId(link.target);
          return getReferralGraphFreeLinkStrength(
            degreeByNodeId.get(source) ?? 1,
            degreeByNodeId.get(target) ?? 1,
            physics.linkStrength,
          );
        })
        .iterations(2),
    )
    .force('x', forceX<SimNode>(0).strength(physics.centerStrength))
    .force('y', forceY<SimNode>(0).strength(physics.centerStrength))
    .force('link-tension', createReferralGraphLinkTensionForce<SimNode>(
      simLinks,
      {
        activeDraggedNodeIdRef,
        baseLinkDistance: physics.linkDistance,
        childCountByNodeId,
        degreeByNodeId,
        graphNodeCount: layout.nodeAnchorPositions.size,
        maxVelocity: 18,
        strength: physics.linkTensionStrength,
        subtreeSizeByNodeId: layout.directedSubtreeSizes,
        thresholdMultiplier: physics.linkTensionThresholdMultiplier,
      },
    ))
    .force(
      'collision',
      forceCollide<SimNode>()
        .radius(48)
        .strength(physics.collisionStrength)
        .iterations(physics.collisionIterations),
    )
    .force('component-separation', createReferralGraphClusterSeparationForce<SimNode>({
      activeDraggedNodeIdRef,
      clusterRadii: layout.componentRadii,
      gap: physics.componentSeparationGap,
      maxVelocity: 8,
      nodeClusterIndex: layout.nodeComponentIndex,
      singletonGapFactor: 0.5,
      softening: 160,
      strength: physics.componentSeparationStrength,
    }))
    .force('drag-locality', createReferralGraphDragLocalityForce<SimNode>(
      activeDraggedNodeIdRef,
      activeNodeDepthsRef,
    ))
    .alphaDecay(physics.alphaDecay)
    .velocityDecay(physics.velocityDecay);
}

function dragOnlySelectedNode(node: SimNode, translate: { x: number; y: number }) {
  node.x += translate.x;
  node.y += translate.y;
  node.fx = node.x;
  node.fy = node.y;
  node.vx = 0;
  node.vy = 0;
}

function distance(left: SimNode, right: SimNode) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function displacement(node: SimNode, start: { x: number; y: number }) {
  return Math.hypot(node.x - start.x, node.y - start.y);
}

function minimumPairDistance(nodes: SimNode[]) {
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      minimumDistance = Math.min(minimumDistance, distance(nodes[left], nodes[right]));
    }
  }
  return minimumDistance;
}

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

  assert.ok(kineticEnergy(simNodes) <= 1.2, `cooled graph still has too much kinetic energy: ${kineticEnergy(simNodes)}`);
  assert.ok(maxNodeDrift(simNodes, before) <= 3.5, `cooled graph kept drifting: ${maxNodeDrift(simNodes, before)}`);
  assert.ok(minimumPairDistance(simNodes) >= 56, `settled graph has overlapping nodes: ${minimumPairDistance(simNodes)}`);
  assert.ok(maxLinkDistance(simLinks) <= 430, `settled graph has an overstretched link: ${maxLinkDistance(simLinks)}`);
});

test('free referral graph drag moves only the pointer node directly while neighbors react through live springs', () => {
  const nodes = [
    makeNode('root'),
    makeNode('branch-a'),
    makeNode('branch-b'),
    makeNode('leaf-a'),
    makeNode('leaf-b'),
    makeNode('leaf-c'),
  ];
  const edges = [
    makeEdge('root', 'branch-a'),
    makeEdge('branch-a', 'branch-b'),
    makeEdge('branch-a', 'leaf-a'),
    makeEdge('branch-a', 'leaf-b'),
    makeEdge('branch-b', 'leaf-c'),
  ];
  const { byId, layout, maps, physics, simLinks, simNodes } = createRuntimeGraph(nodes, edges);
  const root = byId.get('root');
  const branchA = byId.get('branch-a');
  const branchB = byId.get('branch-b');
  const leafC = byId.get('leaf-c');
  assert.ok(root && branchA && branchB && leafC, 'missing simulation nodes');

  const branchAStart = { x: branchA.x, y: branchA.y };
  const branchBStart = { x: branchB.x, y: branchB.y };
  const leafCStart = { x: leafC.x, y: leafC.y };
  const rootTarget = { x: root.x + 520, y: root.y - 160 };
  dragOnlySelectedNode(root, { x: 520, y: -160 });
  const activeDepthsRef = {
    current: getReferralGraphLocalDragDepths(root.id, buildReferralGraphAdjacency(edges), 2),
  };

  const simulation = addFreeReferralForces(
    forceSimulation(simNodes),
    simLinks,
    layout,
    physics,
    maps,
    { current: root.id },
    activeDepthsRef,
  )
    .alpha(physics.dragReheatAlpha)
    .stop();

  for (let index = 0; index < 96; index += 1) {
    simulation.tick();
  }

  assert.equal(root.x, rootTarget.x);
  assert.equal(root.y, rootTarget.y);
  assert.equal(branchA.fx, undefined);
  assert.equal(branchB.fx, undefined);
  assert.equal(leafC.fx, undefined);
  const pointerDistance = Math.hypot(520, -160);
  assert.ok(displacement(branchA, branchAStart) >= pointerDistance * 0.16, `direct neighbor barely reacted: ${displacement(branchA, branchAStart)}`);
  assert.ok(displacement(branchA, branchAStart) <= pointerDistance * 0.42, `direct neighbor overreacted: ${displacement(branchA, branchAStart)}`);
  assert.ok(displacement(branchB, branchBStart) > 20, `nested hub barely reacted: ${displacement(branchB, branchBStart)}`);
  assert.ok(displacement(branchB, branchBStart) < pointerDistance * 0.16, `nested hub moved too much: ${displacement(branchB, branchBStart)}`);
  assert.ok(displacement(leafC, leafCStart) <= 8, `third-hop leaf should barely move: ${displacement(leafC, leafCStart)}`);
  assert.ok(
    displacement(leafC, leafCStart) < displacement(branchA, branchAStart),
    `deep node moved like a rigid follower: leaf=${displacement(leafC, leafCStart)}, direct=${displacement(branchA, branchAStart)}`,
  );
  assert.ok(distance(root, branchA) <= 390, `root spring stretched too far: ${distance(root, branchA)}`);
  assert.ok(distance(branchA, branchB) <= 330, `nested spring stretched too far: ${distance(branchA, branchB)}`);
});

test('free referral graph high-degree hub drag stays local instead of pulling the whole organization into a spike', () => {
  const directChildren = Array.from({ length: 14 }, (_, index) => `direct-${index}`);
  const secondHopChildren = directChildren.map((nodeId) => `${nodeId}-leaf`);
  const nodes = [
    makeNode('root'),
    ...directChildren.map(makeNode),
    ...secondHopChildren.map(makeNode),
    makeNode('other-component'),
    makeNode('other-leaf'),
  ];
  const edges = [
    ...directChildren.map((nodeId) => makeEdge('root', nodeId)),
    ...directChildren.map((nodeId) => makeEdge(nodeId, `${nodeId}-leaf`)),
    makeEdge('other-component', 'other-leaf'),
  ];
  const { byId, layout, maps, physics, simLinks, simNodes } = createRuntimeGraph(nodes, edges);
  const root = byId.get('root');
  const unrelated = byId.get('other-component');
  assert.ok(root && unrelated, 'missing simulation nodes');

  const starts = new Map(simNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  const dragDistance = 260;
  dragOnlySelectedNode(root, { x: dragDistance, y: 0 });
  const activeDepthsRef = {
    current: getReferralGraphLocalDragDepths(root.id, buildReferralGraphAdjacency(edges), 2),
  };
  const simulation = addFreeReferralForces(
    forceSimulation(simNodes),
    simLinks,
    layout,
    physics,
    maps,
    { current: root.id },
    activeDepthsRef,
  )
    .alpha(physics.dragReheatAlpha)
    .stop();

  for (let index = 0; index < 36; index += 1) {
    simulation.tick();
  }

  const directDisplacements = directChildren.map((nodeId) => displacement(byId.get(nodeId) as SimNode, starts.get(nodeId) as { x: number; y: number }));
  const secondHopDisplacements = secondHopChildren.map((nodeId) => displacement(byId.get(nodeId) as SimNode, starts.get(nodeId) as { x: number; y: number }));
  const maxDirectDisplacement = Math.max(...directDisplacements);
  const maxSecondHopDisplacement = Math.max(...secondHopDisplacements);
  const maxUnrelatedDisplacement = Math.max(
    displacement(byId.get('other-component') as SimNode, starts.get('other-component') as { x: number; y: number }),
    displacement(byId.get('other-leaf') as SimNode, starts.get('other-leaf') as { x: number; y: number }),
  );

  assert.ok(maxDirectDisplacement >= dragDistance * 0.16, `direct neighbors barely reacted: ${maxDirectDisplacement}`);
  assert.ok(maxDirectDisplacement <= dragDistance * 0.42, `direct neighbors overreacted into a spike: ${maxDirectDisplacement}`);
  assert.ok(maxSecondHopDisplacement <= dragDistance * 0.2, `second-hop nodes moved too much: ${maxSecondHopDisplacement}`);
  assert.ok(maxUnrelatedDisplacement <= 10, `unrelated component moved during local drag: ${maxUnrelatedDisplacement}`);
});

test('free referral graph collision stays active during drag so reacted nodes do not collapse', () => {
  const nodes = [
    makeNode('center'),
    makeNode('left'),
    makeNode('right'),
    makeNode('top'),
    makeNode('bottom'),
    makeNode('tail'),
  ];
  const edges = [
    makeEdge('center', 'left'),
    makeEdge('center', 'right'),
    makeEdge('center', 'top'),
    makeEdge('center', 'bottom'),
    makeEdge('bottom', 'tail'),
  ];
  const { byId, layout, maps, physics, simLinks, simNodes } = createRuntimeGraph(nodes, edges);
  const center = byId.get('center');
  assert.ok(center, 'missing center node');

  dragOnlySelectedNode(center, { x: 340, y: 120 });
  const activeDepthsRef = {
    current: getReferralGraphLocalDragDepths(center.id, buildReferralGraphAdjacency(edges), 2),
  };
  const simulation = addFreeReferralForces(
    forceSimulation(simNodes),
    simLinks,
    layout,
    physics,
    maps,
    { current: center.id },
    activeDepthsRef,
  )
    .alpha(physics.dragReheatAlpha)
    .stop();

  for (let index = 0; index < 120; index += 1) {
    simulation.tick();
  }

  assert.ok(minimumPairDistance(simNodes) >= 58, `drag collision collapsed nodes: ${minimumPairDistance(simNodes)}`);
  assert.ok(simNodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
});
