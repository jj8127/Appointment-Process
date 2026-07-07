import type { GraphEdge, GraphNode } from '@/types/referral-graph';

function getEdgeEndpointId(value: GraphEdge['source'] | GraphEdge['target']) {
  return typeof value === 'object' ? (value as GraphNode).id : value;
}

export function buildReferralGraphDescendantCountMap(
  nodes: Array<Pick<GraphNode, 'id'>>,
  edges: GraphEdge[],
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const childrenByNodeId = new Map<string, Set<string>>();
  const counts = new Map<string, number>();

  for (const nodeId of nodeIds) {
    childrenByNodeId.set(nodeId, new Set());
    counts.set(nodeId, 0);
  }

  for (const edge of edges) {
    const source = getEdgeEndpointId(edge.source);
    const target = getEdgeEndpointId(edge.target);
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) {
      continue;
    }

    childrenByNodeId.get(source)?.add(target);
  }

  const collectDescendants = (nodeId: string, path: Set<string>, descendants: Set<string>) => {
    if (path.has(nodeId)) {
      return;
    }

    const nextPath = new Set(path);
    nextPath.add(nodeId);

    for (const childId of childrenByNodeId.get(nodeId) ?? []) {
      if (path.has(childId)) {
        continue;
      }

      descendants.add(childId);
      collectDescendants(childId, nextPath, descendants);
    }
  };

  for (const nodeId of nodeIds) {
    const descendants = new Set<string>();
    collectDescendants(nodeId, new Set(), descendants);
    descendants.delete(nodeId);
    counts.set(nodeId, descendants.size);
  }

  return counts;
}
