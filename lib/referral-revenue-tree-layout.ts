import type { SampleRevenueGraphNode } from '@/types/referral-revenue-graph';

export const SAMPLE_REVENUE_TREE_CANVAS_WIDTH = 440;
export const SAMPLE_REVENUE_TREE_NODE_WIDTH = 118;
export const SAMPLE_REVENUE_TREE_NODE_HEIGHT = 66;
export const SAMPLE_REVENUE_TREE_ROW_HEIGHT = 86;
export const SAMPLE_REVENUE_TREE_TOP = 24;

const SAMPLE_REVENUE_TREE_BRANCH_X = {
  viewer: 161,
  a: 24,
  b: 161,
  c: 298,
} as const;

export type SampleRevenueTreeBranch = keyof typeof SAMPLE_REVENUE_TREE_BRANCH_X;

export function getSampleRevenueTreeBranch(
  node: Pick<SampleRevenueGraphNode, 'depth' | 'id'>,
): SampleRevenueTreeBranch {
  if (node.depth === 0) return 'viewer';
  if (node.id.includes('-a')) return 'a';
  if (node.id.includes('-b')) return 'b';
  return 'c';
}

export function getSampleRevenueTreeNodePosition(
  node: Pick<SampleRevenueGraphNode, 'depth' | 'id'>,
) {
  return {
    x: SAMPLE_REVENUE_TREE_BRANCH_X[getSampleRevenueTreeBranch(node)],
    y: SAMPLE_REVENUE_TREE_TOP + node.depth * SAMPLE_REVENUE_TREE_ROW_HEIGHT,
  };
}

export function getSampleRevenueTreeCanvasHeight(
  nodes: readonly Pick<SampleRevenueGraphNode, 'depth'>[],
) {
  const maxDepth = Math.max(0, ...nodes.map((node) => node.depth));
  return SAMPLE_REVENUE_TREE_TOP
    + (maxDepth + 1) * SAMPLE_REVENUE_TREE_ROW_HEIGHT
    + SAMPLE_REVENUE_TREE_TOP;
}

export function getSampleRevenueTreeConnector(
  source: Pick<SampleRevenueGraphNode, 'depth' | 'id'>,
  target: Pick<SampleRevenueGraphNode, 'depth' | 'id'>,
) {
  const sourcePosition = getSampleRevenueTreeNodePosition(source);
  const targetPosition = getSampleRevenueTreeNodePosition(target);
  return {
    x1: sourcePosition.x + SAMPLE_REVENUE_TREE_NODE_WIDTH / 2,
    y1: sourcePosition.y + SAMPLE_REVENUE_TREE_NODE_HEIGHT,
    x2: targetPosition.x + SAMPLE_REVENUE_TREE_NODE_WIDTH / 2,
    y2: targetPosition.y,
  };
}
