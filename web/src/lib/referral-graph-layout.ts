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
  nodeComponentIndex: Map<string, number>;
  nodeClusterIndex: Map<string, number>;
  nodeAnchorPositions: Map<string, GraphLayoutPoint>;
  nodeOrderInComponent: Map<string, number>;
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const OUTER_ORPHAN_RING_RADIUS = 360;
const SIMPLE_COMPONENT_RADIUS = 68;
const DEFAULT_LAYOUT_LINK_DISTANCE = 250;
const COMPONENT_GAP = 32;

type LinkDistanceResolver = (
  sourceDegree: number,
  targetDegree: number,
  baseDistance: number,
  options?: { sourceHasChildren?: boolean; targetHasChildren?: boolean },
) => number;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  const isBranchBridge = Boolean(options.sourceHasChildren && options.targetHasChildren);
  const isLeafSpoke = Boolean(options.sourceHasChildren) !== Boolean(options.targetHasChildren);

  if (isBranchBridge) {
    if (maxDegree <= 2) {
      return Math.round(clamp(clampedBase * 0.29, 68, 82));
    }

    if (minDegree <= 2) {
      return Math.round(clamp(clampedBase * 0.38, 86, 108));
    }

    if (minDegree <= 3) {
      return Math.round(clamp(clampedBase * 0.5, 112, 142));
    }

    return Math.round(clamp(clampedBase * 0.62, 145, 172));
  }

  if (isLeafSpoke) {
    return Math.round(clamp(clampedBase * 0.36, 82, 105));
  }

  if (minDegree <= 1 && maxDegree >= 3) {
    return Math.round(clamp(clampedBase * 0.36, 82, 105));
  }

  if (minDegree <= 2 && maxDegree >= 3) {
    return Math.round(clamp(clampedBase * 0.44, 92, 135));
  }

  if (minDegree >= 3 && maxDegree >= 3) {
    return Math.round(clamp(clampedBase * 0.82, 155, 245));
  }

  return clampedBase;
};

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

function getEdgeEndpoint(value: GraphEdge['source'] | GraphEdge['target']) {
  return typeof value === 'object' ? (value as GraphNode).id : value;
}

function compareIds(left: string, right: string) {
  return left.localeCompare(right);
}

function getStableAngle(id: string) {
  return randomUnitFromHash(hashString(`${id}:angle`)) * Math.PI * 2;
}

function getBranchBendAngle(hubId: string, childHubCount: number) {
  const direction = randomUnitFromHash(hashString(`${hubId}:branch-bend-direction`)) >= 0.5 ? 1 : -1;
  const variance = randomUnitFromHash(hashString(`${hubId}:branch-bend-variance`)) * 0.18;
  const baseBend = childHubCount === 1 ? 0.78 : 0.48;
  return direction * (baseBend + variance);
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

function getComponentVisualRadius(component: string[], degreeByNodeId: Map<string, number>) {
  const hubCount = component.filter((nodeId) => (degreeByNodeId.get(nodeId) ?? 0) >= 3).length;
  const maxDegree = component.reduce((max, nodeId) => Math.max(max, degreeByNodeId.get(nodeId) ?? 0), 0);

  if (hubCount > 1) {
    return Math.min(340, 112 + (hubCount * 14) + (Math.sqrt(component.length) * 8));
  }

  if (maxDegree >= 3) {
    return Math.min(132, getChildOrbitRadius(maxDegree, DEFAULT_LAYOUT_LINK_DISTANCE, defaultLinkDistanceResolver) + 42);
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
  baseLinkDistance: number,
  linkDistanceResolver: LinkDistanceResolver,
  parentHasChildren = true,
) {
  return linkDistanceResolver(1, parentDegree, baseLinkDistance, {
    sourceHasChildren: parentHasChildren,
    targetHasChildren: false,
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
    if (index === 0) {
      const center = { x: 0, y: 0 };
      centers.push(center);
      placed.push({ center, radius });
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

        if (canPlaceComponent(center, radius, placed)) {
          centers.push(center);
          placed.push({ center, radius });
          return;
        }
      }
    }

    const fallback = pointOnCircle({ x: 0, y: 0 }, (index + 1) * (radius + COMPONENT_GAP), phase);
    centers.push(fallback);
    placed.push({ center: fallback, radius });
  });

  return centers;
}

function placeOrphans(
  orphanIds: string[],
  nodeAnchorPositions: Map<string, GraphLayoutPoint>,
  outerRadius: number,
) {
  const sorted = [...orphanIds].sort(compareIds);
  const densityRadius = 260 + Math.sqrt(sorted.length) * 14;
  const resolvedOuterRadius = clamp(Math.max(outerRadius, densityRadius), 320, 480);
  const innerRadius = Math.max(440, resolvedOuterRadius * 0.66);

  sorted.forEach((nodeId, index) => {
    const radialUnit = randomUnitFromHash(hashString(`${nodeId}:orphan-r`));
    const radius = innerRadius + (resolvedOuterRadius - innerRadius) * Math.sqrt(radialUnit);
    const angle = (index * GOLDEN_ANGLE) + getStableAngle(nodeId) * 0.08;
    nodeAnchorPositions.set(nodeId, pointOnCircle({ x: 0, y: 0 }, radius, angle));
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
  degreeByNodeId: Map<string, number>,
  nodeAnchorPositions: Map<string, GraphLayoutPoint>,
  baseLinkDistance: number,
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
  ) => {
    const sortedChildren = [...childIds].sort((left, right) => {
      const degreeDelta = (degreeByNodeId.get(right) ?? 0) - (degreeByNodeId.get(left) ?? 0);
      return degreeDelta || compareIds(left, right);
    });

    const radius = getChildOrbitRadius(
      degreeByNodeId.get(hubId) ?? sortedChildren.length,
      baseLinkDistance,
      linkDistanceResolver,
      hasDirectedChildren(hubId, directedChildren),
    );
    const baseAngle = incomingAngle == null ? getStableAngle(hubId) : incomingAngle;

    sortedChildren.forEach((nodeId, index) => {
      const angle = baseAngle + (Math.PI * 2 * index / Math.max(1, sortedChildren.length));
      const childRadius = radius + (randomUnitFromHash(hashString(`${nodeId}:child-r`)) - 0.5) * 16;
      nodeAnchorPositions.set(nodeId, pointOnCircle(hubPosition, childRadius, angle));
      placed.add(nodeId);
    });
  };

  const placeBranch = (hubId: string, hubPosition: GraphLayoutPoint, incomingAngle: number | null) => {
    nodeAnchorPositions.set(hubId, hubPosition);
    placed.add(hubId);

    const directedChildIds = [...(directedChildren.get(hubId) ?? [])]
      .filter((childId) => componentSet.has(childId) && !placed.has(childId))
      .sort(sortByGraphWeight);
    const childHubIds = directedChildIds.filter((childId) => hubSet.has(childId));
    const childLeafIds = directedChildIds.filter((childId) => !hubSet.has(childId));

    placeChildLeaves(hubId, hubPosition, childLeafIds, incomingAngle);

    if (childHubIds.length === 0) {
      return;
    }

    const baseAngle = incomingAngle == null
      ? getStableAngle(hubId)
      : incomingAngle + getBranchBendAngle(hubId, childHubIds.length);

    childHubIds.forEach((childHubId, index) => {
      const angle = baseAngle + (Math.PI * 2 * index / childHubIds.length);
      const radius = linkDistanceResolver(
        degreeByNodeId.get(hubId) ?? 1,
        degreeByNodeId.get(childHubId) ?? 1,
        baseLinkDistance,
        {
          sourceHasChildren: hasDirectedChildren(hubId, directedChildren),
          targetHasChildren: hasDirectedChildren(childHubId, directedChildren),
        },
      );
      const childHubPosition = pointOnCircle(hubPosition, radius, angle);
      placeBranch(childHubId, childHubPosition, angle);
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
        targetHasChildren: hasDirectedChildren(hubId, directedChildren),
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
  const connectedComponentRadii = connectedComponents.map((component) => getComponentVisualRadius(component, degreeByNodeId));
  const connectedComponentCenters = buildPackedComponentCenters(connectedComponents, connectedComponentRadii);

  connectedComponents.forEach((component, index) => {
    const center = connectedComponentCenters[index] ?? { x: 0, y: 0 };
    const radius = connectedComponentRadii[index] ?? getComponentVisualRadius(component, degreeByNodeId);
    componentAnchors.set(index, center);
    componentRadii.set(index, radius);
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
      degreeByNodeId,
      nodeAnchorPositions,
      baseLinkDistance,
      linkDistanceResolver,
    );
  });

  const maxComponentExtent = connectedComponentCenters.reduce((max, center, index) => {
    const radius = connectedComponentRadii[index] ?? 0;
    return Math.max(max, Math.hypot(center.x, center.y) + radius);
  }, 0);

  placeOrphans(
    orphanComponents.map((component) => component[0]),
    nodeAnchorPositions,
    Math.max(OUTER_ORPHAN_RING_RADIUS, Math.min(520, maxComponentExtent + 96)),
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
    nodeClusterIndex,
    nodeComponentIndex,
    nodeAnchorPositions,
    nodeOrderInComponent,
  };
}
