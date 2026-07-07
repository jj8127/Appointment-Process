import type { GraphEdge, GraphNode } from '../types/referral-graph.ts';

function getEdgeEndpoint(value: GraphEdge['source'] | GraphEdge['target']) {
  return typeof value === 'object' ? (value as GraphNode).id : value;
}

export function buildReferralGraphAdjacency(edges: GraphEdge[]) {
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    const source = getEdgeEndpoint(edge.source);
    const target = getEdgeEndpoint(edge.target);

    if (!adjacency.has(source)) {
      adjacency.set(source, new Set());
    }

    if (!adjacency.has(target)) {
      adjacency.set(target, new Set());
    }

    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  }

  return adjacency;
}

export function buildReferralGraphDirectedChildren(edges: GraphEdge[]) {
  const childrenByNodeId = new Map<string, Set<string>>();

  for (const edge of edges) {
    const source = getEdgeEndpoint(edge.source);
    const target = getEdgeEndpoint(edge.target);

    if (!childrenByNodeId.has(source)) {
      childrenByNodeId.set(source, new Set());
    }
    childrenByNodeId.get(source)?.add(target);

    if (!childrenByNodeId.has(target)) {
      childrenByNodeId.set(target, new Set());
    }
  }

  return childrenByNodeId;
}

export function getReferralGraphConnectedNodeIds(
  startId: string,
  adjacency: Map<string, Set<string>>,
) {
  const visited = new Set<string>([startId]);
  const queue = [startId];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return visited;
}

export function getReferralGraphLocalDragDepths(
  startId: string,
  adjacency: Map<string, Set<string>>,
  maxDepth = 2,
) {
  const depths = new Map<string, number>([[startId, 0]]);
  const queue = [{ nodeId: startId, depth: 0 }];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { nodeId, depth } = queue[cursor];
    if (depth >= maxDepth) {
      continue;
    }

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (depths.has(neighbor)) {
        continue;
      }

      const nextDepth = depth + 1;
      depths.set(neighbor, nextDepth);
      queue.push({ nodeId: neighbor, depth: nextDepth });
    }
  }

  return depths;
}

export function getReferralGraphDescendantNodeIds(
  startId: string,
  childrenByNodeId: Map<string, Set<string>>,
) {
  const visited = new Set<string>();
  const queue = [...(childrenByNodeId.get(startId) ?? [])];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current === startId || visited.has(current)) {
      continue;
    }

    visited.add(current);
    for (const childId of childrenByNodeId.get(current) ?? []) {
      if (childId !== startId && !visited.has(childId)) {
        queue.push(childId);
      }
    }
  }

  return visited;
}

export function getReferralGraphDescendantDepths(
  startId: string,
  childrenByNodeId: Map<string, Set<string>>,
) {
  const depths = new Map<string, number>();
  const queue = [...(childrenByNodeId.get(startId) ?? [])].map((nodeId) => ({
    nodeId,
    depth: 1,
  }));

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { nodeId, depth } = queue[cursor];
    if (nodeId === startId || depths.has(nodeId)) {
      continue;
    }

    depths.set(nodeId, depth);
    for (const childId of childrenByNodeId.get(nodeId) ?? []) {
      if (childId !== startId && !depths.has(childId)) {
        queue.push({ nodeId: childId, depth: depth + 1 });
      }
    }
  }

  return depths;
}

export type ReferralGraphDragFollowerTranslation = {
  x?: number;
  y?: number;
};

export type ReferralGraphDragFollowerTranslationOptions = {
  depthByNodeId?: ReadonlyMap<string, number>;
  depthDecay?: number;
  directChildScale?: number;
  maxPinnedDepth?: number;
  minScale?: number;
};

export type ReferralGraphDragFollowerNode = {
  id: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

function hasFiniteCoordinate(value: number | undefined): value is number {
  return Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getFollowerTranslationScale(
  nodeId: string,
  options?: ReferralGraphDragFollowerTranslationOptions,
) {
  const depthByNodeId = options?.depthByNodeId;
  if (!depthByNodeId) {
    return 1;
  }

  const depth = Math.max(1, depthByNodeId.get(nodeId) ?? 1);
  const directChildScale = clamp(options?.directChildScale ?? 0.94, 0, 1);
  const depthDecay = clamp(options?.depthDecay ?? 0.84, 0.2, 1);
  const minScale = clamp(options?.minScale ?? 0.5, 0, directChildScale);

  return clamp(
    directChildScale * (depthDecay ** Math.max(0, depth - 1)),
    minScale,
    directChildScale,
  );
}

function shouldPinFollower(
  nodeId: string,
  options?: ReferralGraphDragFollowerTranslationOptions,
) {
  if (!options?.depthByNodeId) {
    return true;
  }

  const maxPinnedDepth = options.maxPinnedDepth ?? 1;
  const depth = Math.max(1, options.depthByNodeId.get(nodeId) ?? 1);
  return depth <= maxPinnedDepth;
}

export function applyReferralGraphDragFollowerTranslation<T extends ReferralGraphDragFollowerNode>(
  nodesById: Map<string, T>,
  followerIds: Set<string>,
  translate?: ReferralGraphDragFollowerTranslation,
  options?: ReferralGraphDragFollowerTranslationOptions,
) {
  const dx = Number.isFinite(translate?.x) ? translate?.x ?? 0 : 0;
  const dy = Number.isFinite(translate?.y) ? translate?.y ?? 0 : 0;
  const movedIds = new Set<string>();

  if (dx === 0 && dy === 0) {
    return movedIds;
  }

  for (const nodeId of followerIds) {
    const node = nodesById.get(nodeId);
    if (!node || !hasFiniteCoordinate(node.x) || !hasFiniteCoordinate(node.y)) {
      continue;
    }

    const translationScale = getFollowerTranslationScale(nodeId, options);
    node.x += dx * translationScale;
    node.y += dy * translationScale;
    node.vx = 0;
    node.vy = 0;
    if (shouldPinFollower(nodeId, options)) {
      node.fx = node.x;
      node.fy = node.y;
    }
    movedIds.add(node.id);
  }

  return movedIds;
}

export function releaseReferralGraphDragFollowerNodes<T extends ReferralGraphDragFollowerNode>(
  nodesById: Map<string, T>,
  followerIds: Set<string>,
) {
  const targets = new Map<string, { x: number; y: number }>();

  for (const nodeId of followerIds) {
    const node = nodesById.get(nodeId);
    if (!node) {
      continue;
    }

    node.fx = undefined;
    node.fy = undefined;
    node.vx = 0;
    node.vy = 0;
    if (!hasFiniteCoordinate(node.x) || !hasFiniteCoordinate(node.y)) {
      continue;
    }

    targets.set(node.id, { x: node.x, y: node.y });
  }

  return targets;
}
