import type {
  ReferralGraphEdge,
  ReferralGraphNode,
  ReferralGraphPoint,
  ReferralGraphStatusFilter,
  ReferralGraphViewport,
} from '@/types/referral-graph';

export const REFERRAL_GRAPH_SURFACE_SIZE = 1800;
export const REFERRAL_GRAPH_SURFACE_CENTER = REFERRAL_GRAPH_SURFACE_SIZE / 2;
export const REFERRAL_GRAPH_MIN_SCALE = 0.25;
export const REFERRAL_GRAPH_MAX_SCALE = 6;
export const REFERRAL_GRAPH_FIT_PADDING = 56;

const DEPTH_GAP = 168;
const MIN_DEPTH_ARC_SPACING = 72;
const DISCONNECTED_RING_GAP = 96;
const SURFACE_EDGE_MARGIN = 96;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const compareNode = (a: ReferralGraphNode, b: ReferralGraphNode) =>
  a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id);

export function getReferralGraphNodeRadius(totalDescendantCount: number) {
  const safeCount = Math.max(0, Number(totalDescendantCount) || 0);
  return (4.6 + Math.min(Math.log1p(safeCount) * 2.15, 9.4)) * 1.25;
}

export function getReferralGraphNodeColor(node: ReferralGraphNode) {
  if (node.isViewer) return '#facc15';
  if (node.allCommissionsCompleted) return '#0f9f6e';
  if (node.signupCompleted) return '#ea580c';
  return '#94a3b8';
}

export function getReferralGraphNodeStatusLabel(node: ReferralGraphNode) {
  if (node.isViewer) return '현재 사용자';
  if (node.allCommissionsCompleted) return '모든 위촉 완료';
  if (node.signupCompleted) return '본등록 완료';
  return '사전등록';
}

export function normalizeReferralGraph(
  nodes: ReferralGraphNode[],
  edges: ReferralGraphEdge[],
) {
  const nodeMap = new Map<string, ReferralGraphNode>();
  for (const node of nodes) {
    if (!node?.id || nodeMap.has(node.id)) continue;
    nodeMap.set(node.id, {
      ...node,
      name: node.name.trim() || '이름 없음',
      affiliation: node.affiliation.trim(),
      directInviteeCount: Math.max(0, Number(node.directInviteeCount) || 0),
      totalDescendantCount: Math.max(0, Number(node.totalDescendantCount) || 0),
    });
  }

  const edgeMap = new Map<string, ReferralGraphEdge>();
  for (const edge of edges) {
    if (
      !edge?.source
      || !edge.target
      || edge.source === edge.target
      || !nodeMap.has(edge.source)
      || !nodeMap.has(edge.target)
    ) {
      continue;
    }

    const id = `${edge.source}__${edge.target}`;
    if (!edgeMap.has(id)) {
      edgeMap.set(id, { id, source: edge.source, target: edge.target });
    }
  }

  return {
    nodes: Array.from(nodeMap.values()).sort(compareNode),
    edges: Array.from(edgeMap.values()).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function buildGraphMaps(nodes: ReferralGraphNode[], edges: ReferralGraphEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const children = new Map<string, string[]>();
  const inboundCount = new Map<string, number>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const nextChildren = children.get(edge.source) ?? [];
    nextChildren.push(edge.target);
    children.set(edge.source, nextChildren);
    inboundCount.set(edge.target, (inboundCount.get(edge.target) ?? 0) + 1);
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const [parentId, childIds] of children) {
    children.set(
      parentId,
      Array.from(new Set(childIds)).sort((a, b) => {
        const nodeA = nodeById.get(a);
        const nodeB = nodeById.get(b);
        if (!nodeA || !nodeB) return a.localeCompare(b);
        return compareNode(nodeA, nodeB);
      }),
    );
  }

  return { children, inboundCount, nodeById };
}

function collectLeafWeight(
  nodeId: string,
  children: Map<string, string[]>,
  memo: Map<string, number>,
  path = new Set<string>(),
): number {
  const cached = memo.get(nodeId);
  if (cached != null) return cached;
  if (path.has(nodeId)) return 1;

  const nextPath = new Set(path);
  nextPath.add(nodeId);
  const childIds = (children.get(nodeId) ?? []).filter((childId) => !nextPath.has(childId));
  const weight = childIds.length === 0
    ? 1
    : childIds.reduce(
      (total, childId) => total + collectLeafWeight(childId, children, memo, nextPath),
      0,
    );
  const safeWeight = Math.max(1, weight);
  memo.set(nodeId, safeWeight);
  return safeWeight;
}

export function buildReferralGraphLayout(
  rawNodes: ReferralGraphNode[],
  rawEdges: ReferralGraphEdge[],
) {
  const { nodes, edges } = normalizeReferralGraph(rawNodes, rawEdges);
  const positions = new Map<string, ReferralGraphPoint>();
  if (nodes.length === 0) return positions;

  const { children, inboundCount } = buildGraphMaps(nodes, edges);
  const viewer = nodes.find((node) => node.isViewer);
  const root = viewer
    ?? nodes.find((node) => (inboundCount.get(node.id) ?? 0) === 0)
    ?? nodes[0];
  const leafWeight = new Map<string, number>();
  const visited = new Set<string>();
  const depthByNode = new Map<string, number>([[root.id, 0]]);
  const depthCounts = new Map<number, number>();
  const depthQueue = [root.id];
  for (let cursor = 0; cursor < depthQueue.length; cursor += 1) {
    const nodeId = depthQueue[cursor];
    const depth = depthByNode.get(nodeId) ?? 0;
    for (const childId of children.get(nodeId) ?? []) {
      if (depthByNode.has(childId)) continue;
      const childDepth = depth + 1;
      depthByNode.set(childId, childDepth);
      depthCounts.set(childDepth, (depthCounts.get(childDepth) ?? 0) + 1);
      depthQueue.push(childId);
    }
  }

  const radiusByDepth = new Map<number, number>();
  let previousRadius = 0;
  for (const depth of Array.from(depthCounts.keys()).sort((a, b) => a - b)) {
    const nodeCount = depthCounts.get(depth) ?? 1;
    const breadthRadius = (nodeCount * MIN_DEPTH_ARC_SPACING) / (2 * Math.PI);
    const radius = Math.max(
      DEPTH_GAP * depth,
      previousRadius + DEPTH_GAP,
      breadthRadius,
    );
    radiusByDepth.set(depth, radius);
    previousRadius = radius;
  }

  const placeBranch = (
    nodeId: string,
    depth: number,
    startAngle: number,
    endAngle: number,
    path = new Set<string>(),
  ) => {
    if (visited.has(nodeId) || path.has(nodeId)) return;
    visited.add(nodeId);
    const nextPath = new Set(path);
    nextPath.add(nodeId);

    if (depth === 0) {
      positions.set(nodeId, {
        x: REFERRAL_GRAPH_SURFACE_CENTER,
        y: REFERRAL_GRAPH_SURFACE_CENTER,
      });
    } else {
      const angle = (startAngle + endAngle) / 2;
      const radius = radiusByDepth.get(depth) ?? DEPTH_GAP * depth;
      positions.set(nodeId, {
        x: REFERRAL_GRAPH_SURFACE_CENTER + Math.cos(angle) * radius,
        y: REFERRAL_GRAPH_SURFACE_CENTER + Math.sin(angle) * radius,
      });
    }

    const childIds = (children.get(nodeId) ?? []).filter(
      (childId) => !nextPath.has(childId) && !visited.has(childId),
    );
    if (childIds.length === 0) return;

    const totalWeight = childIds.reduce(
      (total, childId) => total + collectLeafWeight(childId, children, leafWeight, nextPath),
      0,
    );
    const availableSweep = Math.max(0, endAngle - startAngle);
    const childRadius = radiusByDepth.get(depth + 1) ?? DEPTH_GAP * (depth + 1);
    const minimumSweep = Math.min(
      availableSweep / Math.max(1, childIds.length),
      MIN_DEPTH_ARC_SPACING / Math.max(1, childRadius),
    );
    const weightedSweep = Math.max(
      0,
      availableSweep - minimumSweep * childIds.length,
    );
    let cursor = startAngle;
    for (const childId of childIds) {
      const childWeight = collectLeafWeight(childId, children, leafWeight, nextPath);
      const sweep = minimumSweep
        + (weightedSweep * childWeight) / Math.max(1, totalWeight);
      placeBranch(childId, depth + 1, cursor, cursor + sweep, nextPath);
      cursor += sweep;
    }
  };

  placeBranch(root.id, 0, -Math.PI, Math.PI);

  const unplaced = nodes.filter((node) => !positions.has(node.id));
  const disconnectedRadius = Math.min(
    REFERRAL_GRAPH_SURFACE_CENTER - 80,
    DEPTH_GAP + Math.ceil(Math.sqrt(nodes.length)) * DISCONNECTED_RING_GAP,
  );
  unplaced.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, unplaced.length) - Math.PI / 2;
    positions.set(node.id, {
      x: REFERRAL_GRAPH_SURFACE_CENTER + Math.cos(angle) * disconnectedRadius,
      y: REFERRAL_GRAPH_SURFACE_CENTER + Math.sin(angle) * disconnectedRadius,
    });
  });

  const maxOffset = Math.max(
    1,
    ...Array.from(positions.values()).flatMap((point) => [
      Math.abs(point.x - REFERRAL_GRAPH_SURFACE_CENTER),
      Math.abs(point.y - REFERRAL_GRAPH_SURFACE_CENTER),
    ]),
  );
  const availableOffset = REFERRAL_GRAPH_SURFACE_CENTER - SURFACE_EDGE_MARGIN;
  if (maxOffset > availableOffset) {
    const compression = availableOffset / maxOffset;
    for (const [nodeId, point] of positions.entries()) {
      positions.set(nodeId, {
        x: REFERRAL_GRAPH_SURFACE_CENTER
          + (point.x - REFERRAL_GRAPH_SURFACE_CENTER) * compression,
        y: REFERRAL_GRAPH_SURFACE_CENTER
          + (point.y - REFERRAL_GRAPH_SURFACE_CENTER) * compression,
      });
    }
  }

  return positions;
}

export function getReferralGraphFitViewport(options: {
  nodes: ReferralGraphNode[];
  positions: Map<string, ReferralGraphPoint>;
  width: number;
  height: number;
  padding?: number;
}): ReferralGraphViewport {
  const { nodes, positions, width, height } = options;
  const padding = Math.max(0, options.padding ?? REFERRAL_GRAPH_FIT_PADDING);
  const visiblePoints = nodes
    .map((node) => {
      const point = positions.get(node.id);
      if (!point) return null;
      const radius = getReferralGraphNodeRadius(node.totalDescendantCount) + 34;
      return { ...point, radius };
    })
    .filter((point): point is ReferralGraphPoint & { radius: number } => Boolean(point));

  if (visiblePoints.length === 0 || width <= 0 || height <= 0) {
    return { scale: 1, panX: 0, panY: 0 };
  }

  const minX = Math.min(...visiblePoints.map((point) => point.x - point.radius));
  const maxX = Math.max(...visiblePoints.map((point) => point.x + point.radius));
  const minY = Math.min(...visiblePoints.map((point) => point.y - point.radius));
  const maxY = Math.max(...visiblePoints.map((point) => point.y + point.radius));
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = clamp(
    Math.min(availableWidth / graphWidth, availableHeight / graphHeight),
    REFERRAL_GRAPH_MIN_SCALE,
    REFERRAL_GRAPH_MAX_SCALE,
  );
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    scale,
    panX: -(centerX - REFERRAL_GRAPH_SURFACE_CENTER) * scale,
    panY: -(centerY - REFERRAL_GRAPH_SURFACE_CENTER) * scale,
  };
}

export function getReferralGraphNeighborhood(
  selectedNodeId: string | null,
  edges: ReferralGraphEdge[],
  maxHops: number,
) {
  if (!selectedNodeId) return null;
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const visible = new Set<string>([selectedNodeId]);
  let frontier = [selectedNodeId];
  for (let hop = 0; hop < Math.max(0, Math.trunc(maxHops)); hop += 1) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const neighborId of adjacency.get(nodeId) ?? []) {
        if (visible.has(neighborId)) continue;
        visible.add(neighborId);
        next.push(neighborId);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return visible;
}

export function matchesReferralGraphStatus(
  node: ReferralGraphNode,
  filter: ReferralGraphStatusFilter,
) {
  if (filter === 'all') return true;
  if (filter === 'commissioned') return node.allCommissionsCompleted;
  if (filter === 'registered') return node.signupCompleted && !node.allCommissionsCompleted;
  return !node.signupCompleted;
}

export function filterReferralGraphNodes(options: {
  nodes: ReferralGraphNode[];
  searchTerm: string;
  statusFilter: ReferralGraphStatusFilter;
  neighborhood?: Set<string> | null;
}) {
  const keyword = options.searchTerm.trim().toLocaleLowerCase('ko');
  return options.nodes.filter((node) => {
    if (options.neighborhood && !options.neighborhood.has(node.id)) return false;
    if (!matchesReferralGraphStatus(node, options.statusFilter)) return false;
    if (!keyword) return true;
    return [node.name, node.affiliation, node.activeCode ?? '']
      .some((value) => value.toLocaleLowerCase('ko').includes(keyword));
  });
}
