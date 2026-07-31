import type {
  SampleRevenueGraphEdge,
  SampleRevenueGraphNode,
} from '@/types/referral-revenue-graph';

export const SAMPLE_REVENUE_GRAPH_SURFACE_SIZE = 1600;
export const SAMPLE_REVENUE_GRAPH_SURFACE_CENTER =
  SAMPLE_REVENUE_GRAPH_SURFACE_SIZE / 2;
export const SAMPLE_REVENUE_GRAPH_MIN_SCALE = 0.18;
export const SAMPLE_REVENUE_GRAPH_MAX_SCALE = 5.5;
export const SAMPLE_REVENUE_GRAPH_FIT_PADDING = 52;

/**
 * Auditable copy of the admin graph's resolved balanced-force values.
 *
 * Mobile reuses the charge/link/tension/collision and velocity-damping values.
 * `alphaDecay` and `centerStrength` remain here for comparison only: the admin
 * runtime disables its global center force, while mobile uses the bounded
 * interaction schedule and viewer-rooted guidance declared below.
 */
export const SAMPLE_REVENUE_ADMIN_WEB_PHYSICS = {
  alphaDecay: 0.016,
  velocityDecay: 0.46,
  centerStrength: 0.024,
  chargeStrength: -141,
  chargeDistanceMin: 22,
  chargeDistanceMax: 538,
  linkDistance: 195,
  linkStrength: 0.54,
  collisionPadding: 34,
  collisionStrength: 0.88,
  collisionIterations: 2,
  linkTensionStrength: 0.18,
  linkTensionThresholdMultiplier: 1.38,
} as const;

export const SAMPLE_REVENUE_MOBILE_SETTLE = {
  initialAlpha: 0.32,
  decayMultiplier: 0.94,
  stopThreshold: 0.014,
} as const;

const FIRST_RING_RADIUS = 300;
const DEPTH_RING_GAP = 34;
const SIBLING_ANGLE_GAP = 0.12;
const SEED_LINK_DISTANCE_BLEND = 0.35;
const SEED_LINK_DISTANCE_CAP = 230;
const MINIMUM_BRANCH_ANGLE_GAP = 0.025;
const SURFACE_EDGE_MARGIN = 70;
const HARD_COLLISION_ITERATIONS = 96;
const COLLISION_SAFETY_GAP = 5;
const TWO_PI = Math.PI * 2;
const LANDSCAPE_BRANCH_START_ANGLE = 0;

export const SAMPLE_REVENUE_GRAPH_GUIDE_DEPTHS = [1, 3, 6, 10] as const;

export const SAMPLE_REVENUE_RADIAL_GUIDANCE = {
  targetStrength: 0.012,
  targetMaxImpulse: 8,
  viewerAnchorStrength: 0.18,
  viewerAnchorMaxImpulse: 18,
} as const;

export type SampleRevenueGraphPoint = {
  x: number;
  y: number;
};

export type SampleRevenueGraphViewport = {
  scale: number;
  panX: number;
  panY: number;
};

export type SampleRevenueGraphMotionPoint = SampleRevenueGraphPoint & {
  vx: number;
  vy: number;
};

export type SampleRevenueGraphRadialTarget = {
  offsetX: number;
  offsetY: number;
  radius: number;
  angle: number;
  branchIndex: number;
};

type SimulatedSampleRevenueNode = SampleRevenueGraphPoint & {
  id: string;
  vx: number;
  vy: number;
  collisionRadius: number;
  radialTarget: SampleRevenueGraphRadialTarget;
};

type SampleRevenueGraphPhysicsNode = {
  node: SampleRevenueGraphNode;
  collisionRadius: number;
  radialTarget: SampleRevenueGraphRadialTarget;
};

type SampleRevenueGraphPhysicsEdge = {
  sourceId: string;
  targetId: string;
  distance: number;
  strength: number;
};

export type SampleRevenueGraphPhysicsTopology = {
  nodes: readonly SampleRevenueGraphPhysicsNode[];
  edges: readonly SampleRevenueGraphPhysicsEdge[];
  children: ReadonlyMap<string, readonly string[]>;
  nodeById: ReadonlyMap<string, SampleRevenueGraphNode>;
  viewerId: string | null;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const compareNodeIds = (
  left: SampleRevenueGraphNode,
  right: SampleRevenueGraphNode,
) => left.id.localeCompare(right.id);

function buildChildrenMap(
  nodes: readonly SampleRevenueGraphNode[],
  edges: readonly SampleRevenueGraphEdge[],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const next = children.get(edge.source) ?? [];
    next.push(edge.target);
    children.set(edge.source, next);
  }

  for (const [parentId, childIds] of children) {
    children.set(
      parentId,
      Array.from(new Set(childIds)).sort((leftId, rightId) => {
        const left = nodeById.get(leftId);
        const right = nodeById.get(rightId);
        if (!left || !right) return leftId.localeCompare(rightId);
        return compareNodeIds(left, right);
      }),
    );
  }

  return { children, nodeById };
}

function collectSubtreeSize(
  nodeId: string,
  children: ReadonlyMap<string, readonly string[]>,
  memo: Map<string, number>,
  path = new Set<string>(),
): number {
  const cached = memo.get(nodeId);
  if (cached != null) return cached;
  if (path.has(nodeId)) return 1;
  const nextPath = new Set(path);
  nextPath.add(nodeId);
  const size = 1 + (children.get(nodeId) ?? []).reduce(
    (total, childId) => (
      total + collectSubtreeSize(childId, children, memo, nextPath)
    ),
    0,
  );
  memo.set(nodeId, size);
  return size;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicUnitVector(leftId: string, rightId: string) {
  const angle = (hashString(`${leftId}:${rightId}`) / 0xffffffff) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function getSampleRevenueGraphRadialTargetRadius(
  depth: number,
): number {
  if (!Number.isFinite(depth) || depth <= 0) return 0;
  return FIRST_RING_RADIUS + (depth - 1) * DEPTH_RING_GAP;
}

function normalizeAngle(angle: number) {
  return ((angle + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
}

function createRadialTarget(
  radius: number,
  angle: number,
  branchIndex: number,
): SampleRevenueGraphRadialTarget {
  const normalizedAngle = normalizeAngle(angle);
  return {
    offsetX: Math.cos(normalizedAngle) * radius,
    offsetY: Math.sin(normalizedAngle) * radius,
    radius,
    angle: normalizedAngle,
    branchIndex,
  };
}

/**
 * Lightweight analogue of the administrator graph's forward seed.
 *
 * A child advances from its parent into the next viewer-centered depth ring.
 * Collision envelopes and the resolved link distance determine the smallest
 * useful forward angle; stable subtree bands are packed once before the live
 * charge/link/tension/collision loop takes over. This intentionally avoids an
 * O(E^2) crossing force on every mobile frame.
 */
function buildViewerRootedRadialTargets(options: {
  nodes: readonly SampleRevenueGraphNode[];
  children: ReadonlyMap<string, readonly string[]>;
  nodeById: ReadonlyMap<string, SampleRevenueGraphNode>;
  collisionRadiusById: ReadonlyMap<string, number>;
  linkDistanceByChildId: ReadonlyMap<string, number>;
  subtreeSizeById: ReadonlyMap<string, number>;
}) {
  const {
    nodes,
    children,
    nodeById,
    collisionRadiusById,
    linkDistanceByChildId,
    subtreeSizeById,
  } = options;
  const orderedNodes = [...nodes].sort(compareNodeIds);
  const viewer = orderedNodes.find((node) => node.isViewer)
    ?? orderedNodes.find((node) => node.parentId === null)
    ?? orderedNodes[0];
  const radialTargetById = new Map<string, SampleRevenueGraphRadialTarget>();
  if (!viewer) {
    return { radialTargetById, viewerId: null };
  }

  radialTargetById.set(viewer.id, createRadialTarget(0, 0, -1));
  const visited = new Set<string>([viewer.id]);
  type LocalTarget = {
    nodeId: string;
    angle: number;
    radius: number;
  };
  type LocalBranch = {
    branchIndex: number;
    targets: LocalTarget[];
    minBound: number;
    maxBound: number;
  };

  const sortBySubtree = (leftId: string, rightId: string) => (
    (subtreeSizeById.get(rightId) ?? 1)
      - (subtreeSizeById.get(leftId) ?? 1)
    || leftId.localeCompare(rightId)
  );
  const getAngularHalfWidth = (nodeId: string, radius: number) => {
    if (radius <= 0) return 0;
    return Math.asin(clamp(
      ((collisionRadiusById.get(nodeId) ?? 42) + COLLISION_SAFETY_GAP / 2)
        / radius,
      0,
      0.92,
    ));
  };
  const getForwardAngularStep = (parentId: string, childId: string) => {
    const parent = nodeById.get(parentId);
    const child = nodeById.get(childId);
    if (!parent || !child || parent.isViewer) return 0;
    const parentRadius = getSampleRevenueGraphRadialTargetRadius(
      Math.max(1, parent.depth),
    );
    const childRadius = getSampleRevenueGraphRadialTargetRadius(
      Math.max(1, child.depth),
    );
    const minimumChord = (collisionRadiusById.get(parentId) ?? 42)
      + (collisionRadiusById.get(childId) ?? 42)
      + COLLISION_SAFETY_GAP;
    const resolvedLinkDistance = Math.max(
      minimumChord,
      Math.min(
        SEED_LINK_DISTANCE_CAP,
        linkDistanceByChildId.get(childId) ?? minimumChord,
      ),
    );
    const preferredChord = minimumChord
      + (resolvedLinkDistance - minimumChord) * SEED_LINK_DISTANCE_BLEND;
    const maximumChord = Math.max(
      minimumChord,
      parentRadius + childRadius - 0.001,
    );
    const chord = clamp(preferredChord, minimumChord, maximumChord);
    return Math.acos(clamp(
      (
        parentRadius * parentRadius
          + childRadius * childRadius
          - chord * chord
      ) / (2 * parentRadius * childRadius),
      -1,
      1,
    ));
  };
  const getSiblingGap = (childIds: readonly string[]) => {
    if (childIds.length < 2) return 0;
    const maximumCollisionRadius = Math.max(
      ...childIds.map((childId) => collisionRadiusById.get(childId) ?? 42),
    );
    const minimumRadius = Math.min(
      ...childIds.map((childId) => {
        const child = nodeById.get(childId);
        return getSampleRevenueGraphRadialTargetRadius(
          Math.max(1, child?.depth ?? 1),
        );
      }),
    );
    return Math.max(
      SIBLING_ANGLE_GAP,
      2 * Math.asin(clamp(
        (maximumCollisionRadius * 2 + COLLISION_SAFETY_GAP)
          / (2 * minimumRadius),
        0,
        0.92,
      )),
    );
  };
  const branches: LocalBranch[] = [];
  const buildBranch = (rootId: string, branchIndex: number) => {
    const targets: LocalTarget[] = [];
    const place = (nodeId: string, angle: number) => {
      if (visited.has(nodeId)) return;
      const node = nodeById.get(nodeId);
      if (!node) return;
      visited.add(nodeId);
      const radius = getSampleRevenueGraphRadialTargetRadius(
        Math.max(1, node.depth),
      );
      targets.push({ nodeId, angle, radius });

      const childIds = [...(children.get(nodeId) ?? [])]
        .filter((childId) => !visited.has(childId))
        .sort(sortBySubtree);
      const siblingGap = getSiblingGap(childIds);
      childIds.forEach((childId, childIndex) => {
        const centeredIndex = childIndex - (childIds.length - 1) / 2;
        place(
          childId,
          angle
            + getForwardAngularStep(nodeId, childId)
            + centeredIndex * siblingGap,
        );
      });
    };

    place(rootId, 0);
    if (targets.length === 0) return;
    branches.push({
      branchIndex,
      targets,
      minBound: Math.min(...targets.map((target) => (
        target.angle - getAngularHalfWidth(target.nodeId, target.radius)
      ))),
      maxBound: Math.max(...targets.map((target) => (
        target.angle + getAngularHalfWidth(target.nodeId, target.radius)
      ))),
    });
  };

  const rootChildren = [...(children.get(viewer.id) ?? [])]
    .sort(sortBySubtree);
  rootChildren.forEach((nodeId, branchIndex) => {
    buildBranch(nodeId, branchIndex);
  });

  orderedNodes
    .filter((node) => !visited.has(node.id))
    .forEach((node) => {
      buildBranch(node.id, branches.length);
    });

  const totalBranchSpan = branches.reduce(
    (total, branch) => total + branch.maxBound - branch.minBound,
    0,
  );
  const packedGap = branches.length === 0
    ? 0
    : totalBranchSpan < TWO_PI
      ? Math.max(
        MINIMUM_BRANCH_ANGLE_GAP,
        (TWO_PI - totalBranchSpan) / branches.length,
      )
      : MINIMUM_BRANCH_ANGLE_GAP;
  const availableSpan = Math.max(
    0.1,
    TWO_PI - packedGap * branches.length,
  );
  const branchScale = totalBranchSpan > availableSpan
    ? availableSpan / totalBranchSpan
    : 1;
  const packedStarts: number[] = [];
  let cursor = 0;
  for (const branch of branches) {
    packedStarts.push(cursor);
    cursor += (branch.maxBound - branch.minBound) * branchScale + packedGap;
  }
  const landscapeBranchIndex = branches.reduce(
    (largestIndex, branch, index) => (
      branch.maxBound - branch.minBound
        > branches[largestIndex].maxBound - branches[largestIndex].minBound
        ? index
        : largestIndex
    ),
    0,
  );
  const landscapeBranch = branches[landscapeBranchIndex];
  const landscapeMidpoint = landscapeBranch
    ? packedStarts[landscapeBranchIndex]
      + (landscapeBranch.maxBound - landscapeBranch.minBound)
        * branchScale / 2
    : 0;
  const rotation = LANDSCAPE_BRANCH_START_ANGLE - landscapeMidpoint;

  branches.forEach((branch, packedIndex) => {
    const start = packedStarts[packedIndex];
    branch.targets.forEach((target) => {
      radialTargetById.set(
        target.nodeId,
        createRadialTarget(
          target.radius,
          rotation
            + start
            + (target.angle - branch.minBound) * branchScale,
          branch.branchIndex,
        ),
      );
    });
  });

  return { radialTargetById, viewerId: viewer.id };
}

function getAdminWebEquivalentLinkDistance(options: {
  sourceId: string;
  targetId: string;
  sourceDegree: number;
  targetDegree: number;
  sourceChildCount: number;
  targetChildCount: number;
  sourceSubtreeSize: number;
  targetSubtreeSize: number;
  graphNodeCount: number;
}) {
  const {
    sourceId,
    targetId,
    sourceDegree,
    targetDegree,
    sourceChildCount,
    targetChildCount,
    targetSubtreeSize,
    graphNodeCount,
  } = options;
  const minDegree = Math.min(sourceDegree, targetDegree);
  const maxDegree = Math.max(sourceDegree, targetDegree);
  const targetHasChildren = targetChildCount > 0;
  const sourceHasChildren = sourceChildCount > 0;
  const randomUnit = hashString(
    `${sourceId}->${targetId}:${
      targetHasChildren ? 'branch-bridge' : 'terminal-leaf'
    }-distance`,
  ) / 0xffffffff;

  if (targetHasChildren) {
    const branchJitter = Math.round(randomUnit * 54);
    const sparseBranch = sourceChildCount <= 2 && targetChildCount <= 1;
    if (sparseBranch) {
      return Math.round(clamp(
        205
          + Math.sqrt(targetSubtreeSize) * 3
          + targetChildCount * 6
          + branchJitter * 0.35,
        210,
        230,
      ));
    }
    return Math.round(clamp(
      240
        + Math.sqrt(targetSubtreeSize) * 11
        + targetChildCount * 9.4
        + Math.sqrt(targetChildCount) * 3.5
        + branchJitter,
      250,
      430,
    ));
  }

  if (sourceHasChildren || (minDegree <= 1 && maxDegree >= 3)) {
    const terminalJitter = Math.round(randomUnit * 34);
    return Math.round(clamp(
      Math.max(
        SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.linkDistance * 0.36,
        125 + Math.sqrt(Math.max(sourceChildCount, targetChildCount)) * 8
          + terminalJitter,
        112
          + Math.pow(Math.max(0, sourceChildCount - 2), 0.82) * 20
          + Math.sqrt(graphNodeCount) * 2.2
          + terminalJitter,
      ),
      118,
      300,
    ));
  }

  if (minDegree <= 2 && maxDegree >= 3) {
    return Math.round(clamp(
      SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.linkDistance * 0.44,
      92,
      135,
    ));
  }
  if (minDegree >= 3 && maxDegree >= 3) {
    return Math.round(clamp(
      SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.linkDistance * 0.82,
      155,
      245,
    ));
  }
  return SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.linkDistance;
}

export function prepareSampleRevenueGraphPhysicsTopology(
  nodes: readonly SampleRevenueGraphNode[],
  edges: readonly SampleRevenueGraphEdge[],
): SampleRevenueGraphPhysicsTopology {
  const { children, nodeById } = buildChildrenMap(nodes, edges);
  const childCount = new Map(
    nodes.map((node) => [node.id, children.get(node.id)?.length ?? 0]),
  );
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const subtreeSize = new Map<string, number>();
  for (const node of nodes) {
    collectSubtreeSize(node.id, children, subtreeSize);
  }
  const orderedNodes = [...nodes].sort(compareNodeIds);
  const collisionRadiusById = new Map(orderedNodes.map((node) => [
    node.id,
    Math.max(
      42,
      getSampleRevenueGraphNodeRadius(node)
        + SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.collisionPadding,
    ),
  ]));
  const physicsEdges = edges
    .filter(
      (edge) => nodeById.has(edge.source) && nodeById.has(edge.target),
    )
    .map((edge) => {
      const sourceDegree = degree.get(edge.source) ?? 1;
      const targetDegree = degree.get(edge.target) ?? 1;
      return {
        sourceId: edge.source,
        targetId: edge.target,
        distance: getAdminWebEquivalentLinkDistance({
          sourceId: edge.source,
          targetId: edge.target,
          sourceDegree,
          targetDegree,
          sourceChildCount: childCount.get(edge.source) ?? 0,
          targetChildCount: childCount.get(edge.target) ?? 0,
          sourceSubtreeSize: subtreeSize.get(edge.source) ?? 1,
          targetSubtreeSize: subtreeSize.get(edge.target) ?? 1,
          graphNodeCount: nodes.length,
        }),
        strength: Math.max(
          0.06,
          SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.linkStrength
            / Math.sqrt(Math.max(1, Math.min(sourceDegree, targetDegree))),
        ),
      };
    });
  const linkDistanceByChildId = new Map(
    physicsEdges.map((edge) => [edge.targetId, edge.distance]),
  );
  const { radialTargetById, viewerId } = buildViewerRootedRadialTargets({
    nodes: orderedNodes,
    children,
    nodeById,
    collisionRadiusById,
    linkDistanceByChildId,
    subtreeSizeById: subtreeSize,
  });

  return {
    nodes: orderedNodes.map((node) => ({
      node,
      collisionRadius: collisionRadiusById.get(node.id) ?? 42,
      radialTarget: radialTargetById.get(node.id)
        ?? createRadialTarget(0, 0, -1),
    })),
    edges: physicsEdges,
    children,
    nodeById,
    viewerId,
  };
}

function buildRadialSeedLayout(
  topology: SampleRevenueGraphPhysicsTopology,
) {
  return new Map(topology.nodes.map(({ node, radialTarget }) => [
    node.id,
    {
      x: radialTarget.offsetX,
      y: radialTarget.offsetY,
    },
  ]));
}

function resolveHardCollisions(
  simNodes: SimulatedSampleRevenueNode[],
  fixedNodeId: string | null,
) {
  for (let iteration = 0; iteration < HARD_COLLISION_ITERATIONS; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < simNodes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < simNodes.length;
        rightIndex += 1
      ) {
        const left = simNodes[leftIndex];
        const right = simNodes[rightIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.001) {
          const unit = deterministicUnitVector(left.id, right.id);
          dx = unit.x;
          dy = unit.y;
          distance = 1;
        }
        const minimumDistance = left.collisionRadius
          + right.collisionRadius
          + COLLISION_SAFETY_GAP;
        if (distance >= minimumDistance) continue;
        const overlap = minimumDistance - distance;
        const unitX = dx / distance;
        const unitY = dy / distance;
        if (left.id === fixedNodeId) {
          right.x += unitX * overlap;
          right.y += unitY * overlap;
        } else if (right.id === fixedNodeId) {
          left.x -= unitX * overlap;
          left.y -= unitY * overlap;
        } else {
          const correction = overlap / 2;
          left.x -= unitX * correction;
          left.y -= unitY * correction;
          right.x += unitX * correction;
          right.y += unitY * correction;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function addBoundedGuidanceImpulse(
  node: SimulatedSampleRevenueNode,
  deltaX: number,
  deltaY: number,
  strength: number,
  alpha: number,
  maximumImpulse: number,
) {
  const rawImpulseX = deltaX * strength * alpha;
  const rawImpulseY = deltaY * strength * alpha;
  const rawMagnitude = Math.hypot(rawImpulseX, rawImpulseY);
  const scale = rawMagnitude > maximumImpulse
    ? maximumImpulse / rawMagnitude
    : 1;
  node.vx += rawImpulseX * scale;
  node.vy += rawImpulseY * scale;
}

function applyViewerRootedRadialGuidance(options: {
  simNodes: SimulatedSampleRevenueNode[];
  viewerId: string | null;
  centerX: number;
  centerY: number;
  alpha: number;
  fixedNodeId: string | null;
}) {
  const {
    simNodes,
    viewerId,
    centerX,
    centerY,
    alpha,
    fixedNodeId,
  } = options;
  const viewer = viewerId === null
    ? undefined
    : simNodes.find((node) => node.id === viewerId);
  const viewerX = viewer?.x ?? centerX;
  const viewerY = viewer?.y ?? centerY;

  for (const node of simNodes) {
    if (node.id === fixedNodeId) continue;
    if (node.id === viewerId) {
      addBoundedGuidanceImpulse(
        node,
        centerX - node.x,
        centerY - node.y,
        SAMPLE_REVENUE_RADIAL_GUIDANCE.viewerAnchorStrength,
        alpha,
        SAMPLE_REVENUE_RADIAL_GUIDANCE.viewerAnchorMaxImpulse,
      );
      continue;
    }
    addBoundedGuidanceImpulse(
      node,
      viewerX + node.radialTarget.offsetX - node.x,
      viewerY + node.radialTarget.offsetY - node.y,
      SAMPLE_REVENUE_RADIAL_GUIDANCE.targetStrength,
      alpha,
      SAMPLE_REVENUE_RADIAL_GUIDANCE.targetMaxImpulse,
    );
  }
}

function rebaseViewerTowardCenter(options: {
  simNodes: SimulatedSampleRevenueNode[];
  viewerId: string | null;
  centerX: number;
  centerY: number;
  fixedNodeId: string | null;
}) {
  const {
    simNodes,
    viewerId,
    centerX,
    centerY,
    fixedNodeId,
  } = options;
  if (viewerId === null || fixedNodeId !== null) return;
  const viewer = simNodes.find((node) => node.id === viewerId);
  if (!viewer) return;

  const rawOffsetX = (centerX - viewer.x)
    * SAMPLE_REVENUE_RADIAL_GUIDANCE.viewerAnchorStrength;
  const rawOffsetY = (centerY - viewer.y)
    * SAMPLE_REVENUE_RADIAL_GUIDANCE.viewerAnchorStrength;
  const rawMagnitude = Math.hypot(rawOffsetX, rawOffsetY);
  const scale = rawMagnitude
    > SAMPLE_REVENUE_RADIAL_GUIDANCE.viewerAnchorMaxImpulse
    ? SAMPLE_REVENUE_RADIAL_GUIDANCE.viewerAnchorMaxImpulse / rawMagnitude
    : 1;
  const offsetX = rawOffsetX * scale;
  const offsetY = rawOffsetY * scale;

  for (const node of simNodes) {
    node.x += offsetX;
    node.y += offsetY;
  }
}

export function buildSampleRevenueGraphLayout(
  nodes: readonly SampleRevenueGraphNode[],
  edges: readonly SampleRevenueGraphEdge[],
  topology = prepareSampleRevenueGraphPhysicsTopology(nodes, edges),
): Map<string, SampleRevenueGraphPoint> {
  if (nodes.length === 0) return new Map();
  const seed = buildRadialSeedLayout(topology);
  const simNodes = topology.nodes.map<SimulatedSampleRevenueNode>((entry) => ({
    id: entry.node.id,
    x: seed.get(entry.node.id)?.x ?? 0,
    y: seed.get(entry.node.id)?.y ?? 0,
    vx: 0,
    vy: 0,
    collisionRadius: entry.collisionRadius,
    radialTarget: entry.radialTarget,
  }));

  const viewer = topology.viewerId === null
    ? simNodes[0]
    : simNodes.find((node) => node.id === topology.viewerId) ?? simNodes[0];

  const availableOffset =
    SAMPLE_REVENUE_GRAPH_SURFACE_CENTER - SURFACE_EDGE_MARGIN;
  for (let pass = 0; pass < 3; pass += 1) {
    const maxOffset = Math.max(
      1,
      ...simNodes.flatMap((node) => [
        Math.abs(node.x) + node.collisionRadius,
        Math.abs(node.y) + node.collisionRadius,
      ]),
    );
    const surfaceScale = Math.min(1, availableOffset / maxOffset);
    if (surfaceScale < 1) {
      for (const node of simNodes) {
        if (node.id === viewer?.id) continue;
        node.x *= surfaceScale;
        node.y *= surfaceScale;
      }
    }
    resolveHardCollisions(simNodes, viewer?.id ?? null);
    if (surfaceScale === 1) break;
  }

  return new Map(simNodes.map((node) => [
    node.id,
    {
      x: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER + node.x,
      y: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER + node.y,
    },
  ]));
}

export function getSampleRevenueGraphNodeRadius(
  node: SampleRevenueGraphNode,
): number {
  if (node.isViewer) return 27;
  if (!node.eligible) return 21;
  const amountUnits = Math.max(0, node.expectedAllocationKrw) / 100_000;
  return 19 + Math.min(Math.log1p(amountUnits) * 3.1, 9);
}

export function getSampleRevenueGraphNodeColor(
  node: SampleRevenueGraphNode,
  isContext = false,
): string {
  if (isContext) return '#cbd5e1';
  if (node.isViewer) return '#facc15';
  if (!node.eligible) return '#94a3b8';
  return '#f97316';
}

export function getSampleRevenueGraphNodeStatusLabel(
  node: SampleRevenueGraphNode,
  isContext = false,
): string {
  if (isContext) return '선택 구간 연결 경로';
  if (node.isViewer) return '기준 viewer';
  if (!node.eligible) return '대상 제외';
  return `${node.depth}단계 예상 배분`;
}

export function getSampleRevenueContributionPath(
  selectedNodeId: string | null,
  nodes: readonly SampleRevenueGraphNode[],
  edges: readonly SampleRevenueGraphEdge[],
): SampleRevenueGraphEdge[] {
  if (selectedNodeId === null) return [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selectedNode = nodeById.get(selectedNodeId);
  if (!selectedNode || selectedNode.isViewer || !selectedNode.eligible) {
    return [];
  }

  const parentEdgesByChildId = new Map<string, SampleRevenueGraphEdge[]>();
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const parentEdges = parentEdgesByChildId.get(edge.target) ?? [];
    parentEdges.push(edge);
    parentEdgesByChildId.set(edge.target, parentEdges);
  }

  const path: SampleRevenueGraphEdge[] = [];
  const visited = new Set<string>();
  let childId = selectedNodeId;
  while (!visited.has(childId)) {
    visited.add(childId);
    const child = nodeById.get(childId);
    if (!child || (!child.isViewer && !child.eligible)) return [];
    if (child.isViewer) return path;

    const parentEdges = parentEdgesByChildId.get(childId) ?? [];
    if (parentEdges.length !== 1) return [];
    const edge = parentEdges[0];
    path.push(edge);
    childId = edge.source;
  }

  return [];
}

export function formatCompactSampleRevenueKrw(amountKrw: number): string {
  const rounded = Math.round(amountKrw);
  if (Math.abs(rounded) >= 10_000 && rounded % 10_000 === 0) {
    return `${(rounded / 10_000).toLocaleString('ko-KR')}만원`;
  }
  return `${rounded.toLocaleString('ko-KR')}원`;
}

export function formatSampleRevenueNodeAmount(amountKrw: number): string {
  const amountInTenThousands = Math.max(0, amountKrw) / 10_000;
  if (amountInTenThousands >= 10) {
    return `${Math.round(amountInTenThousands)}만`;
  }
  if (amountInTenThousands >= 1) {
    return `${Number(amountInTenThousands.toFixed(1))}만`;
  }
  return `${Math.round(Math.max(0, amountKrw) / 1_000)}천`;
}

export function stepSampleRevenueInteractivePhysics(options: {
  nodes: readonly SampleRevenueGraphNode[];
  edges: readonly SampleRevenueGraphEdge[];
  topology?: SampleRevenueGraphPhysicsTopology;
  motion: ReadonlyMap<string, SampleRevenueGraphMotionPoint>;
  alpha: number;
  ticks?: number;
  fixedNodeId?: string | null;
  fixedPosition?: SampleRevenueGraphPoint | null;
}): Map<string, SampleRevenueGraphMotionPoint> {
  const {
    nodes,
    edges,
    motion,
    fixedNodeId = null,
    fixedPosition = null,
  } = options;
  const alpha = clamp(options.alpha, 0.001, 1);
  const ticks = Math.max(1, Math.min(6, Math.round(options.ticks ?? 1)));
  const topology = options.topology
    ?? prepareSampleRevenueGraphPhysicsTopology(nodes, edges);
  const runtimeNodes = topology.nodes.map((entry) => {
    const point = motion.get(entry.node.id)
      ?? {
        x: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
        y: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
        vx: 0,
        vy: 0,
      };
    return {
      id: entry.node.id,
      x: point.x,
      y: point.y,
      vx: point.vx,
      vy: point.vy,
      collisionRadius: entry.collisionRadius,
      radialTarget: entry.radialTarget,
    };
  });
  const runtimeById = new Map(runtimeNodes.map((node) => [node.id, node]));
  const runtimeEdges = topology.edges
    .map((edge) => {
      const source = runtimeById.get(edge.sourceId);
      const target = runtimeById.get(edge.targetId);
      if (!source || !target) return null;
      return {
        source,
        target,
        distance: edge.distance,
        strength: edge.strength,
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => edge != null);
  const velocityRetention =
    1 - SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.velocityDecay;

  for (let tick = 0; tick < ticks; tick += 1) {
    if (fixedNodeId && fixedPosition) {
      const fixedNode = runtimeById.get(fixedNodeId);
      if (fixedNode) {
        fixedNode.x = fixedPosition.x;
        fixedNode.y = fixedPosition.y;
        fixedNode.vx = 0;
        fixedNode.vy = 0;
      }
    }
    applyViewerRootedRadialGuidance({
      simNodes: runtimeNodes,
      viewerId: topology.viewerId,
      centerX: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
      centerY: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
      alpha,
      fixedNodeId,
    });

    for (let leftIndex = 0; leftIndex < runtimeNodes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < runtimeNodes.length;
        rightIndex += 1
      ) {
        const left = runtimeNodes[leftIndex];
        const right = runtimeNodes[rightIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.001) {
          const unit = deterministicUnitVector(left.id, right.id);
          dx = unit.x;
          dy = unit.y;
          distance = 1;
        }
        if (distance > SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.chargeDistanceMax) {
          continue;
        }
        const effectiveDistance = Math.max(
          distance,
          SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.chargeDistanceMin,
        );
        const impulse = Math.abs(
          SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.chargeStrength,
        ) * alpha / (effectiveDistance * effectiveDistance);
        const forceX = dx * impulse;
        const forceY = dy * impulse;
        if (left.id !== fixedNodeId) {
          left.vx -= forceX;
          left.vy -= forceY;
        }
        if (right.id !== fixedNodeId) {
          right.vx += forceX;
          right.vy += forceY;
        }
      }
    }

    for (let linkIteration = 0; linkIteration < 2; linkIteration += 1) {
      for (const edge of runtimeEdges) {
        let dx = (edge.target.x + edge.target.vx)
          - (edge.source.x + edge.source.vx);
        let dy = (edge.target.y + edge.target.vy)
          - (edge.source.y + edge.source.vy);
        let distance = Math.hypot(dx, dy);
        if (distance < 0.001) {
          const unit = deterministicUnitVector(edge.source.id, edge.target.id);
          dx = unit.x;
          dy = unit.y;
          distance = 1;
        }
        let spring = (distance - edge.distance)
          / distance
          * alpha
          * edge.strength;
        if (
          distance
          > edge.distance
            * SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.linkTensionThresholdMultiplier
        ) {
          spring += (distance - edge.distance)
            / distance
            * alpha
            * SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.linkTensionStrength;
        }
        const forceX = dx * spring * 0.5;
        const forceY = dy * spring * 0.5;
        if (edge.source.id !== fixedNodeId) {
          edge.source.vx += forceX;
          edge.source.vy += forceY;
        }
        if (edge.target.id !== fixedNodeId) {
          edge.target.vx -= forceX;
          edge.target.vy -= forceY;
        }
      }
    }

    for (
      let collisionIteration = 0;
      collisionIteration
        < SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.collisionIterations;
      collisionIteration += 1
    ) {
      for (let leftIndex = 0; leftIndex < runtimeNodes.length; leftIndex += 1) {
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < runtimeNodes.length;
          rightIndex += 1
        ) {
          const left = runtimeNodes[leftIndex];
          const right = runtimeNodes[rightIndex];
          let dx = (right.x + right.vx) - (left.x + left.vx);
          let dy = (right.y + right.vy) - (left.y + left.vy);
          let distance = Math.hypot(dx, dy);
          if (distance < 0.001) {
            const unit = deterministicUnitVector(left.id, right.id);
            dx = unit.x;
            dy = unit.y;
            distance = 1;
          }
          const minimumDistance = left.collisionRadius
            + right.collisionRadius
            + COLLISION_SAFETY_GAP;
          if (distance >= minimumDistance) continue;
          const collision = (minimumDistance - distance)
            / distance
            * SAMPLE_REVENUE_ADMIN_WEB_PHYSICS.collisionStrength
            * 0.5;
          const forceX = dx * collision;
          const forceY = dy * collision;
          if (left.id !== fixedNodeId) {
            left.vx -= forceX;
            left.vy -= forceY;
          }
          if (right.id !== fixedNodeId) {
            right.vx += forceX;
            right.vy += forceY;
          }
        }
      }
    }

    for (const node of runtimeNodes) {
      if (node.id === fixedNodeId && fixedPosition) {
        node.x = fixedPosition.x;
        node.y = fixedPosition.y;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= velocityRetention;
      node.vy *= velocityRetention;
      const nextX = node.x + node.vx;
      const nextY = node.y + node.vy;
      if (Number.isFinite(nextX)) {
        node.x = nextX;
      } else {
        node.vx = 0;
      }
      if (Number.isFinite(nextY)) {
        node.y = nextY;
      } else {
        node.vy = 0;
      }
    }
    rebaseViewerTowardCenter({
      simNodes: runtimeNodes,
      viewerId: topology.viewerId,
      centerX: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
      centerY: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
      fixedNodeId,
    });
  }

  return new Map(runtimeNodes.map((node) => [
    node.id,
    {
      x: node.x,
      y: node.y,
      vx: node.vx,
      vy: node.vy,
    },
  ]));
}

export function getSampleRevenueGraphFitViewport(options: {
  nodes: readonly SampleRevenueGraphNode[];
  positions: ReadonlyMap<string, SampleRevenueGraphPoint>;
  width: number;
  height: number;
  padding?: number;
  insets?: Partial<{
    top: number;
    right: number;
    bottom: number;
    left: number;
  }>;
}): SampleRevenueGraphViewport {
  const { nodes, positions, width, height } = options;
  const padding = Math.max(
    0,
    options.padding ?? SAMPLE_REVENUE_GRAPH_FIT_PADDING,
  );
  const visiblePoints = nodes
    .map((node) => {
      const point = positions.get(node.id);
      if (!point) return null;
      return {
        ...point,
        radius: getSampleRevenueGraphNodeRadius(node) + 54,
      };
    })
    .filter(
      (
        point,
      ): point is SampleRevenueGraphPoint & { radius: number } => Boolean(point),
    );

  if (visiblePoints.length === 0 || width <= 0 || height <= 0) {
    return { scale: 1, panX: 0, panY: 0 };
  }

  const minX = Math.min(
    ...visiblePoints.map((point) => point.x - point.radius),
  );
  const maxX = Math.max(
    ...visiblePoints.map((point) => point.x + point.radius),
  );
  const minY = Math.min(
    ...visiblePoints.map((point) => point.y - point.radius),
  );
  const maxY = Math.max(
    ...visiblePoints.map((point) => point.y + point.radius),
  );
  const leftInset = Math.max(0, options.insets?.left ?? padding);
  const rightInset = Math.max(0, options.insets?.right ?? padding);
  const topInset = Math.max(0, options.insets?.top ?? padding);
  const bottomInset = Math.max(0, options.insets?.bottom ?? padding);
  const availableWidth = Math.max(1, width - leftInset - rightInset);
  const availableHeight = Math.max(1, height - topInset - bottomInset);
  const viewer = nodes.find((node) => node.isViewer);
  const viewerPoint = viewer ? positions.get(viewer.id) : undefined;
  const centerX = viewerPoint?.x ?? SAMPLE_REVENUE_GRAPH_SURFACE_CENTER;
  const centerY = viewerPoint?.y ?? SAMPLE_REVENUE_GRAPH_SURFACE_CENTER;
  const symmetricWidth = Math.max(
    1,
    Math.max(maxX - centerX, centerX - minX) * 2,
  );
  const symmetricHeight = Math.max(
    1,
    Math.max(maxY - centerY, centerY - minY) * 2,
  );
  const requiredFitScale = Math.min(
    availableWidth / symmetricWidth,
    availableHeight / symmetricHeight,
  );
  const scale = Math.max(
    Number.EPSILON,
    Math.min(requiredFitScale, SAMPLE_REVENUE_GRAPH_MAX_SCALE),
  );
  const viewportCenterX = leftInset + availableWidth / 2;
  const viewportCenterY = topInset + availableHeight / 2;

  return {
    scale,
    panX: viewportCenterX
      - width / 2
      - (centerX - SAMPLE_REVENUE_GRAPH_SURFACE_CENTER) * scale,
    panY: viewportCenterY
      - height / 2
      - (centerY - SAMPLE_REVENUE_GRAPH_SURFACE_CENTER) * scale,
  };
}
