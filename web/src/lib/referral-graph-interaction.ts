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
