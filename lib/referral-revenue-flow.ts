import type {
  SampleRevenueGraphEdge,
  SampleRevenueGraphNode,
} from '@/types/referral-revenue-graph';

export type SampleRevenueEdgeFlow = SampleRevenueGraphEdge & {
  amountKrw: number;
  contributorCount: number;
};

type BuildFlowOptions = {
  contributorNodeIds?: ReadonlySet<string>;
};

const getEdgeKey = (source: string, target: string) => `${source}\u0000${target}`;

export function buildSampleRevenueEdgeFlows(
  nodes: readonly SampleRevenueGraphNode[],
  edges: readonly SampleRevenueGraphEdge[],
  options: BuildFlowOptions = {},
): SampleRevenueEdgeFlow[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesByRelationship = new Map(
    edges.map((edge) => [getEdgeKey(edge.source, edge.target), edge]),
  );
  const totalsByEdgeId = new Map<
    string,
    { amountKrw: number; contributorCount: number }
  >();

  for (const contributor of nodes) {
    if (
      contributor.isViewer
      || !contributor.eligible
      || contributor.expectedAllocationKrw <= 0
      || (
        options.contributorNodeIds
        && !options.contributorNodeIds.has(contributor.id)
      )
    ) {
      continue;
    }

    const visited = new Set<string>();
    let current = contributor;

    while (current.parentId !== null) {
      if (visited.has(current.id)) {
        throw new Error(`Cycle detected in sample revenue flow at ${current.id}`);
      }
      visited.add(current.id);

      const parent = nodesById.get(current.parentId);
      if (!parent) {
        throw new Error(
          `Missing sample revenue flow parent ${current.parentId}`,
        );
      }

      const edge = edgesByRelationship.get(
        getEdgeKey(parent.id, current.id),
      );
      if (!edge) {
        throw new Error(
          `Missing sample revenue flow edge ${parent.id} -> ${current.id}`,
        );
      }

      const currentTotal = totalsByEdgeId.get(edge.id) ?? {
        amountKrw: 0,
        contributorCount: 0,
      };
      totalsByEdgeId.set(edge.id, {
        amountKrw: currentTotal.amountKrw + contributor.expectedAllocationKrw,
        contributorCount: currentTotal.contributorCount + 1,
      });
      current = parent;
    }
  }

  return edges.map((edge) => ({
    ...edge,
    ...(totalsByEdgeId.get(edge.id) ?? {
      amountKrw: 0,
      contributorCount: 0,
    }),
  }));
}

export function getSampleRevenueDescendantCounts(
  nodes: readonly SampleRevenueGraphNode[],
): ReadonlyMap<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const childrenByParentId = new Map<string, string[]>();

  for (const node of nodes) {
    if (node.parentId === null || !nodeIds.has(node.parentId)) continue;
    const children = childrenByParentId.get(node.parentId) ?? [];
    children.push(node.id);
    childrenByParentId.set(node.parentId, children);
  }

  const memo = new Map<string, number>();
  const countDescendants = (nodeId: string, path: ReadonlySet<string>): number => {
    const cached = memo.get(nodeId);
    if (cached !== undefined) return cached;
    if (path.has(nodeId)) {
      throw new Error(`Cycle detected in sample revenue descendants at ${nodeId}`);
    }

    const nextPath = new Set(path);
    nextPath.add(nodeId);
    const count = (childrenByParentId.get(nodeId) ?? []).reduce(
      (total, childId) => (
        total + 1 + countDescendants(childId, nextPath)
      ),
      0,
    );
    memo.set(nodeId, count);
    return count;
  };

  for (const node of nodes) {
    countDescendants(node.id, new Set());
  }

  return memo;
}

export function formatSampleRevenueFlowKrw(amountKrw: number): string {
  if (!Number.isFinite(amountKrw) || amountKrw < 0) {
    throw new Error('Sample revenue flow amount must be non-negative and finite');
  }

  if (amountKrw < 10_000) {
    return `${Math.round(amountKrw).toLocaleString('ko-KR')}원`;
  }

  const tenThousands = amountKrw / 10_000;
  const rounded = Math.round(tenThousands * 10) / 10;
  const fractionDigits = Number.isInteger(rounded) ? 0 : 1;
  return `${rounded.toLocaleString('ko-KR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}만`;
}
