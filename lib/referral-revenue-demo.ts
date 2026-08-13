import type {
  SampleRevenueDepthFilter,
  SampleRevenueGraphModel,
  SampleRevenueGraphNode,
  SampleRevenueRawNode,
} from '@/types/referral-revenue-graph';

export const SAMPLE_REVENUE_MIN_DEPTH = 1;
export const SAMPLE_REVENUE_MAX_DEPTH = 10;
export const SAMPLE_REVENUE_RATE_BPS = 1_000;

const BASIS_POINTS_DENOMINATOR = 10_000;

const compareSampleRevenueNodeIds = (
  left: SampleRevenueGraphNode,
  right: SampleRevenueGraphNode,
): number => {
  if (left.id === right.id) {
    return 0;
  }

  return left.id < right.id ? -1 : 1;
};

export const deriveSampleRevenueDepths = (
  nodes: readonly SampleRevenueRawNode[],
): ReadonlyMap<string, number> => {
  const nodesById = new Map<string, SampleRevenueRawNode>();

  for (const node of nodes) {
    if (nodesById.has(node.id)) {
      throw new Error(`Duplicate sample revenue node id: ${node.id}`);
    }
    nodesById.set(node.id, node);
  }

  const roots = nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1) {
    throw new Error(
      `Sample revenue graph must contain exactly one root; received ${roots.length}`,
    );
  }

  for (const node of nodes) {
    if (node.parentId !== null && !nodesById.has(node.parentId)) {
      throw new Error(
        `Orphan sample revenue node ${node.id}: missing parent ${node.parentId}`,
      );
    }
  }

  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  const deriveDepth = (nodeId: string): number => {
    const existingDepth = depths.get(nodeId);
    if (existingDepth !== undefined) {
      return existingDepth;
    }

    if (visiting.has(nodeId)) {
      throw new Error(`Cycle detected in sample revenue graph at node ${nodeId}`);
    }

    const node = nodesById.get(nodeId);
    if (!node) {
      throw new Error(`Orphan sample revenue node reference: ${nodeId}`);
    }

    visiting.add(nodeId);
    const depth = node.parentId === null
      ? 0
      : deriveDepth(node.parentId) + 1;
    visiting.delete(nodeId);
    depths.set(nodeId, depth);

    return depth;
  };

  for (const node of nodes) {
    deriveDepth(node.id);
  }

  return depths;
};

export const isSampleRevenueEligibleDepth = (depth: number): boolean => (
  Number.isInteger(depth)
  && depth >= SAMPLE_REVENUE_MIN_DEPTH
  && depth <= SAMPLE_REVENUE_MAX_DEPTH
);

export const calculateSampleRevenueAllocationKrw = (
  salesKrw: number,
  depth: number,
): number => {
  if (!Number.isFinite(salesKrw) || salesKrw < 0) {
    throw new Error('Sample revenue salesKrw must be a non-negative finite number');
  }

  if (!isSampleRevenueEligibleDepth(depth)) {
    return 0;
  }

  return Math.round(
    (salesKrw * SAMPLE_REVENUE_RATE_BPS) / BASIS_POINTS_DENOMINATOR,
  );
};

export const buildSampleRevenueGraphModel = (
  rawNodes: readonly SampleRevenueRawNode[],
): SampleRevenueGraphModel => {
  const depths = deriveSampleRevenueDepths(rawNodes);
  const rawNodesById = new Map(rawNodes.map((node) => [node.id, node]));
  const nodes = rawNodes.map<SampleRevenueGraphNode>((rawNode) => {
    const depth = depths.get(rawNode.id);
    if (depth === undefined) {
      throw new Error(`Missing derived sample revenue depth for ${rawNode.id}`);
    }

    const isViewer = rawNode.parentId === null;
    const eligible = isSampleRevenueEligibleDepth(depth);
    const pathNames: string[] = [];
    let pathNode: SampleRevenueRawNode | undefined = rawNode;
    while (pathNode) {
      pathNames.unshift(pathNode.name);
      pathNode = pathNode.parentId === null
        ? undefined
        : rawNodesById.get(pathNode.parentId);
    }

    return {
      id: rawNode.id,
      parentId: rawNode.parentId,
      name: rawNode.name,
      affiliation: rawNode.affiliation,
      salesKrw: rawNode.salesKrw,
      depth,
      pathNames,
      isViewer,
      eligible,
      expectedAllocationKrw: calculateSampleRevenueAllocationKrw(
        rawNode.salesKrw,
        depth,
      ),
    };
  });

  const eligibleNodes = nodes.filter((node) => !node.isViewer && node.eligible);
  const excludedNodes = nodes.filter((node) => !node.isViewer && !node.eligible);

  return {
    nodes,
    edges: rawNodes.flatMap((node) => (
      node.parentId === null
        ? []
        : [{
          id: `${node.parentId}__${node.id}`,
          source: node.parentId,
          target: node.id,
        }]
    )),
    summary: {
      eligibleContributorCount: eligibleNodes.length,
      eligibleSalesKrw: eligibleNodes.reduce(
        (total, node) => total + node.salesKrw,
        0,
      ),
      expectedAllocationKrw: eligibleNodes.reduce(
        (total, node) => total + node.expectedAllocationKrw,
        0,
      ),
      excludedContributorCount: excludedNodes.length,
    },
  };
};

const SAMPLE_REVENUE_DEPTH_FILTER_BOUNDS: Record<
  Exclude<SampleRevenueDepthFilter, 'all'>,
  readonly [minDepth: number, maxDepth: number]
> = {
  '1-3': [1, 3],
  '4-6': [4, 6],
  '7-10': [7, 10],
};

export const filterSampleRevenueNodesByDepth = (
  nodes: readonly SampleRevenueGraphNode[],
  filter: SampleRevenueDepthFilter,
): SampleRevenueGraphNode[] => {
  if (filter === 'all') {
    return [...nodes];
  }

  const [minDepth, maxDepth] = SAMPLE_REVENUE_DEPTH_FILTER_BOUNDS[filter];

  return nodes.filter(
    (node) => (
      node.isViewer
      || (node.depth >= minDepth && node.depth <= maxDepth)
    ),
  );
};

export const getSampleRevenueGraphContextNodes = (
  nodes: readonly SampleRevenueGraphNode[],
  filter: SampleRevenueDepthFilter,
): SampleRevenueGraphNode[] => {
  if (filter === 'all') {
    return [...nodes];
  }

  const selectedNodes = filterSampleRevenueNodesByDepth(nodes, filter);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const contextNodeIds = new Set(selectedNodes.map((node) => node.id));

  for (const selectedNode of selectedNodes) {
    let parentId = selectedNode.parentId;
    while (parentId !== null) {
      const parent = nodesById.get(parentId);
      if (!parent) {
        throw new Error(
          `Missing sample revenue graph context parent ${parentId}`,
        );
      }

      contextNodeIds.add(parent.id);
      parentId = parent.parentId;
    }
  }

  return nodes.filter((node) => contextNodeIds.has(node.id));
};

export const sortSampleRevenueNodesByExpectedAmount = (
  nodes: readonly SampleRevenueGraphNode[],
): SampleRevenueGraphNode[] => (
  [...nodes].sort((left, right) => (
    Number(right.eligible) - Number(left.eligible)
    || right.expectedAllocationKrw - left.expectedAllocationKrw
    || compareSampleRevenueNodeIds(left, right)
  ))
);

export const formatSampleRevenueKrw = (amountKrw: number): string => {
  if (!Number.isFinite(amountKrw)) {
    throw new Error('Sample revenue amount must be finite');
  }

  return `${Math.round(amountKrw).toLocaleString('ko-KR')}원`;
};
