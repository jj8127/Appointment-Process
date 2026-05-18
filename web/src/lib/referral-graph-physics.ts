import type { ReferralGraphPhysicsSettings } from '../types/referral-graph.ts';

const GOLDEN_ANGLE_FALLBACK = Math.PI * (3 - Math.sqrt(5));

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
  maxTicks?: number;
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
  options: { sourceHasChildren?: boolean; targetHasChildren?: boolean } = {},
) {
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
  maxVelocity?: number;
  preventStretch?: boolean;
  stretchSlack?: number;
  strength?: number;
  velocityDamping?: number;
};

export type ReferralGraphLinkTensionOptions = {
  activeDraggedNodeIdRef?: {
    current: string | null;
  };
  baseLinkDistance: number;
  childCountByNodeId: Map<string, number>;
  degreeByNodeId: Map<string, number>;
  maxVelocity?: number;
  strength?: number;
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
  childCountByNodeId: Map<string, number>;
  degreeByNodeId: Map<string, number>;
  links: Array<ReferralGraphDragSpringLink<ReferralGraphLayoutMemoryNode>>;
  maxVelocity?: number;
  strength?: number;
};

export type ReferralGraphSiblingAngularOptions = {
  links: Array<ReferralGraphDragSpringLink<ReferralGraphLayoutMemoryNode>>;
  maxVelocity?: number;
  strength?: number;
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
    const anchoredNodeIds = new Set<string>([draggedNode.id]);
    const constraintStrength = clamp(options.constraintStrength ?? 1, 0, 1);
    const stretchSlack = Math.max(0, options.stretchSlack ?? 0);
    const velocityDamping = clamp(options.velocityDamping ?? (0.15 + constraintStrength * 0.55), 0, 0.95);
    const maxPasses = Math.min(Math.max(nodesById.size, 1), 96);

    for (let passIndex = 0; passIndex < maxPasses; passIndex += 1) {
      let movedFollower = false;

      for (const link of links) {
        const sourceId = getLinkEndpointId(link.source);
        const targetId = getLinkEndpointId(link.target);
        const sourceAnchored = anchoredNodeIds.has(sourceId);
        const targetAnchored = anchoredNodeIds.has(targetId);

        if (sourceAnchored === targetAnchored) {
          continue;
        }

        const anchorId = sourceAnchored ? sourceId : targetId;
        const followerId = sourceAnchored ? targetId : sourceId;
        const anchor = nodesById.get(anchorId);
        const follower = nodesById.get(followerId);

        if (
          !anchor
          || !follower
          || follower.fx != null
          || follower.fy != null
          || !hasFiniteCoordinate(anchor.x)
          || !hasFiniteCoordinate(anchor.y)
          || !hasFiniteCoordinate(follower.x)
          || !hasFiniteCoordinate(follower.y)
        ) {
          continue;
        }

        const dx = anchor.x - follower.x;
        const dy = anchor.y - follower.y;
        const distance = Math.hypot(dx, dy) || 1;
        const targetDistance = getReferralGraphLinkDistance(
          options.degreeByNodeId.get(sourceId) ?? 1,
          options.degreeByNodeId.get(targetId) ?? 1,
          options.baseLinkDistance,
          {
            sourceHasChildren: (options.childCountByNodeId.get(sourceId) ?? 0) > 0,
            targetHasChildren: (options.childCountByNodeId.get(targetId) ?? 0) > 0,
          },
        );

        const allowedDistance = targetDistance + stretchSlack;
        if (distance > allowedDistance) {
          const unitX = dx / distance;
          const unitY = dy / distance;
          const correctedDistance = distance - (distance - allowedDistance) * constraintStrength;
          follower.x = anchor.x - unitX * correctedDistance;
          follower.y = anchor.y - unitY * correctedDistance;

          const velocityX = follower.vx ?? 0;
          const velocityY = follower.vy ?? 0;
          const velocityTowardAnchor = velocityX * unitX + velocityY * unitY;
          const radialVelocityX = velocityTowardAnchor < 0 ? unitX * velocityTowardAnchor : 0;
          const radialVelocityY = velocityTowardAnchor < 0 ? unitY * velocityTowardAnchor : 0;
          follower.vx = (velocityX - radialVelocityX) * (1 - velocityDamping);
          follower.vy = (velocityY - radialVelocityY) * (1 - velocityDamping);
        }

        anchoredNodeIds.add(followerId);
        movedFollower = true;
      }

      if (!movedFollower) {
        break;
      }
    }

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
        targetHasChildren: (options.childCountByNodeId.get(targetId) ?? 0) > 0,
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

export function createReferralGraphLinkTensionForce<T extends ReferralGraphLayoutMemoryNode>(
  links: Array<ReferralGraphDragSpringLink<T>>,
  options: ReferralGraphLinkTensionOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodesById = new Map<string, T>();

  const force = ((alpha: number) => {
    const strength = clamp(options.strength ?? 0.3, 0, 0.7) * alpha;
    const maxVelocity = clamp(options.maxVelocity ?? 22, 1, 48);
    const thresholdMultiplier = clamp(options.thresholdMultiplier ?? 1.06, 1, 2.5);

    for (const link of links) {
      const sourceId = getLinkEndpointId(link.source);
      const targetId = getLinkEndpointId(link.target);
      const activeDraggedNodeId = options.activeDraggedNodeIdRef?.current;
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
          targetHasChildren: (options.childCountByNodeId.get(targetId) ?? 0) > 0,
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

      const dragStrengthFactor = activeDraggedNodeId
        ? sourceId === activeDraggedNodeId || targetId === activeDraggedNodeId
          ? 1
          : 0.24
        : 1;
      const velocity = Math.min(maxVelocity, (distance - targetDistance) * strength * dragStrengthFactor);
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

export function createReferralGraphBranchBendForce<T extends ReferralGraphLayoutMemoryNode>(
  options: ReferralGraphBranchBendOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodesById = new Map<string, T>();
  let adjacency = new Map<string, string[]>();
  let directedSingleChildByNodeId = new Map<string, string>();

  const force = ((alpha: number) => {
    const strength = clamp((options.strength ?? 0.18) * alpha, 0, 0.3);
    const maxVelocity = clamp(options.maxVelocity ?? 12, 1, 24);
    if (strength <= 0) {
      return;
    }

    for (const [nodeId, neighborIds] of adjacency) {
      if (neighborIds.length !== 2) {
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
    const strength = clamp((options.strength ?? 0.16) * alpha, 0, 0.28);
    const maxVelocity = clamp(options.maxVelocity ?? 9, 1, 18);
    if (strength <= 0) {
      return;
    }

    for (const [parentId, childIds] of childrenByParentId) {
      if (childIds.length < 2) {
        continue;
      }

      const parent = nodesById.get(parentId);
      if (!parent || !hasFiniteCoordinate(parent.x) || !hasFiniteCoordinate(parent.y)) {
        continue;
      }

      const parentX = parent.x;
      const parentY = parent.y;
      const children = childIds
        .map((childId) => {
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

          return {
            angle: Math.atan2(dy, dx),
            child,
            distance,
          };
        })
        .filter((entry): entry is { angle: number; child: T; distance: number } => entry != null)
        .sort((left, right) => left.angle - right.angle);

      if (children.length < 2) {
        continue;
      }

      const targetGap = Math.min(Math.PI * 0.9, (Math.PI * 2 / children.length) * 0.78);
      for (let index = 0; index < children.length; index += 1) {
        const current = children[index];
        const next = children[(index + 1) % children.length];
        const nextAngle = next.angle + (index === children.length - 1 ? Math.PI * 2 : 0);
        const gap = nextAngle - current.angle;
        if (gap >= targetGap) {
          continue;
        }

        const velocity = Math.min(
          maxVelocity,
          (targetGap - gap) * Math.min(90, (current.distance + next.distance) * 0.5) * strength * 0.18,
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

export function createReferralGraphClusterSeparationForce<T extends ReferralGraphLayoutMemoryNode>(
  options: ReferralGraphClusterSeparationOptions,
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodes: T[] = [];

  const force = ((alpha: number) => {
    const strength = clamp((options.strength ?? 0.045) * alpha, 0, 0.12);
    const maxVelocity = clamp(options.maxVelocity ?? 10, 1, 28);
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
    const strength = clamp((options.strength ?? 0.065) * effectiveAlpha, 0, 0.3);
    const deadZoneRadius = Math.max(0, options.deadZoneRadius ?? 0);
    const gravityScale = clamp(options.gravityScale ?? 160, 1, 380);
    const maxVelocity = clamp(options.maxVelocity ?? 12, 1, 28);
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
    const strength = clamp((options.strength ?? 0.16) * alpha, 0, 0.34);
    const maxVelocity = clamp(options.maxVelocity ?? 14, 1, 32);
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
    const strength = clamp((options.strength ?? 0.075) * alpha, 0, 0.18);
    const maxVelocity = clamp(options.maxVelocity ?? 14, 1, 32);
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

export function createReferralGraphLayoutMemoryForce<T extends ReferralGraphLayoutMemoryNode>(
  targets: Map<string, ReferralGraphLayoutMemoryTarget>,
  strength: number,
  options: ReferralGraphLayoutMemoryForceOptions = {},
): { (alpha: number): void; initialize: (nodes: T[]) => void } {
  let nodes: T[] = [];
  let tickCount = 0;

  const force = (() => {
    tickCount += 1;
    const maxTicks = options.maxTicks ?? Number.POSITIVE_INFINITY;
    if (tickCount > maxTicks) {
      return;
    }

    for (const node of nodes) {
      const manualTarget = options.manualNodeTargetsRef?.current.get(node.id);
      const target = manualTarget ?? targets.get(node.id);
      if (!target) {
        continue;
      }

      if (!manualTarget && options.suppressedNodeIdsRef?.current.has(node.id)) {
        continue;
      }

      const ageRatio = maxTicks === Number.POSITIVE_INFINITY
        ? 1
        : clamp(1 - (tickCount / maxTicks), 0, 1);
      const effectiveStrength = clamp(
        manualTarget ? strength * 0.35 : strength * ageRatio,
        0,
        manualTarget ? 0.035 : 0.08,
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
    velocityDecay: 0.4,
    centerStrength: 0,
    chargeStrength: -3 * clamp(settings.repulsion, 0, 20),
    chargeDistanceMin: 12,
    chargeDistanceMax: Math.round(clamp(linkDistance, 180, 420)),
    linkDistance,
    linkStrength: clamp(settings.linkStrength, 0, 1),
    layoutMemoryStrength: clamp(0.04 + (centerGravity * 0.12), 0.04, 0.16),
  };
}
