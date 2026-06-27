import type { ReferralGraphPhysicsSettings } from '../types/referral-graph.ts';

const GOLDEN_ANGLE_FALLBACK = Math.PI * (3 - Math.sqrt(5));
const REFERRAL_GRAPH_ACTIVE_DRAG_FORCE_SCALE = 0.62;
const REFERRAL_GRAPH_ACTIVE_DRAG_MAX_VELOCITY_SCALE = 0.7;

export type ReferralGraphPhysicsTuning = {
  alphaDecay: number;
  velocityDecay: number;
  centerStrength: number;
  chargeStrength: number;
  chargeDistanceMin: number;
  chargeDistanceMax: number;
  linkDistance: number;
  linkStrength: number;
  layoutMemoryStrength: number;
};

export type ReferralGraphFreePhysicsTuning = {
  alphaDecay: number;
  velocityDecay: number;
  centerStrength: number;
  chargeStrength: number;
  chargeDistanceMin: number;
  chargeDistanceMax: number;
  linkDistance: number;
  linkStrength: number;
  collisionPadding: number;
  collisionStrength: number;
  collisionIterations: number;
  componentSeparationGap: number;
  componentSeparationStrength: number;
  linkTensionStrength: number;
  linkTensionThresholdMultiplier: number;
  dragReheatAlpha: number;
};

export type ReferralGraphDragTranslation = {
  x?: number;
  y?: number;
};
export type ReferralGraphDragLocalityForceOptions = {
  directNeighborVelocityScale: number;
  secondHopVelocityScale: number;
  backgroundVelocityScale: number;
  directNeighborMaxVelocity: number;
  secondHopMaxVelocity: number;
  backgroundMaxVelocity: number;
  directNeighborPullStrength: number;
  secondHopPullStrength: number;
};
export type ReferralGraphDragElasticTether = {
  nodeId: string;
  parentId: string;
  depth: number;
  restX: number;
  restY: number;
};
export type ReferralGraphDragElasticTetherForceOptions = {
  stiffness: number;
  damping: number;
  depthDecay: number;
  maxVelocity: number;
  minAlpha: number;
};
export type ReferralGraphPointerDragTarget = {
  nodeId: string;
  x: number;
  y: number;
};
export type ReferralGraphPointerDragForceOptions = {
  stiffness: number;
  damping: number;
  maxVelocity: number;
  minAlpha: number;
};

const DEFAULT_DRAG_LOCALITY_FORCE: ReferralGraphDragLocalityForceOptions = {
  directNeighborVelocityScale: 0.45,
  secondHopVelocityScale: 0.18,
  backgroundVelocityScale: 0.03,
  directNeighborMaxVelocity: 6,
  secondHopMaxVelocity: 1.5,
  backgroundMaxVelocity: 0.4,
  directNeighborPullStrength: 0.36,
  secondHopPullStrength: 0.055,
};
const DEFAULT_DRAG_ELASTIC_TETHER_FORCE: ReferralGraphDragElasticTetherForceOptions = {
  stiffness: 0.72,
  damping: 0.76,
  depthDecay: 1,
  maxVelocity: 220,
  minAlpha: 0.75,
};
const DEFAULT_POINTER_DRAG_FORCE: ReferralGraphPointerDragForceOptions = {
  stiffness: 1.18,
  damping: 0.66,
  maxVelocity: 220,
  minAlpha: 0.9,
};

type VelocityNode = {
  id: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
};

export type ReferralGraphLinkDistanceOptions = {
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

export const REFERRAL_GRAPH_MIN_NODE_DISTANCE = 112;
export const REFERRAL_GRAPH_ENGINE_COOLDOWN = {
  alphaMin: 0.018,
  cooldownTicks: 360,
  cooldownTimeMs: 8000,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hasActiveReferralGraphDrag(options: { activeDraggedNodeIdRef?: { current: string | null } }) {
  return Boolean(options.activeDraggedNodeIdRef?.current);
}

function scaleReferralGraphActiveDragStrength(
  strength: number,
  options: { activeDraggedNodeIdRef?: { current: string | null } },
  scale = REFERRAL_GRAPH_ACTIVE_DRAG_FORCE_SCALE,
) {
  return hasActiveReferralGraphDrag(options) ? strength * scale : strength;
}

function scaleReferralGraphActiveDragMaxVelocity(
  maxVelocity: number,
  options: { activeDraggedNodeIdRef?: { current: string | null } },
  scale = REFERRAL_GRAPH_ACTIVE_DRAG_MAX_VELOCITY_SCALE,
) {
  return hasActiveReferralGraphDrag(options) ? maxVelocity * scale : maxVelocity;
}

export function getReferralGraphMinimumNodeDistance(graphNodeCount = 0) {
  return Math.round(REFERRAL_GRAPH_MIN_NODE_DISTANCE + clamp((Math.max(0, graphNodeCount) - 90) * 0.14, 0, 28));
}

export function isReferralGraphMeaningfulDrag(
  translate: ReferralGraphDragTranslation | undefined,
  threshold = 8,
) {
  if (!translate) {
    return false;
  }

  const x = Number.isFinite(translate.x) ? translate.x ?? 0 : 0;
  const y = Number.isFinite(translate.y) ? translate.y ?? 0 : 0;
  return Math.hypot(x, y) >= Math.max(0, threshold);
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

function getShortestAngleDelta(targetAngle: number, currentAngle: number) {
  let delta = targetAngle - currentAngle;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
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

export type ReferralGraphLayoutMemoryNode = {
  id: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

export type ReferralGraphLayoutMemoryTarget = {
  x: number;
  y: number;
};

export type ReferralGraphLayoutMemoryForceOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  maxTicks?: number;
  minimumAnchorRatio?: number;
  manualNodeTargetsRef?: {
    current: Map<string, ReferralGraphLayoutMemoryTarget>;
  };
  nodeComponentIndex?: Map<string, number>;
  suppressedNodeIdsRef?: {
    current: Set<string>;
  };
};

function hasFiniteCoordinate(value: number | undefined): value is number {
  return Number.isFinite(value);
}

export function applyReferralGraphLayoutMemory(
  node: ReferralGraphLayoutMemoryNode,
  target: ReferralGraphLayoutMemoryTarget,
  strength: number,
) {
  if (
    node.fx != null
    || node.fy != null
    || !hasFiniteCoordinate(node.x)
    || !hasFiniteCoordinate(node.y)
  ) {
    return;
  }

  node.vx = (node.vx ?? 0) + ((target.x - node.x) * strength);
  node.vy = (node.vy ?? 0) + ((target.y - node.y) * strength);
}

export function getReferralGraphLinkDistance(
  sourceDegree: number,
  targetDegree: number,
  baseDistance: number,
  options: ReferralGraphLinkDistanceOptions = {},
) {
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
  const densityBonus = graphNodeCount > 90
    ? clamp((graphNodeCount - 90) * 0.22, 0, 48)
    : 0;
  const hasExplicitBranchShape = options.targetChildCount != null || options.targetSubtreeSize != null;
  const isSparseBranchBridge = isBranchBridge
    && hasExplicitBranchShape
    && sourceChildCount <= 2
    && localBranchChildCount <= 1;
  let resolvedDistance: number;

  if (isBranchBridge) {
    const branchBridgeJitter = getBranchBridgeDistanceJitter(options);
    resolvedDistance = isSparseBranchBridge
      ? clamp(
        205
          + (Math.sqrt(localBranchSubtreeSize) * 3)
          + (localBranchChildCount * 6)
          + (densityBonus * 0.15)
          + (branchBridgeJitter * 0.35),
        210,
        230,
      )
      : clamp(
        240
          + (Math.sqrt(localBranchSubtreeSize) * 11)
          + (localBranchChildCount * 9.4)
          + (Math.sqrt(localBranchChildCount) * 3.5)
          + (densityBonus * 0.45)
          + branchBridgeJitter,
        250,
        430,
      );
  } else if (isLeafSpoke || (minDegree <= 1 && maxDegree >= 3)) {
    const terminalLeafJitter = isLeafSpoke ? getTerminalLeafDistanceJitter(options) : 0;
    const crowdedLeafDistance = isLeafSpoke
      ? 112
        + (Math.pow(Math.max(0, sourceChildCount - 2), 0.82) * 20)
        + (Math.sqrt(Math.max(1, graphNodeCount)) * 2.2)
      : 0;
    resolvedDistance = clamp(
      Math.max(
        clampedBase * 0.36,
        125 + (Math.sqrt(maxChildCount) * 8) + (densityBonus * 0.15) + terminalLeafJitter,
        crowdedLeafDistance + terminalLeafJitter,
      ),
      118,
      300,
    );
  } else if (minDegree <= 2 && maxDegree >= 3) {
    resolvedDistance = clamp(clampedBase * 0.44, 92, 135);
  } else if (minDegree >= 3 && maxDegree >= 3) {
    resolvedDistance = clamp(clampedBase * 0.82, 155, 245);
  } else {
    resolvedDistance = clampedBase;
  }

  if (isBranchBridge && !isSparseBranchBridge) {
    const sourcePressure = Math.max(0, Math.sqrt(sourceChildCount) - Math.sqrt(localBranchChildCount + 1));
    const sourceBridgeSubtreePressure = Math.max(
      0,
      Math.sqrt(localBranchSubtreeSize) - Math.sqrt(localBranchChildCount + 1),
    );
    const sourceFanoutBridgeDistance = 248
      + (sourcePressure * 16)
      + (sourceBridgeSubtreePressure * 16)
      + (Math.sqrt(localBranchChildCount) * 9)
      + (densityBonus * 0.35);
    resolvedDistance = Math.max(resolvedDistance, clamp(sourceFanoutBridgeDistance, 250, 400));
  }

  if (isBranchBridge && !isSparseBranchBridge) {
    const subtreePressure = Math.max(
      0,
      Math.sqrt(localBranchSubtreeSize) - Math.sqrt(Math.max(1, localBranchChildCount + 1)),
    );
    const fanoutPressure = Math.sqrt(localBranchChildCount);
    const subtreeDistance = 226
      + (fanoutPressure * 24)
      + (subtreePressure * 28)
      + (densityBonus * 0.45);
    resolvedDistance = Math.max(resolvedDistance, clamp(subtreeDistance, 250, 430));
  }

  return Math.round(resolvedDistance);
}

function getLinkEndpointId<T extends ReferralGraphLayoutMemoryNode>(value: string | T) {
  return typeof value === 'object' ? value.id : value;
}

export type ReferralGraphDragSpringLink<T extends ReferralGraphLayoutMemoryNode> = {
  source: string | T;
  target: string | T;
};

export type ReferralGraphDragSpringOptions = {
  baseLinkDistance: number;
  childCountByNodeId: Map<string, number>;
  constraintStrength?: number;
  degreeByNodeId: Map<string, number>;
  graphNodeCount?: number;
  maxVelocity?: number;
  preventStretch?: boolean;
  stretchSlack?: number;
  strength?: number;
  subtreeSizeByNodeId?: Map<string, number>;
  velocityDamping?: number;
};

export type ReferralGraphLinkTensionOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  baseLinkDistance: number;
  childCountByNodeId: Map<string, number>;
  degreeByNodeId: Map<string, number>;
  graphNodeCount?: number;
  maxVelocity?: number;
  strength?: number;
  suppressedNodeIdsRef?: {
    current: Set<string>;
  };
  subtreeSizeByNodeId?: Map<string, number>;
  thresholdMultiplier?: number;
};

export type ReferralGraphClusterSeparationOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  gap?: number;
  maxVelocity?: number;
  nodeClusterIndex: Map<string, number>;
  clusterRadii: Map<number, number>;
  softening?: number;
  strength?: number;
  singletonGapFactor?: number;
  suppressedNodeIdsRef?: {
    current: Set<string>;
  };
};

export type ReferralGraphClusterGravityOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  centerX?: number;
  centerY?: number;
  deadZoneRadius?: number;
  gravityScale?: number;
  maxVelocity?: number;
  minAlpha?: number;
  nodeClusterIndex: Map<string, number>;
  softening?: number;
  strength?: number;
  singletonStrengthFactor?: number;
  singletonDeadZoneRadius?: number;
  suppressedNodeIdsRef?: {
    current: Set<string>;
  };
};

export type ReferralGraphNodeSeparationOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  crossClusterDistance?: number;
  crossComponentDistance?: number;
  minDistance?: number;
  nodeClusterIndex: Map<string, number>;
  nodeComponentIndex?: Map<string, number>;
  maxVelocity?: number;
  strength?: number;
  suppressedNodeIdsRef?: {
    current: Set<string>;
  };
};

export type ReferralGraphBranchBendOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  childCountByNodeId: Map<string, number>;
  degreeByNodeId: Map<string, number>;
  links: Array<ReferralGraphDragSpringLink<ReferralGraphLayoutMemoryNode>>;
  maxVelocity?: number;
  minAlpha?: number;
  strength?: number;
  suppressedNodeIdsRef?: {
    current: Set<string>;
  };
};

export type ReferralGraphSiblingAngularOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  anchorPositions?: Map<string, ReferralGraphLayoutMemoryTarget>;
  links: Array<ReferralGraphDragSpringLink<ReferralGraphLayoutMemoryNode>>;
  minAlpha?: number;
  maxVelocity?: number;
  minOpenGap?: number;
  strength?: number;
  suppressedNodeIdsRef?: {
    current: Set<string>;
  };
};

export type ReferralGraphEdgeCrossingOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  anchorPositions?: Map<string, ReferralGraphLayoutMemoryTarget>;
  anchorCorrectionStrength?: number;
  links: Array<ReferralGraphDragSpringLink<ReferralGraphLayoutMemoryNode>>;
  maxPairs?: number;
  maxVelocity?: number;
  minDistance?: number;
  minAlpha?: number;
  strength?: number;
  suppressedNodeIdsRef?: {
    current: Set<string>;
  };
};

export type ReferralGraphComponentEnvelopeOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  componentRadii: Map<number, number>;
  maxVelocity?: number;
  nodeComponentIndex: Map<string, number>;
  strength?: number;
};

export type ReferralGraphComponentCohesionOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  componentRadii: Map<number, number>;
  maxVelocity?: number;
  nodeComponentIndex: Map<string, number>;
  strength?: number;
};

export function applyReferralGraphDragSpring<T extends ReferralGraphLayoutMemoryNode>(
  draggedNode: T,
  nodesById: Map<string, T>,
  links: Array<ReferralGraphDragSpringLink<T>>,
  options: ReferralGraphDragSpringOptions,
) {
  if (
    !hasFiniteCoordinate(draggedNode.x)
    || !hasFiniteCoordinate(draggedNode.y)
  ) {
    return;
  }

  if (options.preventStretch) {
    return;
  }

  const strength = clamp(options.strength ?? 0.32, 0, 0.6);
  const maxVelocity = clamp(options.maxVelocity ?? 28, 1, 120);

  for (const link of links) {
    const sourceId = getLinkEndpointId(link.source);
    const targetId = getLinkEndpointId(link.target);
    const neighborId = sourceId === draggedNode.id
      ? targetId
      : targetId === draggedNode.id
        ? sourceId
        : null;

    if (!neighborId) {
      continue;
    }

    const neighbor = nodesById.get(neighborId);
    if (
      !neighbor
      || neighbor.fx != null
      || neighbor.fy != null
      || !hasFiniteCoordinate(neighbor.x)
      || !hasFiniteCoordinate(neighbor.y)
    ) {
      continue;
    }

    const dx = draggedNode.x - neighbor.x;
    const dy = draggedNode.y - neighbor.y;
    const distance = Math.hypot(dx, dy) || 1;
    const targetDistance = getReferralGraphLinkDistance(
      options.degreeByNodeId.get(sourceId) ?? 1,
      options.degreeByNodeId.get(targetId) ?? 1,
      options.baseLinkDistance,
      {
        sourceHasChildren: (options.childCountByNodeId.get(sourceId) ?? 0) > 0,
        sourceId,
        targetHasChildren: (options.childCountByNodeId.get(targetId) ?? 0) > 0,
        targetId,
        sourceChildCount: options.childCountByNodeId.get(sourceId) ?? 0,
        targetChildCount: options.childCountByNodeId.get(targetId) ?? 0,
        sourceSubtreeSize: options.subtreeSizeByNodeId?.get(sourceId) ?? 1,
        targetSubtreeSize: options.subtreeSizeByNodeId?.get(targetId) ?? 1,
        graphNodeCount: options.graphNodeCount,
      },
    );
    const excess = distance - targetDistance;
    if (excess <= 0) {
      continue;
    }

    const velocity = Math.min(maxVelocity, excess * strength);
    neighbor.vx = (neighbor.vx ?? 0) + (dx / distance) * velocity;
    neighbor.vy = (neighbor.vy ?? 0) + (dy / distance) * velocity;
  }
}

export function createReferralGraphDragSpringForce<T extends ReferralGraphLayoutMemoryNode>(
  draggedNodeIdRef: { current: string | null },
  nodesByIdRef: { current: Map<string, T> },
  links: Array<ReferralGraphDragSpringLink<T>>,
  options: ReferralGraphDragSpringOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodesById = nodesByIdRef.current;

  const force = (() => {
    nodesById = nodesByIdRef.current;
    const draggedNodeId = draggedNodeIdRef.current;
    if (!draggedNodeId) {
      return;
    }

    const draggedNode = nodesById.get(draggedNodeId);
    if (!draggedNode) {
      return;
    }

    applyReferralGraphDragSpring(draggedNode, nodesById, links, options);
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (nodes: T[]) => {
    nodesById = new Map(nodes.map((node) => [node.id, node]));
  };

  return force;
}

function resolveLinkedNode<T extends ReferralGraphLayoutMemoryNode>(
  value: string | T,
  nodesById: Map<string, T>,
) {
  return typeof value === 'object' ? value : nodesById.get(value);
}

function isActiveDragSuppressedNode(
  nodeId: string | undefined,
  activeDraggedNodeId: string | null | undefined,
  suppressedNodeIds: Set<string> | undefined,
) {
  if (!nodeId || !activeDraggedNodeId) {
    return false;
  }

  return nodeId === activeDraggedNodeId || Boolean(suppressedNodeIds?.has(nodeId));
}

export function createReferralGraphLinkTensionForce<T extends ReferralGraphLayoutMemoryNode>(
  links: Array<ReferralGraphDragSpringLink<T>>,
  options: ReferralGraphLinkTensionOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodesById = new Map<string, T>();

  const force = ((alpha: number) => {
    const strength = clamp(options.strength ?? 0.3, 0, 0.7) * alpha;
    const maxVelocity = clamp(options.maxVelocity ?? 22, 1, 48);
    const thresholdMultiplier = clamp(options.thresholdMultiplier ?? 1.06, 0.82, 2.5);

    for (const link of links) {
      const sourceId = getLinkEndpointId(link.source);
      const targetId = getLinkEndpointId(link.target);
      const suppressedNodeIds = options.suppressedNodeIdsRef?.current;
      if (suppressedNodeIds?.has(sourceId) || suppressedNodeIds?.has(targetId)) {
        continue;
      }

      const source = resolveLinkedNode(link.source, nodesById);
      const target = resolveLinkedNode(link.target, nodesById);

      if (
        !source
        || !target
        || !hasFiniteCoordinate(source.x)
        || !hasFiniteCoordinate(source.y)
        || !hasFiniteCoordinate(target.x)
        || !hasFiniteCoordinate(target.y)
      ) {
        continue;
      }

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1;
      const targetDistance = getReferralGraphLinkDistance(
        options.degreeByNodeId.get(sourceId) ?? 1,
        options.degreeByNodeId.get(targetId) ?? 1,
        options.baseLinkDistance,
        {
          sourceHasChildren: (options.childCountByNodeId.get(sourceId) ?? 0) > 0,
          sourceId,
          targetHasChildren: (options.childCountByNodeId.get(targetId) ?? 0) > 0,
          targetId,
          sourceChildCount: options.childCountByNodeId.get(sourceId) ?? 0,
          targetChildCount: options.childCountByNodeId.get(targetId) ?? 0,
          sourceSubtreeSize: options.subtreeSizeByNodeId?.get(sourceId) ?? 1,
          targetSubtreeSize: options.subtreeSizeByNodeId?.get(targetId) ?? 1,
          graphNodeCount: options.graphNodeCount,
        },
      );

      if (distance <= targetDistance * thresholdMultiplier) {
        continue;
      }

      const sourceMovable = source.fx == null && source.fy == null;
      const targetMovable = target.fx == null && target.fy == null;
      if (!sourceMovable && !targetMovable) {
        continue;
      }

      const velocity = Math.min(maxVelocity, (distance - targetDistance) * strength);
      const unitX = dx / distance;
      const unitY = dy / distance;
      const sourceShare = sourceMovable && targetMovable ? 0.5 : sourceMovable ? 1 : 0;
      const targetShare = sourceMovable && targetMovable ? 0.5 : targetMovable ? 1 : 0;

      if (sourceShare > 0) {
        source.vx = (source.vx ?? 0) + unitX * velocity * sourceShare;
        source.vy = (source.vy ?? 0) + unitY * velocity * sourceShare;
      }

      if (targetShare > 0) {
        target.vx = (target.vx ?? 0) - unitX * velocity * targetShare;
        target.vy = (target.vy ?? 0) - unitY * velocity * targetShare;
      }
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (nodes: T[]) => {
    nodesById = new Map(nodes.map((node) => [node.id, node]));
  };

  return force;
}

function clampVelocity(node: VelocityNode, maxVelocity: number) {
  const vx = node.vx ?? 0;
  const vy = node.vy ?? 0;
  const speed = Math.hypot(vx, vy);
  if (speed === 0 || speed <= maxVelocity) {
    return;
  }

  const scale = maxVelocity / speed;
  node.vx = vx * scale;
  node.vy = vy * scale;
}

function applyLocalDragPull(
  node: VelocityNode,
  draggedNode: VelocityNode | undefined,
  alpha: number,
  strength: number,
) {
  if (
    !draggedNode
    || !hasFiniteCoordinate(node.x)
    || !hasFiniteCoordinate(node.y)
    || !hasFiniteCoordinate(draggedNode.x)
    || !hasFiniteCoordinate(draggedNode.y)
  ) {
    return;
  }

  node.vx = (node.vx ?? 0) + ((draggedNode.x - node.x) * strength * alpha);
  node.vy = (node.vy ?? 0) + ((draggedNode.y - node.y) * strength * alpha);
}

export function createReferralGraphDragLocalityForce<T extends VelocityNode>(
  activeDraggedNodeIdRef: { current: string | null },
  activeNodeDepthsRef: { current: Map<string, number> },
  options: Partial<ReferralGraphDragLocalityForceOptions> = {},
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  const config = {
    ...DEFAULT_DRAG_LOCALITY_FORCE,
    ...options,
  };
  let nodes: T[] = [];

  const force = ((alpha: number) => {
    const draggedNodeId = activeDraggedNodeIdRef.current;
    if (!draggedNodeId) {
      return;
    }
    const draggedNode = nodes.find((node) => node.id === draggedNodeId);
    let directNeighborCount = 0;
    for (const depth of activeNodeDepthsRef.current.values()) {
      if (depth === 1) {
        directNeighborCount += 1;
      }
    }
    const directPullMultiplier = directNeighborCount >= 8 ? 0.72 : directNeighborCount <= 2 ? 1.25 : 1;
    const directMaxVelocityMultiplier = directNeighborCount >= 8 ? 0.78 : directNeighborCount <= 2 ? 1.15 : 1;

    for (const node of nodes) {
      if (node.id === draggedNodeId) {
        continue;
      }

      const depth = activeNodeDepthsRef.current.get(node.id);
      if (depth === 1) {
        node.vx = (node.vx ?? 0) * config.directNeighborVelocityScale;
        node.vy = (node.vy ?? 0) * config.directNeighborVelocityScale;
        applyLocalDragPull(
          node,
          draggedNode,
          alpha,
          config.directNeighborPullStrength * directPullMultiplier,
        );
        clampVelocity(node, config.directNeighborMaxVelocity * directMaxVelocityMultiplier);
        continue;
      }

      if (depth === 2) {
        node.vx = (node.vx ?? 0) * config.secondHopVelocityScale;
        node.vy = (node.vy ?? 0) * config.secondHopVelocityScale;
        applyLocalDragPull(node, draggedNode, alpha, config.secondHopPullStrength);
        clampVelocity(node, config.secondHopMaxVelocity);
        continue;
      }

      node.vx = (node.vx ?? 0) * config.backgroundVelocityScale;
      node.vy = (node.vy ?? 0) * config.backgroundVelocityScale;
      clampVelocity(node, config.backgroundMaxVelocity);
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (nextNodes: T[]) => {
    nodes = nextNodes;
  };

  return force;
}

export function createReferralGraphDragElasticTetherForce<T extends VelocityNode>(
  activeDraggedNodeIdRef: { current: string | null },
  activeDragTethersRef: { current: Map<string, ReferralGraphDragElasticTether> },
  options: Partial<ReferralGraphDragElasticTetherForceOptions> = {},
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  const config = {
    ...DEFAULT_DRAG_ELASTIC_TETHER_FORCE,
    ...options,
  };
  let nodesById = new Map<string, T>();

  const force = ((alpha: number) => {
    if (!activeDraggedNodeIdRef.current || activeDragTethersRef.current.size === 0) {
      return;
    }

    const effectiveAlpha = Math.max(alpha, config.minAlpha);
    const tethers = [...activeDragTethersRef.current.values()]
      .sort((left, right) => left.depth - right.depth);

    for (const tether of tethers) {
      const node = nodesById.get(tether.nodeId);
      const parent = nodesById.get(tether.parentId);
      if (
        !node
        || !parent
        || !hasFiniteCoordinate(node.x)
        || !hasFiniteCoordinate(node.y)
        || !hasFiniteCoordinate(parent.x)
        || !hasFiniteCoordinate(parent.y)
      ) {
        continue;
      }

      const targetX = parent.x + tether.restX;
      const targetY = parent.y + tether.restY;
      const depthFactor = config.depthDecay ** Math.max(0, tether.depth - 1);
      const spring = config.stiffness * depthFactor * effectiveAlpha;

      node.vx = ((node.vx ?? 0) * config.damping) + ((targetX - node.x) * spring);
      node.vy = ((node.vy ?? 0) * config.damping) + ((targetY - node.y) * spring);
      clampVelocity(node, config.maxVelocity * Math.max(0.32, depthFactor));
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (nodes: T[]) => {
    nodesById = new Map(nodes.map((node) => [node.id, node]));
  };

  return force;
}

export function createReferralGraphPointerDragForce<T extends VelocityNode>(
  pointerDragTargetRef: { current: ReferralGraphPointerDragTarget | null },
  options: Partial<ReferralGraphPointerDragForceOptions> = {},
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  const config = {
    ...DEFAULT_POINTER_DRAG_FORCE,
    ...options,
  };
  let nodesById = new Map<string, T>();

  const force = ((alpha: number) => {
    const target = pointerDragTargetRef.current;
    if (!target) {
      return;
    }

    const node = nodesById.get(target.nodeId);
    if (
      !node
      || !hasFiniteCoordinate(node.x)
      || !hasFiniteCoordinate(node.y)
    ) {
      return;
    }

    const effectiveAlpha = Math.max(alpha, config.minAlpha);
    const spring = config.stiffness * effectiveAlpha;
    node.vx = ((node.vx ?? 0) * config.damping) + ((target.x - node.x) * spring);
    node.vy = ((node.vy ?? 0) * config.damping) + ((target.y - node.y) * spring);
    clampVelocity(node, config.maxVelocity);
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (nodes: T[]) => {
    nodesById = new Map(nodes.map((node) => [node.id, node]));
  };

  return force;
}

export function createReferralGraphBranchBendForce<T extends ReferralGraphLayoutMemoryNode>(
  options: ReferralGraphBranchBendOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodesById = new Map<string, T>();
  let adjacency = new Map<string, string[]>();
  let directedSingleChildByNodeId = new Map<string, string>();

  const force = ((alpha: number) => {
    const effectiveAlpha = Math.max(alpha, clamp(options.minAlpha ?? 0, 0, 0.08));
    const strength = scaleReferralGraphActiveDragStrength(
      clamp((options.strength ?? 0.18) * effectiveAlpha, 0, 0.42),
      options,
    );
    const maxVelocity = scaleReferralGraphActiveDragMaxVelocity(
      clamp(options.maxVelocity ?? 12, 1, 30),
      options,
    );
    if (strength <= 0) {
      return;
    }
    const activeDraggedNodeId = options.activeDraggedNodeIdRef?.current;
    const suppressedNodeIds = options.suppressedNodeIdsRef?.current;

    for (const [nodeId, neighborIds] of adjacency) {
      if (neighborIds.length !== 2) {
        continue;
      }
      if (isActiveDragSuppressedNode(nodeId, activeDraggedNodeId, suppressedNodeIds)) {
        continue;
      }

      const childId = directedSingleChildByNodeId.get(nodeId);
      const hasOneDirectedChild = Boolean(childId);
      const hasTwoGraphNeighbors = (options.degreeByNodeId.get(nodeId) ?? 0) === 2;
      if (!hasOneDirectedChild || !hasTwoGraphNeighbors) {
        continue;
      }

      const node = nodesById.get(nodeId);
      const child = childId ? nodesById.get(childId) : undefined;
      const parentId = childId ? neighborIds.find((neighborId) => neighborId !== childId) : undefined;
      if (
        isActiveDragSuppressedNode(parentId, activeDraggedNodeId, suppressedNodeIds)
        || isActiveDragSuppressedNode(childId, activeDraggedNodeId, suppressedNodeIds)
      ) {
        continue;
      }

      const parent = parentId ? nodesById.get(parentId) : undefined;
      const left = parent;
      const right = child;
      if (
        !node
        || !left
        || !right
        || !child
        || !parent
        || node.fx != null
        || node.fy != null
        || !hasFiniteCoordinate(node.x)
        || !hasFiniteCoordinate(node.y)
        || !hasFiniteCoordinate(left.x)
        || !hasFiniteCoordinate(left.y)
        || !hasFiniteCoordinate(right.x)
        || !hasFiniteCoordinate(right.y)
      ) {
        continue;
      }

      const leftX = left.x - node.x;
      const leftY = left.y - node.y;
      const rightX = right.x - node.x;
      const rightY = right.y - node.y;
      const leftDistance = Math.hypot(leftX, leftY);
      const rightDistance = Math.hypot(rightX, rightY);
      if (leftDistance < 1e-6 || rightDistance < 1e-6) {
        continue;
      }

      const cosine = ((leftX * rightX) + (leftY * rightY)) / (leftDistance * rightDistance);
      const straightness = clamp((-0.28 - cosine) / 0.72, 0, 1);
      if (straightness <= 0) {
        continue;
      }

      const bridgeX = right.x - left.x;
      const bridgeY = right.y - left.y;
      const bridgeDistance = Math.hypot(bridgeX, bridgeY) || 1;
      const side = (hashString(`${nodeId}:branch-bend`) % 2) === 0 ? 1 : -1;
      const unitX = (-bridgeY / bridgeDistance) * side;
      const unitY = (bridgeX / bridgeDistance) * side;
      const velocity = Math.min(maxVelocity, Math.max(8, bridgeDistance * 0.12) * straightness * strength);

      node.vx = (node.vx ?? 0) + unitX * velocity;
      node.vy = (node.vy ?? 0) + unitY * velocity;

      const rotationalVelocity = Math.min(maxVelocity, Math.max(10, bridgeDistance * 0.16) * straightness * strength);
      if (child.fx == null && child.fy == null) {
        child.vx = (child.vx ?? 0) + unitX * rotationalVelocity * 0.85;
        child.vy = (child.vy ?? 0) + unitY * rotationalVelocity * 0.85;
      }

      if (parent.fx == null && parent.fy == null) {
        parent.vx = (parent.vx ?? 0) - unitX * rotationalVelocity * 0.45;
        parent.vy = (parent.vy ?? 0) - unitY * rotationalVelocity * 0.45;
      }
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (nodes: T[]) => {
    nodesById = new Map(nodes.map((node) => [node.id, node]));
    const nextAdjacency = new Map<string, Set<string>>();
    const directedChildrenByNodeId = new Map<string, string[]>();

    for (const link of options.links) {
      const sourceId = getLinkEndpointId(link.source);
      const targetId = getLinkEndpointId(link.target);
      if (!nodesById.has(sourceId) || !nodesById.has(targetId)) {
        continue;
      }

      const sourceNeighbors = nextAdjacency.get(sourceId) ?? new Set<string>();
      sourceNeighbors.add(targetId);
      nextAdjacency.set(sourceId, sourceNeighbors);

      const targetNeighbors = nextAdjacency.get(targetId) ?? new Set<string>();
      targetNeighbors.add(sourceId);
      nextAdjacency.set(targetId, targetNeighbors);

      const directedChildren = directedChildrenByNodeId.get(sourceId) ?? [];
      directedChildren.push(targetId);
      directedChildrenByNodeId.set(sourceId, directedChildren);
    }

    adjacency = new Map(
      [...nextAdjacency.entries()].map(([nodeId, neighborIds]) => [
        nodeId,
        [...neighborIds].sort(),
      ]),
    );
    directedSingleChildByNodeId = new Map(
      [...directedChildrenByNodeId.entries()]
        .filter(([, childIds]) => childIds.length === 1)
        .map(([nodeId, childIds]) => [nodeId, childIds[0]]),
    );
  };

  return force;
}

export function createReferralGraphSiblingAngularForce<T extends ReferralGraphLayoutMemoryNode>(
  options: ReferralGraphSiblingAngularOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodesById = new Map<string, T>();
  let childrenByParentId = new Map<string, string[]>();

  const force = ((alpha: number) => {
    if (hasActiveReferralGraphDrag(options)) {
      return;
    }

    const effectiveAlpha = Math.max(alpha, clamp(options.minAlpha ?? 0, 0, 0.08));
    const strength = scaleReferralGraphActiveDragStrength(
      clamp((options.strength ?? 0.3) * effectiveAlpha, 0, 0.95),
      options,
    );
    const maxVelocity = scaleReferralGraphActiveDragMaxVelocity(
      clamp(options.maxVelocity ?? 16, 1, 80),
      options,
    );
    if (strength <= 0) {
      return;
    }
    const activeDraggedNodeId = options.activeDraggedNodeIdRef?.current;
    const suppressedNodeIds = options.suppressedNodeIdsRef?.current;

    for (const [parentId, childIds] of childrenByParentId) {
      if (childIds.length < 2) {
        continue;
      }
      if (isActiveDragSuppressedNode(parentId, activeDraggedNodeId, suppressedNodeIds)) {
        continue;
      }

      const parent = nodesById.get(parentId);
      if (!parent || !hasFiniteCoordinate(parent.x) || !hasFiniteCoordinate(parent.y)) {
        continue;
      }

      const parentX = parent.x;
      const parentY = parent.y;
      const parentAnchor = options.anchorPositions?.get(parentId);
      const children = childIds
        .map((childId) => {
          if (isActiveDragSuppressedNode(childId, activeDraggedNodeId, suppressedNodeIds)) {
            return null;
          }

          const child = nodesById.get(childId);
          if (
            !child
            || child.fx != null
            || child.fy != null
            || !hasFiniteCoordinate(child.x)
            || !hasFiniteCoordinate(child.y)
          ) {
            return null;
          }

          const dx = child.x - parentX;
          const dy = child.y - parentY;
          const distance = Math.hypot(dx, dy);
          if (distance < 1e-6) {
            return null;
          }
          const childAnchor = options.anchorPositions?.get(childId);
          const targetAngle = parentAnchor && childAnchor
            ? Math.atan2(childAnchor.y - parentAnchor.y, childAnchor.x - parentAnchor.x)
            : null;

          return {
            angle: Math.atan2(dy, dx),
            child,
            distance,
            targetAngle,
          };
        })
        .filter((entry): entry is { angle: number; child: T; distance: number; targetAngle: number | null } => entry != null)
        .sort((left, right) => left.angle - right.angle);

      if (children.length < 2) {
        continue;
      }

      for (const entry of children) {
        if (entry.targetAngle == null) {
          continue;
        }

        const angleDelta = getShortestAngleDelta(entry.targetAngle, entry.angle);
        if (Math.abs(angleDelta) < 0.015) {
          continue;
        }

        const velocity = Math.min(
          maxVelocity,
          Math.abs(angleDelta) * Math.min(240, entry.distance) * strength * 0.88,
        );
        const tangentX = -Math.sin(entry.angle);
        const tangentY = Math.cos(entry.angle);
        const direction = Math.sign(angleDelta);
        entry.child.vx = (entry.child.vx ?? 0) + tangentX * velocity * direction;
        entry.child.vy = (entry.child.vy ?? 0) + tangentY * velocity * direction;

        const angularCorrection = clamp(strength * 0.65, 0, 0.32);
        const desiredX = parentX + Math.cos(entry.targetAngle) * entry.distance;
        const desiredY = parentY + Math.sin(entry.targetAngle) * entry.distance;
        const childX = entry.child.x;
        const childY = entry.child.y;
        if (!hasFiniteCoordinate(childX) || !hasFiniteCoordinate(childY)) {
          continue;
        }
        entry.child.x = childX + (desiredX - childX) * angularCorrection;
        entry.child.y = childY + (desiredY - childY) * angularCorrection;
        entry.child.vx = (entry.child.vx ?? 0) * (1 - angularCorrection * 0.8);
        entry.child.vy = (entry.child.vy ?? 0) * (1 - angularCorrection * 0.8);
      }

      const targetGap = clamp(
        (Math.PI * 1.18) / Math.max(1, children.length - 1),
        0.11,
        0.42,
      );
      let largestGap = 0;
      let largestGapIndex = 0;
      for (let index = 0; index < children.length; index += 1) {
        const current = children[index];
        const next = children[(index + 1) % children.length];
        const nextAngle = next.angle + (index === children.length - 1 ? Math.PI * 2 : 0);
        const gap = nextAngle - current.angle;
        if (gap > largestGap) {
          largestGap = gap;
          largestGapIndex = index;
        }
      }

      const minOpenGap = clamp(
        options.minOpenGap ?? (
          children.length >= 12
            ? Math.PI * 0.7
            : children.length >= 8
              ? Math.PI * 0.58
              : Math.PI * 0.42
        ),
        0,
        Math.PI * 1.05,
      );
      if (largestGap < minOpenGap) {
        const current = children[largestGapIndex];
        const next = children[(largestGapIndex + 1) % children.length];
        const velocity = Math.min(
          maxVelocity,
          (minOpenGap - largestGap) * Math.min(260, (current.distance + next.distance) * 0.5) * strength * 0.92,
        );
        const currentTangentX = -Math.sin(current.angle);
        const currentTangentY = Math.cos(current.angle);
        const nextTangentX = -Math.sin(next.angle);
        const nextTangentY = Math.cos(next.angle);

        current.child.vx = (current.child.vx ?? 0) - currentTangentX * velocity;
        current.child.vy = (current.child.vy ?? 0) - currentTangentY * velocity;
        next.child.vx = (next.child.vx ?? 0) + nextTangentX * velocity;
        next.child.vy = (next.child.vy ?? 0) + nextTangentY * velocity;
      }

      for (let index = 0; index < children.length - 1; index += 1) {
        const current = children[index];
        const next = children[index + 1];
        const nextAngle = next.angle;
        const gap = nextAngle - current.angle;
        if (gap >= targetGap) {
          continue;
        }

        const velocity = Math.min(
          maxVelocity,
          (targetGap - gap) * Math.min(220, (current.distance + next.distance) * 0.5) * strength * 0.82,
        );
        const currentTangentX = -Math.sin(current.angle);
        const currentTangentY = Math.cos(current.angle);
        const nextTangentX = -Math.sin(next.angle);
        const nextTangentY = Math.cos(next.angle);

        current.child.vx = (current.child.vx ?? 0) - currentTangentX * velocity;
        current.child.vy = (current.child.vy ?? 0) - currentTangentY * velocity;
        next.child.vx = (next.child.vx ?? 0) + nextTangentX * velocity;
        next.child.vy = (next.child.vy ?? 0) + nextTangentY * velocity;
      }
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (nodes: T[]) => {
    nodesById = new Map(nodes.map((node) => [node.id, node]));
    const nextChildrenByParentId = new Map<string, string[]>();
    for (const link of options.links) {
      const sourceId = getLinkEndpointId(link.source);
      const targetId = getLinkEndpointId(link.target);
      if (!nodesById.has(sourceId) || !nodesById.has(targetId)) {
        continue;
      }

      const children = nextChildrenByParentId.get(sourceId) ?? [];
      children.push(targetId);
      nextChildrenByParentId.set(sourceId, children);
    }

    childrenByParentId = new Map(
      [...nextChildrenByParentId.entries()].map(([parentId, childIds]) => [
        parentId,
        [...childIds].sort(),
      ]),
    );
  };

  return force;
}

type PositionedReferralGraphEdge<T extends ReferralGraphLayoutMemoryNode> = {
  key: string;
  source: T;
  sourceId: string;
  target: T;
  targetId: string;
};

function getPositionedReferralGraphEdge<T extends ReferralGraphLayoutMemoryNode>(
  link: ReferralGraphDragSpringLink<T>,
  nodesById: Map<string, T>,
): PositionedReferralGraphEdge<T> | null {
  const sourceId = getLinkEndpointId(link.source);
  const targetId = getLinkEndpointId(link.target);
  const source = nodesById.get(sourceId);
  const target = nodesById.get(targetId);

  if (
    !source
    || !target
    || sourceId === targetId
    || !hasFiniteCoordinate(source.x)
    || !hasFiniteCoordinate(source.y)
    || !hasFiniteCoordinate(target.x)
    || !hasFiniteCoordinate(target.y)
  ) {
    return null;
  }

  return {
    key: `${sourceId}->${targetId}`,
    source,
    sourceId,
    target,
    targetId,
  };
}

function referralGraphEdgesShareEndpoint<T extends ReferralGraphLayoutMemoryNode>(
  left: PositionedReferralGraphEdge<T>,
  right: PositionedReferralGraphEdge<T>,
) {
  return (
    left.sourceId === right.sourceId
    || left.sourceId === right.targetId
    || left.targetId === right.sourceId
    || left.targetId === right.targetId
  );
}

function referralGraphSegmentCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) {
  return ((bx - ax) * (cy - ay)) - ((by - ay) * (cx - ax));
}

function referralGraphPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const epsilon = 1e-6;
  return (
    px >= Math.min(ax, bx) - epsilon
    && px <= Math.max(ax, bx) + epsilon
    && py >= Math.min(ay, by) - epsilon
    && py <= Math.max(ay, by) + epsilon
    && Math.abs(referralGraphSegmentCross(ax, ay, bx, by, px, py)) <= epsilon
  );
}

function referralGraphSegmentsIntersect<T extends ReferralGraphLayoutMemoryNode>(
  left: PositionedReferralGraphEdge<T>,
  right: PositionedReferralGraphEdge<T>,
) {
  const ax = left.source.x!;
  const ay = left.source.y!;
  const bx = left.target.x!;
  const by = left.target.y!;
  const cx = right.source.x!;
  const cy = right.source.y!;
  const dx = right.target.x!;
  const dy = right.target.y!;
  const epsilon = 1e-6;
  const abC = referralGraphSegmentCross(ax, ay, bx, by, cx, cy);
  const abD = referralGraphSegmentCross(ax, ay, bx, by, dx, dy);
  const cdA = referralGraphSegmentCross(cx, cy, dx, dy, ax, ay);
  const cdB = referralGraphSegmentCross(cx, cy, dx, dy, bx, by);

  if (Math.abs(abC) <= epsilon && referralGraphPointOnSegment(cx, cy, ax, ay, bx, by)) {
    return true;
  }
  if (Math.abs(abD) <= epsilon && referralGraphPointOnSegment(dx, dy, ax, ay, bx, by)) {
    return true;
  }
  if (Math.abs(cdA) <= epsilon && referralGraphPointOnSegment(ax, ay, cx, cy, dx, dy)) {
    return true;
  }
  if (Math.abs(cdB) <= epsilon && referralGraphPointOnSegment(bx, by, cx, cy, dx, dy)) {
    return true;
  }

  return (
    ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
  );
}

function referralGraphPointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared <= 1e-6) {
    return Math.hypot(px - ax, py - ay);
  }

  const ratio = clamp((((px - ax) * dx) + ((py - ay) * dy)) / lengthSquared, 0, 1);
  const projectedX = ax + (ratio * dx);
  const projectedY = ay + (ratio * dy);
  return Math.hypot(px - projectedX, py - projectedY);
}

function referralGraphSegmentDistance<T extends ReferralGraphLayoutMemoryNode>(
  left: PositionedReferralGraphEdge<T>,
  right: PositionedReferralGraphEdge<T>,
) {
  if (referralGraphSegmentsIntersect(left, right)) {
    return 0;
  }

  const ax = left.source.x!;
  const ay = left.source.y!;
  const bx = left.target.x!;
  const by = left.target.y!;
  const cx = right.source.x!;
  const cy = right.source.y!;
  const dx = right.target.x!;
  const dy = right.target.y!;

  return Math.min(
    referralGraphPointToSegmentDistance(ax, ay, cx, cy, dx, dy),
    referralGraphPointToSegmentDistance(bx, by, cx, cy, dx, dy),
    referralGraphPointToSegmentDistance(cx, cy, ax, ay, bx, by),
    referralGraphPointToSegmentDistance(dx, dy, ax, ay, bx, by),
  );
}

function addReferralGraphEdgeVelocity(
  node: ReferralGraphLayoutMemoryNode,
  dx: number,
  dy: number,
) {
  if (node.fx != null || node.fy != null) {
    return;
  }

  node.vx = (node.vx ?? 0) + dx;
  node.vy = (node.vy ?? 0) + dy;
}

function addReferralGraphEdgePosition(
  node: ReferralGraphLayoutMemoryNode,
  dx: number,
  dy: number,
) {
  if (
    node.fx != null
    || node.fy != null
    || !hasFiniteCoordinate(node.x)
    || !hasFiniteCoordinate(node.y)
  ) {
    return;
  }

  node.x += dx;
  node.y += dy;
  node.vx = (node.vx ?? 0) * 0.72;
  node.vy = (node.vy ?? 0) * 0.72;
}

function addReferralGraphAnchorCorrection(
  node: ReferralGraphLayoutMemoryNode,
  target: ReferralGraphLayoutMemoryTarget | undefined,
  ratio: number,
) {
  if (
    !target
    || node.fx != null
    || node.fy != null
    || !hasFiniteCoordinate(node.x)
    || !hasFiniteCoordinate(node.y)
  ) {
    return;
  }

  node.x += (target.x - node.x) * ratio;
  node.y += (target.y - node.y) * ratio;
  node.vx = (node.vx ?? 0) * (1 - (ratio * 0.85));
  node.vy = (node.vy ?? 0) * (1 - (ratio * 0.85));
}

function getReferralGraphAnchorNormalSide<T extends ReferralGraphLayoutMemoryNode>(
  edge: PositionedReferralGraphEdge<T>,
  normalX: number,
  normalY: number,
  anchorPositions: Map<string, ReferralGraphLayoutMemoryTarget> | undefined,
) {
  const sourceAnchor = anchorPositions?.get(edge.sourceId);
  const targetAnchor = anchorPositions?.get(edge.targetId);
  let dot = 0;

  if (sourceAnchor) {
    dot += ((sourceAnchor.x - edge.source.x!) * normalX)
      + ((sourceAnchor.y - edge.source.y!) * normalY);
  }
  if (targetAnchor) {
    dot += ((targetAnchor.x - edge.target.x!) * normalX)
      + ((targetAnchor.y - edge.target.y!) * normalY);
  }

  if (Math.abs(dot) <= 1e-6) {
    return null;
  }

  return dot > 0 ? 1 : -1;
}

export function createReferralGraphEdgeCrossingForce<T extends ReferralGraphLayoutMemoryNode>(
  options: ReferralGraphEdgeCrossingOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodesById = new Map<string, T>();

  const force = ((alpha: number) => {
    if (hasActiveReferralGraphDrag(options)) {
      return;
    }

    const effectiveAlpha = Math.max(alpha, clamp(options.minAlpha ?? 0, 0, 0.025));
    const strength = scaleReferralGraphActiveDragStrength(
      clamp((options.strength ?? 0.12) * effectiveAlpha, 0, 0.34),
      options,
    );
    const maxVelocity = scaleReferralGraphActiveDragMaxVelocity(
      clamp(options.maxVelocity ?? 7, 1, 18),
      options,
    );
    const minDistance = Math.max(4, options.minDistance ?? 18);
    const maxPairs = Math.max(100, options.maxPairs ?? 3600);
    if (strength <= 0 || options.links.length < 2) {
      return;
    }

    const suppressedNodeIds = options.suppressedNodeIdsRef?.current ?? new Set<string>();
    const activeDraggedNodeId = options.activeDraggedNodeIdRef?.current;
    const positionedEdges = options.links
      .map((link) => getPositionedReferralGraphEdge(link as ReferralGraphDragSpringLink<T>, nodesById))
      .filter((edge): edge is PositionedReferralGraphEdge<T> => edge != null)
      .filter((edge) => (
        edge.sourceId !== activeDraggedNodeId
        && edge.targetId !== activeDraggedNodeId
        && !suppressedNodeIds.has(edge.sourceId)
        && !suppressedNodeIds.has(edge.targetId)
      ));

    let checkedPairCount = 0;
    for (let leftIndex = 0; leftIndex < positionedEdges.length; leftIndex += 1) {
      const left = positionedEdges[leftIndex];
      const leftDx = left.target.x! - left.source.x!;
      const leftDy = left.target.y! - left.source.y!;
      const leftLength = Math.hypot(leftDx, leftDy);
      if (leftLength < 1e-6) {
        continue;
      }

      for (let rightIndex = leftIndex + 1; rightIndex < positionedEdges.length; rightIndex += 1) {
        if (checkedPairCount >= maxPairs) {
          return;
        }
        checkedPairCount += 1;

        const right = positionedEdges[rightIndex];
        if (referralGraphEdgesShareEndpoint(left, right)) {
          continue;
        }

        const rightDx = right.target.x! - right.source.x!;
        const rightDy = right.target.y! - right.source.y!;
        const rightLength = Math.hypot(rightDx, rightDy);
        if (rightLength < 1e-6) {
          continue;
        }

        const intersects = referralGraphSegmentsIntersect(left, right);
        const distance = intersects ? 0 : referralGraphSegmentDistance(left, right);
        if (!intersects && distance >= minDistance) {
          continue;
        }

        const leftNormalX = -leftDy / leftLength;
        const leftNormalY = leftDx / leftLength;
        const rightNormalX = -rightDy / rightLength;
        const rightNormalY = rightDx / rightLength;
        const leftMidpointX = (left.source.x! + left.target.x!) * 0.5;
        const leftMidpointY = (left.source.y! + left.target.y!) * 0.5;
        const rightMidpointX = (right.source.x! + right.target.x!) * 0.5;
        const rightMidpointY = (right.source.y! + right.target.y!) * 0.5;
        const deterministicSide = (hashString(`${left.key}:${right.key}:edge-crossing`) % 2 === 0 ? 1 : -1);
        const midpointDot = ((rightMidpointX - leftMidpointX) * leftNormalX)
          + ((rightMidpointY - leftMidpointY) * leftNormalY);
        const side = midpointDot < -1e-6
          ? -1
          : midpointDot > 1e-6
            ? 1
            : deterministicSide;
        const leftDirection = intersects
          ? getReferralGraphAnchorNormalSide(left, leftNormalX, leftNormalY, options.anchorPositions) ?? side
          : side;
        const rightDirection = intersects
          ? getReferralGraphAnchorNormalSide(right, rightNormalX, rightNormalY, options.anchorPositions) ?? -side
          : -side;
        const penetration = Math.max(0, minDistance - distance);
        const crossingBonus = intersects ? minDistance * 0.55 : 0;
        const velocity = Math.min(maxVelocity, (penetration + crossingBonus) * strength);
        if (velocity <= 0) {
          continue;
        }

        addReferralGraphEdgeVelocity(left.source, leftNormalX * leftDirection * velocity * 0.32, leftNormalY * leftDirection * velocity * 0.32);
        addReferralGraphEdgeVelocity(left.target, leftNormalX * leftDirection * velocity, leftNormalY * leftDirection * velocity);
        addReferralGraphEdgeVelocity(right.source, rightNormalX * rightDirection * velocity * 0.32, rightNormalY * rightDirection * velocity * 0.32);
        addReferralGraphEdgeVelocity(right.target, rightNormalX * rightDirection * velocity, rightNormalY * rightDirection * velocity);
        if (intersects) {
          const correction = Math.min(maxVelocity * 0.22, Math.max(0.9, minDistance * 0.035));
          const anchorCorrectionRatio = clamp(options.anchorCorrectionStrength ?? 0.045, 0, 0.12);
          addReferralGraphAnchorCorrection(left.source, options.anchorPositions?.get(left.sourceId), anchorCorrectionRatio * 0.35);
          addReferralGraphAnchorCorrection(left.target, options.anchorPositions?.get(left.targetId), anchorCorrectionRatio);
          addReferralGraphAnchorCorrection(right.source, options.anchorPositions?.get(right.sourceId), anchorCorrectionRatio * 0.35);
          addReferralGraphAnchorCorrection(right.target, options.anchorPositions?.get(right.targetId), anchorCorrectionRatio);
          addReferralGraphEdgePosition(left.source, leftNormalX * leftDirection * correction * 0.18, leftNormalY * leftDirection * correction * 0.18);
          addReferralGraphEdgePosition(left.target, leftNormalX * leftDirection * correction * 0.72, leftNormalY * leftDirection * correction * 0.72);
          addReferralGraphEdgePosition(right.source, rightNormalX * rightDirection * correction * 0.18, rightNormalY * rightDirection * correction * 0.18);
          addReferralGraphEdgePosition(right.target, rightNormalX * rightDirection * correction * 0.72, rightNormalY * rightDirection * correction * 0.72);
        }
      }
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (nodes: T[]) => {
    nodesById = new Map(nodes.map((node) => [node.id, node]));
  };

  return force;
}

export function createReferralGraphClusterSeparationForce<T extends ReferralGraphLayoutMemoryNode>(
  options: ReferralGraphClusterSeparationOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodes: T[] = [];

  const force = ((alpha: number) => {
    if (options.activeDraggedNodeIdRef?.current) {
      return;
    }

    const strength = scaleReferralGraphActiveDragStrength(
      clamp((options.strength ?? 0.045) * alpha, 0, 0.12),
      options,
    );
    const maxVelocity = scaleReferralGraphActiveDragMaxVelocity(
      clamp(options.maxVelocity ?? 10, 1, 28),
      options,
    );
    const softening = Math.max(1, options.softening ?? 70);
    if (strength <= 0 || nodes.length <= 1) {
      return;
    }
    const suppressedClusterIndexes = new Set<number>();
    const activeDraggedClusterIndex = options.activeDraggedNodeIdRef?.current
      ? options.nodeClusterIndex.get(options.activeDraggedNodeIdRef.current)
      : undefined;
    if (activeDraggedClusterIndex != null) {
      suppressedClusterIndexes.add(activeDraggedClusterIndex);
    }
    for (const nodeId of options.suppressedNodeIdsRef?.current ?? []) {
      const clusterIndex = options.nodeClusterIndex.get(nodeId);
      if (clusterIndex != null) {
        suppressedClusterIndexes.add(clusterIndex);
      }
    }

    const clusterCenters = new Map<number, { x: number; y: number; count: number }>();
    const clusterMembers = new Map<number, T[]>();

    for (const node of nodes) {
      if (!hasFiniteCoordinate(node.x) || !hasFiniteCoordinate(node.y)) {
        continue;
      }

      const clusterIndex = options.nodeClusterIndex.get(node.id);
      if (clusterIndex == null) {
        continue;
      }

      const center = clusterCenters.get(clusterIndex) ?? { x: 0, y: 0, count: 0 };
      center.x += node.x;
      center.y += node.y;
      center.count += 1;
      clusterCenters.set(clusterIndex, center);

      const members = clusterMembers.get(clusterIndex) ?? [];
      members.push(node);
      clusterMembers.set(clusterIndex, members);
    }

    const clusters = [...clusterCenters.entries()]
      .filter(([, center]) => center.count > 0)
      .map(([clusterIndex, center]) => ({
        clusterIndex,
        count: center.count,
        x: center.x / center.count,
        y: center.y / center.count,
        radius: options.clusterRadii.get(clusterIndex) ?? 64,
        members: clusterMembers.get(clusterIndex) ?? [],
      }));

    const gap = options.gap ?? 52;
    const singletonGapFactor = clamp(options.singletonGapFactor ?? 1, 0, 1);
    for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
        const left = clusters[leftIndex];
        const right = clusters[rightIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1e-6) {
          const angle = (left.clusterIndex * GOLDEN_ANGLE_FALLBACK) + right.clusterIndex;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        const isLeftSingleton = left.count <= 1;
        const isRightSingleton = right.count <= 1;
        const gapFactor = isLeftSingleton && isRightSingleton
          ? singletonGapFactor
          : isLeftSingleton || isRightSingleton
            ? Math.sqrt(singletonGapFactor)
            : 1;
        const targetDistance = left.radius + right.radius + gap * gapFactor;
        if (distance >= targetDistance) {
          continue;
        }

        const overlap = targetDistance - distance;
        const softenedOverlap = overlap / (overlap + softening);
        const push = Math.min(maxVelocity, overlap * softenedOverlap * strength);
        const unitX = dx / distance;
        const unitY = dy / distance;
        const leftIsSuppressed = suppressedClusterIndexes.has(left.clusterIndex);
        const rightIsSuppressed = suppressedClusterIndexes.has(right.clusterIndex);
        if (leftIsSuppressed && rightIsSuppressed) {
          continue;
        }

        if (!leftIsSuppressed) {
          for (const node of left.members) {
            if (node.fx != null || node.fy != null) {
              continue;
            }
            node.vx = (node.vx ?? 0) - unitX * push;
            node.vy = (node.vy ?? 0) - unitY * push;
          }
        }

        if (!rightIsSuppressed) {
          for (const node of right.members) {
            if (node.fx != null || node.fy != null) {
              continue;
            }
            node.vx = (node.vx ?? 0) + unitX * push;
            node.vy = (node.vy ?? 0) + unitY * push;
          }
        }
      }
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (initialNodes: T[]) => {
    nodes = initialNodes;
  };

  return force;
}

export function createReferralGraphClusterGravityForce<T extends ReferralGraphLayoutMemoryNode>(
  options: ReferralGraphClusterGravityOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodes: T[] = [];

  const force = ((alpha: number) => {
    const effectiveAlpha = Math.max(alpha, clamp(options.minAlpha ?? 0, 0, 0.18));
    const strength = scaleReferralGraphActiveDragStrength(
      clamp((options.strength ?? 0.065) * effectiveAlpha, 0, 0.3),
      options,
    );
    const deadZoneRadius = Math.max(0, options.deadZoneRadius ?? 0);
    const gravityScale = clamp(options.gravityScale ?? 160, 1, 380);
    const maxVelocity = scaleReferralGraphActiveDragMaxVelocity(
      clamp(options.maxVelocity ?? 12, 1, 28),
      options,
    );
    const singletonStrengthFactor = clamp(options.singletonStrengthFactor ?? 1, 0, 1);
    const singletonDeadZoneRadius = Math.max(deadZoneRadius, options.singletonDeadZoneRadius ?? deadZoneRadius);
    const softening = Math.max(1, options.softening ?? 180);
    const centerX = options.centerX ?? 0;
    const centerY = options.centerY ?? 0;
    if (strength <= 0 || nodes.length <= 1) {
      return;
    }

    const suppressedClusterIndex = options.activeDraggedNodeIdRef?.current
      ? options.nodeClusterIndex.get(options.activeDraggedNodeIdRef.current)
      : undefined;
    const clusterCenters = new Map<number, { x: number; y: number; count: number }>();
    const clusterMembers = new Map<number, T[]>();
    const suppressedClusterIndexes = new Set<number>();

    for (const node of nodes) {
      if (!hasFiniteCoordinate(node.x) || !hasFiniteCoordinate(node.y)) {
        continue;
      }

      const clusterIndex = options.nodeClusterIndex.get(node.id);
      if (clusterIndex == null) {
        continue;
      }

      if (options.suppressedNodeIdsRef?.current.has(node.id)) {
        suppressedClusterIndexes.add(clusterIndex);
      }

      const center = clusterCenters.get(clusterIndex) ?? { x: 0, y: 0, count: 0 };
      center.x += node.x;
      center.y += node.y;
      center.count += 1;
      clusterCenters.set(clusterIndex, center);

      const members = clusterMembers.get(clusterIndex) ?? [];
      members.push(node);
      clusterMembers.set(clusterIndex, members);
    }

    const clusters = [...clusterCenters.entries()]
      .filter(([, center]) => center.count > 0)
      .map(([clusterIndex, center]) => ({
        clusterIndex,
        count: center.count,
        members: clusterMembers.get(clusterIndex) ?? [],
        x: center.x / center.count,
        y: center.y / center.count,
      }));

    for (const cluster of clusters) {
      if (
        cluster.clusterIndex === suppressedClusterIndex
        || suppressedClusterIndexes.has(cluster.clusterIndex)
      ) {
        continue;
      }

      const dx = centerX - cluster.x;
      const dy = centerY - cluster.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 1e-6) {
        continue;
      }

      const resolvedDeadZoneRadius = cluster.count <= 1 ? singletonDeadZoneRadius : deadZoneRadius;
      const excessDistance = distance - resolvedDeadZoneRadius;
      if (excessDistance <= 0) {
        continue;
      }

      const distanceFactor = excessDistance / softening;
      const clusterStrength = cluster.count <= 1 ? strength * singletonStrengthFactor : strength;
      const attraction = Math.min(maxVelocity, clusterStrength * gravityScale * distanceFactor);
      if (attraction <= 0) {
        continue;
      }

      const unitX = dx / distance;
      const unitY = dy / distance;
      for (const node of cluster.members) {
        if (node.fx != null || node.fy != null) {
          continue;
        }
        node.vx = (node.vx ?? 0) + unitX * attraction;
        node.vy = (node.vy ?? 0) + unitY * attraction;
      }
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (initialNodes: T[]) => {
    nodes = initialNodes;
  };

  return force;
}

export function createReferralGraphNodeSeparationForce<T extends ReferralGraphLayoutMemoryNode>(
  options: ReferralGraphNodeSeparationOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodes: T[] = [];

  const force = ((alpha: number) => {
    const strength = scaleReferralGraphActiveDragStrength(
      clamp((options.strength ?? 0.16) * alpha, 0, 0.34),
      options,
      0.06,
    );
    const maxVelocity = scaleReferralGraphActiveDragMaxVelocity(
      clamp(options.maxVelocity ?? 14, 1, 32),
      options,
      0.1,
    );
    if (strength <= 0 || nodes.length <= 1) {
      return;
    }

    const sameClusterDistance = options.minDistance ?? 26;
    const crossClusterDistance = options.crossClusterDistance ?? 84;
    const crossComponentDistance = options.crossComponentDistance ?? 112;
    const activeDraggedNodeId = options.activeDraggedNodeIdRef?.current;
    const suppressedComponents = new Set<number>();
    const suppressedClusters = new Set<number>();
    if (activeDraggedNodeId) {
      const activeDraggedComponent = options.nodeComponentIndex?.get(activeDraggedNodeId);
      const activeDraggedCluster = options.nodeClusterIndex.get(activeDraggedNodeId);
      if (activeDraggedComponent != null) {
        suppressedComponents.add(activeDraggedComponent);
      }
      if (activeDraggedCluster != null) {
        suppressedClusters.add(activeDraggedCluster);
      }
    }
    for (const nodeId of options.suppressedNodeIdsRef?.current ?? []) {
      const component = options.nodeComponentIndex?.get(nodeId);
      const cluster = options.nodeClusterIndex.get(nodeId);
      if (component != null) {
        suppressedComponents.add(component);
      }
      if (cluster != null) {
        suppressedClusters.add(cluster);
      }
    }

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      if (!hasFiniteCoordinate(left.x) || !hasFiniteCoordinate(left.y)) {
        continue;
      }

      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        if (!hasFiniteCoordinate(right.x) || !hasFiniteCoordinate(right.y)) {
          continue;
        }

        const leftCluster = options.nodeClusterIndex.get(left.id);
        const rightCluster = options.nodeClusterIndex.get(right.id);
        const leftComponent = options.nodeComponentIndex?.get(left.id);
        const rightComponent = options.nodeComponentIndex?.get(right.id);
        const sameCluster = leftCluster != null && leftCluster === rightCluster;
        const sameComponent = leftComponent != null && leftComponent === rightComponent;
        const leftIsSuppressed = (
          (leftComponent != null && suppressedComponents.has(leftComponent))
          || (leftCluster != null && suppressedClusters.has(leftCluster))
        );
        const rightIsSuppressed = (
          (rightComponent != null && suppressedComponents.has(rightComponent))
          || (rightCluster != null && suppressedClusters.has(rightCluster))
        );
        if (leftIsSuppressed && rightIsSuppressed) {
          continue;
        }
        const targetDistance = sameCluster
          ? sameClusterDistance
          : sameComponent
            ? crossClusterDistance
            : crossComponentDistance;

        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1e-6) {
          const angle = (leftIndex * GOLDEN_ANGLE_FALLBACK) + rightIndex;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        if (distance >= targetDistance) {
          continue;
        }

        const leftMovable = left.fx == null && left.fy == null;
        const rightMovable = right.fx == null && right.fy == null;
        if (!leftMovable && !rightMovable) {
          continue;
        }

        const velocity = Math.min(maxVelocity, (targetDistance - distance) * strength);
        const unitX = dx / distance;
        const unitY = dy / distance;
        const leftShare = leftIsSuppressed && !rightIsSuppressed
          ? 0
          : rightIsSuppressed && !leftIsSuppressed
            ? (leftMovable ? 1 : 0)
            : leftMovable && rightMovable
              ? 0.5
              : leftMovable
                ? 1
                : 0;
        const rightShare = rightIsSuppressed && !leftIsSuppressed
          ? 0
          : leftIsSuppressed && !rightIsSuppressed
            ? (rightMovable ? 1 : 0)
            : leftMovable && rightMovable
              ? 0.5
              : rightMovable
                ? 1
                : 0;

        if (leftShare > 0) {
          left.vx = (left.vx ?? 0) - unitX * velocity * leftShare;
          left.vy = (left.vy ?? 0) - unitY * velocity * leftShare;
        }

        if (rightShare > 0) {
          right.vx = (right.vx ?? 0) + unitX * velocity * rightShare;
          right.vy = (right.vy ?? 0) + unitY * velocity * rightShare;
        }
      }
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (initialNodes: T[]) => {
    nodes = initialNodes;
  };

  return force;
}

export function createReferralGraphComponentEnvelopeForce<T extends ReferralGraphLayoutMemoryNode>(
  options: ReferralGraphComponentEnvelopeOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodes: T[] = [];

  const force = ((alpha: number) => {
    const strength = scaleReferralGraphActiveDragStrength(
      clamp((options.strength ?? 0.075) * alpha, 0, 0.18),
      options,
    );
    const maxVelocity = scaleReferralGraphActiveDragMaxVelocity(
      clamp(options.maxVelocity ?? 14, 1, 32),
      options,
    );
    if (strength <= 0 || nodes.length <= 1) {
      return;
    }

    const componentCenters = new Map<number, { x: number; y: number; count: number }>();
    const suppressedComponentIndex = options.activeDraggedNodeIdRef?.current
      ? options.nodeComponentIndex.get(options.activeDraggedNodeIdRef.current)
      : undefined;

    for (const node of nodes) {
      if (!hasFiniteCoordinate(node.x) || !hasFiniteCoordinate(node.y)) {
        continue;
      }

      const componentIndex = options.nodeComponentIndex.get(node.id);
      if (componentIndex == null || componentIndex === suppressedComponentIndex) {
        continue;
      }

      const center = componentCenters.get(componentIndex) ?? { x: 0, y: 0, count: 0 };
      center.x += node.x;
      center.y += node.y;
      center.count += 1;
      componentCenters.set(componentIndex, center);
    }

    for (const center of componentCenters.values()) {
      center.x /= center.count;
      center.y /= center.count;
    }

    for (const node of nodes) {
      if (
        node.fx != null
        || node.fy != null
        || !hasFiniteCoordinate(node.x)
        || !hasFiniteCoordinate(node.y)
      ) {
        continue;
      }

      const componentIndex = options.nodeComponentIndex.get(node.id);
      if (componentIndex == null || componentIndex === suppressedComponentIndex) {
        continue;
      }

      const center = componentCenters.get(componentIndex);
      if (!center) {
        continue;
      }

      const baseRadius = options.componentRadii.get(componentIndex) ?? 160;
      const envelopeRadius = Math.max(
        155,
        Math.min(560, (baseRadius * 1.02) + (Math.sqrt(center.count) * 24)),
      );
      const dx = center.x - node.x;
      const dy = center.y - node.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance <= envelopeRadius) {
        continue;
      }

      const velocity = Math.min(maxVelocity, (distance - envelopeRadius) * strength);
      node.vx = (node.vx ?? 0) + (dx / distance) * velocity;
      node.vy = (node.vy ?? 0) + (dy / distance) * velocity;
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (initialNodes: T[]) => {
    nodes = initialNodes;
  };

  return force;
}

export function createReferralGraphComponentCohesionForce<T extends ReferralGraphLayoutMemoryNode>(
  options: ReferralGraphComponentCohesionOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodes: T[] = [];

  const force = ((alpha: number) => {
    const strength = scaleReferralGraphActiveDragStrength(
      clamp((options.strength ?? 0.12) * alpha, 0, 0.32),
      options,
    );
    const maxVelocity = scaleReferralGraphActiveDragMaxVelocity(
      clamp(options.maxVelocity ?? 10, 1, 24),
      options,
    );
    if (strength <= 0 || nodes.length <= 1) {
      return;
    }

    const componentCenters = new Map<number, { x: number; y: number; count: number }>();
    const suppressedComponentIndex = options.activeDraggedNodeIdRef?.current
      ? options.nodeComponentIndex.get(options.activeDraggedNodeIdRef.current)
      : undefined;

    for (const node of nodes) {
      if (!hasFiniteCoordinate(node.x) || !hasFiniteCoordinate(node.y)) {
        continue;
      }

      const componentIndex = options.nodeComponentIndex.get(node.id);
      if (componentIndex == null || componentIndex === suppressedComponentIndex) {
        continue;
      }

      const center = componentCenters.get(componentIndex) ?? { x: 0, y: 0, count: 0 };
      center.x += node.x;
      center.y += node.y;
      center.count += 1;
      componentCenters.set(componentIndex, center);
    }

    for (const center of componentCenters.values()) {
      center.x /= center.count;
      center.y /= center.count;
    }

    for (const node of nodes) {
      if (
        node.fx != null
        || node.fy != null
        || !hasFiniteCoordinate(node.x)
        || !hasFiniteCoordinate(node.y)
      ) {
        continue;
      }

      const componentIndex = options.nodeComponentIndex.get(node.id);
      if (componentIndex == null || componentIndex === suppressedComponentIndex) {
        continue;
      }

      const center = componentCenters.get(componentIndex);
      if (!center || center.count <= 1) {
        continue;
      }

      const componentRadius = options.componentRadii.get(componentIndex) ?? 140;
      const cohesionDeadZone = Math.max(72, Math.min(260, componentRadius * 0.58));
      const dx = center.x - node.x;
      const dy = center.y - node.y;
      const distance = Math.hypot(dx, dy) || 1;
      const excessDistance = distance - cohesionDeadZone;
      if (excessDistance <= 0) {
        continue;
      }

      const velocity = Math.min(maxVelocity, excessDistance * strength);
      node.vx = (node.vx ?? 0) + (dx / distance) * velocity;
      node.vy = (node.vy ?? 0) + (dy / distance) * velocity;
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (initialNodes: T[]) => {
    nodes = initialNodes;
  };

  return force;
}

export function createReferralGraphLayoutMemoryForce<T extends ReferralGraphLayoutMemoryNode>(
  targets: Map<string, ReferralGraphLayoutMemoryTarget>,
  strength: number,
  options: ReferralGraphLayoutMemoryForceOptions = {},
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodes: T[] = [];
  let tickCount = 0;

  const force = (() => {
    if (options.activeDraggedNodeIdRef?.current) {
      return;
    }

    tickCount += 1;
    const maxTicks = options.maxTicks ?? Number.POSITIVE_INFINITY;
    const fadedAnchorRatio = maxTicks === Number.POSITIVE_INFINITY
      ? 1
      : clamp(1 - (tickCount / maxTicks), 0, 1);
    const minimumAnchorRatio = maxTicks === Number.POSITIVE_INFINITY
      ? 1
      : clamp(options.minimumAnchorRatio ?? 0, 0, 0.45);
    const anchorAgeRatio = maxTicks === Number.POSITIVE_INFINITY
      ? 1
      : minimumAnchorRatio + (fadedAnchorRatio * (1 - minimumAnchorRatio));

    const activeDraggedComponent = options.activeDraggedNodeIdRef?.current && options.nodeComponentIndex
      ? options.nodeComponentIndex.get(options.activeDraggedNodeIdRef.current)
      : undefined;

    for (const node of nodes) {
      const manualTarget = options.manualNodeTargetsRef?.current.get(node.id);
      const target = manualTarget ?? targets.get(node.id);
      if (!target) {
        continue;
      }

      if (!manualTarget && options.suppressedNodeIdsRef?.current.has(node.id)) {
        continue;
      }

      if (!manualTarget && anchorAgeRatio <= 0) {
        continue;
      }

      if (
        !manualTarget
        && activeDraggedComponent != null
        && options.nodeComponentIndex?.get(node.id) === activeDraggedComponent
      ) {
        continue;
      }

      const activeDragScale = hasActiveReferralGraphDrag(options)
        ? REFERRAL_GRAPH_ACTIVE_DRAG_FORCE_SCALE
        : 1;
      const effectiveStrength = clamp(
        (manualTarget ? strength * 1.15 : strength * anchorAgeRatio) * activeDragScale,
        0,
        manualTarget ? 0.075 : 0.08,
      );
      if (effectiveStrength <= 0) {
        continue;
      }

      applyReferralGraphLayoutMemory(
        node,
        target,
        effectiveStrength,
      );
    }
  }) as unknown as { (alpha: number): void; initialize: (nodes: T[]) => void };

  force.initialize = (initialNodes: T[]) => {
    nodes = initialNodes;
    tickCount = 0;
  };

  return force;
}

export function resolveReferralGraphPhysics(settings: ReferralGraphPhysicsSettings): ReferralGraphPhysicsTuning {
  const centerGravity = clamp(settings.centerGravity, 0, 1);
  const linkDistance = clamp(settings.linkDistance, 30, 500);

  return {
    alphaDecay: 0.012,
    velocityDecay: 0.55,
    centerStrength: 0,
    chargeStrength: -3 * clamp(settings.repulsion, 0, 20),
    chargeDistanceMin: 12,
    chargeDistanceMax: Math.round(clamp(linkDistance, 180, 420)),
    linkDistance,
    linkStrength: clamp(settings.linkStrength, 0, 1),
    layoutMemoryStrength: clamp(0.04 + (centerGravity * 0.12), 0.04, 0.16),
  };
}

export function resolveReferralGraphFreePhysics(settings: ReferralGraphPhysicsSettings): ReferralGraphFreePhysicsTuning {
  const centerGravity = clamp(settings.centerGravity, 0, 1);
  const repulsion = clamp(settings.repulsion, 0, 20);
  const linkDistance = clamp(settings.linkDistance, 30, 500);
  const linkStrength = clamp(settings.linkStrength, 0, 1);

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
    dragReheatAlpha: 0.24,
  };
}

export function getReferralGraphFreeLinkStrength(
  sourceDegree: number,
  targetDegree: number,
  baseLinkStrength: number,
) {
  const degreeDamping = Math.sqrt(Math.max(1, Math.min(
    Number.isFinite(sourceDegree) ? sourceDegree : 1,
    Number.isFinite(targetDegree) ? targetDegree : 1,
  )));
  return Math.max(0.06, clamp(baseLinkStrength, 0, 1) / degreeDamping);
}
