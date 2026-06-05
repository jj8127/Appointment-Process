import type { GraphEdge, GraphNode } from '../types/referral-graph.ts';

export type GraphLayoutPoint = {
  x: number;
  y: number;
};

export type ReferralGraphComponentLayout = {
  componentAnchors: Map<number, GraphLayoutPoint>;
  componentRadii: Map<number, number>;
  componentSizes: Map<number, number>;
  clusterAnchors: Map<number, GraphLayoutPoint>;
  clusterRadii: Map<number, number>;
  directedChildCounts: Map<string, number>;
  directedSubtreeSizes: Map<string, number>;
  nodeComponentIndex: Map<string, number>;
  nodeClusterIndex: Map<string, number>;
  nodeAnchorPositions: Map<string, GraphLayoutPoint>;
  nodeOrderInComponent: Map<string, number>;
};

const OUTER_ORPHAN_RING_RADIUS = 360;
const SIMPLE_COMPONENT_RADIUS = 68;
const DEFAULT_LAYOUT_LINK_DISTANCE = 250;
const COMPONENT_GAP = 32;
const REFERRAL_GRAPH_MIN_NODE_DISTANCE = 112;
type LinkDistanceResolver = (
  sourceDegree: number,
  targetDegree: number,
  baseDistance: number,
  options?: ReferralGraphLinkDistanceOptions,
) => number;

type ReferralGraphLinkDistanceOptions = {
  sourceId?: string;
  sourceHasChildren?: boolean;
  targetId?: string;
  targetHasChildren?: boolean;
  sourceChildCount?: number;
  targetChildCount?: number;
  sourceSubtreeSize?: number;
  targetSubtreeSize?: number;
  graphNodeCount?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getReferralGraphMinimumNodeDistance(graphNodeCount = 0) {
  return Math.round(REFERRAL_GRAPH_MIN_NODE_DISTANCE + clamp((Math.max(0, graphNodeCount) - 90) * 0.14, 0, 28));
}

const defaultLinkDistanceResolver: LinkDistanceResolver = (
  sourceDegree,
  targetDegree,
  baseDistance,
  options = {},
) => {
  const minDegree = Math.min(sourceDegree, targetDegree);
  const maxDegree = Math.max(sourceDegree, targetDegree);
  const clampedBase = clamp(baseDistance, 30, 500);
  const isBranchBridge = Boolean(options.targetHasChildren);
  const isLeafSpoke = Boolean(options.sourceHasChildren && !options.targetHasChildren);
  const sourceChildCount = Math.max(0, options.sourceChildCount ?? 0);
  const targetChildCount = Math.max(0, options.targetChildCount ?? 0);
  const maxChildCount = Math.max(sourceChildCount, targetChildCount);
  const localBranchChildCount = isBranchBridge ? targetChildCount : maxChildCount;
  const sourceSubtreeSize = Math.max(1, options.sourceSubtreeSize ?? 1);
  const targetSubtreeSize = Math.max(1, options.targetSubtreeSize ?? 1);
  const maxSubtreeSize = Math.max(sourceSubtreeSize, targetSubtreeSize);
  const localBranchSubtreeSize = isBranchBridge ? targetSubtreeSize : maxSubtreeSize;
  const graphNodeCount = Math.max(0, options.graphNodeCount ?? 0);
  const minimumNodeDistance = getReferralGraphMinimumNodeDistance(graphNodeCount);
  const densityBonus = graphNodeCount > 90 ? clamp((graphNodeCount - 90) * 0.22, 0, 48) : 0;
  let resolvedDistance: number;

  if (isBranchBridge) {
    const branchBridgeJitter = getBranchBridgeDistanceJitter(options);
    resolvedDistance = clamp(
      225
        + (Math.sqrt(localBranchSubtreeSize) * 8)
        + (localBranchChildCount * 6)
        + (densityBonus * 0.42)
        + branchBridgeJitter,
      220,
      380,
    );
  } else if (isLeafSpoke || (minDegree <= 1 && maxDegree >= 3)) {
    const terminalLeafJitter = isLeafSpoke ? getTerminalLeafDistanceJitter(options) : 0;
    const crowdedLeafDistance = isLeafSpoke && sourceChildCount >= 8
      ? 132 + (sourceChildCount * 7) + (Math.sqrt(Math.max(1, graphNodeCount)) * 2.4)
      : 0;
    resolvedDistance = clamp(
      Math.max(
        clampedBase * 0.36,
        125 + (Math.sqrt(maxChildCount) * 8) + (densityBonus * 0.15) + terminalLeafJitter,
        crowdedLeafDistance + terminalLeafJitter,
      ),
      118,
      285,
    );
  } else if (minDegree <= 2 && maxDegree >= 3) {
    resolvedDistance = clamp(clampedBase * 0.44, 92, 135);
  } else if (minDegree >= 3 && maxDegree >= 3) {
    resolvedDistance = clamp(clampedBase * 0.82, 155, 245);
  } else {
    resolvedDistance = clampedBase;
  }

  if (isBranchBridge && sourceChildCount >= 8 && localBranchChildCount < 5) {
    const sourceFanoutBridgeDistance = 230 + (Math.sqrt(sourceChildCount) * 12) + (densityBonus * 0.48);
    resolvedDistance = Math.max(resolvedDistance, clamp(sourceFanoutBridgeDistance, 290, 340));
  }

  if (isBranchBridge && localBranchChildCount >= 6) {
    const labelSlotWidth = 84;
    const fanoutDistance = ((localBranchChildCount * labelSlotWidth) / (Math.PI * 2)) + 72 + densityBonus;
    const fanoutArc = Math.PI * 1.25;
    const spacingDistance = ((localBranchChildCount * minimumNodeDistance * 1.14) / fanoutArc)
      + 72
      + (densityBonus * 0.68);
    resolvedDistance = Math.max(
      resolvedDistance,
      clamp(Math.max(fanoutDistance, spacingDistance), 300, 360),
    );
  }

  if (isBranchBridge && localBranchSubtreeSize >= 5 && localBranchChildCount >= 4) {
    const subtreeDistance = localBranchChildCount >= 6
      ? 184
        + (Math.sqrt(localBranchSubtreeSize) * 19)
        + (localBranchChildCount * 7)
        + (densityBonus * 0.7)
      : 158
        + (Math.sqrt(localBranchSubtreeSize) * 13)
        + (localBranchChildCount * 6)
        + (densityBonus * 0.36);
    resolvedDistance = Math.max(resolvedDistance, clamp(subtreeDistance, 205, 350));
  }

  return Math.round(resolvedDistance);
};

function normalizeAngle(angle: number) {
  const fullCircle = Math.PI * 2;
  return ((angle % fullCircle) + fullCircle) % fullCircle;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomUnitFromHash(seed: number) {
  return seed / 0xffffffff;
}

function getTerminalLeafDistanceJitter(options: ReferralGraphLinkDistanceOptions) {
  if (!options.sourceId || !options.targetId) {
    return 0;
  }

  return Math.round(randomUnitFromHash(hashString(`${options.sourceId}->${options.targetId}:terminal-leaf-distance`)) * 34);
}

function getBranchBridgeDistanceJitter(options: ReferralGraphLinkDistanceOptions) {
  if (!options.sourceId || !options.targetId) {
    return 0;
  }

  return Math.round(randomUnitFromHash(hashString(`${options.sourceId}->${options.targetId}:branch-bridge-distance`)) * 54);
}

function getEdgeEndpoint(value: GraphEdge['source'] | GraphEdge['target']) {
  return typeof value === 'object' ? (value as GraphNode).id : value;
}

function compareIds(left: string, right: string) {
  return left.localeCompare(right);
}

function getStableAngle(id: string) {
  return randomUnitFromHash(hashString(`${id}:angle`)) * Math.PI * 2;
}

function getLayeredBranchAngleOffset(nodeId: string, index: number, siblingCount: number, sectorArc: number) {
  if (siblingCount <= 1) {
    return (randomUnitFromHash(hashString(`${nodeId}:layered-branch-angle`)) - 0.5) * Math.min(0.24, sectorArc * 0.28);
  }

  const slot = sectorArc / Math.max(1, siblingCount - 1);
  const centeredIndex = index - ((siblingCount - 1) / 2);
  const jitter = (randomUnitFromHash(hashString(`${nodeId}:layered-branch-angle`)) - 0.5) * Math.min(0.16, slot * 0.18);
  return (centeredIndex * slot) + jitter;
}

function getBranchLeafFanRadius(baseRadius: number, siblingCount: number) {
  if (siblingCount <= 0) {
    return baseRadius;
  }

  return clamp(baseRadius * 0.58, 88, siblingCount >= 6 ? 124 : 116);
}

function getSiblingRadialOffset(nodeId: string, index: number, siblingCount: number, isBranchSideFan = false) {
  if (siblingCount < 5) {
    return (randomUnitFromHash(hashString(`${nodeId}:child-r`)) - 0.5) * 18;
  }

  const ringStep = isBranchSideFan
    ? siblingCount >= 8 ? 63 : 46
    : siblingCount >= 16 ? 34 : siblingCount >= 8 ? 30 : 26;
  const ringCount = isBranchSideFan
    ? siblingCount >= 8 ? 3 : 2
    : siblingCount >= 16 ? 4 : siblingCount >= 12 ? 3 : 2;
  const branchRingOrder = ringCount >= 4
    ? [0, 2, 1, 3]
    : ringCount === 3
      ? [0, 2, 1]
      : [0, 1];
  const ringIndex = isBranchSideFan
    ? branchRingOrder[index % branchRingOrder.length] ?? 0
    : index % ringCount;
  const hashJitter = (randomUnitFromHash(hashString(`${nodeId}:child-r`)) - 0.5) * 12;
  if (isBranchSideFan) {
    return (ringIndex * ringStep) + hashJitter;
  }

  const centeredRing = ringIndex - ((ringCount - 1) / 2);
  return (centeredRing * ringStep) + hashJitter;
}

function getLeafFanoutArc(childCount: number, hasIncomingBranch: boolean, reserveChildHubSector: boolean) {
  if (childCount <= 1) {
    return Math.PI * 0.2;
  }

  if (hasIncomingBranch) {
    const base = reserveChildHubSector ? 1.05 : 1.18;
    const perChild = reserveChildHubSector ? 0.18 : 0.22;
    return clamp(base + (childCount * perChild), Math.PI * 0.36, reserveChildHubSector ? Math.PI * 0.78 : Math.PI * 0.9);
  }

  return clamp(1.16 + (childCount * 0.18), Math.PI * 0.38, Math.PI * 0.92);
}

function getBranchHubRadialOffset(
  nodeId: string,
  index: number,
  siblingHubCount: number,
  childCount: number,
  subtreeSize: number,
) {
  if (siblingHubCount < 4) {
    return 0;
  }

  const ringCount = siblingHubCount >= 10 ? 3 : 2;
  const ringIndex = index % ringCount;
  const centeredRing = ringIndex - ((ringCount - 1) / 2);
  const ringStep = siblingHubCount >= 10 ? 42 : 34;
  const childWeightOffset = clamp((Math.sqrt(Math.max(1, subtreeSize)) - 2) * 5, -10, 34);
  const localFanoutOffset = clamp(childCount * 3, 0, 24);
  const hashJitter = (randomUnitFromHash(hashString(`${nodeId}:branch-hub-r`)) - 0.5) * 12;
  return (centeredRing * ringStep) + childWeightOffset + localFanoutOffset + hashJitter;
}

function getBranchHubAngleOffset(nodeId: string, siblingHubCount: number) {
  if (siblingHubCount < 5) {
    return 0;
  }

  const slotAngle = (Math.PI * 2) / siblingHubCount;
  return (randomUnitFromHash(hashString(`${nodeId}:branch-hub-angle`)) - 0.5) * slotAngle * 0.32;
}

function getRootBranchLaneCount(childHubCount: number) {
  if (childHubCount <= 1) {
    return childHubCount;
  }

  return clamp(childHubCount, 3, 11);
}

function getRootBranchLaneAngle(rootId: string, childHubId: string, laneIndex: number, laneCount: number) {
  if (laneCount <= 1) {
    return getStableAngle(childHubId);
  }

  const fanArc = laneCount >= 8 ? Math.PI * 1.18 : Math.PI * 0.95;
  const centeredIndex = laneIndex - ((laneCount - 1) / 2);
  const offset = centeredIndex * fanArc / Math.max(1, laneCount - 1);
  const jitter = (randomUnitFromHash(hashString(`${childHubId}:root-lane-angle`)) - 0.5) * 0.08;
  return getStableAngle(rootId) + offset + jitter;
}

function getRootBranchLaneRadius(
  childHubId: string,
  childHubCount: number,
  laneOrdinal: number,
  childCount: number,
  subtreeSize: number,
) {
  const baseRadius = childHubCount <= 2
    ? 270
    : childHubCount >= 10
      ? 238
      : 250;
  const laneStep = childHubCount >= 14 ? 76 : childHubCount >= 9 ? 84 : 92;
  const subtreeWeight = clamp((Math.sqrt(Math.max(1, subtreeSize)) - 2) * 8, -8, 42);
  const localFanoutWeight = clamp(childCount * 4, 0, 32);
  const jitter = (randomUnitFromHash(hashString(`${childHubId}:root-lane-r`)) - 0.5) * 24;

  return clamp(baseRadius + (laneOrdinal * laneStep) + subtreeWeight + localFanoutWeight + jitter, 172, 450);
}

function pointOnRootBranchLane(
  center: GraphLayoutPoint,
  radius: number,
  angle: number,
  childHubId: string,
  laneIndex: number,
  laneOrdinal: number,
): GraphLayoutPoint {
  const lateralDirection = ((laneIndex + laneOrdinal) % 2 === 0) ? 1 : -1;
  const lateralJitter = (randomUnitFromHash(hashString(`${childHubId}:root-lane-lateral`)) - 0.5) * 18;
  const lateralOffset = laneOrdinal <= 0
    ? lateralJitter
    : lateralDirection * clamp(28 + (laneOrdinal * 12), 28, 58) + lateralJitter;

  return {
    x: center.x + (Math.cos(angle) * radius) + (Math.cos(angle + Math.PI / 2) * lateralOffset),
    y: center.y + (Math.sin(angle) * radius) + (Math.sin(angle + Math.PI / 2) * lateralOffset),
  };
}

function pointOnCircle(center: GraphLayoutPoint, radius: number, angle: number): GraphLayoutPoint {
  return {
    x: center.x + (Math.cos(angle) * radius),
    y: center.y + (Math.sin(angle) * radius),
  };
}

function buildAdjacency(nodes: GraphNode[], edges: GraphEdge[]) {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const edge of edges) {
    const source = getEdgeEndpoint(edge.source);
    const target = getEdgeEndpoint(edge.target);
    if (!adjacency.has(source) || !adjacency.has(target)) {
      continue;
    }
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  }

  return adjacency;
}

function buildDirectedChildren(nodes: GraphNode[], edges: GraphEdge[]) {
  const children = new Map<string, Set<string>>();
  for (const node of nodes) {
    children.set(node.id, new Set());
  }

  for (const edge of edges) {
    const source = getEdgeEndpoint(edge.source);
    const target = getEdgeEndpoint(edge.target);
    if (!children.has(source) || !children.has(target)) {
      continue;
    }

    children.get(source)?.add(target);
  }

  return children;
}

function buildDirectedParentCounts(nodes: GraphNode[], edges: GraphEdge[]) {
  const parentCounts = new Map<string, number>();
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    parentCounts.set(node.id, 0);
  }

  for (const edge of edges) {
    const source = getEdgeEndpoint(edge.source);
    const target = getEdgeEndpoint(edge.target);
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      continue;
    }

    parentCounts.set(target, (parentCounts.get(target) ?? 0) + 1);
  }

  return parentCounts;
}

function buildDirectedSubtreeSizes(nodes: GraphNode[], directedChildren: Map<string, Set<string>>) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const memo = new Map<string, number>();

  const visit = (nodeId: string, path: Set<string>): number => {
    if (!nodeIds.has(nodeId)) {
      return 0;
    }

    const memoized = memo.get(nodeId);
    if (memoized != null) {
      return memoized;
    }

    if (path.has(nodeId)) {
      return 0;
    }

    const nextPath = new Set(path);
    nextPath.add(nodeId);
    let size = 1;
    for (const childId of directedChildren.get(nodeId) ?? []) {
      size += visit(childId, nextPath);
    }
    memo.set(nodeId, size);
    return size;
  };

  for (const nodeId of nodeIds) {
    visit(nodeId, new Set());
  }

  return memo;
}

function getComponents(nodes: GraphNode[], adjacency: Map<string, Set<string>>) {
  const nodeIds = [...nodes.map((node) => node.id)].sort(compareIds);
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const nodeId of nodeIds) {
    if (visited.has(nodeId)) {
      continue;
    }

    const component: string[] = [];
    const queue = [nodeId];
    visited.add(nodeId);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort(compareIds)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push(component.sort(compareIds));
  }

  return components;
}

function getComponentScore(component: string[], degreeByNodeId: Map<string, number>) {
  const degreeSum = component.reduce((sum, nodeId) => sum + (degreeByNodeId.get(nodeId) ?? 0), 0);
  const maxDegree = component.reduce((max, nodeId) => Math.max(max, degreeByNodeId.get(nodeId) ?? 0), 0);
  return (component.length * 10) + (degreeSum * 3) + (maxDegree * 8);
}

function getComponentVisualRadius(
  component: string[],
  degreeByNodeId: Map<string, number>,
  directedChildren: Map<string, Set<string>>,
  graphNodeCount: number,
) {
  const hubCount = component.filter((nodeId) => (degreeByNodeId.get(nodeId) ?? 0) >= 3).length;
  const maxDegree = component.reduce((max, nodeId) => Math.max(max, degreeByNodeId.get(nodeId) ?? 0), 0);
  const maxChildCount = component.reduce((max, nodeId) => Math.max(max, directedChildren.get(nodeId)?.size ?? 0), 0);

  if (hubCount > 1) {
    const compactRadius = 132 + (hubCount * 18) + (Math.sqrt(component.length) * 16) + (maxChildCount * 4);
    if (component.length >= 40 || maxChildCount >= 6) {
      return Math.min(
        920,
        Math.max(
          compactRadius,
          210 + (hubCount * 28) + (Math.sqrt(component.length) * 24) + (maxChildCount * 7),
        ),
      );
    }

    return Math.min(520, compactRadius);
  }

  if (maxDegree >= 3) {
    return Math.min(
      360,
      getChildOrbitRadius(
        maxDegree,
        maxChildCount,
        DEFAULT_LAYOUT_LINK_DISTANCE,
        defaultLinkDistanceResolver,
        true,
        graphNodeCount,
      ) + 64,
    );
  }

  return Math.max(54, 54 + component.length * 5);
}

function hasDirectedChildren(nodeId: string, directedChildren: Map<string, Set<string>>) {
  return (directedChildren.get(nodeId)?.size ?? 0) > 0;
}

function createVisualCluster(
  clusterAnchors: Map<number, GraphLayoutPoint>,
  clusterRadii: Map<number, number>,
  nodeClusterIndex: Map<string, number>,
  nodeAnchorPositions: Map<string, GraphLayoutPoint>,
  rootId: string,
  memberIds: string[],
) {
  const clusterIndex = clusterAnchors.size;
  const uniqueMembers = Array.from(new Set(memberIds)).filter((nodeId) => nodeAnchorPositions.has(nodeId));
  const anchor = nodeAnchorPositions.get(rootId)
    ?? uniqueMembers.map((nodeId) => nodeAnchorPositions.get(nodeId)).find(Boolean)
    ?? { x: 0, y: 0 };
  let radius = uniqueMembers.length <= 1 ? 16 : 52;

  for (const nodeId of uniqueMembers) {
    const position = nodeAnchorPositions.get(nodeId);
    if (!position) {
      continue;
    }

    radius = Math.max(radius, Math.hypot(position.x - anchor.x, position.y - anchor.y) + 46);
    nodeClusterIndex.set(nodeId, clusterIndex);
  }

  clusterAnchors.set(clusterIndex, anchor);
  clusterRadii.set(clusterIndex, Math.min(260, radius + Math.sqrt(uniqueMembers.length) * 4));
}

function buildVisualClusterMetadata(
  connectedComponents: string[][],
  orphanComponents: string[][],
  adjacency: Map<string, Set<string>>,
  directedChildren: Map<string, Set<string>>,
  degreeByNodeId: Map<string, number>,
  nodeAnchorPositions: Map<string, GraphLayoutPoint>,
) {
  const clusterAnchors = new Map<number, GraphLayoutPoint>();
  const clusterRadii = new Map<number, number>();
  const nodeClusterIndex = new Map<string, number>();

  for (const component of connectedComponents) {
    const componentSet = new Set(component);
    const rootIds = component
      .filter((nodeId) => hasDirectedChildren(nodeId, directedChildren) || (degreeByNodeId.get(nodeId) ?? 0) >= 3)
      .sort((left, right) => {
        const childrenDelta = (directedChildren.get(right)?.size ?? 0) - (directedChildren.get(left)?.size ?? 0);
        if (childrenDelta !== 0) {
          return childrenDelta;
        }

        const degreeDelta = (degreeByNodeId.get(right) ?? 0) - (degreeByNodeId.get(left) ?? 0);
        return degreeDelta || compareIds(left, right);
      });
    const rootSet = new Set(rootIds);

    if (rootIds.length === 0) {
      createVisualCluster(clusterAnchors, clusterRadii, nodeClusterIndex, nodeAnchorPositions, component[0], component);
      continue;
    }

    for (const rootId of rootIds) {
      const members = [rootId];
      for (const childId of directedChildren.get(rootId) ?? []) {
        if (componentSet.has(childId) && !rootSet.has(childId)) {
          members.push(childId);
        }
      }

      createVisualCluster(clusterAnchors, clusterRadii, nodeClusterIndex, nodeAnchorPositions, rootId, members);
    }

    for (const nodeId of component) {
      if (nodeClusterIndex.has(nodeId)) {
        continue;
      }

      const adjacentRoot = [...(adjacency.get(nodeId) ?? [])]
        .filter((neighborId) => rootSet.has(neighborId))
        .sort(compareIds)[0];

      createVisualCluster(
        clusterAnchors,
        clusterRadii,
        nodeClusterIndex,
        nodeAnchorPositions,
        adjacentRoot ?? nodeId,
        [nodeId],
      );
    }
  }

  for (const component of orphanComponents) {
    createVisualCluster(
      clusterAnchors,
      clusterRadii,
      nodeClusterIndex,
      nodeAnchorPositions,
      component[0],
      component,
    );
  }

  return { clusterAnchors, clusterRadii, nodeClusterIndex };
}

function getChildOrbitRadius(
  parentDegree: number,
  parentChildCount: number,
  baseLinkDistance: number,
  linkDistanceResolver: LinkDistanceResolver,
  parentHasChildren = true,
  graphNodeCount = 0,
) {
  return linkDistanceResolver(parentDegree, 1, baseLinkDistance, {
    sourceHasChildren: parentHasChildren,
    targetHasChildren: false,
    sourceChildCount: parentChildCount,
    targetChildCount: 0,
    sourceSubtreeSize: Math.max(1, parentChildCount + 1),
    targetSubtreeSize: 1,
    graphNodeCount,
  });
}

function canPlaceComponent(
  candidate: GraphLayoutPoint,
  radius: number,
  placed: Array<{ center: GraphLayoutPoint; radius: number }>,
) {
  return placed.every((entry) => {
    const distance = Math.hypot(candidate.x - entry.center.x, candidate.y - entry.center.y);
    return distance >= radius + entry.radius + COMPONENT_GAP;
  });
}

function buildPackedComponentCenters(
  components: string[][],
  radii: number[],
) {
  const centers: GraphLayoutPoint[] = [];
  const placed: Array<{ center: GraphLayoutPoint; radius: number }> = [];

  components.forEach((component, index) => {
    const radius = radii[index] ?? 120;
    const packingRadius = Math.max(radius, component.length <= 3 ? 220 : 120);
    if (index === 0) {
      const center = { x: 0, y: 0 };
      centers.push(center);
      const dominantReserveRadius = component.length >= 40
        ? Math.max(radius, 820)
        : radius;
      placed.push({ center, radius: dominantReserveRadius });
      return;
    }

    const phase = getStableAngle(component[0]);
    for (let ring = 1; ring <= 72; ring += 1) {
      const candidateRadius = ring * 58;
      const slots = Math.max(8, Math.ceil((Math.PI * 2 * candidateRadius) / Math.max(96, radius * 0.9)));
      for (let slot = 0; slot < slots; slot += 1) {
        const center = pointOnCircle(
          { x: 0, y: 0 },
          candidateRadius,
          phase + (Math.PI * 2 * slot / slots),
        );

        if (canPlaceComponent(center, packingRadius, placed)) {
          centers.push(center);
          placed.push({ center, radius: packingRadius });
          return;
        }
      }
    }

    const fallback = pointOnCircle({ x: 0, y: 0 }, (index + 1) * (radius + COMPONENT_GAP), phase);
    centers.push(fallback);
    placed.push({ center: fallback, radius: packingRadius });
  });

  return centers;
}

function getActualComponentRadius(
  component: string[],
  center: GraphLayoutPoint,
  nodeAnchorPositions: Map<string, GraphLayoutPoint>,
) {
  return component.reduce((radius, nodeId) => {
    const position = nodeAnchorPositions.get(nodeId);
    if (!position) {
      return radius;
    }

    return Math.max(radius, Math.hypot(position.x - center.x, position.y - center.y) + 74);
  }, 54);
}

function placeOrphans(
  orphanIds: string[],
  nodeAnchorPositions: Map<string, GraphLayoutPoint>,
  outerRadius: number,
) {
  const sorted = [...orphanIds].sort(compareIds);
  const minimumDistance = 104;
  let ringRadius = Math.max(outerRadius, 560);
  let ringSlots = Math.max(8, Math.floor((Math.PI * 2 * ringRadius) / minimumDistance));
  let slot = 0;
  let ring = 0;

  sorted.forEach((nodeId) => {
    if (slot >= ringSlots) {
      ring += 1;
      ringRadius += minimumDistance;
      ringSlots = Math.max(8, Math.floor((Math.PI * 2 * ringRadius) / minimumDistance));
      slot = 0;
    }

    const phase = getStableAngle('orphan-layout') + (ring * 0.37);
    const angle = phase + (Math.PI * 2 * slot / ringSlots);
    const radialJitter = (randomUnitFromHash(hashString(`${nodeId}:orphan-r`)) - 0.5) * 16;
    nodeAnchorPositions.set(nodeId, pointOnCircle({ x: 0, y: 0 }, ringRadius + radialJitter, angle));
    slot += 1;
  });
}

function placeSimpleComponent(
  component: string[],
  center: GraphLayoutPoint,
  nodeAnchorPositions: Map<string, GraphLayoutPoint>,
) {
  if (component.length === 1) {
    nodeAnchorPositions.set(component[0], center);
    return;
  }

  component.forEach((nodeId, index) => {
    const angle = getStableAngle(component[0]) + (Math.PI * 2 * index / component.length);
    nodeAnchorPositions.set(nodeId, pointOnCircle(center, SIMPLE_COMPONENT_RADIUS, angle));
  });
}

function placeHubComponent(
  component: string[],
  center: GraphLayoutPoint,
  adjacency: Map<string, Set<string>>,
  directedChildren: Map<string, Set<string>>,
  directedParentCounts: Map<string, number>,
  directedSubtreeSizes: Map<string, number>,
  degreeByNodeId: Map<string, number>,
  nodeAnchorPositions: Map<string, GraphLayoutPoint>,
  baseLinkDistance: number,
  graphNodeCount: number,
  linkDistanceResolver: LinkDistanceResolver,
) {
  const hubs = component
    .filter((nodeId) => (degreeByNodeId.get(nodeId) ?? 0) >= 3 || hasDirectedChildren(nodeId, directedChildren))
    .sort((left, right) => {
      const rootDelta = Number((directedParentCounts.get(left) ?? 0) === 0)
        - Number((directedParentCounts.get(right) ?? 0) === 0);
      if (rootDelta !== 0) {
        return -rootDelta;
      }

      const childrenDelta = (directedChildren.get(right)?.size ?? 0) - (directedChildren.get(left)?.size ?? 0);
      if (childrenDelta !== 0) {
        return childrenDelta;
      }

      const degreeDelta = (degreeByNodeId.get(right) ?? 0) - (degreeByNodeId.get(left) ?? 0);
      return degreeDelta || compareIds(left, right);
    });

  if (hubs.length === 0) {
    placeSimpleComponent(component, center, nodeAnchorPositions);
    return;
  }

  const hubSet = new Set(hubs);
  const componentSet = new Set(component);
  const placed = new Set<string>();
  const rootHub = hubs[0];

  const sortByGraphWeight = (left: string, right: string) => {
    const childrenDelta = (directedChildren.get(right)?.size ?? 0) - (directedChildren.get(left)?.size ?? 0);
    if (childrenDelta !== 0) {
      return childrenDelta;
    }

    const degreeDelta = (degreeByNodeId.get(right) ?? 0) - (degreeByNodeId.get(left) ?? 0);
    return degreeDelta || compareIds(left, right);
  };

  const placeChildLeaves = (
    hubId: string,
    hubPosition: GraphLayoutPoint,
    childIds: string[],
    incomingAngle: number | null = null,
    reserveChildHubSector = false,
    incomingSectorArc: number | null = null,
    incomingLeafFanSide: number | null = null,
  ) => {
    const sortedChildren = [...childIds].sort((left, right) => {
      const degreeDelta = (degreeByNodeId.get(right) ?? 0) - (degreeByNodeId.get(left) ?? 0);
      return degreeDelta || compareIds(left, right);
    });

    const radius = getChildOrbitRadius(
      degreeByNodeId.get(hubId) ?? sortedChildren.length,
      directedChildren.get(hubId)?.size ?? sortedChildren.length,
      baseLinkDistance,
      linkDistanceResolver,
      hasDirectedChildren(hubId, directedChildren),
      graphNodeCount,
    );
    const hasIncomingBranch = incomingAngle != null;
    const fanoutArc = getLeafFanoutArc(sortedChildren.length, hasIncomingBranch, reserveChildHubSector);
    const resolvedFanoutArc = incomingSectorArc == null
      ? fanoutArc
      : Math.min(fanoutArc, Math.max(Math.PI * 0.36, incomingSectorArc * 0.82));
    const branchLeafSide = incomingLeafFanSide ?? ((hashString(`${hubId}:branch-leaf-side`) % 2) === 0 ? 1 : -1);
    const branchLeafCenterAngle = incomingSectorArc == null
      ? (incomingAngle as number) + (branchLeafSide * Math.PI / 2)
      : (incomingAngle as number);
    const baseAngle = hasIncomingBranch
      ? normalizeAngle(branchLeafCenterAngle - (resolvedFanoutArc / 2))
      : getStableAngle(hubId) - (resolvedFanoutArc / 2);

    sortedChildren.forEach((nodeId, index) => {
      const denominator = hasIncomingBranch ? Math.max(1, sortedChildren.length - 1) : Math.max(1, sortedChildren.length);
      const angle = baseAngle + (resolvedFanoutArc * index / denominator);
      const branchLeafRadius = hasIncomingBranch ? getBranchLeafFanRadius(radius, sortedChildren.length) : radius;
      const childRadius = branchLeafRadius + getSiblingRadialOffset(nodeId, index, sortedChildren.length, hasIncomingBranch);
      nodeAnchorPositions.set(nodeId, pointOnCircle(hubPosition, childRadius, angle));
      placed.add(nodeId);
    });
  };

  const placeWeightedRootChildren = (
    hubId: string,
    hubPosition: GraphLayoutPoint,
    childHubIds: string[],
    childLeafIds: string[],
  ) => {
    const sortedChildHubIds = [...childHubIds].sort(sortByGraphWeight);
    const sortedChildLeafIds = [...childLeafIds].sort(sortByGraphWeight);
    const laneCount = getRootBranchLaneCount(sortedChildHubIds.length);
    const laneLoads = new Array(Math.max(1, laneCount)).fill(0);

    sortedChildHubIds.forEach((childId, index) => {
      const laneIndex = laneCount <= 1
        ? 0
        : index % laneCount;
      const laneOrdinal = laneLoads[laneIndex] ?? 0;
      laneLoads[laneIndex] = laneOrdinal + 1;
      const childCount = directedChildren.get(childId)?.size ?? 0;
      const subtreeSize = directedSubtreeSizes.get(childId) ?? 1;
      const angle = getRootBranchLaneAngle(hubId, childId, laneIndex, laneCount);
      const childHubRadius = getRootBranchLaneRadius(childId, sortedChildHubIds.length, laneOrdinal, childCount, subtreeSize);
      const childHubPosition = pointOnRootBranchLane(hubPosition, childHubRadius, angle, childId, laneIndex, laneOrdinal);
      const childSectorArc = laneCount <= 1 ? Math.PI * 0.82 : Math.PI * 0.46;
      const centeredLaneIndex = laneIndex - ((laneCount - 1) / 2);
      const leafFanSide = centeredLaneIndex === 0
        ? ((hashString(`${childId}:root-center-leaf-side`) % 2) === 0 ? 1 : -1)
        : centeredLaneIndex > 0
          ? 1
          : -1;
      placeBranch(childId, childHubPosition, angle, childSectorArc, leafFanSide);
    });

    if (sortedChildLeafIds.length === 0) {
      return;
    }

    const leafArc = sortedChildHubIds.length > 0
      ? Math.PI * 0.82
      : Math.PI * 2;
    const leafBaseAngle = sortedChildHubIds.length > 0
      ? getStableAngle(hubId) + Math.PI - (leafArc / 2)
      : getStableAngle(hubId);
    const leafRadiusBase = sortedChildHubIds.length > 0
      ? clamp(84 + (sortedChildLeafIds.length * 3.8), 92, 148)
      : getChildOrbitRadius(
        degreeByNodeId.get(hubId) ?? sortedChildLeafIds.length,
        directedChildren.get(hubId)?.size ?? sortedChildLeafIds.length,
        baseLinkDistance,
        linkDistanceResolver,
        hasDirectedChildren(hubId, directedChildren),
        graphNodeCount,
      );

    sortedChildLeafIds.forEach((childId, index) => {
      const denominator = Math.max(1, sortedChildLeafIds.length - 1);
      const angle = leafBaseAngle + (leafArc * index / denominator);
      const childRadius = leafRadiusBase + getSiblingRadialOffset(childId, index, sortedChildLeafIds.length);
      nodeAnchorPositions.set(childId, pointOnCircle(hubPosition, childRadius, angle));
      placed.add(childId);
    });
  };

  const placeBranch = (
    hubId: string,
    hubPosition: GraphLayoutPoint,
    incomingAngle: number | null,
    incomingSectorArc: number | null = null,
    incomingLeafFanSide: number | null = null,
  ) => {
    nodeAnchorPositions.set(hubId, hubPosition);
    placed.add(hubId);

    const directedChildIds = [...(directedChildren.get(hubId) ?? [])]
      .filter((childId) => componentSet.has(childId) && !placed.has(childId))
      .sort(sortByGraphWeight);
    const childHubIds = directedChildIds.filter((childId) => hubSet.has(childId));
    const childLeafIds = directedChildIds.filter((childId) => !hubSet.has(childId));

    if (incomingAngle == null && childHubIds.length > 0) {
      placeWeightedRootChildren(hubId, hubPosition, childHubIds, childLeafIds);
      return;
    }

    placeChildLeaves(
      hubId,
      hubPosition,
      childLeafIds,
      incomingAngle,
      childHubIds.length > 0,
      incomingSectorArc,
      incomingLeafFanSide,
    );

    if (childHubIds.length === 0) {
      return;
    }

    childHubIds.forEach((childHubId, index) => {
      const forwardSectorArc = incomingAngle == null
        ? Math.PI * 2
        : Math.min(
          Math.PI * 0.92,
          Math.max(Math.PI * 0.28, (incomingSectorArc ?? Math.PI * 0.92) * 0.58),
        );
      const baseAngle = incomingAngle == null
        ? getStableAngle(hubId) + (childLeafIds.length > 0 ? Math.PI * 0.82 : 0)
        : incomingAngle;
      const angle = incomingAngle == null
        ? baseAngle
          + (Math.PI * 2 * index / childHubIds.length)
          + getBranchHubAngleOffset(childHubId, childHubIds.length)
        : baseAngle + getLayeredBranchAngleOffset(childHubId, index, childHubIds.length, forwardSectorArc);
      const radius = linkDistanceResolver(
        degreeByNodeId.get(hubId) ?? 1,
        degreeByNodeId.get(childHubId) ?? 1,
        baseLinkDistance,
        {
          sourceHasChildren: hasDirectedChildren(hubId, directedChildren),
          sourceId: hubId,
          targetHasChildren: hasDirectedChildren(childHubId, directedChildren),
          targetId: childHubId,
          sourceChildCount: directedChildren.get(hubId)?.size ?? 0,
          targetChildCount: directedChildren.get(childHubId)?.size ?? 0,
          sourceSubtreeSize: directedSubtreeSizes.get(hubId) ?? 1,
          targetSubtreeSize: directedSubtreeSizes.get(childHubId) ?? 1,
          graphNodeCount,
        },
      );
      const childHubRadius = Math.max(
        incomingAngle == null ? 96 : 185,
        radius + getBranchHubRadialOffset(
          childHubId,
          index,
          childHubIds.length,
          directedChildren.get(childHubId)?.size ?? 0,
          directedSubtreeSizes.get(childHubId) ?? 1,
        ),
      );
      const childHubPosition = pointOnCircle(hubPosition, childHubRadius, angle);
      placeBranch(childHubId, childHubPosition, angle, incomingSectorArc == null ? null : incomingSectorArc / Math.max(1, childHubIds.length));
    });
  };

  placeBranch(rootHub, center, null);

  const unplacedHubs = hubs.filter((hubId) => !placed.has(hubId));
  unplacedHubs.forEach((hubId, index) => {
    const radius = linkDistanceResolver(
      degreeByNodeId.get(rootHub) ?? 1,
      degreeByNodeId.get(hubId) ?? 1,
      baseLinkDistance,
      {
        sourceHasChildren: hasDirectedChildren(rootHub, directedChildren),
        sourceId: rootHub,
        targetHasChildren: hasDirectedChildren(hubId, directedChildren),
        targetId: hubId,
        sourceChildCount: directedChildren.get(rootHub)?.size ?? 0,
        targetChildCount: directedChildren.get(hubId)?.size ?? 0,
        sourceSubtreeSize: directedSubtreeSizes.get(rootHub) ?? 1,
        targetSubtreeSize: directedSubtreeSizes.get(hubId) ?? 1,
        graphNodeCount,
      },
    );
    const angle = getStableAngle(rootHub) + (Math.PI * 2 * index / Math.max(1, unplacedHubs.length));
    placeBranch(hubId, pointOnCircle(center, radius, angle), angle);
  });

  const unplacedLeavesByHub = new Map<string, string[]>();
  for (const hubId of hubs) {
    unplacedLeavesByHub.set(hubId, []);
  }

  for (const nodeId of component) {
    if (placed.has(nodeId) || hubSet.has(nodeId)) {
      continue;
    }

    const adjacentHubs = [...(adjacency.get(nodeId) ?? [])]
      .filter((neighbor) => hubSet.has(neighbor) && nodeAnchorPositions.has(neighbor))
      .sort(sortByGraphWeight);
    const parentHub = adjacentHubs[0] ?? rootHub;
    unplacedLeavesByHub.get(parentHub)?.push(nodeId);
  }

  for (const [hubId, leafIds] of unplacedLeavesByHub) {
    if (leafIds.length === 0) {
      continue;
    }

    const hubPosition = nodeAnchorPositions.get(hubId) ?? center;
    placeChildLeaves(hubId, hubPosition, leafIds);
  }

  for (const nodeId of component) {
    if (!nodeAnchorPositions.has(nodeId)) {
      nodeAnchorPositions.set(nodeId, pointOnCircle(center, SIMPLE_COMPONENT_RADIUS, getStableAngle(nodeId)));
    }
  }
}

export function buildReferralGraphLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  baseLinkDistance = DEFAULT_LAYOUT_LINK_DISTANCE,
  linkDistanceResolver = defaultLinkDistanceResolver,
): ReferralGraphComponentLayout {
  const nodeAnchorPositions = new Map<string, GraphLayoutPoint>();
  const adjacency = buildAdjacency(nodes, edges);
  const directedChildren = buildDirectedChildren(nodes, edges);
  const directedParentCounts = buildDirectedParentCounts(nodes, edges);
  const directedSubtreeSizes = buildDirectedSubtreeSizes(nodes, directedChildren);
  const directedChildCounts = new Map(
    [...directedChildren.entries()].map(([nodeId, childIds]) => [nodeId, childIds.size]),
  );
  const degreeByNodeId = new Map<string, number>();

  for (const node of nodes) {
    degreeByNodeId.set(node.id, adjacency.get(node.id)?.size ?? 0);
  }

  const components = getComponents(nodes, adjacency);
  const orphanComponents = components.filter((component) => component.length === 1 && (degreeByNodeId.get(component[0]) ?? 0) === 0);
  const connectedComponents = components
    .filter((component) => !(component.length === 1 && (degreeByNodeId.get(component[0]) ?? 0) === 0))
    .sort((left, right) => {
      const scoreDelta = getComponentScore(right, degreeByNodeId) - getComponentScore(left, degreeByNodeId);
      return scoreDelta || compareIds(left[0], right[0]);
    });
  const componentAnchors = new Map<number, GraphLayoutPoint>();
  const componentRadii = new Map<number, number>();
  const componentSizes = new Map<number, number>();
  const nodeComponentIndex = new Map<string, number>();
  const nodeOrderInComponent = new Map<string, number>();
  const connectedComponentRadii = connectedComponents.map((component) =>
    getComponentVisualRadius(component, degreeByNodeId, directedChildren, nodes.length),
  );
  const connectedComponentCenters = buildPackedComponentCenters(connectedComponents, connectedComponentRadii);

  connectedComponents.forEach((component, index) => {
    const center = connectedComponentCenters[index] ?? { x: 0, y: 0 };
    const radius = connectedComponentRadii[index] ?? getComponentVisualRadius(component, degreeByNodeId, directedChildren, nodes.length);
    componentAnchors.set(index, center);
    componentSizes.set(index, component.length);
    component.forEach((nodeId, orderIndex) => {
      nodeComponentIndex.set(nodeId, index);
      nodeOrderInComponent.set(nodeId, orderIndex);
    });

    placeHubComponent(
      component,
      center,
      adjacency,
      directedChildren,
      directedParentCounts,
      directedSubtreeSizes,
      degreeByNodeId,
      nodeAnchorPositions,
      baseLinkDistance,
      nodes.length,
      linkDistanceResolver,
    );
    const actualRadius = getActualComponentRadius(component, center, nodeAnchorPositions);
    const reservedRadius = index === 0 && component.length >= 40
      ? Math.max(radius, actualRadius, 820)
      : Math.max(radius, actualRadius);
    componentRadii.set(index, reservedRadius);
  });

  const maxComponentExtent = connectedComponentCenters.reduce((max, center, index) => {
    const radius = componentRadii.get(index) ?? connectedComponentRadii[index] ?? 0;
    return Math.max(max, Math.hypot(center.x, center.y) + radius);
  }, 0);

  placeOrphans(
    orphanComponents.map((component) => component[0]),
    nodeAnchorPositions,
    Math.max(OUTER_ORPHAN_RING_RADIUS, Math.min(1080, maxComponentExtent + 260)),
  );

  const {
    clusterAnchors,
    clusterRadii,
    nodeClusterIndex,
  } = buildVisualClusterMetadata(
    connectedComponents,
    orphanComponents,
    adjacency,
    directedChildren,
    degreeByNodeId,
    nodeAnchorPositions,
  );

  return {
    clusterAnchors,
    clusterRadii,
    componentAnchors,
    componentRadii,
    componentSizes,
    directedChildCounts,
    directedSubtreeSizes,
    nodeClusterIndex,
    nodeComponentIndex,
    nodeAnchorPositions,
    nodeOrderInComponent,
  };
}
