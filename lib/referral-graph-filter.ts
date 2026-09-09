import { filterReferralGraphNodes } from './referral-graph-native';
import type { ReferralGraphEdge, ReferralGraphNode } from '@/types/referral-graph';

type FilterOptions = Omit<Parameters<typeof filterReferralGraphNodes>[0], 'nodes'>;
type VisibleGraph = { nodes: ReferralGraphNode[]; edges: ReferralGraphEdge[] };

function sameOrderedObjects<T>(previous: T[], next: T[]) {
  return previous.length === next.length && previous.every((item, index) => item === next[index]);
}

/** One selector belongs to one immutable graph snapshot; no account data is shared. */
export function createReferralGraphFilter(nodes: ReferralGraphNode[], edges: ReferralGraphEdge[]) {
  let previous: VisibleGraph | null = null;

  return (options: FilterOptions): VisibleGraph => {
    const nextNodes = filterReferralGraphNodes({ ...options, nodes });
    if (previous && sameOrderedObjects(previous.nodes, nextNodes)) return previous;

    const visibleIds = new Set(nextNodes.map((node) => node.id));
    const nextEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    previous = {
      nodes: nextNodes,
      edges: previous && sameOrderedObjects(previous.edges, nextEdges) ? previous.edges : nextEdges,
    };
    return previous;
  };
}
